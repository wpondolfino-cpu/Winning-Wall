// src/components/CategoryManagerModal.tsx
// Add/rename/delete drill categories. Renaming cascades to every drill
// using that category (handled by the DB's ON UPDATE CASCADE); deleting
// is blocked while any drill still uses it.

import { useState, useEffect } from "react";
import { DrillCategory, getCategories, addCategory, renameCategory, deleteCategory } from "../lib/categories";

interface Props {
  onClose: () => void;
  onChanged: () => void; // let the parent (DrillLibrary) refresh its own category list
}

export default function CategoryManagerModal({ onClose, onChanged }: Props) {
  const [categories, setCategories] = useState<DrillCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setCategories(await getCategories());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    const { error } = await addCategory(newName);
    if (error) { setError(error); }
    else { setNewName(""); await load(); onChanged(); }
    setAdding(false);
  }

  async function handleRename(oldName: string) {
    setBusyName(oldName);
    setError(null);
    const { error } = await renameCategory(oldName, editValue);
    if (error) { setError(error); }
    else { setEditingName(null); await load(); onChanged(); }
    setBusyName(null);
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`Delete "${name}"? This only works if no drills currently use it.`)) return;
    setBusyName(name);
    setError(null);
    const { error } = await deleteCategory(name);
    if (error) { setError(error); }
    else { await load(); onChanged(); }
    setBusyName(null);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(420px, 96vw)", padding: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1 }}>🏷️ Manage Categories</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
          Used across the Drill Library, Random Drill, and Add Drill. Renaming updates every drill that uses it.
        </div>

        {error && (
          <div style={{ fontSize: 12, color: "#ff7b7b", marginBottom: 12, padding: "10px 12px", background: "rgba(255,60,60,0.08)", borderRadius: 8, border: "1px solid rgba(255,60,60,0.2)" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {categories.map(c => (
              <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                {editingName === c.name ? (
                  <>
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                      style={{ flex: 1, fontSize: 13, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", color: "var(--text)", fontFamily: "inherit", outline: "none" }} />
                    <button onClick={() => handleRename(c.name)} disabled={busyName === c.name}
                      style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                      {busyName === c.name ? "…" : "Save"}
                    </button>
                    <button onClick={() => setEditingName(null)} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{c.name}</div>
                    <button onClick={() => { setEditingName(c.name); setEditValue(c.name); }}
                      style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer", padding: "4px 6px" }}>
                      ✏️
                    </button>
                    <button onClick={() => handleDelete(c.name)} disabled={busyName === c.name}
                      style={{ background: "transparent", border: "none", color: "#ff7b7b", fontSize: 13, cursor: "pointer", padding: "4px 6px" }}>
                      {busyName === c.name ? "…" : "🗑"}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New category name"
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            style={{ flex: 1, fontSize: 13, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 10px", color: "var(--text)", fontFamily: "inherit", outline: "none" }} />
          <button onClick={handleAdd} disabled={adding || !newName.trim()}
            style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", opacity: adding || !newName.trim() ? 0.6 : 1 }}>
            {adding ? "…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
