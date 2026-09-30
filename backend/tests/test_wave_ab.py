"""Wave A/B: previous sets, rest, repeat/start-day, only_me, home today.

Requests go through the ASGI app against a throwaway Mongo database.
"""
import asyncio
import os
import uuid

from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "wave-ab-test-secret-0123456789abcdef")

import moderation  # noqa: E402
import notifications  # noqa: E402
import server  # noqa: E402
import social_graph  # noqa: E402
from routers import program, search, social  # noqa: E402


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient(
            "mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000,
        )
        database = client[f"ironflow_wave_ab_{uuid.uuid4().hex}"]
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()

    asyncio.run(run())


def account(uid):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete"}


def bind(monkeypatch, database):
    monkeypatch.setattr(server, "db", database)
    monkeypatch.setattr(social, "db", database)
    monkeypatch.setattr(social_graph, "db", database)
    monkeypatch.setattr(notifications, "db", database)
    monkeypatch.setattr(moderation, "db", database)
    monkeypatch.setattr(program, "db", database)
    monkeypatch.setattr(search, "db", database)


def auth(uid):
    return {"Authorization": f"Bearer {server.make_token(uid)}"}


def test_previous_sets_come_from_finished_workouts_and_keep_rest_sec(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_many([account("alice"), account("bob")])
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            too_high = await client.post(
                "/api/workouts", headers=auth("alice"), json={"title": "bad rest"},
            )
            assert too_high.status_code == 201, too_high.text
            rejected = await client.post(
                f"/api/workouts/{too_high.json()['id']}/sets",
                headers=auth("alice"),
                json={"exercise_id": "squat", "set_index": 1, "reps": 5, "weight_kg": 100, "rest_sec": 601},
            )
            assert rejected.status_code == 422
            assert await database.workout_sets.count_documents({}) == 0

            opened = await client.post(
                "/api/workouts", headers=auth("alice"), json={"title": "Squat day"},
            )
            workout_id = opened.json()["id"]
            logged = await client.post(
                f"/api/workouts/{workout_id}/sets",
                headers=auth("alice"),
                json={"exercise_id": "squat", "set_index": 1, "reps": 5, "weight_kg": 100, "rest_sec": 90},
            )
            assert logged.status_code == 201, logged.text
            assert logged.json()["rest_sec"] == 90
            stored = await database.workout_sets.find_one({"id": logged.json()["id"]})
            assert stored["rest_sec"] == 90

            # An open session is not history yet.
            early = await client.get("/api/exercises/squat/previous-sets", headers=auth("alice"))
            assert early.status_code == 200
            assert early.json() == {"exercise_id": "squat", "sessions": []}

            finished = await client.post(f"/api/workouts/{workout_id}/finish", headers=auth("alice"))
            assert finished.status_code == 200
            assert finished.json()["ended_at"] is not None
            assert finished.json()["duration_sec"] is not None

            # A second finished session is the one autofill should show first.
            later = await client.post("/api/workouts", headers=auth("alice"), json={"title": "Squat day 2"})
            later_id = later.json()["id"]
            await client.post(
                f"/api/workouts/{later_id}/sets",
                headers=auth("alice"),
                json={"exercise_id": "squat", "set_index": 1, "reps": 3, "weight_kg": 110, "rest_sec": 180},
            )
            await client.post(
                f"/api/workouts/{later_id}/sets",
                headers=auth("alice"),
                json={"exercise_id": "squat", "set_index": 2, "reps": 3, "weight_kg": 110, "rest_sec": 0},
            )
            await client.post(f"/api/workouts/{later_id}/finish", headers=auth("alice"))

            # Someone else's log must not leak into autofill.
            theirs = await client.post("/api/workouts", headers=auth("bob"), json={"title": "Bob"})
            await client.post(
                f"/api/workouts/{theirs.json()['id']}/sets",
                headers=auth("bob"),
                json={"exercise_id": "squat", "set_index": 1, "reps": 1, "weight_kg": 40, "rest_sec": 60},
            )
            await client.post(f"/api/workouts/{theirs.json()['id']}/finish", headers=auth("bob"))

            latest = await client.get("/api/exercises/squat/previous-sets", headers=auth("alice"))
            assert latest.status_code == 200
            body = latest.json()
            assert body["exercise_id"] == "squat"
            assert len(body["sessions"]) == 1
            assert body["sessions"][0]["workout_id"] == later_id
            assert [row["rest_sec"] for row in body["sessions"][0]["sets"]] == [180, 0]
            assert body["sessions"][0]["ended_at"] is not None

            both = await client.get(
                "/api/exercises/squat/previous-sets?limit=2", headers=auth("alice"),
            )
            assert [row["workout_id"] for row in both.json()["sessions"]] == [later_id, workout_id]

            hidden = await client.get("/api/exercises/squat/previous-sets", headers=auth("bob"))
            assert [row["workout_id"] for row in hidden.json()["sessions"]] == [theirs.json()["id"]]

            # Repeat copies suggestions and does not log them.
            denied = await client.post(
                f"/api/workouts/{too_high.json()['id']}/repeat", headers=auth("alice"),
            )
            assert denied.status_code == 409
            repeated = await client.post(f"/api/workouts/{later_id}/repeat", headers=auth("alice"))
            assert repeated.status_code == 201, repeated.text
            copy = repeated.json()
            assert copy["id"] != later_id
            assert copy["ended_at"] is None
            assert copy["duration_sec"] is None
            assert copy["source"] == {"kind": "repeat", "workout_id": later_id}
            assert [row["rest_sec"] for row in copy["suggestions"]] == [180, 0]
            assert await database.workout_sets.count_documents({"workout_id": copy["id"]}) == 0
            still_open = await client.get(
                "/api/exercises/squat/previous-sets", headers=auth("alice"),
            )
            assert still_open.json()["sessions"][0]["workout_id"] == later_id

    run_isolated(scenario)


def test_start_day_reuses_the_program_and_home_shows_it(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_one(account("alice"))
        moment = server.now()
        await database.programs.insert_one({
            "id": "prog-1",
            "user_id": "alice",
            "status": "active",
            "created_at": moment,
            "adjustments": [],
            "program": {"weeks": [{
                "week_index": 1,
                "phase": "accumulation",
                "days": [{
                    "day_index": 1,
                    "focus": "push",
                    "exercises": [{
                        "exercise_slug": "bench-press",
                        "name": "Bench Press",
                        "sets": 4,
                        "reps_min": 6,
                        "reps_max": 8,
                        "target_rpe": 8,
                        "rest_sec": 150,
                        "load_pct_1rm": 72.5,
                    }],
                }],
            }]},
        })
        await database.exercises.insert_one({
            "id": "ex-bench", "slug": "bench-press", "name": "Bench Press",
        })
        await database.communities.insert_one({
            "id": "c-1", "name": "Iron Club", "status": "active",
        })
        await database.community_members.insert_one({
            "id": "m-alice", "community_id": "c-1", "user_id": "alice",
            "status": "active", "joined_at": moment,
        })
        await database.channels.insert_one({
            "id": "ch-1", "community_id": "c-1", "name": "general", "status": "active",
        })
        await database.messages.insert_many([
            {
                "id": "msg-1", "channel_id": "ch-1", "author_id": "bob",
                "content": "Who is training tonight?", "status": "active", "created_at": moment,
            },
            {
                "id": "msg-2", "channel_id": "ch-1", "author_id": "bob",
                "content": "Checked in", "status": "active", "created_at": moment,
                "checkin_day": moment.date().isoformat(),
            },
        ])
        await database.channel_reads.insert_one({
            "id": "read-1", "channel_id": "ch-1", "user_id": "alice",
            "last_read_at": moment.replace(year=moment.year - 1),
        })
        await database.live_sessions.insert_one({
            "id": "live-1", "channel_id": "ch-1", "community_id": "c-1",
            "title": "Evening lift", "status": "scheduled", "starts_at": moment,
        })

        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            missing = await client.post(
                "/api/programs/prog-1/start-day",
                headers=auth("alice"),
                json={"week_index": 9, "day_index": 1},
            )
            assert missing.status_code == 404

            started = await client.post(
                "/api/programs/prog-1/start-day", headers=auth("alice"), json={},
            )
            assert started.status_code == 201, started.text
            workout = started.json()
            assert workout["ended_at"] is None
            assert workout["duration_sec"] is None
            assert workout["planned_exercise_slugs"] == ["bench-press"]
            assert workout["source"]["kind"] == "program_day"
            assert workout["source"]["exercises"][0]["rest_sec"] == 150
            assert workout["planned_exercises"][0]["slug"] == "bench-press"
            assert await database.workout_sets.count_documents({"workout_id": workout["id"]}) == 0

            home = await client.get("/api/home/today", headers=auth("alice"))
            assert home.status_code == 200, home.text
            payload = home.json()
            assert payload["training"]["streak_days"] >= 1
            assert payload["active_workout"]["id"] == workout["id"]
            assert payload["next_session"]["program_id"] == "prog-1"
            assert payload["next_session"]["focus"] == "push"
            assert payload["next_session"]["week_index"] == 1
            assert payload["next_session"]["exercises"][0]["rest_sec"] == 150
            assert payload["clubs"][0]["community_id"] == "c-1"
            assert payload["clubs"][0]["unread_count"] == 2
            assert payload["clubs"][0]["checkins_today"] == 1
            assert {item["type"] for item in payload["clubs"][0]["activity"]} >= {"message", "checkin", "live"}

            dashboard = await client.get("/api/dashboard", headers=auth("alice"))
            assert dashboard.json()["next_session"]["program_id"] == "prog-1"
            assert dashboard.json()["active_workout"]["id"] == workout["id"]

    run_isolated(scenario)


def test_only_me_is_author_only_on_posts_and_stories(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_many([account("alice"), account("bob")])
        await database.follows.insert_one({
            "id": "f-1", "follower_id": "bob", "followee_id": "alice",
            "status": "active", "created_at": server.now(),
        })
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            club = await client.post(
                "/api/posts", headers=auth("alice"),
                json={"content": "nope", "audience": "club"},
            )
            assert club.status_code == 422

            community = await client.post(
                "/api/posts", headers=auth("alice"),
                json={"content": "nope", "community_id": "c-1", "audience": "only_me"},
            )
            assert community.status_code == 422

            public = await client.post(
                "/api/posts", headers=auth("alice"),
                json={"content": "publicwave #publicwave", "audience": "public"},
            )
            friends = await client.post(
                "/api/posts", headers=auth("alice"),
                json={"content": "friendswave", "audience": "friends"},
            )
            private = await client.post(
                "/api/posts", headers=auth("alice"),
                json={"content": "onlymewave #onlymewave", "audience": "only_me"},
            )
            assert private.status_code == 201, private.text
            assert private.json()["audience"] == "only_me"
            private_id = private.json()["id"]

            bob_public = [row["id"] for row in (await client.get("/api/feed?scope=all", headers=auth("bob"))).json()]
            assert public.json()["id"] in bob_public
            assert friends.json()["id"] not in bob_public
            assert private_id not in bob_public

            bob_friends = [row["id"] for row in (await client.get("/api/feed?scope=friends", headers=auth("bob"))).json()]
            assert public.json()["id"] in bob_friends
            assert friends.json()["id"] in bob_friends
            assert private_id not in bob_friends

            alice_friends = [row["id"] for row in (await client.get("/api/feed?scope=friends", headers=auth("alice"))).json()]
            assert private_id not in alice_friends
            mine = [row["id"] for row in (await client.get("/api/feed?scope=mine", headers=auth("alice"))).json()]
            assert private_id in mine

            assert (await client.get(f"/api/posts/{private_id}", headers=auth("bob"))).status_code == 404
            seen = await client.get(f"/api/posts/{private_id}", headers=auth("alice"))
            assert seen.status_code == 200
            assert seen.json()["content"] == "onlymewave #onlymewave"

            for viewer in ("alice", "bob"):
                found = await client.get(
                    "/api/search?q=onlymewave&type=posts", headers=auth(viewer),
                )
                assert found.status_code == 200, found.text
                assert found.json()["results"] == []
                tags = {row["tag"] for row in (await client.get("/api/tags/trending", headers=auth(viewer))).json()}
                assert "onlymewave" not in tags
                assert "publicwave" in tags

            opened = await client.post(
                "/api/workouts", headers=auth("alice"), json={"title": "Story day"},
            )
            workout_id = opened.json()["id"]
            await client.post(f"/api/workouts/{workout_id}/finish", headers=auth("alice"))
            story = await client.post(
                "/api/stories", headers=auth("alice"),
                json={"workout_id": workout_id, "audience": "only_me", "caption": "just me"},
            )
            assert story.status_code == 201, story.text
            assert story.json()["audience"] == "only_me"
            public_story = await client.post(
                "/api/stories", headers=auth("alice"),
                json={"workout_id": workout_id, "audience": "public", "caption": "hello"},
            )
            bob_stories = await client.get("/api/users/alice/stories", headers=auth("bob"))
            assert [row["id"] for row in bob_stories.json()] == [public_story.json()["id"]]
            alice_stories = await client.get("/api/users/alice/stories", headers=auth("alice"))
            assert story.json()["id"] in [row["id"] for row in alice_stories.json()]
            bob_tray = await client.get("/api/stories/feed", headers=auth("bob"))
            bob_ids = [item["id"] for group in bob_tray.json() for item in group["stories"]]
            assert story.json()["id"] not in bob_ids
            assert public_story.json()["id"] in bob_ids

            edited = await client.patch(
                f"/api/posts/{public.json()['id']}",
                headers=auth("alice"),
                json={"content": "publicwave #publicwave", "audience": "only_me"},
            )
            assert edited.status_code == 200, edited.text
            assert edited.json()["audience"] == "only_me"
            assert (await client.get(f"/api/posts/{public.json()['id']}", headers=auth("bob"))).status_code == 404

    run_isolated(scenario)


def test_home_today_without_a_program_or_club_stays_empty(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_one(account("alice"))
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            home = await client.get("/api/home/today", headers=auth("alice"))
            assert home.status_code == 200
            assert home.json()["next_session"] is None
            assert home.json()["clubs"] == []
            assert home.json()["active_workout"] is None
            assert home.json()["training"]["streak_days"] == 0

    run_isolated(scenario)
