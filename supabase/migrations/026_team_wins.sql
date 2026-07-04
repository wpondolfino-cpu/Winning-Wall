-- 026_team_wins.sql
-- Adds team_wins column to profiles for badge tracking

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS team_wins integer DEFAULT 0;
