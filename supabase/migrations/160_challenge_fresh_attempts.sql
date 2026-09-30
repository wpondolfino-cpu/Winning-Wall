-- 160_challenge_fresh_attempts.sql
--
-- Challenges are about doing the drill against someone, not comparing
-- all-time bests.
--
--   1. Each logged attempt can back ONE challenge. Once a score has been
--      sent or used to answer a challenge it's spent; the next challenge
--      on that drill needs a fresh attempt. (Unused scores from the last
--      24 hours can still be sent without redoing the drill.)
--   2. Pending scores are really hidden. The screen said "scores hidden
--      until both players submit", but the challenger's score sat in the
--      challenge row where the opponent could read it through the
--      database. It now waits in a private table only the challenger (and
--      coaches) can read, and moves into the challenge when it's answered
--      or expires.

-- ══ 1. Which attempt backs which side ════════════════════════════
alter table public.challenges add column if not exists challenger_attempt_id uuid references public.score_attempts(id) on delete set null;
alter table public.challenges add column if not exists opponent_attempt_id   uuid references public.score_attempts(id) on delete set null;
create index if not exists challenges_challenger_attempt_idx on public.challenges(challenger_attempt_id);
create index if not exists challenges_opponent_attempt_idx on public.challenges(opponent_attempt_id);

-- A pending challenge has no visible challenger score now.
alter table public.challenges alter column challenger_score drop not null;

-- ══ 2. The private waiting room for pending scores ═══════════════
create table if not exists public.challenge_pending_scores (
  challenge_id  uuid primary key references public.challenges(id) on delete cascade,
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  score         numeric not null,
  tiebreak      numeric
);
alter table public.challenge_pending_scores enable row level security;
drop policy if exists "pending_scores_own" on public.challenge_pending_scores;
create policy "pending_scores_own" on public.challenge_pending_scores
  for select using (challenger_id = auth.uid() or public.is_staff(auth.uid()));
-- No write policies: only the challenge functions write.

-- Challenges already waiting: move their scores out of sight.
insert into public.challenge_pending_scores (challenge_id, challenger_id, score, tiebreak)
select id, challenger_id, challenger_score, challenger_tiebreak
  from public.challenges
 where status = 'pending' and challenger_score is not null
on conflict (challenge_id) do nothing;
update public.challenges set challenger_score = null, challenger_tiebreak = null
 where status = 'pending';

-- ══ 3. My unused score from the last 24 hours ════════════════════
create or replace function public.my_recent_challenge_score(p_workout_id uuid)
returns table (attempt_id uuid, score numeric, tiebreak numeric, attempted_at timestamptz)
language sql stable security definer
set search_path = public, extensions
as $$
  select a.id, public._challenge_value(a.made, a.reps, a.self_points), a.tiebreak_value, a.attempted_at
    from public.score_attempts a
    join public.workouts w on w.id = a.workout_id
   where a.player_id = auth.uid() and a.workout_id = p_workout_id
     and a.attempted_at >= now() - interval '24 hours'
     and public._challenge_value(a.made, a.reps, a.self_points) > 0
     and not exists (select 1 from public.challenges c
                      where c.challenger_attempt_id = a.id or c.opponent_attempt_id = a.id)
   order by public._challenge_value(a.made, a.reps, a.self_points)
            * case when coalesce(w.lower_is_better, false) then -1 else 1 end desc
   limit 1
$$;

-- ══ 4. Sending ═══════════════════════════════════════════════════
-- With a score: logged like any drill, and that attempt is the one sent.
-- Without: my best UNUSED attempt from the last 24 hours (error P0002 if
-- there isn't one, so the app asks for a score).
create or replace function public.send_challenge(p_opponent uuid, p_workout_id uuid,
  p_score integer default null, p_tiebreak numeric default null, p_rematch_of uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  w public.workouts%rowtype;
  v_blocked text;
  v_attempt uuid;
  v_score numeric;
  v_tb numeric;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if coalesce((select total_xp from public.profiles where id = v_me), 0) < public.challenge_xp_threshold() then
    raise exception 'Challenges unlock at % XP.', public.challenge_xp_threshold() using errcode = '42501';
  end if;
  select * into w from public.workouts where id = p_workout_id;
  if not found or coalesce(w.is_active, true) = false or w.scoring_type not in ('competitive', 'multi_spot') then
    raise exception 'That drill can''t be used for a challenge.';
  end if;
  v_blocked := public._challenge_blocked(v_me, p_opponent);
  if v_blocked is not null then raise exception '%', v_blocked; end if;
  if exists (select 1 from public.challenges where challenger_id = v_me and opponent_id = p_opponent
              and workout_id = p_workout_id and status = 'pending') then
    raise exception 'You already have a challenge waiting with them on this drill.';
  end if;

  if p_score is not null then
    if p_score <= 0 then raise exception 'Please enter a valid score.'; end if;
    perform public.log_workout(p_workout_id, p_score, 0, 0, 0, p_tiebreak, null);
    select id into v_attempt from public.score_attempts
     where player_id = v_me and workout_id = p_workout_id order by attempted_at desc limit 1;
    v_score := p_score;
    v_tb := p_tiebreak;
  else
    select r.attempt_id, r.score, r.tiebreak into v_attempt, v_score, v_tb
      from public.my_recent_challenge_score(p_workout_id) r;
    if v_attempt is null then
      raise exception 'Do the drill and enter a fresh score for this challenge.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.challenges (challenger_id, challenger_name, opponent_id, opponent_name,
                                 workout_id, workout_title, challenger_score, opponent_score,
                                 challenger_tiebreak, status, opponent_seen, winner_id, challenger_attempt_id)
  values (v_me, (select name from public.profiles where id = v_me),
          p_opponent, (select name from public.profiles where id = p_opponent),
          p_workout_id, w.title, null, null, null, 'pending', false, null, v_attempt)
  returning id into v_id;

  insert into public.challenge_pending_scores (challenge_id, challenger_id, score, tiebreak)
  values (v_id, v_me, v_score, v_tb);
  return v_id;
end;
$$;

-- ══ 5. Answering: reveal both, decide, pay out ═══════════════════
create or replace function public.respond_challenge(p_challenge_id uuid, p_score integer, p_tiebreak numeric default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  c public.challenges%rowtype;
  w public.workouts%rowtype;
  ps public.challenge_pending_scores%rowtype;
  v_attempt uuid;
  v_winner uuid;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'That challenge no longer exists.'; end if;
  if c.opponent_id <> v_me then raise exception 'Only the challenged player can respond.' using errcode = '42501'; end if;
  if c.status <> 'pending' then raise exception 'This challenge is already finished.'; end if;
  if coalesce(p_score, 0) < 0 then raise exception 'Please enter a valid score.'; end if;

  select * into ps from public.challenge_pending_scores where challenge_id = c.id;
  select * into w from public.workouts where id = c.workout_id;
  if coalesce(p_score, 0) > 0 then
    perform public.log_workout(c.workout_id, p_score, 0, 0, 0, p_tiebreak, null);
    select id into v_attempt from public.score_attempts
     where player_id = v_me and workout_id = c.workout_id order by attempted_at desc limit 1;
  end if;

  v_winner := public._challenge_winner(w, c.challenger_id, c.opponent_id,
                                       coalesce(ps.score, c.challenger_score, 0), coalesce(p_score, 0),
                                       coalesce(ps.tiebreak, c.challenger_tiebreak), p_tiebreak);
  update public.challenges
     set challenger_score = coalesce(ps.score, challenger_score),
         challenger_tiebreak = coalesce(ps.tiebreak, challenger_tiebreak),
         opponent_score = coalesce(p_score, 0), opponent_tiebreak = p_tiebreak,
         opponent_attempt_id = v_attempt,
         status = 'completed', winner_id = v_winner
   where id = c.id;
  delete from public.challenge_pending_scores where challenge_id = c.id;

  if v_winner is not null then
    insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason, challenge_id)
    values (v_winner, 1, 0, now(), 'challenge_win', c.id)
    on conflict do nothing;
  end if;
  perform public._award_xp(c.challenger_id, '_xp_challenge_sent', 2, 'challenge_sent');
  perform public._award_xp(c.opponent_id, '_xp_challenge_done', 3, 'challenge_done');

  return jsonb_build_object('winner_id', v_winner);
end;
$$;

-- ══ 6. Expiry reveals the challenger's score too ═════════════════
create or replace function public.expire_challenges()
returns table (challenge_id uuid, challenger_id uuid, opponent_id uuid, workout_title text,
               challenger_name text, opponent_name text)
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return query
  with expired as (
    update public.challenges ch
       set status = 'completed', winner_id = ch.challenger_id, opponent_score = -1,
           challenger_score = coalesce((select ps.score from public.challenge_pending_scores ps where ps.challenge_id = ch.id), ch.challenger_score),
           challenger_tiebreak = coalesce((select ps.tiebreak from public.challenge_pending_scores ps where ps.challenge_id = ch.id), ch.challenger_tiebreak)
     where ch.status = 'pending' and ch.created_at < now() - interval '5 days'
    returning ch.id, ch.challenger_id, ch.opponent_id, ch.workout_title, ch.challenger_name, ch.opponent_name
  ), cleared as (
    delete from public.challenge_pending_scores ps using expired e where ps.challenge_id = e.id
    returning 1
  ), bonus as (
    insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason, challenge_id)
    select e.challenger_id, 1, 0, now(), 'challenge_win', e.id from expired e
    on conflict do nothing
    returning 1
  )
  select e.id, e.challenger_id, e.opponent_id, e.workout_title, e.challenger_name, e.opponent_name from expired e;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'my_recent_challenge_score'
  loop
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
end $$;
