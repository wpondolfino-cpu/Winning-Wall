// src/components/shared/VideoUrlNote.tsx
// The line that appears under a video URL field when the link won't play.
//
// Every video player in the app is a YouTube embed, but the fields store
// whatever you type — so a Vimeo or Hudl link saves fine and then just
// doesn't render, with nothing on screen explaining why. This is the
// explanation, shown at the moment of pasting rather than discovered
// later.
//
// Renders nothing at all when the field is empty or the link is fine, so
// it can be dropped under any video input unconditionally.

import { videoUrlWarning } from "../../lib/youtube";

export default function VideoUrlNote({ url }: { url?: string | null }) {
  const warning = videoUrlWarning(url);
  if (!warning) return null;
  return (
    <div style={{ fontSize: 11, color: "var(--gold)", lineHeight: 1.4, marginTop: 4 }}>
      {warning}
    </div>
  );
}
