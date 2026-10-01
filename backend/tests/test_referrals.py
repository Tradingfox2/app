"""Referral ledger: the code is stored at signup, and only the first paid invoice pays."""
import inspect
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import referrals  # noqa: E402
import server  # noqa: E402
from routers import community  # noqa: E402
from tests.test_community_billing import SECRET, signed  # noqa: E402
from tests.test_community_complete import expect  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402
from tests.test_pro_billing import _bind  # noqa: E402

DAY = 86400
START = 1_700_000_000


def _period():
    return {"lines": {"data": [{"period": {"start": START, "end": START + 30 * DAY}}]}}


def _event(event_id, kind, obj):
    return {"id": event_id, "type": kind, "data": {"object": obj}}


def test_signup_stores_a_referrer_and_pays_nothing(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        await db.users.insert_one(account("coach"))
        code = (await referrals.mine(account("coach")))["code"]
        await server.register(server.RegisterIn(
            email="new.user@example.com", password="password1", referral_code=code.lower()))
        stored = await db.users.find_one({"email": "new.user@example.com"})
        assert stored["referred_by"] == "coach"
        assert await db.commissions.count_documents({}) == 0
        await server.register(server.RegisterIn(email="plain.user@example.com", password="password1"))
        assert "referred_by" not in await db.users.find_one({"email": "plain.user@example.com"})
        await server.register(server.RegisterIn(
            email="typo.user@example.com", password="password1", referral_code="no-such-code"))
        assert "referred_by" not in await db.users.find_one({"email": "typo.user@example.com"})
        empty = await referrals.mine(account("coach"))
        assert empty["counts"] == {"referred": 1, "converted": 0}
        assert empty["pending"] == {"state": "none_in_period"}
        assert empty["paid"] == {"state": "none_in_period"}
        assert "reward_currency" not in empty and "amount_cents" not in empty
    run_isolated(scenario)


def test_first_paid_invoice_pays_two_levels_and_a_refund_claws_them_back(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        await db.commissions.create_index([("source_user_id", 1), ("level", 1)], unique=True)
        await db.users.insert_many([
            account("ancient"),
            {**account("grand"), "referred_by": "ancient"},
            {**account("coach"), "role": "coach", "coach_status": "approved", "payout_status": "connected", "referred_by": "grand"},
            {**account("payer"), "referred_by": "coach"},
            {**account("payer2"), "referred_by": "coach"},
            {**account("clubber"), "referred_by": "coach"},
        ])
        await db.subscriptions.insert_many([
            {"user_id": "payer", "plan": "pro_monthly", "status": "active", "stripe_subscription_id": "sub_eur"},
            {"user_id": "payer2", "plan": "pro_monthly", "status": "active", "stripe_subscription_id": "sub_jpy"},
        ])
        await db.community_members.insert_one({
            "id": "mem-club", "community_id": "c", "user_id": "clubber",
            "stripe_subscription_id": "sub_club", "status": "active", "role": "member",
        })
        source = inspect.getsource(community.stripe_webhook)
        assert source.index("verify_signature") < source.index("invoice_paid")
        assert source.index("verify_signature") < source.index("charge_refunded")
        eur = {"id": "in_eur", "amount_paid": 1000, "currency": "eur", "subscription": "sub_eur", "charge": "ch_eur", "payment_intent": "pi_eur", **_period()}
        await expect(400, community.stripe_webhook(signed(_event("evt-bad", "invoice.paid", eur), secret="whsec_attacker")))
        assert await db.commissions.count_documents({}) == 0
        await community.stripe_webhook(signed(_event("evt-fail", "invoice.payment_failed", {**eur, "amount_paid": 0, "amount_due": 1000})))
        await community.stripe_webhook(signed(_event("evt-trial", "invoice.paid", {**eur, "id": "in_trial", "amount_paid": 0})))
        assert await db.commissions.count_documents({}) == 0
        await community.stripe_webhook(signed(_event("evt-eur", "invoice.paid", eur)))
        await community.stripe_webhook(signed(_event("evt-eur", "invoice.paid", eur)))
        await community.stripe_webhook(signed(_event("evt-renew", "invoice.paid", {**eur, "id": "in_renew", "amount_paid": 5000})))
        jpy = {"id": "in_jpy", "amount_paid": 1500, "currency": "jpy", "parent": {"subscription_details": {"subscription": "sub_jpy"}}, "payments": {"data": [{"payment": {"payment_intent": "pi_jpy"}}]}, **_period()}
        await community.stripe_webhook(signed(_event("evt-jpy", "invoice.paid", jpy)))
        club = {"id": "in_club", "amount_paid": 2000, "currency": "eur", "subscription": "sub_club", "charge": "ch_club", **_period()}
        await community.stripe_webhook(signed(_event("evt-club", "invoice.paid", club)))
        rows = await db.commissions.find({}, {"_id": 0}).to_list(20)
        assert len(rows) == 6
        assert not any(row["beneficiary_id"] == "ancient" or row["level"] == 3 for row in rows)
        cash = next(row for row in rows if row["source_user_id"] == "payer" and row["level"] == 1)
        days = next(row for row in rows if row["source_user_id"] == "payer" and row["level"] == 2)
        assert cash == {**cash, "beneficiary_id": "coach", "kind": "pro", "amount_cents": 200, "currency": "eur", "status": "pending", "reward": "cash", "invoice_id": "in_eur"}
        assert days["beneficiary_id"] == "grand" and days["amount_cents"] == 50 and days["status"] == "paid"
        assert days["reward"] == "pro_credit_days" and days["credit_days"] == 1
        assert next(row for row in rows if row["invoice_id"] == "in_jpy" and row["level"] == 1)["amount_cents"] == 300
        assert next(row for row in rows if row["invoice_id"] == "in_club" and row["level"] == 1)["kind"] == "club"
        mine = await referrals.mine(account("coach"))
        assert mine["counts"] == {"referred": 3, "converted": 3}
        assert mine["pending"]["totals"] == [{"amount_cents": 600, "currency": "EUR"}, {"amount_cents": 300, "currency": "JPY"}]
        assert mine["paid"] == {"state": "none_in_period"}
        grand = await referrals.mine(account("grand"))
        assert grand["paid"]["totals"] == [{"amount_cents": 150, "currency": "EUR"}, {"amount_cents": 75, "currency": "JPY"}]
        assert (await server.require_pro(await db.users.find_one({"id": "grand"})))["id"] == "grand"
        await db.users.insert_one({**account("tiny"), "referred_by": "coach"})
        await db.subscriptions.insert_one({"user_id": "tiny", "plan": "pro_monthly", "status": "active", "stripe_subscription_id": "sub_tiny"})
        await community.stripe_webhook(signed(_event("evt-tiny", "invoice.paid", {**eur, "id": "in_tiny", "subscription": "sub_tiny", "amount_paid": 1})))
        await community.stripe_webhook(signed(_event("evt-tiny2", "invoice.paid", {**eur, "id": "in_after", "subscription": "sub_tiny", "amount_paid": 1000})))
        assert await db.commissions.count_documents({"source_user_id": "tiny"}) == 0
        await db.commissions.insert_one({
            "beneficiary_id": "lonely", "source_user_id": "x", "level": 1, "kind": "pro",
            "status": "paid", "currency": "eur", "invoice_id": "in_missing",
        })
        missing = await referrals.mine(account("lonely"))
        assert missing["paid"] == {"state": "recorded", "amounts_stored": False, "row_count": 1}
        assert "totals" not in missing["paid"]
        until = (await db.users.find_one({"id": "grand"}))["pro_credit_until"]
        await community.stripe_webhook(signed(_event("evt-refund-eur", "charge.refunded", {"id": "ch_eur", "invoice": "in_eur"})))
        await community.stripe_webhook(signed(_event("evt-refund-jpy", "charge.refunded", {"id": "ch_jpy", "payment_intent": "pi_jpy"})))
        await community.stripe_webhook(signed(_event("evt-refund-club", "charge.refunded", {"id": "ch_club", "invoice": "in_club"})))
        assert await db.commissions.count_documents({"status": "clawed_back"}) == 6
        assert await db.commissions.count_documents({"status": {"$in": ["pending", "paid"]}}) == 1  # the row with no amount
        after = (await db.users.find_one({"id": "grand"}))["pro_credit_until"]
        assert until - after == timedelta(days=3)
        await expect(402, server.require_pro(await db.users.find_one({"id": "grand"})))
        cleared = await referrals.mine(account("coach"))
        assert cleared["pending"] == {"state": "none_in_period"}
        assert cleared["counts"]["converted"] == 0
    run_isolated(scenario)
