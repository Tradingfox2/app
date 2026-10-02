"""Terra live path: demo sample data stays on the demo account, and one Whoop webhook.

The numbers in the webhook sample are the fields of that payload. The test
checks those fields were stored and that nulls, scores, and Terra's own
enrichment were not turned into extra metrics.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "terra-live-test-secret-0123456789abcdef")

import server  # noqa: E402,F401 — registers routers
from routers import wearables  # noqa: E402


def _matches(doc, query):
    for key, expected in query.items():
        if doc.get(key) != expected:
            return False
    return True


class _Collection:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def insert_many(self, docs):
        self.docs.extend(dict(doc) for doc in docs)

    async def delete_many(self, query):
        self.docs = [doc for doc in self.docs if not _matches(doc, query)]

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                return
        if not upsert:
            return
        created = dict(query)
        created.update(update.get("$setOnInsert", {}))
        created.update(update.get("$set", {}))
        self.docs.append(created)

    async def find_one(self, query, projection=None, sort=None):
        rows = [doc for doc in self.docs if _matches(doc, query)]
        if not rows:
            return None
        doc = dict(rows[0])
        if projection and projection.get("_id") == 0:
            doc.pop("_id", None)
        return doc

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if _matches(doc, query))


class _Database:
    def __init__(self):
        self.wearable_metrics = _Collection()
        self.wearable_sources = _Collection()


def _request(payload: dict) -> Request:
    raw = json.dumps(payload).encode()

    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/webhooks/terra",
            "raw_path": b"/api/webhooks/terra",
            "query_string": b"",
            "headers": [(b"content-type", b"application/json")],
            "client": ("127.0.0.1", 123),
            "server": ("test", 80),
        },
        receive,
    )


def _athlete():
    return {"id": "athlete-real", "email": "athlete@example.invalid", "role": "athlete"}


# Whoop sleep, current Terra model. The asleep total is null; the stages are
# the only duration. 5400 + 12600 + 7200 seconds is 7 hours. In-bed time,
# the sleep score, recovery_level, and data_enrichment are present so the
# test can show they were not stored.
WHOOP_SLEEP = {
    "type": "sleep",
    "version": "2022-03-16",
    "user": {
        "user_id": "terra-whoop-sample",
        "provider": "WHOOP",
        "reference_id": "athlete-real",
        "last_webhook_update": "2026-10-01T10:15:00.000000+00:00",
    },
    "data": [
        {
            "metadata": {
                "start_time": "2026-09-30T22:10:00.000000-04:00",
                "end_time": "2026-10-01T06:05:00.000000-04:00",
                "is_nap": False,
                "summary_id": "whoop-sleep-sample-1",
                "upload_type": 1,
            },
            "heart_rate_data": {
                "summary": {
                    "avg_hrv_rmssd": 64.5,
                    "avg_hrv_sdnn": None,
                    "resting_hr_bpm": 49,
                }
            },
            "sleep_durations_data": {
                "asleep": {
                    "duration_asleep_state_seconds": None,
                    "duration_deep_sleep_state_seconds": 5400,
                    "duration_light_sleep_state_seconds": 12600,
                    "duration_REM_sleep_state_seconds": 7200,
                },
                "other": {"duration_in_bed_seconds": 30600},
            },
            "readiness_data": {"readiness": None, "recovery_level": 5},
            "scores": {"sleep": 81},
            "data_enrichment": {"sleep_score": 77.2},
        }
    ],
}


def test_simulated_wearable_path_is_unreachable_for_non_demo(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(wearables, "db", db)
        monkeypatch.setattr(wearables, "TERRA_CONFIGURED", False)
        athlete = _athlete()
        connected = await wearables.connect_source("garmin", athlete)
        assert connected["status"] == "pending"
        assert connected["simulated"] is False
        assert connected.get("terra_user_id") is None
        assert await db.wearable_metrics.count_documents({"user_id": athlete["id"]}) == 0

        await db.wearable_sources.update_one(
            {"user_id": athlete["id"], "provider": "garmin"},
            {"$set": {"status": "connected"}},
        )
        synced = await wearables.sync_source("garmin", athlete)
        assert synced == {
            "provider": "garmin",
            "synced": 0,
            "simulated": False,
            "message": "Live sync will start once this source is authorised (Terra keys not configured yet).",
        }
        assert await db.wearable_metrics.count_documents({"user_id": athlete["id"]}) == 0
        assert await db.wearable_metrics.count_documents({"simulated": True}) == 0

        with pytest.raises(HTTPException) as denied:
            await wearables._simulate_wearable_week(athlete, "garmin")
        assert denied.value.status_code == 403
        assert await db.wearable_metrics.count_documents({"user_id": athlete["id"]}) == 0

    asyncio.run(scenario(_Database()))


def test_whoop_sleep_webhook_stores_only_reported_fields(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(wearables, "db", db)
        monkeypatch.setattr(wearables, "TERRA_CONFIGURED", False)
        monkeypatch.setattr(wearables, "TERRA_SIGNING_SECRET", "")
        await db.wearable_sources.insert_one(
            {
                "id": "src-whoop",
                "user_id": "athlete-real",
                "provider": "whoop",
                "status": "connected",
                "terra_user_id": "terra-whoop-sample",
            }
        )
        result = await wearables.terra_webhook(_request(WHOOP_SLEEP), BackgroundTasks())
        assert result == {"received": True, "processed": 3}
        rows = {
            doc["metric"]: doc
            for doc in db.wearable_metrics.docs
            if doc["user_id"] == "athlete-real"
        }
        assert set(rows) == {"hrv", "resting_hr", "sleep_hours"}
        assert rows["hrv"]["value"] == 64.5
        assert rows["resting_hr"]["value"] == 49
        assert rows["sleep_hours"]["value"] == 7
        assert rows["sleep_hours"]["unit"] == "h"
        for row in rows.values():
            assert row["device"] == "whoop"
            assert row["simulated"] is False
            assert row["terra_item_key"] == "whoop-sleep-sample-1"
            assert row["recorded_at"] == datetime(
                2026, 9, 30, 22, 10, tzinfo=timezone(timedelta(hours=-4))
            )

    asyncio.run(scenario(_Database()))
