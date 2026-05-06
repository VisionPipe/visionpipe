import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSession } from "./session-context";
import { deriveAudioSeconds } from "./audio-duration";

export interface BundleCost {
  screenshots: number;
  annotations: number;
  audio: number;
  total: number;
}

interface CreditContextValue {
  balance: number;
  currentBundleCost: BundleCost;
  /** Re-read balance from the backend (call after a deduct or purchase). */
  refresh: () => Promise<void>;
  /**
   * Calculate cost from current session, deduct from backend, refresh
   * balance. Throws on insufficient credits — caller MUST abort the
   * side effect (clipboard write) on throw.
   */
  deductForBundle: () => Promise<BundleCost>;
}

const ZERO_COST: BundleCost = { screenshots: 0, annotations: 0, audio: 0, total: 0 };

const CreditContext = createContext<CreditContextValue | null>(null);

const PREVIEW_DEBOUNCE_MS = 150;

export function CreditProvider({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const [balance, setBalance] = useState<number>(0);
  const [currentBundleCost, setCurrentBundleCost] = useState<BundleCost>(ZERO_COST);

  const screenshotCount = state.session?.screenshots.length ?? 0;
  const audioSeconds = useMemo(
    () => (state.session ? deriveAudioSeconds(state.session.screenshots) : 0),
    [state.session]
  );

  const refresh = useCallback(async () => {
    try {
      const b = await invoke<number>("get_credit_balance");
      setBalance(b);
    } catch (err) {
      console.error("[VisionPipe] get_credit_balance failed:", err);
    }
  }, []);

  // Initial balance load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live preview, debounced on session changes.
  useEffect(() => {
    if (!state.session) {
      setCurrentBundleCost(ZERO_COST);
      return;
    }
    const handle = setTimeout(() => {
      invoke<BundleCost>("preview_bundle_cost", {
        screenshots: screenshotCount,
        annotations: 0, // dormant — annotation feature is removed; see spec
        audio_seconds: audioSeconds,
      })
        .then(setCurrentBundleCost)
        .catch((err) => console.error("[VisionPipe] preview_bundle_cost failed:", err));
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [state.session, screenshotCount, audioSeconds]);

  const deductForBundle = useCallback(async (): Promise<BundleCost> => {
    const cost = await invoke<BundleCost>("deduct_for_bundle", {
      screenshots: screenshotCount,
      annotations: 0,
      audio_seconds: audioSeconds,
    });
    // Refresh balance from backend (single source of truth).
    await refresh();
    return cost;
  }, [screenshotCount, audioSeconds, refresh]);

  return (
    <CreditContext.Provider value={{ balance, currentBundleCost, refresh, deductForBundle }}>
      {children}
    </CreditContext.Provider>
  );
}

export function useCredit(): CreditContextValue {
  const ctx = useContext(CreditContext);
  if (!ctx) throw new Error("useCredit must be used within a CreditProvider");
  return ctx;
}
