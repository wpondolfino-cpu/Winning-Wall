-- 111_saved_grouping_arrangements.sql
--
-- A saved grouping has been ONE named group -- a list of players. That
-- fits "Starters" perfectly and doesn't fit "3 on 3 groups, week 1" at
-- all, which is an arrangement of the whole roster into several groups.
--
-- Rather than a new table, one column: group_index on the member rows.
-- Every existing saved grouping becomes a one-group arrangement at index
-- 0 automatically, so "Starters" keeps working untouched and there's no
-- data migration.
--
-- group_labels is index-aligned with group_index, so "Starters / 2nd
-- line" can be named while "3s Week 1" just derives Group 1, 2, 3. Null
-- or short arrays fall back to derived names.

alter table public.saved_grouping_members
  add column if not exists group_index int not null default 0;

alter table public.saved_groupings
  add column if not exists group_labels text[] null;

-- Members are read back in arrangement order, so the index leads.
create index if not exists saved_grouping_members_order_idx
  on public.saved_grouping_members(grouping_id, group_index);
