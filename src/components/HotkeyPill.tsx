import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPanel } from "./SettingsPanel";
import { C, FONT_MONO } from "../lib/ui-tokens";
import { KeyCaps } from "./KeyCaps";

interface RustHotkeyConfig {
  take_next_screenshot: string;
  copy_and_send: string;
  rerecord_active: string;
  toggle_view_mode: string;
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

  return (
    <>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Click to change keyboard shortcut"
        style={{
          display: "inline-flex", alignItems: "center", gap: size === "lg" ? 12 : 8,
          background: "transparent", border: "none", padding: 0,
          cursor: "pointer", fontFamily: FONT_MONO,
        }}
      >
        {label && (
          <span style={{ color: C.textDim, fontSize: size === "lg" ? 28 : 18 }}>
            {label}
          </span>
        )}
        <KeyCaps combo={combo} size={size} />
      </button>
      {settingsOpen && <SettingsPanel onClose={onSettingsClose} />}
    </>
  );
}
