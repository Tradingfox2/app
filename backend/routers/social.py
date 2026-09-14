"""Social graph: feed, likes, reposts, comments, follows, direct messages, media."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

import media_storage
import staff
import notifications
import social_graph
from server import clean, current_user, db, new_id, now

router = APIRouter()

AUTHOR_FIELDS = {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1}


class PostIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    community_id: str | None = None
    workout_id: str | None = None
    media_ids: list[str] = Field(default_factory=list, max_length=6)


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class DirectMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


async def _author(user_id: str) -> dict | None:
    return clean(await db.users.find_one({"id": user_id}, AUTHOR_FIELDS))


async def _member_community_ids(user_id: str) -> list[str]:
    return [
        row["community_id"]
        async for row in db.community_members.find(
            {"user_id": user_id, "status": "active"}, {"_id": 0, "community_id": 1}
        )
    ]


async def _can_view_post(post: dict, user_id: str) -> bool:
    """One visibility rule for every path that returns a post.

    A community post belongs to the community: its members see it whatever
    the author's account setting, because the community is its own audience.
    A post on the public feed follows the author's account: a private author
    is visible only to accepted followers. Blocking hides both ways, always.
    """
    author_id = post.get("author_id")
    if author_id == user_id:
        return True
    if author_id and await social_graph.blocked_between(user_id, author_id):
        return False
    if post.get("community_id"):
        return post["community_id"] in await _member_community_ids(user_id)
    return await social_graph.can_view_profile(user_id, author_id)


async def _private_hidden_author_ids(viewer_id: str) -> list[str]:
    """Private authors whose public-feed posts this viewer may not see.

    Scans private users rather than denormalising privacy onto posts, so
    flipping the switch takes effect on old posts immediately. Fine at beta
    scale; revisit with a denormalised flag when private users number in the
    tens of thousands.
    """
    private = {
        row["id"] async for row in db.users.find({"is_private": True}, {"_id": 0, "id": 1})
    }
    private.discard(viewer_id)
    if not private:
        return []
    followed = {
        row["followee_id"]
        async for row in db.follows.find(
            {"follower_id": viewer_id, "followee_id": {"$in": list(private)},
             "status": social_graph.ACTIVE},
            {"_id": 0, "followee_id": 1},
        )
    }
    return list(private - followed)


async def _post_or_404(post_id: str, user_id: str) -> dict:
    post = await db.posts.find_one({"id": post_id, "status": {"$ne": "deleted"}}, {"_id": 0})
    if not post or not await _can_view_post(post, user_id):
        raise HTTPException(404, "Post not found")
    return post


async def _decorate(posts: list[dict], viewer_id: str) -> list[dict]:
    ids = [post["id"] for post in posts]
    liked = {row["post_id"] async for row in db.post_likes.find({"post_id": {"$in": ids}, "user_id": viewer_id}, {"_id": 0, "post_id": 1})}
    reposted = {row["repost_of"] async for row in db.posts.find({"repost_of": {"$in": ids}, "author_id": viewer_id, "status": {"$ne": "deleted"}}, {"_id": 0, "repost_of": 1})}
    authors: dict[str, dict | None] = {}
    output = []
    for post in posts:
        for key in (post["author_id"], (post.get("original") or {}).get("author_id")):
            if key and key not in authors:
                authors[key] = await _author(key)
        post["author"] = authors[post["author_id"]]
        if post.get("original"):
            post["original"]["author"] = authors[post["original"]["author_id"]]
        post["liked_by_me"] = post["id"] in liked
        post["reposted_by_me"] = post["id"] in reposted
        post.setdefault("like_count", 0)
        post.setdefault("comment_count", 0)
        post.setdefault("repost_count", 0)
        post.setdefault("media", [])
        output.append(clean(post))
    return output


async def _with_originals(posts: list[dict], viewer_id: str) -> list[dict]:
    original_ids = [post["repost_of"] for post in posts if post.get("repost_of")]
    originals = {row["id"]: row async for row in db.posts.find({"id": {"$in": original_ids}}, {"_id": 0})} if original_ids else {}
    for post in posts:
        if post.get("repost_of"):
            original = originals.get(post["repost_of"])
            # A repost must not launder a private post to the reposter's
            # audience: the original is shown only to viewers who could see it.
            visible = (original and original.get("status") != "deleted"
                       and await _can_view_post(original, viewer_id))
            post["original"] = original if visible else {"id": post["repost_of"], "author_id": post["author_id"], "content": "", "media": [], "unavailable": True}
    return posts


# --------------------------------------------------------------------------- #
# Media                                                                        #
# --------------------------------------------------------------------------- #
@router.post("/media", status_code=201)
async def upload_media(file: UploadFile = File(...), user: dict = Depends(current_user)):
    content_type = (file.content_type or "").lower()
    kind = media_storage.kind_for(content_type)
    if not kind:
        raise HTTPException(415, "Only JPEG, PNG, WebP images and MP4, MOV, WebM videos are accepted")
    limit = media_storage.MAX_IMAGE_BYTES if kind == "image" else media_storage.MAX_VIDEO_BYTES
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds {limit // (1024 * 1024)} MB limit")
    if not data or not media_storage.sniff_ok(content_type, data):
        raise HTTPException(415, "File content does not match its declared type")
    media_id = new_id()
    key = f"users/{user['id']}/{media_id}.{media_storage.extension_for(content_type)}"
    try:
        url = media_storage.store(key, data, content_type)
    except Exception as exc:  # noqa: BLE001 — storage outage must surface, not corrupt posts
        raise HTTPException(503, "Media storage is unavailable") from exc
    doc = {"id": media_id, "user_id": user["id"], "kind": kind, "content_type": content_type,
           "bytes": len(data), "key": key, "url": url, "created_at": now()}
    await db.media.insert_one(doc)
    return clean(doc)


# --------------------------------------------------------------------------- #
# Feed / posts                                                                 #
# --------------------------------------------------------------------------- #
@router.get("/feed")
async def feed(
    scope: Literal["all", "following", "mine"] = "all",
    before: str | None = None,
    limit: int = Query(default=20, ge=1, le=50),
    user: dict = Depends(current_user),
):
    query: dict = {"status": {"$ne": "deleted"}}
    community_ids = await _member_community_ids(user["id"])
    hidden_private = await _private_hidden_author_ids(user["id"])
    public_posts: dict = {"community_id": None}
    if hidden_private:
        public_posts["author_id"] = {"$nin": hidden_private}
    visibility = {"$or": [public_posts, {"community_id": {"$in": community_ids}}]}
    if scope == "mine":
        query["author_id"] = user["id"]
    elif scope == "following":
        following = [
            row["followee_id"]
            async for row in db.follows.find(
                {"follower_id": user["id"], "status": social_graph.ACTIVE},
                {"_id": 0, "followee_id": 1},
            )
        ]
        query["author_id"] = {"$in": [*following, user["id"]]}
    query.update(visibility)
    # Blocked people disappear both ways; muted people only leave the feed.
    hidden = [a for a in await social_graph.hidden_author_ids(user["id"]) if a != user["id"]]
    if hidden and scope != "mine":
        existing = query.get("author_id")
        query["author_id"] = {**existing, "$nin": hidden} if isinstance(existing, dict) else {"$nin": hidden}
    if before:
        cursor = await db.posts.find_one({"id": before}, {"_id": 0, "created_at": 1})
        if cursor:
            query["created_at"] = {"$lt": cursor["created_at"]}
    posts = [row async for row in db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)]
    return await _decorate(await _with_originals(posts, user["id"]), user["id"])


@router.post("/posts", status_code=201)
async def create_post(body: PostIn, user: dict = Depends(current_user)):
    if not body.content.strip() and not body.media_ids:
        raise HTTPException(422, "A post needs text or media")
    if body.community_id:
        if body.community_id not in await _member_community_ids(user["id"]):
            raise HTTPException(403, "Active community membership required")
    media = []
    if body.media_ids:
        # Only the uploader can attach a media object; rejects other users' URLs.
        async for row in db.media.find({"id": {"$in": body.media_ids}, "user_id": user["id"]}, {"_id": 0, "id": 1, "kind": 1, "url": 1}):
            media.append(row)
        if len(media) != len(set(body.media_ids)):
            raise HTTPException(422, "Unknown media attachment")
    post = {
        "id": new_id(), "author_id": user["id"], "content": body.content.strip(),
        "community_id": body.community_id, "workout_id": body.workout_id,
        "media": media, "repost_of": None, "status": "active",
        "like_count": 0, "comment_count": 0, "repost_count": 0, "created_at": now(),
    }
    await db.posts.insert_one(post)
    name = user.get("full_name") or "Someone"
    for mentioned in notifications.parse_mentions(post["content"]):
        await notifications.notify(
            mentioned, notifications.POST_MENTION, actor=user,
            title=f"{name} mentioned you in a post", body=post["content"][:140],
            target_type="post", target_id=post["id"])
    return (await _decorate([post], user["id"]))[0]


@router.delete("/posts/{post_id}", status_code=204)
async def delete_post(post_id: str, user: dict = Depends(current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        return None
    if post["author_id"] != user["id"] and "content.moderate" not in staff.permissions_for(user):
        raise HTTPException(403, "Only the author can delete this post")
    await db.posts.update_one({"id": post_id}, {"$set": {"status": "deleted", "deleted_at": now()}})
    if post["author_id"] != user["id"]:
        await staff.audit(user, "post.removed", target_type="post", target_id=post_id)
    if post.get("repost_of"):
        await db.posts.update_one({"id": post["repost_of"]}, {"$inc": {"repost_count": -1}})
    return None


async def _notify_post_author(post: dict, actor: dict, kind: str, title: str, body: str = "") -> None:
    """Shared trigger for the three things that can happen to a post."""
    await notifications.notify(
        post["author_id"], kind, actor=actor, title=title, body=body,
        target_type="post", target_id=post["id"],
    )


@router.post("/posts/{post_id}/like")
async def like_post(post_id: str, user: dict = Depends(current_user)):
    post = await _post_or_404(post_id, user["id"])
    try:
        await db.post_likes.insert_one({"post_id": post_id, "user_id": user["id"], "created_at": now()})
    except DuplicateKeyError:
        return {"post_id": post_id, "liked": True, "like_count": post.get("like_count", 0)}
    updated = await db.posts.find_one_and_update({"id": post_id}, {"$inc": {"like_count": 1}}, projection={"_id": 0, "like_count": 1}, return_document=True)
    name = user.get("full_name") or "Someone"
    await _notify_post_author(post, user, notifications.POST_LIKE, f"{name} liked your post")
    return {"post_id": post_id, "liked": True, "like_count": updated["like_count"]}


@router.delete("/posts/{post_id}/like")
async def unlike_post(post_id: str, user: dict = Depends(current_user)):
    result = await db.post_likes.delete_one({"post_id": post_id, "user_id": user["id"]})
    if result.deleted_count:
        await db.posts.update_one({"id": post_id, "like_count": {"$gt": 0}}, {"$inc": {"like_count": -1}})
    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "like_count": 1}) or {}
    return {"post_id": post_id, "liked": False, "like_count": post.get("like_count", 0)}


@router.post("/posts/{post_id}/repost", status_code=201)
async def repost(post_id: str, user: dict = Depends(current_user)):
    original = await _post_or_404(post_id, user["id"])
    if original.get("repost_of"):
        original = await _post_or_404(original["repost_of"], user["id"])
    existing = await db.posts.find_one({"repost_of": original["id"], "author_id": user["id"], "status": {"$ne": "deleted"}}, {"_id": 0})
    if existing:
        return (await _decorate(await _with_originals([existing], user["id"]), user["id"]))[0]
    post = {
        "id": new_id(), "author_id": user["id"], "content": "", "community_id": original.get("community_id"),
        "workout_id": None, "media": [], "repost_of": original["id"], "status": "active",
        "like_count": 0, "comment_count": 0, "repost_count": 0, "created_at": now(),
    }
    await db.posts.insert_one(post)
    await db.posts.update_one({"id": original["id"]}, {"$inc": {"repost_count": 1}})
    name = user.get("full_name") or "Someone"
    await _notify_post_author(original, user, notifications.POST_REPOST, f"{name} reposted your post")
    return (await _decorate(await _with_originals([post], user["id"]), user["id"]))[0]


@router.get("/posts/{post_id}/comments")
async def list_comments(post_id: str, user: dict = Depends(current_user)):
    await _post_or_404(post_id, user["id"])
    comments = [row async for row in db.post_comments.find({"post_id": post_id, "status": "active"}, {"_id": 0}).sort("created_at", 1).limit(200)]
    for comment in comments:
        comment["author"] = await _author(comment["author_id"])
    return comments


@router.post("/posts/{post_id}/comments", status_code=201)
async def add_comment(post_id: str, body: CommentIn, user: dict = Depends(current_user)):
    await _post_or_404(post_id, user["id"])
    comment = {"id": new_id(), "post_id": post_id, "author_id": user["id"], "content": body.content.strip(), "status": "active", "created_at": now()}
    await db.post_comments.insert_one(comment)
    await db.posts.update_one({"id": post_id}, {"$inc": {"comment_count": 1}})
    comment["author"] = await _author(user["id"])

    post = await db.posts.find_one({"id": post_id}, {"_id": 0, "id": 1, "author_id": 1})
    name = user.get("full_name") or "Someone"
    if post:
        await _notify_post_author(
            post, user, notifications.POST_COMMENT,
            f"{name} commented on your post", comment["content"][:140])
    # Someone mentioned in a comment hears about it even if it is not their post.
    for mentioned in notifications.parse_mentions(comment["content"]):
        if post and mentioned == post["author_id"]:
            continue  # already told, as the post author
        await notifications.notify(
            mentioned, notifications.POST_MENTION, actor=user,
            title=f"{name} mentioned you in a comment", body=comment["content"][:140],
            target_type="post", target_id=post_id)
    return clean(comment)


# --------------------------------------------------------------------------- #
# Follows                                                                      #
# --------------------------------------------------------------------------- #
@router.post("/users/{user_id}/follow")
async def follow(user_id: str, user: dict = Depends(current_user)):
    if user_id == user["id"]:
        raise HTTPException(409, "You cannot follow yourself")
    if not await db.users.find_one({"id": user_id}, {"_id": 1}):
        raise HTTPException(404, "User not found")
    if await social_graph.blocked_between(user["id"], user_id):
        raise HTTPException(403, "This account is unavailable")

    edge = await social_graph.create_follow(user["id"], user_id)
    pending = edge.get("status") == "pending"
    name = user.get("full_name") or "Someone"
    await notifications.notify(
        user_id,
        notifications.FOLLOW_REQUEST if pending else notifications.FOLLOW,
        actor=user,
        title=f"{name} asked to follow you" if pending else f"{name} started following you",
        target_type="user", target_id=user["id"],
    )
    return {"state": "pending" if pending else "following", "user_id": user_id,
            "following": not pending}


@router.delete("/users/{user_id}/follow")
async def unfollow(user_id: str, user: dict = Depends(current_user)):
    """Also withdraws a pending request — one control, both meanings."""
    await db.follows.delete_one({"follower_id": user["id"], "followee_id": user_id})
    return {"state": "none", "user_id": user_id, "following": False}


@router.get("/follow-requests")
async def follow_requests(user: dict = Depends(current_user)):
    """Incoming requests awaiting this user's decision."""
    rows = []
    async for edge in db.follows.find(
        {"followee_id": user["id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).limit(100):
        edge["follower"] = await _author(edge["follower_id"])
        rows.append(clean(edge))
    return rows


@router.post("/follow-requests/{follower_id}/approve")
async def approve_follow_request(follower_id: str, user: dict = Depends(current_user)):
    result = await db.follows.update_one(
        {"follower_id": follower_id, "followee_id": user["id"], "status": "pending"},
        {"$set": {"status": "active", "approved_at": now()}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Follow request not found")
    name = user.get("full_name") or "Someone"
    await notifications.notify(
        follower_id, notifications.FOLLOW_ACCEPTED, actor=user,
        title=f"{name} accepted your follow request",
        target_type="user", target_id=user["id"],
    )
    return {"state": "following", "follower_id": follower_id}


@router.delete("/follow-requests/{follower_id}", status_code=204)
async def deny_follow_request(follower_id: str, user: dict = Depends(current_user)):
    """Denial is silent: the requester is never told, as on every major network."""
    result = await db.follows.delete_one(
        {"follower_id": follower_id, "followee_id": user["id"], "status": "pending"}
    )
    if not result.deleted_count:
        raise HTTPException(404, "Follow request not found")


@router.get("/users/{user_id}/followers")
async def followers(user_id: str, user: dict = Depends(current_user)):
    if not await social_graph.can_view_profile(user["id"], user_id):
        raise HTTPException(403, "This account is private")
    rows = []
    async for edge in db.follows.find(
        {"followee_id": user_id, "status": social_graph.ACTIVE}, {"_id": 0}
    ).sort("created_at", -1).limit(200):
        person = await _author(edge["follower_id"])
        if person:
            person["followed_by_me"] = await social_graph.follows_actively(user["id"], person["id"])
            rows.append(person)
    return rows


@router.get("/users/{user_id}/following")
async def following(user_id: str, user: dict = Depends(current_user)):
    if not await social_graph.can_view_profile(user["id"], user_id):
        raise HTTPException(403, "This account is private")
    rows = []
    async for edge in db.follows.find(
        {"follower_id": user_id, "status": social_graph.ACTIVE}, {"_id": 0}
    ).sort("created_at", -1).limit(200):
        person = await _author(edge["followee_id"])
        if person:
            person["followed_by_me"] = await social_graph.follows_actively(user["id"], person["id"])
            rows.append(person)
    return rows


@router.post("/users/{user_id}/block")
async def block_user(user_id: str, user: dict = Depends(current_user)):
    if user_id == user["id"]:
        raise HTTPException(409, "You cannot block yourself")
    await social_graph.block(user["id"], user_id)
    return {"blocked": True, "user_id": user_id}


@router.delete("/users/{user_id}/block", status_code=204)
async def unblock_user(user_id: str, user: dict = Depends(current_user)):
    await social_graph.unblock(user["id"], user_id)


@router.post("/users/{user_id}/mute")
async def mute_user(user_id: str, user: dict = Depends(current_user)):
    if user_id == user["id"]:
        raise HTTPException(409, "You cannot mute yourself")
    await social_graph.mute(user["id"], user_id)
    return {"muted": True, "user_id": user_id}


@router.delete("/users/{user_id}/mute", status_code=204)
async def unmute_user(user_id: str, user: dict = Depends(current_user)):
    await social_graph.unmute(user["id"], user_id)


@router.get("/users/{user_id}/profile")
async def public_profile(user_id: str, user: dict = Depends(current_user)):
    profile = await _author(user_id)
    if not profile:
        raise HTTPException(404, "User not found")
    followers, following = await social_graph.counts(user_id)
    state = await social_graph.follow_state(user["id"], user_id)
    profile["followers"] = followers
    profile["following"] = following
    profile["posts"] = await db.posts.count_documents({"author_id": user_id, "status": {"$ne": "deleted"}, "community_id": None})
    profile["follow_state"] = state
    profile["followed_by_me"] = state == "following"
    profile["is_private"] = await social_graph.is_private(user_id)
    profile["is_blocked"] = bool(await db.blocks.find_one(
        {"blocker_id": user["id"], "blocked_id": user_id}, {"_id": 1}))
    profile["is_muted"] = bool(await db.mutes.find_one(
        {"muter_id": user["id"], "muted_id": user_id}, {"_id": 1}))
    # A private account shows its header but withholds posts until accepted.
    profile["can_view_posts"] = await social_graph.can_view_profile(user["id"], user_id)
    profile["can_message"] = (
        not await social_graph.blocked_between(user["id"], user_id)
        and await _can_message(user["id"], user_id)
    )
    return profile


# --------------------------------------------------------------------------- #
# Direct messages                                                              #
# --------------------------------------------------------------------------- #
async def _can_message(sender_id: str, recipient_id: str) -> bool:
    """Anti-spam: DMs need an existing relationship (shared group, coaching, mutual follow, or a prior reply)."""
    if sender_id == recipient_id:
        return False
    if await db.direct_messages.find_one({"sender_id": recipient_id, "recipient_id": sender_id}, {"_id": 1}):
        return True
    # Accepted follows only. A *pending* request is not a relationship, and
    # counting it would let two strangers unlock DMs just by both asking.
    if (await social_graph.follows_actively(recipient_id, sender_id)
            and await social_graph.follows_actively(sender_id, recipient_id)):
        return True
    if await db.coach_relationships.find_one({"status": "active", "$or": [
        {"coach_id": sender_id, "client_id": recipient_id}, {"coach_id": recipient_id, "client_id": sender_id},
    ]}, {"_id": 1}):
        return True
    shared = set(await _member_community_ids(sender_id)) & set(await _member_community_ids(recipient_id))
    return bool(shared)


def _thread_key(a: str, b: str) -> str:
    return ":".join(sorted((a, b)))


@router.get("/dm")
async def list_threads(user: dict = Depends(current_user)):
    pipeline = [
        {"$match": {"$or": [{"sender_id": user["id"]}, {"recipient_id": user["id"]}]}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$thread_key", "last": {"$first": "$$ROOT"},
                    "unread": {"$sum": {"$cond": [{"$and": [{"$eq": ["$recipient_id", user["id"]]}, {"$eq": ["$read_at", None]}]}, 1, 0]}}}},
        {"$sort": {"last.created_at": -1}}, {"$limit": 50},
    ]
    threads = []
    async for row in db.direct_messages.aggregate(pipeline):
        last = clean(row["last"])
        peer_id = last["recipient_id"] if last["sender_id"] == user["id"] else last["sender_id"]
        threads.append({"peer": await _author(peer_id), "last_message": last, "unread": row["unread"]})
    return threads


@router.get("/dm/{peer_id}/messages")
async def thread_messages(peer_id: str, limit: int = Query(default=50, ge=1, le=100), user: dict = Depends(current_user)):
    key = _thread_key(user["id"], peer_id)
    rows = [row async for row in db.direct_messages.find({"thread_key": key}, {"_id": 0}).sort("created_at", -1).limit(limit)]
    await db.direct_messages.update_many({"thread_key": key, "recipient_id": user["id"], "read_at": None}, {"$set": {"read_at": now()}})
    return list(reversed(rows))


@router.post("/dm/{peer_id}/messages", status_code=201)
async def send_direct_message(peer_id: str, body: DirectMessageIn, user: dict = Depends(current_user)):
    if not await db.users.find_one({"id": peer_id}, {"_id": 1}):
        raise HTTPException(404, "User not found")
    if await social_graph.blocked_between(user["id"], peer_id):
        raise HTTPException(403, "This account is unavailable")
    if not await _can_message(user["id"], peer_id):
        raise HTTPException(403, "You can message people you share a community, coaching relationship or mutual follow with")
    message = {"id": new_id(), "thread_key": _thread_key(user["id"], peer_id), "sender_id": user["id"],
               "recipient_id": peer_id, "content": body.content.strip(), "read_at": None, "created_at": now()}
    await db.direct_messages.insert_one(message)
    name = user.get("full_name") or "Someone"
    await notifications.notify(
        peer_id, notifications.DIRECT_MESSAGE, actor=user,
        title=f"{name} sent you a message", body=message["content"][:140],
        target_type="dm", target_id=user["id"])
    return clean(message)
