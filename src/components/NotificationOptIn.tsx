// src/components/NotificationOptIn.tsx
// A dismissible banner that asks players to enable push notifications.
// Uses our own copy (not OneSignal's dashboard-configured prompt) and
// requests permission directly from the button tap — this is required
// for the permission request to work on iOS 16.4+ installed PWAs.

import { useEffect, useState } from "react";
import { isPushSubscribed, requestPushPermission } from "../lib/onesignal";

interface Props {
  playerId: string;
}

const DISMISS_KEY = "ww_notif_prompt_dismissed";

export default function NotificationOptIn({ playerId }: Props) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "granted" | "denied">("idle");

  useEffect(() => {
    let cancelled = false;
    isPushSubscribed().then((subscribed) => {
      if (cancelled) return;
      const dismissed = localStorage.getItem(DISMISS_KEY) === "true";
      setVisible(!subscribed && !dismissed);
    });
    return () => { cancelled = true; };
  }, []);

  async function handleEnable() {
    setLoading(true);
    const granted = await requestPushPermission(playerId);
    setLoading(false);
    if (granted) {
      setStatus("granted");
      setTimeout(() => setVisible(false), 2500);
    } else {
      setStatus("denied");
    }
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: "rgba(26,63,168,0.12)", border: "1px solid rgba(26,63,168,0.35)",
      borderRadius: 12, padding: "12px 16px", marginBottom: 16,
    }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>🔔</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {status === "granted" ? "Notifications on! 🎉" : "Turn on notifications"}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {status === "granted"
            ? "You'll get pinged for challenges, new workouts, and leaderboard updates."
            : status === "denied"
            ? "Permission was blocked — you can turn it on later in your browser or phone's notification settings."
            : "Get notified about challenges, new workouts, and leaderboard updates — never miss a drop."}
        </div>
      </div>
      {status !== "granted" && (
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={handleDismiss} style={{
            background: "transparent", border: "none", color: "var(--muted)",
            fontSize: 12, fontFamily: "inherit", cursor: "pointer", padding: "8px 6px",
          }}>Not Now</button>
          <button onClick={handleEnable} disabled={loading} style={{
            background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8,
            padding: "8px 14px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
            cursor: loading ? "default" : "pointer", whiteSpace: "nowrap",
          }}>{loading ? "…" : "Turn On"}</button>
        </div>
      )}
    </div>
  );
}
