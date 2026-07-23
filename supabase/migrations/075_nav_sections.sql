-- 075_nav_sections.sql
-- Supports the collapsible IN-SEASON / OFFSEASON sidebar grouping.
-- nav_sections: per-user override of which section a nav item lives in
--   (key -> "inseason" | "offseason" | "always"). Falls back to each
--   item's default section (defined in App.tsx's NAV_CONFIG arrays)
--   when a key isn't present here — this only stores overrides created
--   by dragging an item across zones in NavReorderModal.
-- nav_expanded: per-user remembered expand/collapse state for the two
--   collapsible headers, e.g. {"inseason": true, "offseason": false}.

alter table public.profiles
  add column if not exists nav_sections jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists nav_expanded jsonb not null default '{"inseason": true, "offseason": true}'::jsonb;
