// src/components/ChallengesPanel.tsx
// Thin wrapper — tabs + routing only. Logic lives in sub-components.
import { useState, useEffect } from "react";
import { Score, Workout } from "../../lib/supabase";
import H2HTab from "./H2HTab";
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
}

const isMobile = () => window.innerWidth < 640;

export default function ChallengesPanel({ currentUserId, currentUserName, workouts, myScores, onScoreLogged, canManage = false }: Props) {
  const [activeTab, setActiveTab] = useState<"h2h" | "clash" | "teams" | "stats">("h2h");
  const [mobile, setMobile] = useState(isMobile());
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const h = () => setMobile(isMobile());
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

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
          <H2HOversight />
        ) : (
          <H2HTab
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            workouts={workouts}
            myScores={myScores}
            onScoreLogged={onScoreLogged}
            onPendingCount={setPendingCount}
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
