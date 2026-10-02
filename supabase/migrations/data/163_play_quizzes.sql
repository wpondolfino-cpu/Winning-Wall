-- 163_play_quizzes.sql
--
-- Play quizzes: questions built from plays as drawn.
--
--   quizzes.playbook_id      -- the playbook a play quiz was built from
--                               (null when plays were hand-picked).
--   quizzes.source_play_ids  -- the plays it was built from.
--   quizzes.play_settings    -- question types and counts, so Regenerate
--                               rebuilds with the same choices.
--   quizzes.replaces_quiz_id -- a regenerated version points at the quiz
--                               it replaces; publishing it archives that
--                               one (scout quizzes do this by sheet).
--
--   quiz_questions.qtype     -- what_next | who_ball | name_play (null for
--                               scout and hand-written questions).
--   quiz_questions.visual    -- the snapshot shown WITH the question: the
--                               court up to the moment asked about, never
--                               the step that answers it.
--   quiz_questions.reveal    -- the answering step. Only ever sent with a
--                               result: immediate feedback, the finished-
--                               attempt review, and the review deck.
--
-- Functions redefined to carry the new fields -- each identical to its
-- 161/162 version apart from the lines that add qtype/visual/reveal/
-- playbook_id, (publish_quiz) archive the replaced version, and
-- (quiz_submit_answer) give "name that play" 20 extra seconds on a time
-- limit, since its answers only appear after the opening has played.
--
-- Additive. Safe on top of 161 and 162.

alter table public.quizzes add column if not exists playbook_id uuid references public.playbooks(id) on delete set null;
alter table public.quizzes add column if not exists source_play_ids uuid[] not null default '{}';
alter table public.quizzes add column if not exists play_settings jsonb not null default '{}'::jsonb;
alter table public.quizzes add column if not exists replaces_quiz_id uuid references public.quizzes(id) on delete set null;
create index if not exists quizzes_playbook_idx on public.quizzes(playbook_id);

alter table public.quiz_questions add column if not exists qtype text
  check (qtype is null or qtype in ('what_next', 'who_ball', 'name_play'));
alter table public.quiz_questions add column if not exists visual jsonb;
alter table public.quiz_questions add column if not exists reveal jsonb;

-- The published-question guard (161) compares every column except the
-- prompt, so qtype, visual and reveal are already frozen once published.

create or replace function public.quiz_question_payload(p_question uuid, p_order jsonb)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'question_id', q.id,
    'prompt', q.prompt,
    'qtype', q.qtype,
    'visual', q.visual,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by coalesce(ord.i, 1000 + o.sort_order))
      from public.quiz_question_options o
      left join jsonb_array_elements_text(coalesce(p_order, '[]'::jsonb)) with ordinality ord(option_txt, i)
        on ord.option_txt = o.id::text
      where o.question_id = q.id
    ), '[]'::jsonb)
  )
  from public.quiz_questions q where q.id = p_question
$$;

create or replace function public.my_quizzes()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
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
        and coalesce(array_length(public.quiz_question_ids_for(z.id, v_uid), 1), 0) > 0
    ) s
  ), '[]'::jsonb);
end $$;

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
           -- A "name that play" question plays its opening before the
           -- answers appear, and the clock only starts after that: allow
           -- for the animation (and a Watch again).
           + case when (select (qq.visual->>'hide_after')::boolean from public.quiz_questions qq where qq.id = p_question)
                  then 20 else 0 end) then
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

create or replace function public.quiz_attempt_review(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a     public.quiz_attempts%rowtype;
  z     public.quizzes%rowtype;
begin
  select * into a from public.quiz_attempts where id = p_attempt;
  if not found then raise exception 'Attempt not found'; end if;
  if a.player_id <> v_uid and not public.is_staff(v_uid) then raise exception 'Attempt not found'; end if;
  if a.submitted_at is null then raise exception 'Finish the quiz to see the answers.'; end if;
  select * into z from public.quizzes where id = a.quiz_id;

  return jsonb_build_object(
    'quiz_id', z.id,
    'title', z.title,
    'attempt_no', a.attempt_no,
    'correct_count', a.correct_count,
    'total_count', a.total_count,
    'questions', coalesce((
      select jsonb_agg(
        public.quiz_question_payload(t.q, a.option_order -> (t.q::text)) || jsonb_build_object(
          'chosen_option_id', x.option_id,
          'correct_option_id', k.correct_option_id,
          'explanation', k.explanation,
          'reveal', (select qq.reveal from public.quiz_questions qq where qq.id = t.q),
          'is_correct', coalesce(x.is_correct, false),
          'timed_out', coalesce(x.timed_out, false)
        ) order by t.i)
      from unnest(a.question_order) with ordinality t(q, i)
      left join public.quiz_answers x on x.attempt_id = a.id and x.question_id = t.q
      left join public.quiz_answer_keys k on k.question_id = t.q
      where exists (select 1 from public.quiz_questions qq where qq.id = t.q)
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.review_deck_answer(p_question uuid, p_option uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_correct uuid;
  v_expl    text;
  v_ok      boolean;
begin
  if not exists (
    select 1 from public.quiz_review_items
    where player_id = v_uid and question_id = p_question and cleared_at is null
  ) then
    raise exception 'That question isn''t in your review deck.';
  end if;
  select correct_option_id, explanation into v_correct, v_expl
  from public.quiz_answer_keys where question_id = p_question;
  v_ok := p_option is not null and p_option = v_correct;
  if v_ok then
    update public.quiz_review_items set cleared_at = now()
     where player_id = v_uid and question_id = p_question;
  end if;
  return jsonb_build_object('correct', v_ok, 'correct_option_id', v_correct, 'explanation', v_expl,
                            'reveal', (select reveal from public.quiz_questions where id = p_question),
                            'remaining', public.review_deck_count());
end $$;

create or replace function public.publish_quiz(p_quiz uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_sheet uuid; v_replaces uuid;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Coaches only'; end if;
  select scout_sheet_id, replaces_quiz_id into v_sheet, v_replaces from public.quizzes where id = p_quiz and status = 'draft';
  if not found then raise exception 'Only a draft can be published.'; end if;
  if v_sheet is not null then
    update public.quizzes set status = 'archived'
     where scout_sheet_id = v_sheet and status = 'published' and id <> p_quiz;
  end if;
  -- Play (and standalone) quizzes have no sheet: a regenerated version
  -- names the quiz it replaces instead.
  if v_replaces is not null then
    update public.quizzes set status = 'archived' where id = v_replaces and status = 'published';
  end if;
  update public.quizzes set status = 'published' where id = p_quiz;
end $$;

-- Same grants as before (create or replace keeps them; restated so this
-- file stands on its own).
revoke all on function public.quiz_question_payload(uuid, jsonb)   from public, anon, authenticated;
revoke all on function public.my_quizzes()                         from public, anon;
revoke all on function public.quiz_submit_answer(uuid, uuid, uuid) from public, anon;
revoke all on function public.quiz_attempt_review(uuid)            from public, anon;
revoke all on function public.review_deck_answer(uuid, uuid)       from public, anon;
revoke all on function public.publish_quiz(uuid)                   from public, anon;
grant execute on function public.my_quizzes()                         to authenticated;
grant execute on function public.quiz_submit_answer(uuid, uuid, uuid) to authenticated;
grant execute on function public.quiz_attempt_review(uuid)            to authenticated;
grant execute on function public.review_deck_answer(uuid, uuid)       to authenticated;
grant execute on function public.publish_quiz(uuid)                   to authenticated;
