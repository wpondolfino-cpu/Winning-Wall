-- 077_play_video.sql
-- Adds an optional video_url to plays and playbooks, mirroring the
-- video_url pattern already used on workouts / exercises / offseason
-- drills / practice drills. A play's video is meant for "here's real
-- game film of us running this," a playbook's video is meant for a
-- higher-level walkthrough covering the whole set of plays inside it.
-- No new tables, no RLS changes needed — these ride along on the
-- existing plays/playbooks policies untouched.

alter table public.plays
  add column if not exists video_url text;

alter table public.playbooks
  add column if not exists video_url text;
