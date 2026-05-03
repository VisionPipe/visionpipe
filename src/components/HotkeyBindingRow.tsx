import { useState } from "react";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";

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
  // Ignore plain modifier presses (no actual key)
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return "";
  let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (k === "Tab" || k === "Enter" || k === "Space" || k === "Escape") k = k;
  parts.push(k);
  return parts.join("+");
};

export function HotkeyBindingRow({ label, scope, combo, otherBindings, onChange, onReset }: Props) {
  const [capturing, setCapturing] = useState(false);
  const conflict = detectConflict(combo, otherBindings);

  const startCapture = () => {
    setCapturing(true);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setCapturing(false);
        window.removeEventListener("keydown", handler);
        return;
      }
      const k = formatKey(e);
      if (!k) return; // modifier-only press
      window.removeEventListener("keydown", handler);
      setCapturing(false);
      onChange(k);
    };
    window.addEventListener("keydown", handler);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, alignItems: "center", padding: 8 }}>
      <div style={{ fontFamily: FONT_BODY, color: C.textBright }}>
        {label}
        <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 8 }}>({scope})</span>
      </div>
      <code style={{
        fontFamily: FONT_MONO, fontSize: 12, color: C.amber,
        padding: "4px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 4, minWidth: 160, textAlign: "center",
      }}>
        {capturing ? "Press new shortcut…" : combo}
      </code>
      <button onClick={startCapture} disabled={capturing} style={btnStyle()}>
        {capturing ? "…" : "Change"}
      </button>
      <button onClick={onReset} style={btnStyle()}>Reset</button>
      {conflict && (
        <div style={{ gridColumn: "1 / -1", color: C.sienna, fontSize: 11 }}>{conflict}</div>
      )}
    </div>
  );
}

const btnStyle = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, padding: "4px 10px", borderRadius: 4,
  cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12,
});
