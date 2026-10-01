from __future__ import annotations

import math
from datetime import datetime, time, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

import server

router = APIRouter()

WEARABLE = {
    "recovery": "readiness",
    "readiness": "readiness",
    "hrv": "hrv",
    "resting_hr": "resting_hr",
    "sleep_hours": "sleep_hours",
}
UNITS = {
    "readiness": "%",
    "hrv": "ms",
    "resting_hr": "bpm",
    "sleep_hours": "h",
    "load_au": "AU",
    "tonnage": "kg",
}


def _db():
    return server.db


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def window_keys(days: int, today: datetime | None = None) -> list[str]:
    end = _aware(today or server.now()).date()
    start = end - timedelta(days=days - 1)
    return [(start + timedelta(days=offset)).isoformat() for offset in range(days)]


def _points(keys: list[str], values: dict[str, float]) -> list[dict]:
    return [{"date": day, "value": values.get(day)} for day in keys]


@router.get("/trends")
async def trends(
    user: dict = Depends(server.current_user),
    days: Annotated[int, Query()] = 30,
):
    if days not in (30, 90):
        raise HTTPException(422, "days must be 30 or 90")
    keys = window_keys(days)
    keyset = set(keys)
    start = datetime.combine(datetime.fromisoformat(keys[0]).date(), time.min, tzinfo=timezone.utc)
    uid = user["id"]
    latest: dict[str, dict[str, tuple[datetime, float]]] = {
        "readiness": {},
        "hrv": {},
        "resting_hr": {},
        "sleep_hours": {},
    }
    async for row in _db().wearable_metrics.find(
        {"user_id": uid, "metric": {"$in": list(WEARABLE)}, "recorded_at": {"$gte": start}},
        {"_id": 0, "metric": 1, "value": 1, "recorded_at": 1},
    ):
        name = WEARABLE.get(row.get("metric") or "")
        recorded = row.get("recorded_at")
        value = _number(row.get("value"))
        if not name or not isinstance(recorded, datetime) or value is None:
            continue
        recorded = _aware(recorded)
        day = recorded.strftime("%Y-%m-%d")
        if day not in keyset:
            continue
        previous = latest[name].get(day)
        if previous is None or recorded >= previous[0]:
            latest[name][day] = (recorded, value)

    workouts = [
        w
        async for w in _db().workouts.find(
            {"user_id": uid, "started_at": {"$gte": start}},
            {"_id": 0, "id": 1, "started_at": 1, "duration_sec": 1, "perceived_effort": 1},
        )
    ]
    load: dict[str, float] = {}
    day_of: dict[str, str] = {}
    for workout in workouts:
        started = workout.get("started_at")
        if not isinstance(started, datetime):
            continue
        day = _aware(started).strftime("%Y-%m-%d")
        if day not in keyset or not workout.get("id"):
            continue
        day_of[workout["id"]] = day
        effort = _number(workout.get("perceived_effort"))
        duration = _number(workout.get("duration_sec"))
        if effort is None or duration is None or duration <= 0:
            continue
        load[day] = load.get(day, 0.0) + effort * (duration / 60.0)

    tonnage: dict[str, float] = {}
    muscles: dict[str, dict[str, float]] = {}
    if day_of:
        sets = [
            s
            async for s in _db().workout_sets.find(
                {"workout_id": {"$in": list(day_of)}},
                {"_id": 0, "workout_id": 1, "exercise_id": 1, "weight_kg": 1, "reps": 1},
            )
        ]
        exercise_ids = list({s.get("exercise_id") for s in sets if s.get("exercise_id")})
        primary: dict[str, str | None] = {}
        if exercise_ids:
            async for doc in _db().exercises.find(
                {"id": {"$in": exercise_ids}},
                {"_id": 0, "id": 1, "primary_muscle_slug": 1},
            ):
                primary[doc["id"]] = doc.get("primary_muscle_slug")
        for item in sets:
            day = day_of.get(item.get("workout_id"))
            weight = _number(item.get("weight_kg"))
            reps = _number(item.get("reps"))
            if not day or weight is None or reps is None or weight <= 0 or reps <= 0:
                continue
            amount = weight * reps
            tonnage[day] = tonnage.get(day, 0.0) + amount
            slug = primary.get(item.get("exercise_id"))
            if not slug:
                continue
            bucket = muscles.setdefault(slug, {})
            bucket[day] = bucket.get(day, 0.0) + amount

    def rounded(values: dict[str, float]) -> dict[str, float]:
        return {day: round(value, 1) for day, value in values.items()}

    series = {
        name: _points(keys, {day: value for day, (_, value) in latest[name].items()})
        for name in ("readiness", "hrv", "resting_hr", "sleep_hours")
    }
    series["load_au"] = _points(keys, rounded(load))
    series["tonnage"] = _points(keys, rounded(tonnage))
    return {
        "days": days,
        "start": keys[0],
        "end": keys[-1],
        "series": series,
        "muscles": {slug: _points(keys, rounded(values)) for slug, values in sorted(muscles.items())},
        "units": UNITS,
    }
