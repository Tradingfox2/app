-- Referral link and the partners ledger. Mongo is the writer.
-- A sign-up stores referred_by and pays nothing. The first paid invoice
-- writes commissions: level 1 is 20 percent, level 2 is 5 percent, no level 3.
-- amount_cents stays null when it was not stored. It is never filled in as 0.

alter table public.users add column if not exists referred_by uuid references public.users(id) on delete set null;
alter table public.users add column if not exists pro_credit_until timestamptz;
alter table public.users add column if not exists referral_settled_invoice text;

comment on column public.users.referred_by is
    'Direct referrer. Set from an optional referral_code at signup. Not a reward.';
comment on column public.users.pro_credit_until is
    'Pro access granted as referral credit days. Null means none were granted.';
comment on column public.users.referral_settled_invoice is
    'Invoice id of the first paid invoice. A later invoice does not pay again.';

create table if not exists public.commissions (
    id uuid primary key default gen_random_uuid(),
    beneficiary_id uuid not null references public.users(id) on delete cascade,
    source_user_id uuid not null references public.users(id) on delete cascade,
    level integer not null check (level in (1, 2)),
    kind text not null check (kind in ('pro', 'club')),
    amount_cents integer check (amount_cents is null or amount_cents > 0),
    currency text,
    status text not null check (status in ('pending', 'paid', 'clawed_back')),
    invoice_id text,
    charge_id text,
    payment_intent text,
    reward text not null check (reward in ('cash', 'pro_credit_days')),
    credit_days integer check (credit_days is null or credit_days >= 0),
    paid_at timestamptz,
    clawed_back_at timestamptz,
    created_at timestamptz not null default now(),
    unique (source_user_id, level)
);

create index if not exists idx_commissions_beneficiary on public.commissions(beneficiary_id, status);
create index if not exists idx_commissions_invoice on public.commissions(invoice_id);

alter table public.commissions enable row level security;

drop policy if exists commissions_beneficiary_select on public.commissions;
create policy commissions_beneficiary_select on public.commissions
    for select using (beneficiary_id = auth.uid());
