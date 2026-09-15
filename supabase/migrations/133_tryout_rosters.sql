-- 133_tryout_rosters.sql
--
-- A tryout player is in contention for rosters, not for a hardcoded
-- "upper" or "freshman".
--
-- tryout_group was two fixed values in a check constraint, derived from
-- grade on entry. It worked for one program's shape — varsity and JV
-- together, freshmen alone — and nothing ever read it, so nothing was
-- filtered by it either: a freshman tryout offered the varsity hopefuls
-- and the Team Designer would happily place a freshman onto the varsity
-- board.
--
-- Rosters already are what tryout groups wanted to become: arbitrary in
-- number, named by the coach, and per-program once programs exist. So a
-- pool player carries roster ids, a tryout practice already carries its
-- Team(s), and "who should this practice offer" is an overlap between the
-- two. That deletes a future migration rather than deferring one — there
-- is no separate list of tryout group names to invent later.
--
-- It also handles the case the old comment worried about without a
-- special rule: a freshman pulled up to the varsity tryout is simply in
-- contention for both rosters.
--
-- Existing rows are left blank deliberately. "upper" can't be mapped to
-- rosters without knowing a program's shape — it might mean Varsity, or
-- Varsity and JV — and guessing would put names in front of the wrong
-- tryout. Blank shows as "no teams set" and is fixed in a click.

alter table public.tryout_players
  add column if not exists roster_ids uuid[] not null default '{}';

comment on column public.tryout_players.roster_ids is
  'Which rosters this player is in contention for. A tryout practice offers anyone overlapping its own roster_ids. Empty means not yet decided — shown as "no teams set" rather than guessed at.';

create index if not exists tryout_players_roster_ids_idx
  on public.tryout_players using gin (roster_ids);

-- tryout_group stays for now: it is still written by the add paths and
-- dropping a column while the old client is live would break them
-- mid-deploy. It is read by nothing, and can go in a later migration once
-- this has been running for a while.
