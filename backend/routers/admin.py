"""Back-office console: accounts, moderation queue, staff management, audit trail.

Privacy boundary: staff endpoints expose account and moderation data only. Health
data (biomarkers, lab reports), direct messages and private channel messages are
never returned here — moderation works from what the reporter submitted.
"""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import notifications
import staff
from server import clean, current_user, db, new_id, now

router = APIRouter()

REPORT_REASONS = ("spam", "harassment", "dangerous_advice", "sexual_content", "violence", "other")


class ReportIn(BaseModel):
    target_type: Literal["post", "comment", "message", "user", "community"]
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
        return clean(existing)
    # Snapshot the reported content: moderators must not need read access to
    # private conversations to judge a report.
    snapshot = ""
    if body.target_type in {"post", "comment", "message"}:
        collection = {"post": db.posts, "comment": db.post_comments, "message": db.messages}[body.target_type]
        document = await collection.find_one({"id": body.target_id}, {"_id": 0, "content": 1, "author_id": 1})
        if not document:
            raise HTTPException(404, "Reported content not found")
        snapshot = (document.get("content") or "")[:1000]
        reported_user = document.get("author_id")
    else:
        reported_user = body.target_id if body.target_type == "user" else None
    report = {
        "id": new_id(), "reporter_id": user["id"], "reported_user_id": reported_user,
        "target_type": body.target_type, "target_id": body.target_id,
        "reason": body.reason, "detail": body.detail.strip(), "content_snapshot": snapshot,
        "status": "open", "resolution": None, "reviewed_by": None, "reviewed_at": None,
        "created_at": now(),
    }
    await db.reports.insert_one(report)
    return clean(report)


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
        if report["target_type"] == "post":
            await db.posts.update_one({"id": report["target_id"]}, {"$set": {"status": "deleted", "deleted_at": now(), "removed_by": user["id"]}})
        elif report["target_type"] == "comment":
            await db.post_comments.update_one({"id": report["target_id"]}, {"$set": {"status": "removed", "removed_by": user["id"]}})
        elif report["target_type"] == "message":
            await db.messages.update_one({"id": report["target_id"]}, {"$set": {"status": "removed", "removed_by": user["id"]}})
        else:
            raise HTTPException(409, "This target type cannot be removed automatically")
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
