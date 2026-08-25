"""Wearables (Terra-ready, simulated until keys are provided) + gym QR check-ins.

- "Sources connectées": connect/disconnect/sync per provider.
- POST /webhooks/terra is the ready-to-plug Terra webhook (normalizes payloads
  into wearable_metrics). Real OAuth activates once TERRA_API_KEY/TERRA_DEV_ID
  are set in backend/.env.
- QR check-in: scan "IRONFLOW-GYM:<id>" -> gym visit, optional workout link,
  partner reward unlocks every N visits.
"""
import os
import random
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server import clean, current_user, db, new_id, now

router = APIRouter()

PROVIDERS = ["garmin", "whoop", "fitbit", "oura", "apple_health", "health_connect"]
TERRA_CONFIGURED = bool(os.environ.get("TERRA_API_KEY") and os.environ.get("TERRA_DEV_ID"))

METRIC_UNITS = {
    "hrv": "ms",
    "resting_hr": "bpm",
    "sleep_hours": "h",
    "steps": "steps",
    "calories": "kcal",
    "vo2max": "ml/kg/min",
    "strain": "",
    "recovery": "%",
}

# Terra payload field -> normalized metric
TERRA_FIELD_MAP = {
    "hrv_avg": "hrv",
    "rmssd_avg": "hrv",
    "resting_hr": "resting_hr",
    "resting_heartrate": "resting_hr",
    "sleep_hours": "sleep_hours",
    "sleep_duration_hours": "sleep_hours",
    "steps": "steps",
    "calories": "calories",
    "total_burned_calories": "calories",
    "vo2max": "vo2max",
    "vo2_max": "vo2max",
    "strain": "strain",
    "recovery": "recovery",
    "recovery_score": "recovery",
}


# --------------------------------------------------------------------------- #
# Sources connectées                                                          #
# --------------------------------------------------------------------------- #
@router.get("/wearables/sources")
async def list_sources(user: dict = Depends(current_user)):
    docs = {
        d["provider"]: d
        async for d in db.wearable_sources.find({"user_id": user["id"]}, {"_id": 0})
    }
    out = []
    for p in PROVIDERS:
        d = docs.get(p)
        out.append(
            {
                "provider": p,
                "status": d["status"] if d else "disconnected",
                "last_sync_at": d.get("last_sync_at") if d else None,
                "mode": "terra" if TERRA_CONFIGURED and p not in ("apple_health", "health_connect") else "simulated",
                "requires_native_build": p in ("apple_health", "health_connect"),
            }
        )
    return out


@router.post("/wearables/sources/{provider}/connect")
async def connect_source(provider: str, user: dict = Depends(current_user)):
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown provider")
    terra_user_id = f"sim-{new_id()[:8]}"
    await db.wearable_sources.update_one(
        {"user_id": user["id"], "provider": provider},
        {
            "$set": {"status": "connected", "connected_at": now(), "terra_user_id": terra_user_id},
            "$setOnInsert": {"id": new_id(), "user_id": user["id"], "provider": provider},
        },
        upsert=True,
    )
    doc = await db.wearable_sources.find_one(
        {"user_id": user["id"], "provider": provider}, {"_id": 0}
    )
    return {
        **clean(doc),
        "auth_url": None,  # real Terra widget URL once TERRA_API_KEY is configured
        "simulated": not TERRA_CONFIGURED,
    }


@router.post("/wearables/sources/{provider}/disconnect")
async def disconnect_source(provider: str, user: dict = Depends(current_user)):
    res = await db.wearable_sources.update_one(
        {"user_id": user["id"], "provider": provider},
        {"$set": {"status": "disconnected", "disconnected_at": now()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Source not connected")
    return {"provider": provider, "status": "disconnected"}


@router.post("/wearables/sources/{provider}/sync")
async def sync_source(provider: str, user: dict = Depends(current_user)):
    """Simulated sync: writes 7 days of normalized metrics for this provider."""
    src = await db.wearable_sources.find_one(
        {"user_id": user["id"], "provider": provider, "status": "connected"}, {"_id": 0}
    )
    if not src:
        raise HTTPException(409, "Connect this source first")
    # replace previous simulated rows from this provider to keep series clean
    await db.wearable_metrics.delete_many(
        {"user_id": user["id"], "device": provider, "simulated": True}
    )
    rng = random.Random(f"{user['id']}:{provider}:{now():%Y-%m-%d}")
    docs = []
    base_hrv = rng.uniform(55, 80)
    for d in range(6, -1, -1):
        day = now() - timedelta(days=d)
        daily = {
            "hrv": round(base_hrv + rng.uniform(-12, 10), 1),
            "resting_hr": round(rng.uniform(48, 62)),
            "sleep_hours": round(rng.uniform(5.5, 8.7), 1),
            "steps": rng.randint(4000, 15000),
            "calories": rng.randint(1900, 3400),
            "strain": round(rng.uniform(6, 18), 1),
            "recovery": round(rng.uniform(35, 95)),
        }
        if d == 0:
            daily["vo2max"] = round(rng.uniform(42, 58), 1)
        for metric, value in daily.items():
            docs.append(
                {
                    "id": new_id(),
                    "user_id": user["id"],
                    "metric": metric,
                    "value": value,
                    "unit": METRIC_UNITS.get(metric),
                    "device": provider,
                    "simulated": True,
                    "recorded_at": day,
                    "created_at": now(),
                }
            )
    if docs:
        await db.wearable_metrics.insert_many(docs)
    await db.wearable_sources.update_one(
        {"user_id": user["id"], "provider": provider}, {"$set": {"last_sync_at": now()}}
    )
    return {"provider": provider, "synced": len(docs), "simulated": True}


@router.post("/webhooks/terra")
async def terra_webhook(request: Request):
    """Ready-to-plug Terra webhook: maps payloads to normalized wearable_metrics."""
    payload = await request.json()
    terra_user = (payload.get("user") or {}).get("user_id")
    if not terra_user:
        return {"received": True, "processed": 0}
    src = await db.wearable_sources.find_one({"terra_user_id": terra_user}, {"_id": 0})
    if not src:
        return {"received": True, "processed": 0, "reason": "unknown terra user"}
    processed = 0
    for item in payload.get("data") or []:
        for field, metric in TERRA_FIELD_MAP.items():
            if field in item and isinstance(item[field], (int, float)):
                await db.wearable_metrics.insert_one(
                    {
                        "id": new_id(),
                        "user_id": src["user_id"],
                        "metric": metric,
                        "value": float(item[field]),
                        "unit": METRIC_UNITS.get(metric),
                        "device": src["provider"],
                        "simulated": False,
                        "recorded_at": now(),
                        "created_at": now(),
                    }
                )
                processed += 1
    await db.wearable_sources.update_one(
        {"terra_user_id": terra_user}, {"$set": {"last_sync_at": now()}}
    )
    return {"received": True, "processed": processed}


# --------------------------------------------------------------------------- #
# Gym QR check-ins                                                            #
# --------------------------------------------------------------------------- #
SEED_GYMS = [
    {"name": "IronFlow Bastille", "city": "Paris", "reward_every": 10},
    {"name": "IronFlow Part-Dieu", "city": "Lyon", "reward_every": 10},
    {"name": "IronFlow Vieux-Port", "city": "Marseille", "reward_every": 10},
]


async def ensure_gyms():
    if await db.gyms.count_documents({}) == 0:
        for g in SEED_GYMS:
            gid = new_id()
            await db.gyms.insert_one(
                {"id": gid, **g, "qr_payload": f"IRONFLOW-GYM:{gid}", "created_at": now()}
            )


class CheckinIn(BaseModel):
    qr_payload: str
    workout_id: Optional[str] = None


@router.get("/gyms")
async def list_gyms():
    await ensure_gyms()
    return [clean(g) async for g in db.gyms.find({}, {"_id": 0}).sort("name", 1)]


@router.post("/gyms/checkin", status_code=201)
async def gym_checkin(body: CheckinIn, user: dict = Depends(current_user)):
    await ensure_gyms()
    payload = body.qr_payload.strip()
    if not payload.upper().startswith("IRONFLOW-GYM:"):
        raise HTTPException(422, "QR code non reconnu")
    gym_id = payload.split(":", 1)[1]
    gym = await db.gyms.find_one({"id": gym_id}, {"_id": 0})
    if not gym:
        raise HTTPException(404, "Salle inconnue")
    if body.workout_id:
        w = await db.workouts.find_one({"id": body.workout_id, "user_id": user["id"]})
        if not w:
            raise HTTPException(404, "Workout not found")
        await db.workouts.update_one({"id": body.workout_id}, {"$set": {"gym_id": gym_id}})
    visit = {
        "id": new_id(),
        "user_id": user["id"],
        "gym_id": gym_id,
        "workout_id": body.workout_id,
        "checked_in_at": now(),
    }
    await db.gym_visits.insert_one(dict(visit))
    total = await db.gym_visits.count_documents({"user_id": user["id"], "gym_id": gym_id})
    reward_every = gym.get("reward_every", 10)
    return {
        "visit": clean(visit),
        "gym": clean(gym),
        "total_visits": total,
        "reward_unlocked": total % reward_every == 0,
        "visits_until_reward": (reward_every - total % reward_every) % reward_every,
    }


@router.get("/gyms/visits")
async def my_visits(user: dict = Depends(current_user)):
    visits = [
        clean(v)
        async for v in db.gym_visits.find({"user_id": user["id"]}, {"_id": 0})
        .sort("checked_in_at", -1)
        .limit(50)
    ]
    gyms = {g["id"]: g async for g in db.gyms.find({}, {"_id": 0})}
    for v in visits:
        g = gyms.get(v["gym_id"])
        v["gym_name"] = g["name"] if g else "?"
    return visits
