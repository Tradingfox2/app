"""Per-channel unread, the member directory, invite links, and search."""
import os
from datetime import timedelta

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import notifications  # noqa: E402
import server  # noqa: E402,F401
import social_graph  # noqa: E402
from routers import community, search, social  # noqa: E402
from tests.test_community_permissions import account, run_isolated, seed  # noqa: E402


async def seed_all(db, monkeypatch):
    await seed(db, monkeypatch)  # community, staff, server
    for module in (social, notifications, social_graph, search):
        monkeypatch.setattr(module, "db", db)


async def say(text, who, channel="ch-1"):
    return await community.create_message(channel, community.MessageIn(content=text), account(who))


def unread(channels, cid="ch-1"):
    return next(c for c in channels if c["id"] == cid)["unread_count"]


# --- Unread ---

def test_unread_counts_other_peoples_messages_since_last_read(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await say("one", "mod")
        last = await say("two", "mod")
        await say("mine", "mem")  # your own messages never count
        assert unread(await community.list_channels("c-1", account("mem"))) == 2

        await community.mark_channel_read("ch-1", community.ReadIn(message_id=last["id"]), account("mem"))
        assert unread(await community.list_channels("c-1", account("mem"))) == 0

        await say("three", "mod")
        assert unread(await community.list_channels("c-1", account("mem"))) == 1
    run_isolated(scenario)


def test_the_read_marker_never_moves_backwards(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        first = await say("old", "mod")
        second = await say("new", "mod")
        await community.mark_channel_read("ch-1", community.ReadIn(message_id=second["id"]), account("mem"))
        # A second device reading an older message must not resurrect "new".
        await community.mark_channel_read("ch-1", community.ReadIn(message_id=first["id"]), account("mem"))
        assert unread(await community.list_channels("c-1", account("mem"))) == 0
    run_isolated(scenario)


def test_a_new_member_does_not_inherit_the_backlog_as_unread(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await say("before you arrived", "mod")
        await db.community_members.update_one(
            {"id": "m-mem"}, {"$set": {"joined_at": server.now() + timedelta(seconds=1)}})
        assert unread(await community.list_channels("c-1", account("mem"))) == 0
    run_isolated(scenario)


def test_marking_read_needs_to_see_the_channel(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        message = await say("hi", "mod")
        default = await community._ensure_default_role("c-1")
        await community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=default["id"], deny=community.permissions.VIEW_CHANNEL)],
            account("owner"))
        with pytest.raises(HTTPException) as denied:
            await community.mark_channel_read("ch-1", community.ReadIn(message_id=message["id"]), account("mem"))
        assert denied.value.status_code == 403
    run_isolated(scenario)


# --- Directory ---

def test_any_active_member_can_list_members_for_mentions(monkeypatch):
    """Regression: the roster was manager-only, so @-suggestions were empty
    for every plain member."""
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.community_members.insert_one(
            {"id": "m-p", "community_id": "c-1", "user_id": "out", "role": "member", "status": "pending"})
        people = await community.member_directory("c-1", account("mem"))
        assert sorted(p["id"] for p in people) == ["mem", "mod", "owner"]  # pending excluded
        # Public fields only — in particular, never an email.
        assert all(set(p) <= {"id", "full_name", "avatar_url"} for p in people)
        with pytest.raises(HTTPException) as outsider:
            await community.member_directory("c-1", account("out"))
        assert outsider.value.status_code == 403
    run_isolated(scenario)


# --- Invites ---

async def invite(db, who="owner", **options):
    return await community.create_invite("c-1", community.InviteIn(**options), account(who))


async def set_policy(db, policy):
    await db.communities.update_one({"id": "c-1"}, {"$set": {"join_policy": policy}})


def test_a_plain_invite_grants_only_what_joining_would(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await set_policy(db, "approval")
        link = await invite(db, who="mem")  # INVITE_MEMBER is a default-member bit
        membership = await community.redeem_invite(link["code"], account("out"))
        assert membership["status"] == "pending"  # still needs approval
    run_isolated(scenario)


def test_skipping_approval_is_a_managers_power(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await set_policy(db, "approval")
        with pytest.raises(HTTPException) as denied:
            await invite(db, who="mem", skip_approval=True)
        assert denied.value.status_code == 403

        link = await invite(db, who="owner", skip_approval=True)
        membership = await community.redeem_invite(link["code"], account("out"))
        assert membership["status"] == "active"
        assert membership["entitlement_source"] == "invite"
    run_isolated(scenario)


def test_no_invite_opens_a_paid_community_and_the_use_is_refunded(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await set_policy(db, "paid")
        link = await invite(db, who="owner", skip_approval=True, max_uses=1)
        with pytest.raises(HTTPException) as billing:
            await community.redeem_invite(link["code"], account("out"))
        assert billing.value.status_code == 402
        stored = await db.community_invites.find_one({"code": link["code"]})
        assert stored["uses"] == 0  # a failed join must not burn the single seat
    run_isolated(scenario)


def test_a_banned_member_stays_banned_whatever_link_they_bring(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.community_members.insert_one(
            {"id": "m-out", "community_id": "c-1", "user_id": "out", "role": "member", "status": "banned"})
        link = await invite(db, who="owner", skip_approval=True)
        membership = await community.redeem_invite(link["code"], account("out"))
        assert membership["status"] == "banned"
        assert (await db.community_invites.find_one({"code": link["code"]}))["uses"] == 0
    run_isolated(scenario)


def test_limited_use_revoked_and_expired_invites_stop_working(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.users.insert_many([account("x1"), account("x2")])

        single = await invite(db, max_uses=1)
        await community.redeem_invite(single["code"], account("x1"))
        with pytest.raises(HTTPException) as exhausted:
            await community.redeem_invite(single["code"], account("x2"))
        assert exhausted.value.status_code == 410

        revoked = await invite(db)
        await community.revoke_invite(revoked["code"], account("owner"))
        with pytest.raises(HTTPException) as gone:
            await community.redeem_invite(revoked["code"], account("x2"))
        assert gone.value.status_code == 410

        stale = await invite(db)
        await db.community_invites.update_one(
            {"code": stale["code"]}, {"$set": {"expires_at": server.now() - timedelta(minutes=1)}})
        with pytest.raises(HTTPException) as expired:
            await community.redeem_invite(stale["code"], account("x2"))
        assert expired.value.status_code == 410
    run_isolated(scenario)


def test_redeeming_when_already_a_member_consumes_no_use(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        link = await invite(db, max_uses=1)
        await community.redeem_invite(link["code"], account("mem"))  # already active
        assert (await db.community_invites.find_one({"code": link["code"]}))["uses"] == 0
    run_isolated(scenario)


def test_an_invite_previews_a_private_community_to_an_outsider(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"is_public": False}})
        link = await invite(db)
        preview = await community.preview_invite(link["code"], account("out"))
        assert preview["community"]["name"] == "Iron Club"
        assert preview["unusable_reason"] is None and preview["membership_status"] is None
    run_isolated(scenario)


def test_only_the_creator_or_a_manager_can_revoke(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        link = await invite(db, who="owner")
        await db.community_members.insert_one(
            {"id": "m-x", "community_id": "c-1", "user_id": "out", "role": "member", "status": "active"})
        with pytest.raises(HTTPException) as denied:
            await community.revoke_invite(link["code"], account("out"))
        assert denied.value.status_code == 403
    run_isolated(scenario)


# --- Search ---

def test_people_search_matches_names_never_emails(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        found = await search.search("Mod", "users", 20, account("mem"))
        assert [r["id"] for r in found["results"]] == ["mod"]
        # Every seeded email ends @example.invalid; it must match nothing.
        assert (await search.search("example.invalid", "users", 20, account("mem")))["results"] == []
    run_isolated(scenario)


def test_people_search_hides_blocked_and_suspended_accounts(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await social.block_user("mod", account("mem"))
        await db.users.update_one({"id": "owner"}, {"$set": {"suspended_at": server.now()}})
        found = await search.search("o", "users", 20, account("mem"))
        ids = [r["id"] for r in found["results"]]
        assert "mod" not in ids and "owner" not in ids
    run_isolated(scenario)


def test_community_search_skips_private_and_archived(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.communities.insert_many([
            {"id": "c-2", "owner_id": "owner", "name": "Iron Secret", "is_public": False, "status": "active"},
            {"id": "c-3", "owner_id": "owner", "name": "Iron Gone", "is_public": True, "status": "archived"},
        ])
        found = await search.search("iron", "communities", 20, account("mem"))
        assert [r["id"] for r in found["results"]] == ["c-1"]
    run_isolated(scenario)


def test_post_search_obeys_feed_visibility_but_ignores_mutes(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.users.update_one({"id": "owner"}, {"$set": {"is_private": True}})
        for pid, author in (("p-private", "owner"), ("p-muted", "mod"), ("p-out", "out")):
            await db.posts.insert_one({
                "id": pid, "author_id": author, "content": "deadlift PR", "community_id": None,
                "media": [], "repost_of": None, "status": "active", "like_count": 0,
                "comment_count": 0, "repost_count": 0, "created_at": server.now()})
        await social.mute_user("mod", account("mem"))
        await social.block_user("out", account("mem"))
        found = await search.search("deadlift", "posts", 20, account("mem"))
        ids = [r["id"] for r in found["results"]]
        assert "p-private" not in ids  # private author, not followed
        assert "p-out" not in ids      # blocked
        assert "p-muted" in ids        # muting is feed-only; an explicit search still finds it
    run_isolated(scenario)


def test_a_query_is_matched_literally_never_as_a_regex(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        # Unescaped, ".*" would match every user.
        assert (await search.search(".*", "users", 20, account("mem")))["results"] == []
    run_isolated(scenario)
