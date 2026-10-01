"""Gym partners: stored every-10 rewards, owner redeem, staff badge, partner Checkout."""
import asyncio
import os
import uuid
from datetime import timedelta
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient
import pytest
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "gyms-test-secret-0123456789abcdef")
os.environ.setdefault("PUSH_ENABLED", "off")
import billing  # noqa: E402
import notifications  # noqa: E402
import server  # noqa: E402
from routers import admin, community, gyms  # noqa: E402
from tests.test_community_billing import SECRET, signed  # noqa: E402
KEYS = {"visit", "gym", "total_visits", "reward_unlocked", "visits_until_reward"}

def run(scenario):
    async def _run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000)
        database = client[f"ironflow_gyms_{uuid.uuid4().hex}"]
        try:
            await scenario(database)
        finally:
            await client.drop_database(database.name)
            client.close()
    asyncio.run(_run())

def bind(monkeypatch, database):
    for module in (server, gyms, notifications, admin, community):
        monkeypatch.setattr(module, "db", database)
    monkeypatch.setattr(notifications, "_push", lambda *_args, **_kwargs: None)

async def expect(status, awaitable):
    with pytest.raises(HTTPException) as caught:
        await awaitable
    assert caught.value.status_code == status

def account(uid, **extra):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete", **extra}

def auth(uid):
    return {"Authorization": f"Bearer {server.make_token(uid)}"}

async def insert_gym(database, gid, owner, status="active"):
    await database.gyms.insert_one({
        "id": gid, "name": gid, "city": "Paris", "reward_every": 10,
        "qr_payload": f"IRONFLOW-GYM:{gid}", "owner_user_id": owner, "partner_status": status,
        "plan": "partner" if status == "active" else "free",
        "reward": {"title": "Free session", "kind": "free_session", "note": "Desk"},
        "created_at": server.now(),
    })

async def visit(client, uid, gid, n=1):
    body = None
    for _ in range(n):
        response = await client.post("/api/gyms/checkin", headers=auth(uid), json={"qr_payload": f"IRONFLOW-GYM:{gid}"})
        assert response.status_code == 201, response.text
        body = response.json()
    return body

def test_active_partner_issues_on_the_tenth_visit_and_only_the_owner_redeems(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_many([account("ath"), account("own"), account("stranger")])
        await insert_gym(database, "gym-1", "own")
        await gyms.ensure_indexes(database)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            early = await visit(client, "ath", "gym-1", 9)
            assert early["reward_unlocked"] is False and set(early) == KEYS
            tenth = await visit(client, "ath", "gym-1")
            reward, code = tenth["reward"], tenth["reward"]["code"]
            assert tenth["reward_unlocked"] is True and reward["status"] == "issued"
            assert reward["user_id"] == "ath" and reward["gym_id"] == "gym-1" and reward["expires_at"]
            assert await database.rewards.count_documents({}) == 1
            note = await database.notifications.find_one({"type": "gym_reward"})
            assert note["user_id"] == "ath" and note["title"] == "Free session" and note["body"] == code
            assert [row["code"] for row in (await client.get("/api/gyms/rewards", headers=auth("ath"))).json()] == [code]
            assert "owner_user_id" not in (await client.get("/api/gyms")).json()[0]
            assert (await client.post("/api/gyms/gym-1/redeem", headers=auth("stranger"), json={"code": code})).status_code == 403
            assert (await client.post("/api/gyms/missing/redeem", headers=auth("own"), json={"code": code})).status_code == 404
            assert (await client.post("/api/gyms/gym-1/redeem", headers=auth("own"), json={"code": "NOPE"})).status_code == 404
            ok = await client.post("/api/gyms/gym-1/redeem", headers=auth("own"), json={"code": code.lower()})
            assert ok.status_code == 200 and ok.json()["status"] == "redeemed"
            assert (await client.post("/api/gyms/gym-1/redeem", headers=auth("own"), json={"code": code})).status_code == 409
            assert (await client.get("/api/gyms/rewards", headers=auth("ath"))).json() == []
            mine = (await client.get("/api/gyms/mine", headers=auth("own"))).json()[0]
            assert (mine["members_today"], mine["visits_week"], mine["plan"]) == (1, 10, "partner")
            assert (await client.post("/api/gyms/checkin", headers=auth("ath"), json={"qr_payload": "FOO"})).status_code == 422
            assert (await client.get("/api/gyms/visits", headers=auth("ath"))).json()[0]["gym_name"] == "gym-1"
    run(scenario)

def test_pending_paused_legacy_and_expired_codes_and_the_staff_badge(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        support = account("support", staff_role="support")
        await database.users.insert_many([account("ath"), account("own"), support])
        await insert_gym(database, "pending", "own", "pending")
        await insert_gym(database, "paused", "own", "paused")
        await database.gyms.insert_one({
            "id": "legacy", "name": "Legacy", "city": "Lyon", "reward_every": 10,
            "qr_payload": "IRONFLOW-GYM:legacy", "created_at": server.now(),
        })
        await insert_gym(database, "gym-1", "own")
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for gid in ("pending", "paused", "legacy"):
                body = await visit(client, "ath", gid, 10)
                assert body["reward_unlocked"] is True and set(body) == KEYS
            assert await database.rewards.count_documents({}) == 0
            code = (await visit(client, "ath", "gym-1", 10))["reward"]["code"]
            await database.rewards.update_one({"code": code}, {"$set": {"expires_at": server.now() - timedelta(minutes=1)}})
            denied = await client.post("/api/gyms/gym-1/redeem", headers=auth("own"), json={"code": code})
            assert denied.status_code == 409
            assert (await database.rewards.find_one({"code": code}))["status"] == "expired"
        flags = {row["id"]: row["gym_owner"] for row in (await admin.list_users(None, "all", 25, support))["users"]}
        assert flags == {"ath": False, "own": True, "support": False}
    run(scenario)

def gym_paid(currency="jpy", amount=1500, event_id="evt-gym"):
    return {"id": event_id, "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_gym", "mode": "subscription", "payment_status": "paid",
        "subscription": "sub_gym", "customer": "cus_gym", "amount_total": amount, "currency": currency,
        "metadata": {"kind": "gym_partner", "gym_id": "gym-1", "user_id": "own"}}}}

def test_partner_checkout_uses_the_env_price_and_refuses_without_stripe(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        await database.users.insert_many([account("own"), account("stranger")])
        await insert_gym(database, "gym-1", "own", "pending")
        monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.test")
        monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.post("/api/gyms/gym-1/subscribe", headers=auth("own"))).status_code == 503
            monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
            monkeypatch.delenv("STRIPE_PRICE_GYM_PARTNER", raising=False)
            assert (await client.post("/api/gyms/gym-1/subscribe", headers=auth("own"))).status_code == 503
            monkeypatch.setenv("STRIPE_PRICE_GYM_PARTNER", "price_gym_partner")
            assert (await client.post("/api/gyms/gym-1/subscribe", headers=auth("stranger"))).status_code == 403
            assert (await client.post("/api/gyms/missing/subscribe", headers=auth("own"))).status_code == 404
            calls = []

            async def fake_call(method, path, data=None, idempotency_key=None):
                calls.append(data)
                return {"id": "cs_gym", "url": "https://checkout.stripe.com/c/pay"}

            monkeypatch.setattr(billing, "_call", fake_call)
            opened = await client.post("/api/gyms/gym-1/subscribe", headers=auth("own"))
            assert opened.status_code == 200 and opened.json() == {"url": "https://checkout.stripe.com/c/pay"}
            sent = calls[0]
            assert sent["mode"] == "subscription" and sent["line_items[0][price]"] == "price_gym_partner"
            assert sent["metadata[kind]"] == "gym_partner" and sent["customer_email"] == "own@example.invalid"
            assert "customer" not in sent and not any("price_data" in key or "currency" in key for key in sent)
            assert sent["success_url"] == "https://app.example.test/gym/manage?checkout=success"
            gym = await database.gyms.find_one({"id": "gym-1"})
            assert gym["plan"] == "free" and "billing" not in gym

            async def down(*_args, **_kwargs):
                raise billing.BillingError("down")

            monkeypatch.setattr(billing, "_call", down)
            assert (await client.post("/api/gyms/gym-1/subscribe", headers=auth("own"))).status_code == 502
            await database.gyms.update_one({"id": "gym-1"}, {"$set": {"plan": "partner"}})
            assert (await client.post("/api/gyms/gym-1/subscribe", headers=auth("own"))).status_code == 409
    run(scenario)

def test_signed_payment_opens_the_club_and_a_downgrade_pauses_rewards(monkeypatch):
    async def scenario(database):
        bind(monkeypatch, database)
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
        await database.users.insert_many([account("own"), account("ath"), account("member")])
        await insert_gym(database, "gym-1", "own", "pending")
        await database.gyms.update_one({"id": "gym-1"}, {"$set": {"name": "IronFlow Bastille"}})
        await database.subscriptions.insert_one({
            "id": "sub-row", "user_id": "member", "plan": "pro_monthly", "status": "active",
            "stripe_subscription_id": "sub_pro", "stripe_customer_id": "cus_pro",
            "amount_cents": 900, "currency": "eur",
        })
        await expect(400, community.stripe_webhook(signed(gym_paid(), secret="whsec_attacker")))
        unchanged = await database.gyms.find_one({"id": "gym-1"})
        assert unchanged["plan"] == "free" and "billing" not in unchanged

        await community.stripe_webhook(signed(gym_paid()))
        await community.stripe_webhook(signed(gym_paid()))
        gym = await database.gyms.find_one({"id": "gym-1"}, {"_id": 0})
        assert gym["plan"] == "partner" and gym["partner_status"] == "active"
        assert gym["billing"]["amount_cents"] == 1500 and gym["billing"]["currency"] == "jpy"
        clubs = [row async for row in database.communities.find({"gym_id": "gym-1"})]
        assert len(clubs) == 1 and clubs[0]["category"] == "gym" and clubs[0]["owner_id"] == "own"
        assert gym["community_id"] == clubs[0]["id"]
        owner = await database.community_members.find_one({"community_id": clubs[0]["id"], "user_id": "own"})
        assert owner["role"] == "owner" and owner["entitlement_source"] == "ownership"
        channel = await database.channels.find_one({"community_id": clubs[0]["id"]})
        assert channel["name"] == "general" and channel["is_default"] is True

        await community.stripe_webhook(signed({"id": "evt-inv", "type": "invoice.paid", "data": {"object": {
            "subscription": "sub_gym", "customer": "cus_pro", "amount_paid": 1500, "currency": "jpy"}}}))
        pro = await database.subscriptions.find_one({"user_id": "member"})
        assert pro["stripe_subscription_id"] == "sub_pro" and pro["amount_cents"] == 900 and pro["currency"] == "eur"
        await community.stripe_webhook(signed({"id": "evt-due", "type": "customer.subscription.updated", "data": {"object": {
            "id": "sub_gym", "status": "past_due", "metadata": {"kind": "gym_partner", "gym_id": "gym-1"}}}}))
        assert (await database.gyms.find_one({"id": "gym-1"}))["plan"] == "partner"

        transport = ASGITransport(app=server.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            listed = (await client.get("/api/gyms")).json()[0]
            assert "billing" not in listed and "owner_user_id" not in listed
            early = await visit(client, "ath", "gym-1")
            assert "billing" not in early["gym"]
            await community.stripe_webhook(signed({"id": "evt-del", "type": "customer.subscription.deleted", "data": {"object": {
                "id": "sub_gym", "status": "canceled", "metadata": {"kind": "gym_partner", "gym_id": "gym-1"}}}}))
            paused = await database.gyms.find_one({"id": "gym-1"})
            assert paused["plan"] == "free" and paused["partner_status"] == "paused"
            assert paused["community_id"] == clubs[0]["id"]
            assert await database.communities.count_documents({"id": clubs[0]["id"], "status": "active"}) == 1
            tenth = await visit(client, "ath", "gym-1", 9)
            assert tenth["reward_unlocked"] is True and "reward" not in tenth
            assert await database.rewards.count_documents({}) == 0
            await community.stripe_webhook(signed({"id": "evt-back", "type": "customer.subscription.updated", "data": {"object": {
                "id": "sub_gym", "status": "active", "currency": "gbp",
                "metadata": {"kind": "gym_partner", "gym_id": "gym-1"},
                "items": {"data": [{"price": {"unit_amount": 2500, "currency": "gbp"}}]}}}}))
            restored = await database.gyms.find_one({"id": "gym-1"})
            assert restored["plan"] == "partner" and restored["partner_status"] == "active"
            assert restored["billing"]["amount_cents"] == 2500 and restored["billing"]["currency"] == "gbp"
            assert restored["community_id"] == clubs[0]["id"]
            reward = await visit(client, "ath", "gym-1", 10)
            assert reward["reward"]["status"] == "issued"
    run(scenario)
