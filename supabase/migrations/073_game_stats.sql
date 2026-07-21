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
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists games_season_idx on public.games(season);
create index if not exists games_status_idx on public.games(status);

-- games may already exist from an earlier run of this migration (before
-- notes existed) -- add it explicitly for that case too.
alter table public.games add column if not exists notes text;

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

  possession_type   text not null check (possession_type in ('transition', 'half_court', 'blob', 'slob', 'press')),
  defense_scheme    text check (defense_scheme in ('man', 'zone')),
  press_result      text check (press_result in ('turnover', 'man', 'zone')),
  half_court_type   text check (half_court_type in ('set', 'motion')),
  play_call_id      uuid references public.play_calls(id) on delete set null,
  oob_result        text check (oob_result in ('direct_shot', 'flowed_half_court', 'turnover')),

  paint_touch       boolean not null default false,
  paint_touch_both_sides boolean not null default false,
  oreb_count        int not null default 0,
  missed_fg_count   int not null default 0,

  outcome           text not null check (outcome in ('fg_made', 'fg_missed', 'turnover', 'ft_trip')),
  shot_type         int check (shot_type in (2, 3)),
  shot_quality      text check (shot_quality in ('great', 'good', 'live', 'tough')),
  turnover_type     text check (turnover_type in ('live', 'dead')),
  ft_attempts       int check (ft_attempts between 1 and 3),
  absorbed_ft_attempts int not null default 0,
  absorbed_ft_made  int not null default 0,
  points            int not null default 0,

  created_by        uuid not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),

  constraint possessions_game_seq_unique unique (game_id, sequence)
);

create index if not exists possessions_game_idx on public.possessions(game_id, quarter);
create index if not exists possessions_play_call_idx on public.possessions(play_call_id);

-- possessions may already exist from an earlier run of this migration
-- (before ft_attempts existed) -- add it explicitly for that case too.
alter table public.possessions add column if not exists ft_attempts int;
alter table public.possessions drop constraint if exists possessions_ft_attempts_check;
alter table public.possessions add constraint possessions_ft_attempts_check check (ft_attempts is null or ft_attempts between 1 and 3);
alter table public.possessions add column if not exists missed_fg_count int not null default 0;
alter table public.possessions add column if not exists absorbed_ft_attempts int not null default 0;
alter table public.possessions add column if not exists absorbed_ft_made int not null default 0;

-- Defensive scheme tracking (Man/Zone/Press) -- possession_type needs
-- 'press' added to its allowed values, plus two new nullable columns.
alter table public.possessions drop constraint if exists possessions_possession_type_check;
alter table public.possessions add constraint possessions_possession_type_check
  check (possession_type in ('transition', 'half_court', 'blob', 'slob', 'press'));
alter table public.possessions add column if not exists defense_scheme text;
alter table public.possessions drop constraint if exists possessions_defense_scheme_check;
alter table public.possessions add constraint possessions_defense_scheme_check check (defense_scheme is null or defense_scheme in ('man', 'zone'));
alter table public.possessions add column if not exists press_result text;
alter table public.possessions drop constraint if exists possessions_press_result_check;
alter table public.possessions add constraint possessions_press_result_check check (press_result is null or press_result in ('turnover', 'man', 'zone'));

-- paint_touch used to be a single text field ('single'/'both'), mutually
-- exclusive. Now it's two independent booleans -- a possession can touch
-- the paint on one side, both sides, or neither, without one excluding
-- the other. Guarded so this only runs once even if the migration is
-- re-run after the conversion has already happened.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'possessions' and column_name = 'paint_touch' and data_type = 'text'
  ) then
    alter table public.possessions add column if not exists paint_touch_bool boolean not null default false;
    alter table public.possessions add column if not exists paint_touch_both_sides boolean not null default false;
    update public.possessions set paint_touch_bool = true where paint_touch is not null;
    update public.possessions set paint_touch_both_sides = true where paint_touch = 'both';
    alter table public.possessions drop column paint_touch;
    alter table public.possessions rename column paint_touch_bool to paint_touch;
  else
    alter table public.possessions add column if not exists paint_touch boolean not null default false;
    alter table public.possessions add column if not exists paint_touch_both_sides boolean not null default false;
  end if;
end $$;

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
  stat_key      text not null,
  team          text not null default 'us' check (team in ('us', 'opponent')),
  target_value  numeric not null,
  direction     text not null check (direction in ('higher_better', 'lower_better')),
  updated_by    uuid not null references public.profiles(id) on delete cascade,
  updated_at    timestamptz not null default now()
);

-- team may not exist yet if this table was created before opponent-specific
-- goals were added -- add it explicitly for that case too.
alter table public.stat_goals add column if not exists team text not null default 'us';
alter table public.stat_goals drop constraint if exists stat_goals_team_check;
alter table public.stat_goals add constraint stat_goals_team_check check (team in ('us', 'opponent'));
alter table public.stat_goals drop constraint if exists stat_goals_stat_key_key;
drop index if exists stat_goals_stat_key_team_unique;
create unique index stat_goals_stat_key_team_unique on public.stat_goals(stat_key, team);

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

-- oob_result now reflects a 3-way branch (Shot / Turnover / Set-Motion)
-- instead of the old binary Score/Flowed -- migrate existing data first,
-- since the old constraint has to come off before 'direct_shot' rows can
-- be written.
alter table public.possessions drop constraint if exists possessions_oob_result_check;
update public.possessions set oob_result = 'direct_shot' where oob_result = 'score';
alter table public.possessions add constraint possessions_oob_result_check
  check (oob_result in ('direct_shot', 'flowed_half_court', 'turnover'));

-- ── Report layout (custom stat ordering) ───────────────────────
-- Single-row table (always read/written as "the latest row") holding the
-- coach's preferred stat display order. Any stat key not present in
-- stat_order (e.g. a newly added stat) falls back to the built-in default
-- order -- see resolveStatOrder() in gameStats.ts.
create table if not exists public.report_layout (
  id           uuid primary key default gen_random_uuid(),
  stat_order   jsonb not null default '[]'::jsonb,
  updated_by   uuid not null references public.profiles(id) on delete cascade,
  updated_at   timestamptz not null default now()
);

alter table public.report_layout enable row level security;

drop policy if exists "report_layout_staff_write" on public.report_layout;
create policy "report_layout_staff_write" on public.report_layout
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin'))
  );

drop policy if exists "report_layout_read" on public.report_layout;
create policy "report_layout_read" on public.report_layout
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
