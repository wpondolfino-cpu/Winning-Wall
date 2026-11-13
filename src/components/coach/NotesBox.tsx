// src/components/coach/NotesBox.tsx
// A drill's notes in the practice builder: wraps so every point shows in
// full, grows as points are added, and keeps lists going -- Enter after
// "1) …" starts "2) ", after "- …" or "• …" another bullet; Enter on an
// empty number or bullet ends the list. Shift+Enter is a plain new line.
// Saved as plain text (one point per line) in the same goal_text field as
// before, so older one-line notes are unchanged.

import { useLayoutEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
  placeholder?: string;
}

export default function NotesBox({ value, onChange, onBlur, placeholder = "Add a note…" }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Where the cursor goes once a list edit has re-rendered.
  const caretAfter = useRef<number | null>(null);

  // Grow (or shrink) to fit the text, and put the cursor back after a list edit.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (caretAfter.current != null) {
      el.selectionStart = el.selectionEnd = caretAfter.current;
      caretAfter.current = null;
    }
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    const el = e.currentTarget;
    const pos = el.selectionStart;
    const before = el.value.slice(0, pos);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.slice(lineStart);
    const num = line.match(/^\s*(\d+)([.)])\s*/);
    const bullet = line.match(/^\s*([-•*])\s*/);
    const marker = num ?? bullet;
    if (!marker) return;                            // plain note: ordinary new line
    e.preventDefault();
    // Enter on an empty "3) " ends the list.
    if (line.trim() === marker[0].trim()) {
      const next = el.value.slice(0, lineStart) + el.value.slice(pos);
      caretAfter.current = lineStart;
      onChange(next);
      return;
    }
    const nextMarker = num ? `${parseInt(num[1], 10) + 1}${num[2]} ` : `${bullet![1]} `;
    const next = `${before}\n${nextMarker}${el.value.slice(pos)}`;
    caretAfter.current = pos + 1 + nextMarker.length;
    onChange(next);
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={e => { e.target.style.borderBottom = "1px dashed transparent"; onBlur(e.target.value); }}
      onFocus={e => { e.target.style.borderBottom = "1px dashed var(--border)"; }}
      title="Enter after 1) or - keeps the list going; Shift+Enter for a plain new line"
      style={{
        width: "100%", boxSizing: "border-box", resize: "none", overflow: "hidden",
        background: "transparent", border: "none", borderBottom: "1px dashed transparent",
        color: "var(--text)", fontSize: 12, lineHeight: 1.45, fontFamily: "inherit", outline: "none", padding: "2px 0",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}
    />
  );
}
