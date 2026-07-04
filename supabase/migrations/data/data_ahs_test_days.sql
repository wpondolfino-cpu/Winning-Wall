-- AHS Summer 2025 — Update test day notes for clarity
-- Run in Supabase SQL Editor

-- ── Pre-Test Day 0 notes ──────────────────────────────────────
UPDATE public.lifting_day_exercises
SET notes = 'Enter your jump height in INCHES in the Reps field. Best of 3 jumps. Example: jumped 24 inches = enter 24 reps.'
WHERE day_id = 'bbbbbbbb-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Vertical Jump');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your jump distance in INCHES in the Reps field. Best of 3 jumps. Example: jumped 84 inches = enter 84 reps.'
WHERE day_id = 'bbbbbbbb-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Broad Jump');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your time in SECONDS in the Weight field. 3/4 court sprint. Example: ran it in 4.2 seconds = enter 4.2 weight.'
WHERE day_id = 'bbbbbbbb-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Full Court Sprints');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your time in SECONDS in the Weight field. Run 17s and record your time. Example: finished in 58 seconds = enter 58 weight.'
WHERE day_id = 'bbbbbbbb-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = '17s Conditioning Test');

UPDATE public.lifting_day_exercises
SET notes = 'Enter total reps in the Reps field. Max chin-ups in one set — do not stop until you cannot do another rep.'
WHERE day_id = 'bbbbbbbb-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Chin-Up');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your 3 rep max weight in the Weight field. Build up to the heaviest weight you can do for exactly 3 reps.'
WHERE day_id = 'bbbbbbbb-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Trap Bar Deadlift');

-- ── Post-Test Day 71 notes ────────────────────────────────────
UPDATE public.lifting_day_exercises
SET notes = 'Enter your jump height in INCHES in the Reps field. Best of 3 jumps. Compare to your pre-test result!'
WHERE day_id = 'cccccccc-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Vertical Jump');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your jump distance in INCHES in the Reps field. Best of 3 jumps. Compare to your pre-test result!'
WHERE day_id = 'cccccccc-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Broad Jump');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your time in SECONDS in the Weight field. 3/4 court sprint. Compare to your pre-test result!'
WHERE day_id = 'cccccccc-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Full Court Sprints');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your time in SECONDS in the Weight field. Run 17s and record your time. Compare to your pre-test result!'
WHERE day_id = 'cccccccc-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = '17s Conditioning Test');

UPDATE public.lifting_day_exercises
SET notes = 'Enter total reps in the Reps field. Max chin-ups in one set. Compare to your pre-test result!'
WHERE day_id = 'cccccccc-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Chin-Up');

UPDATE public.lifting_day_exercises
SET notes = 'Enter your 3 rep max weight in the Weight field. Heaviest weight for exactly 3 reps. Compare to your pre-test result!'
WHERE day_id = 'cccccccc-0000-0000-0000-000000000000'
AND bank_exercise_id = (SELECT id FROM lifting_exercise_bank WHERE name = 'Trap Bar Deadlift');

