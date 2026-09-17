// src/components/game-stats/PossessionEditor.tsx
// Film-review tool: the only way to correct a game's tracked possessions,
// and only reachable once a game is finished (tracking is locked at that
// point -- see GameStatsHub's "Reopen for tracking" if that happened too
// early).
//
// Shows every possession for this game merged from TWO sources: whatever
// made it to Supabase, plus anything still stuck in this device's local
// offline queue for this game (which the report/normal queries never see,
// since they only read from Supabase). A queued copy always wins over a
// synced copy with the same id, since the queued one is the newer,
// not-yet-confirmed edit. A small red ⚠ marks anything still queued, with
// the real sync error underneath if it's actually failed rather than just
// pending.
//
// Saving an edit doesn't distinguish between "this was already synced" and
// "this was stuck in the queue" -- every save goes through queuePossession,
// which writes it locally first (instant, offline-safe) and then attempts
// to sync it immediately. Since possessions are upserted by id, that sync
// attempt naturally updates the existing Supabase row if there is one, or
// inserts a fresh one if there isn't. If the attempt fails, the corrected
// version just stays queued (replacing whatever was queued before) and
// tries again on the next sync trigger -- so editing a broken record is
// also how you retry it, with the fix already baked in.
//
// Looks (migration 134): a trip tracked with looks is edited look by look
// -- trip-wide fields on top, then one row per look -- and every edit is
// written back through summarizeLooks, so the rebound, missed-shot and
// free-throw counts, the possession type and the points are all worked
// out from the looks rather than typed. Trips tracked before looks
// existed keep the original card, where those counts are edited by hand:
// the detail of their earlier looks was never saved, so rebuilding them
// from looks would wipe the counts.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import NumberField from "./NumberField";
import {
  queuePossession,
  getQueuedPossessions,
  removeFromQueue,
  getLastSyncErrors,
  syncQueue,
  periodLabel,
  periodNoun,
  DEFAULT_GAME_FORMAT,
  type GameFormat,
  type Possession,
  type PlayCall,
  type Team,
  type PossessionType,
  type HalfCourtType,
  type OobResult,
  type OobDefense,
  type PressBreakResult,
  type FtAwardType,
  type Outcome,
  type ShotQuality,
  type TurnoverType,
  type Look,
  type LookEnd,
  type DefenseScheme,
  type PressResult,
  emptyLook,
  summarizeLooks,
  LOOK_END_LABELS,
} from "../../lib/gameStats";

interface Props {
  gameId: string;
  opponent: string;
  /** Period structure, so the filters read H1/H2 or S1/S2 rather than always Q1/Q2. Optional so any older call site still works. */
  format?: GameFormat;
}

const TEAMS: Team[] = ["us", "opponent"];
const POSSESSION_TYPES: PossessionType[] = ["transition", "half_court", "blob", "slob", "press", "press_break", "non_possession_ft"];
const HALF_COURT_TYPES: HalfCourtType[] = ["set", "motion", "unscripted", "zone"];
const HALF_COURT_LABELS: Record<HalfCourtType, string> = { set: "man set", motion: "motion", unscripted: "unscripted", zone: "zone set" };
const OOB_RESULTS: OobResult[] = ["direct_shot", "flowed_half_court", "turnover"];
const OOB_DEFENSES: OobDefense[] = ["man", "zone"];
const PRESS_BREAK_RESULTS: PressBreakResult[] = ["transition", "half_court", "turnover", "oob", "ft_trip"];
const FT_AWARD_TYPES: FtAwardType[] = ["eog", "technical", "flagrant"];
const OUTCOMES: Outcome[] = ["fg_made", "fg_missed", "turnover", "ft_trip"];
const QUALITIES: ShotQuality[] = ["great", "good", "live", "tough"];
const TURNOVER_TYPES: TurnoverType[] = ["live", "dead", "charge"];
const TURNOVER_TYPE_LABELS: Record<TurnoverType, string> = { live: "live", dead: "dead", charge: "charge / offensive foul" };

export default function PossessionEditor({ gameId, opponent, format = DEFAULT_GAME_FORMAT }: Props) {
  const [possessions, setPossessions] = useState<Possession[]>([]);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [syncErrors, setSyncErrors] = useState<{ id: string; message: string }[]>([]);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [quarterFilter, setQuarterFilter] = useState<number | "all">("all");
  const [teamFilter, setTeamFilter] = useState<Team | "all">("all");

  useEffect(() => { load(); }, [gameId]);

  async function load() {
    setLoading(true);
    const [{ data: syncedData }, { data: playRows }, queued] = await Promise.all([
      supabase.from("possessions").select("*").eq("game_id", gameId),
      supabase.from("play_calls").select("*").eq("status", "active"),
      getQueuedPossessions(),
    ]);
    const synced = (syncedData as Possession[]) ?? [];
    const queuedForGame = queued.filter((p) => p.game_id === gameId);

    // Merge -- a queued copy (newer, not-yet-confirmed) wins over a synced
    // copy with the same id.
    const byId = new Map(synced.map((p) => [p.id, p]));
    queuedForGame.forEach((p) => byId.set(p.id, p));
    const merged = Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);

    setPossessions(merged);
    setQueuedIds(new Set(queuedForGame.map((p) => p.id)));
    setSyncErrors(getLastSyncErrors());
    setPlayCalls((playRows as PlayCall[]) ?? []);
    setLoading(false);
  }

  async function save(p: Possession, patch: Partial<Possession>) {
    setSavingId(p.id);
    const updated = { ...p, ...patch };
    setPossessions((list) => list.map((x) => (x.id === p.id ? updated : x)));
    await queuePossession(updated); // writes locally, then attempts to sync immediately (upsert by id)
    await load(); // refreshes queued/error state to reflect whether that attempt actually landed
    setSavingId(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this possession? This can't be undone.")) return;
    await supabase.from("possessions").delete().eq("id", id); // harmless no-op if it was never actually synced
    await removeFromQueue(id);
    setPossessions((list) => list.filter((x) => x.id !== id));
  }

  async function retrySync() {
    await syncQueue();
    await load();
  }

  const quartersPresent = useMemo(() => Array.from(new Set(possessions.map((p) => p.quarter))).sort((a, b) => a - b), [possessions]);

  const filtered = possessions.filter((p) => {
    if (quarterFilter !== "all" && p.quarter !== quarterFilter) return false;
    if (teamFilter !== "all" && p.team !== teamFilter) return false;
    return true;
  });

  if (loading) return <div className="card">Loading possessions…</div>;

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Editing possessions · vs {opponent}
          {queuedIds.size > 0 && <span style={{ color: "#c2402f" }}> · {queuedIds.size} unsynced</span>}
        </div>
        {queuedIds.size > 0 && (
          <button style={actionBtn} onClick={retrySync}>Retry sync</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setQuarterFilter("all")} style={pillStyle(quarterFilter === "all")}>All {periodNoun(format, true)}</button>
        {quartersPresent.map((q) => (
          <button key={q} onClick={() => setQuarterFilter(q)} style={pillStyle(quarterFilter === q)}>{periodLabel(format, q)}</button>
        ))}
        <span style={{ width: 12 }} />
        <button onClick={() => setTeamFilter("all")} style={pillStyle(teamFilter === "all")}>Both teams</button>
        <button onClick={() => setTeamFilter("us")} style={pillStyle(teamFilter === "us")}>Us</button>
        <button onClick={() => setTeamFilter("opponent")} style={pillStyle(teamFilter === "opponent")}>Opponent</button>
      </div>

      {filtered.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No possessions in this filter.</div>}

      {filtered.map((p) => {
        const isQueued = queuedIds.has(p.id);
        const err = syncErrors.find((e) => e.id === p.id)?.message;
        // Structure names double as play-call categories, except
        // "unscripted", which deliberately has no play list.
        const relevantPlayCalls = playCalls.filter((pc) =>
          p.possession_type === "blob" || p.possession_type === "slob"
            ? pc.category === p.possession_type
            : p.half_court_type && p.half_court_type !== "unscripted"
            ? pc.category === p.half_court_type
            : false
        );
        const pressTypes = playCalls.filter((pc) => pc.category === "press_type");

        if (p.looks && p.looks.length) {
          return (
            <LooksCard
              key={p.id}
              p={p}
              format={format}
              playCalls={playCalls}
              isQueued={isQueued}
              err={err}
              saving={savingId === p.id}
              onSave={(patch) => save(p, patch)}
              onDelete={() => remove(p.id)}
            />
          );
        }

        return (
          <div key={p.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{periodLabel(format, p.quarter)} · #{p.sequence}</span>
                {isQueued && (
                  <span style={{ fontSize: 12, color: "#c2402f" }} title={err ?? "Not yet synced"}>
                    ⚠ {err ? "sync failed" : "unsynced"}
                  </span>
                )}
                {savingId === p.id && <span style={{ fontSize: 11, color: "var(--muted)" }}>saving…</span>}
              </div>
              <button style={{ ...actionBtn, background: "transparent", color: "#8a2f2f" }} onClick={() => remove(p.id)}>Delete</button>
            </div>
            {err && isQueued && <div style={{ fontSize: 11, color: "#c2402f", marginBottom: 8 }}>{err}</div>}
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Tracked before looks were recorded -- counts are edited by hand.</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
              <Field label="Team">
                <select value={p.team} onChange={(e) => save(p, { team: e.target.value as Team })} style={selectStyle}>
                  {TEAMS.map((t) => <option key={t} value={t}>{t === "us" ? "Us" : "Opponent"}</option>)}
                </select>
              </Field>

              <Field label="Quarter">
                <NumberField value={p.quarter} min={1} max={12} commitOn="blur" onChange={(n) => save(p, { quarter: n })} style={selectStyle} />
              </Field>

              <Field label="Possession type">
                <select value={p.possession_type} onChange={(e) => save(p, { possession_type: e.target.value as PossessionType })} style={selectStyle}>
                  {POSSESSION_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
              </Field>

              {(p.possession_type === "half_court" || p.half_court_type) && (
                <Field label="Half-court type">
                  <select value={p.half_court_type ?? ""} onChange={(e) => save(p, { half_court_type: (e.target.value || null) as HalfCourtType | null })} style={selectStyle}>
                    <option value="">—</option>
                    {HALF_COURT_TYPES.map((t) => <option key={t} value={t}>{HALF_COURT_LABELS[t]}</option>)}
                  </select>
                </Field>
              )}

              {(p.possession_type === "blob" || p.possession_type === "slob" || p.half_court_type) && (
                <Field label="Play call">
                  <select value={p.play_call_id ?? ""} onChange={(e) => save(p, { play_call_id: e.target.value || null })} style={selectStyle}>
                    <option value="">—</option>
                    {relevantPlayCalls.map((pc) => <option key={pc.id} value={pc.id}>{pc.name}</option>)}
                  </select>
                </Field>
              )}

              {(p.possession_type === "blob" || p.possession_type === "slob") && (
                <Field label="OOB result">
                  <select value={p.oob_result ?? ""} onChange={(e) => save(p, { oob_result: (e.target.value || null) as OobResult | null })} style={selectStyle}>
                    <option value="">—</option>
                    {OOB_RESULTS.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                  </select>
                </Field>
              )}

              {/* This is the field the report's "18 of 22 tagged" count points at. */}
              {(p.possession_type === "blob" || p.possession_type === "slob") && p.team === "us" && (
                <Field label="Defense on inbounds">
                  <select value={p.oob_defense ?? ""} onChange={(e) => save(p, { oob_defense: (e.target.value || null) as OobDefense | null })} style={selectStyle}>
                    <option value="">— untagged</option>
                    {OOB_DEFENSES.map((d) => <option key={d} value={d}>vs {d}</option>)}
                  </select>
                </Field>
              )}

              {/* Shown for any trip that already carries a press type, not just
                  one still typed press_break -- a broken press becomes
                  transition or half court, and this is how it stays editable. */}
              {(p.possession_type === "press_break" || p.press_break_type_id) && (
                <>
                  <Field label="Press faced">
                    <select value={p.press_break_type_id ?? ""} onChange={(e) => save(p, { press_break_type_id: e.target.value || null })} style={selectStyle}>
                      <option value="">—</option>
                      {pressTypes.map((pc) => <option key={pc.id} value={pc.id}>{pc.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Press break result">
                    <select value={p.press_break_result ?? ""} onChange={(e) => save(p, { press_break_result: (e.target.value || null) as PressBreakResult | null })} style={selectStyle}>
                      <option value="">—</option>
                      {PRESS_BREAK_RESULTS.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                    </select>
                  </Field>
                </>
              )}

              {(p.possession_type === "non_possession_ft" || p.ft_award_type) && (
                <Field label="FTs awarded for">
                  <select value={p.ft_award_type ?? ""} onChange={(e) => save(p, { ft_award_type: (e.target.value || null) as FtAwardType | null })} style={selectStyle}>
                    <option value="">—</option>
                    {FT_AWARD_TYPES.map((t) => <option key={t} value={t}>{t === "eog" ? "end of game" : t}</option>)}
                  </select>
                </Field>
              )}

              <Field label="Paint touch">
                <label style={checkboxLabelStyle}>
                  <input type="checkbox" checked={p.paint_touch} onChange={(e) => save(p, { paint_touch: e.target.checked })} /> touched
                </label>
              </Field>

              <Field label="Both sides">
                <label style={checkboxLabelStyle}>
                  <input type="checkbox" checked={p.paint_touch_both_sides} onChange={(e) => save(p, { paint_touch_both_sides: e.target.checked })} /> both sides
                </label>
              </Field>

              <Field label="OREB count">
                <NumberField value={p.oreb_count} min={0} max={20} commitOn="blur" onChange={(n) => save(p, { oreb_count: n })} style={selectStyle} />
              </Field>

              <Field label="Missed FG count">
                <NumberField value={p.missed_fg_count} min={0} max={20} commitOn="blur" onChange={(n) => save(p, { missed_fg_count: n })} style={selectStyle} />
              </Field>

              <Field label="Absorbed FT attempts">
                <NumberField value={p.absorbed_ft_attempts} min={0} max={20} commitOn="blur" onChange={(n) => save(p, { absorbed_ft_attempts: n })} style={selectStyle} />
              </Field>

              <Field label="Absorbed FT made">
                <NumberField value={p.absorbed_ft_made} min={0} max={20} commitOn="blur" onChange={(n) => save(p, { absorbed_ft_made: n })} style={selectStyle} />
              </Field>

              <Field label="Outcome">
                <select value={p.outcome} onChange={(e) => save(p, { outcome: e.target.value as Outcome })} style={selectStyle}>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                </select>
              </Field>

              {(p.outcome === "fg_made" || p.outcome === "fg_missed") && (
                <>
                  <Field label="Shot type">
                    <select value={p.shot_type ?? ""} onChange={(e) => save(p, { shot_type: e.target.value ? (Number(e.target.value) as 2 | 3) : null })} style={selectStyle}>
                      <option value="">—</option>
                      <option value="2">2pt</option>
                      <option value="3">3pt</option>
                    </select>
                  </Field>
                  <Field label="Shot quality">
                    <select value={p.shot_quality ?? ""} onChange={(e) => save(p, { shot_quality: (e.target.value || null) as ShotQuality | null })} style={selectStyle}>
                      <option value="">—</option>
                      {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                    </select>
                  </Field>
                </>
              )}

              {p.outcome === "turnover" && (
                <Field label="Turnover type">
                  <select value={p.turnover_type ?? ""} onChange={(e) => save(p, { turnover_type: (e.target.value || null) as TurnoverType | null })} style={selectStyle}>
                    <option value="">—</option>
                    {TURNOVER_TYPES.map((t) => <option key={t} value={t}>{TURNOVER_TYPE_LABELS[t]}</option>)}
                  </select>
                </Field>
              )}

              {p.outcome === "ft_trip" && (
                <Field label="FT attempts">
                  <select value={p.ft_attempts ?? ""} onChange={(e) => save(p, { ft_attempts: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null })} style={selectStyle}>
                    <option value="">—</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </Field>
              )}

              <Field label="Points">
                <NumberField value={p.points} min={0} max={3} commitOn="blur" onChange={(n) => save(p, { points: n })} style={selectStyle} />
              </Field>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Looks editor ────────────────────────────────────────────────

const LOOK_TYPES: PossessionType[] = ["transition", "half_court", "blob", "slob", "press_break", "press"];
const LOOK_TYPE_LABELS: Record<PossessionType, string> = {
  transition: "Transition",
  half_court: "Half court",
  blob: "BLOB",
  slob: "SLOB",
  press_break: "Press break",
  press: "Press (our D)",
  non_possession_ft: "Awarded FTs",
};
const DEFENSE_SCHEMES: DefenseScheme[] = ["man", "zone"];
const PRESS_RESULTS: PressResult[] = ["turnover", "man", "zone", "transition", "oob", "ft_trip"];

/** How an earlier (non-final) look ended, as one pickable value. */
type EarlierResult = "miss2" | "miss3" | "missft" | "flowed" | "broke_press" | "reset";
const EARLIER_RESULTS: { value: EarlierResult; label: string }[] = [
  { value: "miss2", label: "Missed 2, rebounded" },
  { value: "miss3", label: "Missed 3, rebounded" },
  { value: "missft", label: "Missed FT, rebounded" },
  { value: "flowed", label: "Flowed" },
  { value: "broke_press", label: "Broke the press" },
  { value: "reset", label: "Reset (foul/jump/OOB)" },
];

function earlierResultOf(l: Look): EarlierResult {
  if (l.end === "rebounded") return l.outcome === "ft_trip" ? "missft" : l.shot_type === 3 ? "miss3" : "miss2";
  return l.end as EarlierResult;
}

/** Points a look scored, from its result -- never typed, so it can't disagree with the result. */
function lookPoints(l: Look): number {
  if (l.outcome === "fg_made") return (l.shot_type ?? 2) + (l.ft_made ?? 0);
  if (l.outcome === "ft_trip") return l.ft_made ?? 0;
  return 0;
}

function applyEarlierResult(l: Look, r: EarlierResult): Look {
  const cleared: Look = {
    ...l, outcome: null, shot_type: null, shot_quality: null, turnover_type: null,
    ft_attempts: null, ft_made: null,
  };
  if (r === "miss2" || r === "miss3") {
    return { ...cleared, end: "rebounded", outcome: "fg_missed", shot_type: r === "miss3" ? 3 : 2, shot_quality: l.shot_quality };
  }
  if (r === "missft") {
    return { ...cleared, end: "rebounded", outcome: "ft_trip", ft_attempts: l.ft_attempts ?? 2, ft_made: l.ft_made ?? 0, shot_quality: "great" };
  }
  return { ...cleared, end: r as LookEnd };
}

function LooksCard({
  p, format, playCalls, isQueued, err, saving, onSave, onDelete,
}: {
  p: Possession;
  format: GameFormat;
  playCalls: PlayCall[];
  isQueued: boolean;
  err?: string;
  saving: boolean;
  onSave: (patch: Partial<Possession>) => void;
  onDelete: () => void;
}) {
  const looks = p.looks ?? [];
  const pressTypes = playCalls.filter((pc) => pc.category === "press_type");

  function write(next: Look[]) {
    const withPoints = next.map((l) => ({ ...l, points: lookPoints(l) }));
    onSave(summarizeLooks(withPoints));
  }

  function updateLook(i: number, patch: Partial<Look>) {
    write(looks.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function changeType(i: number, type: PossessionType) {
    // Anything that only belonged to the old type goes; the result stays.
    updateLook(i, {
      type, half_court_type: null, play_call_id: null, paint_touch: false, paint_touch_both_sides: false,
      press_result: null, press_break_type_id: null, press_break_result: null, oob_result: null, oob_defense: null,
    });
  }

  function removeLook(i: number) {
    if (!window.confirm("Remove this look?")) return;
    write(looks.filter((_, j) => j !== i));
  }

  function addEarlierLook() {
    // The common fix is a rebound that wasn't tapped live: a missed 2 of
    // the same type as the look that followed it.
    const final = looks[looks.length - 1];
    const added: Look = { ...emptyLook(final.type === "non_possession_ft" ? "half_court" : final.type), end: "rebounded", outcome: "fg_missed", shot_type: 2, defense_scheme: final.defense_scheme };
    write([...looks.slice(0, -1), added, final]);
  }

  const summaryBits = [
    p.oreb_count ? `${p.oreb_count} offensive rebound${p.oreb_count === 1 ? "" : "s"}` : null,
    p.missed_fg_count ? `${p.missed_fg_count} rebounded miss${p.missed_fg_count === 1 ? "" : "es"}` : null,
    p.absorbed_ft_attempts ? `${p.absorbed_ft_made}/${p.absorbed_ft_attempts} other FTs` : null,
  ].filter(Boolean);

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{periodLabel(format, p.quarter)} · #{p.sequence}</span>
          {isQueued && (
            <span style={{ fontSize: 12, color: "#c2402f" }} title={err ?? "Not yet synced"}>
              ⚠ {err ? "sync failed" : "unsynced"}
            </span>
          )}
          {saving && <span style={{ fontSize: 11, color: "var(--muted)" }}>saving…</span>}
        </div>
        <button style={{ ...actionBtn, background: "transparent", color: "#8a2f2f" }} onClick={onDelete}>Delete</button>
      </div>
      {err && isQueued && <div style={{ fontSize: 11, color: "#c2402f", marginBottom: 8 }}>{err}</div>}

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Trip</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        <Field label="Team">
          <select value={p.team} onChange={(e) => onSave({ team: e.target.value as Team })} style={selectStyle}>
            {TEAMS.map((t) => <option key={t} value={t}>{t === "us" ? "Us" : "Opponent"}</option>)}
          </select>
        </Field>
        <Field label={periodNoun(format)}>
          <NumberField value={p.quarter} min={1} max={12} commitOn="blur" onChange={(n) => onSave({ quarter: n })} style={selectStyle} />
        </Field>
        <Field label="Counts as">
          <div style={readOnlyStyle}>{LOOK_TYPE_LABELS[p.possession_type]}</div>
        </Field>
        <Field label="Points">
          <div style={readOnlyStyle}>{p.points}</div>
        </Field>
        {(looks[0].type === "non_possession_ft" || p.ft_award_type) && (
          <Field label="FTs awarded for">
            <select value={p.ft_award_type ?? ""} onChange={(e) => onSave({ ft_award_type: (e.target.value || null) as FtAwardType | null })} style={selectStyle}>
              <option value="">—</option>
              {FT_AWARD_TYPES.map((t) => <option key={t} value={t}>{t === "eog" ? "end of game" : t}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Counts as, points{summaryBits.length ? " and the counts here" : ""} come from the looks below{summaryBits.length ? ` · ${summaryBits.join(" · ")}` : ""}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Looks</div>
        <button style={actionBtn} onClick={addEarlierLook}>+ Add look before final</button>
      </div>

      {looks.map((l, i) => {
        const isFinal = i === looks.length - 1;
        const isAwarded = l.type === "non_possession_ft";
        const structureCategory = l.half_court_type && l.half_court_type !== "unscripted" ? l.half_court_type : null;
        const callList =
          l.type === "blob" || l.type === "slob" ? playCalls.filter((pc) => pc.category === l.type)
          : structureCategory ? playCalls.filter((pc) => pc.category === structureCategory)
          : [];
        const showCall = !l.putback && p.team === "us" && callList.length > 0 && (l.type === "blob" || l.type === "slob" || !!structureCategory);
        const isShot = l.outcome === "fg_made" || l.outcome === "fg_missed";
        const tag =
          isFinal ? { text: "Final", bg: "rgba(31,122,77,0.18)", fg: "#1f7a4d" }
          : l.end === "rebounded" ? { text: LOOK_END_LABELS.rebounded, bg: "rgba(138,101,18,0.18)", fg: "#8a6512" }
          : { text: LOOK_END_LABELS[l.end], bg: "rgba(37,80,212,0.15)", fg: "var(--royal-light)" };

        return (
          <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Look {i + 1}</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: tag.bg, color: tag.fg }}>{tag.text}</span>
                {l.putback && <span style={{ fontSize: 11, color: "var(--muted)" }}>putback</span>}
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{l.points} pts</span>
              </div>
              {!isFinal && (
                <button style={{ ...actionBtn, background: "transparent", color: "#8a2f2f", padding: "4px 8px" }} onClick={() => removeLook(i)} title="Remove look">
                  Remove
                </button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
              <Field label="Type">
                {isAwarded ? (
                  <div style={readOnlyStyle}>{LOOK_TYPE_LABELS[l.type]}</div>
                ) : (
                  <select value={l.type} onChange={(e) => changeType(i, e.target.value as PossessionType)} style={selectStyle}>
                    {LOOK_TYPES.map((t) => <option key={t} value={t}>{LOOK_TYPE_LABELS[t]}</option>)}
                  </select>
                )}
              </Field>

              {i > 0 && !isAwarded && (
                <Field label="Putback">
                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={l.putback}
                      onChange={(e) => updateLook(i, e.target.checked
                        ? { putback: true, half_court_type: null, play_call_id: null, paint_touch: false, paint_touch_both_sides: false }
                        : { putback: false })}
                    /> straight off the rebound
                  </label>
                </Field>
              )}

              {l.type === "half_court" && !l.putback && p.team === "us" && (
                <Field label="Structure">
                  <select
                    value={l.half_court_type ?? ""}
                    onChange={(e) => updateLook(i, { half_court_type: (e.target.value || null) as HalfCourtType | null, play_call_id: null })}
                    style={selectStyle}
                  >
                    <option value="">—</option>
                    {HALF_COURT_TYPES.map((t) => <option key={t} value={t}>{HALF_COURT_LABELS[t]}</option>)}
                  </select>
                </Field>
              )}

              {(l.type === "half_court" || l.type === "transition") && p.team === "opponent" && (
                <Field label="Our defense">
                  <select value={l.defense_scheme ?? ""} onChange={(e) => updateLook(i, { defense_scheme: (e.target.value || null) as DefenseScheme | null })} style={selectStyle}>
                    <option value="">—</option>
                    {DEFENSE_SCHEMES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              )}

              {showCall && (
                <Field label="Play call">
                  <select value={l.play_call_id ?? ""} onChange={(e) => updateLook(i, { play_call_id: e.target.value || null })} style={selectStyle}>
                    <option value="">—</option>
                    {callList.map((pc) => <option key={pc.id} value={pc.id}>{pc.name}</option>)}
                  </select>
                </Field>
              )}

              {l.type === "half_court" && !l.putback && (
                <>
                  <Field label="Paint touch">
                    <label style={checkboxLabelStyle}>
                      <input type="checkbox" checked={l.paint_touch} onChange={(e) => updateLook(i, { paint_touch: e.target.checked })} /> touched
                    </label>
                  </Field>
                  <Field label="Both sides">
                    <label style={checkboxLabelStyle}>
                      <input type="checkbox" checked={l.paint_touch_both_sides} onChange={(e) => updateLook(i, { paint_touch_both_sides: e.target.checked })} /> both sides
                    </label>
                  </Field>
                </>
              )}

              {(l.type === "blob" || l.type === "slob") && !l.putback && (
                <>
                  <Field label={p.team === "us" ? "Defense on inbounds" : "Our defense on inbounds"}>
                    <select value={l.oob_defense ?? ""} onChange={(e) => updateLook(i, { oob_defense: (e.target.value || null) as OobDefense | null })} style={selectStyle}>
                      <option value="">— untagged</option>
                      {OOB_DEFENSES.map((d) => <option key={d} value={d}>{p.team === "us" ? `vs ${d}` : d}</option>)}
                    </select>
                  </Field>
                  {l.end !== "flowed" && (
                    <Field label="OOB result">
                      <select value={l.oob_result ?? ""} onChange={(e) => updateLook(i, { oob_result: (e.target.value || null) as OobResult | null })} style={selectStyle}>
                        <option value="">—</option>
                        {OOB_RESULTS.filter((o) => o !== "flowed_half_court").map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                      </select>
                    </Field>
                  )}
                </>
              )}

              {l.type === "press_break" && (
                <>
                  <Field label="Press faced">
                    <select value={l.press_break_type_id ?? ""} onChange={(e) => updateLook(i, { press_break_type_id: e.target.value || null })} style={selectStyle}>
                      <option value="">—</option>
                      {pressTypes.map((pc) => <option key={pc.id} value={pc.id}>{pc.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Press break result">
                    <select value={l.press_break_result ?? ""} onChange={(e) => updateLook(i, { press_break_result: (e.target.value || null) as PressBreakResult | null })} style={selectStyle}>
                      <option value="">—</option>
                      {PRESS_BREAK_RESULTS.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                    </select>
                  </Field>
                </>
              )}

              {l.type === "press" && (
                <Field label="Press result">
                  <select value={l.press_result ?? ""} onChange={(e) => updateLook(i, { press_result: (e.target.value || null) as PressResult | null })} style={selectStyle}>
                    <option value="">—</option>
                    {PRESS_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
              )}

              {/* ── Result ── */}
              {!isFinal ? (
                <Field label="Result">
                  <select value={earlierResultOf(l)} onChange={(e) => write(looks.map((x, j) => (j === i ? applyEarlierResult(x, e.target.value as EarlierResult) : x)))} style={selectStyle}>
                    {EARLIER_RESULTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Outcome">
                  <select
                    value={l.outcome ?? ""}
                    onChange={(e) => {
                      const outcome = e.target.value as Outcome;
                      updateLook(i, {
                        outcome,
                        shot_type: outcome === "fg_made" || outcome === "fg_missed" ? l.shot_type ?? 2 : null,
                        shot_quality: outcome === "ft_trip" ? "great" : outcome === "turnover" ? null : l.shot_quality,
                        turnover_type: outcome === "turnover" ? l.turnover_type : null,
                        ft_attempts: outcome === "ft_trip" ? l.ft_attempts ?? 2 : null,
                        ft_made: outcome === "ft_trip" ? l.ft_made ?? 0 : null,
                      });
                    }}
                    style={selectStyle}
                  >
                    {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                  </select>
                </Field>
              )}

              {isShot && (
                <>
                  {isFinal && (
                    <Field label="Shot type">
                      <select value={l.shot_type ?? 2} onChange={(e) => updateLook(i, { shot_type: Number(e.target.value) as 2 | 3 })} style={selectStyle}>
                        <option value="2">2pt</option>
                        <option value="3">3pt</option>
                      </select>
                    </Field>
                  )}
                  <Field label="Shot quality">
                    <select value={l.shot_quality ?? ""} onChange={(e) => updateLook(i, { shot_quality: (e.target.value || null) as ShotQuality | null })} style={selectStyle}>
                      <option value="">—</option>
                      {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                    </select>
                  </Field>
                </>
              )}

              {isFinal && l.outcome === "fg_made" && (
                <Field label="And-1 free throw">
                  <select
                    value={l.ft_attempts ? (l.ft_made ? "made" : "missed") : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateLook(i, v ? { ft_attempts: 1, ft_made: v === "made" ? 1 : 0 } : { ft_attempts: null, ft_made: null });
                    }}
                    style={selectStyle}
                  >
                    <option value="">none</option>
                    <option value="made">made</option>
                    <option value="missed">missed</option>
                  </select>
                </Field>
              )}

              {isFinal && l.outcome === "turnover" && (
                <Field label="Turnover type">
                  <select value={l.turnover_type ?? ""} onChange={(e) => updateLook(i, { turnover_type: (e.target.value || null) as TurnoverType | null })} style={selectStyle}>
                    <option value="">—</option>
                    {TURNOVER_TYPES.map((t) => <option key={t} value={t}>{TURNOVER_TYPE_LABELS[t]}</option>)}
                  </select>
                </Field>
              )}

              {l.outcome === "ft_trip" && (
                <>
                  <Field label="FT attempts">
                    <select
                      value={l.ft_attempts ?? 2}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        updateLook(i, { ft_attempts: n, ft_made: Math.min(l.ft_made ?? 0, n) });
                      }}
                      style={selectStyle}
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                  </Field>
                  <Field label="FT made">
                    <NumberField value={l.ft_made ?? 0} min={0} max={l.ft_attempts ?? 3} commitOn="blur" onChange={(n) => updateLook(i, { ft_made: n })} style={selectStyle} />
                  </Field>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

const readOnlyStyle: React.CSSProperties = {
  padding: "5px 0",
  fontSize: 13,
  color: "var(--text)",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  padding: "5px 0",
  color: "var(--text)",
};

const actionBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    fontSize: 13,
    borderRadius: 20,
    border: `1px solid ${active ? "var(--royal-light)" : "var(--border)"}`,
    background: active ? "var(--royal)" : "var(--surface2)",
    color: active ? "#fff" : "var(--text)",
    cursor: "pointer",
  };
}
