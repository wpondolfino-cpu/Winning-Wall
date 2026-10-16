-- ============================================================
-- 181_scope_games_scouting_quizzes.sql
--
-- MULTI-TENANCY STEP 7 — games, stats, scouting, game day, quizzes.
--
-- Fenced to their program (restrictive "program_scope", as before):
--   games, possessions, shifts, lineup events, call-ups, rotation plans,
--   play calls, opponents, stat goals & flag streaks, saved reports,
--   report layout, scout sheets (+ sets, defense, players, specials),
--   game day sheets (+ sections, calls), quizzes (+ questions, options,
--   answer keys, assignees, attempts, answers, review deck) and live
--   quiz sessions.
--
-- Also:
--   * Stat goals and flag streaks are keyed per program, so Girls can
--     set its own goals. (Ships with 2 app files that save them.)
--   * Imported schedule games are unique per program: two schools
--     importing the same league game no longer collide.
--   * "My quizzes", live-quiz invites and the review deck only show the
--     program you're in (they run with elevated rights, so they filter
--     themselves).
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. Keys that must be per program ──────────────────────────
drop index if exists public.stat_goals_stat_key_team_unique;
create unique index if not exists stat_goals_program_stat_team_unique
  on public.stat_goals (program_id, stat_key, team);

alter table public.stat_flag_streaks drop constraint if exists stat_flag_streaks_stat_key_team_key;
create unique index if not exists stat_flag_streaks_program_stat_team_unique
  on public.stat_flag_streaks (program_id, stat_key, team);

drop index if exists public.games_external_uid_idx;
create unique index if not exists games_program_external_uid_idx
  on public.games (program_id, external_uid) where external_uid is not null;


-- ── 2. The program fence ──────────────────────────────────────
select public.add_program_scope(t) from unnest(array[
  'games',
  'possessions',
  'shifts',
  'lineup_events',
  'game_call_ups',
  'rotation_plans',
  'play_calls',
  'opponents',
  'stat_goals',
  'stat_flag_streaks',
  'saved_reports',
  'report_layout',
  'scout_sheets',
  'scout_offense_sets',
  'scout_defense',
  'scout_players',
  'scout_specials',
  'gameday_sheets',
  'gameday_sections',
  'gameday_calls',
  'quizzes',
  'quiz_questions',
  'quiz_question_options',
  'quiz_answer_keys',
  'quiz_question_assignees',
  'quiz_attempts',
  'quiz_answers',
  'quiz_review_items',
  'live_sessions',
  'live_participants',
  'live_answers'
]) as t;


-- ── 3. Quiz lists: only the program you're in ─────────────────
CREATE OR REPLACE FUNCTION public.my_quizzes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  return coalesce((
    select jsonb_agg(item order by coalesce(item->>'due_sort', '9999') asc)
    from (
      select jsonb_build_object(
        'quiz_id', z.id,
        'title', z.title,
        'kind', case when z.scout_sheet_id is not null then 'scout'
                     when z.review_game_id is not null then 'review'
                     when z.playbook_id is not null or cardinality(z.source_play_ids) > 0 then 'plays'
                     else 'standalone' end,
        'playbook_id', z.playbook_id,
        'scout_sheet_id', z.scout_sheet_id,
        'game_id', z.game_id,
        'game_date', g.game_date,
        'tip_time', g.tip_time,
        'opponent', g.opponent,
        'due_at', z.due_at,
        'due_sort', coalesce(z.due_at::text, g.game_date::text),
        'feedback_mode', z.feedback_mode,
        'allow_retakes', z.allow_retakes,
        'time_limit_seconds', z.time_limit_seconds,
        'question_count', coalesce(array_length(public.quiz_question_ids_for(z.id, v_uid), 1), 0),
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'attempt_no', a.attempt_no, 'submitted_at', a.submitted_at,
            'correct_count', a.correct_count, 'total_count', a.total_count
          ) order by a.attempt_no)
          from public.quiz_attempts a where a.quiz_id = z.id and a.player_id = v_uid
        ), '[]'::jsonb)
      ) as item
      from public.quizzes z
      left join public.games g on g.id = z.game_id
      where z.status = 'published'
        and z.program_id = public.current_program_id()
        and coalesce(array_length(public.quiz_question_ids_for(z.id, v_uid), 1), 0) > 0
    ) s
  ), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.live_my_sessions()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'quiz_title', z.title, 'status', s.status) order by s.created_at desc), '[]'::jsonb)
  from public.live_sessions s
  join public.quizzes z on z.id = s.quiz_id
  where s.status <> 'ended'
    and s.program_id = public.current_program_id()
    and s.created_at > now() - interval '4 hours'
    and public.quiz_on_game_roster(s.quiz_id, auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.review_deck_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.quiz_review_items r
  join public.quiz_questions q on q.id = r.question_id
  where r.player_id = auth.uid() and r.cleared_at is null
    and r.program_id = public.current_program_id()
$function$
;

CREATE OR REPLACE FUNCTION public.review_deck_next(p_exclude uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_q   uuid;
  v_ord jsonb;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select r.question_id into v_q
  from public.quiz_review_items r
  join public.quiz_questions q on q.id = r.question_id
  where r.player_id = v_uid and r.cleared_at is null
    and r.program_id = public.current_program_id()
  order by (r.question_id = p_exclude), random()
  limit 1;
  if v_q is null then return jsonb_build_object('done', true); end if;

  select jsonb_agg(o.id order by random()) into v_ord
  from public.quiz_question_options o where o.question_id = v_q;

  return public.quiz_question_payload(v_q, v_ord) || jsonb_build_object(
    'done', false,
    'quiz_title', (select z.title from public.quiz_questions q join public.quizzes z on z.id = q.quiz_id where q.id = v_q),
    'remaining', public.review_deck_count()
  );
end $function$
;

commit;


-- ── Summary ───────────────────────────────────────────────────
select 'tables fenced to their program' as item,
       count(*)::text || ' tables' as value
from pg_policies where policyname = 'program_scope' and permissive = 'RESTRICTIVE'
union all
select 'games-group tables fenced (expect 31)',
       count(*)::text from pg_policies
where policyname = 'program_scope' and tablename in ('games', 'possessions', 'shifts', 'lineup_events', 'game_call_ups', 'rotation_plans', 'play_calls', 'opponents', 'stat_goals', 'stat_flag_streaks', 'saved_reports', 'report_layout', 'scout_sheets', 'scout_offense_sets', 'scout_defense', 'scout_players', 'scout_specials', 'gameday_sheets', 'gameday_sections', 'gameday_calls', 'quizzes', 'quiz_questions', 'quiz_question_options', 'quiz_answer_keys', 'quiz_question_assignees', 'quiz_attempts', 'quiz_answers', 'quiz_review_items', 'live_sessions', 'live_participants', 'live_answers')
union all
select 'Boys games / scout sheets / quizzes',
       (select count(*) from public.games g join public.programs pr on pr.id = g.program_id where pr.name = 'Boys Basketball')::text
       || ' / ' ||
       (select count(*) from public.scout_sheets s join public.programs pr on pr.id = s.program_id where pr.name = 'Boys Basketball')::text
       || ' / ' ||
       (select count(*) from public.quizzes q join public.programs pr on pr.id = q.program_id where pr.name = 'Boys Basketball')::text;
