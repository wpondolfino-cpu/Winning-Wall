// src/lib/richtext.ts
// Lightweight markup for workout descriptions: bullets, numbered lists,
// nested indent, bold, and a horizontal divider. Stored as plain text
// (backward compatible with every existing description — a description
// with none of this syntax just renders as plain paragraphs, identical
// to today). Rendered with the exact same function on desktop and
// mobile, so there's no separate "wrap point" per platform to break.
//
// Syntax:
//   - item          -> bullet
//   1. item         -> numbered
//   (two-space indent before - or 1.) -> nested one level deeper
//   ---             -> divider (its own line)
//   **text**        -> bold
//   Toolbar buttons insert this syntax; they don't require memorizing it.

export function insertBullet(line: string): string {
  return "- " + line;
}
export function insertNumbered(line: string): string {
  return "1. " + line;
}
export function insertIndent(line: string): string {
  return "  " + line;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  const escaped = escapeHtml(s);
  return escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

// Renders description markup to sanitized HTML (safe for
// dangerouslySetInnerHTML — all raw text is escaped before any tags
// are added back in for **bold**).
export function renderRichText(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  let html = "";
  const stack: { type: "ul" | "ol"; level: number }[] = [];

  function closeTo(level: number) {
    while (stack.length && stack[stack.length - 1].level >= level) {
      html += stack.pop()!.type === "ul" ? "</ul>" : "</ol>";
    }
  }

  for (const raw of lines) {
    if (raw.trim() === "---") {
      closeTo(0);
      html += '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:10px 0;" />';
      continue;
    }
    if (raw.trim() === "") { continue; }

    const bulletMatch = raw.match(/^(\s*)-\s?(.*)/);
    const numMatch = raw.match(/^(\s*)\d+\.\s?(.*)/);

    if (bulletMatch || numMatch) {
      const m = (bulletMatch ?? numMatch)!;
      const level = Math.floor(m[1].length / 2);
      const type: "ul" | "ol" = bulletMatch ? "ul" : "ol";

      while (
        stack.length &&
        (stack[stack.length - 1].level > level ||
          (stack[stack.length - 1].level === level && stack[stack.length - 1].type !== type))
      ) {
        html += stack.pop()!.type === "ul" ? "</ul>" : "</ol>";
      }
      if (!stack.length || stack[stack.length - 1].level < level) {
        html += type === "ul"
          ? '<ul style="margin:0 0 4px;padding-left:18px;">'
          : '<ol style="margin:0 0 4px;padding-left:18px;">';
        stack.push({ type, level });
      }
      html += `<li style="margin-bottom:4px;">${inline(m[2])}</li>`;
    } else {
      closeTo(0);
      html += `<p style="margin:4px 0;">${inline(raw)}</p>`;
    }
  }
  closeTo(0);
  return html;
}
