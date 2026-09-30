"""Product analytics events.

One Mongo collection, `analytics_events`, is the only source for the staff
rollup. Counts are aggregations over stored rows. Nothing here samples,
estimates, or invents a number.

Live source of truth is this Mongo collection. FastAPI writes and reads it
through Motor only. There is no Supabase migration and no runtime write
to Postgres.

`ts` is the server's UTC receipt time. Client clocks cannot move an event
into or out of the 24h / 7d windows. `actor_id`, `role` and `source` are
taken from the authenticated user and the call site, never from the body.
"""
from __future__ import annotations

import re
import uuid
from datetime import timedelta
from typing import Any, Literal

from pymongo.errors import DuplicateKeyError

EventName = Literal[
    "screen_view",
    "ticket_created",
    "ticket_replied",
    "post_created",
    "post_shared",
    "live_session_started",
    "live_session_joined",
    "live_session_ended",
    "story_created",
    "workout_completed",
]
Source = Literal["client", "server"]

#: Stable order is the order the staff Analytics page follows.
EVENT_NAMES: tuple[EventName, ...] = (
    "screen_view",
    "ticket_created",
    "ticket_replied",
    "post_created",
    "post_shared",
    "live_session_started",
    "live_session_joined",
    "live_session_ended",
    "story_created",
    "workout_completed",
)

#: Keys a caller may attach. Anything else is dropped so a post body, an
#: email, or a health value cannot land in the event log by accident.
ALLOWED_PROPS: dict[str, frozenset[str]] = {
    "screen_view": frozenset({"screen"}),
    "ticket_created": frozenset({"ticket_id"}),
    "ticket_replied": frozenset({"ticket_id"}),
    "post_created": frozenset({"post_id", "has_media", "has_poll", "community_id"}),
    "post_shared": frozenset({"post_id", "channel"}),
    "live_session_started": frozenset({"session_id", "channel_id"}),
    "live_session_joined": frozenset({"session_id"}),
    "live_session_ended": frozenset({"session_id", "channel_id"}),
    "story_created": frozenset({"story_id", "has_media", "highlight"}),
    "workout_completed": frozenset({"workout_id"}),
}
BOOL_PROPS = frozenset({"has_media", "has_poll", "highlight"})
PRODUCT_ROLES = frozenset({"athlete", "coach", "admin"})
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_MAX_PROP_LEN = 80


def sanitize_props(name: str, raw: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only the allow-listed scalars for `name`."""
    if not raw:
        return {}
    allowed = ALLOWED_PROPS[name]
    cleaned: dict[str, Any] = {}
    for key, value in raw.items():
        if key not in allowed:
            continue
        if key in BOOL_PROPS:
            if isinstance(value, bool):
                cleaned[key] = value
            continue
        if isinstance(value, str):
            text = value.strip()
            if text and len(text) <= _MAX_PROP_LEN and text.isprintable():
                cleaned[key] = text
    return cleaned


def product_role(user: dict) -> str | None:
    role = user.get("role")
    return role if role in PRODUCT_ROLES else None


async def ensure_indexes(database=None) -> None:
    """`event_id` is unique; `(name, ts)` serves the rollup."""
    target = database if database is not None else server.db
    await target.analytics_events.create_index("event_id", unique=True)
    await target.analytics_events.create_index(
        [("name", 1), ("ts", -1)],
        name="analytics_events_name_ts",
    )


async def record(
    *,
    name: EventName,
    actor_id: str,
    source: Source,
    role: str | None = None,
    session_id: str | None = None,
    props: dict[str, Any] | None = None,
    event_id: str | None = None,
) -> Literal["accepted", "duplicate"]:
    """Insert one event. A repeated `event_id` is a duplicate, not a second row."""
    if name not in ALLOWED_PROPS:
        raise ValueError(f"Unknown analytics event: {name}")
    if source not in ("client", "server"):
        raise ValueError("source must be client or server")
    stored_id = str(uuid.UUID(event_id)) if event_id else server.new_id()
    doc = {
        "event_id": stored_id,
        "name": name,
        "ts": server.now(),
        "actor_id": actor_id,
        "role": role if role in PRODUCT_ROLES else None,
        "session_id": session_id,
        "source": source,
        "props": sanitize_props(name, props),
    }
    try:
        await server.db.analytics_events.insert_one(doc)
    except DuplicateKeyError:
        return "duplicate"
    return "accepted"


async def counts() -> dict:
    """Counts by event name for the last 24 hours and the last 7 days.

    Every taxonomy name is present. A name with no stored rows is 0.
    Rows older than 7 days, and names outside the taxonomy, are ignored.
    """
    moment = server.now()
    day_ago = moment - timedelta(hours=24)
    week_ago = moment - timedelta(days=7)
    # One count per name uses the (name, ts) index. 24h is not inferred from
    # the 7d total; each window is its own query against stored rows.
    last_day: dict[str, int] = {}
    last_week: dict[str, int] = {}
    for name in EVENT_NAMES:
        last_day[name] = await server.db.analytics_events.count_documents(
            {"name": name, "ts": {"$gte": day_ago}},
        )
        last_week[name] = await server.db.analytics_events.count_documents(
            {"name": name, "ts": {"$gte": week_ago}},
        )
    return {
        "generated_at": moment,
        "windows": {"24h": last_day, "7d": last_week},
    }


# After the event names. `server` imports the routers, and the analytics
# router reads `EventName` while this module is still loading.
import server  # noqa: E402
