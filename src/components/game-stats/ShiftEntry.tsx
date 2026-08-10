// src/components/game-stats/ShiftEntry.tsx
// Post-game shift entry: walk this game's possession list with film up and
// mark where subs happened.
//
// Carry-forward painting, not per-possession tagging. You set the five once
// and it stays until you change it, so a full game is roughly "set the
// starting five, then tap two chips at each sub" -- a dozen interactions,
// not sixty.
//
// Read-only on possessions. This screen only writes shifts and foul-trouble
// events; correcting a possession is PossessionEditor's job. Keeping the two
// apart is what stops this turning into a second GameTracker.
//
// Every action writes immediately, so a half-entered game survives closing
// the tab -- there's no save button and nothing to lose.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getRosters } from "../../lib/practicePlanner";
import {
  listShifts, listLineupEvents, listGamePlayers, lastStartingFive,
  createShift, updateShiftFive, deleteShift, addFoulTrouble, deleteLineupEvent, setGameRoster,
  listCallUpCandidates, addCallUp, removeCallUp,
  assignPossessions, validateShifts, FOUL_LEVELS, SIDE_LABEL,
  type Shift, type LineupEvent, type LineupPlayer, type FoulLevel, type ShiftSide,
} from "../../lib/lineups";
import { periodLabel, describePossession, DEFAULT_GAME_FORMAT, type GameFormat, type Possession } from "../../lib/gameStats";

interface Props {
  gameId: string;
  userId: string;
  rosterId: string | null;
  format?: GameFormat;
  /** An intrasquad practice has two squads to track, not one. */
  intrasquad?: boolean;
  /** Lets the screen tell the hub the roster changed, so it reloads too. */
  onRosterChange?: (rosterId: string | null) => void;
}

const BAND_BG = ["#12241f", "#191a2c", "#241a14", "#241521"];
const BAND_LINE = ["#2f6e56", "#4a46a0", "#8a4b28", "#8a3a56"];

export default function ShiftEntry({ gameId, userId, rosterId, format = DEFAULT_GAME_FORMAT, intrasquad = false, onRosterChange }: Props) {
  const [possessions, setPossessions] = useState<Possession[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [events, setEvents] = useState<LineupEvent[]>([]);
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sub panel state. `editing` is the shift being changed, or a sequence
  // number when a brand new shift is being inserted before that possession.
  const [panel, setPanel] = useState<
    | { mode: "new"; sequence: number; quarter: number }
    | { mode: "edit"; shift: Shift }
    | null
  >(null);
  const [draftOn, setDraftOn] = useState<string[]>([]);
  const [draftIn, setDraftIn] = useState<string[]>([]);
  const [draftOut, setDraftOut] = useState<string[]>([]);
  const [jersey, setJersey] = useState("");

  const [rosters, setRosters] = useState<{ id: string; name: string }[]>([]);
  // Call-ups are per game, so the picker is opened from here rather than
  // being set up in advance -- you find out you need someone at the exact
  // moment you go looking for them on the bench.
  // Which squad is being painted. Games only ever have one.
  const [side, setSide] = useState<ShiftSide>("us");
  const [callUpOpen, setCallUpOpen] = useState(false);
  const [candidates, setCandidates] = useState<(LineupPlayer & { fromRoster: string })[]>([]);
  const [activeRoster, setActiveRoster] = useState<string>(rosterId ?? "");

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, rosterId]);
  useEffect(() => { setActiveRoster(rosterId ?? ""); }, [rosterId]);
  useEffect(() => { getRosters().then((rs) => setRosters(rs.map((r) => ({ id: r.id, name: r.name })))); }, []);

  // Games created before migration 102 have no roster, so they offer every
  // player. Setting it here rather than in a game-settings panel puts the
  // control where the problem is actually visible -- a bench list with
  // thirty names on it.
  async function changeRoster(next: string) {
    setActiveRoster(next);
    const { error: err } = await setGameRoster(gameId, next || null);
    if (err) { setError(err); return; }
    try {
      setPlayers(await listGamePlayers(next || null, gameId));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load players.");
      setPlayers([]);
    }
    onRosterChange?.(next || null);
  }

  async function load() {
    setLoading(true);
    try {
      const { data, error: possErr } = await supabase
        .from("possessions")
        .select("*")
        .eq("game_id", gameId)
        .order("sequence", { ascending: true });
      if (possErr) throw new Error(`Couldn't load possessions: ${possErr.message}`);
      setPossessions((data ?? []) as Possession[]);
      setShifts(await listShifts(gameId));
      setEvents(await listLineupEvents(gameId));
      setPlayers(await listGamePlayers(rosterId, gameId));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load this game's data.");
    }
    setLoading(false);
  }

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const sides = useMemo<ShiftSide[]>(() => (intrasquad ? ["us", "opponent"] : ["us"]), [intrasquad]);
  const assigned = useMemo(() => assignPossessions(possessions, shifts, side), [possessions, shifts, side]);
  const problems = useMemo(() => validateShifts(possessions, shifts, sides), [possessions, shifts, sides]);
  // The list paints one side at a time, so everything below is that side's.
  const sortedShifts = useMemo(
    () => shifts.filter((s) => (s.side ?? "us") === side).sort((a, b) => a.start_sequence - b.start_sequence),
    [shifts, side],
  );
  /** The other squad's five at a moment -- nobody can be on both at once. */
  function opposingFive(sequence: number): string[] {
    if (!intrasquad) return [];
    const other: ShiftSide = side === "us" ? "opponent" : "us";
    let five: string[] = [];
    shifts.filter((s) => (s.side ?? "us") === other)
      .sort((a, b) => a.start_sequence - b.start_sequence)
      .forEach((s) => { if (s.start_sequence <= sequence) five = s.player_ids; });
    return five;
  }

  function label(id: string) {
    const p = byId.get(id);
    if (!p) return "unknown";
    return p.jersey != null ? `${p.jersey} ${p.name}` : p.name;
  }

  /** The five in effect just before a given sequence, so a new shift starts from what's already on the floor. */
  function fiveBefore(sequence: number): string[] {
    let five: string[] = [];
    for (const s of sortedShifts) if (s.start_sequence <= sequence) five = s.player_ids;
    return five;
  }

  const panelSequence = panel ? (panel.mode === "new" ? panel.sequence : panel.shift.start_sequence) : 0;
  const unavailable = panel ? opposingFive(panelSequence) : [];

  async function openNew(sequence: number, quarter: number) {
    const carried = fiveBefore(sequence);
    let seed = carried;
    if (!seed.length) {
      const last = await lastStartingFive(rosterId, gameId);
      // Only prefill with players actually available for this game.
      if (last) seed = last.filter((id) => byId.has(id));
    }
    setPanel({ mode: "new", sequence, quarter });
    setDraftOn(seed);
    setDraftIn([]); setDraftOut([]); setJersey(""); setError(null);
  }

  function openEdit(shift: Shift) {
    setPanel({ mode: "edit", shift });
    setDraftOn(shift.player_ids);
    setDraftIn([]); setDraftOut([]); setJersey(""); setError(null);
  }

  function closePanel() { setPanel(null); setDraftOn([]); setDraftIn([]); setDraftOut([]); setJersey(""); }

  function toggle(id: string) {
    if (draftOn.includes(id)) { setDraftOn(draftOn.filter((x) => x !== id)); setDraftOut([...draftOut, id]); return; }
    if (draftOut.includes(id)) { setDraftOut(draftOut.filter((x) => x !== id)); setDraftOn([...draftOn, id]); return; }
    if (draftIn.includes(id)) { setDraftIn(draftIn.filter((x) => x !== id)); return; }
    setDraftIn([...draftIn, id]);
  }

  /** Jersey typing runs alongside chip tapping, never replaces it. Enter commits the single match. */
  function onJerseyKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const matches = players.filter((p) => p.jersey != null && String(p.jersey).startsWith(jersey) && !unavailable.includes(p.id));
    if (jersey && matches.length === 1) { toggle(matches[0].id); setJersey(""); }
  }

  const nextFive = [...draftOn, ...draftIn];
  const balanced = nextFive.length === 5;
  const changed = (() => {
    if (!panel) return false;
    const key = nextFive.slice().sort().join(",");
    if (panel.mode === "edit") return key !== panel.shift.player_ids.slice().sort().join(",");
    // A new shift has to actually change something, or it just splits one
    // lineup's possessions across two identical rows. The very first shift
    // is exempt -- there's nothing carried forward for it to differ from.
    const carried = fiveBefore(panel.sequence);
    if (!carried.length) return nextFive.length === 5;
    return key !== carried.slice().sort().join(",");
  })();

  async function confirm() {
    if (!panel || !balanced) return;
    setBusy(true); setError(null);
    if (panel.mode === "new") {
      const { error: err, shift } = await createShift(gameId, panel.quarter, panel.sequence, nextFive, userId, side);
      if (err) { setError(err); setBusy(false); return; }
      if (shift) setShifts((s) => [...s, shift]);
    } else {
      const { error: err, shifts: next } = await updateShiftFive(panel.shift.id, nextFive, shifts);
      if (err) { setError(err); setBusy(false); return; }
      setShifts(next);
    }
    setBusy(false);
    closePanel();
  }

  async function removeShift(shift: Shift) {
    if (!window.confirm(`Remove the sub at #${shift.start_sequence}? Possessions after it fall back to the previous five.`)) return;
    const { error: err } = await deleteShift(shift.id);
    if (err) { setError(err); return; }
    setShifts((s) => s.filter((x) => x.id !== shift.id));
  }

  async function openCallUp() {
    try {
      setCandidates(await listCallUpCandidates(activeRoster || null));
      setCallUpOpen(true);
      setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load players."); }
  }

  async function toggleCallUp(playerId: string, currentlyUp: boolean) {
    const { error: err } = currentlyUp
      ? await removeCallUp(gameId, playerId)
      : await addCallUp(gameId, playerId, userId);
    if (err) { setError(err); return; }
    try { setPlayers(await listGamePlayers(activeRoster || null, gameId)); }
    catch (e: any) { setError(e?.message ?? "Couldn't reload players."); }
  }

  // Position comes from whichever panel is open -- foul trouble is recorded
  // at the moment you're already looking at, with the five in front of you.
  async function recordFoul(playerId: string, detail: FoulLevel) {
    if (!panel) return;
    const sequence = panel.mode === "new" ? panel.sequence : panel.shift.start_sequence;
    const quarter = panel.mode === "new" ? panel.quarter : panel.shift.quarter;
    const { error: err, event } = await addFoulTrouble(gameId, quarter, sequence, playerId, detail, userId);
    if (err) { setError(err); return; }
    if (event) setEvents((e) => [...e, event]);
  }

  async function removeFoul(id: string) {
    const { error: err } = await deleteLineupEvent(id);
    if (err) { setError(err); return; }
    setEvents((e) => e.filter((x) => x.id !== id));
  }

  // Nobody available is the normal offseason state: rosters exist but
  // players haven't been assigned to one yet, so a roster filter matches
  // nobody. Say so rather than rendering a blank bench.
  const rosterHint = players.length
    ? null
    : activeRoster
      ? "No players are assigned to this roster yet. Switch to \u201CAll players\u201D above, or assign them under Rosters."
      : "No players found. Players need the \u201Cplayer\u201D role to appear here.";

  if (loading) return <div className="card">Loading possessions…</div>;
  if (!possessions.length) {
    return <div className="card">No possessions tracked for this game yet — there's nothing to assign shifts to.</div>;
  }

  const assignedCount = assigned.size;
  const shiftIndex = new Map(sortedShifts.map((s, i) => [s.id, i]));

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>Shifts</span>
        {intrasquad && (
          <span style={{ display: "flex", gap: 4 }}>
            {sides.map((sd) => (
              <button
                key={sd}
                onClick={() => { setSide(sd); closePanel(); }}
                style={{
                  padding: "4px 10px", fontSize: 12, borderRadius: 999, cursor: "pointer",
                  border: "1px solid " + (side === sd ? "var(--accent, #3a5fd0)" : "var(--border)"),
                  background: side === sd ? "var(--accent, #3a5fd0)" : "var(--surface2)",
                  color: side === sd ? "#fff" : "var(--muted)",
                }}
              >
                {SIDE_LABEL[sd]}
              </button>
            ))}
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {sortedShifts.length} shift{sortedShifts.length === 1 ? "" : "s"} · {assignedCount} of {possessions.length} possessions assigned
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
          Roster
          <select
            value={activeRoster}
            onChange={(e) => changeRoster(e.target.value)}
            style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12 }}
          >
            <option value="">All players</option>
            {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: players.length ? "var(--muted)" : "#c9a227" }}>
          {players.length} player{players.length === 1 ? "" : "s"} available
        </span>
        <button onClick={() => (callUpOpen ? setCallUpOpen(false) : openCallUp())} style={iconBtn}>
          {callUpOpen ? "done" : "+ call up"}
        </button>
        {!sortedShifts.length && (
          <button
            onClick={() => openNew(possessions[0].sequence, possessions[0].quarter)}
            style={{ marginLeft: "auto", padding: "6px 12px", fontSize: 13, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer" }}
          >
            Set starting five
          </button>
        )}
      </div>

      {problems.length > 0 && (
        <div style={{ background: "#2a1f10", border: "1px solid #7a5a20", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
          {problems.map((p, i) => (
            <div key={i} style={{ fontSize: 12, color: "#e0b464" }}>⚠ {p}</div>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: "#c66", marginBottom: 8 }}>{error}</div>}

      {callUpOpen && (
        <div style={{ background: "var(--surface2)", border: "1px solid #7a5a20", borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#e0b464", marginBottom: 8 }}>
            Call up for this game only — tap to add or remove. A permanent move belongs in Players &amp; coaches instead.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {candidates.map((c) => {
              const up = players.some((p) => p.id === c.id);
              return (
                <span
                  key={c.id}
                  onClick={() => toggleCallUp(c.id, up)}
                  style={{
                    fontSize: 13, padding: "5px 9px", borderRadius: 6, cursor: "pointer",
                    background: up ? "#2a1f10" : "var(--surface)",
                    border: `1px solid ${up ? "#7a5a20" : "var(--border)"}`,
                    color: up ? "#e0b464" : "var(--muted)",
                  }}
                >
                  {c.jersey != null ? `${c.jersey} ${c.name}` : c.name}
                  <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 5 }}>{c.fromRoster}</span>
                  {up && <span style={{ marginLeft: 5 }}>✓</span>}
                </span>
              );
            })}
            {!candidates.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>Everyone is already on this roster.</span>}
          </div>
        </div>
      )}

      <div>
        {possessions.map((p, i) => {
          const shift = sortedShifts.find((s) => s.start_sequence === p.sequence);
          const prev = i > 0 ? possessions[i - 1] : null;
          const newPeriod = !prev || prev.quarter !== p.quarter;
          const covering = assigned.get(p.id);
          const bandIdx = covering != null ? (shiftIndex.get(covering) ?? 0) % 4 : 0;
          const foulsHere = events.filter((e) => e.sequence === p.sequence);

          return (
            <div key={p.id}>
              {newPeriod && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 6px" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{periodLabel(format, p.quarter)}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>
              )}

              {shift && (
                <ShiftBand
                  shift={shift}
                  color={BAND_BG[(shiftIndex.get(shift.id) ?? 0) % 4]}
                  line={BAND_LINE[(shiftIndex.get(shift.id) ?? 0) % 4]}
                  labelFor={label}
                  onEdit={() => openEdit(shift)}
                  onRemove={sortedShifts[0]?.id === shift.id ? undefined : () => removeShift(shift)}
                />
              )}

              {panel?.mode === "new" && panel.sequence === p.sequence && !shift && (
                <SubPanel
                  title={`Sub before #${p.sequence}`}
                  players={players} labelFor={label}
                  on={draftOn} inList={draftIn} outList={draftOut}
                  jersey={jersey} setJersey={setJersey} onJerseyKey={onJerseyKey}
                  onToggle={toggle} onConfirm={confirm} onCancel={closePanel}
                  balanced={balanced} changed={changed} busy={busy} count={nextFive.length}
                  rosterHint={rosterHint}
                  onFoul={recordFoul}
                  unavailable={unavailable}
                  otherSideLabel={intrasquad ? SIDE_LABEL[side === "us" ? "opponent" : "us"] : null}
                />
              )}
              {panel?.mode === "edit" && panel.shift.start_sequence === p.sequence && (
                <SubPanel
                  title={`Edit the five from #${p.sequence}`}
                  players={players} labelFor={label}
                  on={draftOn} inList={draftIn} outList={draftOut}
                  jersey={jersey} setJersey={setJersey} onJerseyKey={onJerseyKey}
                  onToggle={toggle} onConfirm={confirm} onCancel={closePanel}
                  balanced={balanced} changed={changed} busy={busy} count={nextFive.length}
                  rosterHint={rosterHint}
                  onFoul={recordFoul}
                  unavailable={unavailable}
                  otherSideLabel={intrasquad ? SIDE_LABEL[side === "us" ? "opponent" : "us"] : null}
                />
              )}

              <div
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", fontSize: 13,
                  borderLeft: `3px solid ${covering ? BAND_LINE[bandIdx] : "transparent"}`,
                  background: covering ? BAND_BG[bandIdx] : "transparent",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)", width: 34 }}>#{p.sequence}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", width: 56 }}>{p.team === "us" ? "Offense" : "Defense"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{describePossession(p)}</span>
                <span style={{ width: 18, textAlign: "right" }}>{p.points ?? 0}</span>
                <button
                  onClick={() => (shift ? openEdit(shift) : openNew(p.sequence, p.quarter))}
                  title={shift ? "Edit this five" : "Sub before this possession"}
                  style={iconBtn}
                >
                  ⇄
                </button>
              </div>

              {foulsHere.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px 4px 47px", fontSize: 12, color: "#e0b464" }}>
                  <span>⚠ {label(e.player_id)} — {e.detail} foul</span>
                  <button onClick={() => removeFoul(e.id)} style={{ ...iconBtn, color: "var(--muted)" }}>✕</button>
                </div>
              ))}

            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function ShiftBand({ shift, color, line, labelFor, onEdit, onRemove }: {
  shift: Shift; color: string; line: string;
  labelFor: (id: string) => string;
  onEdit: () => void; onRemove?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: color, borderLeft: `3px solid ${line}`, marginTop: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: line, fontWeight: 500 }}>From #{shift.start_sequence}</span>
      <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 0 }}>
        {shift.player_ids.map(labelFor).join(" · ")}
      </span>
      <button onClick={onEdit} style={iconBtn}>edit</button>
      {onRemove && <button onClick={onRemove} style={iconBtn}>remove</button>}
    </div>
  );
}

function SubPanel(props: {
  title: string;
  players: LineupPlayer[];
  labelFor: (id: string) => string;
  on: string[]; inList: string[]; outList: string[];
  jersey: string; setJersey: (s: string) => void;
  onJerseyKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onToggle: (id: string) => void;
  onConfirm: () => void; onCancel: () => void;
  balanced: boolean; changed: boolean; busy: boolean; count: number;
  rosterHint: string | null;
  onFoul: (playerId: string, detail: FoulLevel) => void;
  /** Players on the other squad right now — shown but not selectable. */
  unavailable: string[];
  otherSideLabel: string | null;
}) {
  // Which on-floor player is having a foul recorded. Local to the panel --
  // it's a two-tap flourish (who, then which foul), not app state.
  const [foulPlayer, setFoulPlayer] = useState<string | null>(null);
  const { players, labelFor, on, inList, outList, jersey, setJersey, onJerseyKey, onToggle } = props;
  const bench = players.filter((p) => !on.includes(p.id) && !inList.includes(p.id) && !outList.includes(p.id) && !props.unavailable.includes(p.id));
  const taken = players.filter((p) => props.unavailable.includes(p.id) && !on.includes(p.id));
  const anyJerseys = players.some((p) => p.jersey != null);

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--accent, #3a5fd0)", borderRadius: 8, padding: 12, margin: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text)" }}>{props.title}</span>
        {anyJerseys && (
          <>
            <input
              value={jersey}
              onChange={(e) => setJersey(e.target.value.replace(/\D/g, ""))}
              onKeyDown={onJerseyKey}
              placeholder="#"
              inputMode="numeric"
              autoFocus
              style={{ width: 56, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }}
            />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>type a number, Enter to move</span>
          </>
        )}
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
        On floor <span style={{ opacity: 0.7 }}>— tap a name to sub, ⚠ to log foul trouble</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {on.map((id) => (
          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <Chip label={labelFor(id)} kind="on" match={jersey} onClick={() => onToggle(id)} />
            <span
              onClick={() => setFoulPlayer(foulPlayer === id ? null : id)}
              title="Foul trouble"
              style={{ cursor: "pointer", fontSize: 12, padding: "4px 5px", color: foulPlayer === id ? "#e0b464" : "var(--muted)" }}
            >
              ⚠
            </span>
          </span>
        ))}
        {outList.map((id) => <Chip key={id} label={labelFor(id)} kind="out" match={jersey} onClick={() => onToggle(id)} />)}
        {!on.length && !outList.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>nobody yet — tap five from the bench</span>}
      </div>

      {foulPlayer && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10, padding: "8px 10px", background: "#2a1f10", border: "1px solid #7a5a20", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "#e0b464" }}>Which foul for {labelFor(foulPlayer)}?</span>
          {FOUL_LEVELS.map((f) => (
            <span
              key={f}
              onClick={() => { props.onFoul(foulPlayer, f); setFoulPlayer(null); }}
              style={{ fontSize: 13, padding: "4px 10px", borderRadius: 6, background: "var(--surface)", border: "1px solid var(--border)", cursor: "pointer" }}
            >
              {f}
            </span>
          ))}
          <span onClick={() => setFoulPlayer(null)} style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer", marginLeft: 4 }}>cancel</span>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Bench</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {props.rosterHint && !bench.length && !inList.length && (
          <span style={{ fontSize: 12, color: "#c9a227" }}>{props.rosterHint}</span>
        )}
        {inList.map((id) => <Chip key={id} label={labelFor(id)} kind="in" match={jersey} onClick={() => onToggle(id)} />)}
        {bench.map((p) => (
          <Chip
            key={p.id}
            label={p.jersey != null ? `${p.jersey} ${p.name}` : p.name}
            kind={p.called_up ? "callup" : "bench"}
            match={jersey}
            onClick={() => onToggle(p.id)}
          />
        ))}
      </div>

      {taken.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>On {props.otherSideLabel} right now</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {taken.map((p) => (
              <span key={p.id} style={{ fontSize: 13, padding: "5px 9px", borderRadius: 6, background: "var(--surface)", border: "1px dashed var(--border)", color: "var(--muted)", opacity: 0.6 }}>
                {p.jersey != null ? `${p.jersey} ${p.name}` : p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={props.onConfirm}
          disabled={!props.balanced || !props.changed || props.busy}
          className="btn-primary"
          style={{ width: "auto", padding: "7px 14px", fontSize: 13, opacity: props.balanced && props.changed && !props.busy ? 1 : 0.45 }}
        >
          {props.busy ? "Saving…" : "Confirm"}
        </button>
        <button onClick={props.onCancel} style={{ padding: "7px 12px", fontSize: 13, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", cursor: "pointer" }}>
          Cancel
        </button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {props.count === 5 ? (props.changed ? "Ready" : "No change yet") : props.count < 5 ? `Add ${5 - props.count} more` : `Take ${props.count - 5} off`}
        </span>
      </div>
    </div>
  );
}

function Chip({ label, kind, match, onClick }: {
  label: string; kind: "on" | "out" | "in" | "bench" | "callup"; match: string; onClick: () => void;
}) {
  const base: React.CSSProperties = {
    fontSize: 13, padding: "5px 9px", borderRadius: 6, cursor: "pointer", userSelect: "none",
    border: "1px solid transparent",
  };
  const styles: Record<string, React.CSSProperties> = {
    on: { background: "#16305c", color: "#cfe0ff" },
    out: { background: "#3a1a1a", color: "#e2a0a0", textDecoration: "line-through" },
    in: { background: "#1c3a18", color: "#bfe6ac" },
    bench: { background: "var(--surface)", borderColor: "var(--border)", color: "var(--muted)" },
    callup: { background: "var(--surface)", borderColor: "#7a5a20", color: "#e0b464" },
  };
  // Highlight while a jersey number is being typed, so the keyboard path
  // and the tapping path point at the same chip.
  const hit = match !== "" && label.split(" ")[0].startsWith(match);
  return (
    <span onClick={onClick} style={{ ...base, ...styles[kind], outline: hit ? "2px solid #6f8fe0" : undefined }}>
      {label}
    </span>
  );
}

const iconBtn: React.CSSProperties = {
  padding: "3px 8px", fontSize: 12, borderRadius: 5,
  border: "1px solid var(--border)", background: "var(--surface2)",
  color: "var(--muted)", cursor: "pointer",
};
