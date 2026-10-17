-- ============================================================
-- 184_scope_drills_lifting.sql
--
-- MULTI-TENANCY STEP 8b — drills and lifting.
--
-- Fenced to their program (restrictive "program_scope", as before):
--   workouts (the drill library and assigned drills), workout groups,
--   drill categories, library practice log, and all 8 lifting tables
--   (programs, days, day exercises, exercises, exercise bank, logs,
--   assignments, lifting records).
--   Until now any signed-in user could read every program's lifting.
--
-- Also:
--   * Drill category names and lifting exercise-bank names are unique
--     per program, so Girls can have its own "Shooting" or "Back squat".
--     (Ships with 1 app file that saves exercise-bank entries:
--     lifting.ts.)
--   * Every other program (Girls) gets its own copy of:
--       - Boys' drill categories
--       - Boys' library drills (not archived ones). Copies start
--         HIDDEN and not in any group, so Girls players see nothing new
--         in their Workouts tab until the coach groups/shows them. They
--         are owned by that program's head coach so she can edit them.
--         No scores, runs, groups or deadlines are copied.
--       - Boys' lifting exercise bank (the exercise names/videos only,
--         not Boys' lifting programs, logs or records).
--   * Boys' rows are not changed -- this step only adds copies.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Names that must be unique per program ──────────────────
-- Drills link to their category (renaming a category renames it on
-- every drill; a category in use can't be deleted). That link becomes
-- per program too: it's dropped here and re-added below, after the
-- copies, as (program, category) -> (program, name).
alter table public.workouts drop constraint if exists workouts_category_fkey;
alter table public.drill_categories drop constraint if exists drill_categories_pkey;
alter table public.drill_categories add constraint drill_categories_pkey primary key (program_id, name);

alter table public.lifting_exercise_bank drop constraint if exists lifting_exercise_bank_name_key;
drop index if exists public.lifting_exercise_bank_name_key;
create unique index if not exists lifting_exercise_bank_program_name_key
  on public.lifting_exercise_bank (program_id, name);


-- ── 2. Copies for every other program ─────────────────────────
-- Who owns a program's copied drills: its first active head coach
-- who isn't a test account or the platform admin; else the original
-- author.
create or replace function pg_temp.copy_owner(pid uuid, fallback uuid)
returns uuid language sql stable as $$
  select coalesce((
    select pm.user_id from public.program_members pm
     where pm.program_id = pid and pm.role = 'head_coach' and pm.status = 'active'
       and not coalesce(pm.is_test, false)
       and not public.is_platform_admin(pm.user_id)
     order by pm.created_at
     limit 1), fallback)
$$;

-- Drill categories
insert into public.drill_categories (program_id, name, sort_order, created_at)
select p.id, c.name, c.sort_order, now()
  from public.programs p
  cross join public.drill_categories c
 where c.program_id = public.legacy_default_program_id()
   and p.id <> public.legacy_default_program_id()
on conflict (program_id, name) do nothing;

-- Library drills (skips any the program already has with the same
-- title + category, so running this twice doesn't double them)
insert into public.workouts (
  program_id, coach_id, title, description, category, subcategory, tags,
  video_url, resource_url, emoji, scoring_type, scoring_metric, flat_points,
  first_place_pts, second_place_pts, third_place_pts, spot_config,
  timer_duration, lower_is_better, allow_negative, tiebreak_mode,
  tiebreak_spot_index, tiebreak_instructions,
  is_active, leaderboard_active, library_archived, current_run,
  group_id, group_name, deadline, publish_date, created_at)
select p.id, pg_temp.copy_owner(p.id, w.coach_id), w.title, w.description, w.category, w.subcategory, w.tags,
       w.video_url, w.resource_url, w.emoji, w.scoring_type, w.scoring_metric, w.flat_points,
       w.first_place_pts, w.second_place_pts, w.third_place_pts, w.spot_config,
       w.timer_duration, w.lower_is_better, w.allow_negative, w.tiebreak_mode,
       w.tiebreak_spot_index, w.tiebreak_instructions,
       false, true, false, 1,
       null, null, null, null, now()
  from public.programs p
  cross join public.workouts w
 where w.program_id = public.legacy_default_program_id()
   and p.id <> public.legacy_default_program_id()
   and w.library_archived is not true
   and not exists (
     select 1 from public.workouts x
      where x.program_id = p.id and x.title = w.title
        and coalesce(x.category, '') = coalesce(w.category, ''));

-- Lifting exercise bank
insert into public.lifting_exercise_bank (program_id, name, muscle_group, video_url, default_rest_secs,
                                          default_notes, created_by, created_at)
select p.id, b.name, b.muscle_group, b.video_url, b.default_rest_secs,
       b.default_notes, pg_temp.copy_owner(p.id, b.created_by), now()
  from public.programs p
  cross join public.lifting_exercise_bank b
 where b.program_id = public.legacy_default_program_id()
   and p.id <> public.legacy_default_program_id()
on conflict (program_id, name) do nothing;


-- Re-link drills to their own program's categories (same rules as
-- before: renames carry over, in-use categories can't be deleted).
-- Any drill whose category isn't in its program's list yet gets that
-- category added first, so the link can't fail.
insert into public.drill_categories (program_id, name, sort_order, created_at)
select distinct w.program_id, w.category, 999, now()
  from public.workouts w
 where w.category is not null
on conflict (program_id, name) do nothing;

alter table public.workouts drop constraint if exists workouts_category_fkey;
alter table public.workouts
  add constraint workouts_category_fkey
  foreign key (program_id, category) references public.drill_categories (program_id, name)
  on update cascade
  on delete restrict;


-- ── 3. The program fence ──────────────────────────────────────
select public.add_program_scope(t) from unnest(array[
  'workouts',
  'workout_groups',
  'drill_categories',
  'library_practice_log',
  'lifting_programs',
  'lifting_days',
  'lifting_day_exercises',
  'lifting_exercises',
  'lifting_exercise_bank',
  'lifting_logs',
  'lifting_program_assignments',
  'lifting_records'
]) as t;

commit;


-- ── Check ─────────────────────────────────────────────────────
-- One row per program.
-- Boys: the same numbers you had before (nothing of Boys' is changed).
-- Girls: categories and exercise bank = Boys'; drills = Boys' drills
-- that aren't archived, all hidden (hidden = drills); no groups,
-- lifting programs or logs yet.
-- fenced = 12 for every row.
select pr.name as program,
       (select count(*) from public.drill_categories c where c.program_id = pr.id) as categories,
       (select count(*) from public.workouts w where w.program_id = pr.id) as drills,
       (select count(*) from public.workouts w where w.program_id = pr.id and w.is_active is not true) as hidden,
       (select count(*) from public.workouts w where w.program_id = pr.id and w.library_archived) as archived,
       (select count(*) from public.workout_groups g where g.program_id = pr.id) as groups,
       (select count(*) from public.lifting_exercise_bank b where b.program_id = pr.id) as exercise_bank,
       (select count(*) from public.lifting_programs l where l.program_id = pr.id) as lifting_programs,
       (select count(*) from public.lifting_logs l where l.program_id = pr.id) as lifting_logs,
       (select count(*) from pg_policy pol
         where pol.polname = 'program_scope'
           and pol.polrelid::regclass::text in ('workouts','workout_groups','drill_categories','library_practice_log',
             'lifting_programs','lifting_days','lifting_day_exercises','lifting_exercises','lifting_exercise_bank',
             'lifting_logs','lifting_program_assignments','lifting_records')) as fenced
  from public.programs pr
 order by pr.name;
