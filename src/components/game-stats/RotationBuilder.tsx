// src/components/game-stats/RotationBuilder.tsx
// Building the rotation you intend to run, block by block.
//
// Column-first, not painting: you tap a block and set its five, which can't
// produce an invalid state the way ticking players row-by-row can. It's also
// the same sub panel used for shift entry, so there's one interaction to
// learn rather than two.
//
// Everything is a WARNING, never a block. A minute cap exceeded or a
// required pairing broken shows in amber and saves anyway -- you know when
// you're deliberately breaking your own rule, and a planner that refuses to
// let you plan is worse than useless the one night it matters.
//
// The projection beside each block is the point of doing this here rather
// than on paper: you can see that the stretch you were about to schedule
// creates a five that's been outscored all season, before you run it.

import { useEffect, useMemo, useState } from "react";
import {
  loadPlan, savePlan, lastPlan, buildProjectionModel, comparePlanToActual,
  actualBlocksFromSlice, DEFAULT_BLOCKS_PER_PERIOD,
  type RotationPlan, type ProjectionModel,
} from "../../lib/rotationPlans";
import { listGamePlayers, type LineupPlayer } from "../../lib/lineups";
import { periodLabel, gameFormat, regulationPeriods, type GameFormat } from "../../lib/gameStats";
import type { GameSlice } from "../../lib/lineupStats";
import { supabase } from "../../lib/supabase";

interface Props {
  gameId: string;
  userId: string;
  rosterId: string | null;
  /** Season data the projection is built from — not this game. */
  historySlices: GameSlice[];
  goals: any[];
  name: (id: string) => string;
}

export default function RotationBuilder({ gameId, userId, rosterId, historySlices, goals, name }: Props) {
  const [plan, setPlan] = useState<RotationPlan>({ game_id: gameId, blocks: [], minute_targets: {}, notes: null });
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
  const [format, setFormat] = useState<GameFormat>(gameFormat(null));
  const [actualSlice, setActualSlice] = useState<GameSlice | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const model: ProjectionModel = useMemo(() => buildProjectionModel(historySlices, goals), [historySlices, goals]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId]);

  async function load() {
    setLoading(true);
    const { data: game } = await supabase.from("games").select("*").eq("id", gameId).maybeSingle();
    const fmt = gameFormat(game as any);
    setFormat(fmt);

    const existing = await loadPlan(gameId);
    const blockCount = regulationPeriods(fmt).length * DEFAULT_BLOCKS_PER_PERIOD;
    setPlan(existing ?? { game_id: gameId, blocks: Array.from({ length: blockCount }, () => []), minute_targets: {}, notes: null });
    setPlayers(await listGamePlayers(rosterId, gameId));

    // If this game has already been played, its shifts drive plan-vs-actual.
    const [{ data: poss }, { data: shifts }] = await Promise.all([
      supabase.from("possessions").select("*").eq("game_id", gameId).order("sequence", { ascending: true }),
      supabase.from("shifts").select("*").eq("game_id", gameId).order("start_sequence", { ascending: true }),
    ]);
    const ps = (poss ?? []) as any[];
    const sh = (shifts ?? []) as any[];
    setActualSlice(ps.length && sh.length ? { gameId, possessions: ps, shifts: sh, format: fmt } : null);
    setLoading(false);
  }

  const blockLabels = useMemo(() => {
    const out: string[] = [];
    regulationPeriods(format).forEach((period) => {
      for (let b = 0; b < DEFAULT_BLOCKS_PER_PERIOD; b++) out.push(`${periodLabel(format, period)} ${b + 1}`);
    });
    return out;
  }, [format]);

  /** Estimated minutes per block, from the period length rather than a guess. */
  const blockMinutes = useMemo(() => {
    const per = format.period_lengths[0] ?? 8;
    return per / DEFAULT_BLOCKS_PER_PERIOD;
  }, [format]);

  const minutes = useMemo(() => {
    const m = new Map<string, number>();
    plan.blocks.forEach((five) => five.forEach((id) => m.set(id, (m.get(id) ?? 0) + blockMinutes)));
    return m;
  }, [plan.blocks, blockMinutes]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    plan.blocks.forEach((five, i) => {
      if (five.length && five.length !== 5) out.push(`${blockLabels[i]} has ${five.length} players, not 5.`);
    });
    const empty = plan.blocks.filter((b) => !b.length).length;
    if (empty && empty < plan.blocks.length) out.push(`${empty} block${empty === 1 ? "" : "s"} still empty.`);
    minutes.forEach((mins, id) => {
      const target = plan.minute_targets[id];
      if (target && mins > target + 0.5) out.push(`${name(id)} is planned for ${fmt(mins)} against a ${fmt(target)} target.`);
    });
    return out;
  }, [plan, minutes, blockLabels, name]);

  function openBlock(i: number) {
    setEditing(i);
    // Carry the previous block forward -- most blocks differ from the one
    // before by a player or two, not five.
    setDraft(plan.blocks[i]?.length ? plan.blocks[i] : (plan.blocks[i - 1] ?? []));
  }

  function commit() {
    if (editing == null) return;
    const blocks = [...plan.blocks];
    blocks[editing] = draft;
    setPlan({ ...plan, blocks });
    setEditing(null);
  }

  async function persist() {
    const { error } = await savePlan(plan, userId);
    setStatus(error ? `Couldn't save: ${error}` : "Saved");
    setTimeout(() => setStatus(null), 2000);
  }

  async function copyForward() {
    const prev = await lastPlan(gameId, rosterId);
    if (!prev) { setStatus("No earlier plan to copy."); setTimeout(() => setStatus(null), 2000); return; }
    setPlan({ ...prev, game_id: gameId });
    setStatus("Copied from your last plan — not saved yet.");
    setTimeout(() => setStatus(null), 3000);
  }

  const comparison = useMemo(
    () => (actualSlice && plan.blocks.some((b) => b.length) ? comparePlanToActual(plan, actualBlocksFromSlice(actualSlice)) : []),
    [actualSlice, plan],
  );

  if (loading) return <div className="card">Loading plan…</div>;

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>Rotation plan</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{blockLabels.length} blocks · about {fmt(blockMinutes)} each</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={copyForward} style={btn}>Copy last plan</button>
          <button onClick={persist} className="btn-primary" style={{ ...btn, width: "auto" }}>Save</button>
        </span>
      </div>

      {status && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{status}</div>}

      {warnings.length > 0 && (
        <div style={{ background: "#2a1f10", border: "1px solid #7a5a20", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
          {warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#e0b464" }}>⚠ {w}</div>)}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Warnings only — the plan saves either way.
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        {plan.blocks.map((five, i) => {
          const proj = five.length === 5 ? model.project(five) : null;
          return (
            <div key={i}>
              <div
                onClick={() => openBlock(i)}
                style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "var(--surface2)", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                <span style={{ width: 52, fontSize: 12, color: "var(--muted)" }}>{blockLabels[i]}</span>
                <span style={{ flex: 1, minWidth: 0, color: five.length ? "var(--text)" : "var(--muted)" }}>
                  {five.length ? five.map(name).join(" · ") : "tap to set the five"}
                </span>
                {proj && (
                  <span style={{ fontSize: 12, textAlign: "right" }}>
                    <span style={{ color: proj.net == null ? "var(--muted)" : proj.net > 3 ? "#5cb98b" : proj.net < -3 ? "#d98b8b" : "var(--text)" }}>
                      {proj.net == null ? "—" : `${proj.net > 0 ? "+" : ""}${proj.net}`}
                    </span>
                    <span style={{ color: "var(--muted)" }}> {proj.observed ? "played" : "projected"}</span>
                  </span>
                )}
              </div>

              {proj && proj.fit != null && Math.abs(proj.fit) >= 3 && (
                <div style={{ fontSize: 11, color: "var(--muted)", padding: "2px 10px 0 62px" }}>
                  Individuals alone suggest {proj.individualsOnly! > 0 ? "+" : ""}{proj.individualsOnly};
                  {" "}pairs and trios pull it {proj.fit < 0 ? "down" : "up"} to {proj.net! > 0 ? "+" : ""}{proj.net}.
                </div>
              )}

              {editing === i && (
                <FivePicker
                  players={players}
                  selected={draft}
                  onToggle={(id) => setDraft(draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id])}
                  onCommit={commit}
                  onCancel={() => setEditing(null)}
                  name={name}
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Planned minutes</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {[...minutes.entries()].sort((a, b) => b[1] - a[1]).map(([id, mins]) => {
          const target = plan.minute_targets[id];
          const over = target && mins > target + 0.5;
          return (
            <span key={id} style={{ fontSize: 12, padding: "4px 9px", borderRadius: 6, background: "var(--surface2)", color: over ? "#e0b464" : "var(--muted)" }}>
              {name(id)} {fmt(mins)}{target ? ` / ${fmt(target)}` : ""}
            </span>
          );
        })}
        {!minutes.size && <span style={{ fontSize: 12, color: "var(--muted)" }}>Nothing planned yet.</span>}
      </div>

      {comparison.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Plan versus actual</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            {comparison.filter((c) => c.matched).length} of {comparison.length} blocks ran as planned. Deviating isn't a
            failure — where it happens across a season is the useful part.
          </div>
          {comparison.filter((c) => !c.matched).map((c) => (
            <div key={c.block} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", color: "var(--muted)" }}>
              <span style={{ width: 52 }}>{blockLabels[c.block]}</span>
              <span style={{ flex: 1 }}>
                {c.missing.length > 0 && <>planned {c.missing.map(name).join(", ")} </>}
                {c.extra.length > 0 && <>played {c.extra.map(name).join(", ")} instead</>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.7 }}>
        A projected number comes from every group inside that five you've actually played — the pairs and trios as well as
        the individuals — so two players who don't work together pull it down even when both look good alone.
        {model.totalPossessions < 600 && " With this little data the pairs and trios carry almost no weight yet, so projections are close to a straight read of the individuals."}
      </div>
    </div>
  );
}

function FivePicker({ players, selected, onToggle, onCommit, onCancel, name }: {
  players: LineupPlayer[]; selected: string[];
  onToggle: (id: string) => void; onCommit: () => void; onCancel: () => void;
  name: (id: string) => string;
}) {
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--accent, #3a5fd0)", borderRadius: 8, padding: 10, margin: "6px 0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {players.map((p) => {
          const on = selected.includes(p.id);
          return (
            <span
              key={p.id}
              onClick={() => onToggle(p.id)}
              style={{
                fontSize: 13, padding: "5px 9px", borderRadius: 6, cursor: "pointer",
                background: on ? "#16305c" : "var(--surface)",
                border: `1px solid ${on ? "#16305c" : "var(--border)"}`,
                color: on ? "#cfe0ff" : "var(--muted)",
              }}
            >
              {p.jersey != null ? `${p.jersey} ${p.name}` : p.name}
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={onCommit} disabled={selected.length !== 5} className="btn-primary" style={{ ...btn, width: "auto", opacity: selected.length === 5 ? 1 : 0.45 }}>
          Confirm
        </button>
        <button onClick={onCancel} style={btn}>Cancel</button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {selected.length === 5 ? selected.map(name).join(" · ") : `${selected.length} of 5`}
        </span>
      </div>
    </div>
  );
}

/** Minutes as m:ss, matching the report. */
function fmt(mins: number): string {
  const secs = Math.round((mins * 60) / 15) * 15;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

const btn: React.CSSProperties = {
  padding: "6px 12px", fontSize: 13, borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--surface2)",
  color: "var(--text)", cursor: "pointer",
};
