import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  onTakeNextScreenshot: () => void;
  onCopyAndSend: () => Promise<void> | void;
  copyTooltip: string;
  busy: boolean;
}

export function Footer({ onTakeNextScreenshot, onCopyAndSend, copyTooltip, busy }: Props) {
  return (
    <footer style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 16px", background: C.deepForest,
      borderTop: `1px solid ${C.border}`, fontFamily: FONT_BODY,
    }}>
      <button
        onClick={onTakeNextScreenshot}
        disabled={busy}
        style={{
          background: "transparent", border: `1px solid ${C.borderLight}`,
          color: C.textBright, padding: "8px 16px", borderRadius: 6,
          cursor: busy ? "wait" : "pointer", fontSize: 13,
        }}
      >
        ＋ Take next screenshot
      </button>
      <button
        onClick={() => void onCopyAndSend()}
        disabled={busy}
        title={copyTooltip}
        style={{
          background: C.teal, border: "none",
          color: C.deepForest, padding: "8px 18px", borderRadius: 6,
          cursor: busy ? "wait" : "pointer", fontSize: 13, fontWeight: 700,
        }}
      >
        📋 Copy &amp; Send
      </button>
    </footer>
  );
}
