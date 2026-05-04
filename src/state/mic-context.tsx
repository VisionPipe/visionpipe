import { createContext, useContext, type ReactNode } from "react";
import type { NetworkState } from "../components/Header";

export interface MicCtx {
  recording: boolean;
  permissionDenied: boolean;
  onToggle: () => void;
  networkState: NetworkState;
  /**
   * Stop the master cpal recording, drain its in-flight transcript into
   * the appropriate place (last screenshot's segment, or closing narration
   * if no screenshots yet), and flip mic state to off. Used by:
   *   - SessionWindow on "New Session" before END_SESSION
   *   - ReRecordModal on open, since cpal only allows one recording at a time
   */
  clearRecorder: () => Promise<void>;
  /**
   * No-op kept for API stability — Deepgram WebSocket path was removed
   * in v0.5.2 (replaced by Apple SFSpeechRecognizer). SessionWindow still
   * calls this on session-end out of caution. Will become real again if
   * we re-enable cloud streaming behind a Settings toggle.
   */
  closeDeepgram: () => void;
}

const MicContext = createContext<MicCtx | null>(null);

export function MicProvider({ value, children }: { value: MicCtx; children: ReactNode }) {
  return <MicContext.Provider value={value}>{children}</MicContext.Provider>;
}

export function useMic(): MicCtx {
  const ctx = useContext(MicContext);
  if (!ctx) throw new Error("useMic must be used within MicProvider");
  return ctx;
}
