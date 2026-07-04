-- Add 'draft' as a valid visibility option
-- The check constraint needs updating if one exists
ALTER TABLE public.lifting_programs 
  DROP CONSTRAINT IF EXISTS lifting_programs_visibility_check;

ALTER TABLE public.lifting_programs
  ADD CONSTRAINT lifting_programs_visibility_check 
  CHECK (visibility IN ('public', 'assigned', 'personal', 'draft'));
