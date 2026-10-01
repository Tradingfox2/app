-- ============================================================================
-- IronFlow — phone recorder
-- ----------------------------------------------------------------------------
-- Contract mirror for Mongo. The API writes the finished workout and the
-- route there. This table does not enable a second writer.
--
-- workouts.activity is the summary (kind, server-computed distance_m, moving
-- time, steps, elevation). Null steps or elevation means not measured.
-- workout_routes holds the GPS trace and is readable by the owner only. A
-- coach can still read the workout row through the existing policy.
-- ============================================================================

alter table public.workouts
    add column if not exists activity jsonb;

comment on column public.workouts.activity is
    'Phone recorder summary. distance_m is computed server-side from GPS. Null steps and elevation mean not measured.';

create table if not exists public.workout_routes (
    workout_id uuid primary key references public.workouts(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    segments jsonb not null,
    created_at timestamptz not null default now()
);

alter table public.workout_routes enable row level security;

drop policy if exists workout_routes_owner on public.workout_routes;
create policy workout_routes_owner on public.workout_routes
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
