"""Adaptive programming engine — /coach/generate + /coach/adjust.

LLM output is strict JSON validated against Pydantic schemas (mirrored by a
Zod schema on the app side). Never free text in data fields.
"""
from datetime import timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ai import active_model_label, llm_json
from locales import content_language_instruction, normalize_locale
from server import can_access_user_data, clean, current_user, db, new_id, now

router = APIRouter()

FOCUS_RE = "^(push|pull|legs|upper|lower|full_body|conditioning|rest)$"
PHASE_RE = "^(accumulation|intensification|deload|peak)$"


# --------------------------------------------------------------------------- #
# Strict program schema (weeks -> days -> exercises -> set targets)           #
# --------------------------------------------------------------------------- #
class ProgramExercise(BaseModel):
    exercise_slug: str
    name: str
    sets: int = Field(ge=1, le=10)
    reps_min: int = Field(ge=1, le=60)
    reps_max: int = Field(ge=1, le=60)
    target_rpe: float = Field(ge=4, le=10)
    rest_sec: int = Field(ge=15, le=600)
    load_pct_1rm: Optional[float] = Field(default=None, ge=20, le=105)


class ProgramDay(BaseModel):
    day_index: int = Field(ge=1, le=7)
    focus: str = Field(pattern=FOCUS_RE)
    exercises: list[ProgramExercise]


class ProgramWeek(BaseModel):
    week_index: int = Field(ge=1, le=12)
    phase: str = Field(pattern=PHASE_RE)
    days: list[ProgramDay]


class ProgramOut(BaseModel):
    weeks: list[ProgramWeek]


class GenerateIn(BaseModel):
    goal: str = Field(pattern="^(strength|hypertrophy|endurance|fat_loss|general)$")
    level: str = Field(pattern="^(beginner|intermediate|advanced)$")
    days_per_week: int = Field(ge=1, le=7)
    equipment: list[str] = []
    weeks_count: int = Field(default=4, ge=1, le=8)


class AdjustIn(BaseModel):
    program_id: str
    week_index: Optional[int] = Field(default=None, ge=1, le=12)
    day_index: Optional[int] = Field(default=None, ge=1, le=7)


# --------------------------------------------------------------------------- #
# Context gathering                                                           #
# --------------------------------------------------------------------------- #
async def recovery_snapshot(uid: str) -> dict:
    """Latest HRV / sleep / recovery vs 7-day HRV baseline -> fatigue gate."""
    week_ago = now() - timedelta(days=7)

    async def latest(metric: str):
        return await db.wearable_metrics.find_one(
            {"user_id": uid, "metric": metric}, {"_id": 0}, sort=[("recorded_at", -1)]
        )

    hrv = await latest("hrv")
    sleep = await latest("sleep_hours")
    rec = await latest("recovery")
    hrv_vals = [
        m["value"]
        async for m in db.wearable_metrics.find(
            {"user_id": uid, "metric": "hrv", "recorded_at": {"$gte": week_ago}}, {"_id": 0}
        )
    ]
    baseline = round(sum(hrv_vals) / len(hrv_vals), 1) if hrv_vals else None
    reasons = []
    reason_codes = []
    if rec and rec["value"] < 55:
        reasons.append(f"recovery score {rec['value']}% < 55%")
        reason_codes.append("low_recovery")
    if sleep and sleep["value"] < 6:
        reasons.append(f"sleep {sleep['value']}h < 6h")
        reason_codes.append("low_sleep")
    if hrv and baseline and hrv["value"] < 0.85 * baseline:
        reasons.append(f"HRV {hrv['value']}ms < 85% of 7d baseline {baseline}ms")
        reason_codes.append("low_hrv")
    return {
        "hrv": hrv["value"] if hrv else None,
        "hrv_baseline_7d": baseline,
        "sleep_hours": sleep["value"] if sleep else None,
        "recovery_score": rec["value"] if rec else None,
        "fatigue_high": len(reasons) > 0,
        "reasons": reasons,
        "reason_codes": reason_codes,
    }


async def training_history(uid: str) -> list[str]:
    """Last 14 days: sets + best e1RM per exercise, as compact lines."""
    since = now() - timedelta(days=14)
    wids = [
        w["id"]
        async for w in db.workouts.find(
            {"user_id": uid, "started_at": {"$gte": since}}, {"_id": 0, "id": 1}
        )
    ]
    if not wids:
        return []
    agg: dict[str, dict] = {}
    async for s in db.workout_sets.find({"workout_id": {"$in": wids}}, {"_id": 0}):
        ex = agg.setdefault(s["exercise_id"], {"sets": 0, "best": 0.0})
        ex["sets"] += 1
        w, r = s.get("weight_kg") or 0, s.get("reps") or 0
        if w and r:
            e1rm = w if r == 1 else round(w * (1 + r / 30.0), 1)
            ex["best"] = max(ex["best"], e1rm)
    lines = []
    for ex_id, v in list(agg.items())[:15]:
        ex = await db.exercises.find_one({"id": ex_id}, {"_id": 0, "name": 1})
        name = ex["name"] if ex else ex_id
        lines.append(f"{name}: {v['sets']} sets" + (f", best e1RM {v['best']}kg" if v["best"] else ""))
    return lines


async def relevant_biomarkers(uid: str) -> list[str]:
    docs = db.biomarkers.find({"user_id": uid}, {"_id": 0}).sort("measured_at", -1).limit(8)
    return [f"{b['marker']}: {b['value']} {b.get('unit', '')}".strip() async for b in docs]


async def exercise_catalog(equipment: list[str]) -> list[dict]:
    q: dict = {}
    docs = [e async for e in db.exercises.find(q, {"_id": 0})]
    if equipment:
        eq = {e.lower() for e in equipment} | {"bodyweight", "none", ""}
        docs = [d for d in docs if (d.get("equipment") or "bodyweight").lower() in eq] or docs
    return docs


GENERATE_SYSTEM = """You are IronFlow's adaptive strength & conditioning programming engine.
You output ONLY valid JSON matching the schema below. No markdown, no prose, no comments.

HARD CONSTRAINTS:
1. PERIODIZATION — weeks follow phases (accumulation -> intensification -> deload/peak).
   Progressive overload within a phase: +2.5-5% load OR +1 rep OR +1 set week over week.
2. AGONIST/ANTAGONIST BALANCE — weekly push vs pull volume within +/-20%; include
   posterior chain and core work every week.
3. DELOAD — if athlete context says FATIGUE IS HIGH, week 1 MUST be phase="deload"
   (volume -40-50%, target_rpe <= 7, load_pct_1rm <= 65). Otherwise deload on week 4 if
   the plan has >= 4 weeks.
4. Use ONLY exercise slugs from the provided catalog; respect available equipment.
5. Exactly the requested number of training days per week (day_index 1..N),
   3-6 exercises per day, compounds first.
6. Rep/RPE/rest ranges by goal — strength: 3-6 reps, RPE 7-9, rest 180-300s;
   hypertrophy: 6-15 reps, RPE 7-9, rest 60-180s; endurance/fat_loss: 12-25 reps,
   RPE 6-8, rest 30-90s; general: mixed 5-15 reps.

OUTPUT SCHEMA (exactly):
{"weeks":[{"week_index":1,"phase":"accumulation","days":[{"day_index":1,"focus":"push",
"exercises":[{"exercise_slug":"bench-press","name":"Bench Press","sets":4,"reps_min":6,
"reps_max":8,"target_rpe":8,"rest_sec":150,"load_pct_1rm":72.5}]}]}]}
"focus" in: push|pull|legs|upper|lower|full_body|conditioning. "phase" in:
accumulation|intensification|deload|peak. load_pct_1rm may be null for bodyweight/cardio."""

ADJUST_SYSTEM = """You are IronFlow's recovery-gated workout adjuster. The athlete's recovery
is LOW today. Rewrite the given session, output ONLY JSON matching the day schema:
{"day_index":1,"focus":"push","exercises":[{"exercise_slug":"...","name":"...","sets":3,
"reps_min":8,"reps_max":10,"target_rpe":6.5,"rest_sec":180,"load_pct_1rm":60}]}
RULES: reduce total volume by 30-50% (fewer sets and/or exercises); cap target_rpe at 7 and
load_pct_1rm at 70; keep the same focus and movement patterns (may swap to lower-fatigue
variants using ONLY catalog slugs); rest_sec may increase. No prose."""


def _validate_program(catalog_slugs: set[str], body: GenerateIn):
    def _v(data) -> ProgramOut:
        prog = ProgramOut.model_validate(data)
        if len(prog.weeks) != body.weeks_count:
            raise ValueError(f"expected {body.weeks_count} weeks, got {len(prog.weeks)}")
        for wk in prog.weeks:
            if len(wk.days) != body.days_per_week:
                raise ValueError(
                    f"week {wk.week_index}: expected {body.days_per_week} days, got {len(wk.days)}"
                )
            for d in wk.days:
                bad = [e.exercise_slug for e in d.exercises if e.exercise_slug not in catalog_slugs]
                if bad:
                    raise ValueError(f"unknown exercise slugs: {bad}; use only catalog slugs")
        return prog

    return _v


# --------------------------------------------------------------------------- #
# Endpoints                                                                   #
# --------------------------------------------------------------------------- #
@router.post("/coach/generate", status_code=201)
async def generate_program(body: GenerateIn, user: dict = Depends(current_user)):
    uid = user["id"]
    locale = normalize_locale(user.get("preferred_locale"))
    recovery = await recovery_snapshot(uid)
    history = await training_history(uid)
    markers = await relevant_biomarkers(uid)
    catalog = await exercise_catalog(body.equipment)
    if not catalog:
        raise HTTPException(422, "No exercises available for this equipment")
    catalog_lines = "\n".join(
        f"- {e['slug']} | {e['name']} | {e.get('category')} | {e.get('equipment') or 'bodyweight'}"
        for e in catalog
    )
    prompt = f"""ATHLETE CONTEXT
Goal: {body.goal} | Level: {body.level} | Days/week: {body.days_per_week} | Weeks: {body.weeks_count}
Equipment: {', '.join(body.equipment) or 'anything'}
FATIGUE IS {'HIGH — ' + '; '.join(recovery['reasons']) if recovery['fatigue_high'] else 'NORMAL'}
Recovery: HRV {recovery['hrv']}ms (baseline {recovery['hrv_baseline_7d']}ms), sleep {recovery['sleep_hours']}h, score {recovery['recovery_score']}%
Recent training (14d): {'; '.join(history) or 'no recent history'}
Recent biomarkers: {'; '.join(markers) or 'none'}

EXERCISE CATALOG (slug | name | category | equipment):
{catalog_lines}

Generate the program JSON now."""
    try:
        prog = await llm_json(
            f"{GENERATE_SYSTEM}\n{content_language_instruction(locale)}",
            prompt,
            validator=_validate_program({e["slug"] for e in catalog}, body),
            task="program",  # Sonnet 5, adaptive thinking, medium effort
        )
    except ValueError as e:
        raise HTTPException(502, f"Program generation failed: {e}") from None

    await db.programs.update_many({"user_id": uid, "status": "active"}, {"$set": {"status": "archived"}})
    doc = {
        "id": new_id(),
        "user_id": uid,
        "status": "active",
        "params": body.model_dump(),
        "recovery_snapshot": recovery,
        "program": prog.model_dump(),
        "model": active_model_label(task="program"),
        "locale": locale,
        "adjustments": [],
        "created_at": now(),
    }
    await db.programs.insert_one(dict(doc))
    return clean(doc)


@router.get("/programs")
async def list_programs(user: dict = Depends(current_user), owner_id: Optional[str] = None):
    target = owner_id or user["id"]
    if not await can_access_user_data(user["id"], target):
        raise HTTPException(403, "Not allowed")
    return [
        clean(p)
        async for p in db.programs.find({"user_id": target}, {"_id": 0}).sort("created_at", -1).limit(10)
    ]


@router.post("/coach/adjust")
async def adjust_today(body: AdjustIn, user: dict = Depends(current_user)):
    """Recovery-gated workout: rewrites today's session when recovery is low."""
    prog = await db.programs.find_one({"id": body.program_id}, {"_id": 0})
    if not prog:
        raise HTTPException(404, "Program not found")
    if not await can_access_user_data(user["id"], prog["user_id"]):
        raise HTTPException(403, "Not allowed")
    locale = normalize_locale(user.get("preferred_locale"))

    weeks = prog["program"]["weeks"]
    created = prog["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    default_week = min((now() - created).days // 7 + 1, len(weeks))
    week_index = body.week_index or default_week
    week = next((w for w in weeks if w["week_index"] == week_index), weeks[0])
    day_index = body.day_index or week["days"][0]["day_index"]
    day = next((d for d in week["days"] if d["day_index"] == day_index), None)
    if not day:
        raise HTTPException(404, "Day not found in program")

    recovery = await recovery_snapshot(prog["user_id"])
    if not recovery["fatigue_high"]:
        return {
            "adjusted": False,
            "reason": "Recovery is OK — session unchanged",
            "recovery": recovery,
            "week_index": week_index,
            "day": day,
        }

    catalog = [e async for e in db.exercises.find({}, {"_id": 0, "slug": 1, "name": 1})]
    slugs = {e["slug"] for e in catalog}
    prompt = f"""RECOVERY (LOW): {'; '.join(recovery['reasons'])}
HRV {recovery['hrv']}ms (baseline {recovery['hrv_baseline_7d']}ms), sleep {recovery['sleep_hours']}h, score {recovery['recovery_score']}%

TODAY'S PLANNED SESSION (week {week_index}, phase {week['phase']}):
{day}

CATALOG SLUGS: {', '.join(sorted(slugs))}

Rewrite the session JSON now."""

    def _v(data) -> ProgramDay:
        d = ProgramDay.model_validate(data)
        bad = [e.exercise_slug for e in d.exercises if e.exercise_slug not in slugs]
        if bad:
            raise ValueError(f"unknown slugs {bad}")
        return d

    try:
        adjusted = await llm_json(
            f"{ADJUST_SYSTEM}\n{content_language_instruction(locale)}",
            prompt,
            validator=_v,
            task="program",
        )
    except ValueError as e:
        raise HTTPException(502, f"Adjustment failed: {e}") from None

    record = {
        "id": new_id(),
        "week_index": week_index,
        "day_index": day_index,
        "original_day": day,
        "adjusted_day": adjusted.model_dump(),
        "recovery": recovery,
        "locale": locale,
        "created_at": now(),
    }
    await db.programs.update_one({"id": prog["id"]}, {"$push": {"adjustments": record}})
    return {
        "adjusted": True,
        "reason": "; ".join(recovery["reasons"]),
        "recovery": recovery,
        "week_index": week_index,
        "day": adjusted.model_dump(),
        "original_day": day,
    }
