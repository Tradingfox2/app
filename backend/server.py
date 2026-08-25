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
from jwt import InvalidTokenError
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

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

client = AsyncIOMotorClient(mongo_url)
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
    avatar_url: Optional[str] = None


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


class PostIn(BaseModel):
    content: str
    community_id: Optional[str] = None
    workout_id: Optional[str] = None
    media_urls: list[str] = []


class CommunityIn(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    is_public: bool = True


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
    return user


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
        avatar_url=u.get("avatar_url"),
    )


# --------------------------------------------------------------------------- #
# App + routes                                                                #
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.exercises.create_index("slug", unique=True)
    await db.muscles.create_index("slug", unique=True)
    await db.workouts.create_index([("user_id", 1), ("started_at", -1)])
    await db.workout_sets.create_index([("workout_id", 1), ("set_index", 1)])
    await db.biomarkers.create_index([("user_id", 1), ("measured_at", -1)])
    await db.wearable_metrics.create_index(
        [("user_id", 1), ("metric", 1), ("recorded_at", -1)]
    )
    await db.coach_relationships.create_index(
        [("coach_id", 1), ("client_id", 1)], unique=True
    )
    await db.posts.create_index([("created_at", -1)])
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
        "role": body.role,
        "avatar_url": None,
        "created_at": now(),
    }
    await db.users.insert_one(user_doc)
    return TokenOut(access_token=make_token(user_doc["id"]), user=to_public_user(user_doc))


@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return TokenOut(access_token=make_token(user["id"]), user=to_public_user(user))


@api.get("/auth/me", response_model=PublicUser)
async def me(user: dict = Depends(current_user)):
    return to_public_user(user)


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


@api.post("/workouts")
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
        "created_at": now(),
    }
    await db.workouts.insert_one(doc)
    return clean(doc)


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


@api.post("/workouts/{workout_id}/sets")
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
    uid = user["id"]
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
    return {
        "workouts_this_week": workouts_week,
        "strain": clean(latest_strain),
        "recovery": clean(latest_recovery),
        "sleep": clean(latest_sleep),
        "hrv": clean(latest_hrv),
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


@api.get("/coaches")
async def list_coaches():
    return [
        clean(c)
        async for c in db.users.find({"role": "coach"}, {"_id": 0, "password_hash": 0}).limit(50)
    ]


# ---- Communities + posts + sessions --------------------------------------- #
@api.get("/communities")
async def list_communities():
    return [clean(c) async for c in db.communities.find({"is_public": True}, {"_id": 0}).limit(50)]


@api.post("/communities")
async def create_community(body: CommunityIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "owner_id": user["id"],
        **body.model_dump(),
        "cover_url": None,
        "created_at": now(),
    }
    await db.communities.insert_one(doc)
    return clean(doc)


@api.get("/posts")
async def list_posts(community_id: Optional[str] = None, user: dict = Depends(current_user)):
    q: dict = {}
    if community_id:
        q["community_id"] = community_id
    else:
        q["community_id"] = None
    posts = [p async for p in db.posts.find(q, {"_id": 0}).sort("created_at", -1).limit(50)]
    # attach author
    for p in posts:
        author = await db.users.find_one({"id": p["author_id"]}, {"_id": 0, "password_hash": 0})
        p["author"] = clean(author)
    return [clean(p) for p in posts]


@api.post("/posts")
async def create_post(body: PostIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "author_id": user["id"],
        **body.model_dump(),
        "like_count": 0,
        "comment_count": 0,
        "created_at": now(),
    }
    await db.posts.insert_one(doc)
    doc["author"] = to_public_user(user).model_dump()
    return clean(doc)


@api.get("/group-sessions")
async def list_sessions():
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
    await db.subscriptions.update_many(
        {"user_id": user["id"], "status": "active"},
        {"$set": {"status": "canceled"}},
    )
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "plan": body.plan,
        "status": "active",
        "current_period_start": now(),
        "current_period_end": now() + timedelta(days=30),
        "created_at": now(),
    }
    await db.subscriptions.insert_one(doc)
    return clean(doc)


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
    # find all workouts by user
    workout_ids = [w["id"] async for w in db.workouts.find({"user_id": user["id"]}, {"_id": 0, "id": 1})]
    if not workout_ids:
        return {"series": [], "pr": None}
    workouts_map = {}
    async for w in db.workouts.find({"id": {"$in": workout_ids}}, {"_id": 0}):
        workouts_map[w["id"]] = w
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


@api.get("/muscle-heatmap")
async def muscle_heatmap(user: dict = Depends(current_user)):
    """Volume (sets × weight) per muscle over the last 7 days."""
    week_ago = now() - timedelta(days=7)
    recent_workouts = [
        w["id"]
        async for w in db.workouts.find(
            {"user_id": user["id"], "started_at": {"$gte": week_ago}}, {"_id": 0, "id": 1}
        )
    ]
    if not recent_workouts:
        return {"volumes": {}, "max": 0}
    ex_cache: dict[str, dict] = {}
    volumes: dict[str, float] = {}
    async for s in db.workout_sets.find(
        {"workout_id": {"$in": recent_workouts}}, {"_id": 0}
    ):
        ex_id = s["exercise_id"]
        if ex_id not in ex_cache:
            ex = await db.exercises.find_one({"id": ex_id}, {"_id": 0})
            ex_cache[ex_id] = ex or {}
        ex = ex_cache[ex_id]
        weight = s.get("weight_kg") or 0
        reps = s.get("reps") or 1
        vol = max(weight * reps, 1)  # even bodyweight counts as 1 unit / set
        primary = ex.get("primary_muscle_slug")
        if primary:
            volumes[primary] = volumes.get(primary, 0) + vol
        for sec in ex.get("secondary_muscle_slugs", []) or []:
            volumes[sec] = volumes.get(sec, 0) + vol * 0.5
    return {"volumes": volumes, "max": max(volumes.values()) if volumes else 0}


# --------------------------------------------------------------------------- #
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
