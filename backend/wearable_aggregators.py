"""Wearable aggregators: Terra, Junction (formerly Vital) and Thryve.

Every adapter is a class with static methods and the same surface:

- ``enabled()``: all of this vendor's keys are set.
- ``connect_url(user_id, providers, ...)``: a sign-in link for the end user.
- ``verify(raw_body, headers)``: the vendor's documented webhook authentication.
- ``parse(raw_body, headers)``: decode the body to a dict.
- ``events(payload)``: normalized events (see ``WearableEvent``).
- ``deauthenticate(aggregator_user_id, provider)``: revoke at the vendor.

``WEARABLES_AGGREGATOR`` (terra|junction|thryve, default terra) picks which
adapter the connect endpoint uses. Webhooks have one route per vendor and are
accepted whenever that vendor's keys are set. Nothing here talks to Mongo;
routers/wearables.py owns storage.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlencode, urlparse

import requests as http

from terra_labs import verify_webhook_signature

PROVIDERS = ("garmin", "whoop", "fitbit", "oura", "polar")
TIMEOUT = 15


class AggregatorError(Exception):
    """The vendor answered with an error or no usable body."""


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _app_url() -> str:
    return _env("APP_PUBLIC_URL", "http://localhost:8082").rstrip("/")


def _redirect(tag: str, ok: bool) -> str:
    return f"{_app_url()}/sources?{'connected' if ok else 'failed'}={tag}"


def _get(item, *path):
    value = item
    for key in path:
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and isinstance(key, int) and -len(value) <= key < len(value):
            value = value[key]
        else:
            return None
    return value


def _number(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _time(value) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _compact(values: dict) -> dict:
    return {k: v for k, v in values.items() if v is not None}


def _hash_key(item) -> str:
    digest = hashlib.sha256(json.dumps(item, sort_keys=True, default=str).encode()).hexdigest()
    return f"sha256:{digest[:32]}"


class WearableEvent:
    """Factories for the normalized event dicts every adapter emits.

    kind: "connect" | "disconnect" | "sample" | "ignored"
    """

    @staticmethod
    def connect(aggregator_user_id: str, provider: str, reference_id: str | None = None,
                replaces: str | None = None) -> dict:
        return {"kind": "connect", "aggregator_user_id": aggregator_user_id, "provider": provider,
                "reference_id": reference_id, "replaces": replaces}

    @staticmethod
    def disconnect(aggregator_user_id: str, provider: str | None = None) -> dict:
        return {"kind": "disconnect", "aggregator_user_id": aggregator_user_id, "provider": provider}

    @staticmethod
    def sample(aggregator_user_id: str, provider: str | None, event_type: str, item_key: str,
               start_time, end_time, values: dict, metrics: dict) -> dict:
        """values -> wearable_samples; metrics (IronFlow names) -> wearable_metrics."""
        return {"kind": "sample", "aggregator_user_id": aggregator_user_id, "provider": provider,
                "event_type": event_type, "item_key": item_key, "start_time": start_time,
                "end_time": end_time, "values": _compact(values), "metrics": _compact(metrics)}

    @staticmethod
    def ignored(reason: str) -> dict:
        return {"kind": "ignored", "reason": reason}


class Aggregator:
    """Base adapter. Subclasses override the static methods."""

    name = ""
    PROVIDER_CODES: dict[str, str] = {}

    @staticmethod
    def env_keys() -> tuple[str, ...]:
        return ()

    @classmethod
    def enabled(cls) -> bool:
        return all(_env(key) for key in cls.env_keys())

    @classmethod
    def provider_slug(cls, code) -> str | None:
        text = str(code or "").lower()
        for slug, value in cls.PROVIDER_CODES.items():
            if str(value).lower() == text:
                return slug
        return text if text in PROVIDERS else None

    @staticmethod
    def parse(raw_body: bytes, headers) -> dict:
        payload = json.loads(raw_body)
        if not isinstance(payload, dict):
            raise ValueError("webhook body is not an object")
        return payload


# --------------------------------------------------------------------------- #
# Terra                                                                        #
# --------------------------------------------------------------------------- #
class TerraAggregator(Aggregator):
    """Terra (tryterra.co).

    Widget: POST https://access.tryterra.co/api/widget/session (dev-id, x-api-key).
      https://docs.tryterra.co/unified-api/user-authentication/implementation-terra-widget
      The legacy /v2/auth/generateWidgetSession is deprecated on 3 Nov 2026.
    Deauth: DELETE https://access.tryterra.co/api/v2/auth/deauthenticateUser?user_id=
      https://docs.tryterra.co/reference
    Signature: ``terra-signature: t=<unix>,v1=<hex hmac-sha256("t.body")>``, checked
      by terra_labs.verify_webhook_signature (5 minute tolerance).
    """

    name = "terra"
    PROVIDER_CODES = {"garmin": "GARMIN", "whoop": "WHOOP", "fitbit": "FITBIT",
                      "oura": "OURA", "polar": "POLAR"}
    AUTH_EVENTS = frozenset({"auth", "user_reauth"})
    DEAUTH_EVENTS = frozenset({"deauth", "access_revoked"})
    DATA_EVENTS = frozenset({"activity", "daily", "sleep", "body"})

    @staticmethod
    def env_keys() -> tuple[str, ...]:
        return ("TERRA_DEV_ID", "TERRA_API_KEY", "TERRA_SIGNING_SECRET")

    @staticmethod
    def _headers() -> dict:
        return {"dev-id": _env("TERRA_DEV_ID"), "x-api-key": _env("TERRA_API_KEY")}

    @staticmethod
    def _base() -> str:
        return _env("TERRA_BASE_URL", "https://access.tryterra.co/api").rstrip("/")

    @staticmethod
    def connect_url(user_id: str, providers: list[str]) -> dict:
        tag = providers[0] if len(providers) == 1 else "terra"
        response = http.post(
            _env("TERRA_WIDGET_URL", "https://access.tryterra.co/api/widget/session"),
            headers=TerraAggregator._headers(),
            json={"reference_id": user_id,
                  "providers": ",".join(TerraAggregator.PROVIDER_CODES[p] for p in providers),
                  "auth_success_redirect_url": _redirect(tag, True),
                  "auth_failure_redirect_url": _redirect(tag, False)},
            timeout=TIMEOUT,
        )
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code not in (200, 201) or not body.get("url"):
            raise AggregatorError(f"terra widget session failed ({response.status_code})")
        return {"url": body["url"], "session_id": body.get("session_id"),
                "expires_in": body.get("expires_in"), "aggregator_user_id": None}

    @staticmethod
    def verify(raw_body: bytes, headers) -> bool:
        return verify_webhook_signature(raw_body, headers.get("terra-signature"),
                                        _env("TERRA_SIGNING_SECRET"))

    @staticmethod
    def deauthenticate(aggregator_user_id: str, provider: str) -> bool:
        response = http.delete(f"{TerraAggregator._base()}/v2/auth/deauthenticateUser",
                               headers=TerraAggregator._headers(),
                               params={"user_id": aggregator_user_id}, timeout=TIMEOUT)
        if response.status_code in (200, 404):  # 404: Terra already forgot this user
            return True
        raise AggregatorError(f"terra deauthenticate failed ({response.status_code})")

    @staticmethod
    def item_key(event_type: str, item: dict) -> str:
        meta = item.get("metadata") or {}
        if event_type in {"activity", "sleep"} and meta.get("summary_id"):
            return str(meta["summary_id"])
        if meta.get("start_time") or meta.get("end_time"):
            return f"{meta.get('start_time')}:{meta.get('end_time')}"
        return _hash_key(item)

    @staticmethod
    def normalize(event_type: str, item: dict) -> tuple[dict, dict]:
        """(sample values, day metrics). Activity totals are a workout, not day metrics."""
        g, n = _get, _number
        if event_type == "activity":
            return {
                "duration_s": n(g(item, "active_durations_data", "activity_seconds")),
                "calories": n(g(item, "calories_data", "total_burned_calories")),
                "distance_m": n(g(item, "distance_data", "summary", "distance_meters")),
                "steps": n(g(item, "distance_data", "summary", "steps")),
                "avg_hr": n(g(item, "heart_rate_data", "summary", "avg_hr_bpm")),
                "max_hr": n(g(item, "heart_rate_data", "summary", "max_hr_bpm")),
            }, {}
        if event_type == "daily":
            values = {
                "steps": n(g(item, "distance_data", "steps")),
                "calories": n(g(item, "calories_data", "total_burned_calories")),
                "resting_hr": n(g(item, "heart_rate_data", "summary", "resting_hr_bpm")),
                "hrv": n(g(item, "heart_rate_data", "summary", "avg_hrv_rmssd")),
                "strain": n(g(item, "strain_data", "strain_level")),
                "recovery": n(g(item, "scores", "recovery")),
            }
            return values, dict(values)
        if event_type == "sleep":
            asleep = n(g(item, "sleep_durations_data", "asleep", "duration_asleep_state_seconds"))
            if asleep is None:
                stages = [n(g(item, "sleep_durations_data", "asleep", k)) for k in (
                    "duration_deep_sleep_state_seconds", "duration_light_sleep_state_seconds",
                    "duration_REM_sleep_state_seconds")]
                stages = [s for s in stages if s is not None]
                asleep = sum(stages) if stages else None
            values = {"asleep_s": asleep,
                      "hrv": n(g(item, "heart_rate_data", "summary", "avg_hrv_rmssd")),
                      "resting_hr": n(g(item, "heart_rate_data", "summary", "resting_hr_bpm"))}
            return values, {"sleep_hours": asleep / 3600 if asleep is not None else None,
                            "hrv": values["hrv"], "resting_hr": values["resting_hr"]}
        if event_type == "body":
            values = {
                "weight_kg": n(g(item, "measurements_data", "measurements", -1, "weight_kg")),
                "resting_hr": n(g(item, "heart_data", "heart_rate_data", "summary", "resting_hr_bpm")),
                "hrv": n(g(item, "heart_data", "heart_rate_data", "summary", "avg_hrv_rmssd")),
                "vo2max": n(g(item, "oxygen_data", "vo2max_ml_per_min_per_kg")),
            }
            return values, {k: values[k] for k in ("resting_hr", "hrv", "vo2max")}
        return {}, {}

    @staticmethod
    def events(payload: dict) -> list[dict]:
        kind = payload.get("type")
        if kind == "auth":
            if payload.get("status") != "success":
                return [WearableEvent.ignored(f"auth {payload.get('status')}")]
            user = payload.get("user") or {}
            return TerraAggregator._connect(user, payload.get("reference_id"))
        if kind == "user_reauth":
            old = (payload.get("old_user") or {}).get("user_id")
            return TerraAggregator._connect(payload.get("new_user") or {}, None, replaces=old)
        if kind in TerraAggregator.DEAUTH_EVENTS:
            uid = (payload.get("user") or {}).get("user_id")
            return [WearableEvent.disconnect(uid)] if uid else [WearableEvent.ignored("no user")]
        if kind in TerraAggregator.DATA_EVENTS:
            user = payload.get("user") or {}
            uid = user.get("user_id")
            if not uid:
                return [WearableEvent.ignored("no user")]
            provider = TerraAggregator.provider_slug(user.get("provider"))
            out = []
            for item in payload.get("data") or []:
                if not isinstance(item, dict):
                    continue
                values, metrics = TerraAggregator.normalize(kind, item)
                meta = item.get("metadata") or {}
                out.append(WearableEvent.sample(
                    uid, provider, kind, TerraAggregator.item_key(kind, item),
                    _time(meta.get("start_time") or item.get("timestamp")), _time(meta.get("end_time")),
                    values, metrics))
            return out
        return [WearableEvent.ignored(f"event {kind}")]

    @staticmethod
    def _connect(user: dict, reference_id, replaces=None) -> list[dict]:
        provider = TerraAggregator.provider_slug(user.get("provider"))
        ref = user.get("reference_id") or reference_id
        if not (user.get("user_id") and provider and ref):
            return [WearableEvent.ignored("incomplete user")]
        return [WearableEvent.connect(user["user_id"], provider, ref, replaces)]


# --------------------------------------------------------------------------- #
# Junction                                                                     #
# --------------------------------------------------------------------------- #
class SvixSignature:
    """Svix webhook signatures, used by Junction.

    https://docs.junction.com/webhooks/introduction (headers svix-id, svix-timestamp,
    svix-signature) and https://docs.svix.com/receiving/verifying-payloads/how-manual:
    signed content is ``{svix-id}.{svix-timestamp}.{raw body}``; key is the base64 part
    of the ``whsec_`` secret; signature is base64 HMAC-SHA256; the header holds one or
    more space-separated ``v1,<sig>`` entries; reject timestamps over 5 minutes off.
    """

    TOLERANCE = 300

    @staticmethod
    def sign(secret: str, msg_id: str, timestamp: str, body: bytes) -> str:
        key = base64.b64decode(secret.removeprefix("whsec_"))
        content = f"{msg_id}.{timestamp}.".encode() + body
        return base64.b64encode(hmac.new(key, content, hashlib.sha256).digest()).decode()

    @staticmethod
    def verify(secret: str, headers, body: bytes, now: int | None = None) -> bool:
        msg_id = headers.get("svix-id")
        timestamp = headers.get("svix-timestamp")
        header = headers.get("svix-signature")
        if not (secret and msg_id and timestamp and header):
            return False
        try:
            signed_at = int(timestamp)
            expected = SvixSignature.sign(secret, msg_id, timestamp, body)
        except (ValueError, binascii.Error):
            return False
        current = int(time.time()) if now is None else now
        if abs(current - signed_at) > SvixSignature.TOLERANCE:
            return False
        for entry in header.split(" "):
            version, _, signature = entry.partition(",")
            if version == "v1" and hmac.compare_digest(signature, expected):
                return True
        return False


class JunctionAggregator(Aggregator):
    """Junction, formerly Vital (junction.com).

    API key header ``x-vital-api-key``. Hosts (OpenAPI servers):
      production https://api.us.junction.com / https://api.eu.junction.com,
      sandbox https://api.sandbox.us.junction.com / https://api.sandbox.eu.junction.com.
    User: GET /v2/user/resolve/{client_user_id}, else POST /v2/user {client_user_id}.
      https://docs.junction.com/api-reference/user/resolve-user
      https://docs.junction.com/api-reference/user/create-user
    Link: POST /v2/link/token {user_id, provider?, redirect_url, filter_on_providers} ->
      link_web_url. https://docs.junction.com/api-reference/link/generate-link-token
    Deauth: DELETE /v2/user/{user_id}/{provider}.
      https://docs.junction.com/api-reference/user/deregister-a-provider
    Webhooks: Svix-signed. Events provider.connection.created and
      daily.data.{activity,sleep,body,workouts}.{created,updated}.
      https://docs.junction.com/webhooks/introduction
      Summary fields: https://docs.junction.com/api-reference/data/activity/get-summary
      (and .../sleep, .../body, .../workouts).
    """

    name = "junction"
    # Slugs from the Providers enum in the link-token OpenAPI. Whoop is whoop_v2.
    PROVIDER_CODES = {"garmin": "garmin", "whoop": "whoop_v2", "fitbit": "fitbit",
                      "oura": "oura", "polar": "polar"}
    RESOURCES = {"activity": "daily", "sleep": "sleep", "body": "body", "workouts": "activity"}

    @staticmethod
    def env_keys() -> tuple[str, ...]:
        return ("JUNCTION_API_KEY", "JUNCTION_WEBHOOK_SECRET")

    @classmethod
    def provider_slug(cls, code) -> str | None:
        text = str(code or "").lower()
        return "whoop" if text in {"whoop", "whoop_v2"} else super().provider_slug(text)

    @staticmethod
    def base_url() -> str:
        if _env("JUNCTION_BASE_URL"):
            return _env("JUNCTION_BASE_URL").rstrip("/")
        region = "eu" if _env("JUNCTION_REGION", "us").lower() == "eu" else "us"
        sandbox = _env("JUNCTION_ENVIRONMENT", "sandbox").lower() != "production"
        return f"https://api.{'sandbox.' if sandbox else ''}{region}.junction.com"

    @staticmethod
    def _headers() -> dict:
        return {"x-vital-api-key": _env("JUNCTION_API_KEY"), "Accept": "application/json"}

    @staticmethod
    def ensure_user(client_user_id: str) -> str:
        base, headers = JunctionAggregator.base_url(), JunctionAggregator._headers()
        found = http.get(f"{base}/v2/user/resolve/{client_user_id}", headers=headers, timeout=TIMEOUT)
        if found.status_code == 200 and (found.json() or {}).get("user_id"):
            return found.json()["user_id"]
        created = http.post(f"{base}/v2/user", headers=headers,
                            json={"client_user_id": client_user_id}, timeout=TIMEOUT)
        if created.status_code in (200, 201) and (created.json() or {}).get("user_id"):
            return created.json()["user_id"]
        raise AggregatorError(f"junction user failed ({created.status_code})")

    @staticmethod
    def connect_url(user_id: str, providers: list[str]) -> dict:
        junction_user = JunctionAggregator.ensure_user(user_id)
        tag = providers[0] if len(providers) == 1 else "junction"
        body = {"user_id": junction_user, "redirect_url": _redirect(tag, True),
                "filter_on_providers": [JunctionAggregator.PROVIDER_CODES[p] for p in providers]}
        if len(providers) == 1:
            body["provider"] = JunctionAggregator.PROVIDER_CODES[providers[0]]
        response = http.post(f"{JunctionAggregator.base_url()}/v2/link/token",
                             headers=JunctionAggregator._headers(), json=body, timeout=TIMEOUT)
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code not in (200, 201) or not data.get("link_web_url"):
            raise AggregatorError(f"junction link token failed ({response.status_code})")
        return {"url": data["link_web_url"], "session_id": None, "expires_in": 600,
                "aggregator_user_id": junction_user}

    @staticmethod
    def verify(raw_body: bytes, headers) -> bool:
        return SvixSignature.verify(_env("JUNCTION_WEBHOOK_SECRET"), headers, raw_body)

    @staticmethod
    def deauthenticate(aggregator_user_id: str, provider: str) -> bool:
        code = JunctionAggregator.PROVIDER_CODES.get(provider, provider)
        response = http.delete(f"{JunctionAggregator.base_url()}/v2/user/{aggregator_user_id}/{code}",
                               headers=JunctionAggregator._headers(), timeout=TIMEOUT)
        if response.status_code in (200, 204, 404):
            return True
        raise AggregatorError(f"junction deregister failed ({response.status_code})")

    @staticmethod
    def events(payload: dict) -> list[dict]:
        kind = str(payload.get("event_type") or "")
        data = payload.get("data") or {}
        uid = data.get("user_id") or payload.get("user_id")
        if kind == "provider.connection.created":
            provider = JunctionAggregator.provider_slug(_get(data, "provider", "slug") or data.get("provider"))
            if not (uid and provider):
                return [WearableEvent.ignored("incomplete connection")]
            return [WearableEvent.connect(uid, provider, payload.get("client_user_id"))]
        parts = kind.split(".")
        if len(parts) == 4 and parts[0] == "daily" and parts[1] == "data" and parts[2] in JunctionAggregator.RESOURCES:
            if not uid:
                return [WearableEvent.ignored("no user")]
            resource = parts[2]
            provider = JunctionAggregator.provider_slug(_get(data, "source", "provider") or data.get("provider"))
            values, metrics = JunctionAggregator.normalize(resource, data)
            key = str(data.get("id") or data.get("calendar_date") or _hash_key(data))
            start = _time(data.get("time_start") or data.get("bedtime_start") or data.get("calendar_date"))
            end = _time(data.get("time_end") or data.get("bedtime_end"))
            return [WearableEvent.sample(uid, provider, JunctionAggregator.RESOURCES[resource],
                                         key, start, end, values, metrics)]
        return [WearableEvent.ignored(f"event {kind}")]

    @staticmethod
    def normalize(resource: str, data: dict) -> tuple[dict, dict]:
        n = _number
        if resource == "activity":
            values = {"steps": n(data.get("steps")), "calories": n(data.get("calories_total")),
                      "resting_hr": n(_get(data, "heart_rate", "resting_bpm"))}
            return values, dict(values)
        if resource == "sleep":
            total = n(data.get("total"))  # seconds asleep
            values = {"asleep_s": total, "hrv": n(data.get("average_hrv")),
                      "resting_hr": n(data.get("hr_resting"))}
            return values, {"sleep_hours": total / 3600 if total is not None else None,
                            "hrv": values["hrv"], "resting_hr": values["resting_hr"]}
        if resource == "body":
            return {"weight_kg": n(data.get("weight")), "body_fat_pct": n(data.get("fat"))}, {}
        if resource == "workouts":
            return {"duration_s": n(data.get("moving_time")), "calories": n(data.get("calories")),
                    "distance_m": n(data.get("distance")), "avg_hr": n(data.get("average_hr")),
                    "max_hr": n(data.get("max_hr"))}, {}
        return {}, {}


# --------------------------------------------------------------------------- #
# Thryve                                                                       #
# --------------------------------------------------------------------------- #
class ThryveAggregator(Aggregator):
    """Thryve (thryve.health). Host https://api.thryve.de.

    Every call sends ``Authorization: Basic username:password`` and
    ``AppAuthorization: Basic authID:authSecret``.
    User: POST /v5/accessToken (form ``partnerUserID``) returns the endUserId.
      https://docs.thryve.health/integrate-your-web-app/create-thryve-user
      The alias must be unguessable (>= 32 chars, <= 80), so it is an HMAC of our id.
    Widget: POST /widget/v6/connection {endUserId} -> data.url with connectionSessionToken.
      https://docs.thryve.health/connect-data-sources
    Single source connect/revoke: service2.und-gesund.de/dataSourceDirectConnection.html
      and dataSourceDirectRevoke.html (?token=&dataSource=&direct=true); a GET on the
      revoke URL disconnects in the background.
      https://docs.thryve.health/connect-data-sources/build-your-custom-data-source-connection-screen
    Source IDs: https://docs.thryve.health/thryve-data-sources/overview
    Webhooks: zstd-compressed JSON; notification.source.connect/disconnect and
      event.data.daily.create/update. https://docs.thryve.health/receive-updates-via-webhooks/notifications
      https://docs.thryve.health/receive-updates-via-webhooks/data-push
    Webhook authentication: the data-push page says an HMAC secret can be configured
      but does not document the header, algorithm or signed bytes, so HMAC is NOT
      implemented here. Instead we use the documented "custom authentication ... web
      authentication" option: set an Authorization header value in the Thryve Dashboard
      and the same value in THRYVE_WEBHOOK_AUTH. Compared in constant time.
    """

    name = "thryve"
    PROVIDER_CODES = {"fitbit": 1, "garmin": 2, "polar": 3, "oura": 18, "whoop": 42}
    # Daily dataTypeIds documented by Thryve: 1000 Steps, 3001 resting heart rate.
    # 2000 SleepDuration and 5020 Weight have no documented unit, so they are kept as
    # raw sample values and never turned into IronFlow metrics.
    DAILY_TYPES = {1000: ("steps", "steps"), 3001: ("resting_hr", "resting_hr"),
                   2000: ("sleep_duration_raw", None), 5020: ("weight_raw", None)}
    CONNECT_HOST = "https://service2.und-gesund.de"

    @staticmethod
    def env_keys() -> tuple[str, ...]:
        return ("THRYVE_USERNAME", "THRYVE_PASSWORD", "THRYVE_AUTH_ID", "THRYVE_AUTH_SECRET",
                "THRYVE_WEBHOOK_AUTH")

    @staticmethod
    def base_url() -> str:
        return _env("THRYVE_BASE_URL", "https://api.thryve.de").rstrip("/")

    @staticmethod
    def _basic(user: str, password: str) -> str:
        return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()

    @staticmethod
    def _headers() -> dict:
        return {"Authorization": ThryveAggregator._basic(_env("THRYVE_USERNAME"), _env("THRYVE_PASSWORD")),
                "AppAuthorization": ThryveAggregator._basic(_env("THRYVE_AUTH_ID"), _env("THRYVE_AUTH_SECRET"))}

    @staticmethod
    def alias(user_id: str) -> str:
        return hmac.new(_env("THRYVE_AUTH_SECRET").encode(), user_id.encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def end_user_id(user_id: str) -> str:
        response = http.post(f"{ThryveAggregator.base_url()}/v5/accessToken",
                             headers=ThryveAggregator._headers(),
                             data={"partnerUserID": ThryveAggregator.alias(user_id)}, timeout=TIMEOUT)
        token = (response.text or "").strip().strip('"')
        if response.status_code != 200 or not token:
            raise AggregatorError(f"thryve accessToken failed ({response.status_code})")
        return token

    @staticmethod
    def session_token(end_user_id: str) -> tuple[str, str]:
        response = http.post(f"{ThryveAggregator.base_url()}/widget/v6/connection",
                             headers=ThryveAggregator._headers(),
                             json={"endUserId": end_user_id, "locale": "en"}, timeout=TIMEOUT)
        try:
            url = _get(response.json(), "data", "url")
        except ValueError:
            url = None
        token = (parse_qs(urlparse(url).query).get("connectionSessionToken") or [None])[0] if url else None
        if response.status_code != 200 or not token:
            raise AggregatorError(f"thryve widget failed ({response.status_code})")
        return url, token

    @staticmethod
    def connect_url(user_id: str, providers: list[str]) -> dict:
        end_user = ThryveAggregator.end_user_id(user_id)
        widget_url, token = ThryveAggregator.session_token(end_user)
        if len(providers) == 1:
            url = f"{ThryveAggregator.CONNECT_HOST}/dataSourceDirectConnection.html?" + urlencode({
                "token": token, "dataSource": ThryveAggregator.PROVIDER_CODES[providers[0]],
                "redirect_uri": _redirect(providers[0], True)})
        else:
            url = widget_url  # Thryve says the full widget must be embedded in an iframe.
        return {"url": url, "session_id": None, "expires_in": None, "aggregator_user_id": end_user}

    @staticmethod
    def verify(raw_body: bytes, headers) -> bool:
        expected = _env("THRYVE_WEBHOOK_AUTH")
        given = headers.get("authorization") or ""
        return bool(expected) and hmac.compare_digest(given.encode(), expected.encode())

    @staticmethod
    def parse(raw_body: bytes, headers) -> dict:
        if (headers.get("content-encoding") or "").lower() == "zstd":
            import zstandard

            raw_body = zstandard.ZstdDecompressor().decompressobj().decompress(raw_body)
        return Aggregator.parse(raw_body, headers)

    @staticmethod
    def deauthenticate(aggregator_user_id: str, provider: str) -> bool:
        _, token = ThryveAggregator.session_token(aggregator_user_id)
        response = http.get(f"{ThryveAggregator.CONNECT_HOST}/dataSourceDirectRevoke.html",
                            params={"token": token, "dataSource": ThryveAggregator.PROVIDER_CODES[provider],
                                    "direct": "true"}, timeout=TIMEOUT)
        if response.status_code in (200, 302):
            return True
        raise AggregatorError(f"thryve revoke failed ({response.status_code})")

    @staticmethod
    def events(payload: dict) -> list[dict]:
        kind = str(payload.get("type") or "")
        uid = payload.get("endUserId")
        data = payload.get("data") or {}
        if not uid:
            return [WearableEvent.ignored("no user")]
        provider = ThryveAggregator.provider_slug(data.get("dataSourceId"))
        if kind.endswith("source.connect"):
            return [WearableEvent.connect(uid, provider)] if provider else [WearableEvent.ignored("source")]
        if kind.endswith("source.disconnect"):
            return [WearableEvent.disconnect(uid, provider)] if provider else [WearableEvent.ignored("source")]
        if kind.startswith("event.data.daily."):
            out = []
            # The docs list ``dailyData``; one daily example uses ``epochData``. Accept both.
            for item in data.get("dailyData") or data.get("epochData") or []:
                mapped = ThryveAggregator.DAILY_TYPES.get(item.get("dataTypeId")) if isinstance(item, dict) else None
                value = _number(item.get("value")) if mapped else None
                if value is None:
                    continue
                sample_name, metric = mapped
                day = item.get("day")
                out.append(WearableEvent.sample(
                    uid, provider, "daily", f"{day}:{item['dataTypeId']}:{data.get('dataSourceId')}",
                    _time(day), None, {sample_name: value}, {metric: value} if metric else {}))
            return out or [WearableEvent.ignored("no mapped data")]
        return [WearableEvent.ignored(f"event {kind}")]


class Aggregators:
    """Registry and env-based selection."""

    ALL: dict[str, type[Aggregator]] = {
        "terra": TerraAggregator, "junction": JunctionAggregator, "thryve": ThryveAggregator}

    @staticmethod
    def selected_name() -> str:
        name = _env("WEARABLES_AGGREGATOR", "terra").strip().lower()
        return name if name in Aggregators.ALL else "terra"

    @staticmethod
    def selected() -> type[Aggregator]:
        return Aggregators.ALL[Aggregators.selected_name()]

    @staticmethod
    def get(name: str) -> type[Aggregator] | None:
        return Aggregators.ALL.get(name)
