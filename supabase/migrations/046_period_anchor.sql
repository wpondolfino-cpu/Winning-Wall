-- ─────────────────────────────────────────────────────────────
-- period_anchor_migration.sql
-- Run in Supabase SQL Editor
-- Adds app_settings table to store period anchor and other
-- global settings that previously lived in localStorage
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings (needed for period calculations)
CREATE POLICY "app_settings_read_all" ON public.app_settings
  FOR SELECT USING (true);

-- Only admins/coaches can update settings
CREATE POLICY "app_settings_admin_write" ON public.app_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coach')
    )
  );

-- Seed the default period anchor
-- Update this value to match your current period anchor
INSERT INTO public.app_settings (key, value)
VALUES ('period_anchor', '2025-05-03')
ON CONFLICT (key) DO NOTHING;
