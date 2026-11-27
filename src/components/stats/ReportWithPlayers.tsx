// src/components/stats/ReportWithPlayers.tsx
// Puts a "Players" tab next to a game's team report. The team report
// itself is passed in unchanged.
import { useState, type ReactNode } from "react";
import PlayerBoxScore from "./PlayerBoxScore";

export default function ReportWithPlayers({ gameId, canManage, children }: { gameId: string; canManage: boolean; children: ReactNode }) {
  const [pane, setPane] = useState<"team" | "players">("team");
  return (
    <div>
      <div className="role-tabs" style={{ maxWidth: 360, marginBottom: 12 }}>
        <button className={`role-tab ${pane === "team" ? "active" : ""}`} onClick={() => setPane("team")}>Team report</button>
        <button className={`role-tab ${pane === "players" ? "active" : ""}`} onClick={() => setPane("players")}>Players</button>
      </div>
      {pane === "team" ? children : <PlayerBoxScore gameId={gameId} canManage={canManage} />}
    </div>
  );
}
