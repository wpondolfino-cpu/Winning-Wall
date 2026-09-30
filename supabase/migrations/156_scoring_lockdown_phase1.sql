-- 156_scoring_lockdown_phase1.sql
--
-- Option B, Phase 1c: lock what Phase 1 moved to the server.
--
-- Players can no longer write these directly -- only the logging
-- functions (log_workout / log_library_practice) can, which run with
-- server rights. Coaches and admins keep their access (Edit Scores,
-- History deletes, resets).
--
--   score_attempts, personal_bests, spot_personal_bests,
--   library_practice_log, and Hall of Fame records (upsert_record)
--
-- NOT yet locked, because players' browsers still write them:
--   scores          -- the Score Boost perk            (Phase 3)
--   streaks         -- the Streak Shield perk          (Phase 3)
--   streak_bonuses  -- the challenge win bonus         (Phase 2)
--   xp_log / XP     -- challenge XP                    (Phase 2)

-- ══ 1. Tables: read as before, write = staff only ═══════════════
-- Every non-read policy on these tables is dropped (whatever it was
-- named, including dashboard-made ones), then one staff policy added.
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['score_attempts', 'personal_bests', 'spot_personal_bests', 'library_practice_log'] loop
    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t and cmd <> 'SELECT'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('drop policy if exists "staff_write" on public.%I', t);
    execute format('create policy "staff_write" on public.%I for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()))', t);
  end loop;
end $$;

-- Reading stays as it was, but make sure each table has a read policy
-- (a table whose only policy was "for all" would otherwise go dark).
do $$
declare t text;
begin
  foreach t in array array['score_attempts', 'personal_bests', 'spot_personal_bests', 'library_practice_log'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT') then
      execute format('create policy "signed_in_read" on public.%I for select using (auth.uid() is not null)', t);
    end if;
  end loop;
end $$;

-- ══ 2. Hall of Fame records ══════════════════════════════════════
-- upsert_record took any value from any signed-in user, so anyone could
-- write a fake record. Now: the server's refresh_my_records (which reads
-- its own numbers) and coaches (crowning) only.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'upsert_record_unguarded') then
    alter function public.upsert_record(text, uuid, text, text, uuid, text, text, numeric, text, text)
      rename to upsert_record_unguarded;
    revoke all on function public.upsert_record_unguarded(text, uuid, text, text, uuid, text, text, numeric, text, text)
      from public, anon, authenticated;
  end if;
end $$;

create or replace function public.upsert_record(
  p_type text, p_workout_id uuid, p_workout_title text, p_workout_desc text,
  p_player_id uuid, p_player_name text, p_avatar_url text,
  p_value numeric, p_display_value text, p_season text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not (public.is_staff(auth.uid()) or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Only coaches can set records' using errcode = '42501';
  end if;
  return public.upsert_record_unguarded(p_type, p_workout_id, p_workout_title, p_workout_desc,
                                        p_player_id, p_player_name, p_avatar_url, p_value, p_display_value, p_season);
end;
$$;
revoke all on function public.upsert_record(text, uuid, text, text, uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.upsert_record(text, uuid, text, text, uuid, text, text, numeric, text, text) to authenticated;

-- refresh_my_records (migration 155) is called by players after a log and
-- works out every value itself, so it goes straight to the unguarded one.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.refresh_my_records(uuid)'::regprocedure) into v_def;
  if position('upsert_record_unguarded' in v_def) = 0 then
    execute replace(v_def, 'public.upsert_record(', 'public.upsert_record_unguarded(');
  end if;
end $$;

-- ══ Check it ═════════════════════════════════════════════════════
-- Write policies left on these tables should be "staff_write" only:
--
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('score_attempts','personal_bests','spot_personal_bests','library_practice_log')
--    order by tablename, cmd;
