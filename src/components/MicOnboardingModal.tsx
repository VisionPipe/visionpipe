import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  /** Called after the user has either granted both permissions, denied
   *  one, or clicked "Maybe later". The caller is responsible for
   *  setting any persistence flag and updating its own state. */
  onComplete: (granted: { microphone: boolean; speechRecognition: boolean }) => void;
  onSkip: () => void;
}

const SETTINGS_PANE_URLS: Record<"microphone" | "speech_recognition", string> = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  speech_recognition: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
};

/**
 * First-time microphone onboarding. Shown the FIRST time the user
 * clicks the mic button in the Header (or any other mic-trigger surface).
 *
 * We keep these two TCC requests OUT of the main Onboarding card because
 * voice narration is optional — the app works fine for users who only
 * want screenshot+text output. Asking for mic access on first launch
 * was friction for the silent-capture-only user.
 */
export function MicOnboardingModal({ onComplete, onSkip }: Props) {
  const [state, setState] = useState<"idle" | "requesting" | "done">("idle");
  const [errorBanner, setErrorBanner] = useState<{
    pane: "microphone" | "speech_recognition";
    message: string;
  } | null>(null);

  const onGrant = async () => {
    setState("requesting");
    setErrorBanner(null);
    let micGranted = false;
    let speechGranted = false;
    let timedOut: "microphone" | "speech_recognition" | null = null;

    try {
      micGranted = await invoke<boolean>("request_microphone_access");
    } catch (err) {
      // Backend returns Err only on timeout (no response from macOS within
      // 60 s). Treat as "we don't know" — surface the actionable message
      // to the user instead of pretending it was denied.
      console.warn("[VisionPipe] request_microphone_access timed out:", err);
      timedOut = "microphone";
      setErrorBanner({
        pane: "microphone",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (!timedOut) {
      try {
        speechGranted = await invoke<boolean>("request_speech_recognition");
      } catch (err) {
        console.warn("[VisionPipe] request_speech_recognition timed out:", err);
        timedOut = "speech_recognition";
        setErrorBanner({
          pane: "speech_recognition",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setState(timedOut ? "idle" : "done");
    if (!timedOut) {
      onComplete({ microphone: micGranted, speechRecognition: speechGranted });
    }
  };

  const openSystemSettings = async (pane: "microphone" | "speech_recognition") => {
    try {
      await invoke("open_settings_pane", { pane });
    } catch (err) {
      console.warn("[VisionPipe] open_settings_pane failed:", err);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100,
      fontFamily: FONT_BODY,
    }}>
      <div style={{
        background: C.deepForest, border: `1px solid ${C.borderLight}`,
        padding: 28, borderRadius: 10, color: C.cream,
        maxWidth: 480, lineHeight: 1.5,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
      }}>
        <h2 style={{ margin: "0 0 12px 0", fontSize: 18, color: C.cream }}>
          Enable voice notes?
        </h2>
        <p style={{ margin: "0 0 12px 0", color: C.textBright, fontSize: 14 }}>
          Vision|Pipe can record voice narration alongside your captures and
          transcribe it into the markdown bundle. To do that, macOS needs
          to grant Vision|Pipe two permissions:
        </p>
        <ul style={{ margin: "0 0 16px 18px", color: C.textMuted, fontSize: 13, lineHeight: 1.7 }}>
          <li><strong style={{ color: C.cream }}>Microphone</strong> — to record what you say</li>
          <li><strong style={{ color: C.cream }}>Speech Recognition</strong> — to transcribe it on-device via Apple's Speech framework</li>
        </ul>
        <p style={{ margin: "0 0 16px 0", color: C.textMuted, fontSize: 12 }}>
          Click Grant access — macOS will show a prompt for each. Click Allow on both.
        </p>
        {errorBanner && (
          <div style={{
            margin: "0 0 16px 0", padding: "10px 12px",
            background: "#3a1a1a", border: `1px solid ${C.sienna}`,
            borderRadius: 6, color: C.cream, fontSize: 12, lineHeight: 1.5,
          }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              macOS didn't answer the {errorBanner.pane === "microphone" ? "Microphone" : "Speech Recognition"} prompt.
            </div>
            <div style={{ marginBottom: 8, color: C.textMuted }}>
              {errorBanner.message}
            </div>
            <button
              onClick={() => openSystemSettings(errorBanner.pane)}
              style={{
                background: C.teal, color: C.cream, border: "none",
                padding: "5px 10px", borderRadius: 4, fontSize: 11,
                fontWeight: 600, cursor: "pointer",
              }}
            >
              Open System Settings →
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onSkip}
            disabled={state === "requesting"}
            style={{
              background: "transparent", color: C.textMuted,
              border: `1px solid ${C.border}`,
              padding: "8px 14px", borderRadius: 6,
              fontSize: 13, fontWeight: 500,
              cursor: state === "requesting" ? "wait" : "pointer",
            }}
          >
            Maybe later
          </button>
          <button
            onClick={onGrant}
            disabled={state !== "idle"}
            style={{
              background: state === "idle" ? C.teal : C.deepForest,
              color: C.cream, border: `1px solid ${C.teal}`,
              padding: "8px 18px", borderRadius: 6,
              fontSize: 13, fontWeight: 700,
              cursor: state === "idle" ? "pointer" : "wait",
            }}
          >
            {state === "requesting" ? "Asking macOS…" : "Grant access"}
          </button>
        </div>
      </div>
    </div>
  );
}
