# Confirmed Quality Issues

> Repository memory for the IronFlow Cartographer. Facts only, each with file
> and symbol evidence. Remove an entry when it is fixed and verified.

## Open

### Duplicate content-removal paths
`backend/routers/social.py::delete_post` has a moderator branch gated on
`content.moderate` that audits `post.removed` and decrements `repost_count`.
`backend/routers/admin.py::review_report` has a `content_removed` resolution
that sets `removed_by` and **does not** decrement `repost_count`. Only the
admin path has UI (`frontend/app/admin/index.tsx`). The social branch is
dormant. Verified 2026-09-14.

### ESLint had no ignore for generated test artifacts
**Fixed 2026-09-14.** `frontend/test-results/` holds Playwright trace bundles,
including minified JS. ESLint does not read `.gitignore`, so a single failed
browser run left 166 lint errors on disk and broke the lint gate — and CI —
until someone deleted them by hand. `eslint.config.js` now ignores
`test-results/**`, `playwright-report/**` and `.expo/**`.

**Precedent:** a lint gate that reads generated output fails on a schedule
nobody controls. Ignore artifact directories explicitly; `.gitignore` is not
enough.

### `notifications.MENTION` constant is unused
Defined in `backend/notifications.py`; `backend/routers/community.py` passes the
string literal `"mention"`. The values coincide so there is no runtime bug, but
the two mention paths diverge: community mentions use `create()` (no
aggregation, no block suppression) while post and comment mentions use
`notify()`. Verified 2026-09-14.

### Dormant backend capabilities
- **Community-scoped posting from the feed composer.** `PostIn.community_id`
  and its membership guard exist; the composer sends only `content` and
  `media_ids`.
- **Channel kinds `program` and `live`.** Accepted by the model but have no
  behaviour or UI. `challenge` and `checkin` are done (2026-09-14).
- **Permission bits `POST_PROGRAM` and `START_LIVE_SESSION`** are defined and
  checkable but attached to no feature — they belong to the unbuilt `program`
  and `live` channel kinds.

Verified 2026-09-14.

### Legacy client methods
`api.posts()` and `api.createPost()` in `frontend/src/api.ts` point at
`GET /api/posts`, which does not exist anywhere in `backend/`. Neither has a
caller. Safe to remove after confirming no dynamic registration.
Verified 2026-09-14.

### Supabase schema drift
`supabase/migrations/001_init.sql` defines 16 tables. MongoDB now has roughly
twice that — `channels`, `messages`, `community_roles`, `follows`, `blocks`,
`mutes`, `post_likes`, `post_comments`, `direct_messages`, `reports`,
`audit_log`, `notifications`, `media`, `user_notes`, `coach_applications`,
`lab_reports`. `memory/PRD.md` states the backend mirrors a full Supabase
schema and lists migration to Supabase as a next step; that path is blocked
until the SQL side catches up. Verified 2026-09-14.

### Findings from the 2026-09-14 community-batch map (open unless marked)
- `community.py::PostIn` is a legacy duplicate with no references; the live model is `social.py::PostIn`.
- `api.channelPins` and `api.channelMessages(before)` have no callers — pins older than the last 50 messages are invisible; no "load older".
- `list_communities(scope="mine")` includes archived communities.
- Feed cursor silently ignores an unknown `before` id and returns page 1 (`list_messages` 404s instead).
- `INVITE_MEMBER` is in `DEFAULT_MEMBER` — any invite mechanism that bypasses approval must not gate on it alone.
- Realtime: the client subscribes without a subscription token and the connection token carries no channel claims; `user:{id}` mention publishes have no subscriber. A real Centrifugo deployment must not allow unrestricted client-side subscribe.

## Fixed — kept as precedent

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
