"""Staff accounting report.
Reads money already stored in Mongo. It does not call Stripe, open Checkout,
or pay anyone. Amounts stay in the currency on the row: nothing is converted,
and a missing currency is not treated as EUR. An empty window is
`none_in_period` with no totals. One failed read is `unavailable`.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
_CAP = 2000
_PENDING = frozenset({"pending", "unpaid", "processing"})
_PAID = frozenset({"paid", "paid_out"})
_REFERRAL_PENDING = frozenset({"pending", "activated"})
_REWARDED = frozenset({"rewarded"})
_REFUNDS = frozenset({"charge.refunded", "refund.created", "refund.updated", "charge.refund.updated"})
_CHARGEBACKS = frozenset({
    "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
    "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
})
_PREFIXES = ("cs_", "pi_", "ch_", "evt_", "sub_", "po_", "tr_", "py_", "in_", "re_", "dp_", "txn_")
_NONE = {"state": "none_in_period"}
_DOWN = {"state": "unavailable"}
def resolve_period(from_day: date | None, to_day: date | None, *, today: date | None = None):
    """Inclusive calendar days, UTC. Defaults to the last 30 days ending today."""
    end_day = to_day or (today or server.now().date())
    start_day = from_day or (end_day - timedelta(days=29))
    if end_day < start_day:
        raise ValueError("to is before from")
    if (end_day - start_day).days > 366:
        raise ValueError("period is longer than 366 days")
    start = datetime(start_day.year, start_day.month, start_day.day, tzinfo=timezone.utc)
    end = datetime(end_day.year, end_day.month, end_day.day, tzinfo=timezone.utc) + timedelta(days=1)
    return start_day, end_day, start, end
def _currency(value: object) -> str | None:
    text = value.strip().upper() if isinstance(value, str) else ""
    return text if len(text) == 3 and text.isalpha() else None
def _when(row: dict, keys: tuple[str, ...]) -> datetime | None:
    for key in keys:
        value = row.get(key)
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None
def _stripe_id(row: dict) -> str | None:
    for key in ("stripe_id", "provider_subscription_id", "provider_payout_id", "subscription_id", "id"):
        value = row.get(key)
        if isinstance(value, str) and value.startswith(_PREFIXES):
            return value
    return None
def _first_int(row: dict, keys: tuple[str, ...]) -> int | None:
    for key in keys:
        if key in row:
            return row[key] if type(row[key]) is int else None
    return None
def _sorted(groups: dict[str | None, int]):
    return sorted(groups.items(), key=lambda item: (item[0] is None, item[0] or ""))
def _totals(rows: list[dict] | None, parse) -> dict:
    if rows is None:
        return dict(_DOWN)
    if not rows:
        return dict(_NONE)
    groups: dict[str | None, int] = {}
    bad = False
    for row in rows:
        kind, cents, currency = parse(row)
        if kind == "bad":
            bad = True
        elif kind == "ok":
            groups[currency] = groups.get(currency, 0) + cents
    if bad:
        return {"state": "recorded", "amounts_stored": False, "row_count": len(rows)}
    if not groups:
        return dict(_NONE)
    return {"state": "recorded", "amounts_stored": True, "totals": [
        {"amount_cents": cents, "currency": currency} for currency, cents in _sorted(groups)
    ]}
def _positive(row: dict, *keys: str) -> tuple:
    if not any(key in row for key in keys):
        return ("bad", 0, None)
    raw = _first_int(row, keys)
    if raw is None:
        return ("bad", 0, None)
    if raw <= 0:
        return ("skip", 0, None)
    source = row.get("currency") if "currency" in row else row.get("reward_currency")
    return ("ok", raw, _currency(source))
def _fee(row: dict) -> tuple:
    gross, net = row.get("gross_cents"), row.get("net_cents")
    if type(gross) is not int or type(net) is not int:
        return ("bad", 0, None)
    if gross == net:
        return ("skip", 0, None)
    return ("ok", gross - net, _currency(row.get("currency")))
def _owed(row: dict) -> tuple:
    if row.get("status") not in {"available", "pending"}:
        return ("skip", 0, None)
    return _positive(row, "net_cents")
def _reward(row: dict) -> tuple:
    parsed = _positive(row, "reward_amount_cents")
    return parsed if parsed[0] != "ok" else ("ok", parsed[1], _currency(row.get("reward_currency")))
async def _load(name: str, query: dict) -> list[dict] | None:
    try:
        rows = await server.db[name].find(query, {"_id": 0}).limit(_CAP + 1).to_list(_CAP + 1)
    except Exception:
        return None
    return None if len(rows) > _CAP else rows
def _window(start: datetime, end: datetime, keys: tuple[str, ...]) -> dict:
    return {"$or": [{key: {"$gte": start, "$lt": end}} for key in keys]}
def _add(lines, rows, kind, when_keys, status_key, cents_keys, currency_key, *, drop_nonpositive=False):
    for row in rows or []:
        cents = _first_int(row, cents_keys)
        if drop_nonpositive and (cents is None or cents <= 0):
            continue
        when = _when(row, when_keys)
        status = row.get(status_key)
        lines.append({
            "kind": kind, "stripe_id": _stripe_id(row), "currency": _currency(row.get(currency_key)),
            "cents": cents, "when": when.isoformat() if when else None,
            "status": status if isinstance(status, str) else None,
        })
def _subs(rows: list[dict] | None, start: datetime, end: datetime) -> list[dict] | None:
    if rows is None:
        return None
    kept = []
    for row in rows:
        if row.get("provider") not in (None, "stripe"):
            continue
        begin = _when(row, ("current_period_start", "created_at"))
        finish = _when(row, ("current_period_end",))
        if begin and finish and begin < end and finish > start:
            kept.append(row)
        elif begin and not finish and start <= begin < end:
            kept.append(row)
    return kept
def _counts(rows: list[dict] | None) -> dict:
    if rows is None:
        return dict(_DOWN)
    if not rows:
        return dict(_NONE)
    groups: dict[str | None, int] = {}
    for row in rows:
        currency = _currency(row.get("currency"))
        groups[currency] = groups.get(currency, 0) + 1
    return {"state": "recorded", "counts": [{"currency": currency, "count": count} for currency, count in _sorted(groups)]}
def _split(rows, pending, paid, parse) -> dict:
    if rows is None:
        return {"pending": dict(_DOWN), "paid": dict(_DOWN)}
    return {
        "pending": _totals([row for row in rows if row.get("status") in pending], parse),
        "paid": _totals([row for row in rows if row.get("status") in paid], parse),
    }
def _of_type(rows, types):
    if rows is None:
        return None
    return [row for row in rows if row.get("type") in types]

async def summary(start: datetime, end: datetime, start_day: date, end_day: date) -> dict:
    checkouts = await _load("community_checkouts", _window(start, end, ("updated_at", "created_at")))
    events = await _load("billing_events", _window(start, end, ("received_at",)))
    ledger = await _load("partner_ledger", _window(start, end, ("created_at", "updated_at", "occurred_at")))
    referrals = await _load("referrals", _window(start, end, ("activated_at", "created_at")))
    commissions = await _load("commissions", _window(start, end, ("paid_at", "created_at", "updated_at")))
    subscriptions = _subs(await _load("subscriptions", {"status": {"$in": ["active", "trialing"]}}), start, end)
    lines: list[dict] = []
    _add(lines, checkouts, "checkout", ("updated_at", "created_at"), "status", ("amount_cents",), "currency")
    _add(lines, events, "billing_event", ("received_at",), "type", ("amount_cents", "amount"), "currency")
    _add(lines, ledger, "partner_ledger", ("created_at", "updated_at", "occurred_at"), "status", ("net_cents",), "currency")
    _add(lines, commissions, "commission", ("paid_at", "created_at", "updated_at"), "status", ("amount_cents", "cents"), "currency")
    _add(lines, referrals, "referral", ("activated_at", "created_at"), "status", ("reward_amount_cents",), "reward_currency", drop_nonpositive=True)
    _add(lines, subscriptions, "subscription", ("current_period_start", "created_at"), "status", (), "currency")
    lines.sort(key=lambda line: line["when"] or "", reverse=True)
    completed = [row for row in checkouts if row.get("status") == "completed"] if checkouts is not None else None
    amount = lambda row: _positive(row, "amount_cents", "amount")
    return {
        "period": {"from": start_day.isoformat(), "to": end_day.isoformat()},
        "generated_at": server.now(),
        "sections": {
            "gross_collected": _totals(completed, lambda row: _positive(row, "amount_cents")),
            "platform_fees": _totals(ledger, _fee),
            "owed_to_coaches": _totals(ledger, _owed),
            "refunds": _totals(_of_type(events, _REFUNDS), amount),
            "chargebacks": _totals(_of_type(events, _CHARGEBACKS), amount),
            "commissions": _split(commissions, _PENDING, _PAID, lambda row: _positive(row, "amount_cents", "cents")),
            "referrals": _split(referrals, _REFERRAL_PENDING, _REWARDED, _reward),
            "active_subscriptions": _counts(subscriptions),
        },
        "recent_lines": lines[:40],
    }
import server  # noqa: E402  — server imports the routers, which import this module.
