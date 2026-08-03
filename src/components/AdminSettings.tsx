// src/components/AdminSettings.tsx
import { useState, useEffect } from "react";
import { supabase, currentPeriodStart, currentPeriodEnd, savePeriodAnchor, getPeriodAnchor } from "../lib/supabase";
import SeasonModeToggle from "./SeasonModeToggle";

export default function AdminSettings() {
  const [exporting, setExporting]   = useState(false);
  const [anchorDate, setAnchorDate] = useState(() => {
    const d = getPeriodAnchor(); return d.toISOString().split("T")[0];
  });
  const [anchorSaved, setAnchorSaved] = useState(false);

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();
  const daysLeft    = Math.ceil((periodEnd.getTime() - Date.now()) / 86400000);

  async function saveAnchor() {
    await savePeriodAnchor(new Date(anchorDate));
    setAnchorSaved(true);
    setTimeout(() => { setAnchorSaved(false); window.location.reload(); }, 1000);
  }

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
      </div>

      {/* ── Period Settings ── */}
      <div className="card">
        <div className="card-title">📅 Biweekly Period Settings</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Set the start date of Period 1. All future 2-week periods calculate automatically from there.
        </div>
        <div style={{ background: "rgba(26,63,168,0.15)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Current Period</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>
            {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{daysLeft} days remaining</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140, maxWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Period 1 Start Date</label>
            <input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} style={inputStyle} />
          </div>
          <button onClick={saveAnchor} style={{
            background: anchorSaved ? "#5de098" : "var(--royal)", color: anchorSaved ? "#051a0a" : "#fff",
            border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600,
            fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", width: "100%",
          }}>{anchorSaved ? "✓ Saved!" : "Save Date"}</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          💡 Set this to the first day of your offseason. The app handles everything else.
        </div>
      </div>

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
