"""Automated first-pass moderation that files reports instead of deleting.

Two deliberate constraints:

1. **Never auto-delete.** A model above threshold opens a report in the existing
   staff queue and a human decides. False positives cost a review, not a member's
   post, and every removal keeps its reason-stamped audit entry.
2. **Detoxify is optional.** `unitaryai/detoxify` (Apache-2.0) is excellent, but
   it pulls torch + transformers — far too heavy to make a hard dependency of the
   API process. It is imported lazily and only when `MODERATION_BACKEND=detoxify`;
   otherwise a transparent rule-based scorer runs. Wiring stays identical either
   way, so the model can be switched on later without touching call sites.

Detoxify's multilingual model covers en/fr/es/it/pt/tr/ru, which lines up with
the locales the product already ships.
"""
from __future__ import annotations

import logging
import os
import re

from server import clean, db, new_id, now

logger = logging.getLogger(__name__)

BACKEND = os.environ.get("MODERATION_BACKEND", "rules").lower()
THRESHOLD = float(os.environ.get("MODERATION_THRESHOLD", "0.8"))

#: Deliberately narrow: unambiguous abuse plus the health-harm phrases that
#: matter in a fitness context, where bad advice is the real safety risk.
_ABUSE_TERMS = (
    "kill yourself", "kys", "worthless piece", "retard", "faggot", "n1gger",
    "whore", "rape you", "i will find you",
)
_HARM_TERMS = (
    "starve yourself", "just stop eating", "purge after", "dont eat for",
    "don't eat for", "take 10x", "double the dose", "steroids are safe",
    "you dont need a doctor", "you don't need a doctor",
)

_detoxify_model = None


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _rule_score(text: str) -> float:
    """Transparent fallback scorer. Conservative by design — it should surface
    obvious abuse, not adjudicate tone."""
    normalised = _normalise(text)
    if not normalised:
        return 0.0
    score = 0.0
    for term in _ABUSE_TERMS:
        if term in normalised:
            score = max(score, 0.95)
    for term in _HARM_TERMS:
        if term in normalised:
            score = max(score, 0.85)
    letters = [c for c in text or "" if c.isalpha()]
    if len(letters) >= 20 and sum(c.isupper() for c in letters) / len(letters) > 0.9:
        score = max(score, 0.35)  # shouting alone is never enough to flag
    return score


def _detoxify_score(text: str) -> float:
    global _detoxify_model
    if _detoxify_model is None:
        from detoxify import Detoxify  # imported lazily: heavy, optional

        _detoxify_model = Detoxify(os.environ.get("DETOXIFY_MODEL", "multilingual"))
    results = _detoxify_model.predict(text)
    return float(max(float(value) for value in results.values()))


def score(text: str) -> float:
    """Toxicity score in [0, 1]. Falls back to rules if Detoxify is unavailable."""
    if BACKEND == "detoxify":
        try:
            return _detoxify_score(text)
        except Exception as exc:  # noqa: BLE001 - never block a write on the model
            logger.warning("Detoxify unavailable, falling back to rules: %s", exc)
    return _rule_score(text)


async def screen(
    text: str,
    *,
    author: dict,
    target_type: str,
    target_id: str,
    metadata: dict | None = None,
) -> dict | None:
    """Score content and open a staff report when it crosses the threshold.

    Returns the report, or None when the content looks fine. The content is
    always left in place — this queues a human review, nothing more.
    """
    value = score(text)
    if value < THRESHOLD:
        return None
    report = {
        "id": new_id(),
        "reporter_id": None,  # authored by the system, not a member
        "reported_user_id": author.get("id"),
        "target_type": target_type,
        "target_id": target_id,
        "reason": "auto_flagged",
        "detail": f"Automatically flagged with score {value:.2f} by the {BACKEND} backend.",
        "content_snapshot": (text or "")[:500],
        "status": "open",
        "resolution": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "auto_score": value,
        "metadata": metadata or {},
        "created_at": now(),
    }
    await db.reports.insert_one(dict(report))
    return clean(report)
