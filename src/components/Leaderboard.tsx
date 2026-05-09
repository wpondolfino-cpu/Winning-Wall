// src/components/Leaderboard.tsx
import { useState } from "react";
import { useLeaderboard } from "../hooks/useLeaderboard";
import { LeaderboardEntry, GRADE_CATEGORIES, GradeCategory } from "../lib/supabase";

interface Props {
  currentUserId?: string;
}

const ALL = "All Players";
type Tab = typeof ALL | GradeCategory;

export default function Leaderboard({ currentUserId }: Props) {
  const { leaderboard, loading, lastUpdated } = useLeaderboard();
  const [activeTab, setActiveTab] = useState<Tab>(ALL);

  if (loading) return <div className="loading">Loading leaderboard…</div>;

  // Filter by selected tab
  const filtered: LeaderboardEntry[] = activeTab === ALL
    ? leaderboard
    : leaderboard.filter(e => e.grade_category === activeTab);

  // Re-rank within the filtered group
  const ranked = filtered.map((e, i) => ({ ...e, rank: i + 1 }));

  const shotPct = (e: LeaderboardEntry) =>
    e.total_attempts > 0
      ? Math.round((e.total_made / e.total_attempts) * 100) + "%"
      : "—";

  const rankClass = (r: number) =>
    r === 1 ? "gold" : r === 2 ? "silver" : r === 3 ? "bronze" : "";

  const me = leaderboard.find(e => e.id === currentUserId);
  const myRankInTab = ranked.find(e => e.id === currentUserId);

  // Short labels for the tab bar
  const SHORT_LABELS: Record<string, string> = {
    "Elementary (3rd-4th Grade)": "Elem",
    "5th & 6th Grade": "5th/6th",
    "7th & 8th Grade": "7th/8th",
    "Underclassman (9th-10th Grade)": "JV",
    "Upperclassman (11th-12th Grade)": "Varsity",
    "Alumni": "Alumni",
    "All Players": "All",
  };

  const tabs: Tab[] = [ALL, ...GRADE_CATEGORIES];

  return (
    <div className="panel active">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div className="section-title">Leaderboard</div>
          <div className="section-sub">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Syncing…"}
          </div>
        </div>
        <span className="live-badge"><span className="live-dot" /> LIVE</span>
      </div>

      {/* Category tab bar */}
      <div style={{
        display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20,
        background: "var(--surface2)", padding: 6, borderRadius: 12,
        border: "1px solid var(--border)"
      }}>
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600,
              background: activeTab === tab ? "var(--royal)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--muted)",
              transition: "all .2s",
              whiteSpace: "nowrap",
            }}
          >
            {SHORT_LABELS[tab] ?? tab}
          </button>
        ))}
      </div>

      {/* Personal stats (players only) */}
      {currentUserId && me && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Overall Rank</div>
            <div className="stat-value gold">#{me.rank}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">
              {activeTab === ALL ? "Total Points" : `${SHORT_LABELS[activeTab]} Rank`}
            </div>
            <div className="stat-value blue">
              {activeTab === ALL ? me.total_points : myRankInTab ? `#${myRankInTab.rank}` : "—"}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Workouts Done</div>
            <div className="stat-value">{me.workouts_completed}</div>
          </div>
        </div>
      )}

      {/* Category label */}
      {activeTab !== ALL && (
        <div style={{
          marginBottom: 14, padding: "8px 14px",
          background: "rgba(26,63,168,0.15)", borderRadius: 8,
          fontSize: 13, color: "#93b4ff", fontWeight: 600,
          border: "1px solid rgba(26,63,168,0.25)"
        }}>
          📋 Showing: {activeTab} — {ranked.length} player{ranked.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="lb-header-row">
          <div>RNK</div>
          <div>PLAYER</div>
          <div style={{ textAlign: "center" }}>SHOT%</div>
          <div style={{ textAlign: "center" }}>SPRINT</div>
          <div style={{ textAlign: "center" }}>DONE</div>
          <div style={{ textAlign: "center" }}>PTS</div>
        </div>

        {ranked.map(entry => (
          <div
            key={entry.id}
            className={`lb-row ${entry.id === currentUserId ? "me" : ""}`}
          >
            <div className={`lb-rank ${rankClass(entry.rank)}`}>{entry.rank}</div>
            <div>
              <div className="lb-name" style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {/* Crown icon for biweekly champion */}
                {entry.is_period_champion && (
                  <span title="Biweekly Champion!" style={{ fontSize: 16 }}>👑</span>
                )}
                {entry.name}
                {entry.id === currentUserId && (
                  <span style={{ fontSize: 11, color: "#93b4ff" }}>(you)</span>
                )}
                {/* Streak fire badge */}
                {entry.current_streak && entry.current_streak >= 2 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                    background: "rgba(255,100,0,0.2)", color: "#ff8c42", border: "1px solid rgba(255,100,0,0.3)",
                  }}>🔥 {entry.current_streak}d</span>
                )}
              </div>
              <div className="lb-pos">
                {entry.jersey ? `#${entry.jersey}` : ""}{entry.position ? ` · ${entry.position}` : ""}
                {entry.grade_category && activeTab === ALL && (
                  <span style={{ marginLeft: 4, color: "var(--muted)" }}>· {SHORT_LABELS[entry.grade_category] ?? entry.grade_category}</span>
                )}
              </div>
            </div>
            <div className="lb-cell">{shotPct(entry)}</div>
            <div className="lb-cell">{entry.best_sprint > 0 ? `${entry.best_sprint}s` : "—"}</div>
            <div className="lb-cell">{entry.workouts_completed}</div>
            <div className="lb-cell highlight">{entry.total_points}</div>
          </div>
        ))}

        {ranked.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            No players in this category yet. 🏀
          </div>
        )}
      </div>
    </div>
  );
}
