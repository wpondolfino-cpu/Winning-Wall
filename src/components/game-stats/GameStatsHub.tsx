// src/components/game-stats/GameStatsHub.tsx
// Single nav entry point for the Game Stats feature. Coaches/admins land
// on the games list, can start/continue live entry on a draft game, review
// and correct possessions after watching film, open a single game's
// report, or build a custom cross-game report (e.g. "last 5 games,
// transition offense"). Players land on a read-only list of published
// games and can only open reports -- RLS keeps draft games and raw
// possessions out of their queries entirely, so there's no client-side
// gating to get wrong here.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { finishGame, isGameFinal } from "../../lib/gameStats";
import GamesHistory from "../coach/GamesHistory";
import GameTracker from "../coach/GameTracker";
import GameReport, { ReportScope } from "./GameReport";
import PossessionEditor from "./PossessionEditor";
import ReportBuilder from "./ReportBuilder";

interface Props {
  currentUserRole: "player" | "coach" | "admin";
  userId: string;
}

type View =
  | { mode: "list" }
  | { mode: "track"; gameId: string }
  | { mode: "report"; gameId: string; opponent: string }
  | { mode: "edit"; gameId: string; opponent: string }
  | { mode: "reports" };

export default function GameStatsHub({ currentUserRole, userId }: Props) {
  const [view, setView] = useState<View>({ mode: "list" });
  const [quarter, setQuarter] = useState(1);
  const [gameFinal, setGameFinal] = useState<boolean | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finalUs, setFinalUs] = useState("");
  const [finalThem, setFinalThem] = useState("");
  const [reportSel, setReportSel] = useState<{ kind: "quarter"; quarter: number } | { kind: "half"; half: 1 | 2 } | { kind: "game" }>({ kind: "game" });

  const activeGameId = view.mode === "track" || view.mode === "report" || view.mode === "edit" ? view.gameId : null;

  useEffect(() => {
    if (!activeGameId) { setGameFinal(null); return; }
    supabase
      .from("games")
      .select("final_score_us, final_score_them")
      .eq("id", activeGameId)
      .single()
      .then(({ data }) => setGameFinal(data ? isGameFinal(data as any) : false));
  }, [activeGameId]);

  async function handleFinish(gameId: string) {
    const us = Number(finalUs);
    const them = Number(finalThem);
    if (Number.isNaN(us) || Number.isNaN(them)) return;
    const { error } = await finishGame(gameId, us, them);
    if (!error) {
      setGameFinal(true);
      setFinishing(false);
    }
  }

  if (currentUserRole === "player") {
    return <PlayerGamesList userId={userId} view={view} setView={setView} />;
  }

  if (view.mode === "list") {
    return (
      <div>
        <button onClick={() => setView({ mode: "reports" })} style={{ ...backBtn, marginBottom: 10 }}>
          📊 Build a report
        </button>
        <GamesHistory
          userId={userId}
          onOpenGame={(gameId) => setView({ mode: "track", gameId })}
          onEditGame={(gameId) => setView({ mode: "edit", gameId, opponent: "" })}
        />
      </div>
    );
  }

  if (view.mode === "reports") {
    return (
      <div>
        <button onClick={() => setView({ mode: "list" })} style={{ ...backBtn, marginBottom: 10 }}>← Games</button>
        <ReportBuilder season={currentSeason()} />
      </div>
    );
  }

  if (view.mode === "edit") {
    if (gameFinal === false) {
      return (
        <div>
          <button onClick={() => setView({ mode: "list" })} style={{ ...backBtn, marginBottom: 10 }}>← Games</button>
          <div className="card">This game hasn't been finished yet -- finish it first (final score) before correcting possessions.</div>
        </div>
      );
    }
    return (
      <div>
        <button onClick={() => setView({ mode: "list" })} style={{ ...backBtn, marginBottom: 10 }}>← Games</button>
        <PossessionEditor gameId={view.gameId} opponent={view.opponent} />
      </div>
    );
  }

  if (view.mode === "track") {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setView({ mode: "list" })} style={backBtn}>← Games</button>
          <div className="role-tabs" style={{ margin: 0 }}>
            {[1, 2, 3, 4].map((q) => (
              <button key={q} className={`role-tab ${quarter === q ? "active" : ""}`} onClick={() => setQuarter(q)}>
                Q{q}
              </button>
            ))}
          </div>
          <button onClick={() => { setReportSel({ kind: "quarter", quarter }); setView({ mode: "report", gameId: view.gameId, opponent: "" }); }} style={backBtn}>
            View report →
          </button>
          {!gameFinal && (
            <button onClick={() => setFinishing(true)} style={backBtn}>Finish game</button>
          )}
        </div>
        {finishing && (
          <div className="card" style={{ maxWidth: 640, marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Final score — Us</span>
            <input type="number" value={finalUs} onChange={(e) => setFinalUs(e.target.value)} style={{ width: 56, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Them</span>
            <input type="number" value={finalThem} onChange={(e) => setFinalThem(e.target.value)} style={{ width: 56, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }} />
            <button className="btn-primary" style={{ width: "auto", padding: "6px 14px" }} onClick={() => handleFinish(view.gameId)}>Save</button>
            <button style={{ ...backBtn, background: "transparent" }} onClick={() => setFinishing(false)}>Cancel</button>
          </div>
        )}
        <GameTracker gameId={view.gameId} userId={userId} quarter={quarter} />
      </div>
    );
  }

  const scope: ReportScope =
    reportSel.kind === "quarter" ? { kind: "quarter", gameId: view.gameId, quarter: reportSel.quarter } :
    reportSel.kind === "half" ? { kind: "half", gameId: view.gameId, half: reportSel.half } :
    { kind: "game", gameId: view.gameId };
  const title =
    reportSel.kind === "quarter" ? `Q${reportSel.quarter}` :
    reportSel.kind === "half" ? (reportSel.half === 1 ? "Halftime (Q1-Q2)" : "2nd half (Q3-Q4)") :
    "Full game";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={() => setView({ mode: "track", gameId: view.gameId })} style={backBtn}>← Back to tracker</button>
        {gameFinal && (
          <button onClick={() => setView({ mode: "edit", gameId: view.gameId, opponent: view.opponent })} style={backBtn}>Edit stats</button>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[1, 2, 3, 4].map((q) => (
          <button key={q} onClick={() => setReportSel({ kind: "quarter", quarter: q })} style={pillBtn(reportSel.kind === "quarter" && reportSel.quarter === q)}>
            Q{q}
          </button>
        ))}
        <button onClick={() => setReportSel({ kind: "half", half: 1 })} style={pillBtn(reportSel.kind === "half" && reportSel.half === 1)}>Halftime</button>
        <button onClick={() => setReportSel({ kind: "half", half: 2 })} style={pillBtn(reportSel.kind === "half" && reportSel.half === 2)}>2nd half</button>
        <button onClick={() => setReportSel({ kind: "game" })} style={pillBtn(reportSel.kind === "game")}>Full game</button>
      </div>
      <GameReport scope={scope} title={title} />
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

function currentSeason(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
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

function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    fontSize: 13,
    borderRadius: 20,
    border: `1px solid ${active ? "var(--royal-light)" : "var(--border)"}`,
    background: active ? "var(--royal)" : "var(--surface2)",
    color: active ? "#fff" : "var(--text)",
    cursor: "pointer",
  };
}
