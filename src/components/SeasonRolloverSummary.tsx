// src/components/SeasonRolloverSummary.tsx
//
// Shown once, right after a new season starts, from either place that can
// start one (the offseason switch and Settings → Seasons).
//
// Reports what moved on its own -- grades, graduates off their rosters --
// and offers the one cleanup that needs a yes: last season's saved
// groupings. Offered, never automatic; the count is in the button.

import { useEffect, useState } from "react";
import { GradeSync, getPreviousSeasonGroupingIds, deleteSavedGroupings } from "../lib/practicePlanner";

interface Props {
  sync: GradeSync | null | undefined;
  seasonName: string;
  onClose: () => void;
}

export default function SeasonRolloverSummary({ sync, seasonName, onClose }: Props) {
  const [oldIds, setOldIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getPreviousSeasonGroupingIds().then(setOldIds); }, []);

  async function clearOld() {
    if (!oldIds?.length) return;
    setDeleting(true); setErr(null);
    const { error } = await deleteSavedGroupings(oldIds);
    setDeleting(false);
    if (error) { setErr(error); return; }
    setDeleted(oldIds.length);
    setOldIds([]);
  }

  const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const line: React.CSSProperties = { fontSize: 13, color: "var(--text)", padding: "8px 0", borderTop: "1px solid var(--border)" };
  const sub: React.CSSProperties = { fontSize: 11, color: "var(--muted)", marginTop: 2 };

  return (
    <div className="modal-overlay open" onClick={() => !deleting && onClose()}>
      <div className="log-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, width: "92%" }}>
        <button className="modal-close" onClick={() => !deleting && onClose()}>✕</button>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", letterSpacing: 1, marginBottom: 4 }}>
          {seasonName} has started
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>What changed on its own, and one thing that's your call.</div>

        {sync ? (
          <>
            <div style={line}>
              {sync.grades_moved > 0 ? `${plural(sync.grades_moved, "player")} moved up a leaderboard group` : "No leaderboard groups needed to change"}
              <div style={sub}>Seniors are now the class of {sync.academic_year}.</div>
            </div>
            <div style={line}>
              {sync.alumni_cleared > 0 ? `${plural(sync.alumni_cleared, "graduate")} taken off their roster` : "No graduates were still on a roster"}
              <div style={sub}>Their jersey numbers are free again. Their history and scores stay.</div>
            </div>
            {sync.missing_year > 0 && (
              <div style={{ ...line, color: "#ff8c42" }}>
                {plural(sync.missing_year, "player")} {sync.missing_year === 1 ? "has" : "have"} no school year set
                <div style={sub}>They couldn't be moved. Set it in Players &amp; coaches → Edit.</div>
              </div>
            )}
          </>
        ) : (
          <div style={{ ...line, color: "#ff7b7b" }}>
            The season started, but grades couldn't be updated.
            <div style={sub}>Nothing else is affected. Re-saving the season's start date in Settings retries it.</div>
          </div>
        )}

        <div style={{ ...line, paddingBottom: 0 }}>
          Saved groupings from earlier seasons
          <div style={sub}>
            Last year's "3s Week 1" is full of names that have moved on. Practices that used them keep their groups.
          </div>
          {deleted != null ? (
            <div style={{ fontSize: 12, color: "#5de098", marginTop: 8 }}>{plural(deleted, "grouping")} deleted.</div>
          ) : oldIds == null ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Checking…</div>
          ) : oldIds.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>None to clear.</div>
          ) : (
            <button type="button" onClick={clearOld} disabled={deleting}
              style={{ marginTop: 8, background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {deleting ? "Deleting…" : `Delete ${plural(oldIds.length, "old grouping")}`}
            </button>
          )}
          {oldIds != null && oldIds.length > 0 && deleted == null && (
            <div style={sub}>Or keep them: they stay out of the way behind "Show earlier seasons".</div>
          )}
          {err && <div style={{ fontSize: 12, color: "#ff7b7b", marginTop: 6 }}>{err}</div>}
        </div>

        <button type="button" onClick={onClose} disabled={deleting}
          style={{ marginTop: 16, width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          Done
        </button>
      </div>
    </div>
  );
}
