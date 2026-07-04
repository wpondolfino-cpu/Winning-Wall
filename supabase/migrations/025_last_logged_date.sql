-- 025_last_logged_date.sql
-- Adds last_logged_date to scores table for timezone-safe daily limit

ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS last_logged_date date;

-- Backfill from existing logged_at
UPDATE public.scores SET last_logged_date = logged_at::date WHERE last_logged_date IS NULL;
