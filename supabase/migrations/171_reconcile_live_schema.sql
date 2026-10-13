-- ============================================================
-- 171_reconcile_live_schema.sql
--
-- Brings the migration history in line with the LIVE database.
-- Everything below already exists in Supabase — it was created in
-- the dashboard (table editor / policy UI) and never written to a
-- migration file. Found by comparing the 2026-10-13 schema snapshot
-- against migrations 001–170.
--
-- Running this on the live database changes NOTHING: every statement
-- is "if not exists". Its job is to make a fresh database built from
-- these files match production, and to be the baseline the
-- multi-tenancy pass is written against.
--
-- Not included on purpose:
--   * Policies dropped by the loops in 156/157/158 — those drops are
--     already in the history, so nothing to reconcile.
--   * The *_unguarded functions — 150's rename loop creates them.
-- ============================================================


-- ── 1. Columns added in the table editor ──────────────────────

alter table public.profiles
  add column if not exists grade_category       text,
  add column if not exists is_period_champion   boolean default false,
  add column if not exists champion_since       timestamptz,
  add column if not exists must_change_password boolean default true;

alter table public.scores
  add column if not exists self_points integer default 0;

alter table public.workouts
  add column if not exists scoring_type     text not null default 'competitive',
  add column if not exists scoring_metric   text,
  add column if not exists flat_points      integer,
  add column if not exists group_name       text,
  add column if not exists is_active        boolean default true,
  add column if not exists first_place_pts  integer default 5,
  add column if not exists second_place_pts integer default 3,
  add column if not exists third_place_pts  integer default 1;


-- ── 2. Signup trigger (made in the dashboard) ─────────────────
-- handle_new_user() itself is defined in 150_security_lockdown.sql;
-- only the trigger that calls it was missing from the files.

do $$
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
      and t.tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;


-- ── 3. Policies made in the policy UI ─────────────────────────
-- Recorded exactly as they are live. All three are rewritten in the
-- multi-tenancy pass (they read "using (true)", i.e. everyone).

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'biweekly_champions'
                   and policyname = 'champions_read_all') then
    create policy "champions_read_all" on public.biweekly_champions
      for select using (true);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'biweekly_champions'
                   and policyname = 'hof_admin_delete') then
    create policy "hof_admin_delete" on public.biweekly_champions
      for delete using (exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.role in ('coach', 'admin')));
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'challenges'
                   and policyname = 'challenges_read_all') then
    create policy "challenges_read_all" on public.challenges
      for select using (true);
  end if;
end $$;


-- ── 4. Indexes made in the dashboard ──────────────────────────

create index if not exists competitions_tstzrange_excl
  on public.competitions using gist (tstzrange(starts_at, ends_at));
create unique index if not exists possessions_game_seq_unique
  on public.possessions (game_id, sequence);
create unique index if not exists records_type_workout_uniq
  on public.records (record_type, workout_id);
create unique index if not exists records_type_workout_unique
  on public.records (record_type, workout_id);
create unique index if not exists rotation_plans_game_unique
  on public.rotation_plans (game_id);
create index if not exists score_attempts_date_idx
  on public.score_attempts (attempted_at);
create index if not exists scores_logged_at_idx
  on public.scores (logged_at desc);
create index if not exists scores_player_id_idx
  on public.scores (player_id);
create index if not exists scores_workout_id_idx
  on public.scores (workout_id);
create unique index if not exists shifts_game_seq_side_unique
  on public.shifts (game_id, start_sequence, side);

-- NOTE: records_type_workout_uniq and records_type_workout_unique are
-- the same index twice (one is redundant). Left alone here so this file
-- stays a no-op; drop one in the multi-tenancy pass when records gets
-- program_id and its unique key changes anyway.


-- ── 5. Function made in the dashboard ─────────────────────────
-- send_welcome_email exists live, is never called by the app, and 150
-- already revoked everyone's access to it. Not recreated here; it will
-- be dropped in the multi-tenancy pass.
--
-- The reverse case: close_team_competition IS in 029 but does NOT
-- exist live, and src/lib/teams.ts still calls it when a team
-- competition ends with no teams. That call fails silently today.
-- Fixed in the multi-tenancy pass, where team competitions get
-- rewritten for program scope.
