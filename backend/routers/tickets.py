"""Member support tickets.

Mongo collections are `tickets` and `ticket_messages`. Field names match the
SQL columns on `public.support_tickets` and `public.support_ticket_messages`
in supabase/migrations/004_support_and_dual_media.sql (schemaforge). There is
no priority.

A member only ever sees their own rows. A missing ticket and someone else's
ticket are both 404 on read, so the id cannot be used to confirm that another
person opened one. Replying is different on purpose: a non-owner gets 403,
and the owner of a closed ticket gets 403 as well.
"""
from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

import ratelimit
import staff
from server import clean, current_user, db, new_id, now

router = APIRouter()

TicketCategory = Literal["billing", "account", "bug", "feature", "other"]
TicketStatus = Literal["open", "pending", "closed"]
AuthorRole = Literal["user", "staff"]

ACCOUNT_FIELDS = {"_id": 0, "id": 1, "full_name": 1, "email": 1, "staff_role": 1}


class TicketCreateIn(BaseModel):
    subject: str = Field(min_length=1, max_length=120)
    category: TicketCategory
    #: Optional opening message. Omitted means the ticket is created alone.
    body: str | None = Field(default=None, min_length=1, max_length=5000)
    #: Media uploaded with POST /media by the same user. Requires `body`.
    media_id: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("subject", "body", "media_id", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def media_requires_body(self) -> "TicketCreateIn":
        if self.media_id and not self.body:
            raise ValueError("A message body is required to attach media")
        return self


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    media_id: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("body", "media_id", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class TicketPatchIn(BaseModel):
    status: TicketStatus | None = None
    #: Null clears the assignee. A non-staff user id is rejected.
    assignee_id: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("assignee_id", mode="before")
    @classmethod
    def _strip_assignee(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


def _ticket_view(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "user_id": doc["user_id"],
        "subject": doc["subject"],
        "category": doc["category"],
        "status": doc["status"],
        "assignee_id": doc.get("assignee_id"),
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
    }


def _message_view(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "ticket_id": doc["ticket_id"],
        "author_id": doc["author_id"],
        "author_role": doc["author_role"],
        "body": doc["body"],
        "media_id": doc.get("media_id"),
        "created_at": doc["created_at"],
    }


async def _require_owned_media(media_id: str | None, user_id: str) -> str | None:
    """Only the uploader can attach a media row. Same rule as posts."""
    if not media_id:
        return None
    found = await db.media.find_one({"id": media_id, "user_id": user_id}, {"_id": 1})
    if not found:
        raise HTTPException(422, "Unknown media attachment")
    return media_id


async def _messages(ticket_id: str) -> list[dict]:
    return [
        _message_view(row)
        async for row in db.ticket_messages.find({"ticket_id": ticket_id}, {"_id": 0}).sort(
            [("created_at", 1), ("id", 1)]
        )
    ]


async def _snippets(ids: set[str | None]) -> dict[str, dict]:
    wanted = [identifier for identifier in ids if identifier]
    if not wanted:
        return {}
    return {
        row["id"]: {"id": row["id"], "full_name": row.get("full_name"), "email": row.get("email")}
        async for row in db.users.find({"id": {"$in": wanted}}, ACCOUNT_FIELDS)
    }


async def require_ticket(ticket_id: str) -> dict:
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    return ticket


async def _store_message(ticket: dict, author: dict, body: str, media_id: str | None, author_role: AuthorRole) -> dict:
    created = now()
    message = {
        "id": new_id(),
        "ticket_id": ticket["id"],
        "author_id": author["id"],
        "author_role": author_role,
        "body": body,
        "media_id": media_id,
        "created_at": created,
    }
    await db.ticket_messages.insert_one(dict(message))
    await db.tickets.update_one({"id": ticket["id"]}, {"$set": {"updated_at": created}})
    return _message_view(message)


async def add_message(ticket: dict, author: dict, body: MessageIn, author_role: AuthorRole) -> dict:
    media_id = await _require_owned_media(body.media_id, author["id"])
    await ratelimit.hit("ticket_message", author["id"])
    return await _store_message(ticket, author, body.body, media_id, author_role)


async def staff_detail(ticket_id: str) -> dict:
    ticket = await require_ticket(ticket_id)
    messages = await _messages(ticket_id)
    people = await _snippets({ticket.get("user_id"), ticket.get("assignee_id"), *(row["author_id"] for row in messages)})
    for message in messages:
        message["author"] = people.get(message["author_id"])
    view = _ticket_view(ticket)
    view["user"] = people.get(ticket["user_id"])
    assignee_id = ticket.get("assignee_id")
    view["assignee"] = people.get(assignee_id) if assignee_id else None
    view["messages"] = messages
    return view


async def _queue_query(status: TicketStatus | None, q: str | None) -> dict:
    query: dict = {}
    if status:
        query["status"] = status
    needle = (q or "").strip()[:80]
    if not needle:
        return query
    # Escape the term: support search must not become a regex that matches everything.
    safe = re.escape(needle)
    clauses: list[dict] = [
        {"subject": {"$regex": safe, "$options": "i"}},
        {"id": needle},
        {"user_id": needle},
    ]
    if "@" in needle:
        user_ids = [
            row["id"]
            async for row in db.users.find(
                {"email": {"$regex": safe, "$options": "i"}},
                {"_id": 0, "id": 1},
            ).limit(25)
        ]
        if user_ids:
            clauses.append({"user_id": {"$in": user_ids}})
    query["$or"] = clauses
    return query


async def list_for_staff(status: TicketStatus | None, q: str | None, limit: int) -> dict:
    query = await _queue_query(status, q)
    rows = [
        clean(row) or {}
        async for row in db.tickets.find(query, {"_id": 0}).sort([("updated_at", -1), ("id", 1)]).limit(limit)
    ]
    people = await _snippets({row.get("user_id") for row in rows} | {row.get("assignee_id") for row in rows})
    tickets = []
    for row in rows:
        view = _ticket_view(row)
        view["user"] = people.get(row.get("user_id") or "")
        view["assignee"] = people.get(row["assignee_id"]) if row.get("assignee_id") else None
        tickets.append(view)
    return {"tickets": tickets, "count": len(tickets)}


async def update_for_staff(ticket_id: str, body: TicketPatchIn, actor: dict) -> dict:
    ticket = await require_ticket(ticket_id)
    if not body.model_fields_set:
        raise HTTPException(422, "No changes")
    updates: dict = {}
    if "status" in body.model_fields_set:
        if body.status is None:
            raise HTTPException(422, "Status cannot be cleared")
        if body.status != ticket["status"]:
            updates["status"] = body.status
    if "assignee_id" in body.model_fields_set:
        assignee_id = body.assignee_id
        if assignee_id is not None:
            person = await db.users.find_one({"id": assignee_id}, {"_id": 0, "id": 1, "staff_role": 1})
            if not person or not staff.is_staff(person):
                raise HTTPException(404, "Assignee not found")
        if assignee_id != ticket.get("assignee_id"):
            updates["assignee_id"] = assignee_id
    if updates:
        updates["updated_at"] = now()
        await db.tickets.update_one({"id": ticket_id}, {"$set": updates})
        if "status" in updates:
            await staff.audit(
                actor, "ticket.status_changed", target_type="ticket", target_id=ticket_id,
                metadata={"from": ticket["status"], "to": updates["status"]},
            )
        if "assignee_id" in updates:
            await staff.audit(
                actor, "ticket.assignee_changed", target_type="ticket", target_id=ticket_id,
                metadata={"from": ticket.get("assignee_id"), "to": updates["assignee_id"]},
            )
    return await staff_detail(ticket_id)


@router.post("/tickets", status_code=201)
async def create_ticket(body: TicketCreateIn, user: dict = Depends(current_user)):
    media_id = await _require_owned_media(body.media_id, user["id"]) if body.body else None
    await ratelimit.hit("ticket", user["id"])
    stamp = now()
    ticket = {
        "id": new_id(),
        "user_id": user["id"],
        "subject": body.subject,
        "category": body.category,
        "status": "open",
        "assignee_id": None,
        "created_at": stamp,
        "updated_at": stamp,
    }
    await db.tickets.insert_one(dict(ticket))
    messages: list[dict] = []
    if body.body:
        # The opening note is part of creating the ticket, so it does not also
        # spend the reply rate limit.
        opening = await _store_message(ticket, user, body.body, media_id, "user")
        ticket["updated_at"] = opening["created_at"]
        messages.append(opening)
    view = _ticket_view(ticket)
    view["messages"] = messages
    return view


@router.get("/tickets")
async def list_tickets(
    status: TicketStatus | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(current_user),
):
    query: dict = {"user_id": user["id"]}
    if status:
        query["status"] = status
    return [
        _ticket_view(row)
        async for row in db.tickets.find(query, {"_id": 0}).sort([("updated_at", -1), ("id", 1)]).limit(limit)
    ]


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, user: dict = Depends(current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id, "user_id": user["id"]}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    view = _ticket_view(ticket)
    view["messages"] = await _messages(ticket_id)
    return view


@router.post("/tickets/{ticket_id}/messages", status_code=201)
async def create_message(ticket_id: str, body: MessageIn, user: dict = Depends(current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if ticket["user_id"] != user["id"]:
        raise HTTPException(403, "Not allowed")
    if ticket["status"] == "closed":
        raise HTTPException(403, "Ticket is closed")
    return await add_message(ticket, user, body, "user")
