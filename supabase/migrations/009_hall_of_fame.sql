-- ─────────────────────────────────────────────────────────────
-- 009_hall_of_fame.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Create biweekly_champions table
CREATE TABLE IF NOT EXISTS public.biweekly_champions (
  id             uuid primary key default uuid_generate_v4(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  player_name    text not null,
  grade_category text,
  points         integer not null default 0,
  period_start   timestamptz not null,
  period_end     timestamptz not null,
  crowned_at     timestamptz default now(),
  avatar_url     text
);

-- 2. RLS: everyone can read hall of fame
ALTER TABLE public.biweekly_champions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hof_read_all" ON public.biweekly_champions
  FOR SELECT USING (true);

CREATE POLICY "hof_admin_insert" ON public.biweekly_champions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coach','admin'))
  );

-- 3. Add avatar_url column to biweekly_champions if it doesn't exist
ALTER TABLE public.biweekly_champions ADD COLUMN IF NOT EXISTS avatar_url text;

-- 4. Add period_number column for display purposes
ALTER TABLE public.biweekly_champions ADD COLUMN IF NOT EXISTS period_number integer;
