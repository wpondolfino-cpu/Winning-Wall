// src/components/AdminSettings.tsx
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import CompetitionsCard from "./CompetitionsCard";
import SeasonModeToggle from "./SeasonModeToggle";
import SeasonManager from "./SeasonManager";

export default function AdminSettings() {
  const [exporting, setExporting]   = useState(false);

  async function exportLeaderboard() {
    setExporting(true);
    try {
      const { data: profiles } = await supabase.from("profiles").select("id,name,grade_category").eq("role", "player");
      const { data: scores }   = await supabase.from("scores").select("*");
      const { data: workouts } = await supabase.from("workouts").select("id,title");
      if (!profiles || !scores || !workouts) return;

      const headers = ["Player", "Grade", "Total Points", ...workouts.map(w => w.title)];
      const rows = profiles.map(p => {
        const total = scores.filter(s => s.player_id === p.id).reduce((sum, s) => sum + (s.points ?? 0), 0);
        const wPts = workouts.map(w => {
          const s = scores.find(sc => sc.player_id === p.id && sc.workout_id === w.id);
          return s ? `${s.made + s.reps} (${s.points}pts)` : "—";
        });
        return [p.name, p.grade_category ?? "—", total, ...wPts];
      });

      const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `winning-wall-${new Date().toLocaleDateString().replace(/\//g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  const inputStyle = {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "9px 12px", color: "var(--text)",
    fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Season Mode ── */}
      <div className="card">
        <div className="card-title">🔁 Season Mode</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Controls which nav and leaderboard rostered players see. Non-rostered players always stay in offseason mode regardless of this setting.
        </div>
        <SeasonModeToggle />

      {/* Directly under the mode toggle: flipping to offseason is what
          ends a season, so the list it changes belongs beside it. */}
      <div style={{ marginTop: 12 }}>
        <SeasonManager />
      </div>
      </div>

      {/* ── Competitions ── replaces the biweekly anchor-date card */}
      <CompetitionsCard />

      {/* ── Export ── */}
      <div className="card">
        <div className="card-title">📊 Export Leaderboard</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          Download the full leaderboard as a spreadsheet (CSV). Opens in Excel or Google Sheets.
        </div>
        <button onClick={exportLeaderboard} disabled={exporting} style={{
          background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
          padding: "10px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>{exporting ? "Exporting…" : "⬇️ Download CSV"}</button>
      </div>
    </div>
  );
}
