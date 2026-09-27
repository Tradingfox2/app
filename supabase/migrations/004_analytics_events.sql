-- ============================================================================
-- IronFlow — Product analytics events
-- ----------------------------------------------------------------------------
-- Mirrors the MongoDB collection `analytics_events` written by FastAPI
-- (backend/analytics.py, backend/routers/analytics.py). A later move to
-- Supabase is a data copy: same names, same columns.
--
-- `ts` is the API receipt time in UTC, not the device clock.
-- The API uses the service role, which bypasses RLS. No client policy is
-- granted: athletes do not read or write this table directly.
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
