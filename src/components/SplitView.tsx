import { useState } from "react";
import { useSession } from "../state/session-context";
import { Lightbox } from "./Lightbox";
import { convertFileSrc } from "@tauri-apps/api/core";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";

interface Props {
  onTakeNextScreenshot: () => void;
  onRequestRerecord: (seq: number) => void;
  onRequestDelete: (seq: number) => void;
}

export function SplitView({ onTakeNextScreenshot, onRequestRerecord, onRequestDelete }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const [lightboxSeq, setLightboxSeq] = useState<number | null>(null);
  const [activeSeq, setActiveSeq] = useState<number | null>(
    session.screenshots[session.screenshots.length - 1]?.seq ?? null
  );

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <aside style={{
        width: "40%", borderRight: `1px solid ${C.border}`,
        overflowY: "auto", padding: 12, background: C.deepForest,
      }}>
        {session.screenshots.map(s => (
          <div
            key={s.seq}
            onClick={() => setActiveSeq(s.seq)}
            style={{
              display: "flex", gap: 8, padding: 8, marginBottom: 6,
              background: s.seq === activeSeq ? C.forest : "transparent",
              border: `1px solid ${s.seq === activeSeq ? C.teal : C.border}`,
              borderRadius: 4, cursor: "pointer",
            }}
          >
            <img
              src={convertFileSrc(`${session.folder}/${s.canonicalName}.png`)}
              onClick={(e) => { e.stopPropagation(); setLightboxSeq(s.seq); }}
              style={{ width: 60, height: 40, objectFit: "cover", borderRadius: 3 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: C.textMuted,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                   title={s.canonicalName}>
                {s.canonicalName}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.amber,
                            fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.caption || "—"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button onClick={(e) => { e.stopPropagation(); onRequestRerecord(s.seq); }} style={miniBtn()}>🎙</button>
              <button onClick={(e) => { e.stopPropagation(); onRequestDelete(s.seq); }} style={miniBtn()}>🗑</button>
            </div>
          </div>
        ))}
        <button onClick={onTakeNextScreenshot} style={{
          width: "100%", padding: 10, background: "transparent",
          border: `1px dashed ${C.borderLight}`, color: C.textMuted,
          borderRadius: 4, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12,
        }}>
          ＋ Take next screenshot
        </button>
      </aside>

      <section style={{ flex: 1, padding: 16, overflowY: "auto", color: C.textBright, fontFamily: FONT_BODY }}>
        {session.screenshots.map(s => (
          <div key={s.seq} style={{ marginBottom: 24 }}>
            <h3
              onClick={() => setActiveSeq(s.seq)}
              style={{
                fontFamily: FONT_MONO, fontSize: 11, color: C.amber,
                cursor: "pointer", marginBottom: 6,
              }}>
              --- Screenshot {s.seq} — {s.canonicalName} ---
            </h3>
            <textarea
              value={s.transcriptSegment}
              onChange={(e) => dispatch({
                type: "UPDATE_TRANSCRIPT_SEGMENT", seq: s.seq, text: e.target.value,
              })}
              style={{
                width: "100%", minHeight: 80, padding: 8,
                background: C.forest, border: `1px solid ${s.seq === activeSeq ? C.teal : C.borderLight}`,
                color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
              }}
            />
          </div>
        ))}
        <div>
          <h3 style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
            --- Closing narration ---
          </h3>
          <textarea
            value={session.closingNarration}
            onChange={(e) => dispatch({ type: "UPDATE_CLOSING_NARRATION", text: e.target.value })}
            style={{
              width: "100%", minHeight: 60, padding: 8,
              background: C.forest, border: `1px solid ${C.borderLight}`,
              color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
            }}
          />
        </div>
      </section>
      {lightboxSeq !== null && <Lightbox seq={lightboxSeq} onClose={() => setLightboxSeq(null)} />}
    </div>
  );
}

const miniBtn = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, width: 22, height: 22, borderRadius: 3,
  cursor: "pointer", fontSize: 11, padding: 0,
});
