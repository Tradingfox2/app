"""Manual morning check-in: one upsert per local day, then readiness reads it.

The collection below speaks the slice of Mongo that ``manual_morning``,
``recovery_snapshot``, and ``readiness.today_for`` use: ``update_one`` upsert,
``find_one`` with a sort, ``find``, and ``count_documents``.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "morning-test-secret-0123456789abcdef")

import readiness  # noqa: E402
import server  # noqa: E402
from routers import program, wearables  # noqa: E402


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def limit(self, count):
        return _Cursor(self._docs[:count])

    def __aiter__(self):
        self._index = 0
        return self

    async def __anext__(self):
        if self._index >= len(self._docs):
            raise StopAsyncIteration
        doc = self._docs[self._index]
        self._index += 1
        return doc


def _matches(doc, query):
    for key, expected in query.items():
        value = doc.get(key)
        if isinstance(expected, dict):
            if "$gt" in expected and not (isinstance(value, (int, float)) and value > expected["$gt"]):
                return False
            if "$gte" in expected and not (isinstance(value, datetime) and value >= expected["$gte"]):
                return False
            if "$lt" in expected and not (isinstance(value, datetime) and value < expected["$lt"]):
                return False
            continue
        if value != expected:
            return False
    return True


def _project(doc, projection):
    if not projection:
        return dict(doc)
    include = {key for key, flag in projection.items() if flag and key != "_id"}
    if include:
        return {key: doc[key] for key in include if key in doc}
    return {key: value for key, value in doc.items() if projection.get(key, 1)}


class _Collection:
    def __init__(self):
        self.docs = []

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
        if sort:
            field, direction = sort[0]
            rows.sort(key=lambda doc: doc.get(field) or datetime.min.replace(tzinfo=timezone.utc), reverse=direction < 0)
        return _project(rows[0], projection) if rows else None

    def find(self, query, projection=None):
        return _Cursor([_project(doc, projection) for doc in self.docs if _matches(doc, query)])

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if _matches(doc, query))


class _Database:
    def __init__(self):
        self.wearable_metrics = _Collection()
        self.workouts = _Collection()


def bind(monkeypatch, database):
    monkeypatch.setattr(wearables, "db", database)
    monkeypatch.setattr(program, "db", database)


def user(uid="ath"):
    return {"id": uid, "email": f"{uid}@example.invalid", "role": "athlete"}


def day(offset=0):
    return (server.now().date() + timedelta(days=offset)).isoformat()


def body(**overrides):
    payload = {"sleep_hours": 8, "soreness": 2, "mood": 4, "local_day": day()}
    payload.update(overrides)
    return wearables.ManualMorningIn(**payload)


def test_manual_checkin_upserts_one_row_per_metric_per_local_day(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        first = await wearables.manual_morning(body(sleep_hours=8, soreness=2, mood=4), user())
        assert first["device"] == "manual" and first["simulated"] is False
        assert first["metrics"] == ["sleep_hours", "soreness", "mood"]
        kept = (await database.wearable_metrics.find_one({"user_id": "ath", "metric": "sleep_hours"}))["id"]
        second = await wearables.manual_morning(body(sleep_hours=6.5, soreness=5, mood=1), user())
        assert second["local_day"] == first["local_day"]
        assert await database.wearable_metrics.count_documents({"user_id": "ath"}) == 3
        assert (await database.wearable_metrics.find_one({"user_id": "ath", "metric": "sleep_hours"}))["id"] == kept
        rows = {
            row["metric"]: row
            async for row in database.wearable_metrics.find({"user_id": "ath"})
        }
        assert set(rows) == {"sleep_hours", "soreness", "mood"}
        assert rows["sleep_hours"]["value"] == 6.5
        assert rows["soreness"]["value"] == 5 and rows["mood"]["value"] == 1
        assert all(row["device"] == "manual" and row["simulated"] is False for row in rows.values())
        await wearables.manual_morning(body(local_day=day(-1), sleep_hours=4), user())
        assert await database.wearable_metrics.count_documents({"user_id": "ath"}) == 6
        await wearables.manual_morning(body(sleep_hours=7), user("other"))
        assert await database.wearable_metrics.count_documents({"user_id": "ath", "metric": "sleep_hours"}) == 2
        with pytest.raises(ValidationError):
            body(sleep_hours=2)
        with pytest.raises(ValidationError):
            body(soreness=6)
        with pytest.raises(ValidationError):
            wearables.ManualMorningIn(sleep_hours=8, soreness=2, mood=4, local_day=day(), score=80)

    asyncio.run(scenario(_Database()))


def test_readiness_and_recovery_read_manual_rows_and_skip_writes_nothing(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        moment = server.now()
        skipped = await readiness.today_for(database, "ath", moment)
        assert skipped["score"] is None and skipped["confidence"] == 0
        quiet = await program.recovery_snapshot("ath")
        assert quiet["sleep_hours"] is None and quiet["recovery_score"] is None
        assert quiet["soreness"] is None and quiet["mood"] is None
        await wearables.manual_morning(body(sleep_hours=4, soreness=3, mood=5), user())
        scored = await readiness.today_for(database, "ath", moment)
        assert scored["components"]["sleep"]["value"] == 4
        assert scored["score"] == 50 and scored["confidence"] == 0.25
        assert "soreness" not in scored["components"] and "mood" not in scored["components"]
        seen = await program.recovery_snapshot("ath")
        assert (seen["sleep_hours"], seen["soreness"], seen["mood"]) == (4, 3, 5)
        assert seen["recovery_score"] is None
        assert await database.wearable_metrics.count_documents({"metric": "recovery"}) == 0

    asyncio.run(scenario(_Database()))
