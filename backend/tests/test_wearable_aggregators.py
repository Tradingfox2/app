"""Wearable aggregators: Terra, Junction, Thryve. Vendor HTTP calls are mocked."""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import time

import pytest
import zstandard
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "wearable-aggregators-test-secret-0123456789")

import server  # noqa: F401 — registers routers
import wearable_aggregators as wa
from routers import wearables
from wearable_aggregators import Aggregators, SvixSignature

USER = {"id": "athlete-1", "email": "athlete@example.invalid", "role": "athlete"}
TERRA_SECRET = "terra-test-secret"
JUNCTION_SECRET = "whsec_" + base64.b64encode(b"junction-test-key-0123456789abcd").decode()
THRYVE_AUTH = "Basic dGhyeXZlOmhvb2s="

ENV = {
    "TERRA_DEV_ID": "dev", "TERRA_API_KEY": "key", "TERRA_SIGNING_SECRET": TERRA_SECRET,
    "JUNCTION_API_KEY": "jkey", "JUNCTION_WEBHOOK_SECRET": JUNCTION_SECRET,
    "THRYVE_USERNAME": "u", "THRYVE_PASSWORD": "p", "THRYVE_AUTH_ID": "aid",
    "THRYVE_AUTH_SECRET": "asecret", "THRYVE_WEBHOOK_AUTH": THRYVE_AUTH,
}


# ---- fake Mongo ------------------------------------------------------------ #
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
        self._it = iter(docs)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return dict(next(self._it))
        except StopIteration:
            raise StopAsyncIteration from None


class _Collection:
    def __init__(self):
        self.docs = []

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
        hits = [d for d in self.docs if _matches(d, query)]
        for doc in hits:
            doc.update(update.get("$set", {}))
        return _Result(len(hits))


class _Database:
    def __init__(self):
        self.wearable_sources = _Collection()
        self.wearable_samples = _Collection()
        self.wearable_metrics = _Collection()


class _Response:
    def __init__(self, status, body=None, text=None):
        self.status_code = status
        self._body = body
        self.text = text if text is not None else (json.dumps(body) if body is not None else "")

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


@pytest.fixture
def db(monkeypatch):
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    fake = _Database()
    monkeypatch.setattr(wearables, "db", fake)
    return fake


def _request(raw: bytes, headers: dict) -> Request:
    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    return Request({"type": "http", "method": "POST", "path": "/", "query_string": b"",
                    "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]}, receive)


def _run(coro):
    return asyncio.run(coro)


# ---- signing helpers ------------------------------------------------------- #
def terra_post(payload, secret=TERRA_SECRET, ts=None):
    raw = json.dumps(payload).encode()
    t = str(ts if ts is not None else int(time.time()))
    mac = hmac.new(secret.encode(), t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return _run(wearables.terra_wearables_webhook(
        _request(raw, {"terra-signature": f"t={t},v1={mac}"}), BackgroundTasks()))


def junction_post(payload, secret=JUNCTION_SECRET, ts=None, msg_id="msg_1", raw=None):
    raw = raw if raw is not None else json.dumps(payload).encode()
    t = str(ts if ts is not None else int(time.time()))
    sig = SvixSignature.sign(secret, msg_id, t, raw)
    headers = {"svix-id": msg_id, "svix-timestamp": t, "svix-signature": f"v1,{sig}"}
    return _run(wearables.junction_wearables_webhook(_request(raw, headers), BackgroundTasks()))


def thryve_post(payload, auth=THRYVE_AUTH, compress=True):
    raw = json.dumps(payload).encode()
    headers = {"content-type": "application/json"}
    if compress:
        raw = zstandard.ZstdCompressor().compress(raw)
        headers["content-encoding"] = "zstd"
    if auth is not None:
        headers["authorization"] = auth
    return _run(wearables.thryve_wearables_webhook(_request(raw, headers), BackgroundTasks()))


# ---- selection and feature-off --------------------------------------------- #
def test_selection_defaults_to_terra(monkeypatch):
    monkeypatch.delenv("WEARABLES_AGGREGATOR", raising=False)
    assert Aggregators.selected_name() == "terra"
    monkeypatch.setenv("WEARABLES_AGGREGATOR", "Junction")
    assert Aggregators.selected_name() == "junction"
    monkeypatch.setenv("WEARABLES_AGGREGATOR", "bogus")
    assert Aggregators.selected_name() == "terra"


@pytest.mark.parametrize("name,missing", [
    ("terra", "TERRA_SIGNING_SECRET"), ("junction", "JUNCTION_WEBHOOK_SECRET"), ("thryve", "THRYVE_WEBHOOK_AUTH"),
])
def test_feature_off_when_selected_vendor_keys_missing(db, monkeypatch, name, missing):
    monkeypatch.setenv("WEARABLES_AGGREGATOR", name)
    monkeypatch.delenv(missing)
    with pytest.raises(HTTPException) as e:
        _run(wearables.wearables_connect(None, USER))
    assert e.value.status_code == 503
    route = getattr(wearables, f"{name}_wearables_webhook")
    with pytest.raises(HTTPException) as e:
        _run(route(_request(b"{}", {}), BackgroundTasks()))
    assert e.value.status_code == 503
    listed = _run(wearables.list_wearables(USER))
    assert listed["enabled"] is False and listed["aggregator"] == name


def test_named_connect_must_match_selected(db, monkeypatch):
    monkeypatch.setenv("WEARABLES_AGGREGATOR", "terra")
    with pytest.raises(HTTPException) as e:
        _run(wearables.wearables_connect_named("junction", None, USER))
    assert e.value.status_code == 409


# ---- Terra ----------------------------------------------------------------- #
T_AUTH = {"type": "auth", "status": "success",
          "user": {"user_id": "t-u1", "provider": "GARMIN", "reference_id": "athlete-1"}}
T_DAILY = {"type": "daily", "user": {"user_id": "t-u1", "provider": "GARMIN"}, "data": [{
    "metadata": {"start_time": "2026-10-20T00:00:00+02:00", "end_time": "2026-10-21T00:00:00+02:00"},
    "distance_data": {"steps": 9123}, "heart_rate_data": {"summary": {"resting_hr_bpm": 52}}}]}
T_ACTIVITY = {"type": "activity", "user": {"user_id": "t-u1", "provider": "GARMIN"}, "data": [{
    "metadata": {"summary_id": "run-42", "start_time": "2026-10-20T07:00:00Z"},
    "distance_data": {"summary": {"distance_meters": 8000.5}}}]}


def test_terra_connect(db, monkeypatch):
    seen = {}

    def fake_post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, body=json)
        return _Response(201, {"url": "https://widget.tryterra.co/session/x", "session_id": "s"})

    monkeypatch.setattr(wa.http, "post", fake_post)
    out = _run(wearables.wearables_connect(wearables.WearableConnectIn(providers=["garmin", "polar"]), USER))
    assert out["url"].startswith("https://widget.tryterra.co") and out["aggregator"] == "terra"
    assert seen["body"]["reference_id"] == "athlete-1" and seen["body"]["providers"] == "GARMIN,POLAR"
    assert seen["headers"] == {"dev-id": "dev", "x-api-key": "key"}
    assert {d["provider"]: d["status"] for d in db.wearable_sources.docs} == {"garmin": "pending", "polar": "pending"}


def test_terra_connect_errors(db, monkeypatch):
    with pytest.raises(HTTPException) as e:
        _run(wearables.wearables_connect(wearables.WearableConnectIn(providers=["strava"]), USER))
    assert e.value.status_code == 422
    monkeypatch.setattr(wa.http, "post", lambda *a, **k: _Response(401, {"detail": "bad"}))
    with pytest.raises(HTTPException) as e:
        _run(wearables.wearables_connect(None, USER))
    assert e.value.status_code == 502


def test_terra_signature_pass(db):
    assert terra_post(T_AUTH)["processed"] == 1


@pytest.mark.parametrize("kwargs", [{"secret": "wrong"}, {"ts": int(time.time()) - 3600}])
def test_terra_signature_fail(db, kwargs):
    with pytest.raises(HTTPException) as e:
        terra_post(T_AUTH, **kwargs)
    assert e.value.status_code == 401
    assert db.wearable_sources.docs == []


def test_terra_unsigned_and_tampered(db):
    raw = json.dumps(T_AUTH).encode()
    with pytest.raises(HTTPException) as e:
        _run(wearables.terra_wearables_webhook(_request(raw, {}), BackgroundTasks()))
    assert e.value.status_code == 401
    t = str(int(time.time()))
    mac = hmac.new(TERRA_SECRET.encode(), t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    tampered = raw.replace(b"athlete-1", b"attacker")
    with pytest.raises(HTTPException) as e:
        _run(wearables.terra_wearables_webhook(
            _request(tampered, {"terra-signature": f"t={t},v1={mac}"}), BackgroundTasks()))
    assert e.value.status_code == 401


def test_terra_events_idempotent_and_deauth(db):
    terra_post(T_AUTH)
    src = db.wearable_sources.docs[0]
    assert (src["provider"], src["status"], src["aggregator"], src["terra_user_id"]) == ("garmin", "connected", "terra", "t-u1")
    terra_post(T_DAILY)
    terra_post(T_DAILY)
    terra_post(T_ACTIVITY)
    terra_post(T_ACTIVITY)
    assert len(db.wearable_samples.docs) == 2
    daily = next(d for d in db.wearable_samples.docs if d["event_type"] == "daily")
    assert daily["values"] == {"steps": 9123, "resting_hr": 52}
    assert sorted(d["metric"] for d in db.wearable_metrics.docs) == ["resting_hr", "steps"]
    terra_post({"type": "deauth", "user": {"user_id": "t-u1"}})
    assert db.wearable_sources.docs[0]["status"] == "disconnected"
    assert terra_post(T_DAILY)["processed"] == 0


def test_terra_reauth(db):
    terra_post(T_AUTH)
    terra_post({"type": "user_reauth", "old_user": {"user_id": "t-u1"},
                "new_user": {"user_id": "t-u2", "provider": "GARMIN", "reference_id": "athlete-1"}})
    src = db.wearable_sources.docs[0]
    assert src["aggregator_user_id"] == "t-u2" and src["status"] == "connected"


def test_terra_delete(db, monkeypatch):
    terra_post(T_AUTH)
    seen = {}

    def fake_delete(url, headers, params, timeout):
        seen.update(url=url, params=params)
        return _Response(200, {"status": "success"})

    monkeypatch.setattr(wa.http, "delete", fake_delete)
    assert _run(wearables.delete_wearable("garmin", USER))["status"] == "disconnected"
    assert seen["url"].endswith("/v2/auth/deauthenticateUser") and seen["params"] == {"user_id": "t-u1"}
    with pytest.raises(HTTPException) as e:
        _run(wearables.delete_wearable("garmin", USER))
    assert e.value.status_code == 404


def test_delete_keeps_connection_when_vendor_fails(db, monkeypatch):
    terra_post(T_AUTH)
    monkeypatch.setattr(wa.http, "delete", lambda *a, **k: _Response(500))
    with pytest.raises(HTTPException) as e:
        _run(wearables.delete_wearable("garmin", USER))
    assert e.value.status_code == 502
    assert db.wearable_sources.docs[0]["status"] == "connected"


def test_delete_pending_or_demo_row_skips_vendor(db, monkeypatch):
    db.wearable_sources.docs.append({"user_id": "athlete-1", "provider": "whoop", "status": "connected",
                                     "terra_user_id": "sim-1234"})
    monkeypatch.setattr(wa.http, "delete", lambda *a, **k: pytest.fail("vendor called"))
    assert _run(wearables.delete_wearable("whoop", USER))["status"] == "disconnected"


# ---- Junction -------------------------------------------------------------- #
J_CONN = {"event_type": "provider.connection.created", "client_user_id": "athlete-1",
          "data": {"user_id": "j-u1", "provider": {"name": "Oura", "slug": "oura"}}}
J_SLEEP = {"event_type": "daily.data.sleep.created", "data": {
    "id": "sleep-1", "user_id": "j-u1", "calendar_date": "2026-10-20", "bedtime_start": "2026-10-19T22:30:00+00:00",
    "bedtime_end": "2026-10-20T06:30:00+00:00", "total": 25200, "average_hrv": 61.5, "hr_resting": 50,
    "source": {"provider": "oura", "type": "ring"}}}
J_WORKOUT = {"event_type": "daily.data.workouts.updated", "data": {
    "id": "w-9", "user_id": "j-u1", "time_start": "2026-10-20T07:00:00+00:00", "distance": 8544,
    "calories": 470, "average_hr": 150, "source": {"provider": "oura"}}}


def test_svix_known_vector():
    # Example from https://docs.svix.com/receiving/verifying-payloads/how-manual
    secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
    body = b'{"test": 2432232314}'
    expected = "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
    assert SvixSignature.sign(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", "1614265330", body) == expected
    headers = {"svix-id": "msg_p5jXN8AQM9LWM0D4loKWxJek", "svix-timestamp": "1614265330",
               "svix-signature": f"v1,bogus v1,{expected}"}
    assert SvixSignature.verify(secret, headers, body, now=1614265330)
    assert not SvixSignature.verify(secret, headers, body, now=1614265330 + 3600)


def test_junction_connect(db, monkeypatch):
    monkeypatch.setenv("WEARABLES_AGGREGATOR", "junction")
    calls = []
    monkeypatch.setattr(wa.http, "get", lambda url, headers, timeout: calls.append(("get", url)) or _Response(404, {}))

    def fake_post(url, headers, json, timeout):
        calls.append(("post", url, json))
        assert headers["x-vital-api-key"] == "jkey"
        if url.endswith("/v2/user"):
            return _Response(200, {"user_id": "j-u1"})
        return _Response(200, {"link_token": "tok", "link_web_url": "https://link.tryvital.io/?token=tok"})

    monkeypatch.setattr(wa.http, "post", fake_post)
    out = _run(wearables.wearables_connect(wearables.WearableConnectIn(providers=["whoop"]), USER))
    assert out["url"] == "https://link.tryvital.io/?token=tok" and out["aggregator"] == "junction"
    assert calls[0] == ("get", "https://api.sandbox.us.junction.com/v2/user/resolve/athlete-1")
    assert calls[1][2] == {"client_user_id": "athlete-1"}
    assert calls[2][2]["user_id"] == "j-u1" and calls[2][2]["provider"] == "whoop_v2"
    row = db.wearable_sources.docs[0]
    assert (row["status"], row["aggregator"], row["aggregator_user_id"]) == ("pending", "junction", "j-u1")


def test_junction_signature_pass_and_events(db):
    assert junction_post(J_CONN)["processed"] == 1
    junction_post(J_SLEEP)
    junction_post(J_SLEEP)
    junction_post(J_WORKOUT)
    samples = {d["event_type"]: d for d in db.wearable_samples.docs}
    assert set(samples) == {"sleep", "activity"} and len(db.wearable_samples.docs) == 2
    assert samples["sleep"]["values"] == {"asleep_s": 25200, "hrv": 61.5, "resting_hr": 50}
    metrics = {d["metric"]: d["value"] for d in db.wearable_metrics.docs}
    assert metrics == {"sleep_hours": 7.0, "hrv": 61.5, "resting_hr": 50}
    assert all(d["device"] == "oura" for d in db.wearable_metrics.docs)


@pytest.mark.parametrize("kwargs", [
    {"secret": "whsec_" + base64.b64encode(b"some-other-key").decode()},
    {"ts": int(time.time()) - 3600},
])
def test_junction_signature_fail(db, kwargs):
    with pytest.raises(HTTPException) as e:
        junction_post(J_CONN, **kwargs)
    assert e.value.status_code == 401
    assert db.wearable_sources.docs == []


def test_junction_missing_headers_rejected(db):
    with pytest.raises(HTTPException) as e:
        _run(wearables.junction_wearables_webhook(_request(json.dumps(J_CONN).encode(), {}), BackgroundTasks()))
    assert e.value.status_code == 401


def test_junction_delete(db, monkeypatch):
    junction_post(J_CONN)
    seen = {}
    monkeypatch.setattr(wa.http, "delete", lambda url, headers, timeout: seen.update(url=url) or _Response(200, {}))
    assert _run(wearables.delete_wearable("oura", USER))["status"] == "disconnected"
    assert seen["url"] == "https://api.sandbox.us.junction.com/v2/user/j-u1/oura"


def test_junction_base_url(monkeypatch):
    monkeypatch.setenv("JUNCTION_ENVIRONMENT", "production")
    monkeypatch.setenv("JUNCTION_REGION", "eu")
    assert wa.JunctionAggregator.base_url() == "https://api.eu.junction.com"


# ---- Thryve ---------------------------------------------------------------- #
WIDGET = {"type": "enduser.widget.connection",
          "data": {"url": "https://connect.thryve.de/?connectionSessionToken=SESS123&platform=web&lang=en"}}
TH_CONNECT = {"endUserId": "th-u1", "type": "notification.source.connect", "timestampType": "iso",
              "data": {"timestamp": "2026-10-20T17:40:00Z", "dataSourceId": 2}}
TH_DAILY = {"endUserId": "th-u1", "type": "event.data.daily.create", "timestampType": "iso", "data": {
    "dataSourceId": 2, "dailyData": [
        {"day": "2026-10-20", "dataTypeId": 1000, "value": "11203"},
        {"day": "2026-10-20", "dataTypeId": 3001, "value": "51"},
        {"day": "2026-10-20", "dataTypeId": 2000, "value": "432"},
        {"day": "2026-10-20", "dataTypeId": 9999, "value": "1"}]}}


def _thryve_http(monkeypatch, calls):
    def fake_post(url, headers, timeout, data=None, json=None):
        calls.append((url, data or json, headers))
        if url.endswith("/v5/accessToken"):
            return _Response(200, text="th-u1")
        return _Response(200, WIDGET)

    monkeypatch.setattr(wa.http, "post", fake_post)


def test_thryve_connect_single_source(db, monkeypatch):
    monkeypatch.setenv("WEARABLES_AGGREGATOR", "thryve")
    calls = []
    _thryve_http(monkeypatch, calls)
    out = _run(wearables.wearables_connect(wearables.WearableConnectIn(providers=["garmin"]), USER))
    assert out["url"].startswith("https://service2.und-gesund.de/dataSourceDirectConnection.html?token=SESS123&dataSource=2")
    alias = calls[0][1]["partnerUserID"]
    assert alias != "athlete-1" and 32 <= len(alias) <= 80
    assert calls[0][2]["Authorization"] == "Basic " + base64.b64encode(b"u:p").decode()
    assert calls[0][2]["AppAuthorization"] == "Basic " + base64.b64encode(b"aid:asecret").decode()
    assert calls[1][1] == {"endUserId": "th-u1", "locale": "en"}
    assert db.wearable_sources.docs[0]["aggregator_user_id"] == "th-u1"


def test_thryve_auth_pass_and_events(db, monkeypatch):
    monkeypatch.setenv("WEARABLES_AGGREGATOR", "thryve")
    _thryve_http(monkeypatch, [])
    _run(wearables.wearables_connect(wearables.WearableConnectIn(providers=["garmin"]), USER))
    assert thryve_post(TH_CONNECT)["processed"] == 1
    assert db.wearable_sources.docs[0]["status"] == "connected"
    thryve_post(TH_DAILY)
    thryve_post(TH_DAILY, compress=False)
    assert len(db.wearable_samples.docs) == 3  # steps, resting HR, raw sleep; unknown type dropped
    metrics = {d["metric"]: d["value"] for d in db.wearable_metrics.docs}
    assert metrics == {"steps": 11203, "resting_hr": 51}  # sleep unit undocumented: not a metric
    thryve_post({"endUserId": "th-u1", "type": "notification.source.disconnect", "data": {"dataSourceId": 2}})
    assert db.wearable_sources.docs[0]["status"] == "disconnected"


@pytest.mark.parametrize("auth", [None, "Basic wrong", ""])
def test_thryve_auth_fail(db, auth):
    with pytest.raises(HTTPException) as e:
        thryve_post(TH_CONNECT, auth=auth)
    assert e.value.status_code == 401


def test_thryve_unknown_user_ignored(db):
    out = thryve_post(TH_CONNECT)
    assert out["processed"] == 0 and db.wearable_sources.docs == []


def test_thryve_delete_revokes(db, monkeypatch):
    monkeypatch.setenv("WEARABLES_AGGREGATOR", "thryve")
    _thryve_http(monkeypatch, [])
    _run(wearables.wearables_connect(wearables.WearableConnectIn(providers=["garmin"]), USER))
    thryve_post(TH_CONNECT)
    seen = {}
    monkeypatch.setattr(wa.http, "get", lambda url, params, timeout: seen.update(url=url, params=params) or _Response(200))
    assert _run(wearables.delete_wearable("garmin", USER))["status"] == "disconnected"
    assert seen["url"].endswith("/dataSourceDirectRevoke.html")
    assert seen["params"] == {"token": "SESS123", "dataSource": 2, "direct": "true"}
