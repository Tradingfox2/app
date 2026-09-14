"""Check-in channels and challenge channels, through the router."""
import os
from datetime import timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import challenges  # noqa: E402
import server  # noqa: E402
from routers import community  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402
from tests.test_community_slice2 import seed_all  # noqa: E402


# --- Channel creation ---

def test_a_challenge_channel_needs_settings_and_nothing_else_may_have_them():
    now = server.now()
    with pytest.raises(ValidationError):
        community.ChannelIn(name="june", kind="challenge")
    with pytest.raises(ValidationError):
        community.ChannelIn(name="chat", kind="text", challenge=community.ChallengeIn(
            starts_at=now, ends_at=now + timedelta(days=7)))
    with pytest.raises(ValidationError):  # backwards window
        community.ChallengeIn(starts_at=now, ends_at=now - timedelta(days=1))


# --- Check-ins ---

async def checkin_channel(db, owner="owner"):
    return await community.create_channel(
        "c-1", community.ChannelIn(name="daily", kind="checkin"), account(owner))


def test_one_checkin_a_day_and_the_day_is_recorded(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await checkin_channel(db)
        await community.create_message(channel["id"], community.MessageIn(content="done"), account("mem"))
        stored = await db.messages.find_one({"channel_id": channel["id"]})
        assert stored["checkin_day"] == challenges.day_key(server.now())
        with pytest.raises(HTTPException) as twice:
            await community.create_message(channel["id"], community.MessageIn(content="again"), account("mem"))
        assert twice.value.status_code == 409
    run_isolated(scenario)


def test_the_unique_index_stops_a_concurrent_second_checkin(monkeypatch):
    """The find is a fast path; the partial unique index is the real guard."""
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.messages.create_index(
            [("channel_id", 1), ("author_id", 1), ("checkin_day", 1)], unique=True,
            partialFilterExpression={"checkin_day": {"$exists": True}, "status": "active"})
        channel = await checkin_channel(db)
        await community.create_message(channel["id"], community.MessageIn(content="first"), account("mem"))
        # Simulate the race: make the fast-path lookup miss.
        original = db.messages.find_one

        async def blind_find_one(query, *args, **kwargs):
            if "checkin_day" in query:
                return None
            return await original(query, *args, **kwargs)

        monkeypatch.setattr(db.messages, "find_one", blind_find_one)
        with pytest.raises(HTTPException) as raced:
            await community.create_message(channel["id"], community.MessageIn(content="second"), account("mem"))
        assert raced.value.status_code == 409
    run_isolated(scenario)


def test_the_board_reports_your_streak_and_the_leaders(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await checkin_channel(db)
        today = server.now().date()
        # mem: today and two days ago — one rest day in between, still a streak.
        for offset in (0, 2, 3):
            await db.messages.insert_one({
                "id": f"ci-{offset}", "channel_id": channel["id"], "author_id": "mem", "status": "active",
                "content": "x", "created_at": server.now(),
                "checkin_day": (today - timedelta(days=offset)).isoformat()})
        board = await community.checkin_board(channel["id"], account("mem"))
        assert board["me"]["current"] == 3 and board["me"]["checked_in_today"] is True
        assert [row["user_id"] for row in board["leaders"]] == ["mem"]
        assert board["leaders"][0]["user"]["full_name"] == "Mem"
    run_isolated(scenario)


def test_the_checkin_board_needs_a_checkin_channel(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        with pytest.raises(HTTPException) as wrong:
            await community.checkin_board("ch-1", account("mem"))  # a text channel
        assert wrong.value.status_code == 404
    run_isolated(scenario)


# --- Challenges ---

async def challenge_channel(db, metric="workouts", days_ago=3, length=10, goal=None):
    starts = server.now() - timedelta(days=days_ago)
    return await community.create_channel("c-1", community.ChannelIn(
        name="september", kind="challenge",
        challenge=community.ChallengeIn(metric=metric, starts_at=starts,
                                        ends_at=starts + timedelta(days=length), goal=goal),
    ), account("owner"))


async def workout(db, wid, owner, days_ago, minutes=60, sets=()):
    ended = server.now() - timedelta(days=days_ago)
    await db.workouts.insert_one({"id": wid, "user_id": owner, "title": "s", "started_at": ended,
                                  "ended_at": ended, "duration_sec": minutes * 60})
    for reps, kg in sets:
        await db.workout_sets.insert_one({"workout_id": wid, "reps": reps, "weight_kg": kg})


def test_only_people_who_joined_are_scored(monkeypatch):
    """Joining is consent: a member who did not opt in is never counted."""
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await challenge_channel(db)
        await workout(db, "w-mem", "mem", 1)
        await workout(db, "w-mod", "mod", 1)  # mod trains but never joins
        await community.join_challenge(channel["id"], account("mem"))

        board = await community.challenge_board(channel["id"], account("mem"))
        assert [row["user_id"] for row in board["leaders"]] == ["mem"]
        assert board["participant_count"] == 1 and board["joined"] is True
        assert board["me"] == {"place": 1, "score": 1.0}
    run_isolated(scenario)


def test_only_workouts_inside_the_window_count(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await challenge_channel(db, days_ago=3)
        await community.join_challenge(channel["id"], account("mem"))
        await workout(db, "before", "mem", 5)   # before the challenge started
        await workout(db, "inside", "mem", 1)
        board = await community.challenge_board(channel["id"], account("mem"))
        assert board["me"]["score"] == 1.0
    run_isolated(scenario)


def test_tonnage_and_the_group_goal(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await challenge_channel(db, metric="tonnage", goal=2000)
        for who in ("mem", "mod"):
            await community.join_challenge(channel["id"], account(who))
        await workout(db, "w1", "mem", 1, sets=[(5, 100), (5, 100)])  # 1000
        await workout(db, "w2", "mod", 1, sets=[(10, 50)])            # 500
        board = await community.challenge_board(channel["id"], account("mem"))
        assert [(r["user_id"], r["score"]) for r in board["leaders"]] == [("mem", 1000.0), ("mod", 500.0)]
        assert board["group_total"] == 1500.0
        assert board["goal_progress"] == 0.75
    run_isolated(scenario)


def test_leaving_withdraws_you_from_the_board(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await challenge_channel(db)
        await community.join_challenge(channel["id"], account("mem"))
        await community.join_challenge(channel["id"], account("mem"))  # idempotent
        await community.leave_challenge(channel["id"], account("mem"))
        board = await community.challenge_board(channel["id"], account("mem"))
        assert board["participant_count"] == 0 and board["joined"] is False and board["me"] is None
    run_isolated(scenario)


def test_an_ended_challenge_takes_no_new_participants(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await challenge_channel(db, days_ago=20, length=10)
        with pytest.raises(HTTPException) as closed:
            await community.join_challenge(channel["id"], account("mem"))
        assert closed.value.status_code == 409
        assert (await community.challenge_board(channel["id"], account("mem")))["status"] == "ended"
    run_isolated(scenario)


def test_a_hidden_challenge_channel_cannot_be_joined_or_read(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        channel = await challenge_channel(db)
        default = await community._ensure_default_role("c-1")
        await community.set_channel_overwrites(channel["id"], [community.OverwriteIn(
            role_id=default["id"], deny=community.permissions.VIEW_CHANNEL)], account("owner"))
        for attempt in (community.join_challenge, community.challenge_board):
            with pytest.raises(HTTPException) as denied:
                await attempt(channel["id"], account("mem"))
            assert denied.value.status_code == 403
    run_isolated(scenario)
