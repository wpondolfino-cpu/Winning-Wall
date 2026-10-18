-- ============================================================
-- 187_roles_from_program.sql
--
-- MULTI-TENANCY STEP 10 — roles come from the program.
--
-- Until now "is this person a coach / an admin?" came from the role on
-- their profile, one role for the whole app. 133 database rules and
-- ~20 server functions ask that question through two checks,
-- is_staff() and is_admin(). Both now answer it for the program the
-- person is in:
--   * is_staff = head coach or coach of the program you're in
--                (or the platform admin)
--   * is_admin = head coach of the program you're in
--                (or the platform admin)
-- Every rule switches over at once; none of them is rewritten.
--
-- Also:
--   * Only the platform admin can make someone a head coach or take it
--     away (profile role "admin" <-> membership "head_coach"). Head
--     coaches can still approve players and assistant coaches.
--   * Ships with auth.ts (the app reads your role from the program
--     you're in) and PlayersPanel.tsx (clear message if a head coach
--     tries to make another head coach).
--
-- SAFETY CHECK BUILT IN: before changing anything it records, for every
-- Boys member and every platform admin, whether they count as staff and
-- as admin today. After the change it asks again (inside Boys). If
-- anyone LOSES access, the migration stops and nothing changes. Anyone
-- who GAINS access is listed in the result so you can see it.
--
-- If Supabase asks about RLS, choose "Run without RLS" (the check uses
-- temporary tables).
--
-- One transaction: if anything fails, nothing changes.
-- ============================================================

begin;
set local client_min_messages = warning;


-- ── 0. BEFORE: who is staff / admin today ────────────────────
create temp table _r_before on commit preserve rows as
  select p.id, p.name, p.role as profile_role,
         public.is_staff(p.id) as staff, public.is_admin(p.id) as admin
    from public.profiles p
   where p.id in (select user_id from public.program_members where program_id = public.legacy_default_program_id())
      or p.id in (select user_id from public.platform_admins);


-- ── 1. The two checks, per program ────────────────────────────
create or replace function public.is_staff(uid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select uid is not null and public.is_program_staff(public.ctx_program_id(), uid)
$function$;

create or replace function public.is_admin(uid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select uid is not null and public.is_program_head_coach(public.ctx_program_id(), uid)
$function$;


-- ── 2. Only the platform admin makes or removes head coaches ──
create or replace function public.protect_profile_columns()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
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
    elsif (new.role = 'admin' or old.role = 'admin') and not public.is_platform_admin(uid) then
      raise exception 'Only the platform admin can add or remove head coaches' using errcode = '42501';
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
$function$;


-- ── 3. AFTER: nobody in Boys may lose access ─────────────────
-- (Run from the SQL editor, the checks answer for Boys.)
create temp table _r_after on commit preserve rows as
  select b.id, b.name, b.profile_role, b.staff as staff_before, b.admin as admin_before,
         public.is_staff(b.id) as staff_after, public.is_admin(b.id) as admin_after
    from _r_before b;

do $$
declare n int; who text;
begin
  select count(*), string_agg(name || ' (' || profile_role || ')', ', ')
    into n, who
    from _r_after
   where (staff_before and not staff_after) or (admin_before and not admin_after);
  if n > 0 then
    raise exception '187 check: % Boys account(s) would lose coach/admin access: % -- nothing was changed', n, who;
  end if;
end $$;

commit;


-- ── Check ─────────────────────────────────────────────────────
-- If you're seeing this, nobody in Boys lost access.
-- Row 1: totals. Then one row per person whose access CHANGED (gained)
-- -- usually none, or someone whose program role was already higher
-- than their profile role (e.g. a head coach whose profile said coach).
select 'Boys members + platform admins checked' as who,
       count(*)::text as detail,
       count(*) filter (where staff_after)::text || ' staff, ' ||
       count(*) filter (where admin_after)::text || ' admin' as access_now
  from _r_after
union all
select name, 'profile role: ' || profile_role,
       'GAINED ' || concat_ws(' + ',
         case when staff_after and not staff_before then 'staff' end,
         case when admin_after and not admin_before then 'admin' end)
  from _r_after
 where (staff_after and not staff_before) or (admin_after and not admin_before);
