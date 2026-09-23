-- 143_one_season_list.sql
--
-- One list of seasons, and everything points at it.
--
-- There were three names for the same season, on three different rules:
--   · the seasons table — "2025-26", rolling over in July
--   · games — a string worked out from the date, "2026-2027", rolling in August
--   · the leaderboard archive — a label typed by hand at rollover, prefilled
--     "2026-27" from the calendar year with no month logic at all
-- So the reports season selector, which reads the strings on games, could
-- show "2026", "2027" and "2026-2027" as three seasons holding pieces of
-- one year.
--
-- A season now has a START DATE and nothing else. It runs until the next
-- one begins: the earliest has an open start, the current one an open end.
-- Nothing can fall outside a season, which is why no end date is needed
-- and why a July summer-league game has somewhere to go without inventing
-- a range for it.

alter table public.seasons
  add column if not exists start_date date;

comment on column public.seasons.start_date is
  'When this season begins. It runs until the next season starts — no end date, so no date can fall outside every season.';

-- Existing seasons get a start date from their name where it looks like a
-- school year ("2025-26" or "2025-2026"), else from when they were made.
-- August 1 is the assumption; it is editable in Settings.
update public.seasons
   set start_date = case
     when name ~ '^\d{4}' then make_date(substring(name from '^\d{4}')::int, 8, 1)
     else created_at::date
   end
 where start_date is null;

-- ── Which season a date belongs to ───────────────────────────
-- The latest season that had started by then. Used when filing a game,
-- and by the backfill below.
create or replace function public.season_for_date(p_date date)
returns uuid
language sql
stable
as $$
  select id from public.seasons
   where start_date is not null and start_date <= p_date
   order by start_date desc
   limit 1;
$$;

grant execute on function public.season_for_date(date) to authenticated;

-- ── Games belong to a season ─────────────────────────────────
alter table public.games
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

create index if not exists games_season_id_idx on public.games(season_id);

update public.games
   set season_id = public.season_for_date(game_date)
 where season_id is null and game_date is not null;

-- The old text column stays for now. Dropping it while the previous client
-- is still being served would break its reports mid-deploy; it can go once
-- this has been live a while.
comment on column public.games.season is
  'DEPRECATED — superseded by season_id. Still written so an older client keeps working.';

-- ── Archived leaderboards belong to a season ─────────────────
-- New archives point at the season that just ended. Old rows keep their
-- typed label and are matched by name where one matches — which is why
-- renaming a season doesn't re-link the ones it couldn't match.
alter table public.season_history
  add column if not exists season_id uuid references public.seasons(id) on delete set null;
alter table public.inseason_history
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

update public.season_history h
   set season_id = s.id
  from public.seasons s
 where h.season_id is null and trim(h.season_label) = trim(s.name);

update public.inseason_history h
   set season_id = s.id
  from public.seasons s
 where h.season_id is null and trim(h.season_label) = trim(s.name);
