import { useState, useEffect, useCallback } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { InterleavedView } from "./InterleavedView";
import { SplitView } from "./SplitView";
import { Lightbox } from "./Lightbox";
import { SettingsPanel } from "./SettingsPanel";
import { useSession } from "../state/session-context";
import { useCredit } from "../state/credit-context";
import { renderMarkdown } from "../lib/markdown-renderer";
import { generateBundleName } from "../lib/bundle-name";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export function SessionWindow() {
  const { state, dispatch } = useSession();
  const { deductForBundle, currentBundleCost, balance } = useCredit();
  const [lightboxSeq, setLightboxSeq] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Toast state for Copy & Send feedback (auto-dismisses after 3s).
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // Memoized so the keyboard-shortcut listener effect below doesn't
  // re-attach on every render. Depends on state.session (folder + content).
  //
  // Writes transcript.md to disk AND puts it on the clipboard with TWO
  // representations: the markdown body (paste into chat / Claude Code as
  // text) and a file URL (paste into Finder produces a .md file; drag
  // into Claude Code attaches as a file Read can open). The dual-rep
  // pattern is the same as save_and_copy_image (PNG bytes + file URL).
  const onCopyAndSend = useCallback(async () => {
    if (!state.session) {
      setToast({ kind: "err", text: "No active session to copy." });
      return;
    }
    const session = state.session;

    // Deduct credits FIRST. If this throws (insufficient balance), abort
    // before touching the clipboard so the user doesn't get the bundle
    // without paying or pay without getting the bundle.
    let deductedCost;
    try {
      deductedCost = await deductForBundle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "err", text: `Cannot send: ${msg}. Buy more credits to continue.` });
      return;
    }

    const bundleFilename = generateBundleName(session);

    try {
      const md = renderMarkdown(session);
      const path = await invoke<string>("save_and_copy_markdown", {
        folder: session.folder,
        markdown: md,
        filename: bundleFilename,
      });
      setToast({
        kind: "ok",
        text: `Copied ${session.screenshots.length} screenshot${session.screenshots.length === 1 ? "" : "s"} + transcript (${deductedCost.total} cr deducted). Paste as text in chat, OR paste in Finder to drop ${bundleFilename} (saved at ${path}).`,
      });
    } catch (err) {
      console.error("[VisionPipe] Copy & Send failed:", err);
      // Last-resort fallback: text-only clipboard write so the user gets
      // *something* for the credits they just spent. If even this fails,
      // they can grab the markdown file from the session folder.
      try {
        const md = renderMarkdown(session);
        await writeText(md);
        const bytes = new TextEncoder().encode(md);
        await invoke("write_session_file", {
          folder: session.folder, filename: bundleFilename, bytes: Array.from(bytes),
        });
        setToast({
          kind: "ok",
          text: `Copied as text only (file-clipboard failed). ${bundleFilename} is in the session folder. ${deductedCost.total} cr deducted.`,
        });
      } catch (innerErr) {
        setToast({
          kind: "err",
          text: `Copy & Send failed AFTER deducting ${deductedCost.total} credits: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }, [state.session, deductForBundle]);

  // Listen for the window-scoped Copy & Send hotkey dispatched by App.tsx.
  useEffect(() => {
    const handler = () => void onCopyAndSend();
    window.addEventListener("vp-copy-and-send", handler);
    return () => window.removeEventListener("vp-copy-and-send", handler);
  }, [onCopyAndSend]);

  // ── Save bundle to user-chosen disk location ──
  // Same pricing as Copy to Clipboard (deduct first, then write), but
  // writes to a Finder-chosen path instead of touching the clipboard.
  // Also writes the canonical copy to the session folder so HistoryHub
  // can find it later via the existing transcript_md_path discovery.
  const onSaveToDisk = useCallback(async () => {
    if (!state.session) {
      setToast({ kind: "err", text: "No active session to save." });
      return;
    }
    const session = state.session;
    const defaultName = generateBundleName(session);
    let targetPath: string | null;
    try {
      targetPath = await save({
        title: "Save VisionPipe bundle",
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
    } catch (err) {
      console.error("[VisionPipe] save dialog failed:", err);
      setToast({ kind: "err", text: `Save dialog failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (!targetPath) return; // user cancelled the dialog — no charge

    let deductedCost;
    try {
      deductedCost = await deductForBundle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "err", text: `Cannot save: ${msg}. Buy more credits to continue.` });
      return;
    }

    try {
      const md = renderMarkdown(session);
      // Write to user's chosen path...
      await invoke("write_text_to_path", { path: targetPath, content: md });
      // ...and also to the session folder so the bundle stays
      // discoverable from HistoryHub.
      await invoke("save_and_copy_markdown", {
        folder: session.folder,
        markdown: md,
        filename: defaultName,
      }).catch((err) => {
        // The session-folder write is best-effort here — if it fails the
        // user still got their disk save, which is what they asked for.
        console.warn("[VisionPipe] session-folder mirror failed:", err);
      });
      setToast({
        kind: "ok",
        text: `Saved ${session.screenshots.length} screenshot${session.screenshots.length === 1 ? "" : "s"} + transcript to ${targetPath} (${deductedCost.total} cr deducted).`,
      });
    } catch (err) {
      setToast({
        kind: "err",
        text: `Save failed AFTER deducting ${deductedCost.total} credits: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [state.session, deductForBundle]);

  // ── Cancel the active session ──
  // Confirms (Tauri 2 routes window.confirm through plugin:dialog — fixed
  // in v0.9.5 with dialog:allow-confirm). Does NOT deduct credits since
  // nothing is sent. Stops any in-flight recording on best-effort basis
  // so cpal's single-stream slot is freed for the next session.
  const onCancel = useCallback(async () => {
    if (!confirm("Discard this session? Already-captured screenshots stay in the session folder, but the bundle won't be sent.")) return;
    void invoke("stop_recording").catch(() => {/* fine if nothing is recording */});
    dispatch({ type: "END_SESSION" });
    void invoke("refresh_tray").catch(() => {/* best-effort */});
  }, [dispatch]);

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

  // ── New session ──
  // Stops any in-flight cpal recording (best-effort) and ends the session.
  // The tray menu refreshes so the just-ended bundle shows up in the
  // right-click submenu without an app restart.
  const onNewSession = async () => {
    void invoke("stop_recording").catch(() => {/* fine if nothing is recording */});
    dispatch({ type: "END_SESSION" });
    void invoke("refresh_tray").catch(() => {/* best-effort */});
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0e1410" }}>
      <Header
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
              onRequestDelete={requestDelete}
              onOpenLightbox={setLightboxSeq}
            />
          </div>
        ) : (
          <SplitView
            onTakeNextScreenshot={takeNext}
            onRequestDelete={requestDelete}
          />
        )}
      </main>
      <Footer
        onCopyAndSend={onCopyAndSend}
        onCancel={onCancel}
        onSaveToDisk={onSaveToDisk}
        copyTooltip={
          currentBundleCost.total > balance
            ? `Need ${currentBundleCost.total - balance} more credit${currentBundleCost.total - balance === 1 ? "" : "s"} (cost ${currentBundleCost.total}, balance ${balance})`
            : `Copies markdown for ${session.screenshots.length} screenshots + transcript (${currentBundleCost.total} cr)`
        }
        busy={currentBundleCost.total > balance}
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
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
