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
  ScheduleWeek, ScheduleItem, getSchedule, updateScheduleFields, deleteScheduleItem, teamLabelFor,
} from "../../lib/schedule";
import { getCurrentSeason, getRosters, renamePracticeWeek } from "../../lib/practicePlanner";
import ScheduleExport from "./ScheduleExport";
import QuickGameEditor from "./QuickGameEditor";
import { supabase } from "../../lib/supabase";
import EventEditor from "./EventEditor";
import PracticeSchedulePlayerView from "../PracticeSchedulePlayerView";
import { getGameDaySheets, GameDaySheet } from "../../lib/gameDaySheets";
import ScheduleImport from "./ScheduleImport";
import QuickPracticeEditor from "./QuickPracticeEditor";

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

/**
 * Colour says whose, shape says what.
 *
 * The team's colour goes on the left stripe — split when a practice is
 * shared — so it works for any team colour at all, including a near-white
 * or a grey that would vanish if it had to be shaded three ways. The kind
 * is carried by the row itself: a game is filled, an event is dashed, a
 * practice is a plain outline. And a small label says it in words, so
 * nothing depends on telling two shades apart in a gym.
 */
function stripeFor(rosterIds: string[] | undefined, colours: Record<string, string>): string {
  const cs = (rosterIds ?? []).map(id => colours[id]).filter(Boolean);
  if (cs.length === 0) return "var(--border)";
  if (cs.length === 1) return cs[0];
  const at = (k: number) => Math.round((k * 100) / cs.length * 100) / 100;
  return `linear-gradient(to bottom, ${cs.map((c, i) => `${c} ${at(i)}%, ${c} ${at(i + 1)}%`).join(", ")})`;
}

/** A team colour at low strength, for filling a game row. */
function tint(hex: string | undefined, alpha: number): string {
  const m = (hex ?? "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return `rgba(255,255,255,${alpha * 0.6})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export default function SchedulePage({ role, homeRosterId, onOpenTab }: Props) {
  const isCoach = role === "coach" || role === "admin";
  const [weeks, setWeeks] = useState<ScheduleWeek[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [showGame, setShowGame] = useState(false);
  const [pickingSheetFor, setPickingSheetFor] = useState<ScheduleItem | null>(null);

  /** One side of a typed final score. Empty clears it. */
  function scoreBox(key: "final_score_us" | "final_score_them", saved: number | null | undefined) {
    const v = draft[key] !== undefined ? draft[key] : saved;
    return (
      <input inputMode="numeric" value={v == null ? "" : String(v)}
        onChange={e => {
          const d = e.target.value.replace(/[^0-9]/g, "");
          setDraft({ ...draft, [key]: d === "" ? null : parseInt(d, 10) });
        }}
        style={{ width: 64, textAlign: "center", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 6px", color: "var(--text)", fontSize: 14, fontFamily: "inherit" }} />
    );
  }

  async function attachSheet(item: ScheduleItem, sheetId: string) {
    const { error } = await updateScheduleFields(item, { gameday_sheet_id: sheetId });
    setPickingSheetFor(null);
    if (error) { setMsg(error); return; }
    await load();
  }
  // Renaming here writes the same week row the practice builder reads,
  // so a name set on either screen shows on both.
  const [renamingWeek, setRenamingWeek] = useState<string | null>(null);
  const [weekDraft, setWeekDraft] = useState("");

  async function commitWeekName(weekId: string) {
    // An empty name would blank the heading here and on the practices page,
    // which shows the name alone. Clearing it restores the dates instead —
    // the same form the app gives a week it creates itself.
    let name = weekDraft.trim();
    if (!name) {
      const w = weeks.find(x => x.id === weekId);
      const f = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "2-digit" });
      name = w?.start_date && w?.end_date ? `${f(w.start_date)} - ${f(w.end_date)}` : "";
    }
    const { error } = await renamePracticeWeek(weekId, name);
    setRenamingWeek(null);
    if (error) { alert("Couldn't rename the week: " + error); return; }
    await load();
  }
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "game" | "practice" | "event">("all");
  /**
   * How much of the season to show.
   *
   * "fortnight" is the working view — this week and next, which is what a
   * coach is actually planning. Importing a season puts forty weeks on this
   * page, and forty collapsed headers on a phone is not a schedule.
   *
   * "games" is the season's fixture list: every game, no practices, no week
   * headings. It's a lens rather than a separate tab so there's one page to
   * keep right and one place for a player to look.
   */
  const [lens, setLens] = useState<"fortnight" | "season" | "games">("fortnight");
  const [showPast, setShowPast] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasonLabel, setSeasonLabel] = useState<string>("");
  const [rosters, setRosters] = useState<{ id: string; name: string; color: string }[]>([]);
  // Coaches only: which team to show. Null is every team.
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [showEvent, setShowEvent] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Players have no practices tab to route to, so the plan opens here.
  const [openPractice, setOpenPractice] = useState<string | null>(null);
  const [sheets, setSheets] = useState<GameDaySheet[]>([]);
  const [showPractice, setShowPractice] = useState(false);
  // Weeks the coach has collapsed. Current and next start open; the rest
  // start closed, because a season's worth of imported games otherwise
  // pushes this week off the screen.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { load(); }, [role]);

  async function load() {
    setLoading(true);
    const season = await getCurrentSeason();
    setSeasonId(season?.id ?? null);
    setSeasonLabel((season as any)?.name ?? String(new Date().getFullYear()));
    // Everyone needs the roster colours — a player's rows carry their own
    // team's stripe too, not just a coach's.
    getRosters().then(rs => setRosters(rs.map((r: any) => ({ id: r.id, name: r.name, color: r.color })))).catch(() => {});
    if (isCoach) {
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? "");
      // Play sheets are reusable — the same one can be attached to any
      // number of games — so the whole list is offered rather than one
      // per game.
      getGameDaySheets().then(setSheets).catch(console.error);
    }
    setWeeks(await getSchedule(season?.id ?? null, { playerVisibleOnly: !isCoach }));
    setLoading(false);
  }

  const today = new Date().toISOString().slice(0, 10);

  /**
   * The Sunday a date's week starts on.
   *
   * Weeks run Sunday to Saturday since migration 125. This used to find
   * the Monday instead, and after that change a week's start date (a
   * Sunday) could never equal it — so "This week" and "Next week"
   * silently stopped appearing, the current week stopped opening by
   * default, and an empty week's placeholder heading ran Monday to
   * Sunday beside Sunday-to-Saturday weeks.
   */
  function weekStartOf(iso: string): string {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  }
  function addDays(iso: string, n: number): string {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const teamColour: Record<string, string> = Object.fromEntries(rosters.map(r => [r.id, r.color]));

  const teamLabel = (item: ScheduleItem) =>
    teamLabelFor(item.rosterIds, rosters, isCoach ? teamFilter : homeRosterId);

  const filtered = weeks
    .map(w => ({
      ...w,
      items: w.items
        .filter(i => filter === "all" || i.kind === filter)
        // A coach picks a team, or sees them all. Something with no team
        // recorded shows under every team rather than none.
        .filter(i => !isCoach || !teamFilter || !i.rosterIds?.length || i.rosterIds.includes(teamFilter))
        // A player sees their own team. Practices are left to the database,
        // which already returns their team's plus any they've been called
        // up to — filtering by home roster here would hide the call-ups.
        .filter(i => isCoach || i.kind === "practice" || !i.rosterIds?.length || !homeRosterId || i.rosterIds.includes(homeRosterId))
        .filter(i => showPast || i.date >= today)
        // The games lens is the fixture list, whatever the kind filter says.
        .filter(i => lens !== "games" || i.kind === "game")
        .filter(i => lens !== "fortnight" || i.date <= addDays(weekStartOf(today), 13) || showPast),
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
  const scaffold = (showPast || lens !== "fortnight") ? filtered : (() => {
    const out = [...filtered];
    const thisMon = weekStartOf(today);
    for (const start of [thisMon, addDays(thisMon, 7)]) {
      const end = addDays(start, 6);
      const covered = out.some(w =>
        (w.start_date && w.end_date && start >= w.start_date && start <= w.end_date) || w.start_date === start
      );
      if (!covered) {
        out.push({
          id: null,
          name: "",
          start_date: start, end_date: end, items: [],
        });
      }
    }
    return out.sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"));
  })();

  const visible = scaffold;

  const weekKey = (w: ScheduleWeek) => w.id ?? w.start_date ?? w.name;

  /**
   * "This week" / "Next week", computed from the date range rather than
   * baked into a name — so a real week carrying a coach's own title
   * ("Week 1 - Foxboro & Sharon") gets the relative label too, not just
   * the empty scaffolded ones.
   */
  function relativeWeekLabel(w: ScheduleWeek): string | null {
    if (!w.start_date) return null;
    const thisMon = weekStartOf(today);
    if (w.start_date === thisMon) return "This week";
    if (w.start_date === addDays(thisMon, 7)) return "Next week";
    return null;
  }
  /**
   * Current and next week open by default; everything else closed.
   *
   * `toggled` holds the weeks you've clicked, meaning "do the opposite of
   * the default". It used to hold the weeks you'd collapsed, which worked
   * for the two open weeks and not at all for the rest: a future week was
   * already shut without being in the set, so clicking it added it — shut
   * to shut — and it could never be opened.
   */
  function isCollapsed(w: ScheduleWeek): boolean {
    const k = weekKey(w);
    const byDefault = (() => {
      // A fixture list shouldn't make you open forty weeks to read it.
      if (lens === "games") return false;
      if (!w.start_date || !w.end_date) return false;
      const thisMon = weekStartOf(today);
      return !(w.start_date <= addDays(thisMon, 13) && w.end_date >= thisMon);
    })();
    return toggled.has(k) ? !byDefault : byDefault;
  }

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
    // A game only offers what it uses. A freshman game with tracking and
    // both sheets switched off shows none of those links, rather than a row
    // of faded buttons that will never light up.
    const tracked = item.trackStats !== false;
    const scout = item.usesScoutSheet !== false;
    const play = item.usesPlaySheet !== false;
    const all = isCoach
      ? [
          tracked && { label: "Tracker", live: true, go: () => onOpenTab?.("gamestats", { gameId: item.id, view: "track" }) },
          scout && { label: "Scout sheet", live: true, go: () => onOpenTab?.("scoutsheets", { gameId: item.id }) },
          // With nothing attached, this used to open the play sheets page
          // and leave you to work out how to attach one. It opens a picker
          // instead: choose a sheet and it's attached.
          play && {
            label: "Play sheet", live: Boolean(item.gamedaySheetId),
            go: () => item.gamedaySheetId
              ? onOpenTab?.("gameday", { sheetId: item.gamedaySheetId })
              : setPickingSheetFor(item),
          },
          tracked && { label: "Game report", live: Boolean(item.played), go: () => onOpenTab?.("gamestats", { gameId: item.id, view: "report" }) },
        ]
      : [
          scout && { label: "Scout sheet", live: Boolean(item.scoutPublished), go: () => onOpenTab?.("scoutsheets", { gameId: item.id }) },
          tracked && { label: "Game report", live: Boolean(item.played && item.published), go: () => onOpenTab?.("gamestats", { gameId: item.id, view: "report" }) },
        ];
    const buttons = all.filter(Boolean) as { label: string; live: boolean; go: () => void }[];
    if (!buttons.length) return null;
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
      {pickingSheetFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}
          onClick={() => setPickingSheetFor(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 400 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Attach a play sheet</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>For {pickingSheetFor.title}.</div>
            {sheets.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                You haven't made a play sheet yet. Make one on the Game Day Sheets page, then attach it here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {sheets.map(sh => (
                  <button key={sh.id} onClick={() => void attachSheet(pickingSheetFor, sh.id)}
                    style={{ textAlign: "left", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                    {sh.name}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setPickingSheetFor(null)}
              style={{ marginTop: 12, background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {showGame && (
        <QuickGameEditor rosters={rosters} onClose={() => setShowGame(false)} onSaved={load} />
      )}
      {showExport && (
        <ScheduleExport
          items={weeks.flatMap(w => w.items)}
          rosters={rosters}
          defaultRosterId={isCoach ? teamFilter : (homeRosterId ?? null)}
          onClose={() => setShowExport(false)}
        />
      )}
      {/* One page, three lenses. A separate games tab would drift from this
          one and give players two places to look. */}
      <div style={{ display: "flex", gap: 5, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, marginBottom: 8 }}>
        {([["fortnight", "Next 2 weeks"], ["season", "Whole season"], ["games", "Games only"]] as const).map(([v, labelText]) => (
          <button key={v} onClick={() => setLens(v)}
            style={{
              flex: 1, textAlign: "center", fontSize: 11.5, padding: 7, borderRadius: 6, cursor: "pointer",
              fontFamily: "inherit", border: "none", fontWeight: 600,
              background: lens === v ? "var(--royal)" : "transparent",
              color: lens === v ? "#fff" : "var(--muted)",
            }}>
            {labelText}
          </button>
        ))}
      </div>

      {/* Players only ever see their own team, so this row would be one
          button that does nothing — it's for coaches. */}
      {isCoach && rosters.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <button onClick={() => setTeamFilter(null)} style={teamFilter === null ? chipActive : chip}>All teams</button>
          {rosters.map(r => (
            <button key={r.id} onClick={() => setTeamFilter(r.id)} style={teamFilter === r.id ? chipActive : chip}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6, verticalAlign: "middle", boxShadow: "0 0 0 1px rgba(255,255,255,0.25)" }} />
              {r.name}
            </button>
          ))}
        </div>
      )}
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
          <button onClick={() => setShowGame(true)} style={primary}>+ Game</button>
          <button onClick={() => setShowPractice(true)} style={chip}>+ Practice</button>
          <button onClick={() => setShowEvent(true)} style={chip}>+ Event</button>
          <button onClick={() => setShowImport(true)} style={chip}>Import</button>
          {/* Named for both things it does. "Share" with an envelope read as
              if it sent something — it doesn't; it fills your clipboard or
              opens a print dialog. */}
          <button onClick={() => setShowExport(true)} style={{ ...chip, marginLeft: "auto" }}>🖨 Print / Email</button>
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

      {showPractice && (
        <QuickPracticeEditor rosters={rosters} existing={weeks.flatMap(w => w.items)} onClose={() => setShowPractice(false)} onSaved={load} />
      )}

      {showEvent && (
        <EventEditor seasonId={seasonId} rosters={rosters} onClose={() => setShowEvent(false)} onSaved={load} />
      )}
      {showImport && (
        <ScheduleImport season={seasonLabel} seasonId={seasonId} userId={userId} onClose={() => setShowImport(false)} onImported={load} />
      )}

      {visible.map(w => (
        <div key={w.id ?? "loose"}>
          <div
            onClick={() => setToggled(t => { const n = new Set(t); const k = weekKey(w); n.has(k) ? n.delete(k) : n.add(k); return n; })}
            style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              margin: "20px 0 10px", padding: "8px 12px",
              background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--muted)", width: 12 }}>{isCollapsed(w) ? "▸" : "▾"}</span>
            {renamingWeek === w.id && w.id ? (
              // The header toggles the week open and shut, so clicks inside
              // the editor mustn't reach it.
              <span onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 5, flex: 1 }}>
                <input value={weekDraft} onChange={e => setWeekDraft(e.target.value)} autoFocus
                  placeholder="Week 1 – Foxboro & Sharon"
                  onKeyDown={e => { if (e.key === "Enter") void commitWeekName(w.id!); if (e.key === "Escape") setRenamingWeek(null); }}
                  style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }} />
                <button onClick={() => void commitWeekName(w.id!)}
                  style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
                <button onClick={() => setRenamingWeek(null)}
                  style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              </span>
            ) : (
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {relativeWeekLabel(w) ?? (w.name || (w.start_date && w.end_date ? fmtRange(w.start_date, w.end_date) : ""))}
            </span>
            )}
            {/* A coach's own week title still shows, just after the
                relative one — "This week · Week 1 - Foxboro & Sharon". */}
            {renamingWeek !== w.id && relativeWeekLabel(w) && w.name && (
              <span style={{ fontSize: 13, color: "var(--text)" }}>{w.name}</span>
            )}
            {w.start_date && w.end_date && (relativeWeekLabel(w) || w.name) && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{fmtRange(w.start_date, w.end_date)}</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
              {w.items.length === 0 ? "—" : `${w.items.length} item${w.items.length === 1 ? "" : "s"}`}
            </span>
            {isCoach && w.id && renamingWeek !== w.id && (
              <button title="Name this week" onClick={e => { e.stopPropagation(); setRenamingWeek(w.id); setWeekDraft(w.name ?? ""); }}
                style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: "0 2px" }}>✎</button>
            )}
          </div>
          {!isCollapsed(w) && w.items.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 10, padding: "14px 12px", marginBottom: 6 }}>
              {filter === "all" ? "Nothing scheduled this week." : `No ${filter === "game" ? "games" : filter === "practice" ? "practices" : "events"} this week.`}
            </div>
          )}
          {!isCollapsed(w) && w.items.map((item, idx) => {
            // Nothing dims any more. A row is on the schedule because it's
            // happening; whether its plan is written is a separate fact,
            // carried by the tag rather than by fading the whole row.
            const planReady = item.kind !== "practice" || isCoach || item.published;
            // A heading whenever the day changes. Repeating the date on
            // every row made a Monday practice and a Wednesday practice
            // read identically -- the day was there, but as the quietest
            // thing on the line rather than the thing separating them.
            const newDay = idx === 0 || w.items[idx - 1].date !== item.date;
            return (
              <div key={item.kind + item.id}>
                {newDay && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: idx === 0 ? "0 0 6px" : "16px 0 6px" }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{fmtWeekday(item.date)}</span>
                    <span style={{ fontSize: 15, color: "var(--muted)" }}>{fmtMonth(item.date)} {fmtDayNum(item.date)}</span>
                    <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  </div>
                )}
                <div
                  onClick={() => openRow(item)}
                  style={{
                    position: "relative", overflow: "hidden",
                    display: "flex", gap: 12, alignItems: "center",
                    background: item.kind === "game"
                      ? tint(teamColour[(item.rosterIds ?? [])[0]], 0.18)
                      : "var(--surface)",
                    border: item.kind === "event" ? "1px dashed var(--border)" : "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 12px 10px 16px", marginBottom: 6,
                    cursor: planReady ? "pointer" : "default",
                  }}
                >
                  <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: stripeFor(item.rosterIds, teamColour) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: item.kind === "game" ? 700 : 600 }}>{item.title}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: item.kind === "game" ? "var(--text)" : "var(--muted)", whiteSpace: "nowrap" }}>
                        {[teamLabel(item), item.kind].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 2 }}>
                      {/* Bus time leads on an away game: it's the one you
                          have to be somewhere for, and missing it means
                          missing the game. */}
                      {item.busTime && (
                        <span style={{ color: "var(--gold)", fontWeight: 700 }}>Bus {fmtTime(item.busTime)}</span>
                      )}
                      <span style={{ color: item.busTime ? "var(--muted)" : "var(--text)", fontWeight: item.busTime ? 400 : 600 }}>
                        {item.busTime ? `Tip ${fmtTime(item.time)}` : fmtTime(item.time)}
                      </span>
                      {item.kind === "game" && item.homeAway && (
                        <span style={{ fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px" }}>
                          {item.homeAway}
                        </span>
                      )}
                      {item.subtitle && <span style={{ color: "var(--muted)" }}>{item.subtitle}</span>}
                    </div>
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
                    <div style={{ fontSize: 11, color: planReady ? KIND_COLOR[item.kind] : "var(--muted)", textAlign: "right", minWidth: 74 }}>
                      {item.kind === "practice"
                        ? (item.published
                            ? <span style={{ fontWeight: 600 }}>Plan posted ›</span>
                            : "Plan coming")
                        : "›"}
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
                      <Field label={item.kind === "practice" ? "Start" : "Time"}><input type="time" value={(draft.time ?? "").slice(0, 5)} onChange={e => setDraft({ ...draft, time: e.target.value || null })} style={input} /></Field>
                      {/* The end parents are told, fixed without leaving the
                          schedule. Cleared, it falls back to the plan. */}
                      {item.kind === "practice" && (
                        <Field label="Expected end">
                          <input type="time"
                            value={(draft.expected_end_time !== undefined ? (draft.expected_end_time ?? "") : (item.expectedEndTime ?? "")).slice(0, 5)}
                            onChange={e => setDraft({ ...draft, expected_end_time: e.target.value || null })}
                            style={input} />
                        </Field>
                      )}
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
                        <Field label="Bus time">
                          <input type="time" value={(draft.bus_time ?? item.busTime ?? "").slice(0, 5)} onChange={e => setDraft({ ...draft, bus_time: e.target.value || null })} style={input} />
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
                      {/* How an untracked game gets its score — it has no
                          possessions for the tracker to add up. A tracked
                          game can be corrected here too. */}
                      {item.kind === "game" && (
                        <Field label="Final score — us / them">
                          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {scoreBox("final_score_us", item.scoreUs)}
                            <span style={{ color: "var(--muted)" }}>–</span>
                            {scoreBox("final_score_them", item.scoreThem)}
                          </span>
                        </Field>
                      )}
                      {item.kind === "game" && (
                        <Field label="For this game">
                          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {([
                              ["track_stats", "trackStats", "Track stats"],
                              ["uses_scout_sheet", "usesScoutSheet", "Scout sheet"],
                              ["uses_play_sheet", "usesPlaySheet", "Play sheet"],
                            ] as const).map(([k, itemKey, title]) => {
                              const v = draft[k] !== undefined ? draft[k] : (item[itemKey] !== false);
                              return (
                                <label key={k} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                                  <input type="checkbox" checked={Boolean(v)}
                                    onChange={e => setDraft({ ...draft, [k]: e.target.checked })} />
                                  {title}
                                </label>
                              );
                            })}
                          </span>
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

// All anchored at midday: a bare date string parses as UTC midnight, which
// renders as the previous day anywhere west of Greenwich.
function fmtWeekday(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
}
function fmtDayNum(iso: string) {
  return new Date(iso + "T12:00:00").getDate();
}
function fmtMonth(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short" });
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
