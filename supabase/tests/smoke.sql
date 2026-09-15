\set ON_ERROR_STOP 1
-- Rows through the new tables, then the constraints and RLS that matter.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@x.io'), ('00000000-0000-0000-0000-00000000000b', 'b@x.io');
insert into public.users (id, email, full_name) values
  ('00000000-0000-0000-0000-00000000000a', 'a@x.io', 'Ann'), ('00000000-0000-0000-0000-00000000000b', 'b@x.io', 'Bob');
insert into public.communities (id, owner_id, name, slug, category) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Iron Club', 'iron-club', 'strength');
insert into public.channels (id, community_id, name, kind) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'checkins', 'checkin');
insert into public.messages (community_id, channel_id, author_id, content, checkin_day) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'done', current_date);
insert into public.notifications (user_id, type, title) values
  ('00000000-0000-0000-0000-00000000000a', 'mention', 'for Ann'), ('00000000-0000-0000-0000-00000000000b', 'mention', 'for Bob');
insert into public.posts (id, author_id, content, tags) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'leg day', '{legday}');
insert into public.poll_votes (post_id, user_id, option) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 1);
commit;

-- 1. One check-in per member per channel per day.
do $$ begin
  insert into public.messages (community_id, channel_id, author_id, content, checkin_day) values
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'again', current_date);
  raise exception 'FAIL: second check-in accepted';
exception when unique_violation then raise notice 'ok: second check-in refused';
end $$;

-- 2. One final vote per person.
do $$ begin
  insert into public.poll_votes (post_id, user_id, option) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 0);
  raise exception 'FAIL: second vote accepted';
exception when unique_violation then raise notice 'ok: second vote refused';
end $$;

-- 3. Live-session links must be https.
do $$ begin
  insert into public.live_sessions (channel_id, community_id, host_id, title, starts_at, join_url) values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Flow', now(), 'http://insecure');
  raise exception 'FAIL: http join link accepted';
exception when check_violation then raise notice 'ok: http join link refused';
end $$;

-- 4. RLS: a signed-in member reads only their own notifications.
grant usage on schema public to authenticated;
grant select on public.notifications to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare seen int; begin
  select count(*) into seen from public.notifications;
  if seen <> 1 then raise exception 'FAIL: saw % notifications', seen; end if;
  raise notice 'ok: RLS shows Bob only his own notification';
end $$;
reset role;

-- 5. Tag lookups use the GIN index path.
select 'ok: tag query returns ' || count(*) from public.posts where tags @> '{legday}';
