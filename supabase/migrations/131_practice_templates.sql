-- 131_practice_templates.sql
--
-- A practice you can start from, rather than starting blank or
-- duplicating last Tuesday and trimming the one-off block out of it.
--
-- Stored as a practice row, so the whole tree of blocks, segments and
-- drills comes along without a parallel set of tables to keep in step.
-- The cost is that anything querying practices could pick a template up.
-- Most paths already filter by week and a template has no week, so they
-- exclude it for free — but two don't, and they're handled in code:
-- the copy-a-drill picker, and the attendance record, where a template
-- would inflate the denominator and make a player look like they'd
-- missed practices that never happened.
--
-- Roster-agnostic on purpose: the same "Standard Tuesday" should work for
-- Varsity and JV. roster_label is a hint shown in the picker, not a
-- filter — it says what the template was built for without stopping you
-- using it elsewhere.

alter table public.practices
  add column if not exists is_template boolean not null default false;

alter table public.practices
  add column if not exists template_name text;

alter table public.practices
  add column if not exists roster_label text;

comment on column public.practices.is_template is
  'A reusable starting point, not a real practice. Has no date or week, and must be excluded from any query that does not already filter by week.';

comment on column public.practices.roster_label is
  'Display-only hint on a template, e.g. "Varsity". Never a filter — templates are roster-agnostic.';

-- The picker reads these constantly and they are a small slice of the table.
create index if not exists practices_templates_idx
  on public.practices(created_at desc) where is_template;

-- Keep templates out of anything that scans practices by date.
create index if not exists practices_real_idx
  on public.practices(practice_date desc) where not is_template;
