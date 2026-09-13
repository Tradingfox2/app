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

## Billing remains fail-closed

No checkout, payout or referral commission is enabled by this change.

- Paid membership activation is blocked through both join and manual approval.
- Switching between paid and non-paid policies requires a future explicit billing
  migration; metadata updates cannot silently migrate existing members.
- The legacy platform subscription endpoint no longer creates paid access from
  client-selected plans, or locally cancels a paid provider subscription.
- Existing subscription/membership records are not rewritten. Previously created
  unverified records need an operator-reviewed audit before production launch.

Stripe is listed in backend dependencies but there is no connected merchant
configuration or approved commission policy. The recommended next stage is Stripe
Connect **test mode**, direct memberships only, with commissions disabled. This
is a recommendation, not an implemented payment integration.

Before enabling payments: choose merchant ownership, supported jurisdictions and
currencies, platform fees, refund/cancellation policy, tax handling, and connected
account onboarding. Configure secrets outside source control. Implement signed
webhooks, idempotent ledger entries, entitlement expiry/revocation, refund/dispute
reversals and provider reconciliation before activating access or funds movement.
Optional multilevel commissions additionally require agreed bounded levels/rates,
eligibility, anti-self-referral/cycle controls and jurisdictional review.

## Verification

Backend `tests/test_community_rankings.py` uses unique local Mongo test databases
and exact test-run cleanup; it does not call the running API or write to ironflow.
It covers consent, private/archived/banned/left exclusions, 105-community ordering,
publication authorization, profile compatibility and paid-access guards.

Frontend `yarn test:community` uses synthetic API fixtures on desktop/mobile.
Live API deployment, actual provider integration and native-device acceptance are
separate checks. Restart the intended feature-worktree backend to load these routes;
do not accidentally start the main or stabilization checkout.