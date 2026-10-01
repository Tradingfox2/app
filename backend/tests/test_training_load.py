"""Foster sRPE session load. No database."""
from datetime import datetime, timedelta, timezone

from training_load import load_for_read, session_load, summarize

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def finished(**overrides):
    row = {
        "started_at": NOW - timedelta(days=1),
        "ended_at": NOW - timedelta(hours=23),
        "duration_sec": 3600,
        "perceived_effort": 7,
    }
    row.update(overrides)
    return row


def test_session_load_is_effort_times_minutes():
    assert session_load(7, 3600) == 420.0
    assert session_load(8, 100) == 13.3
    assert session_load(0, 3600) == 0.0


def test_session_load_is_unknown_without_effort_or_duration():
    assert session_load(None, 3600) is None
    assert session_load(7, None) is None
    assert session_load(True, 3600) is None
    assert session_load(-1, 60) is None


def test_stored_load_wins_and_missing_load_is_computed_on_read():
    assert load_for_read(finished(load_au=100)) == 100.0
    assert load_for_read(finished(load_au=0, perceived_effort=7)) == 0.0
    assert load_for_read(finished()) == 420.0
    assert "load_au" not in finished()


def test_no_scored_workout_is_null_not_zero():
    empty = summarize([], NOW)
    assert empty == {"load_week": None, "load_28d_avg": None, "acwr": None}
    unscored = summarize([finished(perceived_effort=None, duration_sec=3600)], NOW)
    assert unscored == empty
    assert summarize([finished(ended_at=None)], NOW) == empty


def test_week_and_chronic_average_and_acwr():
    recent = finished()
    earlier = finished(
        started_at=NOW - timedelta(days=10),
        ended_at=NOW - timedelta(days=10) + timedelta(hours=1),
        perceived_effort=5,
        duration_sec=3600,
    )
    summary = summarize([recent, earlier], NOW)
    assert summary["load_week"] == 420.0
    assert summary["load_28d_avg"] == 180.0
    assert summary["acwr"] == 2.33


def test_a_rest_week_with_earlier_load_is_zero_and_old_rows_stay_out():
    earlier = finished(
        started_at=NOW - timedelta(days=10),
        ended_at=NOW - timedelta(days=10) + timedelta(hours=1),
        perceived_effort=5,
    )
    too_old = finished(
        started_at=NOW - timedelta(days=40),
        ended_at=NOW - timedelta(days=40) + timedelta(hours=1),
    )
    summary = summarize([earlier, too_old], NOW)
    assert summary["load_week"] == 0.0
    assert summary["load_28d_avg"] == 75.0
    assert summary["acwr"] == 0.0


def test_zero_chronic_load_has_no_ratio():
    summary = summarize([finished(perceived_effort=0)], NOW)
    assert summary["load_week"] == 0.0
    assert summary["load_28d_avg"] == 0.0
    assert summary["acwr"] is None
