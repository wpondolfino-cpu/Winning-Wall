-- Add multi_spot support and resource_url to workouts table
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS spot_config jsonb DEFAULT NULL;

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS resource_url text DEFAULT NULL;
