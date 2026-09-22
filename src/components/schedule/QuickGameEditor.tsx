// QuickGameEditor — puts a game on the schedule without leaving it.
//
// "+ Game" used to route to the tracker, which is the wrong place to be
// when you're laying out a season: it wants a game format and then opens
// the game to record it. This makes the game row — opponent, date, time,
// place, team — and nothing else, the same way "+ Practice" books a slot.
//
// Because the tracker and the scout hub both read the same games table, a
// game made here is in both straight away. It goes through createGame, so
// it's filed exactly like one made anywhere else.
//
// The opponent is picked from your opponents list rather than typed. That
// link is what lets the scout hub find this game later: build a scout
// sheet for the same opponent and date, and it attaches to this game
// instead of making a second one. No scout sheet is created here — an
// empty one would light up the schedule's Scout sheet button with nothing
// behind it.

import { useState, useEffect } from "react";
import { createGame } from "../../lib/gameStats";
import { getOpponents, createOpponent, Opponent } from "../../lib/scoutSheets";

interface RosterLite { id: string; name: string; }

export default function QuickGameEditor({ rosters, onClose, onSaved }: {
  rosters: RosterLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [opponentId, setOpponentId] = useState<string>("");
  const [newOpponent, setNewOpponent] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [tip, setTip] = useState("19:00");
  const [bus, setBus] = useState("");
  const [homeAway, setHomeAway] = useState<"home" | "away" | "neutral">("home");
  const [location, setLocation] = useState("");
  const [rosterId, setRosterId] = useState<string>(rosters.length === 1 ? rosters[0].id : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getOpponents().then(setOpponents).catch(console.error); }, []);

  const addingNew = opponentId === "__new";

  async function save() {
    setErr(null);
    if (!rosterId) { setErr("Pick a team."); return; }
    let oppId: string | null = opponentId && !addingNew ? opponentId : null;
    let oppName = opponents.find(o => o.id === oppId)?.name ?? "";
    if (addingNew) {
      if (!newOpponent.trim()) { setErr("Type the opponent's name."); return; }
      // Reuse an existing one if the name already matches, rather than
      // making a near-duplicate the scout hub then can't connect.
      const match = opponents.find(o => o.name.trim().toLowerCase() === newOpponent.trim().toLowerCase());
      if (match) { oppId = match.id; oppName = match.name; }
      else {
        try { const created = await createOpponent(newOpponent); oppId = created.id; oppName = created.name; }
        catch (e: any) { setErr(e.message); return; }
      }
    }
    if (!oppName) { setErr("Pick an opponent."); return; }

    setSaving(true);
    const { error } = await createGame({
      opponent: oppName, opponent_id: oppId, game_date: date,
      tip_time: tip || null,
      // Only an away game has a bus worth recording.
      bus_time: homeAway === "away" ? (bus || null) : null,
      home_away: homeAway, location, roster_id: rosterId,
    });
    setSaving(false);
    if (error) { setErr(error); return; }
    onSaved();
    onClose();
  }

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add game</h3>
          <button onClick={onClose} style={btn}>Cancel</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Puts it on the schedule, in the game tracker and in the scout sheets list. The game's format can be set in the tracker.
        </div>

        <label style={label}>Opponent</label>
        <select value={opponentId} onChange={e => setOpponentId(e.target.value)} style={input}>
          <option value="">Choose…</option>
          {opponents.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="__new">+ New opponent</option>
        </select>
        {addingNew && (
          <input value={newOpponent} onChange={e => setNewOpponent(e.target.value)} autoFocus
            placeholder="Opponent's name" style={{ ...input, marginTop: 6 }} />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <div><label style={label}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} /></div>
          <div><label style={label}>Tip time</label>
            <input type="time" value={tip} onChange={e => setTip(e.target.value)} style={input} /></div>
        </div>

        <label style={{ ...label, marginTop: 10 }}>Where</label>
        <div style={{ display: "flex", gap: 6 }}>
          {(["home", "away", "neutral"] as const).map(h => (
            <button key={h} onClick={() => setHomeAway(h)} style={homeAway === h ? chipActive : btn}>
              {h === "home" ? "Home" : h === "away" ? "Away" : "Neutral"}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: homeAway === "away" ? "1fr 1fr" : "1fr", gap: 10, marginTop: 10 }}>
          <div><label style={label}>Location (optional)</label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Gym or school" style={input} /></div>
          {homeAway === "away" && (
            <div><label style={label}>Bus time</label>
              <input type="time" value={bus} onChange={e => setBus(e.target.value)} style={input} /></div>
          )}
        </div>

        {rosters.length > 1 && (
          <>
            <label style={{ ...label, marginTop: 10 }}>Team</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {rosters.map(r => (
                <button key={r.id} onClick={() => setRosterId(r.id)} style={rosterId === r.id ? chipActive : btn}>{r.name}</button>
              ))}
            </div>
          </>
        )}

        {err && <div style={{ fontSize: 12, color: "#ff7b7b", marginTop: 10 }}>{err}</div>}

        <div style={{ marginTop: 14 }}>
          <button onClick={save} disabled={saving} style={{ ...primary, opacity: saving ? 0.5 : 1 }}>
            {saving ? "Adding…" : "Add to schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 };
const panel: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto" };
const label: React.CSSProperties = { display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit" };
const btn: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" };
const chipActive: React.CSSProperties = { ...btn, background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" };
const primary: React.CSSProperties = { background: "var(--royal)", border: "none", color: "#fff", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
