# Confirmed Quality Issues

> Repository memory for the IronFlow Cartographer. Facts only, each with file
> and symbol evidence. Remove an entry when it is fixed and verified.

## Open

### Centrifugo is not deployed (deferred by the owner)
Client and server code are complete: connection tokens carry a `channels`
claim for the member's own `user:{id}`, and `GET /realtime/subscription-token`
mints per-channel tokens after the same VIEW_CHANNEL check as HTTP. **The
deployment must configure the `channel` namespace to require subscription
tokens** (no `allow_subscribe_for_client`), or any signed-in client could
listen to any room. Until then every realtime path falls back to polling.
Verified 2026-09-15.

### Push needs an EAS project id on device builds
`frontend/src/push.ts` reads `expo.extra.eas.projectId`; without one,
`getExpoPushTokenAsync` fails and push silently stays off (in-app
notifications still work). Web never registers. Verified 2026-09-15.

### Link previews: DNS-rebinding residue
`backend/link_preview.py` resolves and checks every address before each hop,
but httpx resolves again when it connects. A rebinding attacker with a very
short TTL could still slip one request through. Pin the resolved IP (custom
transport) before exposing previews to untrusted high-volume use.
Verified 2026-09-15.

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
