// src/components/LeaderboardHub.tsx
import { useState } from "react";
import Leaderboard from "./Leaderboard";
import InSeasonLeaderboard from "./InSeasonLeaderboard";
import { effectiveModeFor } from "../lib/seasonMode";
import { Profile } from "../lib/supabase";

interface Props {
  currentUserId?: string;
  canManage?: boolean;
  profile?: Profile | null;
}

type TopTab = "offseason" | "inseason" | "history";

export default function LeaderboardHub({ currentUserId, canManage = false, profile }: Props) {
  const mode = effectiveModeFor(profile);
  const [topTab, setTopTab] = useState<TopTab>(mode === "inseason" ? "inseason" : "offseason");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {([
          { key: "offseason", label: "Offseason" },
          { key: "inseason", label: "In-season" },
          { key: "history", label: "History" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTopTab(t.key)} style={{
            flex: 1, padding: "10px 4px", borderRadius: 10, cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 700,
            background: topTab === t.key ? "var(--royal)" : "var(--surface2)",
            color: topTab === t.key ? "#fff" : "var(--muted)",
            border: `1px solid ${topTab === t.key ? "var(--royal-light)" : "var(--border)"}`,
          }}>{t.label}</button>
        ))}
      </div>

      {topTab === "offseason" && <Leaderboard currentUserId={currentUserId} canManage={canManage} hiddenTabs={["history"]} />}
      {topTab === "inseason" && <InSeasonLeaderboard />}
      {topTab === "history" && (
        mode === "inseason"
          ? <div style={{ textAlign: "center", color: "var(--muted)", padding: "24px 0", fontSize: 13 }}>In-season history — coming with the archive viewer.</div>
          : <Leaderboard currentUserId={currentUserId} canManage={canManage} hiddenTabs={["current", "overall"]} initialTab="history" />
      )}
    </div>
  );
}
