"""Product-event hook for insightpipe.

insightpipe is not in this repository: there is no client, queue, or schema
for it. Other features record staff actions on `audit_log` and derive community
stats from the documents they already store. Neither of those is a product
event stream, so live-session transitions write here instead.

`emit` appends one document to `insight_events`. A later insightpipe consumer
can tail that collection, or replace this function, without touching the
call sites. A failure is logged and swallowed: losing an analytics row must
not fail start, join, or end.
"""
from __future__ import annotations

import logging

import server

logger = logging.getLogger(__name__)


async def emit(name: str, *, actor_id: str, session_id: str, metadata: dict | None = None) -> None:
    entry = {
        "id": server.new_id(),
        "name": name,
        "actor_id": actor_id,
        "session_id": session_id,
        "metadata": metadata or {},
        "created_at": server.now(),
    }
    try:
        await server.db.insight_events.insert_one(dict(entry))
    except Exception as exc:  # noqa: BLE001 - analytics must not fail the session
        logger.warning("insight event %s for %s was not stored: %s", name, session_id, exc)
