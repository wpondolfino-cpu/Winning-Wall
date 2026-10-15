-- ============================================================
-- 179b_leaderboard_view_scope.sql
--
-- The leaderboard view (which also feeds the Players page's Active /
-- "Not seen 14+ days" lists) ran with the database owner's rights, so it
-- skipped the program fence from 179 and listed every program's players.
-- security_invoker makes it run as the person looking, so it only
-- returns players they can see: their own program's.
--
-- NOTE for later migrations: if this view is ever re-created
-- ("create or replace view public.leaderboard ..."), add
-- "with (security_invoker = true)" or this fix is lost.
-- ============================================================

alter view public.leaderboard set (security_invoker = true);

select 'leaderboard view runs as viewer' as item,
       coalesce((select 'yes' from pg_class
                 where relname = 'leaderboard' and relnamespace = 'public'::regnamespace
                   and reloptions @> array['security_invoker=true']), 'NO') as value;
