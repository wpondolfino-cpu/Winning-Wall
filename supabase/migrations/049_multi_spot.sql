-- Step 1: Add multi_spot to the scoring_type enum
ALTER TYPE scoring_type ADD VALUE IF NOT EXISTS 'multi_spot';

-- Step 2: Add spot_config column to workouts table
-- Stores JSON array of spot names e.g. ["Left Corner","Left Wing","Top of Key","Right Wing","Right Corner"]
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS spot_config jsonb DEFAULT NULL;
