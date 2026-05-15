// src/components/InstallPrompt.tsx
// Shows a banner prompting users to install the PWA on their home screen.
// Appears automatically on Android. On iPhone it shows manual instructions.

import { useEffect, useState } from "react";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already installed (running in standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Don't show if user already dismissed
    if (localStorage.getItem("pwa-dismissed")) return;

    const ios = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
    setIsIOS(ios);

    if (ios) {
      // Show manual instructions for iPhone after a short delay
      setTimeout(() => setShowBanner(true), 3000);
    } else {
      // Android/Chrome: listen for the browser's install prompt
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setShowBanner(true);
      };
      window.addEventListener("beforeinstallprompt", handler);
      return () => window.removeEventListener("beforeinstallprompt", handler);
    }
  }, []);

  function dismiss() {
    setShowBanner(false);
    setDismissed(true);
    localStorage.setItem("pwa-dismissed", "1");
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setShowBanner(false);
    setDeferredPrompt(null);
  }

  if (!showBanner || dismissed) return null;

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 999,
      background: "var(--surface)",
      borderTop: "1px solid var(--border)",
      padding: "16px 20px",
      display: "flex", alignItems: "flex-start", gap: 14,
      boxShadow: "0 -8px 32px rgba(0,0,0,0.4)",
    }}>
      {/* Icon */}
      <img src="/icons/icon-192.png" alt="App icon" style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0 }} />

      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 3 }}>
          Install AHS Winning Wall
        </div>
        {isIOS ? (
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Tap the <strong style={{ color: "var(--silver-light)" }}>Share button</strong> at the bottom of Safari, then tap{" "}
            <strong style={{ color: "var(--silver-light)" }}>"Add to Home Screen"</strong> to install the app.
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Add to your home screen for the full app experience.
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        {!isIOS && (
          <button
            onClick={install}
            style={{
              background: "var(--royal)", color: "#fff", border: "none",
              borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600,
              fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          style={{
            background: "none", color: "var(--muted)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "6px 14px", fontSize: 12,
            fontFamily: "inherit", cursor: "pointer",
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
