"""Role management, channel overwrites and message interactions, end to end.

Uses the same throwaway-database harness as test_admin_console.py: router
functions are called directly so no live server is required.
"""
import asyncio
import os
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import permissions as p  # noqa: E402
import server  # noqa: E402
import staff  # noqa: E402
from routers import community  # noqa: E402


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000)
        db = client[f"ironflow_perm_test_{uuid.uuid4().hex}"]
        try:
            await scenario(db)
        finally:
            await client.drop_database(db.name)
            client.close()
    asyncio.run(run())


def account(uid):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete"}


async def seed(db, monkeypatch):
    """An owner, a moderator and a plain member in one community with one channel."""
    monkeypatch.setattr(community, "db", db)
    monkeypatch.setattr(staff, "db", db)
    monkeypatch.setattr(server, "db", db)
    await db.users.insert_many([account("owner"), account("mod"), account("mem"), account("out")])
    await db.communities.insert_one({
        "id": "c-1", "owner_id": "owner", "name": "Iron Club",
        "status": "active", "is_public": True, "join_policy": "open",
    })
    for uid, role in (("owner", "owner"), ("mod", "moderator"), ("mem", "member")):
        await db.community_members.insert_one({
            "id": f"m-{uid}", "community_id": "c-1", "user_id": uid,
            "role": role, "status": "active",
        })
    await db.channels.insert_one({
        "id": "ch-1", "community_id": "c-1", "name": "general", "description": "",
        "kind": "text", "is_default": True, "status": "active", "overwrites": [],
    })


# --- Roles ---

def test_role_crud_respects_rank_and_protects_the_default_role(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")

        role = await community.create_role("c-1", community.RoleIn(name="coach", rank=5), owner)
        assert role["permissions"] == p.DEFAULT_MEMBER and not role["is_default"]
        # Creating the first role must materialise @everyone, or assigning a
        # narrow role would silently strip the baseline grant.
        default = await db.community_roles.find_one({"community_id": "c-1", "is_default": True})
        assert default["permissions"] == p.DEFAULT_MEMBER

        with pytest.raises(HTTPException) as denied:
            await community.create_role("c-1", community.RoleIn(name="sneaky", rank=5), mem)
        assert denied.value.status_code == 403

        with pytest.raises(HTTPException) as protected:
            await community.delete_role(default["id"], owner)
        assert protected.value.status_code == 409

        await community.delete_role(role["id"], owner)
        assert await db.community_roles.find_one({"id": role["id"]}) is None
    run_isolated(scenario)


def test_assigning_a_role_cannot_escalate_past_the_assigner(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner = account("owner")
        senior = await community.create_role("c-1", community.RoleIn(name="senior", rank=9), owner)
        junior = await community.create_role(
            "c-1", community.RoleIn(name="junior", rank=2, permissions=p.MANAGE_ROLES), owner)

        await community.assign_member_roles(
            "c-1", "m-mod", community.MemberRolesIn(role_ids=[junior["id"]]), owner)
        moderator = account("mod")
        # The moderator may hand out roles, but never one at or above their own rank.
        with pytest.raises(HTTPException) as escalation:
            await community.assign_member_roles(
                "c-1", "m-mem", community.MemberRolesIn(role_ids=[senior["id"]]), moderator)
        assert escalation.value.status_code == 403

        await community.assign_member_roles(
            "c-1", "m-mem", community.MemberRolesIn(role_ids=[]), moderator)
        entry = await db.audit_log.find_one({"action": "community.roles_assigned"})
        assert entry["metadata"]["community_id"] == "c-1"
    run_isolated(scenario)


def test_deleting_a_role_detaches_it_from_members_and_channels(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner = account("owner")
        role = await community.create_role("c-1", community.RoleIn(name="temp", rank=3), owner)
        await community.assign_member_roles(
            "c-1", "m-mem", community.MemberRolesIn(role_ids=[role["id"]]), owner)
        await community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=role["id"], deny=p.SEND_MESSAGE)], owner)

        await community.delete_role(role["id"], owner)
        member = await db.community_members.find_one({"id": "m-mem"})
        channel = await db.channels.find_one({"id": "ch-1"})
        assert role["id"] not in (member.get("role_ids") or [])
        assert channel["overwrites"] == []
    run_isolated(scenario)


# --- Channel overwrites ---

def test_denying_send_blocks_posting_but_not_reading(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")
        default = await community._ensure_default_role("c-1")
        await community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=default["id"], deny=p.SEND_MESSAGE)], owner)

        with pytest.raises(HTTPException) as muted:
            await community.create_message("ch-1", community.MessageIn(content="hello"), mem)
        assert muted.value.status_code == 403

        # Reading is untouched, and the owner ignores the deny entirely.
        assert await community.list_messages("ch-1", None, 50, mem) == []
        posted = await community.create_message("ch-1", community.MessageIn(content="owner here"), owner)
        assert posted["content"] == "owner here"
    run_isolated(scenario)


def test_denying_view_hides_the_channel_from_listings(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")
        default = await community._ensure_default_role("c-1")
        await community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=default["id"], deny=p.VIEW_CHANNEL)], owner)

        assert await community.list_channels("c-1", mem) == []
        assert [c["id"] for c in await community.list_channels("c-1", owner)] == ["ch-1"]
    run_isolated(scenario)


def test_an_allow_overwrite_restores_a_denied_bit_for_one_role(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")
        default = await community._ensure_default_role("c-1")
        coach = await community.create_role("c-1", community.RoleIn(name="coach", rank=4), owner)
        await community.set_channel_overwrites("ch-1", [
            community.OverwriteIn(role_id=default["id"], deny=p.SEND_MESSAGE),
            community.OverwriteIn(role_id=coach["id"], allow=p.SEND_MESSAGE),
        ], owner)

        with pytest.raises(HTTPException):
            await community.create_message("ch-1", community.MessageIn(content="nope"), mem)
        await community.assign_member_roles(
            "c-1", "m-mem", community.MemberRolesIn(role_ids=[coach["id"]]), owner)
        assert (await community.create_message(
            "ch-1", community.MessageIn(content="now I can"), mem))["content"] == "now I can"
    run_isolated(scenario)


# --- Message interactions ---

def test_reactions_are_idempotent_and_clear_when_empty(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        mem, mod = account("mem"), account("mod")
        message = await community.create_message("ch-1", community.MessageIn(content="PR today"), mem)

        for _ in range(3):
            await community.add_reaction(message["id"], community.ReactionIn(emoji="A"), mem)
        await community.add_reaction(message["id"], community.ReactionIn(emoji="A"), mod)
        stored = await db.messages.find_one({"id": message["id"]})
        assert [r["emoji"] for r in stored["reactions"]] == ["A"]
        assert sorted(stored["reactions"][0]["user_ids"]) == ["mem", "mod"]

        await community.remove_reaction(message["id"], "A", mem)
        await community.remove_reaction(message["id"], "A", mod)
        stored = await db.messages.find_one({"id": message["id"]})
        assert stored["reactions"] == []
    run_isolated(scenario)


def test_edit_is_author_only_and_time_boxed(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        mem, mod = account("mem"), account("mod")
        message = await community.create_message("ch-1", community.MessageIn(content="typo"), mem)

        edited = await community.edit_message(
            message["id"], community.MessageEditIn(content="fixed"), mem)
        assert edited["content"] == "fixed" and edited["edited_at"] is not None

        with pytest.raises(HTTPException) as not_author:
            await community.edit_message(
                message["id"], community.MessageEditIn(content="hijack"), mod)
        assert not_author.value.status_code == 403

        await db.messages.update_one(
            {"id": message["id"]},
            {"$set": {"created_at": server.now() - timedelta(seconds=community.EDIT_WINDOW_SECONDS + 60)}})
        with pytest.raises(HTTPException) as stale:
            await community.edit_message(
                message["id"], community.MessageEditIn(content="too late"), mem)
        assert stale.value.status_code == 409
    run_isolated(scenario)


def test_delete_is_soft_and_peers_cannot_delete_each_other(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        mem, mod, owner = account("mem"), account("mod"), account("owner")
        await db.users.insert_one(account("mem2"))
        await db.community_members.insert_one({
            "id": "m-mem2", "community_id": "c-1", "user_id": "mem2",
            "role": "member", "status": "active",
        })
        message = await community.create_message("ch-1", community.MessageIn(content="spam"), mem)

        with pytest.raises(HTTPException) as peer:
            await community.delete_message(message["id"], account("mem2"))
        assert peer.value.status_code == 403

        await community.delete_message(message["id"], mod)
        stored = await db.messages.find_one({"id": message["id"]})
        assert stored["status"] == "deleted"  # retained for moderation review
        assert await community.list_messages("ch-1", None, 50, owner) == []
        entry = await db.audit_log.find_one({"action": "community.message_deleted"})
        assert entry["metadata"]["author_id"] == "mem"
    run_isolated(scenario)


def test_replies_carry_a_parent_preview_that_drops_when_the_parent_goes(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        mem, mod = account("mem"), account("mod")
        parent = await community.create_message("ch-1", community.MessageIn(content="who is in?"), mem)
        reply = await community.create_message(
            "ch-1", community.MessageIn(content="me", reply_to_id=parent["id"]), mod)
        assert reply["reply_to"]["content"] == "who is in?"

        listed = await community.list_messages("ch-1", None, 50, mem)
        assert listed[1]["reply_to"]["id"] == parent["id"]

        await community.delete_message(parent["id"], mem)
        listed = await community.list_messages("ch-1", None, 50, mem)
        assert len(listed) == 1 and listed[0]["reply_to"] is None

        with pytest.raises(HTTPException) as missing:
            await community.create_message(
                "ch-1", community.MessageIn(content="orphan", reply_to_id="nope"), mem)
        assert missing.value.status_code == 404
    run_isolated(scenario)


def test_pins_require_the_permission_and_list_separately(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        mem, mod = account("mem"), account("mod")
        message = await community.create_message("ch-1", community.MessageIn(content="read this"), mem)

        with pytest.raises(HTTPException) as denied:
            await community.pin_message(message["id"], mem)
        assert denied.value.status_code == 403

        await community.pin_message(message["id"], mod)
        assert [m["id"] for m in await community.list_pins("ch-1", mem)] == [message["id"]]
        await community.unpin_message(message["id"], mod)
        assert await community.list_pins("ch-1", mem) == []
    run_isolated(scenario)


# --- Channel kinds ---

def test_announcement_channels_are_broadcast_only(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem, mod = account("owner"), account("mem"), account("mod")
        channel = await community.create_channel(
            "c-1", community.ChannelIn(name="news", kind="announcement"), owner)

        with pytest.raises(HTTPException) as muted:
            await community.create_message(channel["id"], community.MessageIn(content="hi"), mem)
        assert muted.value.status_code == 403
        assert (await community.create_message(
            channel["id"], community.MessageIn(content="Meet at 7"), mod))["content"] == "Meet at 7"
        # Members still see it — read access is exactly what an announcement needs.
        assert channel["id"] in [c["id"] for c in await community.list_channels("c-1", mem)]
    run_isolated(scenario)


def test_checkin_channels_accept_one_message_per_day(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")
        channel = await community.create_channel(
            "c-1", community.ChannelIn(name="daily", kind="checkin"), owner)

        await community.create_message(channel["id"], community.MessageIn(content="done"), mem)
        with pytest.raises(HTTPException) as twice:
            await community.create_message(channel["id"], community.MessageIn(content="again"), mem)
        assert twice.value.status_code == 409

        # Yesterday's check-in must not block today's.
        await db.messages.update_one(
            {"channel_id": channel["id"], "author_id": "mem"},
            # The day lives in checkin_day now; created_at alone no longer decides it.
            {"$set": {"created_at": server.now() - timedelta(days=1),
                      "checkin_day": (server.now() - timedelta(days=1)).date().isoformat()}})
        assert (await community.create_message(
            channel["id"], community.MessageIn(content="today"), mem))["content"] == "today"
    run_isolated(scenario)


def test_a_hidden_channel_cannot_be_read_or_posted_to_by_id(monkeypatch):
    """Regression: VIEW_CHANNEL once gated only the channel *list*, so a member
    who knew a hidden channel's id could read and post into it."""
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")
        default = await community._ensure_default_role("c-1")
        await community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=default["id"], deny=p.VIEW_CHANNEL)], owner)

        for attempt in (
            lambda: community.list_messages("ch-1", None, 50, mem),
            lambda: community.create_message("ch-1", community.MessageIn(content="sneak"), mem),
        ):
            with pytest.raises(HTTPException) as denied:
                await attempt()
            assert denied.value.status_code == 403

        # The owner still reads it: the deny cannot lock out the owner.
        assert await community.list_messages("ch-1", None, 50, owner) == []
    run_isolated(scenario)


def test_hiding_a_channel_also_freezes_actions_on_its_old_messages(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")
        message = await community.create_message("ch-1", community.MessageIn(content="mine"), mem)
        default = await community._ensure_default_role("c-1")
        await community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=default["id"], deny=p.VIEW_CHANNEL)], owner)

        for attempt in (
            lambda: community.edit_message(message["id"], community.MessageEditIn(content="edit"), mem),
            lambda: community.add_reaction(message["id"], community.ReactionIn(emoji="A"), mem),
            lambda: community.remove_reaction(message["id"], "A", mem),
        ):
            with pytest.raises(HTTPException) as denied:
                await attempt()
            assert denied.value.status_code == 403
    run_isolated(scenario)
