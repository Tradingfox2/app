"""Staff accounting reads stored rows. It does not invent a zero total."""
import asyncio
import os
import uuid
from datetime import date, datetime, timedelta, timezone
import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import server  # noqa: E402
import staff  # noqa: E402
from routers.admin import accounting_summary  # noqa: E402
def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000)
        db = client[f"ironflow_accounting_test_{uuid.uuid4().hex}"]
        try:
            await scenario(db)
        finally:
            await client.drop_database(db.name)
            client.close()
    asyncio.run(run())
def account(uid, **extra):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete", **extra}
def test_summary_keeps_currencies_and_skips_empty_totals(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(staff, "db", db)
        moment = datetime(2026, 9, 15, 12, tzinfo=timezone.utc)
        outside = datetime(2026, 8, 1, tzinfo=timezone.utc)
        await db.community_checkouts.insert_many([
            {"id": "cs_eur", "status": "completed", "amount_cents": 2500, "currency": "eur", "updated_at": moment, "created_at": moment},
            {"id": "cs_usd", "status": "completed", "amount_cents": 1000, "currency": "USD", "updated_at": moment, "created_at": moment},
            {"id": "cs_blank", "status": "completed", "amount_cents": 400, "updated_at": moment, "created_at": moment},
            {"id": "cs_open", "status": "open", "amount_cents": 9999, "currency": "EUR", "created_at": moment},
            {"id": "cs_old", "status": "completed", "amount_cents": 8000, "currency": "EUR", "updated_at": outside, "created_at": outside},
        ])
        await db.partner_ledger.insert_many([
            {"id": "po_1", "status": "available", "currency": "usd", "gross_cents": 1000, "net_cents": 700, "created_at": moment, "stripe_id": "tr_1"},
            {"id": "po_2", "status": "paid", "currency": "usd", "gross_cents": 500, "net_cents": 400, "created_at": moment},
        ])
        await db.billing_events.insert_one({"id": "evt_refund", "type": "charge.refunded", "received_at": moment})
        await db.referrals.insert_many([
            {"id": "ref-zero", "status": "pending", "reward_amount_cents": 0, "reward_currency": "EUR", "created_at": moment},
            {"id": "ref-paid", "status": "rewarded", "reward_amount_cents": 1500, "reward_currency": "gbp", "activated_at": moment, "created_at": moment},
        ])
        await db.commissions.insert_many([
            {"id": "com_pending", "status": "pending", "amount_cents": 200, "currency": "usd", "created_at": moment, "stripe_id": "tr_com"},
            {"id": "com_paid", "status": "paid", "amount_cents": 300, "currency": "sek", "paid_at": moment},
        ])
        await db.subscriptions.insert_many([
            {"id": "sub-row", "status": "active", "provider": "stripe", "provider_subscription_id": "sub_1", "plan": "pro",
             "current_period_start": moment, "current_period_end": moment + timedelta(days=20)},
            {"id": "sub-old", "status": "active", "provider": "stripe", "current_period_start": outside, "current_period_end": outside + timedelta(days=5)},
            {"id": "sub-cancel", "status": "canceled", "provider": "stripe", "current_period_start": moment, "current_period_end": moment + timedelta(days=10)},
        ])
        admin = account("boss", staff_role="admin")
        for caller in (
            account("ath"),
            account("prod", role="admin"),
            account("sup", staff_role="support"),
            account("mod", staff_role="moderator"),
        ):
            with pytest.raises(HTTPException) as denied:
                await accounting_summary(caller, date(2026, 9, 1), date(2026, 9, 30))
            assert denied.value.status_code == 403
        report = await accounting_summary(admin, date(2026, 9, 1), date(2026, 9, 30))
        gross = {(row["currency"], row["amount_cents"]) for row in report["sections"]["gross_collected"]["totals"]}
        assert gross == {("EUR", 2500), ("USD", 1000), (None, 400)}
        fees = {(row["currency"], row["amount_cents"]) for row in report["sections"]["platform_fees"]["totals"]}
        assert fees == {("USD", 400)}
        owed = {(row["currency"], row["amount_cents"]) for row in report["sections"]["owed_to_coaches"]["totals"]}
        assert owed == {("USD", 700)}
        assert report["sections"]["refunds"]["state"] == "recorded"
        assert report["sections"]["refunds"]["amounts_stored"] is False
        assert "totals" not in report["sections"]["refunds"]
        assert report["sections"]["chargebacks"] == {"state": "none_in_period"}
        assert report["sections"]["commissions"]["pending"]["totals"] == [{"amount_cents": 200, "currency": "USD"}]
        assert report["sections"]["commissions"]["paid"]["totals"] == [{"amount_cents": 300, "currency": "SEK"}]
        assert report["sections"]["referrals"]["pending"] == {"state": "none_in_period"}
        assert report["sections"]["referrals"]["paid"]["totals"] == [{"amount_cents": 1500, "currency": "GBP"}]
        assert report["sections"]["active_subscriptions"]["counts"] == [{"currency": None, "count": 1}]
        refund_line = next(line for line in report["recent_lines"] if line["stripe_id"] == "evt_refund")
        assert refund_line["cents"] is None and refund_line["currency"] is None
        assert refund_line["kind"] == "billing_event" and refund_line["status"] == "charge.refunded"
        blank = next(line for line in report["recent_lines"] if line["stripe_id"] == "cs_blank")
        assert blank["currency"] is None and blank["cents"] == 400
        assert any(line["stripe_id"] == "cs_open" and line["status"] == "open" for line in report["recent_lines"])
        entry = await db.audit_log.find_one({"action": "accounting.viewed"})
        assert entry["actor_id"] == "boss" and entry["target_type"] == "report"
        assert entry["target_id"] == "accounting_summary"
        assert entry["metadata"] == {"from": "2026-09-01", "to": "2026-09-30"}
        with pytest.raises(HTTPException) as bad_range:
            await accounting_summary(admin, date(2026, 9, 30), date(2026, 9, 1))
        assert bad_range.value.status_code == 422
        empty = await accounting_summary(admin, date(2026, 1, 1), date(2026, 1, 31))
        assert empty["sections"]["gross_collected"] == {"state": "none_in_period"}
        assert empty["sections"]["active_subscriptions"] == {"state": "none_in_period"}
        assert empty["recent_lines"] == []
        assert await db.audit_log.count_documents({"action": "accounting.viewed"}) == 2
    run_isolated(scenario)
def test_a_failed_collection_does_not_blank_the_report(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(staff, "db", db)
        moment = datetime(2026, 9, 15, tzinfo=timezone.utc)
        await db.community_checkouts.insert_one({
            "id": "cs_ok", "status": "completed", "amount_cents": 500, "currency": "CHF",
            "updated_at": moment, "created_at": moment,
        })
        await db.commissions.insert_many([
            {"status": "paid", "amount_cents": 100, "currency": "USD", "created_at": moment},
            {"status": "paid", "currency": "USD", "created_at": moment},
        ])
        class Partial:
            def __getitem__(self, name):
                if name == "partner_ledger":
                    raise RuntimeError("not provisioned")
                return db[name]
        monkeypatch.setattr(server, "db", Partial())
        report = await accounting_summary(account("boss", staff_role="admin"), date(2026, 9, 1), date(2026, 9, 30))
        assert report["sections"]["gross_collected"]["totals"] == [{"amount_cents": 500, "currency": "CHF"}]
        assert report["sections"]["platform_fees"] == {"state": "unavailable"}
        assert report["sections"]["owed_to_coaches"] == {"state": "unavailable"}
        assert "totals" not in report["sections"]["platform_fees"]
        paid = report["sections"]["commissions"]["paid"]
        assert paid["state"] == "recorded" and paid["amounts_stored"] is False
        assert "totals" not in paid
    run_isolated(scenario)
