"""The social graph and the notification taxonomy.

Covers the rules a social product lives or dies on: who can follow whom, what a
private account withholds, what blocking severs, and which events reach a
notification list without burying it.
"""
import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import notifications  # noqa: E402
import server  # noqa: E402,F401 - must load before modules importing from it
import social_graph  # noqa: E402
from routers import social  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402


async def seed_people(db, monkeypatch, private=()):
    for module in (social, notifications, social_graph):
        monkeypatch.setattr(module, "db", db)
    monkeypatch.setattr(server, "db", db)
    people = []
    for uid in ("alice", "bob", "carol"):
        doc = {**account(uid), "is_private": uid in private}
        people.append(doc)
    await db.users.insert_many([dict(p) for p in people])
    return {p["id"]: p for p in people}


# --- Following a public account ---

def test_following_a_public_account_is_immediate_and_notifies(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        result = await social.follow("bob", people["alice"])
        assert result["state"] == "following"

        assert await social_graph.follows_actively("alice", "bob")
        note = await db.notifications.find_one({"user_id": "bob"}, {"_id": 0})
        assert note["type"] == notifications.FOLLOW
        assert note["metadata"]["actor_id"] == "alice"
    run_isolated(scenario)


def test_following_yourself_is_refused(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        with pytest.raises(HTTPException) as denied:
            await social.follow("alice", people["alice"])
        assert denied.value.status_code == 409
    run_isolated(scenario)


def test_unfollow_clears_the_edge(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await social.follow("bob", people["alice"])
        await social.unfollow("bob", people["alice"])
        assert await social_graph.follow_state("alice", "bob") == "none"
    run_isolated(scenario)


# --- Private accounts and follow requests ---

def test_following_a_private_account_creates_a_request(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch, private=("bob",))
        result = await social.follow("bob", people["alice"])
        assert result["state"] == "pending" and result["following"] is False

        # A pending edge grants nothing.
        assert not await social_graph.follows_actively("alice", "bob")
        assert not await social_graph.can_view_profile("alice", "bob")

        note = await db.notifications.find_one({"user_id": "bob"}, {"_id": 0})
        assert note["type"] == notifications.FOLLOW_REQUEST

        pending = await social.follow_requests(people["bob"])
        assert [row["follower_id"] for row in pending] == ["alice"]
    run_isolated(scenario)


def test_approving_a_request_grants_access_and_tells_the_requester(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch, private=("bob",))
        await social.follow("bob", people["alice"])
        await social.approve_follow_request("alice", people["bob"])

        assert await social_graph.follows_actively("alice", "bob")
        assert await social_graph.can_view_profile("alice", "bob")
        accepted = await db.notifications.find_one(
            {"user_id": "alice", "type": notifications.FOLLOW_ACCEPTED}, {"_id": 0})
        assert accepted is not None
        assert await social.follow_requests(people["bob"]) == []
    run_isolated(scenario)


def test_denying_a_request_is_silent(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch, private=("bob",))
        await social.follow("bob", people["alice"])
        await social.deny_follow_request("alice", people["bob"])

        assert await social_graph.follow_state("alice", "bob") == "none"
        # Every major network declines silently; being told you were rejected
        # is itself a harm.
        assert await db.notifications.count_documents(
            {"user_id": "alice", "type": notifications.FOLLOW_ACCEPTED}) == 0
    run_isolated(scenario)


def test_approving_something_that_is_not_pending_is_a_404(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        with pytest.raises(HTTPException) as missing:
            await social.approve_follow_request("alice", people["bob"])
        assert missing.value.status_code == 404
    run_isolated(scenario)


def test_a_private_profile_shows_its_header_but_withholds_posts(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch, private=("bob",))
        profile = await social.public_profile("bob", people["alice"])
        assert profile["is_private"] is True
        assert profile["can_view_posts"] is False
        assert profile["follow_state"] == "none"
    run_isolated(scenario)


# --- Blocking and muting ---

def test_blocking_severs_both_directions_and_prevents_refollow(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await social.follow("bob", people["alice"])
        await social.follow("alice", people["bob"])

        await social.block_user("bob", people["alice"])
        assert await social_graph.follow_state("alice", "bob") == "none"
        assert await social_graph.follow_state("bob", "alice") == "none"

        with pytest.raises(HTTPException) as denied:
            await social.follow("bob", people["alice"])
        assert denied.value.status_code == 403
        # Symmetric: the blocked party cannot reach back either.
        with pytest.raises(HTTPException) as reverse:
            await social.follow("alice", people["bob"])
        assert reverse.value.status_code == 403
    run_isolated(scenario)


def test_unblocking_restores_the_ability_to_follow(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await social.block_user("bob", people["alice"])
        await social.unblock_user("bob", people["alice"])
        assert (await social.follow("bob", people["alice"]))["state"] == "following"
    run_isolated(scenario)


def test_a_block_suppresses_notifications_in_both_directions(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await social.block_user("bob", people["alice"])
        assert await notifications.notify(
            "bob", notifications.FOLLOW, actor=people["alice"], title="should not arrive") is None
        assert await notifications.notify(
            "alice", notifications.FOLLOW, actor=people["bob"], title="nor this") is None
        assert await db.notifications.count_documents({}) == 0
    run_isolated(scenario)


def test_muting_is_one_way_and_does_not_sever_the_follow(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await social.follow("bob", people["alice"])
        await social.mute_user("bob", people["alice"])

        assert await social_graph.follows_actively("alice", "bob")  # still following
        assert "bob" in await social_graph.hidden_author_ids("alice")
        assert "alice" not in await social_graph.hidden_author_ids("bob")
    run_isolated(scenario)


def test_you_cannot_block_or_mute_yourself(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        for action in (social.block_user, social.mute_user):
            with pytest.raises(HTTPException) as denied:
                await action("alice", people["alice"])
            assert denied.value.status_code == 409
    run_isolated(scenario)


# --- Follower and following lists ---

def test_lists_show_accepted_followers_only_and_mark_who_you_follow(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch, private=("carol",))
        await social.follow("alice", people["bob"])
        await social.follow("carol", people["bob"])      # pending, private target

        followers = await social.followers("alice", people["alice"])
        assert [p["id"] for p in followers] == ["bob"]

        following = await social.following("bob", people["bob"])
        # carol is still only a request, so she is not in "following" yet.
        assert [p["id"] for p in following] == ["alice"]
    run_isolated(scenario)


def test_a_private_users_lists_are_hidden_from_outsiders(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch, private=("carol",))
        with pytest.raises(HTTPException) as denied:
            await social.followers("carol", people["alice"])
        assert denied.value.status_code == 403
        # ...but visible to the owner.
        assert await social.followers("carol", people["carol"]) == []
    run_isolated(scenario)


# --- Notification behaviour ---

def test_you_are_never_notified_about_your_own_action(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        assert await notifications.notify(
            "alice", notifications.POST_LIKE, actor=people["alice"], title="self") is None
    run_isolated(scenario)


def test_repeated_likes_aggregate_into_one_row(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        for actor in ("bob", "carol"):
            await notifications.notify(
                "alice", notifications.POST_LIKE, actor=people[actor],
                title=f"{actor} liked your post", target_type="post", target_id="p-1")

        rows = [r async for r in db.notifications.find({"user_id": "alice"}, {"_id": 0})]
        assert len(rows) == 1, "two likes on one post must not make two rows"
        assert sorted(rows[0]["actor_ids"]) == ["bob", "carol"]
        assert rows[0]["actor_count"] == 2

        # The same person liking twice does not inflate the count.
        await notifications.notify(
            "alice", notifications.POST_LIKE, actor=people["bob"],
            title="bob liked your post", target_type="post", target_id="p-1")
        rows = [r async for r in db.notifications.find({"user_id": "alice"}, {"_id": 0})]
        assert len(rows) == 1 and rows[0]["actor_count"] == 2
    run_isolated(scenario)


def test_likes_on_different_posts_stay_separate(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        for target in ("p-1", "p-2"):
            await notifications.notify(
                "alice", notifications.POST_LIKE, actor=people["bob"],
                title="bob liked your post", target_type="post", target_id=target)
        assert await db.notifications.count_documents({"user_id": "alice"}) == 2
    run_isolated(scenario)


def test_a_read_notification_does_not_absorb_new_activity(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        first = await notifications.notify(
            "alice", notifications.POST_LIKE, actor=people["bob"],
            title="bob liked your post", target_type="post", target_id="p-1")
        await db.notifications.update_one({"id": first["id"]}, {"$set": {"read_at": server.now()}})

        await notifications.notify(
            "alice", notifications.POST_LIKE, actor=people["carol"],
            title="carol liked your post", target_type="post", target_id="p-1")
        # Absorbing into an already-read row would hide the new like entirely.
        assert await db.notifications.count_documents({"user_id": "alice"}) == 2
    run_isolated(scenario)


def test_follows_never_aggregate(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        for actor in ("bob", "carol"):
            await notifications.notify(
                "alice", notifications.FOLLOW, actor=people[actor],
                title=f"{actor} followed you", target_type="user", target_id=actor)
        assert await db.notifications.count_documents({"user_id": "alice"}) == 2
    run_isolated(scenario)


def test_actors_resolve_to_display_names(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await notifications.notify(
            "alice", notifications.POST_LIKE, actor=people["bob"],
            title="bob liked your post", target_type="post", target_id="p-1")
        rows = [r async for r in db.notifications.find({"user_id": "alice"}, {"_id": 0})]
        resolved = await notifications.resolve_actors(rows)
        assert [a["full_name"] for a in resolved[0]["actors"]] == ["Bob"]
    run_isolated(scenario)


# --- Direct-message gating ---

def test_a_pending_mutual_follow_does_not_unlock_direct_messages(monkeypatch):
    """Regression: `_can_message` once counted any follow row, so two strangers
    could unlock DMs merely by both *requesting* to follow each other."""
    async def scenario(db):
        people = await seed_people(db, monkeypatch, private=("alice", "bob"))
        await social.follow("bob", people["alice"])   # pending
        await social.follow("alice", people["bob"])   # pending

        assert not await social._can_message("alice", "bob")
        with pytest.raises(HTTPException) as denied:
            await social.send_direct_message(
                "bob", social.DirectMessageIn(content="hi"), people["alice"])
        assert denied.value.status_code == 403

        # Once both requests are accepted, it is a real mutual follow.
        await social.approve_follow_request("alice", people["bob"])
        await social.approve_follow_request("bob", people["alice"])
        assert await social._can_message("alice", "bob")
    run_isolated(scenario)


def test_a_direct_message_notifies_the_recipient(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await social.follow("bob", people["alice"])
        await social.follow("alice", people["bob"])
        await social.send_direct_message(
            "bob", social.DirectMessageIn(content="ready for leg day?"), people["alice"])

        note = await db.notifications.find_one(
            {"user_id": "bob", "type": notifications.DIRECT_MESSAGE}, {"_id": 0})
        assert note is not None and note["metadata"]["actor_id"] == "alice"
    run_isolated(scenario)


def test_blocking_stops_direct_messages(monkeypatch):
    async def scenario(db):
        people = await seed_people(db, monkeypatch)
        await social.follow("bob", people["alice"])
        await social.follow("alice", people["bob"])
        await social.block_user("alice", people["bob"])

        with pytest.raises(HTTPException) as denied:
            await social.send_direct_message(
                "bob", social.DirectMessageIn(content="hi"), people["alice"])
        assert denied.value.status_code == 403
    run_isolated(scenario)
