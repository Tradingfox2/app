"""Search across people, communities and posts.

Every result set is filtered by the same rules as the surfaces it mirrors:
people exclude anyone blocked in either direction and suspended accounts;
communities are public and not archived; posts reuse the feed's visibility
query, so search can never surface a post the feed would hide.

Case-insensitive regex with the input escaped and capped, following
`admin.py::list_users`. There is no text index: MongoDB allows one per
collection and the test harness builds no indexes, so a `$text` query would
diverge between tests and production. Revisit when result volume demands it.
"""
from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Depends, Query

import ratelimit
import social_graph
from routers import community, social
from server import clean, current_user, db

router = APIRouter()

MAX_QUERY = 80


@router.get("/search")
async def search(
    q: str = Query(min_length=2, max_length=MAX_QUERY),
    kind: Literal["users", "communities", "posts", "tags"] = Query(default="users", alias="type"),
    limit: int = Query(default=20, ge=1, le=50),
    user: dict = Depends(current_user),
):
    await ratelimit.hit("search", user["id"])
    # Escaped, so a query is always matched literally and can never become a
    # catastrophic regex supplied by the caller.
    pattern = {"$regex": re.escape(q.strip()[:MAX_QUERY]), "$options": "i"}

    if kind == "users":
        hidden = await social_graph.blocked_ids(user["id"])
        rows = [
            clean(row)
            async for row in db.users.find(
                # Name only, never email: email is not public information.
                {"full_name": pattern, "id": {"$nin": hidden}, "suspended_at": None},
                {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1, "is_private": 1},
            ).limit(limit)
        ]
        for row in rows:
            row["follow_state"] = await social_graph.follow_state(user["id"], row["id"])
            row["is_private"] = bool(row.get("is_private"))
        return {"type": kind, "results": rows}

    if kind == "communities":
        rows = [
            row
            async for row in db.communities.find(
                {"is_public": True, "status": {"$ne": "archived"},
                 "$or": [{"name": pattern}, {"slug": pattern}, {"description": pattern}]},
                {"_id": 0},
            ).limit(limit)
        ]
        return {"type": kind,
                "results": [await community._community_view(row, user["id"]) for row in rows]}

    if kind == "tags":
        # Hashtags that start with the query, ranked by how many posts the
        # viewer can see carry them — the same visibility as the tag's feed,
        # so a tag used only in private posts never shows up here.
        prefix = re.escape(q.strip().lstrip("#").lower()[:50])
        if not prefix:
            return {"type": kind, "results": []}
        query = await social._visible_post_query(user["id"])
        query["tags"] = {"$regex": f"^{prefix}"}
        rows = [row async for row in db.posts.aggregate([
            {"$match": query}, {"$unwind": "$tags"},
            {"$match": {"tags": {"$regex": f"^{prefix}"}}},
            {"$group": {"_id": "$tags", "posts": {"$sum": 1}}},
            {"$sort": {"posts": -1, "_id": 1}}, {"$limit": limit},
        ])]
        return {"type": kind, "results": [{"tag": row["_id"], "posts": row["posts"]} for row in rows]}

    query = await social._visible_post_query(user["id"])
    query["content"] = pattern
    posts = [
        row async for row in db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    ]
    decorated = await social._decorate(await social._with_originals(posts, user["id"]), user["id"])
    return {"type": kind, "results": decorated}
