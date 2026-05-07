import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  /**
   * Called with the absolute temp-file path of the captured PNG.
   * The caller is responsible for moving it into the session folder
   * via `move_capture_to_session`. We pass a path (not bytes) because
   * Tauri's IPC bridge is JSON-only — round-tripping multi-MB binary
   * data through it cost ~10-20 s per capture before v0.9.4.
   */
  onCapture: (capturePath: string) => void;
  onCancel: () => void;
  /** "region" = single-frame capture (default). "scrolling" = capture
   *  the same region across multiple Page Down scrolls and stitch
   *  vertically into one tall PNG. */
  captureMode?: "region" | "scrolling";
}

interface SelectionRect { startX: number; startY: number; endX: number; endY: number; }

export function SelectionOverlay({ onCapture, onCancel, captureMode = "region" }: Props) {
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const completeSelection = useCallback(async (rect: SelectionRect) => {
    const x = Math.min(rect.startX, rect.endX);
    const y = Math.min(rect.startY, rect.endY);
    const w = Math.abs(rect.endX - rect.startX);
    const h = Math.abs(rect.endY - rect.startY);
    if (w < 10 || h < 10) return;

    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const dpr = window.devicePixelRatio || 1;
    const screenX = Math.round(x + pos.x / dpr);
    const screenY = Math.round(y + pos.y / dpr);

    // Hide ourselves so the target app gets keyboard focus before we
    // start sending Page Down events (scrolling mode) or grab the
    // region (regular mode).
    await win.hide();
    await new Promise(r => setTimeout(r, 300));

    let capturePath: string;
    if (captureMode === "scrolling") {
      capturePath = await invoke<string>("take_scrolling_screenshot", {
        x: screenX, y: screenY,
        width: Math.round(w), height: Math.round(h),
        numScrolls: 5,
      });
    } else {
      capturePath = await invoke<string>("take_screenshot", {
        x: screenX, y: screenY, width: Math.round(w), height: Math.round(h),
      });
    }
    onCapture(capturePath);
  }, [onCapture, captureMode]);

  const captureFullscreen = useCallback(async () => {
    // Hide the VP window first, otherwise screencapture captures our own
    // hint pill ("Drag a region · Enter for fullscreen") on top of the
    // desktop. The 300 ms wait gives macOS time to actually hide the
    // window before the screencapture subprocess runs. Mirrors the same
    // hide-then-capture pattern used by completeSelection().
    const win = getCurrentWindow();
    await win.hide();
    await new Promise((r) => setTimeout(r, 300));
    try {
      const capturePath = await invoke<string>("capture_fullscreen");
      onCapture(capturePath);
    } catch (err) {
      console.error("[VisionPipe] capture_fullscreen failed:", err);
      // Bring the overlay back so the user can try again.
      await win.show();
    }
  }, [onCapture]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") captureFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureFullscreen, onCancel]);

  // Hide the macOS window chrome (traffic-light controls) while the
  // capture overlay is visible — those dots peeking through during a
  // capture are jarring and make the overlay feel like an app window
  // rather than an OS-level capture surface (which is what users
  // expect from Cmd+Shift+4 muscle memory). Restore on unmount so
  // HistoryHub / SessionWindow have their normal chrome back.
  useEffect(() => {
    const win = getCurrentWindow();
    void win.setDecorations(false);
    return () => { void win.setDecorations(true); };
  }, []);

  // Compute the selection rectangle in pixel coords. `null` until the
  // user starts dragging, which means: nothing is dimmed yet, the
  // entire screen passes through clean.
  const rect = selection
    ? {
        x1: Math.min(selection.startX, selection.endX),
        y1: Math.min(selection.startY, selection.endY),
        x2: Math.max(selection.startX, selection.endX),
        y2: Math.max(selection.startY, selection.endY),
      }
    : null;

  const dimStyle: React.CSSProperties = {
    position: "fixed",
    background: "rgba(0,0,0,0.45)",
    pointerEvents: "none",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, cursor: "crosshair",
        // Default: completely transparent. The crosshair appears against
        // the live screen — the user's cue to start dragging. Dimming
        // only kicks in once the four masks render around an active
        // selection (below).
        background: "transparent",
      }}
      onMouseDown={(e) => {
        setIsDragging(true);
        setSelection({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY });
      }}
      onMouseMove={(e) => {
        if (!isDragging || !selection) return;
        setSelection({ ...selection, endX: e.clientX, endY: e.clientY });
      }}
      onMouseUp={() => {
        setIsDragging(false);
        if (selection) completeSelection(selection);
      }}
    >
      {/* Dim only the four rectangles AROUND the selection. The selection
          itself remains fully transparent (i.e. the user can see exactly
          what they'll capture, undimmed). Mirrors the native macOS
          Cmd+Shift+4 behavior. Only renders when a selection exists —
          before the first mousedown, the entire screen is unobstructed. */}
      {rect && (
        <>
          {/* top — full width, above the selection */}
          <div style={{ ...dimStyle, left: 0, right: 0, top: 0, height: rect.y1 }} />
          {/* bottom — full width, below the selection */}
          <div style={{ ...dimStyle, left: 0, right: 0, top: rect.y2, bottom: 0 }} />
          {/* left — between top and bottom, left of the selection */}
          <div style={{ ...dimStyle, left: 0, top: rect.y1, width: rect.x1, height: rect.y2 - rect.y1 }} />
          {/* right — between top and bottom, right of the selection */}
          <div style={{ ...dimStyle, left: rect.x2, top: rect.y1, right: 0, height: rect.y2 - rect.y1 }} />
          {/* selection border + faint fill, no fill outside */}
          <div style={{
            position: "absolute",
            left: rect.x1, top: rect.y1,
            width: rect.x2 - rect.x1, height: rect.y2 - rect.y1,
            border: "2px solid #2e8b7a",
            background: "rgba(46, 139, 122, 0.05)",
            pointerEvents: "none",
          }} />
        </>
      )}
      <div style={{
        position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)",
        // Amber pill for both modes — high-contrast against any desktop
        // background so the user instantly sees what to do. Was previously
        // dark-green for the regular mode, which faded into busy desktops.
        background: "rgba(212, 136, 42, 0.95)",
        color: "#1a2a20",
        padding: "10px 22px", borderRadius: 999, fontSize: 14, fontFamily: "Verdana",
        fontWeight: 700,
        boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
        pointerEvents: "none",
      }}>
        {captureMode === "scrolling"
          ? "Scrolling capture: drag the region (the page will scroll & stitch automatically) · Esc to cancel"
          : "Drag a region · Enter for fullscreen · Esc to cancel"}
      </div>
    </div>
  );
}
