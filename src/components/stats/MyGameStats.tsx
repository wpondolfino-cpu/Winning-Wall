// src/components/stats/MyGameStats.tsx
// Profile → My game stats. Season averages, Impact Score next to the
// team's average, records the player holds, and a game log. Only the
// stats the coach lets players see come back from the database; with the
// player view turned off (or no box scores yet) the section stays hidden.
import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  STAT_BY_KEY, RECORD_DEFS, formatStat, getBoxRows, getGameRecords, getSeasonSummary,
  type BoxRow, type GameRecord, type SeasonSummary,
} from "../../lib/boxScores";

interface Props { playerId: string; homeRosterId: string | null }

const tile: CSSProperties = { background: "var(--surface2)", borderRadius: 10, padding: "10px 12px", minWidth: 0 };
const TILES = ["pts", "reb", "ast", "impact", "disruptions"];
const LOG_COLS = ["pts", "reb", "ast", "disruptions", "impact"];

export default function MyGameStats({ playerId, homeRosterId }: Props) {
  const [seasons, setSeasons] = useState<{ id: string; name: string }[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [sum, setSum] = useState<SeasonSummary | null>(null);
  const [log, setLog] = useState<BoxRow[]>([]);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("seasons").select("id, name, start_date").order("start_date", { ascending: false })
      .then(({ data }) => { const s = (data ?? []) as any[]; setSeasons(s); setSeasonId(s[0]?.id ?? null); });
  }, []);

  useEffect(() => {
    if (seasons.length && !seasonId) return;
    getSeasonSummary(playerId, seasonId ?? undefined).then(setSum).catch(() => setSum(null));
    getBoxRows({ playerId, seasonId: seasonId ?? undefined }).then((r) => setLog(r.filter((x) => x.player_id === playerId))).catch(() => setLog([]));
    if (homeRosterId) getGameRecords(homeRosterId).then((r) => setRecords(r.filter((x) => x.player_id === playerId))).catch(() => setRecords([]));
  }, [playerId, seasonId, homeRosterId, seasons.length]);

  if (!sum || sum.whose === "off" || !log.length) return null;

  const per = sum.per_game ?? {};
  const tiles = TILES.filter((k) => per[k] != null);
  const fg = sum.totals?.fg_pct != null ? sum.totals.fg_pct : null;
  const cols = LOG_COLS.filter((k) => log.some((r) => r.stats[k] != null));
  const showFG = log.some((r) => r.stats.fgm != null && r.stats.fga != null);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--title)", letterSpacing: 1, flex: 1 }}>My game stats</div>
        {seasons.length > 1 && (
          <select value={seasonId ?? ""} onChange={(e) => setSeasonId(e.target.value)} aria-label="Season"
            style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{sum.games ?? 0} game{sum.games === 1 ? "" : "s"}</span>
      </div>

      {tiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
          {tiles.map((k) => (
            <button key={k} onClick={() => setInfo(info === k ? null : k)} style={{ ...tile, border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: "inherit" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{STAT_BY_KEY.get(k)!.label}</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--info-text)", lineHeight: 1.1 }}>{formatStat(k, per[k])}</div>
              <div style={{ fontSize: 11, color: k === "impact" && sum.team_avg_impact != null && (per.impact ?? 0) >= sum.team_avg_impact ? "var(--success-text)" : "var(--muted)" }}>
                {k === "impact" && sum.team_avg_impact != null ? `team avg ${sum.team_avg_impact.toFixed(1)}` : "per game"}
              </div>
            </button>
          ))}
        </div>
      )}
      {info && (
        <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.55, background: "var(--surface2)", borderRadius: 8, padding: "8px 10px" }}>
          <b>{STAT_BY_KEY.get(info)!.label}.</b> {STAT_BY_KEY.get(info)!.description}
        </div>
      )}
      {fg != null && <div style={{ fontSize: 12, color: "var(--muted)" }}>Season shooting: FG {formatStat("fg_pct", fg)}%{sum.totals?.fg3_pct != null ? ` · 3P ${formatStat("fg3_pct", sum.totals.fg3_pct)}%` : ""}{sum.totals?.ft_pct != null ? ` · FT ${formatStat("ft_pct", sum.totals.ft_pct)}%` : ""}</div>}

      {records.map((r) => (
        <div key={r.record_key + r.game_id} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 18 }}>🏆</span>
          <span style={{ fontSize: 13, color: "var(--gold-text)" }}>
            You hold the team record: {RECORD_DEFS.find((d) => d.key === r.record_key)?.label.toLowerCase()} ({formatStat(r.record_key, r.value)}, vs {r.opponent})
          </span>
        </div>
      ))}

      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Game log</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ color: "var(--muted)" }}>
              <th style={{ textAlign: "left", padding: "5px 4px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Game</th>
              {cols.map((k) => <th key={k} style={{ textAlign: "right", padding: "5px 4px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{STAT_BY_KEY.get(k)!.short}</th>)}
              {showFG && <th style={{ textAlign: "right", padding: "5px 4px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>FG</th>}
            </tr></thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.game_id}>
                  <td style={{ padding: "5px 4px", borderBottom: "1px solid var(--border)" }}>vs {r.opponent} <span style={{ color: "var(--muted)" }}>· {r.game_date}</span></td>
                  {cols.map((k) => <td key={k} style={{ textAlign: "right", padding: "5px 4px", borderBottom: "1px solid var(--border)", fontWeight: k === "impact" ? 700 : 400 }}>{formatStat(k, r.stats[k])}</td>)}
                  {showFG && <td style={{ textAlign: "right", padding: "5px 4px", borderBottom: "1px solid var(--border)" }}>{formatStat("fgm", r.stats.fgm)}-{formatStat("fga", r.stats.fga)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Tap a stat above for what it means. Season numbers count regular season and postseason games.</div>
      </div>
    </div>
  );
}
