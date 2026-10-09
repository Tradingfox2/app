"""
IronFlow — FastAPI backend mirroring the Supabase schema in MongoDB.

Access control mirrors Row Level Security:
- A user reads/writes only their own health rows.
- A coach reads/writes a client's rows only if there is an active
  coach_relationship between them.
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from jwt import InvalidTokenError
from pydantic import BaseModel, EmailStr, Field

import media_storage
import readiness
import request_context
import training_load
from ai import provider_configured, resolve_provider
from locales import DEFAULT_LOCALE, SUPPORTED_LOCALES, normalize_locale

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# --------------------------------------------------------------------------- #
# Config                                                                      #
# --------------------------------------------------------------------------- #
# Motor client lives in db.py (tz_aware). Same objects as before; scripts
# import that module so they do not load this file's routers.
import observability  # noqa: E402
from db import client, db, db_name, mongo_url  # noqa: E402

observability.configure_logging()
observability.init_sentry()

JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_hex(32)
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 30  # 30 days
# Bound the health probe. The client's own server-selection wait is 30s, which
# would hold a load-balancer check open until it gives up.
HEALTH_MONGO_TIMEOUT_SEC = 2.0

bearer = HTTPBearer(auto_error=False)

logger = logging.getLogger("ironflow")


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def clean(doc: dict | None) -> dict | None:
    """Drop Mongo's _id from a document."""
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: Optional[str] = None
    role: str = Field(default="athlete", pattern="^(athlete|coach)$")
    referral_code: str | None = Field(default=None, max_length=32)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PublicUser(BaseModel):
    id: str
    email: EmailStr
    full_name: Optional[str] = None
    role: str
    coach_status: str = "not_applied"
    avatar_url: Optional[str] = None
    preferred_locale: str = DEFAULT_LOCALE
    activity_ranking_opt_in: bool = False
    is_private: bool = False
    staff_role: Optional[str] = None
    bio: str = ""
    cover_url: Optional[str] = None
    sports: list[str] = []
    about: str = ""


class ProfileUpdateIn(BaseModel):
    preferred_locale: str | None = Field(default=None, pattern=f"^({'|'.join(SUPPORTED_LOCALES)})$")
    activity_ranking_opt_in: bool | None = None
    #: A private account converts incoming follows into requests.
    is_private: bool | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=80)
    bio: str | None = Field(default=None, max_length=300)
    about: str | None = Field(default=None, max_length=500)
    sports: list[Annotated[str, Field(min_length=1, max_length=24)]] | None = Field(default=None, max_length=8)
    #: An image uploaded through /media first; only the uploader's own counts.
    avatar_media_id: str | None = None
    cover_media_id: str | None = None
    #: True clears the avatar or cover.
    remove_avatar: bool | None = None
    remove_cover: bool | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: PublicUser


class ExerciseIn(BaseModel):
    slug: str
    name: str
    category: str
    equipment: Optional[str] = None
    difficulty: str = "beginner"
    primary_muscle: Optional[str] = None
    instructions: Optional[str] = None


class WorkoutIn(BaseModel):
    title: str
    notes: Optional[str] = None
    perceived_effort: Optional[int] = Field(default=None, ge=0, le=10)
    # Exercises queued from the Muscle Explorer / circuits before logging starts.
    planned_exercise_slugs: list[str] = []


class WorkoutPlanIn(BaseModel):
    exercise_slugs: list[str] = Field(min_length=1, max_length=20)


class SetIn(BaseModel):
    exercise_id: str
    set_index: int
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    duration_sec: Optional[int] = None
    distance_m: Optional[float] = None
    rpe: Optional[float] = None
    #: Rest taken before this set. Same name as ProgramExercise.rest_sec.
    #: Omitted stays null so older clients keep working. 0 is a real value.
    rest_sec: Optional[int] = Field(default=None, ge=0, le=600)


class BiomarkerIn(BaseModel):
    marker: str
    value: float
    unit: str
    reference_low: Optional[float] = None
    reference_high: Optional[float] = None
    notes: Optional[str] = None
    source: str = "manual"


class WearableMetricIn(BaseModel):
    metric: str  # hrv / resting_hr / sleep_hours / steps / strain / recovery
    value: float
    unit: Optional[str] = None
    device: Optional[str] = None


class CoachRequestIn(BaseModel):
    client_email: EmailStr


class CoachStatusIn(BaseModel):
    status: str = Field(pattern="^(active|paused|ended)$")


class GroupSessionIn(BaseModel):
    title: str
    starts_at: datetime
    description: Optional[str] = None
    duration_min: int = 60
    price_cents: int = 0
    currency: str = "EUR"
    community_id: Optional[str] = None


class SubscriptionIn(BaseModel):
    plan: str = Field(pattern="^(free|pro|elite|coach)$")


# --------------------------------------------------------------------------- #
# Security helpers                                                            #
# --------------------------------------------------------------------------- #
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, stored: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), stored.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": now(),
        "exp": now() + timedelta(minutes=JWT_TTL_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALG],
            options={"require": ["sub", "exp", "iat"]},
        )
        user_id = payload["sub"]
    except (InvalidTokenError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")
    if user.get("suspended_at"):
        expires = user.get("suspended_until")
        if expires and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)  # legacy rows written without tz
        if expires and expires <= now():
            await db.users.update_one({"id": user_id}, {"$set": {
                "suspended_at": None, "suspended_until": None, "suspension_reason": None,
            }})
            user = await db.users.find_one({"id": user_id})
        else:
            raise HTTPException(status_code=403, detail=user.get("suspension_reason") or "Account suspended")
    return user


async def require_pro(user: dict = Depends(current_user)) -> dict:
    """A live Pro row, or Pro credit days that have not run out.
    `past_due` still counts while Stripe retries the card.
    """
    sub = await db.subscriptions.find_one(
        {
            "user_id": user["id"],
            "plan": {"$in": ["pro", "pro_monthly", "pro_yearly"]},
            "status": {"$in": ["active", "trialing", "past_due"]},
        },
        {"_id": 1},
    )
    if sub:
        return user
    until = user.get("pro_credit_until")
    if isinstance(until, datetime):
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        if until > now():
            return user
    raise HTTPException(402, "Pro subscription required")


async def optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict | None:
    """Like current_user, but anonymous callers get None instead of 401."""
    if not credentials:
        return None
    try:
        return await current_user(credentials)
    except HTTPException:
        return None


async def can_access_user_data(actor_id: str, owner_id: str) -> bool:
    """Mirror of the RLS rule: owner or active coach."""
    if actor_id == owner_id:
        return True
    rel = await db.coach_relationships.find_one(
        {"coach_id": actor_id, "client_id": owner_id, "status": "active"}
    )
    return rel is not None


def to_public_user(u: dict) -> PublicUser:
    return PublicUser(
        id=u["id"],
        email=u["email"],
        full_name=u.get("full_name"),
        role=u.get("role", "athlete"),
        coach_status=u.get(
            "coach_status",
            "approved" if u.get("role") == "coach" else "not_applied",
        ),
        avatar_url=u.get("avatar_url"),
        preferred_locale=normalize_locale(u.get("preferred_locale")),
        activity_ranking_opt_in=u.get("activity_ranking_opt_in", False),
        is_private=u.get("is_private", False),
        staff_role=u.get("staff_role"),
        bio=u.get("bio") or "",
        cover_url=u.get("cover_url"),
        sports=list(u.get("sports") or []),
        about=u.get("about") or "",
    )


# --------------------------------------------------------------------------- #
# App + routes                                                                #
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    # The feed's private-author filter scans only private accounts; this keeps
    # that scan proportional to them, not to every user.
    await db.users.create_index("is_private", partialFilterExpression={"is_private": True})
    await db.exercises.create_index("slug", unique=True)
    await db.muscles.create_index("slug", unique=True)
    await db.workouts.create_index([("user_id", 1), ("started_at", -1)])
    await db.workouts.create_index([("user_id", 1), ("ended_at", -1)])
    await db.workouts.create_index(
        [("user_id", 1), ("activity.client_id", 1)],
        unique=True,
        partialFilterExpression={"activity.client_id": {"$type": "string"}},
    )
    await db.workout_routes.create_index("workout_id", unique=True)
    await db.workout_sets.create_index([("workout_id", 1), ("set_index", 1)])
    await db.workout_sets.create_index([("exercise_id", 1), ("workout_id", 1)])
    await db.biomarkers.create_index([("user_id", 1), ("measured_at", -1)])
    await db.biomarkers.create_index(
        [("terra_session_id", 1), ("terra_result_index", 1)],
        unique=True,
        partialFilterExpression={"terra_session_id": {"$type": "string"}},
    )
    await db.lab_reports.create_index(
        "terra_upload_id",
        unique=True,
        partialFilterExpression={"terra_upload_id": {"$type": "string"}},
    )
    await db.terra_webhook_events.create_index([("received_at", -1)])
    await db.wearable_metrics.create_index(
        [("user_id", 1), ("metric", 1), ("recorded_at", -1)]
    )
    await db.wearable_metrics.create_index(
        [("user_id", 1), ("device", 1), ("metric", 1), ("local_day", 1)],
        unique=True,
        partialFilterExpression={"device": "manual", "local_day": {"$type": "string"}},
    )
    await db.wearable_metrics.create_index(
        [("terra_user_id", 1), ("terra_event_type", 1), ("terra_item_key", 1), ("metric", 1)],
        unique=True,
        partialFilterExpression={"terra_user_id": {"$type": "string"}},
    )
    await db.coach_relationships.create_index(
        [("coach_id", 1), ("client_id", 1)], unique=True
    )
    await db.coach_applications.create_index("user_id", unique=True)
    await db.communities.create_index("slug", unique=True)
    await db.community_members.create_index(
        [("community_id", 1), ("user_id", 1)], unique=True
    )
    await db.community_members.create_index(
        [("owner_id", 1), ("status", 1)]
    )
    await db.channels.create_index(
        [("community_id", 1), ("name", 1)], unique=True
    )
    await db.messages.create_index([("channel_id", 1), ("created_at", -1)])
    await db.messages.create_index([("status", 1), ("created_at", -1)])
    await db.posts.create_index([("created_at", -1)])
    await db.posts.create_index([("author_id", 1), ("status", 1), ("created_at", -1)])
    await db.posts.create_index([("repost_of", 1), ("author_id", 1)])
    await db.post_likes.create_index([("post_id", 1), ("user_id", 1)], unique=True)
    await db.post_kudos.create_index([("post_id", 1), ("user_id", 1)], unique=True)
    await db.post_comments.create_index([("post_id", 1), ("created_at", 1)])
    await db.follows.create_index([("follower_id", 1), ("followee_id", 1)], unique=True)
    await db.follows.create_index([("followee_id", 1)])
    # Follow requests are read by status on every profile view and request list.
    await db.follows.create_index([("followee_id", 1), ("status", 1)])
    await db.follows.create_index([("follower_id", 1), ("status", 1)])
    await db.blocks.create_index([("blocker_id", 1), ("blocked_id", 1)], unique=True)
    await db.blocks.create_index([("blocked_id", 1)])
    await db.mutes.create_index([("muter_id", 1), ("muted_id", 1)], unique=True)
    # Aggregation looks up an unread row for the same target before inserting.
    await db.notifications.create_index([("user_id", 1), ("type", 1), ("metadata.target_id", 1), ("read_at", 1)])
    # One read marker per member per channel; $max upserts rely on the key.
    await db.channel_reads.create_index([("channel_id", 1), ("user_id", 1)], unique=True)
    await db.channel_reads.create_index([("user_id", 1), ("channel_id", 1)])
    # One check-in per member per channel per UTC day. Partial on active rows,
    # so deleting a mistaken check-in frees the day again.
    await db.messages.create_index(
        [("channel_id", 1), ("author_id", 1), ("checkin_day", 1)], unique=True,
        partialFilterExpression={"checkin_day": {"$exists": True}, "status": "active"},
    )
    await db.challenge_participants.create_index([("channel_id", 1), ("user_id", 1)], unique=True)
    await db.program_adoptions.create_index([("message_id", 1), ("user_id", 1)], unique=True)
    await db.live_sessions.create_index([("channel_id", 1), ("status", 1), ("starts_at", 1)])
    await db.live_sessions.create_index([("community_id", 1), ("status", 1), ("started_at", -1)])
    await db.live_rsvps.create_index([("session_id", 1), ("user_id", 1)], unique=True)
    await db.live_participants.create_index([("session_id", 1), ("user_id", 1)], unique=True)
    await db.live_messages.create_index([("session_id", 1), ("created_at", 1)])
    # Historical only. Live start/join/end now go to analytics_events.
    await db.insight_events.create_index([("session_id", 1), ("created_at", -1)])
    await db.insight_events.create_index([("name", 1), ("created_at", -1)])
    await db.post_saves.create_index([("user_id", 1), ("post_id", 1)], unique=True)
    await db.post_saves.create_index([("user_id", 1), ("created_at", -1)])
    await db.comment_likes.create_index([("comment_id", 1), ("user_id", 1)], unique=True)
    await db.poll_votes.create_index([("post_id", 1), ("user_id", 1)], unique=True)
    await db.posts.create_index([("tags", 1), ("created_at", -1)])
    await db.posts.create_index([("author_id", 1), ("created_at", -1)])
    await db.posts.create_index([("content", "text")], default_language="none", name="posts_content_text")
    await db.community_members.create_index([("community_id", 1), ("status", 1), ("user_id", 1)])
    await db.community_members.create_index(
        "stripe_subscription_id", partialFilterExpression={"stripe_subscription_id": {"$type": "string"}})
    await db.community_checkouts.create_index("id", unique=True)
    await db.billing_events.create_index("id", unique=True)
    await db.referrals.create_index("code", unique=True)
    await db.users.create_index("referred_by", partialFilterExpression={"referred_by": {"$type": "string"}})
    await db.commissions.create_index([("source_user_id", 1), ("level", 1)], unique=True)
    await db.commissions.create_index([("beneficiary_id", 1), ("status", 1)])
    await db.subscriptions.create_index("user_id")
    await db.subscriptions.create_index(
        "stripe_subscription_id", unique=True,
        partialFilterExpression={"stripe_subscription_id": {"$type": "string"}},
    )
    await db.push_tokens.create_index("token", unique=True)
    await db.push_tokens.create_index("user_id")
    await db.community_invites.create_index("code", unique=True)
    await db.community_invites.create_index([("community_id", 1), ("revoked_at", 1), ("created_at", -1)])
    await db.rate_limits.create_index("key", unique=True)
    await db.coach_conversations.create_index([("user_id", 1), ("created_at", -1)])
    # TTL: a window's counter deletes itself once the window has passed.
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.direct_messages.create_index([("thread_key", 1), ("created_at", -1)])
    await db.direct_messages.create_index([("recipient_id", 1), ("read_at", 1)])
    await db.media.create_index([("user_id", 1), ("created_at", -1)])
    await db.stories.create_index([("author_id", 1), ("created_at", -1)])
    await db.stories.create_index([("expires_at", 1)])
    # Mirrors 004_support_and_dual_media.sql: unique object key, plus the two
    # partial indexes that skip soft-deleted staff assets.
    await db.admin_media.create_index("key", unique=True)
    await db.admin_media.create_index(
        [("uploader_staff_id", 1), ("created_at", -1)],
        partialFilterExpression={"deleted_at": None},
    )
    await db.admin_media.create_index(
        [("purpose", 1), ("created_at", -1)],
        partialFilterExpression={"deleted_at": None},
    )
    await db.reports.create_index([("status", 1), ("created_at", 1)])
    await db.reports.create_index([("reporter_id", 1), ("target_id", 1), ("status", 1)])
    await db.audit_log.create_index([("created_at", -1)])
    await db.audit_log.create_index([("target_id", 1), ("created_at", -1)])
    await db.audit_log.create_index([("actor_id", 1), ("created_at", -1)])
    await db.audit_log.create_index([("action", 1), ("created_at", -1)])
    await db.audit_log.create_index([("outcome", 1), ("created_at", -1)])
    await db.audit_log.create_index([("actor_id", 1), ("action", 1), ("target_id", 1), ("created_at", -1)])
    await db.users.create_index([("created_at", -1), ("id", -1)])
    await db.users.create_index([("staff_role", 1), ("created_at", -1)])
    await db.coach_applications.create_index([("status", 1), ("created_at", 1)])
    await db.coach_applications.create_index([("status", 1), ("created_at", 1), ("id", 1)])
    await db.community_members.create_index([("status", 1), ("created_at", 1)])
    await db.communities.create_index([("created_at", -1), ("id", -1)])
    await db.reports.create_index([("status", 1), ("created_at", 1), ("id", 1)])
    await db.tickets.create_index([("status", 1), ("updated_at", -1)])
    await db.tickets.create_index([("assignee_id", 1), ("status", 1), ("updated_at", -1)])
    # Product analytics: unique event id, and name+ts for the 24h / 7d rollup.
    await analytics.ensure_indexes(db)
    # Bound at the bottom of this module (gyms imports wearables, which imports server).
    await ensure_gym_indexes(db)
    await ensure_weekly_indexes(db)
    await db.user_notes.create_index([("user_id", 1), ("created_at", -1)])
    # Read by _roles() on every permission resolve — the hot path for each
    # channel read and message write, so it must never be a collection scan.
    await db.community_roles.create_index([("community_id", 1), ("rank", 1)])
    await db.community_roles.create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("read_at", 1)])
    # Hot reads: posts by author, channel history, unread notifications,
    # a member's communities, and a member's wearable history. The posts,
    # messages, and notifications pairs are also created earlier in this
    # lifespan with the same keys. community_members (user_id, status) and
    # wearable_metrics (user_id, recorded_at) are not a prefix of those.
    await db.posts.create_index([("author_id", 1), ("created_at", -1)])
    await db.messages.create_index([("channel_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("read_at", 1)])
    await db.community_members.create_index([("user_id", 1), ("status", 1)])
    await db.wearable_metrics.create_index([("user_id", 1), ("recorded_at", -1)])
    # Support tickets. user_id + status are the member list and the staff queue;
    # ticket_id is how a thread is loaded. id is the public key.
    await db.tickets.create_index("id", unique=True)
    await db.tickets.create_index("user_id")
    await db.tickets.create_index("status")
    await db.tickets.create_index([("user_id", 1), ("updated_at", -1)])
    await db.ticket_messages.create_index("id", unique=True)
    await db.ticket_messages.create_index("ticket_id")
    await db.ticket_messages.create_index([("ticket_id", 1), ("created_at", 1)])
    # Terra webhooks are acknowledged after being persisted. Replay unfinished
    # inbox entries on restart so an interrupted background task is not lost.
    from routers.labs import process_claimed_terra_lab_event

    async for event in db.terra_webhook_events.find(
        {"status": {"$in": ["pending", "failed"]}}, {"_id": 0, "payload": 1}
    ).sort("received_at", 1).limit(100):
        if event.get("payload"):
            await process_claimed_terra_lab_event(event["payload"])
    yield
    client.close()


app = FastAPI(title="IronFlow API", lifespan=lifespan)


@app.middleware("http")
async def bind_request_context(request: Request, call_next):
    token = request_context.set_request(request)
    try:
        return await call_next(request)
    finally:
        request_context.reset_request(token)
api = APIRouter(prefix="/api")


# ---- Health --------------------------------------------------------------- #
@api.get("/")
async def root():
    return {"service": "ironflow", "status": "ok"}


@api.get("/health")
async def health():
    """Readiness: Mongo answers a ping, and whether an AI provider is configured.

    AI is reported only. A missing key does not fail the probe — coach routes
    already degrade, and CI runs with `LLM_PROVIDER=none`. Mongo down is 503
    so Docker and Render stop sending traffic. The body never includes the
    driver error (it can echo the host).
    """
    mongo_ok = False
    try:
        await asyncio.wait_for(db.command("ping"), timeout=HEALTH_MONGO_TIMEOUT_SEC)
        mongo_ok = True
    except Exception:  # noqa: BLE001 — any failure means Mongo is not ready
        logger.warning("Mongo health ping failed")
    body = {
        "status": "ok" if mongo_ok else "unavailable",
        "mongo": mongo_ok,
        "ai_configured": provider_configured(),
        "ai_provider": resolve_provider(),
    }
    if not mongo_ok:
        return JSONResponse(status_code=503, content=body)
    return body


# ---- Auth ----------------------------------------------------------------- #
@api.post("/auth/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    user_doc = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(body.password),
        "full_name": body.full_name,
        "role": "athlete",
        "coach_status": "not_applied",
        "avatar_url": None,
        "preferred_locale": DEFAULT_LOCALE,
        "created_at": now(),
    }
    code = (body.referral_code or "").strip().upper()
    if code:
        referrer = await db.referrals.find_one({"code": code}, {"_id": 0, "referrer_id": 1})
        if referrer and referrer.get("referrer_id"):
            user_doc["referred_by"] = referrer["referrer_id"]
    await db.users.insert_one(user_doc)
    return TokenOut(access_token=make_token(user_doc["id"]), user=to_public_user(user_doc))


@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    import ratelimit  # lazy: ratelimit imports this module

    email = body.email.lower()
    # Keyed by the submitted email, so guessing one account's password is
    # capped whether or not that account exists.
    await ratelimit.hit("login", email)
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return TokenOut(access_token=make_token(user["id"]), user=to_public_user(user))


@api.get("/auth/me", response_model=PublicUser)
async def me(user: dict = Depends(current_user)):
    return to_public_user(user)


@api.get("/realtime/token")
async def realtime_token(user: dict = Depends(current_user)):
    """Short-lived Centrifugo connection token for the signed-in user.

    Returns `enabled: false` rather than erroring when realtime is not
    configured, so the client can fall back to polling without a failed request.
    """
    import realtime

    if not realtime.is_configured():
        return {"enabled": False, "token": None, "url": None}
    return {
        "enabled": True,
        "token": realtime.connection_token(user["id"]),
        "url": realtime.CENTRIFUGO_URL,
    }


def _clean_sports(values: list[str]) -> list[str]:
    """Trim, drop blanks, and keep the first spelling of each sport."""
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in values:
        tag = " ".join(raw.split())
        if not tag or len(tag) > 24:
            raise HTTPException(422, "Sport tags must be 1–24 characters")
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(tag)
    if len(cleaned) > 8:
        raise HTTPException(422, "At most 8 sports")
    return cleaned


@api.patch("/auth/me", response_model=PublicUser)
async def update_me(body: ProfileUpdateIn, user: dict = Depends(current_user)):
    updates = body.model_dump(exclude_none=True)
    media_id = updates.pop("avatar_media_id", None)
    cover_id = updates.pop("cover_media_id", None)
    if updates.pop("remove_avatar", None):
        updates["avatar_url"] = None
    if updates.pop("remove_cover", None):
        updates["cover_url"] = None
    if media_id:
        media = await db.media.find_one(
            {"id": media_id, "user_id": user["id"], "kind": "image"}, {"_id": 0, "url": 1})
        if not media:
            raise HTTPException(422, "Unknown image")
        updates["avatar_url"] = media["url"]
    if cover_id:
        media = await db.media.find_one(
            {"id": cover_id, "user_id": user["id"], "kind": "image"}, {"_id": 0, "url": 1})
        if not media:
            raise HTTPException(422, "Unknown image")
        updates["cover_url"] = media["url"]
    if "full_name" in updates:
        updates["full_name"] = updates["full_name"].strip()
    if "bio" in updates:
        updates["bio"] = updates["bio"].strip()
    if "about" in updates:
        updates["about"] = updates["about"].strip()
    if "sports" in updates:
        updates["sports"] = _clean_sports(updates["sports"])
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {**updates, "updated_at": now()}},
    )
    updated = await db.users.find_one({"id": user["id"]})
    return to_public_user(updated)


# ---- Library (public) ----------------------------------------------------- #
@api.get("/muscles")
async def list_muscles():
    return [clean(m) async for m in db.muscles.find({}, {"_id": 0}).sort("name", 1)]


@api.get("/exercises")
async def list_exercises(category: Optional[str] = None, muscle: Optional[str] = None):
    q: dict = {}
    if category:
        q["category"] = category
    if muscle:
        q["primary_muscle_slug"] = muscle
    return [clean(e) async for e in db.exercises.find(q, {"_id": 0}).sort("name", 1)]


_LOGGED_SET_FIELDS = (
    "id", "exercise_id", "set_index", "reps", "weight_kg",
    "duration_sec", "distance_m", "rpe", "rest_sec",
)


@api.get("/exercises/{exercise_id}/previous-sets")
async def previous_sets(
    exercise_id: str,
    limit: int = Query(default=1, ge=1, le=8),
    user: dict = Depends(current_user),
):
    """Most recent finished sessions that logged this exercise, for autofill.

    Open workouts are excluded: a set counts only after finish writes
    ended_at. Only the caller's own log is read — this is the logger's
    previous performance, not a coach view of a client.
    """
    pipeline = [
        {"$match": {"user_id": user["id"], "ended_at": {"$type": "date"}}},
        {"$sort": {"ended_at": -1, "started_at": -1}},
        {"$lookup": {
            "from": "workout_sets",
            "let": {"wid": "$id"},
            "pipeline": [
                {"$match": {"$expr": {"$and": [
                    {"$eq": ["$workout_id", "$$wid"]},
                    {"$eq": ["$exercise_id", exercise_id]},
                ]}}},
                {"$sort": {"set_index": 1, "created_at": 1}},
                {"$project": {"_id": 0, **{key: 1 for key in _LOGGED_SET_FIELDS}}},
            ],
            "as": "sets",
        }},
        {"$match": {"sets.0": {"$exists": True}}},
        {"$limit": limit},
        {"$project": {
            "_id": 0,
            "workout_id": "$id",
            "started_at": 1,
            "ended_at": 1,
            "sets": 1,
        }},
    ]
    sessions = [row async for row in db.workouts.aggregate(pipeline)]
    return {"exercise_id": exercise_id, "sessions": sessions}


# ---- Workouts ------------------------------------------------------------- #
@api.get("/workouts")
async def list_workouts(user: dict = Depends(current_user), owner_id: Optional[str] = None):
    target = owner_id or user["id"]
    if not await can_access_user_data(user["id"], target):
        raise HTTPException(403, "Not allowed")
    return [
        clean(w)
        async for w in db.workouts.find({"user_id": target}, {"_id": 0}).sort("started_at", -1).limit(50)
    ]


@api.post("/workouts", status_code=201)
async def create_workout(body: WorkoutIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "title": body.title,
        "notes": body.notes,
        "started_at": now(),
        "ended_at": None,
        "duration_sec": None,
        "perceived_effort": body.perceived_effort,
        "planned_exercise_slugs": list(dict.fromkeys(body.planned_exercise_slugs)),
        "created_at": now(),
    }
    await db.workouts.insert_one(doc)
    return clean(doc)


async def _load_workout_for(user: dict, workout_id: str) -> dict:
    w = await db.workouts.find_one({"id": workout_id}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Not found")
    if not await can_access_user_data(user["id"], w["user_id"]):
        raise HTTPException(403, "Not allowed")
    return w


@api.get("/workouts/{workout_id}")
async def get_workout(workout_id: str, user: dict = Depends(current_user)):
    """Single workout + its planned exercises resolved against the catalog."""
    w = await _load_workout_for(user, workout_id)
    slugs = w.get("planned_exercise_slugs") or []
    planned = []
    if slugs:
        by_slug = {
            e["slug"]: clean(e)
            async for e in db.exercises.find({"slug": {"$in": slugs}}, {"_id": 0})
        }
        planned = [by_slug[s] for s in slugs if s in by_slug]
    w["planned_exercises"] = planned
    return w


@api.post("/workouts/{workout_id}/plan")
async def plan_exercises(workout_id: str, body: WorkoutPlanIn, user: dict = Depends(current_user)):
    """Append exercises to a workout's plan (from the Muscle Explorer or a circuit)."""
    w = await _load_workout_for(user, workout_id)
    if w.get("ended_at"):
        raise HTTPException(409, "Workout already finished")
    merged = list(dict.fromkeys([*(w.get("planned_exercise_slugs") or []), *body.exercise_slugs]))
    await db.workouts.update_one({"id": workout_id}, {"$set": {"planned_exercise_slugs": merged}})
    return await get_workout(workout_id, user)


@api.post("/workouts/{workout_id}/finish")
async def finish_workout(workout_id: str, user: dict = Depends(current_user)):
    w = await db.workouts.find_one({"id": workout_id})
    if not w:
        raise HTTPException(404, "Not found")
    if not await can_access_user_data(user["id"], w["user_id"]):
        raise HTTPException(403, "Not allowed")
    if w.get("ended_at"):
        return clean(w)
    ended = now()
    duration = int((ended - w["started_at"]).total_seconds()) if w.get("started_at") else 0
    finished_fields: dict = {"ended_at": ended, "duration_sec": duration}
    load = training_load.session_load(w.get("perceived_effort"), duration)
    if load is not None:
        finished_fields["load_au"] = load
    updated = await db.workouts.find_one_and_update(
        {"id": workout_id, "ended_at": None},
        {"$set": finished_fields},
        projection={"_id": 0},
        return_document=True,
    )
    if not updated:
        return clean(await db.workouts.find_one({"id": workout_id}, {"_id": 0}))
    try:
        await analytics.record(
            name="workout_completed",
            actor_id=user["id"],
            source="server",
            role=analytics.product_role(user),
            props={"workout_id": workout_id},
        )
    except Exception as exc:  # noqa: BLE001 - analytics must not fail the finish
        logger.warning("workout_completed for %s was not stored: %s", workout_id, exc)
    return clean(updated)


def _suggestion(row: dict) -> dict:
    """A prefill hint. No set id: the client logs a new row when the athlete saves."""
    return {
        "exercise_id": row.get("exercise_id"),
        "set_index": row.get("set_index"),
        "reps": row.get("reps"),
        "weight_kg": row.get("weight_kg"),
        "duration_sec": row.get("duration_sec"),
        "distance_m": row.get("distance_m"),
        "rpe": row.get("rpe"),
        "rest_sec": row.get("rest_sec"),
    }


@api.post("/workouts/{workout_id}/repeat", status_code=201)
async def repeat_workout(workout_id: str, user: dict = Depends(current_user)):
    """Start a new open session from a finished workout. No template collection.

    Copies the plan (and, when the plan is empty, the exercise order of the
    log) plus the logged numbers as suggestions. Those suggestions are not
    written to workout_sets — the new session stays unfinished until
    /finish, and previous-sets keeps ignoring it until then.
    """
    source = await _load_workout_for(user, workout_id)
    if not source.get("ended_at"):
        raise HTTPException(409, "Finish the workout before repeating it")
    logged = [
        clean(row) async for row in db.workout_sets.find(
            {"workout_id": workout_id}, {"_id": 0},
        ).sort([("created_at", 1), ("set_index", 1)])
    ]
    slugs = list(source.get("planned_exercise_slugs") or [])
    if not slugs and logged:
        ids = list(dict.fromkeys(row["exercise_id"] for row in logged if row.get("exercise_id")))
        by_id = {
            row["id"]: row
            async for row in db.exercises.find(
                {"id": {"$in": ids}}, {"_id": 0, "id": 1, "slug": 1},
            )
        }
        slugs = [by_id[eid]["slug"] for eid in ids if by_id.get(eid, {}).get("slug")]
    doc = {
        "id": new_id(),
        "user_id": source["user_id"],
        "title": source.get("title") or "Workout",
        "notes": source.get("notes"),
        "started_at": now(),
        "ended_at": None,
        "duration_sec": None,
        "perceived_effort": None,
        "planned_exercise_slugs": slugs,
        "source": {"kind": "repeat", "workout_id": source["id"]},
        "created_at": now(),
    }
    await db.workouts.insert_one(dict(doc))
    created = await get_workout(doc["id"], user)
    created["suggestions"] = [_suggestion(row) for row in logged]
    return created


@api.get("/workouts/{workout_id}/sets")
async def list_sets(workout_id: str, user: dict = Depends(current_user)):
    w = await db.workouts.find_one({"id": workout_id})
    if not w:
        raise HTTPException(404, "Not found")
    if not await can_access_user_data(user["id"], w["user_id"]):
        raise HTTPException(403, "Not allowed")
    return [
        clean(s) async for s in db.workout_sets.find({"workout_id": workout_id}, {"_id": 0}).sort("set_index", 1)
    ]


@api.post("/workouts/{workout_id}/sets", status_code=201)
async def add_set(workout_id: str, body: SetIn, user: dict = Depends(current_user)):
    w = await db.workouts.find_one({"id": workout_id})
    if not w:
        raise HTTPException(404, "Not found")
    if not await can_access_user_data(user["id"], w["user_id"]):
        raise HTTPException(403, "Not allowed")
    doc = {
        "id": new_id(),
        "workout_id": workout_id,
        **body.model_dump(),
        "created_at": now(),
    }
    await db.workout_sets.insert_one(doc)
    return clean(doc)


# ---- Biomarkers ----------------------------------------------------------- #
@api.get("/biomarkers")
async def list_biomarkers(user: dict = Depends(current_user), owner_id: Optional[str] = None):
    target = owner_id or user["id"]
    if not await can_access_user_data(user["id"], target):
        raise HTTPException(403, "Not allowed")
    return [
        clean(b)
        async for b in db.biomarkers.find({"user_id": target}, {"_id": 0}).sort("measured_at", -1).limit(100)
    ]


@api.post("/biomarkers")
async def add_biomarker(body: BiomarkerIn, user: dict = Depends(require_pro)):
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        **body.model_dump(),
        "measured_at": now(),
        "created_at": now(),
    }
    await db.biomarkers.insert_one(doc)
    return clean(doc)


# ---- Wearable metrics ----------------------------------------------------- #
@api.get("/wearable-metrics")
async def list_wearable(user: dict = Depends(current_user), metric: Optional[str] = None):
    q: dict = {"user_id": user["id"]}
    if metric:
        q["metric"] = metric
    return [
        clean(m)
        async for m in db.wearable_metrics.find(q, {"_id": 0}).sort("recorded_at", -1).limit(200)
    ]


@api.post("/wearable-metrics")
async def add_wearable(body: WearableMetricIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        **body.model_dump(),
        "recorded_at": now(),
        "created_at": now(),
    }
    await db.wearable_metrics.insert_one(doc)
    return clean(doc)


async def light_club_activity(uid: str) -> list[dict]:
    """A short glance at clubs this user belongs to.

    Unread comes from channel_reads when a marker exists, otherwise from
    joined_at, and is capped. Messages, today's check-ins, and open live
    sessions are a window, not a second channel API.
    """
    memberships = [
        row async for row in db.community_members.find(
            {"user_id": uid, "status": "active"},
            {"_id": 0, "community_id": 1, "joined_at": 1},
        ).limit(8)
    ]
    if not memberships:
        return []
    joined = {row["community_id"]: row.get("joined_at") for row in memberships}
    communities = {
        row["id"]: row
        async for row in db.communities.find(
            {"id": {"$in": list(joined)}, "status": {"$ne": "archived"}},
            {"_id": 0, "id": 1, "name": 1},
        )
    }
    if not communities:
        return []
    channels = [
        row async for row in db.channels.find(
            {"community_id": {"$in": list(communities)}, "status": "active"},
            {"_id": 0, "id": 1, "community_id": 1},
        ).limit(48)
    ]
    by_community: dict[str, list[str]] = {cid: [] for cid in communities}
    channel_community: dict[str, str] = {}
    for channel in channels:
        cid = channel.get("community_id")
        if cid not in by_community:
            continue
        by_community[cid].append(channel["id"])
        channel_community[channel["id"]] = cid
    channel_ids = list(channel_community)
    reads = {}
    if channel_ids:
        reads = {
            row["channel_id"]: row.get("last_read_at")
            async for row in db.channel_reads.find(
                {"user_id": uid, "channel_id": {"$in": channel_ids}},
                {"_id": 0, "channel_id": 1, "last_read_at": 1},
            )
        }
    recent: list[dict] = []
    if channel_ids:
        recent = [
            row async for row in db.messages.find(
                {"channel_id": {"$in": channel_ids}, "status": "active"},
                {"_id": 0, "id": 1, "channel_id": 1, "author_id": 1, "content": 1,
                 "created_at": 1, "checkin_day": 1},
            ).sort("created_at", -1).limit(24)
        ]
    today = now().astimezone(timezone.utc).date().isoformat()
    checkins_today = {cid: 0 for cid in communities}
    if channel_ids:
        async for row in db.messages.find(
            {"channel_id": {"$in": channel_ids}, "status": "active", "checkin_day": today},
            {"_id": 0, "channel_id": 1},
        ).limit(80):
            cid = channel_community.get(row["channel_id"])
            if cid:
                checkins_today[cid] += 1
    live_rows: list[dict] = []
    if channel_ids:
        live_rows = [
            row async for row in db.live_sessions.find(
                {"channel_id": {"$in": channel_ids}, "status": {"$in": ["scheduled", "live"]}},
                {"_id": 0, "id": 1, "channel_id": 1, "title": 1, "status": 1, "starts_at": 1},
            ).sort("starts_at", 1).limit(12)
        ]

    activity_by: dict[str, list[dict]] = {cid: [] for cid in communities}
    for row in recent:
        cid = channel_community.get(row["channel_id"])
        if not cid or sum(1 for item in activity_by[cid] if item["type"] != "live") >= 3:
            continue
        kind = "checkin" if row.get("checkin_day") else "message"
        item = {
            "type": kind,
            "id": row.get("id"),
            "channel_id": row["channel_id"],
            "author_id": row.get("author_id"),
            "preview": (row.get("content") or "").strip()[:140],
            "created_at": row.get("created_at"),
        }
        if kind == "checkin":
            item["checkin_day"] = row.get("checkin_day")
        activity_by[cid].append(item)
    for row in live_rows:
        cid = channel_community.get(row["channel_id"])
        if not cid:
            continue
        activity_by[cid].append({
            "type": "live",
            "id": row.get("id"),
            "channel_id": row["channel_id"],
            "title": row.get("title") or "",
            "status": row.get("status"),
            "starts_at": row.get("starts_at"),
        })
        activity_by[cid] = activity_by[cid][:4]

    clubs = []
    for cid, community in communities.items():
        ids = by_community.get(cid) or []
        unread = 0
        if ids:
            ors = []
            for channel_id in ids:
                clause: dict = {"channel_id": channel_id}
                since = reads.get(channel_id) or joined.get(cid)
                if since:
                    clause["created_at"] = {"$gt": since}
                ors.append(clause)
            unread = await db.messages.count_documents(
                {"status": "active", "author_id": {"$ne": uid}, "$or": ors},
                limit=99,
            )
        clubs.append({
            "community_id": cid,
            "name": community.get("name") or "",
            "unread_count": unread,
            "checkins_today": checkins_today.get(cid, 0),
            "activity": activity_by.get(cid) or [],
        })
    clubs.sort(key=lambda row: (-row["unread_count"], row["name"]))
    return clubs


@api.get("/dashboard")
async def dashboard(user: dict = Depends(current_user)):
    """Home aggregate. Same document as GET /home/today."""
    return await home_today_for(user["id"])


@api.get("/home/today")
async def home_today(user: dict = Depends(current_user)):
    """One home call: streak, active workout, next program day, club activity.

    GET /dashboard returns this same document so the existing home client
    does not need a second request. Daily tips still call dashboard_snapshot
    on its own and do not load club activity. ``readiness`` rides on this
    payload; Home does not call GET /readiness/today to paint.
    """
    return await home_today_for(user["id"])


@api.get("/readiness/today")
async def readiness_today(user: dict = Depends(current_user)):
    """Today's IronFlow Readiness for the signed-in athlete.

    The same object is on GET /home/today. This route is optional.
    """
    return await readiness.today_for(db, user["id"], now())


async def dashboard_snapshot(uid: str) -> dict:
    """Shared by /dashboard and the AI coach (daily tips, coach tip)."""
    as_of = now()
    week_ago = as_of - timedelta(days=7)
    workouts_week = await db.workouts.count_documents({"user_id": uid, "started_at": {"$gte": week_ago}})
    latest_strain = await db.wearable_metrics.find_one(
        {"user_id": uid, "metric": "strain"}, {"_id": 0}, sort=[("recorded_at", -1)]
    )
    latest_recovery = await db.wearable_metrics.find_one(
        {"user_id": uid, "metric": "recovery"}, {"_id": 0}, sort=[("recorded_at", -1)]
    )
    latest_sleep = await db.wearable_metrics.find_one(
        {"user_id": uid, "metric": "sleep_hours"}, {"_id": 0}, sort=[("recorded_at", -1)]
    )
    latest_hrv = await db.wearable_metrics.find_one(
        {"user_id": uid, "metric": "hrv"}, {"_id": 0}, sort=[("recorded_at", -1)]
    )
    latest_rhr = await db.wearable_metrics.find_one(
        {"user_id": uid, "metric": "resting_hr"}, {"_id": 0}, sort=[("recorded_at", -1)]
    )

    # ---- training stats (always available, even without a wearable) ------- #
    week_workouts = [
        w async for w in db.workouts.find(
            {"user_id": uid, "started_at": {"$gte": week_ago}},
            {"_id": 0, "id": 1, "started_at": 1, "ended_at": 1, "duration_sec": 1},
        )
    ]
    week_ids = [w["id"] for w in week_workouts]
    sets_week = 0
    tonnage_week = 0.0
    muscles_week: set[str] = set()
    if week_ids:
        exercise_cache: dict[str, dict] = {}
        async for s in db.workout_sets.find({"workout_id": {"$in": week_ids}}, {"_id": 0}):
            sets_week += 1
            tonnage_week += float(s.get("weight_kg") or 0) * int(s.get("reps") or 0)
            ex_id = s.get("exercise_id")
            if ex_id and ex_id not in exercise_cache:
                exercise_cache[ex_id] = await db.exercises.find_one({"id": ex_id}, {"_id": 0}) or {}
            slug = exercise_cache.get(ex_id, {}).get("primary_muscle_slug")
            if slug:
                muscles_week.add(slug)
    minutes_week = sum(int(w.get("duration_sec") or 0) for w in week_workouts) // 60
    load_rows = [
        w async for w in db.workouts.find(
            {
                "user_id": uid,
                "ended_at": {"$type": "date"},
                "started_at": {"$gte": as_of - timedelta(days=28)},
            },
            {
                "_id": 0,
                "started_at": 1,
                "ended_at": 1,
                "duration_sec": 1,
                "perceived_effort": 1,
                "load_au": 1,
            },
        )
    ]
    load_summary = training_load.summarize(load_rows, as_of)

    # Streak: consecutive calendar days (ending today or yesterday) with a workout.
    days_with_workout: set[str] = set()
    async for w in db.workouts.find(
        {"user_id": uid, "started_at": {"$gte": now() - timedelta(days=60)}},
        {"_id": 0, "started_at": 1},
    ):
        if w.get("started_at"):
            days_with_workout.add(w["started_at"].strftime("%Y-%m-%d"))
    streak = 0
    cursor_day = now()
    if cursor_day.strftime("%Y-%m-%d") not in days_with_workout:
        cursor_day -= timedelta(days=1)
    while cursor_day.strftime("%Y-%m-%d") in days_with_workout:
        streak += 1
        cursor_day -= timedelta(days=1)

    active = await db.workouts.find_one(
        {"user_id": uid, "ended_at": None}, {"_id": 0, "id": 1, "title": 1, "started_at": 1},
        sort=[("started_at", -1)],
    )
    wearable_connected = bool(latest_strain or latest_recovery or latest_sleep or latest_hrv)

    return {
        "workouts_this_week": workouts_week,
        "strain": clean(latest_strain),
        "recovery": clean(latest_recovery),
        "sleep": clean(latest_sleep),
        "hrv": clean(latest_hrv),
        "resting_hr": clean(latest_rhr),
        "wearable_connected": wearable_connected,
        "training": {
            "sets_week": sets_week,
            "tonnage_week_kg": round(tonnage_week, 1),
            "minutes_week": minutes_week,
            "muscles_week": sorted(muscles_week),
            "streak_days": streak,
            **load_summary,
        },
        "active_workout": clean(active),
    }


# ---- Coach relationships -------------------------------------------------- #
@api.get("/coach/relationships")
async def list_relationships(user: dict = Depends(current_user)):
    docs = db.coach_relationships.find(
        {"$or": [{"coach_id": user["id"]}, {"client_id": user["id"]}]},
        {"_id": 0},
    )
    out = []
    async for rel in docs:
        peer_id = rel["client_id"] if rel["coach_id"] == user["id"] else rel["coach_id"]
        peer = await db.users.find_one({"id": peer_id}, {"_id": 0, "password_hash": 0})
        rel["peer"] = clean(peer)
        out.append(clean(rel))
    return out


@api.post("/coach/request")
async def request_coach(body: CoachRequestIn, user: dict = Depends(current_user)):
    """Coach invites a client by email."""
    if user.get("role") != "coach":
        raise HTTPException(403, "Only coaches can invite clients")
    client_user = await db.users.find_one({"email": body.client_email.lower()})
    if not client_user:
        raise HTTPException(404, "Client not found")
    existing = await db.coach_relationships.find_one(
        {"coach_id": user["id"], "client_id": client_user["id"]}
    )
    if existing:
        return clean(existing)
    doc = {
        "id": new_id(),
        "coach_id": user["id"],
        "client_id": client_user["id"],
        "status": "pending",
        "started_at": now(),
        "created_at": now(),
    }
    await db.coach_relationships.insert_one(doc)
    return clean(doc)


@api.patch("/coach/relationships/{rel_id}")
async def update_relationship(rel_id: str, body: CoachStatusIn, user: dict = Depends(current_user)):
    rel = await db.coach_relationships.find_one({"id": rel_id})
    if not rel:
        raise HTTPException(404, "Not found")
    # Coach can update any; client can only accept (pending -> active) or end
    is_coach = rel["coach_id"] == user["id"]
    is_client = rel["client_id"] == user["id"]
    if not (is_coach or is_client):
        raise HTTPException(403, "Not allowed")
    if is_client and body.status not in ("active", "ended"):
        raise HTTPException(403, "Client can only accept or end")
    await db.coach_relationships.update_one({"id": rel_id}, {"$set": {"status": body.status}})
    updated = await db.coach_relationships.find_one({"id": rel_id}, {"_id": 0})
    return clean(updated)


# ---- Group sessions ------------------------------------------------------- #
@api.get("/group-sessions")
async def list_sessions(user: dict = Depends(current_user)):
    return [
        clean(s)
        async for s in db.group_sessions.find({}, {"_id": 0}).sort("starts_at", 1).limit(50)
    ]


@api.post("/group-sessions")
async def create_session(body: GroupSessionIn, user: dict = Depends(current_user)):
    if user.get("role") != "coach":
        raise HTTPException(403, "Only coaches can create group sessions")
    doc = {
        "id": new_id(),
        "coach_id": user["id"],
        **body.model_dump(),
        "stream_url": None,
        "status": "scheduled",
        "created_at": now(),
    }
    await db.group_sessions.insert_one(doc)
    return clean(doc)


# ---- Subscriptions + payouts + referrals ---------------------------------- #
@api.get("/subscriptions/current")
async def current_sub(user: dict = Depends(current_user)):
    sub = await db.subscriptions.find_one(
        {"user_id": user["id"], "status": {"$in": ["active", "trialing", "past_due"]}},
        {"_id": 0},
    )
    if not sub:
        return {"plan": "free", "status": "active"}
    for key in ("currency", "amount_cents", "current_period_end"):
        sub.setdefault(key, None)
    return clean(sub)


@api.post("/subscriptions")
async def upsert_sub(body: SubscriptionIn, user: dict = Depends(current_user)):
    if body.plan != "free":
        raise HTTPException(402, "Verified billing is required to activate a paid plan")
    existing = await db.subscriptions.find_one({"user_id": user["id"], "status": "active"}, {"_id": 0})
    if existing and existing.get("plan") != "free":
        raise HTTPException(409, "Paid subscriptions must be canceled through verified billing")
    return clean(existing) if existing else {"plan": "free", "status": "active"}


# ---- Progression & muscle heatmap ---------------------------------------- #
def _epley_1rm(weight: float, reps: int) -> float:
    if reps <= 0:
        return 0.0
    if reps == 1:
        return weight
    return round(weight * (1 + reps / 30.0), 1)


@api.get("/progression/{exercise_id}")
async def progression(exercise_id: str, user: dict = Depends(current_user)):
    """Per-exercise series: best e1RM and tonnage per workout, plus current PR."""
    # single pass: map of the user's workouts
    workouts_map = {
        w["id"]: w async for w in db.workouts.find({"user_id": user["id"]}, {"_id": 0})
    }
    workout_ids = list(workouts_map.keys())
    if not workout_ids:
        return {"series": [], "pr": None}
    series: list[dict] = []
    pr = {"e1rm": 0.0, "weight_kg": 0.0, "reps": 0, "date": None}
    # gather sets for this exercise
    async for s in db.workout_sets.find(
        {"workout_id": {"$in": workout_ids}, "exercise_id": exercise_id}, {"_id": 0}
    ):
        w = workouts_map.get(s["workout_id"])
        if not w or not s.get("weight_kg") or not s.get("reps"):
            continue
        e1rm = _epley_1rm(s["weight_kg"], s["reps"])
        tonnage = s["weight_kg"] * s["reps"]
        date_key = w["started_at"].strftime("%Y-%m-%d") if w.get("started_at") else "unknown"
        # bucket per day
        bucket = next((x for x in series if x["date"] == date_key), None)
        if not bucket:
            bucket = {"date": date_key, "best_e1rm": 0.0, "tonnage": 0.0, "sets": 0}
            series.append(bucket)
        bucket["best_e1rm"] = max(bucket["best_e1rm"], e1rm)
        bucket["tonnage"] += tonnage
        bucket["sets"] += 1
        if e1rm > pr["e1rm"]:
            pr = {
                "e1rm": e1rm,
                "weight_kg": s["weight_kg"],
                "reps": s["reps"],
                "date": date_key,
            }
    series.sort(key=lambda x: x["date"])
    return {"series": series, "pr": pr if pr["e1rm"] > 0 else None}


# --------------------------------------------------------------------------- #
# Feature routers (import late: they import shared helpers from this module)  #
import analytics  # noqa: E402
from routers.labs import router as labs_router  # noqa: E402
from routers.recordings import router as recordings_router  # noqa: E402
from routers.trends import router as trends_router  # noqa: E402
from routers.community import router as community_router  # noqa: E402
from routers.muscles import router as muscles_router  # noqa: E402
from routers.program import next_planned_session, router as program_router  # noqa: E402
from routers.coach_chat import router as coach_chat_router  # noqa: E402
from weekly_review import router as weekly_review_router  # noqa: E402
from routers.wearables import router as wearables_router  # noqa: E402
from routers.gyms import ensure_indexes as ensure_gym_indexes  # noqa: E402
from weekly_review import ensure_indexes as ensure_weekly_indexes  # noqa: E402
from routers.gyms import router as gyms_router  # noqa: E402
from routers.social import router as social_router  # noqa: E402
from routers.admin import router as admin_router  # noqa: E402
from routers.tickets import router as tickets_router  # noqa: E402
from routers.analytics import router as analytics_router  # noqa: E402
from routers.notifications import router as notifications_router  # noqa: E402
from routers.search import router as search_router  # noqa: E402
from tips import router as tips_router  # noqa: E402
from revenuecat import router as revenuecat_router  # noqa: E402


async def home_today_for(uid: str) -> dict:
    """Dashboard snapshot plus the next program day and a light club glance.

    Tips keep calling dashboard_snapshot directly so a coach sentence does
    not scan communities.
    """
    snap = await dashboard_snapshot(uid)
    snap["next_session"] = await next_planned_session(uid)
    snap["clubs"] = await light_club_activity(uid)
    snap["readiness"] = await readiness.today_for(db, uid, now())
    return snap


api.include_router(program_router)
api.include_router(coach_chat_router)
api.include_router(weekly_review_router)
api.include_router(community_router)
api.include_router(social_router)
api.include_router(admin_router)
api.include_router(tickets_router)
api.include_router(analytics_router)
api.include_router(labs_router)
api.include_router(recordings_router)
api.include_router(trends_router)
api.include_router(notifications_router)
api.include_router(search_router)
api.include_router(wearables_router)
api.include_router(gyms_router)
api.include_router(muscles_router)
api.include_router(tips_router)
api.include_router(revenuecat_router)

app.include_router(api)
# Bundled local files (exercise posters) stay served even when uploads go to S3/R2.
if True:
    media_storage.MEDIA_ROOT.mkdir(exist_ok=True)
    app.mount("/api/media/files", StaticFiles(directory=media_storage.MEDIA_ROOT), name="media")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
