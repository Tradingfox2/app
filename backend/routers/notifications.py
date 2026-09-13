"""The in-app notification center.

The `notifications` collection predates this router — labs, the staff console
and community mentions all write to it — but nothing ever read it back beyond a
single unfiltered list endpoint in `labs.py`. That endpoint moved here so the
collection has one owner and one shape.

Notifications are per-user by construction: every query is scoped to
`user["id"]`, so one member can never read another's.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from server import clean, current_user, db, now

router = APIRouter()


@router.get("/notifications")
async def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    user: dict = Depends(current_user),
):
    query: dict = {"user_id": user["id"]}
    if unread_only:
        query["read_at"] = None
    return [
        clean(row)
        async for row in db.notifications.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    ]


@router.get("/notifications/unread-count")
async def unread_count(user: dict = Depends(current_user)):
    return {"count": await db.notifications.count_documents(
        {"user_id": user["id"], "read_at": None}
    )}


@router.post("/notifications/{notification_id}/read")
async def mark_read(notification_id: str, user: dict = Depends(current_user)):
    notification = await db.notifications.find_one(
        {"id": notification_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not notification:
        raise HTTPException(404, "Notification not found")
    if notification.get("read_at"):
        return clean(notification)  # idempotent: re-reading is not an error
    stamp = now()
    await db.notifications.update_one(
        {"id": notification_id}, {"$set": {"read_at": stamp}}
    )
    return clean({**notification, "read_at": stamp})


@router.post("/notifications/read-all")
async def mark_all_read(user: dict = Depends(current_user)):
    result = await db.notifications.update_many(
        {"user_id": user["id"], "read_at": None}, {"$set": {"read_at": now()}}
    )
    return {"updated": result.modified_count}
