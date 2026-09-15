"""Paid communities: Stripe Checkout in, signed webhooks only, cancellation out."""
import hashlib
import hmac
import json
import os
import time

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import billing  # noqa: E402
import server  # noqa: E402,F401
from routers import community  # noqa: E402
from tests.test_community_complete import expect, seed_all  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402

SECRET = "whsec_test_secret"


class FakeRequest:
    def __init__(self, payload: bytes, signature: str):
        self.headers = {"stripe-signature": signature}
        self._payload = payload

    async def body(self):
        return self._payload


def signed(event: dict, secret: str = SECRET, at: int | None = None) -> FakeRequest:
    payload = json.dumps(event).encode()
    at = at or int(time.time())
    digest = hmac.new(secret.encode(), f"{at}.".encode() + payload, hashlib.sha256).hexdigest()
    return FakeRequest(payload, f"t={at},v1={digest}")


def completed(session_id="cs_1", subscription="sub_1", event_id="evt_1"):
    return {"id": event_id, "type": "checkout.session.completed", "data": {"object": {
        "id": session_id, "mode": "subscription", "payment_status": "paid",
        "subscription": subscription, "customer": "cus_1"}}}


def subscription_event(kind, status, subscription="sub_1", event_id="evt_2"):
    return {"id": event_id, "type": f"customer.subscription.{kind}",
            "data": {"object": {"id": subscription, "status": status}}}


async def paid_setup(db, monkeypatch):
    await seed_all(db, monkeypatch)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.test")
    await db.communities.update_one({"id": "c-1"}, {"$set": {"join_policy": "paid", "price_cents": 1500, "currency": "EUR"}})
    calls = {"checkout": [], "cancel": []}

    async def fake_checkout(**kwargs):
        calls["checkout"].append(kwargs)
        return {"id": f"cs_{len(calls['checkout'])}", "url": "https://checkout.stripe.com/c/pay"}

    async def fake_cancel(subscription_id):
        calls["cancel"].append(subscription_id)

    monkeypatch.setattr(billing, "create_checkout", fake_checkout)
    monkeypatch.setattr(billing, "cancel_subscription", fake_cancel)
    return calls


async def member(db, uid):
    return await db.community_members.find_one({"community_id": "c-1", "user_id": uid}, {"_id": 0})


def test_the_signature_check_follows_stripes_scheme(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    request = signed({"id": "evt"}, at=1_700_000_000)
    header = request.headers["stripe-signature"]
    assert billing.verify_signature(request._payload, header, now=1_700_000_100)
    # A tampered body, a replayed old event, another secret, or no header all fail.
    assert not billing.verify_signature(request._payload + b" ", header, now=1_700_000_100)
    assert not billing.verify_signature(request._payload, header, now=1_700_000_000 + 301)
    assert not billing.verify_signature(request._payload, signed({"id": "evt"}, "whsec_other", 1_700_000_000).headers["stripe-signature"], now=1_700_000_000)
    assert not billing.verify_signature(request._payload, "", now=1_700_000_000)
    # While a secret is being rolled Stripe sends two v1 signatures; one match is enough.
    assert billing.verify_signature(request._payload, header.replace("v1=", "v1=deadbeef,v1="), now=1_700_000_000)


def test_checkout_is_refused_when_unconfigured_or_free_and_joining_still_needs_payment(monkeypatch):
    async def scenario(db):
        await paid_setup(db, monkeypatch)
        await expect(402, community.join_community("c-1", account("out")))
        monkeypatch.delenv("STRIPE_SECRET_KEY")
        await expect(503, community.start_checkout("c-1", None, account("out")))
        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
        await expect(409, community.start_checkout("c-1", None, account("mem")))  # already in
        await db.communities.update_one({"id": "c-1"}, {"$set": {"join_policy": "open", "price_cents": 0}})
        await expect(409, community.start_checkout("c-1", None, account("out")))
    run_isolated(scenario)


def test_checkout_opens_a_page_but_grants_nothing_until_stripe_signs(monkeypatch):
    async def scenario(db):
        calls = await paid_setup(db, monkeypatch)
        opened = await community.start_checkout("c-1", None, account("out"))
        assert opened == {"url": "https://checkout.stripe.com/c/pay"}
        sent = calls["checkout"][0]
        assert sent["success_url"] == "https://app.example.test/community/c-1?checkout=success"
        assert await member(db, "out") is None  # coming back to the success URL proves nothing

        forged = signed(completed(), secret="whsec_attacker")
        await expect(400, community.stripe_webhook(forged))
        assert await member(db, "out") is None

        await community.stripe_webhook(signed(completed()))
        row = await member(db, "out")
        assert row["status"] == "active" and row["entitlement_source"] == "payment"
        assert row["stripe_subscription_id"] == "sub_1"
        assert await db.notifications.count_documents({"user_id": "out", "type": "membership"}) == 1

        # Stripe redelivers: acknowledged, nothing happens twice.
        await community.stripe_webhook(signed(completed()))
        assert await db.notifications.count_documents({"user_id": "out", "type": "membership"}) == 1
    run_isolated(scenario)


def test_someone_banned_while_paying_is_not_let_in_and_not_charged_on(monkeypatch):
    async def scenario(db):
        calls = await paid_setup(db, monkeypatch)
        await community.start_checkout("c-1", None, account("out"))
        await db.community_members.insert_one({"id": "m-out", "community_id": "c-1", "user_id": "out", "role": "member", "status": "banned"})
        await community.stripe_webhook(signed(completed()))
        assert (await member(db, "out"))["status"] == "banned"
        assert calls["cancel"] == ["sub_1"]
        assert (await db.community_checkouts.find_one({"id": "cs_1"}))["status"] == "refused"
    run_isolated(scenario)


def test_a_cancelled_or_unpaid_subscription_ends_membership_and_recovery_restores_it(monkeypatch):
    async def scenario(db):
        await paid_setup(db, monkeypatch)
        await community.start_checkout("c-1", None, account("out"))
        await community.stripe_webhook(signed(completed()))

        await community.stripe_webhook(signed(subscription_event("updated", "past_due", event_id="e-a")))
        assert (await member(db, "out"))["status"] == "active"  # Stripe is still retrying the card

        await community.stripe_webhook(signed(subscription_event("updated", "unpaid", event_id="e-b")))
        lapsed = await member(db, "out")
        assert lapsed["status"] == "left" and lapsed["ended_reason"] == "billing"

        await community.stripe_webhook(signed(subscription_event("updated", "active", event_id="e-c")))
        assert (await member(db, "out"))["status"] == "active"

        await community.stripe_webhook(signed(subscription_event("deleted", "canceled", event_id="e-d")))
        assert (await member(db, "out"))["status"] == "left"
    run_isolated(scenario)


def test_leaving_cancels_the_subscription_first_and_a_failure_keeps_you_in(monkeypatch):
    async def scenario(db):
        calls = await paid_setup(db, monkeypatch)
        await community.start_checkout("c-1", None, account("out"))
        await community.stripe_webhook(signed(completed()))

        async def down(_):
            raise billing.BillingError("Stripe unreachable")

        monkeypatch.setattr(billing, "cancel_subscription", down)
        await expect(502, community.leave_community("c-1", account("out")))
        assert (await member(db, "out"))["status"] == "active"

        async def fine(subscription_id):
            calls["cancel"].append(subscription_id)

        monkeypatch.setattr(billing, "cancel_subscription", fine)
        await community.leave_community("c-1", account("out"))
        assert (await member(db, "out"))["status"] == "left" and calls["cancel"] == ["sub_1"]
        # Stripe then confirms the deletion; someone who left stays left, quietly.
        await community.stripe_webhook(signed(subscription_event("deleted", "canceled", event_id="e-x")))
        assert await db.notifications.count_documents({"user_id": "out", "title": {"$regex": "ended"}}) == 0
    run_isolated(scenario)


def test_a_ban_stops_the_billing_and_a_stripe_outage_does_not_stop_the_ban(monkeypatch):
    async def scenario(db):
        calls = await paid_setup(db, monkeypatch)
        for uid, session, sub in (("out", "cs_1", "sub_1"), ("mem2", "cs_2", "sub_2")):
            if uid == "mem2":
                await db.users.insert_one(account("mem2"))
            await community.start_checkout("c-1", None, account(uid))
            await community.stripe_webhook(signed(completed(session, sub, event_id=f"evt-{uid}")))

        out = await member(db, "out")
        await community.review_membership("c-1", out["id"], community.MembershipReviewIn(status="banned"), account("owner"))
        assert calls["cancel"] == ["sub_1"]

        async def down(_):
            raise billing.BillingError("Stripe unreachable")

        monkeypatch.setattr(billing, "cancel_subscription", down)
        other = await member(db, "mem2")
        await community.review_membership("c-1", other["id"], community.MembershipReviewIn(status="removed"), account("owner"))
        removed = await member(db, "mem2")
        assert removed["status"] == "removed" and removed["stripe_cancel_failed"] is True
    run_isolated(scenario)


def test_a_private_paid_community_needs_a_live_invite_to_reach_checkout(monkeypatch):
    async def scenario(db):
        await paid_setup(db, monkeypatch)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"is_public": False}})
        await expect(403, community.start_checkout("c-1", None, account("out")))
        link = await community.create_invite("c-1", community.InviteIn(), account("owner"))
        await community.start_checkout("c-1", community.CheckoutIn(invite_code=link["code"]), account("out"))
        await community.stripe_webhook(signed(completed()))
        assert (await member(db, "out"))["status"] == "active"
        assert (await db.community_invites.find_one({"code": link["code"]}))["uses"] == 1
    run_isolated(scenario)
