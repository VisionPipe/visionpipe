import { useSession } from "../state/session-context";

export function SessionWindow() {
  const { state } = useSession();
  if (!state.session) return null;
  return (
    <div style={{ padding: 24, color: "#cfd8d2", fontFamily: "Verdana" }}>
      <h2>Session {state.session.id}</h2>
      <p>{state.session.screenshots.length} screenshot(s)</p>
      <pre style={{ fontSize: 11, opacity: 0.7 }}>{JSON.stringify(state.session, null, 2)}</pre>
    </div>
  );
}
