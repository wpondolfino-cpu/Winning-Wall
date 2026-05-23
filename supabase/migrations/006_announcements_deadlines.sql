-- ─────────────────────────────────────────────────────────────
-- 006_announcements_deadlines.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Add deadline column to workouts
ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS deadline timestamptz;

-- 2. Create announcements table
CREATE TABLE IF NOT EXISTS public.announcements (
  id          uuid primary key default uuid_generate_v4(),
  coach_id    uuid not null references public.profiles(id) on delete cascade,
  coach_name  text not null,
  message     text not null,
  is_pinned   boolean default false,
  created_at  timestamptz default now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Everyone can read announcements
CREATE POLICY "announcements_read_all" ON public.announcements
  FOR SELECT USING (true);

-- Only coaches/admins can create announcements
CREATE POLICY "announcements_coach_insert" ON public.announcements
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coach','admin'))
  );

-- Coaches/admins can delete their own announcements
CREATE POLICY "announcements_coach_delete" ON public.announcements
  FOR DELETE USING (coach_id = auth.uid());

-- Coaches/admins can update (pin/unpin) announcements
CREATE POLICY "announcements_coach_update" ON public.announcements
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coach','admin'))
  );
