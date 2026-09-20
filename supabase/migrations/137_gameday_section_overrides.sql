-- 137_gameday_section_overrides.sql
--
-- Renaming and hiding sections, per sheet.
--
-- GAMEDAY_SECTIONS is a constant of thirteen — every sheet shows the same
-- thirteen headers whether or not it uses them, and none can be renamed.
-- A freshman sheet carries "BLOB zone" it never runs; a varsity sheet
-- can't call it what the staff actually calls it.
--
-- Both overrides live on the SHEET, not on the sections, so varsity and
-- freshmen can differ without touching each other. The section keys stay
-- exactly as they are, which is what keeps this cheap: calls still store
-- their section by key, the print order is unchanged, and unhiding
-- restores everything because nothing was ever moved.
--
-- Deliberately not custom sections. That means sections become rows
-- rather than constants — a table, ordering, and every place that assumes
-- the fixed thirteen — and the shape it should take depends on what a
-- program is, which doesn't exist yet. Renaming and hiding covers "we
-- call it something else" and "we never run one" without pre-empting it.

alter table public.gameday_sheets
  add column if not exists section_labels jsonb not null default '{}'::jsonb;

alter table public.gameday_sheets
  add column if not exists hidden_sections text[] not null default '{}';

comment on column public.gameday_sheets.section_labels is
  'Per-sheet renames, keyed by section key: {"blob_zone": "BLOB vs 2-3"}. Absent key = the built-in label.';

comment on column public.gameday_sheets.hidden_sections is
  'Section keys this sheet does not show or print. Calls in a hidden section are kept, not deleted — unhiding restores them.';
