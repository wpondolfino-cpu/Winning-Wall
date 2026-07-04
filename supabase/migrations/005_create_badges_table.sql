-- Run this in Supabase SQL Editor
-- Safe version - only adds what's missing

-- Add challenges_won to the trigger_type check constraint
ALTER TABLE public.badges DROP CONSTRAINT IF EXISTS badges_trigger_type_check;

ALTER TABLE public.badges ADD CONSTRAINT badges_trigger_type_check 
  CHECK (trigger_type IN ('workouts','points','streak','champion','top_score','challenges_won'));
