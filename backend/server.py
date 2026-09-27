"""
IronFlow — FastAPI backend mirroring the Supabase schema in MongoDB.

Access control mirrors Row Level Security:
- A user reads/writes only their own health rows.
- A coach reads/writes a client's rows only if there is an active
  coach_relationship between them.
"""
from __future__ import annotations

import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from jwt import InvalidTokenError
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

import media_storage
from locales import DEFAULT_LOCALE, SUPPORTED_LOCALES, normalize_locale

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# --------------------------------------------------------------------------- #
# Config                                                                      #
# --------------------------------------------------------------------------- #
mongo_url = os.environ["MONGO_URL"]
db_name = os.environ.get("DB_NAME", "ironflow")
JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_hex(32)
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 30  # 30 days

# tz_aware: Mongo stores UTC; without this, reads come back naive and break
# arithmetic against now() (timezone-aware) — e.g. muscle recovery ages.
client = AsyncIOMotorClient(mongo_url, tz_aware=True)
db = client[db_name]

bearer = HTTPBearer(auto_error=False)

logger = logging.getLogger("ironflow")
logging.basicConfig(level=logging.INFO)


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


class ProfileUpdateIn(BaseModel):
    preferred_locale: str | None = Field(default=None, pattern=f"^({'|'.join(SUPPORTED_LOCALES)})$")
    activity_ranking_opt_in: bool | None = None
    #: A private account converts incoming follows into requests.
    is_private: bool | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=80)
    bio: str | None = Field(default=None, max_length=300)
    #: An image uploaded through /media first; only the uploader's own counts.
    avatar_media_id: str | None = None
    #: True clears the avatar.
    remove_avatar: bool | None = None


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
    await db.workout_sets.create_index([("workout_id", 1), ("set_index", 1)])
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
    await db.live_rsvps.create_index([("session_id", 1), ("user_id", 1)], unique=True)
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
    await db.push_tokens.create_index("token", unique=True)
    await db.push_tokens.create_index("user_id")
    await db.community_invites.create_index("code", unique=True)
    await db.community_invites.create_index([("community_id", 1), ("revoked_at", 1), ("created_at", -1)])
    await db.rate_limits.create_index("key", unique=True)
    # TTL: a window's counter deletes itself once the window has passed.
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.direct_messages.create_index([("thread_key", 1), ("created_at", -1)])
    await db.direct_messages.create_index([("recipient_id", 1), ("read_at", 1)])
    await db.media.create_index([("user_id", 1), ("created_at", -1)])
    await db.reports.create_index([("status", 1), ("created_at", 1)])
    await db.reports.create_index([("reporter_id", 1), ("target_id", 1), ("status", 1)])
    await db.audit_log.create_index([("created_at", -1)])
    await db.audit_log.create_index([("target_id", 1), ("created_at", -1)])
    # Product analytics: unique event id, and name+ts for the 24h / 7d rollup.
    await analytics.ensure_indexes(db)
    await db.user_notes.create_index([("user_id", 1), ("created_at", -1)])
    # Read by _roles() on every permission resolve — the hot path for each
    # channel read and message write, so it must never be a collection scan.
    await db.community_roles.create_index([("community_id", 1), ("rank", 1)])
    await db.community_roles.create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("read_at", 1)])
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
api = APIRouter(prefix="/api")


# ---- Health --------------------------------------------------------------- #
@api.get("/")
async def root():
    return {"service": "ironflow", "status": "ok"}


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


@api.patch("/auth/me", response_model=PublicUser)
async def update_me(body: ProfileUpdateIn, user: dict = Depends(current_user)):
    updates = body.model_dump(exclude_none=True)
    media_id = updates.pop("avatar_media_id", None)
    if updates.pop("remove_avatar", None):
        updates["avatar_url"] = None
    if media_id:
        media = await db.media.find_one(
            {"id": media_id, "user_id": user["id"], "kind": "image"}, {"_id": 0, "url": 1})
        if not media:
            raise HTTPException(422, "Unknown image")
        updates["avatar_url"] = media["url"]
    if "full_name" in updates:
        updates["full_name"] = updates["full_name"].strip()
    if "bio" in updates:
        updates["bio"] = updates["bio"].strip()
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
    ended = now()
    duration = int((ended - w["started_at"]).total_seconds()) if w.get("started_at") else 0
    await db.workouts.update_one(
        {"id": workout_id}, {"$set": {"ended_at": ended, "duration_sec": duration}}
    )
    updated = await db.workouts.find_one({"id": workout_id}, {"_id": 0})
    return clean(updated)


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
async def add_biomarker(body: BiomarkerIn, user: dict = Depends(current_user)):
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


@api.get("/dashboard")
async def dashboard(user: dict = Depends(current_user)):
    """Aggregated glanceable stats for the Home screen."""
    return await dashboard_snapshot(user["id"])


async def dashboard_snapshot(uid: str) -> dict:
    """Shared by /dashboard and the AI coach (daily tips, coach tip)."""
    week_ago = now() - timedelta(days=7)
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
        {"user_id": user["id"], "status": "active"}, {"_id": 0}
    )
    if not sub:
        return {"plan": "free", "status": "active"}
    return clean(sub)


@api.post("/subscriptions")
async def upsert_sub(body: SubscriptionIn, user: dict = Depends(current_user)):
    if body.plan != "free":
        raise HTTPException(402, "Verified billing is required to activate a paid plan")
    existing = await db.subscriptions.find_one({"user_id": user["id"], "status": "active"}, {"_id": 0})
    if existing and existing.get("plan") != "free":
        raise HTTPException(409, "Paid subscriptions must be canceled through verified billing")
    return clean(existing) if existing else {"plan": "free", "status": "active"}


@api.get("/referrals/mine")
async def my_referrals(user: dict = Depends(current_user)):
    my_ref = await db.referrals.find_one({"referrer_id": user["id"]}, {"_id": 0})
    if not my_ref:
        my_ref = {
            "id": new_id(),
            "referrer_id": user["id"],
            "referred_id": None,
            "code": secrets.token_urlsafe(6).upper(),
            "status": "pending",
            "reward_amount_cents": 0,
            "reward_currency": "EUR",
            "created_at": now(),
        }
        await db.referrals.insert_one(dict(my_ref))
    return clean(my_ref)


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
from routers.community import router as community_router  # noqa: E402
from routers.muscles import router as muscles_router  # noqa: E402
from routers.program import router as program_router  # noqa: E402
from routers.wearables import router as wearables_router  # noqa: E402
from routers.social import router as social_router  # noqa: E402
from routers.admin import router as admin_router  # noqa: E402
from routers.analytics import router as analytics_router  # noqa: E402
from routers.notifications import router as notifications_router  # noqa: E402
from routers.search import router as search_router  # noqa: E402
from tips import router as tips_router  # noqa: E402

api.include_router(program_router)
api.include_router(community_router)
api.include_router(social_router)
api.include_router(admin_router)
api.include_router(analytics_router)
api.include_router(labs_router)
api.include_router(notifications_router)
api.include_router(search_router)
api.include_router(wearables_router)
api.include_router(muscles_router)
api.include_router(tips_router)

app.include_router(api)
if not media_storage.s3_enabled():
    media_storage.MEDIA_ROOT.mkdir(exist_ok=True)
    app.mount("/api/media/files", StaticFiles(directory=media_storage.MEDIA_ROOT), name="media")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
