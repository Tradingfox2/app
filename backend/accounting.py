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


class _Loaded:
    """Rows from one collection. `truncated` means the read stopped at `_CAP`."""

    __slots__ = ("rows", "truncated")

    def __init__(self, rows: list[dict], truncated: bool) -> None:
        self.rows = rows
        self.truncated = truncated


def _take(loaded: _Loaded | None) -> tuple[list[dict] | None, bool]:
    if loaded is None:
        return None, False
    return loaded.rows, loaded.truncated
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
    for key in ("stripe_id", "stripe_subscription_id", "provider_subscription_id", "provider_payout_id", "subscription_id", "id"):
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
def _totals(rows: list[dict] | None, parse, *, truncated: bool = False) -> dict:
    """Per-currency totals. Currencies are never added together.

    A section whose rows all lack an amount stays `recorded` with
    `amounts_stored` false. A mix of readable and unreadable rows, or a read
    that stopped at the cap, is `incomplete` and still returns the totals that
    could be read.
    """
    if rows is None:
        return dict(_DOWN)
    if not rows and not truncated:
        return dict(_NONE)
    groups: dict[str | None, int] = {}
    bad = 0
    for row in rows:
        kind, cents, currency = parse(row)
        if kind == "bad":
            bad += 1
        elif kind == "ok":
            groups[currency] = groups.get(currency, 0) + cents
    if not groups:
        # Every row lacked an amount. That stays `recorded` with
        # `amounts_stored` false. A cap on top of that is incomplete.
        if bad and not truncated:
            return {"state": "recorded", "amounts_stored": False, "row_count": len(rows)}
        if truncated:
            result = {"state": "incomplete", "reason": "row_cap", "amounts_stored": False, "row_count": len(rows)}
            if bad:
                result["incomplete_rows"] = bad
            return result
        return dict(_NONE)
    result = {"state": "recorded", "amounts_stored": True, "totals": [
        {"amount_cents": cents, "currency": currency} for currency, cents in _sorted(groups)
    ]}
    if bad:
        result = {
            "state": "incomplete",
            "reason": "malformed_rows",
            "amounts_stored": True,
            "incomplete_rows": bad,
            "totals": result["totals"],
        }
    if truncated:
        result["state"] = "incomplete"
        result["reason"] = "row_cap"
    return result
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
async def _load(name: str, query: dict) -> _Loaded | None:
    try:
        rows = await server.db[name].find(query, {"_id": 0}).limit(_CAP + 1).to_list(_CAP + 1)
    except Exception:
        return None
    if len(rows) > _CAP:
        return _Loaded(rows[:_CAP], True)
    return _Loaded(rows, False)
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
def _channel(row: dict) -> str | None:
    """A missing provider is Stripe. RevenueCat is the store channel. Anything else is dropped."""
    value = row.get("provider")
    if value in (None, "stripe"):
        return "stripe"
    return "revenuecat" if value == "revenuecat" else None
def _subs(rows: list[dict] | None, start: datetime, end: datetime) -> list[dict] | None:
    if rows is None:
        return None
    kept = []
    for row in rows:
        if _channel(row) is None:
            continue
        begin = _when(row, ("current_period_start", "created_at"))
        finish = _when(row, ("current_period_end",))
        if begin and finish and begin < end and finish > start:
            kept.append(row)
        elif begin and not finish and start <= begin < end:
            kept.append(row)
    return kept
def _counts(rows: list[dict] | None, *, truncated: bool = False) -> dict:
    if rows is None:
        return dict(_DOWN)
    if not rows and not truncated:
        return dict(_NONE)
    groups: dict[str | None, int] = {}
    for row in rows:
        currency = _currency(row.get("currency"))
        groups[currency] = groups.get(currency, 0) + 1
    result = {"state": "recorded", "counts": [{"currency": currency, "count": count} for currency, count in _sorted(groups)]}
    if truncated:
        result["state"] = "incomplete"
        result["reason"] = "row_cap"
    return result
_PLAN_KEYS = ("pro_monthly", "pro_yearly", "other")
def _plan_key(row: dict) -> str:
    plan = row.get("plan")
    return plan if plan in ("pro_monthly", "pro_yearly") else "other"
def _by_plan(rows: list[dict], *, truncated: bool = False) -> dict:
    grouped: dict[str, list[dict]] = {key: [] for key in _PLAN_KEYS}
    for row in rows:
        grouped[_plan_key(row)].append(row)
    parse = lambda row: _positive(row, "amount_cents")
    # The cap applies to the subscription read, not to one plan. Every plan
    # built from a capped read is incomplete, including a plan with no rows
    # in the slice that was loaded.
    return {key: _totals(grouped[key], parse, truncated=truncated) for key in _PLAN_KEYS}
def _subscription_amounts(rows: list[dict] | None, *, truncated: bool = False) -> dict:
    """Last amount on file, split by channel and plan. Plans are never added together."""
    if rows is None:
        blank = lambda: {key: dict(_DOWN) for key in _PLAN_KEYS}
        return {"stripe": blank(), "revenuecat": blank()}
    return {
        "stripe": _by_plan([row for row in rows if _channel(row) == "stripe"], truncated=truncated),
        "revenuecat": _by_plan([row for row in rows if _channel(row) == "revenuecat"], truncated=truncated),
    }
def _gym_amount(row: dict) -> tuple:
    """Current gym Stripe amount. A row with no integer amount does not invent one."""
    billing = row.get("billing")
    if not isinstance(billing, dict) or "amount_cents" not in billing:
        return ("skip", 0, None)
    raw = billing.get("amount_cents")
    if type(raw) is not int:
        return ("bad", 0, None)
    if raw <= 0:
        return ("skip", 0, None)
    return ("ok", raw, _currency(billing.get("currency")))
def _clawed(rows, parse, *, truncated: bool = False) -> dict:
    if rows is None:
        return dict(_DOWN)
    return _totals([row for row in rows if row.get("status") == "clawed_back"], parse, truncated=truncated)
def _split(rows, pending, paid, parse, *, truncated: bool = False) -> dict:
    if rows is None:
        return {"pending": dict(_DOWN), "paid": dict(_DOWN)}
    return {
        "pending": _totals([row for row in rows if row.get("status") in pending], parse, truncated=truncated),
        "paid": _totals([row for row in rows if row.get("status") in paid], parse, truncated=truncated),
    }
def _of_type(rows, types):
    if rows is None:
        return None
    return [row for row in rows if row.get("type") in types]

async def summary(start: datetime, end: datetime, start_day: date, end_day: date) -> dict:
    checkouts, checkouts_capped = _take(await _load("community_checkouts", _window(start, end, ("updated_at", "created_at"))))
    events, events_capped = _take(await _load("billing_events", _window(start, end, ("received_at",))))
    ledger, ledger_capped = _take(await _load("partner_ledger", _window(start, end, ("created_at", "updated_at", "occurred_at"))))
    referrals, referrals_capped = _take(await _load("referrals", _window(start, end, ("activated_at", "created_at"))))
    commissions, commissions_capped = _take(await _load("commissions", _window(start, end, ("paid_at", "created_at", "updated_at", "clawed_back_at"))))
    subscription_rows, subscriptions_capped = _take(await _load("subscriptions", {"status": {"$in": ["active", "trialing"]}}))
    subscriptions = _subs(subscription_rows, start, end)
    gyms, gyms_capped = _take(await _load("gyms", {"billing.amount_cents": {"$exists": True}}))
    lines: list[dict] = []
    _add(lines, checkouts, "checkout", ("updated_at", "created_at"), "status", ("amount_cents",), "currency")
    _add(lines, events, "billing_event", ("received_at",), "type", ("amount_cents", "amount"), "currency")
    _add(lines, ledger, "partner_ledger", ("created_at", "updated_at", "occurred_at"), "status", ("net_cents",), "currency")
    _add(lines, commissions, "commission", ("paid_at", "clawed_back_at", "created_at", "updated_at"), "status", ("amount_cents", "cents"), "currency")
    _add(lines, referrals, "referral", ("activated_at", "created_at"), "status", ("reward_amount_cents",), "reward_currency", drop_nonpositive=True)
    for row in subscriptions or []:
        kind = "store_subscription" if row.get("provider") == "revenuecat" else "subscription"
        _add(lines, [row], kind, ("current_period_start", "created_at"), "status", ("amount_cents",), "currency")
    lines.sort(key=lambda line: line["when"] or "", reverse=True)
    completed = [row for row in checkouts if row.get("status") == "completed"] if checkouts is not None else None
    amount = lambda row: _positive(row, "amount_cents", "amount")
    commission_amount = lambda row: _positive(row, "amount_cents", "cents")
    commission_sections = _split(commissions, _PENDING, _PAID, commission_amount, truncated=commissions_capped)
    commission_sections["clawed_back"] = _clawed(commissions, commission_amount, truncated=commissions_capped)
    subscription_amounts = _subscription_amounts(subscriptions, truncated=subscriptions_capped)
    if subscriptions_capped:
        subscription_amounts = {**subscription_amounts, "state": "incomplete", "reason": "row_cap"}
    return {
        "period": {"from": start_day.isoformat(), "to": end_day.isoformat()},
        "generated_at": server.now(),
        "sections": {
            "gross_collected": _totals(completed, lambda row: _positive(row, "amount_cents"), truncated=checkouts_capped),
            "platform_fees": _totals(ledger, _fee, truncated=ledger_capped),
            "owed_to_coaches": _totals(ledger, _owed, truncated=ledger_capped),
            "refunds": _totals(_of_type(events, _REFUNDS), amount, truncated=events_capped),
            "chargebacks": _totals(_of_type(events, _CHARGEBACKS), amount, truncated=events_capped),
            "commissions": commission_sections,
            "referrals": _split(referrals, _REFERRAL_PENDING, _REWARDED, _reward, truncated=referrals_capped),
            "subscription_amounts": subscription_amounts,
            "gym_partner_plans": _totals(gyms, _gym_amount, truncated=gyms_capped),
            "active_subscriptions": _counts(subscriptions, truncated=subscriptions_capped),
        },
        "recent_lines": lines[:40],
    }
import server  # noqa: E402  — server imports the routers, which import this module.
