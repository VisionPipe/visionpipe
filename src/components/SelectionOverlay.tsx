import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  onCapture: (pngBytes: Uint8Array) => void;
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

    let dataUri: string;
    if (captureMode === "scrolling") {
      dataUri = await invoke<string>("take_scrolling_screenshot", {
        x: screenX, y: screenY,
        width: Math.round(w), height: Math.round(h),
        numScrolls: 5,
      });
    } else {
      dataUri = await invoke<string>("take_screenshot", {
        x: screenX, y: screenY, width: Math.round(w), height: Math.round(h),
      });
    }
    const base64 = dataUri.split(",")[1];
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    onCapture(bytes);
  }, [onCapture, captureMode]);

  const captureFullscreen = useCallback(async () => {
    const dataUri = await invoke<string>("capture_fullscreen");
    const base64 = dataUri.split(",")[1];
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    onCapture(bytes);
  }, [onCapture]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") captureFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureFullscreen, onCancel]);

  return (
    <div
      style={{ position: "fixed", inset: 0, cursor: "crosshair", background: "rgba(0,0,0,0.2)" }}
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
      {selection && (
        <div style={{
          position: "absolute",
          left: Math.min(selection.startX, selection.endX),
          top: Math.min(selection.startY, selection.endY),
          width: Math.abs(selection.endX - selection.startX),
          height: Math.abs(selection.endY - selection.startY),
          border: "2px solid #2e8b7a",
          background: "rgba(46, 139, 122, 0.1)",
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)",
        background: captureMode === "scrolling" ? "rgba(212, 136, 42, 0.92)" : "rgba(20, 30, 24, 0.85)",
        color: captureMode === "scrolling" ? "#1a2a20" : "#cfd8d2",
        padding: "8px 20px", borderRadius: 999, fontSize: 14, fontFamily: "Verdana",
        fontWeight: captureMode === "scrolling" ? 700 : 400,
      }}>
        {captureMode === "scrolling"
          ? "Scrolling capture: drag the region (the page will scroll & stitch automatically) · Esc to cancel"
          : "Drag a region · Enter for fullscreen · Esc to cancel"}
      </div>
    </div>
  );
}
