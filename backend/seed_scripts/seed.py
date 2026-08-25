"""Seed muscles + 50 exercises into MongoDB (mirrors supabase/seed.sql)."""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

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

EXERCISES = [
    ("barbell-bench-press", "Barbell Bench Press", "strength", "barbell", "intermediate", "chest", "Lie on bench, lower bar to chest, press up."),
    ("incline-bench-press", "Incline Bench Press", "strength", "barbell", "intermediate", "chest", "Set bench to 30 deg, press bar from upper chest."),
    ("dumbbell-fly", "Dumbbell Fly", "strength", "dumbbell", "beginner", "chest", "Arc dumbbells with slight elbow bend."),
    ("push-up", "Push Up", "strength", "bodyweight", "beginner", "chest", "Lower chest to floor, press up."),
    ("dips", "Dips", "strength", "bodyweight", "intermediate", "triceps", "Lower until shoulders below elbows, press up."),
    ("pull-up", "Pull Up", "strength", "bodyweight", "intermediate", "lats", "Pull chin above bar, control descent."),
    ("chin-up", "Chin Up", "strength", "bodyweight", "intermediate", "biceps", "Supinated grip, pull chin above bar."),
    ("lat-pulldown", "Lat Pulldown", "strength", "machine", "beginner", "lats", "Pull bar to upper chest, squeeze lats."),
    ("bent-over-row", "Bent Over Barbell Row", "strength", "barbell", "intermediate", "back", "Hinge hips, row bar to lower ribs."),
    ("seated-cable-row", "Seated Cable Row", "strength", "machine", "beginner", "back", "Row handle to abdomen, squeeze shoulder blades."),
    ("deadlift", "Deadlift", "strength", "barbell", "advanced", "back", "Hinge, grip bar, drive floor away, lock out."),
    ("romanian-deadlift", "Romanian Deadlift", "strength", "barbell", "intermediate", "hamstrings", "Hinge with soft knees, feel hamstring stretch."),
    ("overhead-press", "Overhead Press", "strength", "barbell", "intermediate", "shoulders", "Press bar overhead from front rack."),
    ("dumbbell-shoulder-press", "Dumbbell Shoulder Press", "strength", "dumbbell", "beginner", "shoulders", "Press dumbbells overhead from shoulders."),
    ("lateral-raise", "Lateral Raise", "strength", "dumbbell", "beginner", "shoulders", "Raise arms out to shoulder height."),
    ("face-pull", "Face Pull", "strength", "machine", "beginner", "shoulders", "Pull rope to face, external rotation."),
    ("barbell-curl", "Barbell Curl", "strength", "barbell", "beginner", "biceps", "Curl bar with elbows pinned."),
    ("dumbbell-curl", "Dumbbell Curl", "strength", "dumbbell", "beginner", "biceps", "Alternate arms, supinate at top."),
    ("hammer-curl", "Hammer Curl", "strength", "dumbbell", "beginner", "biceps", "Neutral grip curl for brachialis."),
    ("tricep-pushdown", "Tricep Pushdown", "strength", "machine", "beginner", "triceps", "Push rope/bar down, keep elbows fixed."),
    ("skull-crusher", "Skull Crusher", "strength", "barbell", "intermediate", "triceps", "Lower bar to forehead, extend triceps."),
    ("wrist-curl", "Wrist Curl", "strength", "dumbbell", "beginner", "forearms", "Small ROM curl for forearms."),
    ("back-squat", "Back Squat", "strength", "barbell", "intermediate", "quads", "Bar on upper back, squat below parallel."),
    ("front-squat", "Front Squat", "strength", "barbell", "advanced", "quads", "Bar in front rack, squat upright."),
    ("goblet-squat", "Goblet Squat", "strength", "dumbbell", "beginner", "quads", "Hold dumbbell at chest, squat."),
    ("leg-press", "Leg Press", "strength", "machine", "beginner", "quads", "Press platform, control descent."),
    ("lunge", "Walking Lunge", "strength", "dumbbell", "beginner", "quads", "Alternate legs, knee tracks over toe."),
    ("bulgarian-split-squat", "Bulgarian Split Squat", "strength", "dumbbell", "intermediate", "quads", "Rear foot elevated, drop back knee."),
    ("leg-extension", "Leg Extension", "strength", "machine", "beginner", "quads", "Extend knees to lock out."),
    ("leg-curl", "Leg Curl", "strength", "machine", "beginner", "hamstrings", "Curl heels to glutes."),
    ("hip-thrust", "Hip Thrust", "strength", "barbell", "intermediate", "glutes", "Drive hips up, squeeze glutes at top."),
    ("glute-bridge", "Glute Bridge", "strength", "bodyweight", "beginner", "glutes", "Bridge hips off floor."),
    ("standing-calf-raise", "Standing Calf Raise", "strength", "machine", "beginner", "calves", "Full stretch and full extension."),
    ("seated-calf-raise", "Seated Calf Raise", "strength", "machine", "beginner", "calves", "Bent-knee variation for soleus."),
    ("crunch", "Crunch", "strength", "bodyweight", "beginner", "abs", "Curl shoulders off floor."),
    ("hanging-leg-raise", "Hanging Leg Raise", "strength", "bodyweight", "intermediate", "abs", "Raise legs while hanging."),
    ("plank", "Plank", "strength", "bodyweight", "beginner", "abs", "Hold rigid position on forearms."),
    ("russian-twist", "Russian Twist", "strength", "bodyweight", "beginner", "obliques", "Rotate torso side to side, feet up."),
    ("side-plank", "Side Plank", "strength", "bodyweight", "beginner", "obliques", "Hold side position on forearm."),
    ("back-extension", "Back Extension", "strength", "bodyweight", "beginner", "lower_back", "Hyperextend at hip on GHD."),
    ("good-morning", "Good Morning", "strength", "barbell", "intermediate", "lower_back", "Hinge with bar on upper back."),
    ("kettlebell-swing", "Kettlebell Swing", "plyo", "kettlebell", "intermediate", "glutes", "Hip hinge, snap hips to swing to eye level."),
    ("box-jump", "Box Jump", "plyo", "bodyweight", "intermediate", "quads", "Explode up onto box, step down."),
    ("burpee", "Burpee", "plyo", "bodyweight", "beginner", "cardio", "Down, plank, jump up."),
    ("mountain-climber", "Mountain Climber", "plyo", "bodyweight", "beginner", "cardio", "Drive knees in from plank."),
    ("jump-rope", "Jump Rope", "cardio", "bodyweight", "beginner", "cardio", "Steady bounce, wrist rotation."),
    ("rowing-erg", "Rowing Erg", "cardio", "machine", "beginner", "cardio", "Legs, hips, arms; reverse in return."),
    ("run", "Run", "cardio", "bodyweight", "beginner", "cardio", "Steady effort run."),
    ("bike-erg", "Bike Erg", "cardio", "machine", "beginner", "cardio", "Pedal steady, adjust resistance."),
    ("assault-bike", "Assault Bike Sprint", "cardio", "machine", "intermediate", "cardio", "All-out effort intervals."),
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
    for slug, name, category, equipment, difficulty, muscle_slug, instructions in EXERCISES:
        muscle = await db.muscles.find_one({"slug": muscle_slug})
        await db.exercises.update_one(
            {"slug": slug},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "slug": slug,
                "name": name,
                "category": category,
                "equipment": equipment,
                "difficulty": difficulty,
                "primary_muscle_slug": muscle_slug,
                "primary_muscle_id": muscle["id"] if muscle else None,
                "instructions": instructions,
                "created_at": now,
            }},
            upsert=True,
        )

    print(f"Seeded {await db.muscles.count_documents({})} muscles, {await db.exercises.count_documents({})} exercises.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
