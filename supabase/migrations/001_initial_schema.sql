-- ============================================================
--  AHS Winning Wall — Supabase Schema (original, from GitHub)
--  This is the true foundation every later migration builds on.
--  Some pieces here (role check, generated points column) were
--  later superseded — e.g. role gains 'admin' in later migrations,
--  and the generated `points` column is superseded once
--  self-reported/multi-spot scoring is added (see scoring_cleanup).
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Profiles (extends auth.users) ───────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  role        text not null check (role in ('player', 'coach')),
  position    text,                        -- PG, SG, SF, PF, C
  jersey      integer,
  avatar_url  text,
  created_at  timestamptz default now()
);

-- ── Workouts ─────────────────────────────────────────────────
create table public.workouts (
  id          uuid primary key default uuid_generate_v4(),
  coach_id    uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  description text,
  category    text not null check (category in ('Shooting','Conditioning','Strength','Skills')),
  video_url   text,
  emoji       text default '🏀',
  created_at  timestamptz default now()
);

-- ── Scores ───────────────────────────────────────────────────
create table public.scores (
  id          uuid primary key default uuid_generate_v4(),
  player_id   uuid not null references public.profiles(id) on delete cascade,
  workout_id  uuid not null references public.workouts(id) on delete cascade,
  made        integer default 0,
  attempts    integer default 0,
  sprint_secs numeric(5,2) default 0,
  reps        integer default 0,
  points      integer generated always as (
                made + reps + greatest(0, round((10 - sprint_secs) * 10)::integer)
              ) stored,
  logged_at   timestamptz default now(),
  unique(player_id, workout_id)             -- one entry per player per workout
);

-- ── Notification log (tracks who was nudged) ─────────────────
create table public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  player_id   uuid not null references public.profiles(id) on delete cascade,
  sent_at     timestamptz default now(),
  channel     text check (channel in ('email','push')),
  message     text
);

-- ── Indexes ──────────────────────────────────────────────────
create index on public.scores(workout_id);
create index on public.scores(player_id);
create index on public.scores(logged_at desc);

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles    enable row level security;
alter table public.workouts    enable row level security;
alter table public.scores      enable row level security;
alter table public.notifications enable row level security;

create policy "profiles_read_all"   on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

create policy "workouts_read_all"    on public.workouts for select using (true);
create policy "workouts_coach_write" on public.workouts for insert
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'coach'));
create policy "workouts_coach_update" on public.workouts for update
  using (coach_id = auth.uid());
create policy "workouts_coach_delete" on public.workouts for delete
  using (coach_id = auth.uid());

create policy "scores_read_all"      on public.scores for select using (true);
create policy "scores_player_insert" on public.scores for insert
  with check (player_id = auth.uid());
create policy "scores_player_update" on public.scores for update
  using (player_id = auth.uid());

create policy "notif_read_own" on public.notifications for select
  using (player_id = auth.uid());

-- ============================================================
--  REALTIME
-- ============================================================
alter publication supabase_realtime add table public.scores;
alter publication supabase_realtime add table public.workouts;

-- ============================================================
--  HELPER VIEW — leaderboard (superseded by later migrations —
--  see 011_leaderboard_active.sql, 024_fix_leaderboard_view.sql,
--  and 035_leaderboard_view_bonus_fix_v2.sql for the current version)
-- ============================================================
create or replace view public.leaderboard as
  select
    p.id,
    p.name,
    p.position,
    p.jersey,
    p.avatar_url,
    coalesce(sum(s.points), 0)          as total_points,
    coalesce(sum(s.made), 0)            as total_made,
    coalesce(sum(s.attempts), 0)        as total_attempts,
    coalesce(min(s.sprint_secs) filter (where s.sprint_secs > 0), 0) as best_sprint,
    count(distinct s.workout_id)        as workouts_completed,
    max(s.logged_at)                    as last_logged_at,
    rank() over (order by coalesce(sum(s.points), 0) desc) as rank
  from public.profiles p
  left join public.scores s on s.player_id = p.id
  where p.role = 'player'
  group by p.id, p.name, p.position, p.jersey, p.avatar_url;

-- ============================================================
--  inactive_players — surfaces who needs a nudge
-- ============================================================
create or replace view public.inactive_players as
  select
    p.id,
    p.name,
    p.created_at,
    max(s.logged_at) as last_activity,
    extract(day from now() - max(s.logged_at)) as days_inactive
  from public.profiles p
  left join public.scores s on s.player_id = p.id
  where p.role = 'player'
  group by p.id, p.name, p.created_at
  having max(s.logged_at) is null
      or extract(day from now() - max(s.logged_at)) >= 14;
