import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from community_rankings import build_rankings


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", serverSelectionTimeoutMS=3000)
        marker = uuid.uuid4().hex
        db = client[f"ironflow_rankings_test_{marker}"]
        collections = set()

        async def seed(collection, *rows):
            collections.add(collection)
            await db[collection].insert_many([{**row, "test_run": marker} for row in rows])

        try:
            await scenario(db, seed)
        finally:
            # Exact test-run scope only. Never touch the live ironflow database.
            for collection in collections:
                await db[collection].delete_many({"test_run": marker})
            client.close()
    asyncio.run(run())


def test_activity_requires_both_consents_and_active_public_membership():
    async def scenario(db, seed):
        timestamp = datetime.now(timezone.utc)
        await seed("users", {"id": "owner", "full_name": "Owner"},
                   {"id": "member", "full_name": "Member", "email": "private@example.invalid"})
        await seed("communities", {"id": "group", "owner_id": "owner", "name": "Group", "status": "active", "is_public": True})
        await seed("channels", {"id": "channel", "community_id": "group", "name": "training", "status": "active"})
        await seed("community_members", {"id": "membership", "user_id": "member", "community_id": "group", "status": "active"})
        await seed("messages", *[
            {"id": str(i), "author_id": "member", "channel_id": "channel", "status": "active", "content": "private message", "created_at": timestamp - timedelta(days=days)}
            for i, days in enumerate([0, 0, 1, 31])
        ])
        assert (await build_rankings(db, timestamp))["users"] == []
        await db.users.update_one({"id": "member"}, {"$set": {"activity_ranking_opt_in": True}})
        assert (await build_rankings(db, timestamp))["users"] == []
        await db.channels.update_one({"id": "channel"}, {"$set": {"ranking_opt_in": True}})
        result = await build_rankings(db, timestamp)
        assert result["users"] == [{"id": "member", "full_name": "Member", "avatar_url": None, "active_days": 2}]
        assert result["channels"][0]["contributors"] == 1
        assert "private message" not in str(result) and "private@example.invalid" not in str(result)
        # Every exclusion is enforced at read time, including immediate opt-out.
        for collection, identifier, field, excluded, restored in [
            ("users", "member", "activity_ranking_opt_in", False, True),
            ("channels", "channel", "ranking_opt_in", False, True),
            ("channels", "channel", "status", "archived", "active"),
            ("communities", "group", "is_public", False, True),
            ("communities", "group", "status", "archived", "active"),
            ("community_members", "membership", "status", "banned", "active"),
            ("community_members", "membership", "status", "left", "active"),
        ]:
            await db[collection].update_one({"id": identifier}, {"$set": {field: excluded}})
            result = await build_rankings(db, timestamp)
            assert result["users"] == [] and result["channels"] == [], (collection, field)
            await db[collection].update_one({"id": identifier}, {"$set": {field: restored}})
    run_isolated(scenario)


def test_rankings_aggregate_before_limit_and_break_ties_by_id():
    async def scenario(db, seed):
        await seed("users", {"id": "owner", "full_name": "Owner"})
        await seed("communities", *[{"id": f"group-{i:03}", "name": f"Group {i}", "owner_id": "owner", "status": "active", "is_public": True} for i in range(105)])
        await seed("community_members", {"id": "a", "community_id": "group-104", "status": "active"}, {"id": "b", "community_id": "group-103", "status": "active"})
        result = await build_rankings(db, datetime.now(timezone.utc))
        assert [row["id"] for row in result["communities"][:3]] == ["group-103", "group-104", "group-000"]
        assert result["coaches"][0]["community_count"] == 105
        assert len(result["communities"]) == 10
    run_isolated(scenario)


def test_paid_approval_and_policy_migration_are_blocked(monkeypatch):
    os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
    import server  # noqa: F401 — application entry point owns router registration
    from routers import community

    async def scenario(db, seed):
        monkeypatch.setattr(community, "db", db)
        await seed("communities", {"id": "paid", "owner_id": "owner", "status": "active", "join_policy": "paid", "price_cents": 1900})
        await seed("community_members", {"id": "owner-member", "user_id": "owner", "community_id": "paid", "status": "active", "role": "owner"},
                   {"id": "pending", "user_id": "member", "community_id": "paid", "status": "pending", "role": "member"})
        with pytest.raises(HTTPException) as denied:
            await community.review_membership("paid", "pending", community.MembershipReviewIn(status="active"), {"id": "owner"})
        assert denied.value.status_code == 402
        assert (await db.community_members.find_one({"id": "pending"}))["status"] == "pending"
        with pytest.raises(HTTPException) as migration:
            await community.update_community("paid", community.CommunityUpdateIn(join_policy="open", price_cents=0), {"id": "owner"})
        assert migration.value.status_code == 409
    run_isolated(scenario)


def test_channel_publication_manager_only_and_profile_patch_preserves_locale(monkeypatch):
    os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
    import server
    from routers import community

    async def scenario(db, seed):
        monkeypatch.setattr(community, "db", db)
        monkeypatch.setattr(server, "db", db)
        await seed("users", {"id": "owner", "email": "owner@example.com", "preferred_locale": "de"})
        await seed("communities", {"id": "group", "status": "active", "is_public": False})
        await seed("channels", {"id": "channel", "community_id": "group", "status": "active"})
        await seed("community_members", {"id": "owner-member", "user_id": "owner", "community_id": "group", "status": "active", "role": "owner"})
        for user_id, expected in [("outsider", 403), ("owner", 409)]:
            with pytest.raises(HTTPException) as denied:
                await community.update_channel_ranking("channel", community.ChannelRankingIn(ranking_opt_in=True), {"id": user_id})
            assert denied.value.status_code == expected
        await db.communities.update_one({"id": "group"}, {"$set": {"is_public": True}})
        result = await community.update_channel_ranking("channel", community.ChannelRankingIn(ranking_opt_in=True), {"id": "owner"})
        assert result["ranking_opt_in"] is True
        updated = await server.update_me(server.ProfileUpdateIn(activity_ranking_opt_in=True), {"id": "owner"})
        assert updated.activity_ranking_opt_in is True and updated.preferred_locale == "de"
        updated = await server.update_me(server.ProfileUpdateIn(preferred_locale="it"), {"id": "owner"})
        assert updated.activity_ranking_opt_in is True and updated.preferred_locale == "it"
    run_isolated(scenario)


def test_plan_selection_cannot_mint_paid_access_or_cancel_provider_subscription(monkeypatch):
    os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
    import server

    async def scenario(db, seed):
        monkeypatch.setattr(server, "db", db)
        for plan in ("pro", "elite", "coach"):
            with pytest.raises(HTTPException) as denied:
                await server.upsert_sub(server.SubscriptionIn(plan=plan), {"id": "member"})
            assert denied.value.status_code == 402
        assert await db.subscriptions.count_documents({}) == 0
        assert await server.upsert_sub(server.SubscriptionIn(plan="free"), {"id": "member"}) == {"plan": "free", "status": "active"}
        await seed("subscriptions", {"id": "verified-sub", "user_id": "member", "plan": "pro", "status": "active", "provider": "stripe"})
        with pytest.raises(HTTPException) as denied:
            await server.upsert_sub(server.SubscriptionIn(plan="free"), {"id": "member"})
        assert denied.value.status_code == 409
        assert (await db.subscriptions.find_one({"id": "verified-sub"}))["status"] == "active"
    run_isolated(scenario)