"""The notification center: scoping, read state, and mention resolution.

Notifications carry moderation outcomes and mentions, so the scoping test is a
privacy test — one member must never read another's.
"""
import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import notifications  # noqa: E402
import server  # noqa: E402
from routers import community  # noqa: E402
from routers import notifications as notifications_router  # noqa: E402
from tests.test_community_permissions import account, run_isolated, seed  # noqa: E402


async def seed_notifications(db, monkeypatch):
    await seed(db, monkeypatch)
    monkeypatch.setattr(notifications, "db", db)
    monkeypatch.setattr(notifications_router, "db", db)
    import social_graph
    monkeypatch.setattr(social_graph, "db", db)  # notify() checks blocks


def test_notifications_are_scoped_to_their_owner(monkeypatch):
    async def scenario(db):
        await seed_notifications(db, monkeypatch)
        await notifications.create("mem", "mention", "Someone mentioned you")
        await notifications.create("mod", "mention", "A different member's business")

        rows = await notifications_router.list_notifications(False, 30, account("mem"))
        assert [row["title"] for row in rows] == ["Someone mentioned you"]
    run_isolated(scenario)


def test_unread_count_and_mark_read(monkeypatch):
    async def scenario(db):
        await seed_notifications(db, monkeypatch)
        first = await notifications.create("mem", "mention", "One")
        await notifications.create("mem", "mention", "Two")
        mem = account("mem")

        assert (await notifications_router.unread_count(mem))["count"] == 2
        marked = await notifications_router.mark_read(first["id"], mem)
        assert marked["read_at"] is not None
        assert (await notifications_router.unread_count(mem))["count"] == 1

        # Marking twice is not an error — a double tap must not 404, and must
        # not move the original timestamp. (Compared through storage: Mongo
        # truncates to milliseconds, so the in-memory value differs in µs.)
        stored = (await db.notifications.find_one({"id": first["id"]}))["read_at"]
        again = await notifications_router.mark_read(first["id"], mem)
        assert again["read_at"] is not None
        assert (await db.notifications.find_one({"id": first["id"]}))["read_at"] == stored

        unread = await notifications_router.list_notifications(True, 30, mem)
        assert [row["title"] for row in unread] == ["Two"]
    run_isolated(scenario)


def test_cannot_mark_another_members_notification_read(monkeypatch):
    async def scenario(db):
        await seed_notifications(db, monkeypatch)
        theirs = await notifications.create("mod", "mention", "Not yours")
        with pytest.raises(HTTPException) as denied:
            await notifications_router.mark_read(theirs["id"], account("mem"))
        assert denied.value.status_code == 404  # not 403: do not confirm it exists
    run_isolated(scenario)


def test_read_all_clears_only_the_callers_unread(monkeypatch):
    async def scenario(db):
        await seed_notifications(db, monkeypatch)
        for _ in range(3):
            await notifications.create("mem", "mention", "Mine")
        await notifications.create("mod", "mention", "Theirs")

        result = await notifications_router.mark_all_read(account("mem"))
        assert result["updated"] == 3
        assert (await notifications_router.unread_count(account("mem")))["count"] == 0
        assert (await notifications_router.unread_count(account("mod")))["count"] == 1
    run_isolated(scenario)


def test_a_mention_produces_a_notification_the_center_returns(monkeypatch):
    """End to end: the feature that was previously invisible."""
    async def scenario(db):
        await seed_notifications(db, monkeypatch)
        import moderation
        monkeypatch.setattr(moderation, "db", db)

        await community.create_message(
            "ch-1", community.MessageIn(content="spot me <@mod>"), account("mem"))

        rows = await notifications_router.list_notifications(True, 30, account("mod"))
        assert len(rows) == 1
        assert rows[0]["type"] == "mention"
        assert rows[0]["metadata"]["channel_id"] == "ch-1"
        assert rows[0]["metadata"]["actor_id"] == "mem"
    run_isolated(scenario)


def test_messages_carry_display_names_for_their_mentions(monkeypatch):
    async def scenario(db):
        await seed_notifications(db, monkeypatch)
        import moderation
        monkeypatch.setattr(moderation, "db", db)

        created = await community.create_message(
            "ch-1", community.MessageIn(content="<@mod> and <@mem> in?"), account("mem"))
        assert sorted(row["id"] for row in created["mentions"]) == ["mem", "mod"]
        assert all(row.get("full_name") for row in created["mentions"])

        listed = await community.list_messages("ch-1", None, 50, account("mem"))
        assert sorted(row["id"] for row in listed[0]["mentions"]) == ["mem", "mod"]
    run_isolated(scenario)


def test_unknown_mention_ids_resolve_to_nothing(monkeypatch):
    async def scenario(db):
        await seed_notifications(db, monkeypatch)
        assert await notifications.resolve_mentions("hello <@ghost>") == []
        assert await notifications.resolve_mentions("no mentions here") == []
    run_isolated(scenario)
