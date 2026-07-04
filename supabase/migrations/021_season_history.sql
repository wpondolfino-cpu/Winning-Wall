-- 021_season_history.sql
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.season_history (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid references public.profiles(id) on delete cascade,
  season_label    text not null,  -- e.g. "2024-25 Season"
  overall_rank    integer,
  group_rank      integer,
  grade_category  text,
  total_points    integer default 0,
  drill_wins      integer default 0,  -- # of #1 finishes on any drill
  h2h_wins        integer default 0,
  team_wins       integer default 0,
  created_at      timestamptz default now()
);

ALTER TABLE public.season_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sh_read_own"  ON public.season_history FOR SELECT USING (auth.uid() = player_id);
CREATE POLICY "sh_admin_all" ON public.season_history FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coach'))
);
