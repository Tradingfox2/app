"""Repository helpers for user + admin media metadata (Mongo mirror).

User media reuses the existing `media` collection shape (no purpose column in v1).
Admin media uses `admin_media`. Bytes always go through media_storage.store.
"""
from __future__ import annotations

from typing import Literal

import media_storage
from server import clean, db, new_id, now

AdminPurpose = Literal[
    "announcement", "moderation_evidence", "exercise_library", "community_asset", "other"
]


async def create_user_media(
    *,
    user_id: str,
    data: bytes,
    content_type: str,
) -> dict:
    kind = media_storage.kind_for(content_type)
    if not kind:
        raise ValueError("Unsupported content type for user media")
    if not data or not media_storage.sniff_ok(content_type, data):
        raise ValueError("File content does not match declared type")
    media_id = new_id()
    key = f"users/{user_id}/{media_id}.{media_storage.extension_for(content_type)}"
    url = media_storage.store(key, data, content_type)
    doc = {
        "id": media_id,
        "user_id": user_id,
        "kind": kind,
        "content_type": content_type,
        "bytes": len(data),
        "key": key,
        "url": url,
        "created_at": now(),
    }
    await db.media.insert_one(doc)
    return clean(doc)


async def create_admin_media(
    *,
    staff_id: str,
    data: bytes,
    content_type: str,
    purpose: AdminPurpose,
    kind: Literal["image", "video", "file"] | None = None,
) -> dict:
    sniffed = media_storage.kind_for(content_type)
    resolved_kind = kind or sniffed or "file"
    if sniffed and data and not media_storage.sniff_ok(content_type, data):
        raise ValueError("File content does not match declared type")
    asset_id = new_id()
    ext = media_storage.extension_for(content_type) if sniffed else "bin"
    key = f"admin/{staff_id}/{asset_id}.{ext}"
    url = media_storage.store(key, data, content_type)
    doc = {
        "id": asset_id,
        "uploader_staff_id": staff_id,
        "kind": resolved_kind,
        "content_type": content_type,
        "bytes": len(data),
        "key": key,
        "url": url,
        "purpose": purpose,
        "created_at": now(),
        "deleted_at": None,
    }
    await db.admin_media.insert_one(doc)
    return clean(doc)
