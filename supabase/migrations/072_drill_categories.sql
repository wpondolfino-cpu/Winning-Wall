-- 072_drill_categories.sql
-- Turns drill categories from a hardcoded frontend list into a real,
-- admin/coach-manageable table. Renaming a category cascades to every
-- drill that uses it; deleting a category in use is blocked.

create table if not exists drill_categories (
  name        text primary key,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Seed with the categories the app has been using.
insert into drill_categories (name, sort_order) values
  ('Dribbling', 0),
  ('Finishing', 1),
  ('Shooting',  2),
  ('Competing', 3),
  ('Strength',  4)
on conflict (name) do nothing;

-- Safety net: pick up any category values already on drills that don't
-- exactly match the seed list above (e.g. from manual edits), so the
-- foreign key below doesn't fail on unexpected data.
insert into drill_categories (name, sort_order)
select distinct category, 999
from workouts
where category is not null
  and category not in (select name from drill_categories)
on conflict (name) do nothing;

-- Link workouts.category to the new table. ON UPDATE CASCADE means
-- renaming a category in drill_categories updates every drill using it
-- automatically. ON DELETE RESTRICT blocks deleting a category that's
-- still in use by at least one drill.
alter table workouts
  add constraint workouts_category_fkey
  foreign key (category) references drill_categories(name)
  on update cascade
  on delete restrict;

alter table drill_categories enable row level security;

drop policy if exists "categories_read_all" on drill_categories;
create policy "categories_read_all" on drill_categories
  for select using (true);

drop policy if exists "categories_staff_insert" on drill_categories;
create policy "categories_staff_insert" on drill_categories
  for insert with check (
    auth.uid() in (select id from public.profiles where role in ('coach', 'admin'))
  );

drop policy if exists "categories_staff_update" on drill_categories;
create policy "categories_staff_update" on drill_categories
  for update using (
    auth.uid() in (select id from public.profiles where role in ('coach', 'admin'))
  );

drop policy if exists "categories_staff_delete" on drill_categories;
create policy "categories_staff_delete" on drill_categories
  for delete using (
    auth.uid() in (select id from public.profiles where role in ('coach', 'admin'))
  );
