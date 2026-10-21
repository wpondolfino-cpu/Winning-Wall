// src/components/library/NewInSharedLibrary.tsx
// "New in Shared Library" -- what the platform admin has offered that this
// program hasn't added or put off yet. Head coaches only (the database
// returns nothing for anyone else, so this renders nothing for them).

import { useEffect, useState } from "react";
import { KIND_LABEL, LibraryKind, NewItem, loadNew, pickNew } from "../../lib/library";

const AFTER_ADD: Record<LibraryKind, string> = {
  drill: "It starts switched off, so publish it when you're ready.",
  team_drill: "",
  template: "Find it under 📋 Templates on the Practices page.",
  play: "",
  lifting: "It's a draft until you share it with players.",
};

export default function NewInSharedLibrary({ kinds, onAdded }: { kinds: LibraryKind[]; onAdded?: () => void }) {
  const [items, setItems] = useState<NewItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = kinds.join(",");

  useEffect(() => {
    let on = true;
    loadNew(kinds).then(v => { if (on) setItems(v); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!items || (items.length === 0 && !note)) return null;

  async function pick(it: NewItem, add: boolean) {
    setBusy(it.id); setErr(null);
    try {
      await pickNew(it.id, add);
      setItems(list => (list ?? []).filter(x => x.id !== it.id));
      if (add) {
        setNote(`Added "${it.title}". It's yours now; edit it like anything else. ${AFTER_ADD[it.kind]}`.trim());
        onAdded?.();
      }
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't do that.");
    } finally {
      setBusy(null);
    }
  }

  const btn = { height: 36, padding: "0 14px", borderRadius: 8, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" } as const;

  return (
    <div style={{ background: "rgba(26,63,168,0.10)", border: "1px solid rgba(147,180,255,0.30)", borderRadius: 14, padding: 14, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>✨ New in Shared Library</span>
        {items.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "rgba(147,180,255,0.18)", color: "var(--info-text)" }}>{items.length} new</span>
        )}
      </div>

      {items.map(it => (
        <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--surface2)", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{it.title}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{[KIND_LABEL[it.kind], it.meta].filter(Boolean).join(" · ")}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => pick(it, true)} disabled={busy === it.id}
              style={{ ...btn, border: 0, background: "var(--royal)", color: "#fff" }}>
              {busy === it.id ? "…" : "Add"}
            </button>
            <button onClick={() => pick(it, false)} disabled={busy === it.id}
              style={{ ...btn, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}>
              Not now
            </button>
          </div>
        </div>
      ))}

      {items.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>You're all caught up.</div>}
      {note && <div style={{ fontSize: 12, color: "var(--success-text)" }}>{note}</div>}
      {err && <div style={{ fontSize: 12, color: "var(--danger-text-2)" }}>{err}</div>}
    </div>
  );
}
