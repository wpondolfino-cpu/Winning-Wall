-- ─────────────────────────────────────────────────────────────
-- 017_teams.sql — Team Competitions
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Teams table
CREATE TABLE IF NOT EXISTS public.teams (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  color        text default '#1a3fa8',
  competition_id uuid,
  created_at   timestamptz default now()
);

-- 2. Team competitions table
CREATE TABLE IF NOT EXISTS public.team_competitions (
  id            uuid primary key default uuid_generate_v4(),
  is_active     boolean default false,
  bonus_points  integer default 10,
  start_date    date,
  end_date      date,
  winning_team_id uuid references public.teams(id),
  created_at    timestamptz default now()
);

-- 3. Add team_id to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS team_id uuid references public.teams(id);

-- 4. RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_competitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_read_all" ON public.teams FOR SELECT USING (true);
CREATE POLICY "teams_admin_write" ON public.teams FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coach','admin')));

CREATE POLICY "tc_read_all" ON public.team_competitions FOR SELECT USING (true);
CREATE POLICY "tc_admin_write" ON public.team_competitions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coach','admin')));
