// src/components/SeasonModeToggle.tsx
import { useState, useEffect } from "react";
import { SeasonMode, getSeasonMode, loadSeasonMode, saveSeasonMode } from "../lib/seasonMode";
import { archiveAndResetOffseason, archiveAndResetInSeason } from "../lib/seasonReset";
import { inputStyle } from "../lib/inputStyle";
import { getCurrentSeason, startNewSeason, nextSeasonNameAfter, Season, GradeSync } from "../lib/practicePlanner";
import SeasonRolloverSummary from "./SeasonRolloverSummary";

export default function SeasonModeToggle() {
  const [mode, setMode] = useState<SeasonMode>(getSeasonMode());
  const [showPopup, setShowPopup] = useState(false);
  const [wantsReset, setWantsReset] = useState(false);
  // The season that's ending, read rather than typed. Its name is the
  // archive's label, so the archive and the season list can't disagree.
  const [current, setCurrent] = useState<Season | null>(null);
  const [seasonLabel, setSeasonLabel] = useState("");
  // Going to offseason ends a season, so this is where a new one starts.
  // Never on the way in: that would make two seasons in one year for a
  // coach who flips both ways.
  const [startNext, setStartNext] = useState(true);
  const [nextName, setNextName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a new season has started, to show what moved with it.
  const [rollover, setRollover] = useState<{ name: string; sync: GradeSync | null | undefined } | null>(null);

  useEffect(() => { loadSeasonMode().then(setMode); }, []);
  useEffect(() => {
    getCurrentSeason().then(cur => {
      setCurrent(cur ?? null);
      // Falls back to a typed label if no season exists yet, so an app
      // that's never had one can still archive.
      setSeasonLabel(cur?.name ?? "");
      setNextName(nextSeasonNameAfter(cur?.name));
    }).catch(console.error);
  }, []);

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
      await archiveAndResetOffseason(seasonLabel.trim(), current?.id ?? null);
      await archiveAndResetInSeason(seasonLabel.trim(), current?.id ?? null);
      // Only after both archives land — a new season that opened while the
      // archive failed would leave the old one closed and unrecorded.
      if (startNext && nextName.trim()) {
        const { error, sync } = await startNewSeason(nextName);
        if (error) throw new Error(error);
        setRollover({ name: nextName.trim(), sync });
      }
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
                <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {current ? "Season ending" : "Archive label"}
                </label>
                <input value={seasonLabel} onChange={e => setSeasonLabel(e.target.value)}
                  placeholder="2026-27"
                  style={{ ...inputStyle, width: "100%", marginTop: 6, marginBottom: 12 }} />

                {/* The rollover, in the one place a season actually ends. */}
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={startNext} onChange={e => setStartNext(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>
                    <span style={{ fontSize: 13, color: "var(--text)" }}>Start the next season</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                      It starts today. Practices and games from here belong to it.
                    </span>
                  </span>
                </label>
                {startNext && (
                  <input value={nextName} onChange={e => setNextName(e.target.value)}
                    placeholder="2027-28" style={{ ...inputStyle, width: "100%", marginBottom: 12 }} />
                )}
                <button type="button" disabled={busy || !seasonLabel.trim() || (startNext && !nextName.trim())} onClick={confirmResetAndSwitch}
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
      {rollover && (
        <SeasonRolloverSummary sync={rollover.sync} seasonName={rollover.name} onClose={() => setRollover(null)} />
      )}
    </div>
  );
}
