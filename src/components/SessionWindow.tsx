import { useState, useEffect, useCallback } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { InterleavedView } from "./InterleavedView";
import { SplitView } from "./SplitView";
import { Lightbox } from "./Lightbox";
import { ReRecordModal } from "./ReRecordModal";
import { SettingsPanel } from "./SettingsPanel";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Toast state for Copy & Send feedback (auto-dismisses after 3s).
  // Was added because the action used to silently swallow failures —
  // user couldn't tell whether the click did anything.
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ seq: number }>;
      setRerecordSeq(ce.detail.seq);
    };
    window.addEventListener("vp-rerecord-segment", handler);
    return () => window.removeEventListener("vp-rerecord-segment", handler);
  }, []);

  // Memoized so the keyboard-shortcut listener effect below doesn't
  // re-attach on every render. Depends on state.session (folder + content).
  const onCopyAndSend = useCallback(async () => {
    if (!state.session) {
      setToast({ kind: "err", text: "No active session to copy." });
      return;
    }
    const session = state.session;
    try {
      const md = renderMarkdown(session);
      await writeText(md);
      const bytes = new TextEncoder().encode(md);
      await invoke("write_session_file", {
        folder: session.folder, filename: "transcript.md", bytes: Array.from(bytes),
      });
      setToast({
        kind: "ok",
        text: `Copied ${session.screenshots.length} screenshot${session.screenshots.length === 1 ? "" : "s"} + transcript to clipboard. Paste into Claude Code or any LLM.`,
      });
    } catch (err) {
      console.error("[VisionPipe] Copy & Send failed:", err);
      setToast({
        kind: "err",
        text: `Copy & Send failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [state.session]);

  // Listen for the window-scoped Copy & Send hotkey dispatched by App.tsx.
  useEffect(() => {
    const handler = () => void onCopyAndSend();
    window.addEventListener("vp-copy-and-send", handler);
    return () => window.removeEventListener("vp-copy-and-send", handler);
  }, [onCopyAndSend]);

  if (!state.session) return null;
  const session = state.session;

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
    mic.closeDeepgram();
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
        onOpenSettings={() => setSettingsOpen(true)}
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
        onCopyAndSend={onCopyAndSend}
        copyTooltip={`Copies markdown for ${session.screenshots.length} screenshots + transcript`}
        busy={false}
      />
      {/* Toast for Copy & Send feedback */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 70, right: 20, maxWidth: 400, zIndex: 1200,
          padding: "10px 14px", borderRadius: 6,
          background: toast.kind === "ok" ? "#1a3a2a" : "#3a1a1a",
          border: `1px solid ${toast.kind === "ok" ? "#2e8b7a" : "#c0462a"}`,
          color: "#e8efe9", fontSize: 12, fontFamily: "Verdana, sans-serif",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {toast.text}
        </div>
      )}
      {lightboxSeq !== null && <Lightbox seq={lightboxSeq} onClose={() => setLightboxSeq(null)} />}
      {rerecordSeq !== null && <ReRecordModal seq={rerecordSeq} onClose={() => setRerecordSeq(null)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
