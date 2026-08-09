// src/components/game-stats/LineupReport.tsx
// Phase 1 lineup report: exact five-man lineups only, raw numbers only.
//
// Deliberately thin. No combos, no shrinkage, no sample gates, no rankings
// -- those need real data to calibrate against, and this exists mainly to
// prove the capture pipeline works end to end. Every number here is a raw
// observation, which is exactly why possession counts sit right next to
// them: at three or four games in, a five-man lineup with 40 possessions
// is a curiosity, not a finding.
//
// Coach-only, like everything else under lineups.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { listGamePlayers, computeLineupRows, type LineupRow, type LineupPlayer } from "../../lib/lineups";
import { gameTypesForGroup } from "../../lib/gameStats";
import type { Possession } from "../../lib/gameStats";

interface Props {
  /** A single game, or null for every game on this roster in the season. */
  gameId: string | null;
  rosterId: string | null;
  season?: string;
}

export default function LineupReport({ gameId, rosterId, season }: Props) {
  const [rows, setRows] = useState<LineupRow[]>([]);
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
  const [gameCount, setGameCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, rosterId, season]);

  async function load() {
    setLoading(true);

    let gameIds: string[] = [];
    if (gameId) {
      gameIds = [gameId];
    } else {
      // The "games" group, not just regular season -- a playoff game is a
      // real game and belongs in the same numbers. Scrimmages, practices and
      // summer league stay out by default.
      let q = supabase.from("games").select("id").in("game_type", gameTypesForGroup("games"));
      if (rosterId) q = q.eq("roster_id", rosterId);
      if (season) q = q.eq("season", season);
      const { data } = await q;
      gameIds = (data ?? []).map((g: any) => g.id);
    }

    if (!gameIds.length) {
      setRows([]); setGameCount(0); setLoading(false); return;
    }

    const { data: poss } = await supabase
      .from("possessions")
      .select("*")
      .in("game_id", gameIds)
      .order("sequence", { ascending: true });

    const { data: shiftRows } = await supabase
      .from("shifts")
      .select("*")
      .in("game_id", gameIds)
      .order("start_sequence", { ascending: true });

    const possessions = (poss ?? []) as Possession[];
    const shifts = (shiftRows ?? []) as any[];

    // Sequence is unique per game, not across games, so each game has to be
    // matched against its own shifts before the results are merged.
    const withShifts = new Set(shifts.map((s) => s.game_id));
    const merged = new Map<string, LineupRow>();
    gameIds.filter((id) => withShifts.has(id)).forEach((id) => {
      const rowsForGame = computeLineupRows(
        possessions.filter((p) => p.game_id === id),
        shifts.filter((s) => s.game_id === id),
      );
      rowsForGame.forEach((r) => {
        const prev = merged.get(r.key);
        if (!prev) { merged.set(r.key, { ...r }); return; }
        prev.offPossessions += r.offPossessions;
        prev.defPossessions += r.defPossessions;
        prev.pointsFor += r.pointsFor;
        prev.pointsAgainst += r.pointsAgainst;
        prev.shiftCount += r.shiftCount;
      });
    });

    const out = [...merged.values()].map((r) => {
      const offPPP = r.offPossessions ? Math.round((r.pointsFor / r.offPossessions) * 100) / 100 : null;
      const defPPP = r.defPossessions ? Math.round((r.pointsAgainst / r.defPossessions) * 100) / 100 : null;
      return {
        ...r,
        offPPP,
        defPPP,
        netRating: offPPP != null && defPPP != null ? Math.round((offPPP - defPPP) * 100) : null,
        plusMinus: r.pointsFor - r.pointsAgainst,
      };
    }).sort((a, b) => b.offPossessions + b.defPossessions - (a.offPossessions + a.defPossessions));

    setRows(out);
    setGameCount(withShifts.size);
    // All players, not just this roster: a shift can contain a call-up who
    // isn't on it, and this list exists purely to turn ids into names.
    setPlayers(await listGamePlayers(null));
    setLoading(false);
  }

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  function label(id: string) {
    const p = byId.get(id);
    if (!p) return "?";
    return p.jersey != null ? String(p.jersey) : (p.name || "?").slice(0, 6);
  }

  const totalOff = rows.reduce((s, r) => s + r.offPossessions, 0);

  if (loading) return <div className="card">Loading lineups…</div>;
  if (!rows.length) {
    return (
      <div className="card">
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          No shifts entered yet. Open a game and use its Shifts tab to mark who was on the floor.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14 }}>Five-man lineups</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {gameCount} game{gameCount === 1 ? "" : "s"} with shifts entered
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 560 }}>
          <div style={{ display: "flex", gap: 8, padding: "8px 10px", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
            <span style={{ flex: 1, minWidth: 0 }}>Lineup</span>
            <span style={{ width: 78, textAlign: "right" }}>Off poss</span>
            <span style={{ width: 78, textAlign: "right" }}>Def poss</span>
            <span style={{ width: 60, textAlign: "right" }}>Off PPP</span>
            <span style={{ width: 60, textAlign: "right" }}>Def PPP</span>
            <span style={{ width: 54, textAlign: "right" }}>Net</span>
            <span style={{ width: 46, textAlign: "right" }}>+/-</span>
          </div>

          {rows.map((r) => {
            const share = totalOff ? Math.round((r.offPossessions / totalOff) * 100) : 0;
            const net = r.netRating;
            const netColor = net == null ? "var(--muted)" : net > 3 ? "#5cb98b" : net < -3 ? "#d98b8b" : "var(--text)";
            return (
              <div key={r.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 10px", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {r.playerIds.map(label).join(" · ")}
                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>
                    {r.shiftCount} shift{r.shiftCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span style={{ width: 78, textAlign: "right" }}>
                  {r.offPossessions} <span style={{ fontSize: 11, color: "var(--muted)" }}>({share}%)</span>
                </span>
                <span style={{ width: 78, textAlign: "right" }}>{r.defPossessions}</span>
                <span style={{ width: 60, textAlign: "right" }}>{r.offPPP?.toFixed(2) ?? "—"}</span>
                <span style={{ width: 60, textAlign: "right" }}>{r.defPPP?.toFixed(2) ?? "—"}</span>
                <span style={{ width: 54, textAlign: "right", color: netColor }}>{net == null ? "—" : (net > 0 ? `+${net}` : net)}</span>
                <span style={{ width: 46, textAlign: "right" }}>{r.plusMinus > 0 ? `+${r.plusMinus}` : r.plusMinus}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
        Raw numbers, no sample adjustment yet — a lineup with 40 possessions is a curiosity, not a finding.
        Net is offence minus defence per 100 possessions. Off poss % is this lineup's share of the possessions covered here.
      </div>
    </div>
  );
}
