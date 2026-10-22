"""Follow-ups for the progress system: real-time XP hooks and motivating nudges.

Hooks are awaited inline and never fail the request that triggered them; the
full sync (streak, badges, unlocks) still runs on the next progress read, so a
skipped hook only delays XP, it never loses it.

Nudges go through `notifications.create`, so the member's per-type switches and
push preference apply. At most one progress nudge per member per day, none in
quiet hours, and copy never contains health values (no step counts, no heart
data) — only streak days, levels and badge names.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException
from pymongo.errors import DuplicateKeyError

import gamification as g
from gamification_config import CONFIG

logger = logging.getLogger(__name__)

PROGRESS_NUDGE = "progress_nudge"
LEAGUE_RESULT = "league_result"

COPY: dict[str, dict[str, tuple[str, str]]] = {
    "streak_at_risk": {
        "en": ("Your {n}-day streak ends tomorrow", "A short session or a walk today keeps it alive."),
        "fr": ("Votre série de {n} jours s'arrête demain", "Une courte séance ou une marche aujourd'hui la garde en vie."),
        "de": ("Deine {n}-Tage-Serie endet morgen", "Eine kurze Einheit oder ein Spaziergang heute hält sie am Leben."),
        "es": ("Tu racha de {n} días termina mañana", "Una sesión corta o un paseo hoy la mantiene viva."),
        "it": ("La tua serie di {n} giorni finisce domani", "Una breve sessione o una camminata oggi la tiene viva."),
    },
    "near_level": {
        "en": ("Level {n} is within reach", "One more workout should get you there."),
        "fr": ("Le niveau {n} est à portée", "Une séance de plus devrait suffire."),
        "de": ("Level {n} ist in Reichweite", "Ein Workout mehr sollte reichen."),
        "es": ("El nivel {n} está a tu alcance", "Un entrenamiento más debería bastar."),
        "it": ("Il livello {n} è a portata di mano", "Un allenamento in più dovrebbe bastare."),
    },
    "near_badge": {
        "en": ("Almost there: {badge}", "You're close to unlocking this badge."),
        "fr": ("Presque : {badge}", "Vous êtes tout près de débloquer ce badge."),
        "de": ("Fast geschafft: {badge}", "Du bist kurz davor, dieses Abzeichen freizuschalten."),
        "es": ("Casi: {badge}", "Estás muy cerca de desbloquear esta insignia."),
        "it": ("Ci sei quasi: {badge}", "Sei vicino a sbloccare questo badge."),
    },
    "comeback": {
        "en": ("Ready for a fresh start?", "No pressure. One easy session restarts your streak."),
        "fr": ("Prêt pour un nouveau départ ?", "Sans pression. Une séance facile relance votre série."),
        "de": ("Bereit für einen Neustart?", "Ganz ohne Druck. Eine lockere Einheit startet deine Serie neu."),
        "es": ("¿Listo para empezar de nuevo?", "Sin presión. Una sesión suave reinicia tu racha."),
        "it": ("Pronto a ripartire?", "Nessuna pressione. Una sessione leggera riavvia la tua serie."),
    },
    "league_promoted": {
        "en": ("Promoted to {division}!", "You finished #{rank} last week."),
        "fr": ("Promu en {division} !", "Vous avez terminé n°{rank} la semaine dernière."),
        "de": ("Aufstieg in {division}!", "Du warst letzte Woche auf Platz {rank}."),
        "es": ("¡Ascenso a {division}!", "Terminaste n.º {rank} la semana pasada."),
        "it": ("Promosso in {division}!", "Hai chiuso al n. {rank} la settimana scorsa."),
    },
    "league_stayed": {
        "en": ("You held your place in {division}", "You finished #{rank} last week. New week, new table."),
        "fr": ("Vous restez en {division}", "N°{rank} la semaine dernière. Nouvelle semaine, nouveau classement."),
        "de": ("Du bleibst in {division}", "Platz {rank} letzte Woche. Neue Woche, neue Tabelle."),
        "es": ("Sigues en {division}", "N.º {rank} la semana pasada. Nueva semana, nueva tabla."),
        "it": ("Resti in {division}", "N. {rank} la settimana scorsa. Nuova settimana, nuova classifica."),
    },
    "league_relegated": {
        "en": ("New week in {division}", "Last week was #{rank}. A couple of sessions and you're back up."),
        "fr": ("Nouvelle semaine en {division}", "N°{rank} la semaine dernière. Quelques séances et vous remontez."),
        "de": ("Neue Woche in {division}", "Platz {rank} letzte Woche. Ein paar Einheiten und du steigst wieder auf."),
        "es": ("Nueva semana en {division}", "N.º {rank} la semana pasada. Un par de sesiones y vuelves a subir."),
        "it": ("Nuova settimana in {division}", "N. {rank} la settimana scorsa. Un paio di sessioni e risali."),
    },
}

BADGE_NAMES = {"workouts_10": "10 workouts", "workouts_50": "50 workouts", "workouts_100": "100 workouts",
               "workouts_250": "250 workouts", "streak_7": "7-day streak", "streak_30": "30-day streak",
               "streak_100": "100-day streak", "minutes_1000": "1,000 minutes", "prs_10": "10 PRs",
               "gym_checkins_25": "25 gym check-ins", "challenges_5": "5 challenges"}


def _db():
    import server

    return server.db


def text(kind: str, locale: str | None, **values) -> tuple[str, str]:
    table = COPY[kind]
    title, body = table.get((locale or "en")[:2], table["en"])
    return title.format(**values), body.format(**values)


class Hooks:
    """Inline awards right after a verified action. Never raises."""

    @staticmethod
    async def workout_finished(user_id: str, workout: dict) -> None:
        try:
            await g.Ledger.ensure_indexes(_db())
            await g.Awards.workout(_db(), user_id, workout)
        except Exception as exc:  # noqa: BLE001
            logger.warning("progress hook (workout) skipped for %s: %s", user_id, exc)

    @staticmethod
    async def gym_checkin(user_id: str, visit: dict) -> None:
        try:
            await g.Ledger.ensure_indexes(_db())
            await g.Awards.gym_checkin(_db(), user_id, visit)
        except Exception as exc:  # noqa: BLE001
            logger.warning("progress hook (gym) skipped for %s: %s", user_id, exc)

    @staticmethod
    async def steps(user_id: str, day: str, value: float, row: dict) -> None:
        try:
            if g.Awards.step_row_counts({**row, "metric": "steps"}):
                await g.Ledger.ensure_indexes(_db())
                await g.Awards.steps_day(_db(), user_id, day, float(value))
        except Exception as exc:  # noqa: BLE001
            logger.warning("progress hook (steps) skipped for %s: %s", user_id, exc)

    @staticmethod
    async def social(user_id: str, kind: str, ref: str) -> None:
        try:
            await g.Ledger.ensure_indexes(_db())
            await g.Awards.social(_db(), user_id, kind, ref, g.utcnow())
        except Exception as exc:  # noqa: BLE001
            logger.warning("progress hook (%s) skipped for %s: %s", kind, user_id, exc)


class Nudges:
    @staticmethod
    def local_hour(user: dict, now: datetime) -> int:
        try:
            return now.astimezone(ZoneInfo(user.get("timezone") or "Europe/Berlin")).hour
        except Exception:  # noqa: BLE001 - unknown zone name
            return now.astimezone(ZoneInfo("Europe/Berlin")).hour

    @staticmethod
    def quiet(hour: int) -> bool:
        cfg = CONFIG["nudges"]
        start, end = cfg["quiet_start_hour"], cfg["quiet_end_hour"]
        return hour >= start or hour < end

    @staticmethod
    def choose(summary: dict, today: str) -> tuple[str, str, dict] | None:
        """Pick at most one nudge (kind, dedupe key, values). Pure, so it is unit-tested."""
        streak = summary["streak"]
        cfg = CONFIG["nudges"]
        if streak.get("at_risk") and streak.get("current", 0) >= 3 and not streak.get("freezes"):
            return "streak_at_risk", f"streak_risk:{today}", {"n": streak["current"]}
        last = streak.get("last_day")
        if last:
            idle = (datetime.fromisoformat(today) - datetime.fromisoformat(last)).days
            if idle >= cfg["comeback_after_days"]:
                period = (datetime.fromisoformat(today).toordinal()) // cfg["comeback_every_days"]
                return "comeback", f"comeback:{period}", {}
        ratio = cfg["near_milestone_ratio"]
        if summary.get("level_span") and summary.get("into_level", 0) >= ratio * summary["level_span"]:
            return "near_level", f"near_level:{summary['level'] + 1}", {"n": summary["level"] + 1}
        for badge in summary.get("badges", []):
            if badge["unlocked_at"] or badge["id"] not in BADGE_NAMES:
                continue
            if badge["threshold"] > 1 and badge["value"] >= ratio * badge["threshold"]:
                return "near_badge", f"near_badge:{badge['id']}", {"badge": BADGE_NAMES[badge["id"]]}
        return None

    @staticmethod
    async def _claim(db, user_id: str, key: str) -> bool:
        await db.progress_nudges.create_index([("user_id", 1), ("key", 1)], unique=True)
        try:
            await db.progress_nudges.insert_one({"user_id": user_id, "key": key, "at": g.utcnow()})
        except DuplicateKeyError:
            return False
        return True

    @staticmethod
    async def for_user(db, user: dict, now: datetime) -> str | None:
        import notifications

        uid = user["id"]
        if Nudges.quiet(Nudges.local_hour(user, now)):
            return None
        today = now.date().isoformat()
        if await db.progress_nudges.find_one({"user_id": uid, "day": today}, {"_id": 1}):
            return None
        summary = await g.Progress.summary(db, uid, now)
        choice = Nudges.choose(summary, today)
        if not choice:
            return None
        kind, key, values = choice
        if not await Nudges._claim(db, uid, key):
            return None
        await db.progress_nudges.update_one({"user_id": uid, "key": key}, {"$set": {"day": today}})
        title, body = text(kind, user.get("preferred_locale"), **values)
        await notifications.create(uid, PROGRESS_NUDGE, title, body,
                                   {"target_type": "progress", "target_id": "progress", "nudge": kind})
        return kind

    @staticmethod
    async def league_results(db, now: datetime) -> int:
        import notifications

        await g.Leagues.close_due(db, now)
        sent = 0
        async for row in db.xp_ledger.find({"kind": "league_result", "at": {"$gte": now - timedelta(days=8)}},
                                           {"_id": 0}).limit(5000):
            meta = row.get("meta") or {}
            if not await Nudges._claim(db, row["user_id"], f"league:{meta.get('week')}"):
                continue
            user = await db.users.find_one({"id": row["user_id"]}, {"_id": 0, "preferred_locale": 1}) or {}
            outcome = meta.get("outcome", "stayed")
            division = meta.get("next_division") if outcome != "stayed" else meta.get("division")
            title, body = text(f"league_{outcome}", user.get("preferred_locale"),
                               division=str(division or "").title(), rank=meta.get("rank"))
            await notifications.create(row["user_id"], LEAGUE_RESULT, title, body,
                                       {"target_type": "progress", "target_id": "progress", "week": meta.get("week")})
            sent += 1
        return sent

    @staticmethod
    async def run(db, now: datetime | None = None, limit: int = 2000) -> dict:
        now = now or g.utcnow()
        await g.Ledger.ensure_indexes(db)
        results = {"league_results": await Nudges.league_results(db, now), "nudges": {}}
        active_since = now - timedelta(days=30)
        async for profile in db.progress_profiles.find({"synced_at": {"$gte": active_since}},
                                                       {"_id": 0, "user_id": 1}).limit(limit):
            user = await db.users.find_one({"id": profile["user_id"]},
                                           {"_id": 0, "id": 1, "preferred_locale": 1, "timezone": 1})
            if not user:
                continue
            try:
                kind = await Nudges.for_user(db, user, now)
            except Exception as exc:  # noqa: BLE001 - one member never stops the run
                logger.warning("nudge for %s failed: %s", user["id"], exc)
                continue
            if kind:
                results["nudges"][kind] = results["nudges"].get(kind, 0) + 1
        return results


router = APIRouter()


@router.post("/progress/nudges/run")
async def run_nudges(x_cron_secret: str = Header(default="")):
    """Hourly job (e.g. a Render Cron Job): close leagues, send result and progress nudges."""
    secret = os.environ.get("PROGRESS_CRON_SECRET", "")
    if not secret or x_cron_secret != secret:
        raise HTTPException(403, "Forbidden")
    return await Nudges.run(_db())
