// src/components/messages/CoachMessages.tsx
// A head coach's conversation with Winning Wall (the platform admin), on
// their Settings page. One conversation per program (migration 191).

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import MessageThread from "./MessageThread";

export default function CoachMessages({ programId, onRead }: { programId: string | null; onRead?: () => void }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!programId) return;
    supabase.from("programs").select("name").eq("id", programId).single()
      .then(({ data }: any) => setName(data?.name ?? "your program"));
  }, [programId]);
  if (!programId || name === null) return null;
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#93b4ff", letterSpacing: 1 }}>💬 Message Winning Wall</div>
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 14px" }}>
        Questions, problems or ideas for {name}. Only {name}'s head coaches see this conversation.
      </div>
      <MessageThread programId={programId} programName={name} asPlatform={false} onActivity={onRead} />
    </div>
  );
}
