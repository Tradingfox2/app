"""Terra wearables: config, REST client, and webhook normalization.

Garmin, Whoop, Fitbit, Oura and Polar connect through one Terra widget.
Nothing here talks to Mongo; routers/wearables.py owns storage.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone

import requests as http

from terra_labs import verify_webhook_signature


class TerraConfig:
    """Environment-backed settings. The feature is off unless all three keys are set."""

    PROVIDER_CODES = {
        "garmin": "GARMIN",
        "whoop": "WHOOP",
        "fitbit": "FITBIT",
        "oura": "OURA",
        "polar": "POLAR",
    }

    @staticmethod
    def dev_id() -> str:
        return os.environ.get("TERRA_DEV_ID", "")

    @staticmethod
    def api_key() -> str:
        return os.environ.get("TERRA_API_KEY", "")

    @staticmethod
    def signing_secret() -> str:
        return os.environ.get("TERRA_SIGNING_SECRET", "")

    @staticmethod
    def widget_url() -> str:
        return os.environ.get("TERRA_WIDGET_URL", "https://access.tryterra.co/api/widget/session")

    @staticmethod
    def base_url() -> str:
        return os.environ.get("TERRA_BASE_URL", "https://access.tryterra.co/api").rstrip("/")

    @staticmethod
    def app_public_url() -> str:
        return os.environ.get("APP_PUBLIC_URL", "http://localhost:8082").rstrip("/")

    @staticmethod
    def enabled() -> bool:
        return bool(TerraConfig.dev_id() and TerraConfig.api_key() and TerraConfig.signing_secret())

    @staticmethod
    def provider_slug(terra_code: str | None) -> str | None:
        code = (terra_code or "").upper()
        for slug, value in TerraConfig.PROVIDER_CODES.items():
            if value == code:
                return slug
        return None


class TerraError(Exception):
    """Terra answered with an error or no usable body."""


class TerraClient:
    """Thin synchronous REST client. Call it from a threadpool."""

    TIMEOUT = 15

    @staticmethod
    def _headers() -> dict:
        return {"dev-id": TerraConfig.dev_id(), "x-api-key": TerraConfig.api_key()}

    @staticmethod
    def generate_widget_session(reference_id: str, providers: list[str]) -> dict:
        """Start a Terra widget session. Returns {"url", "session_id", "expires_in"}."""
        codes = ",".join(TerraConfig.PROVIDER_CODES[p] for p in providers)
        base = TerraConfig.app_public_url()
        tag = providers[0] if len(providers) == 1 else "terra"
        response = http.post(
            TerraConfig.widget_url(),
            headers=TerraClient._headers(),
            json={
                "reference_id": reference_id,
                "providers": codes,
                "auth_success_redirect_url": f"{base}/sources?connected={tag}",
                "auth_failure_redirect_url": f"{base}/sources?failed={tag}",
            },
            timeout=TerraClient.TIMEOUT,
        )
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code not in (200, 201) or not body.get("url"):
            raise TerraError(f"widget session failed ({response.status_code})")
        return {"url": body["url"], "session_id": body.get("session_id"), "expires_in": body.get("expires_in")}

    @staticmethod
    def deauthenticate_user(terra_user_id: str) -> bool:
        """Revoke Terra's access. A 404 means Terra already forgot the user, which is fine."""
        response = http.delete(
            f"{TerraConfig.base_url()}/v2/auth/deauthenticateUser",
            headers=TerraClient._headers(),
            params={"user_id": terra_user_id},
            timeout=TerraClient.TIMEOUT,
        )
        if response.status_code in (200, 404):
            return True
        raise TerraError(f"deauthenticate failed ({response.status_code})")


class TerraWebhook:
    """Signature check and payload normalization for data events."""

    AUTH_EVENTS = frozenset({"auth", "user_reauth"})
    DEAUTH_EVENTS = frozenset({"deauth", "access_revoked"})
    DATA_EVENTS = frozenset({"activity", "daily", "sleep", "body"})

    @staticmethod
    def verify(raw_body: bytes, signature_header: str | None) -> bool:
        return verify_webhook_signature(raw_body, signature_header, TerraConfig.signing_secret())

    @staticmethod
    def _get(item: dict, *path):
        value = item
        for key in path:
            if not isinstance(value, dict):
                return None
            value = value.get(key)
        return value

    @staticmethod
    def _number(value) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return float(value)

    @staticmethod
    def _time(value) -> datetime | None:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    @staticmethod
    def item_key(event_type: str, item: dict) -> str:
        """Stable per-item id so redelivered webhooks overwrite instead of duplicate."""
        meta = item.get("metadata") or {}
        natural = meta.get("summary_id") if event_type in {"activity", "sleep"} else None
        if natural:
            return str(natural)
        start, end = meta.get("start_time"), meta.get("end_time")
        if start or end:
            return f"{start}:{end}"
        digest = hashlib.sha256(json.dumps(item, sort_keys=True, default=str).encode()).hexdigest()
        return f"sha256:{digest[:32]}"

    @staticmethod
    def normalize(event_type: str, item: dict) -> dict:
        """One sample: time window plus the numbers Terra actually sent. Nulls stay out."""
        g, n = TerraWebhook._get, TerraWebhook._number
        meta = item.get("metadata") or {}
        fields: dict[str, float | None] = {}
        if event_type == "activity":
            fields = {
                "duration_s": n(g(item, "active_durations_data", "activity_seconds")),
                "calories": n(g(item, "calories_data", "total_burned_calories")),
                "distance_m": n(g(item, "distance_data", "summary", "distance_meters")),
                "steps": n(g(item, "distance_data", "summary", "steps")),
                "avg_hr": n(g(item, "heart_rate_data", "summary", "avg_hr_bpm")),
                "max_hr": n(g(item, "heart_rate_data", "summary", "max_hr_bpm")),
            }
        elif event_type == "daily":
            fields = {
                "steps": n(g(item, "distance_data", "steps")),
                "calories": n(g(item, "calories_data", "total_burned_calories")),
                "resting_hr": n(g(item, "heart_rate_data", "summary", "resting_hr_bpm")),
                "hrv": n(g(item, "heart_rate_data", "summary", "avg_hrv_rmssd")),
                "strain": n(g(item, "strain_data", "strain_level")),
                "recovery": n(g(item, "scores", "recovery")),
            }
        elif event_type == "sleep":
            asleep = n(g(item, "sleep_durations_data", "asleep", "duration_asleep_state_seconds"))
            if asleep is None:
                stages = [
                    n(g(item, "sleep_durations_data", "asleep", k))
                    for k in (
                        "duration_deep_sleep_state_seconds",
                        "duration_light_sleep_state_seconds",
                        "duration_REM_sleep_state_seconds",
                    )
                ]
                stages = [s for s in stages if s is not None]
                asleep = sum(stages) if stages else None
            fields = {
                "asleep_s": asleep,
                "hrv": n(g(item, "heart_rate_data", "summary", "avg_hrv_rmssd")),
                "resting_hr": n(g(item, "heart_rate_data", "summary", "resting_hr_bpm")),
            }
        elif event_type == "body":
            fields = {
                "resting_hr": n(g(item, "heart_data", "heart_rate_data", "summary", "resting_hr_bpm")),
                "hrv": n(g(item, "heart_data", "heart_rate_data", "summary", "avg_hrv_rmssd")),
                "vo2max": n(g(item, "oxygen_data", "vo2max_ml_per_min_per_kg")),
            }
            measurements = g(item, "measurements_data", "measurements")
            if isinstance(measurements, list) and measurements and isinstance(measurements[-1], dict):
                fields["weight_kg"] = n(measurements[-1].get("weight_kg"))
        return {
            "start_time": TerraWebhook._time(meta.get("start_time") or item.get("timestamp")),
            "end_time": TerraWebhook._time(meta.get("end_time")),
            "values": {k: v for k, v in fields.items() if v is not None},
        }
