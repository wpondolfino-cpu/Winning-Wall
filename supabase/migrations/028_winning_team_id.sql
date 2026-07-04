-- 028_winning_team_id.sql
-- Adds winning_team_id to team_competitions so W/L records work

ALTER TABLE public.team_competitions 
ADD COLUMN IF NOT EXISTS winning_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
