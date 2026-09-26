-- 147_competitions.sql
--
-- Champion periods become competitions you schedule, instead of an
-- endless 14-day cycle counted from one anchor date.
--
--   * Each competition has its own start, end and name: 1 day, 1 week,
--     2 weeks, a calendar month, or custom dates. One runs at a time.
--   * repeats: when it ends, the next one of the same length starts on
--     its own. Turning repeat off is how you pause -- after it ends,
--     nothing runs until you schedule something.
--   * Crowning and skipping are recorded on the competition itself, so
--     "waiting to be crowned" is a plain lookup rather than date math.
--   * Boundaries are midnight Eastern (the anchor math flipped at 8pm).
--
-- THIS MIGRATION CHANGES NOTHING VISIBLE. The app still runs on the
-- anchor until the screens are switched over. It seeds the current and
-- just-ended periods as competitions, and a trigger keeps them in sync
-- with the current Crown button, so both can run side by side.
--
-- Run BEFORE deploying the new daily-reminders function.

-- ── The table ─────────────────────────────────────────────────
create table if not exists public.competitions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  -- Drives the next repeat's length and which competitions a
  -- "most points in a period" record compares against.
  length_kind     text not null default 'two_weeks'
                  check (length_kind in ('day', 'week', 'two_weeks', 'month', 'custom')),
  repeats         boolean not null default false,
  crowned_at      timestamptz,
  skipped_at      timestamptz,
  -- Set when players get their "days left" push, so a re-run can't
  -- send it twice.
  ending_warned_at timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  -- One competition at a time.
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
);

create index if not exists competitions_ends_idx on public.competitions(ends_at);

alter table public.competitions enable row level security;

drop policy if exists "competitions_read" on public.competitions;
create policy "competitions_read" on public.competitions
  for select using (auth.uid() is not null);

drop policy if exists "competitions_staff_write" on public.competitions;
create policy "competitions_staff_write" on public.competitions
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- Past crownings and History snapshots point at their competition.
-- Older ones stay unlinked; they still show by date.
alter table public.biweekly_champions
  add column if not exists competition_id uuid references public.competitions(id) on delete set null;
alter table public.period_snapshots
  add column if not exists competition_id uuid references public.competitions(id) on delete set null;

-- ── Helpers ───────────────────────────────────────────────────
-- Midnight Eastern at the start of a calendar date, as a timestamp.
create or replace function public.competition_midnight(d date)
returns timestamptz
language sql immutable
as $$ select d::timestamp at time zone 'America/New_York' $$;

-- "Sep 19 – Oct 2" for a competition, using its last day, not the
-- midnight it ends on.
create or replace function public.competition_default_name(s timestamptz, e timestamptz)
returns text
language sql stable
as $$
  select case
    when (s at time zone 'America/New_York')::date = ((e at time zone 'America/New_York') - interval '1 second')::date
      then to_char(s at time zone 'America/New_York', 'Mon FMDD')
    else to_char(s at time zone 'America/New_York', 'Mon FMDD') || ' – ' ||
         to_char((e at time zone 'America/New_York') - interval '1 second', 'Mon FMDD')
  end
$$;

-- ── Repeats ───────────────────────────────────────────────────
-- If the latest competition repeats and has ended, start the next one
-- (and the next, if several were missed). Called by the daily job and on
-- app open, so a new competition never waits on either one alone.
-- Scheduling something yourself after a repeating one stops the chain:
-- only the LATEST competition's repeat flag counts.
create or replace function public.roll_competitions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  last   public.competitions%rowtype;
  s      timestamptz;
  e      timestamptz;
  made   int := 0;
begin
  loop
    select * into last from public.competitions order by ends_at desc limit 1;
    exit when not found or not last.repeats or last.ends_at > now() or made >= 100;

    s := last.ends_at;
    -- Lengths are added in Eastern local time, so a boundary stays at
    -- midnight across a daylight-saving change.
    e := case last.length_kind
      when 'day'       then ((s at time zone 'America/New_York') + interval '1 day')   at time zone 'America/New_York'
      when 'week'      then ((s at time zone 'America/New_York') + interval '7 days')  at time zone 'America/New_York'
      when 'two_weeks' then ((s at time zone 'America/New_York') + interval '14 days') at time zone 'America/New_York'
      when 'month'     then ((s at time zone 'America/New_York') + interval '1 month') at time zone 'America/New_York'
      else s + (last.ends_at - last.starts_at)
    end;

    insert into public.competitions (name, starts_at, ends_at, length_kind, repeats, created_by)
    values (public.competition_default_name(s, e), s, e, last.length_kind, true, last.created_by);
    made := made + 1;
  end loop;
  return made;
end;
$$;

grant execute on function public.roll_competitions() to authenticated;

-- The competition running right now, if any. Rolls first.
create or replace function public.current_competition()
returns setof public.competitions
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.roll_competitions();
  return query
    select * from public.competitions
     where starts_at <= now() and ends_at > now()
     limit 1;
end;
$$;

grant execute on function public.current_competition() to authenticated;

-- ── Keep crowning in sync ─────────────────────────────────────
-- Until the new screens ship, the old Crown button writes champion rows
-- by date with no competition attached. This links each row to the
-- competition that ended within a day of its period_end, and marks that
-- competition crowned. Undo (which deletes the rows) clears it again.
-- The new screens will set competition_id and crowned_at directly; the
-- trigger then just confirms what's already there.
create or replace function public.link_champion_to_competition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if tg_op = 'INSERT' then
    cid := new.competition_id;
    if cid is null then
      select id into cid from public.competitions
       where abs(extract(epoch from ends_at - new.period_end)) < 86400
       order by abs(extract(epoch from ends_at - new.period_end))
       limit 1;
      new.competition_id := cid;
    end if;
    if cid is not null then
      update public.competitions
         set crowned_at = coalesce(crowned_at, new.crowned_at, now()), skipped_at = null
       where id = cid;
    end if;
    return new;
  else
    if old.competition_id is not null
       and not exists (select 1 from public.biweekly_champions
                        where competition_id = old.competition_id and id <> old.id) then
      update public.competitions set crowned_at = null where id = old.competition_id;
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists champions_link_competition on public.biweekly_champions;
create trigger champions_link_competition
  before insert on public.biweekly_champions
  for each row execute function public.link_champion_to_competition();

drop trigger if exists champions_unlink_competition on public.biweekly_champions;
create trigger champions_unlink_competition
  after delete on public.biweekly_champions
  for each row execute function public.link_champion_to_competition();

-- ── Seed from the anchor ──────────────────────────────────────
-- Recreates the anchor math exactly (periods counted in whole 14-day
-- steps from UTC midnight on the anchor date).
--
--   just-ended: [start - 14 days, start)       unchanged, for the crown queue
--   current:    [start, midnight ET on its end date)
--
-- The current one keeps its exact start, so today's standings don't
-- move. Only its END shifts, 4-5 hours later, to midnight Eastern. Every
-- competition after it is midnight to midnight Eastern.
do $$
declare
  anchor  timestamptz;
  n       bigint;
  cur_s   timestamptz;
  cur_e   timestamptz;
  prev_s  timestamptz;
  prev_crowned timestamptz;
begin
  if exists (select 1 from public.competitions) then
    raise notice 'competitions already has rows -- seed skipped';
    return;
  end if;

  select coalesce(
           (select (value::date)::timestamp at time zone 'UTC' from public.app_settings where key = 'period_anchor'),
           '2025-05-03'::timestamp at time zone 'UTC')
    into anchor;

  n      := greatest(0, floor(extract(epoch from now() - anchor) / (14 * 86400))::bigint);
  cur_s  := anchor + make_interval(days => (n * 14)::int);
  cur_e  := public.competition_midnight(((cur_s + interval '14 days') at time zone 'UTC')::date);
  prev_s := cur_s - interval '14 days';

  -- Was the just-ended period crowned? Same check the reminder used.
  select max(crowned_at) into prev_crowned
    from public.biweekly_champions
   where abs(extract(epoch from period_end - cur_s)) < 86400;

  if n > 0 then
    insert into public.competitions (name, starts_at, ends_at, length_kind, repeats, crowned_at)
    values (public.competition_default_name(prev_s, cur_s), prev_s, cur_s, 'two_weeks', false, prev_crowned);
  end if;

  insert into public.competitions (name, starts_at, ends_at, length_kind, repeats)
  values (public.competition_default_name(cur_s, cur_e), cur_s, cur_e, 'two_weeks', true);

  -- Link that period's existing champion rows.
  update public.biweekly_champions b
     set competition_id = c.id
    from public.competitions c
   where b.competition_id is null
     and abs(extract(epoch from c.ends_at - b.period_end)) < 86400;
end $$;

-- ── Check it ──────────────────────────────────────────────────
-- Run after the migration. The "running" row should start on the same
-- date the Admin → Biweekly Period Settings card shows today, and end a
-- few hours after midnight UTC on its end date (midnight Eastern).
--
--   select name, starts_at, ends_at, repeats, crowned_at,
--          case when now() >= starts_at and now() < ends_at then 'running'
--               when ends_at <= now() and crowned_at is null and skipped_at is null then 'waiting to crown'
--               else '' end as status
--     from public.competitions order by starts_at;
