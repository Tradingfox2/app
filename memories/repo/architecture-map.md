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
- **Workout affordances (2026-10-01).** Session history is the Sessions segment
  of `(tabs)/workouts.tsx`. The rest timer UI is the banner in `workout/[id].tsx`;
  `src/rest-timer.ts` only schedules the notification. `/program` is not linked
  from the Workouts tab. Hover and press for those screens live in
  `src/press-feedback.ts` (`usePressFeedback`, `useFieldAffordance`). Shared
  files such as `exercise-demo-modal.tsx` take an optional style and otherwise
  keep today's look. Do not put chartreuse on anything except Start, a primary
  fill, and the selected tab.

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

## Added 2026-09-27 (post share-out)

- **Post URL owner:** `frontend/src/share.ts`. `buildPostUrl` / `sharePost` /
  `copyPostLink` / `openShareTarget`. Share links use `ironflow://post/{id}`,
  or `{origin}/post/{id}` when `EXPO_PUBLIC_WEB_ORIGIN` or
  `EXPO_PUBLIC_WEB_URL` is set. `app.json` schemes are `frontend` and
  `ironflow`. Incoming links are rewritten in `frontend/src/linking.ts`.
  Documented in `docs/post-deep-links.md`.
- **Share UI:** `src/components/social/share-bar.tsx`, used by `PostCard`
  (feed overflow Share and the share icon; always open on `app/post/[id].tsx`).
  Targets are real composers (X, Facebook, WhatsApp, LinkedIn) via
  `Linking.openURL` / `window.open`. No success toast.
- **Own profile wall** (`app/user/[id].tsx`) reuses `Composer` and
  `POST /posts`. Follow stays on `api.follow` / `social_graph.py`.
- **`post_shared`:** `share.ts` calls `track("post_shared", { post_id, channel })`
  only after the system sheet returns shared, copy succeeds, or a network
  composer opens. `channel` is `system_share`, `copy`, `x`, `facebook`,
  `whatsapp`, or `linkedin`. Dismiss and failure do not emit.
- **Not built:** universal links / Android app links (need a real host),
  native clipboard module (`expo-clipboard`). Web copy uses the Clipboard API.
  Share does not call a new backend route.

## Added 2026-09-27 (product analytics)

- **`backend/analytics.py`** owns the `analytics_events` collection. `record()`
  inserts one row; `counts()` is two `count_documents` per taxonomy name
  (24h and 7d) and is the only staff rollup. `ts` is server UTC. Actor, role,
  and source are not taken from the client body.
- **Live source of truth:** Mongo `analytics_events`. FastAPI/Motor writes
  and the admin rollup reads it. No Supabase migration for this collection.
- **Read ACL:** staff permission `analytics.read` on support, moderator, and
  admin. Product `admin` and approved coaches without `staff_role` are denied.
  UI: `AnalyticsPanel` on `/admin`, shown only when the overview lists the
  permission.
- **Prove emit:** `frontend/src/analytics.ts` `track()` → `POST /api/events`.
  The feed composer calls `track("post_created", …)` after a successful
  `api.publish`. `share.ts` calls `track("post_shared", …)` after a successful
  share. Do not also emit `post_created` from `create_post`.
- **Indexes:** unique `event_id`, compound `(name, ts)` named
  `analytics_events_name_ts`, created from `analytics.ensure_indexes` in
  `server.lifespan`.

## Added 2026-09-27 (athlete personal space)

- **Schema:** `supabase/migrations/005_athlete_personal_space.sql`. Users gain
  `cover_url`, `sports text[]`, `about`. Posts gain `audience` (`public` |
  `friends`; missing means public). `public.stories` mirrors Mongo `stories`
  (24h workout stories, or `highlight` rows with no `expires_at`). RLS on,
  no client policies.
- **Visibility:** friends means an accepted follow (`social_graph.follows_actively`).
  `routers/social.py` `_can_view_post` enforces it. `_visible_post_query(friends=False)`
  is what search, trending tags, and feed scopes `all` / `following` / `mine`
  use, so friends posts stay off the public community feed. Profile walls and
  `GET /feed?scope=friends` pass `friends=True`.
- **Stories:** `POST /stories` requires a finished workout owned by the caller
  (`_workout_summary`). `GET /stories/feed`, `GET /users/{id}/stories`,
  `GET /users/{id}/highlights`, `DELETE /stories/{id}`. Photos on the wall are
  images already on that person's non-community posts (`GET /users/{id}/photos`).
- **Profile fields:** `PATCH /auth/me` accepts `about`, `sports`, `cover_media_id`,
  `remove_cover`. Cover must be the caller's own image in `media`. About is
  withheld when `can_view_profile` is false.
- **UI:** `app/user/[id].tsx` wall (cover, sports, posts / photos / about,
  highlights). `app/friends.tsx` friends feed. `app/story-new.tsx` and
  `app/story/[authorId].tsx`. Personal composer defaults to `audience: "friends"`.
  `track("story_created")` after a successful create. Community composer unchanged.
- **Tests:** `backend/tests/test_personal_space.py`. UI: `frontend/e2e/personal-space.spec.ts`.

## Added 2026-09-27 (support tickets + dual media foundations)

- **Schema SoT:** `supabase/migrations/004_support_and_dual_media.sql`. Tables:
  `admin_media`, `support_tickets`, `support_ticket_messages`. RLS enabled,
  no client policies (deny-by-default, same as `public.media`). No priority
  column, no `user_media_objects`, no `purpose` on `public.media`, no
  attachments join table. Message attachments are nullable
  `support_ticket_messages.media_id` → `public.media`.
- **Bytes:** `backend/media_storage.py` remains the only writer.
  `backend/media_repo.py` (`create_user_media`, `create_admin_media`) inserts
  Mongo `media` / `admin_media` after `store`. Key prefixes:
  `users/{user_id}/{media_id}.{ext}` and `admin/{staff_id}/{asset_id}.{ext}`.
  Layout notes: `docs/STORAGE_LAYOUT.md`.
- **Indexes:** startup in `server.py` lifespan mirrors the SQL partial indexes
  on `admin_media` (`key` unique; staff+created_at and purpose+created_at where
  `deleted_at` is null). `POST /media` in `routers/social.py` is unchanged.
- **Smoke:** `backend/tests/test_dual_media_smoke.py` is sync (no
  pytest-asyncio in this tree) and only touches a temp `MEDIA_ROOT`.

## Added 2026-09-30 (You tab, only_me UI)

- **Audience API owner:** `backend/routers/social.py` after #17. `Audience` is
  `public | friends | only_me`. Create and `PATCH /posts` accept it. `club` and
  a non-public community post are 422. No further SQL: migration 006 already
  widened the check. Do not add a second audience router.
- **Visibility:** `only_me` is included on the author's wall
  (`GET /feed?author_id={self}`) and `scope=mine`. It is excluded from public
  feeds, the friends feed, search, and trending. Other users get 404 on
  `GET /posts/{id}`. Friends stays an accepted follow. Story lists use
  `_friends_only_clause`: the author sees `only_me` stories; visitors do not.
- **You tab:** `app/(tabs)/profile.tsx` renders `ProfileWall` (`variant="tab"`),
  the same component as `app/user/[id].tsx`. The cover is the first scroll
  block; the avatar overlaps it and opens the story viewer when stories
  exist. `profile-activity` (your story, highlights) stays above Posts |
  Photos | About. Edit profile, saved posts, and the Friends feed sit under
  the header. The gear opens `app/settings.tsx`, which still holds language,
  privacy, plans, support, and sign-out.
- **Copy:** Friends (feed and audience) is not the Followers or Following list.
  Strings live in `frontend/src/personal-space-locales.ts`. The personal
  composer and `app/story-new.tsx` send `only_me` through the existing
  `api.publish` / `api.createStory` types.

## Added 2026-09-30 (Wave D analytics)

- **Single live log:** `routers/community.py` `_emit_live` writes
  `live_session_started`, `live_session_joined`, and `live_session_ended`
  with `analytics.record(..., source="server")`. Props are ids only
  (`session_id`, and `channel_id` except on join). `insights.emit` does not
  insert. `insight_events` is historical and unread.
- **Not this log:** community Insights, the partner dashboard, and the home
  training week card stay domain counts. Glossary copy is in
  `frontend/src/analytics-locales.ts` (`METRIC_GLOSSARY`) and
  `frontend/src/components/metric-glossary.tsx`.
- **Workout:** `POST /workouts/{id}/finish` emits `workout_completed`
  (`workout_id`) once, when `ended_at` was empty. Workout share calls
  `track("post_created")` after `POST /posts`, same as the feed composer.
  `create_post` does not emit.
- **Tickets:** `ticket-form.tsx` emits `ticket_created`. Member
  `ticket-detail.tsx` and staff `admin/index.tsx` emit `ticket_replied`.
  The opening note is not a reply.

## Frontend visual system (verified 2026-10-01, on main through #26)

The palette below landed from `cursor/visual-system-1295` and is on main.

- **Owner:** `frontend/src/theme.ts`. Screens use these tokens. There is no
  second palette and no light canvas. Page is `colors.bg` `#101418`.
- **Chartreuse** `colors.brand` `#D6E35A` with `colors.brandOn` `#16180C` is
  only a primary button fill and `tabBarActiveTintColor` in
  `app/(tabs)/_layout.tsx`. In-screen chips and the muscle-sheet tabs use
  `surface2` plus `colors.text`.
- **Rings:** Home Strain / Recovery / Sleep stay those labels. They sit on
  `colors.ringPlate` `#000000` inside the inset rings card. Strain is
  `colors.blaze`, recovery `colors.success`, sleep `colors.info`. Not Apple
  Move / Exercise / Stand, and not chartreuse.
- **Cards:** `card` is inset (radius 16, 1pt border, pad 16) for rings,
  Today, stats, session history. Feed posts and club rows are full bleed
  (`bleedRow` / post `card`: pad 16, bottom hairline, no radius).
- **Labels:** LIVE is `colors.live` dot plus the word. PR is the word in
  `colors.pr`. Rest is an outline bar, tertiary word, only while
  `restRemaining > 0`. Rest timer math in `src/rest-timer.ts` is unchanged.
- **Plan vs coach:** `/program` header is `t("Plan")`. The human coach stays
  Home `quick-coach` and `/coach/onboarding`. Screens are not merged.

## Home week (verified 2026-10-01, on main through #28)

The activity-day screen landed from `cursor/home-activity-day-d3c3` and is on main.

- **Fold:** header, `LiveNowStrip` only when someone is live, rings on
  `colors.ringPlate`, then `today-card`. The week block is `training-week-card`
  under Today. Nothing new sits above Today.
- **Totals:** `GET /home/today` (`home_today_for` → `dashboard_snapshot`) is a
  rolling 7×24h UTC window. `training` is `{sets_week, tonnage_week_kg,
  minutes_week, muscles_week[], streak_days}`. There is still no per-day field.
  `days_with_workout` stays internal to the streak.
- **Calendar:** last seven local dates from `GET /workouts` `started_at`
  (`trainingCalendar` in `frontend/src/training-week.ts`). Each day is a button
  to `/activity?day=YYYY-MM-DD`. The mark is an `ActivityRing` in `colors.blaze`
  (`frontend/src/components/activity-ring.tsx`): arc from that day's logged
  `duration_sec` against the busiest day in the seven, or a center dot when a
  session exists but duration does not. Chartreuse stays off this card.
- **Activity day:** `frontend/app/activity.tsx` plus `frontend/src/activity-day.ts`.
  No new endpoint and no HealthKit. `api.wearable` is called for `steps` and
  `calories`. Finished `duration_sec` is split across the local hours it
  occupied; hours with none are omitted. Tonnage and distance come from
  `GET /workouts/{id}/sets` (`weight_kg × reps`, `distance_m`) for sessions
  that started that local day, plus `activity.distance_m` from a finished
  phone recording (`recordedDistanceRows`). `workout_sets.distance_m` still has
  no writer in the logger. Wearable `calories` means Terra `total_burned_calories` or
  Samsung active calories, one row per day — not Move, and not hourly.
  `import_day` wins over `recorded_at` when the importer set it. `simulated:
  true` is sample data. A missing or non-positive figure stays "Not measured",
  never 0, and there is no Move goal.
- **Honesty:** missing `training` fields are not painted as zero. A failed
  `/home/today` shows `week-retry`. A quiet week shows `week-empty`. A failed
  `/workouts` shows `week-days-retry` and keeps the last totals. A failed
  activity load keeps its own retry and does not fall through to "Not measured".

## Outdoor recorder (2026-10-01, on main through #29)

The phone recorder landed from `cursor/phone-recorder-d3c3` and is on main.

## Press cues (2026-10-01, rebased onto `0f1f296`)

- Community, You, and the screens they open use `frontend/src/press-affordance.tsx` (`Affordance`). Default `raise` lifts toward `#242A31` and draws a hairline. `brand` only brightens `#D6E35A` to `#DDE874`. `none` keeps today's look.
- Workout hover and press stay in `frontend/src/press-feedback.ts`. Home and the tab bar stay on `frontend/src/affordance.ts`.
- `LiveNowStrip` takes `affordance` (Home, default off) and `feedback` (Community, default off). Home still passes only `affordance`. Community passes `feedback`.

- **Entry:** Home `quick-record` sits under the quick row, below Today. It opens
  `/record` (`frontend/app/record/index.tsx`). A finished recording opens
  `/record/[id]`, including from the workouts list when `item.activity` is set.
  Strength sessions still open `/workout/[id]`. The logger, rest timer, feed,
  and audience are unchanged.
- **Save:** `POST /api/workouts/recorded` inserts an already-finished workout
  (`source: phone_recorder`, `duration_sec` = moving time). It does not call
  `finish_workout` and does not leave `ended_at` null, so it does not become
  Home `active_workout`. Idempotent on `(user_id, activity.client_id)`.
  Client distance is rejected (`extra=forbid`). The server haversine is the
  stored `activity.distance_m`. The trace is `workout_routes`, owner-only
  `GET /workouts/{id}/route` (a coach who can open the workout still gets 403).
- **Honesty:** time is the moving clock. GPS distance, pace or speed, and the
  route come from accepted fixes. A gap over 20s or an impossible jump is not
  drawn. Hike uses coarse GPS (50 m accuracy ceiling, 4 m/s). Steps are stored
  only when the pedometer counted some during the recording. Elevation is
  barometer relative altitude only, with a 1 m deadband. No calories. No
  wearable_metrics write. No background location task.

- **2026-10-01 — staff accounting:** `backend/accounting.py` owns `GET /admin/accounting/summary` (`accounting.read`, admin staff only). It reads `community_checkouts`, `billing_events`, `subscriptions`, `partner_ledger`, `referrals`, and `commissions` when that collection exists. Totals are `{amount_cents, currency}` in the stored currency, with no conversion and no zero filled in for a missing or empty window. A failed read does not blank the report. Opening it writes `audit_log` action `accounting.viewed`. The console tab mounts `AccountingPanel` only after it is chosen.
- **Web:** `watchLocation` uses `navigator.geolocation` because Expo's web
  bridge emits the browser watch id, which does not match its subscriber id.

## Interaction affordance (verified 2026-10-01, main `6422411`)

- There was no shared press or hover helper. `frontend/src/affordance.ts`
  (`useReducedMotion`, `pressableStyle`) is that helper. Web hover is 140ms.
  Reduced motion keeps the color or opacity change and drops scale and the
  transition. Disabled controls return no extra style.
- React Native Web `Pressable` already sets `cursor: pointer`, and
  `app/+html.tsx` does the same for buttons and tabs. `hovered` is passed at
  runtime and is absent from the React Native style-callback type.
- The default bottom-tab button uses `pressOpacity: 1` and no `hoverEffect`.
  `app/(tabs)/_layout.tsx` replaces it with `TabBarButton`, which still
  forwards `href` and ignores modified clicks so a plain click stays in the
  app.
- `MuscleHeatmap` is shared with `/muscles` (opened from the workout logger)
  through a relative import in `muscle-explorer.tsx`. `LiveNowStrip` is shared
  with Community. Both take `affordance` (default off). Home passes it. The
  SVG muscle regions already highlight the selected muscle and were left alone.
- `recorder.spec.ts` and `activity-day.spec.ts` assert computed background and
  text colors. Primary hover uses `filter: brightness(1.06)` so the chartreuse
  fill stays `rgb(214, 227, 90)`. Activity hover never uses `colors.brand`.

## Added 2026-10-01 (readiness)

- **2026-10-01 — Manual morning check-in.** `POST /api/wearables/manual` upserts one `wearable_metrics` row per metric for that local day (`device: manual`, `simulated: false`) for sleep hours, soreness, and mood. It does not write a recovery or readiness score; skipping the screen writes nothing. `recovery_snapshot` and `readiness.today_for` read those rows. Home opens `/morning` only when `readiness.confidence` is below 0.5, and does not call this route on first paint.
- **Readiness — `backend/readiness.py`.** Sole owner of the 0–100 score. Weights when present: HRV vs the 14-day baseline 35, resting HR vs that baseline 20, sleep vs an 8h need 25, acute:chronic load 20. Missing inputs are dropped and the rest reweighted; confidence is the share of weight present. Unknown and non-positive inputs are omitted, never scored as 0. Until wearable `training_load` rows exist, load is Foster session-RPE (`perceived_effort × duration_sec / 60`) on finished workouts. `GET /readiness/today` returns the object; `home_today_for` also sets `readiness`, so Home does not need that route to paint. Rings stay Strain / Recovery / Sleep.
- **Session load (2026-10-01):** Foster sRPE `load_au = perceived_effort × duration_sec / 60` is written by `finish_workout` when both inputs exist. Old rows are not backfilled; `training_load.load_for_read` computes them. `dashboard_snapshot` adds `training.load_week`, `load_28d_avg` (28-day sum / 4), and `acwr`. Home shows that week load in the Strain slot as LOAD / CHARGE when `strain` is null, and "—" when nothing has a computable load.
- **2026-10-01 — Coach chat.** `POST /api/coach/chat` (`routers/coach_chat.py`) accepts `{message}` and returns plain text from `llm_text(..., task="fast")`. Context is the existing `recovery_snapshot`, `training_history`, and `relevant_biomarkers`, plus the active program summary and the last 20 turns in `coach_conversations`. Both turns are stored. `coach_chat` allows 40 messages per user per day. The model name is neither stored nor returned. `GET /api/coach/chat` is only for the chat screen. Home `coach-tip-card` opens `/coach/chat`; `coach-tip-plan` still opens `/program`. Home first paint does not call the chat route.

## Added 2026-10-01 (gym partners)

- **Gyms** are owned by `backend/routers/gyms.py` (`ensure_gyms`, `list_gyms`, `gym_checkin`, `my_visits`, moved from wearables). Optional gym fields: `owner_user_id`, `partner_status` (`pending`|`active`|`paused`), `plan` (`free`|`partner`, no billing) and `reward` `{title, kind: free_session|discount|merch|custom, note}`. An every-10 check-in at an **active** partner inserts `rewards` (`issued`|`redeemed`|`expired`, `expires_at`) and notifies `gym_reward`. The owner redeems with `POST /api/gyms/{id}/redeem`. `/gym/manage` and reward fetches are not on first paint.

## Added 2026-10-01 (deploy health and shared Motor client)

- **Deploy:** `backend/db.py` owns the tz-aware Motor client (`MONGO_URL`, `DB_NAME` default `ironflow`); `server.py` re-exports `client` and `db`, and existing routes still use that `db`. `GET /api/health` pings Mongo (503 when the ping fails) and reports `ai_configured` from `ai.provider_configured` with no network call — `LLM_PROVIDER=none` and `auto` with no keys are not configured; explicit `ollama` is. `GET /api/` is unchanged. `staff_roles.py` holds `STAFF_ROLES` so `seed_scripts/grant_staff.py` imports `db` and the role table without loading `staff` (that import cycled `staff` → `server` → `routers/admin.py` `staff.require`). Python 3.12 (`backend/.python-version`, `backend/Dockerfile`). `boto3` stays because `media_storage.store` imports it when `MEDIA_S3_BUCKET` is set. Render: `render.yaml` services `api` and `centrifugo` (`deploy/centrifugo`), env groups `ironflow-backend` and `ironflow-integrations`. Lab files still use `storage.py` plus `EMERGENT_LLM_KEY`.

## Pro subscription (2026-10-01)

- **Stripe Billing, web checkout.** `POST /api/subscriptions/checkout` opens a subscription Checkout for `pro_monthly` or `pro_yearly` using `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_PRO_YEARLY`. Yearly has a 7-day trial, automatic tax, and promotion codes. The Customer id is `users.stripe_customer_id`. Only the signed webhook (`metadata.kind = pro`, plus subscription and invoice events) writes `subscriptions`; the success URL grants nothing. Amounts are `{amount_cents, currency}` in Stripe's minor unit, so JPY is not scaled and EUR is not assumed. `GET /subscriptions/current` is still `{plan, status}` when there is no live row, and adds `currency`, `amount_cents`, and `current_period_end` when there is. `POST /api/subscriptions` still cannot mint a paid plan. `require_pro` gates the existing `POST /biomarkers`, `POST /labs/upload`, and wearable sync routes. No Connect, Mobile Money, or XAF.

## Added 2026-10-01 (trends, rebased onto `1ba878d`)

- **`GET /api/trends?days=30|90`** (`routers/trends.py`) is the signed-in athlete's daily UTC series: `readiness` (wearable `recovery`, last value that day — not the 0–100 score in `readiness.py`), `hrv`, `resting_hr`, `sleep_hours`, `load_au` (session RPE: `perceived_effort × duration_sec / 60`), `tonnage` (`weight_kg × reps` on that user's sets), and per-muscle tonnage from `exercises.primary_muscle_slug`. A day with no reading is `null`. The route uses `current_user`, not `require_pro`. Home `quick-labs` still opens `/labs` (French "ANALYSES"). `quick-analysis` opens `/analysis`, uses the same surface hover as the other Home rows, and Home does not import that screen or call `/api/trends` on load. The shared SVG chart is `src/components/line-chart.tsx` (progression reuses it; a missing day breaks the line). On `/analysis`, chartreuse is only the selected 30/90 tab.
