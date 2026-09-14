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
