-- ─────────────────────────────────────────────────────────────
-- 016_records.sql
-- Run in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- Records table — survives season resets
CREATE TABLE IF NOT EXISTS public.records (
  id           uuid primary key default uuid_generate_v4(),
  record_type  text not null,  -- 'best_score', 'most_points', 'most_workouts', etc.
  workout_id   uuid references public.workouts(id) on delete cascade,  -- for drill-specific records
  workout_title text,
  workout_desc  text,
  player_id    uuid references public.profiles(id) on delete set null,
  player_name  text not null,
  avatar_url   text,
  value        numeric not null,      -- the record value (score, count, etc.)
  display_value text,                 -- e.g. "42 shots" or "85%" 
  season       text,                  -- e.g. "2024-2025"
  achieved_at  timestamptz default now(),
  updated_at   timestamptz default now()
);

ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;

-- Everyone can read records
CREATE POLICY "records_read_all" ON public.records
  FOR SELECT USING (true);

-- Only service role / admin can insert/update
CREATE POLICY "records_admin_write" ON public.records
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coach','admin'))
  );

-- RPC: update a record if new value beats the old one
CREATE OR REPLACE FUNCTION public.upsert_record(
  p_type        text,
  p_workout_id  uuid,
  p_workout_title text,
  p_workout_desc  text,
  p_player_id   uuid,
  p_player_name text,
  p_avatar_url  text,
  p_value       numeric,
  p_display_value text,
  p_season      text
) RETURNS boolean AS $$
DECLARE
  existing_val numeric;
  is_new_record boolean := false;
BEGIN
  SELECT value INTO existing_val
  FROM public.records
  WHERE record_type = p_type
    AND (workout_id = p_workout_id OR (p_workout_id IS NULL AND workout_id IS NULL))
  LIMIT 1;

  -- Insert or update if new value is better
  IF existing_val IS NULL OR p_value > existing_val THEN
    INSERT INTO public.records (
      record_type, workout_id, workout_title, workout_desc,
      player_id, player_name, avatar_url,
      value, display_value, season, achieved_at, updated_at
    ) VALUES (
      p_type, p_workout_id, p_workout_title, p_workout_desc,
      p_player_id, p_player_name, p_avatar_url,
      p_value, p_display_value, p_season, now(), now()
    )
    ON CONFLICT (record_type, workout_id) DO UPDATE SET
      player_id     = EXCLUDED.player_id,
      player_name   = EXCLUDED.player_name,
      avatar_url    = EXCLUDED.avatar_url,
      value         = EXCLUDED.value,
      display_value = EXCLUDED.display_value,
      season        = EXCLUDED.season,
      achieved_at   = EXCLUDED.achieved_at,
      updated_at    = now();
    is_new_record := true;
  END IF;

  RETURN is_new_record;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.upsert_record(text,uuid,text,text,uuid,text,text,numeric,text,text) TO authenticated;

-- Add unique constraint for upsert to work
ALTER TABLE public.records DROP CONSTRAINT IF EXISTS records_type_workout_unique;
ALTER TABLE public.records ADD CONSTRAINT records_type_workout_unique 
  UNIQUE (record_type, workout_id) DEFERRABLE INITIALLY DEFERRED;
