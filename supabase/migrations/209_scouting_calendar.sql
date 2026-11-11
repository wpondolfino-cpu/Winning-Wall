-- ============================================================
-- 209_scouting_calendar.sql
--
-- SCOUTING CALENDAR: the Scouting page's Calendar tab.
--
--   scouting_games        other teams' games worth watching (pasted in
--                         from a schedule, or added one at a time)
--   scouting_assignments  which coaches are scouting a game, each one
--                         'live' (in the gym) or 'film'
--   scouting_videos       links on a game (YouTube, Google Drive, Hudl,
--                         NFHS, anything) so any coach can watch it later
--   scouting_rankings     each team's MIAA division and power ranking,
--                         pasted in from the rankings, per division
--
-- Coaches only: head coaches and assistants in the program can read and
-- change all of it. Players never see it, and nor does another program.
--
-- New tables only; nothing existing changes. One transaction.
-- Safe to run more than once.
-- ============================================================

begin;
set local client_min_messages = warning;

-- ── 1. Tables ────────────────────────────────────────────────
create table if not exists public.scouting_games (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  game_date   date not null,
  tip_time    time,
  away_team   text not null check (length(trim(away_team)) > 0 and length(away_team) <= 80),
  home_team   text not null check (length(trim(home_team)) > 0 and length(home_team) <= 80),
  -- Names squashed to letters and digits, so "North Andover" and
  -- "north-andover" count as the same team when matching and de-duping.
  away_key    text generated always as (regexp_replace(lower(away_team), '[^a-z0-9]', '', 'g')) stored,
  home_key    text generated always as (regexp_replace(lower(home_team), '[^a-z0-9]', '', 'g')) stored,
  -- Only when it isn't the home team's gym (a neutral site, a tournament).
  location    text check (location is null or length(location) <= 80),
  note        text check (note is null or length(note) <= 200),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- (For anyone who ran the first version of this file: safe to run again.)
alter table public.scouting_games add column if not exists location text
  check (location is null or length(location) <= 80);
-- Pasting the same schedule twice doesn't make a second copy of a game.
create unique index if not exists scouting_games_unique_idx
  on public.scouting_games (program_id, game_date, away_key, home_key);
create index if not exists scouting_games_date_idx on public.scouting_games (program_id, game_date);

create table if not exists public.scouting_assignments (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.programs(id) on delete cascade,
  scouting_game_id uuid not null references public.scouting_games(id) on delete cascade,
  coach_id         uuid not null references public.profiles(id) on delete cascade,
  mode             text not null default 'live' check (mode in ('live', 'film')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (scouting_game_id, coach_id)
);
create index if not exists scouting_assignments_coach_idx on public.scouting_assignments (coach_id);

create table if not exists public.scouting_videos (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.programs(id) on delete cascade,
  scouting_game_id uuid not null references public.scouting_games(id) on delete cascade,
  url              text not null check (url ~* '^https?://' and length(url) <= 1000),
  note             text check (note is null or length(note) <= 120),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists scouting_videos_game_idx on public.scouting_videos (scouting_game_id);

create table if not exists public.scouting_rankings (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  team        text not null check (length(trim(team)) > 0 and length(team) <= 80),
  team_key    text generated always as (regexp_replace(lower(team), '[^a-z0-9]', '', 'g')) stored,
  division    smallint not null check (division between 1 and 8),
  rank        smallint check (rank is null or rank > 0),
  record      text check (record is null or length(record) <= 20),
  updated_at  timestamptz not null default now()
);
create unique index if not exists scouting_rankings_team_idx on public.scouting_rankings (program_id, team_key);


-- ── 2. Program filled in automatically (as on every other table) ──
do $$
declare t text;
begin
  foreach t in array array['scouting_games', 'scouting_assignments', 'scouting_videos', 'scouting_rankings'] loop
    execute format('drop trigger if exists set_program_id on public.%I', t);
    execute format('create trigger set_program_id before insert on public.%I for each row execute function public.set_program_id()', t);
  end loop;
end $$;


-- ── 3. Who can see and change it: this program's coaches ──────
do $$
declare t text;
begin
  foreach t in array array['scouting_games', 'scouting_assignments', 'scouting_videos', 'scouting_rankings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "staff_all" on public.%I', t);
    execute format($p$
      create policy "staff_all" on public.%I
        for all to authenticated
        using (public.is_program_staff(program_id, auth.uid()))
        with check (public.is_program_staff(program_id, auth.uid()))
    $p$, t);
    perform public.add_program_scope(t);
  end loop;
end $$;

-- A scout has to be a coach in the program. (Named zz_ so it runs after
-- set_program_id: triggers on the same event fire in name order.)
create or replace function public.scouting_assignment_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.program_role(new.program_id, new.coach_id) in ('head_coach', 'coach'), false) then
    raise exception 'Scouts have to be coaches in this program.';
  end if;
  if not exists (select 1 from public.scouting_games g where g.id = new.scouting_game_id and g.program_id = new.program_id) then
    raise exception 'That game is not in this program.';
  end if;
  return new;
end $$;
drop trigger if exists zz_scouting_assignment_check on public.scouting_assignments;
create trigger zz_scouting_assignment_check before insert or update on public.scouting_assignments
  for each row execute function public.scouting_assignment_check();

-- A video belongs to a game in the same program.
create or replace function public.scouting_video_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.scouting_games g where g.id = new.scouting_game_id and g.program_id = new.program_id) then
    raise exception 'That game is not in this program.';
  end if;
  return new;
end $$;
drop trigger if exists zz_scouting_video_check on public.scouting_videos;
create trigger zz_scouting_video_check before insert or update on public.scouting_videos
  for each row execute function public.scouting_video_check();

commit;

-- Check: should list 4 tables, each with rls on and 2 policies.
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('scouting_games', 'scouting_assignments', 'scouting_videos', 'scouting_rankings')
 order by 1;
