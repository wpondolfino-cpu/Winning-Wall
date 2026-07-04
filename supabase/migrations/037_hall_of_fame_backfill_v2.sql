-- Backfill Hall of Fame drill records from existing competitive scores
-- Run once to populate records table from historical data
INSERT INTO public.records (record_type, workout_id, workout_title, workout_desc, player_id, player_name, avatar_url, value, display_value, season)
SELECT
  'best_score',
  w.id,
  w.title,
  coalesce(w.description, ''),
  p.id,
  p.name,
  p.avatar_url,
  GREATEST(s.made + s.reps, s.self_points),
  GREATEST(s.made + s.reps, s.self_points)::text,
  CASE
    WHEN extract(month from now()) >= 6
    THEN extract(year from now())::text || '-' || (extract(year from now()) + 1)::text
    ELSE (extract(year from now()) - 1)::text || '-' || extract(year from now())::text
  END
FROM public.scores s
JOIN public.profiles p ON p.id = s.player_id
JOIN public.workouts w ON w.id = s.workout_id
WHERE w.scoring_type = 'competitive'
  AND (s.made + s.reps + s.self_points) > 0
ON CONFLICT DO NOTHING;
