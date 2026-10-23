"""Progress hooks and nudges: inline awards, one nudge per day, quiet hours, league results."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "nudges-test-secret-0123456789abcdef0123")
os.environ.setdefault("PUSH_ENABLED", "off")

import gamification as g  # noqa: E402
import notifications  # noqa: E402
import progress_nudges as pn  # noqa: E402
import server  # noqa: E402


def run(monkeypatch, scenario):
    async def _run():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True, serverSelectionTimeoutMS=3000)
        database = client[f"ironflow_nudge_{uuid.uuid4().hex}"]
        monkeypatch.setattr(server, "db", database)
        monkeypatch.setattr(notifications, "db", database)
        monkeypatch.setattr(notifications, "_push", lambda *_a, **_k: None)
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()
    asyncio.run(_run())


NOON = datetime(2026, 10, 21, 10, 0, tzinfo=timezone.utc)  # 12:00 in Berlin


def summary(**streak):
    base = {"current": 0, "longest": 0, "last_day": None, "at_risk": False, "freezes": 0}
    base.update(streak)
    return {"streak": base, "level": 4, "into_level": 10, "level_span": 100, "badges": []}


def test_choose_prefers_streak_at_risk():
    kind, key, values = pn.Nudges.choose(summary(current=5, at_risk=True, last_day="2026-10-19"), "2026-10-21")
    assert kind == "streak_at_risk" and values == {"n": 5} and key.endswith("2026-10-21")


def test_freeze_tokens_suppress_the_streak_warning():
    assert pn.Nudges.choose(summary(current=5, at_risk=True, freezes=1, last_day="2026-10-19"), "2026-10-21") is None


def test_comeback_after_a_week_idle():
    assert pn.Nudges.choose(summary(last_day="2026-10-10"), "2026-10-21")[0] == "comeback"


def test_near_level_and_near_badge():
    s = summary(last_day="2026-10-20")
    s["into_level"] = 95
    assert pn.Nudges.choose(s, "2026-10-21")[0] == "near_level"
    s["into_level"] = 10
    s["badges"] = [{"id": "workouts_10", "threshold": 10, "value": 9, "unlocked_at": None}]
    kind, _, values = pn.Nudges.choose(s, "2026-10-21")
    assert kind == "near_badge" and values["badge"] == "10 workouts"


def test_quiet_hours():
    assert pn.Nudges.quiet(22) and pn.Nudges.quiet(7) and not pn.Nudges.quiet(12)


def test_copy_has_every_language_and_no_health_values():
    for kind, table in pn.COPY.items():
        assert set(table) == {"en", "fr", "de", "es", "it"}, kind
        for title, body in table.values():
            assert "step" not in (title + body).lower() or kind == "near_badge"
            assert "bpm" not in (title + body).lower()


def test_workout_hook_awards_inline_and_never_raises(monkeypatch):
    async def scenario(database):
        w = {"id": "w1", "user_id": "u", "ended_at": datetime.now(timezone.utc), "duration_sec": 1800}
        await database.workouts.insert_one(dict(w))
        await pn.Hooks.workout_finished("u", w)
        await pn.Hooks.workout_finished("u", w)
        assert await database.xp_ledger.count_documents({"user_id": "u", "kind": "workout"}) == 1
        await pn.Hooks.workout_finished("u", {"broken": True})  # logged, not raised
    run(monkeypatch, scenario)


def test_one_nudge_per_day_and_respects_switch(monkeypatch):
    async def scenario(database):
        await g.Ledger.ensure_indexes(database)
        user = {"id": "u", "preferred_locale": "fr"}
        await database.users.insert_one(dict(user))
        base = NOON - timedelta(days=12)
        for n in range(4):
            day = base + timedelta(days=n)
            await g.Ledger.award(database, "u", f"gym:{n}", "gym_checkin", 15, at=day)
        kind = await pn.Nudges.for_user(database, user, NOON)
        assert kind == "comeback"
        row = await database.notifications.find_one({"user_id": "u"})
        assert row["type"] == pn.PROGRESS_NUDGE and row["title"].startswith("Prêt")
        assert await pn.Nudges.for_user(database, user, NOON + timedelta(hours=2)) is None
        assert await pn.Nudges.for_user(database, user, NOON.replace(hour=21)) is None  # 23:00 Berlin
        # Switched off: recorded nowhere.
        await database.notifications.delete_many({})
        await database.progress_nudges.delete_many({})
        await database.users.update_one({"id": "u"}, {"$set": {"notification_prefs": {"types": {pn.PROGRESS_NUDGE: False}}}})
        await pn.Nudges.for_user(database, user, NOON)
        assert await database.notifications.count_documents({}) == 0
    run(monkeypatch, scenario)


def test_league_results_sent_once(monkeypatch):
    async def scenario(database):
        await g.Ledger.ensure_indexes(database)
        last_week = NOON - timedelta(days=7)
        week = g.week_key(last_week)
        for i in range(3):
            uid = f"u{i}"
            await database.users.insert_one({"id": uid, "preferred_locale": "en"})
            await g.Profiles.get(database, uid)
            await g.Ledger.award(database, uid, f"s{i}", "workout", 100 - i, at=last_week)
            await g.Leagues.place(database, uid, "bronze", week)
        assert await pn.Nudges.league_results(database, g.utcnow()) == 3
        assert await pn.Nudges.league_results(database, g.utcnow()) == 0
        titles = sorted([n["title"] async for n in database.notifications.find({"type": pn.LEAGUE_RESULT})])
        assert titles[0].startswith("Promoted to Silver")
    run(monkeypatch, scenario)


def test_cron_endpoint_requires_secret(monkeypatch):
    async def scenario(database):
        monkeypatch.setenv("PROGRESS_CRON_SECRET", "s3cret")
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as client:
            assert (await client.post("/api/progress/nudges/run")).status_code == 403
            assert (await client.post("/api/progress/nudges/run", headers={"X-Cron-Secret": "nope"})).status_code == 403
            ok = await client.post("/api/progress/nudges/run", headers={"X-Cron-Secret": "s3cret"})
            assert ok.status_code == 200 and "nudges" in ok.json()
    run(monkeypatch, scenario)
