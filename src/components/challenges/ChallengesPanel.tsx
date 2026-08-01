// src/components/ChallengesPanel.tsx
// Thin wrapper — tabs + routing only. Logic lives in sub-components.
import { useState, useEffect } from "react";
import { Score, Workout } from "../../lib/supabase";
import H2HTab, { getH2HEligibleWorkouts } from "./H2HTab";
import H2HOversight from "./H2HOversight";
import TeamsTab from "./TeamsTab";
import StatsTab from "./StatsTab";
import TeamStatsPanel from "./TeamStatsPanel";
import ClassClash from "./ClassClash";

interface Props {
  currentUserId: string;
  currentUserName: string;
  workouts: Workout[];
  myScores: Score[];
  onScoreLogged?: () => void;
  canManage?: boolean;
  prefillWorkoutId?: string | null;
  onPrefillHandled?: () => void;
}

const isMobile = () => window.innerWidth < 640;

export default function ChallengesPanel({ currentUserId, currentUserName, workouts, myScores, onScoreLogged, canManage = false, prefillWorkoutId, onPrefillHandled }: Props) {
  const [activeTab, setActiveTab] = useState<"h2h" | "clash" | "teams" | "stats">("h2h");
  const [mobile, setMobile] = useState(isMobile());
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const h = () => setMobile(isMobile());
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    if (prefillWorkoutId) setActiveTab("h2h");
  }, [prefillWorkoutId]);

  const tabs = [
    { key: "h2h",   label: mobile ? "⚔️ H2H" : "⚔️ Head to Head", badge: pendingCount > 0 ? pendingCount : null },
    { key: "clash", label: "🏆 Clash" },
    { key: "teams", label: "👥 Teams" },
    { key: "stats", label: mobile ? "📊 Stats" : canManage ? "📊 Team Stats" : "📊 My Stats", badge: null },
  ] as const;

  return (
    <div className="panel active">
      <div style={{ marginBottom: 16 }}>
        <div className="section-title">Challenges</div>
        <div className="section-sub">Head-to-Head · Class Clash · Team Competition</div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "var(--surface2)", borderRadius: 10, padding: 4 }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ flex: 1, background: activeTab === tab.key ? "var(--royal)" : "transparent", color: activeTab === tab.key ? "#fff" : "var(--muted)", border: "none", borderRadius: 8, padding: "8px 0", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s", position: "relative" }}>
            {tab.label}
            {"badge" in tab && tab.badge && (
              <span style={{ position: "absolute", top: 2, right: 4, background: "#ff7b7b", color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 99, padding: "1px 4px", lineHeight: 1.4 }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "h2h" && (
        canManage ? (
          <div>
            <EligibleDrillsPanel workouts={workouts} />
            <H2HOversight />
          </div>
        ) : (
          <H2HTab
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            workouts={workouts}
            myScores={myScores}
            onScoreLogged={onScoreLogged}
            onPendingCount={setPendingCount}
            prefillWorkoutId={prefillWorkoutId}
            onPrefillHandled={onPrefillHandled}
          />
        )
      )}
      {activeTab === "clash" && (
        <ClassClash currentUserId={currentUserId} canManage={false} />
      )}
      {activeTab === "teams" && (
        <TeamsTab currentUserId={currentUserId} />
      )}
      {activeTab === "stats" && (
        canManage ? <TeamStatsPanel /> : <StatsTab currentUserId={currentUserId} />
      )}
    </div>
  );
}

// Read-only mirror of the exact drill list players see in H2H's "choose
// drill" dropdown — lets a coach/admin confirm at a glance which drills
// are currently eligible, without needing a fake "new challenge" flow.
function EligibleDrillsPanel({ workouts }: { workouts: Workout[] }) {
  const [open, setOpen] = useState(true);
  const eligible = getH2HEligibleWorkouts(workouts);
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s ease", display: "inline-block" }}>▸</span>
        🎯 Eligible Drills for Head-to-Head ({eligible.length})
      </button>
      {open && (
        <div style={{ marginTop: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: eligible.length ? "8px 12px" : "12px 14px" }}>
          {eligible.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>No drills currently qualify — a drill needs to be active and scored as Competitive or Multi-Spot to show up in H2H.</div>
          ) : (
            eligible.map(w => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span>{w.emoji}</span>
                <span style={{ flex: 1, color: "var(--text)" }}>{w.title}</span>
                <span style={{ color: "var(--muted)", fontSize: 11, textTransform: "capitalize" }}>{w.scoring_type === "multi_spot" ? "Multi-Spot" : "Competitive"}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
