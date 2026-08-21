-- 114_graduation_year_on_signup.sql
--
-- Signup now asks "what grade are you in?" and passes a graduation year in
-- the auth metadata. This gets that value onto the profile row.
--
-- WHY A SECOND TRIGGER RATHER THAN EDITING THE EXISTING ONE
--
-- The trigger that creates a profile from auth.users was made in the
-- Supabase dashboard and never captured in a migration file, so its body
-- isn't in this repo. Rewriting a function you can't read is how fields
-- silently disappear -- so this leaves it entirely alone and adds an
-- independent trigger beside it.
--
-- It fires on public.profiles rather than auth.users, which guarantees
-- ordering: the row already exists by definition, so there's no race with
-- whatever creates it. Postgres fires triggers on a table alphabetically,
-- and this one only ever touches a column nothing else writes.
--
-- (Worth noting for the migration-consolidation work: this is exactly the
-- drift a pg_dump baseline would surface -- live objects that no
-- migration file describes.)

create or replace function public.sync_graduation_year_from_signup()
returns trigger
language plpgsql
security definer
as $$
declare
  v_year int;
begin
  select nullif(u.raw_user_meta_data ->> 'graduation_year', '')::int
    into v_year
  from auth.users u
  where u.id = new.id;

  if v_year is not null then
    update public.profiles
      set graduation_year = v_year
      where id = new.id and graduation_year is null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_graduation_year on public.profiles;
create trigger sync_graduation_year
  after insert on public.profiles
  for each row
  execute function public.sync_graduation_year_from_signup();

-- Backfill anyone who signed up between the app change and this migration
-- running. Only fills blanks, so a coach who already set a year by hand in
-- the Players tab is never overwritten.
update public.profiles p
  set graduation_year = nullif(u.raw_user_meta_data ->> 'graduation_year', '')::int
from auth.users u
where u.id = p.id
  and p.graduation_year is null
  and nullif(u.raw_user_meta_data ->> 'graduation_year', '') is not null;
