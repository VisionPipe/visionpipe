import { Header } from "./Header";
import { Footer } from "./Footer";
import { useSession } from "../state/session-context";
import { renderMarkdown } from "../lib/markdown-renderer";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";

export function SessionWindow() {
  const { state, dispatch } = useSession();
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
      <main style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <pre style={{ color: "#cfd8d2", fontSize: 11 }}>
          {JSON.stringify(session, null, 2)}
        </pre>
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
