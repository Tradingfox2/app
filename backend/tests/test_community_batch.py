"""Workout sharing, rate limiting, and realtime for message mutations."""
import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import notifications  # noqa: E402
import ratelimit  # noqa: E402
import server  # noqa: E402,F401
import social_graph  # noqa: E402
from routers import community, social  # noqa: E402
from tests.test_community_permissions import account, run_isolated, seed  # noqa: E402


async def seed_social(db, monkeypatch):
    await seed(db, monkeypatch)  # patches community, staff and server db
    for module in (social, notifications, social_graph):
        monkeypatch.setattr(module, "db", db)


async def finished_workout(db, wid, owner, ended=True):
    await db.workouts.insert_one({
        "id": wid, "user_id": owner, "title": "Leg day", "duration_sec": 3600,
        "perceived_effort": 8, "started_at": server.now(),
        "ended_at": server.now() if ended else None, "created_at": server.now(),
    })
    await db.exercises.insert_many([
        {"id": f"{wid}-ex1", "slug": "squat", "name": "Back Squat"},
        {"id": f"{wid}-ex2", "slug": "rdl", "name": "Romanian Deadlift"},
    ])
    await db.workout_sets.insert_many([
        {"workout_id": wid, "exercise_id": f"{wid}-ex1", "set_index": 1, "reps": 5, "weight_kg": 100},
        {"workout_id": wid, "exercise_id": f"{wid}-ex1", "set_index": 2, "reps": 5, "weight_kg": 100},
        {"workout_id": wid, "exercise_id": f"{wid}-ex2", "set_index": 3, "reps": 8, "weight_kg": 60},
    ])


# --- Sharing a workout ---

def test_sharing_your_finished_workout_snapshots_the_numbers(monkeypatch):
    async def scenario(db):
        await seed_social(db, monkeypatch)
        await finished_workout(db, "w-1", "mem")
        post = await social.create_post(social.PostIn(workout_id="w-1"), account("mem"))
        card = post["workout_summary"]
        assert card["title"] == "Leg day"
        assert card["sets"] == 3
        assert card["tonnage_kg"] == 5 * 100 * 2 + 8 * 60  # 1480
        assert card["exercises"] == ["Back Squat", "Romanian Deadlift"]

        # A snapshot: editing the log afterwards does not change the card.
        await db.workout_sets.delete_many({"workout_id": "w-1"})
        stored = await db.posts.find_one({"id": post["id"]})
        assert stored["workout_summary"]["sets"] == 3
    run_isolated(scenario)


def test_you_cannot_share_someone_elses_workout(monkeypatch):
    """Regression: workout_id was stored unvalidated, including other users' ids."""
    async def scenario(db):
        await seed_social(db, monkeypatch)
        await finished_workout(db, "w-owner", "owner")
        with pytest.raises(HTTPException) as denied:
            await social.create_post(social.PostIn(workout_id="w-owner"), account("mem"))
        assert denied.value.status_code == 404  # never confirm someone else's workout exists
    run_isolated(scenario)


def test_a_coach_cannot_publish_a_clients_workout(monkeypatch):
    async def scenario(db):
        await seed_social(db, monkeypatch)
        await finished_workout(db, "w-client", "mem")
        # An active coaching relationship lets the coach *read* the session...
        await db.coach_relationships.insert_one(
            {"id": "rel", "coach_id": "mod", "client_id": "mem", "status": "active"})
        # ...but publishing it is the athlete's decision alone.
        with pytest.raises(HTTPException) as denied:
            await social.create_post(social.PostIn(workout_id="w-client"), account("mod"))
        assert denied.value.status_code == 404
    run_isolated(scenario)


def test_an_unfinished_workout_cannot_be_shared(monkeypatch):
    async def scenario(db):
        await seed_social(db, monkeypatch)
        await finished_workout(db, "w-open", "mem", ended=False)
        with pytest.raises(HTTPException) as early:
            await social.create_post(social.PostIn(workout_id="w-open"), account("mem"))
        assert early.value.status_code == 422
    run_isolated(scenario)


def test_an_empty_post_is_still_refused(monkeypatch):
    async def scenario(db):
        await seed_social(db, monkeypatch)
        with pytest.raises(HTTPException) as empty:
            await social.create_post(social.PostIn(), account("mem"))
        assert empty.value.status_code == 422
    run_isolated(scenario)


# --- Rate limiting ---

def test_the_request_after_the_limit_is_refused_with_retry_after(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(ratelimit, "ENABLED", True)
        monkeypatch.setitem(ratelimit.LIMITS, "post", (3, 60))
        for _ in range(3):
            await ratelimit.hit("post", "u-1")
        with pytest.raises(HTTPException) as flooded:
            await ratelimit.hit("post", "u-1")
        assert flooded.value.status_code == 429
        assert int(flooded.value.headers["Retry-After"]) >= 1
    run_isolated(scenario)


def test_limits_are_per_subject_and_per_action(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(ratelimit, "ENABLED", True)
        monkeypatch.setitem(ratelimit.LIMITS, "post", (1, 60))
        monkeypatch.setitem(ratelimit.LIMITS, "like", (1, 60))
        await ratelimit.hit("post", "u-1")
        await ratelimit.hit("post", "u-2")   # another person has their own quota
        await ratelimit.hit("like", "u-1")   # another action has its own quota
        with pytest.raises(HTTPException):
            await ratelimit.hit("post", "u-1")
    run_isolated(scenario)


def test_a_new_window_starts_a_fresh_count(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(ratelimit, "ENABLED", True)
        monkeypatch.setitem(ratelimit.LIMITS, "post", (1, 60))
        clock = {"t": 1_000_000.0}
        monkeypatch.setattr(ratelimit.time, "time", lambda: clock["t"])
        await ratelimit.hit("post", "u-1")
        with pytest.raises(HTTPException):
            await ratelimit.hit("post", "u-1")
        clock["t"] += 60
        await ratelimit.hit("post", "u-1")  # next window: allowed again
    run_isolated(scenario)


def test_the_kill_switch_disables_every_limit(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(ratelimit, "ENABLED", False)
        monkeypatch.setitem(ratelimit.LIMITS, "post", (1, 60))
        for _ in range(5):
            await ratelimit.hit("post", "u-1")
        assert await db.rate_limits.count_documents({}) == 0
    run_isolated(scenario)


def test_endpoints_actually_enforce_the_limit(monkeypatch):
    """The limiter is only worth anything if the write paths call it."""
    async def scenario(db):
        await seed_social(db, monkeypatch)
        monkeypatch.setattr(ratelimit, "ENABLED", True)
        monkeypatch.setitem(ratelimit.LIMITS, "message", (2, 60))
        for text in ("one", "two"):
            await community.create_message("ch-1", community.MessageIn(content=text), account("mem"))
        with pytest.raises(HTTPException) as flooded:
            await community.create_message("ch-1", community.MessageIn(content="three"), account("mem"))
        assert flooded.value.status_code == 429
    run_isolated(scenario)


# --- Realtime for mutations ---

def capture(monkeypatch):
    sent = []

    async def fake_publish(channel, data):
        sent.append((channel, data))

    monkeypatch.setattr(community.realtime, "publish", fake_publish)
    return sent


def test_every_message_mutation_is_broadcast(monkeypatch):
    async def scenario(db):
        await seed_social(db, monkeypatch)
        mem, mod = account("mem"), account("mod")
        message = await community.create_message("ch-1", community.MessageIn(content="hi"), mem)
        sent = capture(monkeypatch)

        await community.add_reaction(message["id"], community.ReactionIn(emoji="🔥"), mem)
        await community.edit_message(message["id"], community.MessageEditIn(content="hello"), mem)
        await community.pin_message(message["id"], mod)
        await community.unpin_message(message["id"], mod)
        await community.remove_reaction(message["id"], "🔥", mem)
        await community.delete_message(message["id"], mem)

        kinds = [data["type"] for _, data in sent]
        assert kinds == ["message.reactions", "message.updated", "message.pinned",
                         "message.pinned", "message.reactions", "message.deleted"]
        assert all(channel == "channel:ch-1" for channel, _ in sent)
        assert sent[3][1]["pinned_at"] is None
    run_isolated(scenario)


def test_a_delete_event_carries_the_id_and_nothing_else(monkeypatch):
    """A removed message's content must never reach a client after removal."""
    async def scenario(db):
        await seed_social(db, monkeypatch)
        message = await community.create_message(
            "ch-1", community.MessageIn(content="something regrettable"), account("mem"))
        sent = capture(monkeypatch)
        await community.delete_message(message["id"], account("mod"))
        assert sent == [("channel:ch-1", {"type": "message.deleted", "id": message["id"]})]
    run_isolated(scenario)
