-- ─────────────────────────────────────────────────────────────
-- tutorials_migration.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tutorials_seen (
  id          uuid primary key default uuid_generate_v4(),
  player_id   uuid not null references public.profiles(id) on delete cascade,
  tutorial_key text not null,
  seen_at     timestamptz default now(),
  unique(player_id, tutorial_key)
);

ALTER TABLE public.tutorials_seen ENABLE ROW LEVEL SECURITY;

-- Players can read and write their own tutorial state
CREATE POLICY "tutorials_seen_own" ON public.tutorials_seen
  FOR ALL USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS tutorials_seen_player_idx 
  ON public.tutorials_seen(player_id);
