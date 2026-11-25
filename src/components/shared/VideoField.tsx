// src/components/shared/VideoField.tsx
// A video link box with "Start at" / "Stop at" under it, so a coach can cue
// a 10-minute video to the drill at 2:50 without knowing YouTube's share
// options. The times are saved inside the link (see lib/youtube.ts), so
// the value in and out is just the link, the same as a plain text box.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatClock, getYouTubeId, parseClock, stripVideoTimes, videoTimes, withVideoTimes } from "../../lib/youtube";
import VideoUrlNote from "./VideoUrlNote";

interface Props {
  value: string | null | undefined;
  onChange: (url: string) => void;
  /** Style for the link box (each form has its own). */
  style?: CSSProperties;
  placeholder?: string;
  autoFocus?: boolean;
}

const timeBox: CSSProperties = {
  width: 76, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 9px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

export default function VideoField({ value, onChange, style, placeholder = "YouTube link", autoFocus }: Props) {
  const v = value ?? "";
  const emitted = useRef(v);
  const [link, setLink] = useState(() => stripVideoTimes(v));
  const [startText, setStartText] = useState(() => { const t = videoTimes(v).start; return t ? formatClock(t) : ""; });
  const [endText, setEndText] = useState(() => { const t = videoTimes(v).end; return t ? formatClock(t) : ""; });

  // A different item was opened (the value changed from outside): show its link and times.
  useEffect(() => {
    if (v === emitted.current) return;
    emitted.current = v;
    const t = videoTimes(v);
    setLink(stripVideoTimes(v));
    setStartText(t.start ? formatClock(t.start) : "");
    setEndText(t.end ? formatClock(t.end) : "");
  }, [v]);

  const start = parseClock(startText);
  const end = parseClock(endText);
  const startBad = Number.isNaN(start);
  const endBad = Number.isNaN(end);
  const order = !startBad && !endBad && start != null && end != null && end <= start;
  const problem = startBad || endBad ? "Type times as minutes:seconds, like 2:50."
    : order ? "Stop at has to be after Start at." : null;

  function emit(nextLink: string, s: number | null, e: number | null) {
    const out = nextLink.trim() ? withVideoTimes(nextLink, s, e) : "";
    emitted.current = out;
    onChange(out);
  }

  function changeLink(text: string) {
    // A pasted link that already has a start time fills in the box.
    const t = videoTimes(text);
    let s = Number.isNaN(start) ? null : start, e = Number.isNaN(end) ? null : end;
    if (t.start || t.end) {
      s = t.start; e = t.end;
      setStartText(t.start ? formatClock(t.start) : "");
      setEndText(t.end ? formatClock(t.end) : "");
      setLink(stripVideoTimes(text));
    } else {
      setLink(text);
    }
    emit(t.start || t.end ? stripVideoTimes(text) : text, s, e && (!s || e > s) ? e : null);
  }

  function changeTime(which: "start" | "end", text: string) {
    if (which === "start") setStartText(text); else setEndText(text);
    const s = which === "start" ? parseClock(text) : start;
    const e = which === "end" ? parseClock(text) : end;
    if (Number.isNaN(s) || Number.isNaN(e)) return; // keep the last good times until it reads
    emit(link, s, e && (!s || e > s) ? e : null);
  }

  return (
    <>
      <input value={link} onChange={e => changeLink(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} style={style} aria-label="Video link" />
      <VideoUrlNote url={link} />
      {getYouTubeId(link) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
            Start at
            <input value={startText} onChange={e => changeTime("start", e.target.value)} placeholder="0:00" inputMode="numeric" aria-label="Start at (minutes:seconds)"
              style={{ ...timeBox, borderColor: startBad ? "var(--danger-text, #ff8a8a)" : "var(--border)" }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
            Stop at
            <input value={endText} onChange={e => changeTime("end", e.target.value)} placeholder="optional" inputMode="numeric" aria-label="Stop at (minutes:seconds)"
              style={{ ...timeBox, borderColor: endBad || order ? "var(--danger-text, #ff8a8a)" : "var(--border)" }} />
          </label>
          <span style={{ fontSize: 11, color: problem ? "var(--danger-text, #ff8a8a)" : "var(--muted)" }}>
            {problem ?? "minutes:seconds · blank plays from the start"}
          </span>
        </div>
      )}
    </>
  );
}
