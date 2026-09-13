"""Channel rename/archive, community archive, and the member-removal guard."""
import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import permissions as p  # noqa: E402
import server  # noqa: E402,F401 - must load before staff, which imports from it
import staff  # noqa: E402,F401
from routers import community  # noqa: E402
from tests.test_community_permissions import account, run_isolated, seed  # noqa: E402


# --- Channel rename ---

def test_rename_normalises_the_slug_like_creation_does(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner = account("owner")
        channel = await community.create_channel("c-1", community.ChannelIn(name="squad"), owner)

        updated = await community.update_channel(
            channel["id"], community.ChannelUpdateIn(name="Leg  Day!!"), owner)
        assert updated["name"] == "leg-day"

        # A rename must not be able to produce a name creation would reject.
        with pytest.raises(Exception):
            community.ChannelUpdateIn(name="!!")
    run_isolated(scenario)


def test_rename_requires_manage_channel(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        with pytest.raises(HTTPException) as denied:
            await community.update_channel(
                "ch-1", community.ChannelUpdateIn(name="hijacked"), account("mem"))
        assert denied.value.status_code == 403
    run_isolated(scenario)


def test_empty_update_is_a_no_op_rather_than_an_error(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        unchanged = await community.update_channel(
            "ch-1", community.ChannelUpdateIn(), account("owner"))
        assert unchanged["name"] == "general"
    run_isolated(scenario)


# --- Channel archive ---

def test_archiving_hides_the_channel_but_keeps_its_messages(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner, mem = account("owner"), account("mem")
        channel = await community.create_channel("c-1", community.ChannelIn(name="temp"), owner)
        message = await community.create_message(
            channel["id"], community.MessageIn(content="still here"), mem)

        await community.archive_channel(channel["id"], owner)
        assert channel["id"] not in [c["id"] for c in await community.list_channels("c-1", owner)]
        # The room is gone from the list; the history is not destroyed.
        assert await db.messages.find_one({"id": message["id"]}) is not None
        entry = await db.audit_log.find_one({"action": "community.channel_archived"})
        assert entry["metadata"]["community_id"] == "c-1"
    run_isolated(scenario)


def test_the_default_channel_cannot_be_archived(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        with pytest.raises(HTTPException) as protected:
            await community.archive_channel("ch-1", account("owner"))
        assert protected.value.status_code == 409
    run_isolated(scenario)


def test_archiving_requires_manage_channel(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        channel = await community.create_channel(
            "c-1", community.ChannelIn(name="temp"), account("owner"))
        with pytest.raises(HTTPException) as denied:
            await community.archive_channel(channel["id"], account("mem"))
        assert denied.value.status_code == 403
    run_isolated(scenario)


# --- Community archive ---

def test_only_the_owner_can_archive_a_community(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        # A moderator manages plenty, but not the community's existence.
        with pytest.raises(HTTPException) as denied:
            await community.archive_community("c-1", account("mod"))
        assert denied.value.status_code == 403

        await community.archive_community("c-1", account("owner"))
        with pytest.raises(HTTPException) as gone:
            await community._community_or_404("c-1")
        assert gone.value.status_code == 404
        assert await db.audit_log.find_one({"action": "community.archived"}) is not None
    run_isolated(scenario)


# --- Member removal ---

def test_banning_needs_kick_member_while_join_review_needs_manage_channel(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        owner = account("owner")
        # A role that can manage channels but explicitly cannot remove people.
        role = await community.create_role("c-1", community.RoleIn(
            name="editor", rank=3, permissions=p.DEFAULT_MEMBER | p.MANAGE_CHANNEL), owner)
        await community.assign_member_roles(
            "c-1", "m-mem", community.MemberRolesIn(role_ids=[role["id"]]), owner)

        await db.community_members.insert_one({
            "id": "m-target", "community_id": "c-1", "user_id": "out",
            "role": "member", "status": "pending",
        })
        mem = account("mem")
        # Join review is allowed...
        reviewed = await community.review_membership(
            "c-1", "m-target", community.MembershipReviewIn(status="rejected"), mem)
        assert reviewed["status"] == "rejected"
        # ...but removing someone is not.
        with pytest.raises(HTTPException) as denied:
            await community.review_membership(
                "c-1", "m-target", community.MembershipReviewIn(status="banned"), mem)
        assert denied.value.status_code == 403

        banned = await community.review_membership(
            "c-1", "m-target", community.MembershipReviewIn(status="banned"), owner)
        assert banned["status"] == "banned"
    run_isolated(scenario)


def test_the_owner_can_never_be_removed_from_their_own_community(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        with pytest.raises(HTTPException) as protected:
            await community.review_membership(
                "c-1", "m-owner", community.MembershipReviewIn(status="banned"), account("owner"))
        assert protected.value.status_code == 409
    run_isolated(scenario)
