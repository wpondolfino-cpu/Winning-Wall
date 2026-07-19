// src/components/game-stats/GameStatsHub.tsx
// Single nav entry point for the Game Stats feature, split into two
// top-level tabs for coaches/admins: Games (create/track/edit individual
// games) and Reports (build cross-game reports and revisit saved ones).
// Players skip the tab split entirely -- they get a read-only list of
// published games and can only open reports. RLS keeps draft games, raw
// possessions, and saved report filters out of their queries, so there's
// no client-side gating to get wrong here.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { finishGame, isGameFinal, listSavedReports, deleteSavedReport, type SavedReport } from "../../lib/gameStats";
import GamesHistory from "../coach/GamesHistory";
import GameTracker from "../coach/GameTracker";
import GameReport, { ReportScope } from "./GameReport";
import PossessionEditor from "./PossessionEditor";
import ReportBuilder from "./ReportBuilder";

interface Props {
  currentUserRole: "player" | "coach" | "admin";
  userId: string;
}

type GamesView =
  | { mode: "list" }
  | { mode: "track"; gameId: string }
  | { mode: "report"; gameId: string; opponent: string }
  | { mode: "edit"; gameId: string; opponent: string };

type ReportsView = { mode: "history" } | { mode: "builder"; saved?: SavedReport };

export default function GameStatsHub({ currentUserRole, userId }: Props) {
  const [topTab, setTopTab] = useState<"games" | "reports">("games");
  const [gamesView, setGamesView] = useState<GamesView>({ mode: "list" });
  const [reportsView, setReportsView] = useState<ReportsView>({ mode: "history" });
  const [quarter, setQuarter] = useState(1);
  const [gameFinal, setGameFinal] = useState<boolean | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finalUs, setFinalUs] = useState("");
  const [finalThem, setFinalThem] = useState("");
  const [reportSel, setReportSel] = useState<{ kind: "quarter"; quarter: number } | { kind: "half"; half: 1 | 2 } | { kind: "game" }>({ kind: "game" });

  const activeGameId = gamesView.mode === "track" || gamesView.mode === "report" || gamesView.mode === "edit" ? gamesView.gameId : null;

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
    return <PlayerGamesList userId={userId} />;
  }

  return (
    <div>
      <div className="role-tabs" style={{ marginBottom: 12, width: "100%", maxWidth: 1400 }}>
        <button className={`role-tab ${topTab === "games" ? "active" : ""}`} onClick={() => setTopTab("games")}>Games</button>
        <button className={`role-tab ${topTab === "reports" ? "active" : ""}`} onClick={() => setTopTab("reports")}>Reports</button>
      </div>

      {topTab === "games" && (
        <GamesTab
          userId={userId}
          view={gamesView}
          setView={setGamesView}
          quarter={quarter}
          setQuarter={setQuarter}
          gameFinal={gameFinal}
          finishing={finishing}
          setFinishing={setFinishing}
          finalUs={finalUs}
          setFinalUs={setFinalUs}
          finalThem={finalThem}
          setFinalThem={setFinalThem}
          handleFinish={handleFinish}
          reportSel={reportSel}
          setReportSel={setReportSel}
        />
      )}

      {topTab === "reports" && (
        <ReportsTab userId={userId} view={reportsView} setView={setReportsView} />
      )}
    </div>
  );
}

function GamesTab({
  userId,
  view,
  setView,
  quarter,
  setQuarter,
  gameFinal,
  finishing,
  setFinishing,
  finalUs,
  setFinalUs,
  finalThem,
  setFinalThem,
  handleFinish,
  reportSel,
  setReportSel,
}: {
  userId: string;
  view: GamesView;
  setView: (v: GamesView) => void;
  quarter: number;
  setQuarter: (q: number) => void;
  gameFinal: boolean | null;
  finishing: boolean;
  setFinishing: (b: boolean) => void;
  finalUs: string;
  setFinalUs: (s: string) => void;
  finalThem: string;
  setFinalThem: (s: string) => void;
  handleFinish: (gameId: string) => void;
  reportSel: { kind: "quarter"; quarter: number } | { kind: "half"; half: 1 | 2 } | { kind: "game" };
  setReportSel: (s: { kind: "quarter"; quarter: number } | { kind: "half"; half: 1 | 2 } | { kind: "game" }) => void;
}) {
  if (view.mode === "list") {
    return (
      <GamesHistory
        userId={userId}
        onOpenGame={(gameId) => setView({ mode: "track", gameId })}
        onEditGame={(gameId) => setView({ mode: "edit", gameId, opponent: "" })}
      />
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
          <button
            onClick={() => { setReportSel({ kind: "quarter", quarter }); setView({ mode: "report", gameId: view.gameId, opponent: "" }); }}
            style={backBtn}
          >
            View report →
          </button>
          {!gameFinal && <button onClick={() => setFinishing(true)} style={backBtn}>Finish game</button>}
        </div>
        {finishing && (
          <div className="card" style={{ width: "100%", maxWidth: 1400, marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

  // view.mode === "report"
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

function ReportsTab({ userId, view, setView }: { userId: string; view: ReportsView; setView: (v: ReportsView) => void }) {
  const [history, setHistory] = useState<SavedReport[] | null>(null);
  const season = currentSeason();

  useEffect(() => { if (view.mode === "history") loadHistory(); }, [view.mode]);

  async function loadHistory() {
    const { data } = await listSavedReports(season);
    setHistory((data as SavedReport[]) ?? []);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this saved report?")) return;
    const { error } = await deleteSavedReport(id);
    if (!error) setHistory((h) => (h ?? []).filter((r) => r.id !== id));
  }

  if (view.mode === "builder") {
    return (
      <div>
        <button onClick={() => setView({ mode: "history" })} style={{ ...backBtn, marginBottom: 10 }}>← Reports</button>
        <ReportBuilder season={season} userId={userId} initial={view.saved} onSaved={loadHistory} />
      </div>
    );
  }

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Reports · {season}</span>
        <button className="btn-primary" style={{ padding: "6px 14px", width: "auto" }} onClick={() => setView({ mode: "builder" })}>
          Create report
        </button>
      </div>

      {history === null && <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>}
      {history?.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No reports saved yet this season.</div>}
      {history?.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ cursor: "pointer" }} onClick={() => setView({ mode: "builder", saved: r })}>
            <span style={{ fontSize: 14 }}>{r.label}</span>{" "}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>· {new Date(r.created_at).toLocaleDateString()}</span>
          </div>
          <button style={{ ...backBtn, background: "transparent", color: "#8a2f2f" }} onClick={() => remove(r.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

function PlayerGamesList({ userId }: { userId: string }) {
  // Players only ever see published games (RLS-enforced) and have no
  // Games/Reports split -- just a list that opens straight into a report.
  type View = { mode: "list" } | { mode: "report"; gameId: string; opponent: string };
  const [view, setView] = useState<View>({ mode: "list" });
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
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
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
