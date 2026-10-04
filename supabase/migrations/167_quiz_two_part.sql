-- 167_quiz_two_part.sql
--
-- Two new play-quiz question kinds:
--
--   * Two-part "what, then where": part 1 asks what a player does on a
--     step; part 2 asks where (tap the spot) or, for a pass, who to. The
--     parts are ordinary questions linked by group_id / group_part, each
--     worth its own point.
--   * "Fill in the read" (qtype fill_read): a word from the step's
--     coaching note is blanked out -- one the coach [bracketed], or a
--     basketball term the app recognises. Ordinary multiple choice.
--
--   quiz_questions.group_id    -- shared by the parts of one question.
--   quiz_questions.group_part  -- 1, 2.
--
-- start_quiz_attempt is identical to its 161 version except retakes
-- shuffle whole groups, keeping part 1 before part 2.
--
-- Additive. Run after 161-166.

alter table public.quiz_questions add column if not exists group_id uuid;
alter table public.quiz_questions add column if not exists group_part int check (group_part is null or group_part between 1 and 5);
create index if not exists quiz_questions_group_idx on public.quiz_questions(group_id);

alter table public.quiz_questions drop constraint if exists quiz_questions_qtype_check;
alter table public.quiz_questions add constraint quiz_questions_qtype_check
  check (qtype is null or qtype in ('what_next', 'who_ball', 'name_play', 'tap_place', 'fill_read'));

create or replace function public.start_quiz_attempt(p_quiz uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_quiz  public.quizzes%rowtype;
  v_open  uuid;
  v_done  int;
  v_qs    uuid[];
  v_order uuid[];
  v_opts  jsonb := '{}'::jsonb;
  v_q     uuid;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  -- Resume an unfinished attempt rather than starting over: closing the
  -- app doesn't reset the clock or the order. Checked before the status,
  -- so someone mid-quiz when a new version goes live can still finish.
  select id into v_open from public.quiz_attempts
   where quiz_id = p_quiz and player_id = v_uid and submitted_at is null;
  if v_open is not null then return v_open; end if;

  select * into v_quiz from public.quizzes where id = p_quiz;
  if not found or v_quiz.status <> 'published' then
    raise exception 'This quiz isn''t available.';
  end if;

  select count(*) into v_done from public.quiz_attempts where quiz_id = p_quiz and player_id = v_uid;
  if v_done > 0 and not v_quiz.allow_retakes then
    raise exception 'You''ve already taken this quiz.';
  end if;

  v_qs := public.quiz_question_ids_for(p_quiz, v_uid);
  if coalesce(array_length(v_qs, 1), 0) = 0 then
    raise exception 'There are no questions in this quiz for you.';
  end if;

  -- First attempt: the coach's order. Retakes: shuffled -- but the parts
  -- of a two-part question move as one unit and stay in order (part 1,
  -- then part 2), so "what" always comes right before its "where".
  if v_done = 0 then
    v_order := v_qs;
  else
    with qs as (
      select q.id, coalesce(q.group_id, q.id) as unit, coalesce(q.group_part, 1) as part
      from public.quiz_questions q where q.id = any(v_qs)
    ), units as (
      select unit, random() as r from (select distinct unit from qs) d
    )
    select array_agg(qs.id order by units.r, qs.part) into v_order
    from qs join units on units.unit = qs.unit;
  end if;

  -- Answer order is always shuffled (generated questions put the right
  -- answer first).
  foreach v_q in array v_order loop
    v_opts := v_opts || jsonb_build_object(v_q::text, coalesce((
      select jsonb_agg(o.id order by random()) from public.quiz_question_options o where o.question_id = v_q
    ), '[]'::jsonb));
  end loop;

  insert into public.quiz_attempts (quiz_id, player_id, attempt_no, question_order, option_order, total_count)
  values (p_quiz, v_uid, v_done + 1, v_order, v_opts, array_length(v_order, 1))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.start_quiz_attempt(uuid) from public, anon;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;
