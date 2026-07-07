-- 059_staff_read_all_challenges_bonuses.sql
-- Safety net for the new H2H Oversight and Team Stats views: ensures
-- coaches/admins can read every row in challenges and streak_bonuses,
-- not just ones they personally participated in.
--
-- This is purely additive. Postgres RLS policies are OR'd together
-- ("permissive" by default) — if a more restrictive policy already
-- exists (e.g. limiting players to their own rows), that stays exactly
-- as-is for players. This just adds an extra path for staff. If staff
-- could already read everything (RLS not restrictive, or already
-- covered), this changes nothing — safe either way.

drop policy if exists "staff_read_all_challenges" on public.challenges;
create policy "staff_read_all_challenges"
  on public.challenges for select
  using (
    auth.uid() in (select id from public.profiles where role in ('coach', 'admin'))
  );

drop policy if exists "staff_read_all_streak_bonuses" on public.streak_bonuses;
create policy "staff_read_all_streak_bonuses"
  on public.streak_bonuses for select
  using (
    auth.uid() in (select id from public.profiles where role in ('coach', 'admin'))
  );
