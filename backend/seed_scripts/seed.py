"""Seed muscles + exercises into MongoDB."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, str(Path(__file__).parent.parent))
from muscle_recommendations import EXERCISE_LIBRARY

load_dotenv(Path(__file__).parent.parent / ".env")

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

    print(f"Seeded {await db.muscles.count_documents({})} muscles, {await db.exercises.count_documents({})} exercises.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
