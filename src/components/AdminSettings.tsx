// src/components/AdminSettings.tsx
// Admin-only settings: period anchor, export data, milestone badges, workout scheduling

import { useState } from "react";
import { supabase, setPeriodAnchor, getPeriodAnchor, currentPeriodStart, currentPeriodEnd } from "../lib/supabase";
import { BADGES } from "../lib/badges";

export default function AdminSettings() {
  const [anchorDate, setAnchorDate] = useState(() => {
    const d = getPeriodAnchor();
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  });
  const [anchorSaved, setAnchorSaved] = useState(false);
  const [exporting, setExporting] = useState(false);

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();
  const daysLeft    = Math.ceil((periodEnd.getTime() - Date.now()) / 86400000);

  function saveAnchor() {
    setPeriodAnchor(new Date(anchorDate));
    setAnchorSaved(true);
    setTimeout(() => setAnchorSaved(false), 2000);
    window.location.reload(); // refresh so all period dates update
  }

  async function exportLeaderboard() {
    setExporting(true);
    try {
      const { data: profiles } = await supabase
        .from("profiles").select("id, name, grade_category").eq("role", "player");
      const { data: scores } = await supabase.from("scores").select("*");
      const { data: workouts } = await supabase.from("workouts").select("id, title");

      if (!profiles || !scores || !workouts) return;

      // Build CSV
      const workoutTitles = workouts.map(w => w.title);
      const headers = ["Player", "Grade", "Total Points", ...workoutTitles];

      const rows = profiles.map(p => {
        const totalPts = scores.filter(s => s.player_id === p.id).reduce((sum, s) => sum + (s.points ?? 0), 0);
        const workoutPts = workouts.map(w => {
          const s = scores.find(sc => sc.player_id === p.id && sc.workout_id === w.id);
          return s ? `${s.made + s.reps} (${s.points}pts)` : "—";
        });
        return [p.name, p.grade_category ?? "—", totalPts, ...workoutPts];
      });

      const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attleboro-winning-wall-${new Date().toLocaleDateString().replace(/\//g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const inputStyle = {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "9px 12px", color: "var(--text)",
    fontSize: 14, fontFamily: "inherit", outline: "none",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Period Settings ── */}
      <div className="card">
        <div className="card-title">📅 Biweekly Period Settings</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Set the start date of your first period. All future periods are calculated automatically in 2-week intervals from this date.
        </div>

        {/* Current period display */}
        <div style={{ background: "rgba(26,63,168,0.15)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Current Period</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>
            {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {daysLeft} days remaining
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Period 1 Start Date
            </label>
            <input
              type="date"
              value={anchorDate}
              onChange={e => setAnchorDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button
            onClick={saveAnchor}
            style={{
              background: anchorSaved ? "#5de098" : "var(--royal)", color: anchorSaved ? "#051a0a" : "#fff",
              border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13,
              fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {anchorSaved ? "✓ Saved!" : "Save Date"}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          💡 Example: if your offseason starts June 1, set the date to June 1. Period 1 = June 1–14, Period 2 = June 15–28, etc.
        </div>
      </div>

      {/* ── Export Data ── */}
      <div className="card">
        <div className="card-title">📊 Export Data</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Download the full leaderboard as a spreadsheet. Opens in Excel, Google Sheets, or any CSV viewer.
        </div>
        <button
          onClick={exportLeaderboard}
          disabled={exporting}
          style={{
            background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
            padding: "10px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
          }}
        >
          {exporting ? "Exporting…" : "⬇️ Download Leaderboard CSV"}
        </button>
      </div>

      {/* ── Milestone Badges ── */}
      <div className="card">
        <div className="card-title">🏅 Milestone Badges</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          These badges are automatically awarded to players when they hit milestones. Players see them on their profile.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {BADGES.map(b => (
            <div key={b.id} style={{
              background: "var(--surface2)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{ fontSize: 24, flexShrink: 0 }}>{b.icon}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{b.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{b.description}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          💡 Badges are awarded automatically when players meet the criteria. No action needed from you.
        </div>
      </div>

    </div>
  );
}
