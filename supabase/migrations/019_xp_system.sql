-- ─────────────────────────────────────────────────────────────
-- 019_xp_system.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- XP settings table (admin-editable thresholds)
CREATE TABLE IF NOT EXISTS public.xp_settings (
  id            uuid primary key default uuid_generate_v4(),
  perk_key      text not null unique,
  perk_name     text not null,
  xp_required   integer not null,
  description   text,
  updated_at    timestamptz default now()
);

ALTER TABLE public.xp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "xp_read_all"   ON public.xp_settings FOR SELECT USING (true);
CREATE POLICY "xp_admin_write" ON public.xp_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Seed default perk thresholds
INSERT INTO public.xp_settings (perk_key, perk_name, xp_required, description) VALUES
  ('challenges_unlocked',  'Challenges Unlocked',    150,  'Head-to-head challenges become available. Avatar appears on leaderboard.'),
  ('team_eligible',        'Team Eligible',           300,  'Can be selected for team competitions. Light gray avatar outline.'),
  ('streak_shield',        'Streak Shield',           750,  'One missed-day streak save per biweekly period. Silver avatar outline.'),
  ('team_bonus',           'Team Boost',             1250,  'Your team automatically starts with +3 points in team competitions. Blue avatar outline.'),
  ('score_boost',          'Score Boost',            2000,  '+5 to one workout score once per biweekly period. Gold avatar outline.')
ON CONFLICT (perk_key) DO NOTHING;

-- XP log table (track how XP was earned)
CREATE TABLE IF NOT EXISTS public.xp_log (
  id          uuid primary key default uuid_generate_v4(),
  player_id   uuid references public.profiles(id) on delete cascade,
  xp_amount   integer not null,
  reason      text not null,  -- 'workout_attempt', 'challenge_sent', 'challenge_completed'
  earned_at   timestamptz default now()
);

ALTER TABLE public.xp_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "xp_log_read_own" ON public.xp_log FOR SELECT USING (auth.uid() = player_id);
CREATE POLICY "xp_log_insert" ON public.xp_log FOR INSERT WITH CHECK (true);
CREATE POLICY "xp_log_admin" ON public.xp_log FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coach'))
);

-- Perk usage tracking (for once-per-period perks)
CREATE TABLE IF NOT EXISTS public.perk_usage (
  id            uuid primary key default uuid_generate_v4(),
  player_id     uuid references public.profiles(id) on delete cascade,
  perk_key      text not null,
  period_start  date not null,
  used_at       timestamptz default now(),
  UNIQUE (player_id, perk_key, period_start)
);

ALTER TABLE public.perk_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perk_usage_own" ON public.perk_usage FOR ALL USING (auth.uid() = player_id);
CREATE POLICY "perk_usage_admin" ON public.perk_usage FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coach'))
);

-- Add total_xp to profiles for fast lookup
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_xp integer default 0;
