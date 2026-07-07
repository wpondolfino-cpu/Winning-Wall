// src/components/challenges/TeamStatsPanel.tsx
// Team-wide competitive stats for coaches/admins — replaces the personal
// "My Stats" tab (which is always empty for staff, since they don't play).
// Shows every player's record across H2H, Class Clash, and Team Competition.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

interface Row {
  id: string;
  name: string;
  h2hWins: number;
  h2hLosses: number;
  clashWins: number;
  teamWins: number;
}

type SortKey = "h2hWins" | "clashWins" | "teamWins" | "name";

export default function TeamStatsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("h2hWins");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: profiles }, { data: challenges }, { data: bonuses }] = await Promise.all([
      supabase.from("profiles").select("id,name").eq("role", "player"),
      supabase.from("challenges").select("challenger_id,opponent_id,winner_id").eq("status", "completed"),
      supabase.from("streak_bonuses").select("player_id,reason").in("reason", ["class_clash_1st", "team_win"]),
    ]);

    const map: Record<string, Row> = {};
    (profiles ?? []).forEach((p: any) => {
      map[p.id] = { id: p.id, name: p.name, h2hWins: 0, h2hLosses: 0, clashWins: 0, teamWins: 0 };
    });

    (challenges ?? []).forEach((c: any) => {
      if (!c.winner_id) return; // ties don't count as a win/loss for either side
      const loserId = c.winner_id === c.challenger_id ? c.opponent_id : c.challenger_id;
      if (map[c.winner_id]) map[c.winner_id].h2hWins += 1;
      if (map[loserId]) map[loserId].h2hLosses += 1;
    });

    (bonuses ?? []).forEach((b: any) => {
      if (!map[b.player_id]) return;
      if (b.reason === "class_clash_1st") map[b.player_id].clashWins += 1;
      if (b.reason === "team_win") map[b.player_id].teamWins += 1;
    });

    setRows(Object.values(map));
    setLoading(false);
  }

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name);
    return (b[sortKey] as number) - (a[sortKey] as number);
  });

  const sortBtn = (key: SortKey, label: string) => (
    <button onClick={() => setSortKey(key)} style={{
      background: sortKey === key ? "var(--royal)" : "transparent",
      color: sortKey === key ? "#fff" : "var(--muted)",
      border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px",
      fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
    }}>{label}</button>
  );

  if (loading) return <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        Sort by: {sortBtn("h2hWins", "⚔️ H2H Wins")} {sortBtn("clashWins", "🏆 Clash Wins")} {sortBtn("teamWins", "👥 Team Wins")} {sortBtn("name", "🔤 Name")}
      </div>

      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>No players yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8, padding: "0 12px 6px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>
            <span>Player</span><span style={{ textAlign: "center" }}>H2H</span><span style={{ textAlign: "center" }}>Clash</span><span style={{ textAlign: "center" }}>Team</span>
          </div>
          {sorted.map(r => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8, alignItems: "center", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r.name}</span>
              <span style={{ textAlign: "center", fontSize: 12, color: "var(--text)" }}>{r.h2hWins}-{r.h2hLosses}</span>
              <span style={{ textAlign: "center", fontSize: 12, color: "var(--gold)" }}>{r.clashWins}</span>
              <span style={{ textAlign: "center", fontSize: 12, color: "#5de098" }}>{r.teamWins}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
