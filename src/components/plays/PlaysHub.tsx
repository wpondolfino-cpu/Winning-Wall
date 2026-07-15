// src/components/plays/PlaysHub.tsx
// Ties PlayViewer and PlayEditor together for a single nav tab: browse/
// watch by default, switch to the editor to draw a new play or edit an
// existing one you own.

import { useState } from "react";
import PlayViewer from "./PlayViewer";
import PlayEditor from "./PlayEditor";
import { Play } from "../../lib/plays";

interface Props {
  currentUserRole: "player" | "coach" | "admin";
}

export default function PlaysHub({ currentUserRole }: Props) {
  const [editing, setEditing] = useState<Play | "new" | null>(null);

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

  return (
    <PlayViewer
      onCreateNew={() => setEditing("new")}
      onEdit={(p) => setEditing(p)}
    />
  );
}
