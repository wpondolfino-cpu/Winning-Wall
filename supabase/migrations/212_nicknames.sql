-- ============================================================
-- 212_nicknames.sql
--
-- Short names for practice printouts and the player's practice view.
--
--   profiles.nickname          what to print instead of the first name
--                              (blank = the app's automatic short form)
--   profiles.nickname_locked   a coach set it; the player can't change it
--   tryout_players.nickname    same, for pool kids with no account
--
-- set_nickname() is how the app saves one. It lets:
--   * anyone change their own (unless a coach locked it),
--   * coaches change anyone's in their program, players and coaches,
--     and lock or unlock a player's.
-- A player editing their profile row directly is held to the same lock
-- by the zz_protect_nickname trigger.
--
-- Safe to run more than once. Changes nothing that already exists.
-- ============================================================

-- ── 1. Columns ───────────────────────────────────────────────
alter table public.profiles       add column if not exists nickname        text;
alter table public.profiles       add column if not exists nickname_locked boolean not null default false;
alter table public.tryout_players add column if not exists nickname        text;

-- Up to 20 characters: letters, spaces, hyphens, apostrophes, periods.
alter table public.profiles drop constraint if exists profiles_nickname_check;
alter table public.profiles add constraint profiles_nickname_check
  check (nickname is null or (char_length(nickname) between 1 and 20 and nickname ~ '^[[:alpha:]][[:alpha:] .''-]*$'));

alter table public.tryout_players drop constraint if exists tryout_players_nickname_check;
alter table public.tryout_players add constraint tryout_players_nickname_check
  check (nickname is null or (char_length(nickname) between 1 and 20 and nickname ~ '^[[:alpha:]][[:alpha:] .''-]*$'));


-- ── 2. The lock, for direct updates ──────────────────────────
-- Named zz_ so it runs after protect_profile_columns.
create or replace function public.protect_nickname()
returns trigger
language plpgsql
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  -- The server, the SQL editor and set_nickname() pass straight through.
  if uid is null or current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_staff(uid) then return new; end if;

  if new.nickname_locked is distinct from old.nickname_locked then
    raise exception 'Only coaches can lock a nickname' using errcode = '42501';
  end if;
  if old.nickname_locked and new.nickname is distinct from old.nickname then
    raise exception 'Your coach set your nickname. Ask them to change it.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_protect_nickname on public.profiles;
create trigger zz_protect_nickname
  before update on public.profiles
  for each row execute function public.protect_nickname();


-- ── 3. Saving a nickname ─────────────────────────────────────
-- nick: blank or null clears it (the automatic short form comes back).
-- lock: null leaves the lock as it is.
create or replace function public.set_nickname(target uuid, nick text, lock boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  staff boolean;
  clean text := nullif(btrim(regexp_replace(coalesce(nick, ''), '\s+', ' ', 'g')), '');
  was_locked boolean;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  staff := public.is_staff(uid);

  select nickname_locked into was_locked from public.profiles where id = target;
  if not found then
    raise exception 'No such person' using errcode = 'P0002';
  end if;

  if target <> uid and not (staff and public.can_see_profile(target)) then
    raise exception 'Only coaches can change someone else''s nickname' using errcode = '42501';
  end if;
  if lock is not null and not staff then
    raise exception 'Only coaches can lock a nickname' using errcode = '42501';
  end if;
  if target = uid and not staff and was_locked then
    raise exception 'Your coach set your nickname. Ask them to change it.' using errcode = '42501';
  end if;

  update public.profiles
     set nickname = clean,
         nickname_locked = coalesce(lock, nickname_locked)
   where id = target;
end;
$$;

revoke all on function public.set_nickname(uuid, text, boolean) from public, anon;
grant execute on function public.set_nickname(uuid, text, boolean) to authenticated;
