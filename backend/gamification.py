"""Progress engine: XP ledger, levels, streaks with freezes, badges, challenges,
weekly leagues and community cups.

Design rules (see docs/gamification.md):
- XP comes only from verified actions: finished workouts, gym check-ins, step
  days from a health source, PRs computed from logged sets, completed
  challenges and (capped) social actions. Hand-typed or sample metrics never count.
- The ledger (`xp_ledger`) is append-only. Every entry has a dedupe `key`
  unique per user, so replays and concurrent syncs can never double-award.
  A correction is a compensating entry, never an edit.
- Points are not money: no purchase, transfer, cash-out or random reward.
- Health values never leave this module for ads or push text.

Everything is grouped in small classes of static functions so the pure parts
(levels, streaks, ranking) are testable without a database.
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

from pymongo.errors import DuplicateKeyError

import challenges as channel_challenges
from gamification_config import BADGES, CONFIG, FRAMES

logger = logging.getLogger(__name__)

TRAINING_KINDS = ("workout", "gym_checkin", "steps_5k")
SOCIAL_KINDS = ("post", "kudos")
METRICS = ("workouts", "active_days", "minutes", "steps", "xp")
CHALLENGE_KINDS = ("solo", "friends", "club", "coach")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def day_of(moment: datetime) -> str:
    return aware(moment).astimezone(timezone.utc).date().isoformat()


def week_key(moment: datetime) -> str:
    year, week, _ = aware(moment).astimezone(timezone.utc).isocalendar()
    return f"{year}-W{week:02d}"


def week_bounds(key: str) -> tuple[datetime, datetime]:
    year, week = key.split("-W")
    start = datetime.fromisocalendar(int(year), int(week), 1).replace(tzinfo=timezone.utc)
    return start, start + timedelta(days=7)


def month_key(moment: datetime) -> str:
    return aware(moment).astimezone(timezone.utc).strftime("%Y-%m")


def month_bounds(key: str) -> tuple[datetime, datetime]:
    year, month = (int(part) for part in key.split("-"))
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    return start, end


# --------------------------------------------------------------------------- #
# Levels
# --------------------------------------------------------------------------- #
class Levels:
    @staticmethod
    def threshold(level: int) -> int:
        """Cumulative XP needed to *reach* `level` (level 1 needs 0)."""
        if level <= 1:
            return 0
        cfg = CONFIG["levels"]
        return int(round(cfg["base"] * (level - 1) ** cfg["exponent"]))

    @staticmethod
    def level_for(xp: int) -> int:
        level = 1
        top = CONFIG["levels"]["max"]
        while level < top and xp >= Levels.threshold(level + 1):
            level += 1
        return level

    @staticmethod
    def stage_for(level: int) -> str:
        stage = CONFIG["stages"][0]["id"]
        for row in CONFIG["stages"]:
            if level >= row["from"]:
                stage = row["id"]
        return stage

    @staticmethod
    def summary(xp: int) -> dict:
        level = Levels.level_for(xp)
        floor, ceiling = Levels.threshold(level), Levels.threshold(level + 1)
        span = max(1, ceiling - floor)
        return {
            "xp": xp, "level": level, "stage": Levels.stage_for(level),
            "level_floor": floor, "next_level_xp": ceiling,
            "into_level": xp - floor, "level_span": span,
            "progress": round(min(1.0, (xp - floor) / span), 4),
        }


# --------------------------------------------------------------------------- #
# Streaks (rest-day tolerant, same rule as channel streaks) + freeze tokens
# --------------------------------------------------------------------------- #
class Streaks:
    MAX_GAP = channel_challenges.MAX_GAP_DAYS  # 2: one rest day never breaks a streak

    @staticmethod
    def runs(days: Iterable[str]) -> list[list[date]]:
        ordered = sorted({date.fromisoformat(d) for d in days})
        runs: list[list[date]] = []
        for day in ordered:
            if runs and (day - runs[-1][-1]).days <= Streaks.MAX_GAP:
                runs[-1].append(day)
            else:
                runs.append([day])
        return runs

    @staticmethod
    def compute(days: Iterable[str], today: date) -> dict:
        runs = Streaks.runs(days)
        if not runs:
            return {"current": 0, "longest": 0, "start": None, "last_day": None,
                    "checked_in_today": False, "at_risk": False}
        last = runs[-1]
        gap = (today - last[-1]).days
        alive = gap <= Streaks.MAX_GAP
        return {
            "current": len(last) if alive else 0,
            "longest": max(len(run) for run in runs),
            "start": last[0].isoformat() if alive else None,
            "last_day": last[-1].isoformat(),
            "checked_in_today": gap == 0,
            # Tomorrow the gap becomes 3 and the run ends: train today (or a freeze covers it).
            "at_risk": alive and gap == Streaks.MAX_GAP,
        }

    @staticmethod
    def freezes_needed(last_day: date, today: date) -> list[date]:
        """Days a freeze must cover so the run is alive again today.

        A freeze counts as a training day; with the one-rest-day rule each
        freeze bridges two missing days. Today itself is never frozen: the
        athlete can still train today.
        """
        gap = (today - last_day).days
        if gap <= Streaks.MAX_GAP:
            return []
        covered, cursor = [], last_day
        while (today - cursor).days > Streaks.MAX_GAP:
            cursor = cursor + timedelta(days=Streaks.MAX_GAP)
            covered.append(cursor)
        return covered


# --------------------------------------------------------------------------- #
# Ledger
# --------------------------------------------------------------------------- #
class Ledger:
    _indexed: set[int] = set()

    @staticmethod
    async def ensure_indexes(db) -> None:
        if id(db) in Ledger._indexed:
            return
        await db.xp_ledger.create_index([("user_id", 1), ("key", 1)], unique=True)
        await db.xp_ledger.create_index([("user_id", 1), ("at", -1)])
        await db.xp_ledger.create_index([("at", 1), ("user_id", 1)])
        await db.progress_challenge_members.create_index([("challenge_id", 1), ("user_id", 1)], unique=True)
        await db.progress_challenge_members.create_index("user_id")
        await db.progress_challenges.create_index("id", unique=True)
        await db.league_members.create_index([("week", 1), ("user_id", 1)], unique=True)
        await db.league_members.create_index([("group_id", 1)])
        await db.league_groups.create_index("id", unique=True)
        await db.league_groups.create_index([("week", 1), ("division", 1), ("size", 1)])
        await db.progress_cups.create_index("month", unique=True)
        await db.progress_profiles.create_index("user_id", unique=True)
        Ledger._indexed.add(id(db))

    @staticmethod
    async def award(db, user_id: str, key: str, kind: str, xp: int, *, at: datetime | None = None,
                    meta: dict | None = None) -> dict | None:
        """Append one entry. Returns None when `key` was already awarded."""
        at = aware(at or utcnow())
        doc = {"user_id": user_id, "key": key, "kind": kind, "xp": int(xp), "at": at,
               "day": day_of(at), "meta": meta or {}, "created_at": utcnow()}
        try:
            await db.xp_ledger.insert_one(dict(doc))
        except DuplicateKeyError:
            return None
        return doc

    @staticmethod
    async def total(db, user_id: str, since: datetime | None = None, until: datetime | None = None) -> int:
        match: dict = {"user_id": user_id}
        if since or until:
            match["at"] = {k: v for k, v in (("$gte", since), ("$lt", until)) if v}
        rows = await db.xp_ledger.aggregate([{"$match": match},
                                             {"$group": {"_id": None, "xp": {"$sum": "$xp"}}}]).to_list(1)
        return int(rows[0]["xp"]) if rows else 0

    @staticmethod
    async def sum_for_day(db, user_id: str, kinds: Iterable[str], day: str) -> int:
        rows = await db.xp_ledger.aggregate([
            {"$match": {"user_id": user_id, "kind": {"$in": list(kinds)}, "day": day}},
            {"$group": {"_id": None, "xp": {"$sum": "$xp"}}}]).to_list(1)
        return int(rows[0]["xp"]) if rows else 0

    @staticmethod
    async def count_for_day(db, user_id: str, kind: str, day: str) -> int:
        return await db.xp_ledger.count_documents({"user_id": user_id, "kind": kind, "day": day})

    @staticmethod
    async def recent(db, user_id: str, limit: int = 20) -> list[dict]:
        rows = db.xp_ledger.find({"user_id": user_id, "xp": {"$ne": 0}}, {"_id": 0, "user_id": 0}).sort("at", -1).limit(limit)
        return [row async for row in rows]


# --------------------------------------------------------------------------- #
# Awards from verified sources (idempotent; safe to call on every read)
# --------------------------------------------------------------------------- #
def e1rm(weight: float | None, reps: int | None) -> float:
    if not weight or not reps or reps <= 0:
        return 0.0
    return float(weight) * (1 + min(int(reps), 12) / 30)  # Epley, reps capped for sanity


class Awards:
    @staticmethod
    def workout_verified(workout: dict, set_count: int) -> bool:
        if not workout.get("ended_at"):
            return False
        minutes = (workout.get("duration_sec") or 0) / 60
        ver = CONFIG["verification"]
        return minutes >= ver["min_workout_minutes"] or set_count >= ver["min_workout_sets"]

    @staticmethod
    def workout_xp(duration_sec: int | None) -> int:
        xp = CONFIG["xp"]
        bonus = int(((duration_sec or 0) // 600) * xp["workout_per_10_min"])
        return xp["workout"] + min(bonus, xp["workout_minutes_bonus_cap"])

    @staticmethod
    async def workout(db, user_id: str, workout: dict) -> list[dict]:
        """XP for one finished workout, plus PRs. Returns the new ledger entries."""
        if workout.get("user_id") != user_id:
            return []
        sets = [row async for row in db.workout_sets.find({"workout_id": workout["id"]}, {"_id": 0})]
        if not Awards.workout_verified(workout, len(sets)):
            return []
        ended = aware(workout["ended_at"])
        if ended > utcnow() + timedelta(minutes=5):
            return []
        day = day_of(ended)
        if await Ledger.count_for_day(db, user_id, "workout", day) >= CONFIG["caps"]["workouts_per_day"]:
            return []
        minutes = int((workout.get("duration_sec") or 0) // 60)
        out = []
        entry = await Ledger.award(db, user_id, f"workout:{workout['id']}", "workout",
                                   Awards.workout_xp(workout.get("duration_sec")), at=ended,
                                   meta={"workout_id": workout["id"], "minutes": minutes})
        if not entry:
            return []
        out.append(entry)
        out.extend(await Awards._prs(db, user_id, workout, sets, ended))
        return out

    @staticmethod
    async def _prs(db, user_id: str, workout: dict, sets: list[dict], ended: datetime) -> list[dict]:
        best_now: dict[str, float] = {}
        for row in sets:
            value = e1rm(row.get("weight_kg"), row.get("reps"))
            if value and row.get("exercise_id"):
                best_now[row["exercise_id"]] = max(best_now.get(row["exercise_id"], 0.0), value)
        if not best_now:
            return []
        earlier_ids = [w["id"] async for w in db.workouts.find(
            {"user_id": user_id, "id": {"$ne": workout["id"]}, "ended_at": {"$ne": None, "$lt": ended}},
            {"_id": 0, "id": 1})]
        best_before: dict[str, float] = {}
        if earlier_ids:
            async for row in db.workout_sets.find(
                    {"workout_id": {"$in": earlier_ids}, "exercise_id": {"$in": list(best_now)}},
                    {"_id": 0, "exercise_id": 1, "weight_kg": 1, "reps": 1}):
                value = e1rm(row.get("weight_kg"), row.get("reps"))
                best_before[row["exercise_id"]] = max(best_before.get(row["exercise_id"], 0.0), value)
        out = []
        for exercise_id, value in sorted(best_now.items(), key=lambda kv: -kv[1]):
            if len(out) >= CONFIG["caps"]["prs_per_workout"]:
                break
            # A first-ever lift is a baseline, not a PR.
            if exercise_id in best_before and value > best_before[exercise_id] + 1e-6:
                entry = await Ledger.award(db, user_id, f"pr:{workout['id']}:{exercise_id}", "pr",
                                           CONFIG["xp"]["pr"], at=ended,
                                           meta={"exercise_id": exercise_id, "workout_id": workout["id"]})
                if entry:
                    out.append(entry)
        return out

    @staticmethod
    async def gym_checkin(db, user_id: str, visit: dict) -> dict | None:
        at = aware(visit["checked_in_at"])
        return await Ledger.award(db, user_id, f"gym:{day_of(at)}", "gym_checkin",
                                  CONFIG["xp"]["gym_checkin"], at=at, meta={"gym_id": visit.get("gym_id")})

    @staticmethod
    def step_row_counts(row: dict) -> bool:
        ver = CONFIG["verification"]
        if row.get("metric") != "steps" or row.get("simulated"):
            return False
        if not row.get("device") or row.get("device") in ver["excluded_devices"]:
            return False
        return row.get("source") not in ver["excluded_sources"]

    @staticmethod
    async def steps_day(db, user_id: str, day: str, steps: float) -> list[dict]:
        ver, xp = CONFIG["verification"], CONFIG["xp"]
        if date.fromisoformat(day) > utcnow().date():
            return []
        at = datetime.fromisoformat(day).replace(tzinfo=timezone.utc, hour=12)
        out = []
        if steps >= ver["steps_5k"]:
            entry = await Ledger.award(db, user_id, f"steps5k:{day}", "steps_5k", xp["steps_5k"], at=at,
                                       meta={"steps": int(steps)})
            if entry:
                out.append(entry)
            else:  # keep the day's best step count current for challenges/badges, still one entry
                await db.xp_ledger.update_one({"user_id": user_id, "key": f"steps5k:{day}",
                                               "meta.steps": {"$lt": int(steps)}},
                                              {"$set": {"meta.steps": int(steps)}})
        if steps >= ver["steps_10k"]:
            entry = await Ledger.award(db, user_id, f"steps10k:{day}", "steps_10k", xp["steps_10k"], at=at)
            if entry:
                out.append(entry)
        return out

    @staticmethod
    async def social(db, user_id: str, kind: str, ref: str, at: datetime) -> dict | None:
        day = day_of(at)
        cap = CONFIG["caps"]["social_xp_per_day"]
        value = CONFIG["xp"][kind]
        if await Ledger.sum_for_day(db, user_id, SOCIAL_KINDS, day) + value > cap:
            return None
        return await Ledger.award(db, user_id, f"{kind}:{ref}", kind, value, at=at)

    @staticmethod
    async def backfill(db, user_id: str) -> None:
        """Pick up verified activity that happened since the last sync."""
        since = utcnow() - timedelta(days=CONFIG["verification"]["backfill_days"])
        async for w in db.workouts.find({"user_id": user_id, "ended_at": {"$gte": since}}, {"_id": 0}).sort("ended_at", 1):
            if not await db.xp_ledger.find_one({"user_id": user_id, "key": f"workout:{w['id']}"}, {"_id": 1}):
                await Awards.workout(db, user_id, w)
        async for v in db.gym_visits.find({"user_id": user_id, "checked_in_at": {"$gte": since}}, {"_id": 0}):
            await Awards.gym_checkin(db, user_id, v)
        best: dict[str, float] = {}
        async for row in db.wearable_metrics.find(
                {"user_id": user_id, "metric": "steps", "recorded_at": {"$gte": since}}, {"_id": 0}):
            if Awards.step_row_counts(row) and row.get("recorded_at"):
                day = row.get("import_day") or day_of(row["recorded_at"])
                best[day] = max(best.get(day, 0.0), float(row.get("value") or 0))
        for day, steps in best.items():
            await Awards.steps_day(db, user_id, day, steps)
        async for post in db.posts.find({"author_id": user_id, "created_at": {"$gte": since},
                                         "repost_of": None, "status": "active"}, {"_id": 0, "id": 1, "created_at": 1}):
            await Awards.social(db, user_id, "post", post["id"], post["created_at"])
        async for kudos in db.post_kudos.find({"user_id": user_id, "created_at": {"$gte": since}},
                                              {"_id": 0, "post_id": 1, "created_at": 1}):
            await Awards.social(db, user_id, "kudos", kudos["post_id"], kudos["created_at"])


# --------------------------------------------------------------------------- #
# Profile projection (cached; always recomputable from the ledger)
# --------------------------------------------------------------------------- #
class Profiles:
    @staticmethod
    async def get(db, user_id: str) -> dict:
        row = await db.progress_profiles.find_one({"user_id": user_id}, {"_id": 0})
        if row:
            return row
        row = {"user_id": user_id, "division": CONFIG["league"]["divisions"][0], "frame": "none",
               "weekly_goal_workouts": CONFIG["weekly_goal"]["default_workouts"],
               "weekly_goal_steps": CONFIG["weekly_goal"]["default_steps"],
               "leagues_opt_out": False, "seen_until": utcnow(), "created_at": utcnow()}
        try:
            await db.progress_profiles.insert_one(dict(row))
        except DuplicateKeyError:
            return await db.progress_profiles.find_one({"user_id": user_id}, {"_id": 0})
        return row

    @staticmethod
    async def set(db, user_id: str, fields: dict) -> None:
        await db.progress_profiles.update_one({"user_id": user_id}, {"$set": fields})


class Streak:
    @staticmethod
    async def training_days(db, user_id: str) -> list[str]:
        return await db.xp_ledger.distinct("day", {"user_id": user_id,
                                                  "kind": {"$in": [*TRAINING_KINDS, "freeze_used"]}})

    @staticmethod
    async def freezes_available(db, user_id: str) -> int:
        earned = await db.xp_ledger.count_documents({"user_id": user_id, "kind": "freeze_earned"})
        used = await db.xp_ledger.count_documents({"user_id": user_id, "kind": "freeze_used"})
        return max(0, earned - used)

    @staticmethod
    async def refresh(db, user_id: str, today: date | None = None) -> dict:
        today = today or utcnow().date()
        days = await Streak.training_days(db, user_id)
        state = Streaks.compute(days, today)
        # Spend freezes when the run just broke and enough tokens are held.
        if state["last_day"] and state["current"] == 0:
            needed = Streaks.freezes_needed(date.fromisoformat(state["last_day"]), today)
            if needed and len(needed) <= await Streak.freezes_available(db, user_id):
                for day in needed:
                    await Ledger.award(db, user_id, f"freeze_used:{day.isoformat()}", "freeze_used", 0,
                                       at=datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc))
                days = await Streak.training_days(db, user_id)
                state = Streaks.compute(days, today)
        cfg, xp = CONFIG["streak"], CONFIG["xp"]
        if state["current"]:
            run = [d for d in sorted(days) if d >= state["start"]]
            # Streak-day XP for each real training day of the run (never for freezes).
            real = set(await db.xp_ledger.distinct("day", {"user_id": user_id, "kind": {"$in": list(TRAINING_KINDS)},
                                                          "day": {"$gte": state["start"]}}))
            for index, day in enumerate(run, start=1):
                if index > 1 and day in real:
                    await Ledger.award(db, user_id, f"streak:{day}", "streak_day",
                                       xp["streak_day_per_day"] * min(index, xp["streak_day_cap"]),
                                       at=datetime.fromisoformat(day).replace(tzinfo=timezone.utc, hour=23),
                                       meta={"streak": index})
            for n in range(cfg["freeze_every_days"], state["current"] + 1, cfg["freeze_every_days"]):
                if await Streak.freezes_available(db, user_id) >= cfg["max_freezes"]:
                    break
                await Ledger.award(db, user_id, f"freeze_earned:{state['start']}:{n}", "freeze_earned", 0)
        state["freezes"] = await Streak.freezes_available(db, user_id)
        state["max_freezes"] = cfg["max_freezes"]
        return state


# --------------------------------------------------------------------------- #
# Badges
# --------------------------------------------------------------------------- #
class Badges:
    @staticmethod
    async def counters(db, user_id: str, streak: dict, level: int) -> dict:
        async def count(kind: str) -> int:
            return await db.xp_ledger.count_documents({"user_id": user_id, "kind": kind})

        steps = await db.xp_ledger.aggregate([
            {"$match": {"user_id": user_id, "kind": "steps_5k"}},
            {"$group": {"_id": None, "total": {"$sum": "$meta.steps"}, "best": {"$max": "$meta.steps"}}}]).to_list(1)
        minutes = await db.xp_ledger.aggregate([
            {"$match": {"user_id": user_id, "kind": "workout"}},
            {"$group": {"_id": None, "total": {"$sum": "$meta.minutes"}}}]).to_list(1)
        return {
            "workouts": await count("workout"), "prs": await count("pr"),
            "gym_checkins": await count("gym_checkin"),
            "challenges_completed": await count("challenge"),
            "league_promotions": await count("league_promoted"),
            "league_wins": await count("league_champion"),
            "cups_won": await count("cup_won"),
            "longest_streak": streak.get("longest", 0),
            "best_steps_day": int(steps[0]["best"] or 0) if steps else 0,
            "steps_total": int(steps[0]["total"] or 0) if steps else 0,
            "minutes_total": int(minutes[0]["total"] or 0) if minutes else 0,
            "level": level,
        }

    @staticmethod
    async def evaluate(db, user_id: str, counters: dict) -> list[dict]:
        new = []
        for badge_id, metric, threshold, xp in BADGES:
            if counters.get(metric, 0) >= threshold:
                entry = await Ledger.award(db, user_id, f"badge:{badge_id}", "badge", xp, meta={"badge": badge_id})
                if entry:
                    new.append(entry)
        return new

    @staticmethod
    async def wall(db, user_id: str, counters: dict) -> list[dict]:
        unlocked = {row["meta"]["badge"]: row["at"] async for row in db.xp_ledger.find(
            {"user_id": user_id, "kind": "badge"}, {"_id": 0, "meta": 1, "at": 1})}
        return [{"id": badge_id, "metric": metric, "threshold": threshold, "xp": xp,
                 "value": min(counters.get(metric, 0), threshold),
                 "unlocked_at": unlocked.get(badge_id)}
                for badge_id, metric, threshold, xp in BADGES]


# --------------------------------------------------------------------------- #
# Rewards (unlocked by level/stage, never bought with points)
# --------------------------------------------------------------------------- #
class Rewards:
    @staticmethod
    def frames_for(level: int) -> list[dict]:
        order = [row["id"] for row in CONFIG["stages"]]
        stage = Levels.stage_for(level)
        return [{"id": frame, "stage": need, "unlocked": order.index(stage) >= order.index(need)}
                for frame, need in FRAMES]

    @staticmethod
    async def grant_pro_credit(db, user_id: str, level: int) -> list[dict]:
        out = []
        year = utcnow().year
        cap = CONFIG["pro_credit_days_per_year_cap"]
        for need, days in sorted(((int(k), int(v)) for k, v in CONFIG["pro_credit_unlocks"].items())):
            if level < need:
                continue
            granted = await db.xp_ledger.aggregate([
                {"$match": {"user_id": user_id, "kind": "pro_credit", "meta.year": year}},
                {"$group": {"_id": None, "days": {"$sum": "$meta.days"}}}]).to_list(1)
            used = int(granted[0]["days"]) if granted else 0
            days = min(days, max(0, cap - used))
            if days <= 0:
                continue
            entry = await Ledger.award(db, user_id, f"pro_credit:L{need}", "pro_credit", 0,
                                       meta={"days": days, "level": need, "year": year})
            if entry:
                await Rewards._extend(db, user_id, days)
                out.append(entry)
        return out

    @staticmethod
    async def _extend(db, user_id: str, days: int) -> None:
        # Same field referrals use (`users.pro_credit_until`), extended from max(now, current).
        row = await db.users.find_one({"id": user_id}, {"_id": 0, "pro_credit_until": 1}) or {}
        current = row.get("pro_credit_until")
        base = max(utcnow(), aware(current)) if isinstance(current, datetime) else utcnow()
        await db.users.update_one({"id": user_id}, {"$set": {"pro_credit_until": base + timedelta(days=days)}})

    @staticmethod
    async def catalogue(db, user_id: str, level: int, profile: dict) -> dict:
        pro = []
        for need, days in sorted(((int(k), int(v)) for k, v in CONFIG["pro_credit_unlocks"].items())):
            row = await db.xp_ledger.find_one({"user_id": user_id, "key": f"pro_credit:L{need}"}, {"_id": 0, "at": 1, "meta": 1})
            pro.append({"level": need, "days": days, "unlocked": bool(row),
                        "granted_days": (row or {}).get("meta", {}).get("days"), "at": (row or {}).get("at")})
        gym = [r async for r in db.rewards.find({"user_id": user_id, "status": "issued"},
                                                 {"_id": 0, "id": 1, "gym_id": 1, "code": 1, "expires_at": 1, "kind": 1, "label": 1}).limit(10)]
        return {"frames": Rewards.frames_for(level), "selected_frame": profile.get("frame", "none"),
                "pro_credit": pro, "gym_rewards": gym,
                "freezes": {"every_days": CONFIG["streak"]["freeze_every_days"], "max": CONFIG["streak"]["max_freezes"]}}


# --------------------------------------------------------------------------- #
# Challenges
# --------------------------------------------------------------------------- #
class Challenges:
    @staticmethod
    def solo_templates(week: str) -> list[dict]:
        start, end = week_bounds(week)
        return [
            {"slug": "workouts", "title": "3 workouts this week", "metric": "workouts", "target": 3, "xp_reward": 75},
            {"slug": "steps", "title": "40,000 steps this week", "metric": "steps", "target": 40000, "xp_reward": 75},
            {"slug": "active", "title": "Active 4 days this week", "metric": "active_days", "target": 4, "xp_reward": 75},
        ], start, end

    @staticmethod
    async def ensure_solo(db, user_id: str, now: datetime) -> None:
        week = week_key(now)
        templates, start, end = Challenges.solo_templates(week)
        for t in templates:
            cid = f"solo-{week}-{t['slug']}-{user_id}"
            await db.progress_challenges.update_one({"id": cid}, {"$setOnInsert": {
                "id": cid, "kind": "solo", "title": t["title"], "metric": t["metric"], "target": t["target"],
                "xp_reward": t["xp_reward"], "starts_at": start, "ends_at": end, "creator_id": user_id,
                "community_id": None, "invitees": [user_id], "created_at": now}}, upsert=True)

    @staticmethod
    async def progress(db, user_id: str, challenge: dict) -> float:
        start, end = aware(challenge["starts_at"]), aware(challenge["ends_at"])
        match = {"user_id": user_id, "at": {"$gte": start, "$lt": end}}
        metric = challenge["metric"]
        if metric == "workouts":
            return float(await db.xp_ledger.count_documents({**match, "kind": "workout"}))
        if metric == "active_days":
            return float(len(await db.xp_ledger.distinct("day", {**match, "kind": {"$in": list(TRAINING_KINDS)}})))
        field, kinds = {"minutes": ("$meta.minutes", ["workout"]), "steps": ("$meta.steps", ["steps_5k"]),
                        "xp": ("$xp", None)}[metric]
        if kinds:
            match["kind"] = {"$in": kinds}
        else:
            match["kind"] = {"$nin": ["challenge", "badge"]}  # no XP-for-XP loops
        rows = await db.xp_ledger.aggregate([{"$match": match},
                                             {"$group": {"_id": None, "v": {"$sum": field}}}]).to_list(1)
        return float(rows[0]["v"] or 0) if rows else 0.0

    @staticmethod
    async def visible_to(db, user_id: str, challenge: dict) -> bool:
        if challenge["kind"] == "club":
            return bool(await db.community_members.find_one(
                {"community_id": challenge.get("community_id"), "user_id": user_id, "status": "active"}, {"_id": 1}))
        return user_id == challenge.get("creator_id") or user_id in (challenge.get("invitees") or [])

    @staticmethod
    async def view(db, user_id: str, challenge: dict, now: datetime) -> dict:
        member = await db.progress_challenge_members.find_one(
            {"challenge_id": challenge["id"], "user_id": user_id}, {"_id": 0})
        joined = bool(member) or challenge["kind"] == "solo"
        value = await Challenges.progress(db, user_id, challenge) if joined else 0.0
        status = channel_challenges.challenge_status(aware(challenge["starts_at"]), aware(challenge["ends_at"]), now)
        done = value >= challenge["target"]
        if joined and done and status != "upcoming":
            await Ledger.award(db, user_id, f"challenge:{challenge['id']}", "challenge",
                               int(challenge.get("xp_reward") or CONFIG["xp"]["challenge_default"]),
                               meta={"challenge_id": challenge["id"], "title": challenge["title"]})
        participants = await db.progress_challenge_members.count_documents({"challenge_id": challenge["id"]})
        out = {k: v for k, v in challenge.items() if k not in {"_id", "invitees"}}
        out.update({"joined": joined, "value": value, "progress": round(min(1.0, value / max(1, challenge["target"])), 4),
                    "completed": done and joined, "status": status,
                    "participants": participants if challenge["kind"] != "solo" else 1})
        return out

    @staticmethod
    async def leaderboard(db, challenge: dict, limit: int = 30) -> list[dict]:
        ids = [m["user_id"] async for m in db.progress_challenge_members.find({"challenge_id": challenge["id"]}, {"_id": 0, "user_id": 1})]
        scores = {uid: await Challenges.progress(db, uid, challenge) for uid in ids[:200]}
        names = await Names.lookup(db, list(scores))
        return [{"rank": place, "user_id": uid, "name": names.get(uid), "value": value}
                for place, uid, value in channel_challenges.rank(scores)[:limit]]


class Names:
    @staticmethod
    async def lookup(db, user_ids: list[str]) -> dict[str, str]:
        if not user_ids:
            return {}
        return {u["id"]: u.get("full_name") or "Athlete" async for u in db.users.find(
            {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "full_name": 1})}


# --------------------------------------------------------------------------- #
# Weekly leagues
# --------------------------------------------------------------------------- #
class Leagues:
    @staticmethod
    def outcome(rank: int, size: int, division: str) -> str:
        cfg = CONFIG["league"]
        divisions = cfg["divisions"]
        index = divisions.index(division) if division in divisions else 0
        if rank <= cfg["promote"] and index < len(divisions) - 1:
            return "promoted"
        if size > cfg["promote"] + cfg["relegate"] and rank > size - cfg["relegate"] and index > 0:
            return "relegated"
        return "stayed"

    @staticmethod
    def next_division(division: str, outcome: str) -> str:
        divisions = CONFIG["league"]["divisions"]
        index = divisions.index(division) if division in divisions else 0
        index += {"promoted": 1, "relegated": -1}.get(outcome, 0)
        return divisions[max(0, min(len(divisions) - 1, index))]

    @staticmethod
    async def place(db, user_id: str, division: str, week: str) -> dict:
        existing = await db.league_members.find_one({"week": week, "user_id": user_id}, {"_id": 0})
        if existing:
            return existing
        size = CONFIG["league"]["group_size"]
        group = await db.league_groups.find_one_and_update(
            {"week": week, "division": division, "size": {"$lt": size}, "closed": False},
            {"$inc": {"size": 1}}, projection={"_id": 0})
        if not group:
            group = {"id": f"{week}-{division}-{utcnow().strftime('%H%M%S%f')}", "week": week,
                     "division": division, "size": 1, "closed": False, "created_at": utcnow()}
            await db.league_groups.insert_one(dict(group))
        row = {"week": week, "user_id": user_id, "group_id": group["id"], "division": division, "joined_at": utcnow()}
        try:
            await db.league_members.insert_one(dict(row))
        except DuplicateKeyError:
            await db.league_groups.update_one({"id": group["id"]}, {"$inc": {"size": -1}})
            return await db.league_members.find_one({"week": week, "user_id": user_id}, {"_id": 0})
        return row

    @staticmethod
    async def standings(db, group_id: str, week: str) -> list[dict]:
        start, end = week_bounds(week)
        ids = [m["user_id"] async for m in db.league_members.find({"group_id": group_id}, {"_id": 0, "user_id": 1})]
        scores = {}
        for uid in ids:
            scores[uid] = float(await Ledger.total(db, uid, start, end))
        names = await Names.lookup(db, ids)
        return [{"rank": place, "user_id": uid, "name": names.get(uid), "xp": int(xp)}
                for place, uid, xp in channel_challenges.rank(scores)]

    @staticmethod
    async def close_group(db, group: dict) -> list[dict]:
        """Close a past week's group exactly once; returns per-member results."""
        claimed = await db.league_groups.find_one_and_update(
            {"id": group["id"], "closed": False}, {"$set": {"closed": True, "closed_at": utcnow()}})
        if not claimed:
            return []
        table = await Leagues.standings(db, group["id"], group["week"])
        results = []
        for row in table:
            outcome = Leagues.outcome(row["rank"], len(table), group["division"])
            nxt = Leagues.next_division(group["division"], outcome)
            await db.league_members.update_one({"week": group["week"], "user_id": row["user_id"]},
                                               {"$set": {"rank": row["rank"], "xp": row["xp"], "outcome": outcome,
                                                         "next_division": nxt}})
            await db.progress_profiles.update_one({"user_id": row["user_id"]}, {"$set": {"division": nxt}})
            await Ledger.award(db, row["user_id"], f"league:{group['week']}", "league_result", 0,
                               meta={"week": group["week"], "rank": row["rank"], "outcome": outcome,
                                     "division": group["division"], "next_division": nxt, "size": len(table)})
            if outcome == "promoted":
                await Ledger.award(db, row["user_id"], f"league_promoted:{group['week']}", "league_promoted", 0)
            if row["rank"] == 1 and row["xp"] > 0:
                await Ledger.award(db, row["user_id"], f"league_champion:{group['week']}", "league_champion", 0)
            results.append({**row, "outcome": outcome, "next_division": nxt})
        return results

    @staticmethod
    async def close_due(db, now: datetime) -> int:
        current = week_key(now)
        closed = 0
        async for group in db.league_groups.find({"closed": False, "week": {"$lt": current}}, {"_id": 0}).limit(200):
            if await Leagues.close_group(db, group):
                closed += 1
        return closed

    @staticmethod
    async def view(db, user_id: str, profile: dict, now: datetime) -> dict:
        week = week_key(now)
        await Leagues.close_due(db, now)
        profile = await db.progress_profiles.find_one({"user_id": user_id}, {"_id": 0}) or profile
        if profile.get("leagues_opt_out"):
            return {"week": week, "opted_out": True}
        start, end = week_bounds(week)
        if await Ledger.total(db, user_id, start, end) <= 0:
            return {"week": week, "division": profile.get("division"), "placed": False, "ends_at": end,
                    "last_result": await Leagues.last_result(db, user_id)}
        member = await Leagues.place(db, user_id, profile.get("division") or CONFIG["league"]["divisions"][0], week)
        table = await Leagues.standings(db, member["group_id"], week)
        size = len(table)
        for row in table:
            row["zone"] = Leagues.outcome(row["rank"], size, member["division"])
            row["me"] = row["user_id"] == user_id
        return {"week": week, "division": member["division"], "placed": True, "ends_at": end,
                "table": table, "promote": CONFIG["league"]["promote"], "relegate": CONFIG["league"]["relegate"],
                "last_result": await Leagues.last_result(db, user_id)}

    @staticmethod
    async def last_result(db, user_id: str) -> dict | None:
        row = await db.xp_ledger.find_one({"user_id": user_id, "kind": "league_result"}, {"_id": 0, "meta": 1, "at": 1},
                                          sort=[("at", -1)])
        return {**row["meta"], "at": row["at"]} if row else None


# --------------------------------------------------------------------------- #
# Community cups (monthly, average XP per active member — fair to small clubs)
# --------------------------------------------------------------------------- #
class Cups:
    @staticmethod
    async def standings(db, month: str) -> list[dict]:
        start, end = month_bounds(month)
        xp_by_user = {row["_id"]: row["xp"] async for row in db.xp_ledger.aggregate([
            {"$match": {"at": {"$gte": start, "$lt": end}, "kind": {"$nin": ["cup_won", "badge", "challenge"]}}},
            {"$group": {"_id": "$user_id", "xp": {"$sum": "$xp"}}}]) if row["xp"] > 0}
        if not xp_by_user:
            return []
        clubs: dict[str, list[int]] = {}
        async for m in db.community_members.find({"user_id": {"$in": list(xp_by_user)}, "status": "active"},
                                                 {"_id": 0, "community_id": 1, "user_id": 1}):
            clubs.setdefault(m["community_id"], []).append(xp_by_user[m["user_id"]])
        minimum = CONFIG["cup"]["min_active_members"]
        scores = {cid: round(sum(v) / len(v), 1) for cid, v in clubs.items() if len(v) >= minimum}
        names = {c["id"]: c.get("name") async for c in db.communities.find({"id": {"$in": list(scores)}}, {"_id": 0, "id": 1, "name": 1})}
        return [{"rank": place, "community_id": cid, "name": names.get(cid), "score": score,
                 "active_members": len(clubs[cid])}
                for place, cid, score in channel_challenges.rank(scores)[:CONFIG["cup"]["max_ranked"]]]

    @staticmethod
    async def close_previous(db, now: datetime) -> dict | None:
        start, _ = month_bounds(month_key(now))
        previous = month_key(start - timedelta(days=1))
        if await db.progress_cups.find_one({"month": previous}, {"_id": 1}):
            return None
        table = await Cups.standings(db, previous)
        doc = {"month": previous, "winner": table[0] if table else None, "podium": table[:3], "closed_at": utcnow()}
        try:
            await db.progress_cups.insert_one(dict(doc))
        except DuplicateKeyError:
            return None
        if table:
            p_start, p_end = month_bounds(previous)
            active = set(await db.xp_ledger.distinct("user_id", {"at": {"$gte": p_start, "$lt": p_end}, "xp": {"$gt": 0}}))
            async for m in db.community_members.find({"community_id": table[0]["community_id"], "status": "active"},
                                                     {"_id": 0, "user_id": 1}):
                if m["user_id"] in active:
                    await Ledger.award(db, m["user_id"], f"cup:{previous}", "cup_won", 0,
                                       meta={"month": previous, "community_id": table[0]["community_id"]})
        return doc

    @staticmethod
    async def view(db, user_id: str, now: datetime) -> dict:
        await Cups.close_previous(db, now)
        month = month_key(now)
        mine = set(await db.community_members.distinct("community_id", {"user_id": user_id, "status": "active"}))
        table = await Cups.standings(db, month)
        for row in table:
            row["mine"] = row["community_id"] in mine
        last = await db.progress_cups.find_one({}, {"_id": 0}, sort=[("month", -1)])
        _, end = month_bounds(month)
        return {"month": month, "ends_at": end, "table": table, "last": last}


# --------------------------------------------------------------------------- #
# Facade
# --------------------------------------------------------------------------- #
CELEBRATION_KINDS = ("badge", "challenge", "league_result", "cup_won", "pro_credit", "level_up")


class Progress:
    @staticmethod
    async def sync(db, user_id: str, now: datetime | None = None) -> dict:
        """Backfill verified activity, refresh streak, badges and unlocks. Idempotent."""
        now = now or utcnow()
        await Ledger.ensure_indexes(db)
        profile = await Profiles.get(db, user_id)
        await Awards.backfill(db, user_id)
        streak = await Streak.refresh(db, user_id, now.date())
        await Challenges.ensure_solo(db, user_id, now)
        async for ch in db.progress_challenges.find({"$or": [
                {"kind": "solo", "creator_id": user_id, "ends_at": {"$gt": now - timedelta(days=8)}},
                {"id": {"$in": await db.progress_challenge_members.distinct("challenge_id", {"user_id": user_id})},
                 "ends_at": {"$gt": now - timedelta(days=8)}}]}, {"_id": 0}):
            await Challenges.view(db, user_id, ch, now)
        # Badges can raise the level and the level can unlock badges: two passes settle it.
        for _ in range(2):
            xp = await Ledger.total(db, user_id)
            level = Levels.level_for(xp)
            counters = await Badges.counters(db, user_id, streak, level)
            await Badges.evaluate(db, user_id, counters)
        xp = await Ledger.total(db, user_id)
        level = Levels.level_for(xp)
        for reached in range(max(2, int(profile.get("level") or 1) + 1), level + 1):
            await Ledger.award(db, user_id, f"level_up:{reached}", "level_up", 0, meta={"level": reached})
        await Rewards.grant_pro_credit(db, user_id, level)
        await Profiles.set(db, user_id, {"xp": xp, "level": level, "stage": Levels.stage_for(level),
                                         "streak": streak.get("current", 0), "synced_at": now})
        return {"profile": {**profile, "xp": xp, "level": level}, "streak": streak, "counters": counters}

    @staticmethod
    async def week(db, user_id: str, profile: dict, now: datetime) -> dict:
        week = week_key(now)
        start, end = week_bounds(week)
        match = {"user_id": user_id, "at": {"$gte": start, "$lt": end}}
        workouts = await db.xp_ledger.count_documents({**match, "kind": "workout"})
        active = await db.xp_ledger.distinct("day", {**match, "kind": {"$in": list(TRAINING_KINDS)}})
        steps = await db.xp_ledger.aggregate([{"$match": {**match, "kind": "steps_5k"}},
                                              {"$group": {"_id": None, "v": {"$sum": "$meta.steps"}}}]).to_list(1)
        minutes = await db.xp_ledger.aggregate([{"$match": {**match, "kind": "workout"}},
                                                {"$group": {"_id": None, "v": {"$sum": "$meta.minutes"}}}]).to_list(1)
        return {"week": week, "starts_at": start, "ends_at": end,
                "workouts": workouts, "workouts_goal": int(profile.get("weekly_goal_workouts") or 3),
                "active_days": sorted(active), "active_days_goal": 7,
                "steps": int(steps[0]["v"] or 0) if steps else 0,
                "steps_goal": int(profile.get("weekly_goal_steps") or CONFIG["weekly_goal"]["default_steps"]),
                "minutes": int(minutes[0]["v"] or 0) if minutes else 0,
                "xp": await Ledger.total(db, user_id, start, end)}

    @staticmethod
    async def celebrations(db, user_id: str, since: datetime) -> list[dict]:
        rows = db.xp_ledger.find({"user_id": user_id, "kind": {"$in": list(CELEBRATION_KINDS)},
                                  "created_at": {"$gt": aware(since)}}, {"_id": 0, "user_id": 0}).sort("created_at", 1).limit(10)
        return [row async for row in rows]

    @staticmethod
    async def summary(db, user_id: str, now: datetime | None = None) -> dict:
        now = now or utcnow()
        synced = await Progress.sync(db, user_id, now)
        profile = await Profiles.get(db, user_id)
        xp = synced["profile"]["xp"]
        level = Levels.summary(xp)
        return {
            **level,
            "streak": synced["streak"],
            "week": await Progress.week(db, user_id, profile, now),
            "badges": await Badges.wall(db, user_id, synced["counters"]),
            "counters": synced["counters"],
            "recent": await Ledger.recent(db, user_id, 15),
            "frame": profile.get("frame", "none"),
            "division": profile.get("division"),
            "celebrations": await Progress.celebrations(db, user_id, profile.get("seen_until") or now),
        }
