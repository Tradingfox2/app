"""The in-app notification center.

The `notifications` collection predates this router — labs, the staff console
and community mentions all write to it — but nothing ever read it back beyond a
single unfiltered list endpoint in `labs.py`. That endpoint moved here so the
collection has one owner and one shape.

Notifications are per-user by construction: every query is scoped to
`user["id"]`, so one member can never read another's.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import notifications
from server import clean, current_user, db, new_id, now

router = APIRouter()


class PreferencesIn(BaseModel):
    push: bool | None = None
    #: Only the configurable kinds; unknown keys are rejected, mandatory ones
    #: (moderation, membership decisions) cannot be switched off.
    types: dict[str, bool] = Field(default_factory=dict)


class PushTokenIn(BaseModel):
    #: `ExponentPushToken[...]` from expo-notifications.
    token: str = Field(min_length=10, max_length=200, pattern=r"^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$")
    platform: Literal["ios", "android", "web"] = "android"


@router.get("/notifications")
async def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    user: dict = Depends(current_user),
    before: str | None = None,
):
    query: dict = {"user_id": user["id"]}
    if unread_only:
        query["read_at"] = None
    if before:
        cursor = await db.notifications.find_one({"id": before, "user_id": user["id"]}, {"_id": 0, "created_at": 1})
        if not cursor:
            raise HTTPException(404, "Notification cursor not found")
        query["created_at"] = {"$lt": cursor["created_at"]}
    rows = [
        clean(row)
        async for row in db.notifications.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    ]
    # Without this the aggregation can show "3 people" but never say who.
    return await notifications.resolve_actors(rows)


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


@router.delete("/notifications/{notification_id}", status_code=204)
async def delete_notification(notification_id: str, user: dict = Depends(current_user)):
    result = await db.notifications.delete_one({"id": notification_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Notification not found")


@router.delete("/notifications")
async def clear_read_notifications(user: dict = Depends(current_user)):
    """Clear everything already read. Unread rows stay: clearing is tidying,
    not a way to lose something you have not seen yet."""
    result = await db.notifications.delete_many({"user_id": user["id"], "read_at": {"$ne": None}})
    return {"deleted": result.deleted_count}


@router.get("/notifications/preferences")
async def get_preferences(user: dict = Depends(current_user)):
    return await notifications.preferences(user["id"])


@router.put("/notifications/preferences")
async def update_preferences(body: PreferencesIn, user: dict = Depends(current_user)):
    unknown = set(body.types) - set(notifications.CONFIGURABLE)
    if unknown:
        raise HTTPException(422, f"Unknown or mandatory notification types: {', '.join(sorted(unknown))}")
    current = await notifications.preferences(user["id"])
    merged = {"push": current["push"] if body.push is None else body.push,
              "types": {**current["types"], **body.types}}
    await db.users.update_one({"id": user["id"]}, {"$set": {"notification_prefs": merged}})
    return merged


@router.post("/push-tokens", status_code=201)
async def register_push_token(body: PushTokenIn, user: dict = Depends(current_user)):
    """Register this device. A token moves to whoever signed in on it last,
    so a shared phone never pushes the previous person's notifications."""
    await db.push_tokens.update_one(
        {"token": body.token},
        {"$set": {"user_id": user["id"], "platform": body.platform, "updated_at": now()},
         "$setOnInsert": {"id": new_id(), "created_at": now()}},
        upsert=True,
    )
    return {"registered": True}


@router.delete("/push-tokens", status_code=204)
async def unregister_push_token(body: PushTokenIn, user: dict = Depends(current_user)):
    """Called on sign-out, so a signed-out device stops receiving pushes."""
    await db.push_tokens.delete_one({"token": body.token, "user_id": user["id"]})
