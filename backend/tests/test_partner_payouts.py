"""Coach ledger rows move to paid_out from Connect payout events, and accounting stops owing them."""
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import accounting  # noqa: E402
import billing  # noqa: E402
from partner_payouts import PartnerPayouts  # noqa: E402
from routers import community  # noqa: E402
from tests.test_community_billing import SECRET, signed  # noqa: E402
from tests.test_community_complete import expect  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402
from tests.test_pro_billing import _bind  # noqa: E402

CONNECT_SECRET = "whsec_connect_test_secret"
T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)


def _payout(event_id, kind, payout_id, amount, currency="eur", acct="acct_coach"):
    return {"id": event_id, "type": kind, "account": acct, "data": {"object": {
        "id": payout_id, "object": "payout", "amount": amount, "currency": currency, "arrival_date": 1_790_000_000}}}


def _row(stripe_id, net, minutes, currency="eur", owner="coach"):
    return {"owner_id": owner, "partner_id": owner, "status": "available", "kind": "invoice.paid",
            "gross_cents": net + net // 4, "fee_cents": net // 4, "net_cents": net, "currency": currency,
            "stripe_id": stripe_id, "created_at": T0 + timedelta(minutes=minutes)}


def test_fifo_never_marks_more_than_the_payout():
    rows = [{"net_cents": 800}, {"net_cents": 800}, {"net_cents": 100}]
    assert [r["net_cents"] for r in PartnerPayouts.fifo(rows, 1600)] == [800, 800]
    assert [r["net_cents"] for r in PartnerPayouts.fifo(rows, 1599)] == [800]
    assert PartnerPayouts.fifo(rows, 799) == []
    assert not PartnerPayouts.handles({"type": "payout.paid"})  # platform payout, no connected account
    assert PartnerPayouts.handles({"type": "payout.paid", "account": "acct_x"})


def test_connect_webhook_secret_is_accepted_alongside_the_platform_secret(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("STRIPE_CONNECT_WEBHOOK_SECRET", CONNECT_SECRET)
    for secret in (SECRET, CONNECT_SECRET):
        request = signed({"id": "evt"}, secret=secret)
        assert billing.verify_signature(request._payload, request.headers["stripe-signature"])
    request = signed({"id": "evt"}, secret="whsec_attacker")
    assert not billing.verify_signature(request._payload, request.headers["stripe-signature"])
    monkeypatch.delenv("STRIPE_CONNECT_WEBHOOK_SECRET")
    request = signed({"id": "evt"}, secret=CONNECT_SECRET)
    assert not billing.verify_signature(request._payload, request.headers["stripe-signature"])


def test_payout_paid_marks_rows_and_owed_to_coaches_excludes_them(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch)
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        monkeypatch.setenv("STRIPE_CONNECT_WEBHOOK_SECRET", CONNECT_SECRET)
        await db.users.insert_many([
            {**account("coach"), "role": "coach", "coach_status": "approved", "payout_status": "connected", "stripe_account_id": "acct_coach"},
            {**account("other"), "role": "coach", "coach_status": "approved", "payout_status": "connected", "stripe_account_id": "acct_other"},
        ])
        await db.partner_ledger.insert_many([
            _row("in_1", 800, 0), _row("in_2", 800, 1), _row("in_3", 800, 2),
            _row("in_jpy", 1500, 3, currency="jpy"), _row("in_o", 800, 0, owner="other"),
        ])
        start, end = T0 - timedelta(days=1), T0 + timedelta(days=1)
        before = await accounting.summary(start, end, start.date(), end.date())
        assert before["sections"]["owed_to_coaches"]["totals"] == [
            {"amount_cents": 3200, "currency": "EUR"}, {"amount_cents": 1500, "currency": "JPY"}]

        await expect(400, community.stripe_webhook(signed(_payout("evt-forged", "payout.paid", "po_1", 1600), secret="whsec_attacker")))
        await community.stripe_webhook(signed(_payout("evt-po1", "payout.paid", "po_1", 1600), secret=CONNECT_SECRET))
        rows = {row["stripe_id"]: row async for row in db.partner_ledger.find({}, {"_id": 0})}
        assert rows["in_1"]["status"] == rows["in_2"]["status"] == "paid_out"
        assert rows["in_1"]["payout_id"] == "po_1" and rows["in_1"]["paid_out_at"] is not None
        assert rows["in_3"]["status"] == "available"  # did not fit in the 1600 payout
        assert rows["in_jpy"]["status"] == "available" and rows["in_o"]["status"] == "available"
        # The same payout delivered again under a new event id changes nothing.
        await community.stripe_webhook(signed(_payout("evt-po1-dup", "payout.paid", "po_1", 1600), secret=CONNECT_SECRET))
        assert await db.partner_ledger.count_documents({"status": "paid_out"}) == 2

        after = await accounting.summary(start, end, start.date(), end.date())
        assert after["sections"]["owed_to_coaches"]["totals"] == [
            {"amount_cents": 1600, "currency": "EUR"}, {"amount_cents": 1500, "currency": "JPY"}]
        # Platform fees are still recorded on paid-out rows.
        assert after["sections"]["platform_fees"] == before["sections"]["platform_fees"]

        # The dashboard keeps showing everything recorded, paid out or not.
        coach = await db.users.find_one({"id": "coach"}, {"_id": 0})
        dash = await community.partner_dashboard(coach)
        assert {row["_id"]: row["net_cents"] for row in dash["balances"]} == {"eur": 2400, "jpy": 1500}
        assert {row["_id"]: row["paid_out_cents"] for row in dash["balances"]} == {"eur": 1600, "jpy": 0}

        # A failed payout puts its rows back.
        await community.stripe_webhook(signed(_payout("evt-po1-fail", "payout.failed", "po_1", 1600), secret=CONNECT_SECRET))
        assert await db.partner_ledger.count_documents({"status": "paid_out"}) == 0
        assert await db.partner_ledger.count_documents({"payout_id": {"$exists": True}}) == 0

        # Zero-decimal currency: amounts compare in minor units as Stripe sends them.
        await community.stripe_webhook(signed(_payout("evt-po2", "payout.paid", "po_2", 1500, currency="jpy"), secret=CONNECT_SECRET))
        assert (await db.partner_ledger.find_one({"stripe_id": "in_jpy"}))["status"] == "paid_out"
        # An unknown connected account changes nothing.
        await community.stripe_webhook(signed(_payout("evt-po3", "payout.paid", "po_3", 99999, acct="acct_unknown"), secret=CONNECT_SECRET))
        assert await db.partner_ledger.count_documents({"status": "paid_out"}) == 1
    run_isolated(scenario)
