# IronFlow — Supabase setup

Complete SQL migrations and seed data for the IronFlow fitness / coaching /
health platform. This directory is the source of truth for the database
schema, whether you deploy to Supabase (recommended) or reproduce the model
in another PostgreSQL instance.

## What's inside

```
supabase/
├── migrations/
│   ├── 001_init.sql                    -- tables, indexes, foreign keys
│   ├── 002_rls.sql                     -- Row Level Security policies + helper function
│   ├── 003_community_social.sql        -- community, social graph, media
│   ├── 004_support_and_dual_media.sql  -- support tickets + admin_media
│   ├── 005_athlete_personal_space.sql  -- profile wall, stories, audience
│   └── 006_audience_only_me.sql        -- audience also allows only_me
├── seed.sql           -- 15 muscles + 50 exercises
└── README.md
```

## Tables

| Table | Purpose |
|---|---|
| `users` | Public profile mirrored from `auth.users` |
| `muscles`, `exercises` | Public exercise library (50 seeded) |
| `workouts`, `workout_sets` | Training sessions and set-level data |
| `biomarkers` | Blood / body analysis results |
| `wearable_metrics` | Apple Watch / Whoop / Garmin metrics |
| `coach_relationships` | Coach ↔ client links with `status` |
| `communities`, `community_members`, `posts` | Social layer. `posts.audience` is `public` (default), `friends`, or `only_me` |
| `stories` | Workout stories and highlights. `stories.audience` is `friends` (default), `public`, or `only_me` |
| `group_sessions`, `session_participants` | Live group coaching sessions |
| `subscriptions`, `payouts`, `referrals` | Monetization layer |
| `media` | End-user uploads (`users/{user_id}/…` keys) |
| `admin_media` | Staff assets (`admin/{staff_id}/…`); purposes announcement, moderation evidence, exercise library, community asset, other |
| `support_tickets` | User support tickets (billing, account, bug, feature, other); status open/pending/closed |
| `support_ticket_messages` | Ticket thread; optional `media_id` points at `media` |

## RLS model

Every user-owned table has RLS enabled. Two access rules apply everywhere:

1. **Owner access** — `user_id = auth.uid()`.
2. **Coach access** — a coach can read/write a client's row only if there is
   a row in `coach_relationships` where `coach_id = auth.uid()`,
   `client_id = owner`, and `status = 'active'`. This is centralized in
   the SQL function `public.is_active_coach_of(owner uuid)`.

Reference tables `muscles` and `exercises` are readable by everyone.

`admin_media`, `support_tickets`, and `support_ticket_messages` enable RLS
and ship with no policies, so a direct client is denied. FastAPI uses the
service role and enforces access in the API.

`stories` enables RLS and ships with no policies (migration 005). Migration
006 does not add policies. `only_me` means the author alone; that visibility
is enforced in the API/Mongo layer. SQL only stores the allowed value.

## Audience

`posts.audience` and `stories.audience` allow `public`, `friends`, and
`only_me` (migration 006). Defaults stay `public` on posts and `friends` on
stories. Existing `public` and `friends` rows stay valid. `club` is not a
value.

## Deploy to Supabase

### Option A — Supabase Dashboard (fastest)

1. Create a new Supabase project → https://supabase.com/dashboard
2. In **SQL Editor**, paste and run in order:
   1. `migrations/001_init.sql`
   2. `migrations/002_rls.sql`
   3. `migrations/003_community_social.sql`
   4. `migrations/004_support_and_dual_media.sql`
   5. `migrations/005_athlete_personal_space.sql`
   6. `migrations/006_audience_only_me.sql`
   7. `seed.sql`
3. In **Project Settings → API**, copy:
   - `Project URL` → `EXPO_PUBLIC_SUPABASE_URL`
   - `anon public key` → `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### Option B — Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-ref>
supabase db push          # applies migrations/
psql "$SUPABASE_DB_URL" -f seed.sql
```

## Generate TypeScript types

```bash
supabase gen types typescript --project-id <your-ref> \
    --schema public > ../frontend/src/db/types.ts
```

## Local Expo wiring

Once the two keys are exported in `frontend/.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

the mobile app auto-detects Supabase mode and uses it as the backend
instead of the bundled FastAPI. Otherwise it falls back to the FastAPI
backend at `EXPO_PUBLIC_BACKEND_URL`, which mirrors this schema in MongoDB
and enforces the same coach-based access rules server-side.

## Notes

- `pgcrypto` is used for `gen_random_uuid()`; already available on Supabase.
- The `is_active_coach_of` function is `security definer` — grant only what
  is needed if you customize it.
- If you need audit logs, add `updated_by` columns and per-table triggers.
