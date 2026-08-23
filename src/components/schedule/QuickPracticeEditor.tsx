// QuickPracticeEditor — books a practice slot from the Schedule.
//
// "+ Practice" used to route into Practice Builder, which is the wrong
// tool for planning a fortnight ahead: you don't know Thursday-week's
// blocks yet, you just know there IS a practice. So this creates the
// draft row — date, time, teams — and nothing else.
//
// Tapping that row afterwards opens Practice Builder for it, which is
// where the blocks and drills get filled in. Rough the dates out first,
// plan them one at a time later.

import { useState } from "react";
import { createPractice } from "../../lib/practicePlanner";

interface RosterLite { id: string; name: string; }

interface Props {
  rosters: RosterLite[];
  /** Pre-selects a date when the button is pressed from inside a week. */
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function QuickPracticeEditor({ rosters, defaultDate, onClose, onSaved }: Props) {
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("15:00");
  const [rosterIds, setRosterIds] = useState<string[]>(rosters.length === 1 ? [rosters[0].id] : []);
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!rosterIds.length) { setErr("Pick at least one team."); return; }
    setSaving(true);
    // Repeating is the whole point of planning ahead — a fortnight of
    // Monday/Wednesday practices shouldn't be six trips through this form.
    // Each is its own draft practice, so they can diverge freely afterwards.
    for (let i = 0; i < repeatWeeks; i++) {
      const d = new Date(date + "T12:00:00");
      d.setDate(d.getDate() + i * 7);
      const { error } = await createPractice({
        practice_date: d.toISOString().slice(0, 10),
        start_time: time,
        roster_ids: rosterIds,
      });
      if (error) { setErr(error); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add practice</h3>
          <button onClick={onClose} style={btn}>Cancel</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Books the slot. Tap it on the schedule when you're ready to build the plan.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={label}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>Start time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={input} />
          </div>
        </div>

        {rosters.length > 1 && (
          <>
            <label style={{ ...label, marginTop: 10 }}>Teams</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {rosters.map(r => {
                const on = rosterIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => setRosterIds(on ? rosterIds.filter(x => x !== r.id) : [...rosterIds, r.id])}
                    style={on ? chipActive : btn}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <label style={{ ...label, marginTop: 12 }}>Repeat weekly</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[1, 2, 3, 4].map(n => (
            <button key={n} onClick={() => setRepeatWeeks(n)} style={repeatWeeks === n ? chipActive : btn}>
              {n === 1 ? "Just once" : `${n} weeks`}
            </button>
          ))}
        </div>

        {err && <div style={{ fontSize: 12, color: "#b8342e", marginTop: 10 }}>{err}</div>}

        <div style={{ marginTop: 14 }}>
          <button onClick={save} disabled={saving} style={primary}>
            {saving ? "Adding…" : repeatWeeks === 1 ? "Add to schedule" : `Add ${repeatWeeks} practices`}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 };
const panel: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto" };
const label: React.CSSProperties = { display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit" };
const btn: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" };
const chipActive: React.CSSProperties = { ...btn, background: "var(--royal)", color: "#fff", border: "none" };
const primary: React.CSSProperties = { background: "var(--royal)", border: "none", color: "#fff", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
