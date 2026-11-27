// src/components/stats/PlayerStatsTab.tsx
// Game Stats → Players (coaches). Season player stats from box scores,
// which games have one, and the Player view settings.
//
// For games that also have lineup shifts, a few extra stats use the
// estimated minutes from shift entry: minutes, usage, per-32 rates and
// steals per 100 possessions. Coach-only, and labelled as estimates.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import { getRosters, type RosterWithCount } from "../../lib/practicePlanner";
import { calcStats, getBoxMetas, getBoxRows, possessionsUsed, sumCounts, COUNT_KEYS, type BoxMeta, type BoxRow, type BoxStats } from "../../lib/boxScores";
import { useLineupData } from "../../lib/useLineupData";
import { computeComboRows } from "../../lib/lineupStats";
import BoxScoreTable, { type ExtraColumn, type TableRow } from "./BoxScoreTable";
import BoxScoreImport from "./BoxScoreImport";
import PlayerViewSettings from "./PlayerViewSettings";
import { recomputeTeamRecords } from "../../lib/teamRecords";

interface GameRow { id: string; opponent: string; game_date: string; game_type: string; season_id: string | null; roster_id: string | null }

const btn: CSSProperties = {
  background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const pill = (on: boolean): CSSProperties => ({
  ...btn, padding: "5px 10px", background: on ? "var(--royal)" : "var(--surface2)", color: on ? "#fff" : "var(--muted)", borderColor: on ? "var(--royal)" : "var(--border)",
});
const selectStyle: CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };
const COUNTED = new Set(["regular", "postseason"]);

export default function PlayerStatsTab() {
  const [rosters, setRosters] = useState<RosterWithCount[]>([]);
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<{ id: string; name: string }[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [allTypes, setAllTypes] = useState(false);
  const [perGame, setPerGame] = useState(true);
  const [games, setGames] = useState<GameRow[]>([]);
  const [metas, setMetas] = useState<Map<string, BoxMeta>>(new Map());
  const [rows, setRows] = useState<BoxRow[]>([]);
  const [editing, setEditing] = useState<GameRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    getRosters().then((r) => { setRosters(r); setRosterId((cur) => cur ?? r[0]?.id ?? null); });
    supabase.from("seasons").select("id, name, start_date").order("start_date", { ascending: false })
      .then(({ data }) => { const s = (data ?? []) as any[]; setSeasons(s); setSeasonId((cur) => cur ?? s[0]?.id ?? null); });
  }, []);

  useEffect(() => {
    if (!rosterId) return;
    setErr(null);
    (async () => {
      try {
        let q = supabase.from("games").select("id, opponent, game_date, game_type, season_id, roster_id").eq("roster_id", rosterId).order("game_date", { ascending: false });
        if (seasonId) q = q.eq("season_id", seasonId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const g = (data ?? []) as GameRow[];
        setGames(g);
        setMetas(await getBoxMetas(g.map((x) => x.id)));
        const r = await getBoxRows({ seasonId: seasonId ?? undefined });
        setRows(r.filter((x) => g.some((gg) => gg.id === x.game_id)));
      } catch (e: any) { setErr(e?.message ?? "Couldn't load player stats."); }
    })();
    recomputeTeamRecords(rosterId).catch(() => {});
  }, [rosterId, seasonId, tick]);

  const countedGames = useMemo(() => games.filter((g) => allTypes || COUNTED.has(g.game_type)), [games, allTypes]);
  const countedIds = useMemo(() => new Set(countedGames.map((g) => g.id)), [countedGames]);
  const boxedIds = useMemo(() => countedGames.filter((g) => metas.has(g.id)).map((g) => g.id), [countedGames, metas]);

  // Estimated minutes etc. from shifts, for games that have them.
  const lineup = useLineupData(boxedIds);
  const onFloor = useMemo(() => {
    const m = new Map<string, Map<string, { min: number; off: number; def: number }>>(); // game -> player -> on floor
    for (const slice of lineup.slices) {
      if (!slice.shifts.length) continue;
      const res = computeComboRows([slice], 1, lineup.goals);
      const per = new Map<string, { min: number; off: number; def: number }>();
      res.rows.forEach((r) => per.set(r.playerIds[0], { min: r.estMinutes, off: r.offPossessions, def: r.defPossessions }));
      m.set(slice.gameId, per);
    }
    return m;
  }, [lineup.slices, lineup.goals]);

  const { tableRows, total, hasMinutes } = useMemo(() => {
    const lines = rows.filter((r) => countedIds.has(r.game_id));
    // Team "possessions used" per game, for share.
    const teamUse = new Map<string, number>();
    lines.forEach((l) => teamUse.set(l.game_id, (teamUse.get(l.game_id) ?? 0) + possessionsUsed(l.stats as any)));
    const byPlayer = new Map<string, BoxRow[]>();
    lines.forEach((l) => {
      const k = l.player_id ?? `x:${l.jersey}:${l.name}`;
      byPlayer.set(k, [...(byPlayer.get(k) ?? []), l]);
    });
    let anyMinutes = false;
    const out: TableRow[] = [...byPlayer.entries()].map(([k, ls]) => {
      const counts = sumCounts(ls.map((l) => l.stats as any));
      const use = ls.reduce((s, l) => s + (teamUse.get(l.game_id) ?? 0), 0);
      const stats = calcStats(counts, use);
      const n = ls.length;
      if (perGame) {
        (COUNT_KEYS as readonly string[]).concat(["fgm", "fga", "disruptions", "impact"]).forEach((key) => {
          if (stats[key] != null) stats[key] = Math.round(((stats[key] as number) / n) * 10) / 10;
        });
      }
      // Extra stats from games where this player has both a box score and shifts.
      let min = 0, off = 0, def = 0;
      const withMin = sumCounts([]);
      ls.forEach((l) => {
        const f = l.player_id ? onFloor.get(l.game_id)?.get(l.player_id) : undefined;
        if (!f) return;
        min += f.min; off += f.off; def += f.def;
        COUNT_KEYS.forEach((c) => (withMin[c] += Number((l.stats as any)[c] ?? 0)));
      });
      const extra: Record<string, number | null> = {};
      if (min > 0) {
        anyMinutes = true;
        extra.min = Math.round(min * 10) / 10;
        extra.usage = off > 0 ? Math.round((possessionsUsed(withMin) / off) * 1000) / 10 : null;
        extra.pts32 = Math.round((withMin.pts * 32 / min) * 10) / 10;
        extra.reb32 = Math.round((withMin.reb * 32 / min) * 10) / 10;
        extra.dis32 = Math.round(((withMin.stl + withMin.blk + withMin.defl + withMin.chg) * 32 / min) * 10) / 10;
        extra.stl100 = def > 0 ? Math.round((withMin.stl / def) * 1000) / 10 : null;
      }
      const first = ls[0];
      return {
        key: k,
        label: `${first.jersey != null ? `#${first.jersey} ` : ""}${first.name.replace(/^#\d+$/, "").trim()}`.trim(),
        sub: `${n} game${n === 1 ? "" : "s"}${first.player_id ? "" : " · not on roster"}`,
        stats,
        extra,
      };
    });
    const t = calcStats(sumCounts(lines.map((l) => l.stats as any)));
    const nGames = new Set(lines.map((l) => l.game_id)).size;
    if (perGame && nGames) (COUNT_KEYS as readonly string[]).concat(["fgm", "fga", "disruptions"]).forEach((key) => {
      if (t[key] != null) t[key] = Math.round(((t[key] as number) / nGames) * 10) / 10;
    });
    t.impact = null; t.share = null;
    return { tableRows: out, total: lines.length ? { key: "team", label: `Team${perGame ? " per game" : ""}`, stats: t as BoxStats } : undefined, hasMinutes: anyMinutes };
  }, [rows, countedIds, perGame, onFloor]);

  const extraColumns: ExtraColumn[] = hasMinutes ? [
    { id: "min", label: "Min*", description: "Estimated minutes, from lineup shift entry (games with shifts only).", format: (v) => (v == null ? "–" : v.toFixed(1)) },
    { id: "usage", label: "Usage*", description: "Share of the team's possessions a player ended with a shot, free throw trip or turnover while on the floor. Games with shifts only; based on estimated minutes.", format: (v) => (v == null ? "–" : `${v.toFixed(1)}`) },
    { id: "pts32", label: "Pts/32*", description: "Points scaled to a full 32-minute game — fair to bench players. Based on estimated minutes.", format: (v) => (v == null ? "–" : v.toFixed(1)) },
    { id: "reb32", label: "Reb/32*", description: "Rebounds scaled to a full 32-minute game. Based on estimated minutes.", format: (v) => (v == null ? "–" : v.toFixed(1)) },
    { id: "dis32", label: "Disr/32*", description: "Disruptions scaled to a full 32-minute game. Based on estimated minutes.", format: (v) => (v == null ? "–" : v.toFixed(1)) },
    { id: "stl100", label: "Stl/100*", description: "Steals per 100 opponent possessions while on the floor. Games with shifts only.", format: (v) => (v == null ? "–" : v.toFixed(1)) },
  ] : [];

  const roster = rosters.find((r) => r.id === rosterId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={rosterId ?? ""} onChange={(e) => setRosterId(e.target.value)} aria-label="Team" style={selectStyle}>
          {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={seasonId ?? ""} onChange={(e) => setSeasonId(e.target.value || null)} aria-label="Season" style={selectStyle}>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button style={pill(!allTypes)} onClick={() => setAllTypes(false)} title="Regular season and postseason games">Counted games</button>
        <button style={pill(allTypes)} onClick={() => setAllTypes(true)} title="Also scrimmages, summer and practice games">All games</button>
        <span style={{ flex: 1 }} />
        {rosterId && <button style={btn} onClick={() => setSettingsOpen(true)}>⚙ Player view settings</button>}
      </div>
      {err && <div className="error-msg">{err}</div>}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--title)", letterSpacing: 1, flex: 1 }}>Season player stats</div>
          <button style={pill(perGame)} onClick={() => setPerGame(true)}>Per game</button>
          <button style={pill(!perGame)} onClick={() => setPerGame(false)}>Totals</button>
        </div>
        <BoxScoreTable rows={tableRows} total={total} extraColumns={extraColumns} initialSort="impact"
          emptyText="No box scores yet for these games. Add one from the list below." />
        {hasMinutes && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>* Coaches only. From games with both a box score and lineup shifts; minutes are estimates.</div>}
      </div>

      <div className="card">
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--title)", letterSpacing: 1, marginBottom: 8 }}>Box scores by game</div>
        {!games.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>No games for this team and season.</div>}
        {games.map((g) => {
          const m = metas.get(g.id);
          return (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>vs {g.opponent}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {g.game_date}{!COUNTED.has(g.game_type) ? ` · ${g.game_type} (not in counted games or records)` : ""}
                </div>
              </div>
              <span style={{ fontSize: 11, color: m ? "var(--success-text)" : "var(--muted)" }}>
                {m ? `✓ ${m.source === "hudl" ? "Hudl" : "typed in"}${m.shared ? "" : " · hidden from players"}` : "No box score"}
              </span>
              <button style={btn} onClick={() => setEditing(g)}>{m ? "✎ Edit" : "📥 Add"}</button>
            </div>
          );
        })}
      </div>

      {editing && (
        <BoxScoreImport gameId={editing.id} rosterId={editing.roster_id} seasonId={editing.season_id} opponent={editing.opponent}
          existing={metas.get(editing.id) ?? null} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setTick((t) => t + 1); }} />
      )}
      {settingsOpen && rosterId && (
        <PlayerViewSettings rosterId={rosterId} rosterName={roster?.name ?? "Team"} onClose={() => { setSettingsOpen(false); setTick((t) => t + 1); }} />
      )}
    </div>
  );
}
