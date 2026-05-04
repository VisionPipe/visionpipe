import { invoke } from "@tauri-apps/api/core";

const VP_EDGE_HTTP = (import.meta.env.VITE_VP_EDGE_HTTP as string | undefined) ?? "http://localhost:8787";

export async function getOrIssueToken(): Promise<string> {
  let token = await invoke<string | null>("load_install_token");
  if (token) return token;

  const resp = await fetch(`${VP_EDGE_HTTP}/install`, { method: "POST" });
  if (!resp.ok) throw new Error(`Token issuance failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as { token: string };
  await invoke("save_install_token", { token: data.token });
  return data.token;
}
