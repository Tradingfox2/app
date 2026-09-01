"""
Muscle explorer API: enriched heatmap + per-muscle recommendations.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from muscle_recommendations import (
    AI_CIRCUIT_SYSTEM,
    SUPPORTED_MUSCLES,
    build_recommendations,
    validate_ai_circuit,
)
from server import current_user, db, now

router = APIRouter()


class AiCircuitIn(BaseModel):
    muscle_slug: str
    goal: str = Field(pattern="^(strength|hypertrophy|endurance|fat_loss|general)$")
    level: str = Field(pattern="^(beginner|intermediate|advanced)$")
    equipment: list[str] = []


async def build_muscle_snapshot(user_id: str) -> dict[str, Any]:
    week_ago = now() - timedelta(days=7)
    workouts = [
        workout
        async for workout in db.workouts.find(
            {"user_id": user_id, "started_at": {"$gte": week_ago}},
            {"_id": 0, "id": 1, "started_at": 1},
        )
    ]
    workout_dates = {
        workout["id"]: workout.get("started_at") for workout in workouts
    }
    details = {
        slug: {
            "sets_7d": 0,
            "volume": 0.0,
            "last_trained_at": None,
        }
        for slug in SUPPORTED_MUSCLES
    }
    exercise_cache: dict[str, dict[str, Any]] = {}

    async for training_set in db.workout_sets.find(
        {"workout_id": {"$in": list(workout_dates)}},
        {"_id": 0},
    ):
        exercise_id = training_set["exercise_id"]
        if exercise_id not in exercise_cache:
            exercise_cache[exercise_id] = (
                await db.exercises.find_one({"id": exercise_id}, {"_id": 0})
                or {}
            )
        exercise = exercise_cache[exercise_id]
        weight = float(training_set.get("weight_kg") or 0)
        reps = int(training_set.get("reps") or 0)
        contribution = weight * reps if weight and reps else float(reps or 1)
        muscles = []
        primary = exercise.get("primary_muscle_slug")
        if primary in SUPPORTED_MUSCLES:
            muscles.append((primary, 1.0))
        muscles.extend(
            (slug, 0.5)
            for slug in exercise.get("secondary_muscle_slugs", []) or []
            if slug in SUPPORTED_MUSCLES
        )
        for slug, factor in muscles:
            details[slug]["sets_7d"] += 1
            details[slug]["volume"] += contribution * factor
            trained_at = workout_dates.get(training_set["workout_id"])
            previous = details[slug]["last_trained_at"]
            if trained_at and (previous is None or trained_at > previous):
                details[slug]["last_trained_at"] = trained_at

    max_volume = max((item["volume"] for item in details.values()), default=0)
    for item in details.values():
        item["load_percent"] = (
            round(item["volume"] / max_volume * 100) if max_volume else 0
        )
        age_hours = (
            (now() - item["last_trained_at"]).total_seconds() / 3600
            if item["last_trained_at"] else None
        )
        item["recovery_state"] = (
            "untrained" if age_hours is None
            else "high_load" if item["load_percent"] >= 85 and age_hours < 24
            else "recovering" if age_hours < 48
            else "ready"
        )
    return details


@router.get("/muscle-heatmap")
async def muscle_heatmap(user: dict = Depends(current_user)):
    muscles = await build_muscle_snapshot(user["id"])
    volumes = {
        slug: item["volume"]
        for slug, item in muscles.items()
        if item["volume"] > 0
    }
    return {
        "volumes": volumes,
        "max": max(volumes.values()) if volumes else 0,
        "muscles": muscles,
    }


@router.get("/muscles/{muscle_slug}/recommendations")
async def muscle_recommendations(
    muscle_slug: str,
    equipment: list[str] = Query(default=[]),
    level: str | None = None,
    user: dict = Depends(current_user),
):
    if muscle_slug not in SUPPORTED_MUSCLES:
        raise HTTPException(status_code=404, detail="Unknown muscle")

    catalog = [
        exercise
        async for exercise in db.exercises.find({}, {"_id": 0})
    ]

    return build_recommendations(
        catalog=catalog,
        muscle_slug=muscle_slug,
        equipment=equipment if equipment else None,
        level=level,
    )


@router.post("/coach/muscle-circuit")
async def ai_muscle_circuit(
    request: AiCircuitIn,
    user: dict = Depends(current_user),
):
    if request.muscle_slug not in SUPPORTED_MUSCLES:
        raise HTTPException(status_code=404, detail="Unknown muscle")

    catalog = [
        exercise
        async for exercise in db.exercises.find({}, {"_id": 0})
    ]

    recommendations = build_recommendations(
        catalog=catalog,
        muscle_slug=request.muscle_slug,
        equipment=request.equipment if request.equipment else None,
        level=request.level,
    )

    available_exercises = (
        recommendations["primary"] 
        + recommendations["secondary"]
        + [
            ex for ex in catalog 
            if ex.get("primary_muscle_slug") == recommendations["antagonist_slug"]
        ]
    )

    if len(available_exercises) < 2:
        raise HTTPException(
            status_code=422,
            detail="Insufficient exercises available for this muscle and filters"
        )

    # Build catalog context for LLM
    allowed_slugs = {ex["slug"] for ex in available_exercises}
    catalog_lines = [
        f"- {ex['slug']}: {ex['name']} ({ex.get('equipment', 'bodyweight')})"
        for ex in available_exercises
    ]
    catalog_text = "\n".join(catalog_lines)

    # Mock LLM response for testing without external API call
    # In production, this would call llm_json with AI_CIRCUIT_SYSTEM prompt
    # For now, return a deterministic circuit based on available exercises
    circuit_items = [
        {
            "exercise_slug": ex["slug"],
            "sets": 3,
            "reps_min": 8,
            "reps_max": 12,
            "rest_sec": 60,
        }
        for ex in available_exercises[:4]
    ]

    mock_response = {
        "name": f"{request.muscle_slug.replace('_', ' ').title()} {request.goal.title()} Circuit",
        "rationale": f"Progressive {request.goal} circuit for {request.level} level using available equipment.",
        "items": circuit_items,
    }

    try:
        validated_circuit = validate_ai_circuit(mock_response, allowed_slugs)
        return validated_circuit.model_dump()
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail="Failed to generate valid circuit"
        )
