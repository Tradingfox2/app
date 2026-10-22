"""Progress & rewards API: XP, levels, streaks, badges, challenges, leagues, cups.

All reads sync first (idempotent), so activity from any source — a finished
workout, a gym check-in, a wearable step day — shows up without each source
having to know about gamification.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import gamification as g
from gamification_config import BADGES, CONFIG
from server import clean, current_user, db, new_id

router = APIRouter()


def _db():
    import server  # follow tests that patch server.db

    return server.db


class GoalIn(BaseModel):
    weekly_goal_workouts: Optional[int] = Field(default=None, ge=1, le=7)
    weekly_goal_steps: Optional[int] = Field(default=None, ge=5000, le=200000)
    leagues_opt_out: Optional[bool] = None


class FrameIn(BaseModel):
    frame: str = Field(min_length=1, max_length=32)


class SeenIn(BaseModel):
    until: Optional[datetime] = None


class ChallengeIn(BaseModel):
    kind: Literal["friends", "club", "coach"]
    title: str = Field(min_length=3, max_length=80)
    metric: Literal["workouts", "active_days", "minutes", "steps", "xp"]
    target: int = Field(ge=1, le=10_000_000)
    starts_at: datetime
    ends_at: datetime
    community_id: Optional[str] = None
    invitees: list[str] = Field(default_factory=list, max_length=200)
    xp_reward: Optional[int] = Field(default=None, ge=0, le=500)


@router.get("/progress")
async def progress(user: dict = Depends(current_user)):
    return clean(await g.Progress.summary(_db(), user["id"]))


@router.get("/progress/config")
async def progress_config(user: dict = Depends(current_user)):
    return {"xp": CONFIG["xp"], "caps": CONFIG["caps"], "stages": CONFIG["stages"],
            "levels": [{"level": n, "xp": g.Levels.threshold(n)} for n in range(1, 51)],
            "badges": [{"id": b, "metric": m, "threshold": t, "xp": x} for b, m, t, x in BADGES],
            "league": CONFIG["league"], "streak": CONFIG["streak"]}


@router.get("/progress/ledger")
async def progress_ledger(limit: int = 50, user: dict = Depends(current_user)):
    return clean({"items": await g.Ledger.recent(_db(), user["id"], max(1, min(limit, 200)))})


@router.put("/progress/goal")
async def set_goal(body: GoalIn, user: dict = Depends(current_user)):
    database = _db()
    await g.Ledger.ensure_indexes(database)
    await g.Profiles.get(database, user["id"])
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if fields:
        await g.Profiles.set(database, user["id"], fields)
    return clean(await g.Profiles.get(database, user["id"]))


@router.post("/progress/celebrations/seen")
async def celebrations_seen(body: SeenIn, user: dict = Depends(current_user)):
    database = _db()
    await g.Profiles.get(database, user["id"])
    until = g.aware(body.until) if body.until else g.utcnow()
    await g.Profiles.set(database, user["id"], {"seen_until": min(until, g.utcnow())})
    return {"ok": True}


@router.get("/progress/rewards")
async def rewards(user: dict = Depends(current_user)):
    database = _db()
    synced = await g.Progress.sync(database, user["id"])
    profile = await g.Profiles.get(database, user["id"])
    return clean(await g.Rewards.catalogue(database, user["id"], synced["profile"]["level"], profile))


@router.post("/progress/frame")
async def choose_frame(body: FrameIn, user: dict = Depends(current_user)):
    database = _db()
    profile = await g.Profiles.get(database, user["id"])
    frames = {f["id"]: f for f in g.Rewards.frames_for(int(profile.get("level") or 1))}
    if body.frame not in frames:
        raise HTTPException(404, "Unknown frame")
    if not frames[body.frame]["unlocked"]:
        raise HTTPException(403, "Frame not unlocked yet")
    await g.Profiles.set(database, user["id"], {"frame": body.frame})
    return {"frame": body.frame}


# ---- Challenges ------------------------------------------------------------ #
@router.get("/progress/challenges")
async def list_challenges(user: dict = Depends(current_user)):
    database = _db()
    now = g.utcnow()
    await g.Ledger.ensure_indexes(database)
    await g.Challenges.ensure_solo(database, user["id"], now)
    clubs = await database.community_members.distinct("community_id", {"user_id": user["id"], "status": "active"})
    query = {"ends_at": {"$gt": now - timedelta(days=7)}, "$or": [
        {"kind": "solo", "creator_id": user["id"]},
        {"kind": {"$in": ["friends", "coach"]}, "$or": [{"creator_id": user["id"]}, {"invitees": user["id"]}]},
        {"kind": "club", "community_id": {"$in": clubs}},
    ]}
    out = [await g.Challenges.view(database, user["id"], ch, now)
           async for ch in database.progress_challenges.find(query, {"_id": 0}).sort("ends_at", 1).limit(50)]
    return clean({"items": out})


@router.post("/progress/challenges", status_code=201)
async def create_challenge(body: ChallengeIn, user: dict = Depends(current_user)):
    database = _db()
    await g.Ledger.ensure_indexes(database)
    starts, ends = g.aware(body.starts_at), g.aware(body.ends_at)
    if ends <= starts or ends - starts > timedelta(days=CONFIG["challenges"]["max_days"]):
        raise HTTPException(422, f"A challenge must end after it starts and last at most {CONFIG['challenges']['max_days']} days")
    if ends <= g.utcnow():
        raise HTTPException(422, "A challenge must end in the future")
    invitees = sorted(set(body.invitees) - {user["id"]})
    community_id = None
    if body.kind == "friends":
        if len(invitees) > CONFIG["challenges"]["max_friends"]:
            raise HTTPException(422, "Too many friends invited")
        follows = set(await database.follows.distinct("followee_id", {"follower_id": user["id"], "status": {"$ne": "pending"}})) if invitees else set()
        followers = set(await database.follows.distinct("follower_id", {"followee_id": user["id"], "status": {"$ne": "pending"}})) if invitees else set()
        if set(invitees) - (follows | followers):
            raise HTTPException(403, "You can only invite people you follow or who follow you")
    elif body.kind == "club":
        membership = await database.community_members.find_one(
            {"community_id": body.community_id, "user_id": user["id"], "status": "active",
             "role": {"$in": ["owner", "moderator", "admin"]}}, {"_id": 0})
        if not body.community_id or not membership:
            raise HTTPException(403, "Only a club owner or moderator can create a club challenge")
        community_id, invitees = body.community_id, []
    else:  # coach
        clients = set(await database.coach_relationships.distinct(
            "client_id", {"coach_id": user["id"], "status": "active"}))
        if not clients or not invitees or set(invitees) - clients:
            raise HTTPException(403, "A coach challenge can only include your active clients")
    doc = {"id": new_id(), "kind": body.kind, "title": body.title.strip(), "metric": body.metric,
           "target": body.target, "xp_reward": body.xp_reward if body.xp_reward is not None else CONFIG["xp"]["challenge_default"],
           "starts_at": starts, "ends_at": ends, "creator_id": user["id"], "community_id": community_id,
           "invitees": invitees, "created_at": g.utcnow()}
    await database.progress_challenges.insert_one(dict(doc))
    if body.kind != "coach":
        await database.progress_challenge_members.update_one(
            {"challenge_id": doc["id"], "user_id": user["id"]},
            {"$setOnInsert": {"challenge_id": doc["id"], "user_id": user["id"], "joined_at": g.utcnow()}}, upsert=True)
    return clean(await g.Challenges.view(database, user["id"], doc, g.utcnow()))


async def _challenge_for(database, challenge_id: str, user_id: str) -> dict:
    ch = await database.progress_challenges.find_one({"id": challenge_id}, {"_id": 0})
    if not ch or not await g.Challenges.visible_to(database, user_id, ch):
        raise HTTPException(404, "Challenge not found")
    return ch


@router.post("/progress/challenges/{challenge_id}/join")
async def join_challenge(challenge_id: str, user: dict = Depends(current_user)):
    database = _db()
    ch = await _challenge_for(database, challenge_id, user["id"])
    if ch["kind"] == "solo":
        raise HTTPException(409, "Personal challenges are always on")
    if g.aware(ch["ends_at"]) <= g.utcnow():
        raise HTTPException(409, "This challenge has ended")
    await database.progress_challenge_members.update_one(
        {"challenge_id": challenge_id, "user_id": user["id"]},
        {"$setOnInsert": {"challenge_id": challenge_id, "user_id": user["id"], "joined_at": g.utcnow()}}, upsert=True)
    return clean(await g.Challenges.view(database, user["id"], ch, g.utcnow()))


@router.post("/progress/challenges/{challenge_id}/leave")
async def leave_challenge(challenge_id: str, user: dict = Depends(current_user)):
    database = _db()
    await _challenge_for(database, challenge_id, user["id"])
    await database.progress_challenge_members.delete_one({"challenge_id": challenge_id, "user_id": user["id"]})
    return {"ok": True}


@router.get("/progress/challenges/{challenge_id}")
async def challenge_detail(challenge_id: str, user: dict = Depends(current_user)):
    database = _db()
    ch = await _challenge_for(database, challenge_id, user["id"])
    view = await g.Challenges.view(database, user["id"], ch, g.utcnow())
    view["leaderboard"] = await g.Challenges.leaderboard(database, ch) if ch["kind"] != "solo" else []
    return clean(view)


# ---- Leagues & cups -------------------------------------------------------- #
@router.get("/progress/league")
async def league(user: dict = Depends(current_user)):
    database = _db()
    await g.Progress.sync(database, user["id"])
    profile = await g.Profiles.get(database, user["id"])
    return clean(await g.Leagues.view(database, user["id"], profile, g.utcnow()))


@router.get("/progress/cups")
async def cups(user: dict = Depends(current_user)):
    database = _db()
    await g.Ledger.ensure_indexes(database)
    return clean(await g.Cups.view(database, user["id"], g.utcnow()))
