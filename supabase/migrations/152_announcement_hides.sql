-- 152_announcement_hides.sql
--
-- Announcements now show at the top of every player page, and a player
-- can hide one once they've seen it. Hiding is per account (so it's gone
-- on their phone and laptop alike) and only for them -- coaches still
-- delete an announcement for everyone from the Announcements page.
--
-- Also: announcements were readable by logged-out visitors (the same
-- "anyone" rule profiles had). Now signed-in only.

create table if not exists public.announcement_hides (
  player_id       uuid not null references public.profiles(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  hidden_at       timestamptz not null default now(),
  primary key (player_id, announcement_id)
);

alter table public.announcement_hides enable row level security;

drop policy if exists "announcement_hides_own" on public.announcement_hides;
create policy "announcement_hides_own" on public.announcement_hides
  for all using (player_id = auth.uid()) with check (player_id = auth.uid());

drop policy if exists "announcements_read_all" on public.announcements;
drop policy if exists "announcements_read_signed_in" on public.announcements;
create policy "announcements_read_signed_in" on public.announcements
  for select using (auth.uid() is not null);
