"""Per-subject rate limiting on write paths.

A fixed-window counter in MongoDB: one document per (action, subject, window),
incremented atomically with `$inc` on an upsert, expired by a TTL index.

Why Mongo rather than in-process:
- Atomic across uvicorn workers and survives a restart — an in-process dict
  would reset on every deploy and let each worker grant its own full quota.
- No new dependency and no Redis to operate.
- Tests stay isolated: the collection lives in whatever `db` is patched in,
  whereas a module-level dict would leak counts between tests on one worker.

Why an awaited helper inside handlers rather than middleware: the limits are
keyed by the authenticated user (or, for login, the submitted email), which a
middleware only has after re-parsing the token. Calling `hit()` next to the
write keeps the key honest and makes the limit visible where it applies.

A fixed window can admit up to twice the limit across a boundary. That is an
accepted trade for simplicity at this scale; the goal is stopping floods and
scripts, not metering fair use to the request.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import server

#: `RATE_LIMITS=off` disables every limit — for load tests, never production.
ENABLED = os.environ.get("RATE_LIMITS", "on").lower() != "off"

#: action -> (max requests, window in seconds). Generous by design: a human
#: acting quickly must never see a 429, a script hammering an endpoint must.
LIMITS: dict[str, tuple[int, int]] = {
    "message": (30, 60),
    "reaction": (90, 60),
    "post": (10, 300),
    "comment": (40, 300),
    "like": (180, 60),
    "follow": (60, 3600),
    "direct_message": (40, 60),
    "login": (10, 300),
    "search": (60, 60),
    "invite_create": (20, 3600),
    "invite_redeem": (15, 600),
    "report": (20, 3600),
    "ticket": (10, 3600),
    "ticket_message": (60, 300),
    "bookmark": (120, 60),
    "vote": (60, 60),
    "checkout": (10, 3600),
    # One hit per request, and a request carries at most 25 events.
    "analytics": (60, 60),
    "gym_redeem": (15, 600),
    # Coach chat: 40 messages per user per day.
    "coach_chat": (40, 86400),
    # One Open Food Facts product read per scan. Not a search.
    "product_read": (60, 3600),
}


async def hit(action: str, subject: str) -> None:
    """Count one request; raise 429 once `subject` exceeds the action's limit."""
    if not ENABLED or action not in LIMITS:
        return
    limit, window = LIMITS[action]
    window_start = int(time.time() // window) * window
    key = f"{action}:{subject}:{window_start}"
    expires_at = datetime.fromtimestamp(window_start + window, timezone.utc)
    update = {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": expires_at}}
    try:
        # `server.db` is read at call time, not bound at import: tests swap the
        # database by patching `server.db`, and this then follows automatically.
        row = await server.db.rate_limits.find_one_and_update(
            {"key": key}, update, upsert=True, return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # Two first-requests raced the upsert; the loser simply increments.
        row = await server.db.rate_limits.find_one_and_update(
            {"key": key}, update, return_document=ReturnDocument.AFTER,
        )
    if row and row.get("count", 0) > limit:
        retry_after = max(1, window_start + window - int(time.time()))
        raise HTTPException(
            429,
            "You are doing that too often. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )
