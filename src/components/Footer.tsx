import { C, FONT_BODY } from "../lib/ui-tokens";
import { Clipboard } from "lucide-react";

interface Props {
  onCopyAndSend: () => Promise<void> | void;
  onCancel: () => void;
  onSaveToDisk: () => Promise<void> | void;
  copyTooltip: string;
  busy: boolean;
}

/**
 * Footer with three controls:
 *   [Cancel]     [Copy to Clipboard]   or save to disk
 *
 * Cancel is outline-only (transparent background) so it doesn't compete
 * visually with the primary teal Copy button. Save-to-disk is a text
 * link sitting next to the primary button — it deducts credits same as
 * Copy, but writes to a Finder-chosen location instead of the clipboard.
 *
 * The "Take next screenshot" affordance lives inline below the last
 * screenshot card (in InterleavedView / SplitView), so it's not in the
 * footer.
 */
export function Footer({ onCopyAndSend, onCancel, onSaveToDisk, copyTooltip, busy }: Props) {
  return (
    <footer style={{
      display: "flex", justifyContent: "flex-end", alignItems: "center",
      gap: 12,
      padding: "10px 16px", background: C.deepForest,
      borderTop: `1px solid ${C.border}`, fontFamily: FONT_BODY,
    }}>
      <button
        onClick={onCancel}
        title="Discard this session without sending. Already-captured screenshots remain in the session folder; they just don't get bundled into a markdown file."
        style={{
          background: "transparent",
          border: `1px solid ${C.borderLight}`,
          color: C.textBright,
          padding: "8px 16px", borderRadius: 6,
          fontSize: 13, fontWeight: 500,
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
      <button
        onClick={() => void onCopyAndSend()}
        disabled={busy}
        title={copyTooltip}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          // Visually de-emphasise the disabled state and use the
          // not-allowed (slashed-circle) cursor instead of `wait` (which
          // renders as a spinner on macOS — users misread the disabled
          // state as "thinking" / "in progress").
          background: busy ? "rgba(46,139,122,0.4)" : C.teal,
          border: "none",
          color: C.deepForest, padding: "8px 18px", borderRadius: 6,
          cursor: busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700,
        }}
      >
        <Clipboard size={14} strokeWidth={2.5} />
        Copy to Clipboard
      </button>
      <span style={{ color: C.textDim, fontSize: 12 }}>
        or{" "}
        <a
          onClick={(e) => { e.preventDefault(); if (!busy) void onSaveToDisk(); }}
          style={{
            color: busy ? C.textDim : C.teal,
            textDecoration: "underline",
            cursor: busy ? "not-allowed" : "pointer",
            fontSize: 12,
          }}
        >
          save to disk
        </a>
      </span>
    </footer>
  );
}
