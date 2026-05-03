import { C, FONT_BODY } from "../lib/ui-tokens";
import { Clipboard } from "lucide-react";

interface Props {
  onCopyAndSend: () => Promise<void> | void;
  copyTooltip: string;
  busy: boolean;
}

/**
 * Footer with the primary "Copy & Send" action only. The "Take next
 * screenshot" affordance lives inline below the last screenshot card
 * (in InterleavedView / SplitView), so it was removed from here per
 * user feedback to avoid the duplicate button.
 */
export function Footer({ onCopyAndSend, copyTooltip, busy }: Props) {
  return (
    <footer style={{
      display: "flex", justifyContent: "flex-end", alignItems: "center",
      padding: "10px 16px", background: C.deepForest,
      borderTop: `1px solid ${C.border}`, fontFamily: FONT_BODY,
    }}>
      <button
        onClick={() => void onCopyAndSend()}
        disabled={busy}
        title={copyTooltip}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          background: C.teal, border: "none",
          color: C.deepForest, padding: "8px 18px", borderRadius: 6,
          cursor: busy ? "wait" : "pointer", fontSize: 13, fontWeight: 700,
        }}
      >
        <Clipboard size={14} strokeWidth={2.5} />
        Copy &amp; Send
      </button>
    </footer>
  );
}
