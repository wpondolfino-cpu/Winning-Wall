// src/components/plays/PlaylistPlayer.tsx
// "Play all": watch every play in a playbook, in order, in 2D or 3D.
//
// Each play runs start to finish. When it ends:
//   - Auto-advance off (the default): it stops and asks -- Replay, or Next.
//   - Auto-advance on: Replay shows for 4 seconds; if it isn't tapped, the
//     next play starts.
// A short title card ("Play 2 of 5 · Horns DHO") opens each play.
//
// The 2D view drives PlayCanvas one step at a time (the same way a single
// play's "Watch play" does); the 3D view uses Play3DViewer's playlist hooks
// (autoPlayToken / onPlayEnd). Speed starts at 1x every time; the 2D/3D
// choice and auto-advance are remembered on this device.

import { useEffect, useMemo, useRef, useState, lazy, Suspense, Component, type ComponentType, type ReactNode } from "react";
import PlayCanvas from "./PlayCanvas";
import StepNote from "./StepNote";
import { useIsMobile } from "../../hooks/useIsMobile";
import { Play, RosterPlayer, playCrop } from "../../lib/plays";

const Play3DViewer = lazy(() => import("./Play3DViewer")) as unknown as ComponentType<{
  play: Play;
  roster: Record<string, RosterPlayer>;
  onBack: () => void;
  autoPlayToken?: number;
  onPlayEnd?: () => void;
  hideBack?: boolean;
  initialSpeed?: number;
  onSpeedChange?: (speed: number) => void;
}>;

interface Props {
  title: string;
  plays: Play[];
  roster: Record<string, RosterPlayer>;
  startIndex?: number;
  onClose: () => void;
}

type Phase = "title" | "playing" | "ended";

const AUTO_KEY = "ww_playlist_auto";
const MODE_KEY = "ww_playlist_mode";
const TITLE_MS = 1300;
const AUTO_WAIT_S = 4;

function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered, that's all */ }
}

/** If the 3D view fails, fall back to 2D rather than blanking the page. */
class ThreeDFallback extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("Playlist 3D view failed:", error); this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

const btn: React.CSSProperties = { padding: "8px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer", fontFamily: "inherit" };
const primary: React.CSSProperties = { ...btn, background: "var(--royal)", borderColor: "var(--royal)", color: "#fff", fontWeight: 600 };

export default function PlaylistPlayer({ title, plays, roster, startIndex = 0, onClose }: Props) {
  const isMobile = useIsMobile();
  const [idx, setIdx] = useState(Math.min(Math.max(0, startIndex), Math.max(0, plays.length - 1)));
  const [mode, setMode] = useState<"2d" | "3d">(() => (readPref(MODE_KEY) === "3d" ? "3d" : "2d"));
  const [auto, setAuto] = useState<boolean>(() => readPref(AUTO_KEY) === "1");
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState<Phase>("title");
  const [countdown, setCountdown] = useState(AUTO_WAIT_S);
  // Bumped every time a play (re)starts; anything left over from an
  // earlier run checks it and stands down.
  const [run, setRun] = useState(1);
  const runRef = useRef(1);
  runRef.current = run;

  // 2D playback state
  const [frameIdx, setFrameIdx] = useState(0);
  const [playSignal, setPlaySignal] = useState(0);
  // 3D playback trigger
  const [token3D, setToken3D] = useState(0);

  const play = plays[idx];
  const frames = play?.data?.frames ?? [];
  const isLast = idx >= plays.length - 1;
  const crop = useMemo(() => (isMobile && frames.length ? playCrop(frames) : null), [isMobile, frames]);

  useEffect(() => writePref(MODE_KEY, mode), [mode]);
  useEffect(() => writePref(AUTO_KEY, auto ? "1" : "0"), [auto]);

  // Title card, then start the play.
  useEffect(() => {
    if (phase !== "title") return;
    const myRun = run;
    setFrameIdx(0);
    const t = setTimeout(() => {
      if (runRef.current !== myRun) return;
      setPhase("playing");
      if (mode === "3d") setToken3D((n) => n + 1);
      else startStep(0, myRun);
    }, TITLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run]);

  function startStep(i: number, myRun: number) {
    if (!frames.length) { finish(myRun); return; }
    setFrameIdx(i);
    const f = frames[i];
    // A step where nothing moves would never report back; hold it briefly.
    if (!f || f.actions.length === 0) {
      setTimeout(() => {
        if (runRef.current !== myRun) return;
        if (i < frames.length - 1) startStep(i + 1, myRun); else finish(myRun);
      }, 1200 / speed);
      return;
    }
    setTimeout(() => { if (runRef.current === myRun) setPlaySignal((s) => s + 1); }, 150 / speed);
  }

  // PlayCanvas calls this with the handler from the render that started
  // the step, so `run` and `frameIdx` here are that run's values.
  function on2DStepDone() {
    if (runRef.current !== run || phase !== "playing") return;
    if (frameIdx < frames.length - 1) startStep(frameIdx + 1, run);
    else finish(run);
  }

  function finish(myRun: number) {
    if (runRef.current !== myRun) return;
    setCountdown(AUTO_WAIT_S);
    setPhase("ended");
  }

  // Auto-advance: Replay waits 4 seconds, then on to the next play.
  useEffect(() => {
    if (phase !== "ended" || !auto || isLast) return;
    if (countdown <= 0) { goTo(idx + 1); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, auto, countdown, isLast]);

  function restart() {
    setRun((r) => r + 1);
    setPhase("title");
  }
  function goTo(i: number) {
    if (i < 0 || i >= plays.length) return;
    setIdx(i);
    restart();
  }
  function switchMode(m: "2d" | "3d") {
    if (m === mode) return;
    setMode(m);
    restart();
  }

  if (!play) {
    return (
      <div>
        <button onClick={onClose} style={btn}>← Back</button>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>No plays to watch in this playbook yet.</p>
      </div>
    );
  }

  const overlay: React.CSSProperties = {
    position: "absolute", inset: 0, zIndex: 5, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 10, background: "rgba(8,12,24,0.72)", borderRadius: 12, padding: 16, textAlign: "center",
  };

  return (
    <div>
      {/* Header: back, where we are, 2D/3D */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={onClose} style={btn}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title} · {idx + 1} of {plays.length}</div>
          <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{play.title}</div>
        </div>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {(["2d", "3d"] as const).map((m) => (
            <button key={m} onClick={() => switchMode(m)}
              style={{ padding: "6px 12px", fontSize: 12, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                background: mode === m ? "var(--royal)" : "transparent", color: mode === m ? "#fff" : "var(--muted)" }}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Progress through the playlist */}
      <div style={{ display: "flex", gap: 3, marginBottom: 10 }}>
        {plays.map((p, i) => (
          <button key={p.id} onClick={() => goTo(i)} title={p.title} aria-label={`Play ${i + 1}: ${p.title}`}
            style={{ flex: 1, height: 6, padding: 0, border: "none", borderRadius: 3, cursor: "pointer",
              background: i < idx ? "var(--royal-light, #4b78e6)" : i === idx ? "var(--gold)" : "var(--border)" }} />
        ))}
      </div>

      {/* Court, with the title card / end-of-play prompt laid over it */}
      <div style={{ position: "relative" }}>
        {mode === "2d" ? (
          <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 12,
            maxWidth: "min(100%, max(420px, calc((100vh - 300px) * 600 / 420 + 24px)))", marginLeft: "auto", marginRight: "auto" }}>
            {frames[frameIdx] && (
              <PlayCanvas
                key={`${play.id}-${run}`}
                frame={frames[frameIdx]}
                courtTemplate={play.court_template}
                roster={roster}
                edit={false}
                playSignal={playSignal}
                onPlayDone={on2DStepDone}
                speed={speed}
                viewBox={crop}
              />
            )}
          </div>
        ) : (
          <ThreeDFallback key={`3d-${play.id}`} onFail={() => setMode("2d")}>
            <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading 3D view…</div>}>
              <Play3DViewer
                key={play.id}
                play={play}
                roster={roster}
                onBack={() => switchMode("2d")}
                hideBack
                autoPlayToken={token3D}
                onPlayEnd={() => finish(runRef.current)}
                initialSpeed={speed}
                onSpeedChange={setSpeed}
              />
            </Suspense>
          </ThreeDFallback>
        )}

        {phase === "title" && (
          <div style={overlay}>
            <div style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700, letterSpacing: 0.5 }}>PLAY {idx + 1} OF {plays.length}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{play.title}</div>
          </div>
        )}

        {phase === "ended" && (
          <div style={overlay}>
            {isLast ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>That's the whole playbook</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <button onClick={restart} style={btn}>↻ Replay this play</button>
                  <button onClick={() => goTo(0)} style={btn}>⏮ Start over</button>
                  <button onClick={onClose} style={primary}>Done</button>
                </div>
              </>
            ) : auto ? (
              <>
                <div style={{ fontSize: 13, color: "#ddd" }}>Next: <b style={{ color: "#fff" }}>{plays[idx + 1].title}</b> in {countdown}…</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={restart} style={btn}>↻ Replay</button>
                  <button onClick={() => goTo(idx + 1)} style={primary}>Next now ›</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "#ddd" }}>Up next: <b style={{ color: "#fff" }}>{plays[idx + 1].title}</b></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={restart} style={btn}>↻ Replay</button>
                  <button onClick={() => goTo(idx + 1)} style={primary}>Next play ›</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <button onClick={() => goTo(idx - 1)} disabled={idx === 0} style={{ ...btn, opacity: idx === 0 ? 0.4 : 1 }} aria-label="Previous play">⏮ Prev</button>
        <button onClick={restart} style={btn} aria-label="Replay this play">↻ Replay</button>
        <button onClick={() => goTo(idx + 1)} disabled={isLast} style={{ ...btn, opacity: isLast ? 0.4 : 1 }} aria-label="Next play">Next ⏭</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 12, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
        {mode === "2d" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
              style={{ padding: "5px 8px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "inherit" }}>
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
          </label>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-advance
        </label>
      </div>

      {mode === "2d" && frames[frameIdx] && (
        <StepNote frame={frames[frameIdx]} index={frameIdx} totalSteps={frames.length} />
      )}
    </div>
  );
}
