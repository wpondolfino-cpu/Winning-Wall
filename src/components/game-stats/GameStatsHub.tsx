// src/components/game-stats/GameStatsHub.tsx
// Single nav entry point for the Game Stats feature. Coaches/admins land
// on the games list, can start/continue live entry on a draft game, or
// open its report. Players land on a read-only list of published games
// and can only open reports -- RLS keeps draft games and raw possessions
// out of their queries entirely, so there's no client-side gating to get
// wrong here.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import GamesHistory from "../coach/GamesHistory";
import GameTracker from "../coach/GameTracker";
import GameReport, { ReportScope } from "./GameReport";

interface Props {
  currentUserRole: "player" | "coach" | "admin";
  userId: string;
}

type View = { mode: "list" } | { mode: "track"; gameId: string } | { mode: "report"; gameId: string; opponent: string };

export default function GameStatsHub({ currentUserRole, userId }: Props) {
  const [view, setView] = useState<View>({ mode: "list" });
  const [quarter, setQuarter] = useState(1);

  if (currentUserRole === "player") {
    return <PlayerGamesList userId={userId} view={view} setView={setView} />;
  }

  if (view.mode === "list") {
    return (
      <GamesHistory
        userId={userId}
        onOpenGame={(gameId) => setView({ mode: "track", gameId })}
      />
    );
  }

  if (view.mode === "track") {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
          <button onClick={() => setView({ mode: "list" })} style={backBtn}>← Games</button>
          <div className="role-tabs" style={{ margin: 0 }}>
            {[1, 2, 3, 4].map((q) => (
              <button key={q} className={`role-tab ${quarter === q ? "active" : ""}`} onClick={() => setQuarter(q)}>
                Q{q}
              </button>
            ))}
          </div>
          <button onClick={() => setView({ mode: "report", gameId: view.gameId, opponent: "" })} style={backBtn}>
            View report →
          </button>
        </div>
        <GameTracker gameId={view.gameId} userId={userId} quarter={quarter} />
      </div>
    );
  }

  const scope: ReportScope = { kind: "game", gameId: view.gameId };
  return (
    <div>
      <button onClick={() => setView({ mode: "track", gameId: view.gameId })} style={backBtn}>← Back to tracker</button>
      <GameReport scope={scope} title="Full game" />
    </div>
  );
}

function PlayerGamesList({ userId, view, setView }: { userId: string; view: View; setView: (v: View) => void }) {
  // Players only ever see published games (RLS-enforced), so this reuses
  // GamesHistory's list rendering isn't appropriate -- it has coach-only
  // actions -- so a lightweight published-only list lives here instead.
  const [games, setGames] = useState<{ id: string; opponent: string; game_date: string; final_score_us: number | null; final_score_them: number | null }[] | null>(null);

  useEffect(() => {
    supabase
      .from("games")
      .select("id, opponent, game_date, final_score_us, final_score_them")
      .order("game_date", { ascending: false })
      .then(({ data }) => setGames(data ?? []));
  }, []);

  if (view.mode === "report") {
    return (
      <div>
        <button onClick={() => setView({ mode: "list" })} style={backBtn}>← Games</button>
        <GameReport scope={{ kind: "game", gameId: view.gameId }} title={`vs ${view.opponent}`} />
      </div>
    );
  }

  if (games === null) {
    return <div className="card">Loading games…</div>;
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>Games</div>
      {games.map((g) => (
        <div
          key={g.id}
          onClick={() => setView({ mode: "report", gameId: g.id, opponent: g.opponent })}
          style={{ padding: "10px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}
        >
          <span style={{ fontSize: 14 }}>vs {g.opponent}</span>{" "}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            · {g.game_date}
            {g.final_score_us != null && g.final_score_them != null
              ? ` · ${g.final_score_us > g.final_score_them ? "W" : "L"} ${g.final_score_us}-${g.final_score_them}`
              : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

const backBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};
