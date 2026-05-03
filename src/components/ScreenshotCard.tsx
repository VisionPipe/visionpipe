import { useState } from "react";
import { useSession } from "../state/session-context";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";
import type { Screenshot } from "../types/session";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  screenshot: Screenshot;
  isActive: boolean;
  onOpenLightbox: (seq: number) => void;
  onRequestRerecord: (seq: number) => void;
  onRequestDelete: (seq: number) => void;
}

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
      display: "flex", gap: 12, padding: 12,
      background: C.deepForest, border: `1px solid ${isActive ? C.teal : C.border}`,
      borderRadius: 8, marginBottom: 12,
    }}>
      <img
        src={imgSrc}
        alt={screenshot.canonicalName}
        onClick={() => onOpenLightbox(screenshot.seq)}
        style={{
          width: 160, height: "auto", maxHeight: 120, objectFit: "cover",
          cursor: "zoom-in", borderRadius: 4, border: `1px solid ${C.borderLight}`,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, color: C.textBright, fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <code style={{
            fontFamily: FONT_MONO, fontSize: 10, color: C.textMuted,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={screenshot.canonicalName}>
            {screenshot.canonicalName}
          </code>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onRequestRerecord(screenshot.seq)} style={iconBtn()}>🎙</button>
            <button onClick={() => onRequestDelete(screenshot.seq)} style={iconBtn()}>🗑</button>
          </div>
        </div>
        {editingCaption ? (
          <input
            autoFocus
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onBlur={saveCaption}
            onKeyDown={(e) => e.key === "Enter" && saveCaption()}
            style={{
              width: "100%", padding: "4px 8px", marginBottom: 6,
              background: C.forest, border: `1px solid ${C.borderLight}`,
              color: C.textBright, borderRadius: 4, fontSize: 12,
            }}
          />
        ) : (
          <div
            onClick={() => { setCaptionDraft(screenshot.caption); setEditingCaption(true); }}
            style={{
              padding: "4px 8px", marginBottom: 6,
              color: screenshot.caption ? C.amber : C.textDim,
              fontStyle: "italic", fontSize: 12, cursor: "text",
              background: C.forest, borderRadius: 4,
            }}
          >
            {screenshot.caption || "Add a caption…"}
          </div>
        )}
        <textarea
          value={screenshot.transcriptSegment}
          onChange={(e) => dispatch({
            type: "UPDATE_TRANSCRIPT_SEGMENT", seq: screenshot.seq, text: e.target.value,
          })}
          placeholder={screenshot.offline ? "(offline — audio recorded locally; no transcript)" : "Speak or type narration here…"}
          style={{
            width: "100%", minHeight: 60, padding: 8,
            background: C.forest, border: `1px solid ${C.borderLight}`,
            color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
          }}
        />
      </div>
    </article>
  );
}

const iconBtn = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, width: 28, height: 28, borderRadius: 4,
  cursor: "pointer", fontSize: 14,
});
