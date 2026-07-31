-- 089_scout_sheets.sql
-- Scout Sheet feature. Persistence model, as discussed:
--   - opponents: a real, reusable entity (like a second roster, but for
--     teams) — a game and a scout sheet both point at one, instead of
--     free-typing a name each time.
--   - one scout sheet per game (games.opponent_id links a game to its
--     opponent). Rematches and next-season meetings are just new games
--     with new scout sheets -- history is never overwritten, "last 5"
--     is a display window, not a retention limit.
--   - the branching/conditional parts (Defense's Man/Zone cascade) are
--     stored as jsonb rather than exploded into dozens of nullable
--     columns, since the frontend owns that shape and it's still
--     opt-in/additive either way.

-- ── Opponents (persistent team identity) ───────────────────────
create table if not exists public.opponents (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  logo_url   text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.opponents enable row level security;

drop policy if exists "opponents_staff_all" on public.opponents;
create policy "opponents_staff_all" on public.opponents
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "opponents_players_read" on public.opponents;
create policy "opponents_players_read" on public.opponents
  for select using (true);

-- ── Link games to a real opponent (additive; existing free-text
--    `opponent` column on games is untouched, stays as a fallback) ──
alter table public.games add column if not exists opponent_id uuid references public.opponents(id) on delete set null;
create index if not exists games_opponent_id_idx on public.games(opponent_id);

-- ── Scout sheets (one per game) ─────────────────────────────────
create table if not exists public.scout_sheets (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null unique references public.games(id) on delete cascade,
  opponent_id    uuid not null references public.opponents(id) on delete cascade,
  team_record    text,
  tempo          text,
  keys_to_game   text[] not null default '{}',
  status         text not null default 'draft' check (status in ('draft', 'published')),
  print_selected_player_ids uuid[] not null default '{}', -- coach's "pick 9" choice, remembered for next print
  created_by     uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists scout_sheets_opponent_idx on public.scout_sheets(opponent_id);

alter table public.scout_sheets enable row level security;

drop policy if exists "scout_sheets_staff_all" on public.scout_sheets;
create policy "scout_sheets_staff_all" on public.scout_sheets
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "scout_sheets_players_read_published" on public.scout_sheets;
create policy "scout_sheets_players_read_published" on public.scout_sheets
  for select using (status = 'published');

-- ── Opponent roster per scout sheet ──────────────────────────────
create table if not exists public.scout_players (
  id                   uuid primary key default gen_random_uuid(),
  scout_sheet_id       uuid not null references public.scout_sheets(id) on delete cascade,
  name                 text not null,
  number               text,
  position             text,
  height               text,
  grade                text,
  dominant_hand        text check (dominant_hand is null or dominant_hand in ('R', 'L')),
  is_starter           boolean not null default false,
  markers              text[] not null default '{}', -- subset of star/dart/turtle, max 2 enforced in app
  assigned_to_profile_id uuid references public.profiles(id) on delete set null,
  offensive_strengths  text[] not null default '{}',
  plan_to_guard        text[] not null default '{}',
  defensive_strengths  text[] not null default '{}',
  plan_to_attack       text[] not null default '{}',
  notes                text,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);

create index if not exists scout_players_sheet_idx on public.scout_players(scout_sheet_id);

alter table public.scout_players enable row level security;

drop policy if exists "scout_players_staff_all" on public.scout_players;
create policy "scout_players_staff_all" on public.scout_players
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "scout_players_players_read_published" on public.scout_players;
create policy "scout_players_players_read_published" on public.scout_players
  for select using (
    exists (select 1 from public.scout_sheets s where s.id = scout_sheet_id and s.status = 'published')
  );

-- ── Offense: favorite sets/calls (repeatable) ───────────────────
create table if not exists public.scout_offense_sets (
  id             uuid primary key default gen_random_uuid(),
  scout_sheet_id uuid not null references public.scout_sheets(id) on delete cascade,
  call_name      text not null,
  description    text,       -- richtext markup (src/lib/richtext.ts)
  plan_to_defend text,       -- richtext markup
  video_url      text,
  play_id        uuid references public.plays(id) on delete set null,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists scout_offense_sets_sheet_idx on public.scout_offense_sets(scout_sheet_id);

alter table public.scout_offense_sets enable row level security;

drop policy if exists "scout_offense_sets_staff_all" on public.scout_offense_sets;
create policy "scout_offense_sets_staff_all" on public.scout_offense_sets
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "scout_offense_sets_players_read_published" on public.scout_offense_sets;
create policy "scout_offense_sets_players_read_published" on public.scout_offense_sets
  for select using (
    exists (select 1 from public.scout_sheets s where s.id = scout_sheet_id and s.status = 'published')
  );

-- ── Specials: BLOB / SLOB (repeatable, same shape as offense sets) ──
create table if not exists public.scout_specials (
  id             uuid primary key default gen_random_uuid(),
  scout_sheet_id uuid not null references public.scout_sheets(id) on delete cascade,
  kind           text not null check (kind in ('blob', 'slob')),
  call_name      text not null,
  description    text,
  plan_to_defend text,
  video_url      text,
  play_id        uuid references public.plays(id) on delete set null,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists scout_specials_sheet_idx on public.scout_specials(scout_sheet_id);

alter table public.scout_specials enable row level security;

drop policy if exists "scout_specials_staff_all" on public.scout_specials;
create policy "scout_specials_staff_all" on public.scout_specials
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "scout_specials_players_read_published" on public.scout_specials;
create policy "scout_specials_players_read_published" on public.scout_specials
  for select using (
    exists (select 1 from public.scout_sheets s where s.id = scout_sheet_id and s.status = 'published')
  );

-- ── Defense: primary / secondary / press / blob_slob_d ──────────
-- One row per slot per scout sheet. `data` holds whatever shape that
-- slot needs (the Man/Zone cascade for primary+secondary, flat chips
-- for press and blob_slob_d) -- kept as jsonb rather than dozens of
-- nullable columns since the frontend owns this branching shape.
create table if not exists public.scout_defense (
  id             uuid primary key default gen_random_uuid(),
  scout_sheet_id uuid not null references public.scout_sheets(id) on delete cascade,
  slot           text not null check (slot in ('primary', 'secondary', 'press', 'blob_slob_d')),
  data           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (scout_sheet_id, slot)
);

create index if not exists scout_defense_sheet_idx on public.scout_defense(scout_sheet_id);

alter table public.scout_defense enable row level security;

drop policy if exists "scout_defense_staff_all" on public.scout_defense;
create policy "scout_defense_staff_all" on public.scout_defense
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "scout_defense_players_read_published" on public.scout_defense;
create policy "scout_defense_players_read_published" on public.scout_defense
  for select using (
    exists (select 1 from public.scout_sheets s where s.id = scout_sheet_id and s.status = 'published')
  );
