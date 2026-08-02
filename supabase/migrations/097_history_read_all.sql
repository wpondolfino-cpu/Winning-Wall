-- 097_history_read_all.sql
-- season_history and inseason_history originally restricted players to
-- reading only their own archived row (fine for "here's your personal
-- record," not enough for an archive viewer showing the full past
-- leaderboard). Widening read access to everyone -- these are already
-- historical, frozen snapshots, so there's nothing sensitive being
-- exposed that a live leaderboard didn't already show at the time.

drop policy if exists "sh_read_own" on public.season_history;
drop policy if exists "sh_read_all" on public.season_history;
create policy "sh_read_all" on public.season_history for select using (true);

drop policy if exists "ih_read_own" on public.inseason_history;
drop policy if exists "ih_read_all" on public.inseason_history;
create policy "ih_read_all" on public.inseason_history for select using (true);
