-- ============================================================================
-- IronFlow — Initial schema (Supabase / PostgreSQL)
-- Domain: fitness / health / coaching (Whoop / Strava-style)
-- ============================================================================
-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
-- Supabase provides auth.users out-of-the-box. We mirror a public.users
-- profile row that references the auth user by id.
create table if not exists public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    email text unique not null,
    full_name text,
    avatar_url text,
    role text not null default 'athlete' check (role in ('athlete','coach','admin')),
    height_cm numeric,
    weight_kg numeric,
    birthdate date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- MUSCLES + EXERCISES  (library, publicly readable)
-- ---------------------------------------------------------------------------
create table if not exists public.muscles (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    name text not null,
    group_name text not null,           -- upper / lower / core / cardio
    created_at timestamptz not null default now()
);

create table if not exists public.exercises (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    name text not null,
    category text not null,             -- strength / cardio / mobility / plyo
    equipment text,                     -- barbell / dumbbell / bodyweight / machine / kettlebell
    difficulty text default 'beginner' check (difficulty in ('beginner','intermediate','advanced')),
    primary_muscle_id uuid references public.muscles(id) on delete set null,
    secondary_muscle_ids uuid[] default '{}',
    instructions text,
    image_url text,
    video_url text,
    created_at timestamptz not null default now()
);

create index if not exists idx_exercises_category on public.exercises(category);
create index if not exists idx_exercises_primary_muscle on public.exercises(primary_muscle_id);

-- ---------------------------------------------------------------------------
-- WORKOUTS + SETS
-- ---------------------------------------------------------------------------
create table if not exists public.workouts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    title text not null,
    notes text,
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    duration_sec integer,
    perceived_effort integer check (perceived_effort between 0 and 10),
    created_at timestamptz not null default now()
);
create index if not exists idx_workouts_user on public.workouts(user_id, started_at desc);

create table if not exists public.workout_sets (
    id uuid primary key default gen_random_uuid(),
    workout_id uuid not null references public.workouts(id) on delete cascade,
    exercise_id uuid not null references public.exercises(id) on delete restrict,
    set_index integer not null,
    reps integer,
    weight_kg numeric,
    duration_sec integer,
    distance_m numeric,
    rpe numeric,
    created_at timestamptz not null default now()
);
create index if not exists idx_sets_workout on public.workout_sets(workout_id, set_index);

-- ---------------------------------------------------------------------------
-- BIOMARKERS (blood analyses etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.biomarkers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    marker text not null,               -- e.g. hemoglobin, testosterone, cortisol
    value numeric not null,
    unit text not null,                 -- e.g. g/dL, ng/mL
    measured_at timestamptz not null default now(),
    source text default 'manual',       -- manual / lab_upload / n8n_pipeline
    reference_low numeric,
    reference_high numeric,
    notes text,
    created_at timestamptz not null default now()
);
create index if not exists idx_biomarkers_user on public.biomarkers(user_id, measured_at desc);

-- ---------------------------------------------------------------------------
-- WEARABLE METRICS (Apple Watch / Garmin / gym QR devices)
-- ---------------------------------------------------------------------------
create table if not exists public.wearable_metrics (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    metric text not null,               -- hrv, resting_hr, sleep_hours, steps, vo2max, strain, recovery
    value numeric not null,
    unit text,
    device text,                        -- apple_watch, garmin, whoop, fitbit
    recorded_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index if not exists idx_wearable_user_metric on public.wearable_metrics(user_id, metric, recorded_at desc);

-- ---------------------------------------------------------------------------
-- COACH RELATIONSHIPS
-- ---------------------------------------------------------------------------
create table if not exists public.coach_relationships (
    id uuid primary key default gen_random_uuid(),
    coach_id uuid not null references public.users(id) on delete cascade,
    client_id uuid not null references public.users(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending','active','paused','ended')),
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    unique (coach_id, client_id)
);
create index if not exists idx_coachrel_coach on public.coach_relationships(coach_id, status);
create index if not exists idx_coachrel_client on public.coach_relationships(client_id, status);

-- ---------------------------------------------------------------------------
-- COMMUNITIES + POSTS + GROUP SESSIONS
-- ---------------------------------------------------------------------------
create table if not exists public.communities (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.users(id) on delete cascade,
    name text not null,
    slug text unique not null,
    description text,
    cover_url text,
    is_public boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.community_members (
    community_id uuid not null references public.communities(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    role text not null default 'member' check (role in ('member','moderator','owner')),
    joined_at timestamptz not null default now(),
    primary key (community_id, user_id)
);

create table if not exists public.posts (
    id uuid primary key default gen_random_uuid(),
    community_id uuid references public.communities(id) on delete cascade,
    author_id uuid not null references public.users(id) on delete cascade,
    content text not null,
    media_urls text[] default '{}',
    workout_id uuid references public.workouts(id) on delete set null,
    like_count integer not null default 0,
    comment_count integer not null default 0,
    created_at timestamptz not null default now()
);
create index if not exists idx_posts_community on public.posts(community_id, created_at desc);
create index if not exists idx_posts_author on public.posts(author_id, created_at desc);

create table if not exists public.group_sessions (
    id uuid primary key default gen_random_uuid(),
    coach_id uuid not null references public.users(id) on delete cascade,
    community_id uuid references public.communities(id) on delete set null,
    title text not null,
    description text,
    starts_at timestamptz not null,
    duration_min integer not null default 60,
    max_participants integer,
    price_cents integer not null default 0,
    currency text not null default 'EUR',
    stream_url text,
    status text not null default 'scheduled' check (status in ('scheduled','live','ended','cancelled')),
    created_at timestamptz not null default now()
);
create index if not exists idx_sessions_coach on public.group_sessions(coach_id, starts_at desc);

create table if not exists public.session_participants (
    session_id uuid not null references public.group_sessions(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    joined_at timestamptz not null default now(),
    paid boolean not null default false,
    primary key (session_id, user_id)
);

-- ---------------------------------------------------------------------------
-- SUBSCRIPTIONS + PAYOUTS + REFERRALS
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    plan text not null check (plan in ('free','pro','elite','coach')),
    status text not null default 'active' check (status in ('active','trialing','past_due','canceled')),
    current_period_start timestamptz not null default now(),
    current_period_end timestamptz,
    provider text default 'stripe',
    provider_customer_id text,
    provider_subscription_id text,
    created_at timestamptz not null default now()
);
create index if not exists idx_subs_user on public.subscriptions(user_id, status);

create table if not exists public.payouts (
    id uuid primary key default gen_random_uuid(),
    coach_id uuid not null references public.users(id) on delete cascade,
    amount_cents integer not null,
    currency text not null default 'EUR',
    status text not null default 'pending' check (status in ('pending','processing','paid','failed')),
    period_start timestamptz not null,
    period_end timestamptz not null,
    provider text default 'stripe',
    provider_payout_id text,
    created_at timestamptz not null default now()
);
create index if not exists idx_payouts_coach on public.payouts(coach_id, created_at desc);

create table if not exists public.referrals (
    id uuid primary key default gen_random_uuid(),
    referrer_id uuid not null references public.users(id) on delete cascade,
    referred_id uuid references public.users(id) on delete set null,
    code text unique not null,
    status text not null default 'pending' check (status in ('pending','activated','rewarded')),
    reward_amount_cents integer not null default 0,
    reward_currency text not null default 'EUR',
    activated_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_referrals_referrer on public.referrals(referrer_id);
