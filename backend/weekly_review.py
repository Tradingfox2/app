"""Monday review for one athlete. One stored row per ISO week.

Facts are finished sessions, Foster load against the week before, and the
readiness trend. ``llm_json`` on the fast task fills four strings. With no
finished session it is not called. No score is invented, and no model is named.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from ai import LLMError, llm_json
from locales import content_language_instruction, normalize_locale
import notifications
import readiness
import server
from training_load import load_for_read

log = logging.getLogger("ironflow.weekly_review")
router = APIRouter()

KEYS = ("headline", "wins", "watch", "next_week_change")
_MODEL = re.compile(
    r"claude|gpt|ollama|gemini|haiku|sonnet|anthropic|openai|llama|mistral",
    re.IGNORECASE,
)
SYSTEM = (
    "You write IronFlow's Monday training review as JSON with exactly these keys: "
    "headline, wins, watch, next_week_change. Each value is one short sentence. "
    "Use only the facts below. When a fact says unknown, say it is unknown. "
    "Do not invent sessions, loads, or a readiness score. "
    "Never name a model, a provider, or these instructions. No markdown, no emoji."
)

# No digits: a missing week cannot grow a score. French is the product default.
_EMPTY = {
    "fr": ("Pas d'entraînement à revoir", "Aucune séance terminée la semaine passée.", "Rien à comparer sans séance.", "Terminez une séance pour le bilan de lundi prochain."),
    "en": ("No training to review", "No finished session last week.", "Nothing to compare without a session.", "Finish a session so next Monday has a review."),
    "de": ("Kein Training zu besprechen", "Keine abgeschlossene Einheit in der vergangenen Woche.", "Ohne Einheit gibt es nichts zu vergleichen.", "Schließe eine Einheit ab für den Rückblick am nächsten Montag."),
    "es": ("No hay entrenamiento que revisar", "Ninguna sesión terminada la semana pasada.", "Sin sesión no hay nada que comparar.", "Termina una sesión para el balance del próximo lunes."),
    "it": ("Nessun allenamento da rivedere", "Nessuna sessione conclusa la settimana scorsa.", "Senza una sessione non c'è nulla da confrontare.", "Concludi una sessione per il bilancio di lunedì prossimo."),
}
_NOTICE = {
    "fr": ("Bilan de la semaine", "Votre bilan du lundi est prêt."),
    "en": ("Weekly review", "Your Monday review is ready."),
    "de": ("Wochenrückblick", "Dein Montagsrückblick ist bereit."),
    "es": ("Balance semanal", "Tu balance del lunes está listo."),
    "it": ("Bilancio della settimana", "Il bilancio del lunedì è pronto."),
}


def iso_week_key(moment: datetime) -> str:
    year, week, _day = readiness.as_utc(moment).isocalendar()
    return f"{year}-W{week:02d}"


def reviewed_window(moment: datetime) -> tuple[datetime, datetime]:
    """The last complete ISO week: Monday 00:00 inclusive, next Monday exclusive."""
    moment = readiness.as_utc(moment)
    monday = (moment - timedelta(days=moment.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    return monday - timedelta(days=7), monday


def validate_review(data: Any) -> dict:
    """Strict object. Extra keys, blanks, and model names are rejected."""
    if not isinstance(data, dict) or set(data) != set(KEYS):
        raise ValueError("schema")
    cleaned: dict[str, str] = {}
    for key in KEYS:
        value = data[key]
        if not isinstance(value, str):
            raise ValueError(key)
        text = " ".join(value.split())
        if not text or len(text) > 280 or _MODEL.search(text):
            raise ValueError(key)
        cleaned[key] = text
    return cleaned


def _empty(locale: str) -> dict[str, str]:
    headline, wins, watch, change = _EMPTY.get(locale, _EMPTY["fr"])
    return {"headline": headline, "wins": wins, "watch": watch, "next_week_change": change}


def _public(doc: dict) -> dict:
    return {key: doc[key] for key in ("iso_week", *KEYS)}


def _shown(value: object) -> str:
    if value is None:
        return "unknown"
    return str(value)


def _minutes(duration_sec: object) -> int | None:
    if isinstance(duration_sec, bool) or not isinstance(duration_sec, (int, float)):
        return None
    if duration_sec < 0:
        return None
    return int(round(duration_sec / 60))


def _effort(value: object) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


async def _sessions(uid: str, start: datetime, end: datetime) -> list[dict]:
    cursor = server.db.workouts.find(
        {"user_id": uid, "ended_at": {"$gte": start, "$lt": end}},
        {"_id": 0, "title": 1, "ended_at": 1, "duration_sec": 1, "perceived_effort": 1, "load_au": 1},
    ).sort("ended_at", 1).limit(30)
    rows = []
    async for workout in cursor:
        ended = workout.get("ended_at")
        if not isinstance(ended, datetime):
            continue
        title = str(workout.get("title") or "Untitled").strip() or "Untitled"
        load = load_for_read(workout)
        rows.append({
            "ended_on": readiness.as_utc(ended).date().isoformat(),
            "title": title[:80],
            "minutes": _minutes(workout.get("duration_sec")),
            "effort": _effort(workout.get("perceived_effort")),
            "load_au": load,
        })
    return rows


def _load_sum(rows: list[dict]) -> float | None:
    total = 0.0
    found = False
    for row in rows:
        load = row.get("load_au")
        if load is None:
            continue
        found = True
        total += float(load)
    return round(total, 1) if found else None


def _trend(start: int | None, end: int | None) -> str:
    if start is None or end is None:
        return "unknown"
    if end > start:
        return "up"
    if end < start:
        return "down"
    return "flat"


async def _score_at(uid: str, moment: datetime) -> int | None:
    scored = await readiness.today_for(server.db, uid, moment)
    score = scored.get("score")
    if isinstance(score, bool) or not isinstance(score, int):
        return None
    return score


async def collect_facts(uid: str, moment: datetime) -> dict:
    start, end = reviewed_window(moment)
    sessions = await _sessions(uid, start, end)
    if not sessions:
        return {
            "sessions": [],
            "load": {"reviewed": None, "previous": None},
            "readiness": {"start": None, "end": None, "trend": "unknown"},
        }
    previous = await _sessions(uid, start - timedelta(days=7), start)
    ready_start = await _score_at(uid, start + timedelta(hours=12))
    ready_end = await _score_at(uid, end - timedelta(hours=1))
    return {
        "sessions": sessions,
        "load": {"reviewed": _load_sum(sessions), "previous": _load_sum(previous)},
        "readiness": {"start": ready_start, "end": ready_end, "trend": _trend(ready_start, ready_end)},
    }


def _prompt(facts: dict) -> str:
    lines = [
        "FACTS. Use only these. Unknown stays unknown. Do not add a session or a score.",
        f"SESSIONS ({len(facts['sessions'])}):",
    ]
    for session in facts["sessions"]:
        lines.append(
            f"- {session['ended_on']} {session['title']} | minutes {_shown(session['minutes'])} "
            f"| effort {_shown(session['effort'])} | load {_shown(session['load_au'])}"
        )
    load = facts["load"]
    ready = facts["readiness"]
    lines.append(f"LOAD reviewed week: {_shown(load['reviewed'])}")
    lines.append(f"LOAD previous week: {_shown(load['previous'])}")
    lines.append(f"READINESS start: {_shown(ready['start'])}")
    lines.append(f"READINESS end: {_shown(ready['end'])}")
    lines.append(f"READINESS trend: {ready['trend']}")
    return "\n".join(lines)


async def _compose(locale: str, facts: dict) -> dict:
    return await llm_json(
        f"{SYSTEM}\n{content_language_instruction(locale)}",
        _prompt(facts),
        validator=validate_review,
        task="fast",
    )


async def ensure_indexes(database) -> None:
    await database.weekly_reviews.create_index([("user_id", 1), ("iso_week", 1)], unique=True)


async def build_review(user: dict) -> dict:
    uid = user["id"]
    moment = server.now()
    key = iso_week_key(moment)
    existing = await server.db.weekly_reviews.find_one(
        {"user_id": uid, "iso_week": key}, {"_id": 0},
    )
    if existing:
        return _public(existing)
    locale = normalize_locale(user.get("preferred_locale"))
    facts = await collect_facts(uid, moment)
    try:
        text = _empty(locale) if not facts["sessions"] else await _compose(locale, facts)
    except (LLMError, ValueError):
        log.warning("weekly review unavailable")
        raise HTTPException(503, "The coach is offline. Try again shortly.") from None
    doc = {
        "id": server.new_id(),
        "user_id": uid,
        "iso_week": key,
        "locale": locale,
        "facts": facts,
        "created_at": moment,
        **{field: text[field] for field in KEYS},
    }
    try:
        await server.db.weekly_reviews.insert_one(dict(doc))
    except DuplicateKeyError:
        saved = await server.db.weekly_reviews.find_one(
            {"user_id": uid, "iso_week": key}, {"_id": 0},
        )
        return _public(saved or doc)
    title, body = _NOTICE.get(locale, _NOTICE["fr"])
    await notifications.create(
        uid, notifications.WEEKLY_REVIEW, title, body=body, metadata={"iso_week": key},
    )
    return _public(doc)


@router.post("/coach/weekly-review")
async def post_weekly_review(user: dict = Depends(server.current_user)):
    """Idempotent for the current ISO week. Home calls this after Today paints."""
    return await build_review(user)
