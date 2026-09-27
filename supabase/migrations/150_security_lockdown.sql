-- 150_security_lockdown.sql
--
-- Closes the holes found in the September 2026 audit. Each section is
-- independent and can be reversed on its own (see the end of the file).
--
--   1. Sign-up can't hand out roles
--   2. Profile guard: only staff change role/crown/roster/grade; only an
--      admin makes coaches; nobody changes their own role
--   3. Coach-only functions check the caller
--   4. Password resets: admin resets anyone, coach resets players only
--   5. Logged-out visitors can't call functions that change data
--   6. Lifting: no more "anyone can do anything"
--   7. Reset requests, badges, XP log
--   8. Pin search_path on every elevated function
--   9. Indexes for the scoring tables
--
-- NOT covered (needs scoring moved to the server -- option B): players
-- can still write their own score rows, streaks, streak bonuses and XP.

-- ══ 1. Sign-up can't hand out roles ════════════════════════════
-- Was: the new account got whatever role the signup request named, so a
-- hand-made request could create an admin, and leaving role out made a
-- full player -- both skipping approval. Now only the two pending roles
-- are accepted; anything else becomes pending_player. Coaches creating
-- accounts ("Add Player Manually", "Add Coach") approve them straight
-- after, from their own session (PlayersPanel.tsx does this).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.profiles (id, name, role, grade_category, must_change_password, created_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'role' in ('pending_player', 'pending_coach')
         then new.raw_user_meta_data->>'role'
         else 'pending_player' end,
    new.raw_user_meta_data->>'grade_category',
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, false),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ══ 2. Profile guard ═══════════════════════════════════════════
-- The update rules let anyone edit their own row with no limit on which
-- columns, so a player could make themselves admin. RLS can't limit
-- columns, so a trigger does:
--   * nobody changes their own role, except a player deactivating
--   * only staff change anyone's role
--   * only an admin makes someone a coach/admin, or changes a coach/admin
--   * only staff change crown, roster, jersey, team, grade/graduation year
-- Players can still change name, avatar, nav and push settings, XP, and
-- must_change_password.
-- Requests with no signed-in user (the SQL editor, the server, sign-up
-- itself) pass through untouched.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
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
  if uid is null then return new; end if;
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
    -- Compared as JSON so a column that doesn't exist reads as null
    -- rather than breaking every profile update.
    o := to_jsonb(old);
    n := to_jsonb(new);
    foreach col in array array['is_period_champion', 'champion_since', 'home_roster_id', 'jersey',
                               'team_id', 'team_wins', 'graduation_year', 'grade_category'] loop
      if (n -> col) is distinct from (o -> col) then
        raise exception 'Only coaches can change %', col using errcode = '42501';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ══ 3. Coach-only functions check the caller ═══════════════════
-- These ran with full rights and never asked who was calling. Rather
-- than rewrite each one (the live versions may differ from the migration
-- files), each is renamed to <name>_unguarded, locked so nobody can call
-- it directly, and replaced by a same-named wrapper that checks the
-- caller is a coach/admin and then calls it. The app keeps calling the
-- same names. The server (service role) is let through.
do $do$
declare
  r record;
  call_args text;
  body text;
begin
  for r in
    select p.oid, p.proname,
           pg_get_function_arguments(p.oid)          as args,
           pg_get_function_identity_arguments(p.oid) as idargs,
           pg_get_function_result(p.oid)             as ret,
           p.pronargs
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = any (array[
         'award_team_bonus', 'increment_team_wins', 'close_team_competition',
         'clear_tryout_pool', 'cut_tryout_players_not_in_plan', 'duplicate_team_plan',
         'clear_workout_tiebreak_values', 'resync_workout_tiebreaks',
         'start_group_run', 'start_group_run_by_workouts', 'delete_pending_user'])
  loop
    -- Already wrapped (migration run twice): leave it.
    if exists (select 1 from pg_proc where proname = r.proname || '_unguarded') then
      continue;
    end if;

    execute format('alter function public.%I(%s) rename to %I', r.proname, r.idargs, r.proname || '_unguarded');
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.proname || '_unguarded', r.idargs);

    -- Positional ($1, $2 ...) so it works whatever the parameters are named.
    call_args := coalesce(array_to_string(array(select '$' || i from generate_series(1, r.pronargs) i), ', '), '');
    body := case
      when r.ret = 'void' then format('perform public.%I(%s);', r.proname || '_unguarded', call_args)
      when r.ret like 'SETOF %' or r.ret like 'TABLE(%' then format('return query select * from public.%I(%s);', r.proname || '_unguarded', call_args)
      else format('return public.%I(%s);', r.proname || '_unguarded', call_args)
    end;

    execute format($f$
      create function public.%I(%s) returns %s
      language plpgsql security definer set search_path = public, extensions
      as $w$
      begin
        if not (public.is_staff(auth.uid()) or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
          raise exception 'Only coaches can do that' using errcode = '42501';
        end if;
        %s
      end;
      $w$
    $f$, r.proname, r.args, r.ret, body);

    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.idargs);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.idargs);
  end loop;
end $do$;

-- ══ 4. Password resets ═════════════════════════════════════════
-- Was callable by anyone, logged in or not, for any account -- including
-- the admin's. Now: an admin can reset anyone; a coach only a player
-- (player / inactive / pending_player); nobody else.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'reset_user_password_unguarded') then
    alter function public.reset_user_password(uuid, text) rename to reset_user_password_unguarded;
    revoke all on function public.reset_user_password_unguarded(uuid, text) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.reset_user_password(target_user_id uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    null;
  elsif not public.is_staff(uid) then
    raise exception 'Only coaches can reset passwords' using errcode = '42501';
  elsif not public.is_admin(uid) and exists (
    select 1 from public.profiles
     where id = target_user_id and role not in ('player', 'inactive', 'pending_player')
  ) then
    raise exception 'Only an admin can reset a coach''s password' using errcode = '42501';
  end if;
  perform public.reset_user_password_unguarded(target_user_id, new_password);
end;
$$;

revoke all on function public.reset_user_password(uuid, text) from public, anon;
grant execute on function public.reset_user_password(uuid, text) to authenticated;

-- ══ 5. Logged-out visitors lose functions that change data ═════
-- Supabase lets anyone call new functions by default, logged in or not.
-- These change data, so they're for signed-in users only. (The helper
-- checks used inside access rules -- is_staff, is_admin and friends --
-- stay callable, since rules are evaluated for visitors too.)
do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as idargs
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = any (array[
         'rerank_workout', 'upsert_record', 'week_for_date',
         'roll_competitions', 'current_competition', 'sync_grades_to_season'])
  loop
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.idargs);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.idargs);
  end loop;
end $$;

-- send_welcome_email only writes a log row and the app never calls it.
-- Nobody but the server.
do $$
declare
  r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as idargs
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'send_welcome_email'
  loop
    execute format('revoke all on function public.send_welcome_email(%s) from public, anon, authenticated', r.idargs);
  end loop;
end $$;

-- ══ 6. Lifting ═════════════════════════════════════════════════
-- Every lifting table allowed anything to anyone, logged in or not.
-- Now: signed-in users read; coaches manage programs, days, exercises and
-- assignments; players write only their own logs and records.
do $$
declare
  t text;
begin
  foreach t in array array['lifting_programs', 'lifting_days', 'lifting_day_exercises',
                           'lifting_exercises', 'lifting_exercise_bank', 'lifting_program_assignments',
                           'lifting_logs', 'lifting_records'] loop
    execute format('drop policy if exists "lifting_read" on public.%I', t);
    execute format('drop policy if exists "lifting_staff_write" on public.%I', t);
    execute format('create policy "lifting_read" on public.%I for select using (auth.uid() is not null)', t);
    execute format('create policy "lifting_staff_write" on public.%I for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()))', t);
  end loop;
end $$;

-- The allow_all names don't all follow one pattern; drop them by name.
drop policy if exists "allow_all_lifting_programs"      on public.lifting_programs;
drop policy if exists "allow_all_lifting_days"          on public.lifting_days;
drop policy if exists "allow_all_lifting_day_exercises" on public.lifting_day_exercises;
drop policy if exists "allow_all_lifting_exercises"     on public.lifting_exercises;
drop policy if exists "allow_all_exercise_bank"         on public.lifting_exercise_bank;
drop policy if exists "allow_all_lifting_assignments"   on public.lifting_program_assignments;
drop policy if exists "allow_all_lifting_logs"          on public.lifting_logs;
drop policy if exists "allow_all_lifting_records"       on public.lifting_records;

-- Players log their own sets and keep their own records.
drop policy if exists "lifting_logs_own"    on public.lifting_logs;
drop policy if exists "lifting_records_own" on public.lifting_records;
create policy "lifting_logs_own" on public.lifting_logs
  for all using (player_id = auth.uid()) with check (player_id = auth.uid());
create policy "lifting_records_own" on public.lifting_records
  for all using (player_id = auth.uid()) with check (player_id = auth.uid());

-- ══ 7. Reset requests, badges, XP log ══════════════════════════
-- Reset requests: a dashboard-made rule let anyone read, change or
-- delete every request. Anyone can still SUBMIT one (you're logged out
-- when you forget your password); coaches and admins read and close them.
drop policy if exists "allow_all_password_reset_requests" on public.password_reset_requests;
drop policy if exists "staff_read_reset"   on public.password_reset_requests;
drop policy if exists "staff_update_reset" on public.password_reset_requests;
create policy "staff_read_reset" on public.password_reset_requests
  for select using (public.is_staff(auth.uid()));
create policy "staff_update_reset" on public.password_reset_requests
  for update using (public.is_staff(auth.uid()));

-- Badges: "badges_admin_write" allowed anyone. Admin only.
drop policy if exists "badges_admin_write" on public.badges;
drop policy if exists "badges_admin_only_write" on public.badges;
create policy "badges_admin_only_write" on public.badges
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- XP log: anyone could add entries for anyone. Now only for yourself
-- (or any player, if you're staff).
drop policy if exists "xp_log_insert" on public.xp_log;
drop policy if exists "xp_log_insert_own" on public.xp_log;
create policy "xp_log_insert_own" on public.xp_log
  for insert with check (player_id = auth.uid() or public.is_staff(auth.uid()));

-- ══ 8. Pin search_path on every elevated function ══════════════
-- A standard hardening step: stops a function resolving a name to
-- something unexpected. 'extensions' is included because crypt() and
-- uuid_generate_v4() live there.
do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as idargs
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prosecdef and p.proconfig is null
  loop
    execute format('alter function public.%I(%s) set search_path = public, extensions', r.proname, r.idargs);
  end loop;
end $$;

-- ══ 9. Indexes for the scoring tables ══════════════════════════
-- Every leaderboard load searches these by date and player; until now
-- they were indexed by id only.
create index if not exists score_attempts_player_idx       on public.score_attempts(player_id);
create index if not exists score_attempts_workout_idx      on public.score_attempts(workout_id);
create index if not exists score_attempts_attempted_at_idx on public.score_attempts(attempted_at);
create index if not exists streak_bonuses_player_idx       on public.streak_bonuses(player_id);
create index if not exists streak_bonuses_awarded_at_idx   on public.streak_bonuses(awarded_at);

-- ══ Check it ═══════════════════════════════════════════════════
-- Re-run blocks 3 and 5 of audit_health_check.sql. Block 3 should list
-- only password_reset_requests "anyone_request_reset" (intended). Block 5
-- should show visitors_can_call = false on everything except the helper
-- checks and current_academic_year, and the *_unguarded functions should
-- show users_can_call = false.
--
-- ══ Reversing one section ══════════════════════════════════════
-- 2: drop trigger protect_profile_columns on public.profiles;
-- 3/4: for a function f: drop function public.f(args);
--      alter function public.f_unguarded(args) rename to f;
--      grant execute on function public.f(args) to authenticated;
-- 6/7: recreate the dropped policy from the audit results.
