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
        self_row = await db.audit_log.find_one({"action": "user.suspended", "outcome": "denied", "target_id": "mod"})
        assert self_row["reason_code"] == "self_target" and self_row["reason"] is None
        assert "Testing self suspension" not in str(self_row)
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
        entries = [row async for row in db.audit_log.find(
            {"action": "staff.role_changed", "outcome": "success"},
        ).sort("created_at", 1)]
        assert [e["metadata"]["to"] for e in entries] == ["support", None]
        denied = await db.audit_log.find_one({"action": "staff.role_changed", "outcome": "denied"})
        assert denied["reason_code"] == "self_target" and denied["reason"] is None
        assert "Self promote" not in str(denied)
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
        import moderation
        import social_graph
        from routers import social
        # Removal goes through moderation; the visibility gate through social.
        for module in (moderation, social, social_graph, server):
            monkeypatch.setattr(module, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        await db.users.insert_many([account("reporter"), account("author"), moderator])
        await db.posts.insert_one({"id": "p1", "author_id": "author", "content": "Take 10x the dose", "status": "active"})
        report = await admin.create_report(admin.ReportIn(target_type="post", target_id="p1", reason="dangerous_advice", detail="Unsafe"), account("reporter"))
        # The reporter gets a receipt; the snapshot is for moderators only.
        assert "content_snapshot" not in report and "reported_user_id" not in report
        stored = await db.reports.find_one({"id": report["id"]})
        assert stored["content_snapshot"] == "Take 10x the dose" and stored["reported_user_id"] == "author"
        # Duplicate reports from the same user do not spam the queue.
        assert (await admin.create_report(admin.ReportIn(target_type="post", target_id="p1", reason="dangerous_advice"), account("reporter")))["id"] == report["id"]
        page = await admin.list_reports("open", 50, moderator)
        assert page["total"] == 1 and len(page["reports"]) == 1 and page["next_cursor"] is None

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
        await db.tickets.insert_many([
            {"id": "t-open", "status": "open"},
            {"id": "t-pending", "status": "pending"},
            {"id": "t-closed", "status": "closed"},
        ])
        summary = await admin.overview(support)
        assert summary["users"]["total"] == 3 and summary["users"]["suspended"] == 1
        assert summary["queues"]["open_reports"] == 1
        assert summary["queues"]["open_tickets"] == 1
        assert summary["queues"]["pending_tickets"] == 1
        assert "users.suspend" not in summary["permissions"]
        assert [row["id"] for row in (await admin.list_users("alice", "all", 25, support))["users"]] == ["alice"]
        assert [row["id"] for row in (await admin.list_users(None, "suspended", 25, support))["users"]] == ["bob"]
        assert [row["id"] for row in (await admin.list_users(None, "staff", 25, support))["users"]] == ["support"]
        # Regex metacharacters in search must not blow up or match everything.
        assert (await admin.list_users(".*", "all", 25, support))["count"] == 0
        assert (await admin.list_users(None, "all", 25, support))["total"] == 3
    run_isolated(scenario)


def test_user_pages_expose_the_total_and_do_not_repeat(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(staff, "db", db)
        support = account("support", staff_role="support")
        stamps = [datetime(2026, 1, day, tzinfo=timezone.utc) for day in (1, 2, 3)]
        await db.users.insert_many([
            {**account("a"), "created_at": stamps[0], "suspended_at": None},
            {**account("b"), "created_at": stamps[1], "suspended_at": None},
            {**account("c"), "created_at": stamps[2], "suspended_at": None},
            {**support, "created_at": datetime(2026, 1, 4, tzinfo=timezone.utc), "suspended_at": None},
        ])
        first = await admin.list_users(None, "all", 2, support)
        assert first["total"] == 4 and first["count"] == 2 and first["next_cursor"]
        second = await admin.list_users(None, "all", 2, support, cursor=first["next_cursor"])
        seen = {row["id"] for row in first["users"]} | {row["id"] for row in second["users"]}
        assert seen == {"a", "b", "c", "support"}
        assert len(first["users"]) + len(second["users"]) == 4
    run_isolated(scenario)


def test_open_reports_sort_by_urgency_then_age(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        older = datetime(2026, 1, 1, tzinfo=timezone.utc)
        newer = datetime(2026, 6, 1, tzinfo=timezone.utc)
        await db.reports.insert_many([
            {"id": "spam", "status": "open", "reason": "spam", "target_type": "post", "created_at": older, "reporter_id": "r", "reported_user_id": "a"},
            {"id": "violence-new", "status": "open", "reason": "violence", "target_type": "post", "created_at": newer, "reporter_id": "r", "reported_user_id": "a"},
            {"id": "violence-old", "status": "open", "reason": "violence", "target_type": "post", "created_at": older, "reporter_id": "r", "reported_user_id": "a"},
        ])
        page = await admin.list_reports("open", 2, moderator)
        assert [row["id"] for row in page["reports"]] == ["violence-old", "violence-new"]
        assert page["total"] == 3 and page["next_cursor"]
        rest = await admin.list_reports("open", 2, moderator, cursor=page["next_cursor"])
        assert [row["id"] for row in rest["reports"]] == ["spam"]
        assert rest["next_cursor"] is None
    run_isolated(scenario)


def test_user_suspended_resolution_suspends_and_a_moderator_cannot_suspend_staff(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        boss = account("boss", staff_role="admin")
        await db.users.insert_many([account("author"), moderator, boss])
        await db.reports.insert_one({
            "id": "r-user", "status": "open", "reason": "harassment", "target_type": "user",
            "target_id": "author", "reported_user_id": "author", "reporter_id": "mod",
            "created_at": datetime.now(timezone.utc),
        })
        with pytest.raises(HTTPException) as short:
            await admin.review_report("r-user", admin.ReportReviewIn(resolution="user_suspended", note="too short"), moderator)
        assert short.value.status_code == 422
        short_row = await db.audit_log.find_one({"action": "report.user_suspended", "outcome": "failed"})
        assert short_row["reason_code"] == "reason_too_short" and short_row["reason"] is None
        assert "too short" not in str(short_row)
        assert (await db.users.find_one({"id": "author"})).get("suspended_at") is None
        assert (await db.reports.find_one({"id": "r-user"}))["status"] == "open"

        resolved = await admin.review_report(
            "r-user", admin.ReportReviewIn(resolution="user_suspended", note="Repeated public harassment"), moderator,
        )
        assert resolved["status"] == "resolved" and resolved["resolution"] == "user_suspended"
        author = await db.users.find_one({"id": "author"})
        assert author["suspended_at"] is not None and "harassment" in author["suspension_reason"]
        assert await db.audit_log.count_documents({"action": "user.suspended", "target_id": "author"}) == 1
        assert await db.audit_log.count_documents({"action": "report.user_suspended", "outcome": "success"}) == 1

        await db.reports.insert_one({
            "id": "r-staff", "status": "open", "reason": "harassment", "target_type": "user",
            "target_id": "boss", "reported_user_id": "boss", "reporter_id": "mod",
            "created_at": datetime.now(timezone.utc),
        })
        with pytest.raises(HTTPException) as denied:
            await admin.review_report("r-staff", admin.ReportReviewIn(resolution="user_suspended", note="Trying to suspend staff"), moderator)
        assert denied.value.status_code == 403
        staff_row = await db.audit_log.find_one({"action": "report.user_suspended", "outcome": "denied"})
        assert staff_row["reason_code"] == "staff_target" and "Trying to suspend staff" not in str(staff_row)
        assert (await db.reports.find_one({"id": "r-staff"}))["status"] == "open"
        assert (await db.users.find_one({"id": "boss"})).get("suspended_at") is None
    run_isolated(scenario)


def test_lost_report_claim_does_not_suspend(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        await db.users.insert_many([account("author"), moderator])
        await db.reports.insert_one({
            "id": "r-race", "status": "open", "reason": "harassment", "target_type": "user",
            "target_id": "author", "reported_user_id": "author", "reporter_id": "mod",
            "created_at": datetime.now(timezone.utc),
        })

        class Reports:
            def __init__(self, real):
                self.real = real

            def __getattr__(self, name):
                return getattr(self.real, name)

            async def update_one(self, query, update, *args, **kwargs):
                if query.get("status") == "open":
                    return type("Result", (), {"modified_count": 0})()
                return await self.real.update_one(query, update, *args, **kwargs)

        class Database:
            def __init__(self, real):
                self.real = real
                self.reports = Reports(real.reports)

            def __getattr__(self, name):
                return getattr(self.real, name)

        monkeypatch.setattr(admin, "db", Database(db))
        before = await db.audit_log.count_documents({})
        with pytest.raises(HTTPException) as lost:
            await admin.review_report(
                "r-race", admin.ReportReviewIn(resolution="user_suspended", note="Repeated public harassment"), moderator,
            )
        assert lost.value.status_code == 409
        assert (await db.users.find_one({"id": "author"})).get("suspended_at") is None
        assert await db.audit_log.count_documents({}) == before
        assert (await db.reports.find_one({"id": "r-race"}))["status"] == "open"
    run_isolated(scenario)


def test_moderator_cannot_reinstate_staff_and_last_admin_stays(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        boss = account("boss", staff_role="admin", suspended_at=datetime.now(timezone.utc))
        other = account("other", staff_role="admin")
        await db.users.insert_many([moderator, boss, other])
        with pytest.raises(HTTPException) as denied:
            await admin.reinstate_user("boss", admin.ReinstateIn(reason="Moderator lifting an admin"), moderator)
        assert denied.value.status_code == 403
        assert (await db.users.find_one({"id": "boss"}))["suspended_at"] is not None
        restored = await admin.reinstate_user("boss", admin.ReinstateIn(reason="Admin lifts the suspension"), other)
        assert restored["suspended_at"] is None
        entry = await db.audit_log.find_one({"action": "user.reinstated", "target_id": "boss", "outcome": "success"})
        assert entry["metadata"]["from"] == "suspended" and entry["metadata"]["to"] == "active"
        denied_row = await db.audit_log.find_one({"action": "user.reinstated", "outcome": "denied"})
        assert denied_row["reason_code"] == "staff_target" and "Moderator lifting an admin" not in str(denied_row)
    run_isolated(scenario)


def test_membership_review_hides_stripe_ids(monkeypatch):
    async def scenario(db):
        import social_graph
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        monkeypatch.setattr(social_graph, "db", db)
        moderator = account("mod", staff_role="moderator")
        member = account("member")
        await db.users.insert_many([moderator, member])
        await db.communities.insert_one({"id": "c1", "name": "Crew", "join_policy": "request", "status": "active"})
        await db.community_members.insert_one({
            "id": "m1", "community_id": "c1", "user_id": "member", "status": "pending", "role": "member",
            "stripe_customer_id": "cus_secret", "stripe_subscription_id": "sub_secret",
            "created_at": datetime.now(timezone.utc),
        })
        updated = await admin.review_membership(
            "m1", admin.MembershipDecisionIn(status="active", reason="Checked the request"), moderator,
        )
        assert updated["status"] == "active"
        assert "stripe_customer_id" not in updated and "stripe_subscription_id" not in updated
        stored = await db.community_members.find_one({"id": "m1"})
        assert stored["stripe_customer_id"] == "cus_secret"
    run_isolated(scenario)


def test_audit_log_filters_and_pages(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(staff, "db", db)
        actor = account("mod", staff_role="moderator")
        other = account("boss", staff_role="admin")
        await staff.audit(actor, "user.suspended", target_type="user", target_id="a", reason="one",
                          metadata={"from": "active", "to": "suspended"})
        await staff.audit(other, "staff.role_changed", target_type="user", target_id="b", reason="two",
                          metadata={"from": None, "to": "support"})
        await db.audit_log.update_one({"action": "user.suspended"}, {"$set": {"created_at": datetime(2026, 1, 2, tzinfo=timezone.utc)}})
        await db.audit_log.update_one({"action": "staff.role_changed"}, {"$set": {"created_at": datetime(2026, 3, 2, tzinfo=timezone.utc)}})
        page = await admin.audit_log(limit=1, user=actor, action="user.")
        assert page["total"] == 1 and page["entries"][0]["action"] == "user.suspended" and page["next_cursor"] is None
        by_actor = await admin.audit_log(limit=10, user=actor, actor="boss@example.invalid")
        assert by_actor["total"] == 1 and by_actor["entries"][0]["action"] == "staff.role_changed"
        early = await admin.audit_log(limit=10, user=actor, to=datetime(2026, 2, 1, tzinfo=timezone.utc))
        assert [row["action"] for row in early["entries"]] == ["user.suspended"]
        everything = await admin.audit_log(limit=1, user=actor)
        assert everything["total"] == 2 and everything["next_cursor"]
        rest = await admin.audit_log(limit=1, user=actor, cursor=everything["next_cursor"])
        assert {everything["entries"][0]["id"], rest["entries"][0]["id"]} == {
            (await db.audit_log.find_one({"action": "user.suspended"}))["id"],
            (await db.audit_log.find_one({"action": "staff.role_changed"}))["id"],
        }
        succeeded = await admin.audit_log(limit=10, user=actor, outcome="success")
        assert succeeded["total"] == 2
        failed_page = await admin.audit_log(limit=10, user=actor, outcome="failed")
        assert failed_page["total"] == 0 and failed_page["entries"] == []
    run_isolated(scenario)


def test_staff_note_is_audited_without_the_note_text(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(staff, "db", db)
        support = account("support", staff_role="support")
        await db.users.insert_one(account("target"))
        await admin.add_note("target", admin.NoteIn(note="Private staff observation about billing"), support)
        entry = await db.audit_log.find_one({"action": "user.note_added", "target_id": "target"})
        assert entry["actor_id"] == "support"
        assert "Private staff observation" not in str(entry)
        assert (await db.user_notes.find_one({"user_id": "target"}))["note"] == "Private staff observation about billing"
        with pytest.raises(HTTPException) as missing:
            await admin.add_note("missing", admin.NoteIn(note="Do not store this sentence"), support)
        assert missing.value.status_code == 404
        failed = await db.audit_log.find_one({"action": "user.note_added", "outcome": "failed"})
        assert failed["reason_code"] == "not_found" and failed["reason"] is None
        assert "Do not store this sentence" not in str(failed)
        assert await db.user_notes.count_documents({"user_id": "missing"}) == 0
    run_isolated(scenario)


def test_coach_directory_pages_past_100(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(staff, "db", db)
        boss = account("boss", staff_role="admin")
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        await db.coach_applications.insert_many([
            {
                "id": f"app-{index:03d}",
                "user_id": f"u-{index:03d}",
                "status": "pending",
                "created_at": base + timedelta(seconds=index),
            }
            for index in range(205)
        ])
        seen: set[str] = set()
        cursor = None
        pages = 0
        while True:
            page = await admin.list_coach_directory("pending", 100, boss, cursor=cursor)
            assert page["total"] == 205
            ids = [row["application_id"] for row in page["coaches"]]
            assert ids and seen.isdisjoint(ids)
            seen.update(ids)
            pages += 1
            cursor = page["next_cursor"]
            if not cursor:
                break
            assert pages < 5
        assert pages == 3 and seen == {f"app-{index:03d}" for index in range(205)}
        assert [row["application_id"] for row in (await admin.list_coach_directory("pending", 2, boss))["coaches"]] == ["app-000", "app-001"]

        await db.users.insert_many([
            {
                **account(f"coach-{index:03d}", role="coach", coach_status="approved"),
                "created_at": base + timedelta(seconds=index),
                "suspended_at": None,
            }
            for index in range(205)
        ])
        approved_seen: set[str] = set()
        cursor = None
        pages = 0
        while True:
            page = await admin.list_coach_directory("approved", 100, boss, cursor=cursor)
            assert page["total"] == 205
            ids = [row["user_id"] for row in page["coaches"]]
            assert ids and approved_seen.isdisjoint(ids)
            approved_seen.update(ids)
            pages += 1
            cursor = page["next_cursor"]
            if not cursor:
                break
            assert pages < 5
        assert pages == 3 and approved_seen == {f"coach-{index:03d}" for index in range(205)}
        # Newest first on the approved branch.
        assert (await admin.list_coach_directory("approved", 1, boss))["coaches"][0]["user_id"] == "coach-204"
    run_isolated(scenario)


def test_failed_side_effect_is_partial_and_retryable(monkeypatch):
    async def scenario(db):
        import moderation
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(moderation, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        await db.users.insert_many([account("author"), moderator])
        await db.posts.insert_one({"id": "p1", "author_id": "author", "content": "Take 10x the dose", "status": "active"})
        await db.reports.insert_one({
            "id": "r-partial", "status": "open", "reason": "dangerous_advice", "target_type": "post",
            "target_id": "p1", "reported_user_id": "author", "reporter_id": "mod",
            "content_snapshot": "Take 10x the dose", "created_at": datetime.now(timezone.utc),
        })

        async def boom(*_args, **_kwargs):
            raise RuntimeError("storage down: Take 10x the dose")

        monkeypatch.setattr(admin.moderation, "remove_content", boom)
        resolved = await admin.review_report(
            "r-partial", admin.ReportReviewIn(resolution="content_removed", note="Unsafe dosing advice"), moderator,
        )
        assert resolved["status"] == "resolved" and resolved["resolution_status"] == "partial"
        assert resolved["side_effect_error"] == "content_removal_failed"
        assert resolved["retry_claimable"] is True
        stored = await db.reports.find_one({"id": "r-partial"})
        assert stored["resolution_status"] == "partial"
        assert "storage down" not in str(stored) and "Take 10x the dose" not in str({
            key: stored[key] for key in stored if key != "content_snapshot"
        })
        audit = await db.audit_log.find_one({"action": "report.content_removed"})
        assert audit["actor_id"] == "mod" and audit["metadata"]["report_id"] == "r-partial"
        assert audit["metadata"]["from"] == "open" and audit["metadata"]["to"] == "content_removed"
        assert "Take 10x the dose" not in str(audit)
        assert (await db.posts.find_one({"id": "p1"}))["status"] == "active"
        assert await db.notifications.count_documents({"type": "moderation_action"}) == 0

        async def remove(target_type, target_id, *, actor):
            stored_mid = await db.reports.find_one({"id": "r-partial"})
            assert stored_mid["resolution_status"] == "retrying"
            with pytest.raises(HTTPException) as overlap:
                await admin.retry_report_side_effect("r-partial", moderator)
            assert overlap.value.status_code == 409
            await db.posts.update_one({"id": target_id}, {"$set": {"status": "deleted"}})
            return True

        monkeypatch.setattr(admin.moderation, "remove_content", remove)
        retried = await admin.retry_report_side_effect("r-partial", moderator)
        assert retried["resolution_status"] == "complete" and retried["side_effect_error"] is None
        assert (await db.posts.find_one({"id": "p1"}))["status"] == "deleted"
        assert await db.notifications.count_documents({"user_id": "author", "type": "moderation_action"}) == 1
        retry_audit = await db.audit_log.find_one({"action": "report.side_effect_retried"})
        assert retry_audit["metadata"]["from"] == "partial" and retry_audit["metadata"]["to"] == "complete"
        assert "Take 10x the dose" not in str(retry_audit)
        with pytest.raises(HTTPException) as done:
            await admin.retry_report_side_effect("r-partial", moderator)
        assert done.value.status_code == 409
        finished = await db.audit_log.find_one({"action": "report.side_effect_retried", "outcome": "failed"})
        assert finished["reason_code"] == "not_retryable" and finished["reason"] is None
        assert await db.notifications.count_documents({"user_id": "author", "type": "moderation_action"}) == 1
    run_isolated(scenario)


def test_stale_retry_lease_can_be_reclaimed(monkeypatch):
    async def scenario(db):
        import moderation
        monkeypatch.setattr(admin, "db", db)
        monkeypatch.setattr(moderation, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moderator = account("mod", staff_role="moderator")
        await db.users.insert_many([account("author"), moderator])
        await db.posts.insert_one({"id": "p1", "author_id": "author", "content": "hello", "status": "active"})
        await db.reports.insert_one({
            "id": "r-lease", "status": "resolved", "resolution": "content_removed",
            "resolution_status": "retrying", "side_effect_lease_at": datetime.now(timezone.utc),
            "note": "Unsafe dosing advice", "reason": "dangerous_advice", "target_type": "post",
            "target_id": "p1", "reported_user_id": "author", "reporter_id": "mod",
            "created_at": datetime.now(timezone.utc),
        })
        calls = {"n": 0}

        async def remove(*_args, **_kwargs):
            calls["n"] += 1
            await db.posts.update_one({"id": "p1"}, {"$set": {"status": "deleted"}})
            return True

        monkeypatch.setattr(admin.moderation, "remove_content", remove)
        listed = await admin.list_reports("resolved", 10, moderator)
        fresh_row = next(row for row in listed["reports"] if row["id"] == "r-lease")
        assert fresh_row["retry_claimable"] is False
        with pytest.raises(HTTPException) as fresh:
            await admin.retry_report_side_effect("r-lease", moderator)
        assert fresh.value.status_code == 409
        assert calls["n"] == 0
        assert await db.audit_log.count_documents({"action": "report.side_effect_retried"}) == 0
        killed = datetime.now(timezone.utc) - admin.REPORT_SIDE_EFFECT_LEASE - timedelta(seconds=5)
        await db.reports.update_one({"id": "r-lease"}, {"$set": {"side_effect_lease_at": killed}})
        listed = await admin.list_reports("resolved", 10, moderator)
        stale_row = next(row for row in listed["reports"] if row["id"] == "r-lease")
        assert stale_row["retry_claimable"] is True
        retried = await admin.retry_report_side_effect("r-lease", moderator)
        assert retried["resolution_status"] == "complete" and calls["n"] == 1
        assert (await db.posts.find_one({"id": "p1"}))["status"] == "deleted"
        await db.reports.update_one(
            {"id": "r-lease"},
            {"$set": {"resolution_status": "retrying"}, "$unset": {"side_effect_lease_at": ""}},
        )
        await db.posts.update_one({"id": "p1"}, {"$set": {"status": "active"}})
        again = await admin.retry_report_side_effect("r-lease", moderator)
        assert again["resolution_status"] == "complete" and calls["n"] == 2
    run_isolated(scenario)


def test_coach_review_is_a_single_winner(monkeypatch):
    async def scenario(db):
        import social_graph
        from routers import community
        monkeypatch.setattr(community, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        monkeypatch.setattr(social_graph, "db", db)
        boss = account("boss", staff_role="admin")
        await db.users.insert_many([boss, account("applicant")])
        await db.coach_applications.insert_one({
            "id": "app-1", "user_id": "applicant", "status": "pending",
            "bio": "Ten years coaching strength athletes in a real gym.",
            "specialties": ["strength"], "created_at": datetime.now(timezone.utc),
        })
        approved = await community.review_coach_application(
            "app-1", community.CoachApplicationReviewIn(status="approved", review_note="Credentials verified"), boss,
        )
        assert approved["status"] == "approved"
        assert (await db.users.find_one({"id": "applicant"}))["role"] == "coach"
        assert await db.audit_log.count_documents({"action": "coach_application.approved"}) == 1
        with pytest.raises(HTTPException) as second:
            await community.review_coach_application(
                "app-1", community.CoachApplicationReviewIn(status="rejected", review_note="Changed my mind"), boss,
            )
        assert second.value.status_code == 409
        assert (await db.users.find_one({"id": "applicant"}))["role"] == "coach"
        assert await db.audit_log.count_documents({"action": "coach_application.rejected"}) == 0
        refused = await db.audit_log.find_one({"action": "coach_application.review", "outcome": "failed"})
        assert refused["reason_code"] == "not_pending" and "Changed my mind" not in str(refused)

        await db.coach_applications.insert_one({
            "id": "app-2", "user_id": "applicant", "status": "pending",
            "created_at": datetime.now(timezone.utc),
        })

        class Applications:
            def __init__(self, real):
                self.real = real

            def __getattr__(self, name):
                return getattr(self.real, name)

            async def update_one(self, query, update, *args, **kwargs):
                if query.get("status") == "pending":
                    return type("Result", (), {"modified_count": 0})()
                return await self.real.update_one(query, update, *args, **kwargs)

        class Database:
            def __init__(self, real):
                self.real = real
                self.coach_applications = Applications(real.coach_applications)

            def __getattr__(self, name):
                return getattr(self.real, name)

        before = await db.audit_log.count_documents({})
        monkeypatch.setattr(community, "db", Database(db))
        with pytest.raises(HTTPException) as lost:
            await community.review_coach_application(
                "app-2", community.CoachApplicationReviewIn(status="rejected", review_note="secret note"), boss,
            )
        assert lost.value.status_code == 409
        assert await db.audit_log.count_documents({}) == before
        assert (await db.coach_applications.find_one({"id": "app-2"}))["status"] == "pending"
    run_isolated(scenario)


def test_a_late_reapply_does_not_undo_an_approval(monkeypatch):
    async def scenario(db):
        import social_graph
        from routers import community
        monkeypatch.setattr(community, "db", db)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(staff, "db", db)
        monkeypatch.setattr(social_graph, "db", db)
        await db.coach_applications.create_index("user_id", unique=True)
        applicant = account("applicant")
        await db.users.insert_one(applicant)
        body = community.CoachApplicationIn(
            bio="Ten years coaching strength athletes in a real gym.",
            specialties=["strength"],
        )
        created = await community.apply_to_coach(body, applicant)
        assert created["status"] == "pending"
        await db.coach_applications.update_one({"user_id": "applicant"}, {"$set": {"status": "rejected"}})
        await db.users.update_one({"id": "applicant"}, {"$set": {"coach_status": "rejected", "role": "athlete"}})
        again = await community.apply_to_coach(body, applicant)
        assert again["status"] == "pending"
        assert (await db.users.find_one({"id": "applicant"}))["coach_status"] == "pending"

        await db.coach_applications.update_one({"user_id": "applicant"}, {"$set": {"status": "rejected"}})
        await db.users.update_one({"id": "applicant"}, {"$set": {"coach_status": "rejected", "role": "athlete"}})

        class Applications:
            def __init__(self, real):
                self.real = real

            def __getattr__(self, name):
                return getattr(self.real, name)

            async def replace_one(self, query, replacement, *args, **kwargs):
                if query.get("status") == "rejected":
                    await self.real.update_one(
                        {"user_id": query["user_id"]},
                        {"$set": {"status": "approved"}},
                    )
                    await db.users.update_one(
                        {"id": "applicant"},
                        {"$set": {"role": "coach", "coach_status": "approved"}},
                    )
                    return type("Result", (), {"modified_count": 0})()
                return await self.real.replace_one(query, replacement, *args, **kwargs)

        class Database:
            def __init__(self, real):
                self.real = real
                self.coach_applications = Applications(real.coach_applications)

            def __getattr__(self, name):
                return getattr(self.real, name)

        monkeypatch.setattr(community, "db", Database(db))
        kept = await community.apply_to_coach(body, applicant)
        assert kept["status"] == "approved"
        stored = await db.users.find_one({"id": "applicant"})
        assert stored["role"] == "coach" and stored["coach_status"] == "approved"
    run_isolated(scenario)


def test_analytics_view_is_deduped(monkeypatch):
    async def scenario(db):
        from routers import analytics as analytics_router
        monkeypatch.setattr(staff, "db", db)

        async def counts():
            return {"generated_at": "2026-10-09T00:00:00Z", "windows": {"24h": {}, "7d": {}}}

        monkeypatch.setattr(analytics_router.analytics, "counts", counts)
        boss = account("boss", staff_role="admin")
        await analytics_router.event_counts(boss)
        await analytics_router.event_counts(boss)
        assert await db.audit_log.count_documents({"action": "analytics.viewed"}) == 1
        row = await db.audit_log.find_one({"action": "analytics.viewed"})
        assert row["actor_id"] == "boss" and row["target_id"] == "product_events" and row["outcome"] == "success"
        await db.audit_log.update_one(
            {"id": row["id"]},
            {"$set": {"created_at": datetime.now(timezone.utc) - staff.ANALYTICS_VIEW_WINDOW - timedelta(seconds=5)}},
        )
        await analytics_router.event_counts(boss)
        assert await db.audit_log.count_documents({"action": "analytics.viewed"}) == 2
    run_isolated(scenario)


def test_permission_denied_on_a_write_is_audited(monkeypatch):
    async def scenario(db):
        import request_context
        from starlette.requests import Request
        monkeypatch.setattr(staff, "db", db)
        support_user = account("support", staff_role="support")
        scope = {
            "type": "http", "method": "POST", "path": "/api/admin/users/x/suspend",
            "headers": [], "query_string": b"",
        }
        token = request_context.set_request(Request(scope))
        try:
            with pytest.raises(HTTPException) as denied:
                await staff.require("users.suspend")(support_user)
            assert denied.value.status_code == 403
        finally:
            request_context.reset_request(token)
        row = await db.audit_log.find_one({"action": "staff.permission_denied"})
        assert row["outcome"] == "denied" and row["reason_code"] == "permission_denied"
        assert row["target_id"] == "users.suspend" and row["reason"] is None
        get_scope = {**scope, "method": "GET", "path": "/api/admin/users"}
        token = request_context.set_request(Request(get_scope))
        try:
            with pytest.raises(HTTPException):
                await staff.require("users.suspend")(support_user)
        finally:
            request_context.reset_request(token)
        assert await db.audit_log.count_documents({"action": "staff.permission_denied"}) == 1
    run_isolated(scenario)
