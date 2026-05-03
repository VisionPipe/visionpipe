import { useEffect, useRef, useState } from "react";
import { useSession } from "../state/session-context";
import { createRecorder, type RecorderHandle } from "../lib/audio-recorder";
import { invoke } from "@tauri-apps/api/core";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  seq: number;
  onClose: () => void;
}

export function ReRecordModal({ seq, onClose }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const screenshot = session.screenshots.find(s => s.seq === seq)!;
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let id: number | null = null;
    (async () => {
      try {
        recorderRef.current = await createRecorder();
        await recorderRef.current.start();
        setRecording(true);
        id = window.setInterval(() => {
          setElapsed(recorderRef.current?.elapsedSec() ?? 0);
        }, 250);
      } catch (err) {
        console.warn("[VisionPipe] Re-record start failed:", err);
        onClose();
      }
    })();
    return () => { if (id) clearInterval(id); };
  }, []);

  const stop = async () => {
    if (!recorderRef.current) return;
    try {
      const blob = await recorderRef.current.stop();
      const buf = new Uint8Array(await blob.arrayBuffer());
      const filename = `${screenshot.canonicalName}-rerecord.webm`;
      await invoke("write_session_file", {
        folder: session.folder, filename, bytes: Array.from(buf),
      });
      dispatch({ type: "SET_RE_RECORDED_AUDIO", seq, filename });
    } catch (err) {
      console.error("[VisionPipe] Re-record save failed:", err);
    } finally {
      setRecording(false);
      onClose();
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: C.deepForest, border: `1px solid ${C.borderLight}`,
        padding: 32, borderRadius: 8, color: C.textBright, fontFamily: FONT_BODY,
        textAlign: "center", minWidth: 360,
      }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          Re-recording for Screenshot {seq}
        </div>
        <div style={{ fontSize: 28, color: recording ? C.sienna : C.textMuted, margin: "12px 0" }}>
          ● {elapsed.toFixed(1)}s
        </div>
        <button onClick={stop} style={{
          background: C.teal, border: "none", color: C.deepForest,
          padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: "pointer",
        }}>
          Stop
        </button>
      </div>
    </div>
  );
}
