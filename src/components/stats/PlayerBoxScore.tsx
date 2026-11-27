// src/components/stats/PlayerBoxScore.tsx
// The Players tab on a game report: the player box score. Coaches can
// import or type it in, choose whether players can see it, and delete it.
// Players see only what their coach's Player view settings allow — the
// database leaves everything else out.
import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  COUNT_KEYS, calcStats, deleteBoxScore, getBoxMetas, getBoxRows, setBoxShared, sumCounts,
  type BoxMeta, type BoxRow, type BoxStats,
} from "../../lib/boxScores";
import BoxScoreTable, { type TableRow } from "./BoxScoreTable";
import BoxScoreImport from "./BoxScoreImport";
import { recomputeTeamRecords } from "../../lib/teamRecords";

interface Props {
  gameId: string;
  canManage: boolean;
}

const btn: CSSProperties = {
  background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};

export default function PlayerBoxScore({ gameId, canManage }: Props) {
  const [rows, setRows] = useState<BoxRow[] | null>(null);
  const [meta, setMeta] = useState<BoxMeta | null>(null);
  const [game, setGame] = useState<{ roster_id: string | null; season_id: string | null; opponent: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await getBoxRows({ gameId });
      setRows(r);
      if (canManage) {
        const metas = await getBoxMetas([gameId]);
        setMeta(metas.get(gameId) ?? null);
        const { data } = await supabase.from("games").select("roster_id, season_id, opponent").eq("id", gameId).maybeSingle();
        setGame((data as any) ?? null);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load the box score.");
      setRows([]);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId]);

  async function afterChange() {
    setEditing(false);
    await load();
    // Team records lean on box scores (assists, steals, 3s), so refresh them.
    if (game?.roster_id) recomputeTeamRecords(game.roster_id).catch(() => {});
  }

  async function remove() {
    if (!window.confirm("Delete this game's box score? Players' stats and records from this game go with it.")) return;
    try { await deleteBoxScore(gameId); await afterChange(); } catch (e: any) { setErr(e?.message ?? "Couldn't delete."); }
  }

  async function toggleShared() {
    if (!meta) return;
    try { await setBoxShared(gameId, !meta.shared); setMeta({ ...meta, shared: !meta.shared }); } catch (e: any) { setErr(e?.message ?? "Couldn't change it."); }
  }

  if (rows === null) return <div className="card" style={{ fontSize: 13, color: "var(--muted)" }}>Loading box score…</div>;

  const tableRows: TableRow[] = rows.map((r, i) => ({
    key: `${r.player_id ?? "x"}-${i}`,
    label: `${r.jersey != null ? `#${r.jersey} ` : ""}${r.name.replace(/^#\d+$/, "").trim() || (r.jersey != null ? "" : "Player")}`.trim(),
    sub: r.player_id ? undefined : "not on roster",
    stats: r.stats,
  }));

  // Team line: counting stats added up. Coaches also get the team's
  // shooting rates. Impact and share don't mean anything for a team.
  const present = new Set<string>();
  rows.forEach((r) => Object.keys(r.stats).forEach((k) => present.add(k)));
  let totalStats: BoxStats | null = null;
  // A player who only sees their own line doesn't need a "team" row repeating it.
  if (rows.length && (canManage || rows.length > 1)) {
    const t = calcStats(sumCounts(rows.map((r) => r.stats as any)));
    t.impact = null; t.share = null;
    totalStats = Object.fromEntries(Object.entries(t).filter(([k]) => present.has(k) && (canManage || (COUNT_KEYS as readonly string[]).includes(k) || k === "fgm" || k === "fga" || k === "disruptions")));
  }

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--title)", letterSpacing: 1, flex: 1 }}>Player box score</div>
        {canManage && meta && (
          <span style={{ fontSize: 11, color: "var(--muted)", padding: "2px 8px", borderRadius: 6, background: "var(--surface2)" }}>
            {meta.source === "hudl" ? "from Hudl" : "typed in"} · {new Date(meta.saved_at).toLocaleDateString()}
          </span>
        )}
        {canManage && (
          <>
            <button style={btn} onClick={() => setEditing(true)}>{meta ? "✎ Replace / edit" : "📥 Import or enter"}</button>
            {meta && (
              <button style={{ ...btn, color: meta.shared ? "var(--success-text)" : "var(--muted)" }} onClick={toggleShared}
                title="Whether players can see this game's box score (only what your Player view settings allow)">
                {meta.shared ? "👁 Players can see" : "🙈 Hidden from players"}
              </button>
            )}
            {meta && <button style={{ ...btn, color: "var(--danger-text)" }} onClick={remove}>🗑</button>}
          </>
        )}
      </div>
      {err && <div className="error-msg">{err}</div>}
      <BoxScoreTable
        rows={tableRows}
        total={totalStats ? { key: "team", label: "Team", stats: totalStats } : undefined}
        emptyText={canManage ? "No box score yet. Import Hudl's box score export, or type it in." : "No box score has been shared for this game."}
      />
      {editing && game && (
        <BoxScoreImport
          gameId={gameId} rosterId={game.roster_id} seasonId={game.season_id} opponent={game.opponent}
          existing={meta} onClose={() => setEditing(false)} onSaved={afterChange}
        />
      )}
    </div>
  );
}
