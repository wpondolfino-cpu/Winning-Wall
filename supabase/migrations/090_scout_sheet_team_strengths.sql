-- 090_scout_sheet_team_strengths.sql
-- Team-wide Offensive Strengths chips for the Offense tab (distinct
-- from the per-player offensive_strengths on scout_players).
alter table public.scout_sheets add column if not exists team_offensive_strengths text[] not null default '{}';
