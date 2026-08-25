-- ============================================================================
-- IronFlow — Row Level Security policies
-- ----------------------------------------------------------------------------
-- Rule: a user can read/write only their own health rows.
-- A coach can read/write a client's health rows only if there is a row in
-- coach_relationships where coach_id = auth.uid() and status = 'active'.
-- ============================================================================

-- Helper: is (auth.uid) an active coach of `owner`?
create or replace function public.is_active_coach_of(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.coach_relationships cr
        where cr.coach_id = auth.uid()
          and cr.client_id = owner
          and cr.status = 'active'
    );
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS on every health-related / user-owned table
-- ----------------------------------------------------------------------------
alter table public.users              enable row level security;
alter table public.workouts           enable row level security;
alter table public.workout_sets       enable row level security;
alter table public.biomarkers         enable row level security;
alter table public.wearable_metrics   enable row level security;
alter table public.coach_relationships enable row level security;
alter table public.communities        enable row level security;
alter table public.community_members  enable row level security;
alter table public.posts              enable row level security;
alter table public.group_sessions     enable row level security;
alter table public.session_participants enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.payouts            enable row level security;
alter table public.referrals          enable row level security;

-- Library tables are readable by all authenticated users
alter table public.muscles   enable row level security;
alter table public.exercises enable row level security;

-- ----------------------------------------------------------------------------
-- USERS: read own row; coaches can read active clients; write own row
-- ----------------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
    for select using (
        id = auth.uid()
        or public.is_active_coach_of(id)
    );

drop policy if exists users_insert on public.users;
create policy users_insert on public.users
    for insert with check (id = auth.uid());

drop policy if exists users_update on public.users;
create policy users_update on public.users
    for update using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- Reusable macro: owner-or-active-coach policies applied to a table with
-- a `user_id` column.
-- ----------------------------------------------------------------------------

-- WORKOUTS
drop policy if exists workouts_select on public.workouts;
create policy workouts_select on public.workouts
    for select using (user_id = auth.uid() or public.is_active_coach_of(user_id));
drop policy if exists workouts_modify on public.workouts;
create policy workouts_modify on public.workouts
    for all using (user_id = auth.uid() or public.is_active_coach_of(user_id))
    with check (user_id = auth.uid() or public.is_active_coach_of(user_id));

-- WORKOUT_SETS (via workout ownership)
drop policy if exists sets_select on public.workout_sets;
create policy sets_select on public.workout_sets
    for select using (
        exists (
            select 1 from public.workouts w
            where w.id = workout_id
              and (w.user_id = auth.uid() or public.is_active_coach_of(w.user_id))
        )
    );
drop policy if exists sets_modify on public.workout_sets;
create policy sets_modify on public.workout_sets
    for all using (
        exists (
            select 1 from public.workouts w
            where w.id = workout_id
              and (w.user_id = auth.uid() or public.is_active_coach_of(w.user_id))
        )
    ) with check (
        exists (
            select 1 from public.workouts w
            where w.id = workout_id
              and (w.user_id = auth.uid() or public.is_active_coach_of(w.user_id))
        )
    );

-- BIOMARKERS
drop policy if exists biomarkers_select on public.biomarkers;
create policy biomarkers_select on public.biomarkers
    for select using (user_id = auth.uid() or public.is_active_coach_of(user_id));
drop policy if exists biomarkers_modify on public.biomarkers;
create policy biomarkers_modify on public.biomarkers
    for all using (user_id = auth.uid() or public.is_active_coach_of(user_id))
    with check (user_id = auth.uid() or public.is_active_coach_of(user_id));

-- WEARABLE_METRICS
drop policy if exists wearable_select on public.wearable_metrics;
create policy wearable_select on public.wearable_metrics
    for select using (user_id = auth.uid() or public.is_active_coach_of(user_id));
drop policy if exists wearable_modify on public.wearable_metrics;
create policy wearable_modify on public.wearable_metrics
    for all using (user_id = auth.uid() or public.is_active_coach_of(user_id))
    with check (user_id = auth.uid() or public.is_active_coach_of(user_id));

-- COACH_RELATIONSHIPS: both parties can see; either can create; only
-- the coach can update status (accept / pause / end)
drop policy if exists coachrel_select on public.coach_relationships;
create policy coachrel_select on public.coach_relationships
    for select using (coach_id = auth.uid() or client_id = auth.uid());
drop policy if exists coachrel_insert on public.coach_relationships;
create policy coachrel_insert on public.coach_relationships
    for insert with check (coach_id = auth.uid() or client_id = auth.uid());
drop policy if exists coachrel_update on public.coach_relationships;
create policy coachrel_update on public.coach_relationships
    for update using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- COMMUNITIES: readable if public or if user is a member; writable by owner
drop policy if exists communities_select on public.communities;
create policy communities_select on public.communities
    for select using (
        is_public
        or owner_id = auth.uid()
        or exists (
            select 1 from public.community_members m
            where m.community_id = id and m.user_id = auth.uid()
        )
    );
drop policy if exists communities_owner on public.communities;
create policy communities_owner on public.communities
    for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- COMMUNITY_MEMBERS: read your own memberships; members of the community
drop policy if exists members_select on public.community_members;
create policy members_select on public.community_members
    for select using (
        user_id = auth.uid()
        or exists (
            select 1 from public.community_members m2
            where m2.community_id = community_id and m2.user_id = auth.uid()
        )
    );
drop policy if exists members_modify on public.community_members;
create policy members_modify on public.community_members
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- POSTS: readable in public communities or where you're a member; author can write
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
    for select using (
        community_id is null
        or exists (
            select 1 from public.communities c
            where c.id = community_id and (
                c.is_public or c.owner_id = auth.uid()
                or exists (
                    select 1 from public.community_members m
                    where m.community_id = c.id and m.user_id = auth.uid()
                )
            )
        )
    );
drop policy if exists posts_author on public.posts;
create policy posts_author on public.posts
    for all using (author_id = auth.uid()) with check (author_id = auth.uid());

-- GROUP_SESSIONS: readable by coach, participants, and community members
drop policy if exists sessions_select on public.group_sessions;
create policy sessions_select on public.group_sessions
    for select using (
        coach_id = auth.uid()
        or exists (
            select 1 from public.session_participants sp
            where sp.session_id = id and sp.user_id = auth.uid()
        )
        or (community_id is not null and exists (
            select 1 from public.communities c
            where c.id = community_id and c.is_public
        ))
    );
drop policy if exists sessions_coach on public.group_sessions;
create policy sessions_coach on public.group_sessions
    for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- SESSION_PARTICIPANTS: read/write your own row; coach reads participants of own sessions
drop policy if exists sp_select on public.session_participants;
create policy sp_select on public.session_participants
    for select using (
        user_id = auth.uid()
        or exists (
            select 1 from public.group_sessions gs
            where gs.id = session_id and gs.coach_id = auth.uid()
        )
    );
drop policy if exists sp_modify on public.session_participants;
create policy sp_modify on public.session_participants
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- SUBSCRIPTIONS: user reads/writes own
drop policy if exists subs_own on public.subscriptions;
create policy subs_own on public.subscriptions
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- PAYOUTS: coach reads/writes own
drop policy if exists payouts_own on public.payouts;
create policy payouts_own on public.payouts
    for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- REFERRALS: referrer reads/writes; referred can read
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
    for select using (referrer_id = auth.uid() or referred_id = auth.uid());
drop policy if exists referrals_referrer on public.referrals;
create policy referrals_referrer on public.referrals
    for all using (referrer_id = auth.uid()) with check (referrer_id = auth.uid());

-- LIBRARY (public reference data)
drop policy if exists muscles_read on public.muscles;
create policy muscles_read on public.muscles for select using (true);

drop policy if exists exercises_read on public.exercises;
create policy exercises_read on public.exercises for select using (true);
