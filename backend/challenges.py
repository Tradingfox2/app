"""Fitness-native channel mechanics: check-in streaks and challenge scoring.

Pure functions, no I/O — the routers fetch rows and hand them here.

Streaks are designed for training, not for engagement at any cost. Streak
research (Duolingo, habit apps) shows punishing resets drive abandonment, which
is why grace periods and freezes exist. In fitness it is worse: rest days are
part of training, so a streak that breaks on a rest day actively rewards
overtraining. Here **one rest day never breaks a streak; two in a row do.** The
streak counts check-in days, not calendar days, so a rest day neither adds nor
costs anything.

Challenges follow the Strava model: a metric, a date window, an optional group
goal, and explicit opt-in. Joining is the consent to have one's training
counted; nothing is scored for people who did not join, and only training
aggregates are ever used — never biomarkers, lab results or wearable health data.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Literal

#: The largest gap between two check-ins that keeps a streak alive: one missed
#: day between them. A gap of 3 means two rest days in a row — the streak ends.
MAX_GAP_DAYS = 2

ChallengeMetric = Literal["workouts", "active_days", "minutes", "tonnage"]
METRICS: tuple[str, ...] = ("workouts", "active_days", "minutes", "tonnage")

#: A challenge longer than this stops being a challenge and becomes a habit
#: tracker; the leaderboard also stays cheap to compute.
MAX_CHALLENGE_DAYS = 92


def day_key(moment: datetime) -> str:
    """UTC calendar day, the unit every streak and active-day count uses."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).date().isoformat()


def streaks(days: Iterable[str], today: date) -> dict:
    """Current and longest streak from a member's check-in days (YYYY-MM-DD).

    The current streak is alive while the gap since the last check-in is within
    MAX_GAP_DAYS — so after a rest day, today is still in time to extend it.
    """
    ordered = sorted({date.fromisoformat(value) for value in days})
    if not ordered:
        return {"current": 0, "longest": 0, "total": 0, "checked_in_today": False, "last_day": None}

    longest = run = 1
    for previous, current in zip(ordered, ordered[1:]):
        run = run + 1 if (current - previous).days <= MAX_GAP_DAYS else 1
        longest = max(longest, run)

    # Checked in on day L: today can still extend the run while today - L is
    # within MAX_GAP_DAYS (at most one rest day in between). At 3, two rest days
    # have already passed and the run is over.
    alive = (today - ordered[-1]).days <= MAX_GAP_DAYS
    return {
        "current": run if alive else 0,
        "longest": longest,
        "total": len(ordered),
        "checked_in_today": ordered[-1] == today,
        "last_day": ordered[-1].isoformat(),
    }


def challenge_status(starts_at: datetime, ends_at: datetime, now: datetime) -> str:
    if now < starts_at:
        return "upcoming"
    if now >= ends_at:
        return "ended"
    return "active"


def score_workouts(
    metric: str,
    workouts: list[dict],
    tonnage_by_workout: dict[str, float] | None = None,
) -> float:
    """One participant's score from their finished workouts inside the window."""
    if metric == "workouts":
        return float(len(workouts))
    if metric == "active_days":
        return float(len({day_key(w["ended_at"]) for w in workouts if w.get("ended_at")}))
    if metric == "minutes":
        return round(sum((w.get("duration_sec") or 0) for w in workouts) / 60, 1)
    if metric == "tonnage":
        tonnage = tonnage_by_workout or {}
        return round(sum(tonnage.get(w["id"], 0.0) for w in workouts), 1)
    raise ValueError(f"Unknown challenge metric: {metric}")


def rank(scores: dict[str, float]) -> list[tuple[int, str, float]]:
    """Competition ranking: equal scores share a place ("1, 2, 2, 4").

    Zero scores are kept — a participant who joined but has not trained yet
    still belongs on the board, just at the bottom.
    """
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    ranked: list[tuple[int, str, float]] = []
    for index, (user_id, score) in enumerate(ordered):
        place = ranked[-1][0] if ranked and ranked[-1][2] == score else index + 1
        ranked.append((place, user_id, score))
    return ranked


def validate_window(starts_at: datetime, ends_at: datetime) -> None:
    if ends_at <= starts_at:
        raise ValueError("A challenge must end after it starts")
    if ends_at - starts_at > timedelta(days=MAX_CHALLENGE_DAYS):
        raise ValueError(f"A challenge can last at most {MAX_CHALLENGE_DAYS} days")
