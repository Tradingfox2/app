"""App Store and Play Store Pro. Only this webhook writes the row.

Amounts come from the event currency. EUR is never filled in.
A missing REVENUECAT_WEBHOOK_SECRET is 503 and grants nothing.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

import pro_billing
import server

router = APIRouter()
_GRANT = {
    "INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE", "UNCANCELLATION",
    "PRODUCT_CHANGE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT", "REFUND_REVERSED",
}
# Minor-unit exponent. Anything else, including an unknown code, uses cents.
_EXPONENT = {
    "bif": 0, "clp": 0, "djf": 0, "gnf": 0, "jpy": 0, "kmf": 0, "krw": 0,
    "mga": 0, "pyg": 0, "rwf": 0, "ugx": 0, "vnd": 0, "vuv": 0, "xpf": 0,
    "bhd": 3, "jod": 3, "kwd": 3, "omr": 3, "tnd": 3,
}


def _secret() -> str:
    return os.environ.get("REVENUECAT_WEBHOOK_SECRET", "").strip()


def _authorized(header: str, secret: str) -> bool:
    """Compare the full Authorization value. Length must not change the result."""
    given = hashlib.sha256(header.encode()).digest()
    expected = hashlib.sha256(secret.encode()).digest()
    return hmac.compare_digest(given, expected)


def _money(event: dict) -> tuple[int | None, str | None]:
    """`price` is USD. The charged amount is `price_in_purchased_currency`."""
    currency = event.get("currency")
    if not isinstance(currency, str) or not currency.strip():
        return None, None
    code = currency.strip().lower()
    price = event.get("price_in_purchased_currency")
    if isinstance(price, bool) or not isinstance(price, (int, float)) or price < 0:
        return None, code
    return int(round(price * (10 ** _EXPONENT.get(code, 2)))), code


def _plan(product_id: object) -> str:
    text = product_id.lower() if isinstance(product_id, str) else ""
    if "year" in text or "annual" in text:
        return "pro_yearly"
    return "pro_monthly"


def _period_end(raw: object) -> datetime | None:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return datetime.fromtimestamp(raw / 1000, timezone.utc)


def _has_pro(event: dict) -> bool:
    ids = event.get("entitlement_ids")
    if isinstance(ids, list):
        return "pro" in ids
    return event.get("entitlement_id") == "pro"


def _status(kind: str, event: dict, row: dict | None) -> tuple[str, bool | None] | None:
    if kind == "EXPIRATION":
        return "canceled", False
    if kind == "BILLING_ISSUE":
        return "past_due", None
    if kind == "CANCELLATION":
        current = (row or {}).get("status")
        status = current if current in pro_billing._GRANTING else (
            "trialing" if event.get("period_type") == "TRIAL" else "active"
        )
        return status, True
    if kind in _GRANT:
        return ("trialing" if event.get("period_type") == "TRIAL" else "active"), False
    return None


async def _stripe_owns(user_id: str) -> bool:
    """A live Stripe Pro row stays on the Stripe webhook."""
    row = await server.db.subscriptions.find_one(
        {"user_id": user_id}, {"_id": 0, "stripe_subscription_id": 1, "status": 1, "provider": 1},
    )
    if not row or row.get("provider") == "revenuecat":
        return False
    return isinstance(row.get("stripe_subscription_id"), str) and row.get("status") in pro_billing._GRANTING


async def _apply(event: dict) -> None:
    if not _has_pro(event):
        return
    user_id = event.get("app_user_id")
    if not isinstance(user_id, str) or not user_id:
        return
    if not await server.db.users.find_one({"id": user_id}, {"_id": 1}):
        return
    if await _stripe_owns(user_id):
        return
    kind = event.get("type")
    if not isinstance(kind, str):
        return
    row = await server.db.subscriptions.find_one({"user_id": user_id}, {"_id": 0, "status": 1})
    decided = _status(kind, event, row)
    if decided is None:
        return
    status, cancel_at_period_end = decided
    amount, currency = _money(event)
    await pro_billing._save(
        user_id, provider="revenuecat", plan=_plan(event.get("product_id")), status=status,
        currency=currency, amount_cents=amount, current_period_end=_period_end(event.get("expiration_at_ms")),
        cancel_at_period_end=cancel_at_period_end,
    )
    await server.db.subscriptions.update_one(
        {"user_id": user_id, "provider": "revenuecat"},
        {"$unset": {"stripe_subscription_id": "", "stripe_customer_id": ""}},
    )


@router.post("/webhooks/revenuecat")
async def revenuecat_webhook(request: Request):
    secret = _secret()
    if not secret:
        raise HTTPException(503, "Payments are not set up yet")
    header = request.headers.get("authorization", "")
    if not isinstance(header, str) or not _authorized(header, secret):
        raise HTTPException(401, "Invalid authorization")
    try:
        body = json.loads(await request.body())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(400, "Invalid JSON") from exc
    event = body.get("event") if isinstance(body, dict) else None
    if not isinstance(event, dict):
        raise HTTPException(400, "Invalid event")
    if event.get("type") == "TEST":
        return {"received": True}
    event_id = event.get("id")
    stored_id = f"revenuecat:{event_id}" if isinstance(event_id, str) and event_id else None
    if stored_id and await server.db.billing_events.find_one({"id": stored_id}, {"_id": 1}):
        return {"received": True}
    await _apply(event)
    if stored_id:
        await server.db.billing_events.update_one(
            {"id": stored_id},
            {"$setOnInsert": {"type": event.get("type"), "received_at": server.now()}},
            upsert=True,
        )
    return {"received": True}
