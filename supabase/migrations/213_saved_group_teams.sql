-- ============================================================
-- 213_saved_group_teams.sql
--
-- Saved groups keep their teams.
--
-- "Save these groups" stored who is in each group but not the teams
-- inside them (e.g. 2 groups of 20, each split into teams of 5). This
-- column holds the team rule and every group's teams, so "Pick saved
-- group" brings the whole thing back.
--
--   team_split = { "rule": "size", "n": 5, "teams": [[["id","id",...], [...]], ...] }
--   (teams[i] lines up with group i; null = no teams were saved)
--
-- Safe to run more than once. Changes nothing that already exists.
-- ============================================================

alter table public.saved_groupings
  add column if not exists team_split jsonb;
