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
 * Convert a stored hotkey-combo string ("CmdOrCtrl+Shift+C") into the
 * sequence of display glyphs ["⌘", "⇧", "C"]. Multi-character key names
 * (e.g. "F1", "Tab") are kept as single units so they render in one
 * key-cap. Mac-only glyphs are used since VisionPipe is Mac-only.
 */
function splitKeys(combo: string): string[] {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => {
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
  });
}

interface Props {
  /**
   * Which hotkey to display. Defaults to "take_next_screenshot" since
   * that's the marquee shortcut shown in the empty/idle states.
   */
  binding?: keyof RustHotkeyConfig;
  /** Optional label shown to the left of the key cluster, e.g. "Capture:" */
  label?: string;
  /** "sm" (default) for inline text-flow contexts; "lg" for prominent CTAs. */
  size?: "sm" | "lg";
}

/**
 * Mac-keycap-style keyboard shortcut display. Renders each key in the
 * combo as its own dark, slightly-raised square — visually matching
 * apps like Hex / Raycast / native macOS rather than a single colored
 * pill. Click anywhere on the cluster to open the SettingsPanel and
 * rebind. The displayed combo refreshes when the panel closes.
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

  const onSettingsClose = () => {
    setSettingsOpen(false);
    invoke<RustHotkeyConfig>("load_hotkey_config")
      .then((cfg) => setCombo(cfg[binding]))
      .catch(() => {/* keep stale value */});
  };

  const isLg = size === "lg";
  // Key-cap dimensions modeled on Hex's settings UI: roughly square,
  // softly-rounded, dark-gray with a subtle border + bottom shadow so
  // the keys read as physical keycaps.
  const minSize = isLg ? 56 : 36;
  const fontSize = isLg ? 28 : 18;
  const radius = isLg ? 12 : 8;
  const gap = isLg ? 6 : 4;

  const keys = splitKeys(combo);

  return (
    <>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Click to change keyboard shortcut"
        style={{
          display: "inline-flex", alignItems: "center", gap: isLg ? 12 : 8,
          background: "transparent", border: "none", padding: 0,
          cursor: "pointer", fontFamily: FONT_MONO,
        }}
      >
        {label && <span style={{ color: C.textDim, fontSize }}>{label}</span>}
        <span style={{ display: "inline-flex", alignItems: "center", gap }}>
          {keys.map((k, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                minWidth: minSize, height: minSize,
                padding: `0 ${isLg ? 14 : 8}px`,
                background: "#262b29",
                color: "#ffffff",
                border: "1px solid #3a4240",
                borderRadius: radius,
                fontFamily: FONT_MONO, fontSize, fontWeight: 700,
                lineHeight: 1, letterSpacing: 0,
                // Subtle "raised key" feel: top inner highlight +
                // bottom outer shadow. Avoids the single-flat-pill look.
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 0 rgba(0,0,0,0.3), 0 4px 8px rgba(0,0,0,0.25)",
                userSelect: "none",
              }}
            >
              {k}
            </span>
          ))}
        </span>
      </button>
      {settingsOpen && <SettingsPanel onClose={onSettingsClose} />}
    </>
  );
}

// Exported for testing.
export const __test__ = { splitKeys };
