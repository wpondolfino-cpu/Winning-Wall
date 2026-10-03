// src/components/quizzes/QuizPrintView.tsx
// "Print quiz + answer key" — a clean page of questions, then the answer
// key on its own page, so the questions can be handed out alone. Uses the
// browser's print dialog (Save as PDF), like the play and scout sheet
// print views, and the same global print CSS (.no-print, .print-page).
//
// Play questions print their court at the moment asked about. The
// lead-up can't animate on paper, so the heading names the play and step;
// a "name that play" question prints its opening step with arrows.

import { useMemo } from "react";
import PlayCanvas, { CANVAS_W, CANVAS_H } from "../plays/PlayCanvas";
import type { CourtTemplate } from "../../lib/plays";
import { QuizBundle, QuizQuestion, PLAY_QTYPE_LABEL } from "../../lib/quizzes";

interface Props {
  bundle: QuizBundle;
  teamNames: string;
  onBack: () => void;
}

// PlayCanvas draws with the dark theme's near-white lines; flip the tokens
// so diagrams are legible on white paper (same as PlayPrintView).
const paper: React.CSSProperties = {
  background: "#fff", color: "#111", padding: 24, borderRadius: 12, marginBottom: 24,
  ["--text" as any]: "#111", ["--muted" as any]: "#555", ["--silver" as any]: "#555",
  ["--border" as any]: "rgba(0,0,0,0.15)", ["--surface" as any]: "#fff", ["--surface2" as any]: "#fff",
};

const LETTERS = "ABCDEFGH";

function heading(q: QuizQuestion): string | null {
  const h = q.visual?.heading;
  if (!h) return null;
  return `${h.play} — Step ${h.stepNumber}${h.stepName ? ` · ${h.stepName}` : ""}${h.ballHolder != null ? ` (the ${h.ballHolder} has the ball)` : ""}`;
}

function courtFor(q: QuizQuestion) {
  const v = q.visual;
  if (!v) return null;
  // Name that play: its opening step (with arrows). Everything else: the
  // paused moment the question asks about. Both are frames[0].
  const frame = v.frames[0];
  if (!frame) return null;
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, maxWidth: 360, margin: "8px 0" }}>
      <PlayCanvas frame={frame} courtTemplate={v.court_template as CourtTemplate} edit={false} courtBg="#f3e4c8" />
    </div>
  );
}

export default function QuizPrintView({ bundle, teamNames, onBack }: Props) {
  const { quiz, questions } = bundle;
  // Built questions store the right answer first, so print in a shuffled
  // order -- fixed for this view so the key matches the questions.
  const order = useMemo(() => Object.fromEntries(questions.map(q => {
    const ids = q.options.map(o => o.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return [q.id, ids.map(id => q.options.find(o => o.id === id)!)];
  })), [questions]);
  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ padding: "8px 14px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer" }}>← Back</button>
        <button onClick={() => window.print()} style={{ padding: "8px 14px", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          🖨️ Print / Save as PDF
        </button>
        <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
          The answer key prints on its own page — print just page 1 for a hand-out.
        </span>
      </div>

      {/* ── Questions ── */}
      <div className="print-page" style={paper}>
        <h2 style={{ fontSize: 20, margin: "0 0 4px", color: "#111" }}>{quiz.title}</h2>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{teamNames}</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 18 }}>Name: ______________________</div>
        {questions.map((q, i) => (
          <div key={q.id} style={{ marginBottom: 18, breakInside: "avoid" }}>
            {heading(q) && <div style={{ fontSize: 12, fontWeight: 700, color: "#7a5a00" }}>{heading(q)}</div>}
            {courtFor(q)}
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              {i + 1}. {q.qtype === "name_play" ? "Which play starts like this?"
                : q.qtype === "tap_place" ? q.prompt.replace(/tap where/i, "Draw an X where") : q.prompt}
            </div>
            {order[q.id].map((o, j) => (
              <div key={o.id} style={{ fontSize: 13, padding: "2px 0 2px 16px" }}>
                ☐ {LETTERS[j]}. {o.label}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Answer key ── */}
      <div className="print-page" style={paper}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px", color: "#111" }}>{quiz.title} — Answer key</h2>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>Coach copy</div>
        {questions.map((q, i) => {
          const opts = order[q.id];
          const j = opts.findIndex(o => o.id === q.correct_option_id);
          if (q.qtype === "tap_place" && q.reveal) {
            return (
              <div key={q.id} style={{ fontSize: 13, marginBottom: 12, breakInside: "avoid" }}>
                <strong>{i + 1}. Where the play sends them (green):</strong>
                <div style={{ border: "1px solid #ddd", borderRadius: 8, maxWidth: 260, margin: "6px 0", position: "relative" }}>
                  <PlayCanvas frame={q.reveal.frame} courtTemplate={q.reveal.court_template as CourtTemplate} edit={false} courtBg="#f3e4c8" />
                  {q.correct_point && (
                    <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                      <circle cx={q.correct_point.x} cy={q.correct_point.y} r={22} fill="none" stroke="#1f9d4c" strokeWidth={4} />
                    </svg>
                  )}
                </div>
                {q.explanation && <div style={{ color: "#444", marginTop: 2 }}>{q.explanation}</div>}
              </div>
            );
          }
          return (
            <div key={q.id} style={{ fontSize: 13, marginBottom: 10, breakInside: "avoid" }}>
              <strong>{i + 1}. {j >= 0 ? `${LETTERS[j]}. ${opts[j].label}` : "—"}</strong>
              {q.qtype && <span style={{ color: "#888" }}> · {PLAY_QTYPE_LABEL[q.qtype]}</span>}
              {q.explanation && <div style={{ color: "#444", marginTop: 2 }}>{q.explanation}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
