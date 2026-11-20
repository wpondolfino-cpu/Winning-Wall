// src/components/PracticeSchedulePlayerView.tsx
import { useState, useEffect } from "react";
import { getCurrentPublishedPracticeForRoster, getPracticePrintData, PrintPractice } from "../lib/practicePlanner";
import DrillDiagram from "./plays/DrillDiagram";

interface Props {
  /** Show one specific practice. Omit to fall back to the roster's current published practice. */
  practiceId?: string | null;
  homeRosterId: string | null | undefined;
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function formatClock(t: string) {
  // Block times arrive already written out ("3:15 PM").
  if (/\s(AM|PM)$/.test(t)) return t;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function PracticeSchedulePlayerView({ homeRosterId, practiceId }: Props) {
  const [practice, setPractice] = useState<PrintPractice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Which drill's diagram is open ("block-segment-drill").
  const [openDiagram, setOpenDiagram] = useState<string | null>(null);

  useEffect(() => {
    // With a practiceId it shows THAT practice — which is what tapping a
    // row on the Schedule means. Without one it falls back to the roster's
    // current published practice, which is how this screen worked when it
    // was its own tab.
    if (!practiceId && !homeRosterId) { setLoading(false); setNotFound(true); return; }
    (async () => {
      let id = practiceId ?? null;
      if (!id) {
        const p = await getCurrentPublishedPracticeForRoster(homeRosterId!);
        if (!p) { setLoading(false); setNotFound(true); return; }
        id = p.id;
      }
      const data = await getPracticePrintData(id);
      setPractice(data);
      setLoading(false);
      if (!data) setNotFound(true);
    })();
  }, [homeRosterId, practiceId]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Loading…</div>;

  if (notFound || !practice) {
    return (
      <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 20px", fontSize: 13 }}>
        No practice has been published yet — check back closer to practice time.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 500, margin: "0 auto" }}>
      <div style={{ borderBottom: "2px solid var(--border)", paddingBottom: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{formatDate(practice.practice_date)}</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Starts {formatClock(practice.start_time)}</div>
      </div>

      {practice.blocks.map((b, bi) => (
        <div key={bi} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--royal-light)", marginBottom: 8 }}>
            {formatClock(b.start)} – {formatClock(b.end)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({b.duration_minutes} min)</span>{b.water_break ? " 💧" : ""}
          </div>
          {b.segments.map((s, si) => (
            <div key={si} style={{ marginBottom: 10, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
              {s.rosterName && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{s.rosterName}</div>}
              {s.drills.map((d, di) => (
                <div key={di} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {d.title}{d.film ? " 🎥" : ""}{d.label && <span style={{ color: "var(--muted)", fontWeight: 400 }}> — {d.label}</span>}
                    <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}> · {d.duration_minutes} min</span>
                  </div>
                  {d.goal_text && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, whiteSpace: "pre-wrap" }}>{d.goal_text}</div>}
                  {/* The drill's diagram: tap to open it, tap again to close. */}
                  {d.diagram && (() => {
                    const key = `${bi}-${si}-${di}`;
                    const open = openDiagram === key;
                    return (
                      <div style={{ marginTop: 4 }}>
                        <button onClick={() => setOpenDiagram(open ? null : key)}
                          style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)", background: open ? "var(--surface2)" : "transparent", color: "var(--royal-light)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                          {open ? "Hide diagram" : "View diagram"}
                        </button>
                        {open && <div style={{ marginTop: 6 }}><DrillDiagram play={d.diagram} /></div>}
                      </div>
                    );
                  })()}
                  {d.groups.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {d.groups.map((g, gi) => (
                        <div key={gi} style={{ fontSize: 11, color: "var(--muted)" }}>
                          <b style={{ fontWeight: 600 }}>{g.label}{g.place ? ` · ${g.place}` : ""}{g.coachNames?.length ? ` · Coach ${g.coachNames.join(" & ")}` : ""}</b>
                          {g.teams && g.teams.length > 1
                            ? g.teams.map((t, ti) => <div key={ti} style={{ paddingLeft: 10 }}>Team {ti + 1}: {t.join(", ")}</div>)
                            : <>: {g.memberNames.join(", ")}</>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {b.water_break && (
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1f6fb2", background: "rgba(31,111,178,0.08)", borderRadius: 8, padding: "5px 10px" }}>💧 Water break</div>
          )}
        </div>
      ))}
    </div>
  );
}
