# Community rankings and billing boundary

## Activity discovery

- Profile exposes `activity_ranking_opt_in`, false for new and existing users
  unless explicitly enabled. PATCH updates preserve the existing locale.
- Community managers can toggle channel `ranking_opt_in` through
  `PATCH /api/channels/{id}/ranking`. It is false when absent. Private
  communities cannot enable it; changing a community to private excludes it
  immediately from public ranking reads.
- Top users: distinct UTC activity dates in the rolling last 30 days, not message
  volume. Top channels: distinct consenting contributors in the same window.
- Only active messages in active, opted-in channels of active public communities
  count. Authors must currently consent and have active community membership.
- Consent includes qualifying activity already present in the rolling window.
  Opt-out excludes it on the next request; already loaded screens can retain
  the previous response until refreshed.
- Rankings publish names and aggregate counts, never messages, email, health data
  or membership lists. Channel links lead to the community join/detail screen;
  ranking publication does not grant message access.
- Community/coach membership rankings now aggregate all public communities before
  selecting ten results. Ties use stable IDs. Membership counts are memberships,
  not deduplicated individuals across communities.

## Paid communities: Stripe Checkout + signed webhooks

`backend/billing.py` talks to Stripe's REST API with httpx, with no SDK. Money goes to
**the platform's Stripe account** as a monthly subscription at the community's
`price_cents`/`currency`, with the price sent inline, so nothing has to be set up in the dashboard.

- `POST /api/communities/{id}/checkout` opens a hosted Checkout page and records
  it in `community_checkouts`. It grants nothing. It returns 503 while Stripe is not
  configured. It refuses banned and already-active members. A private paid community needs
  a live invite code.
- `POST /api/billing/stripe/webhook` is the **only** way to activate a paid membership.
  It verifies `Stripe-Signature` (HMAC-SHA256, 5-minute replay window, several `v1`
  values accepted during secret rotation). Event ids go into `billing_events`, so a
  redelivered event is acknowledged without being applied twice.
  - `checkout.session.completed` activates through `_activate(source="payment")`.
    A ban that lands during checkout, a missing community, or a second subscription
    gets the new subscription cancelled instead.
  - `customer.subscription.updated` to `canceled`/`unpaid`/`incomplete_expired`, or
    `customer.subscription.deleted`, ends the membership (`status: left`,
    `ended_reason: billing`) and notifies the member. `past_due` changes nothing while
    Stripe retries the card, and a recovery to `active` restores access.
- Leaving cancels the subscription first; if Stripe is down the member stays in and
  gets a 502. A ban/removal always takes effect; if the cancel fails, the row gets
  `stripe_cancel_failed: true` to finish by hand. A member who becomes owner stops paying.
- Join, invite redemption and manual approval still return 402 for paid communities.
  Switching an existing community between paid and free still needs a migration (409).

### Configuration (secrets live outside git)

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` first, then `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of an endpoint pointing at `https://<api>/api/billing/stripe/webhook`, subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` |
| `PUBLIC_APP_URL` | Web app origin Stripe returns to (`/community/{id}?checkout=success`) |

For local testing: `stripe listen --forward-to localhost:8001/api/billing/stripe/webhook`
prints a `whsec_` for the session.

### Business decisions still open (not code)

- **Paying coaches.** Everything is collected by the platform account. Paying
  community owners automatically needs Stripe Connect onboarding plus a platform-fee
  percentage — choose the fee and merchant-of-record model first.
- **Refunds and disputes** are handled in the Stripe dashboard. Cancelling there
  sends `customer.subscription.deleted`, which removes access automatically.
- **Tax.** Stripe Tax can be switched on per account; no tax is computed here.
- The app-wide Pro plan is Stripe Checkout (`POST /api/subscriptions/checkout`). `POST /api/subscriptions` still cannot mint a paid plan.

## Verification

Backend `tests/test_community_rankings.py` uses unique local Mongo test databases
and exact test-run cleanup; it does not call the running API or write to ironflow.
It covers consent, private/archived/banned/left exclusions, 105-community ordering,
publication authorization, profile compatibility and paid-access guards.

Frontend `yarn test:community` uses synthetic API fixtures on desktop/mobile.
Live API deployment, actual provider integration and native-device acceptance are
separate checks. Restart the intended feature-worktree backend to load these routes;
do not accidentally start the main or stabilization checkout.