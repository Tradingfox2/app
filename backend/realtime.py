"""Centrifugo transport: connection tokens out, channel publishes in.

Centrifugo OSS is Apache-2.0 and self-hosted, so this costs nothing to run. It
owns the socket; FastAPI stays the source of truth and publishes *after* a write
has already committed.

Two rules make this safe to add to an existing product:

1. **Unconfigured is a no-op.** With no `CENTRIFUGO_URL` the publish returns
   without touching the network, so tests and local dev need no extra service.
2. **A publish never fails a request.** Delivery is best-effort; the client
   reconciles on reconnect via Centrifugo's own history recovery. Losing a
   realtime nudge must never lose the message that triggered it.

Channel naming mirrors the domain: `community:{id}`, `channel:{id}`, `user:{id}`.
"""
from __future__ import annotations

import logging
import os
import time

import httpx
import jwt

import tls

logger = logging.getLogger(__name__)

CENTRIFUGO_URL = os.environ.get("CENTRIFUGO_URL", "").rstrip("/")
CENTRIFUGO_API_KEY = os.environ.get("CENTRIFUGO_API_KEY", "")
# Falls back to the app's own JWT secret so a single-secret deployment works,
# but Centrifugo's docs are emphatic that this value never reaches a client.
TOKEN_SECRET = os.environ.get("CENTRIFUGO_TOKEN_SECRET") or os.environ.get("JWT_SECRET", "")
TOKEN_TTL_SECONDS = int(os.environ.get("CENTRIFUGO_TOKEN_TTL", "3600"))

PUBLISH_TIMEOUT_SECONDS = 2.0


def is_configured() -> bool:
    return bool(CENTRIFUGO_URL and CENTRIFUGO_API_KEY)


def community_channel(community_id: str) -> str:
    return f"community:{community_id}"


def chat_channel(channel_id: str) -> str:
    return f"channel:{channel_id}"


def user_channel(user_id: str) -> str:
    return f"user:{user_id}"


def connection_token(user_id: str, ttl_seconds: int | None = None) -> str:
    """Mint the short-lived HS256 JWT the client hands to Centrifugo on connect.

    The `channels` claim subscribes the connection to the member's own
    `user:{id}` channel server-side, so mention and notification nudges arrive
    without the client ever asking — and no client can ask for someone else's.
    """
    if not TOKEN_SECRET:
        raise RuntimeError("Realtime token secret is not configured")
    claims = {
        "sub": user_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + (ttl_seconds or TOKEN_TTL_SECONDS),
        "channels": [user_channel(user_id)],
    }
    return jwt.encode(claims, TOKEN_SECRET, algorithm="HS256")


def subscription_token(user_id: str, channel: str, ttl_seconds: int | None = None) -> str:
    """Mint the per-channel JWT Centrifugo checks before admitting a subscriber.

    Issued only after the API has checked the member may view the channel, so
    the permission rules stay in one place. The deployment must configure the
    `channel` namespace to require these tokens (no `allow_subscribe_for_client`),
    otherwise any signed-in client could listen to any room.
    """
    if not TOKEN_SECRET:
        raise RuntimeError("Realtime token secret is not configured")
    claims = {
        "sub": user_id,
        "channel": channel,
        "iat": int(time.time()),
        "exp": int(time.time()) + (ttl_seconds or TOKEN_TTL_SECONDS),
    }
    return jwt.encode(claims, TOKEN_SECRET, algorithm="HS256")


async def publish(channel: str, data: dict) -> None:
    """Fire-and-forget publish. Silent when unconfigured, never raises."""
    if not is_configured():
        return
    try:
        async with httpx.AsyncClient(timeout=PUBLISH_TIMEOUT_SECONDS, verify=tls.client_context()) as client:
            response = await client.post(
                f"{CENTRIFUGO_URL}/api/publish",
                json={"channel": channel, "data": data},
                headers={"X-API-Key": CENTRIFUGO_API_KEY},
            )
            response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 - realtime is best-effort by design
        logger.warning("Centrifugo publish to %s failed: %s", channel, exc)
