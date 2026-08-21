// TeamDesigner — the hub around the depth chart board.
//
// Named plans rather than a projection mode: summer league teams are a
// second board existing alongside the depth chart, so multiple plans are
// needed regardless. Once plans are named and duplicable, "project next
// year" is just Duplicate plus the hide-graduating toggle.
//
// The board never writes to rosters. Rosters stay built by hand; this is
// the plan, the roster is the record.

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import {
  TeamPlan, TeamPlanLane, TeamPosition, BoardCard,
  getPlans, createPlan, renamePlan, deletePlan, duplicatePlan,
  getLanes, addLane, renameLane, deleteLane,
  ensurePositions, addPosition, renamePosition, deletePosition,
  getSlots, addSlot, cutPlayersNotInPlan, gradeColor, gradeFromGradYear,
} from "../../lib/teamDesigner";
import { getCurrentSeason, getTryoutPlayers, TryoutPlayer } from "../../lib/practicePlanner";
import DepthChartBoard from "./DepthChartBoard";

interface PlayerLite { id: string; name: string; graduation_year: number | null; home_roster_id: string | null; }

export default function TeamDesigner() {
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [plans, setPlans] = useState<TeamPlan[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [lanes, setLanes] = useState<TeamPlanLane[]>([]);
  const [positions, setPositions] = useState<TeamPosition[]>([]);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [pool, setPool] = useState<TryoutPlayer[]>([]);
  const [players, setPlayers] = useState<PlayerLite[]>([]);
  const [hideGraduating, setHideGraduating] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [linkTarget, setLinkTarget] = useState<BoardCard | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { boot(); }, []);
  useEffect(() => { if (planId) loadPlan(planId); }, [planId]);

  async function boot() {
    setLoading(true);
    const season = await getCurrentSeason();
    setSeasonId(season?.id ?? null);
    setPositions(await ensurePositions());
    const [p, tp, { data: prof }] = await Promise.all([
      getPlans(season?.id ?? null),
      getTryoutPlayers(season?.id ?? null),
      supabase.from("profiles").select("id,name,graduation_year,home_roster_id").eq("role", "player"),
    ]);
    setPlans(p);
    setPool(tp);
    setPlayers((prof as PlayerLite[]) ?? []);
    if (p.length && !planId) setPlanId(p[0].id);
    setLoading(false);
  }

  async function loadPlan(id: string) {
    setLanes(await getLanes(id));
    setCards(await getSlots(id));
  }

  const refresh = () => planId && loadPlan(planId);
  const plan = plans.find(p => p.id === planId) ?? null;

  async function handleCreatePlan() {
    const name = window.prompt("Name this plan — e.g. 2026-27 Depth Chart, or Summer League 2027");
    if (!name?.trim()) return;
    const { id, error } = await createPlan(seasonId, name);
    if (error) { setMsg(error); return; }
    await boot();
    if (id) setPlanId(id);
  }

  async function handleDuplicate() {
    if (!plan) return;
    const name = window.prompt("Name the copy:", `${plan.name} (copy)`);
    if (!name?.trim()) return;
    const { id, error } = await duplicatePlan(plan.id, name);
    if (error) { setMsg(error); return; }
    await boot();
    if (id) setPlanId(id);
  }

  async function handleCut() {
    if (!plan) return;
    const bubble = cards.filter(c => c.zone === "bubble").length;
    const unplaced = cards.filter(c => c.zone === "unplaced").length;
    const note = bubble > 0 ? ` (${bubble} of them ${bubble === 1 ? "is" : "are"} in Bubble)` : "";
    if (!window.confirm(
      `Remove every tryout player not placed on a team?\n\n${bubble + unplaced} on this board aren't in a team row${note}, plus anyone in the pool who was never added.\n\nTheir names, notes, groups and tryout attendance are deleted. Players already in a team row are untouched.`
    )) return;
    const { deleted, error } = await cutPlayersNotInPlan(plan.id);
    if (error) { setMsg(error); return; }
    setMsg(`Removed ${deleted} ${deleted === 1 ? "player" : "players"}.`);
    await boot(); await refresh();
  }

  /** Linking lives on the tryout record, so one confirm covers every plan that person appears in. */
  async function handleLink(profileId: string) {
    if (!linkTarget) return;
    if (linkTarget.tryout_player_id) {
      await supabase.from("tryout_players").update({ linked_profile_id: profileId }).eq("id", linkTarget.tryout_player_id);
    } else {
      await supabase.from("team_plan_slots").update({ profile_id: profileId }).eq("id", linkTarget.id);
    }
    setLinkTarget(null);
    await refresh();
  }

  const onBoard = new Set(cards.flatMap(c => [c.profile_id, c.tryout_player_id].filter(Boolean) as string[]));

  if (loading) return <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <select value={planId ?? ""} onChange={e => setPlanId(e.target.value || null)} style={input}>
          {plans.length === 0 && <option value="">No plans yet</option>}
          {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={handleCreatePlan} style={primary}>+ New plan</button>
        {plan && <button onClick={handleDuplicate} style={btn}>Duplicate</button>}
        {plan && (
          <button onClick={async () => {
            const n = window.prompt("Rename plan:", plan.name);
            if (n?.trim()) { await renamePlan(plan.id, n); await boot(); }
          }} style={btn}>Rename</button>
        )}
        {plan && (
          <button onClick={async () => {
            if (!window.confirm(`Delete "${plan.name}"? The board goes; nobody's account or roster is affected.`)) return;
            await deletePlan(plan.id); setPlanId(null); await boot();
          }} style={{ ...btn, color: "#b8342e" }}>Delete plan</button>
        )}
      </div>

      {plan && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => setShowAdd(v => !v)} style={btn}>+ Add players</button>
            <button onClick={() => setShowSettings(v => !v)} style={btn}>Lanes &amp; positions</button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={hideGraduating} onChange={e => setHideGraduating(e.target.checked)} />
              Hide graduating seniors
            </label>
            <button onClick={handleCut} style={{ ...btn, marginLeft: "auto", color: "#b8342e" }}>Make cuts</button>
          </div>

          {msg && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{msg}</div>}

          {showAdd && (
            <div style={panel}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Add to this board</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Tryout pool ({pool.length})</div>
                  {pool.filter(t => !onBoard.has(t.id)).map(t => (
                    <button key={t.id} onClick={async () => {
                      const { error } = await addSlot(plan.id, { display_name: t.name, tryout_player_id: t.id });
                      if (error) setMsg(error); else refresh();
                    }} style={rowBtn}>
                      {t.name}{t.grade ? ` · ${t.grade}` : ""}
                    </button>
                  ))}
                  {pool.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>Empty — add names in the tryout pool.</div>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Players with accounts</div>
                  {players.filter(p => !onBoard.has(p.id)).map(p => {
                    const g = gradeFromGradYear(p.graduation_year);
                    return (
                      <button key={p.id} onClick={async () => {
                        const { error } = await addSlot(plan.id, { display_name: p.name, profile_id: p.id });
                        if (error) setMsg(error); else refresh();
                      }} style={{ ...rowBtn, borderLeft: `4px solid ${gradeColor(p.graduation_year)}` }}>
                        {p.name}{g != null && g <= 12 ? ` · ${g}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {showSettings && (
            <div style={panel}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Team rows</div>
                  {lanes.map(l => (
                    <div key={l.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>{l.name}</span>
                      <button onClick={async () => {
                        const n = window.prompt("Rename row:", l.name);
                        if (n?.trim()) { await renameLane(l.id, n); refresh(); setLanes(await getLanes(plan.id)); }
                      }} style={btn}>✎</button>
                      <button onClick={async () => {
                        if (!window.confirm(`Delete "${l.name}"? Anyone in that row is removed from this board.`)) return;
                        await deleteLane(l.id); setLanes(await getLanes(plan.id)); refresh();
                      }} style={btn}>✕</button>
                    </div>
                  ))}
                  <button onClick={async () => {
                    const n = window.prompt("New team row name:");
                    if (n?.trim()) { await addLane(plan.id, n, lanes.length); setLanes(await getLanes(plan.id)); }
                  }} style={{ ...btn, marginTop: 6 }}>+ Add row</button>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Positions</div>
                  {positions.map(p => (
                    <div key={p.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                      <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                      <button onClick={async () => {
                        const n = window.prompt("Rename position:", p.name);
                        if (n?.trim()) { await renamePosition(p.id, n); setPositions(await ensurePositions()); }
                      }} style={btn}>✎</button>
                      <button onClick={async () => {
                        if (!window.confirm(`Delete "${p.name}"? Anyone in that column drops to Unplaced.`)) return;
                        await deletePosition(p.id); setPositions(await ensurePositions()); refresh();
                      }} style={btn}>✕</button>
                    </div>
                  ))}
                  <button onClick={async () => {
                    const n = window.prompt("New position name:");
                    if (n?.trim()) { await addPosition(n, positions.length); setPositions(await ensurePositions()); }
                  }} style={{ ...btn, marginTop: 6 }}>+ Add position</button>
                </div>
              </div>
            </div>
          )}

          <DepthChartBoard
            lanes={lanes}
            positions={positions}
            cards={cards}
            hideGraduating={hideGraduating}
            onChanged={refresh}
            onLinkCard={setLinkTarget}
          />
        </>
      )}

      {!plan && plans.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          No plans yet. Create one to start building a depth chart.
        </div>
      )}

      {linkTarget && (
        <div style={overlay}>
          <div style={{ ...panel, maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>Link {linkTarget.display_name}</strong>
              <button onClick={() => setLinkTarget(null)} style={btn}>Close</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Pick the account. Suggestions are name matches — confirm rather than trusting them, since two players can share a name.
            </div>
            {[...players]
              .sort((a, b) => score(b.name, linkTarget.display_name) - score(a.name, linkTarget.display_name))
              .slice(0, 25)
              .map(p => (
                <button key={p.id} onClick={() => handleLink(p.id)} style={rowBtn}>
                  {p.name}{score(p.name, linkTarget.display_name) > 0.8 ? "  ← likely" : ""}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Crude name similarity, used only to sort suggestions — never to link automatically. */
function score(a: string, b: string): number {
  const x = a.toLowerCase().trim(), y = b.toLowerCase().trim();
  if (x === y) return 1;
  const xs = new Set(x.split(/\s+/)), ys = y.split(/\s+/);
  const hits = ys.filter(t => xs.has(t)).length;
  return hits / Math.max(xs.size, ys.length);
}

const btn: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" };
const primary: React.CSSProperties = { background: "var(--royal)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
const input: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };
const panel: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 12 };
const rowBtn: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--text)", fontFamily: "inherit", cursor: "pointer", marginBottom: 4 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 };
