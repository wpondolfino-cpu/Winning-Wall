-- 102_lineup_shifts.sql
-- Phase 1 of the lineup tracker: capture only.
--
-- Design notes worth keeping with the schema:
--
-- SHIFTS, NOT LINEUPS. A "lineup" is just a distinct set of five players;
-- what actually gets stored is a shift -- one continuous stretch with the
-- same five on the floor. Lineups are derived by grouping shifts, which
-- means fixing a mis-entered sub is one row edit instead of forty, and the
-- shift log itself (Q2 #28-#34, 7 poss, +5) falls out for free.
--
-- POSSESSIONS ARE NOT TOUCHED. A shift records where it STARTS
-- (start_sequence) and the possessions it covers are derived: a possession
-- belongs to the latest shift whose start_sequence is <= its own. So
-- nothing writes to the possessions table, and the live tracker is
-- completely unaffected by any of this.
--
-- SHIFTS NEVER SPAN A PERIOD. Enforced by carrying `quarter` here and
-- forcing a boundary at each period change. Makes validation trivial and
-- matches how a coach thinks about subs anyway.
--
-- COACH-ONLY. Unlike game reports, none of this is ever published to
-- players -- lineup +/- is noisy enough early on that a player comparing
-- their number to a teammate's would be reading mostly luck.

-- ── Which roster a game's players come from ──────────────────────
-- Roster membership lives on profiles.home_roster_id, so without this the
-- shift entry screen has no way to know whether to offer varsity, JV, or
-- everyone. Nullable: existing games predate it and fall back to showing
-- every player.
alter table public.games
  add column if not exists roster_id uuid references public.rosters(id) on delete set null;

create index if not exists games_roster_id_idx on public.games(roster_id);

-- ── Shifts ───────────────────────────────────────────────────────
create table if not exists public.shifts (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games(id) on delete cascade,
  quarter        int  not null check (quarter between 1 and 12),
  -- The possession sequence this five came on for. Possessions at or after
  -- it belong to this shift until the next shift starts.
  start_sequence int  not null,
  -- Exactly five players. Stored as an array rather than five columns so
  -- combos (pairs, trios, exact fives) are one containment query each.
  player_ids     uuid[] not null,
  -- Opportunistic: the game clock when this five came on, if it happened to
  -- be legible on film. Never required -- the minutes estimator falls back
  -- to allocating each period's length across its possessions.
  start_clock_seconds int,
  -- Where the shift came from, so live-captured data can be told apart from
  -- film-entered data later if it turns out to be noisier.
  source         text not null default 'post_game'
                 check (source in ('post_game', 'live')),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint shifts_five_players check (array_length(player_ids, 1) = 5),
  constraint shifts_game_seq_unique unique (game_id, start_sequence)
);

create index if not exists shifts_game_idx on public.shifts(game_id, start_sequence);

-- ── Lineup events (foul trouble) ─────────────────────────────────
-- Deliberately not a foul COUNT. What the rotation feature needs is "when
-- did foul trouble constrain me", not raw totals -- and this costs one tap
-- during entry instead of copying a scorebook column.
create table if not exists public.lineup_events (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  quarter    int  not null check (quarter between 1 and 12),
  sequence   int  not null,
  player_id  uuid not null references public.profiles(id) on delete cascade,
  event_type text not null default 'foul_trouble'
             check (event_type in ('foul_trouble')),
  -- Which foul it was. "He had foul trouble" is much less useful than
  -- "he picked up his 3rd with 5:00 left in the second".
  detail     text check (detail in ('2nd', '3rd', '4th', '5th')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lineup_events_game_idx on public.lineup_events(game_id, sequence);

-- ── RLS: coach/admin only, read and write ────────────────────────
alter table public.shifts enable row level security;
alter table public.lineup_events enable row level security;

drop policy if exists shifts_coach_all on public.shifts;
create policy shifts_coach_all on public.shifts
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists lineup_events_coach_all on public.lineup_events;
create policy lineup_events_coach_all on public.lineup_events
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );
