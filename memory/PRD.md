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
- Real Terra connection (needs TERRA_API_KEY/TERRA_DEV_ID in backend/.env)
- HealthKit / Health Connect native reads (needs native build)
- Stripe subscriptions + coach payouts
- Group session live streaming
- Migration to real Supabase once user provides credentials

## Delivered this session (June 2026)

### 1. Adaptive programming engine (LLM, strict JSON — never free text)
- `POST /api/coach/generate` — goal/level/days_per_week/equipment/weeks_count +
  recent 14d history + recovery (HRV vs 7d baseline, sleep, recovery score) +
  biomarkers → GPT-5.4 with bounded system prompt (periodization,
  agonist/antagonist balance ±20%, progressive overload, deload if fatigue
  high). Output validated by Pydantic (backend) + Zod (`src/program-schema.ts`).
- `POST /api/coach/adjust` — recovery-gated workout: rewrites today's session
  (volume −30-50%, RPE ≤7, %1RM ≤70) only when fatigue is high; audit stored
  in `programs.adjustments`. `GET /api/programs` (RLS aware).
- Screen `/program`: generation form (chips), week/phase browser, day cards,
  "Adjust today's session" with recovery banner.

### 2. Lab report ingestion & interpretation (n8n-compatible, in-backend)
- `POST /api/labs/upload` (PDF/JPG/PNG/WebP ≤15MB) → Emergent Object Storage
  (private, `ironflow/uploads/{user}/`) → background pipeline: OCR (Gemini
  vision) → extraction LLM (strict JSON) → normalization (~40-alias marker
  registry → canonical slugs) → bounded educational interpretation in French
  (summary/trends/flags) → biomarkers written → in-app notification.
- Every report: `disclaimer` + `requires_professional_review: true`; full
  audit trail in `report.steps` + `audit_logs` collection.
- `GET /api/labs/reports[/{id}]`, `GET /api/biomarkers/grouped` (time series),
  `GET /api/notifications`, `POST /api/webhooks/n8n/labs` (ready for external
  n8n via N8N_WEBHOOK_SECRET).
- Screen `/labs`: upload PDF/photo, live pipeline status (polling), tap report
  → interpretation + disclaimer, marker cards with sparklines + ref ranges.

### 3. Wearables (Terra-ready) + gym QR check-in
- Providers: garmin/whoop/fitbit/oura/apple_health/health_connect.
  `GET /api/wearables/sources`, connect/disconnect/sync per provider.
  Sync is SIMULATED (7 days of hrv/resting_hr/sleep/steps/calories/strain/
  recovery + vo2max) until TERRA_API_KEY+TERRA_DEV_ID are set.
- `POST /api/webhooks/terra` ready-to-plug (normalizes Terra payloads into
  wearable_metrics). Home rings now show real (simulated) data.
- Gym QR check-in: 3 seeded gyms (`IRONFLOW-GYM:<id>` QR), `POST /api/gyms/
  checkin` (visit + reward every 10 visits, optional workout link),
  `GET /api/gyms/visits`. Screen `/checkin`: camera QR scan (expo-camera,
  full permission flow incl. Open Settings) + web/manual fallback list.
- Screen `/sources`: connected sources, sync state, simulated badge, native-
  build notes. Home quick actions: AI COACH / LABS / SOURCES / CHECK-IN.

### Fixes from iteration_1 minor items
- POST /api/workouts + /sets now return 201; progression single-pass query;
  heatmap bodyweight sets contribute proportional to reps.

### Testing
- iteration_2: 28/28 backend tests pass; all frontend flows verified
  (program, labs, sources, checkin, home quick actions).

### Backend layout
- `server.py` (core) + `routers/program.py`, `routers/labs.py`,
  `routers/wearables.py`, `ai.py` (LLM helpers), `storage.py` (object storage).
- `.env`: EMERGENT_LLM_KEY set; optional TERRA_API_KEY/TERRA_DEV_ID/
  N8N_WEBHOOK_SECRET activate real integrations.

## Delivered (Sept 2026, local runtime)

### AI coach — real providers, no vendor SDK
- `ai.py` rewritten on plain httpx: `LLM_PROVIDER=anthropic|ollama|openrouter|auto`.
  Claude Messages API (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, default
  `claude-sonnet-5`), Ollama `/api/chat` (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
  `OLLAMA_VISION_MODEL` for lab OCR), OpenRouter chat completions. `auto` picks
  Anthropic → OpenRouter → Ollama. `<think>` blocks from reasoning models stripped.
- `POST /api/coach/muscle-circuit` now calls the LLM (strict JSON, validated
  against the allowed slugs) and falls back to a rule-based circuit only when no
  provider is reachable (`source` field tells which).
- `GET /api/coach/status` (provider, model, connected, installed Ollama models),
  `GET /api/coach/models/ollama`. Home "Coach tip" card shows a live AI badge.

### Add exercises to a workout from the Muscle Explorer
- Workouts carry `planned_exercise_slugs`; `GET /api/workouts/{id}` resolves them;
  `POST /api/workouts/{id}/plan` appends (409 once finished).
- Detail sheet: `+` on every exercise card, "Add N exercises to workout" on each
  circuit (deterministic + AI). Reuses the open session or creates one; toast with
  OPEN → logger. Logger shows a PLANNED queue (chips, ✓ when sets logged) and
  preselects the next unlogged planned exercise; reloads on focus.

### Home dashboard
- `/api/dashboard` adds `training` (sets, tonnage, minutes, muscles, streak),
  `resting_hr`, `wearable_connected`, `active_workout`.
- New TRAINING · 7 DAYS card, "Connect a source" CTA when rings are empty,
  START WORKOUT creates a session directly / RESUME SESSION when one is open.
- Did-you-know banner: `GET /api/tips/daily?count=5..10` (60-tip curated
  library, stable per user per day), swipeable carousel with auto-advance
  (respects reduced motion).

### Navigation fixes
- `/muscles` opts back into the Stack header (root hides headers) with a brand
  back button; tab bar inactive colour raised to `textMuted` on a solid surface.
- Motor client is `tz_aware=True` (fixes naive/aware datetime crash in heatmap).
