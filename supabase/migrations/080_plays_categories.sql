-- 080_plays_categories.sql
-- Turns play categories into a real, coach/admin-manageable table —
-- same pattern as 072_drill_categories.sql. Renaming a category
-- cascades to every play that uses it; deleting a category still in
-- use is blocked. category is nullable on plays since every play
-- created before this migration has none yet; new plays are expected
-- to pick one going forward but nothing forces it retroactively.
--
-- This is a coach/admin-facing organizational layer only — players
-- keep the existing plain title/tag search in PlayViewer untouched.

create table if not exists public.plays_categories (
  name       text primary key,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

insert into public.plays_categories (name, sort_order) values
  ('Sets', 0),
  ('End of game plays', 1),
  ('BLOBs', 2),
  ('SLOBs', 3),
  ('Press breaks', 4)
on conflict (name) do nothing;

alter table public.plays
  add column if not exists category text;

-- Safety net for any category values that might already exist on
-- plays from manual data edits, so the foreign key below doesn't fail.
insert into public.plays_categories (name, sort_order)
select distinct category, 999
from public.plays
where category is not null
  and category not in (select name from public.plays_categories)
on conflict (name) do nothing;

alter table public.plays
  add constraint plays_category_fkey
  foreign key (category) references public.plays_categories(name)
  on update cascade
  on delete restrict;

alter table public.plays_categories enable row level security;

drop policy if exists "plays_categories_read_all" on public.plays_categories;
create policy "plays_categories_read_all" on public.plays_categories
  for select using (true);

drop policy if exists "plays_categories_staff_write" on public.plays_categories;
create policy "plays_categories_staff_write" on public.plays_categories
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));
