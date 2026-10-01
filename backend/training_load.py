"""Foster session load (sRPE) and the acute:chronic ratio on the home snapshot.

Session load is perceived effort times duration in minutes. ``finish_workout``
stores that number as ``load_au`` when both inputs exist. Older finished rows
are left untouched: readers compute the same formula when ``load_au`` is absent.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Iterable, Mapping

ACUTE_DAYS = 7
CHRONIC_DAYS = 28
CHRONIC_WEEKS = CHRONIC_DAYS / ACUTE_DAYS


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return float(value)


def _utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def session_load(perceived_effort: object, duration_sec: object) -> float | None:
    """Arbitrary units: effort (0–10) × minutes. Missing effort or duration is unknown."""
    effort = _number(perceived_effort)
    duration = _number(duration_sec)
    if effort is None or duration is None:
        return None
    return round(effort * duration / 60, 1)


def load_for_read(workout: Mapping[str, object]) -> float | None:
    """Stored ``load_au`` wins. Otherwise compute. Never writes."""
    if "load_au" in workout and workout.get("load_au") is not None:
        stored = _number(workout.get("load_au"))
        return None if stored is None else round(stored, 1)
    return session_load(workout.get("perceived_effort"), workout.get("duration_sec"))


def summarize(workouts: Iterable[Mapping[str, object]], moment: datetime) -> dict[str, float | None]:
    """Acute week, chronic weekly average, and their ratio.

    ``load_week`` sums computable loads whose ``started_at`` is inside the last
    7 days. ``load_28d_avg`` is the 28-day sum divided by 4, so it is in the
    same weekly units. ``acwr`` is acute / chronic. All three are null when no
    finished workout in the 28 days has a load — a rest week with earlier
    scored sessions is a real zero, an unscored history is not.
    """
    as_of = _utc(moment)
    week_cutoff = as_of - timedelta(days=ACUTE_DAYS)
    month_cutoff = as_of - timedelta(days=CHRONIC_DAYS)
    week_sum = 0.0
    month_sum = 0.0
    scored = 0
    for workout in workouts:
        ended = workout.get("ended_at")
        started = workout.get("started_at")
        if not isinstance(ended, datetime) or not isinstance(started, datetime):
            continue
        started_utc = _utc(started)
        if started_utc < month_cutoff or started_utc > as_of:
            continue
        load = load_for_read(workout)
        if load is None:
            continue
        scored += 1
        month_sum += load
        if started_utc >= week_cutoff:
            week_sum += load
    if scored == 0:
        return {"load_week": None, "load_28d_avg": None, "acwr": None}
    load_week = round(week_sum, 1)
    load_28d_avg = round(month_sum / CHRONIC_WEEKS, 1)
    acwr = round(load_week / load_28d_avg, 2) if load_28d_avg > 0 else None
    return {"load_week": load_week, "load_28d_avg": load_28d_avg, "acwr": acwr}
