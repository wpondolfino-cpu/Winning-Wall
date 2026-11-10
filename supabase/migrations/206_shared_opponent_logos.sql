-- 206_shared_opponent_logos.sql
-- Opponent logos are shared between programs: if Boys already has
-- Canton's logo, Girls' Canton gets it too, with no uploading.
--
--   * Now: every opponent with no logo takes one from a same-named
--     opponent in any program that has one.
--   * From now on: a new opponent starts with that logo, and uploading a
--     logo for a team fills it in for every program's same-named team
--     that has none yet.
-- Only blanks are ever filled -- a logo someone set is never replaced.
-- Same name = ignoring capitals and extra spaces. The logos are public
-- school logos, so sharing them across programs reveals nothing.
-- Safe to run again.

begin;

create or replace function public._opp_key(n text)
returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(n, '')), '\s+', ' ', 'g'))
$$;

-- 1. Fill the blanks now.
update public.opponents o
   set logo_url = src.logo_url
  from (select distinct on (public._opp_key(name)) public._opp_key(name) as k, logo_url
          from public.opponents
         where logo_url is not null and logo_url <> ''
         order by public._opp_key(name), created_at) src
 where (o.logo_url is null or o.logo_url = '') and public._opp_key(o.name) = src.k;

-- 2. A new opponent starts with a known logo.
create or replace function public._opp_logo_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.logo_url is null or new.logo_url = '' then
    select logo_url into new.logo_url from public.opponents
     where public._opp_key(name) = public._opp_key(new.name) and logo_url is not null and logo_url <> ''
     order by created_at limit 1;
  end if;
  return new;
end $$;
drop trigger if exists opponents_logo_on_insert on public.opponents;
create trigger opponents_logo_on_insert before insert on public.opponents
  for each row execute function public._opp_logo_on_insert();

-- 3. A logo uploaded anywhere fills the same team's blanks elsewhere.
create or replace function public._opp_logo_share()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.logo_url is not null and new.logo_url <> '' and new.logo_url is distinct from old.logo_url then
    update public.opponents
       set logo_url = new.logo_url
     where id <> new.id and (logo_url is null or logo_url = '')
       and public._opp_key(name) = public._opp_key(new.name);
  end if;
  return new;
end $$;
drop trigger if exists opponents_logo_share on public.opponents;
create trigger opponents_logo_share after update of logo_url on public.opponents
  for each row execute function public._opp_logo_share();

revoke all on function public._opp_logo_on_insert(), public._opp_logo_share() from public, anon, authenticated;

commit;

select (select count(*) from public.opponents where logo_url is not null and logo_url <> '') as opponents_with_logos,
       (select count(*) from public.opponents where logo_url is null or logo_url = '') as still_without;
