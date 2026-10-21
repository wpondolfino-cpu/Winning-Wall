-- 199_appearance.sql
-- Light mode: each account's Appearance choice (My Profile).
--   'dark'   - today's look (everyone starts here, so nothing changes
--              until someone picks something else)
--   'light'
--   'system' - follows the phone's or computer's own light/dark setting
-- Saved on the account, so it follows the person to every device.
-- Safe to run again.

begin;

alter table public.profiles
  add column if not exists appearance text not null default 'dark';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_appearance_check') then
    alter table public.profiles add constraint profiles_appearance_check
      check (appearance in ('dark', 'light', 'system'));
  end if;
end $$;

-- Changes only your own appearance, whatever else profile updates allow.
create or replace function public.set_appearance(p_appearance text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_appearance not in ('dark', 'light', 'system') then
    raise exception 'Appearance must be dark, light or system.';
  end if;
  update public.profiles set appearance = p_appearance where id = auth.uid();
end $$;

revoke all on function public.set_appearance(text) from public, anon;
grant execute on function public.set_appearance(text) to authenticated;

commit;

select 'yes' as appearance_ready,
       (select count(*) from public.profiles where appearance = 'dark') as accounts_on_dark;
