// src/components/coach/PracticeDayAttendance.tsx
// A fast, standalone attendance screen — separate from the full
// PracticeBuilder editor, reading/writing the same
// practice_attendance_overrides data. Built for a coach standing in
// the gym: big tap targets, "Mark all present" for the common case,
// and grouped by team (each alphabetical by last name, call-ups at
// the bottom of whichever team they joined) for mixed practices.
//
// Attendance completion is a single timestamp on the practice row
// (attendance_taken_at), stamped only by the explicit "Complete
// attendance" button below — never on an individual checkbox toggle —
// and overwritten (not logged) on every later re-completion.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import {
  Roster, Practice, AttendanceOverride,
  getRosters, getPractice, getAttendanceOverrides, setAttendanceOverride,
  clearAttendanceOverride, markAttendanceTaken, lastNameKey,
} from "../../lib/practicePlanner";

interface PlayerLite { id: string; name: string; home_roster_id: string | null; }

interface Props {
  practiceId: string;
  onClose: () => void;
  onSaved: () => void; // lets the Practice Weeks list refresh its reference chip
}

export default function PracticeDayAttendance({ practiceId, onClose, onSaved }: Props) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [players, setPlayers] = useState<PlayerLite[]>([]);
  const [overrides, setOverrides] = useState<AttendanceOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [toast, setToast] = useState("");
  const [showCallUpFor, setShowCallUpFor] = useState<string | null>(null); // roster id whose call-up picker is open

  const load = useCallback(async () => {
    setLoading(true);
    const [p, allRosters, { data: allPlayers }, ov] = await Promise.all([
      getPractice(practiceId),
      getRosters(),
      supabase.from("profiles").select("id,name,home_roster_id").eq("role", "player"),
      getAttendanceOverrides(practiceId),
    ]);
    setPractice(p);
    setRosters(allRosters.filter(r => (p?.roster_ids ?? []).includes(r.id)).sort((a, b) => a.sort_order - b.sort_order));
    setPlayers(allPlayers ?? []);
    setOverrides(ov);
    setLoading(false);
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  const excusedIds = new Set(overrides.filter(o => o.override_type === "excused").map(o => o.player_id));
  const callUps = overrides.filter(o => o.override_type === "call_up");

  async function toggleExcuse(playerId: string) {
    if (excusedIds.has(playerId)) await clearAttendanceOverride(practiceId, playerId);
    else await setAttendanceOverride(practiceId, playerId, "excused");
    setOverrides(await getAttendanceOverrides(practiceId));
  }

  async function markAllPresent() {
    const excused = [...excusedIds];
    await Promise.all(excused.map(id => clearAttendanceOverride(practiceId, id)));
    setOverrides(await getAttendanceOverrides(practiceId));
  }

  async function addCallUp(playerId: string, rosterId: string) {
    await setAttendanceOverride(practiceId, playerId, "call_up", undefined, rosterId);
    setShowCallUpFor(null);
    setOverrides(await getAttendanceOverrides(practiceId));
  }

  async function removeCallUp(playerId: string) {
    await clearAttendanceOverride(practiceId, playerId);
    setOverrides(await getAttendanceOverrides(practiceId));
  }

  async function handleComplete() {
    setCompleting(true);
    const { error } = await markAttendanceTaken(practiceId);
    if (error) { showToast("Error: " + error); setCompleting(false); return; }
    setPractice(await getPractice(practiceId));
    setCompleting(false);
    showToast("Attendance completed");
    onSaved();
  }

  if (loading || !practice) return <div style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>Loading…</div>;

  function formatDate(d: string) {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function formatTimestamp(ts: string) {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // Every player not on any of this practice's rosters is a candidate to call up, per roster section.
  const callUpCandidates = players.filter(p => !rosters.some(r => r.id === p.home_roster_id));

  let totalAttending = 0;
  let totalRoster = 0;

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>Practice day</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{formatDate(practice.practice_date)} @ {practice.start_time.slice(0, 5)}</div>
        </div>
        <button onClick={onClose} style={secondaryBtn}>Close</button>
      </div>

      {practice.attendance_taken_at && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          Last completed {formatTimestamp(practice.attendance_taken_at)}
        </div>
      )}

      <button onClick={markAllPresent} style={{ ...primaryBtn, width: "100%", marginBottom: 14 }}>✔ Mark all present</button>

      {rosters.map(roster => {
        const base = players
          .filter(p => p.home_roster_id === roster.id)
          .sort((a, b) => lastNameKey(a.name).localeCompare(lastNameKey(b.name)));
        const rosterCallUps = callUps
          .filter(o => o.called_up_to_roster_id === roster.id)
          .map(o => players.find(p => p.id === o.player_id))
          .filter((p): p is PlayerLite => !!p)
          .sort((a, b) => lastNameKey(a.name).localeCompare(lastNameKey(b.name)));

        const attending = [...base, ...rosterCallUps].filter(p => !excusedIds.has(p.id)).length;
        totalAttending += attending;
        totalRoster += base.length + rosterCallUps.length;

        return (
          <div key={roster.id} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: roster.color, display: "inline-block" }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{roster.name}</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{attending} / {base.length + rosterCallUps.length}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[...base, ...rosterCallUps].map(p => {
                const excused = excusedIds.has(p.id);
                const isCallUp = rosterCallUps.some(c => c.id === p.id);
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => toggleExcuse(p.id)}
                      style={{
                        flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)",
                        background: "var(--surface)", cursor: "pointer", textAlign: "left",
                      }}>
                      <span style={{ fontSize: 13, color: excused ? "var(--muted)" : "var(--text)", textDecoration: excused ? "line-through" : "none" }}>
                        {p.name}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                        background: excused ? "rgba(255,107,107,0.12)" : "rgba(40,180,80,0.15)",
                        color: excused ? "#ff7b7b" : "#5de098",
                      }}>
                        {excused ? "Excused" : "Present"}
                      </span>
                    </button>
                    {isCallUp && <button onClick={() => removeCallUp(p.id)} title="Remove call-up" style={iconBtn}>✕</button>}
                  </div>
                );
              })}
              {base.length + rosterCallUps.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No players on this roster.</div>}
            </div>

            {showCallUpFor === roster.id ? (
              <select autoFocus onChange={e => { if (e.target.value) addCallUp(e.target.value, roster.id); }} style={{ ...inputStyle, marginTop: 6 }} defaultValue="">
                <option value="">Choose a player…</option>
                {callUpCandidates.filter(p => !callUps.some(o => o.player_id === p.id)).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <button onClick={() => setShowCallUpFor(roster.id)} style={{ ...smallBtn, marginTop: 6 }}>+ Call up a player</button>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderTop: "1px solid var(--border)", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Attending</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{totalAttending} / {totalRoster}</span>
      </div>

      <button onClick={handleComplete} disabled={completing} style={{ ...primaryBtn, width: "100%" }}>
        {completing ? "Saving…" : "✔ Complete attendance"}
      </button>

      {toast && <p style={{ fontSize: 13, color: "var(--gold)", marginTop: 10, textAlign: "center" }}>{toast}</p>}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px",
  fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7,
  padding: "6px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
};
const iconBtn: React.CSSProperties = {
  background: "none", border: "none", fontSize: 14, cursor: "pointer", padding: "2px 6px", color: "var(--muted)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
