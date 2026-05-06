import { FONT_MONO } from "../lib/ui-tokens";

/**
 * Convert a stored hotkey-combo string ("CmdOrCtrl+Shift+C") into the
 * sequence of display glyphs ["⌘", "⇧", "C"]. Multi-character key names
 * (e.g. "F1", "Tab") are kept as single units so they render in one
 * key-cap. Mac-only glyphs are used since VisionPipe is Mac-only.
 */
export function splitKeys(combo: string): string[] {
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

export type KeyCapSize = "sm" | "md" | "lg";

const SIZE_DIMS: Record<KeyCapSize, { minSize: number; fontSize: number; radius: number; padX: number; gap: number }> = {
  sm: { minSize: 36, fontSize: 18, radius: 8,  padX: 8,  gap: 4 },
  md: { minSize: 44, fontSize: 22, radius: 10, padX: 10, gap: 5 },
  lg: { minSize: 56, fontSize: 28, radius: 12, padX: 14, gap: 6 },
};

interface KeyCapProps {
  glyph: string;
  size: KeyCapSize;
  /** Override colors for special states (e.g. recording, conflict). */
  background?: string;
  borderColor?: string;
  textColor?: string;
}

/**
 * Single key-cap rendering — a dark, slightly-raised square with a
 * centered glyph. Used by both the in-text HotkeyPill (clickable
 * shortcut display) and the Settings panel (rebinding rows).
 */
export function KeyCap({ glyph, size, background, borderColor, textColor }: KeyCapProps) {
  const dims = SIZE_DIMS[size];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: dims.minSize, height: dims.minSize,
        padding: `0 ${dims.padX}px`,
        background: background ?? "#262b29",
        color: textColor ?? "#ffffff",
        border: `1px solid ${borderColor ?? "#3a4240"}`,
        borderRadius: dims.radius,
        fontFamily: FONT_MONO, fontSize: dims.fontSize, fontWeight: 700,
        lineHeight: 1, letterSpacing: 0,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 0 rgba(0,0,0,0.3), 0 4px 8px rgba(0,0,0,0.25)",
        userSelect: "none",
      }}
    >
      {glyph}
    </span>
  );
}

interface KeyCapsProps {
  /** Combo string like "CmdOrCtrl+Shift+C". Empty string = nothing rendered. */
  combo: string;
  size?: KeyCapSize;
  background?: string;
  borderColor?: string;
  textColor?: string;
}

/**
 * Display-only key-cap cluster. Pure rendering — no click handlers,
 * no state. Caller wraps it in whatever (button, label, etc.) is
 * appropriate for the surface.
 */
export function KeyCaps({ combo, size = "sm", background, borderColor, textColor }: KeyCapsProps) {
  const dims = SIZE_DIMS[size];
  const glyphs = splitKeys(combo);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: dims.gap }}>
      {glyphs.map((g, i) => (
        <KeyCap
          key={i}
          glyph={g}
          size={size}
          background={background}
          borderColor={borderColor}
          textColor={textColor}
        />
      ))}
    </span>
  );
}
