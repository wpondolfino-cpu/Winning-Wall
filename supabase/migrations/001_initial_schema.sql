-- ============================================================
--  AHS Winning Wall — Supabase Schema
--  Run this in your Supabase SQL Editor or via CLI:
--    supabase db push
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

-- profiles: everyone can read, users can update their own row
create policy "profiles_read_all"   on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- workouts: everyone can read; only coaches can insert/update/delete
create policy "workouts_read_all"    on public.workouts for select using (true);
create policy "workouts_coach_write" on public.workouts for insert
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'coach'));
create policy "workouts_coach_update" on public.workouts for update
  using (coach_id = auth.uid());
create policy "workouts_coach_delete" on public.workouts for delete
  using (coach_id = auth.uid());

-- scores: everyone can read; players can only write/update their own row
create policy "scores_read_all"      on public.scores for select using (true);
create policy "scores_player_insert" on public.scores for insert
  with check (player_id = auth.uid());
create policy "scores_player_update" on public.scores for update
  using (player_id = auth.uid());

-- notifications: only service role (edge functions) can insert; users see own
create policy "notif_read_own" on public.notifications for select
  using (player_id = auth.uid());

-- ============================================================
--  REALTIME — enable broadcast on scores & workouts
-- ============================================================
alter publication supabase_realtime add table public.scores;
alter publication supabase_realtime add table public.workouts;

-- ============================================================
--  HELPER VIEW — leaderboard (pre-aggregated per player)
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
--  EDGE FUNCTION TRIGGER — auto-notify inactive players
--  (wire this to a pg_cron job or Supabase Edge Function cron)
-- ============================================================
-- The Edge Function at /supabase/functions/notify-inactive/index.ts
-- handles the actual sending. This view surfaces who needs a nudge.
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
