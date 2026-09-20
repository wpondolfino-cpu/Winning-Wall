-- 138_gameday_custom_sections.sql
--
-- Sections become rows, so a sheet can have its own.
--
-- They were thirteen constants in a TypeScript union, which meant a
-- program whose vocabulary doesn't match ours couldn't add "BLOB vs
-- 1-3-1" or "Late clock" at all. Migration 134 added renaming and hiding
-- as a cheaper half-measure; this replaces the model underneath and folds
-- that data in.
--
-- The thing that keeps this from being a painful migration: gameday_calls
-- already stores `section` as TEXT. Built-in sections keep their exact
-- keys, so not one call row moves. A custom section just gets a generated
-- key nothing else has.
--
-- Scoped to the SHEET, which needs nothing that doesn't already exist.
-- When programs land, a program-level default is another scope on this
-- same table rather than a rewrite — which is the reason for building it
-- now instead of waiting: the flexible version reuses a concept the app
-- already has.

create table if not exists public.gameday_sections (
  id          uuid primary key default gen_random_uuid(),
  sheet_id    uuid not null references public.gameday_sheets(id) on delete cascade,
  -- Matches gameday_calls.section. Stable for built-ins so their calls
  -- stay attached; generated for custom ones.
  key         text not null,
  label       text not null,
  "group"     text not null check ("group" in ('offense', 'blobsSlobs', 'defense', 'specials')),
  sort_order  int  not null default 0,
  hidden      boolean not null default false,
  -- Built-ins can be renamed and hidden but not deleted: deleting one
  -- would orphan calls on every other sheet that shares the key.
  is_builtin  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (sheet_id, key)
);

create index if not exists gameday_sections_sheet_idx
  on public.gameday_sections(sheet_id, sort_order);

alter table public.gameday_sections enable row level security;

drop policy if exists "gameday_sections_staff_all" on public.gameday_sections;
create policy "gameday_sections_staff_all" on public.gameday_sections
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "gameday_sections_player_read" on public.gameday_sections;
create policy "gameday_sections_player_read" on public.gameday_sections
  for select using (true);

-- ── Seed every existing sheet with the thirteen ──────────────
-- Carrying across the renames and hiding from 134, so nothing a coach has
-- already set up is lost.
insert into public.gameday_sections (sheet_id, key, label, "group", sort_order, hidden, is_builtin)
select
  s.id,
  d.key,
  coalesce(nullif(trim(s.section_labels ->> d.key), ''), d.label),
  d."group",
  d.sort_order,
  d.key = any(coalesce(s.hidden_sections, '{}')),
  true
from public.gameday_sheets s
cross join (values
  ('offense_man_triggers', 'Man — triggers', 'offense',     0),
  ('offense_man_sets',     'Man — sets',     'offense',     1),
  ('offense_zone',         'Zone',           'offense',     2),
  ('blob_1st',             'BLOB — 1st half','blobsSlobs',  3),
  ('blob_2nd',             'BLOB — 2nd half','blobsSlobs',  4),
  ('blob_zone',            'BLOB zone',      'blobsSlobs',  5),
  ('slob_1st',             'SLOB — 1st half','blobsSlobs',  6),
  ('slob_2nd',             'SLOB — 2nd half','blobsSlobs',  7),
  ('defense_man',          'Man',            'defense',     8),
  ('defense_zone',         'Zone',           'defense',     9),
  ('defense_press',        'Press',          'defense',    10),
  ('specials_press_break', 'Press breaks',   'specials',   11),
  ('specials_eog',         'End of game',    'specials',   12)
) as d(key, label, "group", sort_order)
on conflict (sheet_id, key) do nothing;

-- section_labels and hidden_sections stay on gameday_sheets for now,
-- unread. Dropping them while the previous client is still being served
-- would break it mid-deploy; they can go once this has been live a while.
comment on column public.gameday_sheets.section_labels is
  'DEPRECATED — superseded by gameday_sections.label. Read by nothing.';
comment on column public.gameday_sheets.hidden_sections is
  'DEPRECATED — superseded by gameday_sections.hidden. Read by nothing.';
