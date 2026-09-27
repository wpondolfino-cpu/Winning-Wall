-- 149_record_dashboard_tables.sql
--
-- RECORD ONLY. Running this on the live database changes nothing.
--
-- Five tables were created in the Supabase dashboard and exist in no
-- migration: score_attempts, streaks, streak_bonuses, badges, heartbeat.
-- This writes down what they look like today (captured Sep 2026) so the
-- repo describes the whole database -- which the multi-tenancy pass needs,
-- since four of them get a program_id.
--
-- Every statement is "if not exists", so on the live database each one
-- is skipped. On a fresh database this file would have to run early
-- (after profiles and workouts exist, before migration 005 touches
-- badges); it's numbered here because that's when it was written.
--
-- Columns added later by migrations (018, 030, 055, 057, 088, 110, 118)
-- are included, so this is the full current shape.

-- ── score_attempts: every logged entry (History, Chart) ───────
create table if not exists public.score_attempts (
  id              uuid primary key default uuid_generate_v4(),
  player_id       uuid not null references public.profiles(id) on delete cascade,
  workout_id      uuid not null references public.workouts(id) on delete cascade,
  made            integer default 0,
  reps            integer default 0,
  self_points     integer default 0,
  sprint_secs     numeric default 0,
  raw_score       numeric default 0,
  is_personal_best boolean default false,
  tiebreak_value  numeric,
  spot_scores     numeric[],
  run             integer,
  attempted_at    timestamptz default now()
);

-- ── streaks: one row per player ───────────────────────────────
create table if not exists public.streaks (
  id               uuid primary key default uuid_generate_v4(),
  player_id        uuid not null unique references public.profiles(id) on delete cascade,
  current_streak   integer default 1,
  longest_streak   integer default 1,
  last_logged_date date not null,
  bonus_awarded_at date
);

-- ── streak_bonuses: bonus points that count on the leaderboard ─
create table if not exists public.streak_bonuses (
  id            uuid primary key default uuid_generate_v4(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  points        integer not null,
  streak_length integer not null,
  reason        text default 'streak',
  workout_id    uuid references public.workouts(id),
  challenge_id  uuid,
  awarded_at    timestamptz default now()
);

-- ── badges: badge definitions ─────────────────────────────────
create table if not exists public.badges (
  id            uuid primary key default uuid_generate_v4(),
  icon          text not null default '🏅',
  name          text not null,
  description   text,
  trigger_type  text not null,
  trigger_value integer not null default 1,
  is_active     boolean default true,
  created_at    timestamptz default now()
);
-- trigger_type's allowed values live in migration 005's check constraint.

-- ── heartbeat: pinged every 3 days by cron job keepalive-heartbeat ─
create table if not exists public.heartbeat (
  id        integer primary key default 1 constraint heartbeat_singleton check (id = 1),
  pinged_at timestamptz not null default now()
);

-- ── Row-level security and policies as they stand ─────────────
-- badges' write policy is NOT recorded here: it's replaced in 150.
alter table public.score_attempts enable row level security;
alter table public.streaks        enable row level security;
alter table public.streak_bonuses enable row level security;
alter table public.badges         enable row level security;
alter table public.heartbeat      enable row level security;

do $$
begin
  -- score_attempts
  if not exists (select 1 from pg_policies where tablename = 'score_attempts' and policyname = 'attempts_read_all') then
    create policy attempts_read_all on public.score_attempts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'score_attempts' and policyname = 'attempts_insert_own') then
    create policy attempts_insert_own on public.score_attempts for insert with check (player_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'score_attempts' and policyname = 'attempts_admin_all') then
    create policy attempts_admin_all on public.score_attempts for all
      using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
  end if;
  -- (attempts_staff_delete is in migration 146)

  -- streaks
  if not exists (select 1 from pg_policies where tablename = 'streaks' and policyname = 'streaks_read_all') then
    create policy streaks_read_all on public.streaks for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'streaks' and policyname = 'streaks_write_own') then
    create policy streaks_write_own on public.streaks for all using (player_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'streaks' and policyname = 'streaks_admin_update') then
    create policy streaks_admin_update on public.streaks for all
      using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
  end if;

  -- streak_bonuses
  if not exists (select 1 from pg_policies where tablename = 'streak_bonuses' and policyname = 'bonuses_read_all') then
    create policy bonuses_read_all on public.streak_bonuses for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'streak_bonuses' and policyname = 'bonuses_write_own') then
    create policy bonuses_write_own on public.streak_bonuses for insert with check (player_id = auth.uid());
  end if;
  -- (bonuses_admin_all is in 033; staff_read_all_streak_bonuses in 059)

  -- badges (read only; write is in 150)
  if not exists (select 1 from pg_policies where tablename = 'badges' and policyname = 'badges_read_all') then
    create policy badges_read_all on public.badges for select using (true);
  end if;
end $$;

-- Note: streaks_write_own and bonuses_write_own let players write their
-- own streaks and bonus points, because the app calculates those in the
-- browser. Closing them means moving that calculation to the server
-- (option B in the September 2026 audit) -- not done here.
