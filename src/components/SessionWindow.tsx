import { useState, useEffect } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { InterleavedView } from "./InterleavedView";
import { SplitView } from "./SplitView";
import { Lightbox } from "./Lightbox";
import { ReRecordModal } from "./ReRecordModal";
import { useSession } from "../state/session-context";
import { useMic } from "../state/mic-context";
import { renderMarkdown } from "../lib/markdown-renderer";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";

export function SessionWindow() {
  const { state, dispatch } = useSession();
  const mic = useMic();
  const [lightboxSeq, setLightboxSeq] = useState<number | null>(null);
  const [rerecordSeq, setRerecordSeq] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ seq: number }>;
      setRerecordSeq(ce.detail.seq);
    };
    window.addEventListener("vp-rerecord-segment", handler);
    return () => window.removeEventListener("vp-rerecord-segment", handler);
  }, []);

  if (!state.session) return null;
  const session = state.session;

  const onCopyAndSend = async () => {
    const md = renderMarkdown(session);
    await writeText(md);
    const bytes = new TextEncoder().encode(md);
    await invoke("write_session_file", {
      folder: session.folder, filename: "transcript.md", bytes: Array.from(bytes),
    });
  };

  const takeNext = () => window.dispatchEvent(new CustomEvent("vp-take-next-screenshot"));

  const requestDelete = async (seq: number) => {
    const target = session.screenshots.find(s => s.seq === seq);
    if (!target) return;
    if (!confirm(`Delete Screenshot ${seq}? This will remove the image and its narration. Sequence numbers will not be reused.`)) return;
    await invoke("move_to_deleted", { folder: session.folder, filename: `${target.canonicalName}.png` });
    dispatch({ type: "DELETE_SCREENSHOT", seq });
  };

  const requestRerecord = (seq: number) => {
    // Phase E adds the actual modal; for now just notify.
    window.dispatchEvent(new CustomEvent("vp-rerecord-segment", { detail: { seq } }));
  };

  // ── Flush master audio, then end the session ──
  // Stops the recorder owned by App.tsx (via MicContext), awaits the Blob,
  // writes audio-master.webm to the session folder, then clears the recorder
  // ref in App.tsx and dispatches END_SESSION. The next first-capture branch
  // in App.tsx will create a fresh recorder.
  const onNewSession = async () => {
    if (mic.recorder && session) {
      try {
        const blob = await mic.recorder.stop();
        const buf = new Uint8Array(await blob.arrayBuffer());
        await invoke("write_session_file", {
          folder: session.folder, filename: session.audioFile, bytes: Array.from(buf),
        });
      } catch (err) {
        console.warn("[VisionPipe] Audio flush failed on new-session:", err);
      }
    }
    mic.clearRecorder();
    dispatch({ type: "END_SESSION" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0e1410" }}>
      <Header
        micRecording={mic.recording}
        micPermissionDenied={mic.permissionDenied}
        networkState={mic.networkState}
        onToggleMic={mic.onToggle}
        onToggleViewMode={() => dispatch({ type: "TOGGLE_VIEW_MODE" })}
        onOpenSettings={() => alert("Settings will land in Phase H")}
        onNewSession={onNewSession}
        onOpenSessionFolder={() => alert(session.folder)}
      />
      <main style={{ flex: 1, overflow: "hidden" }}>
        {session.viewMode === "interleaved" ? (
          <div style={{ height: "100%", overflow: "auto" }}>
            <InterleavedView
              onTakeNextScreenshot={takeNext}
              onRequestRerecord={requestRerecord}
              onRequestDelete={requestDelete}
              onOpenLightbox={setLightboxSeq}
            />
          </div>
        ) : (
          <SplitView
            onTakeNextScreenshot={takeNext}
            onRequestRerecord={requestRerecord}
            onRequestDelete={requestDelete}
          />
        )}
      </main>
      <Footer
        onTakeNextScreenshot={takeNext}
        onCopyAndSend={onCopyAndSend}
        copyTooltip={`Copies markdown for ${session.screenshots.length} screenshots + transcript`}
        busy={false}
      />
      {lightboxSeq !== null && <Lightbox seq={lightboxSeq} onClose={() => setLightboxSeq(null)} />}
      {rerecordSeq !== null && <ReRecordModal seq={rerecordSeq} onClose={() => setRerecordSeq(null)} />}
    </div>
  );
}
