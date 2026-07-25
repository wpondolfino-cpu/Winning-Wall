// src/lib/youtube.ts
// Single source of truth for pulling a YouTube video ID out of a URL —
// previously copy-pasted identically into 7 different files (drill
// library, practice drill library, playbook manager, random drill
// modal, plays, and lifting). Every one of those now imports this
// instead of keeping its own copy, so a future tweak to the regex only
// has to be made once.

export function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/\s]+)/);
  return match ? match[1] : null;
}
