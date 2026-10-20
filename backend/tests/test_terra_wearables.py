"""Terra wearables v2: connect, signed webhook, list, deauthenticate. Terra is mocked."""
import asyncio
import hashlib
import hmac
import json
import os
import time

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "terra-wearables-test-secret-0123456789abcdef")

import server  # noqa: E402,F401 — registers routers
import terra_wearables  # noqa: E402
from routers import wearables  # noqa: E402
from terra_wearables import TerraClient, TerraConfig, TerraWebhook  # noqa: E402

SECRET = "whsec-test-only"
USER = {"id": "athlete-1", "email": "athlete@example.invalid", "role": "athlete"}


def _matches(doc, query):
    for key, expected in query.items():
        if isinstance(expected, dict) and "$in" in expected:
            if doc.get(key) not in expected["$in"]:
                return False
        elif doc.get(key) != expected:
            return False
    return True


class _Result:
    def __init__(self, n):
        self.matched_count = self.modified_count = n


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        self._it = iter(self.docs)
        return self

    async def __anext__(self):
        try:
            return dict(next(self._it))
        except StopIteration:
            raise StopAsyncIteration


class _Collection:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    def find(self, query, projection=None):
        return _Cursor([d for d in self.docs if _matches(d, query)])

    async def find_one(self, query, projection=None):
        rows = [d for d in self.docs if _matches(d, query)]
        return dict(rows[0]) if rows else None

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                return _Result(1)
        if upsert:
            created = dict(query)
            created.update(update.get("$setOnInsert", {}))
            created.update(update.get("$set", {}))
            self.docs.append(created)
        return _Result(0)

    async def update_many(self, query, update):
        n = 0
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                n += 1
        return _Result(n)


class _Database:
    def __init__(self):
        self.wearable_sources = _Collection()
        self.wearable_samples = _Collection()
        self.wearable_metrics = _Collection()


class _Response:
    def __init__(self, status, body=None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("TERRA_DEV_ID", "dev-test")
    monkeypatch.setenv("TERRA_API_KEY", "key-test")
    monkeypatch.setenv("TERRA_SIGNING_SECRET", SECRET)
    db = _Database()
    monkeypatch.setattr(wearables, "db", db)
    return db


def _sign(raw: bytes, secret: str = SECRET, ts: int | None = None) -> str:
    t = str(ts if ts is not None else int(time.time()))
    mac = hmac.new(secret.encode(), t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return f"t={t},v1={mac}"


def _request(payload, signature=None) -> Request:
    raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    headers = [(b"content-type", b"application/json")]
    if signature:
        headers.append((b"terra-signature", signature.encode()))

    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    return Request({"type": "http", "method": "POST", "path": "/api/wearables/terra/webhook",
                    "headers": headers, "query_string": b""}, receive)


def _signed(payload):
    raw = json.dumps(payload).encode()
    return _request(raw, _sign(raw))


def _hook(req):
    return asyncio.run(wearables.terra_wearables_webhook(req, BackgroundTasks()))


AUTH = {"type": "auth", "status": "success",
        "user": {"user_id": "terra-u1", "provider": "GARMIN", "reference_id": "athlete-1"}}
DAILY = {
    "type": "daily",
    "user": {"user_id": "terra-u1", "provider": "GARMIN"},
    "data": [{
        "metadata": {"start_time": "2026-10-20T00:00:00+02:00", "end_time": "2026-10-21T00:00:00+02:00"},
        "distance_data": {"steps": 9123},
        "heart_rate_data": {"summary": {"resting_hr_bpm": 52, "avg_hrv_rmssd": None}},
    }],
}
ACTIVITY = {
    "type": "activity",
    "user": {"user_id": "terra-u1", "provider": "GARMIN"},
    "data": [{
        "metadata": {"summary_id": "run-42", "start_time": "2026-10-20T07:00:00Z", "end_time": "2026-10-20T07:40:00Z"},
        "active_durations_data": {"activity_seconds": 2400},
        "distance_data": {"summary": {"distance_meters": 8000.5, "steps": 7000}},
        "heart_rate_data": {"summary": {"avg_hr_bpm": 151, "max_hr_bpm": 178}},
    }],
}


# ---- feature off --------------------------------------------------------- #
def test_feature_off_without_keys(monkeypatch):
    for k in ("TERRA_DEV_ID", "TERRA_API_KEY", "TERRA_SIGNING_SECRET"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(wearables, "db", _Database())
    assert TerraConfig.enabled() is False
    with pytest.raises(HTTPException) as e:
        asyncio.run(wearables.terra_connect(None, USER))
    assert e.value.status_code == 503
    with pytest.raises(HTTPException) as e:
        _hook(_request(AUTH))
    assert e.value.status_code == 503
    listed = asyncio.run(wearables.list_wearables(USER))
    assert listed["enabled"] is False
    assert {c["provider"] for c in listed["connections"]} == {"garmin", "whoop", "fitbit", "oura", "polar"}


# ---- connect ------------------------------------------------------------- #
def test_connect_calls_widget_with_reference_id(env, monkeypatch):
    calls = {}

    def fake_post(url, headers, json, timeout):
        calls.update(url=url, headers=headers, body=json)
        return _Response(201, {"url": "https://widget.tryterra.co/session/abc", "session_id": "s1", "expires_in": 86400})

    monkeypatch.setattr(terra_wearables.http, "post", fake_post)
    out = asyncio.run(wearables.terra_connect(wearables.TerraConnectIn(providers=["garmin", "polar"]), USER))
    assert out["url"] == "https://widget.tryterra.co/session/abc"
    assert calls["body"]["reference_id"] == "athlete-1"
    assert calls["body"]["providers"] == "GARMIN,POLAR"
    assert calls["headers"] == {"dev-id": "dev-test", "x-api-key": "key-test"}
    assert {d["provider"]: d["status"] for d in env.wearable_sources.docs} == {"garmin": "pending", "polar": "pending"}


def test_connect_rejects_unknown_provider_and_terra_failure(env, monkeypatch):
    with pytest.raises(HTTPException) as e:
        asyncio.run(wearables.terra_connect(wearables.TerraConnectIn(providers=["strava"]), USER))
    assert e.value.status_code == 422
    monkeypatch.setattr(terra_wearables.http, "post", lambda *a, **k: _Response(401, {"detail": "bad key"}))
    with pytest.raises(HTTPException) as e:
        asyncio.run(wearables.terra_connect(None, USER))
    assert e.value.status_code == 502


# ---- signature ----------------------------------------------------------- #
def test_signature_pass(env):
    assert _hook(_signed(AUTH))["processed"] == 1


@pytest.mark.parametrize("signature", [
    None,
    "garbage",
    _sign(json.dumps(AUTH).encode(), secret="wrong-secret"),
    _sign(json.dumps(AUTH).encode(), ts=int(time.time()) - 3600),
])
def test_signature_fail(env, signature):
    with pytest.raises(HTTPException) as e:
        _hook(_request(AUTH, signature))
    assert e.value.status_code == 401
    assert env.wearable_sources.docs == []


def test_tampered_body_is_rejected(env):
    sig = _sign(json.dumps(AUTH).encode())
    tampered = dict(AUTH, user=dict(AUTH["user"], reference_id="someone-else"))
    with pytest.raises(HTTPException) as e:
        _hook(_request(tampered, sig))
    assert e.value.status_code == 401


# ---- events -------------------------------------------------------------- #
def test_auth_then_data_is_idempotent(env):
    _hook(_signed(AUTH))
    src = env.wearable_sources.docs[0]
    assert (src["user_id"], src["provider"], src["status"], src["terra_user_id"]) == ("athlete-1", "garmin", "connected", "terra-u1")

    first = _hook(_signed(DAILY))
    again = _hook(_signed(DAILY))
    assert first["processed"] == again["processed"] == 1
    assert len(env.wearable_samples.docs) == 1
    sample = env.wearable_samples.docs[0]
    assert sample["values"] == {"steps": 9123, "resting_hr": 52}
    assert sample["provider"] == "garmin" and sample["user_id"] == "athlete-1"
    assert sorted(d["metric"] for d in env.wearable_metrics.docs) == ["resting_hr", "steps"]

    _hook(_signed(ACTIVITY))
    _hook(_signed(ACTIVITY))
    acts = [d for d in env.wearable_samples.docs if d["event_type"] == "activity"]
    assert len(acts) == 1
    assert acts[0]["item_key"] == "run-42"
    assert acts[0]["values"]["distance_m"] == 8000.5
    # workout totals never land in the day metrics
    assert len(env.wearable_metrics.docs) == 2


def test_sleep_and_body_normalize():
    sleep = TerraWebhook.normalize("sleep", {"sleep_durations_data": {"asleep": {
        "duration_asleep_state_seconds": None, "duration_deep_sleep_state_seconds": 3600,
        "duration_light_sleep_state_seconds": 10800}}})
    assert sleep["values"] == {"asleep_s": 14400}
    body = TerraWebhook.normalize("body", {"measurements_data": {"measurements": [{"weight_kg": 81.2}]}})
    assert body["values"] == {"weight_kg": 81.2}


def test_data_for_unknown_user_is_ignored(env):
    out = _hook(_signed(DAILY))
    assert out["processed"] == 0 and env.wearable_samples.docs == []


def test_deauth_event_disconnects(env):
    _hook(_signed(AUTH))
    out = _hook(_signed({"type": "deauth", "user": {"user_id": "terra-u1", "provider": "GARMIN"}}))
    assert out["processed"] == 1
    assert env.wearable_sources.docs[0]["status"] == "disconnected"
    assert _hook(_signed(DAILY))["processed"] == 0


def test_user_reauth_moves_to_new_terra_user(env):
    _hook(_signed(AUTH))
    _hook(_signed({"type": "user_reauth",
                   "old_user": {"user_id": "terra-u1", "provider": "GARMIN"},
                   "new_user": {"user_id": "terra-u2", "provider": "GARMIN", "reference_id": "athlete-1"}}))
    assert env.wearable_sources.docs[0]["terra_user_id"] == "terra-u2"
    assert env.wearable_sources.docs[0]["status"] == "connected"


# ---- list + delete ------------------------------------------------------- #
def test_list_and_delete_deauthenticates(env, monkeypatch):
    _hook(_signed(AUTH))
    listed = asyncio.run(wearables.list_wearables(USER))
    garmin = next(c for c in listed["connections"] if c["provider"] == "garmin")
    assert listed["enabled"] is True and garmin["status"] == "connected"

    seen = {}

    def fake_delete(url, headers, params, timeout):
        seen.update(url=url, params=params)
        return _Response(200, {"status": "success"})

    monkeypatch.setattr(terra_wearables.http, "delete", fake_delete)
    out = asyncio.run(wearables.delete_wearable("garmin", USER))
    assert out == {"provider": "garmin", "status": "disconnected"}
    assert seen["params"] == {"user_id": "terra-u1"}
    assert seen["url"].endswith("/v2/auth/deauthenticateUser")
    with pytest.raises(HTTPException) as e:
        asyncio.run(wearables.delete_wearable("garmin", USER))
    assert e.value.status_code == 404


def test_delete_keeps_connection_when_terra_fails(env, monkeypatch):
    _hook(_signed(AUTH))
    monkeypatch.setattr(terra_wearables.http, "delete", lambda *a, **k: _Response(500))
    with pytest.raises(HTTPException) as e:
        asyncio.run(wearables.delete_wearable("garmin", USER))
    assert e.value.status_code == 502
    assert env.wearable_sources.docs[0]["status"] == "connected"


def test_client_treats_404_as_already_gone(env, monkeypatch):
    monkeypatch.setattr(terra_wearables.http, "delete", lambda *a, **k: _Response(404))
    assert TerraClient.deauthenticate_user("gone") is True
