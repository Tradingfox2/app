"""IronFlow Readiness — pure, no database."""
from datetime import datetime, timedelta, timezone

import pytest

import readiness as r

MOMENT = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


def test_weights_match_the_readiness_contract():
    assert r.WEIGHTS == {"hrv": 35, "resting_hr": 20, "sleep": 25, "training_load": 20}
    assert sum(r.WEIGHTS.values()) == r.TOTAL_WEIGHT == 100


def test_unknown_inputs_are_omitted_not_scored_as_zero():
    result = r.score_readiness()
    assert result["score"] is None
    assert result["verdict"] is None
    assert result["confidence"] == 0
    assert result["components"] == {}
    assert result["missing"] == ["hrv", "resting_hr", "sleep", "training_load"]


def test_a_non_positive_measurement_does_not_become_a_zero_score():
    result = r.score_readiness(
        hrv=0, hrv_baseline=50, resting_hr=-3, resting_hr_baseline=55, sleep_hours=0,
    )
    assert result["score"] is None
    assert result["components"] == {}
    assert result["missing"] == ["hrv", "resting_hr", "sleep", "training_load"]


def test_a_zero_hrv_does_not_wipe_a_known_sleep_score():
    result = r.score_readiness(hrv=0, hrv_baseline=50, sleep_hours=8)
    assert result["score"] == 100
    assert result["verdict"] == "push"
    assert "hrv" in result["missing"]
    assert "hrv" not in result["components"]


def test_a_measured_hrv_collapse_can_score_zero():
    # 35 / 50 = 0.70 → 75 + 250 * -0.30 = 0. The input is known, so the floor is real.
    result = r.score_readiness(hrv=35, hrv_baseline=50)
    assert result["components"]["hrv"]["score"] == 0
    assert result["score"] == 0
    assert result["verdict"] == "rest"
    assert result["confidence"] == 0.35


def test_hrv_above_baseline_scores_higher_than_hrv_below_it():
    above = r.score_readiness(hrv=60, hrv_baseline=50)  # +20% → 100
    below = r.score_readiness(hrv=40, hrv_baseline=50)  # -20% → 25
    assert above["components"]["hrv"]["score"] == 100
    assert below["components"]["hrv"]["score"] == 25
    assert above["score"] > below["score"]


def test_a_lower_resting_hr_scores_higher():
    low = r.score_readiness(resting_hr=50, resting_hr_baseline=55)  # -5 bpm → 100
    high = r.score_readiness(resting_hr=60, resting_hr_baseline=55)  # +5 bpm → 50
    assert low["components"]["resting_hr"]["score"] == 100
    assert high["components"]["resting_hr"]["score"] == 50


def test_hrv_without_a_baseline_is_missing():
    result = r.score_readiness(hrv=62, sleep_hours=8)
    assert "hrv" in result["missing"]
    assert "hrv" not in result["components"]
    assert result["score"] == 100
    assert result["confidence"] == 0.25


def test_sleep_is_scored_against_an_eight_hour_need():
    full = r.score_readiness(sleep_hours=8)
    short = r.score_readiness(sleep_hours=4)
    extra = r.score_readiness(sleep_hours=10)
    assert full["components"]["sleep"]["need"] == 8
    assert full["score"] == 100
    assert short["components"]["sleep"]["score"] == 50
    assert extra["components"]["sleep"]["score"] == 100


def test_verdict_bands():
    assert r.score_readiness(sleep_hours=5.36)["verdict"] == "push"    # 67
    assert r.score_readiness(sleep_hours=5.28)["verdict"] == "steady"  # 66
    assert r.score_readiness(sleep_hours=2.72)["verdict"] == "steady"  # 34
    assert r.score_readiness(sleep_hours=2.64)["verdict"] == "rest"    # 33


def test_missing_inputs_reweight_and_lower_confidence():
    result = r.score_readiness(hrv=50, hrv_baseline=50, resting_hr=55, resting_hr_baseline=55)
    assert result["components"]["hrv"]["score"] == 75
    assert result["components"]["resting_hr"]["score"] == 75
    assert result["score"] == 75
    assert result["confidence"] == 0.55
    assert result["missing"] == ["sleep", "training_load"]


def test_reweight_uses_only_present_scores():
    # Sleep 4h → 50 (weight 25). ACWR 1.0 → 75 (weight 20). 2750 / 45 = 61.1 → 61.
    result = r.score_readiness(sleep_hours=4, load_7d=280, load_28d=1120)
    assert result["components"]["training_load"]["acute_chronic"] == 1.0
    assert result["score"] == 61
    assert result["verdict"] == "steady"
    assert result["confidence"] == 0.45
    assert result["missing"] == ["hrv", "resting_hr"]


def test_full_inputs_blend_the_nominal_weights():
    result = r.score_readiness(
        hrv=50, hrv_baseline=50,
        resting_hr=55, resting_hr_baseline=55,
        sleep_hours=8,
        load_7d=280, load_28d=1120,
    )
    assert result["components"]["hrv"]["weight"] == 35
    assert result["components"]["training_load"]["score"] == 75
    assert result["score"] == 81  # 8125 / 100
    assert result["verdict"] == "push"
    assert result["confidence"] == 1
    assert result["missing"] == []


def test_a_load_spike_lowers_readiness_and_a_quiet_week_does_not():
    spike = r.score_readiness(load_7d=200, load_28d=400)  # ACWR 2.0 → 0
    quiet = r.score_readiness(load_7d=50, load_28d=400)   # ACWR 0.5 → 100
    assert spike["components"]["training_load"]["acute_chronic"] == 2.0
    assert spike["score"] == 0
    assert quiet["components"]["training_load"]["score"] == 100


def test_training_load_without_a_chronic_base_is_missing():
    result = r.score_readiness(load_7d=100, load_28d=0)
    assert result["score"] is None
    assert "training_load" in result["missing"]
    assert r.score_readiness(load_7d=None, load_28d=400)["components"] == {}


def test_session_load_needs_effort_and_duration():
    assert r.session_load(8, 3600) == 480
    assert r.session_load(None, 3600) is None
    assert r.session_load(8, None) is None
    assert r.session_load(0, 3600) is None


def test_derived_load_ignores_sessions_without_effort_and_unfinished_work():
    workouts = [
        {"ended_at": MOMENT - timedelta(days=1), "perceived_effort": 8, "duration_sec": 3600},
        {"ended_at": MOMENT - timedelta(days=1), "perceived_effort": None, "duration_sec": 3600},
        {"ended_at": None, "perceived_effort": 9, "duration_sec": 1800},
    ]
    assert r.select_training_loads([], workouts, MOMENT) == (480, 480)


def test_seven_day_load_excludes_the_older_part_of_the_chronic_window():
    workouts = [
        {"ended_at": MOMENT - timedelta(days=6), "perceived_effort": 5, "duration_sec": 1200},
        {"ended_at": MOMENT - timedelta(days=8), "perceived_effort": 5, "duration_sec": 1200},
    ]
    load_7, load_28 = r.select_training_loads([], workouts, MOMENT)
    assert load_7 == 100
    assert load_28 == 200


def test_stored_load_wins_over_workout_session_rpe():
    stored = [(MOMENT - timedelta(days=1), 100.0), (MOMENT - timedelta(days=10), 100.0)]
    workouts = [{"ended_at": MOMENT, "perceived_effort": 10, "duration_sec": 6000}]
    assert r.select_training_loads(stored, workouts, MOMENT) == (100.0, 200.0)


def test_no_finished_load_stays_unknown():
    assert r.select_training_loads([], [], MOMENT) == (None, None)


def test_baseline_needs_three_positive_samples():
    assert r.personal_baseline([50, 52]) is None
    assert r.personal_baseline([50, 0, None, 52, 48]) == pytest.approx(50)
    assert r.personal_baseline([50, 52, 48]) == pytest.approx(50)


def test_a_reading_older_than_48_hours_is_not_fresh():
    assert r.is_fresh(MOMENT - timedelta(hours=48), MOMENT) is True
    assert r.is_fresh(MOMENT - timedelta(hours=48, seconds=1), MOMENT) is False
    assert r.is_fresh(None, MOMENT) is False
    assert r.is_fresh(datetime(2026, 10, 1, 10), MOMENT) is True  # naive is UTC
