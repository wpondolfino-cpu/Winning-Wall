-- 134_nav_home.sql
--
-- Lets each coach/admin choose the page the app opens to.
--
-- Stored as a tab key, e.g. 'practices'. Null means the default
-- (Manage Workouts). Only used when the app is opened without a tab in
-- the address (home-screen icon, typing the bare URL, signing in) --
-- a refresh keeps whatever ?tab= is already there.
--
-- Players don't use this: their landing page follows season mode
-- (Schedule in-season, Workouts offseason) and is set in App.tsx.
--
-- No policy change needed: the existing "Users can update own profile"
-- policy already covers it, the same way nav_order is saved.

alter table public.profiles
  add column if not exists nav_home text;
