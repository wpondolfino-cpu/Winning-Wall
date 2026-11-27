// src/components/parent/FamilyLinkCard.tsx
// My Profile (players): "Invite a parent". The link lets a parent make a
// parent account; a coach approves them before they see anything.
import { useState } from "react";
import { createFamilyInvite } from "../../lib/family";

export default function FamilyLinkCard({ playerId }: { playerId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function get(): Promise<string | null> {
    if (url) return url;
    setBusy(true); setMsg(null);
    try { const u = await createFamilyInvite(playerId); setUrl(u); return u; }
    catch (e: any) { setMsg(e?.message ?? "Couldn't make the link."); return null; }
    finally { setBusy(false); }
  }

  async function share() {
    const u = await get(); if (!u) return;
    const text = "Follow my team schedule on Winning Wall. Make a parent account with this link:";
    if (navigator.share) {
      try { await navigator.share({ title: "Winning Wall family link", text, url: u }); return; } catch { /* cancelled: fall through to copy */ }
    }
    copy(u);
  }

  async function copy(u?: string) {
    const link = u ?? await get(); if (!link) return;
    try { await navigator.clipboard.writeText(link); setMsg("Copied. Send it to your parent or guardian."); }
    catch { window.prompt("Your family link:", link); }
  }

  return (
    <div style={{ marginBottom: 16, padding: "14px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 24 }}>👪</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Invite a parent</div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            They'll see your schedule and the coaches' announcements for families. Not your stats, scores or messages. A coach approves them first.
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={share} disabled={busy}
          style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {busy ? "…" : "Send family link"}
        </button>
        <button onClick={() => copy()} disabled={busy}
          style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
          Copy
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
