"""Pro subscription: Checkout opens a page, only a signed webhook grants it."""
import inspect
import os
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import billing  # noqa: E402
import pro_billing  # noqa: E402
import server  # noqa: E402
from routers import community, labs, wearables  # noqa: E402
from tests.test_community_billing import SECRET, completed, signed  # noqa: E402
from tests.test_community_complete import expect  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402
def _ready(monkeypatch, *, secret="sk_test_x", webhook=SECRET):
    monkeypatch.setenv("STRIPE_SECRET_KEY", secret)
    if webhook is None:
        monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    else:
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", webhook)
    monkeypatch.setenv("STRIPE_PRICE_PRO_MONTHLY", "price_month")
    monkeypatch.setenv("STRIPE_PRICE_PRO_YEARLY", "price_year")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.test")
    pro_billing._plans_cache.update(at=0.0, key="", body=None)
def _bind(db, monkeypatch):
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(community, "db", db)
def pro_completed(event_id="evt-pro"):
    return {"id": event_id, "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_pro", "mode": "subscription", "payment_status": "no_payment_required",
        "subscription": "sub_pro", "customer": "cus_pro",
        "metadata": {"kind": "pro", "user_id": "member", "plan": "pro_yearly"}}}}
def test_require_pro_guards_existing_upload_and_sync_routes():
    for fn in (server.add_biomarker, labs.upload_lab, wearables.sync_source):
        assert inspect.signature(fn).parameters["user"].default.dependency is server.require_pro
def test_checkout_needs_stripe_reuses_a_customer_and_yearly_has_a_trial(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        await db.users.insert_one(account("member"))
        _ready(monkeypatch, secret="")
        monkeypatch.delenv("STRIPE_SECRET_KEY")
        await expect(503, pro_billing.start_checkout(pro_billing.CheckoutIn(plan="pro_monthly"), account("member")))
        await expect(503, pro_billing.list_plans())
        await expect(503, pro_billing.billing_portal(account("member")))
        _ready(monkeypatch, webhook=None)
        monkeypatch.delenv("STRIPE_PRICE_PRO_MONTHLY")
        await expect(503, pro_billing.start_checkout(pro_billing.CheckoutIn(plan="pro_monthly"), account("member")))
        await expect(409, pro_billing.billing_portal(account("member")))
        monkeypatch.setenv("STRIPE_PRICE_PRO_MONTHLY", "price_month")
        calls = []
        async def fake_call(method, path, data=None, idempotency_key=None):
            calls.append((path, data, idempotency_key))
            if path == "/customers":
                return {"id": "cus_new"}
            if path == "/billing_portal/sessions":
                return {"url": "https://billing.stripe.com/p/session"}
            return {"id": "cs_1", "url": "https://checkout.stripe.com/c/pay"}
        monkeypatch.setattr(billing, "_call", fake_call)
        opened = await pro_billing.start_checkout(pro_billing.CheckoutIn(plan="pro_monthly"), account("member"))
        assert opened == {"url": "https://checkout.stripe.com/c/pay"} and await db.subscriptions.count_documents({}) == 0
        customer, monthly = calls
        assert customer[2] == "pro-customer-member"
        sent = monthly[1]
        assert sent["line_items[0][price]"] == "price_month" and sent["mode"] == "subscription"
        assert sent["automatic_tax[enabled]"] == "true" and sent["allow_promotion_codes"] == "true"
        assert sent["metadata[kind]"] == "pro" and "subscription_data[trial_period_days]" not in sent
        assert sent["success_url"] == "https://app.example.test/settings?checkout=success"
        calls.clear()
        await pro_billing.start_checkout(pro_billing.CheckoutIn(plan="pro_yearly"), account("member"))
        assert [path for path, _, _ in calls] == ["/checkout/sessions"]
        assert calls[0][1]["subscription_data[trial_period_days]"] == "7"
        assert calls[0][1]["line_items[0][price]"] == "price_year"
        portal = await pro_billing.billing_portal(account("member"))
        assert portal == {"url": "https://billing.stripe.com/p/session"} and calls[-1][1]["customer"] == "cus_new"
    run_isolated(scenario)
def test_a_signed_webhook_grants_pro_and_jpy_stays_a_zero_decimal_amount(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        _ready(monkeypatch)
        await db.users.insert_one(account("member"))
        await expect(400, community.stripe_webhook(signed(pro_completed(), secret="whsec_attacker")))
        await community.stripe_webhook(signed(completed()))
        assert await db.subscriptions.count_documents({}) == 0
        await community.stripe_webhook(signed(pro_completed()))
        await community.stripe_webhook(signed(pro_completed()))
        assert await db.subscriptions.count_documents({}) == 1
        assert await server.current_sub(account("stranger")) == {"plan": "free", "status": "active"}
        trial = await server.current_sub(account("member"))
        assert trial["plan"] == "pro_yearly" and trial["status"] == "trialing"
        assert trial["currency"] is None and trial["amount_cents"] is None
        await community.stripe_webhook(signed({"id": "evt-stray", "type": "invoice.paid", "data": {"object": {
            "customer": "cus_other", "subscription": "sub_other", "currency": "eur", "amount_paid": 500}}}))
        await community.stripe_webhook(signed({"id": "evt-jpy", "type": "invoice.paid", "data": {"object": {
            "customer": "cus_pro", "subscription": "sub_pro", "currency": "JPY", "amount_paid": 1500}}}))
        paid = await server.current_sub(account("member"))
        assert paid["amount_cents"] == 1500 and paid["currency"] == "jpy" and paid["status"] == "trialing"
        await community.stripe_webhook(signed({"id": "evt-fail", "type": "invoice.payment_failed", "data": {"object": {
            "customer": "cus_pro", "subscription": "sub_pro", "currency": "jpy", "amount_due": 1500}}}))
        assert (await server.current_sub(account("member")))["status"] == "past_due"
        assert (await server.require_pro(account("member")))["id"] == "member"
        await community.stripe_webhook(signed({"id": "evt-sub", "type": "customer.subscription.updated", "data": {"object": {
            "id": "sub_pro", "customer": "cus_pro", "status": "active", "cancel_at_period_end": True,
            "current_period_end": 1_800_000_000, "metadata": {"kind": "pro", "user_id": "member", "plan": "pro_yearly"},
            "items": {"data": [{"price": {"unit_amount": 1500, "currency": "jpy", "recurring": {"interval": "year"}}}]},
        }}}))
        current = await server.current_sub(account("member"))
        assert current["cancel_at_period_end"] is True and current["current_period_end"].year == 2027
        assert current["amount_cents"] == 1500 and current["currency"] == "jpy" and current["status"] == "active"
        await community.stripe_webhook(signed({"id": "evt-other", "type": "customer.subscription.deleted", "data": {
            "object": {"id": "sub_community", "status": "canceled"}}}))
        assert (await server.current_sub(account("member")))["status"] == "active"
        await community.stripe_webhook(signed({"id": "evt-del", "type": "customer.subscription.deleted", "data": {
            "object": {"id": "sub_pro", "status": "canceled", "metadata": {"kind": "pro", "user_id": "member"}}}}))
        assert await server.current_sub(account("member")) == {"plan": "free", "status": "active"}
        await expect(402, server.require_pro(account("member")))
        await db.subscriptions.update_one({"user_id": "member"}, {"$set": {"status": "active", "plan": "pro"}})
        await expect(409, pro_billing.start_checkout(pro_billing.CheckoutIn(plan="pro_monthly"), account("member")))
        assert (await server.require_pro(account("member")))["id"] == "member"
    run_isolated(scenario)
def test_prices_come_from_the_price_object_and_are_cached_for_about_an_hour(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        _ready(monkeypatch)
        calls = {"n": 0}
        async def fake_price(price_id):
            calls["n"] += 1
            yearly = price_id == "price_year"
            return {"unit_amount": 12000 if yearly else 1500, "currency": "gbp", "recurring": {"interval": "year" if yearly else "month"}}
        monkeypatch.setattr(billing, "retrieve_price", fake_price)
        first = await pro_billing.list_plans()
        assert await pro_billing.list_plans() == first and calls["n"] == 2
        assert first["plans"] == [
            {"plan": "pro_monthly", "amount_cents": 1500, "currency": "gbp", "interval": "month"},
            {"plan": "pro_yearly", "amount_cents": 12000, "currency": "gbp", "interval": "year"},
        ]
        pro_billing._plans_cache["at"] = 0
        await pro_billing.list_plans()
        assert calls["n"] == 4
    run_isolated(scenario)
