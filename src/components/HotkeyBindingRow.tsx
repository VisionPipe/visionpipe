import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, FONT_BODY } from "../lib/ui-tokens";
import { KeyCaps } from "./KeyCaps";

export const RESERVED_COMBOS: Map<string, string> = new Map([
  ["CmdOrCtrl+Q", "Reserved by macOS (Quit)"],
  ["CmdOrCtrl+W", "Reserved by macOS (Close window)"],
  ["CmdOrCtrl+Tab", "Reserved by macOS (App switcher)"],
  ["CmdOrCtrl+Space", "Reserved by macOS (Spotlight)"],
  ["CmdOrCtrl+H", "Reserved by macOS (Hide app)"],
  ["CmdOrCtrl+M", "Reserved by macOS (Minimize)"],
]);

export function detectConflict(combo: string, otherBindings: string[]): string | null {
  if (RESERVED_COMBOS.has(combo)) return RESERVED_COMBOS.get(combo)!;
  if (otherBindings.includes(combo)) return "Conflicts with another VisionPipe binding";
  return null;
}

interface Props {
  label: string;
  scope: "global" | "window";
  combo: string;
  otherBindings: string[];
  onChange: (newCombo: string) => void;
  onReset: () => void;
}

const formatKey = (e: KeyboardEvent): string => {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  // Ignore plain modifier presses (no actual key).
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return "";
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(k);
  return parts.join("+");
};

export function HotkeyBindingRow({ label, scope, combo, otherBindings, onChange, onReset }: Props) {
  const [capturing, setCapturing] = useState(false);
  const conflict = detectConflict(combo, otherBindings);
  const handlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  // Make sure we don't leak a keydown listener (or a paused-shortcut state)
  // if the component unmounts mid-capture (e.g. user clicks the X to close
  // Settings while a row is recording).
  useEffect(() => {
    return () => {
      if (handlerRef.current) {
        window.removeEventListener("keydown", handlerRef.current);
        // Best-effort resume; the Tauri command is idempotent.
        void invoke("resume_global_shortcuts").catch(() => {/* ignore */});
      }
    };
  }, []);

  const startCapture = async () => {
    if (capturing) return;
    setCapturing(true);

    // Pause global shortcuts so pressing the existing capture combo
    // (e.g. ⌘⇧C) during rebind doesn't also fire the global handler
    // and pull focus away from Settings. The Tauri side unregisters
    // all global shortcuts; resume_global_shortcuts (called below
    // after the keystroke or on Escape) re-registers them with the
    // current — possibly just-changed — config.
    try {
      await invoke("pause_global_shortcuts");
    } catch (err) {
      console.warn("[VisionPipe] pause_global_shortcuts failed:", err);
    }

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        cleanup();
        return;
      }
      const k = formatKey(e);
      if (!k) return; // modifier-only press — keep listening
      cleanup();
      onChange(k);
    };

    const cleanup = () => {
      window.removeEventListener("keydown", handler);
      handlerRef.current = null;
      setCapturing(false);
      void invoke("resume_global_shortcuts").catch((err) => {
        console.warn("[VisionPipe] resume_global_shortcuts failed:", err);
      });
    };

    handlerRef.current = handler;
    window.addEventListener("keydown", handler);
  };

  // Visual states for the clickable key cluster:
  //   - normal:    dark keycaps
  //   - capturing: amber border on the wrapper, "Press shortcut…" placeholder
  //   - conflict:  sienna border + tooltip
  const wrapperBorder = capturing ? C.amber : (conflict ? C.sienna : C.borderLight);
  const wrapperBg = capturing ? "rgba(212,136,42,0.08)" : "transparent";

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto auto",
      gap: 12, alignItems: "center", padding: "8px 0",
    }}>
      <div style={{ fontFamily: FONT_BODY, color: C.textBright }}>
        {label}
        <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 8 }}>({scope})</span>
      </div>

      {/* Click target: wraps the keycaps and (when capturing) a placeholder
          string. Whole box is the click target — no separate Change button. */}
      <button
        type="button"
        onClick={startCapture}
        disabled={capturing}
        title={capturing ? "Press a new shortcut, or Esc to cancel" : "Click to change shortcut"}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          minWidth: 200, minHeight: 52,
          padding: "6px 12px",
          background: wrapperBg,
          border: `1px solid ${wrapperBorder}`,
          borderRadius: 10,
          cursor: capturing ? "default" : "pointer",
          fontFamily: FONT_BODY,
        }}
      >
        {capturing ? (
          <span style={{ color: C.amber, fontSize: 13, fontWeight: 600 }}>
            Press shortcut…
          </span>
        ) : (
          <KeyCaps combo={combo} size="sm" />
        )}
      </button>

      <button
        onClick={onReset}
        disabled={capturing}
        style={{
          background: "transparent", border: `1px solid ${C.borderLight}`,
          color: C.textBright, padding: "6px 12px", borderRadius: 4,
          cursor: capturing ? "default" : "pointer", fontFamily: FONT_BODY, fontSize: 12,
          opacity: capturing ? 0.5 : 1,
        }}
      >
        Reset
      </button>

      {conflict && (
        <div style={{ gridColumn: "1 / -1", color: C.sienna, fontSize: 11, marginTop: 4 }}>
          {conflict}
        </div>
      )}
    </div>
  );
}
