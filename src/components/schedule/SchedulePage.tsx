// SchedulePage — the agenda view over practices, games and events.
//
// An agenda grouped by week rather than a month grid: on a phone a month
// is 35 unreadable cells, and the questions actually being asked are
// "what's this week" and "when do we play them", neither of which a grid
// answers better than a list.
//
// It is a HUB, not an editor. Rows route to the systems that own them.
// The one exception is the quick edit, which touches scheduling fields
// only — a game that moved should take one tap, not a trip through the
// game editor.

import { useState, useEffect } from "react";
import {
  ScheduleWeek, ScheduleItem, getSchedule, updateScheduleFields, deleteScheduleItem,
} from "../../lib/schedule";
import { getCurrentSeason, getRosters } from "../../lib/practicePlanner";
import { supabase } from "../../lib/supabase";
import EventEditor from "./EventEditor";
import PracticeSchedulePlayerView from "../PracticeSchedulePlayerView";
import { getGameDaySheets, GameDaySheet } from "../../lib/gameDaySheets";
import ScheduleImport from "./ScheduleImport";

interface Props {
  role: "player" | "coach" | "admin";
  homeRosterId?: string | null;
  /** Routes a row through to the tab that owns it. */
  onOpenTab?: (tab: string, payload?: { gameId?: string; practiceId?: string; sheetId?: string; view?: string }) => void;
}

const KIND_COLOR: Record<string, string> = {
  game: "#EF9F27",
  practice: "#378ADD",
  event: "#8A7FE8",
};

export default function SchedulePage({ role, homeRosterId, onOpenTab }: Props) {
  const isCoach = role === "coach" || role === "admin";
  const [weeks, setWeeks] = useState<ScheduleWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "game" | "practice" | "event">("all");
  const [showPast, setShowPast] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonLabel, setSeasonLabel] = useState<string>("");
  const [rosters, setRosters] = useState<{ id: string; name: string }[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [showEvent, setShowEvent] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Players have no practices tab to route to, so the plan opens here.
  const [openPractice, setOpenPractice] = useState<string | null>(null);
  const [sheets, setSheets] = useState<GameDaySheet[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { load(); }, [role]);

  async function load() {
    setLoading(true);
    const season = await getCurrentSeason();
    setSeasonId(season?.id ?? null);
    setSeasonLabel((season as any)?.name ?? String(new Date().getFullYear()));
    if (isCoach) {
      const [{ data: u }, rs] = await Promise.all([supabase.auth.getUser(), getRosters()]);
      setUserId(u.user?.id ?? "");
      setRosters(rs.map((r: any) => ({ id: r.id, name: r.name })));
      // Play sheets are reusable — the same one can be attached to any
      // number of games — so the whole list is offered rather than one
      // per game.
      getGameDaySheets().then(setSheets).catch(console.error);
    }
    setWeeks(await getSchedule(season?.id ?? null, { playerVisibleOnly: !isCoach }));
    setLoading(false);
  }

  const today = new Date().toISOString().slice(0, 10);

  /** Monday of the ISO week containing a date. */
  function mondayOf(iso: string): string {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function addDays(iso: string, n: number): string {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const filtered = weeks
    .map(w => ({
      ...w,
      items: w.items
        .filter(i => filter === "all" || i.kind === filter)
        // A player only sees practices for a roster they're on. Coaches see
        // everything, since they're often planning across teams.
        .filter(i => isCoach || !i.rosterIds?.length || !homeRosterId || i.rosterIds.includes(homeRosterId))
        .filter(i => showPast || i.date >= today),
    }))
    .filter(w => w.items.length > 0);

  /**
   * The current week and the next one always appear, even when empty.
   *
   * A bare "Nothing coming up" reads like the page is broken rather than
   * like the week is genuinely clear. Week scaffolding says which week is
   * empty, which is information — and for a coach it's the frame the
   * "+ Game" buttons act on.
   *
   * Built client-side from dates rather than by creating practice_weeks
   * rows: nothing should be written to the database just to render a
   * heading. A real week row takes over the moment one exists.
   */
  const scaffold = showPast ? filtered : (() => {
    const out = [...filtered];
    const thisMon = mondayOf(today);
    for (const start of [thisMon, addDays(thisMon, 7)]) {
      const end = addDays(start, 6);
      const covered = out.some(w =>
        (w.start_date && w.end_date && start >= w.start_date && start <= w.end_date) || w.start_date === start
      );
      if (!covered) {
        out.push({
          id: null,
          name: start === thisMon ? "This week" : "Next week",
          start_date: start, end_date: end, items: [],
        });
      }
    }
    return out.sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"));
  })();

  const visible = scaffold;

  function openRow(item: ScheduleItem) {
    if (item.kind === "game") {
      setExpanded(expanded === item.id ? null : item.id);
      return;
    }
    if (item.kind === "event") return;              // nothing behind it
    // A practice has one destination, so expanding would cost a wasted tap.
    if (!isCoach && !item.published) return;        // dimmed and inert
    // Coaches go to Practice Builder, which is the editable thing. Players
    // have no practices tab at all, so the plan opens in place rather than
    // routing to a tab that doesn't exist for them.
    if (isCoach) onOpenTab?.("practices", { practiceId: item.id });
    else setOpenPractice(item.id);
  }

  async function saveEdit() {
    if (!editing) return;
    const { error } = await updateScheduleFields(editing, draft);
    if (error) { setMsg(error); return; }
    setEditing(null); setDraft({});
    await load();
  }

  async function removeItem(item: ScheduleItem) {
    if (!window.confirm(`Delete "${item.title}" on ${item.date}? This removes it everywhere, not just from the schedule.`)) return;
    const { error } = await deleteScheduleItem(item);
    if (error) { setMsg(error); return; }
    setEditing(null);
    await load();
  }

  function GameButtons({ item }: { item: ScheduleItem }) {
    // Fixed order, pre-game and post-game alike. A button that moves
    // between visits is one you have to look for every time.
    const buttons = isCoach
      ? [
          { label: "Tracker", live: true, go: () => onOpenTab?.("gamestats", { gameId: item.id, view: "track" }) },
          { label: "Scout sheet", live: true, go: () => onOpenTab?.("scoutsheets", { gameId: item.id }) },
          // Coach-only, and before the report because it's a pre-game
          // thing. Faded when no sheet is attached, same rule as the rest.
          { label: "Play sheet", live: Boolean(item.gamedaySheetId), go: () => onOpenTab?.("gameday", { sheetId: item.gamedaySheetId ?? undefined }) },
          { label: "Game report", live: Boolean(item.played), go: () => onOpenTab?.("gamestats", { gameId: item.id, view: "report" }) },
        ]
      : [
          { label: "Scout sheet", live: Boolean(item.scoutPublished), go: () => onOpenTab?.("scoutsheets", { gameId: item.id }) },
          { label: "Game report", live: Boolean(item.played && item.published), go: () => onOpenTab?.("gamestats", { gameId: item.id, view: "report" }) },
        ];
    return (
      <div style={{ padding: "2px 0 10px 16px" }}>
        {buttons.map(b => (
          <button
            key={b.label}
            onClick={b.live ? b.go : undefined}
            style={{
              background: b.live ? "var(--royal)" : "var(--surface2)",
              color: b.live ? "#fff" : "var(--muted)",
              border: b.live ? "none" : "1px solid var(--border)",
              borderRadius: 10, padding: "7px 14px", fontSize: 12, fontFamily: "inherit",
              marginRight: 8, opacity: b.live ? 1 : 0.55,
              cursor: b.live ? "pointer" : "default",
            }}
          >
            {b.label}{b.live ? "" : b.label === "Play sheet" ? " · none attached" : " · not posted yet"}
          </button>
        ))}
      </div>
    );
  }

  if (loading) return <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {(["all", "game", "practice", "event"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={f === filter ? chipActive : chip}>
            {f === "all" ? "All" : f === "game" ? "Games" : f === "practice" ? "Practices" : "Events"}
          </button>
        ))}
        <button onClick={() => setShowPast(v => !v)} style={{ ...chip, marginLeft: "auto" }}>
          {showPast ? "Upcoming only" : "Show past"}
        </button>
      </div>

      {isCoach && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button onClick={() => onOpenTab?.("gamestats", { view: "new" })} style={primary}>+ Game</button>
          <button onClick={() => onOpenTab?.("practices", { view: "new" })} style={chip}>+ Practice</button>
          <button onClick={() => setShowEvent(true)} style={chip}>+ Event</button>
          <button onClick={() => setShowImport(true)} style={chip}>Import</button>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{msg}</div>}

      {visible.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 0" }}>
          Nothing on the schedule.
        </div>
      )}

      {openPractice && (
        <div style={overlayStyle}>
          <div style={sheetStyle}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button onClick={() => setOpenPractice(null)} style={chip}>Close</button>
            </div>
            <PracticeSchedulePlayerView practiceId={openPractice} homeRosterId={homeRosterId ?? null} />
          </div>
        </div>
      )}

      {showEvent && (
        <EventEditor seasonId={seasonId} rosters={rosters} onClose={() => setShowEvent(false)} onSaved={load} />
      )}
      {showImport && (
        <ScheduleImport season={seasonLabel} seasonId={seasonId} userId={userId} onClose={() => setShowImport(false)} onImported={load} />
      )}

      {visible.map(w => (
        <div key={w.id ?? "loose"}>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "16px 0 8px" }}>
            {w.name}{w.start_date && w.end_date ? ` · ${fmtRange(w.start_date, w.end_date)}` : ""}
          </div>
          {w.items.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 12px", marginBottom: 6 }}>
              {filter === "all" ? "Nothing scheduled this week." : `No ${filter === "game" ? "games" : filter === "practice" ? "practices" : "events"} this week.`}
            </div>
          )}
          {w.items.map(item => {
            const live = item.kind === "game" || item.kind === "event" || isCoach || item.published;
            return (
              <div key={item.kind + item.id}>
                <div
                  onClick={() => openRow(item)}
                  style={{
                    display: "flex", gap: 12, alignItems: "center",
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderLeft: `4px solid ${KIND_COLOR[item.kind]}`,
                    borderRadius: 10, padding: "10px 12px", marginBottom: 6,
                    opacity: live ? 1 : 0.5, cursor: live ? "pointer" : "default",
                  }}
                >
                  <div style={{ minWidth: 70 }}>
                    <div style={{ fontSize: 13 }}>{fmtDay(item.date)}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{fmtTime(item.time)}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14 }}>{item.title}</div>
                    {item.subtitle && <div style={{ fontSize: 12, color: "var(--muted)" }}>{item.subtitle}</div>}
                  </div>
                  {isCoach && (
                    <button
                      onClick={e => { e.stopPropagation(); setEditing(editing?.id === item.id ? null : item); setDraft({ date: item.date, time: item.time }); }}
                      style={{ ...chip, padding: "5px 11px" }}
                    >
                      {editing?.id === item.id ? "Close" : "Edit"}
                    </button>
                  )}
                  {!isCoach && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {item.kind === "practice" && !item.published ? "plan not posted" : live ? "›" : ""}
                    </div>
                  )}
                </div>

                {expanded === item.id && item.kind === "game" && <GameButtons item={item} />}

                {editing?.id === item.id && (
                  <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, margin: "0 0 8px 16px" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                      Quick edit — scheduling only. Everything else lives in {item.kind === "game" ? "the game editor" : item.kind === "practice" ? "Practice Builder" : "this row"}.
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                      <Field label="Date"><input type="date" value={draft.date ?? ""} onChange={e => setDraft({ ...draft, date: e.target.value })} style={input} /></Field>
                      <Field label="Time"><input type="time" value={(draft.time ?? "").slice(0, 5)} onChange={e => setDraft({ ...draft, time: e.target.value || null })} style={input} /></Field>
                      {item.kind !== "practice" && (
                        <Field label="Location"><input value={draft.location ?? ""} onChange={e => setDraft({ ...draft, location: e.target.value })} placeholder="Gym" style={input} /></Field>
                      )}
                      {item.kind === "game" && (
                        <Field label="Home / Away">
                          <select value={draft.home_away ?? ""} onChange={e => setDraft({ ...draft, home_away: e.target.value })} style={input}>
                            <option value="">—</option><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option>
                          </select>
                        </Field>
                      )}
                      {item.kind === "game" && (
                        <Field label="Play sheet">
                          <select
                            value={draft.gameday_sheet_id ?? item.gamedaySheetId ?? ""}
                            onChange={e => setDraft({ ...draft, gameday_sheet_id: e.target.value || null })}
                            style={input}
                          >
                            <option value="">— none —</option>
                            {sheets.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                          </select>
                        </Field>
                      )}
                      {item.kind === "event" && (
                        <Field label="Title"><input value={draft.title ?? item.title} onChange={e => setDraft({ ...draft, title: e.target.value })} style={input} /></Field>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button onClick={saveEdit} style={primary}>Save</button>
                      {item.kind === "game" && <button onClick={() => onOpenTab?.("gamestats", { gameId: item.id })} style={chip}>Open game →</button>}
                      {item.kind === "practice" && <button onClick={() => onOpenTab?.("practices", { practiceId: item.id })} style={chip}>Open practice plan →</button>}
                      <button onClick={() => removeItem(item)} style={{ ...chip, marginLeft: "auto", color: "#b8342e" }}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}

function fmtDay(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtRange(a: string, b: string) {
  const f = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(a)} – ${f(b)}`;
}
function fmtTime(t: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 200, padding: 16, overflowY: "auto" };
const sheetStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, width: "100%", maxWidth: 760, marginTop: 20 };
const chip: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" };
const chipActive: React.CSSProperties = { ...chip, background: "var(--royal)", color: "#fff", border: "none" };
const primary: React.CSSProperties = { background: "var(--royal)", border: "none", color: "#fff", borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", marginTop: 2 };
