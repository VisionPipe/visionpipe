import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSession } from "./session-context";

export type RecordingMode = "idle" | "recording" | "paused";

interface RecordingContextValue {
  /** Which screenshot's controls show "Recording …" / "Paused" UI. null = no
   *  active recording anywhere; the cpal stream is also stopped. */
  activeSeq: number | null;
  mode: RecordingMode;
  /** Total elapsed time across the current screenshot's chunks (recording +
   *  paused contribute on display). Resets when finalize() runs. */
  elapsedSec: number;
  /**
   * Click "Record audio" (idle) or the red-dot "Recording {t}" pill (recording / paused).
   *   - idle: start a fresh recording for this seq.
   *   - active on this seq, mode=recording: stop the chunk, transcribe, append + finalize.
   *   - active on this seq, mode=paused: append already-accumulated chunks + finalize.
   *   - active on a DIFFERENT seq: stop+finalize that one first, then start new for `seq`.
   */
  toggleRecord: (seq: number) => Promise<void>;
  /** "Pause"/"Resume" toggle. No-op when no active recording. */
  pauseOrResume: () => Promise<void>;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

/**
 * Owns the per-screenshot recording state machine.
 *
 * cpal is a global singleton — only one stream at a time — so the context
 * tracks WHICH screenshot's controls should render the recording state.
 *
 * Pause/Resume is "stop and restart" (Q1=B from 2026-05-06 design):
 * each Pause stops the current chunk, transcribes it, and parks the text in
 * an internal accumulator. Each Resume kicks off a fresh start_recording.
 * Stop (or stop-and-switch) finalises by appending the entire accumulator
 * to the target screenshot's transcriptSegment via dispatch.
 *
 * The cpal start/stop boundary doesn't break a sentence in the transcript
 * very often (SFSpeechRecognizer treats each chunk independently), but
 * it might re-capitalise the first word of chunk 2. Acceptable trade-off
 * vs. the implementation cost of a true streaming pause.
 */
export function RecordingProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useSession();
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const [mode, setMode] = useState<RecordingMode>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);

  // accumulator + chunk-time tracking — refs because they don't drive UI
  // and we read them inside async handlers without re-binding callbacks.
  const accumulatedRef = useRef<string>("");
  const chunkStartMsRef = useRef<number>(0);
  const chunkBaseSecRef = useRef<number>(0);
  const busyRef = useRef<boolean>(false);

  // Tick the displayed timer once a quarter-second while recording.
  useEffect(() => {
    if (mode !== "recording") return;
    const id = setInterval(() => {
      const liveSec = (Date.now() - chunkStartMsRef.current) / 1000;
      setElapsedSec(chunkBaseSecRef.current + liveSec);
    }, 250);
    return () => clearInterval(id);
  }, [mode]);

  // Stop the cpal stream + transcribe + accumulate. Used by both Pause
  // and final Stop. Updates chunkBaseSec to include the just-finished
  // chunk's wall-clock duration so the displayed elapsedSec is correct.
  const stopCurrentChunkAndAccumulate = useCallback(async () => {
    try {
      const transcript = await invoke<string>("stop_recording");
      const chunkSec = (Date.now() - chunkStartMsRef.current) / 1000;
      chunkBaseSecRef.current += chunkSec;
      const trimmed = (transcript ?? "").trim();
      if (trimmed) {
        accumulatedRef.current = accumulatedRef.current
          ? `${accumulatedRef.current} ${trimmed}`
          : trimmed;
      }
    } catch (err) {
      // "Not recording" or "No speech detected" — both benign here.
      console.warn("[VisionPipe] stop_recording failed:", err);
    }
  }, []);

  // Append the accumulator to the target screenshot's transcriptSegment
  // (Q2=B append-on-rerecord) and reset to idle.
  const finalize = useCallback(() => {
    const seq = activeSeq;
    const text = accumulatedRef.current.trim();
    if (seq !== null && text) {
      const session = state.session;
      const target = session?.screenshots.find((s) => s.seq === seq);
      const existing = (target?.transcriptSegment ?? "").trim();
      const combined = existing ? `${existing} ${text}` : text;
      dispatch({ type: "UPDATE_TRANSCRIPT_SEGMENT", seq, text: combined });
    }
    accumulatedRef.current = "";
    chunkBaseSecRef.current = 0;
    chunkStartMsRef.current = 0;
    setActiveSeq(null);
    setMode("idle");
    setElapsedSec(0);
  }, [activeSeq, state.session, dispatch]);

  const startNewRecording = useCallback(async (seq: number) => {
    accumulatedRef.current = "";
    chunkBaseSecRef.current = 0;
    chunkStartMsRef.current = Date.now();
    try {
      await invoke("start_recording");
      setActiveSeq(seq);
      setMode("recording");
      setElapsedSec(0);
    } catch (err) {
      console.error("[VisionPipe] start_recording failed:", err);
      // Roll back — we never actually started.
      accumulatedRef.current = "";
      setActiveSeq(null);
      setMode("idle");
      setElapsedSec(0);
    }
  }, []);

  const toggleRecord = useCallback(async (seq: number) => {
    if (busyRef.current) return;

    // First-time gate: if the user hasn't completed mic onboarding (Mic +
    // Speech Recognition permissions explained + granted), pop the
    // explainer modal and bail. App.tsx listens for `vp-show-mic-modal`
    // and shows MicOnboardingModal. After the user grants, they click
    // Record again to actually begin (matches the per-screenshot manual
    // model — no auto-start after the prompt).
    if (mode === "idle" && localStorage.getItem("vp-mic-onboarded") !== "1") {
      window.dispatchEvent(new CustomEvent("vp-show-mic-modal"));
      return;
    }

    busyRef.current = true;
    try {
      if (mode === "idle") {
        await startNewRecording(seq);
      } else if (activeSeq === seq) {
        // Stop on the active card. If currently recording, drain the chunk
        // first; if paused, the accumulator already has all chunks.
        if (mode === "recording") {
          await stopCurrentChunkAndAccumulate();
        }
        finalize();
      } else {
        // Switching cards: stop+finalize current, then start fresh for `seq`.
        if (mode === "recording") {
          await stopCurrentChunkAndAccumulate();
        }
        finalize();
        await startNewRecording(seq);
      }
    } finally {
      busyRef.current = false;
    }
  }, [mode, activeSeq, startNewRecording, stopCurrentChunkAndAccumulate, finalize]);

  const pauseOrResume = useCallback(async () => {
    if (busyRef.current) return;
    if (activeSeq === null) return;
    busyRef.current = true;
    try {
      if (mode === "recording") {
        await stopCurrentChunkAndAccumulate();
        setMode("paused");
      } else if (mode === "paused") {
        chunkStartMsRef.current = Date.now();
        try {
          await invoke("start_recording");
          setMode("recording");
        } catch (err) {
          console.error("[VisionPipe] start_recording (resume) failed:", err);
        }
      }
    } finally {
      busyRef.current = false;
    }
  }, [mode, activeSeq, stopCurrentChunkAndAccumulate]);

  return (
    <RecordingContext.Provider value={{ activeSeq, mode, elapsedSec, toggleRecord, pauseOrResume }}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error("useRecording must be used within RecordingProvider");
  return ctx;
}
