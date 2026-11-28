// src/components/parent/ParentTabs.tsx
// Parent app tabs (SQL 223): Sign-ups and Checklist.
import { useEffect, useState } from "react";
import { formatDay, todayIso } from "../../lib/family";
import { blankSignup, draftFrom, getParentChecklist, listSignups, type ParentChecklistRow, type Signup, type SignupDraft } from "../../lib/familyHub";
import SignupCard from "./SignupCard";
import SignupEditor from "./SignupEditor";
import { fu, errText } from "./familyUi";

export function ParentSignups({ playerId, childName, color, suggestionsOn, onToast, onChanged }: {
  playerId: string; childName: string; color: string; suggestionsOn: boolean;
  onToast: (m: string) => void; onChanged: () => void;
}) {
  const [list, setList] = useState<Signup[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<SignupDraft | null>(null);

  const load = () => listSignups(playerId).then(l => { setList(l); setErr(null); }).catch(e => setErr(errText(e)));
  useEffect(() => { setList(null); load(); }, [playerId]);
  const changed = () => { load(); onChanged(); };

  const mineWaiting = (list ?? []).filter(s => s.mine && (s.status === "pending" || s.status === "declined"));
  const live = (list ?? []).filter(s => s.status === "open" || s.status === "closed");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...fu.card, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={fu.h2}>🙋 Sign-ups</div>
          <div style={fu.muted}>Team dinners, rides and volunteer spots for {childName}'s team.</div>
        </div>
        {suggestionsOn && <button style={fu.btn("go", color)} onClick={() => setEditing({ ...blankSignup(), player: playerId })}>+ Suggest one</button>}
      </div>

      {err && <div role="alert" style={{ ...fu.card, color: "var(--danger-text, #ff9b9b)", fontSize: 13 }}>{err}</div>}
      {list === null && !err && <div style={{ ...fu.muted, textAlign: "center", padding: 20 }}>Loading…</div>}

      {mineWaiting.map(s => <SignupCard key={s.id} s={s} playerId={playerId} color={color} onChanged={changed} onToast={onToast}
        onEdit={x => setEditing({ ...draftFrom(x), player: playerId })} />)}

      {list && live.length === 0 && mineWaiting.length === 0 && (
        <div style={{ ...fu.card, textAlign: "center", padding: "24px 16px" }}>
          <div style={{ fontSize: 28 }}>📋</div>
          <div style={{ ...fu.text, marginTop: 6 }}>No sign-ups right now.</div>
          {suggestionsOn && <div style={{ ...fu.muted, marginTop: 4 }}>Organizing a team dinner or rides? Suggest one and a coach will post it.</div>}
        </div>
      )}

      {live.map(s => <SignupCard key={s.id} s={s} playerId={playerId} color={color} onChanged={changed} onToast={onToast}
        onEdit={x => setEditing({ ...draftFrom(x), player: playerId })} />)}

      {editing && (
        <SignupEditor draft={editing} asFamily color={color} onClose={() => setEditing(null)}
          onSaved={st => { setEditing(null); onToast(st === "pending" ? "Sent. A coach will look it over." : "Saved."); changed(); }} />
      )}
    </div>
  );
}

export function ParentChecklist({ playerId, childName }: { playerId: string; childName: string }) {
  const [rows, setRows] = useState<ParentChecklistRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setRows(null); getParentChecklist(playerId).then(setRows).catch(e => setErr(errText(e))); }, [playerId]);
  const got = (rows ?? []).filter(r => r.received_on).length;
  const today = todayIso();

  return (
    <div style={fu.card}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={fu.h2}>✅ Checklist</div>
        {rows && rows.length > 0 && <div style={fu.muted}>{got} of {rows.length} received</div>}
      </div>
      <div style={{ ...fu.muted, margin: "4px 0 12px" }}>What the coaches need for {childName}. They tick each one off when they get it.</div>
      {err && <div role="alert" style={{ color: "var(--danger-text, #ff9b9b)", fontSize: 13 }}>{err}</div>}
      {rows === null && !err ? <div style={fu.muted}>Loading…</div>
        : rows && rows.length === 0 ? <div style={fu.muted}>Nothing on the list right now.</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(rows ?? []).map(r => {
              const late = !r.received_on && r.due_date && r.due_date < today;
              return (
                <div key={r.id} style={{ ...fu.inner, display: "flex", gap: 10, alignItems: "flex-start", borderColor: r.received_on ? "rgba(111,211,138,0.35)" : late ? "rgba(220,50,50,0.4)" : undefined }}>
                  <div style={{ fontSize: 18, lineHeight: 1.2 }} aria-hidden>{r.received_on ? "✅" : "⬜"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text, #e8ecf4)" }}>{r.title}</div>
                    {r.details && <div style={{ ...fu.muted, marginTop: 2, lineHeight: 1.45 }}>{r.details}</div>}
                    <div style={{ fontSize: 12, marginTop: 3, color: r.received_on ? "var(--success-text, #6fd38a)" : late ? "var(--danger-text, #ff9b9b)" : "var(--muted, #9aa3b5)" }}>
                      {r.received_on ? `Received ${formatDay(r.received_on, { month: "short", day: "numeric" })}` : r.due_date ? `${late ? "Was due" : "Due"} ${formatDay(r.due_date)}` : "Not received yet"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
