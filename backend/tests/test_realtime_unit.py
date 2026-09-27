"""Centrifugo transport: token shape, and the two safety rules.

Realtime is additive. The suite pins the guarantees that let it ship without
becoming a new way for the product to fail.
"""
import asyncio
import os

import jwt
import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import realtime  # noqa: E402
from routers import community  # noqa: E402
from tests.test_community_permissions import account, run_isolated, seed  # noqa: E402


def test_channel_names_namespace_by_domain():
    assert realtime.community_channel("c-1") == "community:c-1"
    assert realtime.chat_channel("ch-1") == "channel:ch-1"
    assert realtime.user_channel("u-1") == "user:u-1"
    assert realtime.live_channel("s-1") == "live:s-1"


def test_connection_token_is_verifiable_and_expires(monkeypatch):
    monkeypatch.setattr(realtime, "TOKEN_SECRET", "unit-test-secret")
    token = realtime.connection_token("u-42", ttl_seconds=60)
    claims = jwt.decode(token, "unit-test-secret", algorithms=["HS256"])
    assert claims["sub"] == "u-42"
    assert 0 < claims["exp"] - claims["iat"] <= 60

    with pytest.raises(jwt.InvalidTokenError):
        jwt.decode(token, "the-wrong-secret", algorithms=["HS256"])


def test_token_minting_refuses_to_run_without_a_secret(monkeypatch):
    monkeypatch.setattr(realtime, "TOKEN_SECRET", "")
    with pytest.raises(RuntimeError):
        realtime.connection_token("u-1")


def test_publish_is_a_silent_noop_when_unconfigured(monkeypatch):
    monkeypatch.setattr(realtime, "CENTRIFUGO_URL", "")
    monkeypatch.setattr(realtime, "CENTRIFUGO_API_KEY", "")

    def explode(*args, **kwargs):  # pragma: no cover - must never be reached
        raise AssertionError("publish must not touch the network when unconfigured")

    monkeypatch.setattr(realtime.httpx, "AsyncClient", explode)
    assert asyncio.run(realtime.publish("channel:x", {"hello": "world"})) is None


def test_publish_swallows_transport_failures(monkeypatch):
    monkeypatch.setattr(realtime, "CENTRIFUGO_URL", "http://centrifugo.invalid")
    monkeypatch.setattr(realtime, "CENTRIFUGO_API_KEY", "key")

    class Boom:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *args, **kwargs):
            raise ConnectionError("centrifugo is down")

    monkeypatch.setattr(realtime.httpx, "AsyncClient", Boom)
    assert asyncio.run(realtime.publish("channel:x", {"a": 1})) is None


class BrokenTransport:
    """An httpx.AsyncClient stand-in whose every request fails."""

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        raise ConnectionError("centrifugo is down")


def test_a_centrifugo_outage_never_fails_message_creation(monkeypatch):
    """The rule that matters most: chat keeps working when realtime does not."""
    async def scenario(db):
        await seed(db, monkeypatch)
        monkeypatch.setattr(realtime, "CENTRIFUGO_URL", "http://centrifugo.invalid")
        monkeypatch.setattr(realtime, "CENTRIFUGO_API_KEY", "key")
        monkeypatch.setattr(realtime.httpx, "AsyncClient", BrokenTransport)

        message = await community.create_message(
            "ch-1", community.MessageIn(content="still delivered"), account("mem"))
        assert message["content"] == "still delivered"
        assert await db.messages.find_one({"id": message["id"]}) is not None

    run_isolated(scenario)
