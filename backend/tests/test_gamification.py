"""Gamification engine: pure rules plus the ledger/sync path against a real Mongo."""
import asyncio
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "gamification-test-secret-0123456789abcdef")
os.environ.setdefault("PUSH_ENABLED", "off")

import gamification as g  # noqa: E402
import server  # noqa: E402
from routers import progress  # noqa: E402

TODAY = date(2026, 10, 21)


def iso(*offsets):
    return [(TODAY - timedelta(days=n)).isoformat() for n in offsets]


# --- pure rules -------------------------------------------------------------- #
def test_level_curve_is_monotonic_and_starts_at_one():
    assert g.Levels.level_for(0) == 1
    assert g.Levels.threshold(2) == 100
    values = [g.Levels.threshold(n) for n in range(1, 60)]
    assert values == sorted(values) and len(set(values)) == len(values)
    summary = g.Levels.summary(g.Levels.threshold(5) + 10)
    assert summary["level"] == 5 and summary["stage"] == "mover" and 0 < summary["progress"] < 1


def test_stages_follow_levels():
    assert [g.Levels.stage_for(n) for n in (1, 5, 10, 20, 35, 50)] == ["rookie", "mover", "athlete", "pro", "elite", "legend"]


def test_one_rest_day_keeps_the_streak_two_break_it():
    assert g.Streaks.compute(iso(0, 2, 4), TODAY)["current"] == 3
    broken = g.Streaks.compute(iso(3, 4, 5), TODAY)
    assert broken["current"] == 0 and broken["longest"] == 3


def test_streak_at_risk_when_tomorrow_would_break_it():
    state = g.Streaks.compute(iso(2, 3), TODAY)
    assert state["current"] == 2 and state["at_risk"] is True


def test_freezes_bridge_two_missing_days_each():
    last = TODAY - timedelta(days=5)
    covered = g.Streaks.freezes_needed(last, TODAY)
    assert covered == [last + timedelta(days=2), last + timedelta(days=4)]
    assert g.Streaks.freezes_needed(TODAY - timedelta(days=2), TODAY) == []


def test_workout_verification_rejects_tiny_or_unfinished_sessions():
    assert not g.Awards.workout_verified({"ended_at": None, "duration_sec": 3600}, 10)
    assert not g.Awards.workout_verified({"ended_at": datetime.now(timezone.utc), "duration_sec": 120}, 1)
    assert g.Awards.workout_verified({"ended_at": datetime.now(timezone.utc), "duration_sec": 120}, 3)
    assert g.Awards.workout_xp(3600) == 50 + 30 and g.Awards.workout_xp(36000) == 90


def test_manual_and_sample_steps_never_count():
    assert g.Awards.step_row_counts({"metric": "steps", "device": "garmin", "value": 9000})
    assert not g.Awards.step_row_counts({"metric": "steps", "device": "manual", "value": 9000})
    assert not g.Awards.step_row_counts({"metric": "steps", "device": "garmin", "simulated": True})
    assert not g.Awards.step_row_counts({"metric": "steps", "device": "garmin", "source": "client"})
    assert not g.Awards.step_row_counts({"metric": "steps", "device": None})


def test_league_outcomes():
    assert g.Leagues.outcome(1, 30, "bronze") == "promoted"
    assert g.Leagues.outcome(30, 30, "bronze") == "stayed"      # nothing below bronze
    assert g.Leagues.outcome(30, 30, "silver") == "relegated"
    assert g.Leagues.outcome(1, 30, "diamond") == "stayed"      # nothing above diamond
    assert g.Leagues.outcome(6, 8, "silver") == "stayed"        # small group: no relegation
    assert g.Leagues.next_division("silver", "promoted") == "gold"


def test_points_are_not_money():
    import gamification_config as cfg
    text = open(cfg.__file__, encoding="utf-8").read().lower()
    assert "cash" in text and "never money" in text
    assert not any(word in str(cfg.CONFIG).lower() for word in ("price_eur", "loot", "spin", "random"))


# --- database path ------------------------------------------------------------ #
def run(scenario):
    async def _run():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True, serverSelectionTimeoutMS=3000)
        database = client[f"ironflow_gam_{uuid.uuid4().hex}"]
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()
    asyncio.run(_run())


def now():
    return datetime.now(timezone.utc)


async def add_workout(database, uid, ended, minutes=45, sets=()):
    wid = uuid.uuid4().hex
    await database.workouts.insert_one({"id": wid, "user_id": uid, "started_at": ended - timedelta(minutes=minutes),
                                        "ended_at": ended, "duration_sec": minutes * 60})
    for i, (exercise, weight, reps) in enumerate(sets):
        await database.workout_sets.insert_one({"id": uuid.uuid4().hex, "workout_id": wid, "exercise_id": exercise,
                                                "set_index": i, "weight_kg": weight, "reps": reps})
    return wid


def test_sync_is_idempotent_and_awards_verified_sources_only():
    async def scenario(database):
        uid = "athlete"
        t = now() - timedelta(hours=1)
        await add_workout(database, uid, t - timedelta(days=1), sets=[("bench", 80, 5)])
        await add_workout(database, uid, t, sets=[("bench", 85, 5)])          # a PR on bench
        await add_workout(database, uid, t, minutes=3)                          # too short: no XP
        await database.gym_visits.insert_many([{"user_id": uid, "gym_id": "g1", "checked_in_at": t},
                                               {"user_id": uid, "gym_id": "g1", "checked_in_at": t}])
        await database.wearable_metrics.insert_many([
            {"user_id": uid, "metric": "steps", "value": 12000, "device": "garmin", "recorded_at": t},
            {"user_id": uid, "metric": "steps", "value": 99999, "device": "manual", "recorded_at": t - timedelta(days=2)},
        ])
        first = await g.Progress.sync(database, uid)
        xp1 = first["profile"]["xp"]
        second = await g.Progress.sync(database, uid)
        assert second["profile"]["xp"] == xp1, "a second sync must not award anything"
        kinds = [r["kind"] async for r in database.xp_ledger.find({"user_id": uid})]
        assert kinds.count("workout") == 2 and kinds.count("pr") == 1
        assert kinds.count("gym_checkin") == 1 and kinds.count("steps_5k") == 1 and kinds.count("steps_10k") == 1
        badges = {r["meta"]["badge"] async for r in database.xp_ledger.find({"user_id": uid, "kind": "badge"})}
        assert {"first_workout", "first_pr", "first_gym_checkin", "steps_day_10k"} <= badges
        assert second["counters"]["steps_total"] == 12000
    run(scenario)


def test_daily_workout_cap():
    async def scenario(database):
        t = now() - timedelta(hours=1)
        for _ in range(5):
            await add_workout(database, "u", t)
        await g.Progress.sync(database, "u")
        assert await database.xp_ledger.count_documents({"user_id": "u", "kind": "workout"}) == 3
    run(scenario)


def test_ledger_rejects_duplicate_keys():
    async def scenario(database):
        await g.Ledger.ensure_indexes(database)
        assert await g.Ledger.award(database, "u", "k1", "workout", 50)
        assert await g.Ledger.award(database, "u", "k1", "workout", 50) is None
        assert await g.Ledger.total(database, "u") == 50
    run(scenario)


def test_social_xp_is_capped_per_day():
    async def scenario(database):
        await g.Ledger.ensure_indexes(database)
        t = now()
        for i in range(30):
            await g.Awards.social(database, "u", "kudos", f"p{i}", t)
        assert await g.Ledger.total(database, "u") == 15
    run(scenario)


def test_league_closes_once_and_moves_divisions():
    async def scenario(database):
        await g.Ledger.ensure_indexes(database)
        last_week = now() - timedelta(days=7)
        week = g.week_key(last_week)
        for i in range(12):
            uid = f"u{i:02d}"
            await g.Profiles.get(database, uid)
            await g.Profiles.set(database, uid, {"division": "silver"})
            await g.Ledger.award(database, uid, f"seed:{i}", "workout", 100 - i, at=last_week)
            await g.Leagues.place(database, uid, "silver", week)
        assert await g.Leagues.close_due(database, now()) == 1
        assert await g.Leagues.close_due(database, now()) == 0
        divisions = {p["user_id"]: p["division"] async for p in database.progress_profiles.find({})}
        assert divisions["u00"] == "gold" and divisions["u11"] == "bronze" and divisions["u06"] == "silver"
        assert await database.xp_ledger.count_documents({"kind": "league_champion"}) == 1
    run(scenario)


def test_freeze_earned_and_spent():
    async def scenario(database):
        await g.Ledger.ensure_indexes(database)
        today = now().date()
        for n in range(4, 11):   # 7 consecutive training days ending 4 days ago
            day = today - timedelta(days=n)
            await g.Ledger.award(database, "u", f"gym:{day}", "gym_checkin", 15,
                                 at=datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc))
        state = await g.Streak.refresh(database, "u", today - timedelta(days=4))
        assert state["current"] == 7 and state["freezes"] == 1
        state = await g.Streak.refresh(database, "u", today - timedelta(days=1))
        assert state["current"] == 8 and state["freezes"] == 0     # one freeze bridged the gap
    run(scenario)


def test_api_progress_and_challenges(monkeypatch):
    async def scenario(database):
        monkeypatch.setattr(server, "db", database)
        await database.users.insert_one({"id": "ath", "email": "ath@example.invalid", "full_name": "Ath", "role": "athlete"})
        await add_workout(database, "ath", now() - timedelta(minutes=30))
        headers = {"Authorization": f"Bearer {server.make_token('ath')}"}
        async with AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as client:
            body = (await client.get("/api/progress", headers=headers)).json()
            assert body["level"] >= 1 and body["xp"] > 0 and body["week"]["workouts"] == 1
            assert any(b["id"] == "first_workout" and b["unlocked_at"] for b in body["badges"])
            assert body["celebrations"], "a fresh badge is a celebration"
            listing = (await client.get("/api/progress/challenges", headers=headers)).json()["items"]
            assert {c["metric"] for c in listing if c["kind"] == "solo"} == {"workouts", "steps", "active_days"}
            bad = await client.post("/api/progress/challenges", headers=headers, json={
                "kind": "club", "title": "Club month", "metric": "workouts", "target": 10,
                "starts_at": now().isoformat(), "ends_at": (now() + timedelta(days=20)).isoformat(), "community_id": "c1"})
            assert bad.status_code == 403
            assert (await client.post("/api/progress/celebrations/seen", headers=headers, json={})).status_code == 200
            again = (await client.get("/api/progress", headers=headers)).json()
            assert again["celebrations"] == [] and again["xp"] == body["xp"]
            league = (await client.get("/api/progress/league", headers=headers)).json()
            assert league["placed"] is True and league["table"][0]["me"] is True
            assert (await client.post("/api/progress/frame", headers=headers, json={"frame": "legend"})).status_code == 403
            assert (await client.get("/api/progress/cups", headers=headers)).status_code == 200
    run(scenario)
