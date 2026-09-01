from muscle_recommendations import (
    SUPPORTED_MUSCLES,
    build_recommendations,
)


CATALOG = [
    {
        "slug": "barbell-bench-press",
        "name": "Barbell Bench Press",
        "primary_muscle_slug": "chest",
        "secondary_muscle_slugs": ["triceps", "shoulders"],
        "equipment": "barbell",
        "difficulty": "intermediate",
        "category": "strength",
    },
    {
        "slug": "push-up",
        "name": "Push Up",
        "primary_muscle_slug": "chest",
        "secondary_muscle_slugs": ["triceps"],
        "equipment": "bodyweight",
        "difficulty": "beginner",
        "category": "strength",
    },
    {
        "slug": "seated-cable-row",
        "name": "Seated Cable Row",
        "primary_muscle_slug": "back",
        "secondary_muscle_slugs": ["biceps"],
        "equipment": "machine",
        "difficulty": "beginner",
        "category": "strength",
    },
    {
        "slug": "dumbbell-fly",
        "name": "Dumbbell Fly",
        "primary_muscle_slug": "chest",
        "secondary_muscle_slugs": [],
        "equipment": "dumbbell",
        "difficulty": "beginner",
        "category": "strength",
    },
]


def test_supported_muscles_match_existing_non_cardio_taxonomy():
    assert SUPPORTED_MUSCLES == {
        "chest", "back", "lats", "shoulders", "biceps", "triceps",
        "forearms", "quads", "hamstrings", "glutes", "calves", "abs",
        "obliques", "lower_back",
    }


def test_recommendations_filter_equipment_and_preserve_catalog_slugs():
    result = build_recommendations(
        CATALOG,
        muscle_slug="chest",
        equipment=["bodyweight", "dumbbell"],
        level="beginner",
    )
    slugs = {item["slug"] for item in result["primary"]}
    assert slugs == {"push-up", "dumbbell-fly"}
    assert result["antagonist_slug"] == "back"
    assert all(
        item["exercise_slug"] in {entry["slug"] for entry in CATALOG}
        for circuit in result["circuits"]
        for item in circuit["items"]
    )


import pytest
from pydantic import ValidationError

from muscle_recommendations import validate_ai_circuit


def test_ai_circuit_rejects_unknown_exercise_slug():
    data = {
        "name": "Chest Density",
        "rationale": "Alternates pressing patterns.",
        "items": [
            {
                "exercise_slug": "invented-press",
                "sets": 3,
                "reps_min": 8,
                "reps_max": 12,
                "rest_sec": 60,
            },
            {
                "exercise_slug": "push-up",
                "sets": 3,
                "reps_min": 8,
                "reps_max": 12,
                "rest_sec": 60,
            }
        ],
    }
    with pytest.raises(ValueError, match="unknown exercise"):
        validate_ai_circuit(data, {"push-up"})


def test_ai_circuit_rejects_reversed_rep_range():
    data = {
        "name": "Chest Density",
        "rationale": "Uses known movements.",
        "items": [
            {
                "exercise_slug": "push-up",
                "sets": 3,
                "reps_min": 15,
                "reps_max": 8,
                "rest_sec": 60,
            },
            {
                "exercise_slug": "dumbbell-fly",
                "sets": 3,
                "reps_min": 8,
                "reps_max": 12,
                "rest_sec": 60,
            }
        ],
    }
    with pytest.raises(ValidationError):
        validate_ai_circuit(data, {"push-up", "dumbbell-fly"})
