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
POST_KUDOS = "post_kudos"
POST_COMMENT = "post_comment"
POST_REPOST = "post_repost"
POST_MENTION = "post_mention"
MENTION = "mention"
DIRECT_MESSAGE = "direct_message"
MEMBERSHIP = "membership"
COACH_DECISION = "coach_decision"
LIVE_SESSION = "live_session"
PROGRAM_ADOPTED = "program_adopted"
COMMENT_REPLY = "comment_reply"
COMMENT_LIKE = "comment_like"
JOIN_REQUEST = "join_request"

#: Repeated events on the same object collapse into one row instead of
#: flooding the list — "X and 4 others liked your post". Only unread rows
#: inside this window absorb a new actor; anything older starts a fresh one.
AGGREGATABLE = {POST_LIKE, POST_KUDOS, POST_COMMENT, POST_REPOST, PROGRAM_ADOPTED, COMMENT_LIKE, DIRECT_MESSAGE, JOIN_REQUEST}
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


#: Always delivered, whatever the member's settings: account decisions and
#: moderation outcomes are things a person must be told about.
MANDATORY = {MEMBERSHIP, COACH_DECISION, "moderation_action", "lab_report_ready"}

#: The types a member can switch off, in the order the settings screen lists them.
CONFIGURABLE = (
    FOLLOW, FOLLOW_REQUEST, FOLLOW_ACCEPTED, POST_LIKE, POST_KUDOS, POST_COMMENT, POST_REPOST,
    POST_MENTION, MENTION, COMMENT_REPLY, COMMENT_LIKE, DIRECT_MESSAGE,
    LIVE_SESSION, PROGRAM_ADOPTED, JOIN_REQUEST,
)


async def preferences(user_id: str) -> dict:
    """`{"push": bool, "types": {type: bool}}` with defaults filled in."""
    row = await db.users.find_one({"id": user_id}, {"_id": 0, "notification_prefs": 1}) or {}
    stored = row.get("notification_prefs") or {}
    types = stored.get("types") or {}
    return {"push": stored.get("push", True),
            "types": {kind: bool(types.get(kind, True)) for kind in CONFIGURABLE}}


async def _wanted(user_id: str, kind: str) -> tuple[bool, bool]:
    """(record in-app, also push). A switched-off type does neither."""
    if kind in MANDATORY:
        prefs = await preferences(user_id)
        return True, prefs["push"]
    prefs = await preferences(user_id)
    enabled = prefs["types"].get(kind, True)
    return enabled, enabled and prefs["push"]


def _push(user_id: str, notification: dict) -> None:
    import push  # lazy: keeps this module light for callers that never push

    metadata = notification.get("metadata") or {}
    push.notify(user_id, notification["title"], notification.get("body") or "", {
        "notification_id": notification["id"], "type": notification["type"],
        **{key: metadata[key] for key in ("target_type", "target_id", "channel_id") if metadata.get(key)},
    })


async def create(
    user_id: str,
    kind: str,
    title: str,
    body: str = "",
    metadata: dict | None = None,
) -> dict | None:
    recorded, pushed = await _wanted(user_id, kind)
    if not recorded:
        return None
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
    if pushed:
        _push(user_id, notification)
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
    recorded, pushed = await _wanted(recipient_id, kind)
    if not recorded:
        return None  # the member switched this kind of notification off

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
    if pushed:
        _push(recipient_id, notification)
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
    target_type: str | None = None,
    target_id: str | None = None,
) -> list[str]:
    """Notify everyone mentioned in `content`. Returns the ids actually notified.

    Goes through `notify()`, so the same rules as every other social event
    apply: no self-mention, nothing across a block. When `audience` is given,
    mentions outside it are ignored so a message cannot be used to ping someone
    who is not in the room.
    """
    notified = []
    for user_id in parse_mentions(content):
        if audience is not None and user_id not in audience:
            continue
        row = await notify(
            user_id, kind, actor=author, title=title,
            body=(content or "")[:200],
            target_type=target_type, target_id=target_id, metadata=metadata,
        )
        if row:
            notified.append(user_id)
    return notified
