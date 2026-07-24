// src/lib/plays.ts
// Types + CRUD for the play-drawing feature: plays, play_shares,
// saved_actions, playbooks, playbook_plays, playbook_shares.
// Mirrors the style of workouts.ts / teams.ts — thin wrappers around
// supabase-js, no business logic beyond what the DB/RLS already enforces.

import { supabase } from "./supabase";

// ── Court templates ─────────────────────────────────────────
export const COURT_TEMPLATES = ["half", "full", "baseline_oob", "sideline_oob"] as const;
export type CourtTemplate = typeof COURT_TEMPLATES[number];

export const COURT_TEMPLATE_LABELS: Record<CourtTemplate, string> = {
  half: "Half court",
  full: "Full court",
  baseline_oob: "Baseline out-of-bounds",
  sideline_oob: "Sideline out-of-bounds",
};

// ── Play data shape (stored as jsonb in plays.data / saved_actions.data) ─
// Coordinates are in a 600x420 court-space grid regardless of template,
// same as the prototype — the SVG background swaps per court_template,
// the coordinate system stays constant so saved actions/forks stay valid
// across templates.

export type ActionType = "move" | "pass" | "dribble" | "screen" | "shot" | "lob";

export interface PlayPoint { x: number; y: number; }

export interface PlayAction {
  type: ActionType;
  x1: number; y1: number;
  x2: number; y2: number;
  /** Optional curve control point — drag the line's midpoint handle (Move tool) to bow it into a curl. Straight when absent. */
  curve?: { x: number; y: number };
  /** The player performing this action — auto-detected by proximity to (x1,y1) when drawn. Drives "add step" carry-forward for cuts/dribbles. */
  sourcePlayerId?: string;
  /** For passes — the player this action ends at, auto-detected by proximity to (x2,y2). Drives ball-possession carry-forward. */
  targetPlayerId?: string;
  /**
   * This action's position (0-based) in its source player's ordered
   * sequence within this step — e.g. a screen (0) then a roll (1) for the
   * same player in one beat. Undefined/0 for a player's only action.
   * Carry-forward and animation always use the highest-indexed action for
   * a given player as their true final destination for the step.
   */
  sequenceIndex?: number;
}

/** All of a given player's actions in a frame, in sequence order (lowest sequenceIndex first). */
export function playerActionSequence(frame: PlayFrame, playerId: string): PlayAction[] {
  return frame.actions
    .filter((a) => a.sourcePlayerId === playerId)
    .sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
}

/**
 * Given the whole beat's overall progress (0-1), returns this action's own
 * local progress (0-1) within its slice of that timeline — e.g. a screen
 * (index 0 of 2) plays across the first half of the beat, a roll (index 1
 * of 2) across the second half. Before its slice starts, local progress is
 * 0 (sits at its own start); after its slice ends, it's 1 (sits at its own
 * end) — so a player's actions appear to flow continuously into each
 * other rather than all animating across the full beat at once.
 */
export function localActionProgress(globalT: number, action: PlayAction, frame: PlayFrame): number {
  if (!action.sourcePlayerId) return globalT;
  const seq = playerActionSequence(frame, action.sourcePlayerId);
  const total = seq.length;
  if (total <= 1) return globalT;
  const idx = action.sequenceIndex ?? 0;
  const sliceSize = 1 / total;
  const sliceStart = idx * sliceSize;
  if (globalT < sliceStart) return 0;
  if (globalT > sliceStart + sliceSize) return 1;
  return (globalT - sliceStart) / sliceSize;
}

/** Generates a stable id for a newly-placed player. Not cryptographically meaningful — just needs to be unique within a play. */
export function genPlayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** A freehand-drawn stroke — a raw list of points, for annotations that don't fit the straight-line action types. */
export interface PlayDrawing {
  points: PlayPoint[];
}

export interface PlayPlayer {
  /** Stable identity across every step of this play — set once when first placed, never regenerated. This is what lets a step's cut/pass endpoint carry a player's position (and ball possession) forward automatically. Optional for backward compatibility with plays saved before this existed. */
  id?: string;
  /** Jersey number shown on the icon. */
  num: number;
  x: number; y: number;
  /** Links to a real roster profile so the viewer can resolve their avatar. */
  profile_id?: string | null;
  /** Per-player override — shows an avatar even if the play-wide default is off. */
  showAvatar?: boolean;
  /** Marks this player as receiving a handoff at this point in the beat — stamp it on top of wherever a dribble/cut ends. */
  handoff?: boolean;
}

export interface PlayDefender {
  x: number; y: number;
}

/** A short text annotation placed on the court, e.g. "wait for screen". */
export interface PlayText {
  x: number; y: number;
  text: string;
}

/** A shaded rectangular zone, e.g. a spacing or help-defense area. */
export interface PlayZone {
  x: number; y: number;
  w: number; h: number;
}

export interface PlayFrame {
  /** Optional label for this step, e.g. "Screen sets" / "Cut and pass". */
  label?: string;
  players: PlayPlayer[];
  defenders: PlayDefender[];
  ball: PlayPoint | null;
  /** If set, the ball's displayed position tracks this player (by id) instead of the stored ball.x/y — dragging that player brings the ball with them. Cleared automatically if the ball itself is dragged or re-placed. */
  ballHolderId?: string | null;
  actions: PlayAction[];
  /** Freehand strokes. Optional for backward compatibility with plays saved before this existed. */
  drawings?: PlayDrawing[];
  /** Text annotations. Optional for backward compatibility. */
  texts?: PlayText[];
  /** Shaded zones. Optional for backward compatibility. */
  zones?: PlayZone[];
  /** Practice-drill cone markers. Optional for backward compatibility. */
  cones?: PlayPoint[];
}

/**
 * Where a pass actually ends, for animation purposes — not necessarily the
 * fixed (x2,y2) recorded when it was drawn. If the receiver is also
 * cutting/dribbling/screening to a new spot in this same step (e.g. an
 * alley-oop, or any pass to someone who's also moving), the pass should
 * arrive wherever THEY end up, not a stale fixed point. Otherwise it lands
 * on the receiver's current position, in case they were moved after the
 * pass was drawn. Falls back to the action's own x2/y2 if there's no
 * resolvable target (legacy passes, or ones without a detected receiver).
 */
export function resolvePassEndpoint(frame: PlayFrame, action: PlayAction): { x: number; y: number } {
  if (action.type === "pass" && action.targetPlayerId) {
    const receiverMove = frame.actions.find(
      (a) => a.sourcePlayerId === action.targetPlayerId && (a.type === "move" || a.type === "dribble" || a.type === "screen")
    );
    if (receiverMove) return { x: receiverMove.x2, y: receiverMove.y2 };
    const receiver = frame.players.find((p) => p.id === action.targetPlayerId);
    if (receiver) return { x: receiver.x, y: receiver.y };
  }
  return { x: action.x2, y: action.y2 };
}

export interface PlayData {
  /** true = every player shows an avatar by default; false = numbered circles by default. */
  avatarsDefault: boolean;
  frames: PlayFrame[];
}

export function emptyPlayData(): PlayData {
  return {
    avatarsDefault: true,
    frames: [{ players: [], defenders: [], ball: null, actions: [], drawings: [] }],
  };
}

// ── Plays ────────────────────────────────────────────────────
export interface Play {
  id: string;
  created_by: string;
  title: string;
  tags: string[];
  court_template: CourtTemplate;
  data: PlayData;
  forked_from: string | null;
  /** Optional YouTube URL — e.g. game film of the team actually running this play. */
  video_url: string | null;
  /** Coach/admin-organizational category (e.g. "BLOBs") — see lib/playCategories.ts. Null for plays created before this existed, or any player-authored play. */
  category: string | null;
  created_at: string;
  updated_at: string;
}

export async function getMyPlays(): Promise<Play[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("plays")
    .select("*")
    .eq("created_by", user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Plays someone else has shared with the current user (active shares only). */
export async function getPlaysSharedWithMe(): Promise<(Play & { share_id: string; shared_by: string })[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("play_shares")
    .select("id, shared_by, viewed_at, plays(*)")
    .eq("shared_with", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row.plays, share_id: row.id, shared_by: row.shared_by }));
}

export async function createPlay(play: {
  title: string;
  tags?: string[];
  court_template?: CourtTemplate;
  data?: PlayData;
  forked_from?: string | null;
  video_url?: string | null;
  category?: string | null;
}): Promise<Play> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("plays")
    .insert({
      created_by: user.id,
      title: play.title,
      tags: play.tags ?? [],
      court_template: play.court_template ?? "half",
      data: play.data ?? emptyPlayData(),
      forked_from: play.forked_from ?? null,
      video_url: play.video_url ?? null,
      category: play.category ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Play;
}

export async function updatePlay(id: string, patch: Partial<Pick<Play, "title" | "tags" | "court_template" | "data" | "video_url" | "category">>) {
  const { error } = await supabase.from("plays").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePlay(id: string) {
  const { error } = await supabase.from("plays").delete().eq("id", id);
  if (error) throw error;
}

/** Duplicate a play as a new one owned by the current user — used for forking. Carries the video and category over as a starting point, same as every other field; the copy owner can clear it. */
export async function forkPlay(source: Play, newTitle?: string): Promise<Play> {
  return createPlay({
    title: newTitle ?? `${source.title} (copy)`,
    tags: source.tags,
    court_template: source.court_template,
    data: source.data,
    forked_from: source.id,
    video_url: source.video_url,
    category: source.category,
  });
}

// ── Play shares ──────────────────────────────────────────────
export interface PlayShareTarget {
  id: string;
  name: string;
}

/** Share a play directly with another profile (e.g. a player sharing with their coach). */
export async function sharePlay(playId: string, sharedWithId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("play_shares")
    .upsert(
      { play_id: playId, shared_by: user.id, shared_with: sharedWithId, revoked_at: null },
      { onConflict: "play_id,shared_with" }
    );
  if (error) throw error;

  try {
    await supabase.functions.invoke("send-push", {
      body: {
        title: "🏀 A play was shared with you",
        message: "Someone shared a play with you on Winning Wall.",
        playerIds: [sharedWithId],
      },
    });
  } catch (e) { console.error("Push notification failed to send:", e); }
}

/** Player revoking a coach's (or anyone's) access to one of their plays. */
export async function revokePlayShare(shareId: string) {
  const { error } = await supabase.from("play_shares").update({ revoked_at: new Date().toISOString() }).eq("id", shareId);
  if (error) throw error;
}

export async function markPlayViewed(shareId: string) {
  const { error } = await supabase
    .from("play_shares")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", shareId)
    .is("viewed_at", null);
  if (error) console.error("Failed to mark play viewed:", error);
}

export async function getPlayShares(playId: string) {
  const { data, error } = await supabase
    .from("play_shares")
    .select("id, shared_with, viewed_at, created_at, revoked_at, profiles!play_shares_shared_with_fkey(name)")
    .eq("play_id", playId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Saved actions (reusable stamps like "Flare screen") ─────
export interface SavedAction {
  id: string;
  created_by: string;
  name: string;
  category: string | null;
  data: PlayFrame;
  created_at: string;
}

export async function getMySavedActions(): Promise<SavedAction[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("saved_actions")
    .select("*")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSavedAction(name: string, frame: PlayFrame, category?: string): Promise<SavedAction> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("saved_actions")
    .insert({ created_by: user.id, name, category: category ?? null, data: frame })
    .select()
    .single();
  if (error) throw error;
  return data as SavedAction;
}

export async function deleteSavedAction(id: string) {
  const { error } = await supabase.from("saved_actions").delete().eq("id", id);
  if (error) throw error;
}

// ── Playbooks ────────────────────────────────────────────────
export type PlaybookStatus = "draft" | "active" | "archived";

export interface Playbook {
  id: string;
  name: string;
  description: string | null;
  status: PlaybookStatus;
  created_by: string;
  /** Optional YouTube URL — a higher-level walkthrough covering the whole playbook. */
  video_url: string | null;
  created_at: string;
}

export async function getPlaybooks(): Promise<Playbook[]> {
  const { data, error } = await supabase.from("playbooks").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Playbooks assigned to the current player (RLS already limits to active + shared). */
export async function getMyAssignedPlaybooks(): Promise<(Playbook & { share_id: string; viewed_at: string | null })[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("playbook_shares")
    .select("id, viewed_at, playbooks(*)")
    .eq("shared_with", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row.playbooks, share_id: row.id, viewed_at: row.viewed_at })).filter((p: any) => p.id);
}

export async function createPlaybook(name: string, description?: string, video_url?: string): Promise<Playbook> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("playbooks")
    .insert({ name, description: description ?? null, status: "draft", created_by: user?.id, video_url: video_url ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as Playbook;
}

export async function updatePlaybook(id: string, patch: Partial<Pick<Playbook, "name" | "description" | "video_url">>) {
  const { error } = await supabase.from("playbooks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function setPlaybookStatus(id: string, status: PlaybookStatus) {
  const { error } = await supabase.from("playbooks").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deletePlaybook(id: string) {
  const { error } = await supabase.from("playbooks").delete().eq("id", id);
  if (error) throw error;
}

// ── Playbook contents ────────────────────────────────────────
export async function getPlaybookPlays(playbookId: string): Promise<(Play & { sort_order: number })[]> {
  const { data, error } = await supabase
    .from("playbook_plays")
    .select("sort_order, plays(*)")
    .eq("playbook_id", playbookId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row.plays, sort_order: row.sort_order }));
}

export async function addPlayToPlaybook(playbookId: string, playId: string, sortOrder = 0) {
  const { error } = await supabase.from("playbook_plays").upsert({ playbook_id: playbookId, play_id: playId, sort_order: sortOrder });
  if (error) throw error;
}

export async function removePlayFromPlaybook(playbookId: string, playId: string) {
  const { error } = await supabase.from("playbook_plays").delete().eq("playbook_id", playbookId).eq("play_id", playId);
  if (error) throw error;
}

// ── Playbook shares (publish targets) ────────────────────────
export async function getPlaybookShares(playbookId: string) {
  const { data, error } = await supabase
    .from("playbook_shares")
    .select("id, shared_with, viewed_at, created_at, profiles!playbook_shares_shared_with_fkey(name)")
    .eq("playbook_id", playbookId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Publish a playbook to a set of players, notifying each one once. */
export async function publishPlaybookTo(playbookId: string, playerIds: string[]) {
  if (playerIds.length === 0) return;
  const rows = playerIds.map((id) => ({ playbook_id: playbookId, shared_with: id }));
  const { error } = await supabase.from("playbook_shares").upsert(rows, { onConflict: "playbook_id,shared_with" });
  if (error) throw error;
  try {
    await supabase.functions.invoke("send-push", {
      body: {
        title: "📋 New playbook assigned",
        message: "A new playbook is ready for you to watch.",
        playerIds,
      },
    });
  } catch (e) { console.error("Push notification failed to send:", e); }
}

export async function unassignPlaybookFrom(playbookId: string, playerId: string) {
  const { error } = await supabase.from("playbook_shares").delete().eq("playbook_id", playbookId).eq("shared_with", playerId);
  if (error) throw error;
}

export async function markPlaybookViewed(shareId: string) {
  const { error } = await supabase
    .from("playbook_shares")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", shareId)
    .is("viewed_at", null);
  if (error) console.error("Failed to mark playbook viewed:", error);
}

// ── Roster lookup (for the jersey-number picker) ─────────────
export interface RosterPlayer {
  id: string;
  name: string;
  jersey: number | null;
  avatar_url: string | null;
}

export async function getRoster(): Promise<RosterPlayer[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,name,jersey,avatar_url")
    .eq("role", "player")
    .order("jersey", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/** All staff (coach/admin) — used to populate "share with coach" pickers. */
export async function getStaff(): Promise<PlayShareTarget[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,name")
    .in("role", ["coach", "admin"])
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
