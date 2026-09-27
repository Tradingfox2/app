"""Analytics ingest and the staff rollup. Counts come only from stored events."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import analytics  # noqa: E402
import server  # noqa: E402
import staff  # noqa: E402
from routers.analytics import EventsIn, event_counts, ingest  # noqa: E402


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient(
            "mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000,
        )
        db = client[f"ironflow_analytics_test_{uuid.uuid4().hex}"]
        try:
            await scenario(db)
        finally:
            await client.drop_database(db.name)
            client.close()
    asyncio.run(run())


def account(uid, **extra):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete", **extra}


def test_unknown_event_and_spoofed_actor_are_rejected():
    with pytest.raises(ValidationError):
        EventsIn.model_validate({"name": "page_view"})
    with pytest.raises(ValidationError):
        EventsIn.model_validate({"name": "post_created", "actor_id": "someone-else"})
    with pytest.raises(ValidationError):
        EventsIn.model_validate({"name": "post_created", "source": "server"})
    with pytest.raises(ValidationError):
        EventsIn.model_validate({"name": "post_created", "props": ["nope"]})


def test_three_events_aggregate_and_ignore_domain_rows(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(server, "db", db)
        await analytics.ensure_indexes()
        athlete = account("athlete-1")
        moment = datetime.now(timezone.utc)
        first = str(uuid.uuid4())

        # Three accepted client events. The post document below must not count.
        posted = await ingest(EventsIn.model_validate({
            "events": [
                {"name": "post_created", "event_id": first, "props": {
                    "post_id": "p-1", "has_media": False, "has_poll": True,
                    "content": "this text must not be stored",
                }},
                {"name": "post_created", "props": {"post_id": "p-2", "has_media": True, "has_poll": False}},
                {"name": "screen_view", "props": {"screen": "community"}},
            ],
        }), athlete)
        assert posted == {"accepted": 3, "duplicates": 0}

        again = await ingest(EventsIn.model_validate({
            "name": "post_created", "event_id": first, "props": {"post_id": "p-1"},
        }), athlete)
        assert again == {"accepted": 0, "duplicates": 1}

        # Inside 7d, outside 24h. And one row older than both windows.
        await db.analytics_events.insert_one({
            "event_id": str(uuid.uuid4()), "name": "post_created",
            "ts": moment - timedelta(days=3), "actor_id": "athlete-1",
            "role": "athlete", "session_id": None, "source": "server", "props": {"post_id": "p-old"},
        })
        await db.analytics_events.insert_one({
            "event_id": str(uuid.uuid4()), "name": "post_created",
            "ts": moment - timedelta(days=10), "actor_id": "athlete-1",
            "role": "athlete", "session_id": None, "source": "server", "props": {"post_id": "p-ancient"},
        })
        # A real post is not an analytics event.
        await db.posts.insert_one({
            "id": "p-domain", "created_at": moment, "status": "active", "author_id": "athlete-1",
        })

        stored = await db.analytics_events.find_one({"event_id": first}, {"_id": 0})
        assert stored["actor_id"] == "athlete-1"
        assert stored["source"] == "client"
        assert stored["role"] == "athlete"
        assert stored["props"] == {"post_id": "p-1", "has_media": False, "has_poll": True}
        assert stored["ts"].tzinfo is not None

        with pytest.raises(HTTPException) as denied:
            await event_counts(athlete)
        assert denied.value.status_code == 403
        with pytest.raises(HTTPException) as coach_denied:
            await event_counts(account("coach-1", role="coach", coach_status="approved"))
        assert coach_denied.value.status_code == 403
        # A product admin without a staff role is not staff.
        with pytest.raises(HTTPException) as product_admin:
            await event_counts(account("boss-product", role="admin"))
        assert product_admin.value.status_code == 403

        support = account("support", staff_role="support")
        assert (await staff.require("analytics.read")(support))["id"] == "support"
        summary = await event_counts(support)
        assert summary["windows"]["24h"]["post_created"] == 2
        assert summary["windows"]["7d"]["post_created"] == 3
        assert summary["windows"]["24h"]["screen_view"] == 1
        assert summary["windows"]["7d"]["screen_view"] == 1
        assert summary["windows"]["24h"]["ticket_created"] == 0
        assert summary["windows"]["7d"]["live_session_started"] == 0
        assert set(summary["windows"]["24h"]) == set(analytics.EVENT_NAMES)

    run_isolated(scenario)
