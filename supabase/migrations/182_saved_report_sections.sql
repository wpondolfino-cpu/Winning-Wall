-- ============================================================
-- 182_saved_report_sections.sql
--
-- Report builder "Show" filter: a saved report remembers which sections
-- it shows (Shooting, Paint touch & ball movement, Shot quality, ...).
-- Null = the whole report, exactly like every report saved before this.
-- saved_reports is already fenced to its program (181), so nothing else
-- is needed.
-- ============================================================

alter table public.saved_reports
  add column if not exists sections text[];

select 'saved_reports.sections' as item,
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'saved_reports' and column_name = 'sections'), 'MISSING') as value;
