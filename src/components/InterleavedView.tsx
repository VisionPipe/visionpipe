import { useSession } from "../state/session-context";
import { ScreenshotCard } from "./ScreenshotCard";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  onTakeNextScreenshot: () => void;
  onRequestDelete: (seq: number) => void;
  onOpenLightbox: (seq: number) => void;
}

export function InterleavedView({ onTakeNextScreenshot, onRequestDelete, onOpenLightbox }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;

  return (
    <div style={{ padding: 16 }}>
      {session.screenshots.map((s, i) => (
        <ScreenshotCard
          key={s.seq}
          screenshot={s}
          isActive={i === session.screenshots.length - 1}
          onOpenLightbox={onOpenLightbox}
          onRequestDelete={onRequestDelete}
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
  );
}
