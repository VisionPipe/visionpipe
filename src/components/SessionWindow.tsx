import { useState } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { InterleavedView } from "./InterleavedView";
import { useSession } from "../state/session-context";
import { renderMarkdown } from "../lib/markdown-renderer";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";

export function SessionWindow() {
  const { state, dispatch } = useSession();
  // Lightbox seq is tracked here but a real Lightbox component is added in Task 12.
  // For now we just store the value (no UI surface).
  const [, setLightboxSeq] = useState<number | null>(null);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0e1410" }}>
      <Header
        micRecording={false}
        micPermissionDenied={false}
        networkState="local-only"
        onToggleMic={() => {}}
        onToggleViewMode={() => dispatch({ type: "TOGGLE_VIEW_MODE" })}
        onOpenSettings={() => alert("Settings will land in Phase H")}
        onNewSession={() => dispatch({ type: "END_SESSION" })}
        onOpenSessionFolder={() => alert(session.folder)}
      />
      <main style={{ flex: 1, overflow: "auto" }}>
        <InterleavedView
          onTakeNextScreenshot={takeNext}
          onRequestRerecord={requestRerecord}
          onRequestDelete={requestDelete}
          onOpenLightbox={setLightboxSeq}
        />
      </main>
      <Footer
        onTakeNextScreenshot={takeNext}
        onCopyAndSend={onCopyAndSend}
        copyTooltip={`Copies markdown for ${session.screenshots.length} screenshots + transcript`}
        busy={false}
      />
    </div>
  );
}
