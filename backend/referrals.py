"""Referral commissions. A sign-up stores the link and pays nothing.

The first paid invoice (amount above zero) pays two levels and then stops:
20% to the direct referrer, 5% to that referrer's referrer. There is no
third level. Amounts stay in the invoice currency; nothing is converted,
and a missing amount is never stored as zero.

Athletes, and anyone who is not a connected partner, receive the reward as
Pro credit days (the same percent of the billed period). A connected partner
is an approved coach with payout_status "connected"; their row stays pending
cash. charge.refunded claws the whole commission back, including a partial
refund. Mongo is the writer.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

import accounting
import pro_billing
import server

router = APIRouter()
_RATES = {1: 20, 2: 5}
_CAP = 2000


def _connected_partner(user: dict) -> bool:
    """Approved coach with a connected payout account.

    Matches community._coach_is_approved, plus payout_status. That flag is
    not written anywhere yet, so athletes and unconnected coaches get days.
    """
    approved = user.get("role") == "coach" and user.get("coach_status", "approved") == "approved"
    return approved and user.get("payout_status") == "connected"


def _period_days(invoice: dict) -> int | None:
    lines = (invoice.get("lines") or {}).get("data") or []
    period = (lines[0].get("period") if lines else None) or {}
    start, end = period.get("start"), period.get("end")
    if type(start) not in (int, float) or type(end) not in (int, float):
        return None
    span = int(end) - int(start)
    if span <= 0:
        return None
    return max(1, span // 86400)


def _payment_intent(invoice: dict) -> str | None:
    direct = pro_billing._id(invoice.get("payment_intent"))
    if direct:
        return direct
    for item in (invoice.get("payments") or {}).get("data") or []:
        payment = item.get("payment") if isinstance(item, dict) else None
        found = pro_billing._id(payment.get("payment_intent")) if isinstance(payment, dict) else None
        if found:
            return found
    return None


async def _target(invoice: dict) -> tuple[str, str] | None:
    """Who paid, and whether the invoice is Pro or a paid community (club)."""
    sub_id = pro_billing._invoice_subscription(invoice)
    if not sub_id:
        return None
    member = await server.db.community_members.find_one(
        {"stripe_subscription_id": sub_id}, {"_id": 0, "user_id": 1})
    member_id = (member or {}).get("user_id")
    if isinstance(member_id, str):
        return "club", member_id
    row = await server.db.subscriptions.find_one(
        {"stripe_subscription_id": sub_id}, {"_id": 0, "user_id": 1})
    row_id = (row or {}).get("user_id")
    if isinstance(row_id, str):
        return "pro", row_id
    return None


async def _upline(payer_id: str) -> list[tuple[int, dict]]:
    payer = await server.db.users.find_one({"id": payer_id}, {"_id": 0, "referred_by": 1})
    first_id = (payer or {}).get("referred_by")
    if not isinstance(first_id, str) or not first_id or first_id == payer_id:
        return []
    first = await server.db.users.find_one({"id": first_id}, {"_id": 0})
    if not first:
        return []
    found: list[tuple[int, dict]] = [(1, first)]
    second_id = first.get("referred_by")
    if isinstance(second_id, str) and second_id not in {payer_id, first_id}:
        second = await server.db.users.find_one({"id": second_id}, {"_id": 0})
        if second:
            found.append((2, second))
    return found


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _extend_credit(user_id: str, days: int) -> None:
    if days <= 0:
        return
    row = await server.db.users.find_one({"id": user_id}, {"_id": 0, "pro_credit_until": 1})
    base = server.now()
    current = (row or {}).get("pro_credit_until")
    if isinstance(current, datetime) and _aware(current) > base:
        base = _aware(current)
    await server.db.users.update_one(
        {"id": user_id}, {"$set": {"pro_credit_until": base + timedelta(days=days)}})


async def _retract_credit(user_id: str, days: int) -> None:
    if days <= 0:
        return
    row = await server.db.users.find_one({"id": user_id}, {"_id": 0, "pro_credit_until": 1})
    current = (row or {}).get("pro_credit_until")
    if not isinstance(current, datetime):
        return
    await server.db.users.update_one(
        {"id": user_id}, {"$set": {"pro_credit_until": _aware(current) - timedelta(days=days)}})


async def _first_invoice(payer_id: str, invoice_id: str) -> bool:
    """True for the payer's first paid invoice, including a retry of that same invoice."""
    claimed = await server.db.users.update_one(
        {"id": payer_id, "referral_settled_invoice": {"$exists": False}},
        {"$set": {"referral_settled_invoice": invoice_id}},
    )
    if claimed.modified_count == 1:
        return True
    row = await server.db.users.find_one({"id": payer_id}, {"_id": 0, "referral_settled_invoice": 1})
    return (row or {}).get("referral_settled_invoice") == invoice_id


async def invoice_paid(invoice: dict) -> None:
    """Settle the payer's first paid invoice. Later invoices do not pay again."""
    amount, currency = pro_billing._money(invoice.get("amount_paid"), invoice.get("currency"))
    invoice_id = invoice.get("id") if isinstance(invoice.get("id"), str) else None
    if amount is None or amount <= 0 or not currency or not invoice_id:
        return
    target = await _target(invoice)
    if not target:
        return
    kind, payer_id = target
    upline = await _upline(payer_id)
    if not upline or not await _first_invoice(payer_id, invoice_id):
        return
    days = _period_days(invoice)
    charge_id, intent = pro_billing._id(invoice.get("charge")), _payment_intent(invoice)
    for level, beneficiary in upline:
        cents = amount * _RATES[level] // 100
        if cents <= 0:
            continue
        if await server.db.commissions.find_one(
            {"source_user_id": payer_id, "level": level}, {"_id": 1},
        ):
            continue
        cash = _connected_partner(beneficiary)
        credit = None if days is None else _RATES[level] * days // 100
        doc = {
            "id": server.new_id(),
            "beneficiary_id": beneficiary["id"],
            "source_user_id": payer_id,
            "level": level,
            "kind": kind,
            "amount_cents": cents,
            "currency": currency,
            "status": "pending" if cash else "paid",
            "invoice_id": invoice_id,
            "reward": "cash" if cash else "pro_credit_days",
            "created_at": server.now(),
        }
        if charge_id:
            doc["charge_id"] = charge_id
        if intent:
            doc["payment_intent"] = intent
        if not cash:
            doc["paid_at"] = doc["created_at"]
            if credit is not None:
                doc["credit_days"] = credit
        try:
            await server.db.commissions.insert_one(doc)
        except DuplicateKeyError:
            continue
        if not cash and credit:
            await _extend_credit(beneficiary["id"], credit)


async def charge_refunded(charge: dict) -> None:
    """Claw back every open commission tied to this charge. Partial refunds included."""
    keys = [
        value for value in (
            pro_billing._id(charge.get("id")),
            pro_billing._id(charge.get("invoice")),
            pro_billing._id(charge.get("payment_intent")),
        ) if value
    ]
    if not keys:
        return
    rows = await server.db.commissions.find({
        "status": {"$in": ["pending", "paid"]},
        "$or": [
            {"invoice_id": {"$in": keys}},
            {"charge_id": {"$in": keys}},
            {"payment_intent": {"$in": keys}},
        ],
    }).to_list(50)
    for row in rows:
        updated = await server.db.commissions.update_one(
            {"id": row["id"], "status": {"$in": ["pending", "paid"]}},
            {"$set": {"status": "clawed_back", "clawed_back_at": server.now()}},
        )
        if updated.modified_count == 1 and row.get("reward") == "pro_credit_days":
            days = row.get("credit_days")
            if type(days) is int:
                await _retract_credit(row["beneficiary_id"], days)


async def _ensure_code(user_id: str) -> str:
    row = await server.db.referrals.find_one({"referrer_id": user_id}, {"_id": 0, "code": 1})
    if isinstance((row or {}).get("code"), str):
        return row["code"]
    # Same shape as the previous code row, so the staff report still ignores a
    # zero placeholder. The mine response does not return that placeholder.
    code = secrets.token_urlsafe(6).upper()
    await server.db.referrals.insert_one({
        "id": server.new_id(),
        "referrer_id": user_id,
        "referred_id": None,
        "code": code,
        "status": "pending",
        "reward_amount_cents": 0,
        "reward_currency": "EUR",
        "created_at": server.now(),
    })
    return code


async def _sum(user_id: str, status: str) -> dict:
    rows = await server.db.commissions.find(
        {"beneficiary_id": user_id, "status": status},
        {"_id": 0, "amount_cents": 1, "currency": 1},
    ).limit(_CAP + 1).to_list(_CAP + 1)
    if len(rows) > _CAP:
        return {"state": "unavailable"}
    return accounting._totals(rows, lambda row: accounting._positive(row, "amount_cents"))


@router.get("/referrals/mine")
async def mine(user: dict = Depends(server.current_user)):
    """Code, headcount, and pending/paid totals kept in each stored currency."""
    user_id = user["id"]
    converted = await server.db.commissions.distinct(
        "source_user_id",
        {"beneficiary_id": user_id, "status": {"$in": ["pending", "paid"]}},
    )
    return {
        "code": await _ensure_code(user_id),
        "counts": {
            "referred": await server.db.users.count_documents({"referred_by": user_id}),
            "converted": len(converted),
        },
        "pending": await _sum(user_id, "pending"),
        "paid": await _sum(user_id, "paid"),
    }


# community imports this module while server is still loading, same as pro_billing.
server.api.include_router(router)
