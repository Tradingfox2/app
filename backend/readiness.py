"""IronFlow Readiness, scored 0–100 when it is read.

This module is the sole owner of that score. It is not stored. Each input
that exists contributes its weight; missing inputs are left out, the
remaining weights are renormalized, and confidence falls with the weight
that was dropped. An unknown or non-positive measurement is omitted. It
is never entered as 0. A computed 0 means every present input scored at
the floor.

Weights when the input is present:

- HRV against the 14-day personal baseline: 35
- Resting heart rate against that baseline: 20
- Sleep hours against an 8-hour need: 25
- Acute:chronic training load: 20

HRV at baseline scores 75. Each 10% above adds 25 points and each 10%
below subtracts 25, clamped to 0–100. Resting heart rate at baseline
scores 75. Each beat per minute above subtracts 5 and each beat below
adds 5. Sleep scores ``100 * min(hours, 8) / 8``. Acute:chronic load is
the 7-day load divided by the average week of the 28-day load
(``load_28d / 4``). Ratio 1.0 scores 75. Each tenth above subtracts 12.5
and each tenth below adds 12.5.

A stored ``training_load`` series on ``wearable_metrics`` supplies the
load. Until that series exists, a finished workout contributes Foster
session-RPE: ``perceived_effort * duration_sec / 60``. Verdict is
``push`` from 67, ``steady`` from 34 through 66, and ``rest`` below 34.
With nothing to score, ``score`` and ``verdict`` are null.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

WEIGHTS = {
    "hrv": 35,
    "resting_hr": 20,
    "sleep": 25,
    "training_load": 20,
}
COMPONENT_ORDER = ("hrv", "resting_hr", "sleep", "training_load")
TOTAL_WEIGHT = 100

SLEEP_NEED_HOURS = 8.0
BASELINE_DAYS = 14
MIN_BASELINE_SAMPLES = 3
FRESH_HOURS = 48
ACUTE_DAYS = 7
CHRONIC_DAYS = 28
STORED_LOAD_METRIC = "training_load"

PUSH_AT = 67
STEADY_AT = 34


def as_utc(moment: datetime) -> datetime:
    """Naive timestamps are UTC, matching the rest of the backend."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _positive(value: Any) -> float | None:
    """A usable measurement. Booleans, non-numbers, NaN, and <= 0 are absent."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0:
        return None
    return number


def _clamp(value: float) -> float:
    return round(min(100.0, max(0.0, value)), 1)


def personal_baseline(samples: list[Any]) -> float | None:
    """Mean of positive samples. Fewer than three samples is not a baseline."""
    usable = [number for value in samples if (number := _positive(value)) is not None]
    if len(usable) < MIN_BASELINE_SAMPLES:
        return None
    return sum(usable) / len(usable)


def is_fresh(recorded_at: datetime | None, moment: datetime, *, hours: float = FRESH_HOURS) -> bool:
    """True when a reading is new enough to describe today."""
    if not isinstance(recorded_at, datetime) or not isinstance(moment, datetime):
        return False
    return as_utc(moment) - as_utc(recorded_at) <= timedelta(hours=hours)


def session_load(perceived_effort: Any, duration_sec: Any) -> float | None:
    """Foster session-RPE. Missing effort or duration contributes nothing."""
    effort = _positive(perceived_effort)
    seconds = _positive(duration_sec)
    if effort is None or seconds is None:
        return None
    return effort * seconds / 60.0


def _window_sum(points: list[tuple[datetime, float]], moment: datetime, days: int) -> float:
    cutoff = as_utc(moment) - timedelta(days=days)
    total = 0.0
    for recorded_at, value in points:
        if not isinstance(recorded_at, datetime):
            continue
        if as_utc(recorded_at) >= cutoff and value > 0:
            total += value
    return total


def select_training_loads(
    stored_points: list[tuple[datetime, float]],
    workouts: list[dict],
    moment: datetime,
) -> tuple[float | None, float | None]:
    """7-day and 28-day load. Stored ``training_load`` wins over session-RPE.

    Both values are None when neither source has a positive load. A real
    quiet acute window is 0 beside a positive 28-day total, which is a
    measured load, not an unknown one.
    """
    if stored_points:
        return (
            _window_sum(stored_points, moment, ACUTE_DAYS),
            _window_sum(stored_points, moment, CHRONIC_DAYS),
        )
    points: list[tuple[datetime, float]] = []
    for workout in workouts:
        ended = workout.get("ended_at")
        if not isinstance(ended, datetime):
            continue
        load = session_load(workout.get("perceived_effort"), workout.get("duration_sec"))
        if load is None:
            continue
        points.append((ended, load))
    if not points:
        return None, None
    return _window_sum(points, moment, ACUTE_DAYS), _window_sum(points, moment, CHRONIC_DAYS)


def _hrv_component(hrv: Any, baseline: Any) -> dict | None:
    current = _positive(hrv)
    base = _positive(baseline)
    if current is None or base is None:
        return None
    ratio = current / base
    return {
        "score": _clamp(75 + 250 * (ratio - 1.0)),
        "weight": WEIGHTS["hrv"],
        "value": round(current, 1),
        "baseline": round(base, 1),
    }


def _resting_hr_component(resting_hr: Any, baseline: Any) -> dict | None:
    current = _positive(resting_hr)
    base = _positive(baseline)
    if current is None or base is None:
        return None
    return {
        "score": _clamp(75 - 5 * (current - base)),
        "weight": WEIGHTS["resting_hr"],
        "value": round(current, 1),
        "baseline": round(base, 1),
    }


def _sleep_component(sleep_hours: Any) -> dict | None:
    hours = _positive(sleep_hours)
    if hours is None:
        return None
    return {
        "score": _clamp(100 * min(hours, SLEEP_NEED_HOURS) / SLEEP_NEED_HOURS),
        "weight": WEIGHTS["sleep"],
        "value": round(hours, 1),
        "need": SLEEP_NEED_HOURS,
    }


def _load_component(load_7d: Any, load_28d: Any) -> dict | None:
    if isinstance(load_7d, bool) or isinstance(load_28d, bool):
        return None
    try:
        acute = float(load_7d)
        chronic = float(load_28d)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(acute) or not math.isfinite(chronic) or acute < 0 or chronic <= 0:
        return None
    # 28-day sum / 4 is the average week. Acute:chronic compares the last 7 days to that week.
    ratio = acute / (chronic / (CHRONIC_DAYS / ACUTE_DAYS))
    return {
        "score": _clamp(75 - 125 * (ratio - 1.0)),
        "weight": WEIGHTS["training_load"],
        "load_7d": round(acute, 1),
        "load_28d": round(chronic, 1),
        "acute_chronic": round(ratio, 2),
    }


def _verdict(score: int) -> str:
    if score >= PUSH_AT:
        return "push"
    if score >= STEADY_AT:
        return "steady"
    return "rest"


def score_readiness(
    *,
    hrv: Any = None,
    hrv_baseline: Any = None,
    resting_hr: Any = None,
    resting_hr_baseline: Any = None,
    sleep_hours: Any = None,
    load_7d: Any = None,
    load_28d: Any = None,
) -> dict:
    """Blend whatever inputs exist. Unknown inputs stay out of the average."""
    parts = {
        "hrv": _hrv_component(hrv, hrv_baseline),
        "resting_hr": _resting_hr_component(resting_hr, resting_hr_baseline),
        "sleep": _sleep_component(sleep_hours),
        "training_load": _load_component(load_7d, load_28d),
    }
    components = {key: part for key, part in parts.items() if part is not None}
    missing = [key for key in COMPONENT_ORDER if key not in components]
    if not components:
        return {
            "score": None,
            "verdict": None,
            "confidence": 0.0,
            "components": {},
            "missing": missing,
        }
    present = sum(part["weight"] for part in components.values())
    raw = sum(part["score"] * part["weight"] for part in components.values()) / present
    score = max(0, min(100, int(math.floor(raw + 0.5))))
    return {
        "score": score,
        "verdict": _verdict(score),
        "confidence": round(present / TOTAL_WEIGHT, 2),
        "components": components,
        "missing": missing,
    }


async def _latest(database: Any, uid: str, metric: str, moment: datetime) -> tuple[float, datetime] | None:
    doc = await database.wearable_metrics.find_one(
        {"user_id": uid, "metric": metric, "value": {"$gt": 0}},
        {"_id": 0, "value": 1, "recorded_at": 1},
        sort=[("recorded_at", -1)],
    )
    if not doc or not is_fresh(doc.get("recorded_at"), moment):
        return None
    value = _positive(doc.get("value"))
    if value is None:
        return None
    return value, as_utc(doc["recorded_at"])


async def _baseline_samples(
    database: Any, uid: str, metric: str, moment: datetime, latest_at: datetime,
) -> list[float]:
    cutoff = as_utc(moment) - timedelta(days=BASELINE_DAYS)
    samples: list[float] = []
    cursor = database.wearable_metrics.find(
        {
            "user_id": uid,
            "metric": metric,
            "value": {"$gt": 0},
            "recorded_at": {"$gte": cutoff, "$lt": latest_at},
        },
        {"_id": 0, "value": 1},
    ).limit(500)
    async for doc in cursor:
        value = _positive(doc.get("value"))
        if value is not None:
            samples.append(value)
    return samples


async def _training_loads(database: Any, uid: str, moment: datetime) -> tuple[float | None, float | None]:
    cutoff = as_utc(moment) - timedelta(days=CHRONIC_DAYS)
    stored: list[tuple[datetime, float]] = []
    cursor = database.wearable_metrics.find(
        {
            "user_id": uid,
            "metric": STORED_LOAD_METRIC,
            "value": {"$gt": 0},
            "recorded_at": {"$gte": cutoff},
        },
        {"_id": 0, "value": 1, "recorded_at": 1},
    ).limit(500)
    async for doc in cursor:
        recorded_at = doc.get("recorded_at")
        value = _positive(doc.get("value"))
        if isinstance(recorded_at, datetime) and value is not None:
            stored.append((recorded_at, value))
    if stored:
        return select_training_loads(stored, [], moment)

    workouts: list[dict] = []
    workout_cursor = database.workouts.find(
        {"user_id": uid, "ended_at": {"$gte": cutoff}},
        {"_id": 0, "ended_at": 1, "duration_sec": 1, "perceived_effort": 1},
    ).limit(500)
    async for doc in workout_cursor:
        workouts.append(doc)
    return select_training_loads([], workouts, moment)


async def today_for(database: Any, uid: str, moment: datetime) -> dict:
    """Readiness for one athlete from wearable rows and finished workouts."""
    moment = as_utc(moment)
    hrv_row = await _latest(database, uid, "hrv", moment)
    rhr_row = await _latest(database, uid, "resting_hr", moment)
    sleep_row = await _latest(database, uid, "sleep_hours", moment)
    hrv_baseline = None
    if hrv_row is not None:
        hrv_baseline = personal_baseline(
            await _baseline_samples(database, uid, "hrv", moment, hrv_row[1])
        )
    rhr_baseline = None
    if rhr_row is not None:
        rhr_baseline = personal_baseline(
            await _baseline_samples(database, uid, "resting_hr", moment, rhr_row[1])
        )
    load_7d, load_28d = await _training_loads(database, uid, moment)
    return score_readiness(
        hrv=None if hrv_row is None else hrv_row[0],
        hrv_baseline=hrv_baseline,
        resting_hr=None if rhr_row is None else rhr_row[0],
        resting_hr_baseline=rhr_baseline,
        sleep_hours=None if sleep_row is None else sleep_row[0],
        load_7d=load_7d,
        load_28d=load_28d,
    )
