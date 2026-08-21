// src/components/plays/PlaysHub.tsx
// Ties PlayViewer, PlayEditor and PlaybookManager together for a single
// nav tab: browse/watch by default, switch to the editor to draw a new
// play or edit an existing one you own, or switch to Playbooks to
// organise them.
//
// Playbooks used to be its own nav item sitting next to Plays with a
// near-identical icon. A playbook has no independent existence -- it's a
// collection of plays, and the only reason to open it is to organise
// plays drawn here -- so two top-level items were describing one body of
// content.

import { useState } from "react";
import PlayViewer from "./PlayViewer";
import PlayEditor from "./PlayEditor";
import PlaybookManager from "../coach/PlaybookManager";
import { Play } from "../../lib/plays";

interface Props {
  currentUserRole: "player" | "coach" | "admin";
}

export default function PlaysHub({ currentUserRole }: Props) {
  const [editing, setEditing] = useState<Play | "new" | null>(null);
  const [tab, setTab] = useState<"plays" | "playbooks">("plays");

  // The editor takes the whole screen — showing tabs above a drawing
  // canvas would invite losing unsaved work to a stray tap.
  if (editing) {
    return (
      <PlayEditor
        existingPlay={editing === "new" ? undefined : editing}
        currentUserRole={currentUserRole}
        onSaved={() => setEditing(null)}
        onClose={() => setEditing(null)}
      />
    );
  }

  const canManage = currentUserRole === "coach" || currentUserRole === "admin";

  return (
    <div>
      {canManage && (
        <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "var(--surface2)", borderRadius: 10, padding: 4, width: "fit-content" }}>
          {(["plays", "playbooks"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                background: tab === t ? "var(--royal)" : "transparent",
                color: tab === t ? "#fff" : "var(--muted)",
              }}
            >
              {t === "plays" ? "🏀 Plays" : "📋 Playbooks"}
            </button>
          ))}
        </div>
      )}

      {tab === "playbooks" && canManage ? (
        <PlaybookManager />
      ) : (
        <PlayViewer
          currentUserRole={currentUserRole}
          onCreateNew={() => setEditing("new")}
          onEdit={(p) => setEditing(p)}
        />
      )}
    </div>
  );
}
