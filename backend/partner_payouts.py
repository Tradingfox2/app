"""Coach ledger payout states, driven by Stripe Connect payout events.

How the money moves today: a paid community uses a destination charge, so
Stripe moves the coach's share to their Express account when the invoice is
paid, and `partner_ledger` gets a row with status `available`. The coach's
bank only receives it when Stripe pays out that connected account. Stripe
reports that with `payout.paid` / `payout.failed` / `payout.canceled`, sent to
a Connect webhook endpoint with `event.account` set to the coach's acct_ id.

A payout is a lump sum, not a list of invoices. Rows are matched first in,
first out: the oldest `available` rows in the payout currency are marked
`paid_out` while their net fits inside the payout amount. A row that does not
fully fit stays `available` for the next payout. A failed or cancelled payout
puts its rows back to `available`. This is an approximation until the ledger
reads the payout's balance transactions; it never marks more than was paid.

Statuses: available -> paid_out (payout.paid) -> available (payout.failed or
payout.canceled for that same payout).
"""
from __future__ import annotations

from datetime import datetime, timezone

PAID = "payout.paid"
REVERSED = frozenset({"payout.failed", "payout.canceled"})
EVENTS = frozenset({PAID}) | REVERSED
_CAP = 2000


class PartnerPayouts:
    """Marks `partner_ledger` rows from Connect payout events. Mongo is the writer."""

    @staticmethod
    def handles(event: dict) -> bool:
        account = event.get("account")
        return event.get("type") in EVENTS and isinstance(account, str) and account.startswith("acct_")

    @staticmethod
    def fifo(rows: list[dict], amount: int) -> list[dict]:
        """Oldest rows whose cumulative net fits in `amount`. Stops at the first that does not."""
        picked, left = [], amount
        for row in rows:
            net = row.get("net_cents")
            if type(net) is not int or net <= 0:
                continue
            if net > left:
                break
            picked.append(row)
            left -= net
        return picked

    @staticmethod
    def _currency_query(currency: str) -> dict:
        return {"$in": sorted({currency.lower(), currency.upper()})}

    @staticmethod
    async def apply(event: dict) -> int:
        """Apply one Connect payout event. Returns how many ledger rows changed."""
        if not PartnerPayouts.handles(event):
            return 0
        payout = (event.get("data") or {}).get("object") or {}
        payout_id = payout.get("id")
        if not isinstance(payout_id, str) or not payout_id.startswith("po_"):
            return 0
        owner = await server.db.users.find_one(
            {"stripe_account_id": event["account"]}, {"_id": 0, "id": 1})
        owner_id = (owner or {}).get("id")
        if not isinstance(owner_id, str):
            return 0
        if event["type"] in REVERSED:
            result = await server.db.partner_ledger.update_many(
                {"partner_id": owner_id, "payout_id": payout_id, "status": "paid_out"},
                {"$set": {"status": "available", "updated_at": server.now()},
                 "$unset": {"payout_id": "", "paid_out_at": ""}},
            )
            return result.modified_count
        amount, currency = payout.get("amount"), payout.get("currency")
        if type(amount) is not int or amount <= 0 or not isinstance(currency, str) or not currency.strip():
            return 0
        if await server.db.partner_ledger.find_one({"payout_id": payout_id}, {"_id": 1}):
            return 0  # this payout was already matched
        rows = await server.db.partner_ledger.find(
            {"partner_id": owner_id, "status": "available", "currency": PartnerPayouts._currency_query(currency.strip())},
            {"_id": 0, "stripe_id": 1, "net_cents": 1, "created_at": 1},
        ).sort("created_at", 1).limit(_CAP).to_list(_CAP)
        picked = PartnerPayouts.fifo(rows, amount)
        when = payout.get("arrival_date")
        paid_at = datetime.fromtimestamp(when, timezone.utc) if type(when) is int else server.now()
        changed = 0
        for row in picked:
            result = await server.db.partner_ledger.update_one(
                {"stripe_id": row["stripe_id"], "status": "available"},
                {"$set": {"status": "paid_out", "payout_id": payout_id, "paid_out_at": paid_at, "updated_at": server.now()}},
            )
            changed += result.modified_count
        return changed


import server  # noqa: E402  — server imports the routers, which import this module.
