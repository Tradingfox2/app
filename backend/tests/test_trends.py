"""Daily trends: gaps stay null, and one athlete cannot see another's rows."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "trends-test-secret-0123456789abcdef")

import server  # noqa: E402
from routers.wearables import METRIC_UNITS  # noqa: E402


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient(
            "mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000,
        )
        database = client[f"ironflow_trends_{uuid.uuid4().hex}"]
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()

    asyncio.run(run())


def account(uid):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete"}


def auth(uid):
    return {"Authorization": f"Bearer {server.make_token(uid)}"}


def by_date(points):
    return {point["date"]: point["value"] for point in points}


def test_trends_keep_gaps_and_ignore_other_athletes(monkeypatch):
    async def scenario(database):
        monkeypatch.setattr(server, "db", database)
        await database.users.insert_many([account("alice"), account("bob")])
        today = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0)
        yesterday = today - timedelta(days=1)
        earlier = today - timedelta(days=2)
        await database.wearable_metrics.insert_many([
            {"id": "r1", "user_id": "alice", "metric": "recovery", "value": 70, "recorded_at": earlier},
            {"id": "r2", "user_id": "alice", "metric": "recovery", "value": 10, "recorded_at": today - timedelta(hours=3)},
            {"id": "r3", "user_id": "alice", "metric": "recovery", "value": 80, "recorded_at": today},
            {"id": "h1", "user_id": "bob", "metric": "hrv", "value": 99, "recorded_at": today},
        ])
        await database.exercises.insert_many([
            {"id": "bench", "primary_muscle_slug": "chest"},
            {"id": "squat", "primary_muscle_slug": "quads"},
        ])
        await database.workouts.insert_many([
            {"id": "w-alice", "user_id": "alice", "started_at": today, "duration_sec": 3600, "perceived_effort": 8},
            {"id": "w-gap", "user_id": "alice", "started_at": yesterday, "duration_sec": None, "perceived_effort": None},
            {"id": "w-bob", "user_id": "bob", "started_at": today, "duration_sec": 600, "perceived_effort": 9},
        ])
        await database.workout_sets.insert_many([
            {"id": "s1", "workout_id": "w-alice", "exercise_id": "bench", "weight_kg": 100, "reps": 5},
            {"id": "s2", "workout_id": "w-alice", "exercise_id": "bench", "weight_kg": 80, "reps": 8},
            {"id": "s3", "workout_id": "w-alice", "exercise_id": "squat", "weight_kg": 20, "reps": 10},
            {"id": "s4", "workout_id": "w-gap", "exercise_id": "bench", "weight_kg": None, "reps": 12},
            {"id": "s5", "workout_id": "w-bob", "exercise_id": "bench", "weight_kg": 500, "reps": 10},
        ])
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            anon = await client.get("/api/trends")
            assert anon.status_code == 401
            rejected = await client.get("/api/trends?days=45", headers=auth("alice"))
            assert rejected.status_code == 422
            saved = await client.get("/api/trends?days=30", headers=auth("alice"))
            assert saved.status_code == 200, saved.text
            body = saved.json()
            assert body["days"] == 30
            assert body["end"] == today.strftime("%Y-%m-%d")
            assert body["units"]["readiness"] == METRIC_UNITS["recovery"]
            assert body["units"]["hrv"] == METRIC_UNITS["hrv"]
            assert body["units"]["resting_hr"] == METRIC_UNITS["resting_hr"]
            assert body["units"]["sleep_hours"] == METRIC_UNITS["sleep_hours"]
            readiness = by_date(body["series"]["readiness"])
            assert len(readiness) == 30
            assert readiness[earlier.strftime("%Y-%m-%d")] == 70
            assert readiness[yesterday.strftime("%Y-%m-%d")] is None
            assert readiness[today.strftime("%Y-%m-%d")] == 80
            assert all(value is None for value in by_date(body["series"]["hrv"]).values())
            assert all(value is None for value in by_date(body["series"]["sleep_hours"]).values())
            load = by_date(body["series"]["load_au"])
            assert load[today.strftime("%Y-%m-%d")] == 480
            assert load[yesterday.strftime("%Y-%m-%d")] is None
            tonnage = by_date(body["series"]["tonnage"])
            assert tonnage[today.strftime("%Y-%m-%d")] == 1340
            assert tonnage[yesterday.strftime("%Y-%m-%d")] is None
            assert by_date(body["muscles"]["chest"])[today.strftime("%Y-%m-%d")] == 1140
            assert by_date(body["muscles"]["quads"])[today.strftime("%Y-%m-%d")] == 200
            bob = await client.get("/api/trends", headers=auth("bob"))
            assert bob.status_code == 200, bob.text
            bob_body = bob.json()
            day = today.strftime("%Y-%m-%d")
            assert by_date(bob_body["series"]["hrv"])[day] == 99
            assert by_date(bob_body["series"]["readiness"])[day] is None
            assert by_date(bob_body["muscles"]["chest"])[day] == 5000
            assert by_date(bob_body["series"]["tonnage"])[day] == 5000
            longer = await client.get("/api/trends?days=90", headers=auth("alice"))
            assert longer.status_code == 200
            assert len(longer.json()["series"]["tonnage"]) == 90

    run_isolated(scenario)
