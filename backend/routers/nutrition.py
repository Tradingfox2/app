"""Session protein and water, and one barcode read from Open Food Facts."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import nutrition
import ratelimit
import server

router = APIRouter()


class NutritionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protein_g: float | None = Field(default=None, ge=0)
    water_ml: float | None = Field(default=None, ge=0)


@router.put("/workouts/{workout_id}/nutrition")
async def save_session_nutrition(
    workout_id: str,
    body: NutritionIn,
    user: dict = Depends(server.current_user),
):
    workout = await server.db.workouts.find_one({"id": workout_id}, {"_id": 0, "user_id": 1})
    if not workout:
        raise HTTPException(404, "Not found")
    if workout.get("user_id") != user["id"]:
        raise HTTPException(403, "Not allowed")
    stored = nutrition.session_nutrition(body.protein_g, body.water_ml)
    await server.db.workouts.update_one({"id": workout_id}, {"$set": {"nutrition": stored}})
    return nutrition.public_log(stored)


@router.get("/nutrition/products/{barcode}")
async def read_product(barcode: str, user: dict = Depends(server.current_user)):
    await ratelimit.hit("product_read", user["id"])
    code = nutrition.normalize_barcode(barcode)
    if code is None:
        return nutrition.lookup_failed()
    return await nutrition.fetch_product(code)
