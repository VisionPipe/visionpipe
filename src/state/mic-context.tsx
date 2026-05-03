import { createContext, useContext, type ReactNode } from "react";
import type { RecorderHandle } from "../lib/audio-recorder";
import type { NetworkState } from "../components/Header";

export interface MicCtx {
  recording: boolean;
  permissionDenied: boolean;
  onToggle: () => void;
  recorder: RecorderHandle | null;
  networkState: NetworkState;
  /** Clear the master recorder ref (called after session-end audio flush). */
  clearRecorder: () => void;
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
