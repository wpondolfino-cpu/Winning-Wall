// EventEditor — film sessions, lifting, team dinners, bus times.
//
// Deliberately five fields and nothing more. Without an event type,
// coaches fake these as practices with no blocks, which pollutes practice
// reporting and attendance. But the moment an event gets its own screens
// and workflows it starts growing into a general calendar, which is a
// different product.
//
// So: no editor behind it, no publish state, no attendance. What you see
// here is the entire record.

import { useState } from "react";
import { createEvent } from "../../lib/schedule";

interface RosterLite { id: string; name: string; }

interface Props {
  seasonId: string | null;
  rosters: RosterLite[];
  onClose: () => void;
  onSaved: () => void;
}

export default function EventEditor({ seasonId, rosters, onClose, onSaved }: Props) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [rosterIds, setRosterIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setErr("Give it a name."); return; }
    setSaving(true);
    const { error } = await createEvent({
      season_id: seasonId,
      event_date: date,
      start_time: time || null,
      title,
      location: location.trim() || null,
      // Empty means everyone — a team dinner isn't roster-specific, and
      // making the coach tick every roster to say "all" is friction for
      // the common case.
      roster_ids: rosterIds,
    });
    setSaving(false);
    if (error) { setErr(error); return; }
    onSaved();
    onClose();
  }

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>New event</h3>
          <button onClick={onClose} style={btn}>Cancel</button>
        </div>

        <label style={label}>What is it?</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Film session, lifting, team dinner…" style={input} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <div>
            <label style={label}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={input} />
          </div>
        </div>

        <label style={{ ...label, marginTop: 10 }}>Where</label>
        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Room 214, weight room…" style={input} />

        {rosters.length > 1 && (
          <>
            <label style={{ ...label, marginTop: 10 }}>Who</label>
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
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Leave all unticked for the whole program.
            </div>
          </>
        )}

        {err && <div style={{ fontSize: 12, color: "#b8342e", marginTop: 10 }}>{err}</div>}

        <div style={{ marginTop: 14 }}>
          <button onClick={save} disabled={saving} style={primary}>{saving ? "Saving…" : "Add to schedule"}</button>
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
