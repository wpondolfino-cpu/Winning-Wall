-- 064_push_subscribed_flag.sql
-- Tracks whether a player has successfully enabled push notifications,
-- so coaches can see who to nudge in Players & Coaches.

alter table public.profiles
  add column if not exists push_subscribed boolean not null default false;
