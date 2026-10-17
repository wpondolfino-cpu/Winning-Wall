-- ============================================================
-- 183_settings_per_program.sql
--
-- MULTI-TENANCY STEP 8a — settings per program.
-- (First of the workouts / scoring / leaderboards group.)
--
-- App settings (season mode, time zone, when scoring started, period
-- anchor) and XP settings (XP on/off, XP per action, perk costs) were
-- one shared set for everyone. Now each program has its own:
--   * Girls (and any other program) starts with a copy of Boys'
--     current values, except "scoring started", which starts now for
--     them so Girls' points begin from a clean slate.
--   * Season mode is per program: flipping it in Girls doesn't touch
--     Boys.
--   * The server functions that read these settings read the right
--     program's copy. "Restart scoring season" only clears the program
--     you're in (it used to clear every program's points).
--   * Boys' values are not changed.
--
-- Ships with 3 app files that save these settings: AdminPanel.tsx,
-- xp.ts, seasonMode.ts. Push them right after running this.
--
-- Server jobs (the nightly daily-reminders) still use Boys' settings
-- for now, exactly as today; they are switched to loop over each
-- program in a later step of this group.
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 1. "Which program is this for?" for server functions ──────
-- Signed-in person: the program they're in (Boys fallback, same as
-- new rows today). Server job with no person: the program the job is
-- working on (set per program by the job), else Boys.
create or replace function public.ctx_program_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when auth.uid() is null then
      coalesce(nullif(current_setting('ww.program_id', true), '')::uuid,
               public.legacy_default_program_id())
    else
      coalesce(public.current_program_id(), public.legacy_default_program_id())
  end
$$;


-- ── 2. Keys are per program ───────────────────────────────────
alter table public.app_settings drop constraint if exists app_settings_pkey;
alter table public.app_settings add constraint app_settings_pkey primary key (program_id, key);

alter table public.xp_settings drop constraint if exists xp_settings_perk_key_key;
drop index if exists public.xp_settings_perk_key_key;
create unique index if not exists xp_settings_program_perk_key
  on public.xp_settings (program_id, perk_key);


-- ── 3. Every other program gets a copy of Boys' settings ──────
insert into public.app_settings (program_id, key, value, updated_at)
select p.id, s.key,
       case when s.key = 'scoring_started_at' then now()::text else s.value end,
       now()
  from public.programs p
  cross join public.app_settings s
 where s.program_id = public.legacy_default_program_id()
   and p.id <> public.legacy_default_program_id()
on conflict (program_id, key) do nothing;

-- A program with no "scoring started" yet starts now.
insert into public.app_settings (program_id, key, value, updated_at)
select p.id, 'scoring_started_at', now()::text, now()
  from public.programs p
 where p.id <> public.legacy_default_program_id()
on conflict (program_id, key) do nothing;

insert into public.xp_settings (program_id, perk_key, perk_name, xp_required, description, updated_at)
select p.id, s.perk_key, s.perk_name, s.xp_required, s.description, now()
  from public.programs p
  cross join public.xp_settings s
 where s.program_id = public.legacy_default_program_id()
   and p.id <> public.legacy_default_program_id()
on conflict (program_id, perk_key) do nothing;


-- ── 4. The program fence ──────────────────────────────────────
select public.add_program_scope(t) from unnest(array[
  'app_settings',
  'xp_settings'
]) as t;


-- ── 5. Server functions read their program's settings ─────────
create or replace function public.app_timezone()
 returns text
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  select coalesce((select value from public.app_settings
                    where key = 'timezone' and program_id = public.ctx_program_id()),
                  'America/New_York')
$function$;

create or replace function public.scoring_started_at()
 returns timestamp with time zone
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  select (select value from public.app_settings
           where key = 'scoring_started_at' and program_id = public.ctx_program_id())::timestamptz
$function$;

create or replace function public.xp_system_on()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  select coalesce((select xp_required from public.xp_settings
                    where perk_key = '_xp_enabled' and program_id = public.ctx_program_id()), 1) <> 0
$function$;

create or replace function public.challenge_xp_threshold()
 returns integer
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  select case when public.xp_system_on()
              then coalesce((select xp_required from public.xp_settings
                              where perk_key = 'challenges_unlocked' and program_id = public.ctx_program_id()), 150)
              else 0 end
$function$;

create or replace function public.competition_default_scoring()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when (select value from public.app_settings
                     where key = 'season_mode' and program_id = public.ctx_program_id()) = 'inseason'
              then 'practice_wins' else 'points' end
$function$;

create or replace function public._award_xp(p_player uuid, p_key text, p_default integer, p_reason text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_amount int;
begin
  select coalesce((select xp_required from public.xp_settings
                    where perk_key = p_key and program_id = public.ctx_program_id()), p_default) into v_amount;
  if v_amount <= 0 then return 0; end if;
  insert into public.xp_log (player_id, xp_amount, reason) values (p_player, v_amount, p_reason);
  update public.profiles set total_xp = coalesce(total_xp, 0) + v_amount where id = p_player;
  return v_amount;
end;
$function$;

create or replace function public._scoring_xp(p_player uuid, p_workout uuid, p_reason text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_today_count int;
  v_amount int;
begin
  -- Counted after this log's entry is written, so <= 3 means first three.
  select count(*) into v_today_count from public.score_attempts
   where player_id = p_player and workout_id = p_workout and public.app_date(attempted_at) = public.app_date();
  if v_today_count > 3 then return 0; end if;
  select coalesce((select xp_required from public.xp_settings
                    where perk_key = '_xp_workout' and program_id = public.ctx_program_id()), 10) into v_amount;
  insert into public.xp_log (player_id, xp_amount, reason) values (p_player, v_amount, p_reason);
  update public.profiles set total_xp = coalesce(total_xp, 0) + v_amount where id = p_player;
  return v_amount;
end;
$function$;

create or replace function public._perk_ready(p_perk text)
 returns table(competition_id uuid, period_key date)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_me uuid := auth.uid();
  c record;
  v_needed int;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select id, starts_at into c from public.competitions where starts_at <= now() and ends_at > now() limit 1;
  if not found then raise exception 'No competition is running right now.'; end if;
  if public.xp_system_on() then
    select xp_required into v_needed from public.xp_settings
     where perk_key = p_perk and program_id = public.ctx_program_id();
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
$function$;

create or replace function public._challenge_blocked(p_from uuid, p_to uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  t public.profiles%rowtype;
  v_days int := case when (select value from public.app_settings
                            where key = 'season_mode' and program_id = public.ctx_program_id()) = 'inseason'
                     then 7 else 14 end;
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
$function$;

create or replace function public.inactivity_nudges_due()
 returns table(player_id uuid, days_inactive integer, stage integer, nudge_days integer, mode text)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  with cfg as (
    select coalesce((select value from public.app_settings
                      where key = 'season_mode' and program_id = public.ctx_program_id()), 'offseason') as mode
  ), cfg2 as (
    select mode, case when mode = 'inseason' then 7 else 14 end as n from cfg
  ), players as (
    select p.id, coalesce(p.last_seen_at, p.created_at) as seen
      from public.profiles p
     where p.role = 'player'
       and coalesce(p.grade_category, '') <> 'Alumni'
       and not (p.graduation_year is not null and p.graduation_year < public.current_academic_year())
  ), counted as (
    select pl.id,
           ((now() at time zone public.app_timezone())::date - (pl.seen at time zone public.app_timezone())::date) as d,
           (select count(*) from public.inactivity_nudges n where n.player_id = pl.id and n.sent_at > pl.seen)::int as sent
      from players pl
  )
  select c.id, c.d, c.sent + 1, (c.sent + 1) * cfg2.n, cfg2.mode
    from counted c, cfg2
   where (c.sent = 0 and c.d >= cfg2.n)
      or (c.sent = 1 and c.d >= 2 * cfg2.n)
$function$;

-- Restart only clears the program you're in.
create or replace function public.restart_scoring_season()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_pid uuid := public.ctx_program_id();
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Only coaches can do that' using errcode = '42501';
  end if;
  delete from public.points_ledger   where program_id = v_pid;
  delete from public.scoring_windows where program_id = v_pid;
  insert into public.app_settings (program_id, key, value) values (v_pid, 'scoring_started_at', now()::text)
  on conflict (program_id, key) do update set value = excluded.value, updated_at = now();
end;
$function$;

-- ── 6. Self-test: each program's functions read its own copy ─
-- If any program reads another's settings, this stops the migration
-- and nothing is changed.
do $$
declare pr record; v_stored timestamptz;
begin
  for pr in select id, name from public.programs loop
    perform set_config('ww.program_id', pr.id::text, true);
    select value::timestamptz into v_stored from public.app_settings
     where program_id = pr.id and key = 'scoring_started_at';
    if public.ctx_program_id() <> pr.id then
      raise exception '183 self-test: % resolved to the wrong program', pr.name;
    end if;
    if public.scoring_started_at() is distinct from v_stored then
      raise exception '183 self-test: % reads another program''s settings', pr.name;
    end if;
  end loop;
  perform set_config('ww.program_id', '', true);
end $$;

commit;


-- ── Check ─────────────────────────────────────────────────────
-- One row per program. Boys' values should be exactly what they were
-- before (season mode, XP on/off, XP per workout, challenge unlock).
-- Girls should match Boys, except "scoring started" = today.
select pr.name as program,
       (select count(*) from public.app_settings s where s.program_id = pr.id) as app_settings,
       (select count(*) from public.xp_settings  x where x.program_id = pr.id) as xp_settings,
       (select value from public.app_settings s where s.program_id = pr.id and key = 'season_mode') as season_mode,
       (select left(value, 10) from public.app_settings s where s.program_id = pr.id and key = 'scoring_started_at') as scoring_started,
       (select xp_required from public.xp_settings x where x.program_id = pr.id and perk_key = '_xp_enabled') as xp_on,
       (select xp_required from public.xp_settings x where x.program_id = pr.id and perk_key = '_xp_workout') as xp_per_workout,
       (select xp_required from public.xp_settings x where x.program_id = pr.id and perk_key = 'challenges_unlocked') as challenge_unlock_xp
  from public.programs pr
 order by pr.name;
