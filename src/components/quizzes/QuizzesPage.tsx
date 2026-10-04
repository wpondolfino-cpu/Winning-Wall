// src/components/quizzes/QuizzesPage.tsx
// The coach's Quizzes page: every quiz (scout and standalone) in one list,
// filterable by team. New quiz makes either kind: a standalone quiz, or a
// game's scout quiz -- which is the same quiz as on that game's scout
// sheet (one per game), so it can be made and edited from either place.

import { useCallback, useEffect, useState } from "react";
import {
  QuizListItem, QuizGameOption, getAllQuizzes, getReteachCount, createStandaloneQuiz,
  getGamesForScoutQuiz, createScoutQuizForGame, createPlayQuiz, PlayQType, PLAY_QTYPE_LABEL,
  QuizBundle, getQuizBundle, getQuizResults, resultsToCsv, publishQuiz, deleteQuiz,
} from "../../lib/quizzes";
import { getRoster, RosterPlayer } from "../../lib/plays";
import QuizPreview from "./QuizPreview";
import QuizPrintView from "./QuizPrintView";
import { getPlaybooks, getMyPlays, Playbook, Play } from "../../lib/plays";
import { createReviewQuiz, getGamesForReview } from "../../lib/gameReviewQuiz";
import { getRosters } from "../../lib/practicePlanner";
import { formatDateOnly } from "../../lib/schedule";
import { inputStyle } from "../../lib/inputStyle";
import QuizManager from "./QuizManager";
import { card, pill, primaryBtn, secondaryBtn, label } from "./quizStyles";

type Team = { id: string; name: string };

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

export interface QuizPrefill { playbookId: string; name: string; quizId: string | null; }

export default function QuizzesPage({ prefill, onPrefillUsed }: {
  /** From a playbook's Make quiz / Open quiz button. */
  prefill?: QuizPrefill | null;
  onPrefillUsed?: () => void;
} = {}) {
  const [items, setItems] = useState<QuizListItem[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [reteach, setReteach] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<QuizListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [formStart, setFormStart] = useState<{ playbookId: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Row ⋯ menu, and what its actions open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ bundle: QuizBundle; roster: RosterPlayer[] } | null>(null);
  const [printing, setPrinting] = useState<QuizBundle | null>(null);

  // Close an open menu on any click elsewhere.
  useEffect(() => {
    if (!menuFor) return;
    const off = () => setMenuFor(null);
    window.addEventListener("click", off);
    return () => window.removeEventListener("click", off);
  }, [menuFor]);

  async function act(item: QuizListItem, action: "preview" | "publish" | "export" | "print" | "delete") {
    setMenuFor(null); setError(null); setNotice(null);
    setBusyId(item.quiz.id);
    try {
      if (action === "preview") {
        const [bundle, roster] = await Promise.all([getQuizBundle(item.quiz.id), getRoster()]);
        if (!bundle.questions.length) { setError("This quiz has no questions to preview yet."); return; }
        setPreview({ bundle, roster });
      } else if (action === "print") {
        const bundle = await getQuizBundle(item.quiz.id);
        if (!bundle.questions.length) { setError("This quiz has no questions to print yet."); return; }
        setPrinting(bundle);
      } else if (action === "export") {
        const bundle = await getQuizBundle(item.quiz.id);
        const csv = resultsToCsv(bundle, await getQuizResults(bundle));
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${item.quiz.title.replace(/[^\w\- ]+/g, "").trim() || "quiz"} results.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (action === "publish") {
        const replacing = items?.find(o => o.quiz.status === "published" && o.quiz.id !== item.quiz.id &&
          ((item.quiz.scout_sheet_id && o.quiz.scout_sheet_id === item.quiz.scout_sheet_id) || o.quiz.id === item.quiz.replaces_quiz_id));
        const msg = replacing
          ? `Publish "${item.quiz.title}"? The current live version comes down (its results are kept). After publishing, only the wording can change.`
          : `Publish "${item.quiz.title}"? Players on its teams will see it. After publishing, only the wording can change.`;
        if (!window.confirm(msg)) return;
        await publishQuiz(item.quiz.id);
        setNotice(`"${item.quiz.title}" is live.`);
        await load();
      } else if (action === "delete") {
        const msg = item.quiz.status === "draft"
          ? `Delete the draft "${item.quiz.title}"?`
          : `Delete "${item.quiz.title}"? Every player's attempts and answers on it are deleted too. This can't be undone.`;
        if (!window.confirm(msg)) return;
        await deleteQuiz(item.quiz.id);
        await load();
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong — try again.");
    } finally {
      setBusyId(null);
    }
  }

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

  // Arriving from a playbook: open its quiz, or start a Plays quiz for it.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.quizId) {
      setOpen({ quiz: { id: prefill.quizId } as any, kind: "plays", gameDate: null, tipTime: null, submitted: 0, questionCount: 0, lastEdited: "" });
    } else {
      setFormStart({ playbookId: prefill.playbookId, title: `${prefill.name} quiz` });
      setCreating(true);
    }
    onPrefillUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const close = () => { setOpen(null); load(); };

  if (creating) {
    return (
      <NewQuizForm teams={teams} start={formStart} onCancel={() => { setCreating(false); setFormStart(null); }}
        onCreated={async id => {
          setCreating(false);
          await load();
          setOpen({ quiz: { id } as any, kind: "standalone", gameDate: null, tipTime: null, submitted: 0, questionCount: 0, lastEdited: "" });
        }}
        onPlaysCreated={async id => {
          setCreating(false);
          await load();
          setOpen({ quiz: { id } as any, kind: "plays", gameDate: null, tipTime: null, submitted: 0, questionCount: 0, lastEdited: "" });
        }}
        onScoutCreated={async sheetId => {
          setCreating(false);
          await load();
          setOpen({ quiz: { id: sheetId, scout_sheet_id: sheetId } as any, kind: "scout", gameDate: null, tipTime: null, submitted: 0, questionCount: 0, lastEdited: "" });
        }} />
    );
  }

  if (preview) {
    return (
      <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
        <QuizPreview bundle={preview.bundle} roster={preview.roster} onClose={() => setPreview(null)} />
      </div>
    );
  }

  if (printing) {
    const names = printing.quiz.roster_ids.map(id => teams.find(t => t.id === id)?.name ?? "Team").join(", ");
    return (
      <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
        <QuizPrintView bundle={printing} teamNames={names} onBack={() => setPrinting(null)} />
      </div>
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
      {notice && <div style={{ ...card, fontSize: 13, marginBottom: 12, borderColor: "rgba(40,180,80,0.4)" }}>{notice}</div>}

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
            const isDraft = i.quiz.status === "draft";
            const teamsText = i.quiz.roster_ids.length ? i.quiz.roster_ids.map(teamName).join(", ") : "All players";
            const meta = isDraft
              ? `${teamsText} · ${i.questionCount} question${i.questionCount === 1 ? "" : "s"} · Edited ${timeAgo(i.lastEdited)}`
              : `${teamsText}${due ? ` · Due ${due}` : ""} · ${i.submitted} finished`;
            const menuItem = (labelText: string, icon: string, action: Parameters<typeof act>[1], opts: { danger?: boolean; disabled?: string } = {}) => (
              <button type="button" disabled={!!opts.disabled}
                onClick={e => { e.stopPropagation(); if (!opts.disabled) act(i, action); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none",
                  padding: "8px 10px", borderRadius: 8, fontSize: 13, fontFamily: "inherit",
                  cursor: opts.disabled ? "default" : "pointer",
                  color: opts.disabled ? "var(--muted)" : opts.danger ? "#ff7b7b" : "var(--text)" }}>
                <span aria-hidden="true" style={{ width: 18, textAlign: "center" }}>{icon}</span>
                <span style={{ flex: 1 }}>{labelText}</span>
                {opts.disabled && <span style={{ fontSize: 10, color: "var(--muted)" }}>{opts.disabled}</span>}
              </button>
            );
            return (
              <div key={i.quiz.id} onClick={() => setOpen(i)}
                style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "12px 0", cursor: "pointer",
                  borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={pill(i.kind === "scout" ? "info" : i.kind === "plays" ? "warn" : i.kind === "review" ? "good" : "plain")}>
                      {i.kind === "scout" ? "Scout" : i.kind === "plays" ? "Plays" : i.kind === "review" ? "Game review" : "Standalone"}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{i.quiz.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{meta}</div>
                </div>
                {flags > 0 && <span style={pill("bad")}>{flags} to re-teach</span>}
                <span style={pill(statusKind)}>{statusText}</span>
                <button type="button" aria-label={`Actions for ${i.quiz.title}`} disabled={busyId === i.quiz.id}
                  onClick={e => { e.stopPropagation(); setMenuFor(menuFor === i.quiz.id ? null : i.quiz.id); }}
                  style={{ background: "none", border: "1px solid transparent", borderRadius: 6, padding: "2px 8px",
                    color: "var(--muted)", fontSize: 18, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" }}>
                  {busyId === i.quiz.id ? "…" : "⋯"}
                </button>
                <span aria-hidden="true" style={{ color: "var(--muted)", fontSize: 18 }}>›</span>

                {menuFor === i.quiz.id && (
                  <div onClick={e => e.stopPropagation()}
                    style={{ position: "absolute", right: 24, top: 44, zIndex: 20, minWidth: 220, padding: 6,
                      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>
                    {menuItem("Preview as a player", "▶", "preview")}
                    {isDraft ? menuItem("Publish…", "🌐", "publish")
                      : menuItem(i.quiz.status === "published" ? "Published" : "Archived", "🌐", "publish", { disabled: i.quiz.status === "published" ? "live" : "old version" })}
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
                    {isDraft ? menuItem("Export results", "📊", "export", { disabled: "once live" }) : menuItem("Export results (CSV)", "📊", "export")}
                    {menuItem("Print quiz + answer key", "🖨️", "print")}
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
                    {menuItem("Delete…", "🗑", "delete", { danger: true })}
                  </div>
                )}
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

const PLAY_TYPES: PlayQType[] = ["what_next", "who_ball", "tap_place", "two_part", "fill_read", "name_play"];
const PLAY_TYPE_HINT: Record<PlayQType, string> = {
  what_next: "\"Step 3 · Screen sets — what does the 4 do?\"",
  who_ball: "\"Who does the 1 pass to on this step?\"",
  name_play: "Watch the whole play, the court hides, pick the play",
  tap_place: "\"Tap where the 2 goes on this step\" — graded by distance",
  two_part: "\"What does the 2 do?\" then \"Now tap where\" (or who to, for a pass) — 2 points",
  fill_read: "A word blanked from your step notes — [bracket] the word to choose it",
};

function NewQuizForm({ teams, start, onCancel, onCreated, onScoutCreated, onPlaysCreated }: {
  teams: Team[]; start?: { playbookId: string; title: string } | null;
  onCancel: () => void; onCreated: (id: string) => void; onScoutCreated: (scoutSheetId: string) => void;
  onPlaysCreated: (quizId: string) => void;
}) {
  const [kind, setKind] = useState<"scout" | "plays" | "review" | "standalone">(start ? "plays" : "scout");
  // Game review
  const [reviewGames, setReviewGames] = useState<{ id: string; game_date: string; opponent: string | null; roster_id: string | null }[] | null>(null);
  const [reviewGameId, setReviewGameId] = useState("");
  // Plays
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [myPlays, setMyPlays] = useState<Play[] | null>(null);
  const [source, setSource] = useState<string>(start?.playbookId ?? "");   // playbook id, or "pick"
  const [pickedPlays, setPickedPlays] = useState<string[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<PlayQType, number>>({ what_next: 2, who_ball: 1, name_play: 1, tap_place: 1, two_part: 1, fill_read: 1 });
  const [typeOn, setTypeOn] = useState<Record<PlayQType, boolean>>({ what_next: true, who_ball: true, name_play: true, tap_place: true, two_part: false, fill_read: false });
  const [maxQ, setMaxQ] = useState(20);
  const [games, setGames] = useState<QuizGameOption[] | null>(null);
  const [gameId, setGameId] = useState("");
  const [title, setTitle] = useState(start?.title ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGamesForScoutQuiz().then(setGames).catch(() => setGames([]));
    getPlaybooks().then(list => setPlaybooks(list.filter(p => p.status !== "archived"))).catch(() => setPlaybooks([]));
    getMyPlays().then(setMyPlays).catch(() => setMyPlays([]));
    getGamesForReview().then(setReviewGames).catch(() => setReviewGames([]));
  }, []);

  async function create() {
    setError(null);
    if (kind === "review") {
      if (!reviewGameId) { setError("Pick a game."); return; }
      setSaving(true);
      try {
        const res = await createReviewQuiz(reviewGameId);
        onPlaysCreated(res.id);
      } catch (e: any) {
        setError(e?.message ?? "Couldn't build the review quiz.");
        setSaving(false);
      }
      return;
    }
    if (kind === "plays") {
      if (!title.trim()) { setError("Give the quiz a title."); return; }
      if (!source) { setError("Pick a playbook, or pick plays by hand."); return; }
      if (source === "pick" && !pickedPlays.length) { setError("Pick at least one play."); return; }
      if (!picked.length) { setError("Pick at least one team."); return; }
      if (!PLAY_TYPES.some(t => typeOn[t])) { setError("Pick at least one question type."); return; }
      if (!Number.isFinite(maxQ) || maxQ < 1 || maxQ > 100) { setError("Max questions must be 1 to 100."); return; }
      setSaving(true);
      try {
        let dueAt: string | null = null;
        if (due) {
          const [y, m, d] = due.split("-").map(Number);
          dueAt = new Date(y, m - 1, d, 23, 59, 0).toISOString();
        }
        const types: Partial<Record<PlayQType, number>> = {};
        PLAY_TYPES.forEach(t => { if (typeOn[t]) types[t] = Math.max(1, Math.min(5, Math.round(typeCounts[t] || 1))); });
        const res = await createPlayQuiz({
          title, playbookId: source === "pick" ? null : source, playIds: source === "pick" ? pickedPlays : [],
          rosterIds: picked, dueAt, settings: { types, maxQuestions: Math.round(maxQ) },
        });
        onPlaysCreated(res.id);
      } catch (e: any) {
        setError(e?.message ?? "Couldn't build the play quiz.");
        setSaving(false);
      }
      return;
    }
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
          {([["scout", "Scout quiz"], ["plays", "Plays"], ["review", "Game review"], ["standalone", "Standalone"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setKind(k); setError(null); }}
              style={{ fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: kind === k ? "var(--royal)" : "var(--surface)", color: kind === k ? "#fff" : "var(--muted)" }}>
              {l}
            </button>
          ))}
        </div>
        {error && <div className="error-msg">{error}</div>}

        {kind === "review" ? (
          <>
            <div style={label}>Game</div>
            <select value={reviewGameId} onChange={e => setReviewGameId(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 8 }}>
              <option value="">{reviewGames === null ? "Loading games…" : reviewGames.length ? "Pick a game" : "No played games yet"}</option>
              {(reviewGames ?? []).map(g => (
                <option key={g.id} value={g.id}>
                  {formatDateOnly(g.game_date, { weekday: "short", month: "short", day: "numeric" })} · {g.opponent || "Opponent"}
                  {g.roster_id && teams.find(t => t.id === g.roster_id) ? ` · ${teams.find(t => t.id === g.roster_id)!.name}` : ""}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginBottom: 16 }}>
              Built from the game's end-of-game report — team stats only, never individual or lineup stats: goal checks,
              where the game was won or lost, which sets worked, and scoring runs. The team comes from the game.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={create} disabled={saving} style={primaryBtn}>{saving ? "Building…" : "Build review quiz"}</button>
              <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
            </div>
          </>
        ) : kind === "scout" ? (
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
        ) : kind === "plays" ? (
          <>
            <div style={label}>Title</div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Halfcourt sets review"
              style={{ ...inputStyle, width: "100%", marginBottom: 12 }} />

            <div style={label}>Plays from</div>
            <select value={source} onChange={e => setSource(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 8 }}>
              <option value="">{playbooks === null ? "Loading playbooks…" : "Pick a playbook"}</option>
              {(playbooks ?? []).map(pb => <option key={pb.id} value={pb.id}>{pb.name}{pb.status === "draft" ? " (draft)" : ""}</option>)}
              <option value="pick">Pick plays by hand…</option>
            </select>
            {source === "pick" && (
              <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
                {(myPlays ?? []).length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>{myPlays === null ? "Loading…" : "You don't have any plays yet."}</div>}
                {(myPlays ?? []).map(pl => (
                  <label key={pl.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
                    <input type="checkbox" checked={pickedPlays.includes(pl.id)}
                      onChange={() => setPickedPlays(p => (p.includes(pl.id) ? p.filter(x => x !== pl.id) : [...p, pl.id]))} />
                    {pl.title}
                  </label>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
              Plays only another coach can open are skipped. Players see the quiz's questions, not the playbook, so share the
              playbook with them too if you want them to study it.
            </div>

            <div style={label}>Teams</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {teams.map(t => {
                const on = picked.includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => setPicked(p => (on ? p.filter(x => x !== t.id) : [...p, t.id]))}
                    style={{ fontSize: 13, padding: "5px 12px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
                      border: on ? "1px solid var(--royal-light)" : "1px solid var(--border)",
                      background: on ? "rgba(37,80,212,0.18)" : "var(--surface)", color: on ? "var(--text)" : "var(--muted)" }}>
                    {t.name}
                  </button>
                );
              })}
            </div>

            <div style={label}>Question types</div>
            {PLAY_TYPES.map(t => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <input type="checkbox" checked={typeOn[t]} onChange={e => setTypeOn(o => ({ ...o, [t]: e.target.checked }))} aria-label={PLAY_QTYPE_LABEL[t]} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{PLAY_QTYPE_LABEL[t]}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{PLAY_TYPE_HINT[t]}</div>
                </div>
                {t !== "name_play" && (
                  <>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>per play</span>
                    <input type="number" min={1} max={5} value={typeCounts[t]} disabled={!typeOn[t]}
                      onChange={e => setTypeCounts(c => ({ ...c, [t]: Number(e.target.value) }))}
                      style={{ ...inputStyle, width: 56, padding: "5px 8px" }} />
                  </>
                )}
              </div>
            ))}
            {(["Why / what-if (AI, from step notes)"]).map(l => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)", opacity: 0.5 }}>
                <input type="checkbox" disabled aria-label={l} />
                <div style={{ flex: 1, fontSize: 13 }}>{l}</div>
                <span style={pill("plain")}>Coming soon</span>
              </div>
            ))}

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0 16px" }}>
              <div>
                <div style={label}>Max questions</div>
                <input type="number" min={1} max={100} value={maxQ} onChange={e => setMaxQ(Number(e.target.value))}
                  style={{ ...inputStyle, width: 80 }} />
              </div>
              <div>
                <div style={label}>Due (optional)</div>
                <input type="date" value={due} onChange={e => setDue(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={create} disabled={saving} style={primaryBtn}>{saving ? "Building…" : "Build draft"}</button>
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
