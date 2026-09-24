-- 146_staff_delete_attempts.sql
--
-- Coaches can delete a single logged attempt from a player's History.
--
-- Fixing a fat-fingered 550 in Edit Scores corrects the leaderboard row,
-- but the attempt itself stayed in the player's History and Chart for
-- good. Only admins could delete attempts (033); this extends DELETE --
-- and only DELETE -- to coaches.

drop policy if exists "attempts_staff_delete" on public.score_attempts;
create policy "attempts_staff_delete" on public.score_attempts
  for delete using (public.is_staff(auth.uid()));
