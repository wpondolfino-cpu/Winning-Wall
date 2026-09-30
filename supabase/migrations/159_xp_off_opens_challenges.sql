-- 159_xp_off_opens_challenges.sql
--
-- When the XP system is switched off (Admin -> XP), nothing is locked
-- behind XP: anyone can challenge anyone active, and both perks are
-- available -- the same as the app shows. Phase 2 and 3 (157/158) checked
-- the XP thresholds on the server without looking at the switch, so with
-- XP off, players under 150 XP still couldn't challenge or be challenged.
--
-- XP is still awarded while the switch is off (as before), so turning it
-- back on picks up where everyone actually is.

-- The switch lives in xp_settings as '_xp_enabled' (1 = on, 0 = off).
create or replace function public.xp_system_on()
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$ select coalesce((select xp_required from public.xp_settings where perk_key = '_xp_enabled'), 1) <> 0 $$;

-- XP needed to challenge / be challenged: 0 while XP is off.
create or replace function public.challenge_xp_threshold()
returns integer
language sql stable security definer
set search_path = public, extensions
as $$
  select case when public.xp_system_on()
              then coalesce((select xp_required from public.xp_settings where perk_key = 'challenges_unlocked'), 150)
              else 0 end
$$;

create or replace function public._challenge_blocked(p_from uuid, p_to uuid)
returns text
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  t public.profiles%rowtype;
  v_days int := case when (select value from public.app_settings where key = 'season_mode') = 'inseason' then 7 else 14 end;
  v_threshold int := public.challenge_xp_threshold();
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

create or replace function public.challenge_opponents()
returns table (player_id uuid, name text, available boolean, reason text)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.id, p.name, public._challenge_blocked(auth.uid(), p.id) is null, public._challenge_blocked(auth.uid(), p.id)
    from public.profiles p
   where p.role = 'player' and p.id <> auth.uid()
     and coalesce(p.total_xp, 0) >= public.challenge_xp_threshold()
   order by p.name
$$;

create or replace function public.send_challenge(p_opponent uuid, p_workout_id uuid,
  p_score integer default null, p_tiebreak numeric default null, p_rematch_of uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  v_threshold int := public.challenge_xp_threshold();
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

create or replace function public._perk_ready(p_perk text)
returns table (competition_id uuid, period_key date)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := auth.uid();
  c record;
  v_needed int;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select id, starts_at into c from public.competitions where starts_at <= now() and ends_at > now() limit 1;
  if not found then raise exception 'No competition is running right now.'; end if;
  if public.xp_system_on() then
    select xp_required into v_needed from public.xp_settings where perk_key = p_perk;
  end if;
  if v_needed is not null and coalesce((select total_xp from public.profiles where id = v_me), 0) < v_needed then
    raise exception 'You unlock this perk at % XP.', v_needed using errcode = '42501';
  end if;
  if exists (select 1 from public.perk_usage where player_id = v_me and perk_key = p_perk
              and period_start = (c.starts_at at time zone 'UTC')::date) then
    raise exception 'Already used this competition.';
  end if;
  return query select c.id, (c.starts_at at time zone 'UTC')::date;
end;
$$;
