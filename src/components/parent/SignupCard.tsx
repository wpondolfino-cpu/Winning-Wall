// src/components/parent/SignupCard.tsx
// One sign-up, for a family (sign up / back out) or for whoever runs it
// (the organizer or a coach: edit, close, remind, post an update, take
// someone off). Coaches also approve or decline family suggestions here.
import { useState } from "react";
import { formatDay, formatTime, mapsUrl } from "../../lib/family";
import {
  claimSpot, decideSignup, deleteSignup, postSignupUpdate, sendSignupReminder, setSignupOpen, unclaim,
  type Signup, type SignupSpot,
} from "../../lib/familyHub";
import { fu, errText } from "./familyUi";

interface Props {
  s: Signup;
  /** Set for families: the child they're signing up through. */
  playerId?: string;
  isStaff?: boolean;
  color?: string;
  onChanged: () => void;
  onEdit: (s: Signup) => void;
  onToast?: (msg: string) => void;
}

const STATUS: Record<string, [string, string, string]> = {
  pending:  ["Waiting for a coach", "rgba(240,192,64,0.18)", "var(--gold-text, #f0c040)"],
  closed:   ["Closed", "rgba(176,184,200,0.15)", "var(--muted, #9aa3b5)"],
  declined: ["Not approved", "rgba(220,50,50,0.15)", "var(--danger-text, #ff9b9b)"],
};

export default function SignupCard({ s, playerId, isStaff, color = "var(--royal, #1a3fa8)", onChanged, onEdit, onToast }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<SignupSpot | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateText, setUpdateText] = useState("");
  const [showAllUpdates, setShowAllUpdates] = useState(false);

  const toast = (m: string) => onToast?.(m);
  async function run(fn: () => Promise<unknown>, done?: string) {
    setErr(null); setBusy(true);
    try { await fn(); if (done) toast(done); onChanged(); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  }

  const when = [s.event_date ? formatDay(s.event_date, { weekday: "short", month: "short", day: "numeric" }) : null, s.event_time ? formatTime(s.event_time) : null].filter(Boolean).join(" · ");
  const total = s.spots.reduce((n, sp) => n + sp.quantity, 0);
  const taken = s.spots.reduce((n, sp) => n + sp.taken, 0);
  const iAmIn = s.spots.some(sp => sp.claims.some(c => c.mine));
  const manage = s.can_manage && (s.status === "open" || s.status === "closed");
  const st = STATUS[s.status];
  const firstName = (n: string | null) => (n ?? "").trim().split(/\s+/)[0];

  return (
    <div style={{ ...fu.card, borderColor: s.status === "pending" ? "rgba(240,192,64,0.45)" : iAmIn ? color : undefined }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--white, #fff)" }}>{s.title}</span>
            {st && <span style={fu.tag(st[1], st[2])}>{st[0]}</span>}
            {iAmIn && <span style={fu.tag("rgba(111,211,138,0.18)", "var(--success-text, #6fd38a)")}>You're signed up</span>}
          </div>
          <div style={{ ...fu.muted, marginTop: 3 }}>
            {when || "No date"}{s.team_name ? ` · ${s.team_name}` : isStaff ? " · All teams" : ""}
            {s.deadline && s.status === "open" ? ` · sign up by ${formatDay(s.deadline)}` : ""}
          </div>
          <div style={{ ...fu.muted, marginTop: 2 }}>
            Organized by {s.mine ? "you" : s.organizer_name ?? "a coach"}{s.organizer_is_parent && s.organizer_child && !s.mine ? ` (${firstName(s.organizer_child)}'s family)` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: taken >= total ? "var(--success-text, #6fd38a)" : "var(--text, #e8ecf4)" }}>{taken}/{total}</div>
          <div style={fu.muted}>filled</div>
        </div>
      </div>

      {s.details && <div style={{ ...fu.text, fontSize: 13.5, lineHeight: 1.5, marginTop: 8, whiteSpace: "pre-wrap" }}>{s.details}</div>}

      {s.location
        ? <a href={mapsUrl(s.location)} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "var(--text, #e8ecf4)", textDecoration: "none" }}>📍 {s.location} <span style={fu.muted}>· only shown to people signed up</span></a>
        : s.has_location ? <div style={{ ...fu.muted, marginTop: 8 }}>📍 Location shown after you sign up</div> : null}

      {s.status === "declined" && s.decline_note && <div style={{ ...fu.muted, marginTop: 8, color: "var(--danger-text, #ff9b9b)" }}>Coach's note: {s.decline_note}</div>}

      {/* Spots */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {s.spots.map(sp => {
          const left = sp.quantity - sp.taken;
          const mine = sp.claims.find(c => c.mine);
          const named = sp.claims.filter(c => c.name);
          const hidden = sp.claims.length - named.length;
          return (
            <div key={sp.id} style={{ ...fu.inner, display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text, #e8ecf4)" }}>
                  {sp.label} <span style={{ ...fu.muted, fontWeight: 500 }}>· {sp.taken} of {sp.quantity}</span>
                </div>
                {sp.claims.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {named.map(c => (
                      <span key={c.id} style={{ fontSize: 12, color: c.mine ? "var(--success-text, #6fd38a)" : "var(--muted-2, #b5bdcc)", background: "var(--surface2, #141b2d)", borderRadius: 999, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {c.mine ? "You" : c.name}{c.child && !c.mine ? ` (${firstName(c.child)})` : ""}{c.qty > 1 ? ` ×${c.qty}` : ""}{c.note ? ` · ${c.note}` : ""}
                        {manage && !c.mine && (
                          <button aria-label={`Take ${c.name} off`} disabled={busy}
                            onClick={() => { if (window.confirm(`Take ${c.name} off "${sp.label}"?`)) run(() => unclaim(c.id), "Taken off."); }}
                            style={{ background: "none", border: 0, color: "var(--muted, #9aa3b5)", cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
                        )}
                      </span>
                    ))}
                    {hidden > 0 && <span style={{ ...fu.muted, padding: "2px 4px" }}>{hidden === sp.claims.length ? `${hidden} famil${hidden === 1 ? "y" : "ies"}` : `+${hidden} more`}</span>}
                  </div>
                )}
              </div>
              {playerId && (mine
                ? (s.allow_undo && s.open_now
                    ? <button style={fu.btn("quiet")} disabled={busy} onClick={() => run(() => unclaim(mine.id), "You're off that spot.")}>Undo</button>
                    : <span style={fu.muted}>✓</span>)
                : s.open_now && left > 0
                  ? <button style={fu.btn("go", color)} disabled={busy} onClick={() => { setClaiming(sp); setQty(1); setNote(""); }}>Sign up</button>
                  : left <= 0 ? <span style={fu.muted}>Full</span> : null)}
            </div>
          );
        })}
      </div>

      {claiming && playerId && (
        <div style={{ ...fu.inner, marginTop: 8, display: "flex", flexDirection: "column", gap: 8, borderColor: color }}>
          <div style={fu.text}>Sign up for <b>{claiming.label}</b></div>
          {claiming.quantity - claiming.taken > 1 && (
            <label style={{ ...fu.label, flexDirection: "row", alignItems: "center", gap: 8 }}>How many?
              <input type="number" min={1} max={claiming.quantity - claiming.taken} value={qty}
                onChange={e => setQty(Math.max(1, Math.min(claiming.quantity - claiming.taken, Number(e.target.value) || 1)))} style={{ ...fu.input, width: 70 }} />
            </label>
          )}
          <input value={note} onChange={e => setNote(e.target.value.slice(0, 200))} placeholder={s.show_names ? "Note (optional): what you're bringing, seats…" : "Note for the organizer (optional)"} style={fu.input} />
          {!s.allow_undo && <div style={{ ...fu.muted, color: "var(--amber-text, #f0c96a)" }}>Heads up: this one can't be undone from the app.</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={fu.btn("go", color)} disabled={busy} onClick={() => run(async () => { await claimSpot(claiming.id, playerId, qty, note); setClaiming(null); }, "You're signed up.")}>Confirm</button>
            <button style={fu.btn("plain")} onClick={() => setClaiming(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Updates from the organizer */}
      {s.updates.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {(showAllUpdates ? s.updates : s.updates.slice(0, 2)).map(u => (
            <div key={u.id} style={{ fontSize: 13, color: "var(--text, #e8ecf4)", borderLeft: `3px solid ${color}`, paddingLeft: 8, lineHeight: 1.45 }}>
              📣 {u.message} <span style={fu.muted}>· {u.author ?? "Organizer"}, {new Date(u.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </div>
          ))}
          {s.updates.length > 2 && !showAllUpdates && <button style={{ ...fu.btn("quiet"), alignSelf: "flex-start" }} onClick={() => setShowAllUpdates(true)}>See all {s.updates.length} updates</button>}
        </div>
      )}

      {/* Coach: approve a family's suggestion */}
      {isStaff && s.status === "pending" && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button style={fu.btn("go", color)} disabled={busy} onClick={() => run(() => decideSignup(s.id, true), "Approved. Families were notified.")}>Approve & post</button>
          <button style={fu.btn("plain")} disabled={busy} onClick={() => onEdit(s)}>Edit first</button>
          <button style={fu.btn("danger")} disabled={busy} onClick={() => {
            const n = window.prompt("Decline this sign-up? You can add a short note for the family (optional):", "");
            if (n !== null) run(() => decideSignup(s.id, false, n), "Declined.");
          }}>Decline</button>
        </div>
      )}

      {/* Family: their own suggestion, before approval */}
      {!isStaff && s.mine && (s.status === "pending" || s.status === "declined") && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {s.status === "pending" && <button style={fu.btn("plain")} disabled={busy} onClick={() => onEdit(s)}>Edit</button>}
          <button style={fu.btn("danger")} disabled={busy} onClick={() => { if (window.confirm("Withdraw this sign-up?")) run(() => deleteSignup(s.id), "Withdrawn."); }}>Withdraw</button>
        </div>
      )}

      {/* Organizer or coach */}
      {manage && (
        <>
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            <button style={fu.btn("plain")} disabled={busy} onClick={() => setUpdating(u => !u)}>📣 Post update</button>
            <button style={fu.btn("plain")} disabled={busy} onClick={() => run(async () => toast(await sendSignupReminder(s.id)))}>⏰ Remind</button>
            <button style={fu.btn("plain")} disabled={busy} onClick={() => onEdit(s)}>Edit</button>
            <button style={fu.btn("plain")} disabled={busy} onClick={() => run(() => setSignupOpen(s.id, s.status !== "open"), s.status === "open" ? "Closed. No more sign-ups." : "Open again.")}>
              {s.status === "open" ? "Close sign-ups" : "Reopen"}
            </button>
            {isStaff && <button style={fu.btn("danger")} disabled={busy} onClick={() => { if (window.confirm(`Delete "${s.title}" and everyone's sign-ups?`)) run(() => deleteSignup(s.id), "Deleted."); }}>Delete</button>}
          </div>
          {updating && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={updateText} onChange={e => setUpdateText(e.target.value.slice(0, 1000))} placeholder="Moved to 6:30. Bring plates!" style={{ ...fu.input, flex: 1 }}
                onKeyDown={e => { if (e.key === "Enter" && updateText.trim()) run(async () => { await postSignupUpdate(s.id, updateText); setUpdateText(""); setUpdating(false); }, "Update sent to everyone signed up."); }} />
              <button style={fu.btn("go", color)} disabled={busy || !updateText.trim()}
                onClick={() => run(async () => { await postSignupUpdate(s.id, updateText); setUpdateText(""); setUpdating(false); }, "Update sent to everyone signed up.")}>Send</button>
            </div>
          )}
        </>
      )}

      {err && <div role="alert" style={{ color: "var(--danger-text, #ff9b9b)", fontSize: 13, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
