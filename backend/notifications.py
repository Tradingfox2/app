"""Mentions and the in-app notification center.

Mentions are stored as structured `<@user_id>` tokens rather than raw `@name`
text. Names are not unique, they change, and parsing them invites both misfires
and impersonation; the composer emits the id and the client renders the display
name at read time.

The `notifications` collection predates this module — labs and the staff console
already write to it — so `create()` matches the shape `GET /api/notifications`
already returns.
"""
from __future__ import annotations

import re

from server import clean, db, new_id, now

#: `<@a1b2c3d4-...>` — what the composer emits when a member picks a suggestion.
#: Deliberately permissive about the id charset: membership is what decides who
#: actually gets notified, so an unknown id simply resolves to nobody, and the
#: pattern survives any future change to how ids are minted.
MENTION_PATTERN = re.compile(r"<@([A-Za-z0-9_-]{1,64})>")
EVERYONE_TOKEN = "@everyone"


def parse_mentions(content: str) -> list[str]:
    """User ids mentioned in `content`, de-duplicated, in first-seen order."""
    seen: dict[str, None] = {}
    for match in MENTION_PATTERN.finditer(content or ""):
        seen.setdefault(match.group(1), None)
    return list(seen)


def mentions_everyone(content: str) -> bool:
    return EVERYONE_TOKEN in (content or "")


def strip_everyone(content: str) -> str:
    """Remove the everyone token from content the author may not broadcast."""
    return (content or "").replace(EVERYONE_TOKEN, "").strip()


async def resolve_mentions(content: str) -> list[dict]:
    """Display names for the ids mentioned in `content`.

    The client renders `<@id>` from this list, so a message stays readable even
    after a member changes their name — the token is the id, never the label.
    """
    ids = parse_mentions(content)
    if not ids:
        return []
    return [
        clean(row)
        async for row in db.users.find(
            {"id": {"$in": ids}}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1}
        )
    ]


async def create(
    user_id: str,
    kind: str,
    title: str,
    body: str = "",
    metadata: dict | None = None,
) -> dict:
    notification = {
        "id": new_id(),
        "user_id": user_id,
        "type": kind,
        "title": title,
        "body": body,
        "metadata": metadata or {},
        "read_at": None,
        "created_at": now(),
    }
    await db.notifications.insert_one(dict(notification))
    return notification


async def notify_mentions(
    content: str,
    *,
    author: dict,
    kind: str,
    title: str,
    metadata: dict | None = None,
    audience: set[str] | None = None,
) -> list[str]:
    """Notify everyone mentioned in `content`. Returns the ids actually notified.

    Self-mentions are skipped — nobody needs a notification for their own post.
    When `audience` is given, mentions outside it are ignored so a message
    cannot be used to ping someone who is not in the room.
    """
    notified = []
    for user_id in parse_mentions(content):
        if user_id == author.get("id"):
            continue
        if audience is not None and user_id not in audience:
            continue
        await create(
            user_id, kind, title,
            body=(content or "")[:200],
            metadata={**(metadata or {}), "actor_id": author.get("id")},
        )
        notified.append(user_id)
    return notified
