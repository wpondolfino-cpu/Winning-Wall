-- 221_player_box_scores.sql
-- Individual stats: player box scores (imported from Hudl or typed in),
-- coach-controlled player view, and Hall of Fame game + team records.
--
--   game_box_scores        one row per game that has a box score (where it
--                          came from, whether players can see it)
--   player_box_lines       one row per player per game: the counting stats
--   player_stat_settings   per team: whose stats players see, which stats,
--                          and which count as Hall of Fame records
--   team_records           team records, worked out by the app on a coach's
--                          device and saved here so players can read them
--
-- Players never read the box score tables directly. They go through the
-- functions below, which only hand back the stats the coach has ticked —
-- so a hidden stat can't be dug out through the browser either.
--
-- Safe to run twice.

-- ── 1. Tables ─────────────────────────────────────────────────

create table if not exists public.game_box_scores (
  game_id    uuid primary key references public.games(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  roster_id  uuid references public.rosters(id) on delete set null,
  source     text not null default 'hudl' check (source in ('hudl', 'hand')),
  shared     boolean not null default true,
  saved_at   timestamptz not null default now(),
  saved_by   uuid references public.profiles(id) on delete set null
);

create table if not exists public.player_box_lines (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  game_id    uuid not null references public.game_box_scores(game_id) on delete cascade,
  player_id  uuid references public.profiles(id) on delete set null,
  jersey     int,
  name       text,
  pts  int not null default 0 check (pts  >= 0),
  fgm2 int not null default 0 check (fgm2 >= 0),
  fga2 int not null default 0 check (fga2 >= fgm2),
  fgm3 int not null default 0 check (fgm3 >= 0),
  fga3 int not null default 0 check (fga3 >= fgm3),
  ftm  int not null default 0 check (ftm  >= 0),
  fta  int not null default 0 check (fta  >= ftm),
  oreb int not null default 0 check (oreb >= 0),
  dreb int not null default 0 check (dreb >= 0),
  reb  int not null default 0 check (reb  >= 0),
  ast  int not null default 0 check (ast  >= 0),
  stl  int not null default 0 check (stl  >= 0),
  blk  int not null default 0 check (blk  >= 0),
  tov  int not null default 0 check (tov  >= 0),
  pf   int not null default 0 check (pf   >= 0),
  defl int not null default 0 check (defl >= 0),
  chg  int not null default 0 check (chg  >= 0)
);
create index if not exists player_box_lines_game_idx   on public.player_box_lines (game_id);
create index if not exists player_box_lines_player_idx on public.player_box_lines (player_id);
-- One line per player per game.
create unique index if not exists player_box_lines_game_player_uniq
  on public.player_box_lines (game_id, player_id) where player_id is not null;

create table if not exists public.player_stat_settings (
  roster_id  uuid primary key references public.rosters(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  whose      text not null default 'own' check (whose in ('off', 'own', 'team')),
  visible    text[] not null default array['points','shooting','rebounds','assists','steals','blocks',
                                           'deflections','charges','disruptions','impact'],
  hof        text[] not null default '{}',
  team_hof   text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.team_records (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  roster_id   uuid not null references public.rosters(id) on delete cascade,
  record_key  text not null,
  value       numeric not null,
  display     text not null,
  game_id     uuid references public.games(id) on delete cascade,
  season_id   uuid,
  season_name text,
  opponent    text,
  game_date   date,
  computed_at timestamptz not null default now()
);
create index if not exists team_records_roster_idx on public.team_records (roster_id, record_key);

-- program_id fills itself in, like every other table (175).
do $$
declare t text;
begin
  foreach t in array array['game_box_scores','player_box_lines','player_stat_settings','team_records'] loop
    execute format('drop trigger if exists set_program_id on public.%I', t);
    execute format('create trigger set_program_id before insert on public.%I for each row execute function public.set_program_id()', t);
  end loop;
end $$;

-- ── 2. Access ─────────────────────────────────────────────────
grant select, insert, update, delete on public.game_box_scores, public.player_box_lines,
  public.player_stat_settings, public.team_records to authenticated;
alter table public.game_box_scores      enable row level security;
alter table public.player_box_lines     enable row level security;
alter table public.player_stat_settings enable row level security;
alter table public.team_records         enable row level security;

-- Coaches: everything, in their program.
drop policy if exists "box_scores_staff_all" on public.game_box_scores;
create policy "box_scores_staff_all" on public.game_box_scores
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
drop policy if exists "box_lines_staff_all" on public.player_box_lines;
create policy "box_lines_staff_all" on public.player_box_lines
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
drop policy if exists "stat_settings_staff_all" on public.player_stat_settings;
create policy "stat_settings_staff_all" on public.player_stat_settings
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
drop policy if exists "team_records_staff_all" on public.team_records;
create policy "team_records_staff_all" on public.team_records
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- Players: the settings (so the app knows what to show) and the team
-- records the coach has put in the Hall of Fame. Nothing else directly.
drop policy if exists "stat_settings_member_read" on public.player_stat_settings;
create policy "stat_settings_member_read" on public.player_stat_settings
  for select using (true);
drop policy if exists "team_records_member_read" on public.team_records;
create policy "team_records_member_read" on public.team_records
  for select using (exists (
    select 1 from public.player_stat_settings s
    where s.roster_id = team_records.roster_id and team_records.record_key = any(s.team_hof)));

-- Fenced to the program you're in, like the rest of game stats (181).
select public.add_program_scope(t)
from unnest(array['game_box_scores','player_box_lines','player_stat_settings','team_records']) as t;

-- ── 3. Stat maths ─────────────────────────────────────────────
-- Same formulas as src/lib/boxScores.ts. Keep the two in step.

-- Which stat keys each "Players see" tick covers.
create or replace function public._box_group_keys(groups text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(k), '{}') from (
    select unnest(case g
      when 'points'      then array['pts']
      when 'shooting'    then array['fgm','fga','fg_pct','fgm2','fga2','fg2_pct','fgm3','fga3','fg3_pct','ftm','fta','ft_pct']
      when 'rebounds'    then array['oreb','dreb','reb']
      when 'assists'     then array['ast']
      when 'steals'      then array['stl']
      when 'blocks'      then array['blk']
      when 'deflections' then array['defl']
      when 'charges'     then array['chg']
      when 'turnovers'   then array['tov']
      when 'fouls'       then array['pf']
      when 'disruptions' then array['disruptions']
      when 'impact'      then array['impact']
      when 'efficiency'  then array['efg_pct','ts_pct','pps','rate3','ftr']
      when 'ast_to'      then array['ast_to']
      when 'share'       then array['share']
      else array[]::text[] end) as k
    from unnest(groups) g
  ) x;
$$;

-- The stat a Hall of Fame record is about, and the tick it needs.
create or replace function public._box_record_group(record_key text)
returns text language sql immutable as $$
  select case record_key
    when 'pts' then 'points' when 'reb' then 'rebounds' when 'oreb' then 'rebounds'
    when 'ast' then 'assists' when 'stl' then 'steals' when 'blk' then 'blocks'
    when 'defl' then 'deflections' when 'chg' then 'charges' when 'fgm3' then 'shooting'
    when 'disruptions' then 'disruptions' when 'impact' then 'impact' else null end;
$$;

-- Counting stats in, everything (counting + calculated) out.
-- team_use = the team's shots + 0.44 FTA + turnovers, for "share".
create or replace function public._box_calc(c jsonb, team_use numeric)
returns jsonb language plpgsql immutable as $$
declare
  pts numeric := coalesce((c->>'pts')::numeric, 0);
  fgm2 numeric := coalesce((c->>'fgm2')::numeric, 0); fga2 numeric := coalesce((c->>'fga2')::numeric, 0);
  fgm3 numeric := coalesce((c->>'fgm3')::numeric, 0); fga3 numeric := coalesce((c->>'fga3')::numeric, 0);
  ftm numeric := coalesce((c->>'ftm')::numeric, 0);  fta numeric := coalesce((c->>'fta')::numeric, 0);
  oreb numeric := coalesce((c->>'oreb')::numeric, 0); dreb numeric := coalesce((c->>'dreb')::numeric, 0);
  reb numeric := coalesce((c->>'reb')::numeric, 0);
  ast numeric := coalesce((c->>'ast')::numeric, 0);  stl numeric := coalesce((c->>'stl')::numeric, 0);
  blk numeric := coalesce((c->>'blk')::numeric, 0);  tov numeric := coalesce((c->>'tov')::numeric, 0);
  pf numeric := coalesce((c->>'pf')::numeric, 0);    defl numeric := coalesce((c->>'defl')::numeric, 0);
  chg numeric := coalesce((c->>'chg')::numeric, 0);
  fgm numeric := fgm2 + fgm3; fga numeric := fga2 + fga3;
  tsa numeric := fga + 0.44 * fta;
begin
  return jsonb_build_object(
    'pts', pts, 'fgm2', fgm2, 'fga2', fga2, 'fgm3', fgm3, 'fga3', fga3, 'ftm', ftm, 'fta', fta,
    'oreb', oreb, 'dreb', dreb, 'reb', reb, 'ast', ast, 'stl', stl, 'blk', blk, 'tov', tov,
    'pf', pf, 'defl', defl, 'chg', chg,
    'fgm', fgm, 'fga', fga,
    'fg_pct',  case when fga  > 0 then round(fgm  / fga  * 100, 1) end,
    'fg2_pct', case when fga2 > 0 then round(fgm2 / fga2 * 100, 1) end,
    'fg3_pct', case when fga3 > 0 then round(fgm3 / fga3 * 100, 1) end,
    'ft_pct',  case when fta  > 0 then round(ftm  / fta  * 100, 1) end,
    'efg_pct', case when fga  > 0 then round((fgm + 0.5 * fgm3) / fga * 100, 1) end,
    'ts_pct',  case when tsa  > 0 then round(pts / (2 * tsa) * 100, 1) end,
    'pps',     case when tsa  > 0 then round(pts / tsa, 2) end,
    'rate3',   case when fga  > 0 then round(fga3 / fga * 100, 1) end,
    'ftr',     case when fga  > 0 then round(fta / fga, 2) end,
    'ast_to',  case when tov  > 0 then round(ast / tov, 2) end,
    'disruptions', stl + blk + defl + chg,
    'impact', round(pts + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm) + 0.7 * oreb + 0.3 * dreb
                    + stl + 0.7 * ast + 0.7 * blk - 0.4 * pf - tov + 0.5 * defl + chg, 1),
    'share',   case when coalesce(team_use, 0) > 0 then round((fga + 0.44 * fta + tov) / team_use * 100, 1) end
  );
end $$;

create or replace function public._box_counts(l public.player_box_lines)
returns jsonb language sql immutable as $$
  select jsonb_build_object('pts', l.pts, 'fgm2', l.fgm2, 'fga2', l.fga2, 'fgm3', l.fgm3, 'fga3', l.fga3,
    'ftm', l.ftm, 'fta', l.fta, 'oreb', l.oreb, 'dreb', l.dreb, 'reb', l.reb, 'ast', l.ast, 'stl', l.stl,
    'blk', l.blk, 'tov', l.tov, 'pf', l.pf, 'defl', l.defl, 'chg', l.chg);
$$;

create or replace function public._jsonb_only(j jsonb, keys text[])
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(j) e(k, v) where k = any(keys);
$$;

-- The settings for a team, with defaults when the coach hasn't saved any.
create or replace function public._stat_settings(p_roster uuid)
returns public.player_stat_settings language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s from public.player_stat_settings s where s.roster_id = p_roster),
    row(p_roster, null, 'own',
        array['points','shooting','rebounds','assists','steals','blocks','deflections','charges','disruptions','impact'],
        '{}'::text[], '{}'::text[], now())::public.player_stat_settings);
$$;

-- ── 4. Reading box scores ─────────────────────────────────────
-- Coaches get every stat for every game. Players get only shared games,
-- only the lines their coach allows (their own, or the whole team), and
-- only the ticked stats.
create or replace function public.player_box_scores(
  p_game uuid default null, p_player uuid default null, p_season uuid default null)
returns table (game_id uuid, player_id uuid, jersey int, name text, opponent text, game_date date,
               game_type text, season_id uuid, roster_id uuid, source text, shared boolean, stats jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_pid   uuid := public.current_program_id();
  v_staff boolean := v_pid is not null and public.is_program_staff(v_pid, v_uid);
  v_home  uuid := (select p.home_roster_id from public.profiles p where p.id = v_uid);
begin
  if v_pid is null then return; end if;
  return query
  with lines as (
    select x.game_id, x.player_id, x.jersey, x.name, public._box_counts(x) as counts,
           sum(x.fga2 + x.fga3 + 0.44 * x.fta + x.tov) over (partition by x.game_id) as team_use
    from public.player_box_lines x
    where x.program_id = v_pid and (p_game is null or x.game_id = p_game)
  )
  select l.game_id, l.player_id, l.jersey,
         coalesce(pr.name, l.name, '#' || l.jersey::text),
         g.opponent, g.game_date, g.game_type, g.season_id, b.roster_id, b.source, b.shared,
         case when v_staff then public._box_calc(l.counts, l.team_use)
              else public._jsonb_only(public._box_calc(l.counts, l.team_use),
                                      public._box_group_keys(st.visible)) end
  from lines l
  join public.game_box_scores b on b.game_id = l.game_id
  join public.games g on g.id = l.game_id
  left join public.profiles pr on pr.id = l.player_id
  cross join lateral public._stat_settings(b.roster_id) st
  where (p_player is null or l.player_id = p_player)
    and (p_season is null or g.season_id = p_season)
    and (v_staff or (
          b.shared and st.whose <> 'off'
          and (l.player_id = v_uid
               or (st.whose = 'team' and (b.roster_id = v_home
                   or exists (select 1 from public.player_box_lines m where m.game_id = l.game_id and m.player_id = v_uid))))))
  order by g.game_date desc, l.jersey nulls last;
end $$;

-- One player's season for their Profile: games, totals, per-game averages,
-- and the team's average Impact Score. Only ticked stats come back.
-- Counts regular season and postseason games, like the Hall of Fame.
create or replace function public.player_season_summary(p_player uuid default null, p_season uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_pid   uuid := public.current_program_id();
  v_staff boolean := v_pid is not null and public.is_program_staff(v_pid, v_uid);
  v_who   uuid := coalesce(p_player, v_uid);
  v_home  uuid := (select p.home_roster_id from public.profiles p where p.id = v_who);
  st      public.player_stat_settings := public._stat_settings(v_home);
  v_keys  text[];
  v_tot   jsonb;
  v_games int;
  v_avg   jsonb := '{}';
  v_use   numeric;
  v_team_impact numeric;
  k text;
begin
  if v_pid is null then return null; end if;
  if v_who <> v_uid and not v_staff then return null; end if;
  if not v_staff and st.whose = 'off' then return jsonb_build_object('whose', 'off'); end if;
  v_keys := case when v_staff then null else public._box_group_keys(st.visible) end;

  select count(*),
         jsonb_build_object('pts', sum(l.pts), 'fgm2', sum(l.fgm2), 'fga2', sum(l.fga2), 'fgm3', sum(l.fgm3),
           'fga3', sum(l.fga3), 'ftm', sum(l.ftm), 'fta', sum(l.fta), 'oreb', sum(l.oreb), 'dreb', sum(l.dreb),
           'reb', sum(l.reb), 'ast', sum(l.ast), 'stl', sum(l.stl), 'blk', sum(l.blk), 'tov', sum(l.tov),
           'pf', sum(l.pf), 'defl', sum(l.defl), 'chg', sum(l.chg))
    into v_games, v_tot
  from public.player_box_lines l
  join public.game_box_scores b on b.game_id = l.game_id
  join public.games g on g.id = l.game_id
  where l.program_id = v_pid and l.player_id = v_who
    and (v_staff or b.shared)
    and g.game_type in ('regular', 'postseason')
    and (p_season is null or g.season_id = p_season);

  if v_games = 0 then return jsonb_build_object('games', 0, 'whose', st.whose); end if;

  -- The team's shots + FTs + turnovers in the games this player played, for share.
  select sum(t.fga2 + t.fga3 + 0.44 * t.fta + t.tov) into v_use
  from public.player_box_lines t
  where t.game_id in (select l.game_id from public.player_box_lines l
                      join public.games g on g.id = l.game_id
                      join public.game_box_scores b on b.game_id = l.game_id
                      where l.player_id = v_who and l.program_id = v_pid and (v_staff or b.shared)
                        and g.game_type in ('regular', 'postseason')
                        and (p_season is null or g.season_id = p_season));

  v_tot := public._box_calc(v_tot, v_use);

  -- Per game: counting stats and the two counting-style ratings only;
  -- percentages are already rates, so they stay as season figures.
  foreach k in array array['pts','fgm2','fga2','fgm3','fga3','ftm','fta','oreb','dreb','reb','ast','stl','blk',
                           'tov','pf','defl','chg','fgm','fga','disruptions','impact'] loop
    v_avg := v_avg || jsonb_build_object(k, round((v_tot->>k)::numeric / v_games, 1));
  end loop;

  -- The team's average Impact Score per player-game, same team and season.
  select round(avg((public._box_calc(public._box_counts(t), null)->>'impact')::numeric), 1)
    into v_team_impact
  from public.player_box_lines t
  join public.game_box_scores b on b.game_id = t.game_id
  join public.games g on g.id = t.game_id
  where t.program_id = v_pid and b.roster_id = v_home and (v_staff or b.shared)
    and g.game_type in ('regular', 'postseason')
    and (p_season is null or g.season_id = p_season);

  return jsonb_build_object(
    'games', v_games,
    'whose', st.whose,
    'totals',   case when v_keys is null then v_tot else public._jsonb_only(v_tot, v_keys) end,
    'per_game', case when v_keys is null then v_avg else public._jsonb_only(v_avg, v_keys) end,
    'team_avg_impact', case when v_keys is null or 'impact' = any(v_keys) then v_team_impact end);
end $$;

-- ── 5. Hall of Fame: game records ─────────────────────────────
-- Best single game for each stat the coach has ticked for the Hall of
-- Fame (and lets players see). Regular season and postseason games only.
-- Ties come back as several rows.
create or replace function public.game_records(p_roster uuid)
returns table (record_key text, value numeric, player_id uuid, name text,
               game_id uuid, opponent text, game_date date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_pid uuid := public.current_program_id();
  st public.player_stat_settings := public._stat_settings(p_roster);
begin
  if v_pid is null then return; end if;
  return query
  with keys as (
    select h as k from unnest(st.hof) h
    where public._box_record_group(h) = any(st.visible)
  ), vals as (
    select k.k, (public._box_calc(public._box_counts(l), null)->>k.k)::numeric as v,
           l.player_id, coalesce(pr.name, l.name, '#' || l.jersey::text) as nm,
           l.game_id, g.opponent, g.game_date
    from keys k
    cross join public.player_box_lines l
    join public.game_box_scores b on b.game_id = l.game_id
    join public.games g on g.id = l.game_id
    left join public.profiles pr on pr.id = l.player_id
    where l.program_id = v_pid and b.roster_id = p_roster and b.shared
      and g.game_type in ('regular', 'postseason')
  ), best as (select k, max(v) as m from vals group by k)
  select v.k, v.v, v.player_id, v.nm, v.game_id, v.opponent, v.game_date
  from vals v join best on best.k = v.k and v.v = best.m
  where best.m > 0
  order by v.k, v.game_date;
end $$;

-- ── 6. Writing (coaches) ──────────────────────────────────────

-- Replace a game's box score in one go. p_lines is a list of
-- {player_id, jersey, name, pts, fgm2, fga2, ...}. Checks that each line
-- adds up before anything is saved.
create or replace function public.save_box_score(p_game uuid, p_source text, p_shared boolean, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  g public.games;
  r record;
  n int := 0;
begin
  select * into g from public.games where id = p_game;
  if g.id is null or g.program_id is distinct from public.current_program_id()
     or not public.is_program_staff(g.program_id, auth.uid()) then
    raise exception 'Only coaches can save a box score for this game.';
  end if;
  if p_source not in ('hudl', 'hand') then raise exception 'Unknown source.'; end if;

  for r in select * from jsonb_to_recordset(p_lines) as x(
      player_id uuid, jersey int, name text, pts int, fgm2 int, fga2 int, fgm3 int, fga3 int, ftm int, fta int,
      oreb int, dreb int, reb int, ast int, stl int, blk int, tov int, pf int, defl int, chg int) loop
    if coalesce(r.pts, 0) <> 2 * coalesce(r.fgm2, 0) + 3 * coalesce(r.fgm3, 0) + coalesce(r.ftm, 0) then
      raise exception '#%: points (%) don''t match made shots (% twos, % threes, % free throws).',
        coalesce(r.jersey::text, r.name), r.pts, r.fgm2, r.fgm3, r.ftm;
    end if;
  end loop;

  insert into public.game_box_scores (game_id, program_id, roster_id, source, shared, saved_at, saved_by)
  values (p_game, g.program_id, g.roster_id, p_source, coalesce(p_shared, true), now(), auth.uid())
  on conflict (game_id) do update
    set roster_id = excluded.roster_id, source = excluded.source, shared = excluded.shared,
        saved_at = now(), saved_by = auth.uid();

  delete from public.player_box_lines where game_id = p_game;

  insert into public.player_box_lines (program_id, game_id, player_id, jersey, name,
    pts, fgm2, fga2, fgm3, fga3, ftm, fta, oreb, dreb, reb, ast, stl, blk, tov, pf, defl, chg)
  select g.program_id, p_game, x.player_id, x.jersey, nullif(trim(x.name), ''),
    coalesce(x.pts,0), coalesce(x.fgm2,0), coalesce(x.fga2,0), coalesce(x.fgm3,0), coalesce(x.fga3,0),
    coalesce(x.ftm,0), coalesce(x.fta,0), coalesce(x.oreb,0), coalesce(x.dreb,0),
    coalesce(x.reb, coalesce(x.oreb,0) + coalesce(x.dreb,0)), coalesce(x.ast,0), coalesce(x.stl,0),
    coalesce(x.blk,0), coalesce(x.tov,0), coalesce(x.pf,0), coalesce(x.defl,0), coalesce(x.chg,0)
  from jsonb_to_recordset(p_lines) as x(
      player_id uuid, jersey int, name text, pts int, fgm2 int, fga2 int, fgm3 int, fga3 int, ftm int, fta int,
      oreb int, dreb int, reb int, ast int, stl int, blk int, tov int, pf int, defl int, chg int);
  get diagnostics n = row_count;
  return n;
end $$;

-- Team records, worked out by the app on a coach's device. Replaces the
-- team's whole set so a record that's been beaten (or a game deleted)
-- doesn't hang around.
create or replace function public.replace_team_records(p_roster uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid := (select program_id from public.rosters where id = p_roster);
  n int := 0;
begin
  if v_pid is null or v_pid is distinct from public.current_program_id()
     or not public.is_program_staff(v_pid, auth.uid()) then
    raise exception 'Only coaches can update team records.';
  end if;
  delete from public.team_records where roster_id = p_roster;
  insert into public.team_records (program_id, roster_id, record_key, value, display, game_id,
                                   season_id, season_name, opponent, game_date)
  select v_pid, p_roster, x.record_key, x.value, x.display, x.game_id, x.season_id, x.season_name,
         x.opponent, x.game_date
  from jsonb_to_recordset(p_rows) as x(record_key text, value numeric, display text, game_id uuid,
                                        season_id uuid, season_name text, opponent text, game_date date);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public._box_calc(jsonb, numeric), public._box_counts(public.player_box_lines),
  public._jsonb_only(jsonb, text[]), public._stat_settings(uuid) from public, anon;
grant execute on function public.player_box_scores(uuid, uuid, uuid), public.player_season_summary(uuid, uuid),
  public.game_records(uuid), public.save_box_score(uuid, text, boolean, jsonb),
  public.replace_team_records(uuid, jsonb) to authenticated;
revoke execute on function public.player_box_scores(uuid, uuid, uuid), public.player_season_summary(uuid, uuid),
  public.game_records(uuid), public.save_box_score(uuid, text, boolean, jsonb),
  public.replace_team_records(uuid, jsonb) from anon;

-- ── 7. Check ──────────────────────────────────────────────────
select 'box score tables' as item, count(*)::text as value
from information_schema.tables
where table_schema = 'public'
  and table_name in ('game_box_scores','player_box_lines','player_stat_settings','team_records');
