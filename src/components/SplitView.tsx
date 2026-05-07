import { useState } from "react";
import { useSession } from "../state/session-context";
import { ScreenshotCard } from "./ScreenshotCard";
import { Lightbox } from "./Lightbox";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  onTakeNextScreenshot: () => void;
  onRequestDelete: (seq: number) => void;
}

/**
 * Detached transcript view. Visually distinct from InterleavedView mainly
 * by column proportions (transcript wider, image narrower by default) but
 * structurally identical: each row pairs a single image with its single
 * transcript, so screenshots vertically align with their transcripts —
 * if transcript 1 is tall, screenshot 2 bumps down to stay beside
 * transcript 2 (per user request 2026-05-03).
 *
 * Click any image to expand it (per-card toggle handled inside
 * ScreenshotCard); when expanded that card flips to image-wide.
 *
 * The previous SplitView with a separate "left thumbnails column +
 * right transcript column" rendered them as independent stacks — long
 * transcripts caused screenshots to misalign with their transcripts.
 */
export function SplitView({ onTakeNextScreenshot, onRequestDelete }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const [lightboxSeq, setLightboxSeq] = useState<number | null>(null);

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <div style={{ padding: 16 }}>
        {session.screenshots.map((s, i) => (
          <ScreenshotCard
            key={s.seq}
            screenshot={s}
            isActive={i === session.screenshots.length - 1}
            onOpenLightbox={setLightboxSeq}
            onRequestDelete={onRequestDelete}
            // Detached default: transcript gets ~2x the horizontal room
            // of the image, but the image is still big enough to read.
            // Click image to flip to image-wide.
            defaultImageFlex={1}
            defaultTranscriptFlex={2}
          />
        ))}
        <button
          onClick={onTakeNextScreenshot}
          style={{
            width: "100%", padding: 16, background: "transparent",
            border: `1px dashed ${C.borderLight}`, color: C.textMuted,
            borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 14,
          }}
        >
          ＋ Take next screenshot
        </button>
        <div style={{ marginTop: 24 }}>
          <label style={{ display: "block", color: C.textMuted, fontFamily: FONT_BODY, fontSize: 11, marginBottom: 4 }}>
            CLOSING NARRATION
          </label>
          <textarea
            value={session.closingNarration}
            onChange={(e) => dispatch({ type: "UPDATE_CLOSING_NARRATION", text: e.target.value })}
            placeholder="Anything to say after the last screenshot? (e.g., 'fix this for me')"
            style={{
              width: "100%", minHeight: 60, padding: 8,
              background: C.forest, border: `1px solid ${C.borderLight}`,
              color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
            }}
          />
        </div>
      </div>
      {lightboxSeq !== null && <Lightbox seq={lightboxSeq} onClose={() => setLightboxSeq(null)} />}
    </div>
  );
}
