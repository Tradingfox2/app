"""Community marketplace, membership, chat, and partner operations."""
from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from pymongo.errors import DuplicateKeyError

from server import clean, current_user, db, new_id, now, optional_user
from community_rankings import build_rankings
import billing
import challenges
import moderation
import notifications
import permissions
import ratelimit
import realtime
import social_graph
import analytics
import staff

router = APIRouter()
logger = logging.getLogger(__name__)

JoinPolicy = Literal["open", "approval", "paid"]
MemberStatus = Literal["pending", "active", "rejected", "left", "banned", "removed"]
ChannelKind = Literal["text", "announcement", "program", "challenge", "checkin", "live"]


class CoachApplicationIn(BaseModel):
    bio: str = Field(min_length=40, max_length=1200)
    specialties: list[str] = Field(min_length=1, max_length=8)
    credentials: list[str] = Field(default_factory=list, max_length=10)


class CoachApplicationReviewIn(BaseModel):
    status: Literal["approved", "rejected"]
    review_note: str | None = Field(default=None, max_length=500)


Category = Literal[
    "strength", "bodybuilding", "powerlifting", "crossfit", "running", "cycling",
    "yoga", "mobility", "calisthenics", "weight_loss", "nutrition", "combat", "general",
]

Rules = list[Annotated[str, Field(min_length=1, max_length=300)]]


class CommunityCreateIn(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    slug: str = Field(min_length=3, max_length=48, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    description: str = Field(default="", max_length=1200)
    category: Category = "general"
    is_public: bool = True
    join_policy: JoinPolicy = "open"
    price_cents: int = Field(default=0, ge=0, le=1_000_000)
    currency: str = Field(default="EUR", min_length=3, max_length=3)

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("price_cents")
    @classmethod
    def validate_price(cls, value: int, info):
        policy = info.data.get("join_policy")
        if policy == "paid" and value < 100:
            raise ValueError("Paid communities require a price of at least 100 cents")
        if policy != "paid" and value != 0:
            raise ValueError("Only paid communities can define a price")
        return value


class CommunityUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=80)
    description: str | None = Field(default=None, max_length=1200)
    category: Category | None = None
    is_public: bool | None = None
    join_policy: JoinPolicy | None = None
    price_cents: int | None = Field(default=None, ge=0, le=1_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    #: House rules, shown on the about page and accepted on first entry.
    rules: Rules | None = Field(default=None, max_length=15)
    #: Shown once to each new member when they first open the community.
    welcome_message: str | None = Field(default=None, max_length=1000)
    #: Uploaded through /media first; only the uploader's own images count.
    cover_media_id: str | None = None
    avatar_media_id: str | None = None


class MembershipReviewIn(BaseModel):
    #: `removed` is a kick: out, but free to rejoin. Setting it on a banned
    #: member is how a ban is lifted.
    status: Literal["active", "rejected", "banned", "removed"]


class TimeoutIn(BaseModel):
    #: 0 lifts a timeout. Four weeks is Discord's ceiling too.
    minutes: int = Field(ge=0, le=28 * 24 * 60)


class RoleIn(BaseModel):
    name: str = Field(min_length=2, max_length=32)
    color: str = Field(default="#9BE15D", pattern=r"^#[0-9a-fA-F]{6}$")
    rank: int = Field(default=1, ge=1, le=100)
    permissions: int = Field(default=permissions.DEFAULT_MEMBER, ge=0, le=permissions.ALL)


class RoleUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=32)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    rank: int | None = Field(default=None, ge=1, le=100)
    permissions: int | None = Field(default=None, ge=0, le=permissions.ALL)


class MemberRolesIn(BaseModel):
    role_ids: list[str] = Field(default_factory=list, max_length=20)


class OverwriteIn(BaseModel):
    role_id: str
    allow: int = Field(default=0, ge=0, le=permissions.ALL)
    deny: int = Field(default=0, ge=0, le=permissions.ALL)


class ChallengeIn(BaseModel):
    metric: challenges.ChallengeMetric = "workouts"
    starts_at: datetime
    ends_at: datetime
    #: Optional collective target, the Strava "group goal": everyone's total
    #: counts toward it.
    goal: float | None = Field(default=None, gt=0, le=1_000_000)

    @model_validator(mode="after")
    def check_window(self):
        starts = self.starts_at if self.starts_at.tzinfo else self.starts_at.replace(tzinfo=timezone.utc)
        ends = self.ends_at if self.ends_at.tzinfo else self.ends_at.replace(tzinfo=timezone.utc)
        challenges.validate_window(starts, ends)
        self.starts_at, self.ends_at = starts, ends
        return self


class ChannelIn(BaseModel):
    name: str = Field(min_length=2, max_length=50)
    description: str = Field(default="", max_length=300)
    kind: ChannelKind = "text"
    challenge: ChallengeIn | None = None
    #: Sidebar group heading, e.g. "Training" or "Nutrition". Free text.
    category: str | None = Field(default=None, max_length=32)
    #: Seconds a member must wait between messages; 0 is off. Six hours max, as Discord.
    slowmode_sec: int = Field(default=0, ge=0, le=21600)

    @model_validator(mode="after")
    def challenge_matches_kind(self):
        if self.kind == "challenge" and self.challenge is None:
            raise ValueError("A challenge channel needs a metric and a date window")
        if self.kind != "challenge" and self.challenge is not None:
            raise ValueError("Only a challenge channel takes challenge settings")
        return self

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
        if len(slug) < 2:
            raise ValueError("Channel name must contain at least two letters or numbers")
        return slug


class ChannelRankingIn(BaseModel):
    ranking_opt_in: bool


class ChannelUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=50)
    description: str | None = Field(default=None, max_length=300)
    #: An empty string clears the category.
    category: str | None = Field(default=None, max_length=32)
    slowmode_sec: int | None = Field(default=None, ge=0, le=21600)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        # Same normalisation as creation, or a rename could produce a channel
        # whose slug could never have been created in the first place.
        if value is None:
            return None
        slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
        if len(slug) < 2:
            raise ValueError("Channel name must contain at least two letters or numbers")
        return slug


class MessageIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    reply_to_id: str | None = None
    #: Uploaded through /media first. Needs ATTACH_MEDIA.
    media_ids: list[str] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def says_something(self):
        if not self.content.strip() and not self.media_ids:
            raise ValueError("A message needs text or an attachment")
        return self


class MessageEditIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ChannelOrderIn(BaseModel):
    channel_ids: list[str] = Field(min_length=1, max_length=200)


#: Discord allows 20 distinct reactions per message; so do we.
MAX_DISTINCT_REACTIONS = 20


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)

    @field_validator("emoji")
    @classmethod
    def looks_like_emoji(cls, value: str) -> str:
        # Reactions are pictographs, not a second chat: no letters, digits or spaces.
        if any(char.isalnum() or char.isspace() for char in value):
            raise ValueError("A reaction must be an emoji")
        return value


async def _community_or_404(community_id: str) -> dict:
    community = await db.communities.find_one({"id": community_id}, {"_id": 0})
    if not community or community.get("status", "active") != "active":
        raise HTTPException(404, "Community not found")
    return community


async def _membership(community_id: str, user_id: str) -> dict | None:
    return await db.community_members.find_one(
        {"community_id": community_id, "user_id": user_id}, {"_id": 0}
    )


async def _active_member(community_id: str, user_id: str) -> dict:
    member = await _membership(community_id, user_id)
    if not member or member.get("status") != "active":
        raise HTTPException(403, "Active community membership required")
    return member


async def _roles(community_id: str) -> list[dict]:
    return [
        role async for role in db.community_roles.find(
            {"community_id": community_id}, {"_id": 0}
        ).sort("rank", 1)
    ]


async def _mask(community_id: str, user_id: str, channel: dict | None = None) -> tuple[int, dict]:
    """Effective permission mask for a member, plus the membership document."""
    member = await _active_member(community_id, user_id)
    community = await _community_or_404(community_id)
    roles = await _roles(community_id)
    return permissions.resolve(member, community, channel, roles), member


async def _require(
    community_id: str,
    user_id: str,
    permission: int,
    channel: dict | None = None,
) -> dict:
    if channel is not None:
        # Nothing may be done inside a channel the caller cannot see. Enforced
        # here once, rather than trusted to every call site to remember.
        permission |= permissions.VIEW_CHANNEL
    mask, member = await _mask(community_id, user_id, channel)
    if not permissions.has(mask, permission):
        raise HTTPException(403, "Insufficient community permissions")
    until = member.get("timeout_until")
    if until and permission & permissions.PARTICIPATE and until > now():
        # A timeout silences, it does not expel: reading stays allowed.
        raise HTTPException(403, f"You are timed out until {until.isoformat()}")
    return member


async def _manager(community_id: str, user_id: str) -> dict:
    """Back-compatible manager gate, now expressed as a permission.

    Legacy owners resolve to every bit and legacy moderators to MODERATOR, so
    existing communities behave exactly as before without a migration.
    """
    mask, member = await _mask(community_id, user_id)
    if not permissions.has(mask, permissions.MANAGE_CHANNEL):
        raise HTTPException(403, "Community manager access required")
    return member


def _coach_is_approved(user: dict) -> bool:
    # Existing coach accounts predate onboarding and remain grandfathered.
    return user.get("role") == "coach" and user.get("coach_status", "approved") == "approved"


async def _community_view(community: dict, user_id: str | None = None) -> dict:
    community_id = community["id"]
    member_count = await db.community_members.count_documents(
        {"community_id": community_id, "status": "active"}
    )
    owner = await db.users.find_one(
        {"id": community["owner_id"]},
        {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1},
    )
    view = clean(dict(community)) or {}
    view["member_count"] = member_count
    view["owner"] = clean(owner)
    view["membership"] = await _membership(community_id, user_id) if user_id else None
    return view


@router.post("/coach/applications", status_code=201)
async def apply_to_coach(body: CoachApplicationIn, user: dict = Depends(current_user)):
    existing = await db.coach_applications.find_one({"user_id": user["id"]}, {"_id": 0})
    if existing and existing.get("status") in {"pending", "approved"}:
        return clean(existing)
    timestamp = now()
    doc = {
        "id": existing["id"] if existing else new_id(),
        "user_id": user["id"],
        **body.model_dump(),
        "status": "pending",
        "review_note": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "updated_at": timestamp,
        "created_at": existing.get("created_at", timestamp) if existing else timestamp,
    }
    await db.coach_applications.replace_one({"user_id": user["id"]}, doc, upsert=True)
    await db.users.update_one({"id": user["id"]}, {"$set": {"coach_status": "pending"}})
    return clean(doc)


@router.get("/coach/application")
async def get_coach_application(user: dict = Depends(current_user)):
    application = await db.coach_applications.find_one({"user_id": user["id"]}, {"_id": 0})
    return clean(application) if application else {"status": user.get("coach_status", "not_applied")}


@router.patch("/admin/coach-applications/{application_id}")
async def review_coach_application(
    application_id: str,
    body: CoachApplicationReviewIn,
    user: dict = Depends(current_user),
):
    if "coaches.review" not in staff.permissions_for(user):
        raise HTTPException(403, "Staff permission required")
    application = await db.coach_applications.find_one({"id": application_id})
    if not application:
        raise HTTPException(404, "Coach application not found")
    timestamp = now()
    await db.coach_applications.update_one(
        {"id": application_id},
        {"$set": {
            "status": body.status,
            "review_note": body.review_note,
            "reviewed_by": user["id"],
            "reviewed_at": timestamp,
            "updated_at": timestamp,
        }},
    )
    await db.users.update_one(
        {"id": application["user_id"]},
        {"$set": {
            "role": "coach" if body.status == "approved" else "athlete",
            "coach_status": body.status,
        }},
    )
    approved = body.status == "approved"
    await notifications.notify(
        application["user_id"], notifications.COACH_DECISION, actor=user,
        title=("Your coach application was approved" if approved
               else "Your coach application was not approved"),
        body=body.review_note or "",
        target_type="coach_application", target_id=application_id,
        metadata={"approved": approved})
    await staff.audit(user, f"coach_application.{body.status}", target_type="user",
                      target_id=application["user_id"], reason=body.review_note,
                      metadata={"application_id": application_id})
    return clean(await db.coach_applications.find_one({"id": application_id}, {"_id": 0}))


@router.get("/admin/coach-applications")
async def list_coach_applications(
    status: Literal["pending", "approved", "rejected"] = "pending",
    user: dict = Depends(current_user),
):
    if "coaches.review" not in staff.permissions_for(user):
        raise HTTPException(403, "Staff permission required")
    applications = []
    async for application in db.coach_applications.find(
        {"status": status}, {"_id": 0}
    ).sort("created_at", 1).limit(100):
        applicant = await db.users.find_one(
            {"id": application["user_id"]},
            {"_id": 0, "id": 1, "full_name": 1, "email": 1, "avatar_url": 1},
        )
        application["applicant"] = clean(applicant)
        applications.append(clean(application))
    return applications


@router.get("/coaches")
async def list_coaches():
    coaches = []
    async for coach in db.users.find(
        {"role": "coach", "$or": [{"coach_status": "approved"}, {"coach_status": {"$exists": False}}]},
        {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1, "role": 1, "coach_status": 1},
    ).limit(50):
        coach["community_count"] = await db.communities.count_documents(
            {"owner_id": coach["id"], "status": {"$ne": "archived"}}
        )
        coach["member_count"] = await db.community_members.count_documents(
            {"owner_id": coach["id"], "status": "active"}
        )
        coaches.append(clean(coach))
    return coaches


# Posts / feed live in routers/social.py (likes, reposts, comments, media, DMs).


@router.get("/communities")
async def list_communities(
    scope: Literal["discover", "mine"] = "discover",
    user: dict | None = Depends(optional_user),
    category: Category | None = None,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    if scope == "discover":
        # Ranked by size in the database. Sorting in Python after taking the
        # 100 newest meant a large older community simply fell off the list.
        match: dict = {"is_public": True, "status": {"$ne": "archived"}}
        if category:
            match["category"] = category
        pipeline = [
            {"$match": match},
            {"$lookup": {
                "from": "community_members", "let": {"cid": "$id"},
                "pipeline": [
                    {"$match": {"$expr": {"$and": [
                        {"$eq": ["$community_id", "$$cid"]}, {"$eq": ["$status", "active"]}]}}},
                    {"$count": "n"},
                ],
                "as": "_mc",
            }},
            {"$addFields": {"_members": {"$ifNull": [{"$arrayElemAt": ["$_mc.n", 0]}, 0]}}},
            {"$sort": {"_members": -1, "created_at": -1}},
            {"$skip": offset},
            {"$limit": limit},
            {"$project": {"_id": 0, "_mc": 0, "_members": 0}},
        ]
        rows = [row async for row in db.communities.aggregate(pipeline)]
        return [await _community_view(row, user["id"] if user else None) for row in rows]
    if not user:
        raise HTTPException(401, "Not authenticated")
    memberships = [
        member
        async for member in db.community_members.find(
            {"user_id": user["id"], "status": {"$in": ["active", "pending"]}},
            {"_id": 0, "community_id": 1},
        )
    ]
    # An archived community is closed for everyone, members included.
    query = {"id": {"$in": [member["community_id"] for member in memberships]},
             "status": {"$ne": "archived"}}
    communities = [
        community async for community in db.communities.find(query, {"_id": 0}).sort("created_at", -1).limit(100)
    ]
    views = [await _community_view(community, user["id"] if user else None) for community in communities]
    return sorted(views, key=lambda item: (item["member_count"], item["created_at"]), reverse=True)


@router.post("/communities", status_code=201)
async def create_community(body: CommunityCreateIn, user: dict = Depends(current_user)):
    if not _coach_is_approved(user):
        raise HTTPException(403, "Approved coach status required")
    timestamp = now()
    community_id = new_id()
    community = {
        "id": community_id,
        "owner_id": user["id"],
        **body.model_dump(),
        "cover_url": None,
        "avatar_url": None,
        "rules": [],
        "welcome_message": "",
        "status": "active",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    owner_membership = {
        "id": new_id(),
        "community_id": community_id,
        "user_id": user["id"],
        "owner_id": user["id"],
        "role": "owner",
        "status": "active",
        "entitlement_source": "ownership",
        "joined_at": timestamp,
        "created_at": timestamp,
    }
    channel = {
        "id": new_id(),
        "community_id": community_id,
        "name": "general",
        "description": "",
        "created_by": user["id"],
        "is_default": True,
        "status": "active",
        "created_at": timestamp,
    }
    try:
        await db.communities.insert_one(community)
        await db.community_members.insert_one(owner_membership)
        await db.channels.insert_one(channel)
    except DuplicateKeyError as exc:
        await db.communities.delete_one({"id": community_id})
        await db.community_members.delete_many({"community_id": community_id})
        await db.channels.delete_many({"community_id": community_id})
        raise HTTPException(409, "Community slug already exists") from exc
    return await _community_view(community, user["id"])


@router.get("/communities/{community_id}")
async def get_community(community_id: str, user: dict | None = Depends(optional_user)):
    community = await _community_or_404(community_id)
    if not community.get("is_public"):
        if not user:
            raise HTTPException(401, "Not authenticated")
        await _active_member(community_id, user["id"])
    return await _community_view(community, user["id"] if user else None)


@router.patch("/communities/{community_id}")
async def update_community(
    community_id: str,
    body: CommunityUpdateIn,
    user: dict = Depends(current_user),
):
    community = await _community_or_404(community_id)
    await _manager(community_id, user["id"])
    updates = body.model_dump(exclude_none=True)
    policy = updates.get("join_policy", community.get("join_policy", "open"))
    price = updates.get("price_cents", community.get("price_cents", 0))
    if policy == "paid" and price < 100:
        raise HTTPException(422, "Paid communities require a price of at least 100 cents")
    if policy != "paid" and price != 0:
        raise HTTPException(422, "Only paid communities can define a price")
    if policy != community.get("join_policy", "open") and "paid" in {policy, community.get("join_policy")}:
        # Billing migration needs an explicit grandfathering/cancellation policy.
        # Do not silently grant or revoke existing memberships via a metadata edit.
        raise HTTPException(409, "Paid membership policy changes require a billing migration")
    if "currency" in updates:
        updates["currency"] = updates["currency"].upper()
    for field, target in (("cover_media_id", "cover_url"), ("avatar_media_id", "avatar_url")):
        media_id = updates.pop(field, None)
        if media_id:
            media = await db.media.find_one(
                {"id": media_id, "user_id": user["id"], "kind": "image"}, {"_id": 0, "url": 1})
            if not media:
                raise HTTPException(422, "Unknown image")
            updates[target] = media["url"]
    updates["updated_at"] = now()
    await db.communities.update_one({"id": community_id}, {"$set": updates})
    updated = await db.communities.find_one({"id": community_id}, {"_id": 0})
    return await _community_view(updated, user["id"])


async def _activate(
    community: dict,
    user: dict,
    *,
    bypass_approval: bool = False,
    source: str = "free",
) -> tuple[dict, bool]:
    """The single door into a community. Returns (membership, changed).

    Every way in — joining directly, redeeming an invite — goes through here,
    so the two rules that matter cannot be routed around:
    - a banned member stays banned, whatever link they arrive with;
    - a paid community needs verified billing, whatever link they arrive with.
      Only the signed Stripe webhook passes `source="payment"`.
    """
    community_id = community["id"]
    existing = await _membership(community_id, user["id"])
    status_now = (existing or {}).get("status")
    if status_now in {"active", "banned"}:
        return clean(existing), False
    if status_now == "pending" and not bypass_approval:
        return clean(existing), False
    policy = community.get("join_policy", "open")
    if policy == "paid" and source != "payment":
        raise HTTPException(402, "Verified payment is required before membership activation")
    activate = policy == "open" or bypass_approval
    timestamp = now()
    membership = {
        "id": existing["id"] if existing else new_id(),
        "community_id": community_id,
        "user_id": user["id"],
        "owner_id": community["owner_id"],
        "role": "member",
        "status": "active" if activate else "pending",
        "entitlement_source": source,
        "joined_at": timestamp if activate else None,
        "created_at": existing.get("created_at", timestamp) if existing else timestamp,
        "updated_at": timestamp,
    }
    await db.community_members.replace_one(
        {"community_id": community_id, "user_id": user["id"]}, membership, upsert=True
    )
    return clean(membership), True


@router.post("/communities/{community_id}/join")
async def join_community(community_id: str, user: dict = Depends(current_user)):
    community = await _community_or_404(community_id)
    if not community.get("is_public", True):
        # A private community is reached by invite only; invite redemption
        # calls _activate directly, so it is unaffected by this door closing.
        existing = await _membership(community_id, user["id"])
        if (existing or {}).get("status") != "active":
            raise HTTPException(403, "This community is invite-only")
    membership, _ = await _activate(community, user)
    return membership


class CheckoutIn(BaseModel):
    invite_code: str | None = Field(default=None, max_length=64)


@router.post("/communities/{community_id}/checkout")
async def start_checkout(
    community_id: str, body: CheckoutIn | None = None, user: dict = Depends(current_user),
):
    """Open a Stripe Checkout page for a paid community.

    This takes no money and grants nothing: the membership only switches on
    when Stripe's signed webhook reports the payment (see `stripe_webhook`).
    A private paid community still needs a valid invite to reach checkout.
    """
    await ratelimit.hit("checkout", user["id"])
    community = await _community_or_404(community_id)
    if community.get("join_policy") != "paid":
        raise HTTPException(409, "This community is free to join")
    if not billing.is_configured():
        raise HTTPException(503, "Payments are not set up yet")
    status_now = (await _membership(community_id, user["id"]) or {}).get("status")
    if status_now == "banned":
        raise HTTPException(403, "The community's managers removed you")
    if status_now == "active":
        raise HTTPException(409, "You are already a member")
    invite_code = None
    if not community.get("is_public", True):
        code = body.invite_code if body else None
        invite = await db.community_invites.find_one({"code": code, "community_id": community_id}, {"_id": 0}) if code else None
        if not invite or _invite_state(invite):
            raise HTTPException(403, "This community is invite-only")
        invite_code = code
    back = f"{billing.app_url()}/community/{community_id}"
    try:
        session = await billing.create_checkout(
            community=community, user=user,
            success_url=f"{back}?checkout=success", cancel_url=f"{back}?checkout=cancelled")
    except billing.BillingError as exc:
        logger.warning("Stripe checkout for %s failed: %s", community_id, exc)
        raise HTTPException(502, "Could not open checkout. Try again in a moment.") from exc
    await db.community_checkouts.insert_one({
        "id": session["id"], "community_id": community_id, "user_id": user["id"],
        "invite_code": invite_code, "status": "open", "amount_cents": community["price_cents"],
        "currency": community.get("currency", "EUR"), "created_at": now(),
    })
    return {"url": session["url"]}


@router.post("/billing/stripe/webhook")
async def stripe_webhook(request: Request):
    """Stripe's signed events — the only thing that can activate a paid membership.

    Every handler is idempotent (Stripe retries, and may deliver twice), and
    each event id is recorded so a redelivery is acknowledged without work.
    """
    payload = await request.body()
    if not billing.verify_signature(payload, request.headers.get("stripe-signature", "")):
        raise HTTPException(400, "Invalid signature")
    event = json.loads(payload)
    if await db.billing_events.find_one({"id": event.get("id")}, {"_id": 1}):
        return {"received": True}
    kind = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    if kind == "checkout.session.completed":
        await _checkout_completed(obj)
    elif kind in {"customer.subscription.deleted", "customer.subscription.updated"}:
        await _subscription_changed(obj, deleted=kind == "customer.subscription.deleted")
    await db.billing_events.update_one(
        {"id": event.get("id")}, {"$setOnInsert": {"type": kind, "received_at": now()}}, upsert=True)
    return {"received": True}


async def _cancel_quietly(subscription_id: str | None, why: str) -> bool:
    """Cancel where a failure must not undo the action around it; logs instead."""
    if not subscription_id:
        return True
    try:
        await billing.cancel_subscription(subscription_id)
        return True
    except billing.BillingError as exc:
        logger.error("Could not cancel subscription %s (%s): %s", subscription_id, why, exc)
        return False


async def _checkout_completed(session: dict) -> None:
    if session.get("mode") != "subscription" or session.get("payment_status") not in {"paid", "no_payment_required"}:
        return
    checkout = await db.community_checkouts.find_one({"id": session.get("id")}, {"_id": 0})
    if not checkout or checkout.get("status") != "open":
        return  # not one of ours, or already handled
    subscription_id = session.get("subscription")
    community = await db.communities.find_one({"id": checkout["community_id"]}, {"_id": 0})
    member = await db.users.find_one({"id": checkout["user_id"]}, {"_id": 0})
    membership = None
    if community and member:
        membership, changed = await _activate(community, member, bypass_approval=True, source="payment")
        paying_twice = not changed and membership.get("stripe_subscription_id") not in (None, subscription_id)
        if membership.get("status") != "active" or paying_twice:
            membership = None
    if membership is None:
        # Banned while on the checkout page, community gone, or already paying:
        # never keep charging someone who did not get in.
        await _cancel_quietly(subscription_id, "checkout refused")
        await db.community_checkouts.update_one({"id": checkout["id"]}, {"$set": {"status": "refused", "updated_at": now()}})
        return
    await db.community_members.update_one({"id": membership["id"]}, {"$set": {
        "stripe_subscription_id": subscription_id, "stripe_customer_id": session.get("customer"),
        "entitlement_source": "payment", "ended_reason": None, "updated_at": now()}})
    await db.community_checkouts.update_one({"id": checkout["id"]}, {"$set": {
        "status": "completed", "subscription_id": subscription_id, "updated_at": now()}})
    if checkout.get("invite_code"):
        await db.community_invites.update_one({"code": checkout["invite_code"]}, {"$inc": {"uses": 1}})
    await notifications.notify(
        member["id"], notifications.MEMBERSHIP, actor=None, title=f"You joined {community['name']}",
        body="Your payment went through. Welcome in.",
        target_type="community", target_id=community["id"], metadata={"approved": True})


async def _subscription_changed(subscription: dict, *, deleted: bool) -> None:
    """A cancelled or unpaid subscription ends the membership; a recovered one restores it.

    `past_due` changes nothing: Stripe is still retrying the card, and a
    member should not lose access over a payment that may yet succeed.
    """
    membership = await db.community_members.find_one({"stripe_subscription_id": subscription.get("id")}, {"_id": 0})
    if not membership or membership.get("role") == "owner":
        return
    status = subscription.get("status")
    community = await db.communities.find_one({"id": membership["community_id"]}, {"_id": 0, "name": 1}) or {}
    name = community.get("name", "the community")
    if deleted or status in {"canceled", "unpaid", "incomplete_expired"}:
        if membership.get("status") != "active":
            return  # they already left or were removed; that path cancelled the subscription
        await db.community_members.update_one({"id": membership["id"]}, {"$set": {
            "status": "left", "ended_reason": "billing", "updated_at": now()}})
        await notifications.notify(
            membership["user_id"], notifications.MEMBERSHIP, actor=None,
            title=f"Your membership in {name} ended",
            body="The subscription was cancelled or a payment failed. You can subscribe again any time.",
            target_type="community", target_id=membership["community_id"], metadata={"approved": False})
    elif status in {"active", "trialing"} and membership.get("status") == "left" and membership.get("ended_reason") == "billing":
        await db.community_members.update_one({"id": membership["id"]}, {"$set": {
            "status": "active", "ended_reason": None, "updated_at": now()}})


@router.get("/communities/{community_id}/members")
async def list_members(
    community_id: str,
    user: dict = Depends(current_user),
    status: MemberStatus | None = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
):
    """Every membership row, for managers — a page at a time, optionally one
    status or a name search. Profiles are fetched in one batch per page."""
    await _manager(community_id, user["id"])
    query: dict = {"community_id": community_id}
    if status:
        query["status"] = status
    if q and q.strip():
        matching = [row["id"] async for row in db.users.find(
            {"full_name": {"$regex": re.escape(q.strip()), "$options": "i"}}, {"_id": 0, "id": 1}).limit(2000)]
        query["user_id"] = {"$in": matching}
    rows = [row async for row in db.community_members.find(
        query, {"_id": 0, "stripe_customer_id": 0, "stripe_subscription_id": 0}).sort("created_at", 1).skip(offset).limit(limit)]
    people = await _people([row["user_id"] for row in rows])
    return [clean({**row, "user": people.get(row["user_id"])}) for row in rows]


@router.patch("/communities/{community_id}/members/{member_id}")
async def review_membership(
    community_id: str,
    member_id: str,
    body: MembershipReviewIn,
    user: dict = Depends(current_user),
):
    member = await db.community_members.find_one({"id": member_id, "community_id": community_id}, {"_id": 0})
    if not member:
        raise HTTPException(404, "Membership not found")
    if member.get("role") == "owner":
        raise HTTPException(409, "Owner membership cannot be changed")
    # Reviewing a join request is channel management. Anything done to someone
    # already inside — or already banned — is a separate power, KICK_MEMBER,
    # and only over members ranked below you. Otherwise "reject" an active
    # member would be a kick without the kick permission.
    reviewing_request = member.get("status") == "pending" and body.status in {"active", "rejected"}
    if reviewing_request:
        await _manager(community_id, user["id"])
    else:
        await _require(community_id, user["id"], permissions.KICK_MEMBER)
        await _check_outranks(community_id, user["id"], member)
    community = await _community_or_404(community_id)
    if body.status == "active" and community.get("join_policy") == "paid":
        raise HTTPException(402, "Only verified billing can activate paid memberships")
    updates = {"status": body.status, "updated_at": now(), "reviewed_by": user["id"]}
    if body.status == "active":
        updates["joined_at"] = now()
    await db.community_members.update_one({"id": member_id}, {"$set": updates})
    if body.status != "active" and member.get("status") == "active" and member.get("stripe_subscription_id"):
        # A removal must stop the billing too. The removal itself stands even if
        # Stripe is down; the flag leaves the cancellation visible to finish by hand.
        if not await _cancel_quietly(member["stripe_subscription_id"], f"member {body.status}"):
            await db.community_members.update_one({"id": member_id}, {"$set": {"stripe_cancel_failed": True}})
    if not reviewing_request:
        await staff.audit(
            user, f"community.member_{body.status}", target_type="community_member",
            target_id=member_id, reason=None,
            metadata={"community_id": community_id, "user_id": member["user_id"],
                      "from": member.get("status")},
        )
    if body.status in {"active", "rejected"}:
        approved = body.status == "active"
        await notifications.notify(
            member["user_id"], notifications.MEMBERSHIP, actor=user,
            title=(f"You joined {community['name']}" if approved
                   else f"Your request to join {community['name']} was declined"),
            target_type="community", target_id=community_id,
            metadata={"approved": approved})
    return clean(await db.community_members.find_one({"id": member_id}, {"_id": 0}))


@router.post("/communities/{community_id}/members/{member_id}/timeout")
async def timeout_member(
    community_id: str, member_id: str, body: TimeoutIn, user: dict = Depends(current_user),
):
    """Silence a member for a while — the step between a warning and a kick."""
    await _require(community_id, user["id"], permissions.KICK_MEMBER)
    member = await db.community_members.find_one(
        {"id": member_id, "community_id": community_id, "status": "active"}, {"_id": 0})
    if not member:
        raise HTTPException(404, "Membership not found")
    if member["user_id"] == user["id"]:
        raise HTTPException(409, "You cannot time yourself out")
    await _check_outranks(community_id, user["id"], member)
    until = now() + timedelta(minutes=body.minutes) if body.minutes else None
    await db.community_members.update_one({"id": member_id}, {"$set": {"timeout_until": until}})
    await staff.audit(
        user, "community.member_timeout", target_type="community_member", target_id=member_id,
        reason=None, metadata={"community_id": community_id, "user_id": member["user_id"],
                               "minutes": body.minutes},
    )
    community = await _community_or_404(community_id)
    if until:
        await notifications.create(
            member["user_id"], notifications.MEMBERSHIP,
            f"You were timed out in {community['name']}",
            f"You can read but not post until {until.isoformat()}.",
            metadata={"target_type": "community", "target_id": community_id},
        )
    return clean({**member, "timeout_until": until})


@router.delete("/communities/{community_id}", status_code=204)
async def archive_community(community_id: str, user: dict = Depends(current_user)):
    """Archive a community. Owner only — closing someone's community is not a
    power a moderator should hold, however much else they can manage.

    `_community_or_404` already refuses anything not `active`, so every read
    path honours this with no further change.
    """
    community = await _community_or_404(community_id)
    if community["owner_id"] != user["id"]:
        raise HTTPException(403, "Only the owner can archive a community")
    await db.communities.update_one(
        {"id": community_id}, {"$set": {"status": "archived", "archived_at": now()}}
    )
    await staff.audit(
        user, "community.archived", target_type="community", target_id=community_id,
        reason=None, metadata={"name": community.get("name")},
    )


@router.get("/communities-archived")
async def list_archived_communities(user: dict = Depends(current_user)):
    """The caller's own archived communities — the only place they still show,
    so an owner can find one again to restore it."""
    return [
        clean(row) async for row in db.communities.find(
            {"owner_id": user["id"], "status": "archived"}, {"_id": 0}
        ).sort("archived_at", -1).limit(100)
    ]


@router.post("/communities/{community_id}/restore")
async def restore_community(community_id: str, user: dict = Depends(current_user)):
    community = await db.communities.find_one({"id": community_id, "status": "archived"}, {"_id": 0})
    if not community:
        raise HTTPException(404, "Archived community not found")
    if community["owner_id"] != user["id"]:
        raise HTTPException(403, "Only the owner can restore a community")
    await db.communities.update_one(
        {"id": community_id}, {"$set": {"status": "active", "archived_at": None, "updated_at": now()}})
    await staff.audit(
        user, "community.restored", target_type="community", target_id=community_id,
        reason=None, metadata={"name": community.get("name")},
    )
    return await _community_view({**community, "status": "active"}, user["id"])


class TransferIn(BaseModel):
    member_id: str


@router.post("/communities/{community_id}/transfer")
async def transfer_ownership(community_id: str, body: TransferIn, user: dict = Depends(current_user)):
    """Hand the community to another active member. Owner only, audited.

    The previous owner stays on as a moderator rather than dropping to a plain
    member: a handover should not strand the person who built the place.
    """
    community = await _community_or_404(community_id)
    if community["owner_id"] != user["id"]:
        raise HTTPException(403, "Only the owner can transfer the community")
    target = await db.community_members.find_one(
        {"id": body.member_id, "community_id": community_id, "status": "active"}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Active member not found")
    if target["user_id"] == user["id"]:
        raise HTTPException(409, "You already own this community")
    new_owner = await db.users.find_one({"id": target["user_id"]}, {"_id": 0})
    if not new_owner or not _coach_is_approved(new_owner):
        # Creating a community needs approved coach status; so does owning one.
        raise HTTPException(409, "The new owner must be an approved coach")
    timestamp = now()
    await db.communities.update_one(
        {"id": community_id}, {"$set": {"owner_id": target["user_id"], "updated_at": timestamp}})
    await db.community_members.update_one(
        {"community_id": community_id, "user_id": user["id"]},
        {"$set": {"role": "moderator", "entitlement_source": "free", "updated_at": timestamp}})
    await db.community_members.update_one(
        {"id": target["id"]},
        {"$set": {"role": "owner", "entitlement_source": "ownership", "timeout_until": None,
                  "updated_at": timestamp}})
    if target.get("stripe_subscription_id"):
        # An owner does not pay for their own community.
        if await _cancel_quietly(target["stripe_subscription_id"], "became owner"):
            await db.community_members.update_one({"id": target["id"]}, {"$set": {"stripe_subscription_id": None}})
    await db.community_members.update_many(
        {"community_id": community_id}, {"$set": {"owner_id": target["user_id"]}})
    await staff.audit(
        user, "community.ownership_transferred", target_type="community", target_id=community_id,
        reason=None, metadata={"from": user["id"], "to": target["user_id"]},
    )
    await notifications.notify(
        target["user_id"], notifications.MEMBERSHIP, actor=user,
        title=f"You now own {community['name']}",
        target_type="community", target_id=community_id,
    )
    updated = await db.communities.find_one({"id": community_id}, {"_id": 0})
    return await _community_view(updated, user["id"])


@router.post("/communities/{community_id}/onboarding", status_code=204)
async def complete_onboarding(community_id: str, user: dict = Depends(current_user)):
    """The member has seen the welcome message and accepted the rules."""
    member = await _active_member(community_id, user["id"])
    await db.community_members.update_one(
        {"id": member["id"], "onboarded_at": None}, {"$set": {"onboarded_at": now()}})
    await db.community_members.update_one(
        {"id": member["id"], "onboarded_at": {"$exists": False}}, {"$set": {"onboarded_at": now()}})


@router.get("/communities/{community_id}/audit-log")
async def community_audit_log(
    community_id: str,
    user: dict = Depends(current_user),
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    """The community's own moderation trail, for its managers.

    Platform staff read the whole log through the admin console; this is the
    slice about one community — the actions taken inside it — so an owner can
    see who kicked whom without being platform staff.
    """
    await _manager(community_id, user["id"])
    channel_ids = [row["id"] async for row in db.channels.find({"community_id": community_id}, {"_id": 0, "id": 1})]
    query = {"$or": [
        {"target_id": community_id},
        {"metadata.community_id": community_id},
        {"target_id": {"$in": channel_ids}},
    ], "action": {"$regex": "^community\\."}}
    # Staff emails and platform roles are the platform's business, not the owner's.
    projection = {"_id": 0, "actor_email": 0, "actor_staff_role": 0}
    rows = [clean(row) async for row in db.audit_log.find(query, projection).sort("created_at", -1).limit(limit)]
    people = await _people(list({row.get("actor_id") for row in rows if row.get("actor_id")}))
    for row in rows:
        row["actor"] = people.get(row.get("actor_id"))
    return rows


class CommunityReportReviewIn(BaseModel):
    resolution: Literal["dismissed", "content_removed"]
    note: str = Field(default="", max_length=1000)


@router.get("/communities/{community_id}/reports")
async def community_reports(
    community_id: str,
    user: dict = Depends(current_user),
    status: Literal["open", "resolved"] = "open",
):
    """Reports about content inside this community, for its moderators.

    Platform staff still see every report in the admin console; this lets a
    community keep its own house clean without waiting for them.
    """
    await _require(community_id, user["id"], permissions.MANAGE_MESSAGES)
    rows = [
        clean(row) async for row in db.reports.find(
            {"community_id": community_id, "status": status},
            {"_id": 0, "reporter_id": 0},  # reporters stay anonymous to the community
        ).sort("created_at", 1).limit(100)
    ]
    people = await _people(list({row["reported_user_id"] for row in rows if row.get("reported_user_id")}))
    for row in rows:
        row["reported_user"] = people.get(row.get("reported_user_id"))
    return rows


@router.patch("/communities/{community_id}/reports/{report_id}")
async def review_community_report(
    community_id: str, report_id: str, body: CommunityReportReviewIn, user: dict = Depends(current_user),
):
    await _require(community_id, user["id"], permissions.MANAGE_MESSAGES)
    report = await db.reports.find_one({"id": report_id, "community_id": community_id}, {"_id": 0})
    if not report:
        raise HTTPException(404, "Report not found")
    if report["status"] != "open":
        raise HTTPException(409, "Report already resolved")
    if report.get("reported_user_id") == user["id"]:
        # Nobody judges a report about themselves; platform staff will.
        raise HTTPException(409, "A report about you is reviewed by platform staff")
    if body.resolution == "content_removed":
        await moderation.remove_content(report["target_type"], report["target_id"], actor=user)
    await db.reports.update_one({"id": report_id}, {"$set": {
        "status": "resolved", "resolution": body.resolution, "note": body.note.strip(),
        "reviewed_by": user["id"], "reviewed_at": now(), "reviewed_in": "community",
    }})
    await staff.audit(
        user, f"community.report_{body.resolution}", target_type=report["target_type"],
        target_id=report["target_id"], reason=body.note.strip() or None,
        metadata={"community_id": community_id, "report_id": report_id},
    )
    return clean(await db.reports.find_one({"id": report_id}, {"_id": 0, "reporter_id": 0}))


@router.get("/communities/{community_id}/insights")
async def community_insights(community_id: str, user: dict = Depends(current_user)):
    """Growth and engagement for the people running the community.

    Counts only — who joined and how much was said — never anyone's training
    or health data. Windows are the last 7 and 30 days.
    """
    await _manager(community_id, user["id"])
    current = now()
    week, month = current - timedelta(days=7), current - timedelta(days=30)
    members = db.community_members
    messages = db.messages

    async def count(collection, query):
        return await collection.count_documents(query)

    active_authors = await messages.distinct(
        "author_id", {"community_id": community_id, "status": "active", "created_at": {"$gte": week}})
    total_members = await count(members, {"community_id": community_id, "status": "active"})
    daily = []
    async for row in messages.aggregate([
        {"$match": {"community_id": community_id, "status": "active", "created_at": {"$gte": month}}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}, "n": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]):
        daily.append({"day": row["_id"], "messages": row["n"]})
    top_channels = []
    async for row in messages.aggregate([
        {"$match": {"community_id": community_id, "status": "active", "created_at": {"$gte": month}}},
        {"$group": {"_id": "$channel_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 5},
    ]):
        channel = await db.channels.find_one({"id": row["_id"]}, {"_id": 0, "id": 1, "name": 1})
        if channel:
            top_channels.append({**channel, "messages": row["n"]})
    return {
        "members": total_members,
        "joined_7d": await count(members, {"community_id": community_id, "status": "active", "joined_at": {"$gte": week}}),
        "joined_30d": await count(members, {"community_id": community_id, "status": "active", "joined_at": {"$gte": month}}),
        "left_30d": await count(members, {"community_id": community_id, "status": {"$in": ["left", "removed"]}, "updated_at": {"$gte": month}}),
        "pending": await count(members, {"community_id": community_id, "status": "pending"}),
        "messages_7d": await count(messages, {"community_id": community_id, "status": "active", "created_at": {"$gte": week}}),
        "messages_30d": await count(messages, {"community_id": community_id, "status": "active", "created_at": {"$gte": month}}),
        "active_members_7d": len(active_authors),
        "engagement_rate_7d": round(len(active_authors) / total_members, 3) if total_members else 0,
        "daily_messages": daily,
        "top_channels": top_channels,
    }


@router.delete("/communities/{community_id}/membership", status_code=204)
async def leave_community(community_id: str, user: dict = Depends(current_user)):
    member = await _membership(community_id, user["id"])
    if not member:
        return None
    if member.get("role") == "owner":
        raise HTTPException(409, "Community owners cannot leave their community")
    if member.get("status") == "active" and member.get("stripe_subscription_id"):
        # Cancel first: leaving must never leave the card still being charged.
        try:
            await billing.cancel_subscription(member["stripe_subscription_id"])
        except billing.BillingError as exc:
            logger.warning("Cancel on leave failed for %s: %s", member["id"], exc)
            raise HTTPException(502, "Could not cancel your subscription, so you are still a member. Try again in a moment.") from exc
    await db.community_members.update_one(
        {"id": member["id"]}, {"$set": {"status": "left", "ended_reason": "left", "updated_at": now()}}
    )
    return None


async def _ensure_default_role(community_id: str) -> dict:
    """Guarantee an @everyone role before custom roles start carrying grants.

    Without it, assigning a narrow custom role would silently strip a member of
    the baseline grant they had under the legacy fallback.
    """
    existing = await db.community_roles.find_one(
        {"community_id": community_id, "is_default": True}, {"_id": 0}
    )
    if existing:
        return existing
    role = {
        "id": new_id(),
        "community_id": community_id,
        "name": "everyone",
        "color": "#8A8F98",
        "rank": 0,
        "permissions": permissions.DEFAULT_MEMBER,
        "is_default": True,
        "created_at": now(),
    }
    await db.community_roles.insert_one(dict(role))
    return role


async def _role_or_404(role_id: str) -> dict:
    role = await db.community_roles.find_one({"id": role_id}, {"_id": 0})
    if not role:
        raise HTTPException(404, "Role not found")
    return role


async def _rank_ceiling(community_id: str, user_id: str) -> int:
    member = await _active_member(community_id, user_id)
    community = await _community_or_404(community_id)
    return permissions.highest_rank(member, community, await _roles(community_id))


async def _grant_limit(community_id: str, user_id: str) -> tuple[int, int]:
    """(permission mask, rank ceiling) — the most this member can hand out.

    Rank alone is not enough: a role manager could otherwise mint a role below
    their rank carrying every bit, assign it to themselves, and end up holding
    powers nobody gave them. You can only grant what you hold.
    """
    mask, _ = await _mask(community_id, user_id)
    return mask, await _rank_ceiling(community_id, user_id)


def _check_grantable(bits: int, mask: int) -> None:
    if bits & ~mask:
        raise HTTPException(403, "Cannot grant permissions you do not hold")


async def _target_rank(community_id: str, target: dict) -> int:
    community = await _community_or_404(community_id)
    return permissions.highest_rank(target, community, await _roles(community_id))


async def _check_outranks(community_id: str, user_id: str, target: dict) -> None:
    """Only act on someone strictly below you — the Discord role hierarchy."""
    if target.get("user_id") == user_id:
        return
    if await _target_rank(community_id, target) >= await _rank_ceiling(community_id, user_id):
        raise HTTPException(403, "Cannot act on a member at or above your own rank")


@router.get("/communities/{community_id}/roles")
async def list_roles(community_id: str, user: dict = Depends(current_user)):
    await _community_or_404(community_id)
    await _active_member(community_id, user["id"])
    return [clean(role) for role in await _roles(community_id)]


@router.post("/communities/{community_id}/roles", status_code=201)
async def create_role(community_id: str, body: RoleIn, user: dict = Depends(current_user)):
    await _require(community_id, user["id"], permissions.MANAGE_ROLES)
    mask, ceiling = await _grant_limit(community_id, user["id"])
    if body.rank >= ceiling:
        raise HTTPException(403, "Cannot create a role at or above your own rank")
    _check_grantable(body.permissions, mask)
    await _ensure_default_role(community_id)
    role = {
        "id": new_id(),
        "community_id": community_id,
        **body.model_dump(),
        "is_default": False,
        "created_at": now(),
    }
    await db.community_roles.insert_one(dict(role))
    return clean(role)


@router.patch("/roles/{role_id}")
async def update_role(role_id: str, body: RoleUpdateIn, user: dict = Depends(current_user)):
    role = await _role_or_404(role_id)
    community_id = role["community_id"]
    await _require(community_id, user["id"], permissions.MANAGE_ROLES)
    mask, ceiling = await _grant_limit(community_id, user["id"])
    if role.get("rank", 0) >= ceiling:
        raise HTTPException(403, "Cannot edit a role at or above your own rank")
    updates = {key: value for key, value in body.model_dump().items() if value is not None}
    if role.get("is_default") and "rank" in updates:
        raise HTTPException(409, "The default role rank is fixed")
    if int(updates.get("rank", 0)) >= ceiling:
        raise HTTPException(403, "Cannot raise a role to or above your own rank")
    if "permissions" in updates:
        # Only the bits being added need to be held; a manager may still strip
        # a bit they lack from a junior role.
        _check_grantable(updates["permissions"] & ~int(role.get("permissions", 0)), mask)
    if updates:
        await db.community_roles.update_one({"id": role_id}, {"$set": updates})
    return clean({**role, **updates})


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(role_id: str, user: dict = Depends(current_user)):
    role = await _role_or_404(role_id)
    community_id = role["community_id"]
    await _require(community_id, user["id"], permissions.MANAGE_ROLES)
    if role.get("is_default"):
        raise HTTPException(409, "The default role cannot be deleted")
    if role.get("rank", 0) >= await _rank_ceiling(community_id, user["id"]):
        raise HTTPException(403, "Cannot delete a role at or above your own rank")
    await db.community_roles.delete_one({"id": role_id})
    await db.community_members.update_many(
        {"community_id": community_id}, {"$pull": {"role_ids": role_id}}
    )
    await db.channels.update_many(
        {"community_id": community_id}, {"$pull": {"overwrites": {"role_id": role_id}}}
    )


@router.put("/communities/{community_id}/members/{member_id}/roles")
async def assign_member_roles(
    community_id: str,
    member_id: str,
    body: MemberRolesIn,
    user: dict = Depends(current_user),
):
    await _require(community_id, user["id"], permissions.MANAGE_ROLES)
    target = await db.community_members.find_one(
        {"id": member_id, "community_id": community_id}, {"_id": 0}
    )
    if not target:
        raise HTTPException(404, "Member not found")
    # Re-roling someone who outranks you is a demotion you have no standing for.
    await _check_outranks(community_id, user["id"], target)
    ceiling = await _rank_ceiling(community_id, user["id"])
    roles = {role["id"]: role for role in await _roles(community_id)}
    for role_id in body.role_ids:
        role = roles.get(role_id)
        if not role or role["community_id"] != community_id:
            raise HTTPException(404, "Role not found")
        if role.get("rank", 0) >= ceiling:
            raise HTTPException(403, "Cannot assign a role at or above your own rank")
    await db.community_members.update_one(
        {"id": member_id}, {"$set": {"role_ids": body.role_ids}}
    )
    await staff.audit(
        user, "community.roles_assigned", target_type="community_member",
        target_id=member_id, reason=None,
        metadata={"community_id": community_id, "role_ids": body.role_ids},
    )
    return clean({**target, "role_ids": body.role_ids})


@router.put("/channels/{channel_id}/overwrites")
async def set_channel_overwrites(
    channel_id: str,
    body: list[OverwriteIn],
    user: dict = Depends(current_user),
):
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    community_id = channel["community_id"]
    # Overwrites are permissions, so they need MANAGE_ROLES as in Discord, and
    # the same two limits as roles: only for roles below you, only bits you hold.
    await _require(community_id, user["id"], permissions.MANAGE_CHANNEL | permissions.MANAGE_ROLES, channel)
    mask, ceiling = await _grant_limit(community_id, user["id"])
    roles = {role["id"]: role for role in await _roles(community_id)}
    previous = {row.get("role_id"): row for row in channel.get("overwrites") or []}
    overwrites = []
    for entry in body:
        role = roles.get(entry.role_id)
        if not role:
            raise HTTPException(404, "Role not found")
        before = previous.get(entry.role_id) or {}
        if (int(before.get("allow", 0)), int(before.get("deny", 0))) != (entry.allow, entry.deny):
            if role.get("rank", 0) >= ceiling:
                raise HTTPException(403, "Cannot change overwrites for a role at or above your own rank")
            _check_grantable(entry.allow | entry.deny, mask)
        overwrites.append(entry.model_dump())
    for role_id in set(previous) - {entry.role_id for entry in body}:
        if roles.get(role_id, {}).get("rank", 0) >= ceiling:
            raise HTTPException(403, "Cannot remove overwrites for a role at or above your own rank")
    await db.channels.update_one({"id": channel_id}, {"$set": {"overwrites": overwrites}})
    return clean({**channel, "overwrites": overwrites})


@router.get("/communities/{community_id}/channels")
async def list_channels(community_id: str, user: dict = Depends(current_user)):
    community = await _community_or_404(community_id)
    member = await _active_member(community_id, user["id"])
    roles = await _roles(community_id)
    visible = []
    async for channel in db.channels.find(
        {"community_id": community_id, "status": "active"}, {"_id": 0}
    ).sort([("is_default", -1), ("created_at", 1)]):
        mask = permissions.resolve(member, community, channel, roles)
        if not permissions.has(mask, permissions.VIEW_CHANNEL):
            continue  # a denied channel should not even reveal that it exists
        visible.append(clean({**channel, "permissions": mask}))
    # A manager's explicit order wins; channels never placed keep creation
    # order behind them (stable sort), default channel first.
    visible.sort(key=lambda row: row["position"] if row.get("position") is not None else 1_000_000)
    await _attach_unread(visible, member, user["id"])
    return visible


@router.put("/communities/{community_id}/channel-order")
async def reorder_channels(community_id: str, body: ChannelOrderIn, user: dict = Depends(current_user)):
    """Set the sidebar order. Ids not listed keep their place after these."""
    await _manager(community_id, user["id"])
    known = {
        row["id"] async for row in db.channels.find(
            {"community_id": community_id, "status": "active"}, {"_id": 0, "id": 1})
    }
    if set(body.channel_ids) - known:
        raise HTTPException(404, "Channel not found")
    for position, channel_id in enumerate(dict.fromkeys(body.channel_ids)):
        await db.channels.update_one({"id": channel_id}, {"$set": {"position": position}})
    return {"channel_ids": list(dict.fromkeys(body.channel_ids))}


#: Badges read "99+" beyond this; counting further would cost a scan for no gain.
UNREAD_CAP = 100


async def _attach_unread(channels: list[dict], member: dict, user_id: str) -> None:
    """Add `unread_count` to each channel: other people's messages since the
    caller last read it.

    With no read marker, the baseline is when they joined, so a new member does
    not open the app to a thousand-message backlog marked unread. Own messages
    never count. Uses the existing (channel_id, created_at) index.
    """
    ids = [channel["id"] for channel in channels]
    reads = {
        row["channel_id"]: row["last_read_at"]
        async for row in db.channel_reads.find(
            {"user_id": user_id, "channel_id": {"$in": ids}}, {"_id": 0}
        )
    }
    joined = member.get("joined_at")
    for channel in channels:
        query: dict = {"channel_id": channel["id"], "status": "active",
                       "author_id": {"$ne": user_id}}
        since = reads.get(channel["id"]) or joined
        if since:
            query["created_at"] = {"$gt": since}
        channel["unread_count"] = await db.messages.count_documents(query, limit=UNREAD_CAP)


@router.post("/communities/{community_id}/channels", status_code=201)
async def create_channel(
    community_id: str,
    body: ChannelIn,
    user: dict = Depends(current_user),
):
    await _manager(community_id, user["id"])
    fields = body.model_dump()
    fields["category"] = (fields.get("category") or "").strip() or None
    channel = {
        "id": new_id(),
        "community_id": community_id,
        **fields,
        "created_by": user["id"],
        "is_default": False,
        "status": "active",
        "overwrites": [],
        "created_at": now(),
    }
    try:
        await db.channels.insert_one(channel)
    except DuplicateKeyError as exc:
        raise HTTPException(409, "Channel already exists") from exc
    return clean(channel)


@router.get("/channels/{channel_id}")
async def get_channel(channel_id: str, user: dict = Depends(current_user)):
    """One channel plus the caller's effective mask, for the chat screen."""
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    mask, _ = await _mask(channel["community_id"], user["id"], channel)
    if not permissions.has(mask, permissions.VIEW_CHANNEL):
        raise HTTPException(403, "Insufficient community permissions")
    return clean({**channel, "permissions": mask})


@router.patch("/channels/{channel_id}")
async def update_channel(channel_id: str, body: ChannelUpdateIn, user: dict = Depends(current_user)):
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await _require(channel["community_id"], user["id"], permissions.MANAGE_CHANNEL, channel)
    updates = {key: value for key, value in body.model_dump().items() if value is not None}
    if "category" in updates:
        updates["category"] = updates["category"].strip() or None
    if not updates:
        return clean(channel)
    try:
        await db.channels.update_one({"id": channel_id}, {"$set": updates})
    except DuplicateKeyError as exc:
        raise HTTPException(409, "A channel with that name already exists") from exc
    return clean({**channel, **updates})


@router.delete("/channels/{channel_id}", status_code=204)
async def archive_channel(channel_id: str, user: dict = Depends(current_user)):
    """Archive a channel. Messages are kept — this hides the room, not its history."""
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    community_id = channel["community_id"]
    await _require(community_id, user["id"], permissions.MANAGE_CHANNEL, channel)
    if channel.get("is_default"):
        raise HTTPException(409, "The default channel cannot be archived")
    await db.channels.update_one(
        {"id": channel_id}, {"$set": {"status": "archived", "archived_at": now()}}
    )
    await staff.audit(
        user, "community.channel_archived", target_type="channel", target_id=channel_id,
        reason=None, metadata={"community_id": community_id, "name": channel.get("name")},
    )


@router.patch("/channels/{channel_id}/ranking")
async def update_channel_ranking(channel_id: str, body: ChannelRankingIn, user: dict = Depends(current_user)):
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    community = await _community_or_404(channel["community_id"])
    await _manager(channel["community_id"], user["id"])
    if body.ranking_opt_in and not community.get("is_public"):
        raise HTTPException(409, "Private communities cannot publish channel rankings")
    await db.channels.update_one({"id": channel_id}, {"$set": {"ranking_opt_in": body.ranking_opt_in}})
    return {**channel, "ranking_opt_in": body.ranking_opt_in}


@router.get("/channels/{channel_id}/messages")
async def list_messages(
    channel_id: str,
    before: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(current_user),
):
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    query: dict = {"channel_id": channel_id, "status": "active"}
    if before:
        cursor = await db.messages.find_one({"id": before, "channel_id": channel_id}, {"_id": 0})
        if not cursor:
            raise HTTPException(404, "Message cursor not found")
        query["created_at"] = {"$lt": cursor["created_at"]}
    messages = [
        message async for message in db.messages.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    ]
    return await _decorate_messages(list(reversed(messages)), channel["community_id"])


async def _decorate_messages(messages: list[dict], community_id: str) -> list[dict]:
    """Authors, reply quotes, mentions and role badges for a page of messages.

    Batched: a constant number of queries per page, however long the page, where
    it used to be three or four per message.
    """
    parent_ids = list({m["reply_to_id"] for m in messages if m.get("reply_to_id")})
    parents = {
        row["id"]: row async for row in db.messages.find(
            {"id": {"$in": parent_ids}},
            {"_id": 0, "id": 1, "author_id": 1, "content": 1, "status": 1},
        )
    } if parent_ids else {}
    mentioned = {uid for m in messages for uid in notifications.parse_mentions(m.get("content", ""))}
    people_ids = {m["author_id"] for m in messages} | {p["author_id"] for p in parents.values()} | mentioned
    people = await _people(list(people_ids))
    badges = await _role_badges(community_id, [m["author_id"] for m in messages])
    for message in messages:
        message["author"] = people.get(message["author_id"])
        message["author_role"] = badges.get(message["author_id"])
        # Messages written before interactions shipped carry none of these keys.
        message.setdefault("reactions", [])
        message.setdefault("reply_to_id", None)
        message.setdefault("pinned_at", None)
        message.setdefault("edited_at", None)
        message.setdefault("media", [])
        message["mentions"] = [
            people[uid] for uid in notifications.parse_mentions(message.get("content", "")) if uid in people
        ]
        parent = parents.get(message["reply_to_id"]) if message["reply_to_id"] else None
        if parent and parent.get("status") == "active":
            message["reply_to"] = clean({**parent, "author": people.get(parent["author_id"])})
        else:
            message["reply_to"] = None
    return [clean(message) for message in messages]


async def _role_badges(community_id: str, user_ids: list[str]) -> dict[str, dict]:
    """Each author's most senior visible role — the coloured name tag.

    The owner shows as "owner"; the default role is never a badge because
    everyone has it.
    """
    community = await db.communities.find_one({"id": community_id}, {"_id": 0, "owner_id": 1}) or {}
    roles = {role["id"]: role for role in await _roles(community_id) if not role.get("is_default")}
    badges: dict[str, dict] = {}
    async for member in db.community_members.find(
        {"community_id": community_id, "user_id": {"$in": list(set(user_ids))}},
        {"_id": 0, "user_id": 1, "role": 1, "role_ids": 1},
    ):
        if member["user_id"] == community.get("owner_id") or member.get("role") == "owner":
            badges[member["user_id"]] = {"name": "owner", "color": "#F5C542"}
            continue
        held = [roles[rid] for rid in member.get("role_ids") or [] if rid in roles]
        if held:
            top = max(held, key=lambda role: role.get("rank", 0))
            badges[member["user_id"]] = {"name": top["name"], "color": top.get("color")}
        elif member.get("role") == "moderator":
            badges[member["user_id"]] = {"name": "moderator", "color": "#5DA9E1"}
    return badges


def _send_permission(channel: dict) -> int:
    """What writing in this channel takes.

    An announcement channel is broadcast-only: everyone reads, only members who
    can manage messages may post. Expressed as a permission rather than an
    @everyone deny, so legacy moderators — who have no role document to grant
    an exception to — keep working without a migration. SEND_MESSAGE rides
    along so a timeout silences announcers too.
    """
    if channel.get("kind") == "announcement":
        return permissions.MANAGE_MESSAGES | permissions.SEND_MESSAGE
    return permissions.SEND_MESSAGE


@router.post("/channels/{channel_id}/messages", status_code=201)
async def create_message(
    channel_id: str,
    body: MessageIn,
    user: dict = Depends(current_user),
):
    await ratelimit.hit("message", user["id"])
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    needed = _send_permission(channel)
    if body.media_ids:
        needed |= permissions.ATTACH_MEDIA
    await _require(channel["community_id"], user["id"], needed, channel)
    return await _insert_message(
        channel, user, content=body.content, reply_to_id=body.reply_to_id, media_ids=body.media_ids)


async def _insert_message(
    channel: dict,
    user: dict,
    *,
    content: str,
    reply_to_id: str | None = None,
    media_ids: list[str] | None = None,
    extra: dict | None = None,
) -> dict:
    """Everything that happens when a message lands, whatever posted it.

    The caller has already checked the permission to post. This enforces the
    channel's own rules (slow mode, one check-in a day), then writes, publishes,
    notifies mentions and screens — so a shared program or any future message
    type gets the same treatment as a typed one.
    """
    channel_id = channel["id"]
    community_id = channel["community_id"]
    mask, _ = await _mask(community_id, user["id"], channel)

    slowmode = int(channel.get("slowmode_sec") or 0)
    if slowmode and not permissions.has(mask, permissions.MANAGE_MESSAGES):
        recent = await db.messages.find_one(
            {"channel_id": channel_id, "author_id": user["id"], "status": "active",
             "created_at": {"$gt": now() - timedelta(seconds=slowmode)}},
            {"_id": 0, "created_at": 1}, sort=[("created_at", -1)],
        )
        if recent:
            wait = slowmode - int((now() - recent["created_at"]).total_seconds())
            raise HTTPException(429, f"Slow mode is on: wait {max(wait, 1)}s", headers={"Retry-After": str(max(wait, 1))})

    checkin_day = challenges.day_key(now()) if channel.get("kind") == "checkin" else None
    if checkin_day and await db.messages.find_one({
        "channel_id": channel_id, "author_id": user["id"],
        "status": "active", "checkin_day": checkin_day,
    }, {"_id": 1}):
        raise HTTPException(409, "You have already checked in today")

    reply_to = None
    if reply_to_id:
        parent = await db.messages.find_one(
            {"id": reply_to_id, "channel_id": channel_id, "status": "active"},
            {"_id": 0, "id": 1, "author_id": 1, "content": 1},
        )
        if not parent:
            raise HTTPException(404, "Message being replied to was not found")
        reply_to = clean({**parent, "author": (await _people([parent["author_id"]])).get(parent["author_id"])})

    media = []
    if media_ids:
        # Only the uploader's own files — the same ownership rule as posts.
        media = [row async for row in db.media.find(
            {"id": {"$in": media_ids}, "user_id": user["id"]}, {"_id": 0, "id": 1, "kind": 1, "url": 1})]
        if len(media) != len(set(media_ids)):
            raise HTTPException(422, "Unknown media attachment")

    content = (content or "").strip()
    if notifications.mentions_everyone(content) and not permissions.has(
        mask, permissions.MENTION_EVERYONE
    ):
        # Drop the token rather than rejecting the message: the member still gets
        # to say their piece, they just do not get to ring the whole community.
        content = notifications.strip_everyone(content)

    message = {
        "id": new_id(),
        "community_id": community_id,
        "channel_id": channel_id,
        "author_id": user["id"],
        "content": content,
        "reply_to_id": reply_to_id,
        "media": media,
        "reactions": [],
        "pinned_at": None,
        "edited_at": None,
        "status": "active",
        "created_at": now(),
        **(extra or {}),
    }
    if checkin_day:
        message["checkin_day"] = checkin_day
    try:
        await db.messages.insert_one(dict(message))
    except DuplicateKeyError as exc:
        # The find above is the fast path; the unique partial index on
        # (channel_id, author_id, checkin_day) is what actually stops two
        # concurrent check-ins from both landing.
        raise HTTPException(409, "You have already checked in today") from exc
    message["author"] = {key: user.get(key) for key in ("id", "full_name", "avatar_url")}
    message["author_role"] = (await _role_badges(community_id, [user["id"]])).get(user["id"])
    message["reply_to"] = reply_to
    message["mentions"] = await notifications.resolve_mentions(content)
    published = clean(message)
    # After the write commits: a dropped publish costs a nudge, never the message.
    await realtime.publish(
        realtime.chat_channel(channel_id), {"type": "message.created", "message": published}
    )

    # Only people who can see the channel can be pinged from it — a mention
    # must never tell someone about a room that is hidden from them.
    audience = await _channel_audience(channel)
    title = f"{user.get('full_name', 'Someone')} mentioned you"
    metadata = {"community_id": community_id, "channel_id": channel_id, "message_id": message["id"]}
    notified = set(await notifications.notify_mentions(
        content, author=user, kind=notifications.MENTION, title=title, metadata=metadata,
        audience=audience, target_type="message", target_id=message["id"],
    ))
    if notifications.mentions_everyone(content):
        # The token only survives the strip above for members holding
        # MENTION_EVERYONE, so reaching this line is the permission check.
        body = notifications.strip_everyone(content)[:200] or title
        for member_id in audience - notified - {user["id"]}:
            if await notifications.notify(
                member_id, notifications.MENTION, actor=user,
                title=f"{user.get('full_name', 'Someone')} pinged @everyone in #{channel.get('name', 'channel')}",
                body=body, target_type="message", target_id=message["id"], metadata=metadata,
            ):
                notified.add(member_id)
    for mentioned in notified:
        await realtime.publish(
            realtime.user_channel(mentioned),
            {"type": "mention", "message_id": message["id"], "channel_id": channel_id},
        )

    await moderation.screen(
        content, author=user, target_type="message", target_id=message["id"],
        metadata={"community_id": community_id, "channel_id": channel_id},
    )
    return published


async def _channel_audience(channel: dict) -> set[str]:
    """Active members whose effective mask lets them see `channel`."""
    community = await db.communities.find_one({"id": channel["community_id"]}, {"_id": 0}) or {}
    roles = await _roles(channel["community_id"])
    audience = set()
    async for member in db.community_members.find(
        {"community_id": channel["community_id"], "status": "active"}, {"_id": 0},
    ):
        if permissions.has(permissions.resolve(member, community, channel, roles), permissions.VIEW_CHANNEL):
            audience.add(member["user_id"])
    return audience


EDIT_WINDOW_SECONDS = 15 * 60


async def _message_or_404(message_id: str) -> tuple[dict, dict]:
    message = await db.messages.find_one({"id": message_id, "status": "active"}, {"_id": 0})
    if not message:
        raise HTTPException(404, "Message not found")
    channel = await db.channels.find_one(
        {"id": message["channel_id"], "status": "active"}, {"_id": 0}
    )
    if not channel:
        raise HTTPException(404, "Channel not found")
    return message, channel


async def _publish_change(channel_id: str, kind: str, payload: dict) -> None:
    """Broadcast a committed message mutation to everyone watching the channel.

    Only the changed fields travel. A deletion carries the id and nothing else,
    so a removed message's content never reaches a client after removal.
    """
    await realtime.publish(realtime.chat_channel(channel_id), {"type": kind, **payload})


@router.post("/messages/{message_id}/reactions")
async def add_reaction(message_id: str, body: ReactionIn, user: dict = Depends(current_user)):
    await ratelimit.hit("reaction", user["id"])
    message, channel = await _message_or_404(message_id)
    await _require(channel["community_id"], user["id"], permissions.ADD_REACTION, channel)
    # $addToSet keeps a double-tap idempotent under concurrent reactions.
    updated = await db.messages.find_one_and_update(
        {"id": message_id, "reactions.emoji": body.emoji},
        {"$addToSet": {"reactions.$.user_ids": user["id"]}},
        projection={"_id": 0}, return_document=True,
    )
    if not updated:
        # A new pill only while the message has room: without a cap, one member
        # could bury a message under hundreds of distinct "emoji".
        pushed = await db.messages.update_one(
            {"id": message_id, "reactions.emoji": {"$ne": body.emoji},
             f"reactions.{MAX_DISTINCT_REACTIONS - 1}": {"$exists": False}},
            {"$push": {"reactions": {"emoji": body.emoji, "user_ids": [user["id"]]}}},
        )
        if not pushed.matched_count and not await db.messages.find_one(
                {"id": message_id, "reactions.emoji": body.emoji}, {"_id": 1}):
            raise HTTPException(409, "This message has reached its reaction limit")
        updated = await db.messages.find_one({"id": message_id}, {"_id": 0})
    await _publish_change(channel["id"], "message.reactions",
                          {"id": message_id, "reactions": updated.get("reactions", [])})
    return clean(updated)


@router.delete("/messages/{message_id}/reactions")
async def remove_reaction(message_id: str, emoji: str = Query(...), user: dict = Depends(current_user)):
    message, channel = await _message_or_404(message_id)
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    await db.messages.update_one(
        {"id": message_id, "reactions.emoji": emoji},
        {"$pull": {"reactions.$.user_ids": user["id"]}},
    )
    # Drop the pill once the last reactor leaves, so empty emoji do not linger.
    await db.messages.update_one(
        {"id": message_id}, {"$pull": {"reactions": {"user_ids": {"$size": 0}}}}
    )
    updated = await db.messages.find_one({"id": message_id}, {"_id": 0})
    await _publish_change(channel["id"], "message.reactions",
                          {"id": message_id, "reactions": updated.get("reactions", [])})
    return clean(updated)


@router.patch("/messages/{message_id}")
async def edit_message(message_id: str, body: MessageEditIn, user: dict = Depends(current_user)):
    message, channel = await _message_or_404(message_id)
    if message["author_id"] != user["id"]:
        raise HTTPException(403, "Only the author can edit a message")
    # Editing is posting: the same permission as writing it in the first place,
    # so a member who lost the right to speak cannot keep rewriting old words.
    await _require(channel["community_id"], user["id"], _send_permission(channel), channel)
    if (now() - message["created_at"]).total_seconds() > EDIT_WINDOW_SECONDS:
        raise HTTPException(409, "The edit window for this message has closed")
    content = body.content.strip()
    mask, _ = await _mask(channel["community_id"], user["id"], channel)
    if notifications.mentions_everyone(content) and not permissions.has(mask, permissions.MENTION_EVERYONE):
        content = notifications.strip_everyone(content)
    updates = {"content": content, "edited_at": now()}
    await db.messages.update_one({"id": message_id}, {"$set": updates})
    # Screened again: otherwise a message could pass as harmless and be
    # rewritten into something else afterwards.
    await moderation.screen(
        content, author=user, target_type="message", target_id=message_id,
        metadata={"community_id": channel["community_id"], "channel_id": channel["id"], "edited": True},
    )
    mentions = await notifications.resolve_mentions(updates["content"])
    await _publish_change(channel["id"], "message.updated",
                          {"id": message_id, "content": updates["content"],
                           "edited_at": updates["edited_at"].isoformat(), "mentions": mentions})
    return clean({**message, **updates, "mentions": mentions})


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(message_id: str, user: dict = Depends(current_user)):
    message, channel = await _message_or_404(message_id)
    community_id = channel["community_id"]
    if message["author_id"] != user["id"]:
        await _require(community_id, user["id"], permissions.MANAGE_MESSAGES, channel)
        await staff.audit(
            user, "community.message_deleted", target_type="message",
            target_id=message_id, reason=None,
            metadata={"community_id": community_id, "author_id": message["author_id"]},
        )
    else:
        await _require(community_id, user["id"], permissions.VIEW_CHANNEL, channel)
    # Soft delete: the row survives for moderation review and the audit trail.
    await db.messages.update_one(
        {"id": message_id}, {"$set": {"status": "deleted", "deleted_at": now()}}
    )
    await _publish_change(channel["id"], "message.deleted", {"id": message_id})


@router.post("/messages/{message_id}/pin")
async def pin_message(message_id: str, user: dict = Depends(current_user)):
    message, channel = await _message_or_404(message_id)
    await _require(channel["community_id"], user["id"], permissions.PIN_MESSAGE, channel)
    updates = {"pinned_at": now(), "pinned_by": user["id"]}
    await db.messages.update_one({"id": message_id}, {"$set": updates})
    await _publish_change(channel["id"], "message.pinned",
                          {"id": message_id, "pinned_at": updates["pinned_at"].isoformat()})
    return clean({**message, **updates})


@router.delete("/messages/{message_id}/pin", status_code=204)
async def unpin_message(message_id: str, user: dict = Depends(current_user)):
    message, channel = await _message_or_404(message_id)
    await _require(channel["community_id"], user["id"], permissions.PIN_MESSAGE, channel)
    await db.messages.update_one(
        {"id": message_id}, {"$set": {"pinned_at": None, "pinned_by": None}}
    )
    await _publish_change(channel["id"], "message.pinned", {"id": message_id, "pinned_at": None})


@router.get("/channels/{channel_id}/pins")
async def list_pins(channel_id: str, user: dict = Depends(current_user)):
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    pins = [
        message
        async for message in db.messages.find(
            {"channel_id": channel_id, "status": "active", "pinned_at": {"$ne": None}},
            {"_id": 0},
        ).sort("pinned_at", -1).limit(50)
    ]
    return await _decorate_messages(pins, channel["community_id"])


@router.get("/channels/{channel_id}/search")
async def search_channel(
    channel_id: str,
    q: str = Query(..., min_length=2, max_length=80),
    user: dict = Depends(current_user),
):
    """Messages in one channel containing `q`, newest first.

    Escaped and capped like the global search: a member's query is data, never
    a pattern, and the same VIEW_CHANNEL rule as reading the channel applies.
    """
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    rows = [
        row async for row in db.messages.find(
            {"channel_id": channel_id, "status": "active",
             "content": {"$regex": re.escape(q.strip()), "$options": "i"}},
            {"_id": 0},
        ).sort("created_at", -1).limit(30)
    ]
    return await _decorate_messages(rows, channel["community_id"])


@router.post("/channels/{channel_id}/typing", status_code=204)
async def channel_typing(channel_id: str, user: dict = Depends(current_user)):
    """A "typing…" nudge for everyone watching the channel. Nothing is stored."""
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await _require(channel["community_id"], user["id"], _send_permission(channel), channel)
    await realtime.publish(realtime.chat_channel(channel_id), {
        "type": "typing", "user": {"id": user["id"], "full_name": user.get("full_name")}})


@router.get("/realtime/subscription-token")
async def realtime_subscription_token(channel: str = Query(..., max_length=100), user: dict = Depends(current_user)):
    """A Centrifugo subscription token for one chat channel or live room.

    The same VIEW_CHANNEL check as reading over HTTP, so a hidden channel stays
    hidden on the socket too. Subscribable rooms are `channel:{id}` and
    `live:{session_id}`. A member's own `user:{id}` channel comes with the
    connection token and is not requested here.
    """
    live_prefix = realtime.live_channel("")
    if channel.startswith(live_prefix):
        session_id = channel[len(live_prefix):]
        if not session_id:
            raise HTTPException(422, "Missing live session id")
        _session, row = await _live_session_or_404(session_id)
        await _require(row["community_id"], user["id"], permissions.VIEW_CHANNEL, row)
        if not realtime.is_configured():
            return {"enabled": False, "token": None}
        return {"enabled": True, "token": realtime.subscription_token(user["id"], channel)}
    prefix = realtime.chat_channel("")
    if not channel.startswith(prefix):
        raise HTTPException(422, "Only chat channels and live rooms take a subscription token")
    row = await db.channels.find_one({"id": channel[len(prefix):], "status": "active"}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Channel not found")
    await _require(row["community_id"], user["id"], permissions.VIEW_CHANNEL, row)
    if not realtime.is_configured():
        return {"enabled": False, "token": None}
    return {"enabled": True, "token": realtime.subscription_token(user["id"], channel)}


class ReadIn(BaseModel):
    message_id: str


class InviteIn(BaseModel):
    max_uses: int | None = Field(default=None, ge=1, le=1000)
    expires_in_hours: int | None = Field(default=168, ge=1, le=24 * 30)
    #: Admit straight to active membership, skipping approval. Manager-only.
    skip_approval: bool = False


@router.post("/channels/{channel_id}/read")
async def mark_channel_read(channel_id: str, body: ReadIn, user: dict = Depends(current_user)):
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    message = await db.messages.find_one(
        {"id": body.message_id, "channel_id": channel_id}, {"_id": 0, "created_at": 1})
    if not message:
        raise HTTPException(404, "Message not found")
    # $max: the marker only moves forward, so reading an old message on a
    # second device can never resurrect messages already seen.
    await db.channel_reads.update_one(
        {"channel_id": channel_id, "user_id": user["id"]},
        {"$max": {"last_read_at": message["created_at"]},
         "$setOnInsert": {"id": new_id()}},
        upsert=True,
    )
    row = await db.channel_reads.find_one(
        {"channel_id": channel_id, "user_id": user["id"]}, {"_id": 0})
    return {"channel_id": channel_id, "last_read_at": row["last_read_at"]}


@router.get("/communities/{community_id}/directory")
async def member_directory(
    community_id: str,
    user: dict = Depends(current_user),
    q: Annotated[str | None, Query(max_length=80)] = None,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
):
    """Active members' public fields, for any active member, by name.

    Distinct from `/members`, which is manager-only because it exposes pending
    requests and statuses. Without this, @-mention suggestions were silently
    empty for everyone who was not a manager. Paged and searchable, so a
    community of any size answers "@da…" with the right Dave, not the first
    thousand names.
    """
    await _community_or_404(community_id)
    await _active_member(community_id, user["id"])
    pipeline: list[dict] = [
        {"$match": {"community_id": community_id, "status": "active"}},
        {"$lookup": {"from": "users", "localField": "user_id", "foreignField": "id", "as": "person"}},
        {"$unwind": "$person"},
    ]
    if q and q.strip():
        pipeline.append({"$match": {"person.full_name": {"$regex": re.escape(q.strip()), "$options": "i"}}})
    pipeline += [
        {"$sort": {"person.full_name": 1}}, {"$skip": offset}, {"$limit": limit},
        {"$project": {"_id": 0, "id": "$person.id", "full_name": "$person.full_name", "avatar_url": "$person.avatar_url"}},
    ]
    return [clean(row) async for row in db.community_members.aggregate(pipeline)]


def _invite_state(invite: dict) -> str | None:
    """Why an invite cannot be used, or None when it can."""
    if invite.get("revoked_at"):
        return "revoked"
    expires = invite.get("expires_at")
    if expires and expires <= now():
        return "expired"
    max_uses = invite.get("max_uses")
    if max_uses is not None and invite.get("uses", 0) >= max_uses:
        return "exhausted"
    return None


def _invite_view(invite: dict) -> dict:
    view = clean(dict(invite)) or {}
    view["unusable_reason"] = _invite_state(invite)
    return view


@router.post("/communities/{community_id}/invites", status_code=201)
async def create_invite(community_id: str, body: InviteIn, user: dict = Depends(current_user)):
    await ratelimit.hit("invite_create", user["id"])
    # INVITE_MEMBER is a default-member bit, so a plain invite may only grant
    # what a normal join would. Skipping approval is a manager's decision.
    needed = permissions.MANAGE_CHANNEL if body.skip_approval else permissions.INVITE_MEMBER
    await _require(community_id, user["id"], needed)
    timestamp = now()
    invite = {
        "id": new_id(),
        "code": secrets.token_urlsafe(9),
        "community_id": community_id,
        "created_by": user["id"],
        "max_uses": body.max_uses,
        "uses": 0,
        "expires_at": (timestamp + timedelta(hours=body.expires_in_hours)) if body.expires_in_hours else None,
        "skip_approval": body.skip_approval,
        "revoked_at": None,
        "created_at": timestamp,
    }
    await db.community_invites.insert_one(dict(invite))
    return _invite_view(invite)


@router.get("/communities/{community_id}/invites")
async def list_invites(community_id: str, user: dict = Depends(current_user)):
    await _manager(community_id, user["id"])
    return [
        _invite_view(row)
        async for row in db.community_invites.find(
            {"community_id": community_id, "revoked_at": None}, {"_id": 0}
        ).sort("created_at", -1).limit(100)
    ]


@router.delete("/invites/{code}", status_code=204)
async def revoke_invite(code: str, user: dict = Depends(current_user)):
    invite = await db.community_invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite["created_by"] != user["id"]:
        await _manager(invite["community_id"], user["id"])
    await db.community_invites.update_one({"code": code}, {"$set": {"revoked_at": now()}})


@router.get("/invites/{code}")
async def preview_invite(code: str, user: dict | None = Depends(optional_user)):
    """What the link leads to. Readable before joining, including for a
    private community, since holding the link is the point of an invite."""
    invite = await db.community_invites.find_one({"code": code}, {"_id": 0})
    community = await db.communities.find_one(
        {"id": invite["community_id"]}, {"_id": 0}) if invite else None
    if not invite or not community or community.get("status", "active") != "active":
        raise HTTPException(404, "Invite not found")
    reason = _invite_state(invite)
    if reason and not community.get("is_public", True):
        # A dead link to a private community must not keep describing it.
        return {"code": code, "unusable_reason": reason, "skip_approval": False,
                "membership_status": None, "community": None}
    member_count = await db.community_members.count_documents(
        {"community_id": community["id"], "status": "active"})
    membership = await _membership(community["id"], user["id"]) if user else None
    return {
        "code": code,
        "unusable_reason": reason,
        "skip_approval": invite.get("skip_approval", False),
        "membership_status": (membership or {}).get("status"),
        "community": {
            "id": community["id"], "name": community["name"],
            "description": community.get("description", ""),
            "join_policy": community.get("join_policy", "open"),
            "is_public": community.get("is_public", True),
            "member_count": member_count,
        },
    }


@router.post("/invites/{code}/redeem")
async def redeem_invite(code: str, user: dict = Depends(current_user)):
    await ratelimit.hit("invite_redeem", user["id"])
    invite = await db.community_invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    reason = _invite_state(invite)
    if reason:
        raise HTTPException(410, f"This invite is {reason}")
    community = await _community_or_404(invite["community_id"])

    # Claim a use atomically *before* joining, so two people racing for the
    # last seat cannot both get in; refund it if the join changes nothing.
    claim: dict = {"code": code, "revoked_at": None}
    if invite.get("max_uses") is not None:
        claim["uses"] = {"$lt": invite["max_uses"]}
    claimed = await db.community_invites.find_one_and_update(claim, {"$inc": {"uses": 1}})
    if not claimed:
        raise HTTPException(410, "This invite is exhausted")
    try:
        membership, changed = await _activate(
            community, user, bypass_approval=invite.get("skip_approval", False), source="invite")
    except HTTPException:
        await db.community_invites.update_one({"code": code}, {"$inc": {"uses": -1}})
        raise
    if not changed:
        await db.community_invites.update_one({"code": code}, {"$inc": {"uses": -1}})
    return membership


async def _kind_channel_or_404(channel_id: str, kind: str) -> dict:
    channel = await db.channels.find_one({"id": channel_id, "status": "active"}, {"_id": 0})
    if not channel or channel.get("kind") != kind:
        raise HTTPException(404, f"No {kind} channel with that id")
    return channel


async def _people(ids: list[str]) -> dict[str, dict]:
    return {
        row["id"]: clean(row)
        async for row in db.users.find(
            {"id": {"$in": ids}}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1})
    }


@router.get("/channels/{channel_id}/checkins")
async def checkin_board(channel_id: str, user: dict = Depends(current_user)):
    """Your streak, and who is on a live streak in this check-in channel.

    One rest day never breaks a streak; two in a row do — see challenges.py for
    why a training streak must not punish rest.
    """
    channel = await _kind_channel_or_404(channel_id, "checkin")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    today = now().date()
    by_author: dict[str, set[str]] = {}
    async for row in db.messages.find(
        {"channel_id": channel_id, "status": "active", "checkin_day": {"$exists": True}},
        {"_id": 0, "author_id": 1, "checkin_day": 1},
    ):
        by_author.setdefault(row["author_id"], set()).add(row["checkin_day"])

    hidden = set(await social_graph.blocked_ids(user["id"]))
    leaders = [
        {"user_id": author, **challenges.streaks(days, today)}
        for author, days in by_author.items() if author not in hidden
    ]
    leaders = sorted((row for row in leaders if row["current"] > 0),
                     key=lambda row: (-row["current"], -row["longest"], row["user_id"]))[:20]
    people = await _people([row["user_id"] for row in leaders])
    for row in leaders:
        row["user"] = people.get(row["user_id"])
    return {
        "channel_id": channel_id,
        "today": today.isoformat(),
        "me": challenges.streaks(by_author.get(user["id"], set()), today),
        "leaders": leaders,
    }


@router.post("/channels/{channel_id}/challenge/participants", status_code=201)
async def join_challenge(channel_id: str, user: dict = Depends(current_user)):
    """Opt in. Joining is the consent to have your training counted here."""
    channel = await _kind_channel_or_404(channel_id, "challenge")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    config = channel["challenge"]
    if challenges.challenge_status(config["starts_at"], config["ends_at"], now()) == "ended":
        raise HTTPException(409, "This challenge has ended")
    # Upsert keeps a double tap idempotent even where the unique index is absent.
    await db.challenge_participants.update_one(
        {"channel_id": channel_id, "user_id": user["id"]},
        {"$setOnInsert": {"id": new_id(), "joined_at": now()}},
        upsert=True,
    )
    return {"channel_id": channel_id, "joined": True}


@router.delete("/channels/{channel_id}/challenge/participants", status_code=204)
async def leave_challenge(channel_id: str, user: dict = Depends(current_user)):
    """Leaving withdraws consent: you disappear from the board immediately."""
    channel = await _kind_channel_or_404(channel_id, "challenge")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    await db.challenge_participants.delete_one({"channel_id": channel_id, "user_id": user["id"]})


@router.get("/channels/{channel_id}/challenge")
async def challenge_board(channel_id: str, user: dict = Depends(current_user)):
    """The scoreboard. Only participants are scored, only from finished
    workouts inside the window, and only training aggregates are used —
    never biomarkers, lab results or wearable health data."""
    channel = await _kind_channel_or_404(channel_id, "challenge")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    config = channel["challenge"]
    starts, ends, metric = config["starts_at"], config["ends_at"], config["metric"]
    moment = now()
    participants = [
        row["user_id"]
        async for row in db.challenge_participants.find(
            {"channel_id": channel_id}, {"_id": 0, "user_id": 1}).limit(1000)
    ]

    workouts: dict[str, list[dict]] = {person: [] for person in participants}
    if participants and moment >= starts:
        async for row in db.workouts.find(
            {"user_id": {"$in": participants}, "ended_at": {"$gte": starts, "$lt": min(ends, moment)}},
            {"_id": 0, "id": 1, "user_id": 1, "ended_at": 1, "duration_sec": 1},
        ):
            workouts[row["user_id"]].append(row)

    tonnage: dict[str, float] = {}
    if metric == "tonnage":
        ids = [w["id"] for rows in workouts.values() for w in rows]
        async for row in db.workout_sets.find(
            {"workout_id": {"$in": ids}}, {"_id": 0, "workout_id": 1, "weight_kg": 1, "reps": 1}
        ):
            tonnage[row["workout_id"]] = tonnage.get(row["workout_id"], 0.0) + \
                float(row.get("weight_kg") or 0) * int(row.get("reps") or 0)

    scores = {person: challenges.score_workouts(metric, rows, tonnage) for person, rows in workouts.items()}
    ranked = challenges.rank(scores)
    hidden = set(await social_graph.blocked_ids(user["id"]))
    shown = [(place, person, score) for place, person, score in ranked if person not in hidden][:50]
    people = await _people([person for _, person, _ in shown])
    mine = next(({"place": place, "score": score} for place, person, score in ranked
                 if person == user["id"]), None)
    total = round(sum(scores.values()), 1)
    goal = config.get("goal")
    return {
        "channel_id": channel_id,
        "challenge": {"metric": metric, "starts_at": starts, "ends_at": ends, "goal": goal},
        "status": challenges.challenge_status(starts, ends, moment),
        "participant_count": len(participants),
        "joined": user["id"] in participants,
        "me": mine,
        "leaders": [{"place": place, "user_id": person, "score": score, "user": people.get(person)}
                    for place, person, score in shown],
        "group_total": total,
        "goal_progress": round(min(1.0, total / goal), 4) if goal else None,
    }


# --------------------------------------------------------------------------- #
# Program channels — a coach shares a training block; members adopt it         #
# --------------------------------------------------------------------------- #
class ProgramShareIn(BaseModel):
    program_id: str
    note: str = Field(default="", max_length=1000)


def _program_snapshot(program: dict) -> dict:
    """What travels into the channel: the plan, never the person.

    A generated program document also stores the author's recovery snapshot
    (HRV, sleep) and the biomarkers that shaped it. None of that leaves here —
    the health-data firewall holds inside communities too.
    """
    params = program.get("params") or {}
    weeks = (program.get("program") or {}).get("weeks") or []
    return {
        "program_id": program["id"],
        "goal": params.get("goal"),
        "level": params.get("level"),
        "days_per_week": params.get("days_per_week"),
        "weeks_count": len(weeks),
        "equipment": params.get("equipment") or [],
        "weeks": weeks,
    }


@router.post("/channels/{channel_id}/programs", status_code=201)
async def share_program(channel_id: str, body: ProgramShareIn, user: dict = Depends(current_user)):
    await ratelimit.hit("message", user["id"])
    channel = await _kind_channel_or_404(channel_id, "program")
    await _require(channel["community_id"], user["id"], permissions.POST_PROGRAM, channel)
    program = await db.programs.find_one({"id": body.program_id, "user_id": user["id"]}, {"_id": 0})
    if not program:
        raise HTTPException(404, "Program not found")  # your own programs only
    return await _insert_message(
        channel, user, content=body.note, extra={"program": _program_snapshot(program)})


@router.get("/channels/{channel_id}/programs")
async def list_shared_programs(channel_id: str, user: dict = Depends(current_user)):
    """The channel's program library, newest first, with adoption counts."""
    channel = await _kind_channel_or_404(channel_id, "program")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    rows = [
        row async for row in db.messages.find(
            {"channel_id": channel_id, "status": "active", "program": {"$ne": None}}, {"_id": 0}
        ).sort("created_at", -1).limit(50)
    ]
    ids = [row["id"] for row in rows]
    counts = {
        row["_id"]: row["n"] async for row in db.program_adoptions.aggregate([
            {"$match": {"message_id": {"$in": ids}}}, {"$group": {"_id": "$message_id", "n": {"$sum": 1}}},
        ])
    }
    mine = {
        row["message_id"] async for row in db.program_adoptions.find(
            {"message_id": {"$in": ids}, "user_id": user["id"]}, {"_id": 0, "message_id": 1})
    }
    decorated = await _decorate_messages(rows, channel["community_id"])
    for row in decorated:
        row["adoption_count"] = counts.get(row["id"], 0)
        row["adopted_by_me"] = row["id"] in mine
    return decorated


@router.post("/messages/{message_id}/adopt-program", status_code=201)
async def adopt_program(message_id: str, user: dict = Depends(current_user)):
    """Copy a shared program into the caller's own plan and make it active.

    Mirrors what generating a program does — the previous active program is
    archived, not deleted — so the rest of the app (today's session, the
    recovery-gated adjust) works on it unchanged.
    """
    message, channel = await _message_or_404(message_id)
    snapshot = message.get("program")
    if not snapshot:
        raise HTTPException(404, "This message has no program")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    try:
        await db.program_adoptions.insert_one({
            "id": new_id(), "message_id": message_id, "user_id": user["id"],
            "channel_id": channel["id"], "created_at": now(),
        })
    except DuplicateKeyError as exc:
        raise HTTPException(409, "You already use this program") from exc
    await db.programs.update_many({"user_id": user["id"], "status": "active"}, {"$set": {"status": "archived"}})
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "status": "active",
        "params": {
            "goal": snapshot.get("goal"), "level": snapshot.get("level"),
            "days_per_week": snapshot.get("days_per_week"),
            "equipment": snapshot.get("equipment") or [], "weeks_count": snapshot.get("weeks_count"),
        },
        "recovery_snapshot": None,
        "program": {"weeks": snapshot.get("weeks") or []},
        "model": "shared",
        "source": {"message_id": message_id, "channel_id": channel["id"],
                   "community_id": channel["community_id"], "coach_id": message["author_id"]},
        "adjustments": [],
        "created_at": now(),
    }
    await db.programs.insert_one(dict(doc))
    await notifications.notify(
        message["author_id"], notifications.PROGRAM_ADOPTED, actor=user,
        title=f"{user.get('full_name') or 'Someone'} started your program",
        target_type="message", target_id=message_id,
        metadata={"channel_id": channel["id"], "community_id": channel["community_id"]},
    )
    return clean(doc)


# --------------------------------------------------------------------------- #
# Live channels — scheduled sessions, RSVPs, and an in-app room                #
# --------------------------------------------------------------------------- #
class LiveSessionIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=1000)
    starts_at: datetime
    duration_min: int = Field(default=60, ge=10, le=480)
    #: Optional external room (Zoom, Meet, YouTube). The in-app room is
    #: presence and chat on Centrifugo `live:{session_id}`; the app does not
    #: stream video itself.
    join_url: str | None = Field(default=None, max_length=500)

    @field_validator("join_url")
    @classmethod
    def https_only(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not re.match(r"^https://[^\s/$.?#][^\s]*$", value):
            raise ValueError("The join link must be an https:// URL")
        return value

    @field_validator("starts_at")
    @classmethod
    def sensible_start(cls, value: datetime) -> datetime:
        value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        current = datetime.now(timezone.utc)
        if value < current - timedelta(minutes=5):
            raise ValueError("A session cannot start in the past")
        if value > current + timedelta(days=90):
            raise ValueError("Schedule at most 90 days ahead")
        return value


class LiveChatIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Say something")
        return value


LIVE_OPEN = ("scheduled", "live")


def _live_channel_name(session: dict) -> str:
    return session.get("realtime_channel") or realtime.live_channel(session["id"])


def _refuse_unless_live(session: dict) -> None:
    if session["status"] == "live":
        return
    if session["status"] in ("ended", "cancelled"):
        raise HTTPException(409, "This session has ended")
    raise HTTPException(409, "This session has not started")


async def _live_session_or_404(session_id: str) -> tuple[dict, dict]:
    session = await db.live_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    channel = await _kind_channel_or_404(session["channel_id"], "live")
    return session, channel


async def _live_view(sessions: list[dict], viewer_id: str) -> list[dict]:
    ids = [row["id"] for row in sessions]
    counts = {
        row["_id"]: row["n"] async for row in db.live_rsvps.aggregate([
            {"$match": {"session_id": {"$in": ids}}}, {"$group": {"_id": "$session_id", "n": {"$sum": 1}}},
        ])
    }
    mine = {
        row["session_id"] async for row in db.live_rsvps.find(
            {"session_id": {"$in": ids}, "user_id": viewer_id}, {"_id": 0, "session_id": 1})
    }
    hosts = await _people(list({row["host_id"] for row in sessions}))
    return [clean({**row, "host": hosts.get(row["host_id"]), "rsvp_count": counts.get(row["id"], 0),
                   "rsvped": row["id"] in mine}) for row in sessions]


async def _live_participants(session_id: str) -> list[dict]:
    rows = [
        row async for row in db.live_participants.find(
            {"session_id": session_id}, {"_id": 0}
        ).sort("joined_at", 1)
    ]
    people = await _people([row["user_id"] for row in rows])
    return [
        {"user_id": row["user_id"], "joined_at": row["joined_at"], "user": people.get(row["user_id"])}
        for row in rows
    ]


def _subscription_token(user_id: str, channel: str) -> str | None:
    """Mint a join token when Centrifugo is configured. None is a valid answer."""
    if not realtime.is_configured():
        return None
    try:
        return realtime.subscription_token(user_id, channel)
    except RuntimeError:
        logger.warning("Live room token skipped: realtime secret is not configured")
        return None


async def _live_room(session: dict, viewer_id: str) -> dict:
    channel_name = _live_channel_name(session)
    participants = await _live_participants(session["id"])
    view = (await _live_view([session], viewer_id))[0]
    view["realtime_channel"] = channel_name
    return {
        "session": view,
        "participants": participants,
        "realtime_channel": channel_name,
        "subscription_token": _subscription_token(viewer_id, channel_name),
        "joined": any(row["user_id"] == viewer_id for row in participants),
    }


async def _emit_live(
    name: Literal["live_session_started", "live_session_joined", "live_session_ended"],
    session: dict,
    user: dict,
) -> None:
    """One live lifecycle row on analytics_events. Nothing is written to insight_events.

    `props.session_id` is the live room. The analytics envelope `session_id`
    stays empty here: that field is the client analytics session, not the room.
    Titles are omitted. A failure is logged and swallowed so start, join, and
    end still succeed.
    """
    props = {"session_id": session["id"]}
    if name != "live_session_joined":
        props["channel_id"] = session["channel_id"]
    try:
        await analytics.record(
            name=name,
            actor_id=user["id"],
            source="server",
            role=analytics.product_role(user),
            props=props,
        )
    except Exception as exc:  # noqa: BLE001 - analytics must not fail the session
        logger.warning("analytics event %s for live session %s was not stored: %s", name, session.get("id"), exc)


def _live_notice(session: dict) -> dict:
    return {"channel_id": session["channel_id"], "session_id": session["id"]}


async def _tell_rsvps(session: dict, actor: dict, title: str) -> None:
    """RSVP-only notices (cancel). Going live uses `_tell_channel` instead."""
    async for row in db.live_rsvps.find({"session_id": session["id"]}, {"_id": 0, "user_id": 1}):
        await notifications.notify(
            row["user_id"], notifications.LIVE_SESSION, actor=actor, title=title,
            body=session["title"], target_type="channel", target_id=session["channel_id"],
            metadata=_live_notice(session),
        )


async def _tell_channel(session: dict, channel: dict, actor: dict, title: str) -> None:
    """Tell every member who can see the channel that a session is live.

    `notifications.notify` still skips the host, blocked pairs, and anyone who
    switched off the `live_session` preference.
    """
    for user_id in await _channel_audience(channel):
        await notifications.notify(
            user_id, notifications.LIVE_SESSION, actor=actor, title=title,
            body=session["title"], target_type="channel", target_id=session["channel_id"],
            metadata=_live_notice(session),
        )


async def _with_place_names(sessions: list[dict], viewer_id: str) -> list[dict]:
    if not sessions:
        return []
    views = await _live_view(sessions, viewer_id)
    channel_ids = list({row["channel_id"] for row in views})
    community_ids = list({row["community_id"] for row in views})
    channels = {
        row["id"]: row.get("name") or ""
        async for row in db.channels.find({"id": {"$in": channel_ids}}, {"_id": 0, "id": 1, "name": 1})
    }
    communities = {
        row["id"]: row.get("name") or ""
        async for row in db.communities.find({"id": {"$in": community_ids}}, {"_id": 0, "id": 1, "name": 1})
    }
    for view in views:
        view["channel_name"] = channels.get(view["channel_id"]) or ""
        view["community_name"] = communities.get(view["community_id"]) or ""
    return views


@router.get("/live-now")
async def list_live_now(user: dict = Depends(current_user)):
    """Sessions that are live and that this member can join.

    Active membership is not enough: a channel overwrite can hide the room,
    and those sessions stay off Home and Community.
    """
    community_ids = list({
        row["community_id"]
        async for row in db.community_members.find(
            {"user_id": user["id"], "status": "active"},
            {"_id": 0, "community_id": 1},
        )
    })
    if not community_ids:
        return []
    sessions = [
        row async for row in db.live_sessions.find(
            {"status": "live", "community_id": {"$in": community_ids}},
            {"_id": 0},
        ).sort("started_at", -1).limit(30)
    ]
    if not sessions:
        return []
    channels = {
        row["id"]: row
        async for row in db.channels.find(
            {"id": {"$in": list({row["channel_id"] for row in sessions})}, "status": "active", "kind": "live"},
            {"_id": 0},
        )
    }
    roles_cache: dict[str, list] = {}
    community_cache: dict[str, dict] = {}
    member_cache: dict[str, dict] = {}
    visible: list[dict] = []
    for session in sessions:
        channel = channels.get(session["channel_id"])
        if not channel:
            continue
        community_id = session["community_id"]
        if community_id not in member_cache:
            member_cache[community_id] = await _membership(community_id, user["id"]) or {}
            community_cache[community_id] = await db.communities.find_one({"id": community_id}, {"_id": 0}) or {}
            roles_cache[community_id] = await _roles(community_id)
        member = member_cache[community_id]
        if member.get("status") != "active":
            continue
        mask = permissions.resolve(member, community_cache[community_id], channel, roles_cache[community_id])
        if permissions.has(mask, permissions.VIEW_CHANNEL):
            visible.append(session)
    return await _with_place_names(visible, user["id"])


@router.post("/channels/{channel_id}/live-sessions", status_code=201)
async def schedule_live_session(channel_id: str, body: LiveSessionIn, user: dict = Depends(current_user)):
    channel = await _kind_channel_or_404(channel_id, "live")
    await _require(channel["community_id"], user["id"], permissions.START_LIVE_SESSION, channel)
    session_id = new_id()
    session = {
        "id": session_id, "channel_id": channel_id, "community_id": channel["community_id"],
        "host_id": user["id"], **body.model_dump(), "status": "scheduled",
        "started_at": None, "ended_at": None, "created_at": now(),
        "realtime_channel": realtime.live_channel(session_id),
    }
    await db.live_sessions.insert_one(dict(session))
    # The announcement lands in the channel like any message, so it is seen,
    # can be reacted to, and shows up in unread counts.
    await _insert_message(channel, user, content=body.title, extra={"live_session_id": session["id"]})
    return (await _live_view([session], user["id"]))[0]


@router.get("/channels/{channel_id}/live-sessions")
async def list_live_sessions(channel_id: str, user: dict = Depends(current_user)):
    """Live and upcoming sessions first, then the five most recent past ones."""
    channel = await _kind_channel_or_404(channel_id, "live")
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    upcoming = [row async for row in db.live_sessions.find(
        {"channel_id": channel_id, "status": {"$in": list(LIVE_OPEN)}}, {"_id": 0}).sort("starts_at", 1).limit(50)]
    past = [row async for row in db.live_sessions.find(
        {"channel_id": channel_id, "status": {"$in": ["ended", "cancelled"]}}, {"_id": 0}).sort("starts_at", -1).limit(5)]
    return {"upcoming": await _live_view(upcoming, user["id"]), "past": await _live_view(past, user["id"])}


@router.post("/live-sessions/{session_id}/rsvp", status_code=201)
async def rsvp_live_session(session_id: str, user: dict = Depends(current_user)):
    session, channel = await _live_session_or_404(session_id)
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    if session["status"] not in LIVE_OPEN:
        raise HTTPException(409, "This session is over")
    try:
        await db.live_rsvps.insert_one({"id": new_id(), "session_id": session_id, "user_id": user["id"], "created_at": now()})
    except DuplicateKeyError:
        pass  # already going: idempotent
    return (await _live_view([session], user["id"]))[0]


@router.delete("/live-sessions/{session_id}/rsvp")
async def cancel_rsvp(session_id: str, user: dict = Depends(current_user)):
    session, channel = await _live_session_or_404(session_id)
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    await db.live_rsvps.delete_one({"session_id": session_id, "user_id": user["id"]})
    return (await _live_view([session], user["id"]))[0]


async def _host_or_manager(session: dict, channel: dict, user: dict) -> None:
    if session["host_id"] == user["id"]:
        await _require(channel["community_id"], user["id"], permissions.START_LIVE_SESSION, channel)
    else:
        await _require(channel["community_id"], user["id"],
                       permissions.START_LIVE_SESSION | permissions.MANAGE_CHANNEL, channel)


@router.post("/live-sessions/{session_id}/start")
async def start_live_session(session_id: str, user: dict = Depends(current_user)):
    session, channel = await _live_session_or_404(session_id)
    await _host_or_manager(session, channel, user)
    if session["status"] != "scheduled":
        raise HTTPException(409, f"This session is {session['status']}")
    updated = await db.live_sessions.find_one_and_update(
        {"id": session_id, "status": "scheduled"},
        {"$set": {"status": "live", "started_at": now()}}, projection={"_id": 0}, return_document=True)
    if not updated:
        raise HTTPException(409, "This session already started")
    await _tell_channel(updated, channel, user, f"{updated['title']} is live now")
    await _emit_live("live_session_started", updated, user)
    payload = {"type": "live.started", "session_id": session_id}
    await realtime.publish(realtime.chat_channel(channel["id"]), payload)
    await realtime.publish(_live_channel_name(updated), payload)
    return (await _live_view([updated], user["id"]))[0]


@router.post("/live-sessions/{session_id}/end")
async def end_live_session(session_id: str, user: dict = Depends(current_user)):
    session, channel = await _live_session_or_404(session_id)
    await _host_or_manager(session, channel, user)
    updated = await db.live_sessions.find_one_and_update(
        {"id": session_id, "status": "live"},
        {"$set": {"status": "ended", "ended_at": now()}}, projection={"_id": 0}, return_document=True)
    if not updated:
        raise HTTPException(409, "Only a live session can end")
    await _emit_live("live_session_ended", updated, user)
    payload = {"type": "live.ended", "session_id": session_id}
    await realtime.publish(realtime.chat_channel(channel["id"]), payload)
    await realtime.publish(_live_channel_name(updated), payload)
    return (await _live_view([updated], user["id"]))[0]


@router.get("/live-sessions/{session_id}")
async def get_live_session(session_id: str, user: dict = Depends(current_user)):
    """The room snapshot: status, who has joined, and where to subscribe.

    Does not admit the caller. Join is a separate write so opening a scheduled
    or ended session cannot mark someone present.
    """
    session, channel = await _live_session_or_404(session_id)
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    return await _live_room(session, user["id"])


@router.post("/live-sessions/{session_id}/join")
async def join_live_session(session_id: str, user: dict = Depends(current_user)):
    """Admit a member into a session that is live. Ended sessions are refused.

    Idempotent: joining twice does not duplicate the participant or the
    `live_session_joined` event. The optional `subscription_token` is a
    Centrifugo JWT for `live:{session_id}` when realtime is configured.
    """
    session, channel = await _live_session_or_404(session_id)
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    _refuse_unless_live(session)
    fresh = False
    try:
        await db.live_participants.insert_one({
            "id": new_id(), "session_id": session_id, "user_id": user["id"], "joined_at": now(),
        })
        fresh = True
    except DuplicateKeyError:
        pass
    if fresh:
        await _emit_live("live_session_joined", session, user)
        person = (await _people([user["id"]])).get(user["id"]) or {
            "id": user["id"], "full_name": user.get("full_name"), "avatar_url": None,
        }
        await realtime.publish(_live_channel_name(session), {
            "type": "presence.joined", "user_id": user["id"], "user": person,
        })
    return await _live_room(session, user["id"])


@router.get("/live-sessions/{session_id}/messages")
async def list_live_messages(session_id: str, user: dict = Depends(current_user)):
    session, channel = await _live_session_or_404(session_id)
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    rows = [
        row async for row in db.live_messages.find(
            {"session_id": session_id}, {"_id": 0}
        ).sort("created_at", 1).limit(200)
    ]
    people = await _people(list({row["author_id"] for row in rows}))
    return [clean({**row, "author": people.get(row["author_id"])}) for row in rows]


@router.post("/live-sessions/{session_id}/messages", status_code=201)
async def post_live_message(session_id: str, body: LiveChatIn, user: dict = Depends(current_user)):
    """Session chat. Only a member who has joined, and only while the session is live."""
    await ratelimit.hit("message", user["id"])
    session, channel = await _live_session_or_404(session_id)
    await _require(channel["community_id"], user["id"], permissions.SEND_MESSAGE, channel)
    _refuse_unless_live(session)
    admitted = await db.live_participants.find_one(
        {"session_id": session_id, "user_id": user["id"]}, {"_id": 1})
    if not admitted:
        raise HTTPException(409, "Join the session before chatting")
    doc = {
        "id": new_id(), "session_id": session_id, "author_id": user["id"],
        "content": body.content, "created_at": now(),
    }
    await db.live_messages.insert_one(dict(doc))
    view = clean({**doc, "author": (await _people([user["id"]])).get(user["id"])})
    await realtime.publish(_live_channel_name(session), {"type": "chat.message", "message": view})
    return view


@router.delete("/live-sessions/{session_id}", status_code=204)
async def cancel_live_session(session_id: str, user: dict = Depends(current_user)):
    session, channel = await _live_session_or_404(session_id)
    await _host_or_manager(session, channel, user)
    updated = await db.live_sessions.find_one_and_update(
        {"id": session_id, "status": "scheduled"},
        {"$set": {"status": "cancelled", "ended_at": now()}}, projection={"_id": 0})
    if not updated:
        raise HTTPException(409, "Only a scheduled session can be cancelled")
    await _tell_rsvps(session, user, f"{session['title']} was cancelled")


@router.get("/partner/dashboard")
async def partner_dashboard(user: dict = Depends(current_user)):
    if not _coach_is_approved(user):
        raise HTTPException(403, "Approved coach status required")
    communities = [
        community async for community in db.communities.find(
            {"owner_id": user["id"], "status": {"$ne": "archived"}}, {"_id": 0}
        )
    ]
    community_ids = [community["id"] for community in communities]
    active_members = await db.community_members.count_documents(
        {"community_id": {"$in": community_ids}, "status": "active", "role": "member"}
    )
    pending_members = await db.community_members.count_documents(
        {"community_id": {"$in": community_ids}, "status": "pending"}
    )
    ledger_pipeline = [
        {"$match": {"partner_id": user["id"], "status": "available"}},
        {"$group": {"_id": "$currency", "gross_cents": {"$sum": "$gross_cents"}, "net_cents": {"$sum": "$net_cents"}}},
    ]
    balances = [clean(row) async for row in db.partner_ledger.aggregate(ledger_pipeline)]
    return {
        "community_count": len(communities),
        "active_members": active_members,
        "pending_members": pending_members,
        "balances": balances,
        "payout_status": user.get("payout_status", "not_connected"),
        "communities": [await _community_view(community, user["id"]) for community in communities],
    }


@router.get("/community-rankings")
async def community_rankings():
    result = await build_rankings(db, now())
    # Preserve the existing community response shape for older clients.
    views = []
    for row in result["communities"]:
        community = await db.communities.find_one({"id": row["id"], "is_public": True, "status": "active"}, {"_id": 0})
        if community:
            view = await _community_view(community)
            view["member_count"] = row["member_count"]
            views.append(view)
    result["communities"] = views
    return result
