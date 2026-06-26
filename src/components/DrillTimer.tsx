// src/components/DrillTimer.tsx
// Standalone drill timer with alarm — works anywhere in the app
import { useState, useEffect, useRef } from "react";

interface Props {
  defaultSeconds?: number;
  compact?: boolean; // compact mode for embedding in workout cards
  onComplete?: () => void;
}

function playAlarm() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Play 3 beeps
    [0, 0.3, 0.6].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.8, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.25);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.25);
    });
    // Vibrate if supported
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  } catch (e) { console.warn("Audio not available:", e); }
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DrillTimer({ defaultSeconds = 30, compact = false, onComplete }: Props) {
  const [duration, setDuration]   = useState(defaultSeconds);
  const [remaining, setRemaining] = useState(defaultSeconds);
  const [running, setRunning]     = useState(false);
  const [done, setDone]           = useState(false);
  const [editing, setEditing]     = useState(false);
  const [inputMin, setInputMin]   = useState(Math.floor(defaultSeconds / 60).toString());
  const [inputSec, setInputSec]   = useState((defaultSeconds % 60).toString());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          setRunning(false);
          setDone(true);
          playAlarm();
          onComplete?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current!);
  }, [running]);

  function handleStart() { setDone(false); setRunning(true); }
  function handlePause() { setRunning(false); }
  function handleReset() { setRunning(false); setDone(false); setRemaining(duration); }

  function handleSetTime() {
    const mins = parseInt(inputMin) || 0;
    const secs = parseInt(inputSec) || 0;
    const total = mins * 60 + secs;
    if (total > 0) {
      setDuration(total);
      setRemaining(total);
      setDone(false);
      setRunning(false);
    }
    setEditing(false);
  }

  const pct = duration > 0 ? (remaining / duration) * 100 : 0;
  const color = done ? "#5de098" : remaining <= 5 ? "#ff7b7b" : remaining <= 10 ? "var(--gold)" : "#93b4ff";

  if (compact) {
    return (
      <div style={{ background: "var(--surface2)", border: `1px solid ${done ? "rgba(93,224,152,0.4)" : "var(--border)"}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        {/* Progress ring — small */}
        <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
          <svg width="44" height="44" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle cx="22" cy="22" r="18" fill="none" stroke={color} strokeWidth="3"
              strokeDasharray={`${2 * Math.PI * 18}`}
              strokeDashoffset={`${2 * Math.PI * 18 * (1 - pct / 100)}`}
              style={{ transition: "stroke-dashoffset 0.5s, stroke 0.3s" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color, lineHeight: 1 }}>
            {done ? "✓" : formatTime(remaining)}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            {done ? "⏱ Time's up!" : running ? "⏱ Running…" : `⏱ ${formatTime(duration)}`}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {!running && !done && <button onClick={handleStart} style={{ background: color, color: "#000", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>▶ Start</button>}
            {running && <button onClick={handlePause} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>⏸ Pause</button>}
            {(done || remaining < duration) && <button onClick={handleReset} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>↺ Reset</button>}
          </div>
        </div>
      </div>
    );
  }

  // Full size timer
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px" }}>
      {/* Big ring */}
      <div style={{ position: "relative", width: 200, height: 200, marginBottom: 24 }}>
        <svg width="200" height="200" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="100" cy="100" r="88" fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle cx="100" cy="100" r="88" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${2 * Math.PI * 88}`}
            strokeDashoffset={`${2 * Math.PI * 88 * (1 - pct / 100)}`}
            style={{ transition: "stroke-dashoffset 0.5s, stroke 0.3s" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {done ? (
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: "#5de098", lineHeight: 1 }}>Done!</div>
          ) : (
            <>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, color, lineHeight: 1 }}>{formatTime(remaining)}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>of {formatTime(duration)}</div>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {!running && !done && (
          <button onClick={handleStart}
            style={{ background: color, color: "#000", border: "none", borderRadius: 10, padding: "12px 28px", fontSize: 16, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
            ▶ Start
          </button>
        )}
        {running && (
          <button onClick={handlePause}
            style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 10, padding: "12px 28px", fontSize: 16, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
            ⏸ Pause
          </button>
        )}
        {(done || remaining < duration) && (
          <button onClick={handleReset}
            style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 10, padding: "12px 28px", fontSize: 16, fontFamily: "inherit", cursor: "pointer" }}>
            ↺ Reset
          </button>
        )}
      </div>

      {/* Set time */}
      {!running && (
        editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" value={inputMin} onChange={e => setInputMin(e.target.value)} min="0" max="59" placeholder="min"
              style={{ width: 56, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px", color: "var(--text)", fontSize: 16, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
            <span style={{ color: "var(--muted)", fontSize: 18 }}>:</span>
            <input type="number" value={inputSec} onChange={e => setInputSec(e.target.value)} min="0" max="59" placeholder="sec"
              style={{ width: 56, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px", color: "var(--text)", fontSize: 16, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
            <button onClick={handleSetTime}
              style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Set</button>
            <button onClick={() => setEditing(false)}
              style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {[15, 30, 45, 60, 90, 120].map(s => (
              <button key={s} onClick={() => { setDuration(s); setRemaining(s); setDone(false); }}
                style={{ background: duration === s ? "rgba(147,180,255,0.2)" : "var(--surface2)", border: `1px solid ${duration === s ? "#93b4ff" : "var(--border)"}`, color: duration === s ? "#93b4ff" : "var(--muted)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                {s < 60 ? `${s}s` : `${s/60}m`}
              </button>
            ))}
            <button onClick={() => { setEditing(true); setInputMin(Math.floor(duration/60).toString()); setInputSec((duration%60).toString()); }}
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
              Custom
            </button>
          </div>
        )
      )}

      {done && (
        <div style={{ marginTop: 12, fontSize: 14, color: "#5de098", fontWeight: 600, textAlign: "center" }}>
          🔔 Time's up! Great work!
        </div>
      )}
    </div>
  );
}
