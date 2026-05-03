import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types/session";

let pending: Session | null = null;
let timer: number | null = null;

const DEBOUNCE_MS = 500;

async function flush() {
  if (!pending) return;
  const s = pending;
  pending = null;
  timer = null;
  try {
    const json = JSON.stringify(s, null, 2);
    const bytes = new TextEncoder().encode(json);
    await invoke("write_session_file", {
      folder: s.folder, filename: "transcript.json", bytes: Array.from(bytes),
    });
  } catch (err) {
    console.error("[VisionPipe] Persistence write failed:", err);
  }
}

/** Schedule a debounced write of the session to transcript.json. */
export function scheduleSessionWrite(session: Session, immediate = false) {
  pending = session;
  if (immediate) {
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS) as unknown as number;
}
