"""Gym QR check-ins and partner rewards.
Moved from wearables.py: ensure_gyms, list_gyms, gym_checkin, my_visits.
Paths, status codes and the original response keys stay the same. An every-10
unlock writes `rewards` only when partner_status is active. The partner plan
is set by the signed billing webhook, never by the success URL.
"""
import logging
import secrets
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
import billing
import notifications
import pro_billing
import ratelimit
import server
from routers.wearables import is_demo_user
from server import clean, current_user, db, new_id, now, optional_user
logger = logging.getLogger(__name__)
router = APIRouter()
REWARD_KINDS = ("free_session", "discount", "merch", "custom")
REWARD_TTL = timedelta(days=30)
SEED_GYMS = [
    {"name": "IronFlow Bastille", "city": "Paris", "reward_every": 10},
    {"name": "IronFlow Part-Dieu", "city": "Lyon", "reward_every": 10},
    {"name": "IronFlow Vieux-Port", "city": "Marseille", "reward_every": 10},
]

async def ensure_indexes(database) -> None:
    await database.rewards.create_index("code", unique=True)
    await database.rewards.create_index([("user_id", 1), ("gym_id", 1), ("visit_number", 1)], unique=True)
    await database.rewards.create_index([("user_id", 1), ("status", 1)])
    await database.gym_visits.create_index([("gym_id", 1), ("checked_in_at", -1)])
    await database.gyms.create_index("owner_user_id")
    await database.gyms.create_index(
        "billing.stripe_subscription_id", unique=True,
        partialFilterExpression={"billing.stripe_subscription_id": {"$type": "string"}},
    )

async def ensure_gyms(user: Optional[dict] = None):
    """Seed demo gyms only when the test account asks, and only if none exist."""
    if user is None or not is_demo_user(user):
        return
    if await db.gyms.count_documents({}) == 0:
        for g in SEED_GYMS:
            gid = new_id()
            await db.gyms.insert_one({"id": gid, **g, "qr_payload": f"IRONFLOW-GYM:{gid}", "created_at": now()})

class CheckinIn(BaseModel):
    qr_payload: str
    workout_id: Optional[str] = None

class RedeemIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)

async def _issue_reward(user: dict, gym: dict, visit_number: int) -> dict | None:
    if gym.get("partner_status") != "active":
        return None
    template = gym.get("reward") or {}
    kind = template.get("kind") if template.get("kind") in REWARD_KINDS else "custom"
    title = (template.get("title") or "Partner reward").strip() or "Partner reward"
    expires_at = now() + REWARD_TTL
    for _ in range(4):
        doc = {
            "id": new_id(), "user_id": user["id"], "gym_id": gym["id"],
            "code": secrets.token_hex(4).upper(), "status": "issued", "expires_at": expires_at,
            "title": title, "kind": kind, "note": template.get("note") or "",
            "visit_number": visit_number, "created_at": now(),
        }
        try:
            await db.rewards.insert_one(dict(doc))
        except DuplicateKeyError:
            existing = await db.rewards.find_one(
                {"user_id": user["id"], "gym_id": gym["id"], "visit_number": visit_number}, {"_id": 0},
            )
            if existing:
                return existing
            continue
        await notifications.create(
            user["id"], notifications.GYM_REWARD, title, body=doc["code"],
            metadata={"gym_id": gym["id"], "reward_id": doc["id"]},
        )
        return doc
    return None

async def _expire_issued(query: dict) -> None:
    await db.rewards.update_many(
        {**query, "status": "issued", "expires_at": {"$lte": now()}}, {"$set": {"status": "expired"}},
    )

@router.get("/gyms")
async def list_gyms(user: Optional[dict] = Depends(optional_user)):
    # Public list (QR flows); demo gyms are only seeded for the test account.
    await ensure_gyms(user)
    return [clean(g) async for g in db.gyms.find({}, {"_id": 0, "owner_user_id": 0, "billing": 0}).sort("name", 1)]

@router.post("/gyms/checkin", status_code=201)
async def gym_checkin(body: CheckinIn, user: dict = Depends(current_user)):
    await ensure_gyms(user)
    payload = body.qr_payload.strip()
    if not payload.upper().startswith("IRONFLOW-GYM:"):
        raise HTTPException(422, "QR code non reconnu")
    gym_id = payload.split(":", 1)[1]
    gym = await db.gyms.find_one({"id": gym_id}, {"_id": 0})
    if not gym:
        raise HTTPException(404, "Salle inconnue")
    if body.workout_id:
        w = await db.workouts.find_one({"id": body.workout_id, "user_id": user["id"]})
        if not w:
            raise HTTPException(404, "Workout not found")
        await db.workouts.update_one({"id": body.workout_id}, {"$set": {"gym_id": gym_id}})
    visit = {
        "id": new_id(), "user_id": user["id"], "gym_id": gym_id,
        "workout_id": body.workout_id, "checked_in_at": now(),
    }
    await db.gym_visits.insert_one(dict(visit))
    total = await db.gym_visits.count_documents({"user_id": user["id"], "gym_id": gym_id})
    reward_every = gym.get("reward_every", 10)
    unlocked = total % reward_every == 0
    issued = await _issue_reward(user, gym, total) if unlocked else None
    public = {key: value for key, value in gym.items() if key not in {"owner_user_id", "billing"}}
    result = {
        "visit": clean(visit), "gym": clean(public), "total_visits": total,
        "reward_unlocked": unlocked,
        "visits_until_reward": (reward_every - total % reward_every) % reward_every,
    }
    if issued:
        result["reward"] = clean(issued)
    return result

@router.get("/gyms/visits")
async def my_visits(user: dict = Depends(current_user)):
    visits = [
        clean(v) async for v in db.gym_visits.find({"user_id": user["id"]}, {"_id": 0}).sort("checked_in_at", -1).limit(50)
    ]
    gyms = {g["id"]: g async for g in db.gyms.find({}, {"_id": 0})}
    for v in visits:
        g = gyms.get(v["gym_id"])
        v["gym_name"] = g["name"] if g else "?"
    return visits

@router.get("/gyms/rewards")
async def my_rewards(user: dict = Depends(current_user)):
    await _expire_issued({"user_id": user["id"]})
    rows = [
        clean(row) async for row in db.rewards.find(
            {"user_id": user["id"], "status": "issued"}, {"_id": 0},
        ).sort("created_at", -1).limit(20)
    ]
    names = {g["id"]: g.get("name") async for g in db.gyms.find({}, {"_id": 0, "id": 1, "name": 1})}
    for row in rows:
        row["gym_name"] = names.get(row["gym_id"]) or "?"
    return rows

@router.get("/gyms/mine")
async def my_gyms(user: dict = Depends(current_user)):
    gyms = [clean(g) async for g in db.gyms.find({"owner_user_id": user["id"]}, {"_id": 0}).sort("name", 1)]
    start, week = now().replace(hour=0, minute=0, second=0, microsecond=0), now() - timedelta(days=7)
    for gym in gyms:
        gym.pop("billing", None)
        gym.setdefault("partner_status", "pending")
        gym.setdefault("plan", "free")
        gym.setdefault("reward", None)
        today = await db.gym_visits.distinct("user_id", {"gym_id": gym["id"], "checked_in_at": {"$gte": start}})
        gym["members_today"] = len(today)
        gym["visits_week"] = await db.gym_visits.count_documents({"gym_id": gym["id"], "checked_in_at": {"$gte": week}})
    return gyms

@router.post("/gyms/{gym_id}/redeem")
async def redeem_reward(gym_id: str, body: RedeemIn, user: dict = Depends(current_user)):
    gym = await db.gyms.find_one({"id": gym_id}, {"_id": 0, "owner_user_id": 1})
    if not gym:
        raise HTTPException(404, "Gym not found")
    if gym.get("owner_user_id") != user["id"]:
        raise HTTPException(403, "Only the gym owner can redeem")
    await ratelimit.hit("gym_redeem", user["id"])
    code = body.code.strip().upper()
    if not code:
        raise HTTPException(422, "Code not found")
    await _expire_issued({"gym_id": gym_id, "code": code})
    updated = await db.rewards.find_one_and_update(
        {"gym_id": gym_id, "code": code, "status": "issued", "expires_at": {"$gt": now()}},
        {"$set": {"status": "redeemed", "redeemed_at": now(), "redeemed_by": user["id"]}},
        return_document=ReturnDocument.AFTER,
    )
    if updated:
        return clean(updated)
    row = await db.rewards.find_one({"gym_id": gym_id, "code": code}, {"_id": 0, "status": 1})
    if not row:
        raise HTTPException(404, "Code not found")
    if row.get("status") == "redeemed":
        raise HTTPException(409, "Already redeemed")
    raise HTTPException(409, "Code expired")

@router.post("/gyms/{gym_id}/subscribe")
async def subscribe_gym(gym_id: str, user: dict = Depends(current_user)):
    """Open Stripe Checkout for the partner plan. The webhook is what grants it."""
    gym = await db.gyms.find_one({"id": gym_id}, {"_id": 0})
    if not gym:
        raise HTTPException(404, "Gym not found")
    if gym.get("owner_user_id") != user["id"]:
        raise HTTPException(403, "Only the gym owner can subscribe")
    if not billing.secret_key() or not billing.gym_partner_price_id():
        raise HTTPException(503, "Payments are not set up yet")
    if gym.get("plan") == "partner":
        raise HTTPException(409, "This gym is already a partner")
    await ratelimit.hit("checkout", user["id"])
    back = f"{billing.app_url()}/gym/manage"
    try:
        session = await billing.create_gym_checkout(
            gym=gym, user=user, price_id=billing.gym_partner_price_id(),
            success_url=f"{back}?checkout=success", cancel_url=f"{back}?checkout=cancelled",
        )
    except billing.BillingError as exc:
        logger.warning("Gym checkout failed: %s", exc)
        raise HTTPException(502, "Could not open checkout. Try again in a moment.") from exc
    return {"url": session["url"]}

_PAUSE_STATUSES = frozenset({"canceled", "unpaid", "incomplete_expired"})

def _event_subscription(kind: str | None, obj: dict) -> str | None:
    if kind in {"invoice.paid", "invoice.payment_failed"}:
        return pro_billing._invoice_subscription(obj)
    if kind in {"customer.subscription.updated", "customer.subscription.deleted"}:
        return pro_billing._id(obj.get("id"))
    return pro_billing._id(obj.get("subscription"))

async def is_partner_event(kind: str | None, obj: dict) -> bool:
    if (obj.get("metadata") or {}).get("kind") == "gym_partner":
        return True
    sub_id = _event_subscription(kind, obj)
    if not sub_id:
        return False
    # `server.db` at call time: community and Pro tests patch that name, and the
    # import-time `db` binding is a different Motor client.
    return bool(await server.db.gyms.find_one({"billing.stripe_subscription_id": sub_id}, {"_id": 1}))

async def _partner_gym(kind: str | None, obj: dict) -> dict | None:
    gym_id = (obj.get("metadata") or {}).get("gym_id")
    if isinstance(gym_id, str) and gym_id:
        gym = await server.db.gyms.find_one({"id": gym_id}, {"_id": 0})
        if gym:
            return gym
    sub_id = _event_subscription(kind, obj)
    return await server.db.gyms.find_one({"billing.stripe_subscription_id": sub_id}, {"_id": 0}) if sub_id else None

def _money_fields(amount: object, currency: object, prefix: str = "") -> dict:
    cents, code = pro_billing._money(amount, currency)
    fields: dict = {}
    if isinstance(cents, int):
        fields[f"{prefix}amount_cents"] = cents
    if code:
        fields[f"{prefix}currency"] = code
    return fields

async def _write_gym(gym_id: str, fields: dict) -> dict | None:
    return await server.db.gyms.find_one_and_update(
        {"id": gym_id}, {"$set": fields}, projection={"_id": 0}, return_document=ReturnDocument.AFTER,
    )

async def partner_billing_event(kind: str | None, obj: dict) -> dict | None:
    """Apply one signed gym event. Amounts stay Stripe's minor unit and currency."""
    gym = await _partner_gym(kind, obj)
    if not gym:
        return None
    if kind == "checkout.session.completed":
        if obj.get("mode") != "subscription" or obj.get("payment_status") not in {"paid", "no_payment_required"}:
            return None
        recorded = {
            "stripe_subscription_id": pro_billing._id(obj.get("subscription")),
            "stripe_customer_id": pro_billing._id(obj.get("customer")),
            "status": "trialing" if obj.get("payment_status") == "no_payment_required" else "active",
            **_money_fields(obj.get("amount_total"), obj.get("currency")),
        }
        return await _write_gym(gym["id"], {
            "plan": "partner", "partner_status": "active",
            "billing": {key: value for key, value in recorded.items() if value is not None},
        })
    if kind in {"invoice.paid", "invoice.payment_failed"}:
        paid = obj.get("amount_due") if kind == "invoice.payment_failed" else obj.get("amount_paid")
        fields = _money_fields(paid, obj.get("currency"), "billing.")
        return await _write_gym(gym["id"], fields) if fields else gym
    if kind not in {"customer.subscription.updated", "customer.subscription.deleted"}:
        return None
    status = "canceled" if kind == "customer.subscription.deleted" else (obj.get("status") or "")
    if status == "past_due":
        return None
    items = ((obj.get("items") or {}).get("data") or [])
    price = (items[0].get("price") if items else None) or {}
    common: dict = {**_money_fields(price.get("unit_amount"), price.get("currency") or obj.get("currency"), "billing.")}
    sub_id, customer = pro_billing._id(obj.get("id")), pro_billing._id(obj.get("customer"))
    if sub_id:
        common["billing.stripe_subscription_id"] = sub_id
    if customer:
        common["billing.stripe_customer_id"] = customer
    if status in _PAUSE_STATUSES:
        return await _write_gym(gym["id"], {"plan": "free", "partner_status": "paused", "billing.status": status, **common})
    if status in {"active", "trialing"}:
        return await _write_gym(gym["id"], {"plan": "partner", "partner_status": "active", "billing.status": status, **common})
    return None
