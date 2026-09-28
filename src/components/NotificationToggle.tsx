// src/components/NotificationToggle.tsx
//
// My Profile: turn push notifications on or off for THIS device, any time
// -- so a "Not now" or a mis-tap on the first prompt isn't permanent.
// A subscription belongs to the device, so a phone and a laptop are set
// separately.

import { useEffect, useState } from "react";
import { getPushState, setPushEnabled, PushState } from "../lib/onesignal";

const HELP: Record<Exclude<PushState, "on" | "off">, string> = {
  blocked: "Notifications are blocked for this app. Turn them back on in your phone's or browser's settings (Notifications → Winning Wall), then come back here.",
  "needs-install": "On iPhone and iPad, notifications only work from the Home Screen app. In Safari, tap Share → Add to Home Screen, open it from there, then turn this on.",
  unsupported: "This browser can't show notifications. Try Chrome, Edge or Safari, or the Home Screen app on your phone.",
};

export default function NotificationToggle({ playerId }: { playerId: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getPushState().then(setState); }, []);

  async function flip() {
    if (state !== "on" && state !== "off") return;
    setBusy(true);
    setState(await setPushEnabled(state === "off", playerId));
    setBusy(false);
  }

  const on = state === "on";
  const usable = state === "on" || state === "off";

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 20 }}>🔔</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Notifications</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {state == null ? "Checking…" : on ? "On for this device" : usable ? "Off for this device" : "Not available here"}
          </div>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label="Notifications" onClick={flip} disabled={!usable || busy}
          style={{ width: 46, height: 26, borderRadius: 13, border: "none", position: "relative", flexShrink: 0,
                   background: on ? "var(--royal)" : "var(--surface)", outline: "1px solid var(--border)",
                   cursor: usable && !busy ? "pointer" : "default", opacity: usable ? 1 : 0.5, transition: "background 0.15s" }}>
          <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%",
                         background: "#fff", transition: "left 0.15s" }} />
        </button>
      </div>
      {state && !usable && (
        <div style={{ fontSize: 12, color: "#ff8c42", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", lineHeight: 1.5 }}>
          {HELP[state as keyof typeof HELP]}
        </div>
      )}
    </div>
  );
}
