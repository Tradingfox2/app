"""Back-office console: accounts, moderation queue, staff management, audit trail.

Privacy boundary: staff endpoints expose account and moderation data only. Health
data (biomarkers, lab reports), direct messages and private channel messages are
never returned here — moderation works from what the reporter submitted.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import accounting
import admin_pages
import moderation
import notifications
import ratelimit
import staff
from routers import tickets
from server import clean, current_user, db, new_id, now

router = APIRouter()

REPORT_REASONS = ("spam", "harassment", "dangerous_advice", "sexual_content", "violence", "other")


class ReportIn(BaseModel):
    target_type: Literal["post", "comment", "message", "direct_message", "user", "community"]
    target_id: str
    reason: Literal[REPORT_REASONS]  # type: ignore[valid-type]
    detail: str = Field(default="", max_length=1000)


class ReportReviewIn(BaseModel):
    resolution: Literal["dismissed", "content_removed", "user_suspended", "warning_sent"]
    note: str = Field(default="", max_length=1000)


class SuspensionIn(BaseModel):
    reason: str = Field(min_length=10, max_length=500)
    days: int | None = Field(default=None, ge=1, le=3650)


class ReinstateIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class StaffRoleIn(BaseModel):
    staff_role: Literal["support", "moderator", "admin"] | None = None
    reason: str = Field(min_length=5, max_length=500)


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


class MembershipDecisionIn(BaseModel):
    status: Literal["active", "rejected"]
    reason: str = Field(min_length=5, max_length=500)


ACCOUNT_FIELDS = {
    "_id": 0, "id": 1, "email": 1, "full_name": 1, "role": 1, "coach_status": 1,
    "staff_role": 1, "avatar_url": 1, "preferred_locale": 1, "created_at": 1,
    "suspended_at": 1, "suspended_until": 1, "suspension_reason": 1,
}


async def _account_or_404(user_id: str) -> dict:
    account = await db.users.find_one({"id": user_id}, ACCOUNT_FIELDS)
    if not account:
        raise HTTPException(404, "User not found")
    return clean(account)


PERSON_FIELDS = {"_id": 0, "id": 1, "full_name": 1, "email": 1}
MEMBERSHIP_FIELDS = {"_id": 0, "stripe_customer_id": 0, "stripe_subscription_id": 0}
# Lower rank is reviewed first. Waiting time breaks ties (older first).
REPORT_URGENCY = (
    ("violence", 1),
    ("sexual_content", 2),
    ("dangerous_advice", 3),
    ("harassment", 4),
    ("spam", 5),
    ("other", 6),
)
# A side-effect retry owns the row for this long. A process that dies while
# `resolution_status` is `retrying` can be reclaimed once the lease is older
# than this. Five minutes covers one removal or notice without leaving a
# killed worker blocking the queue overnight.
REPORT_SIDE_EFFECT_LEASE = timedelta(minutes=5)


async def _people(ids: list[str | None]) -> dict[str, dict]:
    wanted = [item for item in dict.fromkeys(ids) if item]
    if not wanted:
        return {}
    rows = [clean(row) async for row in db.users.find({"id": {"$in": wanted}}, PERSON_FIELDS)]
    return {row["id"]: row for row in rows if row}


async def _accounts(ids: list[str | None]) -> dict[str, dict]:
    wanted = [item for item in dict.fromkeys(ids) if item]
    if not wanted:
        return {}
    rows = [clean(row) async for row in db.users.find({"id": {"$in": wanted}}, ACCOUNT_FIELDS)]
    return {row["id"]: row for row in rows if row}


def _page_cursor(rows: list[dict], extra: bool, *fields: str) -> str | None:
    if not extra or not rows:
        return None
    last = rows[-1]
    parts: list[str] = []
    for field in fields:
        if field == "id":
            parts.append(str(last.get("id") or ""))
            continue
        stamp = admin_pages.iso(last.get(field))
        if not stamp:
            return None
        parts.append(stamp)
    if any(not part for part in parts):
        return None
    return admin_pages.encode_cursor(*parts)


async def _refuse_staff(account: dict, actor: dict, action: str, audit_action: str) -> None:
    try:
        _staff_guard(account, actor, action)
    except HTTPException:
        await staff.audit_denied(
            actor, audit_action, target_type="user", target_id=account["id"],
            outcome="denied", reason_code="staff_target",
        )
        raise


async def _apply_suspension(actor: dict, account: dict, reason: str, days: int | None) -> dict:
    user_id = account["id"]
    if user_id == actor["id"]:
        await staff.audit_denied(
            actor, "user.suspended", target_type="user", target_id=user_id,
            outcome="denied", reason_code="self_target",
        )
        raise HTTPException(409, "You cannot suspend your own account")
    await _refuse_staff(account, actor, "suspend", "user.suspended")
    until = now() + timedelta(days=days) if days else None
    await db.users.update_one({"id": user_id}, {"$set": {
        "suspended_at": now(), "suspended_until": until, "suspension_reason": reason,
        "suspended_by": actor["id"],
    }})
    await staff.audit(actor, "user.suspended", target_type="user", target_id=user_id,
                      reason=reason, metadata={"days": days})
    return await _account_or_404(user_id)


def _staff_guard(account: dict, actor: dict, action: str) -> None:
    """A moderator may not suspend or reinstate another staff account."""
    if staff.permissions_for(account) and "staff.manage" not in staff.permissions_for(actor):
        raise HTTPException(403, f"Only an admin can {action} a staff account")


# --------------------------------------------------------------------------- #
# Reporting (any signed-in user)                                              #
# --------------------------------------------------------------------------- #
@router.post("/reports", status_code=201)
async def create_report(body: ReportIn, user: dict = Depends(current_user)):
    existing = await db.reports.find_one(
        {"reporter_id": user["id"], "target_type": body.target_type,
         "target_id": body.target_id, "status": "open"}, {"_id": 0}
    )
    if existing:
        return _reporter_view(existing)
    await ratelimit.hit("report", user["id"])
    # Snapshot the reported content: moderators must not need read access to
    # private conversations to judge a report. But only content the reporter
    # can see may be reported — otherwise a report is a way to read (or merely
    # confirm the existence of) a post or message behind a wall.
    snapshot = ""
    community_id = None
    if body.target_type == "direct_message":
        # Only the recipient may report a DM: reporting is the one way a
        # private message reaches a moderator, and it is theirs to hand over.
        document = await db.direct_messages.find_one(
            {"id": body.target_id, "recipient_id": user["id"], "status": {"$ne": "deleted"}}, {"_id": 0})
        if not document:
            raise HTTPException(404, "Reported content not found")
        snapshot = (document.get("content") or "")[:1000]
        reported_user = document.get("sender_id")
    elif body.target_type in {"post", "comment", "message"}:
        document = await _visible_target(body.target_type, body.target_id, user)
        if not document:
            raise HTTPException(404, "Reported content not found")
        snapshot = (document.get("content") or "")[:1000]
        reported_user = document.get("author_id")
        community_id = document.get("community_id")
    elif body.target_type == "user":
        if not await db.users.find_one({"id": body.target_id}, {"_id": 1}):
            raise HTTPException(404, "Reported account not found")
        reported_user = body.target_id
    else:
        community = await db.communities.find_one({"id": body.target_id, "status": "active"}, {"_id": 0})
        if not community:
            raise HTTPException(404, "Reported community not found")
        reported_user = community.get("owner_id")
        community_id = None  # a report about a community goes to platform staff only
    report = {
        "id": new_id(), "reporter_id": user["id"], "reported_user_id": reported_user,
        "community_id": community_id,
        "target_type": body.target_type, "target_id": body.target_id,
        "reason": body.reason, "detail": body.detail.strip(), "content_snapshot": snapshot,
        "status": "open", "resolution": None, "resolution_status": None, "reviewed_by": None, "reviewed_at": None,
        "created_at": now(),
    }
    await db.reports.insert_one(report)
    return _reporter_view(report)


def _reporter_view(report: dict) -> dict:
    """What the reporter gets back: the receipt, not the content or the author."""
    view = clean(dict(report)) or {}
    for key in ("content_snapshot", "reported_user_id", "community_id"):
        view.pop(key, None)
    return view


async def _visible_target(target_type: str, target_id: str, user: dict) -> dict | None:
    """The reported post, comment or message — if, and only if, `user` can see it."""
    from routers import community, social  # lazy: both import this module's peers

    if target_type == "post":
        post = await db.posts.find_one({"id": target_id, "status": {"$ne": "deleted"}}, {"_id": 0})
        return post if post and await social._can_view_post(post, user["id"]) else None
    if target_type == "comment":
        comment = await db.post_comments.find_one({"id": target_id, "status": "active"}, {"_id": 0})
        if not comment:
            return None
        post = await db.posts.find_one({"id": comment["post_id"], "status": {"$ne": "deleted"}}, {"_id": 0})
        if not post or not await social._can_view_post(post, user["id"]):
            return None
        return {**comment, "community_id": post.get("community_id")}
    message = await db.messages.find_one({"id": target_id, "status": "active"}, {"_id": 0})
    if not message:
        return None
    channel = await db.channels.find_one({"id": message["channel_id"], "status": "active"}, {"_id": 0})
    if not channel:
        return None
    try:
        await community._require(channel["community_id"], user["id"], community.permissions.VIEW_CHANNEL, channel)
    except HTTPException:
        return None
    return message


# --------------------------------------------------------------------------- #
# Overview                                                                     #
# --------------------------------------------------------------------------- #
@router.get("/admin/overview")
async def overview(user: dict = Depends(staff.require("users.read"))):
    day_ago, week_ago = now() - timedelta(days=1), now() - timedelta(days=7)
    return {
        "users": {
            "total": await db.users.count_documents({}),
            "new_7d": await db.users.count_documents({"created_at": {"$gte": week_ago}}),
            "suspended": await db.users.count_documents({"suspended_at": {"$ne": None}}),
            "coaches": await db.users.count_documents({"role": "coach", "coach_status": "approved"}),
        },
        "queues": {
            "open_reports": await db.reports.count_documents({"status": "open"}),
            "pending_coach_applications": await db.coach_applications.count_documents({"status": "pending"}),
            "pending_memberships": await db.community_members.count_documents({"status": "pending"}),
            # Ticket and report lists are paged. These counts are the full queues.
            "open_tickets": await db.tickets.count_documents({"status": "open"}),
            "pending_tickets": await db.tickets.count_documents({"status": "pending"}),
            "unassigned_open_tickets": await db.tickets.count_documents({"status": "open", "assignee_id": None}),
            "oldest_open_report_at": admin_pages.iso((await db.reports.find_one(
                {"status": "open"}, {"_id": 0, "created_at": 1}, sort=[("created_at", 1)],
            ) or {}).get("created_at")),
            "oldest_unassigned_ticket_at": admin_pages.iso((await db.tickets.find_one(
                {"status": "open", "assignee_id": None}, {"_id": 0, "created_at": 1}, sort=[("created_at", 1)],
            ) or {}).get("created_at")),
        },
        "activity": {
            "workouts_24h": await db.workouts.count_documents({"started_at": {"$gte": day_ago}}),
            "posts_24h": await db.posts.count_documents({"created_at": {"$gte": day_ago}, "status": {"$ne": "deleted"}}),
            "messages_24h": await db.messages.count_documents({"created_at": {"$gte": day_ago}}),
            "communities": await db.communities.count_documents({"status": "active"}),
        },
        "permissions": sorted(staff.permissions_for(user)),
        "staff_role": user.get("staff_role"),
        "generated_at": now().isoformat(),
    }


def _coach_directory_row(person: dict | None, application: dict | None) -> dict:
    person = person or {}
    application = application or {}
    return clean({
        "user_id": person.get("id") or application.get("user_id"),
        "full_name": person.get("full_name"),
        "email": person.get("email"),
        "role": person.get("role"),
        "coach_status": person.get("coach_status") or application.get("status"),
        "suspended_at": person.get("suspended_at"),
        "application_id": application.get("id"),
        "bio": application.get("bio"),
        "specialties": application.get("specialties") or [],
        "credentials": application.get("credentials") or [],
        "review_note": application.get("review_note"),
        "created_at": application.get("created_at") or person.get("created_at"),
    }) or {}


@router.get("/admin/coaches")
async def list_coach_directory(
    status: Literal["pending", "approved", "rejected", "suspended"] = "approved",
    limit: int = Query(default=100, ge=1, le=100),
    user: dict = Depends(staff.require("coaches.review")),
    cursor: str | None = None,
):
    """Coach lists behind the overview card.

    Approved matches the overview count (role coach + approved), including
    coaches who were approved before applications were stored. Banned means
    the account is suspended. Waiting and rejected come from applications.
    The cursor is taken from the sorted documents, not the joined row, because
    the joined `created_at` can come from the other collection.
    """
    if status in {"pending", "rejected"}:
        match = {"status": status}
        total = await db.coach_applications.count_documents(match)
        window = match
        if cursor:
            created_s, doc_id = admin_pages.decode_cursor(cursor, 2)
            window = admin_pages.and_query(match, admin_pages.after_asc(
                "created_at", admin_pages.parse_instant(created_s), doc_id,
            ))
        applications = [
            clean(row) or {}
            async for row in db.coach_applications.find(window, {"_id": 0}).sort([("created_at", 1), ("id", 1)]).limit(limit + 1)
        ]
        extra = len(applications) > limit
        applications = applications[:limit]
        people = await _accounts([row.get("user_id") for row in applications])
        return {
            "coaches": [_coach_directory_row(people.get(row.get("user_id") or ""), row) for row in applications],
            "total": total,
            "next_cursor": _page_cursor(applications, extra, "created_at", "id"),
        }
    if status == "approved":
        query: dict = {"role": "coach", "coach_status": "approved"}
    else:
        query = {
            "suspended_at": {"$ne": None},
            "$or": [
                {"role": "coach"},
                {"coach_status": {"$in": ["pending", "approved", "rejected"]}},
            ],
        }
    total = await db.users.count_documents(query)
    window = query
    if cursor:
        created_s, doc_id = admin_pages.decode_cursor(cursor, 2)
        window = admin_pages.and_query(query, admin_pages.before_desc(
            "created_at", admin_pages.parse_instant(created_s), doc_id,
        ))
    people = [
        clean(row) or {}
        async for row in db.users.find(window, ACCOUNT_FIELDS).sort([("created_at", -1), ("id", -1)]).limit(limit + 1)
    ]
    extra = len(people) > limit
    people = people[:limit]
    applications = [
        clean(row) or {}
        async for row in db.coach_applications.find(
            {"user_id": {"$in": [person["id"] for person in people if person.get("id")]}}, {"_id": 0},
        )
    ] if people else []
    by_user = {row.get("user_id"): row for row in applications}
    return {
        "coaches": [_coach_directory_row(person, by_user.get(person.get("id"))) for person in people],
        "total": total,
        "next_cursor": _page_cursor(people, extra, "created_at", "id"),
    }


# --------------------------------------------------------------------------- #
# Accounts                                                                     #
# --------------------------------------------------------------------------- #
@router.get("/admin/users")
async def list_users(
    q: str | None = None,
    status: Literal["all", "active", "suspended", "staff"] = "all",
    limit: int = Query(default=25, ge=1, le=100),
    user: dict = Depends(staff.require("users.read")),
    cursor: str | None = None,
):
    query: dict = {}
    if status == "suspended":
        query["suspended_at"] = {"$ne": None}
    elif status == "active":
        query["suspended_at"] = None
    elif status == "staff":
        query["staff_role"] = {"$in": list(staff.STAFF_ROLES)}
    if q:
        safe = re.escape(q.strip()[:80])
        query["$or"] = [{"email": {"$regex": safe, "$options": "i"}},
                        {"full_name": {"$regex": safe, "$options": "i"}}, {"id": q.strip()}]
    total = await db.users.count_documents(query)
    window = query
    if cursor:
        created_s, doc_id = admin_pages.decode_cursor(cursor, 2)
        window = admin_pages.and_query(query, admin_pages.before_desc(
            "created_at", admin_pages.parse_instant(created_s), doc_id,
        ))
    rows = [
        clean(row) or {}
        async for row in db.users.find(window, ACCOUNT_FIELDS).sort([("created_at", -1), ("id", -1)]).limit(limit + 1)
    ]
    extra = len(rows) > limit
    rows = rows[:limit]
    ids = [row["id"] for row in rows if row.get("id")]
    owned = set(await db.gyms.distinct("owner_user_id", {"owner_user_id": {"$in": ids}})) if ids else set()
    for row in rows:
        row["gym_owner"] = row["id"] in owned
    # `count` stays the page length. `total` is the filtered collection.
    return {
        "users": rows,
        "count": len(rows),
        "total": total,
        "next_cursor": _page_cursor(rows, extra, "created_at", "id"),
    }


@router.get("/admin/users/{user_id}")
async def user_detail(user_id: str, user: dict = Depends(staff.require("users.read"))):
    account = await _account_or_404(user_id)
    account["stats"] = {
        "workouts": await db.workouts.count_documents({"user_id": user_id}),
        "posts": await db.posts.count_documents({"author_id": user_id, "status": {"$ne": "deleted"}}),
        "communities": await db.community_members.count_documents({"user_id": user_id, "status": "active"}),
        "reports_against": await db.reports.count_documents({"reported_user_id": user_id}),
    }
    account["notes"] = [clean(row) async for row in db.user_notes.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(50)]
    # Health data (biomarkers, lab reports) and message bodies are deliberately absent.
    return account


@router.post("/admin/users/{user_id}/notes", status_code=201)
async def add_note(user_id: str, body: NoteIn, user: dict = Depends(staff.require("users.read"))):
    account = await db.users.find_one({"id": user_id}, {"_id": 1})
    if not account:
        await staff.audit_denied(
            user, "user.note_added", target_type="user", target_id=user_id,
            outcome="failed", reason_code="not_found",
        )
        raise HTTPException(404, "User not found")
    note = {"id": new_id(), "user_id": user_id, "author_id": user["id"],
            "author_email": user.get("email"), "note": body.note.strip(), "created_at": now()}
    await db.user_notes.insert_one(dict(note))
    await staff.audit(user, "user.note_added", target_type="user", target_id=user_id)
    return clean(note)


async def _missing_account(actor: dict, user_id: str, action: str) -> None:
    await staff.audit_denied(
        actor, action, target_type="user", target_id=user_id,
        outcome="failed", reason_code="not_found",
    )
    raise HTTPException(404, "User not found")


@router.post("/admin/users/{user_id}/suspend")
async def suspend_user(user_id: str, body: SuspensionIn, user: dict = Depends(staff.require("users.suspend"))):
    account = await db.users.find_one({"id": user_id}, ACCOUNT_FIELDS)
    if not account:
        await _missing_account(user, user_id, "user.suspended")
    return await _apply_suspension(user, clean(account), body.reason.strip(), body.days)


@router.post("/admin/users/{user_id}/reinstate")
async def reinstate_user(user_id: str, body: ReinstateIn, user: dict = Depends(staff.require("users.suspend"))):
    account = await db.users.find_one({"id": user_id}, ACCOUNT_FIELDS)
    if not account:
        await _missing_account(user, user_id, "user.reinstated")
    account = clean(account)
    await _refuse_staff(account, user, "reinstate", "user.reinstated")
    await db.users.update_one({"id": user_id}, {"$set": {
        "suspended_at": None, "suspended_until": None, "suspension_reason": None, "suspended_by": None,
    }})
    await staff.audit(user, "user.reinstated", target_type="user", target_id=user_id, reason=body.reason.strip(),
                      metadata={"from": "suspended", "to": "active"})
    return await _account_or_404(user_id)


@router.patch("/admin/users/{user_id}/staff-role")
async def set_staff_role(user_id: str, body: StaffRoleIn, user: dict = Depends(staff.require("staff.manage"))):
    account = await db.users.find_one({"id": user_id}, ACCOUNT_FIELDS)
    if not account:
        await _missing_account(user, user_id, "staff.role_changed")
    account = clean(account)
    if user_id == user["id"]:
        await staff.audit_denied(
            user, "staff.role_changed", target_type="user", target_id=user_id,
            outcome="denied", reason_code="self_target",
        )
        raise HTTPException(409, "You cannot change your own staff role")
    await db.users.update_one({"id": user_id}, {"$set": {"staff_role": body.staff_role}})
    await staff.audit(user, "staff.role_changed", target_type="user", target_id=user_id,
                      reason=body.reason.strip(),
                      metadata={"from": account.get("staff_role"), "to": body.staff_role})
    return await _account_or_404(user_id)


# --------------------------------------------------------------------------- #
# Moderation queue                                                             #
# --------------------------------------------------------------------------- #
def _report_urgency_switch() -> dict:
    return {"$switch": {
        "branches": [{"case": {"$eq": ["$reason", reason]}, "then": rank} for reason, rank in REPORT_URGENCY],
        "default": 9,
    }}


@router.get("/admin/reports")
async def list_reports(
    status: Literal["open", "resolved"] = "open",
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(staff.require("reports.read")),
    cursor: str | None = None,
    target_type: Literal["post", "comment", "message", "direct_message", "user", "community"] | None = None,
):
    """Open reports are ordered by policy urgency, then by how long they have waited."""
    match: dict = {"status": status}
    if target_type:
        match["target_type"] = target_type
    total = await db.reports.count_documents(match)
    if status == "open":
        stages: list[dict] = [{"$match": match}, {"$addFields": {"_urgency": _report_urgency_switch()}}]
        if cursor:
            rank_s, created_s, doc_id = admin_pages.decode_cursor(cursor, 3)
            try:
                rank = int(rank_s)
            except ValueError as exc:
                raise HTTPException(422, "Invalid page cursor") from exc
            created = admin_pages.parse_instant(created_s)
            stages.append({"$match": {"$or": [
                {"_urgency": {"$gt": rank}},
                {"_urgency": rank, "created_at": {"$gt": created}},
                {"_urgency": rank, "created_at": created, "id": {"$gt": doc_id}},
            ]}})
        stages.extend([
            {"$sort": {"_urgency": 1, "created_at": 1, "id": 1}},
            {"$limit": limit + 1},
            {"$project": {"_id": 0, "_urgency": 0}},
        ])
        reports = [clean(row) or {} async for row in db.reports.aggregate(stages)]
    else:
        window = match
        if cursor:
            reviewed_s, doc_id = admin_pages.decode_cursor(cursor, 2)
            window = admin_pages.and_query(match, admin_pages.before_desc(
                "reviewed_at", admin_pages.parse_instant(reviewed_s), doc_id,
            ))
        reports = [
            clean(row) or {}
            async for row in db.reports.find(window, {"_id": 0}).sort([("reviewed_at", -1), ("id", -1)]).limit(limit + 1)
        ]
    extra = len(reports) > limit
    reports = reports[:limit]
    people = await _people([row.get("reporter_id") for row in reports] + [row.get("reported_user_id") for row in reports])
    for report in reports:
        report["reporter"] = people.get(report.get("reporter_id") or "")
        report["reported_user"] = people.get(report.get("reported_user_id") or "")
        report.pop("_urgency", None)
        report["retry_claimable"] = _retry_claimable(report, now())
    if status == "open":
        next_cursor = None
        if extra and reports:
            last = reports[-1]
            rank = dict(REPORT_URGENCY).get(last.get("reason") or "", 9)
            stamp = admin_pages.iso(last.get("created_at"))
            if stamp and last.get("id"):
                next_cursor = admin_pages.encode_cursor(str(rank), stamp, last["id"])
    else:
        next_cursor = _page_cursor(reports, extra, "reviewed_at", "id")
    return {"reports": reports, "total": total, "next_cursor": next_cursor}


@router.patch("/admin/reports/{report_id}")
async def review_report(report_id: str, body: ReportReviewIn, user: dict = Depends(staff.require("reports.resolve"))):
    report = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        await staff.audit_denied(
            user, "report.review", target_type="report", target_id=report_id,
            outcome="failed", reason_code="not_found",
        )
        raise HTTPException(404, "Report not found")
    if report["status"] != "open":
        await staff.audit_denied(
            user, "report.review", target_type="report", target_id=report_id,
            outcome="failed", reason_code="already_resolved",
        )
        raise HTTPException(409, "Report already resolved")
    note = body.note.strip()
    account = None
    if body.resolution == "content_removed" and report["target_type"] not in moderation.REMOVABLE:
        await staff.audit_denied(
            user, "report.content_removed", target_type="report", target_id=report_id,
            outcome="failed", reason_code="not_removable",
        )
        raise HTTPException(409, "This target type cannot be removed automatically")
    if body.resolution == "user_suspended":
        if len(note) < 10:
            await staff.audit_denied(
                user, "report.user_suspended", target_type="report", target_id=report_id,
                outcome="failed", reason_code="reason_too_short",
            )
            raise HTTPException(422, "Suspending an account needs a reason of at least 10 characters")
        reported_id = report.get("reported_user_id")
        if not reported_id:
            await staff.audit_denied(
                user, "report.user_suspended", target_type="report", target_id=report_id,
                outcome="failed", reason_code="no_account",
            )
            raise HTTPException(409, "This report has no account to suspend")
        account = await db.users.find_one({"id": reported_id}, ACCOUNT_FIELDS)
        if not account:
            await staff.audit_denied(
                user, "report.user_suspended", target_type="user", target_id=reported_id,
                outcome="failed", reason_code="not_found",
            )
            raise HTTPException(404, "User not found")
        account = clean(account)
        if account["id"] == user["id"]:
            await staff.audit_denied(
                user, "report.user_suspended", target_type="user", target_id=account["id"],
                outcome="denied", reason_code="self_target",
            )
            raise HTTPException(409, "You cannot suspend your own account")
        await _refuse_staff(account, user, "suspend", "report.user_suspended")
    # Claim the open row before any side effect. A second reviewer loses here
    # and must not suspend an account or remove content for a decision they did not win.
    # `resolution_status` starts partial so a crash after the claim is retryable.
    claimed = await db.reports.update_one({"id": report_id, "status": "open"}, {"$set": {
        "status": "resolved", "resolution": body.resolution, "note": note,
        "reviewed_by": user["id"], "reviewed_at": now(),
        "resolution_status": "partial", "side_effect_error": "pending",
    }})
    if claimed.modified_count != 1:
        raise HTTPException(409, "Report already resolved")
    # The winning resolution stays if a later write fails. Reopening the row
    # would let a second decision land on top of a suspension or removal that
    # already happened. The audit row is written before the side effect so a
    # failure still names who decided.
    await staff.audit(user, f"report.{body.resolution}", target_type=report["target_type"],
                      target_id=report["target_id"], reason=note or None,
                      metadata={"report_id": report_id, "reason": report["reason"], "from": "open", "to": body.resolution})
    code = await _report_side_effects(user, report, body.resolution, note, account)
    await _mark_resolution(report_id, code)
    return _expose_report(await db.reports.find_one({"id": report_id}, {"_id": 0}))


_NOTICE = {
    "warning_sent": "A moderator sent you a warning about the community guidelines.",
    "content_removed": "Content was removed for breaching the guidelines.",
}
_SIDE_EFFECT_CODE = {
    "content_removed": "content_removal_failed",
    "user_suspended": "suspension_failed",
    "warning_sent": "notice_failed",
    "dismissed": "side_effect_failed",
}


async def _mark_resolution(report_id: str, code: str | None) -> None:
    # The lease only matters while a retry owns the row. A finished attempt
    # drops it so the next retry of a partial row is not waiting on a dead clock.
    if code:
        await db.reports.update_one({"id": report_id}, {
            "$set": {"resolution_status": "partial", "side_effect_error": code},
            "$unset": {"side_effect_lease_at": ""},
        })
        return
    await db.reports.update_one({"id": report_id}, {
        "$set": {"resolution_status": "complete", "side_effect_error": None},
        "$unset": {"side_effect_lease_at": ""},
    })


async def _report_side_effects(
    actor: dict, report: dict, resolution: str, note: str, account: dict | None,
) -> str | None:
    """Run removal, suspension, and the member notice.

    Returns a stable error code when something fails. The exception text is
    not stored: it can echo reported content. A repeated call is safe:
    removal no-ops once the target is gone, suspension is skipped when the
    account is already suspended, and the notice is skipped when this report
    already created one.
    """
    try:
        if resolution == "content_removed":
            await moderation.remove_content(report["target_type"], report["target_id"], actor=actor)
        if resolution == "user_suspended":
            target_id = (account or {}).get("id") or report.get("reported_user_id")
            if target_id:
                fresh = await db.users.find_one({"id": target_id}, ACCOUNT_FIELDS)
                if fresh and not fresh.get("suspended_at"):
                    await _apply_suspension(actor, fresh, note, None)
        await _moderation_notice(report, resolution, note)
    except Exception:
        code = _SIDE_EFFECT_CODE.get(resolution, "side_effect_failed")
        logger.warning("report side effect failed code=%s report_id=%s", code, report.get("id"))
        return code
    return None


async def _moderation_notice(report: dict, resolution: str, note: str) -> None:
    notice = _NOTICE.get(resolution)
    reported = report.get("reported_user_id")
    if not reported or not notice:
        return
    existing = await db.notifications.find_one({
        "user_id": reported,
        "type": "moderation_action",
        "metadata.report_id": report["id"],
    }, {"_id": 1})
    if existing:
        return
    # Through notifications.create so the row carries `read_at`, which is
    # the field the notification centre actually reads. A moderation notice
    # is deliberately NOT sent via notify(): it must reach the member even
    # if they have blocked the staff account acting on the report.
    await notifications.create(
        reported,
        "moderation_action",
        "Community guidelines",
        note or notice,
        metadata={"report_id": report["id"], "target_type": "report", "target_id": report["id"]},
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _lease_expired(report: dict, moment: datetime) -> bool:
    """A retrying row with no lease, or a lease older than the timeout, can be taken."""
    lease = report.get("side_effect_lease_at")
    if not isinstance(lease, datetime):
        return True
    return _as_utc(lease) <= _as_utc(moment) - REPORT_SIDE_EFFECT_LEASE


def _expose_report(report: dict | None) -> dict | None:
    """Staff report payload, including whether a stuck retry can be taken."""
    row = clean(report)
    if not row:
        return row
    row["retry_claimable"] = _retry_claimable(row, now())
    return row


def _retry_claimable(report: dict, moment: datetime) -> bool:
    if report.get("status") != "resolved":
        return False
    state = report.get("resolution_status")
    if state == "partial":
        return True
    if state == "retrying":
        return _lease_expired(report, moment)
    return False


def _retry_claim_clauses(moment: datetime) -> list[dict]:
    cutoff = _as_utc(moment) - REPORT_SIDE_EFFECT_LEASE
    return [
        {"resolution_status": "partial"},
        {"resolution_status": "retrying", "side_effect_lease_at": {"$lte": cutoff}},
        {"resolution_status": "retrying", "side_effect_lease_at": None},
        {"resolution_status": "retrying", "side_effect_lease_at": {"$exists": False}},
    ]


@router.post("/admin/reports/{report_id}/retry-side-effect")
async def retry_report_side_effect(report_id: str, user: dict = Depends(staff.require("reports.resolve"))):
    """Re-run a side effect that failed after the report was claimed.

    The resolution itself is not opened again. A lost claim stays a 409.
    """
    report = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        await staff.audit_denied(
            user, "report.side_effect_retried", target_type="report", target_id=report_id,
            outcome="failed", reason_code="not_found",
        )
        raise HTTPException(404, "Report not found")
    moment = now()
    if not _retry_claimable(report, moment):
        # A fresh lease is another worker. That loser gets no audit row.
        # A finished row is a refused repeat, which is recorded.
        if report.get("status") == "resolved" and report.get("resolution_status") == "retrying":
            raise HTTPException(409, "This report does not have a partial resolution to retry")
        await staff.audit_denied(
            user, "report.side_effect_retried", target_type="report", target_id=report_id,
            outcome="failed", reason_code="not_retryable",
        )
        raise HTTPException(409, "This report does not have a partial resolution to retry")
    resolution = report.get("resolution") or ""
    note = (report.get("note") or "").strip()
    account = None
    if resolution == "user_suspended":
        reported_id = report.get("reported_user_id")
        if not reported_id:
            await staff.audit_denied(
                user, "report.side_effect_retried", target_type="report", target_id=report_id,
                outcome="failed", reason_code="no_account",
            )
            raise HTTPException(409, "This report has no account to suspend")
        account = await db.users.find_one({"id": reported_id}, ACCOUNT_FIELDS)
        if not account:
            await staff.audit_denied(
                user, "report.side_effect_retried", target_type="user", target_id=reported_id,
                outcome="failed", reason_code="not_found",
            )
            raise HTTPException(404, "User not found")
        account = clean(account)
        if account["id"] == user["id"]:
            await staff.audit_denied(
                user, "report.side_effect_retried", target_type="user", target_id=account["id"],
                outcome="denied", reason_code="self_target",
            )
            raise HTTPException(409, "You cannot suspend your own account")
        if not account.get("suspended_at"):
            await _refuse_staff(account, user, "suspend", "report.side_effect_retried")
    # One retry owns the row. A second caller loses before it can suspend or
    # notify again. The claim matches partial, or a retrying row whose lease
    # is older than REPORT_SIDE_EFFECT_LEASE (a killed worker).
    claimed = await db.reports.update_one(
        {"id": report_id, "status": "resolved", "$or": _retry_claim_clauses(moment)},
        {"$set": {"resolution_status": "retrying", "side_effect_lease_at": moment}},
    )
    if claimed.modified_count != 1:
        raise HTTPException(409, "This report does not have a partial resolution to retry")
    code = await _report_side_effects(user, report, resolution, note, account)
    await _mark_resolution(report_id, code)
    await staff.audit(
        user, "report.side_effect_retried", target_type="report", target_id=report_id,
        metadata={
            "report_id": report_id,
            "from": report.get("resolution_status") or "partial",
            "to": "partial" if code else "complete",
            "side_effect_error": code,
        },
    )
    return _expose_report(await db.reports.find_one({"id": report_id}, {"_id": 0}))


# --------------------------------------------------------------------------- #
# Communities and join requests                                                #
# Staff with content.moderate can accept or decline a pending request here.    #
# Paid communities still require verified billing, same rule as managers.      #
# --------------------------------------------------------------------------- #
@router.get("/admin/memberships")
async def list_memberships(
    status: Literal["pending", "banned", "removed"] = "pending",
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(staff.require("users.read")),
    cursor: str | None = None,
):
    match = {"status": status}
    total = await db.community_members.count_documents(match)
    window = match
    if cursor:
        created_s, doc_id = admin_pages.decode_cursor(cursor, 2)
        window = admin_pages.and_query(match, admin_pages.after_asc(
            "created_at", admin_pages.parse_instant(created_s), doc_id,
        ))
    rows = [
        clean(row) or {}
        async for row in db.community_members.find(window, MEMBERSHIP_FIELDS).sort([("created_at", 1), ("id", 1)]).limit(limit + 1)
    ]
    extra = len(rows) > limit
    rows = rows[:limit]
    people = await _people([row.get("user_id") for row in rows])
    community_ids = [row.get("community_id") for row in rows if row.get("community_id")]
    groups = {
        row["id"]: clean(row)
        async for row in db.communities.find(
            {"id": {"$in": community_ids}}, {"_id": 0, "id": 1, "name": 1, "join_policy": 1},
        )
    } if community_ids else {}
    for row in rows:
        row["user"] = people.get(row.get("user_id") or "")
        row["community"] = groups.get(row.get("community_id") or "")
    return {
        "memberships": rows,
        "total": total,
        "next_cursor": _page_cursor(rows, extra, "created_at", "id"),
    }


@router.get("/admin/communities")
async def list_communities(
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(staff.require("users.read")),
    cursor: str | None = None,
):
    total = await db.communities.count_documents({})
    window: dict = {}
    if cursor:
        created_s, doc_id = admin_pages.decode_cursor(cursor, 2)
        window = admin_pages.before_desc("created_at", admin_pages.parse_instant(created_s), doc_id)
    rows = [
        clean(row) or {}
        async for row in db.communities.find(
            window,
            {"_id": 0, "id": 1, "name": 1, "status": 1, "join_policy": 1, "owner_id": 1, "created_at": 1},
        ).sort([("created_at", -1), ("id", -1)]).limit(limit + 1)
    ]
    extra = len(rows) > limit
    rows = rows[:limit]
    ids = [row["id"] for row in rows if row.get("id")]
    counts: dict[tuple[str, str], int] = {}
    if ids:
        async for bucket in db.community_members.aggregate([
            {"$match": {"community_id": {"$in": ids}, "status": {"$in": ["active", "pending"]}}},
            {"$group": {"_id": {"community_id": "$community_id", "status": "$status"}, "n": {"$sum": 1}}},
        ]):
            counts[(bucket["_id"]["community_id"], bucket["_id"]["status"])] = bucket["n"]
    owners = await _people([row.get("owner_id") for row in rows])
    for row in rows:
        row["member_count"] = counts.get((row["id"], "active"), 0)
        row["pending_count"] = counts.get((row["id"], "pending"), 0)
        row["owner"] = owners.get(row.get("owner_id") or "")
    return {"communities": rows, "total": total, "next_cursor": _page_cursor(rows, extra, "created_at", "id")}


@router.patch("/admin/memberships/{member_id}")
async def review_membership(
    member_id: str,
    body: MembershipDecisionIn,
    user: dict = Depends(staff.require("content.moderate")),
):
    member = await db.community_members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        await staff.audit_denied(
            user, "community.member_review", target_type="community_member", target_id=member_id,
            outcome="failed", reason_code="not_found",
        )
        raise HTTPException(404, "Membership not found")
    if member.get("status") != "pending":
        await staff.audit_denied(
            user, "community.member_review", target_type="community_member", target_id=member_id,
            outcome="failed", reason_code="not_pending",
        )
        raise HTTPException(409, "Only a pending request can be reviewed here")
    if member.get("role") == "owner":
        await staff.audit_denied(
            user, "community.member_review", target_type="community_member", target_id=member_id,
            outcome="denied", reason_code="owner_locked",
        )
        raise HTTPException(409, "Owner membership cannot be changed")
    community = await db.communities.find_one({"id": member["community_id"]}, {"_id": 0, "id": 1, "name": 1, "join_policy": 1})
    if not community:
        await staff.audit_denied(
            user, "community.member_review", target_type="community", target_id=member.get("community_id") or member_id,
            outcome="failed", reason_code="not_found",
        )
        raise HTTPException(404, "Community not found")
    if body.status == "active" and community.get("join_policy") == "paid":
        await staff.audit_denied(
            user, "community.member_review", target_type="community_member", target_id=member_id,
            outcome="failed", reason_code="paid_plan",
        )
        raise HTTPException(402, "Only verified billing can activate paid memberships")
    updates = {"status": body.status, "updated_at": now(), "reviewed_by": user["id"]}
    if body.status == "active":
        updates["joined_at"] = now()
    claimed = await db.community_members.update_one({"id": member_id, "status": "pending"}, {"$set": updates})
    if claimed.modified_count != 1:
        # The other reviewer won the pending row. No audit row for this loser.
        raise HTTPException(409, "Only a pending request can be reviewed here")
    await staff.audit(
        user, f"community.member_{body.status}", target_type="community_member",
        target_id=member_id, reason=body.reason.strip(),
        metadata={"community_id": member["community_id"], "user_id": member["user_id"], "from": "pending", "to": body.status},
    )
    approved = body.status == "active"
    await notifications.notify(
        member["user_id"], notifications.MEMBERSHIP, actor=user,
        title=(f"You joined {community['name']}" if approved
               else f"Your request to join {community['name']} was declined"),
        target_type="community", target_id=community["id"],
        metadata={"approved": approved},
    )
    return clean(await db.community_members.find_one({"id": member_id}, MEMBERSHIP_FIELDS))


# --------------------------------------------------------------------------- #
# Support tickets                                                              #
# The queue is account and conversation data only — never health rows.        #
# --------------------------------------------------------------------------- #
@router.get("/admin/tickets")
async def list_admin_tickets(
    status: tickets.TicketStatus | None = None,
    q: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=100),
    unassigned: bool = False,
    user: dict = Depends(staff.require("tickets.read")),
    cursor: str | None = None,
):
    return await tickets.list_for_staff(status, q, limit, unassigned=unassigned, cursor=cursor)


@router.get("/admin/tickets/{ticket_id}")
async def get_admin_ticket(ticket_id: str, user: dict = Depends(staff.require("tickets.read"))):
    return await tickets.staff_detail(ticket_id)


@router.patch("/admin/tickets/{ticket_id}")
async def update_admin_ticket(
    ticket_id: str,
    body: tickets.TicketPatchIn,
    user: dict = Depends(staff.require("tickets.write")),
):
    return await tickets.update_for_staff(ticket_id, body, user)


@router.post("/admin/tickets/{ticket_id}/messages", status_code=201)
async def reply_admin_ticket(
    ticket_id: str,
    body: tickets.MessageIn,
    user: dict = Depends(staff.require("tickets.write")),
):
    try:
        ticket = await tickets.require_ticket(ticket_id)
    except HTTPException:
        await staff.audit_denied(
            user, "ticket.replied", target_type="ticket", target_id=ticket_id,
            outcome="failed", reason_code="not_found",
        )
        raise
    # Staff can still leave a closing note after the member is locked out.
    try:
        message = await tickets.add_message(ticket, user, body, "staff")
    except HTTPException as exc:
        code = "media_not_owned" if exc.status_code == 422 else "reply_rejected"
        await staff.audit_denied(
            user, "ticket.replied", target_type="ticket", target_id=ticket_id,
            outcome="failed", reason_code=code,
        )
        raise
    # The reply body stays on the ticket. The audit row names the actor, the
    # ticket, and the status at send time. It does not copy the message.
    await staff.audit(
        user, "ticket.replied", target_type="ticket", target_id=ticket_id,
        metadata={
            "message_id": message.get("id"),
            "from": ticket.get("status"),
            "to": ticket.get("status"),
            "has_attachment": bool(message.get("media_id")),
        },
    )
    return message


# --------------------------------------------------------------------------- #
# Audit trail (read-only by design: no update or delete endpoint exists)       #
# --------------------------------------------------------------------------- #
@router.get("/admin/audit-log")
async def audit_log(
    actor_id: str | None = None,
    target_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    user: dict = Depends(staff.require("audit.read")),
    actor: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
    cursor: str | None = None,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
    outcome: Literal["success", "failed", "denied"] | None = None,
):
    """Read-only. `outcome` is success, failed, or denied. Rows written before outcomes count as success."""
    query: dict = {key: value for key, value in (("actor_id", actor_id), ("target_id", target_id), ("target_type", target_type)) if value}
    if outcome == "success":
        query = admin_pages.and_query(query, {"$or": [{"outcome": "success"}, {"outcome": {"$exists": False}}]})
    elif outcome in {"failed", "denied"}:
        query = admin_pages.and_query(query, {"outcome": outcome})
    if actor:
        safe = re.escape(actor.strip()[:80])
        actor_clause = {"$or": [{"actor_id": actor.strip()}, {"actor_email": {"$regex": safe, "$options": "i"}}]}
        query = admin_pages.and_query(query, actor_clause)
    if action:
        query = admin_pages.and_query(query, {"action": {"$regex": f"^{re.escape(action.strip()[:80])}"}})
    if from_ or to:
        window: dict = {}
        if from_:
            window["$gte"] = from_
        if to:
            window["$lt"] = to
        query = admin_pages.and_query(query, {"created_at": window})
    total = await db.audit_log.count_documents(query)
    window_query = query
    if cursor:
        created_s, doc_id = admin_pages.decode_cursor(cursor, 2)
        window_query = admin_pages.and_query(query, admin_pages.before_desc(
            "created_at", admin_pages.parse_instant(created_s), doc_id,
        ))
    rows = [
        clean(row) or {}
        async for row in db.audit_log.find(window_query, {"_id": 0}).sort([("created_at", -1), ("id", -1)]).limit(limit + 1)
    ]
    extra = len(rows) > limit
    rows = rows[:limit]
    return {"entries": rows, "total": total, "next_cursor": _page_cursor(rows, extra, "created_at", "id")}


@router.get("/admin/accounting/summary")
async def accounting_summary(
    user: dict = Depends(staff.require("accounting.read")),
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: Annotated[date | None, Query(alias="to")] = None,
):
    """Money already on file, grouped by the currency stored on each row."""
    if "accounting.read" not in staff.permissions_for(user):
        raise HTTPException(403, "Staff permission required")
    try:
        start_day, end_day, start, end = accounting.resolve_period(from_, to)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    report = await accounting.summary(start, end, start_day, end_day)
    await staff.audit(
        user, "accounting.viewed",
        target_type="report", target_id="accounting_summary",
        metadata={"from": start_day.isoformat(), "to": end_day.isoformat()},
    )
    return report
