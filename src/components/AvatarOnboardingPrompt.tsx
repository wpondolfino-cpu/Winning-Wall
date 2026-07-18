// src/components/AvatarOnboardingPrompt.tsx
// A one-time, skippable prompt shown the first time a player lands in the
// app on an active account (after setting a real password, or right after
// coach/admin approval for self-registered players). Marks
// avatar_prompt_seen so it never reappears, whether they build one or skip.
import { useState } from "react";
import { Profile, markAvatarPromptSeen } from "../lib/supabase";
import AvatarBuilder from "./AvatarBuilder";

interface Props {
  profile: Profile;
  onDone: (updates: Partial<Profile>) => void;
}

export default function AvatarOnboardingPrompt({ profile, onDone }: Props) {
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSkip() {
    setBusy(true);
    try {
      await markAvatarPromptSeen(profile.id);
      onDone({ avatar_prompt_seen: true });
    } catch {
      // Non-critical — worst case the prompt shows again next login.
      onDone({ avatar_prompt_seen: true });
    }
  }

  async function handleSaved(url: string) {
    try { await markAvatarPromptSeen(profile.id); } catch { /* non-critical */ }
    onDone({ avatar_url: url, avatar_prompt_seen: true });
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0c14", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
        {building ? (
          <>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--text)", letterSpacing: 0.5, margin: "0 0 16px", textAlign: "center" }}>
              Build your avatar
            </h2>
            <AvatarBuilder profile={profile} onSaved={handleSaved} onCancel={() => setBuilding(false)} />
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--surface2)", margin: "0 auto 18px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "var(--muted)" }}>
              ?
            </div>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--text)", letterSpacing: 0.5, margin: "0 0 8px" }}>
              Set up your avatar
            </h2>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 22px" }}>
              Build a face that's really you — you'll see it in plays and on your profile.
            </p>
            <button
              onClick={() => setBuilding(true)}
              style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", background: "var(--royal)", color: "#fff", fontFamily: "inherit", fontWeight: 600, fontSize: 14, marginBottom: 10, cursor: "pointer" }}
            >
              Build my avatar
            </button>
            <button
              onClick={handleSkip}
              disabled={busy}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: "transparent", color: "var(--muted)", fontFamily: "inherit", fontSize: 13, cursor: busy ? "wait" : "pointer" }}
            >
              {busy ? "…" : "Skip for now"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
