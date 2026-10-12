-- 161_quizzes.sql
--
-- Player quizzes, version 1: quizzes generated from a scout sheet.
--
--   1. Tables: quizzes (the single root every other quiz table hangs
--      off, so the multi-tenancy pass adds program_id in ONE place),
--      questions, options, answer keys, assignees, attempts, answers,
--      the personal review deck, and a "to cover" list per practice.
--   2. Policies: staff read/write through is_staff(). Players get NO
--      direct access to keys, assignees, answers or the review deck --
--      every player action goes through the functions in section 4.
--   3. Guards: once a quiz is published, only wording can change. An
--      answer, an option list or an assignment can't move under work
--      that's already been submitted -- Regenerate makes a new version.
--   4. Player functions. The phone never sends a score and never holds
--      the answer key before an answer is locked:
--        start_quiz_attempt   -- creates the attempt, fixes its order
--        quiz_next_question   -- serves ONE question, stamps the time
--        quiz_submit_answer   -- grades + locks it on the server
--        quiz_attempt_review  -- the key, only once the attempt is done
--        review_deck_*        -- redo missed questions until right
--   5. Staff function: publish_quiz (validates, archives the old
--      version, publishes the new one in one step) and quiz_roster.
--
-- Additive only. Nothing existing changes.

-- ══ 1. Tables ════════════════════════════════════════════════════

create table if not exists public.quizzes (
  id                   uuid primary key default gen_random_uuid(),
  scout_sheet_id       uuid references public.scout_sheets(id) on delete cascade,
  game_id              uuid references public.games(id) on delete cascade,
  title                text not null,
  version              int  not null default 1,
  status               text not null default 'draft'
                       check (status in ('draft', 'published', 'archived')),
  feedback_mode        text not null default 'end'
                       check (feedback_mode in ('end', 'immediate')),
  allow_retakes        boolean not null default false,
  time_limit_seconds   int check (time_limit_seconds is null or time_limit_seconds between 5 and 300),
  show_time_to_coaches boolean not null default false,
  published_at         timestamptz,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists quizzes_sheet_idx on public.quizzes(scout_sheet_id);
create index if not exists quizzes_game_idx  on public.quizzes(game_id);
-- One draft and one live version per scout sheet at a time.
create unique index if not exists quizzes_one_draft_per_sheet
  on public.quizzes(scout_sheet_id) where status = 'draft' and scout_sheet_id is not null;
create unique index if not exists quizzes_one_live_per_sheet
  on public.quizzes(scout_sheet_id) where status = 'published' and scout_sheet_id is not null;

create table if not exists public.quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  sort_order  int  not null default 0,
  prompt      text not null,
  source      text not null default 'coach' check (source in ('sheet', 'ai', 'coach')),
  -- Groups questions of the same kind across players, e.g. every
  -- "which hand is your man's strong hand" matchup question, so the
  -- re-teach alert can judge them together.
  family      text,
  created_at  timestamptz not null default now()
);
create index if not exists quiz_questions_quiz_idx on public.quiz_questions(quiz_id);

create table if not exists public.quiz_question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  label       text not null,
  sort_order  int  not null default 0
);
create index if not exists quiz_options_question_idx on public.quiz_question_options(question_id);

-- Staff-only. A player only ever sees a row of this through a function,
-- after their own answer to that question is locked.
create table if not exists public.quiz_answer_keys (
  question_id       uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_option_id uuid not null references public.quiz_question_options(id) on delete cascade,
  explanation       text
);

-- No rows for a question = it goes to everyone on the game's roster.
create table if not exists public.quiz_question_assignees (
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  player_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (question_id, player_id)
);
create index if not exists quiz_assignees_player_idx on public.quiz_question_assignees(player_id);

create table if not exists public.quiz_attempts (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes(id) on delete cascade,
  player_id      uuid not null references public.profiles(id) on delete cascade,
  attempt_no     int  not null,
  question_order uuid[] not null,          -- fixed at start; retakes are shuffled
  option_order   jsonb  not null default '{}'::jsonb,  -- { question_id: [option ids] }
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  correct_count  int,                      -- written only by the server, at finish
  total_count    int not null,
  unique (quiz_id, player_id, attempt_no)
);
create index if not exists quiz_attempts_quiz_idx on public.quiz_attempts(quiz_id);
create index if not exists quiz_attempts_player_idx on public.quiz_attempts(player_id);
create unique index if not exists quiz_attempts_one_open
  on public.quiz_attempts(quiz_id, player_id) where submitted_at is null;

-- A row appears when a question is SERVED (that's the clock start for a
-- time limit) and is completed when it's answered.
create table if not exists public.quiz_answers (
  attempt_id  uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  served_at   timestamptz not null default now(),
  answered_at timestamptz,
  option_id   uuid references public.quiz_question_options(id) on delete set null,
  is_correct  boolean,
  timed_out   boolean not null default false,
  primary key (attempt_id, question_id)
);
create index if not exists quiz_answers_question_idx on public.quiz_answers(question_id);

-- The personal review deck. Cleared when the player gets it right on a
-- later try (in the deck, or on a retake).
create table if not exists public.quiz_review_items (
  player_id   uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  added_at    timestamptz not null default now(),
  cleared_at  timestamptz,
  primary key (player_id, question_id)
);

-- Re-teach: "cover this at the next practice".
create table if not exists public.practice_cover_items (
  id               uuid primary key default gen_random_uuid(),
  practice_id      uuid not null references public.practices(id) on delete cascade,
  quiz_question_id uuid references public.quiz_questions(id) on delete set null,
  text             text not null,
  done             boolean not null default false,
  added_by         uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists practice_cover_items_practice_idx on public.practice_cover_items(practice_id);

-- ══ 2. Policies ══════════════════════════════════════════════════

alter table public.quizzes                 enable row level security;
alter table public.quiz_questions          enable row level security;
alter table public.quiz_question_options   enable row level security;
alter table public.quiz_answer_keys        enable row level security;
alter table public.quiz_question_assignees enable row level security;
alter table public.quiz_attempts           enable row level security;
alter table public.quiz_answers            enable row level security;
alter table public.quiz_review_items       enable row level security;
alter table public.practice_cover_items    enable row level security;

-- Content: staff read and write (the guards in section 3 limit what a
-- write can do once published).
drop policy if exists "quizzes_staff_all" on public.quizzes;
create policy "quizzes_staff_all" on public.quizzes
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- Players may list published quizzes (title, settings -- nothing secret).
drop policy if exists "quizzes_players_read_published" on public.quizzes;
create policy "quizzes_players_read_published" on public.quizzes
  for select using (status = 'published');

drop policy if exists "quiz_questions_staff_all" on public.quiz_questions;
create policy "quiz_questions_staff_all" on public.quiz_questions
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "quiz_options_staff_all" on public.quiz_question_options;
create policy "quiz_options_staff_all" on public.quiz_question_options
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "quiz_keys_staff_all" on public.quiz_answer_keys;
create policy "quiz_keys_staff_all" on public.quiz_answer_keys
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy if exists "quiz_assignees_staff_all" on public.quiz_question_assignees;
create policy "quiz_assignees_staff_all" on public.quiz_question_assignees
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- Results: staff READ only. Nobody -- staff included -- writes these
-- directly; only the functions below do.
drop policy if exists "quiz_attempts_staff_read" on public.quiz_attempts;
create policy "quiz_attempts_staff_read" on public.quiz_attempts
  for select using (public.is_staff(auth.uid()));

-- A player can see their own attempt rows (order, timestamps, and the
-- count once the server has written it at finish).
drop policy if exists "quiz_attempts_own_read" on public.quiz_attempts;
create policy "quiz_attempts_own_read" on public.quiz_attempts
  for select using (player_id = auth.uid());

drop policy if exists "quiz_answers_staff_read" on public.quiz_answers;
create policy "quiz_answers_staff_read" on public.quiz_answers
  for select using (public.is_staff(auth.uid()));

drop policy if exists "quiz_review_staff_read" on public.quiz_review_items;
create policy "quiz_review_staff_read" on public.quiz_review_items
  for select using (public.is_staff(auth.uid()));

drop policy if exists "practice_cover_staff_all" on public.practice_cover_items;
create policy "practice_cover_staff_all" on public.practice_cover_items
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- ══ 3. Published guards ══════════════════════════════════════════
-- A missing parent (the quiz is being deleted and this is the cascade)
-- is allowed through.

create or replace function public.quiz_status_of(p_quiz uuid)
returns text language sql stable security definer set search_path = public
as $$ select status from public.quizzes where id = p_quiz $$;

create or replace function public.quiz_status_of_question(p_question uuid)
returns text language sql stable security definer set search_path = public
as $$ select z.status from public.quiz_questions q join public.quizzes z on z.id = q.quiz_id where q.id = p_question $$;

create or replace function public.quiz_guard_questions()
returns trigger language plpgsql set search_path = public
as $$
declare v_status text;
begin
  if tg_op = 'INSERT' then
    v_status := public.quiz_status_of(new.quiz_id);
    if v_status in ('published', 'archived') then
      raise exception 'This quiz is published. Regenerate to change its questions.';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    v_status := public.quiz_status_of(old.quiz_id);
    if v_status in ('published', 'archived') then
      raise exception 'This quiz is published. Regenerate to remove questions.';
    end if;
    return old;
  else
    v_status := public.quiz_status_of(old.quiz_id);
    if v_status = 'archived' then
      raise exception 'This version is archived and can''t be edited.';
    end if;
    if v_status = 'published' and (to_jsonb(new) - 'prompt') <> (to_jsonb(old) - 'prompt') then
      raise exception 'Only the wording can change on a published quiz.';
    end if;
    return new;
  end if;
end $$;

drop trigger if exists quiz_guard_questions on public.quiz_questions;
create trigger quiz_guard_questions before insert or update or delete on public.quiz_questions
  for each row execute function public.quiz_guard_questions();

create or replace function public.quiz_guard_options()
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
    if v_status = 'published' and (to_jsonb(new) - 'label') <> (to_jsonb(old) - 'label') then
      raise exception 'Only the wording can change on a published quiz.';
    end if;
    return new;
  end if;
  if v_status in ('published', 'archived') then
    raise exception 'This quiz is published. Regenerate to change its answers.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists quiz_guard_options on public.quiz_question_options;
create trigger quiz_guard_options before insert or update or delete on public.quiz_question_options
  for each row execute function public.quiz_guard_options();

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
  -- The correct option must belong to the same question.
  if tg_op <> 'DELETE' then
    if not exists (
      select 1 from public.quiz_question_options o
      where o.id = new.correct_option_id and o.question_id = new.question_id
    ) then
      raise exception 'The correct answer has to be one of this question''s options.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists quiz_guard_keys on public.quiz_answer_keys;
create trigger quiz_guard_keys before insert or update or delete on public.quiz_answer_keys
  for each row execute function public.quiz_guard_keys();

create or replace function public.quiz_guard_assignees()
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
  if v_status in ('published', 'archived') then
    raise exception 'Assignments are frozen once a quiz is published. Regenerate to change them.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists quiz_guard_assignees on public.quiz_question_assignees;
create trigger quiz_guard_assignees before insert or update or delete on public.quiz_question_assignees
  for each row execute function public.quiz_guard_assignees();

-- Status only moves forward: draft -> published -> archived. Publishing
-- validates the question set. Settings can still be changed while live.
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
      if exists (
        select 1 from public.quiz_questions q
        where q.quiz_id = new.id
          and (not exists (select 1 from public.quiz_answer_keys k where k.question_id = q.id)
               or (select count(*) from public.quiz_question_options o where o.question_id = q.id) < 2)
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

drop trigger if exists quiz_guard_status on public.quizzes;
create trigger quiz_guard_status before update on public.quizzes
  for each row execute function public.quiz_guard_status();

-- New quizzes always start as drafts.
create or replace function public.quiz_guard_insert()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.status <> 'draft' then
    raise exception 'New quizzes start as drafts.';
  end if;
  return new;
end $$;

drop trigger if exists quiz_guard_insert on public.quizzes;
create trigger quiz_guard_insert before insert on public.quizzes
  for each row execute function public.quiz_guard_insert();

-- ══ 4. Player functions ══════════════════════════════════════════

-- Is this player on the quiz's game roster (home roster or called up)?
-- A game with no roster set means every player.
create or replace function public.quiz_on_game_roster(p_quiz uuid, p_player uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.quizzes z
    join public.profiles p on p.id = p_player and p.role = 'player'
    left join public.games g on g.id = z.game_id
    where z.id = p_quiz
      and (g.roster_id is null
           or p.home_roster_id = g.roster_id
           or exists (select 1 from public.game_call_ups c where c.game_id = g.id and c.player_id = p_player))
  )
$$;

-- The questions this player gets, in coach order: everything unassigned
-- (if they're on the roster) plus anything assigned to them by name.
create or replace function public.quiz_question_ids_for(p_quiz uuid, p_player uuid)
returns uuid[] language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(q.id order by q.sort_order, q.created_at), '{}')
  from public.quiz_questions q
  where q.quiz_id = p_quiz
    and (
      exists (select 1 from public.quiz_question_assignees a where a.question_id = q.id and a.player_id = p_player)
      or (not exists (select 1 from public.quiz_question_assignees a where a.question_id = q.id)
          and public.quiz_on_game_roster(p_quiz, p_player))
    )
$$;

-- Builds the client payload for one question with options in this
-- attempt's order. Never includes the answer.
create or replace function public.quiz_question_payload(p_question uuid, p_order jsonb)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'question_id', q.id,
    'prompt', q.prompt,
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

-- Published quizzes this player has questions in, with their attempts.
create or replace function public.my_quizzes()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  return coalesce((
    select jsonb_agg(item order by (item->>'game_date') desc nulls last)
    from (
      select jsonb_build_object(
        'quiz_id', z.id,
        'title', z.title,
        'scout_sheet_id', z.scout_sheet_id,
        'game_id', z.game_id,
        'game_date', g.game_date,
        'tip_time', g.tip_time,
        'opponent', g.opponent,
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

  -- First attempt: the coach's order. Retakes: shuffled.
  if v_done = 0 then
    v_order := v_qs;
  else
    select array_agg(x order by random()) into v_order from unnest(v_qs) x;
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

-- Serves the next unanswered question. Re-asking returns the SAME
-- question with the SAME start time, so refreshing can't reset a timer
-- or skip ahead.
create or replace function public.quiz_next_question(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  a        public.quiz_attempts%rowtype;
  z        public.quizzes%rowtype;
  v_q      uuid;
  v_idx    int;
  v_served timestamptz;
begin
  select * into a from public.quiz_attempts where id = p_attempt and player_id = v_uid;
  if not found then raise exception 'Attempt not found'; end if;
  select * into z from public.quizzes where id = a.quiz_id;
  if a.submitted_at is not null then
    return jsonb_build_object('done', true, 'feedback_mode', z.feedback_mode);
  end if;

  select t.q, t.i::int into v_q, v_idx
  from unnest(a.question_order) with ordinality t(q, i)
  where not exists (
    select 1 from public.quiz_answers x
    where x.attempt_id = a.id and x.question_id = t.q and x.answered_at is not null
  )
  order by t.i
  limit 1;

  if v_q is null then
    -- Nothing left (shouldn't normally happen -- the last answer finishes).
    update public.quiz_attempts
       set submitted_at = now(),
           correct_count = (select count(*) from public.quiz_answers where attempt_id = a.id and is_correct)
     where id = a.id and submitted_at is null;
    return jsonb_build_object('done', true, 'feedback_mode', z.feedback_mode);
  end if;

  insert into public.quiz_answers (attempt_id, question_id, served_at)
  values (a.id, v_q, now())
  on conflict (attempt_id, question_id) do nothing;
  select served_at into v_served from public.quiz_answers where attempt_id = a.id and question_id = v_q;

  return public.quiz_question_payload(v_q, a.option_order -> (v_q::text)) || jsonb_build_object(
    'done', false,
    'index', v_idx,
    'total', array_length(a.question_order, 1),
    'feedback_mode', z.feedback_mode,
    'time_limit', z.time_limit_seconds,
    'remaining', case when z.time_limit_seconds is null then null
                      else greatest(0, z.time_limit_seconds - floor(extract(epoch from now() - v_served)))::int end
  );
end $$;

-- Grades and locks one answer. p_option null = no answer (time ran out).
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
     and now() > v_row.served_at + make_interval(secs => z.time_limit_seconds + 2) then
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
    v_result := v_result || jsonb_build_object('correct', v_ok, 'correct_option_id', v_correct, 'explanation', v_expl);
  end if;
  return v_result;
end $$;

-- The full key for a FINISHED attempt. Owner or staff.
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

-- Review deck ────────────────────────────────────────────────────

create or replace function public.review_deck_count()
returns int language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.quiz_review_items r
  join public.quiz_questions q on q.id = r.question_id
  where r.player_id = auth.uid() and r.cleared_at is null
$$;

-- A random open item (not the one just answered, when there's a choice).
create or replace function public.review_deck_next(p_exclude uuid default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
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
                            'remaining', public.review_deck_count());
end $$;

-- ══ 5. Staff functions ═══════════════════════════════════════════

-- Who "everyone" means for this quiz right now (for the results screen).
create or replace function public.quiz_roster(p_quiz uuid)
returns setof uuid language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff(auth.uid()) then raise exception 'Coaches only'; end if;
  return query
    select p.id from public.profiles p
    where p.role = 'player' and public.quiz_on_game_roster(p_quiz, p.id);
end $$;

-- Publishes a draft and retires the previous live version of the same
-- sheet in one step. Validation lives in the status guard.
create or replace function public.publish_quiz(p_quiz uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_sheet uuid;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Coaches only'; end if;
  select scout_sheet_id into v_sheet from public.quizzes where id = p_quiz and status = 'draft';
  if not found then raise exception 'Only a draft can be published.'; end if;
  if v_sheet is not null then
    update public.quizzes set status = 'archived'
     where scout_sheet_id = v_sheet and status = 'published' and id <> p_quiz;
  end if;
  update public.quizzes set status = 'published' where id = p_quiz;
end $$;

-- ══ Grants ═══════════════════════════════════════════════════════
-- Internal helpers: nobody calls these directly.
-- quiz_status_of / quiz_status_of_question stay callable by signed-in
-- users: the guard triggers run as the coach making the edit and call
-- them, so revoking them would block every staff write. They only
-- return a status word.
revoke all on function public.quiz_status_of(uuid)                  from public, anon;
revoke all on function public.quiz_status_of_question(uuid)         from public, anon;
grant execute on function public.quiz_status_of(uuid)                 to authenticated;
grant execute on function public.quiz_status_of_question(uuid)        to authenticated;
revoke all on function public.quiz_on_game_roster(uuid, uuid)       from public, anon, authenticated;
revoke all on function public.quiz_question_ids_for(uuid, uuid)     from public, anon, authenticated;
revoke all on function public.quiz_question_payload(uuid, jsonb)    from public, anon, authenticated;
revoke all on function public.quiz_guard_questions()                from public, anon, authenticated;
revoke all on function public.quiz_guard_options()                  from public, anon, authenticated;
revoke all on function public.quiz_guard_keys()                     from public, anon, authenticated;
revoke all on function public.quiz_guard_assignees()                from public, anon, authenticated;
revoke all on function public.quiz_guard_status()                   from public, anon, authenticated;
revoke all on function public.quiz_guard_insert()                   from public, anon, authenticated;

-- Signed-in only. Each one checks the caller itself.
revoke all on function public.my_quizzes()                          from public, anon;
revoke all on function public.start_quiz_attempt(uuid)              from public, anon;
revoke all on function public.quiz_next_question(uuid)              from public, anon;
revoke all on function public.quiz_submit_answer(uuid, uuid, uuid)  from public, anon;
revoke all on function public.quiz_attempt_review(uuid)             from public, anon;
revoke all on function public.review_deck_count()                   from public, anon;
revoke all on function public.review_deck_next(uuid)                from public, anon;
revoke all on function public.review_deck_answer(uuid, uuid)        from public, anon;
revoke all on function public.quiz_roster(uuid)                     from public, anon;
revoke all on function public.publish_quiz(uuid)                    from public, anon;
grant execute on function public.my_quizzes()                         to authenticated;
grant execute on function public.start_quiz_attempt(uuid)             to authenticated;
grant execute on function public.quiz_next_question(uuid)             to authenticated;
grant execute on function public.quiz_submit_answer(uuid, uuid, uuid) to authenticated;
grant execute on function public.quiz_attempt_review(uuid)            to authenticated;
grant execute on function public.review_deck_count()                  to authenticated;
grant execute on function public.review_deck_next(uuid)               to authenticated;
grant execute on function public.review_deck_answer(uuid, uuid)       to authenticated;
grant execute on function public.quiz_roster(uuid)                    to authenticated;
grant execute on function public.publish_quiz(uuid)                   to authenticated;
