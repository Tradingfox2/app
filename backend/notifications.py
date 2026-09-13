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
from datetime import timedelta

import social_graph
from server import clean, db, new_id, now

#: The event taxonomy. Split the way the research on notification systems
#: splits it: things that happened to your content ("transaction awareness")
#: versus somebody addressing you directly ("communication").
FOLLOW = "follow"
FOLLOW_REQUEST = "follow_request"
FOLLOW_ACCEPTED = "follow_accepted"
POST_LIKE = "post_like"
POST_COMMENT = "post_comment"
POST_REPOST = "post_repost"
POST_MENTION = "post_mention"
MENTION = "mention"
DIRECT_MESSAGE = "direct_message"
MEMBERSHIP = "membership"
COACH_DECISION = "coach_decision"

#: Repeated events on the same object collapse into one row instead of
#: flooding the list — "X and 4 others liked your post". Only unread rows
#: inside this window absorb a new actor; anything older starts a fresh one.
AGGREGATABLE = {POST_LIKE, POST_COMMENT, POST_REPOST}
AGGREGATION_WINDOW = timedelta(hours=24)

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
        "actor_ids": [],
        "actor_count": 0,
        "read_at": None,
        "created_at": now(),
    }
    await db.notifications.insert_one(dict(notification))
    return notification


async def notify(
    recipient_id: str,
    kind: str,
    *,
    actor: dict | None = None,
    title: str,
    body: str = "",
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict | None = None,
) -> dict | None:
    """Record a social event for `recipient_id`.

    Returns None when the event should not produce a notification at all:
    acting on your own content, or either party having blocked the other.
    Callers fire-and-forget, so the suppression rules live here rather than
    being re-implemented at every trigger site.
    """
    actor_id = (actor or {}).get("id")
    if actor_id and actor_id == recipient_id:
        return None  # nobody needs telling about their own action
    if actor_id and await social_graph.blocked_between(actor_id, recipient_id):
        return None

    payload = {**(metadata or {})}
    if actor_id:
        payload["actor_id"] = actor_id
    if target_type:
        payload["target_type"] = target_type
    if target_id:
        payload["target_id"] = target_id

    if kind in AGGREGATABLE and target_id and actor_id:
        existing = await db.notifications.find_one(
            {
                "user_id": recipient_id,
                "type": kind,
                "metadata.target_id": target_id,
                "read_at": None,
                "created_at": {"$gte": now() - AGGREGATION_WINDOW},
            },
            {"_id": 0},
        )
        if existing:
            # $addToSet keeps a repeat action from inflating the count.
            await db.notifications.update_one(
                {"id": existing["id"]},
                {"$addToSet": {"actor_ids": actor_id},
                 "$set": {"title": title, "body": body, "created_at": now()}},
            )
            refreshed = await db.notifications.find_one({"id": existing["id"]}, {"_id": 0})
            if refreshed:
                await db.notifications.update_one(
                    {"id": existing["id"]},
                    {"$set": {"actor_count": len(refreshed.get("actor_ids") or [])}},
                )
            return clean(await db.notifications.find_one({"id": existing["id"]}, {"_id": 0}))

    notification = {
        "id": new_id(),
        "user_id": recipient_id,
        "type": kind,
        "title": title,
        "body": body,
        "metadata": payload,
        "actor_ids": [actor_id] if actor_id else [],
        "actor_count": 1 if actor_id else 0,
        "read_at": None,
        "created_at": now(),
    }
    await db.notifications.insert_one(dict(notification))
    return clean(notification)


async def resolve_actors(rows: list[dict]) -> list[dict]:
    """Attach display info for the actors behind each notification."""
    ids = {actor for row in rows for actor in (row.get("actor_ids") or [])}
    if not ids:
        return rows
    people = {
        person["id"]: person
        async for person in db.users.find(
            {"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1}
        )
    }
    for row in rows:
        row["actors"] = [people[a] for a in (row.get("actor_ids") or []) if a in people]
    return rows


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
