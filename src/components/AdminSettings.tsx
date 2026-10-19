// src/components/AdminSettings.tsx
import CompetitionsCard from "./CompetitionsCard";
import SeasonModeToggle from "./SeasonModeToggle";
import SeasonManager from "./SeasonManager";

export default function AdminSettings() {
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
    </div>
  );
}
