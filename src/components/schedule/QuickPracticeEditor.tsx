// QuickPracticeEditor — books practice slots from the Schedule.
//
// This creates draft rows — date, times, teams — and nothing else. The
// plan comes later, in Practice Builder, one practice at a time.
//
// One week at a time, by weekday. It used to repeat a single date weekly
// for up to four weeks, which fitted a one-day-a-week team and nothing
// else: Sunday, Monday, Wednesday and Thursday meant four passes through
// the form. Now the date picks a week and you tap the days in it.
//
// Days can have their own times. Sunday is usually a morning session and
// the weekdays after school, and one shared time would mean fixing Sunday
// with a quick edit every single week. A day with no time of its own
// follows the default, so changing the default moves all of those at once.

import { useState, useMemo } from "react";
import { createPractice } from "../../lib/practicePlanner";
import { ScheduleItem } from "../../lib/schedule";

interface RosterLite { id: string; name: string; }

interface Props {
  rosters: RosterLite[];
  /** Pre-selects a date when the button is pressed from inside a week. */
  defaultDate?: string;
  /** What's already booked, so a day that already has a practice is marked. */
  existing?: ScheduleItem[];
  onClose: () => void;
  onSaved: () => void;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
function sundayOf(dateIso: string): Date {
  const d = new Date(dateIso + "T12:00:00");
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function t12(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export default function QuickPracticeEditor({ rosters, defaultDate, existing = [], onClose, onSaved }: Props) {
  const start = defaultDate ?? iso(new Date());
  const [date, setDate] = useState(start);
  const [time, setTime] = useState("15:00");
  const [endTime, setEndTime] = useState("");
  const [rosterIds, setRosterIds] = useState<string[]>(rosters.length === 1 ? [rosters[0].id] : []);
  // The chosen date's own day starts ticked — it's the day you were thinking of.
  const [days, setDays] = useState<Set<number>>(new Set([new Date(start + "T12:00:00").getDay()]));
  const [own, setOwn] = useState<Record<number, { start: string; end: string }>>({});
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const week = useMemo(() => {
    const sun = sundayOf(date);
    return DAYS.map((label, i) => {
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      return { i, label, iso: iso(d), dayNum: d.getDate() };
    });
  }, [date]);

  const rangeLabel = (() => {
    const f = (s: string) => new Date(s + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${f(week[0].iso)} – ${f(week[6].iso)}`;
  })();

  /**
   * Is there already a practice for one of the chosen teams that day?
   * Booking it again would make a second practice, not replace the first.
   */
  function alreadyBooked(dayIso: string): boolean {
    return existing.some(x =>
      x.kind === "practice" && x.date === dayIso &&
      (!rosterIds.length || !(x.rosterIds ?? []).length || (x.rosterIds ?? []).some(r => rosterIds.includes(r)))
    );
  }

  const timesFor = (i: number) => own[i] ?? { start: time, end: endTime };

  function toggleDay(i: number) {
    const next = new Set(days);
    if (next.has(i)) {
      next.delete(i);
      // Unticking a day drops its own time too, so re-ticking it later
      // starts from the default rather than a forgotten override. Kept out
      // of the setDays updater: React may run an updater twice.
      setOwn(o => { const c = { ...o }; delete c[i]; return c; });
      if (editingDay === i) setEditingDay(null);
    } else {
      next.add(i);
    }
    setDays(next);
  }

  const chosen = [...days].sort((a, b) => a - b);

  async function save() {
    if (!rosterIds.length) { setErr("Pick at least one team."); return; }
    if (!chosen.length) { setErr("Pick at least one day."); return; }
    setSaving(true);
    for (const i of chosen) {
      const t = timesFor(i);
      const { error } = await createPractice({
        practice_date: week[i].iso,
        start_time: t.start,
        // Practices booked here have no plan yet, so this is the only end
        // a parent email can show for them.
        expected_end_time: t.end || null,
        roster_ids: rosterIds,
      });
      if (error) {
        setErr(`Stopped at ${week[i].label}: ${error}. Anything before it was booked.`);
        setSaving(false);
        onSaved();
        return;
      }
    }
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add practice</h3>
          <button onClick={onClose} style={btn}>Cancel</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Books the slots. Tap one on the schedule when you're ready to build the plan.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <label style={label}>Week of</label>
            <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>Start</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>Expected end</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={input} />
          </div>
        </div>

        <label style={{ ...label, marginTop: 12 }}>Days · {rangeLabel}</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
          {week.map(d => {
            const on = days.has(d.i);
            const booked = alreadyBooked(d.iso);
            return (
              <button key={d.i} onClick={() => toggleDay(d.i)}
                title={booked ? "There's already a practice this day — booking it adds a second" : undefined}
                style={{
                  ...(on ? chipActive : btn),
                  padding: "7px 0", borderRadius: 8, textAlign: "center", lineHeight: 1.25,
                  ...(booked && !on ? { borderColor: "var(--gold)" } : {}),
                }}>
                {d.label}
                <br />
                <span style={{ fontSize: 10, opacity: on ? 0.85 : 0.6 }}>{d.dayNum}</span>
                {booked && <span style={{ display: "block", fontSize: 9, color: on ? "#fff" : "var(--gold)" }}>booked</span>}
              </button>
            );
          })}
        </div>

        {chosen.length > 0 && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", marginTop: 10 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              Times — tap a day to give it its own
            </div>
            {chosen.map(i => {
              const t = timesFor(i);
              const hasOwn = !!own[i];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
                  <span style={{ width: 38, color: "var(--text)" }}>{DAYS[i]}</span>
                  {editingDay === i ? (
                    <>
                      <input type="time" value={t.start} onChange={e => setOwn(o => ({ ...o, [i]: { ...timesFor(i), start: e.target.value } }))} style={{ ...input, width: "auto", padding: "4px 7px", fontSize: 12 }} />
                      <span style={{ color: "var(--muted)" }}>–</span>
                      <input type="time" value={t.end} onChange={e => setOwn(o => ({ ...o, [i]: { ...timesFor(i), end: e.target.value } }))} style={{ ...input, width: "auto", padding: "4px 7px", fontSize: 12 }} />
                      <button onClick={() => setEditingDay(null)} style={{ ...btn, padding: "3px 9px", fontSize: 11 }}>Done</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setOwn(o => ({ ...o, [i]: timesFor(i) })); setEditingDay(i); }}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: hasOwn ? "var(--text)" : "var(--muted)", textDecoration: "underline dotted" }}>
                        {t12(t.start)}{t.end ? ` – ${t12(t.end)}` : ""}
                      </button>
                      {hasOwn && (
                        <>
                          <span style={{ fontSize: 10.5, color: "var(--gold)" }}>own time</span>
                          <button title="Back to the default"
                            onClick={() => setOwn(o => { const c = { ...o }; delete c[i]; return c; })}
                            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 0 }}>↺</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {rosters.length > 1 && (
          <>
            <label style={{ ...label, marginTop: 12 }}>Teams</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {rosters.map(r => {
                const on = rosterIds.includes(r.id);
                return (
                  <button key={r.id}
                    onClick={() => setRosterIds(on ? rosterIds.filter(x => x !== r.id) : [...rosterIds, r.id])}
                    style={on ? chipActive : btn}>
                    {r.name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {err && <div style={{ fontSize: 12, color: "#ff7b7b", marginTop: 10 }}>{err}</div>}

        <div style={{ marginTop: 14 }}>
          {/* Says how many, so a stray tap doesn't book one you didn't mean. */}
          <button onClick={save} disabled={saving || !chosen.length} style={{ ...primary, opacity: saving || !chosen.length ? 0.5 : 1 }}>
            {saving ? "Adding…" : chosen.length === 1 ? "Add practice" : `Add ${chosen.length} practices`}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 };
const panel: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto" };
const label: React.CSSProperties = { display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit" };
const btn: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" };
const chipActive: React.CSSProperties = { ...btn, background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" };
const primary: React.CSSProperties = { background: "var(--royal)", border: "none", color: "#fff", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
