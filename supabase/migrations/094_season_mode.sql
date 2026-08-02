-- 094_season_mode.sql
-- Seeds the default season_mode row. The app_settings table itself
-- already exists (migration 046) — this just makes the default
-- explicit in the database rather than relying on the client's
-- fallback value.
insert into public.app_settings (key, value)
values ('season_mode', 'offseason')
on conflict (key) do nothing;
