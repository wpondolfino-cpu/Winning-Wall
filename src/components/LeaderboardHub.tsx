// src/components/LeaderboardHub.tsx
import { useState } from "react";
import Leaderboard from "./Leaderboard";
import InSeasonLeaderboard from "./InSeasonLeaderboard";
import ArchivedSeasons from "./ArchivedSeasons";
import { effectiveModeFor } from "../lib/seasonMode";
import { Profile } from "../lib/supabase";
import LeaderboardPrintView from "./LeaderboardPrintView";
import { BoardTable, loadBoard, downloadBoardCsv } from "../lib/leaderboardExport";

interface Props {
  currentUserId?: string;
  canManage?: boolean;
  profile?: Profile | null;
}

type TopTab = "offseason" | "inseason" | "history";

export default function LeaderboardHub({ currentUserId, canManage = false, profile }: Props) {
  const mode = effectiveModeFor(profile);
  const [topTab, setTopTab] = useState<TopTab>(mode === "inseason" ? "inseason" : "offseason");
  const [printing, setPrinting] = useState<BoardTable | null>(null);
  const [busy, setBusy] = useState<"print" | "csv" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Coaches: print or export the board on screen (History has its own export).
  async function run(what: "print" | "csv") {
    if (topTab === "history") return;
    setBusy(what); setErr(null);
    try {
      const t = await loadBoard(topTab);
      if (what === "print") setPrinting(t); else downloadBoardCsv(t);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load the leaderboard.");
    }
    setBusy(null);
  }

  if (printing) return <LeaderboardPrintView table={printing} onBack={() => setPrinting(null)} />;

  const toolBtn = {
    background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8,
    padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
  } as const;

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

      {canManage && topTab !== "history" && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          {err && <span style={{ fontSize: 12, color: "var(--danger-text-2)", marginRight: "auto" }}>{err}</span>}
          <button type="button" onClick={() => run("print")} disabled={busy !== null} style={toolBtn}>
            {busy === "print" ? "Loading…" : "🖨️ Print"}
          </button>
          <button type="button" onClick={() => run("csv")} disabled={busy !== null} style={toolBtn}>
            {busy === "csv" ? "Exporting…" : "⬇️ Export CSV"}
          </button>
        </div>
      )}

      {topTab === "offseason" && <Leaderboard currentUserId={currentUserId} canManage={canManage} />}
      {topTab === "inseason" && <InSeasonLeaderboard />}
      {topTab === "history" && <ArchivedSeasons />}
    </div>
  );
}
