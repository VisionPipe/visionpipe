import { Mic } from "lucide-react";
import { useRecording } from "../state/recording-context";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";

interface Props { seq: number; }

/**
 * Per-screenshot recording controls. Lives between the "Narration" label
 * and the transcript textarea on each ScreenshotCard.
 *
 * State machine (per the 2026-05-06 design):
 *
 *   idle       →  [🎙 Record audio]
 *   recording  →  [🔴 Recording 0:14]   [Pause]
 *   paused     →  [🔴 Recording 0:14]   [Resume]
 *
 *   - Click the 🔴 pill in either active state → stop, transcribe,
 *     APPEND to the screenshot's existing transcriptSegment.
 *   - Click Pause → stop the current chunk + transcribe (parked in
 *     the context's accumulator), stay on this card in "paused" mode.
 *   - Click Resume → start a new chunk; on Stop the accumulator drains.
 *
 * Only one screenshot can be active at a time (cpal singleton). If a
 * different card's Record is clicked while this one is active, the
 * context auto-stops + finalises this one before starting the new one.
 */
export function RecordingControls({ seq }: Props) {
  const { activeSeq, mode, elapsedSec, toggleRecord, pauseOrResume } = useRecording();

  const isThisCardActive = activeSeq === seq;
  const isRecording = isThisCardActive && mode === "recording";
  const isPaused = isThisCardActive && mode === "paused";

  const fmtTime = (s: number) => {
    const total = Math.max(0, Math.floor(s));
    const m = Math.floor(total / 60);
    const r = total % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  // ── Active state (recording or paused) ────────────────────────────────
  if (isRecording || isPaused) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => void toggleRecord(seq)}
          title="Click to stop recording and insert transcript"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 12px", borderRadius: 999,
            background: "rgba(192, 70, 42, 0.15)",
            border: `1px solid ${C.sienna}`,
            color: C.sienna, fontFamily: FONT_BODY, fontSize: 12,
            fontWeight: 700, cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 8, height: 8, borderRadius: 999,
              background: C.sienna,
              opacity: isPaused ? 0.5 : 1,
            }}
          />
          <span style={{ fontFamily: FONT_MONO }}>{fmtTime(elapsedSec)}</span>
          <span>{isPaused ? "Paused" : "Recording"}</span>
        </button>
        <button
          type="button"
          onClick={() => void pauseOrResume()}
          style={{
            background: "transparent", border: `1px solid ${C.borderLight}`,
            color: C.textBright, padding: "5px 10px", borderRadius: 4,
            fontSize: 11, fontFamily: FONT_BODY, cursor: "pointer",
          }}
          title={isPaused ? "Resume recording" : "Pause recording (audio stops; resume to continue)"}
        >
          {isPaused ? "Resume" : "Pause"}
        </button>
      </div>
    );
  }

  // ── Idle state ────────────────────────────────────────────────────────
  // If a DIFFERENT card is active, this one is still clickable — toggleRecord
  // will stop+finalise that one and start fresh here. The button text stays
  // "Record audio" so the affordance is consistent across cards.
  return (
    <button
      type="button"
      onClick={() => void toggleRecord(seq)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "transparent", border: `1px solid ${C.borderLight}`,
        color: C.textBright, padding: "5px 12px", borderRadius: 4,
        fontSize: 11, fontFamily: FONT_BODY, cursor: "pointer",
      }}
      title="Record audio that will be transcribed and inserted below"
    >
      <Mic size={12} strokeWidth={2} />
      Record audio
    </button>
  );
}
