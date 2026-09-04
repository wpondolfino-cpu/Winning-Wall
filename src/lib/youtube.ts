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
