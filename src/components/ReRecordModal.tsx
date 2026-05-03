import { useEffect, useRef, useState } from "react";
import { useSession } from "../state/session-context";
import { useMic } from "../state/mic-context";
import { invoke } from "@tauri-apps/api/core";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  seq: number;
  onClose: () => void;
}

/**
 * Re-record narration for a single past screenshot. Replaces that
 * screenshot's transcriptSegment text outright (no separate audio file
 * is preserved — the cpal/SFSpeech pipeline only emits a transcript).
 *
 * If the master session mic is running when this modal opens, we pause
 * it first (via mic.clearRecorder, which flushes its current segment's
 * transcript to wherever it would normally land). The cpal singleton
 * only supports one recording at a time, so this is required. We do NOT
 * auto-restart master mic on close — the user can hit the Header mic
 * button to resume if they want continuous recording for future shots.
 *
 * v0.5.2 → v0.6.0: switched from MediaRecorder + webm-blob saved to
 * <canonicalName>-rerecord.webm + reRecordedAudio metadata, to inline
 * cpal transcription that updates transcriptSegment directly.
 */
export function ReRecordModal({ seq, onClose }: Props) {
  const { state, dispatch } = useSession();
  const mic = useMic();
  const session = state.session!;
  const screenshot = session.screenshots.find(s => s.seq === seq)!;
  const [phase, setPhase] = useState<"starting" | "recording" | "stopping">("starting");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startMsRef = useRef<number>(0);

  useEffect(() => {
    let intervalId: number | null = null;
    let cancelled = false;
    (async () => {
      try {
        // Pause master if active so cpal's single-recording slot is free.
        if (mic.recording) {
          await mic.clearRecorder();
        }
        if (cancelled) return;
        await invoke("start_recording");
        if (cancelled) return;
        startMsRef.current = Date.now();
        setPhase("recording");
        intervalId = window.setInterval(() => {
          setElapsed((Date.now() - startMsRef.current) / 1000);
        }, 100);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[VisionPipe] Re-record start failed:", msg);
        setError(`Couldn't start mic: ${msg}`);
      }
    })();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
    // mic intentionally omitted — we want the snapshot at modal-open time,
    // not to react to subsequent changes (which would cancel re-record mid-flight).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = async () => {
    if (phase !== "recording") return;
    setPhase("stopping");
    try {
      const transcript = await invoke<string>("stop_recording");
      const newText = (transcript ?? "").trim();
      if (newText) {
        dispatch({ type: "UPDATE_TRANSCRIPT_SEGMENT", seq, text: newText });
      }
    } catch (err) {
      console.error("[VisionPipe] Re-record stop_recording failed:", err);
    } finally {
      onClose();
    }
  };

  const cancel = async () => {
    if (phase === "recording") {
      try { await invoke<string>("stop_recording"); } catch { /* ignore */ }
    }
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: C.deepForest, border: `1px solid ${C.borderLight}`,
        padding: 32, borderRadius: 8, color: C.textBright, fontFamily: FONT_BODY,
        textAlign: "center", minWidth: 360,
      }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          Re-record narration for Screenshot {seq}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>
          Replaces the existing transcript with what you say now.
        </div>
        {error ? (
          <>
            <div style={{ color: C.sienna, fontSize: 13, margin: "16px 0" }}>
              {error}
            </div>
            <button onClick={onClose} style={{
              background: C.borderLight, border: "none", color: C.textBright,
              padding: "10px 20px", borderRadius: 6, cursor: "pointer",
            }}>
              Close
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 28, color: phase === "recording" ? C.sienna : C.textMuted, margin: "12px 0" }}>
              ● {elapsed.toFixed(1)}s
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={cancel} disabled={phase === "stopping"} style={{
                background: "transparent", border: `1px solid ${C.borderLight}`,
                color: C.textMuted, padding: "10px 20px", borderRadius: 6,
                cursor: phase === "stopping" ? "wait" : "pointer",
              }}>
                Cancel
              </button>
              <button onClick={stop} disabled={phase !== "recording"} style={{
                background: phase === "recording" ? C.teal : C.border,
                border: "none", color: phase === "recording" ? C.deepForest : C.textDim,
                padding: "10px 20px", borderRadius: 6, fontWeight: 700,
                cursor: phase === "recording" ? "pointer" : "wait",
              }}>
                {phase === "starting" ? "Starting…" : phase === "stopping" ? "Saving…" : "Stop & Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
