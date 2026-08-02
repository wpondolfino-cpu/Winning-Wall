// src/components/SeasonModeToggle.tsx
import { useState, useEffect } from "react";
import { SeasonMode, getSeasonMode, loadSeasonMode, saveSeasonMode } from "../lib/seasonMode";
import { archiveAndResetOffseason, archiveAndResetInSeason } from "../lib/seasonReset";
import { inputStyle } from "../lib/inputStyle";

export default function SeasonModeToggle() {
  const [mode, setMode] = useState<SeasonMode>(getSeasonMode());
  const [showPopup, setShowPopup] = useState(false);
  const [wantsReset, setWantsReset] = useState(false);
  const [seasonLabel, setSeasonLabel] = useState(() => {
    const y = new Date().getFullYear();
    return `${y}-${(y + 1).toString().slice(2)}`;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadSeasonMode().then(setMode); }, []);

  const target: SeasonMode = mode === "offseason" ? "inseason" : "offseason";
  // Deferred-reset design: archiving only ever happens on the trip BACK
  // to offseason (touches everyone together, fairly) — never on the
  // trip into a season, which would give non-rostered players an
  // unfair head start. So the reset option only appears here.
  const canOfferReset = target === "offseason";

  function openPopup() {
    setError(null);
    setWantsReset(false);
    setShowPopup(true);
  }

  async function plainSwitch() {
    setBusy(true);
    setError(null);
    try {
      await saveSeasonMode(target);
      setMode(target);
      setShowPopup(false);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't switch modes — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmResetAndSwitch() {
    if (!seasonLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Both archives must succeed before the mode flips or anything
      // resets — if either fails, nothing changes.
      await archiveAndResetOffseason(seasonLabel.trim());
      await archiveAndResetInSeason(seasonLabel.trim());
      await saveSeasonMode(target);
      setMode(target);
      setShowPopup(false);
    } catch (e: any) {
      setError(e?.message ?? "Archiving failed — nothing was reset or switched. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "var(--surface2)", borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Season Mode</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        App is currently in <strong style={{ color: "var(--text)" }}>{mode === "inseason" ? "In-season" : "Offseason"}</strong> mode.
      </div>
      <button type="button" onClick={openPopup} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
        Switch to {target === "inseason" ? "In-season" : "Offseason"}
      </button>

      {showPopup && (
        <div className="modal-overlay open" onClick={() => !busy && setShowPopup(false)}>
          <div className="log-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: "92%" }}>
            <button className="modal-close" onClick={() => !busy && setShowPopup(false)}>✕</button>
            <h3 style={{ marginTop: 0 }}>Switch to {target === "inseason" ? "In-season" : "Offseason"}?</h3>

            {error && <div className="error-msg">{error}</div>}

            {!wantsReset ? (
              <>
                <p style={{ fontSize: 13, color: "var(--muted)" }}>This changes the mobile nav and default leaderboard view for every rostered player.</p>
                <button type="button" disabled={busy} onClick={plainSwitch}
                  style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontWeight: 600, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
                  {busy ? "Switching…" : "Switch"}
                </button>
                {canOfferReset && (
                  <button type="button" disabled={busy} onClick={() => setWantsReset(true)}
                    style={{ width: "100%", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.25)", color: "#ff7b7b", borderRadius: 8, padding: "10px", fontWeight: 600, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
                    Switch with Reset &amp; Archive
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => setShowPopup(false)}
                  style={{ width: "100%", background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "10px", fontSize: 13, cursor: "pointer" }}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#ff7b7b" }}>
                  This archives and resets <strong>both</strong> leaderboards for every player — rostered and non-rostered together. Personal bests and perks are untouched. This can't be undone.
                </p>
                <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Archive label</label>
                <input value={seasonLabel} onChange={e => setSeasonLabel(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 6, marginBottom: 12 }} />
                <button type="button" disabled={busy || !seasonLabel.trim()} onClick={confirmResetAndSwitch}
                  style={{ width: "100%", background: "#c0392b", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
                  {busy ? "Archiving…" : "Confirm — Archive, Reset & Switch"}
                </button>
                <button type="button" disabled={busy} onClick={() => setWantsReset(false)}
                  style={{ width: "100%", background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "10px", fontSize: 13, cursor: "pointer" }}>
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
