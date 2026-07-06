-- 007_nav_order.sql
-- Lets each coach/admin persist a custom order for their sidebar nav tabs.
-- Stored as a JSON array of tab keys, e.g. ["workouts","leaderboard",...].
-- Null means "use the default order".

alter table public.profiles
  add column if not exists nav_order jsonb;
