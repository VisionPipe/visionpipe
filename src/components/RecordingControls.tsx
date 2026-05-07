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
 *   recording  →  [🔴 0:14 Recording]   [Pause]   [Save]   or cancel
 *   paused     →  [🔴 0:14 Paused]      [Resume]  [Save]   or cancel
 *
 *   - The "Recording / Paused" pill is a STATUS DIV, not a button —
 *     Save and Cancel are the explicit terminal actions.
 *   - Pause stops the current chunk + transcribes (parked in the
 *     context's accumulator), stays on this card in "paused" mode.
 *   - Resume kicks off a fresh start_recording.
 *   - Save stops the chunk + transcribes + APPENDS the entire
 *     accumulator to the screenshot's existing transcriptSegment
 *     (Q2=B from the 2026-05-06 design call).
 *   - Cancel discards the in-flight recording without transcribing
 *     or appending — the existing transcriptSegment is untouched.
 *
 * Only one screenshot can be active at a time (cpal singleton). Clicking
 * Record on a different card while this one is active triggers the
 * context's auto-stop+finalise of this one, then starts the new one.
 */
export function RecordingControls({ seq }: Props) {
  const { activeSeq, mode, elapsedSec, toggleRecord, pauseOrResume, discardRecording } = useRecording();

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Status pill — display only, NOT clickable. Save / Cancel are
            the explicit terminal actions; the pill just shows what's
            happening. Same border-radius (4) as the idle Record button
            so the cluster reads as one consistent control surface. */}
        <div
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 12px", borderRadius: 4,
            background: "rgba(192, 70, 42, 0.15)",
            border: `1px solid ${C.sienna}`,
            color: C.sienna, fontFamily: FONT_BODY, fontSize: 12,
            fontWeight: 700,
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
        </div>

        {/* Pause / Resume — toggles between recording and paused mode.
            Doesn't transcribe or finalise. */}
        <button
          type="button"
          onClick={() => void pauseOrResume()}
          style={{
            background: "transparent", border: `1px solid ${C.borderLight}`,
            color: C.textBright, padding: "5px 12px", borderRadius: 4,
            fontSize: 11, fontFamily: FONT_BODY, cursor: "pointer",
          }}
          title={isPaused ? "Resume recording" : "Pause recording"}
        >
          {isPaused ? "Resume" : "Pause"}
        </button>

        {/* Save — explicit stop + transcribe + append to transcriptSegment. */}
        <button
          type="button"
          onClick={() => void toggleRecord(seq)}
          style={{
            background: C.teal, border: "none",
            color: C.deepForest, padding: "5px 14px", borderRadius: 4,
            fontSize: 11, fontFamily: FONT_BODY, fontWeight: 700,
            cursor: "pointer",
          }}
          title="Stop, transcribe, and append the text to this screenshot's narration"
        >
          Save
        </button>

        {/* Cancel — discard the recording, no transcript, no append. */}
        <span style={{ color: C.textDim, fontSize: 11 }}>
          or{" "}
          <a
            onClick={(e) => { e.preventDefault(); void discardRecording(); }}
            style={{
              color: C.sienna,
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            cancel
          </a>
        </span>
      </div>
    );
  }

  // ── Idle state ────────────────────────────────────────────────────────
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
      title="Record audio that will be transcribed and appended to this screenshot's narration"
    >
      <Mic size={12} strokeWidth={2} />
      Record audio
    </button>
  );
}
