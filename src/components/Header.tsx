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

function OverflowMenu({ onNewSession, onOpenFolder, onOpenSettings }: {
  onNewSession: () => void; onOpenFolder: () => void; onOpenSettings: () => void;
}) {
  const handle = () => {
    const choice = window.prompt(
      "Choose: 1) New session  2) Open session folder  3) Settings  (1/2/3)",
      ""
    );
    if (choice === "1") onNewSession();
    else if (choice === "2") onOpenFolder();
    else if (choice === "3") onOpenSettings();
  };
  // Replace with a real popover menu in a follow-on polish pass; v0.2 ships with this minimal prompt-based menu.
  return <button onClick={handle} style={btnStyle()}>⋮</button>;
}
