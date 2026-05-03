import { Header } from "./Header";
import { useSession } from "../state/session-context";

export function SessionWindow() {
  const { state, dispatch } = useSession();
  if (!state.session) return null;
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
        onOpenSessionFolder={() => alert(state.session?.folder)}
      />
      <pre style={{ padding: 16, color: "#cfd8d2", overflow: "auto", fontSize: 11 }}>
        {JSON.stringify(state.session, null, 2)}
      </pre>
    </div>
  );
}
