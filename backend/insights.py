"""Retired sink for live-session product events.

Live start, join, and end are stored on Mongo `analytics_events` by
`routers.community._emit_live`, which calls `analytics.record`. Staff
Analytics reads that collection. This module used to insert the same
occurrences into `insight_events`. That write is stopped so one live
action cannot land in two event logs.

`insight_events` is not a read model. Rows already stored there are
history only. Community Insights (`GET /communities/{id}/insights`) counts
memberships and messages. The partner dashboard counts members, pending
requests, and owned communities. The home training week card counts
workouts. None of those screens read `insight_events` or `analytics_events`.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def emit(name: str, *, actor_id: str, session_id: str, metadata: dict | None = None) -> None:
    """Do not store a product event.

    Kept so an old caller cannot recreate the dual write by accident.
    """
    logger.info(
        "insights.emit ignored name=%s actor=%s session=%s metadata_keys=%s; use analytics.record",
        name,
        actor_id,
        session_id,
        sorted((metadata or {}).keys()),
    )
