-- ============================================================================
-- IronFlow — Athlete personal space
-- ----------------------------------------------------------------------------
-- Profile wall (cover, sports, about), friends-only posts, and workout
-- stories / highlights. Live writes stay in MongoDB (users, posts, stories).
-- This file is the schema contract, matching 003_community_social.sql.
--
-- Friends means an accepted follow (public.follows.status = active). A
-- missing posts.audience is public, so rows written before this migration
-- stay on the public feed.
-- ============================================================================

alter table public.users add column if not exists cover_url text;
alter table public.users add column if not exists sports text[] not null default '{}';
alter table public.users add column if not exists about text not null default '';

alter table public.posts add column if not exists audience text not null default 'public'
    check (audience in ('public', 'friends'));

-- ---------------------------------------------------------------------------
-- STORIES: 24h workout stories, or highlights kept on the profile
-- ---------------------------------------------------------------------------
create table if not exists public.stories (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null references public.users(id) on delete cascade,
    caption text not null default '',
    media jsonb not null default '[]'::jsonb,
    workout_id uuid references public.workouts(id) on delete set null,
    workout_summary jsonb,
    audience text not null default 'friends' check (audience in ('friends', 'public')),
    highlight boolean not null default false,
    highlight_title text,
    expires_at timestamptz,
    status text not null default 'active' check (status in ('active', 'deleted')),
    created_at timestamptz not null default now(),
    deleted_at timestamptz
);
create index if not exists idx_stories_author on public.stories(author_id, created_at desc);
create index if not exists idx_stories_active on public.stories(expires_at)
    where highlight = false and status = 'active';

alter table public.stories enable row level security;
