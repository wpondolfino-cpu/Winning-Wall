// src/lib/onesignal.ts
// Thin wrapper around the OneSignal Web SDK (loaded via <script> tag in index.html).
//
// IMPORTANT — iOS 16.4+ only allows a push permission request that is
// triggered directly by a user tap (a click handler). It silently blocks
// any permission request fired automatically (e.g. on a page-load timer).
// So requestPushPermission() below must always be called from an onClick,
// never from a useEffect.

import { supabase } from "./supabase";

declare global {
  interface Window {
    OneSignalDeferred?: any[];
  }
}

function withOneSignal(fn: (OneSignal: any) => void) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(fn);
}

// ── Turning notifications off on this device ──────────────────
// A push subscription belongs to the device, not the account, so the
// choice is remembered per device. Without this, ensurePushTag() re-opted
// every permitted device in on each load and "off" never stuck.
const OFF_KEY = "ww_push_off";
function turnedOffHere(): boolean {
  try { return localStorage.getItem(OFF_KEY) === "true"; } catch { return false; }
}
function setTurnedOffHere(off: boolean) {
  try { off ? localStorage.setItem(OFF_KEY, "true") : localStorage.removeItem(OFF_KEY); } catch { /* private mode */ }
}

function recordSubscribed(playerId: string, on: boolean) {
  supabase.from("profiles").update({ push_subscribed: on }).eq("id", playerId)
    .then(({ error }) => { if (error) console.error("Failed to record push_subscribed:", error); });
}

/**
 * Where this device stands:
 *   on / off       -- the switch works
 *   blocked        -- the browser's prompt was answered Block; only the
 *                     phone's or browser's settings can undo that
 *   needs-install  -- iPhone/iPad in Safari: push only works once the app
 *                     is added to the Home Screen
 *   unsupported    -- this browser can't do push, or OneSignal didn't load
 */
export type PushState = "on" | "off" | "blocked" | "needs-install" | "unsupported";

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function getPushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return Promise.resolve("needs-install");
  if (!("Notification" in window)) return Promise.resolve("unsupported");
  if (Notification.permission === "denied") return Promise.resolve("blocked");
  return new Promise((resolve) => {
    // If OneSignal never loads (an ad blocker, say), don't hang forever.
    const t = setTimeout(() => resolve("unsupported"), 6000);
    withOneSignal((OneSignal) => {
      clearTimeout(t);
      const permitted = !!OneSignal.Notifications.permission;
      const optedIn = !!OneSignal.User?.PushSubscription?.optedIn;
      resolve(permitted && optedIn && !turnedOffHere() ? "on" : "off");
    });
  });
}

/**
 * The My Profile switch. Must be called from a tap: turning on may show
 * the browser's permission prompt, which iOS only allows from a click.
 */
export async function setPushEnabled(on: boolean, playerId: string): Promise<PushState> {
  if (on) {
    setTurnedOffHere(false);
    const granted = await requestPushPermission(playerId);
    if (!granted) return getPushState();
    return "on";
  }
  setTurnedOffHere(true);
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 6000);
    withOneSignal(async (OneSignal) => {
      try { await OneSignal.User.PushSubscription.optOut(); } catch (e) { console.error("Push opt-out failed:", e); }
      clearTimeout(t);
      resolve();
    });
  });
  recordSubscribed(playerId, false);
  return "off";
}

/** Resolves true once we know whether the browser has already granted permission. */
export function isPushSubscribed(): Promise<boolean> {
  return new Promise((resolve) => {
    withOneSignal((OneSignal) => {
      resolve(!!OneSignal.Notifications.permission);
    });
  });
}

/**
 * Triggers the native browser permission prompt. Must be called from a
 * click handler. On success, tags the subscriber with player_id so our
 * Edge Functions (e.g. notify-inactive) can target them by tag.
 */
export function requestPushPermission(playerId: string): Promise<boolean> {
  return new Promise((resolve) => {
    withOneSignal(async (OneSignal) => {
      try {
        await OneSignal.Notifications.requestPermission();
        const granted = !!OneSignal.Notifications.permission;
        if (granted) {
          // Custom (non-default) permission flows like ours need this
          // explicit opt-in call, or OneSignal may grant browser permission
          // without fully marking the subscription as "subscribed" server-side.
          setTurnedOffHere(false);
          await OneSignal.User.PushSubscription.optIn();
          await OneSignal.User.addTag("player_id", playerId);
          recordSubscribed(playerId, true);
        }
        resolve(granted);
      } catch (e) {
        console.error("Push permission request failed:", e);
        resolve(false);
      }
    });
  });
}

/**
 * Re-applies the player_id tag for anyone already subscribed. Safe to call
 * on every login — keeps the tag fresh even if they subscribed before this
 * feature existed, and is a no-op if permission was never granted.
 */
export function ensurePushTag(playerId: string) {
  // Turned off with the My Profile switch on this device: leave it off.
  if (turnedOffHere()) return;
  withOneSignal(async (OneSignal) => {
    try {
      if (OneSignal.Notifications.permission) {
        // Self-heal subscriptions that granted browser permission earlier
        // (e.g. during testing) but never got fully opted in server-side.
        await OneSignal.User.PushSubscription.optIn();
        await OneSignal.User.addTag("player_id", playerId);
        recordSubscribed(playerId, true);
      }
    } catch (e) {
      console.error("Failed to tag push subscriber:", e);
    }
  });
}
