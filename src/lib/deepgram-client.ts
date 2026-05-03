import { getOrIssueToken } from "./install-token";

const VP_EDGE_WS = (import.meta.env.VITE_VP_EDGE_WS as string | undefined) ?? "ws://localhost:8787/transcribe";

export type TranscriptEvent =
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "open" }
  | { type: "close"; reason: string }
  | { type: "error"; error: string };

export type TranscriptListener = (e: TranscriptEvent) => void;

export interface DeepgramClient {
  send(audio: Blob): void;
  close(): void;
  onEvent(listener: TranscriptListener): void;
  isOpen(): boolean;
}

export async function connectDeepgram(): Promise<DeepgramClient> {
  const token = await getOrIssueToken();
  const ws = new WebSocket(`${VP_EDGE_WS}?token=${encodeURIComponent(token)}`);
  ws.binaryType = "arraybuffer";

  let listeners: TranscriptListener[] = [];
  const emit = (e: TranscriptEvent) => listeners.forEach(l => l(e));

  ws.addEventListener("open", () => emit({ type: "open" }));
  ws.addEventListener("close", (ev) => emit({ type: "close", reason: ev.reason || "closed" }));
  ws.addEventListener("error", () => emit({ type: "error", error: "WebSocket error" }));
  ws.addEventListener("message", (msg) => {
    try {
      const data = JSON.parse(typeof msg.data === "string" ? msg.data : new TextDecoder().decode(msg.data));
      const t = data?.channel?.alternatives?.[0]?.transcript ?? "";
      if (!t) return;
      emit({ type: data.is_final ? "final" : "interim", text: t });
    } catch (err) {
      console.warn("[Deepgram] Bad message:", err);
    }
  });

  return {
    send: (audio: Blob) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      audio.arrayBuffer().then(buf => ws.send(buf));
    },
    close: () => ws.close(),
    onEvent: (l) => { listeners.push(l); },
    isOpen: () => ws.readyState === WebSocket.OPEN,
  };
}
