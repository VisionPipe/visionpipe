import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";
import type { PermissionStatus } from "../lib/permissions-types";
import { VersionBadge } from "./VersionBadge";

type SettingsPane =
  | "screen_recording"
  | "automation"
  | "accessibility"
  | "microphone"
  | "speech_recognition";

interface OnboardingProps {
  permissions: PermissionStatus | null;
  onRecheck: () => void;
  onDismiss: () => void;
}

export function Onboarding({ permissions, onRecheck, onDismiss }: OnboardingProps) {
  const allGranted = !!(
    permissions?.screenRecording &&
    permissions?.systemEvents &&
    permissions?.accessibility &&
    permissions?.microphone &&
    permissions?.speechRecognition
  );

  const openPane = async (pane: SettingsPane) => {
    try {
      await invoke("open_settings_pane", { pane });
    } catch (e) {
      console.error("[VisionPipe] open_settings_pane failed:", e);
    }
  };

  // For microphone + speech recognition, calling the Apple SDK request
  // function FIRST is what triggers the native macOS permission prompt and
  // adds Vision|Pipe to the TCC database. Without that, System Settings →
  // Privacy → Microphone shows an empty list with no "+" button (Apple
  // doesn't allow manual mic-permission adds). After requesting, we
  // re-check and only open Settings as a fallback if the user has
  // previously denied (request returns false instantly without prompting).
  const requestMic = async () => {
    try {
      const granted = await invoke<boolean>("request_microphone_access");
      await onRecheck();
      if (!granted) {
        // Either user just denied, or they previously denied; either way,
        // give them a path to flip the toggle manually in Settings.
        await openPane("microphone");
      }
    } catch (e) {
      console.error("[VisionPipe] request_microphone_access failed:", e);
      await openPane("microphone");
    }
  };

  const requestSpeech = async () => {
    try {
      const granted = await invoke<boolean>("request_speech_recognition");
      await onRecheck();
      if (!granted) {
        // The Privacy_SpeechRecognition URL scheme is unreliable on macOS
        // 14+, but try anyway as a fallback.
        await openPane("speech_recognition");
      }
    } catch (e) {
      console.error("[VisionPipe] request_speech_recognition failed:", e);
      await openPane("speech_recognition");
    }
  };

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", alignItems: "stretch", justifyContent: "stretch",
      background: "transparent",
      fontFamily: FONT_BODY,
    }}>
      <div style={{
        display: "flex", flexDirection: "column", flex: 1,
        borderRadius: 14, overflow: "hidden",
        border: `1px solid ${C.border}`, background: C.forest,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(46, 139, 122, 0.1)",
      }}>
        {/* Title bar drag region */}
        <div
          data-tauri-drag-region
          style={{
            height: 28, background: C.deepForest,
            borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingLeft: 80, paddingRight: 12,
          }}
        >
          <span style={{
            fontFamily: FONT_MONO, fontSize: 11, color: C.textDim, letterSpacing: "0.04em",
          }}>
            Vision<span style={{ color: C.teal }}>|</span>Pipe
          </span>
          <VersionBadge />
        </div>

        <div style={{ flex: 1, padding: 24, overflowY: "auto", color: C.cream }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Welcome to Vision|Pipe</h1>
          <p style={{ margin: "4px 0 0 0", color: C.amber, fontSize: 14, fontWeight: 700 }}>
            Give your LLM eyes.
          </p>

          {!allGranted ? (
            <>
              <p style={{ marginTop: 8, marginBottom: 16, color: C.textMuted, fontSize: 13 }}>
                Grant the permissions below and you'll be ready to capture. The first three are required;
                microphone + speech recognition are only needed for voice notes.
              </p>

              <PermissionRow
                granted={!!permissions?.screenRecording}
                label="Screen Recording"
                description="Required to capture screenshots. If Vision|Pipe isn't already in the list, click the + button and add Vision|Pipe from your Applications folder, then toggle it on."
                onOpen={() => openPane("screen_recording")}
                onRecheck={onRecheck}
              />
              <PermissionRow
                granted={!!permissions?.systemEvents}
                label="Automation: System Events"
                description="Lets Vision|Pipe read the active app and window so it can include them as metadata in captures. Found under System Settings → Privacy & Security → Automation."
                onOpen={() => openPane("automation")}
                onRecheck={onRecheck}
              />
              <PermissionRow
                granted={!!permissions?.accessibility}
                label="Accessibility"
                description="Required so the ⌘⇧C global shortcut works system-wide. Found under System Settings → Privacy & Security → Accessibility. Click + to add Vision|Pipe if it's not listed."
                onOpen={() => openPane("accessibility")}
                onRecheck={onRecheck}
              />
              <PermissionRow
                granted={!!permissions?.microphone}
                label="Microphone"
                description="Optional — enables voice notes attached to your captures. Click Grant access, then click Allow on the macOS prompt that appears."
                onOpen={requestMic}
                onRecheck={onRecheck}
                buttonLabel="Grant access"
              />
              <PermissionRow
                granted={!!permissions?.speechRecognition}
                label="Speech Recognition"
                description="Optional — enables on-device transcription of your voice notes via Apple's Speech framework. Nothing leaves your Mac for this. Click Grant access to trigger the macOS prompt."
                onOpen={requestSpeech}
                onRecheck={onRecheck}
                buttonLabel="Grant access"
              />
            </>
          ) : (
            <>
              <p style={{ marginTop: 16, marginBottom: 4, color: C.teal, fontSize: 13, fontWeight: 600 }}>
                ✓ You're all set.
              </p>
              <p style={{ marginTop: 0, marginBottom: 16, color: C.textMuted, fontSize: 13 }}>
                All permissions are granted. Here's how to use Vision|Pipe:
              </p>

              <div style={{ color: C.textMuted, fontSize: 14, marginBottom: 12, marginTop: 8 }}>How to use:</div>
              <ul style={{ margin: 0, paddingLeft: 24, color: C.cream, fontSize: 16, lineHeight: 2.2 }}>
                <li>Press <KbdKey>⌘</KbdKey><KbdKey>⇧</KbdKey><KbdKey>C</KbdKey> anywhere to start a capture.</li>
                <li>Drag to select a region, or press <KbdKey>Enter</KbdKey> for a fullscreen capture.</li>
                <li>Press <KbdKey>Esc</KbdKey> to cancel.</li>
                <li>
                  Add an annotation, then click{" "}
                  <strong style={{ color: C.amber }}>Pipe it</strong> to copy a markdown-ready
                  capture to your clipboard.
                </li>
                <li>Paste into ChatGPT, Claude, Gemini, or any LLM that accepts images + text.</li>
              </ul>

              <div style={{ marginTop: 16, fontSize: 12, color: C.textDim }}>
                Re-open this welcome from the menu bar tray icon →{" "}
                <em>Show Onboarding…</em>
              </div>

              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={onDismiss}
                  style={{
                    background: C.teal, color: C.cream, border: "none",
                    padding: "8px 20px", borderRadius: 6,
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Got it
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline keyboard-key badge — sized large so the shortcut to capture
//    (⌘⇧C) is unmistakable as the call-to-action on the welcome card. ──
function KbdKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-block",
      padding: "8px 14px", margin: "0 4px",
      fontFamily: FONT_MONO, fontSize: 22, fontWeight: 700,
      color: C.cream, background: C.deepForest,
      border: `2px solid ${C.amber}`, borderRadius: 8,
      verticalAlign: "middle",
      minWidth: 28, textAlign: "center",
      boxShadow: "0 2px 0 rgba(0,0,0,0.3)",
    }}>
      {children}
    </kbd>
  );
}

// ── Single permission row ──
function PermissionRow({
  granted, label, description, onOpen, onRecheck, buttonLabel = "Open System Settings",
}: {
  granted: boolean;
  label: string;
  description: string;
  onOpen: () => void;
  onRecheck: () => Promise<void> | void;
  buttonLabel?: string;
}) {
  const [checking, setChecking] = useState(false);

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      // Keep "Checking…" visible briefly so the user notices the response.
      setTimeout(() => setChecking(false), 400);
    }
  };

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 12,
      background: C.deepForest,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          color: granted ? C.teal : C.sienna,
          fontWeight: 700, fontSize: 16, width: 16, textAlign: "center",
        }}>
          {granted ? "✓" : "✗"}
        </span>
        <span style={{ color: C.cream, fontWeight: 600, fontSize: 14 }}>{label}</span>
      </div>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 8, marginLeft: 24 }}>
        {description}
      </div>
      <div style={{ display: "flex", gap: 8, marginLeft: 24, alignItems: "center" }}>
        <button
          onClick={onOpen}
          style={{
            background: C.teal, color: C.cream, border: "none",
            padding: "6px 12px", borderRadius: 4, fontSize: 12,
            cursor: "pointer", fontWeight: 600,
          }}
        >
          {buttonLabel}
        </button>
        <button
          onClick={handleRecheck}
          disabled={checking}
          style={{
            background: checking ? C.deepForest : "transparent",
            color: checking ? C.amber : C.textMuted,
            border: `1px solid ${checking ? C.amber : C.border}`,
            padding: "6px 12px", borderRadius: 4, fontSize: 12,
            cursor: checking ? "default" : "pointer",
            fontWeight: checking ? 600 : 400,
            transition: "all 150ms ease",
            opacity: checking ? 0.9 : 1,
          }}
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>
    </div>
  );
}
