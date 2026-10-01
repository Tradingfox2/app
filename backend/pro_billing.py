"""App-wide Pro. Checkout grants nothing until a signed webhook.
Amounts stay Stripe's minor-unit integer plus that object's currency.
Zero-decimal currencies such as JPY are not scaled, and EUR is never assumed.
"""
from __future__ import annotations
import logging
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import billing
import ratelimit
import server
logger = logging.getLogger(__name__)
router = APIRouter()
_CACHE_SECONDS = 3600
_plans_cache: dict = {"at": 0.0, "key": "", "body": None}
_PLANS = {"pro_monthly", "pro_yearly"}
_GRANTING = ["active", "trialing", "past_due"]
class CheckoutIn(BaseModel):
    plan: str = Field(pattern="^(pro_monthly|pro_yearly)$")
def _id(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, dict) and isinstance(value.get("id"), str):
        return value["id"]
    return None
def _money(amount: object, currency: object) -> tuple[int | None, str | None]:
    code = currency.lower() if isinstance(currency, str) else ""
    return (amount if isinstance(amount, int) else None, code or None)
def _period_end(subscription: dict) -> datetime | None:
    raw = subscription.get("current_period_end")
    items = ((subscription.get("items") or {}).get("data") or [])
    raw = items[0].get("current_period_end") if raw is None and items else raw
    return datetime.fromtimestamp(int(raw), timezone.utc) if isinstance(raw, (int, float)) else None
def _plan_of(subscription: dict, row: dict | None) -> str | None:
    plan = (subscription.get("metadata") or {}).get("plan")
    if plan in _PLANS:
        return plan
    items = ((subscription.get("items") or {}).get("data") or [])
    interval = (((items[0].get("price") if items else None) or {}).get("recurring") or {}).get("interval")
    return {"month": "pro_monthly", "year": "pro_yearly"}.get(interval) or (row or {}).get("plan")
async def _save(user_id: str, **fields: object) -> None:
    written = {key: value for key, value in fields.items() if value is not None}
    written["updated_at"] = server.now()
    await server.db.subscriptions.update_one(
        {"user_id": user_id},
        {"$set": written, "$setOnInsert": {"id": server.new_id(), "created_at": server.now()}},
        upsert=True,
    )
async def is_pro_event(subscription: dict) -> bool:
    if (subscription.get("metadata") or {}).get("kind") == "pro":
        return True
    sub_id = _id(subscription.get("id"))
    return bool(sub_id and await server.db.subscriptions.find_one({"stripe_subscription_id": sub_id}, {"_id": 1}))
async def checkout_completed(session: dict) -> None:
    meta = session.get("metadata") or {}
    user_id = meta.get("user_id") or session.get("client_reference_id")
    if meta.get("kind") != "pro" or session.get("mode") != "subscription" or not user_id or meta.get("plan") not in _PLANS:
        return
    if session.get("payment_status") not in {"paid", "no_payment_required"}:
        return
    amount, currency = _money(session.get("amount_total"), session.get("currency"))
    customer = _id(session.get("customer"))
    await _save(
        user_id, plan=meta["plan"], stripe_subscription_id=_id(session.get("subscription")),
        stripe_customer_id=customer, currency=currency, amount_cents=amount, cancel_at_period_end=False,
        status="trialing" if session.get("payment_status") == "no_payment_required" else "active",
    )
    if customer:
        await server.db.users.update_one({"id": user_id}, {"$set": {"stripe_customer_id": customer}})
async def subscription_changed(subscription: dict, *, deleted: bool) -> None:
    sub_id = _id(subscription.get("id"))
    row = await server.db.subscriptions.find_one({"stripe_subscription_id": sub_id}, {"_id": 0}) if sub_id else None
    user_id = (subscription.get("metadata") or {}).get("user_id") or (row or {}).get("user_id")
    if not user_id:
        return
    if deleted:
        await _save(user_id, status="canceled", stripe_subscription_id=sub_id, cancel_at_period_end=False)
        return
    items = ((subscription.get("items") or {}).get("data") or [])
    price = (items[0].get("price") if items else None) or {}
    amount, currency = _money(price.get("unit_amount"), price.get("currency") or subscription.get("currency"))
    await _save(
        user_id, plan=_plan_of(subscription, row), status=subscription.get("status") or "active",
        stripe_subscription_id=sub_id, stripe_customer_id=_id(subscription.get("customer")),
        currency=currency, amount_cents=amount, current_period_end=_period_end(subscription),
        cancel_at_period_end=bool(subscription.get("cancel_at_period_end")),
    )
def _invoice_subscription(invoice: dict) -> str | None:
    parent = (invoice.get("parent") or {}).get("subscription_details") or {}
    return _id(invoice.get("subscription")) or _id(parent.get("subscription"))
async def invoice_changed(invoice: dict, *, failed: bool) -> None:
    sub_id, customer = _invoice_subscription(invoice), _id(invoice.get("customer"))
    row = await server.db.subscriptions.find_one({"stripe_subscription_id": sub_id}, {"_id": 0}) if sub_id else None
    if row is None and customer:
        row = await server.db.subscriptions.find_one({"stripe_customer_id": customer}, {"_id": 0})
    user_id = (row or {}).get("user_id")
    if not user_id and customer:
        user_id = ((await server.db.users.find_one({"stripe_customer_id": customer}, {"id": 1})) or {}).get("id")
    if not user_id:
        return
    amount, currency = _money(invoice.get("amount_due") if failed else invoice.get("amount_paid"), invoice.get("currency"))
    await _save(
        user_id, stripe_subscription_id=sub_id, stripe_customer_id=customer, currency=currency,
        amount_cents=amount, **({"status": "past_due"} if failed else {}),
    )
def _ready() -> None:
    if not billing.secret_key():
        raise HTTPException(503, "Payments are not set up yet")
async def _customer_id(user: dict) -> str:
    stored = await server.db.users.find_one({"id": user["id"]}, {"_id": 0, "stripe_customer_id": 1, "email": 1, "full_name": 1}) or {}
    customer_id = stored.get("stripe_customer_id") or user.get("stripe_customer_id")
    if customer_id:
        return customer_id
    customer = await billing.create_customer({**user, **stored})
    await server.db.users.update_one({"id": user["id"]}, {"$set": {"stripe_customer_id": customer["id"]}})
    return customer["id"]
@router.post("/subscriptions/checkout")
async def start_checkout(body: CheckoutIn, user: dict = Depends(server.current_user)):
    _ready()
    price_id = billing.pro_price_id(body.plan)
    if not price_id:
        raise HTTPException(503, "Payments are not set up yet")
    await ratelimit.hit("checkout", user["id"])
    if await server.db.subscriptions.find_one(
        {"user_id": user["id"], "status": {"$in": _GRANTING}, "plan": {"$in": ["pro", *_PLANS]}}, {"_id": 1},
    ):
        raise HTTPException(409, "You already have Pro")
    back = f"{billing.app_url()}/settings"
    try:
        session = await billing.create_pro_checkout(
            customer_id=await _customer_id(user), user_id=user["id"], plan=body.plan, price_id=price_id,
            success_url=f"{back}?checkout=success", cancel_url=f"{back}?checkout=cancelled",
        )
    except billing.BillingError as exc:
        logger.warning("Pro checkout failed: %s", exc)
        raise HTTPException(502, "Could not open checkout. Try again in a moment.") from exc
    return {"url": session["url"]}
@router.post("/subscriptions/portal")
async def billing_portal(user: dict = Depends(server.current_user)):
    _ready()
    stored = await server.db.users.find_one({"id": user["id"]}, {"_id": 0, "stripe_customer_id": 1}) or {}
    customer_id = stored.get("stripe_customer_id") or user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(409, "No billing account yet")
    try:
        session = await billing.create_portal(customer_id=customer_id, return_url=f"{billing.app_url()}/settings")
    except billing.BillingError as exc:
        logger.warning("Billing portal failed: %s", exc)
        raise HTTPException(502, "Could not open the billing portal. Try again in a moment.") from exc
    return {"url": session["url"]}
@router.get("/subscriptions/plans", dependencies=[Depends(server.current_user)])
async def list_plans():
    """The two Pro Price objects, cached in this process for about an hour."""
    _ready()
    monthly, yearly = billing.pro_price_id("pro_monthly"), billing.pro_price_id("pro_yearly")
    if not monthly or not yearly:
        raise HTTPException(503, "Payments are not set up yet")
    key, now_ts = f"{monthly}|{yearly}", time.time()
    if _plans_cache["body"] is not None and _plans_cache["key"] == key and now_ts - _plans_cache["at"] < _CACHE_SECONDS:
        return _plans_cache["body"]
    try:
        plans = []
        for plan, price_id in (("pro_monthly", monthly), ("pro_yearly", yearly)):
            price = await billing.retrieve_price(price_id)
            amount, currency = _money(price.get("unit_amount"), price.get("currency"))
            plans.append({"plan": plan, "amount_cents": amount, "currency": currency, "interval": (price.get("recurring") or {}).get("interval")})
    except billing.BillingError as exc:
        logger.warning("Pro prices failed: %s", exc)
        raise HTTPException(502, "Could not load prices. Try again in a moment.") from exc
    body = {"plans": plans}
    _plans_cache.update(at=now_ts, key=key, body=body)
    return body
# server imports community, which imports this module, so the router is attached
# after it exists rather than from server.py.
server.api.include_router(router)
