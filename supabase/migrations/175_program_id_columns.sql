-- ============================================================
-- 175_program_id_columns.sql
--
-- MULTI-TENANCY STEP 2 — label every row with its program.
--
-- 1. Renames the three Lifting columns called program_id (they mean
--    "which LIFTING program") to lifting_program_id, so program_id can
--    mean "which team program" everywhere. Ships with 4 updated Lifting
--    files — push those right after running this.
-- 2. Adds program_id to 106 tables. Every existing row is labelled
--    Boys Basketball.
-- 3. New rows get labelled automatically with the creator's active
--    program. Rows written by the server with nobody logged in (the
--    daily-reminders job, server functions) fall back to Boys for now;
--    that fallback is removed when those are converted.
--
-- What this does NOT do: change who can see what. Security rules are
-- untouched — the app behaves exactly as before.
--
-- Not labelled, on purpose (they belong to a person or the whole app,
-- not a program): profiles, profile_emails, tutorials_seen,
-- password_reset_requests, help_pages, heartbeat.
--
-- How existing rows get labelled: "add column ... default <Boys>" fills
-- them instantly WITHOUT firing any update triggers — important,
-- because the published-quiz guards would reject a row update, and
-- plays would get their "last edited" time bumped.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;

-- ── 1. Lifting rename ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['lifting_days', 'lifting_exercises', 'lifting_program_assignments'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t and column_name = 'program_id')
       and not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t and column_name = 'lifting_program_id') then
      execute format('alter table public.%I rename column program_id to lifting_program_id', t);
    end if;
  end loop;
end $$;


-- ── 2. Fallback program for rows written with nobody logged in ──
-- Temporary. Dropped once server jobs set the program themselves.
do $$
declare boys uuid;
begin
  select pr.id into boys
  from public.programs pr join public.organizations o on o.id = pr.organization_id
  where o.name = 'Attleboro High School' and pr.name = 'Boys Basketball';
  if boys is null then raise exception 'Stopped: Boys Basketball program not found (run 174 first)'; end if;

  execute format($f$
    create or replace function public.legacy_default_program_id()
    returns uuid language sql immutable as $b$ select %L::uuid $b$
  $f$, boys);
end $$;
revoke all on function public.legacy_default_program_id() from public, anon, authenticated;


-- ── 3. The labelling trigger ──────────────────────────────────
create or replace function public.set_program_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.program_id is null then
    new.program_id := coalesce(public.current_program_id(), public.legacy_default_program_id());
  end if;
  return new;
end $$;
revoke all on function public.set_program_id() from public, anon, authenticated;


-- ── 4. Add program_id to every program-owned table ────────────
do $$
declare
  boys uuid := public.legacy_default_program_id();
  t text;
  n int := 0;
begin
  foreach t in array array[
    'announcement_hides', 'announcements', 'app_settings', 'badges',
    'biweekly_champions', 'block_rotation_groups', 'block_segments',
    'challenge_pending_scores', 'challenges', 'class_clash_competitions',
    'competitions', 'drill_categories', 'formations', 'game_call_ups',
    'gameday_calls', 'gameday_sections', 'gameday_sheets', 'games',
    'inactivity_nudges', 'inseason_history', 'library_practice_log',
    'lifting_day_exercises', 'lifting_days', 'lifting_exercise_bank',
    'lifting_exercises', 'lifting_logs', 'lifting_program_assignments',
    'lifting_programs', 'lifting_records', 'lineup_events', 'live_answers',
    'live_participants', 'live_sessions', 'notifications', 'opponents',
    'period_snapshots', 'perk_boosts', 'perk_usage', 'personal_bests',
    'play_calls', 'play_shares', 'playbook_plays', 'playbook_shares',
    'playbooks', 'plays', 'plays_categories', 'points_ledger', 'possessions',
    'practice_attendance_overrides', 'practice_blocks',
    'practice_cover_items', 'practice_drill_categories',
    'practice_drill_tag_links', 'practice_drill_tags',
    'practice_drills_library', 'practice_weeks', 'practice_wins',
    'practices', 'quiz_answer_keys', 'quiz_answers', 'quiz_attempts',
    'quiz_question_assignees', 'quiz_question_options', 'quiz_questions',
    'quiz_review_items', 'quizzes', 'records', 'report_layout', 'rosters',
    'rotation_plans', 'saved_actions', 'saved_grouping_members',
    'saved_groupings', 'saved_reports', 'schedule_events', 'score_attempts',
    'scores', 'scoring_windows', 'scout_defense', 'scout_offense_sets',
    'scout_players', 'scout_sheets', 'scout_specials', 'season_history',
    'seasons', 'segment_drill_group_members', 'segment_drill_groups',
    'segment_drills', 'shifts', 'spot_personal_bests', 'stat_flag_streaks',
    'stat_goals', 'streak_bonuses', 'streaks', 'team_competitions',
    'team_plan_lanes', 'team_plan_slots', 'team_plans', 'team_positions',
    'teams', 'tryout_attendance', 'tryout_players', 'workout_groups',
    'workouts', 'xp_log', 'xp_settings'
  ] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'program_id') then
      -- Fills existing rows instantly, no triggers fired.
      execute format('alter table public.%I add column program_id uuid not null default %L references public.programs(id)', t, boys);
      execute format('alter table public.%I alter column program_id drop default', t);
      n := n + 1;
    end if;
    execute format('create index if not exists %I on public.%I (program_id)', t || '_program_idx', t);
    execute format('drop trigger if exists set_program_id on public.%I', t);
    execute format('create trigger set_program_id before insert on public.%I for each row execute function public.set_program_id()', t);
  end loop;
  raise notice 'program_id added to % tables', n;
end $$;

commit;


-- ── 5. Summary ────────────────────────────────────────────────
-- "tables missing program_id" should list only the six on purpose
-- (plus the five program tables from 174, which are the programs
-- themselves). Run this same query after any future migration that
-- adds a table.
select 'tables with program_id' as item,
       count(*)::text as value
from information_schema.columns
where table_schema = 'public' and column_name = 'program_id'
  and table_name not in ('program_members', 'program_features')
union all
select 'tables missing program_id',
       string_agg(c.relname, ', ' order by c.relname)
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and not exists (select 1 from information_schema.columns col
                  where col.table_schema = 'public' and col.table_name = c.relname
                    and col.column_name = 'program_id')
union all
select 'lifting columns renamed',
       (select count(*)::text from information_schema.columns
        where table_schema = 'public' and column_name = 'lifting_program_id')
union all
select 'labelling triggers',
       (select count(*)::text from pg_trigger where tgname = 'set_program_id');
