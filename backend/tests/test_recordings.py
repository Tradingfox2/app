"""Phone recorder: finished workouts, server-side distance, owner-only routes."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "recordings-test-secret-0123456789abcdef")

import server  # noqa: E402
from routers.recordings import haversine_m  # noqa: E402


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient(
            "mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000,
        )
        database = client[f"ironflow_recordings_{uuid.uuid4().hex}"]
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


def payload(kind="run", profile="fine", gap=10, jump=0.00045, accuracy=8, steps=None, client_id="client-run-1"):
    started = datetime.now(timezone.utc) - timedelta(minutes=3)
    ended = started + timedelta(seconds=80)
    first = started + timedelta(seconds=5)
    second = first + timedelta(seconds=gap)
    return {
        "client_id": client_id,
        "kind": kind,
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "moving_sec": 60,
        "steps": steps,
        "elevation_gain_m": None,
        "gps_profile": profile,
        "route": {
            "segments": [[
                {"lat": 48.8566, "lng": 2.3522, "t": first.isoformat(), "acc": accuracy},
                {"lat": 48.8566 + jump, "lng": 2.3522, "t": second.isoformat(), "acc": accuracy},
            ]],
        },
    }, 48.8566, 48.8566 + jump


def test_a_run_stores_measured_distance_and_not_an_open_workout(monkeypatch):
    async def scenario(database):
        monkeypatch.setattr(server, "db", database)
        await database.users.insert_one(account("alice"))
        body, lat1, lat2 = payload()
        expected = haversine_m(lat1, 2.3522, lat2, 2.3522)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            saved = await client.post("/api/workouts/recorded", headers=auth("alice"), json=body)
            assert saved.status_code == 201, saved.text
            doc = saved.json()
            assert doc["ended_at"] is not None
            assert doc["duration_sec"] == 60
            assert doc["source"] == "phone_recorder"
            assert doc["activity"]["kind"] == "run"
            assert doc["activity"]["steps"] is None
            assert doc["activity"]["has_route"] is True
            assert abs(doc["activity"]["distance_m"] - expected) < 1
            assert "distance_m" not in body or body.get("distance_m") is None
            again = await client.post("/api/workouts/recorded", headers=auth("alice"), json=body)
            assert again.status_code == 200, again.text
            assert again.json()["id"] == doc["id"]
            assert await database.workouts.count_documents({}) == 1
            assert await database.workouts.count_documents({"ended_at": None}) == 0
            assert await database.workout_sets.count_documents({}) == 0
            assert await database.wearable_metrics.count_documents({}) == 0
            route = await client.get(f"/api/workouts/{doc['id']}/route", headers=auth("alice"))
            assert route.status_code == 200, route.text
            segments = route.json()["segments"]
            assert len(segments) == 1
            assert len(segments[0]) == 2

            sneaky = dict(body)
            sneaky["distance_m"] = 99999
            sneaky["client_id"] = "client-run-2"
            rejected = await client.post("/api/workouts/recorded", headers=auth("alice"), json=sneaky)
            assert rejected.status_code == 422

    run_isolated(scenario)


def test_a_gap_or_a_single_point_does_not_invent_distance(monkeypatch):
    async def scenario(database):
        monkeypatch.setattr(server, "db", database)
        await database.users.insert_one(account("alice"))
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            gap, _, _ = payload(gap=30, client_id="client-gap")
            saved = await client.post("/api/workouts/recorded", headers=auth("alice"), json=gap)
            assert saved.status_code == 201, saved.text
            assert saved.json()["activity"]["distance_m"] is None
            assert saved.json()["activity"]["has_route"] is False
            missing = await client.get(
                f"/api/workouts/{saved.json()['id']}/route", headers=auth("alice"),
            )
            assert missing.status_code == 404

            jump, _, _ = payload(kind="walk", profile="fine", gap=5, jump=0.02, client_id="client-jump")
            dropped = await client.post("/api/workouts/recorded", headers=auth("alice"), json=jump)
            assert dropped.status_code == 201, dropped.text
            assert dropped.json()["activity"]["distance_m"] is None

            started = datetime.now(timezone.utc) - timedelta(minutes=2)
            alone = {
                "client_id": "client-one",
                "kind": "walk",
                "started_at": started.isoformat(),
                "ended_at": (started + timedelta(seconds=30)).isoformat(),
                "moving_sec": 20,
                "steps": 0,
                "gps_profile": "fine",
                "route": {"segments": [[
                    {"lat": 48.85, "lng": 2.35, "t": (started + timedelta(seconds=2)).isoformat(), "acc": 5},
                ]]},
            }
            zero_steps = await client.post("/api/workouts/recorded", headers=auth("alice"), json=alone)
            assert zero_steps.status_code == 422

            alone["steps"] = None
            alone["client_id"] = "client-one-b"
            one = await client.post("/api/workouts/recorded", headers=auth("alice"), json=alone)
            assert one.status_code == 201, one.text
            assert one.json()["activity"]["distance_m"] is None
            assert one.json()["activity"]["steps"] is None

    run_isolated(scenario)


def test_hike_uses_coarse_gps_and_the_route_stays_with_the_owner(monkeypatch):
    async def scenario(database):
        monkeypatch.setattr(server, "db", database)
        await database.users.insert_many([account("alice"), account("bob"), account("cara")])
        await database.coach_relationships.insert_one(
            {"coach_id": "bob", "client_id": "alice", "status": "active"},
        )
        body, lat1, lat2 = payload(
            kind="hike", profile="coarse", gap=15, jump=0.00045, accuracy=40, steps=1200,
            client_id="client-hike",
        )
        expected = haversine_m(lat1, 2.3522, lat2, 2.3522)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            saved = await client.post("/api/workouts/recorded", headers=auth("alice"), json=body)
            assert saved.status_code == 201, saved.text
            doc = saved.json()
            assert doc["activity"]["gps_profile"] == "coarse"
            assert doc["activity"]["steps"] == 1200
            assert abs(doc["activity"]["distance_m"] - expected) < 1
            workout_id = doc["id"]

            fine = dict(body)
            fine["gps_profile"] = "fine"
            fine["client_id"] = "client-hike-fine"
            mismatch = await client.post("/api/workouts/recorded", headers=auth("alice"), json=fine)
            assert mismatch.status_code == 422

            blurry, _, _ = payload(
                kind="walk", profile="fine", gap=10, accuracy=40, client_id="client-blur",
            )
            blurred = await client.post("/api/workouts/recorded", headers=auth("alice"), json=blurry)
            assert blurred.status_code == 201, blurred.text
            assert blurred.json()["activity"]["distance_m"] is None

            owner = await client.get(f"/api/workouts/{workout_id}/route", headers=auth("alice"))
            assert owner.status_code == 200
            coach_workout = await client.get(f"/api/workouts/{workout_id}", headers=auth("bob"))
            assert coach_workout.status_code == 200, coach_workout.text
            coach_route = await client.get(f"/api/workouts/{workout_id}/route", headers=auth("bob"))
            assert coach_route.status_code == 403
            stranger = await client.get(f"/api/workouts/{workout_id}/route", headers=auth("cara"))
            assert stranger.status_code == 403

    run_isolated(scenario)
