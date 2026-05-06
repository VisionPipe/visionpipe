import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSession } from "../state/session-context";
import { useCredit } from "../state/credit-context";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";
import { VersionBadge } from "./VersionBadge";

export type NetworkState = "live" | "local-only" | "reconnecting";

interface Props {
  micRecording: boolean;
  micPermissionDenied: boolean;
  networkState: NetworkState;
  onToggleMic: () => void;
  onToggleViewMode: () => void;
  onOpenSettings: () => void;
  onNewSession: () => void;
  onOpenSessionFolder: () => void;
}

const dotColor = (s: NetworkState, recording: boolean): string => {
  if (!recording) return C.textDim;
  if (s === "live") return C.sienna;
  if (s === "reconnecting") return C.amber;
  return C.textMuted;
};

const networkLabel = (s: NetworkState): string =>
  s === "live" ? "Live" : s === "reconnecting" ? "Reconnecting…" : "Local-only";

export function Header(props: Props) {
  const { state } = useSession();
  const session = state.session;
  if (!session) return null;

  return (
    <header
      data-tauri-drag-region
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        // 80px left padding clears the macOS traffic-light controls (close /
        // minimize / zoom) that Tauri overlays at top-left when
        // titleBarStyle is "Overlay". Without this, the brand+session-id
        // collide with the dots.
        padding: "10px 16px 10px 80px",
        minHeight: 32,
        background: C.deepForest,
        borderBottom: `1px solid ${C.border}`, color: C.textBright, fontFamily: FONT_BODY,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontWeight: 700, color: C.teal }}>Vision<span style={{ color: C.amber }}>|</span>Pipe</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textMuted, cursor: "pointer" }}
              title="Click to copy folder path"
              onClick={() => navigator.clipboard.writeText(session.folder)}>
          session-{session.id}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <CreditChip />
        <button
          onClick={props.onToggleMic}
          disabled={props.micPermissionDenied}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "transparent", border: `1px solid ${C.borderLight}`,
            color: C.textBright, padding: "4px 10px", borderRadius: 4,
            cursor: props.micPermissionDenied ? "not-allowed" : "pointer", fontFamily: FONT_BODY, fontSize: 12,
          }}
          title={props.micPermissionDenied ? "Microphone permission required" : "Toggle recording"}
        >
          <span style={{
            width: 8, height: 8, borderRadius: 999,
            background: dotColor(props.networkState, props.micRecording),
          }} />
          {props.micRecording ? `Recording · ${networkLabel(props.networkState)}` : "Paused"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={props.onToggleViewMode}
          style={btnStyle()}
          title={session.viewMode === "interleaved" ? "Detach transcript (split view)" : "Attach transcript (interleaved)"}
        >
          ◫ {session.viewMode === "interleaved" ? "Detach transcript" : "Attach transcript"}
        </button>
        <OverflowMenu
          onNewSession={props.onNewSession}
          onOpenFolder={props.onOpenSessionFolder}
          onOpenSettings={props.onOpenSettings}
        />
        <VersionBadge />
      </div>
    </header>
  );
}

const btnStyle = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, padding: "4px 10px", borderRadius: 4,
  cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12,
});

function CreditChip() {
  const { balance, currentBundleCost } = useCredit();
  const insufficient = currentBundleCost.total > balance;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 10px", borderRadius: 4,
        background: "transparent",
        border: `1px solid ${insufficient ? C.amber : C.borderLight}`,
        color: insufficient ? C.amber : C.textBright,
        fontFamily: FONT_MONO, fontSize: 11,
      }}
      title={
        insufficient
          ? `This bundle costs ${currentBundleCost.total} credits but you only have ${balance}.`
          : `Bundle: ${currentBundleCost.screenshots} screenshot${currentBundleCost.screenshots === 1 ? "" : "s"} + ${currentBundleCost.audio} audio = ${currentBundleCost.total}. Balance: ${balance}.`
      }
    >
      <span>Cost: {currentBundleCost.total} cr</span>
      <span style={{ opacity: 0.6 }}>·</span>
      <span>Balance: {balance} cr</span>
    </div>
  );
}

/**
 * Real dropdown menu, replacing the prior `window.prompt`-based stub
 * (which on some macOS / Tauri webview combinations silently dropped
 * the prompt — the user clicked ⋮ and saw nothing happen). Opens on
 * click, closes on (a) item selection, (b) outside click, or (c)
 * Escape.
 */
function OverflowMenu({
  onNewSession, onOpenFolder, onOpenSettings,
}: {
  onNewSession: () => void; onOpenFolder: () => void; onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (action: () => void) => {
    setOpen(false);
    action();
  };

  const revealLogs = async () => {
    try {
      await invoke("reveal_logs_in_finder");
    } catch (err) {
      console.warn("[VisionPipe] reveal_logs_in_finder failed:", err);
    }
  };

  const saveDiagnostic = async () => {
    try {
      await invoke("save_diagnostic_bundle");
    } catch (err) {
      console.warn("[VisionPipe] save_diagnostic_bundle failed:", err);
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={btnStyle()} title="More actions">⋮</button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 1500,
            background: C.deepForest, border: `1px solid ${C.borderLight}`,
            borderRadius: 6, padding: 4, minWidth: 200,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            display: "flex", flexDirection: "column",
          }}
        >
          <MenuItem onSelect={() => select(onNewSession)}>New session</MenuItem>
          <MenuItem onSelect={() => select(onOpenFolder)}>Open session folder</MenuItem>
          <MenuDivider />
          <MenuItem onSelect={() => select(onOpenSettings)}>Settings…</MenuItem>
          <MenuDivider />
          <MenuItem onSelect={() => select(revealLogs)}>Reveal logs in Finder…</MenuItem>
          <MenuItem onSelect={() => select(saveDiagnostic)}>Save diagnostic bundle…</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      style={{
        background: "transparent", border: "none", color: C.textBright,
        textAlign: "left", padding: "8px 10px", borderRadius: 4,
        cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.forest; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: C.border, margin: "2px 0" }} />;
}
