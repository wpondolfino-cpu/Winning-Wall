-- 164_quiz_lead_up.sql
--
-- "What happens next" and "Who gets the ball" questions now play the step
-- before the moment they ask about (stored in the question's visual as
-- lead_frames), and the answers appear after it. The on-screen clock
-- starts once the answers show, so the server allows 30 extra seconds on
-- a timed quiz for questions with a lead-up -- the same idea as the 20
-- seconds "name that play" already gets.
--
-- quiz_submit_answer is identical to its 163 version apart from that
-- allowance. No table changes: lead_frames lives inside the existing
-- visual column.

create or replace function public.quiz_submit_answer(p_attempt uuid, p_question uuid, p_option uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  a          public.quiz_attempts%rowtype;
  z          public.quizzes%rowtype;
  v_row      public.quiz_answers%rowtype;
  v_correct  uuid;
  v_expl     text;
  v_ok       boolean;
  v_timed    boolean := false;
  v_finished boolean := false;
  v_result   jsonb;
begin
  select * into a from public.quiz_attempts where id = p_attempt and player_id = v_uid for update;
  if not found then raise exception 'Attempt not found'; end if;
  if a.submitted_at is not null then raise exception 'This attempt is already finished.'; end if;
  if not (p_question = any(a.question_order)) then raise exception 'That question isn''t in this attempt.'; end if;

  select * into v_row from public.quiz_answers where attempt_id = a.id and question_id = p_question;
  if not found then raise exception 'That question hasn''t been served yet.'; end if;
  if v_row.answered_at is not null then raise exception 'That question is already answered.'; end if;

  if p_option is not null and not exists (
    select 1 from public.quiz_question_options where id = p_option and question_id = p_question
  ) then
    raise exception 'That isn''t one of the answers.';
  end if;

  select * into z from public.quizzes where id = a.quiz_id;
  -- Two seconds of grace for a slow connection.
  if z.time_limit_seconds is not null
     and now() > v_row.served_at + make_interval(secs => z.time_limit_seconds + 2
           -- Questions that play something before their answers appear
           -- get extra time, since the clock on screen only starts after:
           -- "name that play" 20s, a lead-up 30s.
           + coalesce((
               select case
                 when (qq.visual->>'hide_after')::boolean then 20
                 -- A lead-up plays the step(s) before the one asked about
                 -- first; "Watch from the start" can replay several.
                 when jsonb_typeof(qq.visual->'lead_frames') = 'array'
                      and jsonb_array_length(qq.visual->'lead_frames') > 0 then 30
                 else 0 end
               from public.quiz_questions qq where qq.id = p_question), 0)) then
    v_timed := true;
  end if;

  select correct_option_id, explanation into v_correct, v_expl
  from public.quiz_answer_keys where question_id = p_question;
  v_ok := (not v_timed) and p_option is not null and p_option = v_correct;

  update public.quiz_answers
     set option_id = p_option, answered_at = now(), is_correct = v_ok, timed_out = v_timed
   where attempt_id = a.id and question_id = p_question;

  if v_ok then
    update public.quiz_review_items set cleared_at = now()
     where player_id = v_uid and question_id = p_question and cleared_at is null;
  else
    insert into public.quiz_review_items (player_id, question_id)
    values (v_uid, p_question)
    on conflict (player_id, question_id) do update set cleared_at = null, added_at = now();
  end if;

  if not exists (
    select 1 from unnest(a.question_order) q
    where not exists (
      select 1 from public.quiz_answers x
      where x.attempt_id = a.id and x.question_id = q and x.answered_at is not null
    )
  ) then
    update public.quiz_attempts
       set submitted_at = now(),
           correct_count = (select count(*) from public.quiz_answers where attempt_id = a.id and is_correct)
     where id = a.id;
    v_finished := true;
  end if;

  v_result := jsonb_build_object('recorded', true, 'finished', v_finished, 'timed_out', v_timed);
  if z.feedback_mode = 'immediate' then
    v_result := v_result || jsonb_build_object('correct', v_ok, 'correct_option_id', v_correct, 'explanation', v_expl,
      'reveal', (select reveal from public.quiz_questions where id = p_question));
  end if;
  return v_result;
end $$;

revoke all on function public.quiz_submit_answer(uuid, uuid, uuid) from public, anon;
grant execute on function public.quiz_submit_answer(uuid, uuid, uuid) to authenticated;
