"""Back-office console: accounts, moderation queue, staff management, audit trail.

Privacy boundary: staff endpoints expose account and moderation data only. Health
data (biomarkers, lab reports), direct messages and private channel messages are
never returned here — moderation works from what the reporter submitted.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import accounting
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
        "status": "open", "resolution": None, "reviewed_by": None, "reviewed_at": None,
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
            # Ticket list is paged (max 100). These are the real open/pending totals for Overview.
            "open_tickets": await db.tickets.count_documents({"status": "open"}),
            "pending_tickets": await db.tickets.count_documents({"status": "pending"}),
        },
        "activity": {
            "workouts_24h": await db.workouts.count_documents({"started_at": {"$gte": day_ago}}),
            "posts_24h": await db.posts.count_documents({"created_at": {"$gte": day_ago}, "status": {"$ne": "deleted"}}),
            "messages_24h": await db.messages.count_documents({"created_at": {"$gte": day_ago}}),
            "communities": await db.communities.count_documents({"status": "active"}),
        },
        "permissions": sorted(staff.permissions_for(user)),
        "staff_role": user.get("staff_role"),
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
    user: dict = Depends(staff.require("coaches.review")),
):
    """Coach lists behind the overview card.

    Approved matches the overview count (role coach + approved), including
    coaches who were approved before applications were stored. Banned means
    the account is suspended. Waiting and rejected come from applications.
    """
    rows: list[dict] = []
    if status in {"pending", "rejected"}:
        async for application in db.coach_applications.find(
            {"status": status}, {"_id": 0}
        ).sort("created_at", 1).limit(100):
            person = await db.users.find_one({"id": application["user_id"]}, ACCOUNT_FIELDS)
            rows.append(_coach_directory_row(person, application))
        return rows
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
    async for person in db.users.find(query, ACCOUNT_FIELDS).sort("created_at", -1).limit(100):
        application = await db.coach_applications.find_one({"user_id": person["id"]}, {"_id": 0})
        rows.append(_coach_directory_row(clean(person), application))
    return rows


# --------------------------------------------------------------------------- #
# Accounts                                                                     #
# --------------------------------------------------------------------------- #
@router.get("/admin/users")
async def list_users(
    q: str | None = None,
    status: Literal["all", "active", "suspended", "staff"] = "all",
    limit: int = Query(default=25, ge=1, le=100),
    user: dict = Depends(staff.require("users.read")),
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
    rows = [clean(row) async for row in db.users.find(query, ACCOUNT_FIELDS).sort("created_at", -1).limit(limit)]
    return {"users": rows, "count": len(rows)}


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
    await _account_or_404(user_id)
    note = {"id": new_id(), "user_id": user_id, "author_id": user["id"],
            "author_email": user.get("email"), "note": body.note.strip(), "created_at": now()}
    await db.user_notes.insert_one(dict(note))
    await staff.audit(user, "user.note_added", target_type="user", target_id=user_id)
    return clean(note)


@router.post("/admin/users/{user_id}/suspend")
async def suspend_user(user_id: str, body: SuspensionIn, user: dict = Depends(staff.require("users.suspend"))):
    account = await _account_or_404(user_id)
    if user_id == user["id"]:
        raise HTTPException(409, "You cannot suspend your own account")
    if staff.permissions_for(account) and "staff.manage" not in staff.permissions_for(user):
        raise HTTPException(403, "Only an admin can suspend a staff account")
    until = now() + timedelta(days=body.days) if body.days else None
    await db.users.update_one({"id": user_id}, {"$set": {
        "suspended_at": now(), "suspended_until": until, "suspension_reason": body.reason.strip(),
        "suspended_by": user["id"],
    }})
    await staff.audit(user, "user.suspended", target_type="user", target_id=user_id,
                      reason=body.reason.strip(), metadata={"days": body.days})
    return await _account_or_404(user_id)


@router.post("/admin/users/{user_id}/reinstate")
async def reinstate_user(user_id: str, body: ReinstateIn, user: dict = Depends(staff.require("users.suspend"))):
    await _account_or_404(user_id)
    await db.users.update_one({"id": user_id}, {"$set": {
        "suspended_at": None, "suspended_until": None, "suspension_reason": None, "suspended_by": None,
    }})
    await staff.audit(user, "user.reinstated", target_type="user", target_id=user_id, reason=body.reason.strip())
    return await _account_or_404(user_id)


@router.patch("/admin/users/{user_id}/staff-role")
async def set_staff_role(user_id: str, body: StaffRoleIn, user: dict = Depends(staff.require("staff.manage"))):
    account = await _account_or_404(user_id)
    if user_id == user["id"]:
        raise HTTPException(409, "You cannot change your own staff role")
    await db.users.update_one({"id": user_id}, {"$set": {"staff_role": body.staff_role}})
    await staff.audit(user, "staff.role_changed", target_type="user", target_id=user_id,
                      reason=body.reason.strip(),
                      metadata={"from": account.get("staff_role"), "to": body.staff_role})
    return await _account_or_404(user_id)


# --------------------------------------------------------------------------- #
# Moderation queue                                                             #
# --------------------------------------------------------------------------- #
@router.get("/admin/reports")
async def list_reports(
    status: Literal["open", "resolved"] = "open",
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(staff.require("reports.read")),
):
    reports = [clean(row) async for row in db.reports.find({"status": status}, {"_id": 0}).sort("created_at", 1).limit(limit)]
    for report in reports:
        for key, field in (("reporter_id", "reporter"), ("reported_user_id", "reported_user")):
            identifier = report.get(key)
            report[field] = clean(await db.users.find_one({"id": identifier}, {"_id": 0, "id": 1, "full_name": 1, "email": 1})) if identifier else None
    return reports


@router.patch("/admin/reports/{report_id}")
async def review_report(report_id: str, body: ReportReviewIn, user: dict = Depends(staff.require("reports.resolve"))):
    report = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(404, "Report not found")
    if report["status"] != "open":
        raise HTTPException(409, "Report already resolved")
    if body.resolution == "content_removed":
        if report["target_type"] not in moderation.REMOVABLE:
            raise HTTPException(409, "This target type cannot be removed automatically")
        await moderation.remove_content(report["target_type"], report["target_id"], actor=user)
    await db.reports.update_one({"id": report_id}, {"$set": {
        "status": "resolved", "resolution": body.resolution, "note": body.note.strip(),
        "reviewed_by": user["id"], "reviewed_at": now(),
    }})
    await staff.audit(user, f"report.{body.resolution}", target_type=report["target_type"],
                      target_id=report["target_id"], reason=body.note.strip() or None,
                      metadata={"report_id": report_id, "reason": report["reason"]})
    if report.get("reported_user_id") and body.resolution in {"warning_sent", "content_removed"}:
        # Through notifications.create so the row carries `read_at`, which is
        # the field the notification centre actually reads. A moderation notice
        # is deliberately NOT sent via notify(): it must reach the member even
        # if they have blocked the staff account acting on the report.
        await notifications.create(
            report["reported_user_id"],
            "moderation_action",
            "Community guidelines",
            body.note.strip() or "Content was removed for breaching the guidelines.",
            metadata={"report_id": report_id, "target_type": "report",
                      "target_id": report_id},
        )
    return clean(await db.reports.find_one({"id": report_id}, {"_id": 0}))


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
):
    rows = [
        clean(row)
        async for row in db.community_members.find(
            {"status": status},
            {"_id": 0, "stripe_customer_id": 0, "stripe_subscription_id": 0},
        ).sort("created_at", 1).limit(limit)
    ]
    for row in rows:
        person = await db.users.find_one(
            {"id": row.get("user_id")}, {"_id": 0, "id": 1, "full_name": 1, "email": 1})
        group = await db.communities.find_one(
            {"id": row.get("community_id")}, {"_id": 0, "id": 1, "name": 1, "join_policy": 1})
        row["user"] = clean(person) if person else None
        row["community"] = clean(group) if group else None
    return rows


@router.get("/admin/communities")
async def list_communities(
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(staff.require("users.read")),
):
    rows = [
        clean(row)
        async for row in db.communities.find(
            {},
            {"_id": 0, "id": 1, "name": 1, "status": 1, "join_policy": 1, "owner_id": 1, "created_at": 1},
        ).sort("created_at", -1).limit(limit)
    ]
    for row in rows:
        row["member_count"] = await db.community_members.count_documents(
            {"community_id": row["id"], "status": "active"})
        row["pending_count"] = await db.community_members.count_documents(
            {"community_id": row["id"], "status": "pending"})
        owner = await db.users.find_one(
            {"id": row.get("owner_id")}, {"_id": 0, "id": 1, "full_name": 1, "email": 1})
        row["owner"] = clean(owner) if owner else None
    return rows


@router.patch("/admin/memberships/{member_id}")
async def review_membership(
    member_id: str,
    body: MembershipDecisionIn,
    user: dict = Depends(staff.require("content.moderate")),
):
    member = await db.community_members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(404, "Membership not found")
    if member.get("status") != "pending":
        raise HTTPException(409, "Only a pending request can be reviewed here")
    if member.get("role") == "owner":
        raise HTTPException(409, "Owner membership cannot be changed")
    community = await db.communities.find_one({"id": member["community_id"]}, {"_id": 0, "id": 1, "name": 1, "join_policy": 1})
    if not community:
        raise HTTPException(404, "Community not found")
    if body.status == "active" and community.get("join_policy") == "paid":
        raise HTTPException(402, "Only verified billing can activate paid memberships")
    updates = {"status": body.status, "updated_at": now(), "reviewed_by": user["id"]}
    if body.status == "active":
        updates["joined_at"] = now()
    await db.community_members.update_one({"id": member_id}, {"$set": updates})
    await staff.audit(
        user, f"community.member_{body.status}", target_type="community_member",
        target_id=member_id, reason=body.reason.strip(),
        metadata={"community_id": member["community_id"], "user_id": member["user_id"], "from": "pending"},
    )
    approved = body.status == "active"
    await notifications.notify(
        member["user_id"], notifications.MEMBERSHIP, actor=user,
        title=(f"You joined {community['name']}" if approved
               else f"Your request to join {community['name']} was declined"),
        target_type="community", target_id=community["id"],
        metadata={"approved": approved},
    )
    return clean(await db.community_members.find_one({"id": member_id}, {"_id": 0}))


# --------------------------------------------------------------------------- #
# Support tickets                                                              #
# The queue is account and conversation data only — never health rows.        #
# --------------------------------------------------------------------------- #
@router.get("/admin/tickets")
async def list_admin_tickets(
    status: tickets.TicketStatus | None = None,
    q: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(staff.require("tickets.read")),
):
    return await tickets.list_for_staff(status, q, limit)


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
    ticket = await tickets.require_ticket(ticket_id)
    # Staff can still leave a closing note after the member is locked out.
    return await tickets.add_message(ticket, user, body, "staff")


# --------------------------------------------------------------------------- #
# Audit trail (read-only by design: no update or delete endpoint exists)       #
# --------------------------------------------------------------------------- #
@router.get("/admin/audit-log")
async def audit_log(
    actor_id: str | None = None,
    target_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    user: dict = Depends(staff.require("audit.read")),
):
    query = {key: value for key, value in (("actor_id", actor_id), ("target_id", target_id)) if value}
    return [clean(row) async for row in db.audit_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)]


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
