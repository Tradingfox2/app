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
- **Feed pagination.** `social.py::feed(before=...)` is implemented and typed in
  `api.ts`, but `frontend/src/components/social/feed.tsx` never passes a cursor.
  The feed is capped at 20 posts with no way to load more.
- **`PostIn.workout_id`.** Accepted and persisted; no client sends it.
- **Community-scoped posting from the feed composer.** `PostIn.community_id`
  and its membership guard exist; the composer sends only `content` and
  `media_ids`.
- **Channel kinds.** `program` / `challenge` / `checkin` / `live` are enforced
  backend-side but render as a label with no dedicated UI.
- **Permission bits `POST_PROGRAM` and `START_LIVE_SESSION`** are defined and
  checkable but attached to no feature.

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

### No rate limiting
Any authenticated token can drive message creation, reactions, follows and
likes without throttling. Verified 2026-09-14.

### Findings from the 2026-09-14 community-batch map (open unless marked)
- **(authorization)** `community.py::list_messages`, `create_message`, `edit_message` do not check `VIEW_CHANNEL`; a channel hidden by a `deny: VIEW_CHANNEL` overwrite is readable and postable by id. `list_channels`, `get_channel`, `list_pins` do check it.
- **(privacy)** `social.py::feed(scope="all")` and `_post_or_404` ignore `users.is_private`, while the Profile privacy switch promises only approved followers see posts.
- `social.py::create_post` stores `workout_id` unvalidated — any id, including another user's workout.
- `community.py::PostIn` is a legacy duplicate with no references; the live model is `social.py::PostIn`.
- `api.createCommunityChannel` never sends `kind`, so non-text channel kinds cannot be created from the UI at all.
- Check-in guard (`create_message`, kind `checkin`): count-then-insert race, UTC day, and deleting a check-in frees the day. No streak is computed anywhere. Name collision: `checkin` also means gym QR check-in (`/gyms/checkin`, `app/checkin.tsx`).
- `api.channelPins` and `api.channelMessages(before)` have no callers — pins older than the last 50 messages are invisible; no "load older".
- The channel mention roster uses manager-only `list_members`, so @-suggestions are empty for plain members (swallowed 403).
- `app/community/[id].tsx::isManager` uses legacy role strings, not the permission mask, so custom-role managers get no settings gear.
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
