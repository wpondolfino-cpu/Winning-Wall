// src/components/shared/RichTextEditor.tsx
import { useRef } from "react";
import { insertBullet, insertNumbered, insertIndent } from "../../lib/richtext";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 70, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function lineBounds() {
    const el = ref.current;
    if (!el) return null;
    const val = el.value;
    const pos = el.selectionStart ?? val.length;
    let start = val.lastIndexOf("\n", pos - 1) + 1;
    let end = val.indexOf("\n", pos);
    if (end === -1) end = val.length;
    return { el, val, start, end };
  }
  function prependLine(fn: (line: string) => string) {
    const b = lineBounds();
    if (!b) return;
    const line = b.val.slice(b.start, b.end);
    onChange(b.val.slice(0, b.start) + fn(line) + b.val.slice(b.end));
    requestAnimationFrame(() => b.el.focus());
  }
  function insertAtCursor(text: string) {
    const el = ref.current;
    if (!el) { onChange(value + text); return; }
    const pos = el.selectionStart ?? value.length;
    onChange(value.slice(0, pos) + text + value.slice(pos));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = pos + text.length; });
  }
  function wrapBold() {
    const el = ref.current;
    if (!el) { insertAtCursor("**bold**"); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null || start === end) { insertAtCursor("**bold**"); return; }
    const sel = value.slice(start, end);
    onChange(value.slice(0, start) + "**" + sel + "**" + value.slice(end));
    requestAnimationFrame(() => el.focus());
  }
  function insertDivider() {
    const el = ref.current;
    const pos = el ? (el.selectionStart ?? value.length) : value.length;
    const prefix = pos > 0 && value[pos - 1] !== "\n" ? "\n" : "";
    insertAtCursor(prefix + "---\n");
  }

  const btnStyle: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" };

  return (
    <div>
      {!disabled && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
          <button type="button" onClick={() => prependLine(insertBullet)} style={btnStyle}>• Bullets</button>
          <button type="button" onClick={() => prependLine(insertNumbered)} style={btnStyle}>1. Numbered</button>
          <button type="button" onClick={() => insertAtCursor(" → ")} style={btnStyle}>→ Arrow</button>
          <button type="button" onClick={wrapBold} style={{ ...btnStyle, fontWeight: 700 }}>B Bold</button>
          <button type="button" onClick={() => prependLine(insertIndent)} style={btnStyle}>⇥ Indent</button>
          <button type="button" onClick={insertDivider} style={btnStyle}>— Divider</button>
        </div>
      )}
      <textarea ref={ref} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={{ width: "100%", minHeight, fontSize: 13 }} />
    </div>
  );
}
