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
