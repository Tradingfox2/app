"""The social graph: following, follow requests, blocking and muting.

Three rules shape everything here.

**Follow state lives on the edge.** A `follows` row carries `status` of
`active` or `pending`. Rows written before follow requests existed have no
`status` field at all, so every query treats a missing status as `active` —
that is what `ACTIVE` encodes, and it is why this ships without a migration.

**A private account converts a follow into a request.** Following a public
account is immediate; following a private one creates a pending edge that the
target approves or denies. Nothing about a pending edge grants visibility.

**Blocking is symmetric and beats everything.** A block removes existing edges
in both directions and prevents new ones, notifications, and DMs. Muting is
one-way and silent: the muted person is never told, and only the feed is
affected — they can still interact.
"""
from __future__ import annotations

from server import db, new_id, now

#: A follow written before requests existed has no `status`; treat it as active.
ACTIVE = {"$ne": "pending"}


async def is_private(user_id: str) -> bool:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "is_private": 1})
    return bool(user and user.get("is_private"))


async def blocked_between(a: str, b: str) -> bool:
    """True when either party has blocked the other. Blocking is symmetric."""
    return bool(await db.blocks.find_one(
        {"$or": [{"blocker_id": a, "blocked_id": b}, {"blocker_id": b, "blocked_id": a}]},
        {"_id": 1},
    ))


async def follow_state(follower_id: str, followee_id: str) -> str:
    """One of `none`, `pending`, `following`."""
    edge = await db.follows.find_one(
        {"follower_id": follower_id, "followee_id": followee_id}, {"_id": 0, "status": 1}
    )
    if not edge:
        return "none"
    return "pending" if edge.get("status") == "pending" else "following"


async def follows_actively(follower_id: str, followee_id: str) -> bool:
    return bool(await db.follows.find_one(
        {"follower_id": follower_id, "followee_id": followee_id, "status": ACTIVE}, {"_id": 1}
    ))


async def counts(user_id: str) -> tuple[int, int]:
    """(followers, following), counting accepted edges only."""
    followers = await db.follows.count_documents({"followee_id": user_id, "status": ACTIVE})
    following = await db.follows.count_documents({"follower_id": user_id, "status": ACTIVE})
    return followers, following


async def can_view_profile(viewer_id: str, target_id: str) -> bool:
    """A private account's posts are visible to accepted followers only."""
    if viewer_id == target_id:
        return True
    if await blocked_between(viewer_id, target_id):
        return False
    if not await is_private(target_id):
        return True
    return await follows_actively(viewer_id, target_id)


async def muted_ids(user_id: str) -> list[str]:
    return [
        row["muted_id"]
        async for row in db.mutes.find({"muter_id": user_id}, {"_id": 0, "muted_id": 1})
    ]


async def blocked_ids(user_id: str) -> list[str]:
    """Everyone this user cannot see, in either direction."""
    ids = set()
    async for row in db.blocks.find(
        {"$or": [{"blocker_id": user_id}, {"blocked_id": user_id}]},
        {"_id": 0, "blocker_id": 1, "blocked_id": 1},
    ):
        ids.add(row["blocked_id"] if row["blocker_id"] == user_id else row["blocker_id"])
    return list(ids)


async def hidden_author_ids(user_id: str) -> list[str]:
    """Authors to strip from a feed: everyone blocked, plus everyone muted."""
    return list({*await blocked_ids(user_id), *await muted_ids(user_id)})


async def create_follow(follower_id: str, followee_id: str) -> dict:
    """Follow, or request to follow a private account. Idempotent."""
    existing = await db.follows.find_one(
        {"follower_id": follower_id, "followee_id": followee_id}, {"_id": 0}
    )
    if existing:
        return existing
    status = "pending" if await is_private(followee_id) else "active"
    edge = {
        "id": new_id(),
        "follower_id": follower_id,
        "followee_id": followee_id,
        "status": status,
        "created_at": now(),
    }
    await db.follows.insert_one(dict(edge))
    return edge


async def block(blocker_id: str, blocked_id: str) -> dict:
    """Block and sever. Existing edges go both ways, so both are removed."""
    await db.follows.delete_many({"$or": [
        {"follower_id": blocker_id, "followee_id": blocked_id},
        {"follower_id": blocked_id, "followee_id": blocker_id},
    ]})
    existing = await db.blocks.find_one(
        {"blocker_id": blocker_id, "blocked_id": blocked_id}, {"_id": 0}
    )
    if existing:
        return existing
    row = {"id": new_id(), "blocker_id": blocker_id, "blocked_id": blocked_id, "created_at": now()}
    await db.blocks.insert_one(dict(row))
    return row


async def unblock(blocker_id: str, blocked_id: str) -> None:
    await db.blocks.delete_one({"blocker_id": blocker_id, "blocked_id": blocked_id})


async def mute(muter_id: str, muted_id: str) -> dict:
    existing = await db.mutes.find_one({"muter_id": muter_id, "muted_id": muted_id}, {"_id": 0})
    if existing:
        return existing
    row = {"id": new_id(), "muter_id": muter_id, "muted_id": muted_id, "created_at": now()}
    await db.mutes.insert_one(dict(row))
    return row


async def unmute(muter_id: str, muted_id: str) -> None:
    await db.mutes.delete_one({"muter_id": muter_id, "muted_id": muted_id})
