"""Swap one planned exercise without rewriting the program."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from program_layout import SwapError, apply_program_swap  # noqa: E402


def _program():
    return {
        "program": {
            "weeks": [{
                "week_index": 1,
                "phase": "accumulation",
                "days": [{
                    "day_index": 1,
                    "focus": "push",
                    "exercises": [{
                        "exercise_slug": "bench-press",
                        "name": "Bench Press",
                        "sets": 4,
                        "reps_min": 6,
                        "reps_max": 8,
                        "target_rpe": 8,
                        "rest_sec": 150,
                        "load_pct_1rm": 72.5,
                    }],
                }],
            }],
        },
        "adjustments": [{
            "week_index": 1,
            "day_index": 1,
            "adjusted_day": {
                "day_index": 1,
                "focus": "push",
                "exercises": [{
                    "exercise_slug": "bench-press",
                    "name": "Bench Press",
                    "sets": 2,
                    "reps_min": 8,
                    "reps_max": 10,
                    "target_rpe": 6.5,
                    "rest_sec": 180,
                    "load_pct_1rm": 60,
                }],
            },
        }],
    }


def test_swap_keeps_the_prescription_on_the_day_and_the_adjustment():
    prog = _program()
    result = apply_program_swap(prog, 1, 1, "bench-press", "dip", "Dip")
    exercise = result["day"]["exercises"][0]
    assert exercise["exercise_slug"] == "dip"
    assert exercise["name"] == "Dip"
    assert exercise["sets"] == 4
    assert exercise["reps_min"] == 6
    assert exercise["rest_sec"] == 150
    assert exercise["load_pct_1rm"] == 72.5
    adjusted = result["adjusted_day"]["exercises"][0]
    assert adjusted["exercise_slug"] == "dip"
    assert adjusted["sets"] == 2
    assert adjusted["rest_sec"] == 180
    assert prog["program"]["weeks"][0]["phase"] == "accumulation"
    assert len(prog["program"]["weeks"]) == 1


def test_swap_rejects_a_missing_or_duplicate_exercise():
    prog = _program()
    try:
        apply_program_swap(prog, 1, 1, "row", "dip", "Dip")
    except SwapError as exc:
        assert exc.status == 404
    else:
        raise AssertionError("missing exercise should fail")
    prog["program"]["weeks"][0]["days"][0]["exercises"].append({
        "exercise_slug": "dip",
        "name": "Dip",
        "sets": 3,
        "reps_min": 8,
        "reps_max": 8,
        "target_rpe": 8,
        "rest_sec": 120,
    })
    try:
        apply_program_swap(prog, 1, 1, "bench-press", "dip", "Dip")
    except SwapError as exc:
        assert exc.status == 409
    else:
        raise AssertionError("duplicate exercise should fail")
    assert prog["program"]["weeks"][0]["days"][0]["exercises"][0]["exercise_slug"] == "bench-press"


if __name__ == "__main__":
    test_swap_keeps_the_prescription_on_the_day_and_the_adjustment()
    test_swap_rejects_a_missing_or_duplicate_exercise()
    print("ok")
