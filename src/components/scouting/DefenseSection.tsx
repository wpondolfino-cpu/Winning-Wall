// src/components/scouting/DefenseSection.tsx
import ChipSection from "../shared/ChipSection";

export interface ManBranch {
  court: "full" | "half" | null;
  structure: string[]; structurePlan: string[];
  offBall: string[]; offBallPlan: string[];
  ballScreen: string[]; ballScreenPlan: string[];
}
export interface ZoneBranch {
  type: string[];
  structure: string[];
  plan: string[];
}
export interface DefenseSectionData {
  base: "man" | "zone" | null;
  man: ManBranch;
  zone: ZoneBranch;
}

export const emptyDefenseData: DefenseSectionData = {
  base: null,
  man: { court: null, structure: [], structurePlan: [], offBall: [], offBallPlan: [], ballScreen: [], ballScreenPlan: [] },
  zone: { type: [], structure: [], plan: [] },
};

const STRUCTURE_OPTS = ["Good help", "Hugs", "High ball pressure", "Looks to double", "Overplays"];
const STRUCTURE_PLAN_OPTS = ["Look skips", "Look 45", "Crash hard", "Look for backdoors", "Look to flash"];
const OFF_BALL_OPTS = ["Switch", "Fight through", "Combo"];
const OFF_BALL_PLAN_OPTS = ["Look for slips & screen your own", "Look for curls/refuses"];
const BALL_SCREEN_OPTS = ["Ice", "Hedge", "Blitz"];
const BALL_SCREEN_PLAN_OPTS = ["Look for flips/re-screens/ghosts/drive the roll", "Look to refuse", "Attack"];
const ZONE_TYPE_OPTS = ["2-3", "1-2-2", "1-3-1", "3-2", "Box & 1", "Triangle & 2"];
const ZONE_STRUCTURE_OPTS = ["Compact", "Extended", "Traps corners", "Traps wings"];
const ZONE_PLAN_OPTS = ["Diamond"];

interface Props {
  label: string;
  data: DefenseSectionData;
  onChange: (next: DefenseSectionData) => void;
  canManage: boolean;
}

function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
}

export default function DefenseSection({ label, data, onChange, canManage }: Props) {
  const d: DefenseSectionData = { ...emptyDefenseData, ...data, man: { ...emptyDefenseData.man, ...data?.man }, zone: { ...emptyDefenseData.zone, ...data?.zone } };

  function setBase(base: "man" | "zone") {
    if (!canManage) return;
    onChange({ ...d, base });
  }
  function patchMan(patch: Partial<ManBranch>) { onChange({ ...d, man: { ...d.man, ...patch } }); }
  function patchZone(patch: Partial<ZoneBranch>) { onChange({ ...d, zone: { ...d.zone, ...patch } }); }

  return (
    <div style={{ marginBottom: 20, background: "var(--surface2)", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{label}</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["man", "zone"] as const).map(b => (
          <button key={b} type="button" disabled={!canManage} onClick={() => setBase(b)}
            style={{ flex: 1, textTransform: "capitalize", background: d.base === b ? "var(--royal)" : "var(--surface1)", color: d.base === b ? "#fff" : "var(--muted)", border: "none", borderRadius: 8, padding: "8px 0", fontWeight: 600, cursor: canManage ? "pointer" : "default" }}>
            {b}
          </button>
        ))}
      </div>

      {d.base === "man" && (
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Full or half court</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {(["full", "half"] as const).map(c => (
              <span key={c} onClick={() => canManage && patchMan({ court: c })}
                style={{ cursor: canManage ? "pointer" : "default", fontSize: 12, padding: "5px 10px", borderRadius: 8,
                  background: d.man.court === c ? "rgba(26,63,168,0.15)" : "var(--surface1)", color: d.man.court === c ? "var(--royal-light)" : "var(--muted)",
                  border: `1px solid ${d.man.court === c ? "var(--royal-light)" : "var(--border)"}`, textTransform: "capitalize" }}>
                {c} court
              </span>
            ))}
          </div>

          <ChipSection label="Structure" options={STRUCTURE_OPTS} selected={d.man.structure}
            onToggle={v => canManage && patchMan({ structure: toggle(d.man.structure, v) })}
            onAddCustom={v => canManage && patchMan({ structure: toggle(d.man.structure, v) })} />
          <ChipSection label="Plan to attack" options={STRUCTURE_PLAN_OPTS} selected={d.man.structurePlan}
            onToggle={v => canManage && patchMan({ structurePlan: toggle(d.man.structurePlan, v) })}
            onAddCustom={v => canManage && patchMan({ structurePlan: toggle(d.man.structurePlan, v) })} />

          <ChipSection label="Off ball" options={OFF_BALL_OPTS} selected={d.man.offBall}
            onToggle={v => canManage && patchMan({ offBall: toggle(d.man.offBall, v) })}
            onAddCustom={v => canManage && patchMan({ offBall: toggle(d.man.offBall, v) })} />
          <ChipSection label="Plan to attack" options={OFF_BALL_PLAN_OPTS} selected={d.man.offBallPlan}
            onToggle={v => canManage && patchMan({ offBallPlan: toggle(d.man.offBallPlan, v) })}
            onAddCustom={v => canManage && patchMan({ offBallPlan: toggle(d.man.offBallPlan, v) })} />

          <ChipSection label="Ball screen" options={BALL_SCREEN_OPTS} selected={d.man.ballScreen}
            onToggle={v => canManage && patchMan({ ballScreen: toggle(d.man.ballScreen, v) })}
            onAddCustom={v => canManage && patchMan({ ballScreen: toggle(d.man.ballScreen, v) })} />
          <ChipSection label="Plan to attack" options={BALL_SCREEN_PLAN_OPTS} selected={d.man.ballScreenPlan}
            onToggle={v => canManage && patchMan({ ballScreenPlan: toggle(d.man.ballScreenPlan, v) })}
            onAddCustom={v => canManage && patchMan({ ballScreenPlan: toggle(d.man.ballScreenPlan, v) })} />
        </div>
      )}

      {d.base === "zone" && (
        <div>
          <ChipSection label="Zone type" options={ZONE_TYPE_OPTS} selected={d.zone.type}
            onToggle={v => canManage && patchZone({ type: toggle(d.zone.type, v) })}
            onAddCustom={v => canManage && patchZone({ type: toggle(d.zone.type, v) })} />
          <ChipSection label="Structure" options={ZONE_STRUCTURE_OPTS} selected={d.zone.structure}
            onToggle={v => canManage && patchZone({ structure: toggle(d.zone.structure, v) })}
            onAddCustom={v => canManage && patchZone({ structure: toggle(d.zone.structure, v) })} />
          <ChipSection label="Plan to attack" options={ZONE_PLAN_OPTS} selected={d.zone.plan}
            onToggle={v => canManage && patchZone({ plan: toggle(d.zone.plan, v) })}
            onAddCustom={v => canManage && patchZone({ plan: toggle(d.zone.plan, v) })} />
        </div>
      )}
    </div>
  );
}
