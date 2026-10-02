// src/components/quizzes/QuizzesPage.tsx
// The coach's Quizzes page: every quiz (scout and standalone) in one list,
// filterable by team. New quiz makes either kind: a standalone quiz, or a
// game's scout quiz -- which is the same quiz as on that game's scout
// sheet (one per game), so it can be made and edited from either place.

import { useCallback, useEffect, useState } from "react";
import {
  QuizListItem, QuizGameOption, getAllQuizzes, getReteachCount, createStandaloneQuiz,
  getGamesForScoutQuiz, createScoutQuizForGame,
} from "../../lib/quizzes";
import { getRosters } from "../../lib/practicePlanner";
import { formatDateOnly } from "../../lib/schedule";
import { inputStyle } from "../../lib/inputStyle";
import QuizManager from "./QuizManager";
import { card, pill, primaryBtn, secondaryBtn, label } from "./quizStyles";

type Team = { id: string; name: string };

function dueLabel(item: QuizListItem): string | null {
  if (item.kind === "scout") {
    if (!item.gameDate) return null;
    const day = formatDateOnly(item.gameDate, { weekday: "short", month: "short", day: "numeric" });
    if (!item.tipTime) return day;
    const [h, m] = item.tipTime.split(":").map(Number);
    return `${day} ${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  if (!item.quiz.due_at) return null;
  return new Date(item.quiz.due_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function QuizzesPage() {
  const [items, setItems] = useState<QuizListItem[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [reteach, setReteach] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<QuizListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, rosters] = await Promise.all([getAllQuizzes(), getRosters()]);
      setItems(list);
      setTeams(rosters.map(r => ({ id: r.id, name: r.name })));
      // Re-teach flags for live quizzes only, filled in as they arrive.
      list.filter(i => i.quiz.status === "published").forEach(i => {
        getReteachCount(i.quiz.id).then(n => setReteach(r => ({ ...r, [i.quiz.id]: n }))).catch(() => {});
      });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load quizzes.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(null); load(); };

  if (creating) {
    return (
      <NewQuizForm teams={teams} onCancel={() => setCreating(false)}
        onCreated={async id => {
          setCreating(false);
          await load();
          setOpen({ quiz: { id } as any, kind: "standalone", gameDate: null, tipTime: null, submitted: 0 });
        }}
        onScoutCreated={async sheetId => {
          setCreating(false);
          await load();
          setOpen({ quiz: { id: sheetId, scout_sheet_id: sheetId } as any, kind: "scout", gameDate: null, tipTime: null, submitted: 0 });
        }} />
    );
  }

  if (open) {
    return (
      <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
        <button type="button" onClick={close} style={{ ...secondaryBtn, marginBottom: 12 }}>← All quizzes</button>
        {open.kind === "scout" && open.quiz.scout_sheet_id
          ? <QuizManager scoutSheetId={open.quiz.scout_sheet_id} />
          : <QuizManager quizId={open.quiz.id} onDeleted={close} />}
      </div>
    );
  }

  const teamName = (id: string) => teams.find(t => t.id === id)?.name ?? "Team";
  const shown = (items ?? []).filter(i => teamFilter === "all" || i.quiz.roster_ids.includes(teamFilter));

  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Quizzes</div>
        <button type="button" onClick={() => setCreating(true)} style={primaryBtn}>+ New quiz</button>
      </div>
      {error && <div className="error-msg">{error}</div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[{ id: "all", name: "All teams" }, ...teams].map(t => (
          <button key={t.id} type="button" onClick={() => setTeamFilter(t.id)}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
              border: teamFilter === t.id ? "1px solid var(--royal-light)" : "1px solid var(--border)",
              background: teamFilter === t.id ? "rgba(37,80,212,0.18)" : "var(--surface2)",
              color: teamFilter === t.id ? "var(--text)" : "var(--muted)" }}>
            {t.name}
          </button>
        ))}
      </div>

      {items === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ ...card, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          No quizzes{teamFilter !== "all" ? " for this team" : ""} yet. Use New quiz to make a scout quiz for a game,
          or a standalone one for anything else, like terms or rules.
        </div>
      ) : (
        <div style={card}>
          {shown.map((i, idx) => {
            const due = dueLabel(i);
            const statusKind = i.quiz.status === "published" ? "good" : i.quiz.status === "draft" ? "warn" : "plain";
            const statusText = i.quiz.status === "published" ? "Live" : i.quiz.status === "draft" ? "Draft" : "Archived";
            const flags = reteach[i.quiz.id] ?? 0;
            return (
              <div key={i.quiz.id} onClick={() => setOpen(i)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer",
                  borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={pill(i.kind === "scout" ? "info" : "plain")}>{i.kind === "scout" ? "Scout" : "Standalone"}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{i.quiz.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                    {i.quiz.roster_ids.length ? i.quiz.roster_ids.map(teamName).join(", ") : "All players"}
                    {due ? ` · Due ${due}` : ""}
                    {i.quiz.status !== "draft" ? ` · ${i.submitted} finished` : ""}
                  </div>
                </div>
                {flags > 0 && <span style={pill("bad")}>{flags} to re-teach</span>}
                <span style={pill(statusKind)}>{statusText}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function gameLabel(g: QuizGameOption, teams: Team[]): string {
  const day = formatDateOnly(g.game_date, { weekday: "short", month: "short", day: "numeric" });
  const team = g.roster_id ? teams.find(t => t.id === g.roster_id)?.name : null;
  return `${day} · ${g.opponent || "Opponent"}${team ? ` · ${team}` : ""}`;
}

function NewQuizForm({ teams, onCancel, onCreated, onScoutCreated }: {
  teams: Team[]; onCancel: () => void; onCreated: (id: string) => void; onScoutCreated: (scoutSheetId: string) => void;
}) {
  const [kind, setKind] = useState<"scout" | "standalone">("scout");
  const [games, setGames] = useState<QuizGameOption[] | null>(null);
  const [gameId, setGameId] = useState("");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGamesForScoutQuiz().then(setGames).catch(() => setGames([]));
  }, []);

  async function create() {
    setError(null);
    if (kind === "scout") {
      if (!gameId) { setError("Pick a game."); return; }
      setSaving(true);
      try { onScoutCreated(await createScoutQuizForGame(gameId)); }
      catch (e: any) { setError(e?.message ?? "Couldn't make the scout quiz."); setSaving(false); }
      return;
    }
    if (!title.trim()) { setError("Give the quiz a title."); return; }
    if (!picked.length) { setError("Pick at least one team."); return; }
    setSaving(true);
    try {
      let dueAt: string | null = null;
      if (due) {
        const [y, m, d] = due.split("-").map(Number);
        dueAt = new Date(y, m - 1, d, 23, 59, 0).toISOString();
      }
      onCreated(await createStandaloneQuiz(title, picked, dueAt));
    } catch (e: any) {
      setError(e?.message ?? "Couldn't create the quiz.");
      setSaving(false);
    }
  }

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>New quiz</div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {([["scout", "Scout quiz"], ["standalone", "Standalone"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setKind(k); setError(null); }}
              style={{ fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: kind === k ? "var(--royal)" : "var(--surface)", color: kind === k ? "#fff" : "var(--muted)" }}>
              {l}
            </button>
          ))}
        </div>
        {error && <div className="error-msg">{error}</div>}

        {kind === "scout" ? (
          <>
            <div style={label}>Game</div>
            <select value={gameId} onChange={e => setGameId(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 8 }}>
              <option value="">{games === null ? "Loading games…" : games.length ? "Pick a game" : "No upcoming games on the schedule"}</option>
              {(games ?? []).map(g => <option key={g.id} value={g.id}>{gameLabel(g, teams)}</option>)}
            </select>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginBottom: 16 }}>
              Questions are built from the game's scout sheet, so fill that in first for the best quiz. If the game
              already has a scout quiz, this opens it. It's the same quiz as the one on the sheet's Quiz tab, and the
              team comes from the game.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={create} disabled={saving} style={primaryBtn}>{saving ? "Building…" : "Build scout quiz"}</button>
              <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
            </div>
          </>
        ) : (<>
        <div style={label}>Title</div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Basketball terms 101"
          style={{ ...inputStyle, width: "100%", marginBottom: 12 }} />

        <div style={label}>Teams</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {teams.map(t => {
            const on = picked.includes(t.id);
            return (
              <button key={t.id} type="button"
                onClick={() => setPicked(p => (on ? p.filter(x => x !== t.id) : [...p, t.id]))}
                style={{ fontSize: 13, padding: "5px 12px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
                  border: on ? "1px solid var(--royal-light)" : "1px solid var(--border)",
                  background: on ? "rgba(37,80,212,0.18)" : "var(--surface)", color: on ? "var(--text)" : "var(--muted)" }}>
                {t.name}
              </button>
            );
          })}
          {teams.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>No active teams. Add one under Players &amp; Coaches.</span>}
        </div>

        <div style={label}>Due (optional)</div>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={create} disabled={saving} style={primaryBtn}>{saving ? "Creating…" : "Create draft"}</button>
          <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
        </div>
        </>)}
      </div>
    </div>
  );
}
