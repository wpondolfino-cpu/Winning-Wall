-- 115_schedule.sql
--
-- The Schedule page: one agenda over practices, games and events, grouped
-- by week.
--
-- THE KEY CHANGE IS DATES ON WEEKS.
--
-- practice_weeks has only a name and a created_at, so assigning anything
-- to a week has always been manual. That was tolerable when weeks only
-- held practices you made one at a time. It breaks the moment a schedule
-- import arrives: twenty games at once, spanning fifteen weeks, most of
-- which don't exist yet.
--
-- Giving weeks a date range makes everything file itself. It also
-- properly fixes the orphaned-practice bug that was patched by defaulting
-- to "the most recent week" -- a reasonable guess that is sometimes
-- wrong. With ranges it stops being a guess.
--
-- The table keeps its name. It is now the program's week structure rather
-- than a practices-only one.

-- ── weeks get a range ─────────────────────────────────────────
alter table public.practice_weeks
  add column if not exists start_date date;

alter table public.practice_weeks
  add column if not exists end_date date;

-- Backfill from the practices already inside each week: earliest and
-- latest practice_date, widened to Monday-Sunday so a week with a single
-- Tuesday practice still covers the Friday game that belongs with it.
update public.practice_weeks w
set start_date = coalesce(w.start_date, r.first_day - ((extract(isodow from r.first_day)::int - 1)) ),
    end_date   = coalesce(w.end_date,   r.last_day  + (7 - extract(isodow from r.last_day)::int) )
from (
  select week_id, min(practice_date) as first_day, max(practice_date) as last_day
  from public.practices
  where week_id is not null
  group by week_id
) r
where r.week_id = w.id
  and (w.start_date is null or w.end_date is null);

create index if not exists practice_weeks_range_idx on public.practice_weeks(start_date, end_date);

-- Finds (or creates) the week containing a date. Import uses this so a
-- season's worth of games files itself, creating any missing weeks.
create or replace function public.week_for_date(p_date date, p_season_id uuid default null)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_start date;
  v_end date;
begin
  select id into v_id from public.practice_weeks
   where start_date is not null and end_date is not null
     and p_date between start_date and end_date
   order by start_date desc limit 1;
  if v_id is not null then return v_id; end if;

  -- ISO weeks, Monday-Sunday, so a week never splits a Friday game away
  -- from the practices that led up to it.
  v_start := p_date - (extract(isodow from p_date)::int - 1);
  v_end   := v_start + 6;

  insert into public.practice_weeks (name, season_id, start_date, end_date)
  values (to_char(v_start, 'Mon DD') || ' - ' || to_char(v_end, 'Mon DD'), p_season_id, v_start, v_end)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.week_for_date(date, uuid) to authenticated;

-- ── games become schedulable ──────────────────────────────────
-- "Dec 12 vs Taunton" isn't a schedule entry. "Dec 12, 6:30, Taunton HS"
-- is. Both nullable: a tournament date is often known before its tip time.
alter table public.games
  add column if not exists tip_time time;

alter table public.games
  add column if not exists location text;

alter table public.games
  add column if not exists week_id uuid references public.practice_weeks(id) on delete set null;

create index if not exists games_week_idx on public.games(week_id);

-- Lets a re-import recognise a game it already created and update it
-- rather than adding a duplicate. Nullable, since a hand-made game has no
-- external source.
alter table public.games
  add column if not exists external_uid text;

create unique index if not exists games_external_uid_idx
  on public.games(external_uid) where external_uid is not null;

-- ── events ────────────────────────────────────────────────────
-- Film sessions, lifting, team dinners, bus times. Kept deliberately thin:
-- without it, coaches fake these as practices with no blocks, which
-- pollutes practice reporting and attendance. Five fields and no editor
-- behind it -- the moment an event gets its own screen it starts growing
-- into a general calendar.
create table if not exists public.schedule_events (
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid references public.practice_weeks(id) on delete set null,
  season_id   uuid references public.seasons(id) on delete cascade,
  event_date  date not null,
  start_time  time,
  title       text not null,
  location    text,
  roster_ids  uuid[] not null default '{}',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists schedule_events_date_idx on public.schedule_events(event_date);
create index if not exists schedule_events_week_idx on public.schedule_events(week_id);

alter table public.schedule_events enable row level security;

drop policy if exists "everyone reads events" on public.schedule_events;
create policy "everyone reads events" on public.schedule_events
  for select using (auth.uid() is not null);

drop policy if exists "coaches manage events" on public.schedule_events;
create policy "coaches manage events" on public.schedule_events
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

-- ── film link on the scout sheet ──────────────────────────────
-- Named for what it is rather than for a vendor: per-item video_url
-- already exists on scout_offense_sets and scout_specials, but there was
-- nowhere to put "here's the full playlist for this opponent". Hudl today,
-- something else in two years.
alter table public.scout_sheets
  add column if not exists film_url text;
