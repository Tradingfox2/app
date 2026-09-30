"""Social graph: feed, likes, reposts, comments, follows, direct messages, media."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, model_validator
from pymongo.errors import DuplicateKeyError

import link_preview
import media_storage
import moderation
import staff
import notifications
import ratelimit
import realtime
import social_graph
from server import clean, current_user, db, new_id, now

router = APIRouter()

AUTHOR_FIELDS = {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1}

#: `#legday`, `#5x5`, `#récupération` — letters, digits and underscores, any
#: script, not starting a word mid-way (so "C#" and URLs' fragments are skipped).
HASHTAG_PATTERN = re.compile(r"(?<![\w&/#])#(\w{1,50})", re.UNICODE)
MAX_TAGS = 10
POST_EDIT_WINDOW = timedelta(hours=24)
STORY_TTL = timedelta(hours=24)
#: Matches posts_audience_check / stories_audience_check in migration 006.
Audience = Literal["public", "friends", "only_me"]


def _aware(value: datetime) -> datetime:
    """Stored times may come back naive depending on the client; treat as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def extract_tags(content: str) -> list[str]:
    seen: dict[str, None] = {}
    for match in HASHTAG_PATTERN.finditer(content or ""):
        tag = match.group(1).lower()
        if not tag.isdigit():  # "#1" is a ranking, not a topic
            seen.setdefault(tag, None)
    return list(seen)[:MAX_TAGS]


class PollIn(BaseModel):
    options: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(min_length=2, max_length=4)
    duration_hours: int = Field(default=24, ge=1, le=168)

    @model_validator(mode="after")
    def distinct(self):
        cleaned = [option.strip() for option in self.options]
        if any(not option for option in cleaned) or len({o.lower() for o in cleaned}) != len(cleaned):
            raise ValueError("Poll options must be distinct and not blank")
        self.options = cleaned
        return self


class PostIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    community_id: str | None = None
    workout_id: str | None = None
    media_ids: list[str] = Field(default_factory=list, max_length=6)
    poll: PollIn | None = None
    #: `friends` is accepted followers only. `only_me` is the author alone.
    #: Omitted or `public` keeps the existing feed. A community post stays
    #: public: the community is the audience.
    audience: Audience = "public"


class StoryIn(BaseModel):
    """A workout story. Highlights stay on the profile; other stories last 24h."""
    caption: str = Field(default="", max_length=300)
    media_ids: list[str] = Field(default_factory=list, max_length=4)
    workout_id: str
    audience: Audience = "friends"
    highlight: bool = False
    highlight_title: str | None = Field(default=None, max_length=40)


class PostEditIn(BaseModel):
    content: str = Field(max_length=4000)
    #: Omit to leave the audience unchanged.
    audience: Audience | None = None


class RepostIn(BaseModel):
    #: Empty is a plain repost; text makes it a quote post.
    content: str = Field(default="", max_length=4000)


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    #: Reply to a comment. Threads are one level deep, as on Instagram: a
    #: reply to a reply attaches to the same top-level comment.
    parent_id: str | None = None


class CommentEditIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class VoteIn(BaseModel):
    option: int = Field(ge=0, le=3)


class DirectMessageIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    media_ids: list[str] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def says_something(self):
        if not self.content.strip() and not self.media_ids:
            raise ValueError("A message needs text or an attachment")
        return self


async def _people(ids) -> dict[str, dict]:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return {row["id"]: clean(row) async for row in db.users.find({"id": {"$in": ids}}, AUTHOR_FIELDS)}


async def _plain(content: str) -> str:
    """Text with `<@id>` tokens rendered as @Name — for notification bodies,
    which are shown as plain text and must never leak raw tokens."""
    ids = notifications.parse_mentions(content)
    if not ids:
        return content or ""
    people = await _people(ids)
    return notifications.MENTION_PATTERN.sub(
        lambda m: "@" + ((people.get(m.group(1)) or {}).get("full_name") or "someone"), content or "")


async def _owned_media(media_ids: list[str], user_id: str) -> list[dict]:
    """Only the uploader can attach a media object; rejects anyone else's."""
    if not media_ids:
        return []
    media = [row async for row in db.media.find(
        {"id": {"$in": media_ids}, "user_id": user_id}, {"_id": 0, "id": 1, "kind": 1, "url": 1})]
    if len(media) != len(set(media_ids)):
        raise HTTPException(422, "Unknown media attachment")
    return media


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
    # only_me is the author alone. A follower, a community member, and a
    # coach all get the same 404 as a stranger. A missing audience is public.
    if post.get("audience") == "only_me":
        return False
    if author_id and await social_graph.blocked_between(user_id, author_id):
        return False
    # Friends-only is the accepted-follow edge, on top of account privacy.
    if post.get("audience") == "friends" and not await social_graph.follows_actively(user_id, author_id):
        return False
    if post.get("community_id"):
        return post["community_id"] in await _member_community_ids(user_id)
    return await social_graph.can_view_profile(user_id, author_id)


async def _followed_ids(viewer_id: str) -> list[str]:
    return [
        row["followee_id"]
        async for row in db.follows.find(
            {"follower_id": viewer_id, "status": social_graph.ACTIVE},
            {"_id": 0, "followee_id": 1},
        )
    ]


async def _visible_post_query(
    viewer_id: str, *, friends: bool = False, include_only_me: bool = False,
) -> dict:
    """Every post this viewer may see — the base both the feed and search use.

    The Mongo form of `_can_view_post`: community posts for members only,
    public posts minus private authors the viewer does not follow, and nothing
    from anyone blocked in either direction. Feed-only narrowing (muting,
    scope) is layered on by the caller.

    `friends=False` (search, the public feed, trending tags) drops
    friends-audience posts entirely, so that surface stays what it was.
    `friends=True` (friends feed, a profile wall) keeps a friends post only
    for the author and their accepted followers.

    `only_me` is dropped everywhere except the author's own wall and
    scope=mine. Search and trending pass the default and never see it.
    """
    community_ids = await _member_community_ids(viewer_id)
    hidden_private = await _private_hidden_author_ids(viewer_id)
    public_posts: dict = {"community_id": None}
    if hidden_private:
        public_posts["author_id"] = {"$nin": hidden_private}
    clauses: list[dict] = [{"$or": [public_posts, {"community_id": {"$in": community_ids}}]}]
    if friends:
        followed = await _followed_ids(viewer_id)
        clauses.append({"$or": [
            {"audience": {"$ne": "friends"}},
            {"author_id": {"$in": [*followed, viewer_id]}},
        ]})
    else:
        clauses.append({"audience": {"$ne": "friends"}})
    if include_only_me:
        clauses.append({"$or": [
            {"audience": {"$ne": "only_me"}},
            {"author_id": viewer_id},
        ]})
    else:
        clauses.append({"audience": {"$ne": "only_me"}})
    query: dict = {"status": {"$ne": "deleted"}, "$and": clauses}
    blocked = await social_graph.blocked_ids(viewer_id)
    if blocked:
        query["author_id"] = {"$nin": blocked}
    return query


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
    """Everything a post card needs, in a fixed number of queries per page.

    Viewer state (liked, saved, reposted, voted) is computed for both the post
    and, for a repost, its original — the card acts on the original, so that
    is whose state it has to show.
    """
    originals = [post["original"] for post in posts if post.get("original") and not post["original"].get("unavailable")]
    every = posts + originals
    ids = list({post["id"] for post in every})
    liked = {row["post_id"] async for row in db.post_likes.find({"post_id": {"$in": ids}, "user_id": viewer_id}, {"_id": 0, "post_id": 1})}
    saved = {row["post_id"] async for row in db.post_saves.find({"post_id": {"$in": ids}, "user_id": viewer_id}, {"_id": 0, "post_id": 1})}
    reposted = {row["repost_of"] async for row in db.posts.find({"repost_of": {"$in": ids}, "author_id": viewer_id, "status": {"$ne": "deleted"}, "content": ""}, {"_id": 0, "repost_of": 1})}
    polled = [post["id"] for post in every if post.get("poll")]
    votes = {row["post_id"]: row["option"] async for row in db.poll_votes.find({"post_id": {"$in": polled}, "user_id": viewer_id}, {"_id": 0})} if polled else {}
    mentioned = {uid for post in every for uid in notifications.parse_mentions(post.get("content", ""))}
    people = await _people({post["author_id"] for post in every} | mentioned)
    moment = now()

    def fill(post: dict) -> dict:
        post["author"] = people.get(post["author_id"])
        post["liked_by_me"] = post["id"] in liked
        post["saved_by_me"] = post["id"] in saved
        post["reposted_by_me"] = post["id"] in reposted
        post["mentions"] = [people[uid] for uid in notifications.parse_mentions(post.get("content", "")) if uid in people]
        post["can_edit"] = post["author_id"] == viewer_id and moment - _aware(post["created_at"]) <= POST_EDIT_WINDOW if post.get("created_at") else False
        post.setdefault("like_count", 0)
        post.setdefault("comment_count", 0)
        post.setdefault("repost_count", 0)
        post.setdefault("media", [])
        post.setdefault("tags", [])
        post.setdefault("audience", "public")
        post.setdefault("link_preview", None)
        post.setdefault("edited_at", None)
        poll = post.get("poll")
        if poll:
            closed = _aware(poll["closes_at"]) <= moment
            mine = votes.get(post["id"])
            # Results show once you have voted, once it closes, or to its author —
            # the convention everywhere, so early votes do not herd later ones.
            reveal = closed or mine is not None or post["author_id"] == viewer_id
            post["poll"] = {
                "options": poll["options"], "closes_at": poll["closes_at"], "closed": closed,
                "my_vote": mine, "total": sum(poll.get("counts") or []),
                "counts": poll.get("counts") if reveal else None,
            }
        return post

    output = []
    for post in posts:
        fill(post)
        if post.get("original") and not post["original"].get("unavailable"):
            fill(post["original"])
        elif post.get("original"):
            post["original"]["author"] = people.get(post["original"]["author_id"])
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
    scope: Literal["all", "following", "mine", "friends"] = "all",
    before: str | None = None,
    limit: int = Query(default=20, ge=1, le=50),
    user: dict = Depends(current_user),
    author_id: Annotated[str | None, Query(max_length=64)] = None,
    tag: Annotated[str | None, Query(max_length=50)] = None,
    community_id: Annotated[str | None, Query(max_length=64)] = None,
):
    # A profile wall and the friends feed may include friends-audience posts.
    # The public scopes must not, or the community feed would change.
    # only_me stays on the author's wall and scope=mine, not on either feed.
    query = await _visible_post_query(
        user["id"],
        friends=scope == "friends" or bool(author_id),
        include_only_me=scope == "mine" or author_id == user["id"],
    )
    if tag:
        query["tags"] = tag.lstrip("#").lower()
    if community_id:
        # A community's own wall: members only, which the visible-post query
        # already guarantees — a non-member simply gets an empty page.
        query["community_id"] = community_id
    if author_id:
        # One person's posts, as on their profile. A private account withholds
        # them until the viewer is an accepted follower.
        if not await social_graph.can_view_profile(user["id"], author_id):
            raise HTTPException(403, "This account is private")
        if author_id != user["id"] and await social_graph.blocked_between(user["id"], author_id):
            raise HTTPException(403, "This account is unavailable")
        query["author_id"] = author_id
        if not community_id:
            query["community_id"] = None  # a profile shows the public wall, as its post count does
    elif scope == "mine":
        query["author_id"] = user["id"]
    elif scope == "friends":
        # Self plus accepted followees, wall posts only. Muted people leave
        # this feed the same way they leave FOLLOWING.
        following = await _followed_ids(user["id"])
        excluded = set(query.get("author_id", {}).get("$nin", []))
        excluded |= set(await social_graph.muted_ids(user["id"]))
        excluded.discard(user["id"])
        query["author_id"] = {"$in": [uid for uid in (*following, user["id"]) if uid not in excluded]}
        query["community_id"] = None
    else:
        # Blocked people are already excluded; muted people leave the feed too.
        # (Muting is feed-only — search still finds them, as on X.)
        excluded = set(query.get("author_id", {}).get("$nin", []))
        excluded |= set(await social_graph.muted_ids(user["id"]))
        excluded.discard(user["id"])
        author_filter: dict = {"$nin": list(excluded)} if excluded else {}
        if scope == "following":
            following = [
                row["followee_id"]
                async for row in db.follows.find(
                    {"follower_id": user["id"], "status": social_graph.ACTIVE},
                    {"_id": 0, "followee_id": 1},
                )
            ]
            author_filter["$in"] = [*following, user["id"]]
        if author_filter:
            query["author_id"] = author_filter
        else:
            query.pop("author_id", None)
    if before:
        # An unknown cursor is an error, as in list_messages: silently serving
        # page one again would make infinite scroll repeat itself forever.
        cursor = await db.posts.find_one({"id": before}, {"_id": 0, "created_at": 1})
        if not cursor:
            raise HTTPException(404, "Post cursor not found")
        query["created_at"] = {"$lt": cursor["created_at"]}
    posts = [row async for row in db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)]
    return await _decorate(await _with_originals(posts, user["id"]), user["id"])


async def _workout_summary(workout_id: str, user: dict) -> dict:
    """Snapshot a finished workout for a feed card.

    Owner-only, the `gym_checkin` precedent — deliberately not
    `_load_workout_for`, which also admits active coaches: a coach may read a
    client's session but must never be able to publish it. The numbers are
    frozen at share time so the card neither costs a query per render nor
    changes if the log is edited afterwards.
    """
    workout = await db.workouts.find_one({"id": workout_id, "user_id": user["id"]}, {"_id": 0})
    if not workout:
        raise HTTPException(404, "Workout not found")  # yours or nothing — never confirm others'
    if not workout.get("ended_at"):
        raise HTTPException(422, "Finish the workout before sharing it")
    sets = [row async for row in db.workout_sets.find({"workout_id": workout_id}, {"_id": 0})]
    exercise_ids = list(dict.fromkeys(row["exercise_id"] for row in sets if row.get("exercise_id")))
    names = {
        row["id"]: row.get("name") or row.get("slug")
        async for row in db.exercises.find({"id": {"$in": exercise_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1})
    }
    tonnage = sum(float(row.get("weight_kg") or 0) * int(row.get("reps") or 0) for row in sets)
    return {
        "workout_id": workout_id,
        "title": workout.get("title") or "Workout",
        "duration_sec": workout.get("duration_sec"),
        "sets": len(sets),
        "tonnage_kg": round(tonnage, 1),
        "exercises": [names[e] for e in exercise_ids if names.get(e)][:6],
        "exercise_count": len(exercise_ids),
        "perceived_effort": workout.get("perceived_effort"),
        "ended_at": workout.get("ended_at"),
    }


@router.post("/posts", status_code=201)
async def create_post(body: PostIn, user: dict = Depends(current_user)):
    await ratelimit.hit("post", user["id"])
    if not body.content.strip() and not body.media_ids and not body.workout_id and not body.poll:
        raise HTTPException(422, "A post needs text, media, a workout or a poll")
    if body.poll and not body.content.strip():
        raise HTTPException(422, "A poll needs a question")
    if body.community_id and body.audience != "public":
        raise HTTPException(422, "A community post uses the community's audience")
    workout_summary = await _workout_summary(body.workout_id, user) if body.workout_id else None
    if body.community_id:
        if body.community_id not in await _member_community_ids(user["id"]):
            raise HTTPException(403, "Active community membership required")
    media = await _owned_media(body.media_ids, user["id"])
    content = body.content.strip()
    timestamp = now()
    post = {
        "id": new_id(), "author_id": user["id"], "content": content,
        "community_id": body.community_id, "workout_id": body.workout_id,
        "media": media, "repost_of": None, "status": "active",
        "workout_summary": workout_summary,
        "tags": extract_tags(content),
        "poll": {
            "options": body.poll.options, "counts": [0] * len(body.poll.options),
            "closes_at": timestamp + timedelta(hours=body.poll.duration_hours),
        } if body.poll else None,
        # Only the first link, and never alongside media: the media is the card.
        "link_preview": None if media else await _preview_for(content),
        "edited_at": None,
        "audience": body.audience,
        "like_count": 0, "comment_count": 0, "repost_count": 0, "created_at": timestamp,
    }
    await db.posts.insert_one(post)
    await _notify_mentions(post, user, notifications.parse_mentions(content))
    await moderation.screen(content, author=user, target_type="post", target_id=post["id"],
                            metadata={"community_id": body.community_id})
    return (await _decorate([post], user["id"]))[0]


async def _preview_for(content: str) -> dict | None:
    url = link_preview.first_url(content)
    return await link_preview.fetch(url) if url else None


async def _notify_mentions(post: dict, user: dict, mentioned: list[str]) -> None:
    name = user.get("full_name") or "Someone"
    body = (await _plain(post["content"]))[:140]
    for person in mentioned:
        # A private post's mention must not tell someone about a post they
        # could not open; notify() handles blocks, this handles audience.
        if not await _can_view_post(post, person):
            continue
        await notifications.notify(
            person, notifications.POST_MENTION, actor=user,
            title=f"{name} mentioned you in a post", body=body,
            target_type="post", target_id=post["id"])


@router.get("/posts/{post_id}")
async def get_post(post_id: str, user: dict = Depends(current_user)):
    """One post, for its own screen — where a notification about it lands."""
    post = await _post_or_404(post_id, user["id"])
    return (await _decorate(await _with_originals([post], user["id"]), user["id"]))[0]


@router.patch("/posts/{post_id}")
async def edit_post(post_id: str, body: PostEditIn, user: dict = Depends(current_user)):
    """Edit the text of your own post within 24 hours. Marked as edited.

    Media, polls and shared workouts are fixed once posted — editing a poll's
    options after votes are cast would change what people voted for.
    """
    post = await _post_or_404(post_id, user["id"])
    if post["author_id"] != user["id"]:
        raise HTTPException(403, "Only the author can edit this post")
    if post.get("repost_of") and not post.get("content"):
        raise HTTPException(409, "A repost has no text to edit")
    if now() - _aware(post["created_at"]) > POST_EDIT_WINDOW:
        raise HTTPException(409, "The edit window for this post has closed")
    content = body.content.strip()
    if not content and not post.get("media") and not post.get("workout_summary") and not post.get("repost_of"):
        raise HTTPException(422, "A post needs text, media or a workout")
    if post.get("poll") and not content:
        raise HTTPException(422, "A poll needs a question")
    before = set(notifications.parse_mentions(post.get("content", "")))
    if body.audience is not None and post.get("community_id") and body.audience != "public":
        raise HTTPException(422, "A community post uses the community's audience")
    updates = {
        "content": content, "tags": extract_tags(content), "edited_at": now(),
        "link_preview": None if post.get("media") else await _preview_for(content),
    }
    if body.audience is not None:
        updates["audience"] = body.audience
    await db.posts.update_one({"id": post_id}, {"$set": updates})
    post = {**post, **updates}
    # Only people newly mentioned hear about it; the rest were told already.
    await _notify_mentions(post, user, [p for p in notifications.parse_mentions(content) if p not in before])
    await moderation.screen(content, author=user, target_type="post", target_id=post_id,
                            metadata={"community_id": post.get("community_id"), "edited": True})
    return (await _decorate(await _with_originals([post], user["id"]), user["id"]))[0]


@router.delete("/posts/{post_id}", status_code=204)
async def delete_post(post_id: str, user: dict = Depends(current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        return None
    own = post["author_id"] == user["id"]
    if not own and "content.moderate" not in staff.permissions_for(user):
        raise HTTPException(403, "Only the author can delete this post")
    # The author's own delete is not a moderation act, so it carries no removed_by.
    removed = await moderation.remove_content("post", post_id, actor={} if own else user)
    if removed and not own:
        await staff.audit(user, "post.removed", target_type="post", target_id=post_id)
    return None


async def _notify_post_author(post: dict, actor: dict, kind: str, title: str, body: str = "") -> None:
    """Shared trigger for the three things that can happen to a post."""
    await notifications.notify(
        post["author_id"], kind, actor=actor, title=title, body=body,
        target_type="post", target_id=post["id"],
    )


@router.post("/posts/{post_id}/like")
async def like_post(post_id: str, user: dict = Depends(current_user)):
    await ratelimit.hit("like", user["id"])
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
async def repost(post_id: str, user: dict = Depends(current_user), body: RepostIn | None = None):
    """A plain repost (idempotent, one per person) or, with text, a quote post."""
    quote = (body.content if body else "").strip()
    if quote:
        await ratelimit.hit("post", user["id"])
    original = await _post_or_404(post_id, user["id"])
    if original.get("repost_of") and not original.get("content"):
        # Reposting a plain repost reposts what it carries. A quote post has
        # its own words, so it is quoted as itself.
        original = await _post_or_404(original["repost_of"], user["id"])
    if not quote:
        existing = await db.posts.find_one({"repost_of": original["id"], "author_id": user["id"], "content": "", "status": {"$ne": "deleted"}}, {"_id": 0})
        if existing:
            return (await _decorate(await _with_originals([existing], user["id"]), user["id"]))[0]
    post = {
        "id": new_id(), "author_id": user["id"], "content": quote, "community_id": original.get("community_id"),
        "workout_id": None, "media": [], "repost_of": original["id"], "status": "active",
        "tags": extract_tags(quote), "poll": None, "link_preview": None, "edited_at": None,
        "like_count": 0, "comment_count": 0, "repost_count": 0, "created_at": now(),
    }
    await db.posts.insert_one(post)
    await db.posts.update_one({"id": original["id"]}, {"$inc": {"repost_count": 1}})
    name = user.get("full_name") or "Someone"
    await _notify_post_author(
        original, user, notifications.POST_REPOST,
        f"{name} quoted your post" if quote else f"{name} reposted your post",
        (await _plain(quote))[:140])
    if quote:
        await _notify_mentions(post, user, notifications.parse_mentions(quote))
        await moderation.screen(quote, author=user, target_type="post", target_id=post["id"],
                                metadata={"community_id": post["community_id"]})
    return (await _decorate(await _with_originals([post], user["id"]), user["id"]))[0]


@router.delete("/posts/{post_id}/repost", status_code=204)
async def undo_repost(post_id: str, user: dict = Depends(current_user)):
    """Take back a plain repost. Quote posts are deleted like any post."""
    existing = await db.posts.find_one(
        {"repost_of": post_id, "author_id": user["id"], "content": "", "status": {"$ne": "deleted"}}, {"_id": 0, "id": 1})
    if existing:
        await moderation.remove_content("post", existing["id"], actor={})


# --------------------------------------------------------------------------- #
# Comments — one level of replies, likes, edit and delete                      #
# --------------------------------------------------------------------------- #
COMMENT_EDIT_WINDOW = timedelta(minutes=15)


async def _comment_view(comments: list[dict], viewer_id: str) -> list[dict]:
    ids = [row["id"] for row in comments]
    liked = {row["comment_id"] async for row in db.comment_likes.find(
        {"comment_id": {"$in": ids}, "user_id": viewer_id}, {"_id": 0, "comment_id": 1})}
    mentioned = {uid for row in comments for uid in notifications.parse_mentions(row.get("content", ""))}
    people = await _people({row["author_id"] for row in comments} | mentioned)
    moment = now()
    for row in comments:
        row["author"] = people.get(row["author_id"])
        row["mentions"] = [people[uid] for uid in notifications.parse_mentions(row.get("content", "")) if uid in people]
        row["liked_by_me"] = row["id"] in liked
        row.setdefault("like_count", 0)
        row.setdefault("reply_count", 0)
        row.setdefault("parent_id", None)
        row.setdefault("edited_at", None)
        row["can_edit"] = row["author_id"] == viewer_id and moment - _aware(row["created_at"]) <= COMMENT_EDIT_WINDOW
    return [clean(row) for row in comments]


@router.get("/posts/{post_id}/comments")
async def list_comments(
    post_id: str,
    user: dict = Depends(current_user),
    before: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    """Oldest first, a page at a time; `before` walks back from a cursor.

    Replies ride along with their parents. People blocked either way are
    left out, the same rule as the feed.
    """
    await _post_or_404(post_id, user["id"])
    query: dict = {"post_id": post_id, "status": "active"}
    blocked = await social_graph.blocked_ids(user["id"])
    if blocked:
        query["author_id"] = {"$nin": blocked}
    if before:
        cursor = await db.post_comments.find_one({"id": before, "post_id": post_id}, {"_id": 0, "created_at": 1})
        if not cursor:
            raise HTTPException(404, "Comment cursor not found")
        query["created_at"] = {"$lt": cursor["created_at"]}
    rows = [row async for row in db.post_comments.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)]
    return await _comment_view(list(reversed(rows)), user["id"])


@router.post("/posts/{post_id}/comments", status_code=201)
async def add_comment(post_id: str, body: CommentIn, user: dict = Depends(current_user)):
    await ratelimit.hit("comment", user["id"])
    post = await _post_or_404(post_id, user["id"])
    parent = None
    if body.parent_id:
        parent = await db.post_comments.find_one(
            {"id": body.parent_id, "post_id": post_id, "status": "active"}, {"_id": 0})
        if not parent:
            raise HTTPException(404, "Comment being replied to was not found")
        if parent.get("parent_id"):
            parent = await db.post_comments.find_one({"id": parent["parent_id"]}, {"_id": 0}) or parent
    comment = {"id": new_id(), "post_id": post_id, "author_id": user["id"], "content": body.content.strip(),
               "parent_id": parent["id"] if parent else None, "like_count": 0, "reply_count": 0,
               "edited_at": None, "status": "active", "created_at": now()}
    await db.post_comments.insert_one(dict(comment))
    await db.posts.update_one({"id": post_id}, {"$inc": {"comment_count": 1}})
    if parent:
        await db.post_comments.update_one({"id": parent["id"]}, {"$inc": {"reply_count": 1}})

    name = user.get("full_name") or "Someone"
    body_text = (await _plain(comment["content"]))[:140]
    told = {user["id"]}
    await _notify_post_author(post, user, notifications.POST_COMMENT, f"{name} commented on your post", body_text)
    told.add(post["author_id"])
    if parent and parent["author_id"] not in told:
        await notifications.notify(
            parent["author_id"], notifications.COMMENT_REPLY, actor=user,
            title=f"{name} replied to your comment", body=body_text,
            target_type="post", target_id=post_id, metadata={"comment_id": comment["id"]})
        told.add(parent["author_id"])
    # Someone mentioned in a comment hears about it even if it is not their post.
    for mentioned in notifications.parse_mentions(comment["content"]):
        if mentioned in told or not await _can_view_post(post, mentioned):
            continue
        await notifications.notify(
            mentioned, notifications.POST_MENTION, actor=user,
            title=f"{name} mentioned you in a comment", body=body_text,
            target_type="post", target_id=post_id)
    await moderation.screen(comment["content"], author=user, target_type="comment", target_id=comment["id"],
                            metadata={"community_id": post.get("community_id"), "post_id": post_id})
    return (await _comment_view([comment], user["id"]))[0]


async def _comment_or_404(comment_id: str, user_id: str) -> tuple[dict, dict]:
    comment = await db.post_comments.find_one({"id": comment_id, "status": "active"}, {"_id": 0})
    if not comment:
        raise HTTPException(404, "Comment not found")
    post = await _post_or_404(comment["post_id"], user_id)
    return comment, post


@router.patch("/comments/{comment_id}")
async def edit_comment(comment_id: str, body: CommentEditIn, user: dict = Depends(current_user)):
    comment, post = await _comment_or_404(comment_id, user["id"])
    if comment["author_id"] != user["id"]:
        raise HTTPException(403, "Only the author can edit a comment")
    if now() - _aware(comment["created_at"]) > COMMENT_EDIT_WINDOW:
        raise HTTPException(409, "The edit window for this comment has closed")
    updates = {"content": body.content.strip(), "edited_at": now()}
    await db.post_comments.update_one({"id": comment_id}, {"$set": updates})
    await moderation.screen(updates["content"], author=user, target_type="comment", target_id=comment_id,
                            metadata={"community_id": post.get("community_id"), "post_id": post["id"], "edited": True})
    return (await _comment_view([{**comment, **updates}], user["id"]))[0]


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(comment_id: str, user: dict = Depends(current_user)):
    """The comment's author, the post's author (it is their thread), or staff."""
    comment, post = await _comment_or_404(comment_id, user["id"])
    own = comment["author_id"] == user["id"]
    host = post["author_id"] == user["id"]
    staff_power = "content.moderate" in staff.permissions_for(user)
    if not (own or host or staff_power):
        raise HTTPException(403, "You cannot delete this comment")
    removed = await moderation.remove_content("comment", comment_id, actor={} if own else user)
    if removed and comment.get("parent_id"):
        await db.post_comments.update_one(
            {"id": comment["parent_id"], "reply_count": {"$gt": 0}}, {"$inc": {"reply_count": -1}})
    if removed and not own and not host:
        await staff.audit(user, "comment.removed", target_type="comment", target_id=comment_id)


@router.post("/comments/{comment_id}/like")
async def like_comment(comment_id: str, user: dict = Depends(current_user)):
    await ratelimit.hit("like", user["id"])
    comment, _post = await _comment_or_404(comment_id, user["id"])
    try:
        await db.comment_likes.insert_one({"comment_id": comment_id, "user_id": user["id"], "created_at": now()})
    except DuplicateKeyError:
        return {"comment_id": comment_id, "liked": True, "like_count": comment.get("like_count", 0)}
    updated = await db.post_comments.find_one_and_update(
        {"id": comment_id}, {"$inc": {"like_count": 1}}, projection={"_id": 0, "like_count": 1}, return_document=True)
    await notifications.notify(
        comment["author_id"], notifications.COMMENT_LIKE, actor=user,
        title=f"{user.get('full_name') or 'Someone'} liked your comment",
        body=(await _plain(comment["content"]))[:140],
        target_type="post", target_id=comment["post_id"], metadata={"comment_id": comment_id})
    return {"comment_id": comment_id, "liked": True, "like_count": updated["like_count"]}


@router.delete("/comments/{comment_id}/like")
async def unlike_comment(comment_id: str, user: dict = Depends(current_user)):
    result = await db.comment_likes.delete_one({"comment_id": comment_id, "user_id": user["id"]})
    if result.deleted_count:
        await db.post_comments.update_one({"id": comment_id, "like_count": {"$gt": 0}}, {"$inc": {"like_count": -1}})
    row = await db.post_comments.find_one({"id": comment_id}, {"_id": 0, "like_count": 1}) or {}
    return {"comment_id": comment_id, "liked": False, "like_count": row.get("like_count", 0)}


# --------------------------------------------------------------------------- #
# Saved posts, polls, hashtags                                                 #
# --------------------------------------------------------------------------- #
@router.post("/posts/{post_id}/save")
async def save_post(post_id: str, user: dict = Depends(current_user)):
    """Bookmark a post. Private: nobody is told, not even the author."""
    await ratelimit.hit("bookmark", user["id"])
    await _post_or_404(post_id, user["id"])
    try:
        await db.post_saves.insert_one({"post_id": post_id, "user_id": user["id"], "created_at": now()})
    except DuplicateKeyError:
        pass
    return {"post_id": post_id, "saved": True}


@router.delete("/posts/{post_id}/save")
async def unsave_post(post_id: str, user: dict = Depends(current_user)):
    await db.post_saves.delete_one({"post_id": post_id, "user_id": user["id"]})
    return {"post_id": post_id, "saved": False}


@router.get("/saved")
async def saved_posts(
    user: dict = Depends(current_user),
    before: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    """Most recently saved first. A post that has since become invisible to
    the viewer — deleted, gone private, author blocked — silently drops out."""
    query: dict = {"user_id": user["id"]}
    if before:
        cursor = await db.post_saves.find_one({"user_id": user["id"], "post_id": before}, {"_id": 0, "created_at": 1})
        if not cursor:
            raise HTTPException(404, "Saved cursor not found")
        query["created_at"] = {"$lt": cursor["created_at"]}
    saves = [row async for row in db.post_saves.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)]
    posts = {row["id"]: row async for row in db.posts.find(
        {"id": {"$in": [s["post_id"] for s in saves]}, "status": {"$ne": "deleted"}}, {"_id": 0})}
    visible = [posts[s["post_id"]] for s in saves
               if s["post_id"] in posts and await _can_view_post(posts[s["post_id"]], user["id"])]
    return await _decorate(await _with_originals(visible, user["id"]), user["id"])


@router.post("/posts/{post_id}/vote")
async def vote(post_id: str, body: VoteIn, user: dict = Depends(current_user)):
    """One vote per person, final — as on X. Changing it would let a voter
    peek at the results and then switch."""
    await ratelimit.hit("vote", user["id"])
    post = await _post_or_404(post_id, user["id"])
    poll = post.get("poll")
    if not poll:
        raise HTTPException(404, "This post has no poll")
    if _aware(poll["closes_at"]) <= now():
        raise HTTPException(409, "This poll has closed")
    if body.option >= len(poll["options"]):
        raise HTTPException(422, "No such option")
    try:
        await db.poll_votes.insert_one({"post_id": post_id, "user_id": user["id"], "option": body.option, "created_at": now()})
    except DuplicateKeyError as exc:
        raise HTTPException(409, "You have already voted") from exc
    await db.posts.update_one({"id": post_id}, {"$inc": {f"poll.counts.{body.option}": 1}})
    updated = await db.posts.find_one({"id": post_id}, {"_id": 0})
    return (await _decorate(await _with_originals([updated], user["id"]), user["id"]))[0]


@router.get("/tags/trending")
async def trending_tags(user: dict = Depends(current_user)):
    """The most used hashtags this week, among posts this viewer can see."""
    query = await _visible_post_query(user["id"])
    query["created_at"] = {"$gte": now() - timedelta(days=7)}
    query["tags.0"] = {"$exists": True}
    rows = [row async for row in db.posts.aggregate([
        {"$match": query}, {"$unwind": "$tags"},
        {"$group": {"_id": "$tags", "posts": {"$sum": 1}}},
        {"$sort": {"posts": -1, "_id": 1}}, {"$limit": 15},
    ])]
    return [{"tag": row["_id"], "posts": row["posts"]} for row in rows]


# --------------------------------------------------------------------------- #
# Follows                                                                      #
# --------------------------------------------------------------------------- #
@router.post("/users/{user_id}/follow")
async def follow(user_id: str, user: dict = Depends(current_user)):
    await ratelimit.hit("follow", user["id"])
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
    extra = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "bio": 1, "role": 1, "coach_status": 1, "cover_url": 1, "sports": 1, "about": 1},
    ) or {}
    profile["bio"] = extra.get("bio") or ""
    profile["cover_url"] = extra.get("cover_url")
    profile["sports"] = list(extra.get("sports") or [])
    profile["is_coach"] = extra.get("role") == "coach" and extra.get("coach_status", "approved") == "approved"
    profile["followers"] = followers
    profile["following"] = following
    post_filter: dict = {"author_id": user_id, "status": {"$ne": "deleted"}, "community_id": None}
    # A non-author must not learn that only_me posts exist. A non-follower
    # also must not learn how many friends-only posts exist.
    if user["id"] != user_id:
        hidden = ["only_me"]
        if not await social_graph.follows_actively(user["id"], user_id):
            hidden.append("friends")
        post_filter["audience"] = {"$nin": hidden}
    profile["posts"] = await db.posts.count_documents(post_filter)
    can_view = await social_graph.can_view_profile(user["id"], user_id)
    profile["about"] = (extra.get("about") or "") if can_view else ""
    profile["follow_state"] = state
    profile["followed_by_me"] = state == "following"
    profile["is_private"] = await social_graph.is_private(user_id)
    profile["is_blocked"] = bool(await db.blocks.find_one(
        {"blocker_id": user["id"], "blocked_id": user_id}, {"_id": 1}))
    profile["is_muted"] = bool(await db.mutes.find_one(
        {"muter_id": user["id"], "muted_id": user_id}, {"_id": 1}))
    # A private account shows its header but withholds posts until accepted.
    profile["can_view_posts"] = can_view
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


def _dm_view(message: dict) -> dict:
    """A deleted DM keeps its place in the thread but loses its content."""
    view = clean(dict(message)) or {}
    view.setdefault("media", [])
    view.setdefault("status", "active")
    if view["status"] == "deleted":
        view["content"] = ""
        view["media"] = []
    return view


@router.get("/dm")
async def list_threads(user: dict = Depends(current_user)):
    blocked = await social_graph.blocked_ids(user["id"])
    match: dict = {"$or": [{"sender_id": user["id"]}, {"recipient_id": user["id"]}]}
    if blocked:
        # A blocked person's thread disappears from the inbox, both ways.
        match["sender_id"] = {"$nin": blocked}
        match["recipient_id"] = {"$nin": blocked}
    pipeline = [
        {"$match": match},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$thread_key", "last": {"$first": "$$ROOT"},
                    "unread": {"$sum": {"$cond": [{"$and": [{"$eq": ["$recipient_id", user["id"]]}, {"$eq": ["$read_at", None]}]}, 1, 0]}}}},
        {"$sort": {"last.created_at": -1}}, {"$limit": 50},
    ]
    rows = [row async for row in db.direct_messages.aggregate(pipeline)]
    peers = [row["last"]["recipient_id"] if row["last"]["sender_id"] == user["id"] else row["last"]["sender_id"] for row in rows]
    people = await _people(peers)
    return [{"peer": people.get(peer), "last_message": _dm_view(row["last"]), "unread": row["unread"]}
            for row, peer in zip(rows, peers)]


@router.get("/dm/unread-count")
async def dm_unread_count(user: dict = Depends(current_user)):
    """For the inbox badge on the tab bar."""
    query: dict = {"recipient_id": user["id"], "read_at": None, "status": {"$ne": "deleted"}}
    blocked = await social_graph.blocked_ids(user["id"])
    if blocked:
        query["sender_id"] = {"$nin": blocked}
    return {"count": await db.direct_messages.count_documents(query, limit=100)}


@router.get("/dm/{peer_id}/messages")
async def thread_messages(
    peer_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(current_user),
    before: str | None = None,
):
    key = _thread_key(user["id"], peer_id)
    query: dict = {"thread_key": key}
    if before:
        cursor = await db.direct_messages.find_one({"id": before, "thread_key": key}, {"_id": 0, "created_at": 1})
        if not cursor:
            raise HTTPException(404, "Message cursor not found")
        query["created_at"] = {"$lt": cursor["created_at"]}
    rows = [row async for row in db.direct_messages.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)]
    if not before:
        read = await db.direct_messages.update_many(
            {"thread_key": key, "recipient_id": user["id"], "read_at": None}, {"$set": {"read_at": now()}})
        if read.modified_count:
            # The read receipt: tells the sender's open thread to show "Seen".
            await realtime.publish(realtime.user_channel(peer_id), {"type": "dm.read", "peer_id": user["id"]})
    return [_dm_view(row) for row in reversed(rows)]


@router.post("/dm/{peer_id}/messages", status_code=201)
async def send_direct_message(peer_id: str, body: DirectMessageIn, user: dict = Depends(current_user)):
    await ratelimit.hit("direct_message", user["id"])
    if not await db.users.find_one({"id": peer_id}, {"_id": 1}):
        raise HTTPException(404, "User not found")
    if await social_graph.blocked_between(user["id"], peer_id):
        raise HTTPException(403, "This account is unavailable")
    if not await _can_message(user["id"], peer_id):
        raise HTTPException(403, "You can message people you share a community, coaching relationship or mutual follow with")
    media = await _owned_media(body.media_ids, user["id"])
    message = {"id": new_id(), "thread_key": _thread_key(user["id"], peer_id), "sender_id": user["id"],
               "recipient_id": peer_id, "content": body.content.strip(), "media": media,
               "status": "active", "read_at": None, "created_at": now()}
    await db.direct_messages.insert_one(dict(message))
    name = user.get("full_name") or "Someone"
    await notifications.notify(
        peer_id, notifications.DIRECT_MESSAGE, actor=user,
        title=f"{name} sent you a message",
        body=(message["content"][:140] or "📎"),
        target_type="dm", target_id=user["id"])
    view = _dm_view(message)
    await realtime.publish(realtime.user_channel(peer_id), {"type": "dm.created", "message": view})
    # Deliberately not auto-screened: staff never read DMs. The recipient can
    # report one, which hands moderators exactly that message and nothing more.
    return view


@router.delete("/dm/messages/{message_id}", status_code=204)
async def delete_direct_message(message_id: str, user: dict = Depends(current_user)):
    """Unsend your own message. It stays as a "message deleted" marker."""
    message = await db.direct_messages.find_one({"id": message_id}, {"_id": 0})
    if not message or message["sender_id"] != user["id"]:
        raise HTTPException(404, "Message not found")
    await db.direct_messages.update_one(
        {"id": message_id}, {"$set": {"status": "deleted", "deleted_at": now(), "content": "", "media": []}})
    await realtime.publish(realtime.user_channel(message["recipient_id"]), {"type": "dm.deleted", "id": message_id})


@router.post("/dm/{peer_id}/typing", status_code=204)
async def dm_typing(peer_id: str, user: dict = Depends(current_user)):
    """A "typing…" nudge. Realtime only — nothing is stored."""
    if await social_graph.blocked_between(user["id"], peer_id):
        return
    await realtime.publish(realtime.user_channel(peer_id), {"type": "dm.typing", "peer_id": user["id"]})


# --------------------------------------------------------------------------- #
# Profile photos, workout stories, highlights                                  #
# --------------------------------------------------------------------------- #
async def _wall_visible(viewer_id: str, author_id: str) -> None:
    """403 when the viewer cannot see this person's wall. Same rule as posts."""
    if not await db.users.find_one({"id": author_id}, {"_id": 1}):
        raise HTTPException(404, "User not found")
    if author_id != viewer_id and await social_graph.blocked_between(viewer_id, author_id):
        raise HTTPException(403, "This account is unavailable")
    if not await social_graph.can_view_profile(viewer_id, author_id):
        raise HTTPException(403, "This account is private")


def _friends_only_clause(viewer_id: str, author_id: str, follows: bool) -> dict:
    """Hide rows this viewer must not see on a wall.

    only_me never leaves the author. friends stays the accepted-follow edge.
    A missing audience still matches, the same as before the field existed.
    """
    if viewer_id == author_id:
        return {}
    hidden = ["only_me"] if follows else ["only_me", "friends"]
    return {"audience": {"$nin": hidden}}


@router.get("/users/{user_id}/photos")
async def profile_photos(user_id: str, user: dict = Depends(current_user)):
    """Images already attached to this person's wall posts. No separate album."""
    await _wall_visible(user["id"], user_id)
    follows = user["id"] == user_id or await social_graph.follows_actively(user["id"], user_id)
    query = {
        "author_id": user_id, "status": {"$ne": "deleted"}, "community_id": None,
        "media.kind": "image", **_friends_only_clause(user["id"], user_id, follows),
    }
    photos: list[dict] = []
    async for post in db.posts.find(query, {"_id": 0, "id": 1, "media": 1}).sort("created_at", -1).limit(40):
        for item in post.get("media") or []:
            if item.get("kind") == "image":
                photos.append({"post_id": post["id"], "id": item.get("id"), "url": item.get("url"), "kind": "image"})
            if len(photos) >= 60:
                return photos
    return photos


def _story_view(row: dict, author: dict | None) -> dict:
    view = clean(dict(row)) or {}
    view["author"] = author
    view.setdefault("media", [])
    view.setdefault("audience", "friends")
    view.setdefault("highlight", False)
    return view


async def _list_stories(author_id: str, user: dict, *, highlight: bool) -> list[dict]:
    await _wall_visible(user["id"], author_id)
    follows = user["id"] == author_id or await social_graph.follows_actively(user["id"], author_id)
    query: dict = {
        "author_id": author_id,
        "status": {"$ne": "deleted"},
        "highlight": True if highlight else {"$ne": True},
        **_friends_only_clause(user["id"], author_id, follows),
    }
    if not highlight:
        query["expires_at"] = {"$gt": now()}
    author = await _author(author_id)
    rows = [
        _story_view(row, author)
        async for row in db.stories.find(query, {"_id": 0}).sort("created_at", -1 if highlight else 1).limit(50)
    ]
    return rows


@router.get("/users/{user_id}/stories")
async def user_stories(user_id: str, user: dict = Depends(current_user)):
    """Active 24h workout stories. Highlights are a separate list."""
    return await _list_stories(user_id, user, highlight=False)


@router.get("/users/{user_id}/highlights")
async def user_highlights(user_id: str, user: dict = Depends(current_user)):
    return await _list_stories(user_id, user, highlight=True)


@router.get("/stories/feed")
async def story_feed(user: dict = Depends(current_user)):
    """Unexpired stories from you and people you follow. One group per author."""
    followed = await _followed_ids(user["id"])
    blocked = set(await social_graph.blocked_ids(user["id"]))
    authors = [uid for uid in (user["id"], *followed) if uid not in blocked]
    if not authors:
        return []
    rows = [
        row async for row in db.stories.find(
            {
                "author_id": {"$in": authors},
                "status": {"$ne": "deleted"},
                "highlight": {"$ne": True},
                "expires_at": {"$gt": now()},
            },
            {"_id": 0},
        ).sort("created_at", 1).limit(200)
    ]
    followed_set = set(followed)
    visible = [
        row for row in rows
        if row.get("audience") != "only_me" or row["author_id"] == user["id"]
        if row["author_id"] == user["id"]
        or row.get("audience") != "friends"
        or row["author_id"] in followed_set
    ]
    people = await _people(row["author_id"] for row in visible)
    groups: dict[str, dict] = {}
    order: list[str] = []
    for row in visible:
        author_id = row["author_id"]
        if author_id not in groups:
            groups[author_id] = {"author": people.get(author_id), "stories": []}
            order.append(author_id)
        groups[author_id]["stories"].append(_story_view(row, people.get(author_id)))
    order.sort(key=lambda uid: (uid != user["id"], uid))
    return [groups[uid] for uid in order]


@router.post("/stories", status_code=201)
async def create_story(body: StoryIn, user: dict = Depends(current_user)):
    await ratelimit.hit("post", user["id"])
    summary = await _workout_summary(body.workout_id, user)
    media = await _owned_media(body.media_ids, user["id"])
    title = (body.highlight_title or "").strip() or (summary.get("title") or "Workout")
    timestamp = now()
    doc = {
        "id": new_id(),
        "author_id": user["id"],
        "caption": body.caption.strip(),
        "media": media,
        "workout_id": body.workout_id,
        "workout_summary": summary,
        "audience": body.audience,
        "highlight": body.highlight,
        "highlight_title": title if body.highlight else None,
        "expires_at": None if body.highlight else timestamp + STORY_TTL,
        "status": "active",
        "created_at": timestamp,
    }
    await db.stories.insert_one(dict(doc))
    return _story_view(doc, await _author(user["id"]))


@router.delete("/stories/{story_id}", status_code=204)
async def delete_story(story_id: str, user: dict = Depends(current_user)):
    story = await db.stories.find_one({"id": story_id, "status": {"$ne": "deleted"}}, {"_id": 0, "author_id": 1})
    if not story or story["author_id"] != user["id"]:
        raise HTTPException(404, "Story not found")
    await db.stories.update_one(
        {"id": story_id}, {"$set": {"status": "deleted", "deleted_at": now()}},
    )
