# Architecture Map

> Repository memory for the IronFlow Cartographer. Index, not authority —
> verify against source before relying on an entry. Keep entries dated and
> evidence-based; delete what stops being true.

## Ownership (verified 2026-09-14, branch `feature/interactive-muscle-explorer`)

### Community permissions — `backend/permissions.py`
Sole owner of who may do what inside a community. A 14-bit mask resolves in two
layers: role grants OR together (the default `@everyone` role always applies),
then per-channel `deny` then `allow` overwrites in ascending role rank. The
owner short-circuits to `ALL` so a bad overwrite cannot lock someone out of
their own community.

Legacy `owner` / `moderator` / `member` strings map onto the same bitmask, so
the feature shipped with **no migration**. `frontend/src/permissions.ts` mirrors
the bit values and **must be changed in lockstep**.

Do not model a capability as an `@everyone` deny when some actors are not
represented as roles — legacy moderators have no role document to grant an
exception to. Announcement channels therefore require `MANAGE_MESSAGES`
directly rather than denying `SEND_MESSAGE` to everyone.

### Social graph — `backend/social_graph.py`
Sole owner of follow / block / mute edges. Follow state lives on the `follows`
edge as `status`. A **missing** `status` means active — encoded as
`social_graph.ACTIVE = {"$ne": "pending"}`. That is why follow requests shipped
without a migration.

- A private account (`users.is_private`) converts an incoming follow into a
  pending request. A pending edge grants nothing.
- Blocking is **symmetric**: it severs both edges and prevents re-follow,
  notifications and DMs.
- Muting is **one-way and silent**: feed-only, and the muted person is never
  told and can still interact.
- Distinct from *suspension* (`routers/admin.py`), which is staff-imposed and
  account-wide.

### Notifications — `backend/notifications.py`
`notify()` is the intended sole writer. It suppresses self-actions and blocked
pairs once, centrally, and aggregates `POST_LIKE` / `POST_COMMENT` /
`POST_REPOST` on `(user, type, target_id)` inside 24h using `$addToSet`.

**Collection contract: `read_at` (nullable timestamp), never `read`.**
`backend/routers/notifications.py` is the single reader.

`notifications.create()` is the un-aggregated, un-suppressed path. It is
correct for notices that must arrive even when the recipient has blocked the
actor — a moderation decision, for example.

### Realtime — `backend/realtime.py`
Centrifugo (Apache-2.0, self-hosted, free). Additive by construction:
unconfigured is a silent no-op and a publish failure can never fail the write
that triggered it. The client falls back to polling — 8s disconnected, 45s
reconcile when connected. Dormant until `CENTRIFUGO_URL` and
`CENTRIFUGO_API_KEY` are set.

## Frontend conventions

- `frontend/src/api.ts` is the **only** HTTP boundary. A backend capability is
  unreachable unless it has both a method there and a caller under
  `frontend/app/` or `frontend/src/`.
- Expo Router: `frontend/app/user/[id].tsx` is a leaf with no sibling
  directory. New user sub-screens must be static siblings
  (`user/connections.tsx`), never `user/[id]/*`.
- **`expo-router`'s `typedRoutes` generator is unreliable here.** It emits
  `/admin/index` for `app/admin/index.tsx` while the runtime serves `/admin`,
  and lists non-routes such as `/../e2e/community.spec` as valid paths. Trust
  the runtime; call sites carry a documented `as Href` cast.
- Mentions are stored as `<@user_id>` tokens, never `@name`. Names are neither
  unique nor stable, and parsing them invites impersonation.

## Validation commands

```
cd backend  && ../.venv/Scripts/python.exe -m pytest -q      # needs Mongo on :27017
cd frontend && node ./node_modules/typescript/bin/tsc --noEmit
cd frontend && node ./node_modules/@playwright/test/cli.js test
```

Use the **worktree's own** `.venv`. The repo-root `C:\Users\fouda\app\.venv` is
Python 3.14 with no dependencies installed. `node`, `npx` and `gh` are not on
PATH in this environment; invoke them by absolute path.

## Test-isolation gotcha

Social routes reach into three modules, so a throwaway database must be
monkeypatched into `social`, `notifications` **and** `social_graph` — otherwise
a notification trigger escapes to the global Motor client bound to an
already-closed event loop. Encoded in
`backend/tests/test_social_and_sources.py::patch_social_db`. The same applies
to `routers/admin.py` and `routers/labs.py`, which now write notifications
through the shared module.

## Added 2026-09-14 (community-batch map)

- **Search:** no Mongo text index exists. Regex precedents: `admin.py::list_users` (`re.escape`, 80-char cap) and `wearables.py::_resolve_exercise` (anchored prefix). Exercise search is client-side in `(tabs)/workouts.tsx`. Public user search must match `full_name` only, never email.
- **Workout doc:** `{id, user_id, title, notes, started_at, ended_at, duration_sec, perceived_effort, planned_exercise_slugs[], created_at}`. Only imported sets carry `user_id` — never query `workout_sets` by user. Owner-only precedent: `wearables.py::gym_checkin`; `server.py::_load_workout_for` also admits active coaches, so do not reuse it for sharing.
- **Feed cursor:** post id -> `created_at <` that post's time; no tiebreak, no `has_more`.
- **Test/CI shape:** harness tests call router functions directly and monkeypatch module `db`, so middleware never runs in them. CI runs one uvicorn process; live-server tests sign in as the seeded demo user under `-n 2 --dist loadscope`.
- **Routing qualifier:** `community/[id].tsx` coexists with `community/[id]/manage.tsx`, so the "no sibling directory" rule applies to `user/[id]` specifically, not Expo Router generally.

## Added 2026-09-14 (community batch, slices 1-2)

- **Rate limiting — `backend/ratelimit.py`.** Fixed-window counter in MongoDB
  (`$inc` upsert, TTL on `expires_at`), keyed by action and subject, called
  inside handlers. `RATE_LIMITS=off` disables it. It reads `server.db` at call
  time, so the test harness's `server.db` patch covers it — prefer that pattern
  for new modules over binding `db` at import.
- **The single door into a community — `community.py::_activate`.** Direct joins
  and invite redemption both go through it, so "banned stays banned" and "paid
  needs verified billing" cannot be routed around. Only the signed Stripe
  webhook passes `source="payment"`.
- **Billing — `backend/billing.py`.** Stripe REST over httpx, no SDK. Checkout
  (`community_checkouts`) grants nothing. `stripe_webhook` verifies the
  signature, records event ids in `billing_events`, activates on
  `checkout.session.completed`, and lapses on cancelled/unpaid subscriptions
  (`ended_reason: billing`). Leave, ban, removal and ownership transfer cancel
  the member's `stripe_subscription_id`.
- **Outbound TLS — `backend/tls.py`.** `client_context()` uses the OS trust store
  with `VERIFY_X509_STRICT` relaxed. It is shared by link previews, push,
  realtime and billing.
- **Invites.** `community_invites`, unique `code`. A plain invite needs
  `INVITE_MEMBER` (a default-member bit) and grants only what joining would; a
  direct invite that skips approval needs `MANAGE_CHANNEL`. Redemption claims a
  use atomically before joining and refunds it if the join changes nothing.
- **Unread.** `channel_reads {channel_id, user_id, last_read_at}`, advanced with
  `$max` so it never moves backwards. Baseline with no marker is `joined_at`.
  `list_channels` returns `unread_count`, capped at 100.
- **Member directory.** `GET /communities/{id}/directory` — public fields of
  active members, for any active member. The mention roster uses it; `/members`
  stays manager-only.
- **Search — `backend/routers/search.py`.** Escaped, capped regex. People by
  `full_name` only, excluding blocked and suspended; communities public and not
  archived; posts via `_visible_post_query`. Muted authors still appear —
  muting is feed-only.
- **Realtime publishes** now cover `message.created`, `message.reactions`,
  `message.updated`, `message.deleted` (id only) and `message.pinned`.
- **Workout sharing.** `create_post` snapshots `workout_summary` from an owned,
  finished workout — not `_load_workout_for`, which admits coaches.

## Added 2026-09-14 (community batch, slice 3 — fitness channels)

- **`backend/challenges.py`** — pure mechanics, unit-tested without a database.
  - **Streaks count check-in days, not calendar days. One rest day never breaks
    a streak; two in a row do** (`MAX_GAP_DAYS = 2`). A training streak must not
    punish rest, or it rewards overtraining. Current streak is alive while
    `today - last_checkin <= 2`.
  - Challenges follow Strava: a metric (`workouts` / `active_days` / `minutes` /
    `tonnage`), a window of at most 92 days, an optional group goal, and
    competition ranking ("1, 2, 2, 4").
- **Check-in day** is stored on the message as `checkin_day` (UTC `YYYY-MM-DD`).
  A unique partial index on `(channel_id, author_id, checkin_day)` over active
  rows is the real race guard; deleting a mistaken check-in frees the day. Name
  collision to remember: `checkin` also means gym QR check-in (`/gyms/checkin`).
- **Challenges are opt-in.** `challenge_participants`; joining is the consent to
  be scored. Only participants' finished workouts inside the window count, and
  only training aggregates — never biomarkers, labs or wearable health data.
  Blocked people are hidden from the viewer's board but still count toward the
  group total.
- **UI:** `frontend/src/components/community/fitness-panel.tsx` renders the
  streak strip or scoreboard at the top of the channel; the kind picker and
  challenge settings are in `community/[id]/manage.tsx`.

## Added 2026-09-15 (community completion)

- **One removal path:** `moderation.remove_content(target_type, id, actor=)`
  for post, comment, message and direct_message. Idempotent; unwinds
  counters. Author deletes pass `actor={}` so no `removed_by` is stamped.
- **Grant hierarchy** (`routers/community.py`): `_grant_limit`,
  `_check_grantable`, `_check_outranks`. Timeouts are enforced centrally in
  `_require` via `permissions.PARTICIPATE` — reading is never blocked.
- **Messages:** `_insert_message` is the single insert path (slow mode,
  check-in day, attachments, mentions, publish, screening). `create_message`,
  `share_program` and `schedule_live_session` all use it.
  `_decorate_messages` batches authors, reply quotes, mentions and
  `_role_badges` per page.
- **Program channels:** `share_program` snapshots the plan only
  (`_program_snapshot` — never `recovery_snapshot`); `adopt_program` copies it
  into `db.programs` as the active program and archives the old one.
- **Live channels:** `live_sessions` + `live_rsvps`; RSVPs are notified on
  start and cancel. The app schedules and gathers; video lives at `join_url`.
- **Posts:** `_decorate` is batched and computes viewer state for the post
  *and* a plain repost's original — the card acts on the original. Quote
  posts are reposts with content. Polls: one final vote, results hidden until
  you vote. Hashtags in `posts.tags`; `/tags/trending`.
- **Notifications:** `notifications.preferences()` gates `create()` and
  `notify()`; `MANDATORY` kinds (membership, coach decision, moderation, lab)
  always record. Push goes through `push.py` (Expo HTTP API, background task,
  prunes `DeviceNotRegistered`).
- **Link previews:** `link_preview.py`: https only, public IPs only per hop,
  connections pinned to the vetted IPs (`_PinnedBackend`), reads up to `</head>`
  or 1.5 MB. Tests monkeypatch `link_preview.fetch`.
- **Frontend shared social components** in `src/components/social/`:
  `avatar`, `rich-text` (mentions, #tags, links), `media` (grid, full-screen
  viewer, expo-video player), `report-sheet`, `action-sheet`,
  `mention-input`. New screens: `post/[id]`, `tag/[tag]`, `saved`,
  `profile-edit`, `notification-settings`.
- **Realtime personal channel:** `useRealtimeUser` listens on the
  connection's server-side `user:{id}` subscription (DMs, typing, receipts).
- **Test harness:** new router params that take `Query(...)` defaults must go
  *after* `user` and use `Annotated[..., Query()] = default`, because tests
  call handlers positionally.

## Added 2026-09-27 (product analytics)

- **`backend/analytics.py`** owns the `analytics_events` collection. `record()`
  inserts one row; `counts()` is two `count_documents` per taxonomy name
  (24h and 7d) and is the only staff rollup. `ts` is server UTC. Actor, role,
  and source are not taken from the client body.
- **Live source of truth:** Mongo `analytics_events`. FastAPI/Motor writes
  and the admin rollup reads it. `supabase/migrations/005_analytics_events.sql`
  is a schema mirror only (after `004_support_and_dual_media.sql`). No runtime
  write to Postgres. Not SQLAlchemy.
- **Read ACL:** staff permission `analytics.read` on support, moderator, and
  admin. Product `admin` and approved coaches without `staff_role` are denied.
  UI: `AnalyticsPanel` on `/admin`, shown only when the overview lists the
  permission.
- **Prove emit:** `frontend/src/analytics.ts` `track()` → `POST /api/events`.
  The feed composer calls `track("post_created", …)` after a successful
  `api.publish`. Do not also emit that event from `create_post`.
- **Indexes:** unique `event_id`, compound `(name, ts)` named
  `analytics_events_name_ts`, created from `analytics.ensure_indexes` in
  `server.lifespan`.
