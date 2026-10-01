"""Save a finished outdoor recording.

The phone sends GPS points and a moving time. This router computes distance
and keeps the route. It does not open a workout, write wearable_metrics, or
trust a distance sent by the client.

Keep the ceilings, the 20 second gap, and the 0.5 m jitter floor in step
with `frontend/src/recorder-math.ts`.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

import analytics
import server

router = APIRouter()

Sport = Literal["walk", "run", "ride", "hike", "tennis", "mtb", "paddle", "sail"]
GpsProfile = Literal["fine", "coarse"]

# (gps profile, max speed m/s). Hike is the coarse track. The others are names
# on the same recorder.
PROFILES: dict[str, tuple[GpsProfile, float]] = {
    "walk": ("fine", 6.0),
    "run": ("fine", 12.0),
    "ride": ("fine", 35.0),
    "hike": ("coarse", 4.0),
    "tennis": ("fine", 10.0),
    "mtb": ("fine", 25.0),
    "paddle": ("fine", 8.0),
    "sail": ("fine", 20.0),
}
TITLES = {
    "walk": "Walk",
    "run": "Run",
    "ride": "Ride",
    "hike": "Hike",
    "tennis": "Tennis",
    "mtb": "MTB",
    "paddle": "Paddle",
    "sail": "Sail",
}
GAP_SEC = 20.0
JITTER_M = 0.5
MAX_POINTS = 8000
EARTH_M = 6_371_000.0


class RoutePointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float
    lng: float
    t: datetime
    acc: float | None = None


class RouteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segments: list[list[RoutePointIn]] = Field(default_factory=list, max_length=500)


class RecordedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")
    kind: Sport
    title: str | None = Field(default=None, max_length=80)
    started_at: datetime
    ended_at: datetime
    moving_sec: int = Field(ge=1, le=86_400)
    steps: int | None = Field(default=None, ge=1, le=200_000)
    elevation_gain_m: float | None = Field(default=None, ge=0, le=20_000)
    gps_profile: GpsProfile
    route: RouteIn | None = None


def _db():
    return server.db


def _aware(value: datetime, label: str) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise HTTPException(422, f"{label} needs a timezone")
    return value.astimezone(timezone.utc)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = p2 - p1
    dlng = math.radians(lng2 - lng1)
    h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_M * math.asin(min(1.0, math.sqrt(h)))


def _point(raw: RoutePointIn) -> dict:
    if not math.isfinite(raw.lat) or not math.isfinite(raw.lng):
        raise HTTPException(422, "A GPS point is not a real coordinate")
    if raw.lat < -90 or raw.lat > 90 or raw.lng < -180 or raw.lng > 180:
        raise HTTPException(422, "A GPS point is outside the map")
    if raw.acc is not None and (not math.isfinite(raw.acc) or raw.acc < 0):
        raise HTTPException(422, "GPS accuracy is not a real reading")
    return {"lat": raw.lat, "lng": raw.lng, "t": _aware(raw.t, "GPS time"), "acc": raw.acc}


def measure(kind: str, segments: list[list[dict]]) -> tuple[float | None, list[list[dict]]]:
    """Distance inside segments only. Drops jumps and does not bridge a gap."""
    profile, max_speed = PROFILES[kind]
    ceiling = 50.0 if profile == "coarse" else 25.0
    kept: list[list[dict]] = []
    distance = 0.0
    saw = False
    accepted = 0
    previous_end: datetime | None = None

    for segment in segments:
        current: list[dict] = []
        last_t: datetime | None = None
        for point in segment:
            if accepted >= MAX_POINTS:
                raise HTTPException(422, "Too many GPS points")
            if last_t is not None and point["t"] <= last_t:
                raise HTTPException(422, "GPS times must move forward")
            if previous_end is not None and not current and point["t"] < previous_end:
                raise HTTPException(422, "GPS times must move forward")
            last_t = point["t"]
            acc = point["acc"]
            if acc is not None and acc > ceiling:
                continue
            if not current:
                current = [point]
                accepted += 1
                continue
            previous = current[-1]
            dt = (point["t"] - previous["t"]).total_seconds()
            if dt > GAP_SEC:
                kept.append(current)
                current = [point]
                accepted += 1
                continue
            meters = haversine_m(previous["lat"], previous["lng"], point["lat"], point["lng"])
            if dt <= 0 or meters / dt > max_speed:
                continue
            if meters < JITTER_M:
                current[-1] = point
                accepted += 1
                continue
            current.append(point)
            distance += meters
            saw = True
            accepted += 1
        if current:
            previous_end = current[-1]["t"]
            kept.append(current)

    route = []
    for segment in kept:
        if len(segment) < 2:
            continue
        route.append([
            {
                "lat": round(point["lat"], 6),
                "lng": round(point["lng"], 6),
                "t": point["t"],
                "acc": point["acc"],
            }
            for point in segment
        ])
    measured = round(distance, 2) if saw else None
    return measured, route


def _title(kind: str, raw: str | None) -> str:
    if raw is not None and raw.strip():
        return raw.strip()
    return TITLES[kind]


@router.post("/workouts/recorded", status_code=201)
async def record_workout(body: RecordedIn, user: dict = Depends(server.current_user)):
    started = _aware(body.started_at, "Start")
    ended = _aware(body.ended_at, "End")
    current = server.now()
    if ended <= started:
        raise HTTPException(422, "End must be after the start")
    elapsed = (ended - started).total_seconds()
    if elapsed > 24 * 3600:
        raise HTTPException(422, "A recording cannot be longer than 24 hours")
    if body.moving_sec > elapsed + 1:
        raise HTTPException(422, "Moving time is longer than the recording")
    if started < current - timedelta(days=7):
        raise HTTPException(422, "Recording is older than 7 days")
    if ended > current + timedelta(minutes=5):
        raise HTTPException(422, "Recording ends in the future")
    expected, _speed = PROFILES[body.kind]
    if body.gps_profile != expected:
        raise HTTPException(422, "GPS setting does not match this activity")

    window_start = started - timedelta(seconds=5)
    window_end = ended + timedelta(seconds=5)
    raw_segments: list[list[dict]] = []
    count = 0
    for segment in body.route.segments if body.route else []:
        parsed = []
        for point in segment:
            item = _point(point)
            if item["t"] < window_start or item["t"] > window_end:
                raise HTTPException(422, "A GPS point is outside the recording")
            parsed.append(item)
            count += 1
            if count > MAX_POINTS:
                raise HTTPException(422, "Too many GPS points")
        if parsed:
            raw_segments.append(parsed)

    distance_m, route = measure(body.kind, raw_segments)
    existing = await _db().workouts.find_one(
        {"user_id": user["id"], "activity.client_id": body.client_id},
        {"_id": 0},
    )
    if existing:
        return JSONResponse(content=jsonable_encoder(existing), status_code=200)

    workout_id = server.new_id()
    doc = {
        "id": workout_id,
        "user_id": user["id"],
        "title": _title(body.kind, body.title),
        "notes": None,
        "started_at": started,
        "ended_at": ended,
        "duration_sec": body.moving_sec,
        "perceived_effort": None,
        "planned_exercise_slugs": [],
        "created_at": server.now(),
        "source": "phone_recorder",
        "activity": {
            "kind": body.kind,
            "distance_m": distance_m,
            "moving_sec": body.moving_sec,
            "elapsed_sec": int(elapsed),
            "steps": body.steps,
            "elevation_gain_m": body.elevation_gain_m,
            "gps_profile": body.gps_profile,
            "has_route": bool(route),
            "client_id": body.client_id,
        },
    }
    try:
        await _db().workouts.insert_one(dict(doc))
    except DuplicateKeyError:
        again = await _db().workouts.find_one(
            {"user_id": user["id"], "activity.client_id": body.client_id},
            {"_id": 0},
        )
        if again:
            return JSONResponse(content=jsonable_encoder(again), status_code=200)
        raise
    if route:
        try:
            await _db().workout_routes.insert_one({
                "workout_id": workout_id,
                "user_id": user["id"],
                "segments": route,
                "created_at": server.now(),
            })
        except Exception:
            await _db().workouts.delete_one({"id": workout_id})
            raise
    try:
        await analytics.record(
            name="workout_completed",
            actor_id=user["id"],
            source="server",
            role=analytics.product_role(user),
            props={"workout_id": workout_id, "kind": body.kind},
        )
    except Exception as exc:  # noqa: BLE001 - analytics must not fail the save
        server.logger.warning("workout_completed for %s was not stored: %s", workout_id, exc)
    return doc


@router.get("/workouts/{workout_id}/route")
async def get_route(workout_id: str, user: dict = Depends(server.current_user)):
    """Owner only. A coach can see the workout summary and still not the trace."""
    workout = await _db().workouts.find_one({"id": workout_id}, {"_id": 0, "user_id": 1})
    if not workout:
        raise HTTPException(404, "Not found")
    if workout.get("user_id") != user["id"]:
        raise HTTPException(403, "Not allowed")
    route = await _db().workout_routes.find_one({"workout_id": workout_id}, {"_id": 0})
    if not route:
        raise HTTPException(404, "No route")
    return {"workout_id": workout_id, "segments": route.get("segments") or []}
