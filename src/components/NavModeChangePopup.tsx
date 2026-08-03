// src/components/NavModeChangePopup.tsx
import { useState, useEffect } from "react";
import { SeasonMode } from "../lib/seasonMode";

interface Props {
  playerId: string;
  effectiveMode: SeasonMode;
}

export default function NavModeChangePopup({ playerId, effectiveMode }: Props) {
  const [show, setShow] = useState(false);
  const storageKey = `nav_mode_seen_${playerId}`;

  useEffect(() => {
    const lastSeen = localStorage.getItem(storageKey);
    if (lastSeen !== effectiveMode) {
      setShow(true);
    }
  }, [effectiveMode, storageKey]);

  function dismiss() {
    localStorage.setItem(storageKey, effectiveMode);
    setShow(false);
  }

  if (!show) return null;

  const isInSeason = effectiveMode === "inseason";

  return (
    <div className="modal-overlay open" onClick={dismiss}>
      <div className="log-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380, width: "90%" }}>
        <button className="modal-close" onClick={dismiss}>✕</button>
        <h3 style={{ marginTop: 0 }}>{isInSeason ? "🏀 Welcome to In-season mode" : "☀️ Welcome to Offseason mode"}</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          {isInSeason
            ? "Your coach just started the season. Your nav bar now shows Leaderboard, Plays, Analytics, and Scout Sheets."
            : "The season just ended. Your nav bar is back to Workouts, Leaderboard, Challenges, and Lifting."}
        </p>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Everything from the other mode didn't go anywhere — tap <strong style={{ color: "var(--text)" }}>More</strong> to find it.
        </p>
        <button type="button" onClick={dismiss} style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontWeight: 600, fontSize: 13, cursor: "pointer", marginTop: 8 }}>
          Got it
        </button>
      </div>
    </div>
  );
}
