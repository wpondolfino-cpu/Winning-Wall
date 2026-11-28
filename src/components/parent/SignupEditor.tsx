// src/components/parent/SignupEditor.tsx
// Make or edit a sign-up: coaches (opens right away) and families (a
// suggestion a coach approves first). The location field explains who
// sees it and that it's wiped 2 days after the event.
import { useState } from "react";
import { saveSignup, type SignupDraft } from "../../lib/familyHub";
import { fu, errText } from "./familyUi";

interface Props {
  draft: SignupDraft;
  /** Coaches pick the team; families can't (it's their child's team). */
  teams?: { id: string; name: string }[];
  asFamily?: boolean;
  color?: string;
  onClose: () => void;
  onSaved: (status: string) => void;
}

const IDEAS = ["Team dinner", "Rides to the tournament", "Snacks for the bus", "Volunteers: senior night", "Bake sale"];

export default function SignupEditor({ draft, teams, asFamily, color = "var(--royal, #1a3fa8)", onClose, onSaved }: Props) {
  const [d, setD] = useState<SignupDraft>(draft);
  const [notify, setNotify] = useState(true);
  const [locFocus, setLocFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isNew = !draft.id;
  const set = (patch: Partial<SignupDraft>) => setD(x => ({ ...x, ...patch }));
  const setSpot = (i: number, patch: Partial<SignupDraft["spots"][number]>) =>
    setD(x => ({ ...x, spots: x.spots.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  async function save() {
    setErr(null);
    if (!d.title.trim()) { setErr("Give it a name."); return; }
    if (!d.spots.some(s => s.label.trim())) { setErr("Add at least one spot."); return; }
    if (d.location.trim() && !d.event_date) { setErr("Add the date so the location can be removed after the event."); return; }
    if (d.deadline && d.event_date && d.deadline > d.event_date) { setErr("The sign-up deadline is after the event."); return; }
    setBusy(true);
    try {
      const r = await saveSignup(d, { notifyFamilies: !asFamily && notify });
      onSaved(r.status);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  const showLocWarn = locFocus || d.location.trim().length > 0;

  return (
    <div role="dialog" aria-modal="true" aria-label={isNew ? "New sign-up" : "Edit sign-up"} style={fu.overlay} onClick={onClose}>
      <div style={fu.sheet} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1, fontSize: 18, fontWeight: 700, color: "var(--white, #fff)" }}>
            {isNew ? (asFamily ? "Suggest a sign-up" : "New sign-up") : "Edit sign-up"}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: "var(--muted, #9aa3b5)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        {asFamily && isNew && (
          <div style={{ ...fu.muted, lineHeight: 1.5 }}>A coach looks it over before other families see it. You'll be the organizer: you can post updates and send reminders.</div>
        )}

        <label style={fu.label}>What is it?
          <input value={d.title} onChange={e => set({ title: e.target.value.slice(0, 100) })} placeholder="Team dinner" style={fu.input} list="signup-ideas" />
          <datalist id="signup-ideas">{IDEAS.map(i => <option key={i} value={i} />)}</datalist>
        </label>

        {teams && teams.length > 0 && !asFamily && (
          <div>
            <div style={{ ...fu.muted, marginBottom: 6 }}>For</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={fu.pill(!d.roster_id, color)} onClick={() => set({ roster_id: null })}>All teams</button>
              {teams.map(t => <button key={t.id} style={fu.pill(d.roster_id === t.id, color)} onClick={() => set({ roster_id: t.id })}>{t.name}</button>)}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8 }}>
          <label style={fu.label}>Date
            <input type="date" value={d.event_date} onChange={e => set({ event_date: e.target.value })} style={fu.input} />
          </label>
          <label style={fu.label}>Time
            <input type="time" value={d.event_time} onChange={e => set({ event_time: e.target.value })} style={fu.input} />
          </label>
          <label style={fu.label}>Sign up by
            <input type="date" value={d.deadline} onChange={e => set({ deadline: e.target.value })} style={fu.input} />
          </label>
        </div>

        <label style={fu.label}>Details (optional)
          <textarea value={d.details} onChange={e => set({ details: e.target.value.slice(0, 1000) })} rows={2}
            placeholder="Pasta dinner for the team before the Xaverian game" style={{ ...fu.input, resize: "vertical" }} />
        </label>

        <div>
          <div style={{ ...fu.muted, marginBottom: 6 }}>Spots (what you need, and how many)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {d.spots.map((s, i) => (
              <div key={s.id ?? `n${i}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input aria-label={`Spot ${i + 1}`} value={s.label} onChange={e => setSpot(i, { label: e.target.value.slice(0, 80) })}
                  placeholder={i === 0 ? "Main dish" : i === 1 ? "Drinks" : "Another spot"} style={{ ...fu.input, flex: 1 }} />
                <input aria-label={`How many for spot ${i + 1}`} type="number" min={1} max={99} value={s.quantity}
                  onChange={e => setSpot(i, { quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} style={{ ...fu.input, width: 70, textAlign: "center" }} />
                <button aria-label="Remove spot" disabled={d.spots.length === 1} onClick={() => setD(x => ({ ...x, spots: x.spots.filter((_, j) => j !== i) }))}
                  style={{ ...fu.btn("quiet"), textDecoration: "none", fontSize: 16, opacity: d.spots.length === 1 ? 0.3 : 1 }}>✕</button>
              </div>
            ))}
          </div>
          {d.spots.length < 30 && <button style={{ ...fu.btn("plain"), marginTop: 8 }} onClick={() => setD(x => ({ ...x, spots: [...x.spots, { label: "", quantity: 1 }] }))}>+ Add a spot</button>}
        </div>

        <label style={fu.label}>Location (optional)
          <input value={d.location} onChange={e => set({ location: e.target.value.slice(0, 300) })} onFocus={() => setLocFocus(true)} onBlur={() => setLocFocus(false)}
            placeholder="Where to meet or drop off" style={fu.input} />
        </label>
        {showLocWarn && (
          <div role="note" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--amber-text, #f0c96a)", background: "rgba(240,192,64,0.10)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "8px 10px" }}>
            🔒 Only coaches, the organizer and families who sign up see this. It's deleted 2 days after the event.
            {" "}If it's a home address, only add it if you're OK with those families having it.
          </div>
        )}

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={d.show_names} onChange={e => set({ show_names: e.target.checked })} style={{ marginTop: 3 }} />
          <span><span style={fu.text}>Show who signed up</span><br /><span style={fu.muted}>Off: families see how many spots are left, not names. Coaches and the organizer always see names.</span></span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={d.allow_undo} onChange={e => set({ allow_undo: e.target.checked })} style={{ marginTop: 3 }} />
          <span><span style={fu.text}>Families can back out</span><br /><span style={fu.muted}>Until the sign-up deadline (or the day of, with no deadline).</span></span>
        </label>
        {!asFamily && isNew && (
          <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
            <span style={fu.text}>Notify families now</span>
          </label>
        )}

        {err && <div role="alert" style={{ color: "var(--danger-text, #ff9b9b)", fontSize: 13 }}>{err}</div>}
        <button onClick={save} disabled={busy} style={{ ...fu.btn("go", color), padding: 14, fontSize: 15, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Saving…" : isNew ? (asFamily ? "Send to the coaches" : "Post sign-up") : "Save"}
        </button>
      </div>
    </div>
  );
}
