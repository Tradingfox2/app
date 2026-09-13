import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import notifications  # noqa: E402
import server  # noqa: E402
import staff  # noqa: E402
from routers import admin  # noqa: E402


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000)
        db = client[f"ironflow_admin_test_{uuid.uuid4().hex}"]
        try:
            await scenario(db)
        finally:
            await client.drop_database(db.name)  # unique throwaway DB created above
            client.close()
    asyncio.run(run())


def account(uid, **extra):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete", **extra}


def test_permission_matrix_is_least_privilege():
    assert staff.permissions_for({}) == set()
    assert staff.permissions_for({"staff_role": "support"}) < staff.permissions_for({"staff_role": "moderator"})
    assert staff.permissions_for({"staff_role": "moderator"}) < staff.permissions_for({"staff_role": "admin"})
    for permission in ("staff.manage", "users.suspend", "content.moderate"):
        assert permission not in staff.permissions_for({"staff_role": "support"})
    # A product "admin" role without a staff role grants nothing.
    assert staff.permissions_for({"role": "admin"}) == set()


def test_staff_endpoints_reject_insufficient_roles(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        await db.users.insert_many([account("target"), account("support", staff_role="support"), account("boss", staff_role="admin")])
        for permission, caller in (("users.suspend", account("support", staff_role="support")),
                                   ("staff.manage", account("support", staff_role="support")),
                                   ("users.read", account("nobody"))):
            with pytest.raises(HTTPException) as denied:
                await staff.require(permission)(caller)
            assert denied.value.status_code == 403
        assert (await staff.require("users.read")(account("support", staff_role="support")))["id"] == "support"
    run_isolated(scenario)


def test_suspension_blocks_access_and_expires(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        await db.users.insert_many([account("target"), moderator, account("boss", staff_role="admin")])
        token = server.make_token("target")
        credentials = type("C", (), {"scheme": "Bearer", "credentials": token})()
        assert (await server.current_user(credentials))["id"] == "target"

        await admin.suspend_user("target", admin.SuspensionIn(reason="Repeated harassment reports", days=7), moderator)
        with pytest.raises(HTTPException) as blocked:
            await server.current_user(credentials)
        assert blocked.value.status_code == 403 and "harassment" in blocked.value.detail

        entry = await db.audit_log.find_one({"action": "user.suspended"})
        assert entry["actor_id"] == "mod" and entry["target_id"] == "target" and entry["metadata"]["days"] == 7

        # An elapsed suspension lifts itself on the next request.
        await db.users.update_one({"id": "target"}, {"$set": {"suspended_until": datetime.now(timezone.utc) - timedelta(minutes=1)}})
        assert (await server.current_user(credentials))["id"] == "target"
        assert (await db.users.find_one({"id": "target"}))["suspended_at"] is None

        with pytest.raises(HTTPException) as self_harm:
            await admin.suspend_user("mod", admin.SuspensionIn(reason="Testing self suspension"), moderator)
        assert self_harm.value.status_code == 409
        with pytest.raises(HTTPException) as protected:
            await admin.suspend_user("boss", admin.SuspensionIn(reason="Moderator suspending an admin"), moderator)
        assert protected.value.status_code == 403
    run_isolated(scenario)


def test_staff_role_changes_are_admin_only_and_audited(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        boss = account("boss", staff_role="admin")
        await db.users.insert_many([account("target"), boss])
        updated = await admin.set_staff_role("target", admin.StaffRoleIn(staff_role="support", reason="New support hire"), boss)
        assert updated["staff_role"] == "support"
        with pytest.raises(HTTPException) as self_promo:
            await admin.set_staff_role("boss", admin.StaffRoleIn(staff_role="admin", reason="Self promote"), boss)
        assert self_promo.value.status_code == 409
        revoked = await admin.set_staff_role("target", admin.StaffRoleIn(staff_role=None, reason="Left the team"), boss)
        assert revoked["staff_role"] is None
        entries = [row async for row in db.audit_log.find({"action": "staff.role_changed"}).sort("created_at", 1)]
        assert [e["metadata"]["to"] for e in entries] == ["support", None]
    run_isolated(scenario)


def test_user_detail_never_exposes_health_data(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        await db.users.insert_one({**account("target"), "password_hash": "$2b$secret", "suspended_at": None})
        await db.biomarkers.insert_one({"id": "b1", "user_id": "target", "marker": "Ferritin", "value": 42})
        await db.lab_reports.insert_one({"id": "l1", "user_id": "target", "markers": [{"marker": "TSH"}]})
        await db.direct_messages.insert_one({"id": "d1", "sender_id": "target", "content": "private"})
        detail = await admin.user_detail("target", account("support", staff_role="support"))
        blob = str(detail)
        for secret in ("Ferritin", "TSH", "private", "password_hash", "$2b$"):
            assert secret not in blob
        assert detail["stats"]["workouts"] == 0 and detail["email"] == "target@example.invalid"
    run_isolated(scenario)


def test_report_flow_snapshots_content_and_resolves_once(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        await db.users.insert_many([account("reporter"), account("author"), moderator])
        await db.posts.insert_one({"id": "p1", "author_id": "author", "content": "Take 10x the dose", "status": "active"})
        report = await admin.create_report(admin.ReportIn(target_type="post", target_id="p1", reason="dangerous_advice", detail="Unsafe"), account("reporter"))
        assert report["content_snapshot"] == "Take 10x the dose" and report["reported_user_id"] == "author"
        # Duplicate reports from the same user do not spam the queue.
        assert (await admin.create_report(admin.ReportIn(target_type="post", target_id="p1", reason="dangerous_advice"), account("reporter")))["id"] == report["id"]
        assert len(await admin.list_reports("open", 50, moderator)) == 1

        with pytest.raises(HTTPException) as missing:
            await admin.create_report(admin.ReportIn(target_type="post", target_id="ghost", reason="spam"), account("reporter"))
        assert missing.value.status_code == 404

        with pytest.raises(HTTPException) as unauthorised:
            await staff.require("reports.resolve")(account("support", staff_role="support"))
        assert unauthorised.value.status_code == 403

        resolved = await admin.review_report(report["id"], admin.ReportReviewIn(resolution="content_removed", note="Unsafe dosing advice"), moderator)
        assert resolved["status"] == "resolved"
        assert (await db.posts.find_one({"id": "p1"}))["status"] == "deleted"
        assert await db.notifications.count_documents({"user_id": "author", "type": "moderation_action"}) == 1
        assert await db.audit_log.count_documents({"action": "report.content_removed"}) == 1
        with pytest.raises(HTTPException) as twice:
            await admin.review_report(report["id"], admin.ReportReviewIn(resolution="dismissed"), moderator)
        assert twice.value.status_code == 409
    run_isolated(scenario)


def test_overview_and_user_search(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        support = account("support", staff_role="support")
        await db.users.insert_many([
            {**account("alice"), "created_at": datetime.now(timezone.utc), "suspended_at": None},
            {**account("bob"), "created_at": datetime.now(timezone.utc), "suspended_at": datetime.now(timezone.utc)},
            {**support, "created_at": datetime.now(timezone.utc), "suspended_at": None},
        ])
        await db.reports.insert_one({"id": "r1", "status": "open", "created_at": datetime.now(timezone.utc)})
        summary = await admin.overview(support)
        assert summary["users"]["total"] == 3 and summary["users"]["suspended"] == 1
        assert summary["queues"]["open_reports"] == 1
        assert "users.suspend" not in summary["permissions"]
        assert [row["id"] for row in (await admin.list_users("alice", "all", 25, support))["users"]] == ["alice"]
        assert [row["id"] for row in (await admin.list_users(None, "suspended", 25, support))["users"]] == ["bob"]
        assert [row["id"] for row in (await admin.list_users(None, "staff", 25, support))["users"]] == ["support"]
        # Regex metacharacters in search must not blow up or match everything.
        assert (await admin.list_users(".*", "all", 25, support))["count"] == 0
    run_isolated(scenario)
