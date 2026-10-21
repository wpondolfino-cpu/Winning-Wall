// src/components/gameday/SheetRotation.tsx
// The rotation plan linked to a Game Day play sheet (migration 202).
//
// A sheet carries one rotation until you unlink it or link a different
// one, the same way it carries its calls. RotationLink is the strip on the
// editor (link / change / unlink, plus a view of the plan); RotationPrint
// is the printed page.

import { useEffect, useState } from "react";
import { RotationChoice, SheetRotation, listRotationPlans, loadSheetRotation } from "../../lib/rotationPlans";
import { setSheetRotation } from "../../lib/gameDaySheets";

function fmtDate(iso: string | null) {
  return iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

export function useSheetRotation(planId: string | null | undefined) {
  const [rot, setRot] = useState<SheetRotation | null>(null);
  useEffect(() => {
    let on = true;
    if (!planId) { setRot(null); return; }
    loadSheetRotation(planId).then(r => { if (on) setRot(r); }).catch(() => { if (on) setRot(null); });
    return () => { on = false; };
  }, [planId]);
  return rot;
}

export function RotationLink({ sheetId, planId, onChanged }: { sheetId: string; planId: string | null | undefined; onChanged: (id: string | null) => void }) {
  const rot = useSheetRotation(planId);
  const [choices, setChoices] = useState<RotationChoice[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startPick() {
    setPicking(true); setErr(null);
    try { setChoices(await listRotationPlans()); } catch (e: any) { setErr(e?.message ?? "Couldn't load rotation plans."); }
  }
  async function link(id: string | null) {
    setErr(null);
    try { await setSheetRotation(sheetId, id); onChanged(id); setPicking(false); }
    catch (e: any) {
      setErr(/rotation_plan_id/.test(e?.message ?? "") ? "Run migration 202 first." : (e?.message ?? "Couldn't save that."));
    }
  }

  const chip = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" } as const;

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>🔄 Rotation plan</span>
        {planId && rot ? (
          <>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{rot.label}{rot.date ? ` · ${fmtDate(rot.date)}` : ""}</span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setOpen(o => !o)} style={chip}>{open ? "Hide" : "Show"}</button>
            <button type="button" onClick={startPick} style={chip}>Change</button>
            <button type="button" onClick={() => link(null)} style={{ ...chip, color: "var(--danger-text)" }}>Unlink</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>None linked. It prints with the sheet once you link one.</span>
            <button type="button" onClick={startPick} style={{ ...chip, background: "var(--royal)", color: "#fff", border: "none" }}>🔗 Link rotation plan</button>
          </>
        )}
      </div>

      {picking && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {choices === null && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>}
          {choices?.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No rotation plans yet. Make one in Analytics → Lineups → Rotation on a game.</div>
          )}
          {choices?.map(c => (
            <button key={c.id} type="button" onClick={() => link(c.id)}
              style={{ ...chip, textAlign: "left", fontWeight: c.id === planId ? 700 : 500, borderColor: c.id === planId ? "var(--gold)" : "var(--border)" }}>
              {c.label}{c.date ? ` · ${fmtDate(c.date)}` : ""}
            </button>
          ))}
          <button type="button" onClick={() => setPicking(false)} style={{ ...chip, color: "var(--muted)", alignSelf: "flex-start" }}>Cancel</button>
        </div>
      )}

      {err && <div style={{ fontSize: 12, color: "var(--danger-text)", marginTop: 6 }}>{err}</div>}

      {open && rot && !picking && <RotationTable rot={rot} />}
    </div>
  );
}

function RotationTable({ rot, print }: { rot: SheetRotation; print?: boolean }) {
  const line = print ? "1px solid #ddd" : "1px solid var(--border)";
  return (
    <div style={{ marginTop: print ? 0 : 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: print ? 11 : 12.5 }}>
        <tbody>
          {rot.rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: "4px 8px 4px 0", borderBottom: line, fontWeight: 700, whiteSpace: "nowrap", width: 70 }}>{r.label}</td>
              <td style={{ padding: "4px 0", borderBottom: line }}>{r.names.length ? r.names.join(" · ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rot.notes && <div style={{ fontSize: print ? 11 : 12, marginTop: 6, color: print ? "#444" : "var(--muted)" }}>{rot.notes}</div>}
    </div>
  );
}

/** The printed rotation, for the sheet's print view. */
export function RotationPrint({ planId }: { planId: string | null | undefined }) {
  const rot = useSheetRotation(planId);
  if (!planId || !rot) return null;
  return (
    <div>
      <div style={{ background: "#e8ecf8", color: "#1a2a6c", fontWeight: 600, padding: "4px 8px", marginBottom: 6 }}>
        ROTATION · {rot.label}{rot.date ? ` · ${fmtDate(rot.date)}` : ""}
      </div>
      <RotationTable rot={rot} print />
    </div>
  );
}
