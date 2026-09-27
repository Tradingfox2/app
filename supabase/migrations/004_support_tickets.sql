-- ============================================================================
-- IronFlow — Support tickets
-- ----------------------------------------------------------------------------
-- SQL names follow schemaforge: public.support_tickets and
-- public.support_ticket_messages. The FastAPI backend stores the same fields
-- in Mongo collections `tickets` and `ticket_messages` (string uuid ids).
-- Column names match those Mongo fields exactly. There is no priority.
--
-- The API uses the service role and bypasses RLS. Policies below only let a
-- member read their own thread. Staff replies stay behind the API.
-- ============================================================================

create table if not exists public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    subject text not null check (char_length(subject) between 1 and 120),
    category text not null check (category in ('billing', 'account', 'bug', 'feature', 'other')),
    status text not null default 'open' check (status in ('open', 'pending', 'closed')),
    assignee_id uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_user
    on public.support_tickets (user_id, updated_at desc);
create index if not exists idx_support_tickets_status
    on public.support_tickets (status, updated_at desc);

create table if not exists public.support_ticket_messages (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null references public.support_tickets(id) on delete cascade,
    author_id uuid not null references public.users(id) on delete cascade,
    author_role text not null check (author_role in ('user', 'staff')),
    body text not null check (char_length(body) between 1 and 5000),
    media_id uuid references public.media(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists idx_support_ticket_messages_ticket
    on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

drop policy if exists support_tickets_own on public.support_tickets;
create policy support_tickets_own on public.support_tickets
    for select using (user_id = auth.uid());

drop policy if exists support_ticket_messages_own on public.support_ticket_messages;
create policy support_ticket_messages_own on public.support_ticket_messages
    for select using (
        exists (
            select 1
            from public.support_tickets ticket
            where ticket.id = ticket_id
              and ticket.user_id = auth.uid()
        )
    );
