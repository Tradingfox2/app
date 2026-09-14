"""Community marketplace, membership, chat, and partner operations."""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from pymongo.errors import DuplicateKeyError

from server import clean, current_user, db, new_id, now, optional_user
from community_rankings import build_rankings
import challenges
import moderation
import notifications
import permissions
import ratelimit
import realtime
import social_graph
import staff

router = APIRouter()

JoinPolicy = Literal["open", "approval", "paid"]
MemberStatus = Literal["pending", "active", "rejected", "left", "banned"]
ChannelKind = Literal["text", "announcement", "program", "challenge", "checkin", "live"]


class CoachApplicationIn(BaseModel):
    bio: str = Field(min_length=40, max_length=1200)
    specialties: list[str] = Field(min_length=1, max_length=8)
    credentials: list[str] = Field(default_factory=list, max_length=10)


class CoachApplicationReviewIn(BaseModel):
    status: Literal["approved", "rejected"]
    review_note: str | None = Field(default=None, max_length=500)


class CommunityCreateIn(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    slug: str = Field(min_length=3, max_length=48, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    description: str = Field(default="", max_length=1200)
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
    is_public: bool | None = None
    join_policy: JoinPolicy | None = None
    price_cents: int | None = Field(default=None, ge=0, le=1_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)


class MembershipReviewIn(BaseModel):
    status: Literal["active", "rejected", "banned"]


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
    content: str = Field(min_length=1, max_length=4000)
    reply_to_id: str | None = None


class MessageEditIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


class PostIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    community_id: str | None = None
    workout_id: str | None = None
    media_urls: list[str] = Field(default_factory=list, max_length=8)


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
):
    if scope == "mine":
        if not user:
            raise HTTPException(401, "Not authenticated")
        memberships = [
            member
            async for member in db.community_members.find(
                {"user_id": user["id"], "status": {"$in": ["active", "pending"]}},
                {"_id": 0, "community_id": 1},
            )
        ]
        query = {"id": {"$in": [member["community_id"] for member in memberships]}}
    else:
        query = {"is_public": True, "status": {"$ne": "archived"}}
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

    Every way in â€” joining directly, redeeming an invite â€” goes through here,
    so the two rules that matter cannot be routed around:
    - a banned member stays banned, whatever link they arrive with;
    - a paid community needs verified billing, whatever link they arrive with.
    """
    community_id = community["id"]
    existing = await _membership(community_id, user["id"])
    status_now = (existing or {}).get("status")
    if status_now in {"active", "banned"}:
        return clean(existing), False
    if status_now == "pending" and not bypass_approval:
        return clean(existing), False
    policy = community.get("join_policy", "open")
    if policy == "paid":
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
    membership, _ = await _activate(community, user)
    return membership


@router.get("/communities/{community_id}/members")
async def list_members(community_id: str, user: dict = Depends(current_user)):
    await _manager(community_id, user["id"])
    output = []
    async for member in db.community_members.find({"community_id": community_id}, {"_id": 0}).sort("created_at", 1):
        profile = await db.users.find_one(
            {"id": member["user_id"]}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1}
        )
        member["user"] = clean(profile)
        output.append(clean(member))
    return output


@router.patch("/communities/{community_id}/members/{member_id}")
async def review_membership(
    community_id: str,
    member_id: str,
    body: MembershipReviewIn,
    user: dict = Depends(current_user),
):
    # Reviewing a join request is channel management; removing someone already
    # inside is a separate power, which is what KICK_MEMBER exists to express.
    if body.status == "banned":
        await _require(community_id, user["id"], permissions.KICK_MEMBER)
    else:
        await _manager(community_id, user["id"])
    member = await db.community_members.find_one({"id": member_id, "community_id": community_id})
    if not member:
        raise HTTPException(404, "Membership not found")
    if member.get("role") == "owner":
        raise HTTPException(409, "Owner membership cannot be changed")
    community = await _community_or_404(community_id)
    if body.status == "active" and community.get("join_policy") == "paid":
        raise HTTPException(402, "Only verified billing can activate paid memberships")
    updates = {"status": body.status, "updated_at": now(), "reviewed_by": user["id"]}
    if body.status == "active":
        updates["joined_at"] = now()
    await db.community_members.update_one({"id": member_id}, {"$set": updates})
    if body.status in {"active", "rejected"}:
        approved = body.status == "active"
        await notifications.notify(
            member["user_id"], notifications.MEMBERSHIP, actor=user,
            title=(f"You joined {community['name']}" if approved
                   else f"Your request to join {community['name']} was declined"),
            target_type="community", target_id=community_id,
            metadata={"approved": approved})
    return clean(await db.community_members.find_one({"id": member_id}, {"_id": 0}))


@router.delete("/communities/{community_id}", status_code=204)
async def archive_community(community_id: str, user: dict = Depends(current_user)):
    """Archive a community. Owner only â€” closing someone's community is not a
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


@router.delete("/communities/{community_id}/membership", status_code=204)
async def leave_community(community_id: str, user: dict = Depends(current_user)):
    member = await _membership(community_id, user["id"])
    if not member:
        return None
    if member.get("role") == "owner":
        raise HTTPException(409, "Community owners cannot leave their community")
    await db.community_members.update_one(
        {"id": member["id"]}, {"$set": {"status": "left", "updated_at": now()}}
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


@router.get("/communities/{community_id}/roles")
async def list_roles(community_id: str, user: dict = Depends(current_user)):
    await _community_or_404(community_id)
    await _active_member(community_id, user["id"])
    return [clean(role) for role in await _roles(community_id)]


@router.post("/communities/{community_id}/roles", status_code=201)
async def create_role(community_id: str, body: RoleIn, user: dict = Depends(current_user)):
    await _require(community_id, user["id"], permissions.MANAGE_ROLES)
    if body.rank >= await _rank_ceiling(community_id, user["id"]):
        raise HTTPException(403, "Cannot create a role at or above your own rank")
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
    ceiling = await _rank_ceiling(community_id, user["id"])
    if role.get("rank", 0) >= ceiling:
        raise HTTPException(403, "Cannot edit a role at or above your own rank")
    updates = {key: value for key, value in body.model_dump().items() if value is not None}
    if role.get("is_default") and "rank" in updates:
        raise HTTPException(409, "The default role rank is fixed")
    if int(updates.get("rank", 0)) >= ceiling:
        raise HTTPException(403, "Cannot raise a role to or above your own rank")
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
    await _require(community_id, user["id"], permissions.MANAGE_CHANNEL, channel)
    known = {role["id"] for role in await _roles(community_id)}
    overwrites = []
    for entry in body:
        if entry.role_id not in known:
            raise HTTPException(404, "Role not found")
        overwrites.append(entry.model_dump())
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
    await _attach_unread(visible, member, user["id"])
    return visible


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
    channel = {
        "id": new_id(),
        "community_id": community_id,
        **body.model_dump(),
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
    if not updates:
        return clean(channel)
    try:
        await db.channels.update_one({"id": channel_id}, {"$set": updates})
    except DuplicateKeyError as exc:
        raise HTTPException(409, "A channel with that name already exists") from exc
    return clean({**channel, **updates})


@router.delete("/channels/{channel_id}", status_code=204)
async def archive_channel(channel_id: str, user: dict = Depends(current_user)):
    """Archive a channel. Messages are kept â€” this hides the room, not its history."""
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
    for message in messages:
        author = await db.users.find_one(
            {"id": message["author_id"]}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1}
        )
        message["author"] = clean(author)
        # Messages written before interactions shipped carry none of these keys.
        message.setdefault("reactions", [])
        message.setdefault("reply_to_id", None)
        message.setdefault("pinned_at", None)
        message.setdefault("edited_at", None)
        message["mentions"] = await notifications.resolve_mentions(message.get("content", ""))
        if message["reply_to_id"]:
            parent = await db.messages.find_one(
                {"id": message["reply_to_id"]},
                {"_id": 0, "id": 1, "author_id": 1, "content": 1, "status": 1},
            )
            if parent and parent.get("status") == "active":
                message["reply_to"] = clean(parent)
            else:
                message["reply_to"] = None
    return [clean(message) for message in reversed(messages)]


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
    community_id = channel["community_id"]
    # An announcement channel is broadcast-only: everyone reads, only members who
    # can manage messages may post. Expressed as a permission rather than an
    # @everyone deny, so legacy moderators â€” who have no role document to grant
    # an exception to â€” keep working without a migration.
    needed = (
        permissions.MANAGE_MESSAGES
        if channel.get("kind") == "announcement"
        else permissions.SEND_MESSAGE
    )
    await _require(community_id, user["id"], needed, channel)

    checkin_day = challenges.day_key(now()) if channel.get("kind") == "checkin" else None
    if checkin_day and await db.messages.find_one({
        "channel_id": channel_id, "author_id": user["id"],
        "status": "active", "checkin_day": checkin_day,
    }, {"_id": 1}):
        raise HTTPException(409, "You have already checked in today")

    reply_to = None
    if body.reply_to_id:
        parent = await db.messages.find_one(
            {"id": body.reply_to_id, "channel_id": channel_id, "status": "active"},
            {"_id": 0, "id": 1, "author_id": 1, "content": 1},
        )
        if not parent:
            raise HTTPException(404, "Message being replied to was not found")
        reply_to = clean(parent)

    content = body.content.strip()
    mask, _ = await _mask(community_id, user["id"], channel)
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
        "reply_to_id": body.reply_to_id,
        "reactions": [],
        "pinned_at": None,
        "edited_at": None,
        "status": "active",
        "created_at": now(),
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
    message["reply_to"] = reply_to
    message["mentions"] = await notifications.resolve_mentions(content)
    published = clean(message)
    # After the write commits: a dropped publish costs a nudge, never the message.
    await realtime.publish(
        realtime.chat_channel(channel_id), {"type": "message.created", "message": published}
    )

    audience = {
        member["user_id"]
        async for member in db.community_members.find(
            {"community_id": community_id, "status": "active"}, {"_id": 0, "user_id": 1}
        )
    }
    for mentioned in await notifications.notify_mentions(
        content, author=user, kind="mention",
        title=f"{user.get('full_name', 'Someone')} mentioned you",
        metadata={"community_id": community_id, "channel_id": channel_id,
                  "message_id": message["id"]},
        audience=audience,
    ):
        await realtime.publish(
            realtime.user_channel(mentioned),
            {"type": "mention", "message_id": message["id"], "channel_id": channel_id},
        )

    await moderation.screen(
        content, author=user, target_type="message", target_id=message["id"],
        metadata={"community_id": community_id, "channel_id": channel_id},
    )
    return published


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
        await db.messages.update_one(
            {"id": message_id, "reactions.emoji": {"$ne": body.emoji}},
            {"$push": {"reactions": {"emoji": body.emoji, "user_ids": [user["id"]]}}},
        )
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
    await _require(channel["community_id"], user["id"], permissions.VIEW_CHANNEL, channel)
    if (now() - message["created_at"]).total_seconds() > EDIT_WINDOW_SECONDS:
        raise HTTPException(409, "The edit window for this message has closed")
    updates = {"content": body.content.strip(), "edited_at": now()}
    await db.messages.update_one({"id": message_id}, {"$set": updates})
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
    return [
        clean(message)
        async for message in db.messages.find(
            {"channel_id": channel_id, "status": "active", "pinned_at": {"$ne": None}},
            {"_id": 0},
        ).sort("pinned_at", -1)
    ]


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
async def member_directory(community_id: str, user: dict = Depends(current_user)):
    """Active members' public fields, for any active member.

    Distinct from `/members`, which is manager-only because it exposes pending
    requests and statuses. Without this, @-mention suggestions were silently
    empty for everyone who was not a manager.
    """
    await _community_or_404(community_id)
    await _active_member(community_id, user["id"])
    user_ids = [
        row["user_id"]
        async for row in db.community_members.find(
            {"community_id": community_id, "status": "active"}, {"_id": 0, "user_id": 1}
        ).limit(1000)
    ]
    return [
        clean(row)
        async for row in db.users.find(
            {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "full_name": 1, "avatar_url": 1}
        ).sort("full_name", 1)
    ]


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
    member_count = await db.community_members.count_documents(
        {"community_id": community["id"], "status": "active"})
    membership = await _membership(community["id"], user["id"]) if user else None
    return {
        "code": code,
        "unusable_reason": _invite_state(invite),
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

    One rest day never breaks a streak; two in a row do â€” see challenges.py for
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
    workouts inside the window, and only training aggregates are used â€”
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
