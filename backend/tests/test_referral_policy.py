"""Referral policy: single level, net-of-tax base, configurable rate, proportional clawback."""
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import referrals  # noqa: E402
from referrals import ReferralPolicy  # noqa: E402
from routers import community  # noqa: E402
from tests.test_community_billing import SECRET, signed  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402
from tests.test_pro_billing import _bind  # noqa: E402

DAY = 86400
START = 1_700_000_000
PERIOD = {"lines": {"data": [{"period": {"start": START, "end": START + 30 * DAY}}]}}


def _event(event_id, kind, obj):
    return {"id": event_id, "type": kind, "data": {"object": obj}}


def test_rate_is_configurable_and_bad_values_fall_back(monkeypatch):
    monkeypatch.delenv("REFERRAL_RATE_PERCENT", raising=False)
    assert ReferralPolicy.rate_percent() == 20
    for value, expected in (("10", 10), ("0", 0), ("100", 100), ("101", 20), ("-5", 20), ("abc", 20), (" 15 ", 15)):
        monkeypatch.setenv("REFERRAL_RATE_PERCENT", value)
        assert ReferralPolicy.rate_percent() == expected, value


def test_base_is_net_of_tax_for_every_stripe_tax_shape():
    assert ReferralPolicy.commission_base({"tax": 190}, 1190) == 1000
    assert ReferralPolicy.commission_base({"total_taxes": [{"amount": 150}, {"amount": 40}]}, 1190) == 1000
    assert ReferralPolicy.commission_base({"total_tax_amounts": [{"amount": 190, "inclusive": True}]}, 1190) == 1000
    assert ReferralPolicy.commission_base({}, 1190) == 1190
    assert ReferralPolicy.commission_base({"tax": 5000}, 1190) == 0


def test_accounting_reports_commissions_net_of_partial_clawback():
    import accounting
    assert accounting._commission({"status": "pending", "amount_cents": 200, "clawed_back_cents": 50, "currency": "eur"}) == ("ok", 150, "EUR")
    assert accounting._commission({"status": "pending", "amount_cents": 200, "clawed_back_cents": 200, "currency": "eur"})[0] == "skip"
    assert accounting._commission({"status": "clawed_back", "amount_cents": 200, "clawed_back_cents": 200, "currency": "eur"}) == ("ok", 200, "EUR")
    assert accounting._commission({"status": "paid", "amount_cents": 200, "currency": "eur"}) == ("ok", 200, "EUR")


def test_clawback_target_is_proportional_and_full_refund_takes_all():
    assert ReferralPolicy.clawback_target(200, (595, 1190)) == 100
    assert ReferralPolicy.clawback_target(200, (1190, 1190)) == 200
    assert ReferralPolicy.clawback_target(200, (0, 1190)) == 0
    assert ReferralPolicy.clawback_target(200, None) == 200
    assert ReferralPolicy.refunded_share({"amount": 1190, "amount_refunded": 9999}) == (1190, 1190)
    assert ReferralPolicy.refunded_share({"id": "ch_x"}) is None


def test_single_level_net_of_tax_and_proportional_refunds(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        monkeypatch.delenv("REFERRAL_RATE_PERCENT", raising=False)
        await db.commissions.create_index([("source_user_id", 1), ("level", 1)], unique=True)
        await db.users.insert_many([
            account("grand"),
            {**account("coach"), "role": "coach", "coach_status": "approved", "payout_status": "connected", "referred_by": "grand"},
            {**account("friend"), "referred_by": "grand"},
            {**account("a"), "referred_by": "coach"},
            {**account("b"), "referred_by": "friend"},
            {**account("c"), "referred_by": "coach"},
        ])
        await db.subscriptions.insert_many([
            {"user_id": user, "plan": "pro_monthly", "status": "active", "stripe_subscription_id": f"sub_{user}"}
            for user in ("a", "b", "c")
        ])
        inv_a = {"id": "in_a", "amount_paid": 1190, "tax": 190, "currency": "eur", "subscription": "sub_a", "charge": "ch_a", **PERIOD}
        inv_b = {"id": "in_b", "amount_paid": 1190, "total_taxes": [{"amount": 190}], "currency": "eur", "subscription": "sub_b", "charge": "ch_b", **PERIOD}
        await community.stripe_webhook(signed(_event("evt-a", "invoice.paid", inv_a)))
        await community.stripe_webhook(signed(_event("evt-b", "invoice.paid", inv_b)))
        rows = {row["source_user_id"]: row for row in await db.commissions.find({}, {"_id": 0}).to_list(20)}
        assert set(rows) == {"a", "b"}
        assert all(row["level"] == 1 for row in rows.values())
        assert await db.commissions.count_documents({"beneficiary_id": "grand"}) == 0
        # 20% of 1000 (the 1190 invoice minus 190 VAT), not of 1190.
        assert rows["a"]["amount_cents"] == 200 and rows["a"]["base_cents"] == 1000 and rows["a"]["rate_percent"] == 20
        assert rows["a"]["reward"] == "cash" and rows["a"]["status"] == "pending"
        assert rows["b"]["amount_cents"] == 200 and rows["b"]["reward"] == "pro_credit_days" and rows["b"]["credit_days"] == 6
        friend_until = (await db.users.find_one({"id": "friend"}))["pro_credit_until"]

        # Half refunded: half the commission and half the credit days come back.
        await community.stripe_webhook(signed(_event("evt-ra1", "charge.refunded", {"id": "ch_a", "invoice": "in_a", "amount": 1190, "amount_refunded": 595})))
        await community.stripe_webhook(signed(_event("evt-rb1", "charge.refunded", {"id": "ch_b", "invoice": "in_b", "amount": 1190, "amount_refunded": 595})))
        a_row = await db.commissions.find_one({"source_user_id": "a"})
        assert a_row["status"] == "pending" and a_row["clawed_back_cents"] == 100
        mine = await referrals.mine(account("coach"))
        assert mine["pending"]["totals"] == [{"amount_cents": 100, "currency": "EUR"}]
        assert friend_until - (await db.users.find_one({"id": "friend"}))["pro_credit_until"] == timedelta(days=3)
        # A redelivery of the same cumulative state claws nothing more.
        await community.stripe_webhook(signed(_event("evt-ra1-again", "charge.refunded", {"id": "ch_a", "invoice": "in_a", "amount": 1190, "amount_refunded": 595})))
        assert (await db.commissions.find_one({"source_user_id": "a"}))["clawed_back_cents"] == 100

        # Fully refunded: everything left is clawed back.
        await community.stripe_webhook(signed(_event("evt-ra2", "charge.refunded", {"id": "ch_a", "invoice": "in_a", "amount": 1190, "amount_refunded": 1190})))
        await community.stripe_webhook(signed(_event("evt-rb2", "charge.refunded", {"id": "ch_b", "invoice": "in_b", "amount": 1190, "amount_refunded": 1190})))
        a_row = await db.commissions.find_one({"source_user_id": "a"})
        assert a_row["status"] == "clawed_back" and a_row["clawed_back_cents"] == 200
        assert (await db.commissions.find_one({"source_user_id": "b"}))["status"] == "clawed_back"
        assert friend_until - (await db.users.find_one({"id": "friend"}))["pro_credit_until"] == timedelta(days=6)
        assert (await referrals.mine(account("coach")))["pending"] == {"state": "none_in_period"}

        # The rate comes from the environment at settle time.
        monkeypatch.setenv("REFERRAL_RATE_PERCENT", "10")
        await community.stripe_webhook(signed(_event("evt-c", "invoice.paid", {"id": "in_c", "amount_paid": 1000, "currency": "eur", "subscription": "sub_c", **PERIOD})))
        c_row = await db.commissions.find_one({"source_user_id": "c"})
        assert c_row["amount_cents"] == 100 and c_row["rate_percent"] == 10
    run_isolated(scenario)
