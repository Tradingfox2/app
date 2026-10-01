"""Stripe billing for paid communities, over Stripe's plain REST API.

Like push and realtime this needs no SDK and no new Python dependency: Stripe
speaks form-encoded HTTPS, and a webhook signature is one HMAC-SHA256.

The money rule is the whole design: **only a webhook Stripe signed can activate
a paid membership.** The browser coming back to a success URL proves nothing —
anyone can type that URL — so the app never trusts it, it only waits for the
signed `checkout.session.completed` event.

Unconfigured is explicit, not silent: with no `STRIPE_SECRET_KEY` a checkout
answers 503, so a paid community never pretends to take money it cannot.

Environment:
- `STRIPE_SECRET_KEY`         sk_test_… or sk_live_… (server only, never shipped)
- `STRIPE_WEBHOOK_SECRET`     whsec_… from the webhook endpoint in the dashboard
- `STRIPE_PRICE_PRO_MONTHLY`  Price id for the Pro monthly plan
- `STRIPE_PRICE_PRO_YEARLY`   Price id for the Pro yearly plan
- `PUBLIC_APP_URL`            where Stripe sends people back, e.g. https://app.ironflow.fit
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time

import httpx

import tls

logger = logging.getLogger(__name__)

API = "https://api.stripe.com/v1"
TIMEOUT_SECONDS = 10.0
#: Stripe's own default: a signed event older than this is a replay.
SIGNATURE_TOLERANCE_SECONDS = 300


class BillingError(Exception):
    """Stripe refused or could not be reached."""


def secret_key() -> str:
    return os.environ.get("STRIPE_SECRET_KEY", "")


def webhook_secret() -> str:
    return os.environ.get("STRIPE_WEBHOOK_SECRET", "")


def is_configured() -> bool:
    return bool(secret_key() and webhook_secret())


def app_url() -> str:
    return os.environ.get("PUBLIC_APP_URL", "http://localhost:8082").rstrip("/")


async def _call(method: str, path: str, data: dict | None = None, idempotency_key: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {secret_key()}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, verify=tls.client_context()) as client:
            response = await client.request(method, f"{API}{path}", data=data, headers=headers)
    except httpx.HTTPError as exc:
        raise BillingError(f"Stripe unreachable: {exc}") from exc
    body = response.json() if response.content else {}
    if response.status_code >= 400:
        message = (body.get("error") or {}).get("message") or f"HTTP {response.status_code}"
        raise BillingError(message)
    return body


async def create_checkout(*, community: dict, user: dict, success_url: str, cancel_url: str) -> dict:
    """A hosted Checkout page for a monthly subscription at the community's price.

    The price is sent inline (`price_data`), so an owner changing the price
    never needs a matching object created in the Stripe dashboard. Both the
    session and the subscription carry the community and the member, so every
    later event can be traced back without a lookup table.
    """
    tags = {"community_id": community["id"], "user_id": user["id"]}
    data = {
        "mode": "subscription",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": community.get("currency", "EUR").lower(),
        "line_items[0][price_data][unit_amount]": str(int(community["price_cents"])),
        "line_items[0][price_data][recurring][interval]": "month",
        "line_items[0][price_data][product_data][name]": f"{community['name']} membership"[:250],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": user["id"],
    }
    if user.get("email"):
        data["customer_email"] = user["email"]
    for key, value in tags.items():
        data[f"metadata[{key}]"] = value
        data[f"subscription_data[metadata][{key}]"] = value
    return await _call("POST", "/checkout/sessions", data)


def pro_price_id(plan: str) -> str:
    env = {"pro_monthly": "STRIPE_PRICE_PRO_MONTHLY", "pro_yearly": "STRIPE_PRICE_PRO_YEARLY"}[plan]
    return os.environ.get(env, "")


async def create_customer(user: dict) -> dict:
    data = {"metadata[user_id]": user["id"]}
    if user.get("email"):
        data["email"] = user["email"]
    if user.get("full_name"):
        data["name"] = user["full_name"]
    return await _call("POST", "/customers", data, idempotency_key=f"pro-customer-{user['id']}")


async def create_pro_checkout(*, customer_id: str, user_id: str, plan: str, price_id: str, success_url: str, cancel_url: str) -> dict:
    """Subscription Checkout. Yearly includes a 7-day trial. Grants nothing by itself."""
    data = {
        "mode": "subscription", "customer": customer_id, "client_reference_id": user_id,
        "line_items[0][price]": price_id, "line_items[0][quantity]": "1",
        "success_url": success_url, "cancel_url": cancel_url, "allow_promotion_codes": "true",
        "automatic_tax[enabled]": "true", "billing_address_collection": "required", "customer_update[address]": "auto",
        "metadata[kind]": "pro", "metadata[user_id]": user_id, "metadata[plan]": plan,
        "subscription_data[metadata][kind]": "pro", "subscription_data[metadata][user_id]": user_id,
        "subscription_data[metadata][plan]": plan,
    }
    if plan == "pro_yearly":
        data["subscription_data[trial_period_days]"] = "7"
    return await _call("POST", "/checkout/sessions", data)


async def create_portal(*, customer_id: str, return_url: str) -> dict:
    return await _call("POST", "/billing_portal/sessions", {"customer": customer_id, "return_url": return_url})


async def retrieve_price(price_id: str) -> dict:
    return await _call("GET", f"/prices/{price_id}")


async def cancel_subscription(subscription_id: str) -> None:
    """End a subscription now. Already cancelled counts as done."""
    try:
        await _call("DELETE", f"/subscriptions/{subscription_id}")
    except BillingError as exc:
        if "No such subscription" in str(exc) or "canceled" in str(exc):
            return
        raise


def verify_signature(payload: bytes, header: str, *, now: float | None = None) -> bool:
    """Stripe's `Stripe-Signature` check: HMAC-SHA256 of `{t}.{body}`.

    The header may carry several `v1` signatures while a secret is being
    rolled; any one matching is enough. The timestamp is signed too, so an
    old event cannot be replayed with a fresh `t`.
    """
    secret = webhook_secret()
    if not secret or not header:
        return False
    timestamp, signatures = None, []
    for part in header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)
    if not timestamp or not timestamp.isdigit() or not signatures:
        return False
    if abs((now if now is not None else time.time()) - int(timestamp)) > SIGNATURE_TOLERANCE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)
