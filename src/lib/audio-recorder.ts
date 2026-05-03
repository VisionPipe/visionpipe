/**
 * Wraps the browser MediaRecorder API for VisionPipe's needs:
 *  - Continuous recording to an in-memory blob, flushed to disk on stop / pause / chunk-tick.
 *  - Track elapsed time so the reducer can stamp audioOffset.start/end on captures.
 *  - Re-record mode: same API, separate output, original master untouched.
 *  - Emits chunks for downstream WebSocket forwarding (Deepgram client).
 */

export type AudioChunkListener = (chunk: Blob) => void;

export interface RecorderHandle {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<Blob>;
  elapsedSec(): number;
  isRecording(): boolean;
  onChunk(listener: AudioChunkListener): void;
}

const CHUNK_INTERVAL_MS = 1000;

export async function createRecorder(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });

  let chunks: Blob[] = [];
  let listeners: AudioChunkListener[] = [];
  let startTime = 0;
  let pausedAccumulated = 0;
  let pauseStarted = 0;
  let recording = false;

  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
      for (const l of listeners) l(e.data);
    }
  });

  return {
    start: async () => {
      recorder.start(CHUNK_INTERVAL_MS);
      startTime = performance.now();
      pausedAccumulated = 0;
      recording = true;
    },
    pause: () => {
      if (recorder.state === "recording") {
        recorder.pause();
        pauseStarted = performance.now();
        recording = false;
      }
    },
    resume: () => {
      if (recorder.state === "paused") {
        recorder.resume();
        pausedAccumulated += performance.now() - pauseStarted;
        recording = true;
      }
    },
    stop: () => new Promise<Blob>((resolve) => {
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
        chunks = [];
        recording = false;
        stream.getTracks().forEach(t => t.stop());
        resolve(blob);
      }, { once: true });
      recorder.stop();
    }),
    elapsedSec: () => {
      if (startTime === 0) return 0;
      const now = recorder.state === "paused" ? pauseStarted : performance.now();
      return (now - startTime - pausedAccumulated) / 1000;
    },
    isRecording: () => recording,
    onChunk: (l) => { listeners.push(l); },
  };
}
