-- ============================================================================
-- IronFlow — Product analytics events (schema mirror only)
-- ----------------------------------------------------------------------------
-- Numbered 005 because 004 is `004_support_and_dual_media.sql`.
--
-- Live source of truth is the MongoDB collection `analytics_events`.
-- FastAPI/Motor writes that collection and the admin rollup reads it
-- (backend/analytics.py, backend/routers/analytics.py). This file keeps the
-- Postgres shape level with Mongo, the same dual-store pattern as the other
-- migrations. The API does not write analytics here at runtime.
--
-- `ts` is the API receipt time in UTC, not the device clock.
-- RLS is on with no client policy. A future copy would use the service role.
-- ============================================================================

create table if not exists public.analytics_events (
    event_id uuid primary key default gen_random_uuid(),
    name text not null check (name in (
        'screen_view',
        'ticket_created',
        'ticket_replied',
        'post_created',
        'post_shared',
        'live_session_started',
        'live_session_joined'
    )),
    ts timestamptz not null default now(),
    actor_id uuid references public.users(id) on delete set null,
    role text check (role is null or role in ('athlete', 'coach', 'admin')),
    session_id text,
    source text not null check (source in ('client', 'server')),
    props jsonb not null default '{}'::jsonb
);

create index if not exists idx_analytics_events_name_ts
    on public.analytics_events(name, ts desc);

alter table public.analytics_events enable row level security;
