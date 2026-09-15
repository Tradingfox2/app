"""Phone push notifications through Expo's push service.

Expo's service is free and speaks plain HTTPS, so this needs no SDK and no new
Python dependency. The app registers its Expo push token with the API; when a
notification row is written, the same title and body go out as a push.

Like realtime, push is best-effort and never fails a request:
- no registered token, or `PUSH_ENABLED=off`, is a silent no-op;
- the send runs as a background task with a short timeout;
- tokens Expo reports as `DeviceNotRegistered` are deleted, so an uninstalled
  app stops being pushed to.

Only the notification's title and a short body travel — never health data. The
notification layer already guarantees that: nothing health-related is ever
written as a notification body.
"""
from __future__ import annotations

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
ENABLED = os.environ.get("PUSH_ENABLED", "on").lower() not in {"off", "0", "false"}
TIMEOUT_SECONDS = 4.0

_pending: set[asyncio.Task] = set()


def _db():
    import server  # read at call time so tests that patch server.db are followed

    return server.db


async def _send(user_id: str, title: str, body: str, data: dict) -> None:
    try:
        tokens = [row["token"] async for row in _db().push_tokens.find({"user_id": user_id}, {"_id": 0, "token": 1})]
    except Exception as exc:  # noqa: BLE001 - a push must never surface as an error
        logger.info("Push token lookup failed: %s", exc)
        return
    if not tokens:
        return
    messages = [{"to": token, "title": title, "body": body[:180], "data": data, "sound": "default"}
                for token in tokens]
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(EXPO_PUSH_URL, json=messages,
                                         headers={"Accept": "application/json"})
            response.raise_for_status()
            tickets = (response.json() or {}).get("data") or []
    except Exception as exc:  # noqa: BLE001 - push is best-effort by design
        logger.warning("Expo push to %s failed: %s", user_id, exc)
        return
    for token, ticket in zip(tokens, tickets):
        if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
            await _db().push_tokens.delete_one({"token": token})


def notify(user_id: str, title: str, body: str = "", data: dict | None = None) -> None:
    """Queue a push to every device `user_id` has registered. Returns at once."""
    if not ENABLED:
        return
    try:
        task = asyncio.get_running_loop().create_task(_send(user_id, title, body or "", data or {}))
    except RuntimeError:
        return  # no running loop (a sync caller): nothing to schedule on
    _pending.add(task)
    task.add_done_callback(_pending.discard)
