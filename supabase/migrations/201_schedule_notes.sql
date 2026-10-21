-- 201_schedule_notes.sql
-- A free-text note on every schedule item: games, practices and events
-- ("Wear grey jerseys", "Bring user fees"). Players see it on their
-- schedule, and it's included in Print / Email.
--
-- Its own column, not games.notes: that one already holds the post-game
-- notes written when a game is finished.
-- Adds columns only; nothing existing changes. Safe to run again.

begin;

alter table public.games           add column if not exists schedule_note text;
alter table public.practices       add column if not exists schedule_note text;
alter table public.schedule_events add column if not exists schedule_note text;

commit;

select 'yes' as schedule_notes_ready;
