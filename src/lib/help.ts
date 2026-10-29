// src/lib/help.ts
// The "?" help panel (migration 170).
//
// Every page ships with STARTER help below -- a one-line "what this page is
// for" and the few things people do most there, separately for coaches and
// players. When an admin edits a page's help in the app, that edit is saved
// in help_pages and shown instead; "Reset to starter text" deletes it.
//
// Links (full guide, quick sheet, video) start blank and only appear in the
// panel once someone pastes one in.
//
// Screens inside a page (the play designer, a scout sheet, practice builder,
// the live tracker) call useHelpTopic() so the ? opens help for that screen
// while it's on screen.

import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

export type HelpAudience = "coach" | "player";

export interface HelpContent {
  title: string;
  intro: string;
  steps: string[];
  guideUrl: string | null;
  sheetUrl: string | null;
  videoUrl: string | null;
}

export interface HelpEntry extends HelpContent {
  pageKey: string;
  audience: HelpAudience;
  edited: boolean;            // true when an admin's edit is showing
  updatedBy: string | null;   // name
  updatedAt: string | null;
}

type Starter = { title: string; intro: string; steps: string[] };
const S = (title: string, intro: string, steps: string[]): Starter => ({ title, intro, steps });

// ── Starter help ─────────────────────────────────────────────────
const COACH: Record<string, Starter> = {
  schedule: S("Schedule", "Games, practices and events in one list, grouped by week.", [
    "Use the team buttons and All · Games · Practices · Events to filter. Show past brings back older weeks.",
    "+ Game, + Practice and + Event add to the schedule. + Practice books slots a week at a time.",
    "Tap a game for Tracker · Scout sheet · Play sheet · Game report. A faded button means it doesn't exist yet.",
    "Edit on any row changes date, time, location and bus time.",
    "Import pastes games from your league page — it updates moved games rather than duplicating.",
    "🖨 Print / Email turns a date range into text for your weekly message.",
  ]),
  practices: S("Practices", "Your practice plans, week by week. Open one to build, publish and run it.", [
    "Open a week and tap a practice to build it, or make a new one.",
    "Add time blocks, then drills inside them. A second drill in a block makes stations.",
    "Use the Group column to generate groups from today's attendance.",
    "Publish so players see the plan — that also unlocks attendance and wins.",
    "Attendance opens a big-button screen for the gym; ✔ Complete attendance stamps it.",
  ]),
  practicebuilder: S("Practice Builder", "Plan the practice in timed blocks. Header fields save as you change them.", [
    "Set the date, start time, teams and week in the header.",
    "+ Add time block, set its minutes, and drag ⠳ to reorder. Clock times are worked out from the start time.",
    "+ Add drill inside a block. ⧉ From a past practice brings a drill with its setup.",
    "Split a block when two teams practice together but do different things.",
    "Publish, Print, Duplicate and Save as template are in the header.",
  ]),
  practicelibrary: S("Practice Drills", "Your team drill library — what the practice builder's drill picker draws from.", [
    "+ New drill: title, description, video and category.",
    "Fill in default minutes and group size so drills land in a practice ready to go.",
    "Tick “Somebody wins this drill” to record practice wins for it.",
    "Link a play so the drill opens with its diagram.",
  ]),
  plays: S("Plays", "Your plays and playbooks. Draw a play, file it in a playbook, and share it.", [
    "+ Draw a new play opens the designer.",
    "Open a play to watch it in 2D or 3D, print it, or edit it.",
    "Playbooks collect plays — Man offense, BLOBs, Press breaks.",
    "📝 Make quiz on a playbook builds a play quiz from it.",
    "Share a play or playbook with staff, your team or individual players.",
  ]),
  playdesigner: S("Play Designer", "Draw the play step by step. It saves itself a few seconds after every change.", [
    "Name the play and pick the court first.",
    "Place Players, Defenders and the Ball, then draw lines by dragging from the player who does the action.",
    "Start a new line at the tip of the last one to continue that player's path — a gold ring shows it'll attach.",
    "⇄ Handoff: drag from the end of the dribble to the receiver.",
    "👻 Ghost: drag to the screen spot like a Screen, then draw a Cut from its tip for the slip. They slow in, fake it and sprint out.",
    "◖ Seal: drag from the post player toward the defender they're sealing (to a spot, or a short drag to seal in place). They sink low and hold it.",
    "📚 Pick the playbooks this play belongs in, under the category.",
    "+ Add step moves everyone to where their lines ended. Name each step and write the read in its notes.",
    "Play frame checks one step; Preview full play and Watch live show the whole thing.",
  ]),
  gamestats: S("Analytics", "Tracking, reports, lineups and goals for your games.", [
    "Games lists your games — open one for its tracker, report, shifts or possession editor.",
    "Reports builds a report across any games and possession types.",
    "Lineups shows individual, 2-, 3- and 5-man numbers once shifts are entered.",
    "Goals sets the target for each stat — that's what turns numbers green or red.",
  ]),
  "analytics-games": S("Analytics — Games", "Every game on your schedule, with its tracker, stats and clean-up tools.", [
    "Start opens the tap-through tracker; switch periods with the tabs above it.",
    "Stats shows the report by period, half or full game.",
    "Shifts is where you enter who was on the floor — the Lineups tab is built from these.",
    "Edit stats fixes a mis-tapped trip after the fact.",
    "Finish locks in the final score; Push to team shares the game with players.",
    "Closed a period or game too early? Use Reopen.",
  ]),
  "analytics-reports": S("Analytics — Reports", "Reports across any games you choose. Saved reports stay listed by season.", [
    "Pick a season to see its saved reports.",
    "Create report: choose the games and possession types to include.",
    "Numbers are colored against your Goals — green is on target, red is off.",
    "Save it to come back later, or open a saved report to edit it.",
  ]),
  "analytics-lineups": S("Analytics — Lineups", "How groups of players did together, built from the shifts you enter on each game.", [
    "Enter shifts first: Games → Shifts on that game.",
    "Pick the type first (games, scrimmages, practices, summer), then the scope — all, the last few, wins, losses or one game.",
    "Reports shows individual, 2-, 3- and 5-man numbers for that scope.",
    "Rankings and Rotation are coming — they're placeholders for now.",
    "Small samples mislead — check how many possessions a group actually played.",
  ]),
  "analytics-goals": S("Analytics — Goals", "Season targets for each stat. Reports color a stat green, yellow or red against these.", [
    "Pick Us or Opponent, then set a target for each stat you care about.",
    "Choose the direction — higher is better, or lower is better (like turnovers).",
    "Leave an Opponent target blank to simply invert your Us target.",
    "Use ↑ ↓ and Save order to set the order stats appear in reports.",
  ]),
  gametracker: S("Game Tracker", "One tap-through per offensive trip, yours and theirs. Taps save on this device and sync in the background.", [
    "Pick how the trip started: Transition, Half-court, Press break or SLOB.",
    "Half court: Man set, Motion, Zone set or Unscripted, then the play call.",
    "Finish it: make or miss 2/3, turnover, FT trip, And-1 — or Foul/Jump/OOB if it's still your ball.",
    "Grade every shot. A miss asks whether you got the offensive rebound.",
    "← Back steps back a screen; Undo removes the last saved trip.",
    "End the period with End Q, and the game with Finish game.",
  ]),
  scoutsheets: S("Scout Sheets", "Opponent reports, one sheet per game. Players see a sheet once it's published.", [
    "Open a game's sheet from the Schedule (Scout sheet), or from an opponent here.",
    "Scouted them before? Copy last sheet brings their roster, sets and defense.",
    "Publish when it's ready — players can't see drafts.",
    "Print gives a two-page sheet; the Quiz tab builds a scout quiz.",
  ]),
  scoutsheet: S("Scout Sheet", "Everything about this opponent for this game. Fields save as you type.", [
    "Roster: add their players, hand, markers, and who guards each.",
    "Tap a player's name for strengths, how to guard and attack, and notes.",
    "Offense and Specials: their sets, BLOBs and SLOBs — link a play to each.",
    "Defense: primary, secondary, press, and how they guard your inbounds.",
    "Keys to the game: up to five. [Bracket] a word to quiz it.",
    "Publish, Print, or open the Quiz tab.",
  ]),
  gameday: S("Game Day Sheets", "Your sideline call sheet — built once, carried all season.", [
    "Create a sheet, then + Add calls under each section — type the word you'll shout.",
    "Import pastes a list, or pulls calls straight from your plays.",
    "Drag to reorder within a section; rename or hide sections per sheet.",
    "Print view aims for one landscape page.",
    "Attach it to a game from the Schedule (Edit → Play sheet).",
  ]),
  quizzes: S("Quizzes", "Every quiz for your teams. Make one, check it, publish it, then use the results.", [
    "+ New quiz: Scout, Plays, Game review or Standalone.",
    "Open a draft to edit questions, add your own or a play question, and assign them.",
    "▶ Preview as a player before you publish.",
    "Publish quiz — the banner shows who can take it.",
    "Open a live quiz for results and re-teach flags.",
    "🔴 Run live to quiz the whole team on the TV.",
  ]),
  workouts: S("Workouts", "Drills players do on their own and log a score for. You set how each one scores.", [
    "Workouts live in groups; one group is active at a time.",
    "+ New workout: title, category, description, video, then the scoring type.",
    "Competitive drills rank within grade groups; points per rank default to 5 / 3 / 1.",
    "Go live makes a group active and notifies players — build the whole group first.",
  ]),
  library: S("Drill Library", "Every player drill, active or archived.", [
    "Search or filter by category.",
    "Open a drill to edit it or see its scores.",
    "Archived drills keep their scores — they're just hidden from players.",
  ]),
  leaderboard: S("Leaderboard", "Points for the current competition, ranked by grade group.", [
    "Tabs switch grade groups.",
    "Tap a player to see their scores.",
    "The crown queue lists ended competitions waiting to be crowned.",
    "Save a snapshot at the end of a block to keep its final standings.",
  ]),
  hof: S("Hall of Fame", "The best score ever logged on each drill, across every season.", [
    "Find a drill to see its record and who holds it.",
    "Records stand until someone beats them.",
  ]),
  lifting: S("Lifting", "Lifting programs players follow and log.", [
    "+ New program: start blank or from a ready-made one.",
    "Set visibility: Draft (coaches only), Public, or Specific players.",
    "Build each day from the exercise bank, with sets, reps, weight and rest.",
    "Team progress shows who's actually logging.",
  ]),
  challenges: S("Challenges", "Head to head, Class Clash, teams and engagement — all scored off workouts.", [
    "H2H shows the drills players can challenge on, and every challenge sent.",
    "Clash shows a grade-against-grade window (set up in Admin).",
    "Team stats shows who's sending, answering and winning challenges.",
  ]),
  players: S("Players & Rosters", "Accounts, teams, and the depth-chart planner.", [
    "Approve new signups — they're pending until you do.",
    "Edit a player's name, graduation year, home roster and jersey.",
    "Rosters: create teams, add players, archive seasonal ones.",
    "Team Designer: drag players into lanes and positions; Make cuts after tryouts.",
  ]),
  announcements: S("Announcements", "Send a message or notification to players.", [
    "Write the message and pick who it goes to.",
    "Sent announcements show in players' apps.",
  ]),
  settings: S("Settings", "Season mode, seasons, competitions and export. Changes here affect everyone.", [
    "Switch to In-season or Offseason in Season Mode.",
    "Reset & Archive closes out a season — crown and export first.",
    "Schedule competitions and choose Points or Practice wins.",
    "Download CSV saves the full leaderboard.",
  ]),
  admin: S("Admin", "Badges, XP, team competitions and Class Clash.", [
    "Create badges with a trigger and threshold — they award themselves.",
    "Turn XP on or off and set the perk ladder.",
    "Generate team competitions; preview before you confirm.",
    "Create and award a Class Clash.",
  ]),
  profile: S("Profile", "Your account.", [
    "Change your name, photo and password.",
    "Choose your home page and sidebar order in Settings.",
  ]),
};

const PLAYER: Record<string, Starter> = {
  schedule: S("Schedule", "Your team's games, practices and events.", [
    "Tap a practice with “Plan posted ›” to see the plan.",
    "Tap a game for its scout sheet and game report once your coach posts them.",
  ]),
  practiceschedule: S("Practices", "Practice plans your coach has posted.", [
    "Tap a practice to see its blocks, drills and your group.",
  ]),
  workouts: S("Workouts", "Drills to do on your own. Log a score to earn points.", [
    "Tap a drill to read it and watch its video.",
    "Do the drill, then log your score. Some drills have a stopwatch at the top — start it before you begin.",
    "Top three in your grade group earn points on competitive drills.",
    "Logging on consecutive days builds a streak.",
  ]),
  library: S("Drill Library", "Every drill your coach has posted.", [
    "Search or filter by category.",
    "Tap a drill to read it, watch it, or log a score.",
  ]),
  leaderboard: S("Leaderboard", "Where you rank for the current competition.", [
    "Tabs switch grade groups.",
    "Points come from your best scores on competitive drills.",
  ]),
  hof: S("Hall of Fame", "The best score ever on each drill.", [
    "Beat a record and your name goes up.",
  ]),
  lifting: S("Lifting", "Your lifting programs.", [
    "Open a program and pick today's day.",
    "Log the weight and reps you did for each set.",
    "Finish every day for your program summary.",
  ]),
  h2h: S("Head to Head", "Challenge a teammate on a drill.", [
    "Pick a drill and an opponent, do the drill and log your score.",
    "They have to do the same drill to answer it.",
    "The winner gets bonus points.",
  ]),
  plays: S("Plays", "Your team's playbooks and plays.", [
    "Open a playbook, then a play.",
    "Watch it step by step, or in 3D with Watch live.",
    "Read the coach's note under each step.",
    "“Test yourself on this playbook” has a quiz when your coach makes one.",
  ]),
  playdesigner: S("Play Designer", "Draw your own play. It saves as you go.", [
    "Place players, then drag from a player to draw what they do.",
    "+ Add step moves everyone to where their lines ended.",
    "Preview full play watches the whole thing.",
  ]),
  scoutsheets: S("Scout Sheets", "Reports on your next opponents.", [
    "Open the sheet for your next game.",
    "Check who you're guarding and the keys to the game.",
    "Take the scout quiz at the top if there is one.",
  ]),
  scoutsheet: S("Scout Sheet", "Your coach's report on this opponent.", [
    "Roster: who you're guarding and how to guard them.",
    "Keys to the game are what matters most.",
    "Take the scout quiz to check you know it.",
  ]),
  gamestats: S("Game Stats", "Reports from your games.", [
    "Open a game to see its report.",
    "Tap any stat to see what it means.",
  ]),
  quizzes: S("Quizzes", "Quizzes from your coaches — the scout, your plays and game reviews.", [
    "Start a quiz from To do. Some are due at tip-off.",
    "On a court question, watch the lead-up, then answer.",
    "For “Where do you go”, tap the court — you can tap again to move it.",
    "Missed questions go to your Review deck — practice until they clear.",
  ]),
  progress: S("Progress", "How your scores have changed over time.", [
    "Pick a drill to see your history.",
  ]),
  profile: S("Profile", "Your account, badges and perks.", [
    "See your badges, XP and the perks you've unlocked.",
    "Change your photo and password.",
  ]),
  more: S("More", "Everything that doesn't fit on the bottom bar.", [
    "Tap any item to open it.",
  ]),
};

/** The starter help for a page (falls back to the other audience, then generic). */
/** Every page players can open, for the editor's "Players see" picker. */
export const PLAYER_PAGES: { key: string; title: string }[] =
  Object.entries(PLAYER).map(([key, v]) => ({ key, title: v.title }));

// Coach screens whose player version lives under a different key.
const PLAYER_KEY_FOR: Record<string, string> = {
  practices: "practiceschedule",
  "analytics-games": "gamestats",
  "analytics-reports": "gamestats",
  "analytics-lineups": "gamestats",
  "analytics-goals": "gamestats",
};

/** The player page matching a coach page, or null when players have no version of it. */
export function playerKeyFor(key: string): string | null {
  if (PLAYER[key]) return key;
  return PLAYER_KEY_FOR[key] ?? null;
}

export function starterHelp(pageKey: string, audience: HelpAudience): Starter {
  const own = audience === "coach" ? COACH : PLAYER;
  return own[pageKey] ?? (audience === "coach" ? PLAYER[pageKey] : undefined)
    ?? S("Help", "Help for this page hasn't been written yet.", []);
}

// ── Loading and saving ──────────────────────────────────────────

const VALID_URL = /^https:\/\/[^\s/$.?#][^\s]*\.[^\s]+$/i;
export const isValidHelpUrl = (u: string) => VALID_URL.test(u.trim());

export async function getHelp(pageKey: string, audience: HelpAudience): Promise<HelpEntry> {
  const starter = starterHelp(pageKey, audience);
  const { data } = await supabase.from("help_pages").select("*").eq("page_key", pageKey).eq("audience", audience).maybeSingle();
  const row = data as any;
  let updatedBy: string | null = null;
  if (row?.updated_by) {
    const { data: p } = await supabase.from("profiles").select("name").eq("id", row.updated_by).maybeSingle();
    updatedBy = (p as any)?.name ?? null;
  }
  return {
    pageKey, audience,
    title: row?.title || starter.title,
    intro: row?.intro ?? starter.intro,
    steps: Array.isArray(row?.steps) && row ? row.steps : starter.steps,
    guideUrl: row?.guide_url ?? null,
    sheetUrl: row?.sheet_url ?? null,
    videoUrl: row?.video_url ?? null,
    edited: !!row,
    updatedBy,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function saveHelp(pageKey: string, audience: HelpAudience, c: HelpContent): Promise<void> {
  const clean = (u: string | null) => (u && u.trim() ? u.trim() : null);
  for (const u of [c.guideUrl, c.sheetUrl, c.videoUrl]) {
    if (u && u.trim() && !isValidHelpUrl(u)) throw new Error(`"${u}" doesn't look like a web link — it should start with https://`);
  }
  const { error } = await supabase.from("help_pages").upsert({
    page_key: pageKey, audience,
    title: c.title.trim() || null,
    intro: c.intro.trim(),
    steps: c.steps.map(s => s.trim()).filter(Boolean),
    guide_url: clean(c.guideUrl), sheet_url: clean(c.sheetUrl), video_url: clean(c.videoUrl),
  });
  if (error) throw new Error(error.message);
}

export async function resetHelp(pageKey: string, audience: HelpAudience): Promise<void> {
  const { error } = await supabase.from("help_pages").delete().eq("page_key", pageKey).eq("audience", audience);
  if (error) throw new Error(error.message);
}

// ── Which screen the ? is for ───────────────────────────────────
// A screen inside a page registers itself while it's mounted; the most
// recent one wins, and the page's own key is used when none is.

type TopicCtx = { stack: string[]; push: (k: string) => number; pop: (id: number) => void };
const HelpTopicContext = createContext<TopicCtx | null>(null);

export function HelpTopicProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<{ id: number; key: string }[]>([]);
  const next = useRef(1);
  const value = useMemo<TopicCtx>(() => ({
    stack: entries.map(e => e.key),
    push: (key: string) => { const id = next.current++; setEntries(es => [...es, { id, key }]); return id; },
    pop: (id: number) => setEntries(es => es.filter(e => e.id !== id)),
  }), [entries]);
  return createElement(HelpTopicContext.Provider, { value }, children);
}

/** Call in a screen's component: while it's on screen, ? opens this topic.
 *  Pass null to register nothing (e.g. while a child screen has its own help). */
export function useHelpTopic(key: string | null) {
  const ctx = useContext(HelpTopicContext);
  const pushRef = useRef(ctx?.push);
  const popRef = useRef(ctx?.pop);
  pushRef.current = ctx?.push;
  popRef.current = ctx?.pop;
  useEffect(() => {
    if (!key) return;
    const id = pushRef.current?.(key);
    return () => { if (id) popRef.current?.(id); };
  }, [key]);
}

/** The topic the ? should open: the newest registered screen, else the page. */
export function useCurrentHelpTopic(pageKey: string): string {
  const ctx = useContext(HelpTopicContext);
  return ctx?.stack.length ? ctx.stack[ctx.stack.length - 1] : pageKey;
}
