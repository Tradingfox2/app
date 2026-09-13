# Community browser regressions

Run `yarn test:community` from the feature worktree's frontend directory.
Install the runner's browser once with `npx playwright install chromium`.
The configuration starts Expo on localhost:8082, or reuses a running server
outside CI. Ensure any reused server serves this same worktree.

All API requests are intercepted with synthetic fixtures, including writes.
No real account, database, billing provider or production credentials are used.
These tests exercise the real React Native Web screens, not backend authorization.

## Verified scenarios

Each scenario runs in Chromium at desktop (1440×900) and mobile (390×844) sizes:

- Discovery failure is visible instead of appearing as an empty community list;
  retry restores content, and coach/ranking tabs render without page overflow.
- A pending membership review disables duplicate submissions, preserves the
  request after failure, and clears the error after a successful retry.
- A delayed message poll cannot overwrite a newer send; subsequent polling does
  not duplicate the message.
- A failed send preserves the draft; retry clears the error and draft.
- Channel creation is single-flight, preserves the name after failure, and
  recovers on retry. Input bounds match the backend contract.

Additional scenarios cover user consent persistence, manager-controlled channel
publication, top-user/channel rendering, and paid-plan refusal feedback.
Screenshots and traces are retained on failure in ignored test-results output.

## Limits

This is browser regression coverage, not native-device acceptance or a complete
visual audit. The existing backend authorization/integration tests remain
separate and were not rerun for this frontend-only reliability slice.

Verified checkout, payouts and optional multilevel referral settlement are not
delivered by these changes. Top-user/channel rankings require explicit consent.
Paid memberships
must remain locked until verified billing is integrated. No private-feed,
coach-approval or channel entitlement checks were relaxed.