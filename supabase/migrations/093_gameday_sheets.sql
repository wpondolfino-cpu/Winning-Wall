-- 093_gameday_sheets.sql
-- Game Day call sheets: a second, separate concept from Scout Sheets.
-- Not tied to any one game -- named, reusable, continually-updated
-- documents (a coach's own play-calling reference), duplicated season
-- to season rather than created fresh per game. Coach/admin only --
-- no player-read policy at all, unlike Scout Sheets.

create table if not exists public.gameday_sheets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gameday_sheets enable row level security;

drop policy if exists "gameday_sheets_staff_all" on public.gameday_sheets;
create policy "gameday_sheets_staff_all" on public.gameday_sheets
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

-- Fixed category structure (permanent shape, per design discussion --
-- not meant to change): 13 sections across Offense, Blobs & Slobs,
-- Defense, and Specials.
create table if not exists public.gameday_calls (
  id         uuid primary key default gen_random_uuid(),
  sheet_id   uuid not null references public.gameday_sheets(id) on delete cascade,
  section    text not null check (section in (
    'offense_man_triggers', 'offense_man_sets', 'offense_zone',
    'blob_1st', 'blob_2nd', 'blob_zone',
    'slob_1st', 'slob_2nd',
    'defense_man', 'defense_zone', 'defense_press',
    'specials_press_break', 'specials_eog'
  )),
  call_name  text not null,
  play_id    uuid references public.plays(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists gameday_calls_sheet_idx on public.gameday_calls(sheet_id);

alter table public.gameday_calls enable row level security;

drop policy if exists "gameday_calls_staff_all" on public.gameday_calls;
create policy "gameday_calls_staff_all" on public.gameday_calls
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );
