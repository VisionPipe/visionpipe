import { useEffect, useState, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Camera, Folder, Clipboard, ChevronRight, ChevronDown } from "lucide-react";
import { C, FONT_BODY } from "../lib/ui-tokens";

/**
 * Summary returned by the Rust `list_recent_sessions_cmd` Tauri command.
 * Mirrors `SessionSummary` in src-tauri/src/lib.rs (snake_case fields are
 * serialized to camelCase via #[serde(rename_all = "camelCase")] there).
 */
interface SessionSummary {
  id: string;
  folder: string;
  createdAt: string;
  label: string;
  screenshotCount: number;
  firstCaption: string | null;
  transcriptSnippet: string | null;
  thumbnailPaths: string[];
  transcriptMdPath: string | null;
}

/**
 * "Home page" of Vision|Pipe when no session is active. Renders:
 *   - "+ New Screenshot Bundle" button (fires the same vp-take-next-screenshot
 *     event the in-app "+" button uses, so the same prepare/resize/select
 *     pipeline runs).
 *   - List of recent sessions, each row collapsible. Each row shows a
 *     thumbnail strip + label/caption/snippet + a Copy button (writes
 *     transcript.md to clipboard with the dual text+file representation)
 *     and a Show-in-Finder button (drag source for now — true window-out
 *     drag isn't supported by Tauri 2 yet).
 *
 * Sessions are pulled from ~/Pictures/VisionPipe/session-* via the new
 * `list_recent_sessions_cmd` Rust command, sorted by mtime desc.
 */
export function HistoryHub() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<SessionSummary[]>("list_recent_sessions_cmd", { limit: 50 });
      setSessions(list);
    } catch (err) {
      console.error("[VisionPipe] list_recent_sessions_cmd failed:", err);
      setSessions([]);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onNewBundle = () => {
    // Same trigger the SessionWindow uses for "+ Take next screenshot".
    // App.tsx's listener handles prepare_in_app_capture + window resize.
    window.dispatchEvent(new CustomEvent("vp-take-next-screenshot"));
  };

  // Copy transcript.md + the markdown body to clipboard with dual text+file
  // representations (same pattern as save_and_copy_markdown). For sessions
  // that haven't had Copy & Send run on them yet (no transcript.md on disk),
  // we read the JSON, render markdown via markdown-renderer, and call
  // save_and_copy_markdown which writes the .md and sets the clipboard.
  const onCopy = async (s: SessionSummary) => {
    setBusy(s.id);
    try {
      // Pull the saved transcript.md if available; otherwise re-render from
      // transcript.json. This keeps Copy useful even for sessions the user
      // never explicitly "sent" (e.g. ones they ended via New Session).
      let md: string | null = null;
      if (s.transcriptMdPath) {
        try {
          const bytes = await invoke<number[]>("read_session_file", {
            folder: s.folder, filename: "transcript.md",
          });
          md = new TextDecoder().decode(new Uint8Array(bytes));
        } catch {/* fall through to render */}
      }
      if (!md) {
        // Re-render from the JSON via the same renderer the live session uses.
        // Keeps formatting identical between Copy-from-history and live Copy & Send.
        const { renderMarkdown } = await import("../lib/markdown-renderer");
        const bytes = await invoke<number[]>("read_session_file", {
          folder: s.folder, filename: "transcript.json",
        });
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
        md = renderMarkdown(json);
      }
      await invoke("save_and_copy_markdown", { folder: s.folder, markdown: md });
      setToast({ kind: "ok", text: `Copied ${s.screenshotCount} screenshot${s.screenshotCount === 1 ? "" : "s"} + transcript. Paste in chat as text, or in Finder as a .md file.` });
      // transcript.md may have just been created on disk; refresh row state.
      await reload();
    } catch (err) {
      console.error("[VisionPipe] Copy from history failed:", err);
      setToast({ kind: "err", text: `Copy failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  const onShowInFinder = async (s: SessionSummary) => {
    try {
      // If transcript.md exists, reveal that specific file (selects it in
      // Finder so the user can drag it directly into Claude Code). Otherwise
      // open the folder.
      const target = s.transcriptMdPath ?? s.folder;
      await invoke("reveal_in_finder", { path: target });
    } catch (err) {
      console.error("[VisionPipe] reveal_in_finder failed:", err);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.deepForest, color: C.textBright, fontFamily: FONT_BODY }}>
      <div data-tauri-drag-region style={{
        height: 40, paddingLeft: 80, paddingRight: 16, display: "flex",
        alignItems: "center", borderBottom: `1px solid ${C.border}`,
        fontSize: 12, color: C.textMuted, userSelect: "none",
      }}>
        Vision|Pipe — History
      </div>

      <div style={{ padding: 20, borderBottom: `1px solid ${C.border}` }}>
        <button
          onClick={onNewBundle}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 20px", background: C.teal, color: "white",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600,
          }}
        >
          <Camera size={18} />
          New Screenshot Bundle
        </button>
        <div style={{ marginTop: 8, fontSize: 11, color: C.textDim }}>
          or press ⌘⇧C from anywhere
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {sessions === null && <div style={{ color: C.textMuted, fontSize: 13 }}>Loading…</div>}
        {sessions !== null && sessions.length === 0 && (
          <div style={{ color: C.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>
            No screenshot bundles yet. Hit ⌘⇧C or click the button above to create your first one.
          </div>
        )}
        {sessions?.map(s => {
          const isExpanded = expanded.has(s.id);
          return (
            <div key={s.id} style={{
              marginBottom: 12, background: C.forest,
              border: `1px solid ${C.border}`, borderRadius: 8,
              overflow: "hidden",
            }}>
              <div
                onClick={() => toggleExpand(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: 12,
                  cursor: "pointer",
                }}
              >
                <div style={{ color: C.textMuted, flexShrink: 0 }}>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {s.thumbnailPaths.slice(0, 3).map((p, i) => (
                    <img
                      key={i}
                      src={convertFileSrc(p)}
                      alt=""
                      style={{
                        width: 56, height: 40, objectFit: "cover",
                        background: C.deepForest, borderRadius: 3,
                        border: `1px solid ${C.border}`,
                      }}
                    />
                  ))}
                  {s.thumbnailPaths.length === 0 && (
                    <div style={{ width: 56, height: 40, background: C.deepForest, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: 10 }}>
                      no img
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: C.textBright, marginBottom: 2 }}>
                    {s.label} · {s.screenshotCount} screenshot{s.screenshotCount === 1 ? "" : "s"}
                  </div>
                  {s.firstCaption && (
                    <div style={{ fontSize: 12, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.firstCaption}
                    </div>
                  )}
                  {!s.firstCaption && s.transcriptSnippet && (
                    <div style={{ fontSize: 12, color: C.textDim, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      "{s.transcriptSnippet}…"
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => void onCopy(s)}
                    disabled={busy === s.id}
                    title="Copy markdown + screenshots to clipboard"
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 10px", background: C.teal, color: "white",
                      border: "none", borderRadius: 4, cursor: busy === s.id ? "wait" : "pointer",
                      fontFamily: FONT_BODY, fontSize: 12,
                      opacity: busy === s.id ? 0.6 : 1,
                    }}
                  >
                    <Clipboard size={12} />
                    {busy === s.id ? "Copying…" : "Copy"}
                  </button>
                  <button
                    onClick={() => void onShowInFinder(s)}
                    title="Show this bundle in Finder (drag from there into Claude Code)"
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 10px", background: "transparent",
                      color: C.textMuted, border: `1px solid ${C.borderLight}`,
                      borderRadius: 4, cursor: "pointer",
                      fontFamily: FONT_BODY, fontSize: 12,
                    }}
                  >
                    <Folder size={12} />
                    Finder
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div style={{
                  padding: "0 12px 12px 12px", borderTop: `1px solid ${C.border}`,
                  background: C.deepForest,
                }}>
                  <div style={{
                    paddingTop: 12,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                    gap: 8,
                  }}>
                    {s.thumbnailPaths.map((p, i) => (
                      <img
                        key={i}
                        src={convertFileSrc(p)}
                        alt=""
                        style={{
                          width: "100%", height: 100, objectFit: "cover",
                          background: C.deepForest, borderRadius: 4,
                          border: `1px solid ${C.border}`, cursor: "pointer",
                        }}
                        onClick={() => void invoke("reveal_in_finder", { path: p })}
                      />
                    ))}
                  </div>
                  {s.transcriptSnippet && (
                    <div style={{ marginTop: 12, padding: 10, background: C.forest, borderRadius: 4, fontSize: 12, color: C.textMuted, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
                      "{s.transcriptSnippet}…"
                    </div>
                  )}
                  <div style={{ marginTop: 8, fontSize: 10, color: C.textDim, fontFamily: "Menlo, monospace" }}>
                    {s.folder}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, maxWidth: 400, zIndex: 1200,
          padding: "10px 14px", borderRadius: 6,
          background: toast.kind === "ok" ? "#1a3a2a" : "#3a1a1a",
          border: `1px solid ${toast.kind === "ok" ? C.teal : C.sienna}`,
          color: C.textBright, fontSize: 12, fontFamily: FONT_BODY,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
