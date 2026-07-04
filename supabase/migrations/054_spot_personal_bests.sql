-- Per-spot personal bests for multi-spot workouts
CREATE TABLE IF NOT EXISTS public.spot_personal_bests (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id    uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  workout_id   uuid REFERENCES public.workouts(id) ON DELETE CASCADE,
  spot_index   int NOT NULL,   -- 0-based index of the spot
  spot_name    text NOT NULL,
  best_score   int NOT NULL,
  achieved_at  timestamptz DEFAULT now(),
  UNIQUE(player_id, workout_id, spot_index)
);

ALTER TABLE public.spot_personal_bests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Players can read own spot PBs" ON public.spot_personal_bests
  FOR SELECT USING (auth.uid() = player_id OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('coach','admin')
  ));
CREATE POLICY "Players can upsert own spot PBs" ON public.spot_personal_bests
  FOR ALL USING (auth.uid() = player_id);
