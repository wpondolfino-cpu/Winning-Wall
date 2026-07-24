-- 078_practice_day_attendance.sql
-- Supports the standalone "Practice Day" attendance screen:
--   1. attendance_taken_at — one timestamp per practice, stamped by an
--      explicit "Complete attendance" action and overwritten (not
--      logged) on every later re-completion. Null means attendance
--      hasn't been taken yet for this practice.
--   2. called_up_to_roster_id — which of the practice's roster(s) a
--      call-up is joining. Only meaningful for override_type =
--      'call_up'; null for single-roster practices and for 'excused'
--      rows. Needed so a mixed practice (e.g. Varsity + JV together)
--      can show a called-up player inside the correct team section
--      instead of a single undifferentiated list.

alter table public.practices
  add column if not exists attendance_taken_at timestamptz;

alter table public.practice_attendance_overrides
  add column if not exists called_up_to_roster_id uuid references public.rosters(id) on delete set null;
