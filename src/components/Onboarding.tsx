import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";
import type { PermissionStatus } from "../lib/permissions-types";
import { VersionBadge } from "./VersionBadge";
import { HotkeyPill } from "./HotkeyPill";

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
  // Mic + speech recognition are deliberately deferred to the first time
  // the user clicks the mic button in the Header (see MicOnboardingModal).
  // Only the three required permissions gate dismissal of this card.
  const allGranted = !!(
    permissions?.screenRecording &&
    permissions?.systemEvents &&
    permissions?.accessibility
  );

  const openPane = async (pane: SettingsPane) => {
    try {
      await invoke("open_settings_pane", { pane });
    } catch (e) {
      console.error("[VisionPipe] open_settings_pane failed:", e);
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
                Grant the three permissions below and you'll be ready to capture.
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

              <p style={{ marginTop: 12, color: C.textDim, fontSize: 11, fontStyle: "italic" }}>
                Microphone &amp; Speech Recognition are optional and will be requested the first time
                you click the microphone in the app — they're only needed for voice notes.
              </p>
            </>
          ) : (
            <>
              <p style={{ marginTop: 16, marginBottom: 16, color: C.teal, fontSize: 13, fontWeight: 600 }}>
                ✓ You're all set.
              </p>

              <div style={{ color: C.textMuted, fontSize: 14, marginBottom: 12, marginTop: 8 }}>
                How to give your LLM eyes:
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 12,
                color: C.cream, fontSize: 16, lineHeight: 1.6,
                margin: "0 0 4px 0",
              }}>
                <span>Press</span>
                <HotkeyPill size="lg" />
                <span>to capture your screen</span>
              </div>
              <p style={{ marginTop: 6, color: C.textDim, fontSize: 11 }}>
                Click the orange pill to change the shortcut.
              </p>

              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={onDismiss}
                  style={{
                    background: C.teal, color: C.cream, border: "none",
                    padding: "8px 20px", borderRadius: 6,
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Get Started
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
