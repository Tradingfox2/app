"""Wearables (Terra live path, sample data only for the demo account).

- "Sources connectées": connect/disconnect/sync per provider.
- POST /webhooks/terra maps the current Terra daily, sleep, and body models
  into wearable_metrics. Real OAuth starts once TERRA_API_KEY and TERRA_DEV_ID
  are set. Those names are listed in .env.production.example with no values.

Gym QR check-ins live in routers/gyms.py.
"""
import csv
import io
import json
import os
import random
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests as http
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator

from server import clean, current_user, db, new_id, now, require_pro
from terra_labs import verify_webhook_signature
from routers.labs import claim_terra_lab_event, process_claimed_terra_lab_event

router = APIRouter()

TERRA_CONFIGURED = bool(os.environ.get("TERRA_API_KEY") and os.environ.get("TERRA_DEV_ID"))
TERRA_SIGNING_SECRET = os.environ.get("TERRA_SIGNING_SECRET", "")
TERRA_WIDGET_URL = os.environ.get("TERRA_WIDGET_URL", "https://access.tryterra.co/api/widget/session")
# Where Terra sends the browser after the provider login (frontend /sources route).
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "http://localhost:8082").rstrip("/")
TERRA_PROVIDER_CODES = {"garmin": "GARMIN", "whoop": "WHOOP", "fitbit": "FITBIT", "oura": "OURA"}
SDK_ONLY_PROVIDERS = {"apple_health", "health_connect", "samsung_health"}
# Technogym Mywellness cloud (gym equipment). Real activation needs a commercial
# agreement + API key + auth domain from a local Technogym rep; endpoints then
# live at https://enterprise.mywellness.com/api. Docs: https://apidocs.mywellness.com
TECHNOGYM_CONFIGURED = bool(
    os.environ.get("TECHNOGYM_API_KEY") and os.environ.get("TECHNOGYM_AUTH_DOMAIN")
)
# EGYM (Fitness First Ravensburg and many EGYM smart-strength clubs).
EGYM_CONFIGURED = bool(os.environ.get("EGYM_API_KEY"))

# provider -> metadata. `kind` groups the UI ("wearable" vs "equipment").
# `provides` documents what normalized data the source feeds into IronFlow.
PROVIDER_INFO: dict[str, dict] = {
    # ---- wearables & health apps (via Terra) ----------------------------- #
    "garmin": {"kind": "wearable", "label": "Garmin",
               "provides": ["hrv", "resting_hr", "sleep_hours", "steps", "calories", "vo2max"]},
    "whoop": {"kind": "wearable", "label": "Whoop",
              "provides": ["hrv", "recovery", "strain", "sleep_hours", "resting_hr"]},
    "fitbit": {"kind": "wearable", "label": "Fitbit",
               "provides": ["hrv", "resting_hr", "sleep_hours", "steps", "calories"]},
    "oura": {"kind": "wearable", "label": "Oura",
             "provides": ["hrv", "resting_hr", "sleep_hours", "recovery"]},
    "apple_health": {"kind": "wearable", "label": "Apple Health",
                     "provides": ["hrv", "resting_hr", "sleep_hours", "steps"]},
    "health_connect": {"kind": "wearable", "label": "Health Connect",
                       "provides": ["hrv", "resting_hr", "sleep_hours", "steps"]},
    "samsung_health": {"kind": "wearable", "label": "Samsung Health",
                       "provides": ["resting_hr", "sleep_hours", "steps", "calories"],
                       "import_formats": ["zip", "csv"],
                       "note": "Live sync needs the Android app build. Today: Samsung Health > Settings > Download personal data, then import the file here."},
    # ---- gym equipment & clubs ------------------------------------------ #
    "technogym": {
        "kind": "equipment",
        "label": "Technogym · Mywellness",
        "provides": ["gym_sessions", "strength_sets", "wellness_age", "biometrics"],
        "requires_agreement": True,
        "docs": "https://apidocs.mywellness.com",
        "note": "Ravensburg area: MTG Sportinsel (Wangen), Allgäu-Fitness (Isny).",
    },
    "egym": {
        "kind": "equipment",
        "label": "EGYM Smart Strength",
        "provides": ["gym_sessions", "strength_sets"],
        "requires_agreement": True,
        "docs": "https://www.egym.com",
        "note": "Ravensburg: Fitness First (EGYM smart-strength circuit).",
    },
}
PROVIDERS = list(PROVIDER_INFO)
EQUIPMENT_PROVIDERS = {p for p, m in PROVIDER_INFO.items() if m["kind"] == "equipment"}


def _provider_configured(provider: str) -> bool:
    if provider == "technogym":
        return TECHNOGYM_CONFIGURED
    if provider == "egym":
        return EGYM_CONFIGURED
    return TERRA_CONFIGURED


def _source_mode(provider: str, demo: bool) -> str:
    """cloud = real integration live · simulated = test-account sample · pending = awaiting creds."""
    if provider in SDK_ONLY_PROVIDERS:
        return "simulated" if demo else "pending"
    if _provider_configured(provider):
        return "cloud"
    return "simulated" if demo else "pending"

# Simulated wearable data + seeded demo gyms exist ONLY for the test account(s).
# Real athletes get real data (Terra webhook) or an honest empty state.
DEMO_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("DEMO_EMAILS", "demo@ironflow.app").split(",")
    if e.strip()
}


def is_demo_user(user: dict) -> bool:
    return (user.get("email") or "").lower() in DEMO_EMAILS

METRIC_UNITS = {
    "hrv": "ms",
    "resting_hr": "bpm",
    "sleep_hours": "h",
    "steps": "steps",
    "calories": "kcal",
    "vo2max": "ml/kg/min",
    "strain": "",
    "recovery": "%",
    "soreness": "1-5",
    "mood": "1-5",
}
MANUAL_DEVICE = "manual"

# Flat aliases kept for older test payloads. A nested Terra field wins when both exist.
TERRA_FIELD_MAP = {
    "hrv_avg": "hrv",
    "rmssd_avg": "hrv",
    "resting_hr": "resting_hr",
    "resting_heartrate": "resting_hr",
    "sleep_hours": "sleep_hours",
    "sleep_duration_hours": "sleep_hours",
    "steps": "steps",
    "calories": "calories",
    "total_burned_calories": "calories",
    "vo2max": "vo2max",
    "vo2_max": "vo2max",
    "strain": "strain",
    "recovery": "recovery",
    "recovery_score": "recovery",
}

# Current Terra models (docs.tryterra.co data models, schema 2022-03-16).
# Daily steps live on distance_data.steps. Activity steps live on
# distance_data.summary.steps and are a workout, not the day total.
# Whoop recovery is daily scores.recovery (0-100). Whoop strain is
# strain_data.strain_level. Sleep scores.sleep is a score, not hours.
# readiness_data.recovery_level is an enum (0-6), not a percent.
# data_enrichment is Terra's own score and is not a device reading.
# Garmin VO2 max arrives on the body payload. The point field wins over the
# day average when both are numbers; they are never averaged.
# Body heart-rate summary is under heart_data.heart_rate_data, not the daily path.
TERRA_NESTED_METRICS = {
    "daily": {
        ("heart_rate_data", "summary", "avg_hrv_rmssd"): "hrv",
        ("heart_rate_data", "summary", "resting_hr_bpm"): "resting_hr",
        ("distance_data", "steps"): "steps",
        ("calories_data", "total_burned_calories"): "calories",
        ("oxygen_data", "day_avg_vo2max_ml_per_min_per_kg"): "vo2max",
        ("oxygen_data", "vo2max_ml_per_min_per_kg"): "vo2max",
        ("strain_data", "strain_level"): "strain",
        ("scores", "recovery"): "recovery",
    },
    "sleep": {
        ("heart_rate_data", "summary", "avg_hrv_rmssd"): "hrv",
        ("heart_rate_data", "summary", "resting_hr_bpm"): "resting_hr",
        ("readiness_data", "readiness"): "recovery",
    },
    "body": {
        ("heart_data", "heart_rate_data", "summary", "avg_hrv_rmssd"): "hrv",
        ("heart_data", "heart_rate_data", "summary", "resting_hr_bpm"): "resting_hr",
        ("oxygen_data", "day_avg_vo2max_ml_per_min_per_kg"): "vo2max",
        ("oxygen_data", "vo2max_ml_per_min_per_kg"): "vo2max",
    },
}

_ASLEEP_TOTAL = ("sleep_durations_data", "asleep", "duration_asleep_state_seconds")
_ASLEEP_STAGES = (
    ("sleep_durations_data", "asleep", "duration_deep_sleep_state_seconds"),
    ("sleep_durations_data", "asleep", "duration_light_sleep_state_seconds"),
    ("sleep_durations_data", "asleep", "duration_REM_sleep_state_seconds"),
)


def _nested_value(item: dict, path: tuple[str, ...]):
    value = item
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _terra_number(value):
    """A Terra metric is a JSON number. Booleans are ints in Python and are not readings."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _sleep_hours_from_terra(item: dict) -> float | None:
    """Hours asleep from the current sleep model.

    ``duration_asleep_state_seconds`` is the total when Terra sends it. When
    that field is null and stage seconds are present, the total is the sum of
    those stages (Terra documents this for Garmin and Whoop). In-bed time
    includes awake time, so it is not a substitute. A sleep score is not a duration.
    """
    total = _terra_number(_nested_value(item, _ASLEEP_TOTAL))
    if total is not None:
        return total / 3600
    stages = []
    for path in _ASLEEP_STAGES:
        number = _terra_number(_nested_value(item, path))
        if number is not None:
            stages.append(number)
    if not stages:
        return None
    return sum(stages) / 3600


def _terra_metric_values(event_type: str | None, item: dict) -> dict[str, float]:
    """Map one Terra data item. Missing fields stay missing. Nothing is filled in."""
    values: dict[str, float] = {}
    for path, metric in TERRA_NESTED_METRICS.get(event_type or "", {}).items():
        number = _terra_number(_nested_value(item, path))
        if number is not None:
            values[metric] = number
    if event_type == "sleep":
        hours = _sleep_hours_from_terra(item)
        if hours is not None:
            values["sleep_hours"] = hours
    for field, metric in TERRA_FIELD_MAP.items():
        if metric in values:
            continue
        number = _terra_number(item.get(field))
        if number is not None:
            values[metric] = number
    return values


def _terra_recorded_at(item: dict) -> datetime:
    value = (item.get("metadata") or {}).get("start_time") or item.get("timestamp")
    if not value:
        return now()
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return now()


def _terra_item_key(event_type: str, item: dict) -> str:
    metadata = item.get("metadata") or {}
    if event_type in {"activity", "sleep"}:
        return str(metadata.get("summary_id") or f"{metadata.get('start_time')}:{metadata.get('end_time')}")
    return str(item.get("timestamp") or f"{metadata.get('start_time')}:{metadata.get('end_time')}")


class ManualMorningIn(BaseModel):
    """Sleep, soreness, and mood for one local day. No score field."""

    model_config = ConfigDict(extra="forbid")
    sleep_hours: float = Field(ge=3, le=12)
    soreness: int = Field(ge=1, le=5)
    mood: int = Field(ge=1, le=5)
    local_day: str

    @field_validator("local_day")
    @classmethod
    def _local_day(cls, value: str) -> str:
        try:
            day = datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError("local day must be YYYY-MM-DD") from exc
        if abs((day - now().date()).days) > 1:
            raise ValueError("local day must be yesterday, today, or tomorrow")
        return value


@router.post("/wearables/manual")
async def manual_morning(body: ManualMorningIn, user: dict = Depends(current_user)):
    """Upsert this athlete's morning check-in for one local day.

    Writes ``sleep_hours``, ``soreness``, and ``mood`` on ``wearable_metrics``
    with ``device`` ``manual`` and ``simulated`` false. A second submit the
    same local day updates those rows. It does not write a recovery or
    readiness score. Skipping the screen does not call this route.
    """
    recorded_at = now()
    values = {
        "sleep_hours": round(float(body.sleep_hours), 1),
        "soreness": float(body.soreness),
        "mood": float(body.mood),
    }
    for metric, value in values.items():
        await db.wearable_metrics.update_one(
            {
                "user_id": user["id"],
                "device": MANUAL_DEVICE,
                "metric": metric,
                "local_day": body.local_day,
            },
            {
                "$set": {
                    "value": value,
                    "unit": METRIC_UNITS.get(metric),
                    "recorded_at": recorded_at,
                    "simulated": False,
                },
                "$setOnInsert": {
                    "id": new_id(),
                    "user_id": user["id"],
                    "metric": metric,
                    "device": MANUAL_DEVICE,
                    "local_day": body.local_day,
                    "created_at": recorded_at,
                },
            },
            upsert=True,
        )
    return {
        "local_day": body.local_day,
        "device": MANUAL_DEVICE,
        "simulated": False,
        "metrics": list(values),
    }


# --------------------------------------------------------------------------- #
# Sources connectées                                                          #
# --------------------------------------------------------------------------- #
@router.get("/wearables/sources")
async def list_sources(user: dict = Depends(current_user)):
    docs = {
        d["provider"]: d
        async for d in db.wearable_sources.find({"user_id": user["id"]}, {"_id": 0})
    }
    out = []
    demo = is_demo_user(user)
    for p in PROVIDERS:
        info = PROVIDER_INFO[p]
        d = docs.get(p)
        out.append(
            {
                "provider": p,
                "kind": info["kind"],
                "label": info["label"],
                "provides": info["provides"],
                "requires_agreement": info.get("requires_agreement", False),
                "docs": info.get("docs"),
                "note": info.get("note"),
                "status": d["status"] if d else "disconnected",
                "last_sync_at": d.get("last_sync_at") if d else None,
                "mode": _source_mode(p, demo),
                "requires_native_build": p in SDK_ONLY_PROVIDERS,
                "import_formats": info.get("import_formats", []),
            }
        )
    return out


def _terra_widget_session(user_id: str, provider: str) -> str:
    response = http.post(
        TERRA_WIDGET_URL,
        headers={"dev-id": os.environ["TERRA_DEV_ID"], "x-api-key": os.environ["TERRA_API_KEY"]},
        json={
            "reference_id": user_id,
            "providers": TERRA_PROVIDER_CODES[provider],
            "auth_success_redirect_url": f"{APP_PUBLIC_URL}/sources?connected={provider}",
            "auth_failure_redirect_url": f"{APP_PUBLIC_URL}/sources?failed={provider}",
        },
        timeout=15,
    )
    if response.status_code not in (200, 201) or not response.json().get("url"):
        raise HTTPException(502, "Terra could not start the connection. Check the Terra dashboard credentials.")
    return response.json()["url"]


@router.post("/wearables/sources/{provider}/connect")
async def connect_source(provider: str, user: dict = Depends(current_user)):
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown provider")
    demo = is_demo_user(user)
    auth_url = None
    # Only demo accounts get an instantly "connected" simulated source. Real users
    # stay `pending` until the provider authorises (Terra auth webhook / OAuth callback).
    status = "connected" if demo else "pending"
    if provider in TERRA_PROVIDER_CODES and TERRA_CONFIGURED and not demo:
        auth_url = await run_in_threadpool(_terra_widget_session, user["id"], provider)
    elif provider == "technogym" and TECHNOGYM_CONFIGURED:
        domain = os.environ.get("TECHNOGYM_AUTH_DOMAIN", "")
        auth_url = f"https://{domain}/oauth/authorize?response_type=code&client_id={os.environ.get('TECHNOGYM_CLIENT_ID', '')}"
    elif provider in SDK_ONLY_PROVIDERS and not demo:
        # Manual import is the only path without a native build; mark it ready to receive files.
        status = "connected"
    await db.wearable_sources.update_one(
        {"user_id": user["id"], "provider": provider},
        {
            "$set": {"status": status, "connected_at": now() if status == "connected" else None,
                     **({"terra_user_id": f"sim-{new_id()[:8]}"} if demo else {})},
            "$setOnInsert": {"id": new_id(), "user_id": user["id"], "provider": provider},
        },
        upsert=True,
    )
    doc = await db.wearable_sources.find_one({"user_id": user["id"], "provider": provider}, {"_id": 0})
    return {
        **clean(doc),
        "auth_url": auth_url,
        "simulated": demo and not _provider_configured(provider),
        "message": None if auth_url or demo or provider in SDK_ONLY_PROVIDERS else (
            "This provider needs Terra credentials on the server before a live connection can start."
        ),
    }


# ---- Samsung Health personal-data export ------------------------------------ #
# Samsung Health has no cloud API; the export zip holds CSVs whose first line is
# "<datatype>,<version>,<n>" and whose columns are prefixed with the datatype.
_SAMSUNG_FILES = {
    "pedometer_day_summary": "steps", "step_daily_trend": "steps",
    "heart_rate": "heart_rate", "sleep": "sleep", "calories_burned": "calories",
}
MAX_IMPORT_BYTES = 60 * 1024 * 1024


def _col(row: dict, *suffixes: str):
    for key, value in row.items():
        if key and any(key.endswith(suffix) for suffix in suffixes) and value not in (None, ""):
            return value
    return None


def _samsung_time(value) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.isdigit():
        return datetime.fromtimestamp(int(text) / 1000, tz=timezone.utc)
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:26], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _parse_samsung_csv(name: str, text: str) -> dict[str, dict[str, list[float]]]:
    """Return {metric: {YYYY-MM-DD: [values]}} for one export CSV."""
    kind = next((v for k, v in _SAMSUNG_FILES.items() if k in name), None)
    if not kind:
        return {}
    lines = text.splitlines()
    if lines and lines[0].startswith("com.samsung"):
        lines = lines[1:]
    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    out: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in reader:
        try:
            if kind == "steps":
                when = _samsung_time(_col(row, "day_time", "start_time"))
                count = _col(row, ".count", "step_count")
                source = _col(row, "source_type") or ""
                # step_daily_trend mixes device rows; -2 is the merged "all sources" total.
                if when and count and source in ("", "-2"):
                    out["steps"][when.strftime("%Y-%m-%d")].append(float(count))
            elif kind == "heart_rate":
                when = _samsung_time(_col(row, "start_time"))
                bpm = _col(row, ".heart_rate", "heart_rate.heart_rate")
                if when and bpm and 25 < float(bpm) < 230:
                    out["heart_rate"][when.strftime("%Y-%m-%d")].append(float(bpm))
            elif kind == "sleep":
                start = _samsung_time(_col(row, "start_time"))
                end = _samsung_time(_col(row, "end_time"))
                minutes = _col(row, "sleep_duration")
                hours = float(minutes) / 60 if minutes else ((end - start).total_seconds() / 3600 if start and end else None)
                if start and hours and 0.5 <= hours <= 16:
                    # Attribute the night to the wake-up date so it aligns with daily metrics.
                    out["sleep_hours"][(end or start).strftime("%Y-%m-%d")].append(hours)
            elif kind == "calories":
                when = _samsung_time(_col(row, "day_time", "start_time"))
                kcal = _col(row, "active_calorie", "calorie")
                if when and kcal:
                    out["calories"][when.strftime("%Y-%m-%d")].append(float(kcal))
        except (TypeError, ValueError):
            continue
    return out


def _summarise_samsung(parsed: list[dict]) -> list[tuple[str, str, float]]:
    merged: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for chunk in parsed:
        for metric, days in chunk.items():
            for day, values in days.items():
                merged[metric][day].extend(values)
    rows: list[tuple[str, str, float]] = []
    for metric, days in merged.items():
        for day, values in days.items():
            if metric == "steps":
                rows.append(("steps", day, max(values)))
            elif metric == "heart_rate":
                # Resting HR proxy: 5th percentile of the day's samples (robust to workouts).
                ordered = sorted(values)
                rows.append(("resting_hr", day, round(ordered[max(0, int(len(ordered) * 0.05) - 1)])))
            elif metric == "sleep_hours":
                rows.append(("sleep_hours", day, round(sum(values), 2)))
            elif metric == "calories":
                rows.append(("calories", day, round(max(values))))
    return rows


@router.post("/wearables/sources/samsung_health/import")
async def import_samsung_health(file: UploadFile = File(...), user: dict = Depends(current_user)):
    data = await file.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Export is larger than 60 MB")
    parsed: list[dict] = []
    files_seen = 0
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for info in archive.infolist():
                if info.filename.lower().endswith(".csv") and info.file_size < 40 * 1024 * 1024:
                    files_seen += 1
                    parsed.append(_parse_samsung_csv(info.filename, archive.read(info).decode("utf-8", "ignore")))
    elif (file.filename or "").lower().endswith(".csv"):
        files_seen = 1
        parsed.append(_parse_samsung_csv(file.filename or "", data.decode("utf-8", "ignore")))
    else:
        raise HTTPException(415, "Upload the Samsung Health export .zip or one of its .csv files")
    rows = _summarise_samsung(parsed)
    if not rows:
        raise HTTPException(422, "No steps, heart rate, sleep or calorie data recognised in this export")
    written = 0
    for metric, day, value in rows:
        recorded_at = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        await db.wearable_metrics.update_one(
            {"user_id": user["id"], "device": "samsung_health", "metric": metric, "import_day": day},
            {"$set": {"value": value, "unit": METRIC_UNITS.get(metric), "recorded_at": recorded_at,
                      "simulated": False, "source": "samsung_export"},
             "$setOnInsert": {"id": new_id(), "user_id": user["id"], "metric": metric,
                              "device": "samsung_health", "import_day": day, "created_at": now()}},
            upsert=True,
        )
        written += 1
    await db.wearable_sources.update_one(
        {"user_id": user["id"], "provider": "samsung_health"},
        {"$set": {"status": "connected", "last_sync_at": now(), "connected_at": now(), "mode": "import"},
         "$setOnInsert": {"id": new_id(), "user_id": user["id"], "provider": "samsung_health"}},
        upsert=True,
    )
    days = sorted({day for _, day, _ in rows})
    return {"provider": "samsung_health", "files": files_seen, "synced": written,
            "metrics": sorted({metric for metric, _, _ in rows}), "from": days[0], "to": days[-1]}


@router.post("/wearables/sources/{provider}/disconnect")
async def disconnect_source(provider: str, user: dict = Depends(current_user)):
    res = await db.wearable_sources.update_one(
        {"user_id": user["id"], "provider": provider},
        {"$set": {"status": "disconnected", "disconnected_at": now()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Source not connected")
    return {"provider": provider, "status": "disconnected"}


@router.post("/wearables/sources/{provider}/sync")
async def sync_source(provider: str, user: dict = Depends(require_pro)):
    """Simulated sync: writes 7 days of normalized metrics for this provider."""
    src = await db.wearable_sources.find_one(
        {"user_id": user["id"], "provider": provider, "status": "connected"}, {"_id": 0}
    )
    if not src:
        raise HTTPException(409, "Connect this source first")

    demo = is_demo_user(user)

    # ---- gym equipment (Technogym / EGYM) ------------------------------- #
    if provider in EQUIPMENT_PROVIDERS:
        if demo:
            n = await _simulate_gym_session(user["id"], provider)
            await db.wearable_sources.update_one(
                {"user_id": user["id"], "provider": provider}, {"$set": {"last_sync_at": now()}}
            )
            return {"provider": provider, "synced": n, "simulated": True,
                    "message": f"Imported a sample {PROVIDER_INFO[provider]['label']} session ({n} sets)."}
        await db.wearable_sources.update_one(
            {"user_id": user["id"], "provider": provider}, {"$set": {"last_sync_at": now()}}
        )
        configured = _provider_configured(provider)
        return {
            "provider": provider, "synced": 0, "simulated": False,
            "message": (
                "Machine workouts will import automatically after you link your gym account "
                + ("(Mywellness / EGYM)." if configured
                   else "— pending the club's Technogym/EGYM API agreement.")
            ),
        }

    # ---- wearables (Terra) ---------------------------------------------- #
    if not demo:
        # No sample rows for a real athlete, even when the source is already
        # connected. Metrics arrive via the Terra webhook or a file import.
        await db.wearable_sources.update_one(
            {"user_id": user["id"], "provider": provider}, {"$set": {"last_sync_at": now()}}
        )
        return {
            "provider": provider,
            "synced": 0,
            "simulated": False,
            "message": (
                "Live sync will start once this source is authorised "
                + ("(Terra webhook)." if TERRA_CONFIGURED else "(Terra keys not configured yet).")
            ),
        }
    written = await _simulate_wearable_week(user, provider)
    await db.wearable_sources.update_one(
        {"user_id": user["id"], "provider": provider}, {"$set": {"last_sync_at": now()}}
    )
    return {"provider": provider, "synced": written, "simulated": True}


async def _simulate_wearable_week(user: dict, provider: str) -> int:
    """Write seven days of sample wearable rows. Demo accounts only.

    Calling this for anyone else is refused before a row is written. The
    route above also returns before it reaches this function.
    """
    if not is_demo_user(user):
        raise HTTPException(403, "Sample wearable data is only available on the demo account")
    await db.wearable_metrics.delete_many(
        {"user_id": user["id"], "device": provider, "simulated": True}
    )
    rng = random.Random(f"{user['id']}:{provider}:{now():%Y-%m-%d}")
    docs = []
    base_hrv = rng.uniform(55, 80)
    for d in range(6, -1, -1):
        day = now() - timedelta(days=d)
        daily = {
            "hrv": round(base_hrv + rng.uniform(-12, 10), 1),
            "resting_hr": round(rng.uniform(48, 62)),
            "sleep_hours": round(rng.uniform(5.5, 8.7), 1),
            "steps": rng.randint(4000, 15000),
            "calories": rng.randint(1900, 3400),
            "strain": round(rng.uniform(6, 18), 1),
            "recovery": round(rng.uniform(35, 95)),
        }
        if d == 0:
            daily["vo2max"] = round(rng.uniform(42, 58), 1)
        for metric, value in daily.items():
            docs.append(
                {
                    "id": new_id(),
                    "user_id": user["id"],
                    "metric": metric,
                    "value": value,
                    "unit": METRIC_UNITS.get(metric),
                    "device": provider,
                    "simulated": True,
                    "recorded_at": day,
                    "created_at": now(),
                }
            )
    if docs:
        await db.wearable_metrics.insert_many(docs)
    return len(docs)


@router.post("/webhooks/terra")
async def terra_webhook(request: Request, background: BackgroundTasks):
    """Map a Terra webhook onto wearable_metrics. Missing fields are left missing."""
    raw_body = await request.body()
    if TERRA_SIGNING_SECRET:
        signature = request.headers.get("terra-signature") or request.headers.get("x-terra-signature")
        if not verify_webhook_signature(raw_body, signature, TERRA_SIGNING_SECRET):
            raise HTTPException(401, "Invalid Terra webhook signature")
    elif TERRA_CONFIGURED:
        raise HTTPException(503, "TERRA_SIGNING_SECRET is required for Terra webhooks")

    try:
        payload = json.loads(raw_body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(400, "Invalid Terra webhook JSON") from exc

    if payload.get("type") in {"lab_report.completed", "lab_report.failed"}:
        if not await claim_terra_lab_event(payload):
            return {"received": True, "duplicate": True, "processed": 0}
        background.add_task(process_claimed_terra_lab_event, payload)
        return {"received": True, "queued": True}

    event_type = payload.get("type")
    if event_type == "auth" and payload.get("status") == "success":
        terra_user = payload.get("user") or {}
        reference_id = terra_user.get("reference_id") or payload.get("reference_id")
        if reference_id and terra_user.get("user_id") and terra_user.get("provider"):
            await db.wearable_sources.update_one(
                {"user_id": reference_id, "provider": terra_user["provider"].lower()},
                {"$set": {
                    "status": "connected",
                    "terra_user_id": terra_user["user_id"],
                    "connected_at": now(),
                }, "$setOnInsert": {"id": new_id(), "user_id": reference_id}},
                upsert=True,
            )
        return {"received": True, "processed": 1 if reference_id else 0}

    terra_user = (payload.get("user") or {}).get("user_id")
    if not terra_user:
        return {"received": True, "processed": 0}
    src = await db.wearable_sources.find_one({"terra_user_id": terra_user}, {"_id": 0})
    if not src:
        return {"received": True, "processed": 0, "reason": "unknown terra user"}
    processed = 0
    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        values = _terra_metric_values(event_type, item)
        item_key = _terra_item_key(event_type or "unknown", item)
        for metric, value in values.items():
            await db.wearable_metrics.update_one(
                {
                    "terra_user_id": terra_user,
                    "terra_event_type": event_type,
                    "terra_item_key": item_key,
                    "metric": metric,
                },
                {"$set": {
                    "id": new_id(),
                    "user_id": src["user_id"],
                    "metric": metric,
                    "value": value,
                    "unit": METRIC_UNITS.get(metric),
                    "device": src["provider"],
                    "simulated": False,
                    "terra_user_id": terra_user,
                    "terra_event_type": event_type,
                    "terra_item_key": item_key,
                    "recorded_at": _terra_recorded_at(item),
                    "updated_at": now(),
                }, "$setOnInsert": {"created_at": now()}},
                upsert=True,
            )
            processed += 1
    await db.wearable_sources.update_one(
        {"terra_user_id": terra_user}, {"$set": {"last_sync_at": now()}}
    )
    return {"received": True, "processed": processed}


# --------------------------------------------------------------------------- #
# Technogym / Mywellness (gym equipment)                                       #
# --------------------------------------------------------------------------- #
# Two ways in, both ready-to-plug behind the env keys above:
#   1. POST /webhooks/technogym  — push from Mywellness "Training Results".
#   2. A future server-to-server pull against https://enterprise.mywellness.com/api
#      (add TECHNOGYM_API_KEY + TECHNOGYM_AUTH_DOMAIN, then call from sync_source).
# Both funnel through _import_gym_session so machine workouts land in the same
# workouts / workout_sets collections the manual logger uses.

# Mywellness exercise name -> IronFlow exercise slug (extend as the club's kit grows).
TECHNOGYM_EXERCISE_MAP = {
    "chest press": "chest-press-machine",
    "leg press": "leg-press",
    "lat machine": "lat-pulldown",
    "leg extension": "leg-extension",
    "leg curl": "seated-leg-curl",
    "shoulder press": "machine-shoulder-press",
    "low row": "seated-cable-row",
    "abdominal crunch": "cable-crunch",
}


async def _resolve_exercise(name: str, slug_hint: Optional[str] = None) -> Optional[dict]:
    """Best-effort map a machine's exercise name to a catalog exercise."""
    if slug_hint:
        ex = await db.exercises.find_one({"slug": slug_hint}, {"_id": 0})
        if ex:
            return ex
    key = (name or "").strip().lower()
    slug = TECHNOGYM_EXERCISE_MAP.get(key)
    if slug:
        ex = await db.exercises.find_one({"slug": slug}, {"_id": 0})
        if ex:
            return ex
    # loose name match against the catalog
    return await db.exercises.find_one(
        {"name": {"$regex": f"^{re.escape(name)}", "$options": "i"}}, {"_id": 0}
    ) if name else None


async def _import_gym_session(
    user_id: str, provider: str, title: str, exercises: list[dict], started_at
) -> int:
    """Create one workout + its sets from a normalized machine session.

    `exercises` = [{"name": str, "slug": str|None, "sets": [{"reps": int, "weight_kg": float}]}]
    Returns the number of sets written. Idempotent-ish: skips if an equal
    external session was already imported (matched on external_id when present).
    """
    workout = {
        "id": new_id(),
        "user_id": user_id,
        "title": title,
        "notes": f"Imported from {PROVIDER_INFO[provider]['label']}",
        "source": provider,
        "started_at": started_at,
        "ended_at": started_at,
        "duration_sec": None,
        "perceived_effort": None,
        "planned_exercise_slugs": [],
        "created_at": now(),
    }
    await db.workouts.insert_one(dict(workout))
    written = 0
    for ex in exercises:
        catalog = await _resolve_exercise(ex.get("name", ""), ex.get("slug"))
        if not catalog:
            continue
        for i, s in enumerate(ex.get("sets", [])):
            await db.workout_sets.insert_one(
                {
                    "id": new_id(),
                    "workout_id": workout["id"],
                    "user_id": user_id,
                    "exercise_id": catalog["id"],
                    "set_index": i,
                    "reps": s.get("reps"),
                    "weight_kg": s.get("weight_kg"),
                    "source": provider,
                    "created_at": now(),
                }
            )
            written += 1
    return written


async def _simulate_gym_session(user_id: str, provider: str) -> int:
    """Demo-only: a realistic machine circuit so the test account shows gym data."""
    rng = random.Random(f"{user_id}:{provider}:{now():%Y-%m-%d-%H}")
    plan = [
        ("chest press", "chest-press-machine", 40, 70),
        ("leg press", "leg-press", 120, 220),
        ("lat machine", "lat-pulldown", 45, 75),
        ("leg extension", "leg-extension", 35, 60),
        ("shoulder press", "machine-shoulder-press", 25, 45),
    ]
    exercises = []
    for name, slug, lo, hi in plan:
        base = rng.uniform(lo, hi)
        exercises.append(
            {
                "name": name,
                "slug": slug,
                "sets": [
                    {"reps": rng.randint(8, 12), "weight_kg": round(base + 2.5 * k, 1)}
                    for k in range(3)
                ],
            }
        )
    return await _import_gym_session(
        user_id, provider, f"{PROVIDER_INFO[provider]['label']} circuit", exercises, now()
    )


@router.post("/webhooks/technogym")
async def technogym_webhook(request: Request):
    """Ready-to-plug Mywellness push: normalize a training-result payload.

    Expected shape (simplified from the Mywellness "Training Results" module):
      {"userId": "...", "session": {"name": "...", "date": "ISO",
        "exercises": [{"name": "Chest Press", "sets": [{"reps": 10, "weightKg": 60}]}]},
       "biometrics": {"hrv": 62, "restingHr": 55, "wellnessAge": 31}}
    """
    if not TECHNOGYM_CONFIGURED:
        raise HTTPException(503, "Technogym integration is not configured on this server")
    payload = await request.json()
    tg_user = payload.get("userId") or payload.get("user_id")
    if not tg_user:
        return {"received": True, "processed": 0}
    src = await db.wearable_sources.find_one(
        {"terra_user_id": tg_user, "provider": "technogym"}, {"_id": 0}
    ) or await db.wearable_sources.find_one(
        {"technogym_user_id": tg_user, "provider": "technogym"}, {"_id": 0}
    )
    if not src:
        return {"received": True, "processed": 0, "reason": "unknown technogym user"}
    uid = src["user_id"]
    written = 0
    session = payload.get("session") or {}
    if session.get("exercises"):
        exercises = [
            {
                "name": e.get("name", ""),
                "slug": e.get("slug"),
                "sets": [
                    {"reps": st.get("reps"), "weight_kg": st.get("weightKg") or st.get("weight_kg")}
                    for st in (e.get("sets") or [])
                ],
            }
            for e in session["exercises"]
        ]
        started = session.get("date") and now() or now()
        written = await _import_gym_session(
            uid, "technogym", session.get("name") or "Technogym session", exercises, started
        )
    # biometrics -> wearable_metrics (same store the Home rings read)
    bio = payload.get("biometrics") or {}
    bio_map = {"hrv": "hrv", "restingHr": "resting_hr", "recovery": "recovery"}
    for field, metric in bio_map.items():
        if isinstance(bio.get(field), (int, float)):
            await db.wearable_metrics.insert_one(
                {
                    "id": new_id(), "user_id": uid, "metric": metric,
                    "value": float(bio[field]), "unit": METRIC_UNITS.get(metric),
                    "device": "technogym", "simulated": False,
                    "recorded_at": now(), "created_at": now(),
                }
            )
    await db.wearable_sources.update_one(
        {"user_id": uid, "provider": "technogym"}, {"$set": {"last_sync_at": now()}}
    )
    return {"received": True, "processed": written}
