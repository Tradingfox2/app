"""Seed muscles, exercises, the demo athlete, and the demo gyms into MongoDB."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, str(Path(__file__).parent.parent))
from muscle_recommendations import EXERCISE_LIBRARY

load_dotenv(Path(__file__).parent.parent / ".env")

# CI's live-server suite signs in as this account. The password is the
# documented demo credential, not a production secret.
DEMO_EMAIL = "demo@ironflow.app"
DEMO_PASSWORD = "demo1234"
DEMO_PROGRAM_ID = "seed-demo-program"

# Same three rooms as routers.gyms.SEED_GYMS. Listed here so this script does
# not import the FastAPI app. The public gym list only shows what is stored.
DEMO_GYMS = [
    {"name": "IronFlow Bastille", "city": "Paris", "reward_every": 10},
    {"name": "IronFlow Part-Dieu", "city": "Lyon", "reward_every": 10},
    {"name": "IronFlow Vieux-Port", "city": "Marseille", "reward_every": 10},
]


MUSCLES = [
    ("chest", "Chest", "upper"),
    ("back", "Back", "upper"),
    ("lats", "Lats", "upper"),
    ("shoulders", "Shoulders", "upper"),
    ("biceps", "Biceps", "upper"),
    ("triceps", "Triceps", "upper"),
    ("forearms", "Forearms", "upper"),
    ("quads", "Quadriceps", "lower"),
    ("hamstrings", "Hamstrings", "lower"),
    ("glutes", "Glutes", "lower"),
    ("calves", "Calves", "lower"),
    ("abs", "Abs", "core"),
    ("obliques", "Obliques", "core"),
    ("lower_back", "Lower Back", "core"),
    ("cardio", "Cardiovascular", "cardio"),
]


async def main() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "ironflow")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    now = datetime.now(timezone.utc)

    # Muscles
    for slug, name, group in MUSCLES:
        await db.muscles.update_one(
            {"slug": slug},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "slug": slug,
                "name": name,
                "group_name": group,
                "created_at": now,
            }},
            upsert=True,
        )

    # Exercises
    for item in EXERCISE_LIBRARY:
        muscle = await db.muscles.find_one({"slug": item["primary_muscle_slug"]})
        await db.exercises.update_one(
            {"slug": item["slug"]},
            {
                "$set": {
                    "name": item["name"],
                    "category": item["category"],
                    "equipment": item["equipment"],
                    "difficulty": item["difficulty"],
                    "primary_muscle_slug": item["primary_muscle_slug"],
                    "primary_muscle_id": muscle["id"] if muscle else None,
                    "secondary_muscle_slugs": item.get("secondary_muscle_slugs") or [],
                    "instructions": item.get("instructions") or "",
                    "video_url": item.get("video_url"),
                    "video_poster_url": item.get("video_poster_url"),
                    "video_duration_sec": item.get("video_duration_sec"),
                },
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "slug": item["slug"],
                    "created_at": now,
                },
            },
            upsert=True,
        )

    # Demo athlete. Refresh the hash so a re-seed always matches DEMO_PASSWORD.
    password_hash = bcrypt.hashpw(DEMO_PASSWORD.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()
    await db.users.update_one(
        {"email": DEMO_EMAIL},
        {
            "$set": {
                "password_hash": password_hash,
                "full_name": "Demo Athlete",
                "role": "athlete",
                "coach_status": "not_applied",
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "email": DEMO_EMAIL,
                "avatar_url": None,
                "preferred_locale": "fr",
                "created_at": now,
            },
        },
        upsert=True,
    )
    demo = await db.users.find_one({"email": DEMO_EMAIL}, {"_id": 0, "id": 1})
    await db.programs.update_one(
        {"id": DEMO_PROGRAM_ID},
        {"$set": {
            "id": DEMO_PROGRAM_ID,
            "user_id": demo["id"],
            "status": "active",
            "created_at": now,
            "adjustments": [],
            "program": {"weeks": [{
                "week_index": 1,
                "phase": "accumulation",
                "days": [{
                    "day_index": 1,
                    "focus": "push",
                    "exercises": [{
                        "exercise_slug": "barbell-bench-press",
                        "name": "Barbell Bench Press",
                        "sets": 4,
                        "reps_min": 5,
                        "reps_max": 8,
                        "target_rpe": 8,
                        "rest_sec": 150,
                    }],
                }],
            }]},
        }},
        upsert=True,
    )

    for gym in DEMO_GYMS:
        gid = str(uuid.uuid4())
        await db.gyms.update_one(
            {"name": gym["name"]},
            {"$setOnInsert": {
                "id": gid,
                **gym,
                "qr_payload": f"IRONFLOW-GYM:{gid}",
                "created_at": now,
            }},
            upsert=True,
        )

    print(
        f"Seeded {await db.muscles.count_documents({})} muscles, "
        f"{await db.exercises.count_documents({})} exercises, "
        f"demo user {DEMO_EMAIL}, "
        f"{await db.gyms.count_documents({})} gyms."
    )
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
