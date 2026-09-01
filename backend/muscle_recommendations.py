from __future__ import annotations

from typing import Any, Iterable, Optional

from pydantic import BaseModel, Field, model_validator

SUPPORTED_MUSCLES = {
    "chest", "back", "lats", "shoulders", "biceps", "triceps",
    "forearms", "quads", "hamstrings", "glutes", "calves", "abs",
    "obliques", "lower_back",
}

ANTAGONISTS = {
    "chest": "back",
    "back": "chest",
    "lats": "chest",
    "shoulders": "lats",
    "biceps": "triceps",
    "triceps": "biceps",
    "forearms": "biceps",
    "quads": "hamstrings",
    "hamstrings": "quads",
    "glutes": "quads",
    "calves": "quads",
    "abs": "lower_back",
    "obliques": "lower_back",
    "lower_back": "abs",
}

LEVEL_RANK = {"beginner": 0, "intermediate": 1, "advanced": 2}


def build_recommendations(
    catalog: Iterable[dict[str, Any]],
    muscle_slug: str,
    equipment: Optional[list[str]] = None,
    level: Optional[str] = None,
) -> dict[str, Any]:
    if muscle_slug not in SUPPORTED_MUSCLES:
        raise ValueError(f"Unsupported muscle: {muscle_slug}")

    entries = list(catalog)
    allowed_equipment = {item.lower() for item in equipment or []}
    max_rank = LEVEL_RANK.get(level, LEVEL_RANK["advanced"])

    def eligible(item: dict[str, Any]) -> bool:
        item_equipment = (item.get("equipment") or "bodyweight").lower()
        item_level = LEVEL_RANK.get(item.get("difficulty", "beginner"), 0)
        return (
            (not allowed_equipment or item_equipment in allowed_equipment)
            and item_level <= max_rank
        )

    filtered = [item for item in entries if eligible(item)]
    primary = [
        item for item in filtered
        if item.get("primary_muscle_slug") == muscle_slug
    ]
    secondary = [
        item for item in filtered
        if muscle_slug in (item.get("secondary_muscle_slugs") or [])
        and item.get("primary_muscle_slug") != muscle_slug
    ]
    antagonist_slug = ANTAGONISTS[muscle_slug]
    antagonist = [
        item for item in filtered
        if item.get("primary_muscle_slug") == antagonist_slug
    ]

    combined = primary + antagonist
    circuit_source = combined if len(combined) >= 3 else primary + secondary
    circuit_items = [
        {
            "exercise_slug": item["slug"],
            "name": item["name"],
            "sets": 3,
            "reps_min": 8,
            "reps_max": 12,
            "rest_sec": 60,
        }
        for item in circuit_source[:5]
    ]
    circuits = (
        [{"name": f"{muscle_slug.replace('_', ' ').title()} Builder", "items": circuit_items}]
        if len(circuit_items) >= 2
        else []
    )
    return {
        "muscle_slug": muscle_slug,
        "antagonist_slug": antagonist_slug,
        "primary": primary,
        "secondary": secondary,
        "combinations": (primary[:2] + antagonist[:2])[:4],
        "circuits": circuits,
    }


class AiCircuitItem(BaseModel):
    exercise_slug: str
    sets: int = Field(ge=1, le=6)
    reps_min: int = Field(ge=1, le=50)
    reps_max: int = Field(ge=1, le=50)
    rest_sec: int = Field(ge=15, le=300)

    @model_validator(mode="after")
    def reps_are_ordered(self):
        if self.reps_min > self.reps_max:
            raise ValueError("reps_min must not exceed reps_max")
        return self


class AiCircuit(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    rationale: str = Field(min_length=3, max_length=300)
    items: list[AiCircuitItem] = Field(min_length=2, max_length=5)


def validate_ai_circuit(data: Any, allowed_slugs: set[str]) -> AiCircuit:
    circuit = AiCircuit.model_validate(data)
    unknown = [
        item.exercise_slug
        for item in circuit.items
        if item.exercise_slug not in allowed_slugs
    ]
    if unknown:
        raise ValueError(f"unknown exercise slugs: {unknown}")
    return circuit


AI_CIRCUIT_SYSTEM = """You are a strength training coach. Generate a workout circuit as valid JSON only.

Requirements:
- Use ONLY exercise slugs from the provided catalog
- Include 2-5 exercises
- Sets: 1-6 per exercise
- Reps: 1-50 (min must not exceed max)
- Rest: 15-300 seconds
- Name: 3-80 characters
- Rationale: 3-300 characters explaining the selection
- NO medical claims or guarantees

Return ONLY valid JSON matching this exact structure:
{
  "name": "Circuit Name",
  "rationale": "Brief explanation",
  "items": [
    {
      "exercise_slug": "exact-catalog-slug",
      "sets": 3,
      "reps_min": 8,
      "reps_max": 12,
      "rest_sec": 60
    }
  ]
}"""
