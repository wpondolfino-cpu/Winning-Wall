// src/lib/liveQuiz.ts
// Live team-meeting mode (migration 168).
//
// Every state change goes through a database function; Realtime only
// carries "something changed" pings on a per-session broadcast channel,
// and each screen then asks the server for the state. So a ping can't
// carry a fake score or an answer key -- there's nothing in it to trust.
// Phones open the channel only while they're in a session.

import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import type { QuizVisual, QuizReveal, TapPoint, PlayQType } from "./quizzes";

export type LiveStatus = "lobby" | "question" | "reveal" | "scoreboard" | "ended";

export interface LiveQuestion {
  question_id: string;
  prompt: string;
  qtype: PlayQType | null;
  visual: QuizVisual | null;
  options: { id: string; label: string }[];
}

export interface LiveBoardRow { player_id: string; name: string; correct: number; ms: number; rank: number; }

export interface LiveHostState {
  id: string;
  quiz_id: string;
  status: LiveStatus;
  quiz_title: string;
  index: number;
  total: number;
  seconds: number;
  remaining: number | null;
  participants: string[];
  question: LiveQuestion | null;
  answered: number;
  counts: Record<string, number>;
  taps: { x: number; y: number; ok: boolean }[] | null;
  correct_count: number | null;
  key: {
    correct_option_id: string | null;
    correct_point: TapPoint | null;
    explanation: string | null;
    radius: number;
    reveal: QuizReveal | null;
  } | null;
  board: LiveBoardRow[] | null;
}

export interface LivePlayerState {
  id: string;
  status: LiveStatus;
  quiz_title: string;
  index: number;
  total: number;
  remaining: number | null;
  question: LiveQuestion | null;
  answered: boolean;
  my_correct: boolean | null;
  my_rank: LiveBoardRow | null;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

// ── Coach ──
export async function startLive(quizId: string, quizTitle: string): Promise<string> {
  const id = await rpc<string>("live_start", { p_quiz: quizId });
  // Tell the team. Best effort: the in-app banner covers anyone whose
  // notifications are off.
  try {
    const { data } = await supabase.rpc("quiz_roster", { p_quiz: quizId });
    const playerIds = ((data ?? []) as any[]).map(r => (typeof r === "string" ? r : r.quiz_roster ?? r.id)).filter(Boolean);
    if (playerIds.length) {
      await supabase.functions.invoke("send-push", {
        body: { title: "🔴 Live quiz starting", message: `${quizTitle} — tap to join`, playerIds, url: "/?tab=quizzes" },
      });
    }
  } catch { /* push is optional */ }
  return id;
}
export const advanceLive = (sessionId: string, action: "start" | "reveal" | "scoreboard" | "next" | "end") =>
  rpc<void>("live_advance", { p_session: sessionId, p_action: action });
export const getHostState = (sessionId: string) => rpc<LiveHostState>("live_host_state", { p_session: sessionId });

// ── Players ──
export const getMyLiveSessions = () =>
  rpc<{ id: string; quiz_title: string; status: LiveStatus }[]>("live_my_sessions").then(r => r ?? []);
export const joinLive = (sessionId: string) => rpc<void>("live_join", { p_session: sessionId });
export const getLiveState = (sessionId: string) => rpc<LivePlayerState>("live_state", { p_session: sessionId });
export const answerLive = (sessionId: string, questionId: string, optionId: string | null, point: TapPoint | null) =>
  rpc<{ recorded: boolean }>("live_answer", {
    p_session: sessionId, p_question: questionId, p_option: optionId, p_x: point?.x ?? null, p_y: point?.y ?? null,
  });

/**
 * Joins the session's broadcast channel while mounted. onPing runs when
 * another screen says something changed; returns a function to send one.
 * A slow poll backs it up, so a dropped connection only slows things down.
 */
export function useLiveChannel(sessionId: string | null, onPing: (event: string) => void, pollMs = 4000) {
  const sendRef = useRef<(event: string) => void>(() => {});
  const pingRef = useRef(onPing);
  pingRef.current = onPing;

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase.channel(`live-${sessionId}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "ping" }, (msg: any) => pingRef.current(String(msg?.payload?.kind ?? "state")));
    channel.subscribe();
    sendRef.current = (kind: string) => { channel.send({ type: "broadcast", event: "ping", payload: { kind } }); };
    const poll = window.setInterval(() => pingRef.current("poll"), pollMs);
    return () => {
      window.clearInterval(poll);
      sendRef.current = () => {};
      supabase.removeChannel(channel);
    };
  }, [sessionId, pollMs]);

  return (kind: string) => sendRef.current(kind);
}

/** Answer tile colours, the same on the projector and the phones. */
export const LIVE_COLORS = ["#2550D4", "#C2410C", "#15803D", "#7E22CE", "#0E7490"];
