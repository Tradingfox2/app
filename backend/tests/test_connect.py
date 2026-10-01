"""Stripe Connect for approved coaches. Pro checkout and the signature check stay put."""
import inspect
import os

import pytest
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import billing  # noqa: E402
import server  # noqa: E402
from routers import coach_chat, community  # noqa: E402
from tests.test_community_billing import SECRET, signed  # noqa: E402
from tests.test_community_complete import expect, seed_all  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402


def coach(uid="owner", **extra):
    return account(uid) | {"role": "coach", "coach_status": "approved", **extra}


def test_coach_chat_stays_open_without_pro():
    assert inspect.signature(coach_chat.coach_chat).parameters["user"].default.dependency is server.current_user


def test_express_countries_are_the_named_regions_only():
    assert {"FR", "DE", "GB", "US", "CA", "JP", "SG", "HK", "AU", "NZ", "KR"} <= billing.EXPRESS_COUNTRIES
    for blocked in ("HR", "CH", "NO", "IS", "BR", "CM", "XAF", "GI"):
        assert blocked not in billing.EXPRESS_COUNTRIES
    assert community.ConnectIn(country="fr").country == "FR"
    with pytest.raises(ValidationError):
        community.ConnectIn(country="CH")
    with pytest.raises(ValidationError):
        community.ConnectIn(country="XAF")


def test_connect_requires_an_approved_coach_and_a_stripe_key(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
        await expect(403, community.start_connect(community.ConnectIn(country="FR"), account("owner")))
        await expect(403, community.connect_status(account("out")))
        await expect(403, community.start_connect(community.ConnectIn(country="FR"), coach("owner", coach_status="pending")))
        await db.users.update_one({"id": "owner"}, {"$set": {"role": "coach", "coach_status": "approved"}})
        await expect(503, community.start_connect(community.ConnectIn(country="FR"), coach()))
        await expect(503, community.connect_status(coach()))
    run_isolated(scenario)


def test_connect_creates_one_express_account_and_status_waits_for_both_flags(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
        monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.test")
        await db.users.update_one({"id": "owner"}, {"$set": {"role": "coach", "coach_status": "approved"}})
        calls = []
        flags = {"charges_enabled": False, "payouts_enabled": True}

        async def fake_call(method, path, data=None, idempotency_key=None):
            calls.append((method, path, data, idempotency_key))
            if path == "/accounts" and method == "POST":
                return {"id": "acct_owner"}
            if path == "/account_links":
                return {"url": "https://connect.stripe.com/setup/e/acct_owner"}
            if path == "/accounts/acct_owner":
                return {"id": "acct_owner", **flags}
            raise AssertionError(path)

        monkeypatch.setattr(billing, "_call", fake_call)
        opened = await community.start_connect(community.ConnectIn(country="FR"), coach())
        assert opened == {"url": "https://connect.stripe.com/setup/e/acct_owner"}
        created = calls[0]
        assert created[0] == "POST" and created[1] == "/accounts"
        assert created[2]["type"] == "express" and created[2]["country"] == "FR"
        assert created[3] == "connect-owner-FR"
        link = calls[1][2]
        assert link["type"] == "account_onboarding" and link["account"] == "acct_owner"
        assert link["return_url"] == "https://app.example.test/partner?connect=return"
        assert (await db.users.find_one({"id": "owner"}))["stripe_account_id"] == "acct_owner"
        calls.clear()
        await community.start_connect(community.ConnectIn(country="DE"), coach())
        assert [path for _, path, _, _ in calls] == ["/account_links"]
        waiting = await community.connect_status(coach())
        assert waiting["payout_status"] == "not_connected" and waiting["charges_enabled"] is False
        assert (await db.users.find_one({"id": "owner"})).get("payout_status") != "connected"
        flags["charges_enabled"] = True
        ready = await community.connect_status(coach())
        assert ready["payout_status"] == "connected" and ready["payouts_enabled"] is True
        assert (await db.users.find_one({"id": "owner"}))["payout_status"] == "connected"
        assert (await db.users.find_one({"id": "owner"}))["stripe_account_id"] == "acct_owner"
    run_isolated(scenario)


def test_checkout_adds_a_destination_only_for_a_connected_owner(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"join_policy": "paid", "price_cents": 1500, "currency": "EUR"}})
        sent = []

        async def fake_call(method, path, data=None, idempotency_key=None):
            sent.append(data)
            return {"id": f"cs_{len(sent)}", "url": "https://checkout.stripe.com/c/pay"}

        monkeypatch.setattr(billing, "_call", fake_call)
        await community.start_checkout("c-1", None, account("out"))
        assert "subscription_data[transfer_data][destination]" not in sent[0]
        assert "subscription_data[application_fee_percent]" not in sent[0]
        await db.users.update_one({"id": "owner"}, {"$set": {"stripe_account_id": "acct_owner", "payout_status": "connected"}})
        await db.users.insert_one(account("buyer"))
        await community.start_checkout("c-1", None, account("buyer"))
        assert sent[1]["subscription_data[transfer_data][destination]"] == "acct_owner"
        assert sent[1]["subscription_data[application_fee_percent]"] == "20"
    run_isolated(scenario)


def _invoice(event_id, invoice):
    return {"id": event_id, "type": "invoice.paid", "data": {"object": invoice}}


def test_invoice_paid_writes_the_ledger_in_the_invoice_currency_and_audits_it(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
        monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
        await db.users.update_one({"id": "owner"}, {"$set": {
            "role": "coach", "coach_status": "approved", "stripe_account_id": "acct_owner", "payout_status": "connected",
        }})
        await expect(400, community.stripe_webhook(signed(_invoice("evt-bad", {
            "id": "in_bad", "amount_paid": 1500, "currency": "jpy", "metadata": {"community_id": "c-1"},
        }), secret="whsec_attacker")))
        assert await db.partner_ledger.count_documents({}) == 0

        await community.stripe_webhook(signed(_invoice("evt-jpy", {
            "id": "in_jpy", "amount_paid": 1500, "currency": "jpy", "metadata": {"community_id": "c-1"},
        })))
        await community.stripe_webhook(signed(_invoice("evt-jpy", {
            "id": "in_jpy", "amount_paid": 1500, "currency": "jpy", "metadata": {"community_id": "c-1"},
        })))
        await community.stripe_webhook(signed(_invoice("evt-eur", {
            "id": "in_eur", "amount_paid": 2000, "currency": "EUR", "application_fee_amount": 250,
            "parent": {"subscription_details": {"metadata": {"community_id": "c-1"}}},
        })))
        await community.stripe_webhook(signed({"id": "evt-pro", "type": "invoice.paid", "data": {"object": {
            "id": "in_pro", "amount_paid": 900, "currency": "eur", "metadata": {"kind": "pro", "community_id": "c-1"},
        }}}))
        await community.stripe_webhook(signed({"id": "evt-fail", "type": "invoice.payment_failed", "data": {"object": {
            "id": "in_fail", "amount_due": 1500, "currency": "jpy", "metadata": {"community_id": "c-1"},
        }}}))
        rows = {row["stripe_id"]: row async for row in db.partner_ledger.find({}, {"_id": 0})}
        assert set(rows) == {"in_jpy", "in_eur"}
        yen = rows["in_jpy"]
        assert yen["currency"] == "jpy" and yen["gross_cents"] == 1500
        assert yen["fee_cents"] == 300 and yen["net_cents"] == 1200 and yen["kind"] == "invoice.paid"
        assert yen["owner_id"] == "owner"
        assert rows["in_eur"]["currency"] == "EUR" and rows["in_eur"]["fee_cents"] == 250 and rows["in_eur"]["net_cents"] == 1750
        audits = [row async for row in db.audit_log.find({"action": "partner_ledger.written"}, {"_id": 0})]
        assert len(audits) == 2
        assert {row["target_id"] for row in audits} == {"in_jpy", "in_eur"}
        assert audits[0]["metadata"]["currency"] in {"jpy", "EUR"}
        board = await community.partner_dashboard(coach())
        totals = {row["_id"]: (row["gross_cents"], row["net_cents"]) for row in board["balances"]}
        assert totals == {"jpy": (1500, 1200), "EUR": (2000, 1750)}

        await db.users.update_one({"id": "owner"}, {"$set": {"payout_status": "not_connected"}})
        await community.stripe_webhook(signed(_invoice("evt-later", {
            "id": "in_later", "amount_paid": 800, "currency": "eur", "metadata": {"community_id": "c-1"},
        })))
        assert await db.partner_ledger.count_documents({"stripe_id": "in_later"}) == 0
        await db.community_members.update_one({"user_id": "mem"}, {"$set": {"stripe_subscription_id": "sub_mem"}})
        await db.users.update_one({"id": "owner"}, {"$set": {"payout_status": "connected"}})
        await community.stripe_webhook(signed(_invoice("evt-sub", {
            "id": "in_sub", "amount_paid": 1000, "currency": "gbp", "subscription": "sub_mem",
        })))
        sub_row = await db.partner_ledger.find_one({"stripe_id": "in_sub"}, {"_id": 0})
        assert sub_row["currency"] == "gbp" and sub_row["fee_cents"] == 200 and sub_row["net_cents"] == 800
        assert await db.audit_log.count_documents({"action": "partner_ledger.written"}) == 3
    run_isolated(scenario)
