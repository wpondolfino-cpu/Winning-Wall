// src/lib/onesignal.ts
// Thin wrapper around the OneSignal Web SDK (loaded via <script> tag in index.html).
//
// IMPORTANT — iOS 16.4+ only allows a push permission request that is
// triggered directly by a user tap (a click handler). It silently blocks
// any permission request fired automatically (e.g. on a page-load timer).
// So requestPushPermission() below must always be called from an onClick,
// never from a useEffect.

declare global {
  interface Window {
    OneSignalDeferred?: any[];
  }
}

function withOneSignal(fn: (OneSignal: any) => void) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(fn);
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
          await OneSignal.User.PushSubscription.optIn();
          await OneSignal.User.addTag("player_id", playerId);
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
  withOneSignal(async (OneSignal) => {
    try {
      if (OneSignal.Notifications.permission) {
        // Self-heal subscriptions that granted browser permission earlier
        // (e.g. during testing) but never got fully opted in server-side.
        await OneSignal.User.PushSubscription.optIn();
        await OneSignal.User.addTag("player_id", playerId);
      }
    } catch (e) {
      console.error("Failed to tag push subscriber:", e);
    }
  });
}
