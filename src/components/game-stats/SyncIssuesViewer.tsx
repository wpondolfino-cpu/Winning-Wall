// src/components/game-stats/SyncIssuesViewer.tsx
// Shows every possession still sitting in the local offline queue for
// THIS device/browser, with a human-readable summary and, for anything
// that's actually failed, the real error message from Supabase. "Retry
// all" re-attempts every queued item (useful after a schema fix or once
// wifi comes back). "Discard" drops one permanently from the local queue
// without ever saving it -- for the rare case a record is unrecoverable
// and you'd rather just re-enter it live than leave it stuck forever.
//
// Important: this queue lives in this browser's IndexedDB, not on the
// server -- it only shows possessions queued on the device you're viewing
// this from. If you tracked a game on a different phone/tablet, its stuck
// queue only shows up when you open the app on THAT device.

import { useEffect, useState } from "react";
import {
  getQueuedPossessions,
  removeFromQueue,
  syncQueue,
  getLastSyncErrors,
  describePossession,
  type Possession,
} from "../../lib/gameStats";

export default function SyncIssuesViewer() {
  const [queued, setQueued] = useState<Possession[] | null>(null);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setQueued(await getQueuedPossessions());
    setErrors(getLastSyncErrors());
  }

  async function retryAll() {
    setRetrying(true);
    await syncQueue();
    await load();
    setRetrying(false);
  }

  async function discard(id: string) {
    if (!window.confirm("Discard this possession? It will never be saved -- this can't be undone.")) return;
    await removeFromQueue(id);
    await load();
  }

  if (queued === null) return <div className="card">Loading queue…</div>;

  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Sync queue (this device)</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {queued.length} queued{errors.length ? ` · ${errors.length} failed last attempt` : ""}
          </div>
        </div>
        <button className="btn-primary" style={{ width: "auto", padding: "6px 14px" }} onClick={retryAll} disabled={retrying || !queued.length}>
          {retrying ? "Retrying…" : "Retry all"}
        </button>
      </div>

      {queued.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Nothing queued — everything's synced.</div>}

      {queued.map((p) => {
        const err = errorFor(p.id);
        return (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border)", gap: 8, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14 }}>{describePossession(p)}</div>
              {err ? (
                <div style={{ fontSize: 12, color: "#c2402f", marginTop: 2 }}>{err}</div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>pending — hasn't been attempted yet, or waiting for connection</div>
              )}
            </div>
            <button
              style={{ padding: "6px 12px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "#8a2f2f", cursor: "pointer" }}
              onClick={() => discard(p.id)}
            >
              Discard
            </button>
          </div>
        );
      })}
    </div>
  );
}
