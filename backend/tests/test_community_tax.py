"""Paid-community checkout tax: off by default, Stripe automatic tax behind a flag, ledger net excludes tax."""
import os

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import accounting  # noqa: E402
import billing  # noqa: E402
from billing import CommunityTax  # noqa: E402
from routers import community  # noqa: E402
from tests.test_community_billing import SECRET, signed  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402
from tests.test_connect import seed_all  # noqa: E402


def test_flags_default_to_current_production_behaviour(monkeypatch):
    for name in ("STRIPE_COMMUNITY_AUTOMATIC_TAX", "STRIPE_COMMUNITY_TAX_BEHAVIOR", "CONNECT_FEE_PERCENT"):
        monkeypatch.delenv(name, raising=False)
    assert CommunityTax.automatic_tax() is False
    assert CommunityTax.checkout_fields() == {}
    assert CommunityTax.fee_percent() == 20
    monkeypatch.setenv("CONNECT_FEE_PERCENT", "15")
    assert CommunityTax.fee_percent() == 15
    monkeypatch.setenv("CONNECT_FEE_PERCENT", "nope")
    assert CommunityTax.fee_percent() == 20
    monkeypatch.setenv("STRIPE_COMMUNITY_AUTOMATIC_TAX", "true")
    assert CommunityTax.checkout_fields() == {
        "automatic_tax[enabled]": "true",
        "billing_address_collection": "required",
        "line_items[0][price_data][tax_behavior]": "inclusive",
    }
    monkeypatch.setenv("STRIPE_COMMUNITY_TAX_BEHAVIOR", "exclusive")
    assert CommunityTax.checkout_fields()["line_items[0][price_data][tax_behavior]"] == "exclusive"
    assert CommunityTax.invoice_tax({"tax": 239}) == 239
    assert CommunityTax.invoice_tax({"total_taxes": [{"amount": 200}, {"amount": 39}]}) == 239
    assert CommunityTax.invoice_tax({"total_tax_amounts": [{"amount": 239}]}) == 239
    assert CommunityTax.invoice_tax({}) == 0


def test_checkout_sends_tax_only_when_the_flag_is_on(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        monkeypatch.delenv("STRIPE_COMMUNITY_AUTOMATIC_TAX", raising=False)
        monkeypatch.delenv("CONNECT_FEE_PERCENT", raising=False)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"join_policy": "paid", "price_cents": 1500, "currency": "EUR"}})
        await db.users.update_one({"id": "owner"}, {"$set": {"stripe_account_id": "acct_owner", "payout_status": "connected"}})
        sent = []

        async def fake_call(method, path, data=None, idempotency_key=None):
            sent.append(data)
            return {"id": f"cs_{len(sent)}", "url": "https://checkout.stripe.com/c/pay"}

        monkeypatch.setattr(billing, "_call", fake_call)
        await db.users.insert_many([account("off"), account("on")])
        await community.start_checkout("c-1", None, account("off"))
        assert not any(key.startswith("automatic_tax") or "tax_behavior" in key for key in sent[0])
        assert "billing_address_collection" not in sent[0]
        assert sent[0]["subscription_data[application_fee_percent]"] == "20"
        monkeypatch.setenv("STRIPE_COMMUNITY_AUTOMATIC_TAX", "true")
        await community.start_checkout("c-1", None, account("on"))
        assert sent[1]["automatic_tax[enabled]"] == "true"
        assert sent[1]["line_items[0][price_data][tax_behavior]"] == "inclusive"
        assert sent[1]["line_items[0][price_data][unit_amount]"] == "1500"
    run_isolated(scenario)


def test_ledger_net_excludes_tax(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        monkeypatch.delenv("CONNECT_FEE_PERCENT", raising=False)
        await db.users.update_one({"id": "owner"}, {"$set": {"stripe_account_id": "acct_owner", "payout_status": "connected"}})
        base = {"currency": "eur", "metadata": {"community_id": "c-1"}}
        # 15.00 incl. 19% VAT (2.39). Stripe reports the platform fee; net = 1500 - 239 - 252.
        await community.stripe_webhook(signed({"id": "evt-t1", "type": "invoice.paid", "data": {"object": {
            **base, "id": "in_tax", "amount_paid": 1500, "tax": 239, "application_fee_amount": 252}}}))
        # No application_fee_amount: the fallback fee is 20% of the amount net of tax.
        await community.stripe_webhook(signed({"id": "evt-t2", "type": "invoice.paid", "data": {"object": {
            **base, "id": "in_fallback", "amount_paid": 1190, "total_taxes": [{"amount": 190}]}}}))
        # Untaxed invoice: unchanged arithmetic.
        await community.stripe_webhook(signed({"id": "evt-t3", "type": "invoice.paid", "data": {"object": {
            **base, "id": "in_plain", "amount_paid": 1000, "application_fee_amount": 200}}}))
        rows = {row["stripe_id"]: row async for row in db.partner_ledger.find({}, {"_id": 0})}
        assert (rows["in_tax"]["gross_cents"], rows["in_tax"]["tax_cents"], rows["in_tax"]["fee_cents"], rows["in_tax"]["net_cents"]) == (1500, 239, 252, 1009)
        assert (rows["in_fallback"]["tax_cents"], rows["in_fallback"]["fee_cents"], rows["in_fallback"]["net_cents"]) == (190, 200, 800)
        assert (rows["in_plain"]["tax_cents"], rows["in_plain"]["fee_cents"], rows["in_plain"]["net_cents"]) == (0, 200, 800)
        # The accounting report counts the fee, not the tax, as platform revenue.
        assert accounting._fee(rows["in_tax"]) == ("ok", 252, "EUR")
        assert accounting._fee({"gross_cents": 1500, "tax_cents": 239, "net_cents": 1009, "currency": "eur"}) == ("ok", 252, "EUR")
        assert accounting._fee({"gross_cents": 1000, "net_cents": 800, "currency": "eur"}) == ("ok", 200, "EUR")
    run_isolated(scenario)
