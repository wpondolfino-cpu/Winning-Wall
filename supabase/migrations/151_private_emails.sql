-- 151_private_emails.sql
--
-- Every account's name and email could be read by anyone holding the
-- app's public key -- no account needed. Emails are mostly minors'.
--
--   1. Emails move to their own table: coaches/admins read all, each
--      person reads their own. profiles.email is removed.
--   2. The sign-up email sync fills the new table.
--   3. Forgot Password requests are matched to an account here, by email,
--      instead of the logged-out form looking it up in profiles.
--   4. Profiles are readable only when signed in.
--   5. The views stop serving logged-out visitors (views skip RLS).
--
-- RUN LAST: after the new send-push function is deployed and the new app
-- (LoginPage, PlayersPanel, AdminPanel) is live. The old app's Forgot
-- Password needs profiles to be readable while logged out.

-- ══ 1. Emails in their own table ═══════════════════════════════
create table if not exists public.profile_emails (
  id    uuid primary key references public.profiles(id) on delete cascade,
  email text
);

alter table public.profile_emails enable row level security;

drop policy if exists "profile_emails_read" on public.profile_emails;
create policy "profile_emails_read" on public.profile_emails
  for select using (id = auth.uid() or public.is_staff(auth.uid()));
-- No write policies: only the sync trigger (below) writes, with server rights.

insert into public.profile_emails (id, email)
select id, email from public.profiles where email is not null
on conflict (id) do update set email = excluded.email;

create index if not exists profile_emails_email_idx on public.profile_emails (lower(email));

-- ══ 2. Sign-up / email-change sync ═════════════════════════════
-- Fires on auth.users insert and email change (trigger on_auth_user_email_sync,
-- made in the dashboard). Runs after on_auth_user_created -- triggers fire
-- in name order -- so the profile row already exists. The guard covers
-- the case where it doesn't, so a sign-up can never fail here.
create or replace function public.sync_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if exists (select 1 from public.profiles where id = new.id) then
    insert into public.profile_emails (id, email) values (new.id, new.email)
    on conflict (id) do update set email = excluded.email;
  end if;
  return new;
end;
$$;

-- ══ 3. Forgot Password: match the account here ═════════════════
-- Whatever player_id the form sends is ignored; the account is found by
-- email with server rights. The form no longer needs to read profiles
-- while logged out, and can't point a request at someone else's account.
create or replace function public.match_reset_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  new.player_id := (
    select id from public.profile_emails
     where lower(email) = lower(trim(new.email))
     limit 1
  );
  return new;
end;
$$;

drop trigger if exists match_reset_request on public.password_reset_requests;
create trigger match_reset_request
  before insert on public.password_reset_requests
  for each row execute function public.match_reset_request();

-- ══ 4. Profiles: signed-in only ════════════════════════════════
drop policy if exists "profiles_read_all" on public.profiles;
drop policy if exists "profiles_read_signed_in" on public.profiles;
create policy "profiles_read_signed_in" on public.profiles
  for select using (auth.uid() is not null);

-- Now that nothing reads it, the column goes.
alter table public.profiles drop column if exists email;

-- ══ 5. Views ═══════════════════════════════════════════════════
-- Views run with their owner's rights and skip RLS, so these served
-- names and activity to logged-out visitors. Signed-in users keep them.
-- inactive_players is only read by the notify-inactive function (server
-- rights), so nobody else needs it.
revoke all on public.leaderboard        from anon, public;
revoke all on public.challenge_stats    from anon, public;
revoke all on public.workouts_with_group from anon, public;
revoke all on public.inactive_players   from anon, public, authenticated;
grant select on public.leaderboard, public.challenge_stats, public.workouts_with_group to authenticated;

-- ══ Check it ═══════════════════════════════════════════════════
--   select count(*) from public.profile_emails;          -- about your account count
--   select policyname from pg_policies where tablename = 'profiles' and cmd = 'SELECT';
--                                                        -- profiles_read_signed_in only
