// src/components/quizzes/QuizzesPage.tsx
// The coach's Quizzes page: every quiz (scout and standalone) in one list,
// filterable by team, with New quiz for standalone ones. Scout quizzes are
// only CREATED from their scout sheet, so there's one place they're made;
// they're listed here so everything is visible at a glance.

import { useCallback, useEffect, useState } from "react";
import {
  QuizListItem, getAllQuizzes, getReteachCount, createStandaloneQuiz,
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
          No quizzes{teamFilter !== "all" ? " for this team" : ""} yet. Scout quizzes are made from a scout sheet's Quiz tab;
          use New quiz for anything else, like terms or rules.
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

function NewQuizForm({ teams, onCancel, onCreated }: { teams: Team[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
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
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>New quiz</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          For a scout quiz, open the scout sheet instead. Its quiz builds from the sheet.
        </div>
        {error && <div className="error-msg">{error}</div>}

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
      </div>
    </div>
  );
}
