"""Patch secondary muscle slugs onto key exercises for heatmap accuracy."""
import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent.parent / ".env")

PATCHES = {
    "barbell-bench-press":    ["triceps", "shoulders"],
    "incline-bench-press":    ["triceps", "shoulders"],
    "dumbbell-fly":           ["shoulders"],
    "push-up":                ["triceps", "shoulders", "abs"],
    "dips":                   ["chest", "shoulders"],
    "pull-up":                ["biceps", "back", "forearms"],
    "chin-up":                ["lats", "back", "forearms"],
    "lat-pulldown":           ["biceps", "back"],
    "bent-over-row":          ["biceps", "lats", "forearms"],
    "seated-cable-row":       ["biceps", "lats"],
    "deadlift":               ["glutes", "hamstrings", "lower_back", "forearms"],
    "romanian-deadlift":      ["glutes", "lower_back"],
    "overhead-press":         ["triceps", "abs"],
    "dumbbell-shoulder-press":["triceps"],
    "lateral-raise":          [],
    "face-pull":              ["back"],
    "barbell-curl":           ["forearms"],
    "dumbbell-curl":          ["forearms"],
    "hammer-curl":            ["forearms"],
    "tricep-pushdown":        [],
    "skull-crusher":          [],
    "back-squat":             ["glutes", "hamstrings", "abs", "lower_back"],
    "front-squat":            ["glutes", "abs"],
    "goblet-squat":           ["glutes", "abs"],
    "leg-press":              ["glutes", "hamstrings"],
    "lunge":                  ["glutes", "hamstrings"],
    "bulgarian-split-squat":  ["glutes", "hamstrings"],
    "leg-curl":               ["glutes"],
    "hip-thrust":             ["hamstrings"],
    "glute-bridge":           ["hamstrings"],
    "hanging-leg-raise":      ["obliques", "forearms"],
    "plank":                  ["obliques", "shoulders"],
    "russian-twist":          ["abs"],
    "side-plank":             ["abs"],
    "good-morning":           ["hamstrings", "glutes"],
    "kettlebell-swing":       ["hamstrings", "lower_back", "cardio"],
    "box-jump":               ["glutes", "calves", "cardio"],
    "burpee":                 ["chest", "quads", "shoulders"],
    "mountain-climber":       ["abs", "shoulders"],
    "rowing-erg":             ["back", "quads", "biceps"],
    "run":                    ["quads", "hamstrings", "glutes", "calves"],
    "bike-erg":               ["quads", "hamstrings"],
    "assault-bike":           ["quads", "hamstrings", "shoulders"],
}


async def main() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "ironflow")]
    for slug, secs in PATCHES.items():
        await db.exercises.update_one({"slug": slug}, {"$set": {"secondary_muscle_slugs": secs}})
    print(f"Patched {len(PATCHES)} exercises.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
