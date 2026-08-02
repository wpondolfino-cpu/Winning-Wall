// src/components/InSeasonLeaderboard.tsx
import { useState, useEffect, useCallback } from "react";
import { getPracticeWinStandings, PracticeWinStanding } from "../lib/practiceWins";
import { getRosters, RosterWithCount } from "../lib/practicePlanner";
import { currentPeriodStart, currentPeriodEnd } from "../lib/periods";

const ALL_ROSTERS = "All Teams";

export default function InSeasonLeaderboard() {
  const [subTab, setSubTab] = useState<"current" | "season">("current");
  const [rosterFilter, setRosterFilter] = useState<string>(ALL_ROSTERS);
  const [rosters, setRosters] = useState<RosterWithCount[]>([]);
  const [standings, setStandings] = useState<PracticeWinStanding[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, s] = await Promise.all([
      getRosters(),
      subTab === "current"
        ? getPracticeWinStandings(currentPeriodStart(), currentPeriodEnd())
        : getPracticeWinStandings(),
    ]);
    setRosters(r);
    setStandings(s);
    setLoading(false);
  }, [subTab]);

  useEffect(() => { load().catch(console.error); }, [load]);

  const filtered = rosterFilter === ALL_ROSTERS ? standings : standings.filter(s => s.home_roster_id === rosterFilter);
  const ranked = filtered.filter(s => s.wins > 0);

  return (
    <div>
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 12, padding: 4, marginBottom: 12, border: "1px solid var(--border)" }}>
        {([{ key: "current", label: "📅 Current" }, { key: "season", label: "🏆 Season" }] as const).map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            flex: 1, padding: "10px 4px", borderRadius: 9, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 600,
            background: subTab === t.key ? "var(--royal)" : "transparent",
            color: subTab === t.key ? "#fff" : "var(--muted)", transition: "all .2s",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {[ALL_ROSTERS, ...rosters.map(r => r.id)].map(key => {
          const label = key === ALL_ROSTERS ? ALL_ROSTERS : rosters.find(r => r.id === key)?.name ?? key;
          const on = rosterFilter === key;
          return (
            <span key={key} onClick={() => setRosterFilter(key)}
              style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 20,
                background: on ? "var(--royal)" : "var(--surface2)", color: on ? "#fff" : "var(--muted)", border: `1px solid ${on ? "var(--royal-light)" : "var(--border)"}` }}>
              {label}
            </span>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>Loading…</div>
      ) : ranked.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>
          No practice wins logged yet{subTab === "current" ? " this period" : ""}.
        </div>
      ) : (
        <div>
          {ranked.map((s, i) => (
            <div key={s.player_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: i === 0 ? "rgba(240,192,64,0.2)" : "var(--surface2)", color: i === 0 ? "var(--gold)" : "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                {i + 1}
              </div>
              <span style={{ flex: 1, fontSize: 14 }}>{s.name}</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{s.wins}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
