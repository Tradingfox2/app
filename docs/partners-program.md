# IronFlow Partners

Compensation for introducing someone who later pays. Creating an account is not a reward.

## Who is paid

`POST /api/auth/register` accepts an optional `referral_code`. When the code matches a referrer's code, the new user stores `users.referred_by`. An unknown code does not fail signup and does not set the field. No commission is written at signup.

## When it pays

The signed Stripe webhook is unchanged in how it checks `Stripe-Signature`. After that check, the first **paid** invoice for a referred user (`invoice.paid` with `amount_paid` greater than zero) writes `commissions`. A zero trial invoice does not count, so the first invoice that actually collects money is the one that pays. A later invoice for the same person does not pay again.

**Single level only.** The direct referrer (`referred_by`) is paid. Their own referrer is not.

| Who | Rate | Base |
| --- | --- | --- |
| The direct referrer | `REFERRAL_RATE_PERCENT`, default 20% | invoice `amount_paid` minus tax |

The base excludes tax (`tax`, else `total_taxes`, else `total_tax_amounts` on the invoice), so no reward is paid on VAT. `amount_cents` is that base in Stripe's minor unit, times the rate, integer division. Each row stores `base_cents` and `rate_percent`. A percent that rounds down to zero cents is not written, and that invoice still counts as the first one, so a later invoice does not pay either. The currency is the invoice currency. Totals are not converted, and a missing amount is not treated as zero.

`kind` is `pro` for the app-wide Pro plan and `club` for a paid community membership.

## How it is delivered

An athlete, and anyone who is not a connected partner, receives **Pro credit days**, not cash. Days are the same percent of the invoice's billed period (`lines.data[0].period`). The days extend `users.pro_credit_until`, which `require_pro` honors while it is still in the future. The ledger row is `status: paid`, `reward: pro_credit_days`.

A connected partner is an approved coach whose `users.payout_status` is `connected`. Their row is `status: pending`, `reward: cash`, for the same percent of the invoice. Nothing here sends that cash, and who funds it is still an open decision. `payout_status` is written by `GET /api/partner/connect/status` once Stripe reports `charges_enabled` and `payouts_enabled` on the coach's Express account.

## Clawback

`charge.refunded` claws back in proportion to the refund. Stripe sends the cumulative `amount_refunded`, so the row keeps `clawed_back_cents` and `clawed_back_days` and each event only claws the difference. A partial refund leaves the row open with the remainder; a full refund (or a charge without amounts) sets `status: clawed_back`. Credit days are removed in the same proportion. Clawed-back rows are not pending and not paid.

## What you see

`GET /api/referrals/mine` returns the code, how many people you referred, how many of those still have an open commission, and the pending and paid totals. Each currency is its own total. Settings loads this only after you ask, and shares `ironflow://join?ref=CODE`.

## Earnings disclosure

<!-- EARNINGS DISCLOSURE: to be supplied by the business -->

This placeholder is not an income claim. Past payments are not a promise of future earnings.

## Open decisions

- Cash rows stay `pending` until a payout path exists. This program does not add Stripe Connect, Mobile Money, or XAF.
- The staff accounting report reads `commissions` in the stored currency. Credit-day rows that are `paid` appear in the paid total at `amount_cents`; `reward` tells them apart from cash.
- The Stripe endpoint must also receive `invoice.paid` and `charge.refunded`. Signature verification is the same check as every other event.
