-- Foster session load on a finished workout. Mongo is the writer.
-- No backfill: rows without load_au are computed on read from
-- perceived_effort and duration_sec.

alter table public.workouts
    add column if not exists load_au numeric;

alter table public.workouts
    drop constraint if exists workouts_load_au_check;

alter table public.workouts
    add constraint workouts_load_au_check check (load_au is null or load_au >= 0);

comment on column public.workouts.load_au is
    'Foster sRPE arbitrary units (perceived_effort x minutes). Written at finish. Null means not measured.';
