"""Streak and challenge mechanics — pure, no database."""
from datetime import date, datetime, timedelta, timezone

import pytest

import challenges as c

TODAY = date(2026, 9, 14)


def days(*offsets):
    """Check-in days as offsets back from TODAY: days(0, 1) = today and yesterday."""
    return [(TODAY - timedelta(days=n)).isoformat() for n in offsets]


# --- Streaks: one rest day never breaks a streak; two in a row do ---

def test_consecutive_days_build_a_streak():
    result = c.streaks(days(0, 1, 2, 3), TODAY)
    assert result["current"] == 4 and result["longest"] == 4
    assert result["checked_in_today"] is True


def test_a_single_rest_day_keeps_the_streak():
    # Checked in today and two days ago; yesterday was a rest day.
    result = c.streaks(days(0, 2, 3), TODAY)
    assert result["current"] == 3  # counts check-in days, not calendar days


def test_two_rest_days_in_a_row_end_the_streak():
    # Gap of three days between the two oldest and the newest run.
    result = c.streaks(days(0, 1, 4, 5), TODAY)
    assert result["current"] == 2
    assert result["longest"] == 2


def test_a_streak_stays_alive_through_one_rest_day_before_you_check_in():
    # Last check-in two days ago; yesterday was rest. Today is still in time.
    assert c.streaks(days(2, 3, 4), TODAY)["current"] == 3


def test_a_streak_is_over_after_two_rest_days_with_no_check_in():
    assert c.streaks(days(3, 4, 5), TODAY)["current"] == 0
    assert c.streaks(days(3, 4, 5), TODAY)["longest"] == 3  # history is kept


def test_longest_is_the_best_run_ever_not_the_current_one():
    result = c.streaks(days(0, 10, 11, 12, 13, 14), TODAY)
    assert result["current"] == 1
    assert result["longest"] == 5


def test_duplicate_days_count_once_and_empty_history_is_zero():
    assert c.streaks(days(0, 0, 1), TODAY)["total"] == 2
    assert c.streaks([], TODAY) == {"current": 0, "longest": 0, "total": 0,
                                   "checked_in_today": False, "last_day": None}


def test_day_key_is_utc_regardless_of_offset():
    late_evening_in_new_york = datetime(2026, 9, 13, 23, 30, tzinfo=timezone(timedelta(hours=-4)))
    assert c.day_key(late_evening_in_new_york) == "2026-09-14"
    assert c.day_key(datetime(2026, 9, 14, 1, 0)) == "2026-09-14"  # naive is read as UTC


# --- Challenges ---

def test_status_follows_the_window():
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=14)
    assert c.challenge_status(start, end, start - timedelta(seconds=1)) == "upcoming"
    assert c.challenge_status(start, end, start) == "active"
    assert c.challenge_status(start, end, end) == "ended"


def workout(wid, day_offset, minutes=60):
    ended = datetime(2026, 9, 10, 18, tzinfo=timezone.utc) + timedelta(days=day_offset)
    return {"id": wid, "ended_at": ended, "duration_sec": minutes * 60}


def test_each_metric_scores_the_same_workouts_differently():
    rows = [workout("a", 0, 45), workout("b", 0, 30), workout("c", 1, 60)]
    assert c.score_workouts("workouts", rows) == 3
    assert c.score_workouts("active_days", rows) == 2  # two sessions on one day
    assert c.score_workouts("minutes", rows) == 135
    assert c.score_workouts("tonnage", rows, {"a": 1000.0, "c": 480.5}) == 1480.5


def test_an_unknown_metric_is_rejected():
    with pytest.raises(ValueError):
        c.score_workouts("steps", [])


def test_ranking_shares_places_on_ties_and_keeps_zero_scores():
    assert c.rank({"ann": 5, "bob": 9, "cat": 5, "dan": 0}) == [
        (1, "bob", 9), (2, "ann", 5), (2, "cat", 5), (4, "dan", 0),
    ]


def test_windows_must_run_forward_and_stay_bounded():
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        c.validate_window(start, start)
    with pytest.raises(ValueError):
        c.validate_window(start, start + timedelta(days=c.MAX_CHALLENGE_DAYS + 1))
    c.validate_window(start, start + timedelta(days=30))
