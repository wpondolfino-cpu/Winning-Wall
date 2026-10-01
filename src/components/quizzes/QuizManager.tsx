// src/components/quizzes/QuizManager.tsx
// The coach's Quiz tab on a scout sheet.
//
//   No quiz yet  -> Generate (questions built from the sheet's structured
//                   fields; AI drafts can be added from the free text).
//   Draft        -> edit everything, settings, Publish.
//   Published    -> Results, wording-only edits, Regenerate (a new draft
//                   version; this one stays live until that's published).
//   Archived     -> read-only results of an older version.

import { useCallback, useEffect, useState } from "react";
import {
  Quiz, QuizBundle, QuizQuestion, QuestionDraft,
  getQuizzesForSheet, getQuizBundle, createDraftForSheet, addQuestions, saveDraftQuestion,
  saveWording, deleteQuestion, moveQuestion, updateQuizSettings, publishQuiz, deleteQuiz,
  draftQuestionsWithAi,
} from "../../lib/quizzes";
import { getRoster, RosterPlayer } from "../../lib/plays";
import { inputStyle } from "../../lib/inputStyle";
import QuizQuestionEditor from "./QuizQuestionEditor";
import QuizResults from "./QuizResults";
import { card, pill, primaryBtn, secondaryBtn, dangerBtn, smallBtn, sectionTitle, label } from "./quizStyles";

interface Props {
  scoutSheetId: string;
}

const SOURCE_LABEL = { sheet: "From sheet", ai: "AI draft", coach: "Coach" } as const;

export default function QuizManager({ scoutSheetId }: Props) {
  const [versions, setVersions] = useState<Quiz[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<QuizBundle | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [view, setView] = useState<"results" | "questions">("results");
  const [editingId, setEditingId] = useState<string | null>(null);   // question id, or "new"
  const [aiCount, setAiCount] = useState(6);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadVersions = useCallback(async (select?: string) => {
    const list = await getQuizzesForSheet(scoutSheetId);
    setVersions(list);
    const live = list.find(q => q.status === "published");
    const pick = select ?? live?.id ?? list[0]?.id ?? null;
    setSelectedId(pick);
    return list;
  }, [scoutSheetId]);

  const loadBundle = useCallback(async (id: string | null) => {
    if (!id) { setBundle(null); return; }
    setBundle(await getQuizBundle(id));
  }, []);

  useEffect(() => {
    loadVersions().catch(e => setError(e?.message ?? "Couldn't load the quiz."));
    getRoster().then(setRoster).catch(() => {});
  }, [loadVersions]);

  useEffect(() => {
    setEditingId(null);
    loadBundle(selectedId).catch(e => setError(e?.message ?? "Couldn't load the quiz."));
  }, [selectedId, loadBundle]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null); setNotice(null);
    try { await fn(); }
    catch (e: any) { setError(e?.message ?? "Something went wrong — try again."); }
    finally { setBusy(null); }
  }

  const refresh = async () => { if (selectedId) await loadBundle(selectedId); };

  // ── Actions ──
  const generate = () => run("generate", async () => {
    const id = await createDraftForSheet(scoutSheetId);
    await loadVersions(id);
    setView("questions");
  });

  const draftWithAi = () => run("ai", async () => {
    if (!bundle) return;
    const drafts = await draftQuestionsWithAi(scoutSheetId, aiCount);
    if (!drafts.length) { setNotice("The AI didn't come back with any usable questions. Try again."); return; }
    const start = bundle.questions.reduce((m, q) => Math.max(m, q.sort_order), -1) + 1;
    await addQuestions(bundle.quiz.id, drafts, start);
    await refresh();
    setNotice(`Added ${drafts.length} AI draft${drafts.length === 1 ? "" : "s"} at the bottom. Check each one before publishing.`);
  });

  const publish = () => run("publish", async () => {
    if (!bundle || !versions) return;
    const live = versions.find(q => q.status === "published");
    const msg = live
      ? `Publish version ${bundle.quiz.version}? Version ${live.version} comes down (its results are kept). After publishing, only the wording can change.`
      : "Publish this quiz? Players on the game roster will see it. After publishing, only the wording can change.";
    if (!window.confirm(msg)) return;
    await publishQuiz(bundle.quiz.id);
    await loadVersions(bundle.quiz.id);
    setView("results");
  });

  const regenerate = () => run("regenerate", async () => {
    if (!window.confirm("Start a new version from the scout sheet as it is now? Questions you wrote or kept from the AI carry over. This version stays live until you publish the new one.")) return;
    const id = await createDraftForSheet(scoutSheetId);
    await loadVersions(id);
    setView("questions");
  });

  const removeQuiz = () => run("delete", async () => {
    if (!bundle) return;
    const isDraft = bundle.quiz.status === "draft";
    const msg = isDraft
      ? "Delete this draft?"
      : `Delete version ${bundle.quiz.version}? Every player's attempts and answers on it are deleted too. This can't be undone.`;
    if (!window.confirm(msg)) return;
    await deleteQuiz(bundle.quiz.id);
    await loadVersions();
  });

  const setSetting = (patch: Parameters<typeof updateQuizSettings>[1]) => run("settings", async () => {
    if (!bundle) return;
    await updateQuizSettings(bundle.quiz.id, patch);
    setBundle({ ...bundle, quiz: { ...bundle.quiz, ...patch } });
  });

  // ── Render ──
  if (versions === null) return <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>{error ?? "Loading…"}</div>;

  if (versions.length === 0) {
    return (
      <div>
        {error && <div className="error-msg">{error}</div>}
        <div style={{ ...card, textAlign: "center", padding: "22px 16px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Make a quiz from this scout</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
            Questions are built from the sheet's matchups, hands, strengths and defense. Matchup questions go only to
            the assigned defender. You review everything before players see it, and can add AI drafts from the
            written descriptions.
          </div>
          <button type="button" onClick={generate} disabled={busy === "generate"} style={primaryBtn}>
            {busy === "generate" ? "Building…" : "Generate quiz"}
          </button>
        </div>
      </div>
    );
  }

  const quiz = bundle?.quiz;
  const draft = versions.find(q => q.status === "draft");
  const live = versions.find(q => q.status === "published");
  const isDraft = quiz?.status === "draft";
  const isLive = quiz?.status === "published";
  const nameOf = (id: string) => roster.find(r => r.id === id)?.name ?? "Player";

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}
      {notice && <div style={{ ...card, fontSize: 13, marginBottom: 12, borderColor: "var(--royal-light)" }}>{notice}</div>}

      {/* ── Versions ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        {versions.map(v => (
          <button key={v.id} type="button" onClick={() => setSelectedId(v.id)}
            style={{ ...smallBtn, padding: "5px 10px", color: v.id === selectedId ? "#fff" : "var(--muted)",
              background: v.id === selectedId ? "var(--royal)" : "none", border: v.id === selectedId ? "1px solid var(--royal)" : "1px solid var(--border)" }}>
            v{v.version} · {v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Archived"}
          </button>
        ))}
      </div>

      {!quiz ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div> : (
        <>
          {isDraft && (
            <div style={{ ...card, fontSize: 13, marginBottom: 12, borderColor: "rgba(240,192,64,0.4)" }}>
              <span style={pill("warn")}>Draft</span>{" "}
              Players can't see this yet.{live ? ` Version ${live.version} stays live until you publish this one.` : ""}
            </div>
          )}
          {isLive && draft && (
            <div style={{ ...card, fontSize: 13, marginBottom: 12 }}>
              Version {draft.version} is being drafted.{" "}
              <button type="button" onClick={() => setSelectedId(draft.id)} style={smallBtn}>Open draft</button>
            </div>
          )}

          {/* ── Live: Results / Questions switch ── */}
          {!isDraft && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["results", "questions"] as const).map(t => (
                <button key={t} type="button" onClick={() => { setView(t); setEditingId(null); }}
                  style={{ fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: view === t ? "var(--royal)" : "var(--surface2)", color: view === t ? "#fff" : "var(--muted)" }}>
                  {t === "results" ? "Results" : "Questions"}
                </button>
              ))}
            </div>
          )}

          {!isDraft && view === "results" && bundle && <QuizResults key={bundle.quiz.id} bundle={bundle} />}

          {(isDraft || view === "questions") && bundle && (
            <>
              {/* ── Settings ── */}
              <div style={sectionTitle}>Settings</div>
              <div style={{ ...card, display: "grid", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span style={{ flex: 1 }}>Show answers</span>
                  <select value={quiz.feedback_mode} disabled={quiz.status === "archived"}
                    onChange={e => setSetting({ feedback_mode: e.target.value as "end" | "immediate" })}
                    style={{ ...inputStyle, padding: "6px 10px" }}>
                    <option value="end">At the end</option>
                    <option value="immediate">After each question</option>
                  </select>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <input type="checkbox" checked={quiz.allow_retakes} disabled={quiz.status === "archived"}
                    onChange={e => setSetting({ allow_retakes: e.target.checked })} />
                  <span style={{ flex: 1 }}>Allow retakes <span style={{ color: "var(--muted)" }}>(questions and answers reshuffle each time)</span></span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <input type="checkbox" checked={quiz.time_limit_seconds != null} disabled={quiz.status === "archived"}
                    onChange={e => setSetting({ time_limit_seconds: e.target.checked ? 20 : null })} />
                  <span style={{ flex: 1 }}>Time limit per question</span>
                  {quiz.time_limit_seconds != null && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="number" min={5} max={300} step={5} defaultValue={quiz.time_limit_seconds}
                        key={`${quiz.id}-${quiz.time_limit_seconds}`}
                        disabled={quiz.status === "archived"}
                        onBlur={e => {
                          const n = Math.round(Number(e.target.value));
                          if (!Number.isFinite(n) || n < 5 || n > 300) { setError("Time limit must be 5 to 300 seconds."); return; }
                          if (n !== quiz.time_limit_seconds) setSetting({ time_limit_seconds: n });
                        }}
                        style={{ ...inputStyle, width: 70, padding: "6px 8px" }} />
                      <span style={{ color: "var(--muted)" }}>sec</span>
                    </span>
                  )}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <input type="checkbox" checked={quiz.show_time_to_coaches} disabled={quiz.status === "archived"}
                    onChange={e => setSetting({ show_time_to_coaches: e.target.checked })} />
                  <span style={{ flex: 1 }}>Show coaches how long each player took</span>
                </label>
                {isLive && (
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    Changing the time limit or when answers show only affects players who haven't started.
                  </div>
                )}
              </div>

              {/* ── Questions ── */}
              <div style={sectionTitle}>
                {bundle.questions.length} question{bundle.questions.length === 1 ? "" : "s"}
                {isLive ? " — wording fixes only. Regenerate to change answers or who gets them." : ""}
              </div>
              {bundle.questions.length === 0 && isDraft && (
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
                  The sheet's structured fields didn't produce any questions yet. Add your own or draft some with AI.
                </div>
              )}
              {bundle.questions.map((q, i) => editingId === q.id ? (
                <div key={q.id} style={{ marginBottom: 8 }}>
                  <QuizQuestionEditor
                    mode={isDraft ? "draft" : "wording"} question={q} roster={roster}
                    onCancel={() => setEditingId(null)}
                    onSaveDraft={async d => { await saveDraftQuestion(q, d); setEditingId(null); await refresh(); }}
                    onSaveWording={async (p, l, e) => { await saveWording(q, p, l, e); setEditingId(null); await refresh(); }}
                  />
                </div>
              ) : (
                <QuestionRow key={q.id} q={q} index={i} nameOf={nameOf}
                  canEdit={quiz.status !== "archived"} canRearrange={isDraft}
                  onEdit={() => setEditingId(q.id)}
                  onUp={() => run("move", async () => { await moveQuestion(bundle.questions, i, -1); await refresh(); })}
                  onDown={() => run("move", async () => { await moveQuestion(bundle.questions, i, 1); await refresh(); })}
                  onDelete={() => run("del", async () => {
                    if (!window.confirm("Delete this question?")) return;
                    await deleteQuestion(q.id); await refresh();
                  })}
                />
              ))}

              {isDraft && editingId === "new" && (
                <div style={{ marginBottom: 8 }}>
                  <QuizQuestionEditor mode="draft" question={null} roster={roster}
                    onCancel={() => setEditingId(null)}
                    onSaveDraft={async (d: QuestionDraft) => {
                      const start = bundle.questions.reduce((m, x) => Math.max(m, x.sort_order), -1) + 1;
                      await addQuestions(bundle.quiz.id, [d], start);
                      setEditingId(null); await refresh();
                    }} />
                </div>
              )}

              {/* ── Draft actions ── */}
              {isDraft && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  <button type="button" onClick={() => setEditingId("new")} style={secondaryBtn}>+ Add question</button>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button type="button" onClick={draftWithAi} disabled={busy === "ai"} style={secondaryBtn}>
                      {busy === "ai" ? "Drafting…" : "✨ Draft with AI"}
                    </button>
                    <select value={aiCount} onChange={e => setAiCount(Number(e.target.value))} style={{ ...inputStyle, padding: "6px 8px" }}
                      aria-label="How many AI questions">
                      {[3, 6, 10].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={removeQuiz} disabled={!!busy} style={dangerBtn}>Delete draft</button>
                  <button type="button" onClick={publish} disabled={!!busy || bundle.questions.length === 0} style={primaryBtn}>
                    {busy === "publish" ? "Publishing…" : "Publish quiz"}
                  </button>
                </div>
              )}
              {isDraft && (
                <div style={{ ...label, marginTop: 8 }}>
                  AI drafts use the sheet's written descriptions, plans, notes and keys. Opposing players are sent by number only, never by name.
                </div>
              )}
            </>
          )}

          {/* ── Live / archived actions ── */}
          {!isDraft && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              {isLive && !draft && (
                <button type="button" onClick={regenerate} disabled={!!busy} style={secondaryBtn}>
                  {busy === "regenerate" ? "Building…" : "↻ Regenerate"}
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={removeQuiz} disabled={!!busy} style={dangerBtn}>Delete v{quiz.version}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuestionRow(props: {
  q: QuizQuestion; index: number; nameOf: (id: string) => string;
  canEdit: boolean; canRearrange: boolean;
  onEdit: () => void; onUp: () => void; onDown: () => void; onDelete: () => void;
}) {
  const { q, index, nameOf, canEdit, canRearrange } = props;
  const correct = q.options.find(o => o.id === q.correct_option_id);
  const sourceKind = q.source === "ai" ? "info" : q.source === "coach" ? "good" : "plain";
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12, color: "var(--muted)", width: 18, paddingTop: 2 }}>{index + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
          <span style={pill(sourceKind)}>{SOURCE_LABEL[q.source]}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {q.assignee_ids.length ? `→ ${q.assignee_ids.map(nameOf).join(", ")}` : "→ Everyone"}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{q.prompt}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {q.options.map(o => (
            <span key={o.id} style={{ marginRight: 10, color: o.id === correct?.id ? "#5de098" : undefined }}>
              {o.id === correct?.id ? "✓ " : ""}{o.label}
            </span>
          ))}
          {!correct && <span style={{ color: "#ff7b7b" }}>No correct answer marked</span>}
        </div>
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {canRearrange && <button type="button" onClick={props.onUp} style={smallBtn} aria-label="Move up">↑</button>}
          {canRearrange && <button type="button" onClick={props.onDown} style={smallBtn} aria-label="Move down">↓</button>}
          <button type="button" onClick={props.onEdit} style={smallBtn} aria-label="Edit">✎</button>
          {canRearrange && <button type="button" onClick={props.onDelete} style={smallBtn} aria-label="Delete">✕</button>}
        </div>
      )}
    </div>
  );
}
