// src/lib/youtube.ts
// Single source of truth for pulling a YouTube video ID out of a URL —
// previously copy-pasted identically into 7 different files (drill
// library, practice drill library, playbook manager, random drill
// modal, plays, and lifting). Every one of those now imports this
// instead of keeping its own copy, so a future tweak to the regex only
// has to be made once.

export function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  // Covers every shape a coach actually pastes:
  //   watch?v=ID          the normal address bar URL
  //   youtu.be/ID         the Share button's short link
  //   shorts/ID           a Short
  //   embed/ID            what you get from "Copy embed code" — this one
  //                       used to fail silently, which was confusing
  //                       because it IS a YouTube link
  //   live/ID             a livestream or its archive
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([^&?/\s]+)/);
  return match ? match[1] : null;
}

/**
 * Whether a pasted video URL will actually play in the app.
 *
 * Video fields store whatever you type, but every player in the app is a
 * YouTube embed — so a Vimeo or Hudl link saves fine and then simply
 * doesn't render, with nothing on screen to say why. This is what the
 * inputs use to warn at the point of pasting instead.
 *
 * Returns null when there's nothing to say (empty field, or a URL we can
 * read), and a short message when the link won't play.
 */
export function videoUrlWarning(url?: string | null): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;              // empty is fine — these fields are optional
  if (getYouTubeId(trimmed)) return null; // we can read it, it'll play

  // Name the service where we can, so the message is actionable rather
  // than just "no".
  const lower = trimmed.toLowerCase();
  if (lower.includes("vimeo.")) {
    return "Vimeo links don't play here — only YouTube. Upload it to YouTube as unlisted and paste that link instead.";
  }
  if (lower.includes("hudl.com")) {
    return "Hudl links don't play here — only YouTube. Hudl game film can't be embedded elsewhere at all, so it would need re-uploading to YouTube as unlisted.";
  }
  if (lower.includes("drive.google.") || lower.includes("dropbox.")) {
    return "File-sharing links don't play here — only YouTube. Upload it to YouTube as unlisted and paste that link instead.";
  }
  if (lower.includes("youtube.") || lower.includes("youtu.be")) {
    // A YouTube link we still couldn't read — a channel, a playlist, a
    // search. Worth its own message so it doesn't read as "YouTube isn't
    // supported", which would be nonsense.
    return "This looks like a YouTube link, but not to a single video. Open the video itself and copy the link from the address bar.";
  }
  return "This doesn't look like a YouTube link, so the video won't show. Only YouTube plays here.";
}

// ── Start / stop times ──────────────────────────────────────────
// A video can be cued to a clip: "start at 2:50, stop at 3:40". The times
// live in the saved link itself (…?v=ID&t=170&end=220), so every place a
// link is copied — the shared library, exports, adopting a playbook —
// carries them along with no extra fields. YouTube's own watch page
// honours t= too, so "open in YouTube" links land on the same spot.

/** "2:50" -> 170, "1:02:03" -> 3723, "95" -> 95. Blank -> null. Unreadable -> NaN. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const [, h, mi, s] = m;
  if (Number(s) > 59 || (h !== undefined && Number(mi) > 59)) return NaN;
  return (h ? Number(h) * 3600 : 0) + Number(mi) * 60 + Number(s);
}

/** 170 -> "2:50", 3723 -> "1:02:03". */
export function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** YouTube's t= forms: "170", "170s", "2m50s", "1h2m3s". */
function readT(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+s?$/.test(v)) return parseInt(v, 10);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

function splitUrl(url: string): { base: string; params: URLSearchParams; hash: string } {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const q = noHash.indexOf("?");
  return { base: q >= 0 ? noHash.slice(0, q) : noHash, params: new URLSearchParams(q >= 0 ? noHash.slice(q + 1) : ""), hash };
}

/** The clip times saved in a link (start from t= or start=, stop from end=). */
export function videoTimes(url?: string | null): { start: number | null; end: number | null } {
  if (!url) return { start: null, end: null };
  const { params, hash } = splitUrl(url.trim());
  const start = readT(params.get("t")) ?? readT(params.get("start")) ?? readT(new URLSearchParams(hash.replace(/^#/, "")).get("t"));
  const end = readT(params.get("end"));
  return { start: start && start > 0 ? start : null, end: end && end > 0 ? end : null };
}

/** The link without any clip times — what the link box shows. */
export function stripVideoTimes(url: string): string {
  const { base, params, hash } = splitUrl(url.trim());
  params.delete("t"); params.delete("start"); params.delete("end");
  const q = params.toString();
  const h = hash.replace(/(^#|&)t=[^&]*/g, "").replace(/^#&?$/, "");
  return base + (q ? `?${q}` : "") + (h && h !== "#" ? h : "");
}

/** The link with these clip times saved into it. */
export function withVideoTimes(url: string, start: number | null, end: number | null): string {
  const now = videoTimes(url);
  // Nothing to add or take away: leave the link exactly as typed.
  if (!start && !end && !now.start && !now.end) return url.trim();
  const clean = stripVideoTimes(url);
  if (!clean) return "";
  const { base, params, hash } = splitUrl(clean);
  if (start && start > 0) params.set("t", String(start));
  if (end && end > 0) params.set("end", String(end));
  const q = params.toString();
  return base + (q ? `?${q}` : "") + hash;
}

/** "Starts at 2:50" / "Clip 2:50–3:40" / "Plays to 3:40", or null with no times. */
export function videoClipLabel(url?: string | null): string | null {
  const { start, end } = videoTimes(url);
  if (start && end && end > start) return `Clip ${formatClock(start)}–${formatClock(end)}`;
  if (start) return `Starts at ${formatClock(start)}`;
  if (end) return `Plays to ${formatClock(end)}`;
  return null;
}

/** The player address for a saved link, cued to its clip. Empty if it isn't a YouTube video. */
export function youTubeEmbedUrl(url?: string | null): string {
  const id = getYouTubeId(url);
  if (!id) return "";
  const { start, end } = videoTimes(url);
  let src = `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
  if (start) src += `&start=${start}`;
  if (end && (!start || end > start)) src += `&end=${end}`;
  return src;
}
