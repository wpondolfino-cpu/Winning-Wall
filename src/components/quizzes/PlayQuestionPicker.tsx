// src/components/quizzes/PlayQuestionPicker.tsx
// "+ Play question": the coach picks exactly the play question they want.
//
//   Type → Play → Step → Player → Review
//
// Type comes first, and each later pick only asks for what that type needs
// and only offers what fits it: Name that play skips the step and player;
// Fill in the read skips the player; steps and players that don't fit the
// type are greyed out. The right answer comes from the drawing (except
// "Your own question", where the coach writes it).

import { useEffect, useMemo, useState } from "react";
import PlayCanvas, { CANVAS_W, CANVAS_H } from "../plays/PlayCanvas";
import { Play, CourtTemplate, stepButtonText } from "../../lib/plays";
import {
  Quiz, QuestionDraft, PickType, getPlaysForPicker, stepFits, eligiblePlayers, buildChosenQuestion,
} from "../../lib/quizzes";
import { inputStyle } from "../../lib/inputStyle";
import { QuizPlayVisual } from "./QuizPlayVisual";
import { card, label, primaryBtn, secondaryBtn, smallBtn, optionStyle } from "./quizStyles";

const TYPES: { k: PickType; t: string; d: string; needs: string }[] = [
  { k: "what_next", t: "What happens next", d: "Pick the action for a player on a step.", needs: "play · step · player" },
  { k: "two_part", t: "What, then where", d: "The action, then tap the spot (or who to). 2 points.", needs: "play · step · player" },
  { k: "tap_place", t: "Where do you go", d: "Tap where the player ends up.", needs: "play · step · player" },
  { k: "who_ball", t: "Who gets the ball", d: "Who the player passes to.", needs: "play · step · player" },
  { k: "fill_read", t: "Fill in the read", d: "Blank a word from the step's note.", needs: "play · step" },
  { k: "name_play", t: "Name that play", d: "The whole play runs, then the court hides.", needs: "play" },
  { k: "own", t: "Your own question", d: "You write it; the court shows with it.", needs: "play · step · player (optional)" },
];

interface Props {
  quiz: Quiz;
  onAdd: (drafts: QuestionDraft[]) => Promise<void>;
  onCancel: () => void;
}

export default function PlayQuestionPicker({ quiz, onAdd, onCancel }: Props) {
  const [type, setType] = useState<PickType | null>(null);
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [playId, setPlayId] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [skipPlayer, setSkipPlayer] = useState(false);
  const [drafts, setDrafts] = useState<QuestionDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getPlaysForPicker(quiz).then(setPlays).catch(() => setPlays([])); }, [quiz]);

  const play = plays?.find(p => p.id === playId) ?? null;
  const needsStep = type !== null && type !== "name_play";
  const needsPlayer = type !== null && !["name_play", "fill_read"].includes(type);
  const ownType = type === "own";

  // Build the question as soon as everything it needs is picked.
  useEffect(() => {
    setDrafts(null); setError(null);
    if (!type || !play) return;
    if (needsStep && step === null) return;
    if (needsPlayer && !playerId && !(ownType && skipPlayer)) return;
    try { setDrafts(buildChosenQuestion(type, play, step, playerId, plays ?? [])); }
    catch (e: any) { setError(e?.message ?? "Couldn't build that question."); }
  }, [type, play, step, playerId, skipPlayer]);   // eslint-disable-line react-hooks/exhaustive-deps

  const stage = !type ? "type" : !play ? "play" : needsStep && step === null ? "step"
    : needsPlayer && !playerId && !(ownType && skipPlayer) ? "player" : "review";

  function restart() { setType(null); setPlayId(null); setStep(null); setPlayerId(null); setSkipPlayer(false); setDrafts(null); setError(null); }
  const back = () => {
    if (stage === "review") { if (needsPlayer) { setPlayerId(null); setSkipPlayer(false); } else if (needsStep) setStep(null); else setPlayId(null); }
    else if (stage === "player") setStep(null);
    else if (stage === "step") setPlayId(null);
    else if (stage === "play") setType(null);
  };

  const eligible = useMemo(() => (type && play && step !== null ? eligiblePlayers(type, play, step) : []), [type, play, step]);

  async function save() {
    if (!drafts) return;
    const d = drafts;
    if (ownType) {
      const q = d[0];
      const opts = q.options.map(o => o.trim());
      if (!q.prompt.trim()) { setError("Write the question."); return; }
      if (opts.filter(Boolean).length < 2) { setError("Give it at least two answers."); return; }
      if (!opts[q.correctIndex]) { setError("Mark which answer is correct."); return; }
    }
    setSaving(true); setError(null);
    try { await onAdd(d.map(x => ({ ...x, prompt: x.prompt.trim() }))); }
    catch (e: any) { setError(e?.message ?? "Couldn't add the question."); setSaving(false); }
  }

  const crumbs = [
    type ? TYPES.find(t => t.k === type)!.t : "Type",
    ...(type ? [play?.title ?? "Play"] : []),
    ...(needsStep ? [step !== null && play ? stepButtonText(play.data.frames[step], step) : "Step"] : []),
    ...(needsPlayer ? [playerId && play && step !== null ? `the ${play.data.frames[step].players.find(p => p.id === playerId)?.num}` : skipPlayer ? "no player" : "Player"] : []),
    "Review",
  ];

  const editDraft = (i: number, patch: Partial<QuestionDraft>) =>
    setDrafts(ds => (ds ? ds.map((x, j) => (j === i ? { ...x, ...patch } : x)) : ds));

  return (
    <div style={{ ...card, border: "1px solid var(--royal-light)", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {crumbs.map((c, i) => (
          <span key={i} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 12, background: "var(--surface)", color: "var(--muted)" }}>{c}</span>
        ))}
      </div>
      {error && <div className="error-msg">{error}</div>}

      {stage === "type" && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>What kind of play question?</div>
          {TYPES.map(t => (
            <button key={t.k} type="button" onClick={() => setType(t.k)}
              style={{ ...optionStyle("idle"), display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontWeight: 600 }}>{t.t}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t.d}</span>
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{t.needs}</span>
            </button>
          ))}
        </>
      )}

      {stage === "play" && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Which play?</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>This quiz's plays first, then the others you can open.</div>
          {plays === null ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading plays…</div>
            : plays.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)" }}>No plays you can open yet.</div>
            : (
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {plays.map(p => (
                  <button key={p.id} type="button" onClick={() => setPlayId(p.id)} style={optionStyle("idle")}>
                    {p.title} <span style={{ fontSize: 11, color: "var(--muted)" }}>· {p.data.frames.length} step{p.data.frames.length === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            )}
        </>
      )}

      {stage === "step" && play && type && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Which step?</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Steps with nothing for this type are greyed out.</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {play.data.frames.map((f, i) => {
              const ok = stepFits(type, play, i);
              return (
                <button key={i} type="button" disabled={!ok} onClick={() => setStep(i)}
                  title={ok ? "" : "Nothing on this step fits this type"}
                  style={{ width: 170, padding: 6, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)",
                    cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.35, textAlign: "left", fontFamily: "inherit", color: "var(--text)" }}>
                  <PlayCanvas frame={f} courtTemplate={play.court_template as CourtTemplate} edit={false} />
                  <div style={{ fontSize: 12, marginTop: 4 }}>{stepButtonText(f, i)}</div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {stage === "player" && play && step !== null && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Tap the player</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {ownType ? "Optional — tap one to draw them in gold, or skip." : "Only players who fit are outlined; the rest are dimmed."}
          </div>
          <div style={{ position: "relative", maxWidth: 520 }}>
            <PlayCanvas frame={play.data.frames[step]} courtTemplate={play.court_template as CourtTemplate} edit={false} />
            <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              {play.data.frames[step].players.map(p => {
                const ok = !!p.id && eligible.includes(p.id);
                return ok ? (
                  <circle key={p.id ?? p.num} cx={p.x} cy={p.y} r={19} fill="rgba(240,192,64,0.15)" stroke="#F0C040" strokeWidth={3}
                    style={{ cursor: "pointer" }} onClick={() => setPlayerId(p.id ?? null)}>
                    <title>The {p.num}</title>
                  </circle>
                ) : (
                  <circle key={p.id ?? p.num} cx={p.x} cy={p.y} r={15} fill="rgba(17,24,38,0.6)" />
                );
              })}
            </svg>
          </div>
          {ownType && (
            <button type="button" onClick={() => setSkipPlayer(true)} style={{ ...smallBtn, marginTop: 8 }}>No player</button>
          )}
        </>
      )}

      {stage === "review" && drafts && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Review</div>
          {drafts.map((d, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              {drafts.length > 1 && <div style={{ ...label, color: "var(--gold)" }}>Part {i + 1} of {drafts.length}</div>}
              {i === 0 && d.visual && (
                <div style={{ maxWidth: 420 }}><QuizPlayVisual visual={d.visual} compact /></div>
              )}
              <div style={label}>Question</div>
              <input value={d.prompt} onChange={e => editDraft(i, { prompt: e.target.value })}
                placeholder={ownType ? "e.g. If his man goes under, what should the 2 do?" : ""}
                style={{ ...inputStyle, width: "100%", marginBottom: 8 }} />
              {ownType ? (
                <>
                  <div style={label}>Answers — tap the circle on the right one</div>
                  {d.options.map((o, j) => (
                    <div key={j} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <input type="radio" name="own-correct" checked={d.correctIndex === j} onChange={() => editDraft(i, { correctIndex: j })}
                        aria-label={`Answer ${j + 1} is correct`} style={{ width: 18, height: 18, accentColor: "#28b450" }} />
                      <input value={o} onChange={e => editDraft(i, { options: d.options.map((x, k) => (k === j ? e.target.value : x)) })}
                        placeholder={`Answer ${j + 1}`} style={{ ...inputStyle, flex: 1 }} />
                    </div>
                  ))}
                  {d.options.length < 5 && (
                    <button type="button" onClick={() => editDraft(i, { options: [...d.options, ""] })} style={{ ...smallBtn, marginBottom: 8 }}>+ Answer</button>
                  )}
                </>
              ) : d.qtype === "tap_place" ? (
                <div style={{ fontSize: 12, color: "#5de098", marginBottom: 8 }}>✓ The right spot comes from the drawing.</div>
              ) : (
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  {d.options.map((o, j) => (
                    <span key={j} style={{ marginRight: 12, color: j === d.correctIndex ? "#5de098" : "var(--muted)" }}>
                      {j === d.correctIndex ? "✓ " : ""}{o}
                    </span>
                  ))}
                </div>
              )}
              <div style={label}>Explanation (shown with the answer)</div>
              <input value={d.explanation ?? ""} onChange={e => editDraft(i, { explanation: e.target.value })}
                style={{ ...inputStyle, width: "100%" }} />
            </div>
          ))}
          {drafts.some(d => d.assigneeIds.length) && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              This player is linked to a real player, so it goes only to them ("You're the …").
            </div>
          )}
          {!ownType && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Wording and explanation can change; the right answer comes from the play.</div>}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {stage === "review" && drafts && (
          <button type="button" onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Adding…" : "Add to quiz"}</button>
        )}
        {stage !== "type" && <button type="button" onClick={back} style={secondaryBtn}>Back</button>}
        {stage !== "type" && <button type="button" onClick={restart} style={secondaryBtn}>Start over</button>}
        <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
      </div>
    </div>
  );
}
