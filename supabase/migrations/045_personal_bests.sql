-- ─────────────────────────────────────────────────────────────
-- personal_bests migration
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.personal_bests (
  id           uuid primary key default uuid_generate_v4(),
  player_id    uuid not null references public.profiles(id) on delete cascade,
  workout_id   uuid not null references public.workouts(id) on delete cascade,
  raw_score    numeric not null,
  achieved_at  timestamptz not null default now(),
  unique(player_id, workout_id)
);

ALTER TABLE public.personal_bests ENABLE ROW LEVEL SECURITY;

-- Everyone can read personal bests
CREATE POLICY "personal_bests_read_all" ON public.personal_bests
  FOR SELECT USING (true);

-- Players can insert/update their own bests
CREATE POLICY "personal_bests_insert_own" ON public.personal_bests
  FOR INSERT WITH CHECK (player_id = auth.uid());

CREATE POLICY "personal_bests_update_own" ON public.personal_bests
  FOR UPDATE USING (player_id = auth.uid());

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS personal_bests_player_idx ON public.personal_bests(player_id);
CREATE INDEX IF NOT EXISTS personal_bests_workout_idx ON public.personal_bests(workout_id);
