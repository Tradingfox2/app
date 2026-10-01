"""POST /api/coach/chat stores both turns and calls llm_text on the fast task."""
import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "coach-chat-test-secret-0123456789abcdef")

import ratelimit  # noqa: E402
import server  # noqa: E402
from ai import LLMError  # noqa: E402
from routers import coach_chat, program  # noqa: E402

REPLY = "Gardez la séance facile aujourd'hui."


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000)
        database = client[f"ironflow_coach_chat_{uuid.uuid4().hex}"]
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()
    asyncio.run(run())


def bind(monkeypatch, database):
    monkeypatch.setattr(server, "db", database)
    monkeypatch.setattr(program, "db", database)
    monkeypatch.setattr(ratelimit, "ENABLED", True)


def auth(uid):
    return {"Authorization": f"Bearer {server.make_token(uid)}"}


async def athlete(database, uid, locale):
    await database.users.insert_one({
        "id": uid, "email": f"{uid}@example.invalid", "full_name": uid,
        "role": "athlete", "preferred_locale": locale,
    })


def test_chat_uses_athlete_context_and_stores_plain_text(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        moment = datetime.now(timezone.utc)
        await athlete(database, "ada", "fr")
        await athlete(database, "beau", "en")
        await database.wearable_metrics.insert_many([
            {"user_id": "ada", "metric": metric, "value": value, "recorded_at": moment}
            for metric, value in (("hrv", 40), ("sleep_hours", 5), ("recovery", 40))
        ])
        await database.workouts.insert_one({"id": "w1", "user_id": "ada", "started_at": moment})
        await database.workout_sets.insert_one({"workout_id": "w1", "exercise_id": "ex1", "weight_kg": 100, "reps": 5})
        await database.exercises.insert_one({"id": "ex1", "name": "Back Squat"})
        await database.biomarkers.insert_many([
            {"user_id": "ada", "marker": "Ferritin", "value": 40, "unit": "ng/mL", "measured_at": moment},
            {"user_id": "beau", "marker": "SecretMarker", "value": 1, "unit": "x", "measured_at": moment},
        ])
        await database.programs.insert_one({
            "id": "p1", "user_id": "ada", "status": "active", "created_at": moment,
            "params": {"goal": "strength", "level": "intermediate", "days_per_week": 4},
            "program": {"weeks": [{"week_index": 1, "phase": "accumulation", "days": [{
                "day_index": 1, "focus": "legs",
                "exercises": [{"name": "Front Squat", "exercise_slug": "front-squat"}],
            }]}]},
        })
        await database.coach_conversations.insert_many([
            {"id": f"old-{i}", "user_id": "ada", "role": "user" if i % 2 == 0 else "assistant",
             "content": f"turn-{i:02d}", "created_at": moment - timedelta(hours=1) + timedelta(seconds=i)}
            for i in range(21)
        ])
        await database.coach_conversations.insert_one(
            {"id": "other", "user_id": "beau", "role": "user", "content": "secret-other", "created_at": moment},
        )
        calls = []

        async def fake_llm_text(system, user_text, **kwargs):
            calls.append({"system": system, "user_text": user_text, **kwargs})
            return REPLY

        monkeypatch.setattr(coach_chat, "llm_text", fake_llm_text)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.post("/api/coach/chat", headers=auth("ada"), json={"message": "   "})).status_code == 422
            assert calls == []
            sent = await client.post("/api/coach/chat", headers=auth("ada"), json={"message": "  How should I train?  "})
            assert sent.status_code == 200
            assert sent.headers["content-type"].startswith("text/plain")
            assert sent.text == REPLY and "claude" not in sent.text.lower() and "{" not in sent.text
            history = await client.get("/api/coach/chat", headers=auth("ada"))
            other = await client.get("/api/coach/chat", headers=auth("beau"))

        assert set(calls[0]) == {"system", "user_text", "task"} and calls[0]["task"] == "fast"
        assert "entirely in French" in calls[0]["system"]
        prompt = calls[0]["user_text"]
        for needle in ("RECOVERY (high)", "Back Squat", "Ferritin", "goal strength", "Front Squat", "turn-01", "turn-20", "How should I train?"):
            assert needle in prompt
        assert "turn-00" not in prompt and "secret-other" not in prompt and "SecretMarker" not in prompt
        stored = [doc async for doc in database.coach_conversations.find({"user_id": "ada"}).sort("created_at", 1)]
        assert stored[-2]["role"] == "user" and stored[-2]["content"] == "How should I train?"
        assert stored[-1]["role"] == "assistant" and stored[-1]["content"] == REPLY
        assert stored[-1]["created_at"] > stored[-2]["created_at"]
        assert "model" not in stored[-1] and "provider" not in stored[-1]
        contents = [row["content"] for row in history.json()]
        assert history.status_code == 200 and "turn-00" not in contents and "turn-02" not in contents
        assert "turn-03" in contents and contents[-1] == REPLY
        assert all(set(row) == {"role", "content"} for row in history.json())
        assert [row["content"] for row in other.json()] == ["secret-other"]

    run_isolated(scenario)


def test_the_forty_first_message_is_refused_and_a_failure_is_not_stored(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await athlete(database, "ada", "en")
        window = 86400
        start = int(time.time() // window) * window
        await database.rate_limits.insert_one({
            "key": f"coach_chat:ada:{start}", "count": 40,
            "expires_at": datetime.fromtimestamp(start + window, timezone.utc),
        })

        async def fake_llm_text(system, user_text, **kwargs):
            raise LLMError("provider claude-haiku-4-5 failed")

        monkeypatch.setattr(coach_chat, "llm_text", fake_llm_text)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            blocked = await client.post("/api/coach/chat", headers=auth("ada"), json={"message": "one more"})
            assert blocked.status_code == 429
            await database.rate_limits.delete_many({})
            failed = await client.post("/api/coach/chat", headers=auth("ada"), json={"message": "hello"})
        assert failed.status_code == 503
        assert "claude" not in failed.text.lower() and "haiku" not in failed.text.lower()
        assert await database.coach_conversations.count_documents({}) == 0

    run_isolated(scenario)
