-- 166_quiz_tap_place.sql
--
-- Play quizzes phase 2: "Where do you go?" -- the court pauses at the start
-- of a step and the player taps where they end up.
--
--   quiz_questions.qtype      -- adds 'tap_place'.
--   quiz_answer_keys          -- correct_option_id may now be null;
--     .correct_point            a tap question's key is the spot the play
--                               sends the player ({x, y} in court units).
--                               Staff-only, like every key: the phone never
--                               has it until the tap is locked.
--   quizzes.tap_tolerance     -- strict | normal | loose: how close a tap
--                               must land (30 / 50 / 75 court units; the
--                               court is 600 wide, a player circle ~26).
--   quiz_answers.tap_point    -- where the player tapped.
--
--   quiz_submit_tap           -- grades and locks a tap on the server
--                               (same rules as quiz_submit_answer: one
--                               answer per question, server clock, time
--                               allowances).
--   review_deck_tap           -- the review deck's version.
--
-- Redefined, identical apart from the tap lines: quiz_guard_keys (allow a
-- spot instead of an option), quiz_guard_status (publish check),
-- quiz_attempt_review (adds the tap, the spot and the distance).
--
-- Additive. Run after 161-165.

alter table public.quiz_questions drop constraint if exists quiz_questions_qtype_check;
alter table public.quiz_questions add constraint quiz_questions_qtype_check
  check (qtype is null or qtype in ('what_next', 'who_ball', 'name_play', 'tap_place'));

alter table public.quiz_answer_keys alter column correct_option_id drop not null;
alter table public.quiz_answer_keys add column if not exists correct_point jsonb;
alter table public.quiz_answer_keys drop constraint if exists quiz_answer_keys_has_answer;
alter table public.quiz_answer_keys add constraint quiz_answer_keys_has_answer
  check (correct_option_id is not null or correct_point is not null);

alter table public.quizzes add column if not exists tap_tolerance text not null default 'normal'
  check (tap_tolerance in ('strict', 'normal', 'loose'));

alter table public.quiz_answers add column if not exists tap_point jsonb;

create or replace function public.quiz_tap_radius(p_tolerance text)
returns double precision language sql immutable
as $$ select case p_tolerance when 'strict' then 30 when 'loose' then 75 else 50 end::double precision $$;

create or replace function public.quiz_guard_keys()
returns trigger language plpgsql set search_path = public
as $$
declare v_status text;
begin
  -- NEW doesn't exist on DELETE and OLD doesn't exist on INSERT, so read
  -- whichever this operation has.
  if tg_op = 'INSERT' then
    v_status := public.quiz_status_of_question(new.question_id);
  else
    v_status := public.quiz_status_of_question(old.question_id);
  end if;
  if tg_op = 'UPDATE' then
    if v_status = 'archived' then raise exception 'This version is archived and can''t be edited.'; end if;
    if v_status = 'published' and (to_jsonb(new) - 'explanation') <> (to_jsonb(old) - 'explanation') then
      raise exception 'The correct answer can''t change on a published quiz. Regenerate to change it.';
    end if;
  elsif v_status in ('published', 'archived') then
    raise exception 'This quiz is published. Regenerate to change its answers.';
  end if;
  -- The correct option, when there is one, must belong to the same
  -- question. Tap-to-place questions have a correct spot instead.
  if tg_op <> 'DELETE' then
    if new.correct_option_id is not null and not exists (
      select 1 from public.quiz_question_options o
      where o.id = new.correct_option_id and o.question_id = new.question_id
    ) then
      raise exception 'The correct answer has to be one of this question''s options.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.quiz_guard_status()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'published')
         or (old.status = 'published' and new.status = 'archived')) then
      raise exception 'A quiz can only go draft → published → archived.';
    end if;
    if new.status = 'published' then
      if not exists (select 1 from public.quiz_questions where quiz_id = new.id) then
        raise exception 'Add at least one question before publishing.';
      end if;
      -- Tap-to-place questions need a correct spot; every other question
      -- needs two answers and a correct one marked.
      if exists (
        select 1 from public.quiz_questions q
        where q.quiz_id = new.id
          and (
            (q.qtype = 'tap_place' and not exists (
               select 1 from public.quiz_answer_keys k where k.question_id = q.id and k.correct_point is not null))
            or
            (q.qtype is distinct from 'tap_place' and (
               not exists (select 1 from public.quiz_answer_keys k where k.question_id = q.id and k.correct_option_id is not null)
               or (select count(*) from public.quiz_question_options o where o.question_id = q.id) < 2))
          )
      ) then
        raise exception 'Every question needs at least two answers and a correct one marked.';
      end if;
      new.published_at := now();
    end if;
  end if;
  if old.status <> 'draft' and (new.scout_sheet_id is distinct from old.scout_sheet_id
                                or new.game_id is distinct from old.game_id
                                or new.version is distinct from old.version) then
    raise exception 'A published quiz can''t be moved to another game.';
  end if;
  return new;
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
          'chosen_point', x.tap_point,
          'correct_point', k.correct_point,
          'radius', public.quiz_tap_radius(z.tap_tolerance),
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

create or replace function public.quiz_submit_tap(p_attempt uuid, p_question uuid, p_x double precision, p_y double precision)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  a          public.quiz_attempts%rowtype;
  z          public.quizzes%rowtype;
  v_row      public.quiz_answers%rowtype;
  v_correct  jsonb;
  v_radius   double precision;
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

  if not exists (select 1 from public.quiz_questions where id = p_question and qtype = 'tap_place') then
    raise exception 'That question isn''t a tap question.';
  end if;
  if (p_x is null) <> (p_y is null) then raise exception 'A tap needs both x and y.'; end if;

  select * into z from public.quizzes where id = a.quiz_id;
  -- Two seconds of grace for a slow connection.
  if z.time_limit_seconds is not null
     and now() > v_row.served_at + make_interval(secs => z.time_limit_seconds + 2
           -- Questions that play something before their answers appear
           -- get extra time, since the clock on screen only starts after:
           -- "name that play" 10s + 3s per step, a lead-up 30s.
           + coalesce((
               select case
                 -- Name that play plays the WHOLE play before its answers
                 -- appear: about 3 seconds a step, plus 10.
                 when (qq.visual->>'hide_after')::boolean then
                   10 + 3 * greatest(1, coalesce(jsonb_array_length(qq.visual->'frames'), 1))
                 -- A lead-up plays the step(s) before the one asked about
                 -- first; "Watch from the start" can replay several.
                 when jsonb_typeof(qq.visual->'lead_frames') = 'array'
                      and jsonb_array_length(qq.visual->'lead_frames') > 0 then 30
                 else 0 end
               from public.quiz_questions qq where qq.id = p_question), 0)) then
    v_timed := true;
  end if;

  select correct_point, explanation into v_correct, v_expl
  from public.quiz_answer_keys where question_id = p_question;
  v_radius := public.quiz_tap_radius(z.tap_tolerance);
  -- Right when the tap lands within the quiz's distance of the spot the
  -- play actually sends the player (court units; the court is 600 wide).
  v_ok := (not v_timed) and p_x is not null and v_correct is not null
          and sqrt(power(p_x - (v_correct->>'x')::double precision, 2)
                 + power(p_y - (v_correct->>'y')::double precision, 2)) <= v_radius;

  update public.quiz_answers
     set option_id = null, answered_at = now(), is_correct = v_ok, timed_out = v_timed,
         tap_point = case when p_x is null then null else jsonb_build_object('x', p_x, 'y', p_y) end
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
    v_result := v_result || jsonb_build_object('correct', v_ok, 'correct_point', v_correct, 'radius', v_radius,
      'explanation', v_expl, 'reveal', (select reveal from public.quiz_questions where id = p_question));
  end if;
  return v_result;
end $$;

create or replace function public.review_deck_tap(p_question uuid, p_x double precision, p_y double precision)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_correct jsonb;
  v_expl    text;
  v_radius  double precision;
  v_ok      boolean;
begin
  if not exists (
    select 1 from public.quiz_review_items
    where player_id = v_uid and question_id = p_question and cleared_at is null
  ) then
    raise exception 'That question isn''t in your review deck.';
  end if;
  select k.correct_point, k.explanation, public.quiz_tap_radius(z.tap_tolerance)
    into v_correct, v_expl, v_radius
  from public.quiz_answer_keys k
  join public.quiz_questions q on q.id = k.question_id
  join public.quizzes z on z.id = q.quiz_id
  where k.question_id = p_question;
  v_ok := p_x is not null and p_y is not null and v_correct is not null
          and sqrt(power(p_x - (v_correct->>'x')::double precision, 2)
                 + power(p_y - (v_correct->>'y')::double precision, 2)) <= v_radius;
  if v_ok then
    update public.quiz_review_items set cleared_at = now()
     where player_id = v_uid and question_id = p_question;
  end if;
  return jsonb_build_object('correct', v_ok, 'correct_point', v_correct, 'radius', v_radius, 'explanation', v_expl,
                            'reveal', (select reveal from public.quiz_questions where id = p_question),
                            'remaining', public.review_deck_count());
end $$;

revoke all on function public.quiz_tap_radius(text)                                       from public, anon;
grant execute on function public.quiz_tap_radius(text)                                       to authenticated;
revoke all on function public.quiz_guard_keys()                                            from public, anon, authenticated;
revoke all on function public.quiz_guard_status()                                          from public, anon, authenticated;
revoke all on function public.quiz_attempt_review(uuid)                                    from public, anon;
revoke all on function public.quiz_submit_tap(uuid, uuid, double precision, double precision) from public, anon;
revoke all on function public.review_deck_tap(uuid, double precision, double precision)    from public, anon;
grant execute on function public.quiz_attempt_review(uuid)                                    to authenticated;
grant execute on function public.quiz_submit_tap(uuid, uuid, double precision, double precision) to authenticated;
grant execute on function public.review_deck_tap(uuid, double precision, double precision)    to authenticated;
