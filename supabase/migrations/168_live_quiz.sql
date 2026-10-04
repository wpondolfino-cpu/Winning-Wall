-- 168_live_quiz.sql
--
-- Live team-meeting mode: the coach runs a quiz on the projector, players
-- answer on their phones, the room sees the reveal and a top-5 board.
--
--   live_sessions      -- one per run: which quiz, where it's up to.
--   live_participants  -- who's in the room.
--   live_answers       -- one locked answer per player per question.
--
-- Separate from a quiz's own results: a live run is never an attempt and
-- never touches the review deck, so players can still take the quiz on
-- their own afterwards.
--
-- Same security model as quizzes: players have NO direct access to these
-- tables. Every action is a function that checks the caller; answers are
-- graded and locked on the server, and keys are only sent at reveal.
-- Phones learn about changes through a Realtime broadcast ping and then
-- ask the server for the state, so nothing in a ping can be trusted or
-- needs to be.
--
-- Questions assigned to specific players are left out of a live run --
-- it's for the whole room.
--
-- Additive. Run after 161-167.

create table if not exists public.live_sessions (
  id                  uuid primary key default gen_random_uuid(),
  quiz_id             uuid not null references public.quizzes(id) on delete cascade,
  host_id             uuid references public.profiles(id) on delete set null,
  status              text not null default 'lobby'
                      check (status in ('lobby', 'question', 'reveal', 'scoreboard', 'ended')),
  question_ids        uuid[] not null default '{}',
  current_index       int not null default -1,
  question_started_at timestamptz,
  seconds_per_question int not null default 20 check (seconds_per_question between 5 and 300),
  created_at          timestamptz not null default now(),
  ended_at            timestamptz
);
create index if not exists live_sessions_quiz_idx on public.live_sessions(quiz_id);
create index if not exists live_sessions_active_idx on public.live_sessions(status) where status <> 'ended';

create table if not exists public.live_participants (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  player_id  uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (session_id, player_id)
);

create table if not exists public.live_answers (
  session_id  uuid not null references public.live_sessions(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  option_id   uuid references public.quiz_question_options(id) on delete set null,
  tap_point   jsonb,
  is_correct  boolean not null default false,
  answered_ms int not null,
  answered_at timestamptz not null default now(),
  primary key (session_id, question_id, player_id)
);

alter table public.live_sessions     enable row level security;
alter table public.live_participants enable row level security;
alter table public.live_answers      enable row level security;

-- Staff can read everything (the coach's after-session summary).
drop policy if exists "live_sessions_staff_read" on public.live_sessions;
create policy "live_sessions_staff_read" on public.live_sessions for select using (public.is_staff(auth.uid()));
drop policy if exists "live_participants_staff_read" on public.live_participants;
create policy "live_participants_staff_read" on public.live_participants for select using (public.is_staff(auth.uid()));
drop policy if exists "live_answers_staff_read" on public.live_answers;
create policy "live_answers_staff_read" on public.live_answers for select using (public.is_staff(auth.uid()));

-- ══ Helpers ══════════════════════════════════════════════════════

-- Leaderboard order: most right first; total time on right answers breaks ties.
create or replace function public.live_board(p_session uuid, p_limit int)
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(b)::jsonb order by b.rank), '[]'::jsonb)
  from (
    select pr.id as player_id, pr.name,
           count(a.*) filter (where a.is_correct) as correct,
           coalesce(sum(a.answered_ms) filter (where a.is_correct), 0) as ms,
           rank() over (order by count(a.*) filter (where a.is_correct) desc,
                                 coalesce(sum(a.answered_ms) filter (where a.is_correct), 0) asc) as rank
    from public.live_participants p
    join public.profiles pr on pr.id = p.player_id
    left join public.live_answers a on a.session_id = p.session_id and a.player_id = p.player_id
    where p.session_id = p_session
    group by pr.id, pr.name
    order by 5
    limit p_limit
  ) b
$$;

-- The current question for a phone or the projector, never with its key.
create or replace function public.live_question_payload(s public.live_sessions)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when s.current_index < 0 or s.current_index >= coalesce(array_length(s.question_ids, 1), 0) then null
    else public.quiz_question_payload(s.question_ids[s.current_index + 1],
           -- Answers in an order that's scrambled but the same on every
           -- screen in this session (built questions store the right one first).
           (select jsonb_agg(o.id order by md5(o.id::text || s.id::text)) from public.quiz_question_options o
             where o.question_id = s.question_ids[s.current_index + 1]))
         || jsonb_build_object('qtype', (select qtype from public.quiz_questions where id = s.question_ids[s.current_index + 1]),
                               'visual', (select visual from public.quiz_questions where id = s.question_ids[s.current_index + 1]))
  end
$$;

-- ══ Coach ════════════════════════════════════════════════════════

create or replace function public.live_start(p_quiz uuid, p_seconds int default 20)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_qs uuid[]; v_limit int;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Coaches only'; end if;
  -- Whole-room questions only, in the coach's order (pairs stay in order).
  select coalesce(array_agg(q.id order by q.sort_order, q.created_at), '{}') into v_qs
  from public.quiz_questions q
  where q.quiz_id = p_quiz
    and not exists (select 1 from public.quiz_question_assignees a where a.question_id = q.id);
  if coalesce(array_length(v_qs, 1), 0) = 0 then
    raise exception 'This quiz has no questions for the whole team (assigned questions are left out of live mode).';
  end if;
  -- One live run per quiz at a time.
  update public.live_sessions set status = 'ended', ended_at = now()
   where quiz_id = p_quiz and status <> 'ended';
  select coalesce(time_limit_seconds, p_seconds) into v_limit from public.quizzes where id = p_quiz;
  insert into public.live_sessions (quiz_id, host_id, question_ids, seconds_per_question)
  values (p_quiz, auth.uid(), v_qs, greatest(5, least(300, coalesce(v_limit, 20))))
  returning id into v_id;
  return v_id;
end $$;

-- start | reveal | scoreboard | next | end
create or replace function public.live_advance(p_session uuid, p_action text)
returns void language plpgsql security definer set search_path = public
as $$
declare s public.live_sessions%rowtype; v_total int;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Coaches only'; end if;
  select * into s from public.live_sessions where id = p_session for update;
  if not found or s.status = 'ended' then raise exception 'This live session has ended.'; end if;
  v_total := coalesce(array_length(s.question_ids, 1), 0);
  if p_action = 'end' then
    update public.live_sessions set status = 'ended', ended_at = now() where id = p_session;
  elsif p_action = 'reveal' and s.status = 'question' then
    update public.live_sessions set status = 'reveal' where id = p_session;
  elsif p_action = 'scoreboard' and s.status in ('reveal', 'question') then
    update public.live_sessions set status = 'scoreboard' where id = p_session;
  elsif p_action in ('start', 'next') and s.status in ('lobby', 'reveal', 'scoreboard') then
    if s.current_index + 1 >= v_total then
      update public.live_sessions set status = 'ended', ended_at = now() where id = p_session;
    else
      update public.live_sessions
         set status = 'question', current_index = s.current_index + 1, question_started_at = now()
       where id = p_session;
    end if;
  else
    raise exception 'Can''t % from here.', p_action;
  end if;
end $$;

-- Everything the projector shows: the question, then at reveal the key,
-- how many picked each answer (never who), every tap, and the board.
create or replace function public.live_host_state(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare s public.live_sessions%rowtype; v_q uuid; v_reveal boolean;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Coaches only'; end if;
  select * into s from public.live_sessions where id = p_session;
  if not found then raise exception 'Session not found'; end if;
  v_q := case when s.current_index >= 0 then s.question_ids[s.current_index + 1] else null end;
  v_reveal := s.status in ('reveal', 'scoreboard', 'ended');
  return jsonb_build_object(
    'id', s.id, 'quiz_id', s.quiz_id, 'status', s.status,
    'quiz_title', (select title from public.quizzes where id = s.quiz_id),
    'index', s.current_index, 'total', coalesce(array_length(s.question_ids, 1), 0),
    'seconds', s.seconds_per_question,
    'remaining', case when s.status = 'question' and s.question_started_at is not null
                      then greatest(0, s.seconds_per_question - floor(extract(epoch from now() - s.question_started_at)))::int end,
    'participants', (select coalesce(jsonb_agg(pr.name order by p.joined_at), '[]'::jsonb)
                     from public.live_participants p join public.profiles pr on pr.id = p.player_id where p.session_id = s.id),
    'question', public.live_question_payload(s),
    'answered', (select count(*) from public.live_answers where session_id = s.id and question_id = v_q),
    'counts', (select coalesce(jsonb_object_agg(coalesce(option_id::text, 'none'), n), '{}'::jsonb)
               from (select option_id, count(*) n from public.live_answers where session_id = s.id and question_id = v_q group by option_id) c),
    'taps', case when v_reveal then (select coalesce(jsonb_agg(jsonb_build_object('x', (tap_point->>'x')::float, 'y', (tap_point->>'y')::float, 'ok', is_correct)), '[]'::jsonb)
                    from public.live_answers where session_id = s.id and question_id = v_q and tap_point is not null) end,
    'correct_count', case when v_reveal then (select count(*) from public.live_answers where session_id = s.id and question_id = v_q and is_correct) end,
    'key', case when v_reveal and v_q is not null then (
             select jsonb_build_object('correct_option_id', k.correct_option_id, 'correct_point', k.correct_point,
                                       'explanation', k.explanation, 'radius', public.quiz_tap_radius(z.tap_tolerance),
                                       'reveal', (select reveal from public.quiz_questions where id = v_q))
             from public.quiz_answer_keys k, public.quizzes z where k.question_id = v_q and z.id = s.quiz_id) end,
    'board', case when s.status in ('scoreboard', 'ended') then public.live_board(s.id, 5) end
  );
end $$;

-- ══ Players ══════════════════════════════════════════════════════

-- Live runs this player can join right now (for the "Live now" banner).
create or replace function public.live_my_sessions()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'quiz_title', z.title, 'status', s.status) order by s.created_at desc), '[]'::jsonb)
  from public.live_sessions s
  join public.quizzes z on z.id = s.quiz_id
  where s.status <> 'ended'
    and s.created_at > now() - interval '4 hours'
    and public.quiz_on_game_roster(s.quiz_id, auth.uid())
$$;

create or replace function public.live_join(p_session uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare s public.live_sessions%rowtype;
begin
  select * into s from public.live_sessions where id = p_session;
  if not found or s.status = 'ended' then raise exception 'This live quiz has ended.'; end if;
  if not public.quiz_on_game_roster(s.quiz_id, auth.uid()) then raise exception 'This live quiz isn''t for your team.'; end if;
  insert into public.live_participants (session_id, player_id) values (p_session, auth.uid())
  on conflict do nothing;
end $$;

-- What a phone shows. The key only appears once the coach reveals.
create or replace function public.live_state(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare s public.live_sessions%rowtype; v_q uuid; v_mine public.live_answers%rowtype; v_rank jsonb;
begin
  if not exists (select 1 from public.live_participants where session_id = p_session and player_id = auth.uid()) then
    raise exception 'Join the live quiz first.';
  end if;
  select * into s from public.live_sessions where id = p_session;
  v_q := case when s.current_index >= 0 then s.question_ids[s.current_index + 1] else null end;
  select * into v_mine from public.live_answers where session_id = s.id and question_id = v_q and player_id = auth.uid();
  select r into v_rank from jsonb_array_elements(public.live_board(s.id, 1000)) r where (r->>'player_id')::uuid = auth.uid();
  return jsonb_build_object(
    'id', s.id, 'status', s.status,
    'quiz_title', (select title from public.quizzes where id = s.quiz_id),
    'index', s.current_index, 'total', coalesce(array_length(s.question_ids, 1), 0),
    'remaining', case when s.status = 'question' and s.question_started_at is not null
                      then greatest(0, s.seconds_per_question - floor(extract(epoch from now() - s.question_started_at)))::int end,
    'question', case when s.status = 'question' then public.live_question_payload(s) end,
    'answered', v_mine.player_id is not null,
    'my_correct', case when s.status in ('reveal', 'scoreboard', 'ended') then v_mine.is_correct end,
    'my_rank', v_rank
  );
end $$;

-- Grades and locks one answer. Option for multiple choice, x/y for a tap.
create or replace function public.live_answer(p_session uuid, p_question uuid, p_option uuid, p_x double precision, p_y double precision)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare s public.live_sessions%rowtype; v_key public.quiz_answer_keys%rowtype; v_ok boolean; v_ms int; v_radius double precision;
begin
  if not exists (select 1 from public.live_participants where session_id = p_session and player_id = auth.uid()) then
    raise exception 'Join the live quiz first.';
  end if;
  select * into s from public.live_sessions where id = p_session;
  if s.status <> 'question' or s.question_ids[s.current_index + 1] <> p_question then
    raise exception 'Too late — the coach has moved on.';
  end if;
  v_ms := floor(extract(epoch from now() - s.question_started_at) * 1000);
  if v_ms > (s.seconds_per_question + 2) * 1000 then raise exception 'Time''s up.'; end if;
  select * into v_key from public.quiz_answer_keys where question_id = p_question;
  if v_key.correct_point is not null then
    if p_x is null or p_y is null then raise exception 'Tap the court first.'; end if;
    select public.quiz_tap_radius(tap_tolerance) into v_radius from public.quizzes where id = s.quiz_id;
    v_ok := sqrt(power(p_x - (v_key.correct_point->>'x')::double precision, 2)
               + power(p_y - (v_key.correct_point->>'y')::double precision, 2)) <= v_radius;
  else
    if p_option is null or not exists (select 1 from public.quiz_question_options where id = p_option and question_id = p_question) then
      raise exception 'That isn''t one of the answers.';
    end if;
    v_ok := p_option = v_key.correct_option_id;
  end if;
  insert into public.live_answers (session_id, question_id, player_id, option_id, tap_point, is_correct, answered_ms)
  values (p_session, p_question, auth.uid(), p_option,
          case when p_x is null then null else jsonb_build_object('x', p_x, 'y', p_y) end, v_ok, v_ms)
  on conflict do nothing;
  if not found then raise exception 'You already answered this one.'; end if;
  return jsonb_build_object('recorded', true);
end $$;

-- ══ Grants ═══════════════════════════════════════════════════════
revoke all on function public.live_board(uuid, int)                    from public, anon, authenticated;
revoke all on function public.live_question_payload(public.live_sessions) from public, anon, authenticated;
revoke all on function public.live_start(uuid, int)                    from public, anon;
revoke all on function public.live_advance(uuid, text)                 from public, anon;
revoke all on function public.live_host_state(uuid)                    from public, anon;
revoke all on function public.live_my_sessions()                       from public, anon;
revoke all on function public.live_join(uuid)                          from public, anon;
revoke all on function public.live_state(uuid)                         from public, anon;
revoke all on function public.live_answer(uuid, uuid, uuid, double precision, double precision) from public, anon;
grant execute on function public.live_start(uuid, int)                    to authenticated;
grant execute on function public.live_advance(uuid, text)                 to authenticated;
grant execute on function public.live_host_state(uuid)                    to authenticated;
grant execute on function public.live_my_sessions()                       to authenticated;
grant execute on function public.live_join(uuid)                          to authenticated;
grant execute on function public.live_state(uuid)                         to authenticated;
grant execute on function public.live_answer(uuid, uuid, uuid, double precision, double precision) to authenticated;
