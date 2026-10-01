# IronFlow Partners

Compensation for introducing someone who later pays. Creating an account is not a reward.

## Who is paid

`POST /api/auth/register` accepts an optional `referral_code`. When the code matches a referrer's code, the new user stores `users.referred_by`. An unknown code does not fail signup and does not set the field. No commission is written at signup.

## When it pays

The signed Stripe webhook is unchanged in how it checks `Stripe-Signature`. After that check, the first **paid** invoice for a referred user (`invoice.paid` with `amount_paid` greater than zero) writes `commissions`. A zero trial invoice does not count, so the first invoice that actually collects money is the one that pays. A later invoice for the same person does not pay again. There is no third level.

| Level | Who | Rate |
| --- | --- | --- |
| 1 | The direct referrer (`referred_by`) | 20% of that invoice |
| 2 | The referrer's referrer | 5% of that invoice |

`amount_cents` is the invoice amount in Stripe's minor unit, times the rate, integer division. A percent that rounds down to zero cents is not written, and that invoice still counts as the first one, so a later invoice does not pay either. The currency is the invoice currency. Totals are not converted, and a missing amount is not treated as zero.

`kind` is `pro` for the app-wide Pro plan and `club` for a paid community membership.

## How it is delivered

An athlete, and anyone who is not a connected partner, receives **Pro credit days**, not cash. Days are the same percent of the invoice's billed period (`lines.data[0].period`). The days extend `users.pro_credit_until`, which `require_pro` honors while it is still in the future. The ledger row is `status: paid`, `reward: pro_credit_days`.

A connected partner is an approved coach whose `users.payout_status` is `connected`. Their row is `status: pending`, `reward: cash`, for the same percent of the invoice. Nothing here sends that cash. `payout_status` is not set by this program.

## Clawback

`charge.refunded` sets matching rows to `status: clawed_back`. A partial refund claws back the whole commission. Credit days granted for that row are removed. Clawed-back rows are not pending and not paid.

## What you see

`GET /api/referrals/mine` returns the code, how many people you referred, how many of those still have an open commission, and the pending and paid totals. Each currency is its own total. Settings loads this only after you ask, and shares `ironflow://join?ref=CODE`.

## Earnings disclosure

<!-- EARNINGS DISCLOSURE: to be supplied by the business -->

This placeholder is not an income claim. Past payments are not a promise of future earnings.

## Open decisions

- Cash rows stay `pending` until a payout path exists. This program does not add Stripe Connect, Mobile Money, or XAF.
- The staff accounting report reads `commissions` in the stored currency. Credit-day rows that are `paid` appear in the paid total at `amount_cents`; `reward` tells them apart from cash.
- The Stripe endpoint must also receive `invoice.paid` and `charge.refunded`. Signature verification is the same check as every other event.
