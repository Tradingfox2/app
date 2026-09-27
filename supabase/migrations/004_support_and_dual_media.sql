-- IronFlow — Support tickets + dual media foundations
-- Migration: 004_support_and_dual_media.sql
-- Depends on: 001_init, 002_rls, 003_community_social
--
-- Locked with apismith (Support Tickets API v1):
--   support_tickets / support_ticket_messages field names below.
--   Attachments: nullable media_id on messages → public.media (reuse; no
--   user_media_objects; no purpose enum for tickets).
-- Dual media (schemaforge / eggbot):
--   admin_media table + admin/{staff_id}/ key prefix (see docs/STORAGE_LAYOUT.md).

-- ---------------------------------------------------------------------------
-- ADMIN MEDIA (staff-owned assets)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_media (
    id uuid primary key default gen_random_uuid(),
    uploader_staff_id uuid not null references public.users(id) on delete restrict,
    kind text not null check (kind in ('image', 'video', 'file')),
    content_type text not null,
    bytes integer not null check (bytes >= 0),
    key text not null unique,
    url text not null,
    purpose text not null check (purpose in (
        'announcement', 'moderation_evidence', 'exercise_library',
        'community_asset', 'other'
    )),
    created_at timestamptz not null default now(),
    deleted_at timestamptz
);

create index if not exists idx_admin_media_staff
    on public.admin_media(uploader_staff_id, created_at desc)
    where deleted_at is null;

create index if not exists idx_admin_media_purpose
    on public.admin_media(purpose, created_at desc)
    where deleted_at is null;

alter table public.admin_media enable row level security;

-- ---------------------------------------------------------------------------
-- SUPPORT TICKETS (apismith freeze)
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    subject text not null,
    category text not null
        check (category in ('billing', 'account', 'bug', 'feature', 'other')),
    status text not null default 'open'
        check (status in ('open', 'pending', 'closed')),
    assignee_id uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint support_tickets_subject_len check (char_length(subject) between 1 and 120)
);

create index if not exists idx_support_tickets_user
    on public.support_tickets(user_id);

create index if not exists idx_support_tickets_status
    on public.support_tickets(status);

create table if not exists public.support_ticket_messages (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null references public.support_tickets(id) on delete cascade,
    author_id uuid not null references public.users(id) on delete cascade,
    author_role text not null check (author_role in ('user', 'staff')),
    body text not null,
    media_id uuid references public.media(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint support_ticket_messages_body_len check (char_length(body) between 1 and 5000)
);

create index if not exists idx_support_ticket_messages_ticket
    on public.support_ticket_messages(ticket_id);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
