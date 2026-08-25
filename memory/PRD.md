# IronFlow — Product Requirements

Dark performance-first fitness / coaching mobile app (Expo) with a FastAPI
backend that mirrors a full Supabase schema and enforces the same RLS-like
coach ↔ client access rules.

## Delivered so far

### Monorepo layout (adapted to Emergent runtime)
- `/app/frontend` — Expo mobile app (dark Whoop/Strava aesthetic, electric lime)
- `/app/backend` — FastAPI + MongoDB, JWT auth, Supabase-schema mirror
- `/app/supabase` — SQL migrations (001_init, 002_rls) + seed.sql + README

### Schema (Supabase + Mongo mirror)
users · muscles · exercises · workouts · workout_sets · biomarkers ·
wearable_metrics · coach_relationships · communities · community_members ·
posts · group_sessions · session_participants · subscriptions · payouts ·
referrals — RLS enabled on every health/user table.

### Auth
- Email/password + JWT (bcrypt hashes, 30-day tokens).
- Demo athlete: `demo@ironflow.app` / `demo1234`.

### Frontend screens
- **Auth** — full-bleed hero + gradient, athlete/coach role toggle.
- **Home** — Whoop rings (Strain / Recovery / Sleep), HRV + Resting HR,
  Coach Tip, and **MuscleHeatmap** SVG (front + back body, 7-day volume).
- **Workouts** — Sessions tab + Library tab (50 exercises, filter chips
  by category + muscle). Sticky "New Session" CTA.
- **Workout Logger** (`/workout/[id]`) — fast set entry (reps/kg/RPE +
  add-set in <3 s), auto 90-s rest timer, exercise picker (search +
  muscle chips), offline queue banner, link to progression.
- **Progression** (`/progression/[id]`) — SVG e1RM line chart, PR card
  (Epley formula), tonnage / sets / sessions totals.
- **Community** — Feed composer + card feed, coaches list, group sessions.
- **Profile** — Plan selection (Free / Pro / Elite), referral code card,
  sign-out.

### Offline-first
- `src/offline-queue.ts` queues set writes in AsyncStorage, drains on
  reconnect via NetInfo listener, retries on the next flush.

### Testing
- 12/12 backend tests pass (auth, workout CRUD, RLS access control,
  progression Epley e1RM, muscle-heatmap secondary contribution).
- Frontend flow verified via screenshots: auth → home + heatmap →
  workouts → logger (set added, timer running) → progression (PR + chart).

## Next building blocks
- Wearable sync (Apple Watch / HealthKit / Garmin webhooks)
- Biomarker upload + n8n interpretation pipeline
- Stripe subscriptions + coach payouts
- Group session live streaming
