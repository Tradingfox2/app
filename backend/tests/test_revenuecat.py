"""RevenueCat store billing. A bad header, a missing secret, and the client grant nothing."""
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import server  # noqa: E402
from tests.test_community_complete import expect  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402
from tests.test_pro_billing import _bind  # noqa: E402
import revenuecat  # noqa: E402

SECRET = "rc_test_secret"


class Request:
    def __init__(self, payload: dict, authorization: str | None):
        self.headers = {} if authorization is None else {"authorization": authorization}
        self._payload = json.dumps(payload).encode()

    async def body(self):
        return self._payload


def payload(kind: str = "INITIAL_PURCHASE", **fields: object) -> dict:
    event = {
        "id": "evt-1", "type": kind, "app_user_id": "member", "product_id": "pro_monthly",
        "entitlement_ids": ["pro"], "period_type": "NORMAL", "currency": "GBP",
        "price": 4.99, "price_in_purchased_currency": 9.99, "expiration_at_ms": 1_800_000_000_000,
    }
    event.update(fields)
    return {"api_version": "1.0", "event": event}


def test_a_bad_authorization_header_does_not_grant_pro(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        await db.users.insert_one(account("member"))
        monkeypatch.delenv("REVENUECAT_WEBHOOK_SECRET", raising=False)

        class Closed:
            headers = {"authorization": SECRET}

            async def body(self):
                raise AssertionError("body was read without a secret")

        await expect(503, revenuecat.revenuecat_webhook(Closed()))
        monkeypatch.setenv("REVENUECAT_WEBHOOK_SECRET", SECRET)
        await expect(401, revenuecat.revenuecat_webhook(Request(payload(), "nope")))
        await expect(401, revenuecat.revenuecat_webhook(Request(payload(), "")))
        assert await db.subscriptions.count_documents({}) == 0
        await expect(402, server.require_pro(account("member")))
    run_isolated(scenario)


def test_a_grant_stores_the_charged_currency_and_minor_units(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        monkeypatch.setenv("REVENUECAT_WEBHOOK_SECRET", SECRET)
        await db.users.insert_many([account("member"), account("yen"), account("blank"), account("other"), account("card")])
        await db.subscriptions.insert_one({
            "id": "stripe-row", "user_id": "card", "plan": "pro_monthly", "status": "active",
            "stripe_subscription_id": "sub_live", "currency": "usd", "amount_cents": 1200,
        })
        await revenuecat.revenuecat_webhook(Request(payload(), SECRET))
        await revenuecat.revenuecat_webhook(Request(payload(), SECRET))
        assert await db.subscriptions.count_documents({"user_id": "member"}) == 1
        assert await db.billing_events.count_documents({"id": "revenuecat:evt-1"}) == 1
        granted = await server.current_sub(account("member"))
        assert granted["provider"] == "revenuecat" and granted["plan"] == "pro_monthly"
        assert granted["status"] == "active" and granted["currency"] == "gbp" and granted["amount_cents"] == 999
        assert granted["current_period_end"].year == 2027
        assert (await server.require_pro(account("member")))["id"] == "member"
        await revenuecat.revenuecat_webhook(Request(payload(
            id="evt-jpy", app_user_id="yen", product_id="ironflow_annual", currency="JPY",
            price_in_purchased_currency=1500, price=10,
        ), SECRET))
        yen = await server.current_sub(account("yen"))
        assert yen["plan"] == "pro_yearly" and yen["currency"] == "jpy" and yen["amount_cents"] == 1500
        blank = payload(id="evt-blank", app_user_id="blank")
        del blank["event"]["currency"]
        await revenuecat.revenuecat_webhook(Request(blank, SECRET))
        missing = await db.subscriptions.find_one({"user_id": "blank"}, {"_id": 0})
        assert missing["provider"] == "revenuecat" and missing.get("currency") is None and missing.get("amount_cents") is None
        await revenuecat.revenuecat_webhook(Request(payload(id="evt-elite", app_user_id="other", entitlement_ids=["elite"]), SECRET))
        await revenuecat.revenuecat_webhook(Request(payload(id="evt-ghost", app_user_id="ghost"), SECRET))
        assert await db.subscriptions.count_documents({"user_id": {"$in": ["other", "ghost"]}}) == 0
        await revenuecat.revenuecat_webhook(Request(payload(id="evt-card", app_user_id="card", currency="GBP"), SECRET))
        card = await db.subscriptions.find_one({"user_id": "card"}, {"_id": 0})
        assert card["stripe_subscription_id"] == "sub_live" and card.get("provider") != "revenuecat"
        assert card["currency"] == "usd" and card["amount_cents"] == 1200
    run_isolated(scenario)


def test_a_cancellation_keeps_pro_until_expiration(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        monkeypatch.setenv("REVENUECAT_WEBHOOK_SECRET", SECRET)
        await db.users.insert_one(account("member"))
        await revenuecat.revenuecat_webhook(Request(payload(id="evt-buy"), SECRET))
        await revenuecat.revenuecat_webhook(Request(payload(
            "CANCELLATION", id="evt-cancel", currency=None, price_in_purchased_currency=None,
        ), SECRET))
        current = await server.current_sub(account("member"))
        assert current["status"] == "active" and current["cancel_at_period_end"] is True
        assert current["provider"] == "revenuecat" and current["currency"] == "gbp" and current["amount_cents"] == 999
        assert (await server.require_pro(account("member")))["id"] == "member"
        await revenuecat.revenuecat_webhook(Request(payload("EXPIRATION", id="evt-end"), SECRET))
        assert await server.current_sub(account("member")) == {"plan": "free", "status": "active"}
        await expect(402, server.require_pro(account("member")))
        stored = await db.subscriptions.find_one({"user_id": "member"}, {"_id": 0, "status": 1, "provider": 1})
        assert stored["status"] == "canceled" and stored["provider"] == "revenuecat"
    run_isolated(scenario)
