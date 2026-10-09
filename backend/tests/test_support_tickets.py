"""Support tickets: real Mongo reads and writes, owner scope, staff queue.

Each persistence test builds a throwaway database and drops it. Requests go
through the ASGI app, so routing, auth, and validation run as they do in
production. The global Motor client is left alone.
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "support-ticket-test-secret-0123456789abcdef")

import ratelimit  # noqa: E402
import server  # noqa: E402
import staff  # noqa: E402
from routers import tickets  # noqa: E402

TICKET_KEYS = {
    "id", "user_id", "subject", "category", "status", "assignee_id", "created_at", "updated_at",
}
MESSAGE_KEYS = {
    "id", "ticket_id", "author_id", "author_role", "body", "media_id", "created_at",
}


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient(
            "mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000,
        )
        database = client[f"ironflow_ticket_test_{uuid.uuid4().hex}"]
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()

    asyncio.run(run())


def account(uid, **extra):
    email = extra.pop("email", f"{uid}@example.invalid")
    return {"id": uid, "email": email, "full_name": uid.title(), "role": "athlete", **extra}


def bind(monkeypatch, database):
    monkeypatch.setattr(server, "db", database)
    monkeypatch.setattr(staff, "db", database)
    monkeypatch.setattr(tickets, "db", database)


def auth(uid):
    return {"Authorization": f"Bearer {server.make_token(uid)}"}


def test_support_inherits_ticket_permissions_to_moderator_and_admin():
    support = staff.permissions_for({"staff_role": "support"})
    moderator = staff.permissions_for({"staff_role": "moderator"})
    admin_perms = staff.permissions_for({"staff_role": "admin"})
    assert {"tickets.read", "tickets.write"} <= support < moderator < admin_perms
    assert staff.permissions_for({"role": "admin"}) == set()

    async def check():
        assert (await staff.require("tickets.write")({"id": "s", "staff_role": "moderator"}))["id"] == "s"
        with pytest.raises(HTTPException) as denied:
            await staff.require("tickets.read")({"id": "a", "role": "athlete"})
        assert denied.value.status_code == 403
        assert denied.value.detail == "Staff permission required"

    asyncio.run(check())


def test_ticket_routes_are_in_the_openapi_contract():
    paths = server.app.openapi()["paths"]
    assert paths["/api/tickets"]["post"]["responses"]["201"]
    assert "get" in paths["/api/tickets"]
    assert "get" in paths["/api/tickets/{ticket_id}"]
    assert paths["/api/tickets/{ticket_id}/messages"]["post"]["responses"]["201"]
    assert "get" in paths["/api/admin/tickets"]
    assert "get" in paths["/api/admin/tickets/{ticket_id}"]
    assert "patch" in paths["/api/admin/tickets/{ticket_id}"]
    assert paths["/api/admin/tickets/{ticket_id}/messages"]["post"]["responses"]["201"]


def test_lengths_are_enforced_before_a_write():
    with pytest.raises(ValidationError):
        tickets.TicketCreateIn(subject="", category="bug")
    with pytest.raises(ValidationError):
        tickets.TicketCreateIn(subject="x" * 121, category="bug")
    with pytest.raises(ValidationError):
        tickets.TicketCreateIn(subject="ok", category="urgent")
    with pytest.raises(ValidationError):
        tickets.MessageIn(body="x" * 5001)
    with pytest.raises(ValidationError):
        tickets.TicketCreateIn(subject="ok", category="bug", media_id="m-1")
    opened = tickets.TicketCreateIn(subject="  padded  ", category="other", body="  hello  ")
    assert opened.subject == "padded" and opened.body == "hello"


def test_member_ticket_round_trip_is_owner_scoped_and_persisted(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_many([
            account("owner", email="owner@example.invalid"),
            account("other"),
            account("support", staff_role="support", email="support@example.invalid"),
            account("coach", role="coach"),
        ])
        await database.media.insert_many([
            {"id": "media-owner", "user_id": "owner", "kind": "image", "url": "/m/owner"},
            {"id": "media-other", "user_id": "other", "kind": "image", "url": "/m/other"},
            {"id": "media-staff", "user_id": "support", "kind": "image", "url": "/m/staff"},
        ])
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            missing = await client.get("/api/tickets")
            assert missing.status_code == 401
            assert missing.json()["detail"] == "Not authenticated"

            bad = await client.post(
                "/api/tickets", headers=auth("owner"),
                json={"subject": "nope", "category": "urgent"},
            )
            assert bad.status_code == 422
            assert await database.tickets.count_documents({}) == 0

            stolen = await client.post(
                "/api/tickets", headers=auth("owner"),
                json={"subject": "Shot", "category": "bug", "body": "See photo", "media_id": "media-other"},
            )
            assert stolen.status_code == 422
            assert stolen.json()["detail"] == "Unknown media attachment"
            assert await database.tickets.count_documents({}) == 0

            created = await client.post(
                "/api/tickets", headers=auth("owner"),
                json={
                    "subject": "  Invoice missing  ",
                    "category": "billing",
                    "body": "April invoice never arrived.",
                    "media_id": "media-owner",
                    "priority": "high",
                    "author_role": "staff",
                },
            )
            assert created.status_code == 201, created.text
            payload = created.json()
            assert payload["subject"] == "Invoice missing"
            assert payload["status"] == "open" and payload["assignee_id"] is None
            assert payload["user_id"] == "owner"
            assert payload["messages"][0]["author_role"] == "user"
            assert payload["messages"][0]["media_id"] == "media-owner"
            assert "priority" not in payload
            ticket_id = payload["id"]

            stored = await database.tickets.find_one({"id": ticket_id})
            assert set(stored.keys()) - {"_id"} == TICKET_KEYS
            assert "priority" not in stored
            assert isinstance(stored["created_at"], datetime)
            message = await database.ticket_messages.find_one({"ticket_id": ticket_id})
            assert set(message.keys()) - {"_id"} == MESSAGE_KEYS
            assert message["author_role"] == "user" and message["author_id"] == "owner"

            listed = await client.get("/api/tickets", headers=auth("owner"))
            assert listed.status_code == 200
            assert [row["id"] for row in listed.json()] == [ticket_id]
            others = await client.get("/api/tickets", headers=auth("other"))
            assert others.status_code == 200 and others.json() == []

            ghost = await client.post(
                "/api/tickets/does-not-exist/messages", headers=auth("owner"),
                json={"body": "hello"},
            )
            assert ghost.status_code == 404 and ghost.json()["detail"] == "Ticket not found"

            hidden = await client.get(f"/api/tickets/{ticket_id}", headers=auth("other"))
            assert hidden.status_code == 404 and hidden.json()["detail"] == "Ticket not found"

            detail = await client.get(f"/api/tickets/{ticket_id}", headers=auth("owner"))
            assert detail.status_code == 200
            assert detail.json()["messages"][0]["body"] == "April invoice never arrived."
            assert "email" not in detail.json()["messages"][0]

            forbidden = await client.post(
                f"/api/tickets/{ticket_id}/messages", headers=auth("other"),
                json={"body": "I can see this", "author_role": "staff"},
            )
            assert forbidden.status_code == 403 and forbidden.json()["detail"] == "Not allowed"

            reply = await client.post(
                f"/api/tickets/{ticket_id}/messages", headers=auth("owner"),
                json={"body": "Any update?", "author_role": "staff"},
            )
            assert reply.status_code == 201
            assert reply.json()["author_role"] == "user"
            assert await database.ticket_messages.count_documents({"ticket_id": ticket_id}) == 2

            # A coach who is not staff cannot open the queue.
            missing_admin = await client.get("/api/admin/tickets/does-not-exist", headers=auth("support"))
            assert missing_admin.status_code == 404 and missing_admin.json()["detail"] == "Ticket not found"

            queue_denied = await client.get("/api/admin/tickets", headers=auth("coach"))
            assert queue_denied.status_code == 403
            assert queue_denied.json()["detail"] == "Staff permission required"

            queue = await client.get("/api/admin/tickets?status=open&q=invoice", headers=auth("support"))
            assert queue.status_code == 200
            body = queue.json()
            assert body["count"] == 1 and body["tickets"][0]["id"] == ticket_id
            assert body["tickets"][0]["user"]["email"] == "owner@example.invalid"
            assert (await client.get("/api/admin/tickets?q=.*", headers=auth("support"))).json()["count"] == 0
            by_email = await client.get(
                "/api/admin/tickets?q=owner@example.invalid", headers=auth("support"),
            )
            assert [row["id"] for row in by_email.json()["tickets"]] == [ticket_id]

            staff_view = await client.get(f"/api/admin/tickets/{ticket_id}", headers=auth("support"))
            assert staff_view.status_code == 200
            assert staff_view.json()["messages"][0]["author"]["email"] == "owner@example.invalid"

            not_staff = await client.patch(
                f"/api/admin/tickets/{ticket_id}", headers=auth("support"),
                json={"status": "pending", "assignee_id": "coach"},
            )
            assert not_staff.status_code == 404
            assert not_staff.json()["detail"] == "Assignee not found"
            assert (await database.tickets.find_one({"id": ticket_id}))["status"] == "open"
            failed = await database.audit_log.find_one({"outcome": "failed"})
            assert failed["action"] == "ticket.assignee_changed"
            assert failed["reason_code"] == "assignee_not_staff" and failed["reason"] is None
            assert "pending" not in str(failed) and "coach" not in str(failed["metadata"])

            assigned = await client.patch(
                f"/api/admin/tickets/{ticket_id}", headers=auth("support"),
                json={"status": "pending", "assignee_id": "support"},
            )
            assert assigned.status_code == 200
            assert assigned.json()["status"] == "pending"
            assert assigned.json()["assignee"]["id"] == "support"
            audits = [row async for row in database.audit_log.find({}).sort("action", 1)]
            assert {row["action"] for row in audits} == {"ticket.assignee_changed", "ticket.status_changed"}
            assert all(row["actor_id"] == "support" and row["target_id"] == ticket_id for row in audits)

            same = await client.patch(
                f"/api/admin/tickets/{ticket_id}", headers=auth("support"),
                json={"status": "pending"},
            )
            assert same.status_code == 200
            # The failed assignee attempt is kept; the no-op patch adds nothing.
            assert await database.audit_log.count_documents({"outcome": "success"}) == 2
            assert await database.audit_log.count_documents({"outcome": "failed"}) == 1

            empty = await client.patch(f"/api/admin/tickets/{ticket_id}", headers=auth("support"), json={})
            assert empty.status_code == 422 and empty.json()["detail"] == "No changes"

            note = await client.post(
                f"/api/admin/tickets/{ticket_id}/messages", headers=auth("support"),
                json={"body": "Looking at the April invoice.", "media_id": "media-staff"},
            )
            assert note.status_code == 201 and note.json()["author_role"] == "staff"
            replied = [row async for row in database.audit_log.find({"action": "ticket.replied"})]
            assert len(replied) == 1
            assert replied[0]["actor_id"] == "support" and replied[0]["target_id"] == ticket_id
            assert replied[0]["metadata"]["from"] == "pending" and replied[0]["metadata"]["to"] == "pending"
            assert replied[0]["metadata"]["message_id"] == note.json()["id"]
            assert "Looking at the April invoice." not in str(replied[0])
            stolen_staff = await client.post(
                f"/api/admin/tickets/{ticket_id}/messages", headers=auth("support"),
                json={"body": "Not my file", "media_id": "media-owner"},
            )
            assert stolen_staff.status_code == 422

            closed = await client.patch(
                f"/api/admin/tickets/{ticket_id}", headers=auth("support"),
                json={"status": "closed", "assignee_id": None},
            )
            assert closed.status_code == 200 and closed.json()["assignee_id"] is None
            locked = await client.post(
                f"/api/tickets/{ticket_id}/messages", headers=auth("owner"),
                json={"body": "Wait, one more thing"},
            )
            assert locked.status_code == 403 and locked.json()["detail"] == "Ticket is closed"
            closing = await client.post(
                f"/api/admin/tickets/{ticket_id}/messages", headers=auth("support"),
                json={"body": "Closed after the invoice was reissued."},
            )
            assert closing.status_code == 201 and closing.json()["author_role"] == "staff"
            closing_audits = [row async for row in database.audit_log.find({"action": "ticket.replied", "outcome": "success"})]
            assert len(closing_audits) == 2
            assert all("Closed after the invoice was reissued." not in str(row) for row in closing_audits)
            assert all(row["actor_id"] == "support" and row["target_id"] == ticket_id for row in closing_audits)
            status_change = await database.audit_log.find_one({"action": "ticket.status_changed", "metadata.to": "closed"})
            assert status_change["actor_id"] == "support" and status_change["target_id"] == ticket_id
            assert status_change["metadata"]["from"] == "pending" and status_change["metadata"]["to"] == "closed"

            owner_again = await client.get(f"/api/tickets/{ticket_id}", headers=auth("owner"))
            assert owner_again.status_code == 200
            assert owner_again.json()["status"] == "closed"
            assert [row["author_role"] for row in owner_again.json()["messages"]] == [
                "user", "user", "staff", "staff",
            ]
            assert "email" not in owner_again.json()["messages"][-1]

            open_only = await client.get("/api/tickets?status=open", headers=auth("owner"))
            assert open_only.json() == []
            closed_only = await client.get("/api/tickets?status=closed", headers=auth("owner"))
            assert [row["id"] for row in closed_only.json()] == [ticket_id]

            final = await database.tickets.find_one({"id": ticket_id})
            assert final["status"] == "closed" and final["assignee_id"] is None
            assert final["updated_at"] >= final["created_at"]
            assert await database.ticket_messages.count_documents({"ticket_id": ticket_id, "author_role": "staff"}) == 2

    run_isolated(scenario)


def test_lost_ticket_update_writes_no_audit(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_one(account("support", staff_role="support"))
        stamp = datetime.now(timezone.utc)
        await database.tickets.insert_one({
            "id": "t-race", "user_id": "owner", "subject": "Hi", "category": "account",
            "status": "open", "assignee_id": None, "created_at": stamp, "updated_at": stamp,
        })

        # Motor builds a new collection object on every attribute access, so the
        # patch has to sit on the object the handler will actually call.
        tickets_col = database.tickets

        class Lost:
            modified_count = 0

        async def lose(*_args, **_kwargs):
            return Lost()

        tickets_col.update_one = lose

        class Handle:
            tickets = tickets_col
            users = database.users
            audit_log = database.audit_log

        monkeypatch.setattr(tickets, "db", Handle)
        with pytest.raises(HTTPException) as lost:
            await tickets.update_for_staff(
                "t-race",
                tickets.TicketPatchIn(status="pending"),
                {"id": "support", "email": "support@example.invalid", "staff_role": "support"},
            )
        assert lost.value.status_code == 409
        assert lost.value.detail == "Ticket changed while you were editing it"
        assert await database.audit_log.count_documents({}) == 0
        assert (await database.tickets.find_one({"id": "t-race"}))["status"] == "open"

    run_isolated(scenario)


def test_ticket_creation_is_rate_limited(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        monkeypatch.setitem(ratelimit.LIMITS, "ticket", (1, 3600))
        await database.users.insert_one(account("owner"))
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post(
                "/api/tickets", headers=auth("owner"),
                json={"subject": "One", "category": "account"},
            )
            assert first.status_code == 201
            assert first.json()["messages"] == []
            second = await client.post(
                "/api/tickets", headers=auth("owner"),
                json={"subject": "Two", "category": "account"},
            )
            assert second.status_code == 429
            assert await database.tickets.count_documents({}) == 1

    run_isolated(scenario)
