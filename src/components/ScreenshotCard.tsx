import { useState } from "react";
import { useSession } from "../state/session-context";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";
import type { Screenshot } from "../types/session";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Mic, X } from "lucide-react";

interface Props {
  screenshot: Screenshot;
  isActive: boolean;
  onOpenLightbox: (seq: number) => void;
  onRequestRerecord: (seq: number) => void;
  onRequestDelete: (seq: number) => void;
}

/**
 * Card layout (per user spec, 2026-05-03):
 *   ┌──────────────────┬─────────────────────────────────┐
 *   │  [image, big,    │  NARRATION              [🎙]   │
 *   │   full-column,   │  ┌─────────────────────────┐   │
 *   │   click=lightbox]│  │ transcript text…        │   │
 *   │  [×] in corner   │  │                         │   │
 *   │                  │  └─────────────────────────┘   │
 *   │  Caption (edit)  │                                 │
 *   │  canonicalName   │                                 │
 *   └──────────────────┴─────────────────────────────────┘
 *
 * Image and transcript are siblings in a flex row, so each card's
 * transcript pairs with its own image — no more independent stacking.
 */
export function ScreenshotCard({ screenshot, isActive, onOpenLightbox, onRequestRerecord, onRequestDelete }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(screenshot.caption);

  const imgSrc = convertFileSrc(`${session.folder}/${screenshot.canonicalName}.png`);

  const saveCaption = () => {
    dispatch({ type: "UPDATE_CAPTION", seq: screenshot.seq, caption: captionDraft.trim() });
    setEditingCaption(false);
  };

  return (
    <article style={{
      display: "flex", gap: 16, padding: 12, alignItems: "flex-start",
      background: C.deepForest, border: `1px solid ${isActive ? C.teal : C.border}`,
      borderRadius: 8, marginBottom: 12,
    }}>
      {/* IMAGE COLUMN — half width, image fills it */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: "relative" }}>
          <img
            src={imgSrc}
            alt={screenshot.canonicalName}
            onClick={() => onOpenLightbox(screenshot.seq)}
            style={{
              width: "100%", height: "auto", display: "block",
              cursor: "zoom-in", borderRadius: 4, border: `1px solid ${C.borderLight}`,
            }}
          />
          {/* Delete X — overlaid in top-right corner of the image */}
          <button
            onClick={() => onRequestDelete(screenshot.seq)}
            title="Remove this screenshot"
            style={{
              position: "absolute", top: 8, right: 8,
              width: 26, height: 26, borderRadius: 999,
              background: "rgba(20, 30, 24, 0.85)", color: C.cream,
              border: `1px solid ${C.borderLight}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", padding: 0,
            }}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        {/* Editable caption ("name") below image */}
        {editingCaption ? (
          <input
            autoFocus
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onBlur={saveCaption}
            onKeyDown={(e) => e.key === "Enter" && saveCaption()}
            style={{
              width: "100%", padding: "6px 10px", marginTop: 8,
              background: C.forest, border: `1px solid ${C.borderLight}`,
              color: C.textBright, borderRadius: 4, fontSize: 13,
              fontFamily: FONT_BODY,
            }}
          />
        ) : (
          <div
            onClick={() => { setCaptionDraft(screenshot.caption); setEditingCaption(true); }}
            style={{
              padding: "6px 10px", marginTop: 8,
              color: screenshot.caption ? C.amber : C.textDim,
              fontStyle: "italic", fontSize: 13, cursor: "text",
              background: C.forest, borderRadius: 4,
              fontFamily: FONT_BODY,
            }}
          >
            {screenshot.caption || "Add a name…"}
          </div>
        )}

        {/* Tiny canonicalName underneath — useful for grounding markdown
            alt-text but kept low-contrast so it doesn't compete. */}
        <code style={{
          display: "block", marginTop: 4, padding: "0 10px",
          fontFamily: FONT_MONO, fontSize: 9, color: C.textDim,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }} title={screenshot.canonicalName}>
          {screenshot.canonicalName}
        </code>
      </div>

      {/* TRANSCRIPT COLUMN — half width, mic button + transcript */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 6,
        }}>
          <span style={{
            color: C.textMuted, fontSize: 10, letterSpacing: "0.08em",
            textTransform: "uppercase", fontFamily: FONT_BODY,
          }}>
            Narration
          </span>
          <button
            onClick={() => onRequestRerecord(screenshot.seq)}
            title="Re-record narration for this screenshot"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "transparent", border: `1px solid ${C.borderLight}`,
              color: C.textBright, padding: "4px 10px", borderRadius: 4,
              cursor: "pointer", fontSize: 11, fontFamily: FONT_BODY,
            }}
          >
            <Mic size={12} strokeWidth={2} />
            Re-record
          </button>
        </div>
        <textarea
          value={screenshot.transcriptSegment}
          onChange={(e) => dispatch({
            type: "UPDATE_TRANSCRIPT_SEGMENT", seq: screenshot.seq, text: e.target.value,
          })}
          placeholder={screenshot.offline ? "(offline — audio recorded locally; no transcript)" : "Speak or type narration here…"}
          style={{
            width: "100%", flex: 1, minHeight: 140, padding: 10,
            background: C.forest, border: `1px solid ${C.borderLight}`,
            color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      </div>
    </article>
  );
}
