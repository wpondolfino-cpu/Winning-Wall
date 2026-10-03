// src/components/quizzes/QuizQuestionEditor.tsx
// Edits one quiz question.
//
//   mode "draft"   -- everything: question, answers, which is right,
//                     explanation, and who it goes to.
//   mode "wording" -- a PUBLISHED quiz: only the text can change. The
//                     correct answer and the assignments are frozen (the
//                     database enforces it too); Regenerate changes them.

import { useState } from "react";
import { QuizQuestion, QuestionDraft, QuestionSource } from "../../lib/quizzes";
import { RosterPlayer } from "../../lib/plays";
import { inputStyle } from "../../lib/inputStyle";
import { primaryBtn, secondaryBtn, smallBtn, label, card } from "./quizStyles";

interface Props {
  mode: "draft" | "wording";
  question: QuizQuestion | null;          // null = new question
  roster: RosterPlayer[];
  onSaveDraft?: (d: QuestionDraft) => Promise<void>;
  onSaveWording?: (prompt: string, labels: Record<string, string>, explanation: string | null) => Promise<void>;
  onCancel: () => void;
}

export default function QuizQuestionEditor({ mode, question, roster, onSaveDraft, onSaveWording, onCancel }: Props) {
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [options, setOptions] = useState<string[]>(
    question ? question.options.map(o => o.label) : ["", "", ""]);
  const [correctIndex, setCorrectIndex] = useState<number>(
    question ? Math.max(0, question.options.findIndex(o => o.id === question.correct_option_id)) : 0);
  const [labels, setLabels] = useState<Record<string, string>>(
    Object.fromEntries((question?.options ?? []).map(o => [o.id, o.label])));
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [assignees, setAssignees] = useState<string[]>(question?.assignee_ids ?? []);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!prompt.trim()) { setError("Write the question first."); return; }
    setSaving(true);
    try {
      if (mode === "draft") {
        const filled = options.map(o => o.trim());
        if (filled.filter(Boolean).length < 2) { setError("Give it at least two answers."); setSaving(false); return; }
        if (!filled[correctIndex]) { setError("Mark which answer is correct."); setSaving(false); return; }
        const source: QuestionSource = question?.source ?? "coach";
        await onSaveDraft?.({
          prompt, options: filled, correctIndex, explanation: explanation || null,
          source, family: question?.family ?? null, assigneeIds: assignees,
        });
      } else {
        if (Object.values(labels).some(l => !l.trim())) { setError("Answers can't be blank."); setSaving(false); return; }
        await onSaveWording?.(prompt, labels, explanation || null);
      }
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save — try again.");
      setSaving(false);
    }
  }

  function removeOption(i: number) {
    setOptions(opts => opts.filter((_, j) => j !== i));
    setCorrectIndex(c => (c === i ? 0 : c > i ? c - 1 : c));
  }

  const nameOf = (id: string) => roster.find(r => r.id === id)?.name ?? "Player";
  const matches = roster.filter(r =>
    !assignees.includes(r.id) && (!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase())));

  return (
    <div style={{ ...card, border: "1px solid var(--royal-light)" }}>
      {error && <div className="error-msg">{error}</div>}

      <div style={label}>Question</div>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
        style={{ ...inputStyle, width: "100%", resize: "vertical", marginBottom: 10 }} />

      {(mode === "draft" || (question?.options.length ?? 0) > 0) && (
        <div style={label}>{mode === "draft" ? "Answers — tap the circle on the correct one" : "Answers (the correct one is locked)"}</div>
      )}
      {mode === "wording" && question?.qtype === "tap_place" && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Players tap the court. The right spot comes from the play as drawn — Rebuild from plays picks up changes.
        </div>
      )}
      {mode === "draft" ? (
        <>
          {options.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="radio" name={`correct-${question?.id ?? "new"}`} checked={correctIndex === i} onChange={() => setCorrectIndex(i)}
                aria-label={`Answer ${i + 1} is correct`} style={{ width: 18, height: 18, accentColor: "#28b450" }} />
              <input value={o} onChange={e => setOptions(opts => opts.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Answer ${i + 1}`} style={{ ...inputStyle, flex: 1 }} />
              {options.length > 2 && (
                <button type="button" onClick={() => removeOption(i)} style={smallBtn} aria-label="Remove answer">✕</button>
              )}
            </div>
          ))}
          {options.length < 5 && (
            <button type="button" onClick={() => setOptions(o => [...o, ""])} style={{ ...smallBtn, marginBottom: 10 }}>+ Answer</button>
          )}
        </>
      ) : (
        (question?.options ?? []).map(o => (
          <div key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ width: 18, textAlign: "center", color: o.id === question?.correct_option_id ? "#5de098" : "var(--muted)" }}>
              {o.id === question?.correct_option_id ? "✓" : "•"}
            </span>
            <input value={labels[o.id] ?? ""} onChange={e => setLabels(l => ({ ...l, [o.id]: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }} />
          </div>
        ))
      )}

      <div style={{ ...label, marginTop: 8 }}>Explanation (shown with the answer)</div>
      <input value={explanation} onChange={e => setExplanation(e.target.value)}
        placeholder="Why that's the answer" style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />

      {mode === "draft" && (
        <>
          <div style={label}>Goes to</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            {assignees.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--text)", padding: "4px 10px", borderRadius: 14, background: "var(--surface)" }}>
                Everyone on the game roster
              </span>
            )}
            {assignees.map(id => (
              <button key={id} type="button" onClick={() => setAssignees(a => a.filter(x => x !== id))}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 14, border: "1px solid var(--royal-light)",
                  background: "rgba(37,80,212,0.18)", color: "var(--text)", cursor: "pointer", fontFamily: "inherit" }}>
                {nameOf(id)} ✕
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Assign to specific players…"
            style={{ ...inputStyle, width: "100%", marginBottom: 6 }} />
          {search.trim() && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {matches.slice(0, 12).map(r => (
                <button key={r.id} type="button" onClick={() => { setAssignees(a => [...a, r.id]); setSearch(""); }}
                  style={{ ...smallBtn, color: "var(--text)" }}>
                  {r.jersey != null ? `#${r.jersey} ` : ""}{r.name}
                </button>
              ))}
              {matches.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>No match</span>}
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
      </div>
    </div>
  );
}
