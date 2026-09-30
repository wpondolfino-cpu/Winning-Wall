-- 157_challenges_server.sql
--
-- Option B, Phase 2: head-to-head challenges run on the server.
--
-- Players type their own scores (honor system, as with drills). Everything
-- after that is decided here: who can be challenged, who won, the +1 win
-- bonus, XP, and expiry.
--
--   * Only active players can be challenged: seen in the last 14 days
--     (7 in-season), the same rule as the inactivity nudges.
--   * Unanswered for 5 days: the challenger wins by default (+1, no XP) --
--     and can't challenge that player again until they challenge back.
--   * XP only for completed challenges, for both players.
--   * Then: challenges, bonus points and XP are locked to server writes.
--     (Still open until Phase 3: score rows and streaks, for the perks.)

-- ══ 1. Profile guard: know when it's the app vs. the server ══════
-- The guard (migration 150) ran with elevated rights, so it couldn't tell
-- a player's own request from one of our server functions acting for
-- them. Running it with the caller's rights, current_user says which:
-- 'authenticated' = straight from a browser; anything else = a server
-- function, the SQL editor or sign-up, which are trusted.
-- XP joins the protected columns: only the server awards it now.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  uid   uuid := auth.uid();
  staff boolean;
  admin boolean;
  o jsonb;
  n jsonb;
  col text;
begin
  if uid is null or current_user not in ('authenticated', 'anon') then return new; end if;
  staff := public.is_staff(uid);
  admin := public.is_admin(uid);

  if new.role is distinct from old.role then
    if new.id = uid then
      if not (old.role = 'player' and new.role = 'inactive') then
        raise exception 'You can''t change your own role' using errcode = '42501';
      end if;
    elsif not staff then
      raise exception 'Only coaches can change roles' using errcode = '42501';
    elsif not admin and (new.role in ('coach', 'admin') or old.role in ('coach', 'admin')) then
      raise exception 'Only an admin can make or change coaches' using errcode = '42501';
    end if;
  end if;

  if not staff then
    o := to_jsonb(old);
    n := to_jsonb(new);
    foreach col in array array['is_period_champion', 'champion_since', 'home_roster_id', 'jersey',
                               'team_id', 'team_wins', 'graduation_year', 'grade_category', 'total_xp'] loop
      if (n -> col) is distinct from (o -> col) then
        raise exception 'Only coaches can change %', col using errcode = '42501';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

-- ══ 2. Helpers ═══════════════════════════════════════════════════
create or replace function public._award_xp(p_player uuid, p_key text, p_default int, p_reason text)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_amount int;
begin
  select coalesce((select xp_required from public.xp_settings where perk_key = p_key), p_default) into v_amount;
  if v_amount <= 0 then return 0; end if;
  insert into public.xp_log (player_id, xp_amount, reason) values (p_player, v_amount, p_reason);
  update public.profiles set total_xp = coalesce(total_xp, 0) + v_amount where id = p_player;
  return v_amount;
end;
$$;

-- The score a challenge compares: typed points, or made + reps.
create or replace function public._challenge_value(p_made numeric, p_reps numeric, p_self numeric)
returns numeric language sql immutable
as $$ select case when coalesce(p_self, 0) > 0 then p_self else coalesce(p_made, 0) + coalesce(p_reps, 0) end $$;

-- Same rules as the app's decideChallengeWinner: score first (respecting
-- lower-is-better), then the drill's tiebreak; having a tiebreak beats
-- not having one; otherwise a tie (null).
create or replace function public._challenge_winner(w public.workouts, p_challenger uuid, p_opponent uuid,
  p_c numeric, p_o numeric, p_ctb numeric, p_otb numeric)
returns uuid language plpgsql immutable
as $$
declare
  lower_wins boolean := coalesce(w.lower_is_better, false);
  tie_lower boolean;
begin
  if (lower_wins and p_c < p_o) or (not lower_wins and p_c > p_o) then return p_challenger; end if;
  if (lower_wins and p_o < p_c) or (not lower_wins and p_o > p_c) then return p_opponent; end if;
  if w.tiebreak_mode is null then return null; end if;
  if p_ctb is not null and p_otb is null then return p_challenger; end if;
  if p_otb is not null and p_ctb is null then return p_opponent; end if;
  if p_ctb is null or p_otb is null then return null; end if;
  tie_lower := case w.tiebreak_mode when 'fastest_time' then true when 'spot' then lower_wins else false end;
  if (tie_lower and p_ctb < p_otb) or (not tie_lower and p_ctb > p_otb) then return p_challenger; end if;
  if (tie_lower and p_otb < p_ctb) or (not tie_lower and p_otb > p_ctb) then return p_opponent; end if;
  return null;
end;
$$;

-- Why p_from can't challenge p_to right now (null = they can).
create or replace function public._challenge_blocked(p_from uuid, p_to uuid)
returns text
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  t public.profiles%rowtype;
  v_days int := case when (select value from public.app_settings where key = 'season_mode') = 'inseason' then 7 else 14 end;
  v_threshold int := coalesce((select xp_required from public.xp_settings where perk_key = 'challenges_unlocked'), 150);
  v_last_default timestamptz;
begin
  if p_from = p_to then return 'You can''t challenge yourself.'; end if;
  select * into t from public.profiles where id = p_to;
  if not found or t.role <> 'player' then return 'That player can''t be challenged.'; end if;
  if coalesce(t.total_xp, 0) < v_threshold then return t.name || ' hasn''t unlocked challenges yet.'; end if;
  if coalesce(t.last_seen_at, t.created_at) < now() - make_interval(days => v_days) then
    return t.name || ' hasn''t been on the app lately.';
  end if;
  -- One default win per matchup until they challenge back.
  select max(created_at) into v_last_default from public.challenges
   where challenger_id = p_from and opponent_id = p_to and opponent_score = -1;
  if v_last_default is not null and not exists (
    select 1 from public.challenges where challenger_id = p_to and opponent_id = p_from and created_at > v_last_default
  ) then
    return 'Waiting for ' || t.name || ' to challenge you back.';
  end if;
  return null;
end;
$$;

-- ══ 3. What the app calls ════════════════════════════════════════
-- Everyone who has unlocked challenges, with whether I can challenge them.
create or replace function public.challenge_opponents()
returns table (player_id uuid, name text, available boolean, reason text)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.id, p.name, public._challenge_blocked(auth.uid(), p.id) is null, public._challenge_blocked(auth.uid(), p.id)
    from public.profiles p
   where p.role = 'player' and p.id <> auth.uid()
     and coalesce(p.total_xp, 0) >= coalesce((select xp_required from public.xp_settings where perk_key = 'challenges_unlocked'), 150)
   order by p.name
$$;

-- Send a challenge. With a score: it's logged like any drill first. Without
-- one: my best on this drill from the last 24 hours is used (error if none).
create or replace function public.send_challenge(p_opponent uuid, p_workout_id uuid,
  p_score integer default null, p_tiebreak numeric default null, p_rematch_of uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  v_threshold int := coalesce((select xp_required from public.xp_settings where perk_key = 'challenges_unlocked'), 150);
  w public.workouts%rowtype;
  v_blocked text;
  v_score numeric;
  v_tb numeric;
  v_dir int;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if coalesce((select total_xp from public.profiles where id = v_me), 0) < v_threshold then
    raise exception 'Challenges unlock at % XP.', v_threshold using errcode = '42501';
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
    v_score := p_score;
    v_tb := p_tiebreak;
  else
    v_dir := case when coalesce(w.lower_is_better, false) then -1 else 1 end;
    select public._challenge_value(a.made, a.reps, a.self_points), a.tiebreak_value into v_score, v_tb
      from public.score_attempts a
     where a.player_id = v_me and a.workout_id = p_workout_id and a.attempted_at >= now() - interval '24 hours'
     order by public._challenge_value(a.made, a.reps, a.self_points) * v_dir desc
     limit 1;
    if v_score is null or v_score = 0 then
      raise exception 'Log this drill in the last 24 hours first.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.challenges (challenger_id, challenger_name, opponent_id, opponent_name,
                                 workout_id, workout_title, challenger_score, opponent_score,
                                 challenger_tiebreak, status, opponent_seen, winner_id)
  values (v_me, (select name from public.profiles where id = v_me),
          p_opponent, (select name from public.profiles where id = p_opponent),
          p_workout_id, w.title, v_score, null, v_tb, 'pending', false, null)
  returning id into v_id;
  return v_id;
end;
$$;

-- Respond with a score: logged like any drill, winner decided here, +1
-- win bonus once, XP to both players.
create or replace function public.respond_challenge(p_challenge_id uuid, p_score integer, p_tiebreak numeric default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  c public.challenges%rowtype;
  w public.workouts%rowtype;
  v_winner uuid;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'That challenge no longer exists.'; end if;
  if c.opponent_id <> v_me then raise exception 'Only the challenged player can respond.' using errcode = '42501'; end if;
  if c.status <> 'pending' then raise exception 'This challenge is already finished.'; end if;
  if coalesce(p_score, 0) < 0 then raise exception 'Please enter a valid score.'; end if;

  select * into w from public.workouts where id = c.workout_id;
  if coalesce(p_score, 0) > 0 then
    perform public.log_workout(c.workout_id, p_score, 0, 0, 0, p_tiebreak, null);
  end if;

  v_winner := public._challenge_winner(w, c.challenger_id, c.opponent_id,
                                       c.challenger_score, coalesce(p_score, 0), c.challenger_tiebreak, p_tiebreak);
  update public.challenges
     set opponent_score = coalesce(p_score, 0), opponent_tiebreak = p_tiebreak,
         status = 'completed', winner_id = v_winner
   where id = c.id;

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

create or replace function public.decline_challenge(p_challenge_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  update public.challenges set status = 'declined'
   where id = p_challenge_id and opponent_id = auth.uid() and status = 'pending';
  if not found then raise exception 'That challenge can''t be declined.'; end if;
end;
$$;

create or replace function public.mark_challenges_seen()
returns void
language sql security definer
set search_path = public, extensions
as $$
  update public.challenges set opponent_seen = true
   where opponent_id = auth.uid() and status = 'pending' and not coalesce(opponent_seen, false)
$$;

-- Daily job: 5 days unanswered -> the challenger wins by default (+1, no
-- XP). opponent_score = -1 marks it (the app shows "forfeited").
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
       set status = 'completed', winner_id = ch.challenger_id, opponent_score = -1
     where ch.status = 'pending' and ch.created_at < now() - interval '5 days'
    returning ch.id, ch.challenger_id, ch.opponent_id, ch.workout_title, ch.challenger_name, ch.opponent_name
  ), bonus as (
    insert into public.streak_bonuses (player_id, points, streak_length, awarded_at, reason, challenge_id)
    select e.challenger_id, 1, 0, now(), 'challenge_win', e.id from expired e
    on conflict do nothing
    returning 1
  )
  select e.id, e.challenger_id, e.opponent_id, e.workout_title, e.challenger_name, e.opponent_name from expired e;
end;
$$;

-- ══ 4. Who can call what ═════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'challenge_opponents', 'send_challenge', 'respond_challenge', 'decline_challenge', 'mark_challenges_seen')
  loop
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_award_xp', '_challenge_blocked', 'expire_challenges')
  loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.proname, r.args);
  end loop;
end $$;

-- ══ 5. Locks ═════════════════════════════════════════════════════
-- challenges, streak_bonuses, xp_log: read as before; writes = server
-- functions and coaches only. (Class Clash awards are made by coaches.)
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['challenges', 'streak_bonuses', 'xp_log'] loop
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('drop policy if exists "staff_write" on public.%I', t);
    execute format('create policy "staff_write" on public.%I for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()))', t);
  end loop;
end $$;

-- ══ Check it ═════════════════════════════════════════════════════
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('challenges', 'streak_bonuses', 'xp_log') order by 1, 3;
-- Expect each table's read policies plus "staff_write".
