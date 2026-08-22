// src/components/PracticeSchedulePlayerView.tsx
import { useState, useEffect } from "react";
import { getCurrentPublishedPracticeForRoster, getPracticePrintData, PrintPractice } from "../lib/practicePlanner";

interface Props {
  /** Show one specific practice. Omit to fall back to the roster's current published practice. */
  practiceId?: string | null;
  homeRosterId: string | null | undefined;
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function formatClock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function PracticeSchedulePlayerView({ homeRosterId, practiceId }: Props) {
  const [practice, setPractice] = useState<PrintPractice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
            {formatClock(b.start)} – {formatClock(b.end)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({b.duration_minutes} min)</span>
          </div>
          {b.segments.map((s, si) => (
            <div key={si} style={{ marginBottom: 10, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
              {s.rosterName && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{s.rosterName}</div>}
              {s.drills.map((d, di) => (
                <div key={di} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {d.title}{d.label && <span style={{ color: "var(--muted)", fontWeight: 400 }}> — {d.label}</span>}
                    <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}> · {d.duration_minutes} min</span>
                  </div>
                  {d.goal_text && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{d.goal_text}</div>}
                  {d.groups.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {d.groups.map((g, gi) => (
                        <div key={gi} style={{ fontSize: 11, color: "var(--muted)" }}>{g.label}: {g.memberNames.join(", ")}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
