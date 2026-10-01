# Confirmed Quality Issues

> Repository memory for the IronFlow Cartographer. Facts only, each with file
> and symbol evidence. Remove an entry when it is fixed and verified.

## Open

### Centrifugo is not deployed (deferred by the owner)
`deploy/centrifugo/config.json` (v6) is the template. It was verified on
2026-09-15 with a local v6.9.6 run: tokenless room subscribe was refused (103),
the API token admitted, the `user:` channel was delivered server-side, and
another member's `user:` channel was refused. **Keep it free of
`allow_subscribe_for_client`** on the `channel` namespace. Until it is deployed,
every realtime path falls back to polling.

### Push needs an EAS project id and FCM/APNs credentials
`frontend/src/push.ts` reads `expo.extra.eas.projectId`, then
`EXPO_PUBLIC_EAS_PROJECT_ID`. Setup steps are in `frontend/README.md`. Without an
id, push stays off and the in-app centre still works. It never loads in Expo Go
(see below). Verified 2026-09-15.

### Paid communities pay the platform account only
`backend/billing.py` + `community.start_checkout` / `stripe_webhook` are live
once `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set; without them checkout
returns 503. Coach payouts (Stripe Connect, platform fee), refunds and disputes
(dashboard), and tax are **business decisions still open**; see
`docs/community-rankings-and-billing.md`. It has not been run against a real Stripe
account yet; only a fake-key call confirmed transport and error parsing.

### ESLint had no ignore for generated test artifacts
**Fixed 2026-09-14.** `frontend/test-results/` holds Playwright trace bundles,
including minified JS. ESLint does not read `.gitignore`, so a single failed
browser run left 166 lint errors on disk and broke the lint gate — and CI —
until someone deleted them by hand. `eslint.config.js` now ignores
`test-results/**`, `playwright-report/**` and `.expo/**`.

**Precedent:** a lint gate that reads generated output fails on a schedule
nobody controls. Ignore artifact directories explicitly; `.gitignore` is not
enough.

## Fixed — kept as precedent

### Home week card painted zeros and an endless skeleton (2026-10-01)
`training-week-card` used `?? 0` and left `home-stats-skeleton` up after
`GET /home/today` failed. `readTrainingTotals` now refuses a partial block,
the card shows `week-retry` or `week-empty`, and the calendar is the existing
`GET /workouts` list. `TONNAGE` goes through `t()`. Regression:
`frontend/e2e/wave-a.spec.ts` and `frontend/src/training-week.test.ts`.

### What running on an Android phone found (2026-09-15)
Web e2e passed; the Android emulator (Expo Go, SDK 54) did not:
- Importing `expo-notifications` in Expo Go put up an error overlay at startup.
  It is now loaded lazily and only outside Expo Go (`push.ts::notifications`).
- With `edgeToEdgeEnabled`, Android no longer resizes for the keyboard, so
  `KeyboardAvoidingView behavior={ios ? "padding" : undefined}` left the chat and
  DM composers under the keyboard. Both now use `"padding"` everywhere.
  (`auth.tsx` and `workout/[id].tsx` still use the old pattern.)
- Poll text was not centred (`flex:1` on Android), preview images failed with no
  fallback, and "COMMUNAUTÉ" wrapped mid-word.

**Precedent:** web e2e cannot see native layout, keyboard or module-load
failures. Run each new screen once on the emulator.

### Link previews: DNS rebinding
Fixed 2026-09-15. `link_preview._PinnedBackend` connects only to the addresses
vetted for that hop, and a name with any private answer is refused. Regression:
`test_social_complete.py::test_a_name_with_any_private_answer_is_refused_and_connections_stay_pinned`.

### Community completion batch (2026-09-15)
Closed in one pass, each with a regression test in
`backend/tests/test_community_complete.py` or `test_social_complete.py`:
- **Private communities joinable without an invite** — `join_community` now
  403s unless public; invites call `_activate` directly.
- **Privilege escalation through roles and overwrites** — `_grant_limit` /
  `_check_grantable`: you can only grant bits you hold, to roles below you.
  Overwrites now also need MANAGE_ROLES (as in Discord).
- **Rank-blind moderation** — `_check_outranks` gates re-roling, kick, ban,
  unban and timeout; every one is audited. "Reject" on an active member is a
  kick and needs KICK_MEMBER.
- **Edits bypassed screening and send permission** — `edit_message` re-checks
  `_send_permission` and re-screens.
- **Reports as a read oracle** — `admin._visible_target` gates reportable
  content on what the reporter can see; the receipt no longer echoes the
  snapshot. DMs are reportable only by their recipient.
- **Duplicate removal paths** — `moderation.remove_content` is the single,
  idempotent path; counters (repost, comment, reply) unwind exactly once.
- **Unused `MENTION`, community mentions via `create()`** — `notify_mentions`
  goes through `notify()` (blocks, self, preferences).
- **Legacy `api.posts`/`createPost`, `community.PostIn`** — removed.
- **Feed cursor ignored unknown ids; "mine" listed archived communities;
  discover sorted only the newest 100** — all fixed; discover ranks in Mongo.
- **Reaction spam** — emoji-only validator, 20 distinct per message.
- **`GET /group-sessions` needed no login** — now requires one.
- **Supabase drift** — `supabase/migrations/003_community_social.sql`.

**Precedent:** permission checks that compare only *rank* are escalations
waiting to happen; every grant path needs both a rank ceiling and a
bits-held check.

### Pending follows unlocked direct messages (authorization)
`social.py::_can_message` queried `db.follows` with no `status` filter. Correct
while every follow was active; introducing pending edges meant two strangers
could unlock DMs merely by both *requesting* to follow each other's private
accounts. Now uses `social_graph.follows_actively` on both sides. Regression
test: `tests/test_social_graph.py::test_a_pending_mutual_follow_does_not_unlock_direct_messages`.
Fixed 2026-09-14.

**Precedent:** adding a state to an existing edge invalidates every query that
read that edge unconditionally. Grep all readers before adding a status field.

### Notifications that could never be marked read
`routers/labs.py` and `routers/admin.py` wrote the collection directly with
`read: False`, while the reader checks `read_at`. The lab row also carried no
`title`, which the notification centre renders unguarded. Both now use
`notifications.create`. Fixed 2026-09-14.

### Broken Profile entry point
`app/(tabs)/profile.tsx` pushed `/admin/index`, which the runtime serves at
`/admin`, so the staff console button landed on "Unmatched Route". Two
`/partner/index` pushes had the same defect. No test caught it because the
admin specs navigate by URL rather than clicking the entry point. Regression
test: `e2e/admin.spec.ts` "the Profile entry point actually opens the console".
Fixed 2026-09-13.

**Precedent:** an e2e suite that navigates by URL never exercises navigation.
Click the real control at least once per entry point.

### Announcement channels muted legacy moderators
Implemented first as a `SEND_MESSAGE` deny on the `@everyone` role, which also
muted legacy moderators because they inherit the default role and have no role
document to grant an exception to. Replaced with a direct `MANAGE_MESSAGES`
requirement. Fixed 2026-09-13.

### `resolve_actors` was dormant
Nothing called it, so notification aggregation could report a count but never a
name. Wired into `routers/notifications.py::list_notifications`.
Fixed 2026-09-14.


### Hidden channels readable by id; private posts visible to all
Fixed 2026-09-14. `_require` now adds `VIEW_CHANNEL` whenever a channel is in
play, so nothing can be done inside a channel the caller cannot see.
`social._can_view_post` is the single post-visibility rule and
`_visible_post_query` its Mongo form, shared by the feed and search.
`_with_originals` applies it to repost originals — otherwise an approved
follower's repost would launder a private post to their whole audience.

### Code inserted above a function inherited its decorator
Found 2026-09-14: a helper inserted directly above `create_post` landed under
`@router.post("/posts")`, which would have registered the helper as the
endpoint. **Precedent:** when inserting before a function, anchor on its
decorator line, not its `def`.

### A hook placed after an early return
Found 2026-09-14 in `app/community/[id].tsx`: two `useState` calls sat after the
loading-state `return`, crashing with "Rendered more hooks than during the
previous render". `react-hooks/rules-of-hooks` is enabled and flags this.
**Precedent:** run ESLint, not just `tsc`, after every frontend edit — it is two
seconds against a failed browser run.

### Asserting a captured request synchronously after a click
Found 2026-09-14: `expect(captured).toEqual(...)` straight after `.click()`
races the route handler and flakes under load. It surfaced in
`management.spec.ts` when a new request shifted timing; nine instances across
five specs were fixed. **Precedent:** use `await expect.poll(() => captured)`.
Assert absence only after the UI proves the action settled.

## Frontend reachability — closed 2026-09-14

Every capability listed below now has a client method in `frontend/src/api.ts`
**and** a caller:

| Capability | Client | Caller |
|---|---|---|
| follow / unfollow, tri-state | `api.follow`, `api.unfollow` | `app/user/[id].tsx` |
| follow requests: list, approve, deny | `api.followRequests`, `approveFollowRequest`, `denyFollowRequest` | `app/follow-requests.tsx` |
| followers / following | `api.followers`, `api.followingList` | `app/user/connections.tsx` |
| block / unblock, mute / unmute | `api.blockUser`, `unblockUser`, `muteUser`, `unmuteUser` | `app/user/[id].tsx` overflow menu |
| private account | `api.updatePrivacy` | `app/(tabs)/profile.tsx` |
| 11 notification types + aggregation | `api.notifications` | `app/notifications.tsx` |

`app/user/connections.tsx` is a **static sibling** of `user/[id].tsx`, not
`user/[id]/followers.tsx` — that leaf has no sibling directory and adding one
would collide.
