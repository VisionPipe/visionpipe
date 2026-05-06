import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPanel } from "./SettingsPanel";
import { C, FONT_MONO } from "../lib/ui-tokens";

interface RustHotkeyConfig {
  take_next_screenshot: string;
  copy_and_send: string;
  rerecord_active: string;
  toggle_view_mode: string;
}

/**
 * Convert a stored hotkey string like "CmdOrCtrl+Shift+C" to display
 * glyphs like "⌘⇧C". Mac-only glyphs are used since VisionPipe is
 * Mac-only (per src-tauri/Cargo.toml's macOS-only deps).
 */
function formatHotkey(combo: string): string {
  const parts = combo.split("+").map(p => p.trim());
  return parts
    .map(p => {
      switch (p) {
        case "CmdOrCtrl":
        case "Cmd":
        case "Meta":
          return "⌘";
        case "Shift":
          return "⇧";
        case "Alt":
        case "Option":
          return "⌥";
        case "Ctrl":
          return "⌃";
        case "Enter":
        case "Return":
          return "↩";
        case "Tab":
          return "⇥";
        case "Escape":
        case "Esc":
          return "⎋";
        case "Space":
          return "␣";
        case "Backspace":
          return "⌫";
        default:
          return p.length === 1 ? p.toUpperCase() : p;
      }
    })
    .join("");
}

interface Props {
  /**
   * Which hotkey to display. Defaults to "takeNextScreenshot" since that's
   * the marquee shortcut shown in the empty/idle states.
   */
  binding?: keyof RustHotkeyConfig;
  /** Optional label shown to the left of the pill, e.g. "Capture:" */
  label?: string;
  /** Optional size override — "sm" (default) or "lg" for prominent CTAs. */
  size?: "sm" | "lg";
}

/**
 * Single orange pill rendering the keyboard shortcut. Click opens the
 * SettingsPanel so the user can rebind. Self-contained: holds its own
 * settings-open state and renders the modal when triggered.
 */
export function HotkeyPill({ binding = "take_next_screenshot", label, size = "sm" }: Props) {
  const [combo, setCombo] = useState<string>("CmdOrCtrl+Shift+C");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<RustHotkeyConfig>("load_hotkey_config");
        setCombo(cfg[binding]);
      } catch (err) {
        console.warn("[VisionPipe] HotkeyPill: load_hotkey_config failed", err);
      }
    })();
  }, [binding]);

  // Refresh the displayed combo whenever the settings panel closes (the
  // user may have just rebound it).
  const onSettingsClose = () => {
    setSettingsOpen(false);
    invoke<RustHotkeyConfig>("load_hotkey_config")
      .then(cfg => setCombo(cfg[binding]))
      .catch(() => {/* keep stale value if reload fails */});
  };

  // Size variants. Both are intentionally chunky — large glyphs on a
  // softly-rounded pill so the shortcut reads as a tactile "press this"
  // affordance, not a status badge. "lg" is the welcome-card CTA;
  // "sm" is the in-text size used in HistoryHub captions ("or press X
  // from anywhere") — sized so the keys are unmistakably ⌘⇧C even
  // when scanning quickly, not a tiny inline badge.
  const isLg = size === "lg";
  const fontSize = isLg ? 32 : 22;
  const padY = isLg ? 14 : 8;
  const padX = isLg ? 22 : 14;
  const radius = isLg ? 12 : 8;
  const labelGap = isLg ? 12 : 8;

  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: labelGap }}>
        {label && <span style={{ color: C.textDim, fontSize }}>{label}</span>}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Click to change keyboard shortcut"
          style={{
            display: "inline-flex", alignItems: "center", gap: isLg ? 10 : 2,
            padding: `${padY}px ${padX}px`, borderRadius: radius,
            background: C.amber, color: C.deepForest,
            border: "none", cursor: "pointer",
            fontFamily: FONT_MONO, fontSize, fontWeight: 700,
            letterSpacing: isLg ? "1px" : "0.5px",
            boxShadow: isLg ? "0 3px 6px rgba(0,0,0,0.3)" : "0 1px 2px rgba(0,0,0,0.2)",
            lineHeight: 1,
          }}
        >
          {formatHotkey(combo)}
        </button>
      </span>
      {settingsOpen && <SettingsPanel onClose={onSettingsClose} />}
    </>
  );
}

// Exported for testing.
export const __test__ = { formatHotkey };
