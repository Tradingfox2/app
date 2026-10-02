"""POST /api/coach/weekly-review stores one Monday review per ISO week.

llm_json is monkeypatched. A week with no finished session does not call it
and does not invent a score.
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "weekly-review-test-secret-0123456789abcdef")

import notifications  # noqa: E402
import server  # noqa: E402
import weekly_review  # noqa: E402
from ai import LLMError  # noqa: E402

MOMENT = datetime(2026, 10, 1, 15, tzinfo=timezone.utc)
REPLY = {
    "headline": "Deux séances, charge en hausse.",
    "wins": "Squat Day et Bench Day sont terminées.",
    "watch": "La charge dépasse la semaine précédente.",
    "next_week_change": "Gardez un jour facile.",
}


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000)
        database = client[f"ironflow_weekly_{uuid.uuid4().hex}"]
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()
    asyncio.run(run())


def bind(monkeypatch, database):
    monkeypatch.setattr(server, "db", database)
    monkeypatch.setattr(notifications, "db", database)
    clock = {"at": MOMENT}
    monkeypatch.setattr(server, "now", lambda: clock["at"])
    return clock


def auth(uid):
    return {"Authorization": f"Bearer {server.make_token(uid)}"}


async def athlete(database, uid, locale="fr"):
    await database.users.insert_one({
        "id": uid, "email": f"{uid}@example.invalid", "full_name": uid,
        "role": "athlete", "preferred_locale": locale,
    })


async def workout(database, uid, when, title, effort, duration):
    await database.workouts.insert_one({
        "id": f"{uid}-{title}", "user_id": uid, "title": title,
        "started_at": when, "ended_at": when,
        "perceived_effort": effort, "duration_sec": duration,
    })


def test_review_uses_real_sessions_and_is_idempotent_per_iso_week(monkeypatch):
    async def scenario(database):
        clock = bind(monkeypatch, database)
        await weekly_review.ensure_indexes(database)
        start, _end = weekly_review.reviewed_window(MOMENT)
        await athlete(database, "ada", "fr")
        await athlete(database, "beau", "en")
        await workout(database, "ada", start + timedelta(days=1, hours=10), "Squat Day", 8, 3600)
        await workout(database, "ada", start + timedelta(days=3, hours=10), "Bench Day", 6, 3000)
        await workout(database, "ada", start - timedelta(days=3), "Old Pull", 5, 2400)
        await workout(database, "ada", MOMENT, "Thursday Lift", 7, 1800)
        await workout(database, "beau", start + timedelta(days=1), "Secret Session", 9, 3600)
        calls = []

        async def fake_llm_json(system, user_text, validator=None, **kwargs):
            calls.append({"system": system, "user_text": user_text, **kwargs})
            data = dict(REPLY)
            return validator(data) if validator else data

        monkeypatch.setattr(weekly_review, "llm_json", fake_llm_json)
        ada = auth("ada")
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post("/api/coach/weekly-review", headers=ada)
            second = await client.post("/api/coach/weekly-review", headers=ada)
            clock["at"] = MOMENT + timedelta(days=7)
            third = await client.post("/api/coach/weekly-review", headers=ada)

        assert first.status_code == 200 and first.json() == second.json()
        body = first.json()
        assert set(body) == {"iso_week", *weekly_review.KEYS}
        assert body["iso_week"] == weekly_review.iso_week_key(MOMENT)
        assert body["headline"] == REPLY["headline"]
        assert "claude" not in first.text.lower() and "model" not in body
        assert len(calls) == 2 and calls[0]["task"] == "fast" and "model" not in calls[0]
        assert "entirely in French" in calls[0]["system"]
        prompt = calls[0]["user_text"]
        assert "Squat Day" in prompt and "Bench Day" in prompt
        assert "Old Pull" not in prompt and "Thursday Lift" not in prompt
        assert "Secret Session" not in prompt
        assert "LOAD reviewed week: 780.0" in prompt and "LOAD previous week: 200.0" in prompt
        stored = await database.weekly_reviews.find_one({"user_id": "ada", "iso_week": body["iso_week"]})
        assert "model" not in stored and "provider" not in stored
        ready = stored["facts"]["readiness"]
        for label, value in (("start", ready["start"]), ("end", ready["end"])):
            assert f"READINESS {label}: {weekly_review._shown(value)}" in prompt
        assert [row["title"] for row in stored["facts"]["sessions"]] == ["Squat Day", "Bench Day"]
        notes = [row async for row in database.notifications.find({"user_id": "ada"})]
        assert len(notes) == 2 and {row["type"] for row in notes} == {"weekly_review"}
        assert notifications.WEEKLY_REVIEW not in notifications.MANDATORY
        assert notifications.WEEKLY_REVIEW in notifications.CONFIGURABLE
        assert third.json()["iso_week"] == weekly_review.iso_week_key(clock["at"])
        assert third.json()["iso_week"] != body["iso_week"]

    run_isolated(scenario)


def test_no_training_says_so_without_calling_the_model_or_inventing_a_score(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await athlete(database, "ada", "fr")
        await database.users.update_one(
            {"id": "ada"}, {"$set": {"notification_prefs": {"types": {"weekly_review": False}}}},
        )
        calls = []

        async def fake_llm_json(*_args, **_kwargs):
            calls.append(True)
            return dict(REPLY)

        monkeypatch.setattr(weekly_review, "llm_json", fake_llm_json)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            sent = await client.post("/api/coach/weekly-review", headers=auth("ada"))
            again = await client.post("/api/coach/weekly-review", headers=auth("ada"))
        assert calls == []
        assert sent.status_code == 200 and sent.json() == again.json()
        assert sent.json()["headline"] == "Pas d'entraînement à revoir"
        spoken = "".join(sent.json()[key] for key in weekly_review.KEYS)
        assert not any(char.isdigit() for char in spoken)
        stored = await database.weekly_reviews.find_one({"user_id": "ada"})
        assert stored["facts"]["readiness"] == {"start": None, "end": None, "trend": "unknown"}
        assert stored["facts"]["sessions"] == []
        assert "model" not in stored
        assert await database.notifications.count_documents({"type": "weekly_review"}) == 0

    run_isolated(scenario)


def test_a_model_failure_is_not_stored_and_does_not_name_the_model(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        start, _end = weekly_review.reviewed_window(MOMENT)
        await athlete(database, "ada", "en")
        await workout(database, "ada", start + timedelta(days=2), "Squat Day", 8, 3600)

        async def fake_llm_json(*_args, **_kwargs):
            raise LLMError("provider claude-haiku-4-5 failed")

        monkeypatch.setattr(weekly_review, "llm_json", fake_llm_json)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            failed = await client.post("/api/coach/weekly-review", headers=auth("ada"))
            bad = {"headline": "ok", "wins": "ok", "watch": "uses gpt", "next_week_change": "ok"}

            async def invalid(*_args, **kwargs):
                return kwargs["validator"](bad)

            monkeypatch.setattr(weekly_review, "llm_json", invalid)
            rejected = await client.post("/api/coach/weekly-review", headers=auth("ada"))
        assert failed.status_code == 503 and rejected.status_code == 503
        assert "claude" not in failed.text.lower() and "haiku" not in failed.text.lower()
        assert "gpt" not in rejected.text.lower()
        assert await database.weekly_reviews.count_documents({}) == 0
        assert await database.notifications.count_documents({}) == 0

    run_isolated(scenario)
