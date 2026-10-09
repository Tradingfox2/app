"""Opaque cursors for staff lists.

`total` is the size of the filtered collection. `count` on older payloads is
only the page length. A cursor is not a contract: callers send it back as-is.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import HTTPException


def encode_cursor(*parts: str) -> str:
    raw = "\x1f".join(parts)
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(token: str, width: int) -> tuple[str, ...]:
    try:
        padded = token + ("=" * (-len(token) % 4))
        text = base64.urlsafe_b64decode(padded.encode()).decode()
        parts = text.split("\x1f")
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422, "Invalid page cursor") from exc
    if len(parts) != width or any(not part for part in parts):
        raise HTTPException(422, "Invalid page cursor")
    return tuple(parts)


def parse_instant(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(422, "Invalid page cursor") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def and_query(query: dict, extra: dict | None) -> dict:
    if not extra:
        return query
    if not query:
        return extra
    return {"$and": [query, extra]}


def before_desc(field: str, instant: datetime, doc_id: str, *, id_op: str = "$lt") -> dict:
    """Rows that sort after `(instant, doc_id)` when `field` is descending."""
    return {"$or": [
        {field: {"$lt": instant}},
        {field: instant, "id": {id_op: doc_id}},
    ]}


def after_asc(field: str, instant: datetime, doc_id: str) -> dict:
    """Rows that sort after `(instant, doc_id)` when `field` is ascending."""
    return {"$or": [
        {field: {"$gt": instant}},
        {field: instant, "id": {"$gt": doc_id}},
    ]}
