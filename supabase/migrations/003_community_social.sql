-- ============================================================================
-- IronFlow — Community, social graph, moderation and notifications
-- ----------------------------------------------------------------------------
-- Brings the SQL schema level with what the FastAPI + MongoDB backend
-- actually stores today (routers/community.py, routers/social.py,
-- routers/admin.py, routers/notifications.py). Every table here corresponds to
-- a Mongo collection of the same name, so a future move to Supabase is a data
-- copy, not a redesign.
--
-- Conventions kept from 001/002:
--   * uuid ids, timestamptz, `on delete cascade` from the owning row
--   * enum-like columns are text + CHECK, so adding a value is one migration
--   * RLS is enabled on every table; the API uses the service role. The few
--     policies below cover what a client could safely read directly.
--
-- Health-data firewall: nothing in this file joins to biomarkers, lab reports
-- or wearable metrics. Shared programs copy the plan only (see
-- program_adoptions); challenges score from workouts only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- USERS: profile, privacy, staff and preference columns added since 001
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists bio text not null default '';
alter table public.users add column if not exists is_private boolean not null default false;
alter table public.users add column if not exists preferred_locale text not null default 'fr';
alter table public.users add column if not exists coach_status text not null default 'not_applied'
    check (coach_status in ('not_applied','pending','approved','rejected'));
alter table public.users add column if not exists staff_role text
    check (staff_role in ('support','moderator','admin'));
alter table public.users add column if not exists activity_ranking_opt_in boolean not null default false;
alter table public.users add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
alter table public.users add column if not exists suspended_at timestamptz;
alter table public.users add column if not exists suspended_until timestamptz;
alter table public.users add column if not exists suspension_reason text;

-- ---------------------------------------------------------------------------
-- MEDIA (uploads referenced by posts, messages, DMs, avatars, covers)
-- ---------------------------------------------------------------------------
create table if not exists public.media (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    kind text not null check (kind in ('image','video')),
    content_type text not null,
    bytes integer not null,
    key text not null,
    url text not null,
    created_at timestamptz not null default now()
);
create index if not exists idx_media_user on public.media(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- SOCIAL GRAPH: follows (with pending requests), blocks, mutes
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
    follower_id uuid not null references public.users(id) on delete cascade,
    followee_id uuid not null references public.users(id) on delete cascade,
    status text not null default 'active' check (status in ('active','pending')),
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    primary key (follower_id, followee_id),
    check (follower_id <> followee_id)
);
create index if not exists idx_follows_followee on public.follows(followee_id, status);

create table if not exists public.blocks (
    blocker_id uuid not null references public.users(id) on delete cascade,
    blocked_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id)
);

create table if not exists public.mutes (
    muter_id uuid not null references public.users(id) on delete cascade,
    muted_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (muter_id, muted_id)
);

-- ---------------------------------------------------------------------------
-- COMMUNITIES: columns added since 001
-- ---------------------------------------------------------------------------
alter table public.communities add column if not exists category text not null default 'general'
    check (category in ('strength','bodybuilding','powerlifting','crossfit','running','cycling',
                        'yoga','mobility','calisthenics','weight_loss','nutrition','combat','general'));
alter table public.communities add column if not exists join_policy text not null default 'open'
    check (join_policy in ('open','approval','paid'));
alter table public.communities add column if not exists price_cents integer not null default 0 check (price_cents >= 0);
alter table public.communities add column if not exists currency text not null default 'EUR';
alter table public.communities add column if not exists avatar_url text;
alter table public.communities add column if not exists rules text[] not null default '{}';
alter table public.communities add column if not exists welcome_message text not null default '';
alter table public.communities add column if not exists status text not null default 'active'
    check (status in ('active','archived'));
alter table public.communities add column if not exists archived_at timestamptz;
alter table public.communities add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_communities_discover on public.communities(is_public, status, category);

alter table public.community_members add column if not exists id uuid not null default gen_random_uuid();
alter table public.community_members add column if not exists status text not null default 'active'
    check (status in ('pending','active','rejected','left','banned','removed'));
alter table public.community_members add column if not exists entitlement_source text not null default 'free'
    check (entitlement_source in ('ownership','free','payment','invite'));
alter table public.community_members add column if not exists role_ids uuid[] not null default '{}';
alter table public.community_members add column if not exists timeout_until timestamptz;
alter table public.community_members add column if not exists onboarded_at timestamptz;
alter table public.community_members add column if not exists reviewed_by uuid references public.users(id) on delete set null;
alter table public.community_members add column if not exists updated_at timestamptz not null default now();
create unique index if not exists idx_members_id on public.community_members(id);
create index if not exists idx_members_status on public.community_members(community_id, status);

-- Roles: a bitmask per role (backend/permissions.py), ranked for hierarchy.
create table if not exists public.community_roles (
    id uuid primary key default gen_random_uuid(),
    community_id uuid not null references public.communities(id) on delete cascade,
    name text not null check (char_length(name) between 2 and 32),
    color text not null default '#9BE15D' check (color ~ '^#[0-9a-fA-F]{6}$'),
    rank integer not null default 1 check (rank between 0 and 100),
    permissions integer not null default 0,
    is_default boolean not null default false,
    created_at timestamptz not null default now()
);
create index if not exists idx_roles_community on public.community_roles(community_id, rank);
create unique index if not exists idx_roles_one_default on public.community_roles(community_id) where is_default;

-- ---------------------------------------------------------------------------
-- CHANNELS, MESSAGES, READ MARKERS
-- ---------------------------------------------------------------------------
create table if not exists public.channels (
    id uuid primary key default gen_random_uuid(),
    community_id uuid not null references public.communities(id) on delete cascade,
    name text not null,
    description text not null default '',
    kind text not null default 'text'
        check (kind in ('text','announcement','program','challenge','checkin','live')),
    category text,
    position integer,
    slowmode_sec integer not null default 0 check (slowmode_sec between 0 and 21600),
    is_default boolean not null default false,
    ranking_opt_in boolean not null default false,
    overwrites jsonb not null default '[]'::jsonb,   -- [{role_id, allow, deny}]
    challenge jsonb,                                  -- {metric, starts_at, ends_at, goal}
    status text not null default 'active' check (status in ('active','archived')),
    created_by uuid references public.users(id) on delete set null,
    archived_at timestamptz,
    created_at timestamptz not null default now()
);
create unique index if not exists idx_channels_name on public.channels(community_id, name) where status = 'active';

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    community_id uuid not null references public.communities(id) on delete cascade,
    channel_id uuid not null references public.channels(id) on delete cascade,
    author_id uuid not null references public.users(id) on delete cascade,
    content text not null default '',
    reply_to_id uuid references public.messages(id) on delete set null,
    media jsonb not null default '[]'::jsonb,
    reactions jsonb not null default '[]'::jsonb,     -- [{emoji, user_ids}]
    program jsonb,                                    -- shared program snapshot (plan only)
    live_session_id uuid,
    checkin_day date,
    pinned_at timestamptz,
    pinned_by uuid references public.users(id) on delete set null,
    edited_at timestamptz,
    status text not null default 'active' check (status in ('active','deleted','removed')),
    removed_by uuid references public.users(id) on delete set null,
    deleted_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_messages_channel on public.messages(channel_id, created_at desc);
-- One check-in per member per channel per day; deleting frees the day.
create unique index if not exists idx_messages_checkin on public.messages(channel_id, author_id, checkin_day)
    where checkin_day is not null and status = 'active';

create table if not exists public.channel_reads (
    channel_id uuid not null references public.channels(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    last_read_at timestamptz not null,
    primary key (channel_id, user_id)
);

create table if not exists public.community_invites (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    community_id uuid not null references public.communities(id) on delete cascade,
    created_by uuid not null references public.users(id) on delete cascade,
    max_uses integer check (max_uses between 1 and 1000),
    uses integer not null default 0,
    expires_at timestamptz,
    skip_approval boolean not null default false,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- FITNESS CHANNELS: challenges, shared programs, live sessions
-- ---------------------------------------------------------------------------
create table if not exists public.challenge_participants (
    channel_id uuid not null references public.channels(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    joined_at timestamptz not null default now(),
    primary key (channel_id, user_id)
);

create table if not exists public.programs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    status text not null default 'active' check (status in ('active','archived')),
    params jsonb not null default '{}'::jsonb,
    program jsonb not null,                          -- {weeks: [...]}
    recovery_snapshot jsonb,                         -- generator input; never shared
    model text,
    locale text,
    source jsonb,                                    -- set when adopted from a channel
    adjustments jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_programs_user on public.programs(user_id, created_at desc);

create table if not exists public.program_adoptions (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references public.messages(id) on delete cascade,
    channel_id uuid not null references public.channels(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (message_id, user_id)
);

create table if not exists public.live_sessions (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.channels(id) on delete cascade,
    community_id uuid not null references public.communities(id) on delete cascade,
    host_id uuid not null references public.users(id) on delete cascade,
    title text not null check (char_length(title) between 3 and 120),
    description text not null default '',
    starts_at timestamptz not null,
    duration_min integer not null default 60 check (duration_min between 10 and 480),
    join_url text check (join_url is null or join_url like 'https://%'),
    status text not null default 'scheduled' check (status in ('scheduled','live','ended','cancelled')),
    started_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_live_channel on public.live_sessions(channel_id, status, starts_at);

create table if not exists public.live_rsvps (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.live_sessions(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (session_id, user_id)
);

-- ---------------------------------------------------------------------------
-- POSTS: columns added since 001, plus likes, saves, comments, polls
-- ---------------------------------------------------------------------------
alter table public.posts alter column content set default '';
alter table public.posts add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.posts add column if not exists repost_of uuid references public.posts(id) on delete set null;
alter table public.posts add column if not exists repost_count integer not null default 0;
alter table public.posts add column if not exists workout_summary jsonb;
alter table public.posts add column if not exists tags text[] not null default '{}';
alter table public.posts add column if not exists poll jsonb;           -- {options, counts, closes_at}
alter table public.posts add column if not exists link_preview jsonb;
alter table public.posts add column if not exists edited_at timestamptz;
alter table public.posts add column if not exists status text not null default 'active'
    check (status in ('active','deleted'));
alter table public.posts add column if not exists removed_by uuid references public.users(id) on delete set null;
alter table public.posts add column if not exists deleted_at timestamptz;
create index if not exists idx_posts_tags on public.posts using gin (tags);
create index if not exists idx_posts_repost on public.posts(repost_of);

create table if not exists public.post_likes (
    post_id uuid not null references public.posts(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (post_id, user_id)
);

create table if not exists public.post_saves (
    user_id uuid not null references public.users(id) on delete cascade,
    post_id uuid not null references public.posts(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, post_id)
);
create index if not exists idx_saves_recent on public.post_saves(user_id, created_at desc);

create table if not exists public.poll_votes (
    post_id uuid not null references public.posts(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    option smallint not null check (option between 0 and 3),
    created_at timestamptz not null default now(),
    primary key (post_id, user_id)                   -- one final vote each
);

create table if not exists public.post_comments (
    id uuid primary key default gen_random_uuid(),
    post_id uuid not null references public.posts(id) on delete cascade,
    author_id uuid not null references public.users(id) on delete cascade,
    parent_id uuid references public.post_comments(id) on delete cascade,
    content text not null check (char_length(content) between 1 and 2000),
    like_count integer not null default 0,
    reply_count integer not null default 0,
    edited_at timestamptz,
    status text not null default 'active' check (status in ('active','removed')),
    removed_by uuid references public.users(id) on delete set null,
    deleted_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_comments_post on public.post_comments(post_id, created_at);

create table if not exists public.comment_likes (
    comment_id uuid not null references public.post_comments(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (comment_id, user_id)
);

-- ---------------------------------------------------------------------------
-- DIRECT MESSAGES
-- ---------------------------------------------------------------------------
create table if not exists public.direct_messages (
    id uuid primary key default gen_random_uuid(),
    thread_key text not null,                        -- sorted "a:b" of the two ids
    sender_id uuid not null references public.users(id) on delete cascade,
    recipient_id uuid not null references public.users(id) on delete cascade,
    content text not null default '',
    media jsonb not null default '[]'::jsonb,
    status text not null default 'active' check (status in ('active','deleted')),
    read_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_dm_thread on public.direct_messages(thread_key, created_at desc);
create index if not exists idx_dm_unread on public.direct_messages(recipient_id, read_at);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS + PUSH TOKENS
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    type text not null,
    title text not null,
    body text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    actor_ids uuid[] not null default '{}',
    actor_count integer not null default 0,
    read_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);

create table if not exists public.push_tokens (
    id uuid primary key default gen_random_uuid(),
    token text unique not null,
    user_id uuid not null references public.users(id) on delete cascade,
    platform text not null check (platform in ('ios','android','web')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_push_user on public.push_tokens(user_id);

-- ---------------------------------------------------------------------------
-- MODERATION: reports, audit trail, staff notes, coach applications
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid references public.users(id) on delete set null,   -- null = automated
    reported_user_id uuid references public.users(id) on delete set null,
    community_id uuid references public.communities(id) on delete cascade,
    target_type text not null check (target_type in ('post','comment','message','direct_message','user','community')),
    target_id uuid not null,
    reason text not null,
    detail text not null default '',
    content_snapshot text not null default '',
    auto_score numeric,
    metadata jsonb not null default '{}'::jsonb,
    status text not null default 'open' check (status in ('open','resolved')),
    resolution text check (resolution in ('dismissed','content_removed','user_suspended','warning_sent')),
    note text,
    reviewed_by uuid references public.users(id) on delete set null,
    reviewed_at timestamptz,
    reviewed_in text,                                -- 'community' when a community moderator closed it
    created_at timestamptz not null default now()
);
create index if not exists idx_reports_queue on public.reports(status, created_at);
create index if not exists idx_reports_community on public.reports(community_id, status);

-- Append-only by design: no update or delete path exists in the API.
create table if not exists public.audit_log (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.users(id) on delete set null,
    actor_email text,
    actor_staff_role text,
    action text not null,
    target_type text not null,
    target_id text not null,
    reason text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_audit_target on public.audit_log(target_id, created_at desc);

create table if not exists public.user_notes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    author_id uuid references public.users(id) on delete set null,
    note text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.coach_applications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    bio text not null,
    specialties text[] not null default '{}',
    credentials text[] not null default '{}',
    status text not null default 'pending' check (status in ('pending','approved','rejected')),
    review_note text,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- The API connects with the service role, which bypasses RLS. These rules
-- decide what an authenticated client may touch directly — deliberately
-- little: its own notifications, saves, push tokens and read markers.
-- Everything else is deny-by-default until an explicit policy exists.
-- ---------------------------------------------------------------------------
alter table public.media                  enable row level security;
alter table public.follows                enable row level security;
alter table public.blocks                 enable row level security;
alter table public.mutes                  enable row level security;
alter table public.community_roles        enable row level security;
alter table public.channels               enable row level security;
alter table public.messages               enable row level security;
alter table public.channel_reads          enable row level security;
alter table public.community_invites      enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.programs               enable row level security;
alter table public.program_adoptions      enable row level security;
alter table public.live_sessions          enable row level security;
alter table public.live_rsvps             enable row level security;
alter table public.post_likes             enable row level security;
alter table public.post_saves             enable row level security;
alter table public.poll_votes             enable row level security;
alter table public.post_comments          enable row level security;
alter table public.comment_likes          enable row level security;
alter table public.direct_messages        enable row level security;
alter table public.notifications          enable row level security;
alter table public.push_tokens            enable row level security;
alter table public.reports                enable row level security;
alter table public.audit_log              enable row level security;
alter table public.user_notes             enable row level security;
alter table public.coach_applications     enable row level security;

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
    for select using (user_id = auth.uid());

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists saves_own on public.post_saves;
create policy saves_own on public.post_saves
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists channel_reads_own on public.channel_reads;
create policy channel_reads_own on public.channel_reads
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists programs_own on public.programs;
create policy programs_own on public.programs
    for select using (user_id = auth.uid() or public.is_active_coach_of(user_id));

drop policy if exists dm_participants on public.direct_messages;
create policy dm_participants on public.direct_messages
    for select using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists coach_applications_own on public.coach_applications;
create policy coach_applications_own on public.coach_applications
    for select using (user_id = auth.uid());
