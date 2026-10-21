-- 202_template_court_and_sheet_rotation.sql
-- Two small additions, columns only. Nothing existing changes.
--
-- 1. Play templates remember their court (formations.court_template).
--    Blank on existing templates: they were laid out on a half court, and
--    the app treats them that way -- a BLOB template opens on the baseline
--    out-of-bounds court, a SLOB on the sideline one, the rest as before.
--    Set a press template to full court in the template editor.
--
-- 2. A Game Day play sheet can link a rotation plan
--    (gameday_sheets.rotation_plan_id). It shows on the sheet and its
--    printout until you unlink it or link a different one. Deleting the
--    rotation plan just unlinks it.
-- Safe to run again.

begin;

alter table public.formations add column if not exists court_template text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'formations_court_template_check') then
    alter table public.formations add constraint formations_court_template_check
      check (court_template is null or court_template in ('half', 'full', 'baseline_oob', 'sideline_oob'));
  end if;
end $$;

alter table public.gameday_sheets add column if not exists rotation_plan_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gameday_sheets_rotation_plan_fk') then
    alter table public.gameday_sheets add constraint gameday_sheets_rotation_plan_fk
      foreign key (rotation_plan_id) references public.rotation_plans(id) on delete set null;
  end if;
end $$;

commit;

select 'yes' as ready;
