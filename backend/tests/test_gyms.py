"""Gym partners: stored every-10 rewards, owner redeem, staff badge."""
import asyncio
import os
import uuid
from datetime import timedelta
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("JWT_SECRET", "gyms-test-secret-0123456789abcdef")
os.environ.setdefault("PUSH_ENABLED", "off")
import notifications  # noqa: E402
import server  # noqa: E402
from routers import admin, gyms  # noqa: E402
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
    for module in (server, gyms, notifications, admin):
        monkeypatch.setattr(module, "db", database)
    monkeypatch.setattr(notifications, "_push", lambda *_args, **_kwargs: None)

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
