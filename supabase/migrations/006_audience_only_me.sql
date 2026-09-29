-- ============================================================================
-- IronFlow — Wave B: only_me audience
-- ----------------------------------------------------------------------------
-- Extend the CHECK on posts.audience and stories.audience. Author-only
-- visibility is enforced in the API/Mongo layer; SQL is the contract mirror.
-- This migration enables nothing new for RLS.
--
-- Allowed values become public, friends, and only_me. Column name, defaults
-- (posts: public, stories: friends), and nullability stay as migration 005
-- left them. Existing public and friends rows remain valid. club is not a
-- value in this wave.
--
-- Constraint names match what Postgres assigned to the inline CHECKs in
-- 005_athlete_personal_space.sql (posts_audience_check, stories_audience_check).
-- ============================================================================

alter table public.posts drop constraint if exists posts_audience_check;
alter table public.posts
    add constraint posts_audience_check
    check (audience in ('public', 'friends', 'only_me'));

alter table public.stories drop constraint if exists stories_audience_check;
alter table public.stories
    add constraint stories_audience_check
    check (audience in ('public', 'friends', 'only_me'));
