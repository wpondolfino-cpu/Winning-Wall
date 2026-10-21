// src/components/library/AddToSharedLibrary.tsx
// "📚 Add to Shared Library" -- shown only to the platform admin. Saves a
// copy into the Shared Library; the original stays where it is.

import { CSSProperties, MouseEvent, useEffect, useState } from "react";
import { LibraryKind, addToLibrary, inLibrary, usePlatformAdmin } from "../../lib/library";

const base: CSSProperties = {
  background: "rgba(240,192,64,0.10)", border: "1px solid rgba(240,192,64,0.35)", color: "var(--gold-text)",
  borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};

export default function AddToSharedLibrary({ kind, id, compact, style }: {
  kind: LibraryKind; id: string;
  /** Icon-only, for crowded rows. */
  compact?: boolean;
  style?: CSSProperties;
}) {
  const admin = usePlatformAdmin();
  const [state, setState] = useState<"idle" | "saving" | "in">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let on = true;
    setState("idle"); setMsg(null);
    inLibrary([id]).then(s => { if (on && s.has(id)) setState("in"); });
    return () => { on = false; };
  }, [admin, id]);

  if (!admin) return null;

  async function add(e: MouseEvent) {
    e.stopPropagation();
    if (state !== "idle") return;
    setState("saving"); setMsg(null);
    try {
      const r = await addToLibrary(kind, id);
      setState("in");
      setMsg(r.status === "already" ? "Already in the Shared Library." : "Added. Turn on Starter pack or Offered on the Shared Library page.");
    } catch (err: any) {
      setState("idle");
      setMsg(err?.message ?? "Couldn't add it.");
    }
  }

  const label = state === "in" ? (compact ? "📚✓" : "✓ In Shared Library")
    : state === "saving" ? (compact ? "…" : "Adding…")
    : (compact ? "📚" : "📚 Add to Shared Library");

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button onClick={add} disabled={state !== "idle"}
        title={state === "in" ? "In the Shared Library" : "Add a copy to the Shared Library (only you see this)"}
        aria-label={state === "in" ? "In the Shared Library" : "Add to Shared Library"}
        style={{ ...base, ...(state === "in" ? { opacity: 0.75, cursor: "default" } : {}), ...style }}>
        {label}
      </button>
      {msg && !compact && <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: 260 }}>{msg}</span>}
    </span>
  );
}
