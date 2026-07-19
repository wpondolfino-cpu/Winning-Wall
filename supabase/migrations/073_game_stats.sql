-- 073_game_stats.sql
-- Game Stats feature: coaches log every possession live (offense/defense),
-- the app computes team analytics (eFG%, OREB%, TOV%, transition%, PPP,
-- shot quality, set-play effectiveness, streaks) and rolls them up into
-- quarter/half/game/win-loss/season reports.
--
-- Possession model:
--   One row = one true offensive trip. An offensive rebound does NOT
--   start a new row -- it increments oreb_count on the same possession
--   and the trip stays open until a shot/turnover/FT-trip closes it.
--   This keeps "possession" counts correct for rate stats (eFG%, PPP)
--   instead of over-counting extra shots off an OREB as new possessions.
--
-- Publish model mirrors workout_groups / playbooks: a game starts as
-- 'draft' (coach-only) and is flipped to 'published' (visible to
-- players) explicitly, so a coach can review a report before the team
-- sees it.

-- ── Games ────────────────────────────────────────────────────
create table if not exists public.games (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references public.profiles(id) on delete cascade,
  opponent         text not null,
  game_date        date not null,
  season           text not null,
  home_away        text not null default 'home' check (home_away in ('home', 'away', 'neutral')),
  final_score_us   int,
  final_score_them int,
  status           text not null default 'draft' check (status in ('draft', 'published')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists games_season_idx on public.games(season);
create index if not exists games_status_idx on public.games(status);

alter table public.games enable row level security;

drop policy if exists "games_staff_all" on public.games;
create policy "games_staff_all" on public.games
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "games_players_read_published" on public.games;
create policy "games_players_read_published" on public.games
  for select using (status = 'published');

-- ── Play calls (coach-managed named plays, per category) ──────
create table if not exists public.play_calls (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (category in ('set', 'motion', 'blob', 'slob')),
  name       text not null,
  status     text not null default 'active' check (status in ('active', 'archived')),
  linked_play_id uuid references public.plays(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- play_calls may already exist from an earlier run of this migration
-- (before linked_play_id existed) -- "create table if not exists" would
-- skip it entirely in that case, so add the column explicitly too.
alter table public.play_calls add column if not exists linked_play_id uuid references public.plays(id) on delete set null;

create unique index if not exists play_calls_linked_play_unique on public.play_calls(linked_play_id) where linked_play_id is not null;

create index if not exists play_calls_category_idx on public.play_calls(category, status);

alter table public.play_calls enable row level security;

drop policy if exists "play_calls_staff_all" on public.play_calls;
create policy "play_calls_staff_all" on public.play_calls
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

-- ── Possessions ─────────────────────────────────────────────
create table if not exists public.possessions (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games(id) on delete cascade,
  team              text not null check (team in ('us', 'opponent')),
  quarter           int not null check (quarter between 1 and 8),
  sequence          int not null,

  possession_type   text not null check (possession_type in ('transition', 'half_court', 'blob', 'slob')),
  half_court_type   text check (half_court_type in ('set', 'motion')),
  play_call_id      uuid references public.play_calls(id) on delete set null,
  oob_result        text check (oob_result in ('score', 'flowed_half_court')),

  paint_touch       text check (paint_touch in ('single', 'both')),
  oreb_count        int not null default 0,

  outcome           text not null check (outcome in ('fg_made', 'fg_missed', 'turnover', 'ft_trip')),
  shot_type         int check (shot_type in (2, 3)),
  shot_quality      text check (shot_quality in ('great', 'good', 'live', 'tough')),
  turnover_type     text check (turnover_type in ('live', 'dead')),
  points            int not null default 0,

  created_by        uuid not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),

  constraint possessions_game_seq_unique unique (game_id, sequence)
);

create index if not exists possessions_game_idx on public.possessions(game_id, quarter);
create index if not exists possessions_play_call_idx on public.possessions(play_call_id);

alter table public.possessions enable row level security;

drop policy if exists "possessions_staff_all" on public.possessions;
create policy "possessions_staff_all" on public.possessions
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "possessions_players_read_published" on public.possessions;
create policy "possessions_players_read_published" on public.possessions
  for select using (
    exists (select 1 from public.games g where g.id = possessions.game_id and g.status = 'published')
  );

-- ── Stat goals (coach-set targets, used to color report rows) ─
create table if not exists public.stat_goals (
  id            uuid primary key default gen_random_uuid(),
  stat_key      text not null unique,
  target_value  numeric not null,
  direction     text not null check (direction in ('higher_better', 'lower_better')),
  updated_by    uuid not null references public.profiles(id) on delete cascade,
  updated_at    timestamptz not null default now()
);

alter table public.stat_goals enable row level security;

drop policy if exists "stat_goals_staff_all" on public.stat_goals;
create policy "stat_goals_staff_all" on public.stat_goals
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "stat_goals_players_read" on public.stat_goals;
create policy "stat_goals_players_read" on public.stat_goals
  for select using (true);

-- ── Saved reports (Reports tab history) ────────────────────────
-- Stores the *filters* a coach used to build a report, not a frozen
-- snapshot -- reopening one re-runs it against current data.
create table if not exists public.saved_reports (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  season       text not null,
  game_count   text not null check (game_count in ('3', '5', '10', 'season')),
  category     text not null check (category in ('all', 'transition', 'half_court', 'blob', 'slob')),
  created_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists saved_reports_season_idx on public.saved_reports(season);

alter table public.saved_reports enable row level security;

drop policy if exists "saved_reports_staff_all" on public.saved_reports;
create policy "saved_reports_staff_all" on public.saved_reports
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );
