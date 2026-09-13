// src/components/coach/CopyDrillPicker.tsx
//
// Bring a drill across from a practice you've already run, with
// everything that belongs to the placement rather than the library drill
// — its sub-label, duration, note, coaches, groups, station membership
// and split rule.
//
// Two steps rather than one flat list: every practice you've ever run is
// a long list, and loading each one's drills up front would be slow for a
// picker you mostly use to find last Tuesday.
//
// Groups are filtered to people at today's practice. A group from three
// weeks ago can hold someone who has since left, and copying it verbatim
// would print a name that won't be there — the attention badge wouldn't
// catch it either, since it only counts players marked absent.

import { useState, useEffect } from "react";
import {
  getPastPracticesForCopy, getCopyableDrills, copyDrillToSegment,
  PastPracticeSummary, CopyableDrill,
} from "../../lib/practicePlanner";
import { inputStyle } from "../../lib/inputStyle";

interface Props {
  practiceId: string;
  targetSegmentId: string;
  orderIndex: number;
  attendeeIds: string[];
  onClose: () => void;
  onCopied: (message: string) => void;
}

export default function CopyDrillPicker({ practiceId, targetSegmentId, orderIndex, attendeeIds, onClose, onCopied }: Props) {
  const [practices, setPractices] = useState<PastPracticeSummary[] | null>(null);
  const [openPractice, setOpenPractice] = useState<PastPracticeSummary | null>(null);
  const [drills, setDrills] = useState<CopyableDrill[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPastPracticesForCopy(practiceId).then(setPractices).catch(err => { console.error(err); setPractices([]); });
  }, [practiceId]);

  useEffect(() => {
    if (!openPractice) { setDrills(null); return; }
    setDrills(null);
    getCopyableDrills(openPractice.id).then(setDrills).catch(err => { console.error(err); setDrills([]); });
  }, [openPractice]);

  const dateLabel = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  const shown = (practices ?? []).filter(p =>
    !search.trim() || dateLabel(p.practice_date).toLowerCase().includes(search.trim().toLowerCase()));

  async function copy(d: CopyableDrill) {
    setBusy(true);
    const { droppedFromGroups, error } = await copyDrillToSegment(d.drill.id, targetSegmentId, orderIndex, attendeeIds);
    setBusy(false);
    if (error) { alert("Couldn't copy the drill: " + error); return; }
    onCopied(
      droppedFromGroups > 0
        ? `Copied “${d.title}” — ${droppedFromGroups} player${droppedFromGroups === 1 ? "" : "s"} left out of the groups (not at this practice)`
        : `Copied “${d.title}”`
    );
    onClose();
  }

  const summary = (d: CopyableDrill) => {
    const bits: string[] = [];
    if (d.drill.duration_minutes) bits.push(`${d.drill.duration_minutes} min`);
    if (d.groupCount) bits.push(`${d.groupCount} group${d.groupCount === 1 ? "" : "s"}`);
    if (d.coachCount) bits.push(`${d.coachCount} coach${d.coachCount === 1 ? "" : "es"}`);
    if (d.drill.goal_text?.trim()) bits.push("a note");
    if ((d.drill.station_member_ids ?? []).length) bits.push("station");
    return bits.length ? `brings ${bits.join(", ")}` : "nothing attached";
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 16, width: "min(620px, 96vw)", maxHeight: "88vh", overflowY: "auto", padding: 20 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>
            {openPractice ? dateLabel(openPractice.practice_date) : "Copy a drill"}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          {openPractice
            ? "Brings the drill's note, duration, coaches, groups and station setup with it. Players who aren't at this practice are left out of the groups."
            : "Pick a practice you've already run, then the drill you want."}
        </div>

        {!openPractice && (
          <>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by date…"
              style={{ ...inputStyle, width: "100%", marginBottom: 10, boxSizing: "border-box" }} />
            {practices === null && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>}
            {practices?.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No other practices yet.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {shown.map(p => (
                <button key={p.id} onClick={() => setOpenPractice(p)}
                  style={{ textAlign: "left", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", cursor: "pointer", fontFamily: "inherit" }}>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{dateLabel(p.practice_date)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {openPractice && (
          <>
            <button onClick={() => setOpenPractice(null)}
              style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 11.5, cursor: "pointer", padding: 0, marginBottom: 10 }}>
              ← All practices
            </button>
            {drills === null && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>}
            {drills?.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No drills in that practice.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(drills ?? []).map(d => (
                <button key={d.drill.id} disabled={busy} onClick={() => copy(d)}
                  style={{ textAlign: "left", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>
                    {d.title}
                    {d.drill.label?.trim() && <span style={{ color: "var(--muted)" }}> · {d.drill.label}</span>}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{summary(d)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
