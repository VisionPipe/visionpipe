import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText, writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import logoUrl from "./images/visionpipe-logo.svg";

// ── Earthy palette ──
const C = {
  teal: "#2e8b7a",
  amber: "#d4882a",
  cream: "#f5f0e8",
  forest: "#1a2a20",
  deepForest: "#141e18",
  sienna: "#c0462a",
  textMuted: "#8a9a8a",
  textDim: "#5a6a5a",
  border: "#2a3a2a",
  borderLight: "#3a4a3a",
};

type AppMode = "idle" | "selecting" | "annotating";
type DrawTool = "pen" | "rect" | "arrow" | "circle" | "text";

interface CaptureMetadata {
  app: string;
  window: string;
  resolution: string;
  scale: string;
  os: string;
  osBuild: string;
  timestamp: string;
  hostname: string;
  username: string;
  locale: string;
  timezone: string;
  displayCount: number;
  primaryDisplay: string;
  colorSpace: string;
  cpu: string;
  memoryGb: string;
  darkMode: boolean;
  battery: string;
  uptime: string;
  activeUrl: string;
  // Frontend-added fields
  captureWidth: number;
  captureHeight: number;
  captureMethod: string;
}

interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function App() {
  const [mode, setMode] = useState<AppMode>("idle");
  const [annotation, setAnnotation] = useState("");
  const [croppedScreenshot, setCroppedScreenshot] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<CaptureMetadata | null>(null);
  const [activeTool, setActiveTool] = useState<DrawTool>("pen");
  const [drawColor, setDrawColor] = useState(C.amber);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sessionCredits, setSessionCredits] = useState(0);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const captureCredits = 1 + (transcript ? 2 : 0);

  // ── Listen for hotkey event from Rust ──
  useEffect(() => {
    const unlisten = listen<string>("start-capture", (event) => {
      console.log("[VisionPipe] start-capture received, payload:", event.payload);
      setMode("selecting");
      setSelection(null);
      setIsDragging(false);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Complete selection: capture the region via Rust, then show annotation UI ──
  const completeSelection = useCallback(async (rect: SelectionRect) => {
    const x = Math.min(rect.startX, rect.endX);
    const y = Math.min(rect.startY, rect.endY);
    const w = Math.abs(rect.endX - rect.startX);
    const h = Math.abs(rect.endY - rect.startY);

    if (w < 10 || h < 10) return;

    const win = getCurrentWindow();
    // Get the window's position on screen so we can translate
    // viewport-relative clientX/Y to absolute screen coords.
    // outerPosition() returns physical pixels, so divide by DPR
    // since the screenshots crate uses macOS point coordinates.
    const winPos = await win.outerPosition();
    await win.hide();
    await new Promise((r) => setTimeout(r, 150));

    const dpr = window.devicePixelRatio || 1;
    // macOS CGDisplayCreateImageForRect uses point (logical) coords,
    // NOT physical pixels. Pass CSS pixel values directly.
    const captureX = Math.round(x + winPos.x / dpr);
    const captureY = Math.round(y + winPos.y / dpr);
    const captureW = Math.round(w);
    const captureH = Math.round(h);

    try {
      const screenshot = await invoke<string>("take_screenshot", {
        x: captureX, y: captureY, width: captureW, height: captureH
      });
      setCroppedScreenshot(screenshot);
    } catch (err) {
      console.error("[VisionPipe] Region capture failed:", err);
      setCroppedScreenshot(null);
    }

    // Report physical pixel dimensions for metadata (the actual image is at native resolution)
    const physW = Math.round(captureW * dpr);
    const physH = Math.round(captureH * dpr);

    try {
      const meta = await invoke<CaptureMetadata>("get_metadata");
      setMetadata({ ...meta, captureWidth: physW, captureHeight: physH, captureMethod: "region" });
    } catch {
      setMetadata({
        app: "Unknown", window: "Unknown",
        resolution: `${screen.width}x${screen.height}`,
        scale: `${dpr}x`, os: navigator.platform, osBuild: "",
        timestamp: new Date().toISOString(),
        hostname: "", username: "", locale: "", timezone: "",
        displayCount: 1, primaryDisplay: "Unknown", colorSpace: "sRGB",
        cpu: "", memoryGb: "", darkMode: false, battery: "Unknown",
        uptime: "", activeUrl: "",
        captureWidth: physW, captureHeight: physH, captureMethod: "region",
      });
    }

    try {
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      await win.setAlwaysOnTop(false);
      await win.setSize(new LogicalSize(920, 520));
      await win.center();
      await new Promise((r) => setTimeout(r, 100));
      await win.show();
      await win.setFocus();
    } catch (err) {
      console.error("[VisionPipe] Window resize failed:", err);
      await win.show();
      await win.setFocus();
    }
    setMode("annotating");
    setTimeout(() => textareaRef.current?.focus(), 200);
  }, []);

  // ── Fullscreen capture (Enter key during selection) ──
  const captureFullScreen = useCallback(async () => {
    const win = getCurrentWindow();
    await win.hide();
    await new Promise((r) => setTimeout(r, 150));

    const dpr = window.devicePixelRatio || 1;
    const physW = Math.round(screen.width * dpr);
    const physH = Math.round(screen.height * dpr);

    try {
      const screenshot = await invoke<string>("capture_fullscreen");
      setCroppedScreenshot(screenshot);
    } catch (err) {
      console.error("[VisionPipe] Fullscreen capture failed:", err);
      setCroppedScreenshot(null);
    }

    try {
      const meta = await invoke<CaptureMetadata>("get_metadata");
      setMetadata({ ...meta, captureWidth: physW, captureHeight: physH, captureMethod: "fullscreen" });
    } catch {
      setMetadata({
        app: "Unknown", window: "Unknown",
        resolution: `${screen.width}x${screen.height}`,
        scale: `${dpr}x`, os: navigator.platform, osBuild: "",
        timestamp: new Date().toISOString(),
        hostname: "", username: "", locale: "", timezone: "",
        displayCount: 1, primaryDisplay: "Unknown", colorSpace: "sRGB",
        cpu: "", memoryGb: "", darkMode: false, battery: "Unknown",
        uptime: "", activeUrl: "",
        captureWidth: physW, captureHeight: physH, captureMethod: "fullscreen",
      });
    }

    try {
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      await win.setAlwaysOnTop(false);
      await win.setSize(new LogicalSize(920, 520));
      await win.center();
      await new Promise((r) => setTimeout(r, 100));
      await win.show();
      await win.setFocus();
    } catch (err) {
      console.error("[VisionPipe] Window resize failed:", err);
      await win.show();
      await win.setFocus();
    }
    setMode("annotating");
    setTimeout(() => textareaRef.current?.focus(), 200);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setSelection({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY });
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setSelection((prev) => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
  }, [isDragging]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !selection) return;
    const finalSelection = { ...selection, endX: e.clientX, endY: e.clientY };
    setIsDragging(false);
    setSelection(finalSelection);
    completeSelection(finalSelection);
  }, [isDragging, selection, completeSelection]);

  const handleSubmit = useCallback(async () => {
    if (!metadata) return;

    // Build the composite image: screenshot + annotation + metadata in one PNG
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    // Build user comments (annotation + transcript combined)
    const userComments: string[] = [];
    if (annotation.trim()) userComments.push(annotation.trim());
    if (transcript.trim()) userComments.push(`[voice] ${transcript.trim()}`);
    const userCommentText = userComments.length > 0
      ? userComments.join(" ")
      : "No additional comments provided.";

    // Build logical text blocks (will be word-wrapped to fit canvas width)
    type TextBlock = { text: string; bold: boolean; color: string };
    const blocks: TextBlock[] = [];

    // LLM instruction header
    blocks.push({ text: "LLM Instructions: This is a screenshot generated by VisionPipe.ai for you to evaluate. Here is what the user had to say about the screenshot above:", bold: true, color: C.amber });
    blocks.push({ text: "", bold: false, color: C.cream }); // spacer

    // User comments
    blocks.push({ text: userCommentText, bold: false, color: C.cream });
    blocks.push({ text: "", bold: false, color: C.cream }); // spacer

    // Instruction for unclear input
    blocks.push({ text: "If you do not understand the user instructions then do your best to parse the image and provide the user back with your recommendations based on what you find.", bold: false, color: C.textMuted });
    blocks.push({ text: "", bold: false, color: C.cream }); // spacer

    // Metadata header
    blocks.push({ text: "Metadata about this image:", bold: true, color: C.amber });
    blocks.push({ text: `app: ${metadata.app} | window: ${metadata.window}`, bold: false, color: C.textMuted });
    blocks.push({ text: `os: ${metadata.os} (${metadata.osBuild}) | uptime: ${metadata.uptime}`, bold: false, color: C.textMuted });
    blocks.push({ text: `display: ${metadata.resolution} @ ${metadata.scale} | ${metadata.primaryDisplay} (${metadata.displayCount} display${metadata.displayCount !== 1 ? "s" : ""})`, bold: false, color: C.textMuted });
    blocks.push({ text: `cpu: ${metadata.cpu} | memory: ${metadata.memoryGb}`, bold: false, color: C.textMuted });
    blocks.push({ text: `user: ${metadata.username}@${metadata.hostname} | locale: ${metadata.locale} | tz: ${metadata.timezone}`, bold: false, color: C.textMuted });
    blocks.push({ text: `color space: ${metadata.colorSpace} | dark mode: ${metadata.darkMode ? "yes" : "no"} | battery: ${metadata.battery}`, bold: false, color: C.textMuted });
    if (metadata.activeUrl) {
      blocks.push({ text: `url: ${metadata.activeUrl}`, bold: false, color: C.textMuted });
    }
    blocks.push({ text: `captured: ${metadata.timestamp} | region: ${metadata.captureWidth}x${metadata.captureHeight}`, bold: false, color: C.textMuted });
    blocks.push({ text: "", bold: false, color: C.textMuted }); // spacer
    blocks.push({ text: `VisionPipe v0.1.0`, bold: false, color: C.textMuted });

    // Determine canvas width first (need it to scale fonts and word-wrap)
    let imgW = 600, imgH = 400;
    let img: HTMLImageElement | null = null;
    if (croppedScreenshot) {
      img = new Image();
      await new Promise<void>((resolve) => {
        img!.onload = () => resolve();
        img!.onerror = () => resolve();
        img!.src = croppedScreenshot!;
      });
      imgW = img.naturalWidth || 600;
      imgH = img.naturalHeight || 400;
    }
    const maxW = Math.max(imgW, 500);

    // Target: text panel should be at most 20% of image height.
    // Find the largest font size that fits, minimum 8px.
    const maxPanelH = Math.round(imgH * 0.20);
    const minFontSize = 8;
    const maxFontSize = Math.max(16, Math.round(maxW * 0.022));

    const makeFont = (bold: boolean, size: number) =>
      `${bold ? "bold " : ""}${size}px Verdana, Geneva, sans-serif`;

    // Word-wrap blocks at a given font size and return rendered lines + total height
    type RenderedLine = { text: string; font: string; color: string };
    const layoutAtSize = (size: number) => {
      const lh = Math.round(size * 1.55);
      const pad = Math.round(size * 1.5);
      const areaW = maxW - pad * 2;
      const lines: RenderedLine[] = [];
      for (const block of blocks) {
        if (block.text === "") {
          lines.push({ text: "", font: makeFont(false, size), color: block.color });
          continue;
        }
        const font = makeFont(block.bold, size);
        ctx.font = font;
        const words = block.text.split(/\s+/);
        let cur = "";
        for (const word of words) {
          const test = cur ? cur + " " + word : word;
          if (ctx.measureText(test).width > areaW && cur) {
            lines.push({ text: cur, font, color: block.color });
            cur = word;
          } else {
            cur = test;
          }
        }
        if (cur) lines.push({ text: cur, font, color: block.color });
      }
      const totalH = pad * 2 + lines.length * lh;
      return { lines, totalH, lh, pad };
    };

    // Binary search for the largest font size that fits within maxPanelH
    let lo = minFontSize, hi = maxFontSize;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (layoutAtSize(mid).totalH <= maxPanelH) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const fontSize = lo;
    const { lines: panelLines, totalH: panelHeight, lh: lineHeight, pad: panelPadding } = layoutAtSize(fontSize);

    if (img && croppedScreenshot) {
      canvas.width = maxW;
      canvas.height = imgH + panelHeight;

      // Draw screenshot
      ctx.drawImage(img, 0, 0, imgW, imgH);
      if (imgW < maxW) {
        ctx.fillStyle = C.deepForest;
        ctx.fillRect(imgW, 0, maxW - imgW, imgH);
      }

      // Draw panel background
      ctx.fillStyle = C.deepForest;
      ctx.fillRect(0, imgH, maxW, panelHeight);

      // Draw separator line
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, imgH);
      ctx.lineTo(maxW, imgH);
      ctx.stroke();

      // Draw text lines
      let y = imgH + panelPadding + fontSize; // baseline offset
      for (const line of panelLines) {
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, panelPadding, y);
        y += lineHeight;
      }
    } else {
      // No screenshot — just render the text panel
      canvas.width = 500;
      canvas.height = panelHeight;
      ctx.fillStyle = C.deepForest;
      ctx.fillRect(0, 0, 500, panelHeight);
      let y = panelPadding + fontSize;
      for (const line of panelLines) {
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, panelPadding, y);
        y += lineHeight;
      }
    }

    // Copy composite image to clipboard via Tauri's native clipboard plugin
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
      });
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      await writeImage(uint8Array);
      console.log("[VisionPipe] Composite image copied to clipboard via Tauri");
    } catch (err) {
      console.error("[VisionPipe] Image clipboard failed, falling back to text:", err);
      const lines: string[] = [];
      if (annotation.trim()) lines.push(annotation.trim(), "");
      if (transcript.trim()) lines.push(`[voice] ${transcript.trim()}`, "");
      lines.push("---");
      lines.push(`app: ${metadata.app} | window: ${metadata.window}`);
      lines.push(`os: ${metadata.os} (${metadata.osBuild}) | uptime: ${metadata.uptime}`);
      lines.push(`display: ${metadata.resolution} @ ${metadata.scale} | ${metadata.primaryDisplay}`);
      lines.push(`cpu: ${metadata.cpu} | memory: ${metadata.memoryGb}`);
      lines.push(`user: ${metadata.username}@${metadata.hostname} | locale: ${metadata.locale} | tz: ${metadata.timezone}`);
      lines.push(`color space: ${metadata.colorSpace} | dark mode: ${metadata.darkMode ? "yes" : "no"} | battery: ${metadata.battery}`);
      if (metadata.activeUrl) lines.push(`url: ${metadata.activeUrl}`);
      lines.push(`captured: ${metadata.timestamp} | region: ${metadata.captureWidth}x${metadata.captureHeight}`);
      lines.push("---", "VisionPipe v0.1.0");
      await writeText(lines.join("\n"));
    }

    setSessionCredits((c) => c + captureCredits);
    resetAndHide();
  }, [annotation, transcript, metadata, captureCredits, croppedScreenshot]);

  const resetAndHide = useCallback(async () => {
    setAnnotation("");
    setTranscript("");
    setCroppedScreenshot(null);
    setSelection(null);
    setMetadata(null);
    setIsDragging(false);
    setMode("idle");
    const win = getCurrentWindow();
    await win.setAlwaysOnTop(false);
    await win.hide();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { resetAndHide(); }
      if (e.key === "Enter" && mode === "selecting") {
        e.preventDefault();
        captureFullScreen();
      }
      if (e.key === "Enter" && !e.shiftKey && mode === "annotating" && document.activeElement === textareaRef.current) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [resetAndHide, handleSubmit, captureFullScreen, mode]);

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      if (!transcript) setTranscript("This dropdown is rendering below the viewport on Safari...");
    } else {
      setIsRecording(true);
      setTranscript("");
    }
  };

  // ═══════════════════════════════════════
  // IDLE
  // ═══════════════════════════════════════
  if (mode === "idle") return null;

  // ═══════════════════════════════════════
  // SELECTING — fullscreen crosshair
  // ═══════════════════════════════════════
  if (mode === "selecting") {
    const selX = selection ? Math.min(selection.startX, selection.endX) : 0;
    const selY = selection ? Math.min(selection.startY, selection.endY) : 0;
    const selW = selection ? Math.abs(selection.endX - selection.startX) : 0;
    const selH = selection ? Math.abs(selection.endY - selection.startY) : 0;

    return (
      <div
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          cursor: "crosshair", background: "rgba(20, 30, 24, 0.35)",
          zIndex: 99999, userSelect: "none", WebkitUserSelect: "none",
        }}
      >
        {isDragging && selection && selW > 2 && selH > 2 && (
          <>
            <div style={{
              position: "absolute", left: selX, top: selY, width: selW, height: selH,
              border: `2px solid ${C.teal}`, background: "rgba(46, 139, 122, 0.08)",
              pointerEvents: "none", boxSizing: "border-box",
            }} />
            <div style={{
              position: "absolute", left: selX, top: selY + selH + 6,
              background: "rgba(20, 30, 24, 0.85)", color: C.teal,
              fontSize: 12, fontFamily: "'Source Code Pro', monospace",
              padding: "3px 10px", borderRadius: 6, pointerEvents: "none",
            }}>
              {Math.round(selW)}x{Math.round(selH)}
            </div>
          </>
        )}
        {!isDragging && !selection && (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none",
            background: "rgba(20, 30, 24, 0.82)", borderRadius: 16, padding: "24px 36px",
            border: `1px solid ${C.border}`,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: C.cream, fontSize: 20, fontWeight: 600, letterSpacing: "0.02em" }}>
              Let's <span style={{ fontFamily: "'Source Code Pro', monospace", color: C.teal }}>screenshot | llm</span> it!
            </div>
            <div style={{ color: C.textMuted, fontSize: 13, marginTop: 10 }}>
              Drag to select &bull; Enter for full screen &bull; Esc to cancel
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════
  // ANNOTATING — earthy annotation overlay
  // ═══════════════════════════════════════
  return (
    <div style={{
      width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(20, 30, 24, 0.9)",
      fontFamily: "Verdana, Geneva, sans-serif",
    }}>
      <div style={{
        display: "flex", width: 880, height: 460, borderRadius: 14, overflow: "hidden",
        border: `1px solid ${C.border}`,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(46, 139, 122, 0.1)",
      }}>

        {/* ── Left: Screenshot + Drawing Tools ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: C.forest }}>

          {/* Drawing Toolbar */}
          <div style={{
            padding: "8px 12px", background: C.deepForest, display: "flex", alignItems: "center", gap: 6,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <ToolButton icon="pen" active={activeTool === "pen"} onClick={() => setActiveTool("pen")} title="Freehand draw" />
            <ToolButton icon="rect" active={activeTool === "rect"} onClick={() => setActiveTool("rect")} title="Rectangle" />
            <ToolButton icon="arrow" active={activeTool === "arrow"} onClick={() => setActiveTool("arrow")} title="Arrow" />
            <ToolButton icon="circle" active={activeTool === "circle"} onClick={() => setActiveTool("circle")} title="Circle" />
            <ToolButton icon="text" active={activeTool === "text"} onClick={() => setActiveTool("text")} title="Text label" />

            <div style={{ width: 1, height: 20, background: C.border, margin: "0 4px" }} />

            <button
              style={{
                width: 24, height: 24, borderRadius: "50%", border: `2px solid ${C.borderLight}`,
                background: drawColor, cursor: "pointer", padding: 0,
              }}
              onClick={() => setDrawColor(drawColor === C.amber ? C.teal : drawColor === C.teal ? C.sienna : C.amber)}
              title="Annotation color"
            />

            <div style={{ width: 1, height: 20, background: C.border, margin: "0 4px" }} />

            <ToolButton icon="undo" active={false} onClick={() => {}} title="Undo" />
            <ToolButton icon="redo" active={false} onClick={() => {}} title="Redo" />

            <div style={{ flex: 1 }} />

            {metadata && (
              <div style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 10, color: C.textDim, display: "flex", alignItems: "center", gap: 4 }}>
                <span>{metadata.captureWidth}x{metadata.captureHeight}</span>
                <span style={{ color: C.teal }}>|</span>
                <span>{metadata.scale}</span>
                <span style={{ color: C.teal }}>|</span>
                <span>{metadata.captureMethod}</span>
              </div>
            )}
          </div>

          {/* Screenshot Area */}
          <div style={{
            flex: 1, background: `linear-gradient(135deg, ${C.forest}, ${C.deepForest})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden",
          }}>
            {croppedScreenshot ? (
              <img src={croppedScreenshot} alt="Captured screenshot" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ color: C.textDim, fontSize: 13, textAlign: "center" }}>
                <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.5 }}>&#128247;</div>
                <span style={{ color: C.textMuted }}>Your Screenshot</span><br />
                <span style={{ fontSize: 11, color: C.textDim }}>Displayed at captured size</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Sidebar ── */}
        <div style={{
          width: 250, flexShrink: 0, background: C.deepForest,
          borderLeft: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column", padding: 16, overflow: "hidden",
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <img src={logoUrl} style={{ width: 32, height: 32, borderRadius: 8 }} alt="VisionPipe logo" />
            <div style={{ fontSize: 16, fontWeight: 700, color: C.cream }}>
              Vision<span style={{ color: C.teal, fontFamily: "'Source Code Pro', monospace" }}>|</span><span style={{ color: C.teal }}>Pipe</span>
            </div>
          </div>

          {/* Metadata Block */}
          {metadata && (
            <div style={{
              fontFamily: "'Source Code Pro', monospace", fontSize: 9, color: C.textMuted,
              marginBottom: 14, lineHeight: 1.7,
              background: C.forest, borderRadius: 8, padding: "8px 10px",
              border: `1px solid ${C.border}`,
              maxHeight: 120, overflowY: "auto",
            }}>
              <div><span style={{ color: C.textDim }}>app</span> <span style={{ color: C.teal }}>=</span> {metadata.app}</div>
              <div><span style={{ color: C.textDim }}>win</span> <span style={{ color: C.teal }}>=</span> {metadata.window}</div>
              <div><span style={{ color: C.textDim }}>os</span>&nbsp; <span style={{ color: C.teal }}>=</span> {metadata.os} ({metadata.osBuild})</div>
              <div><span style={{ color: C.textDim }}>res</span> <span style={{ color: C.teal }}>=</span> {metadata.resolution} @ {metadata.scale}</div>
              <div><span style={{ color: C.textDim }}>cpu</span> <span style={{ color: C.teal }}>=</span> {metadata.cpu}</div>
              <div><span style={{ color: C.textDim }}>mem</span> <span style={{ color: C.teal }}>=</span> {metadata.memoryGb}</div>
              <div><span style={{ color: C.textDim }}>usr</span> <span style={{ color: C.teal }}>=</span> {metadata.username}@{metadata.hostname}</div>
              <div><span style={{ color: C.textDim }}>bat</span> <span style={{ color: C.teal }}>=</span> {metadata.battery}</div>
              {metadata.activeUrl && (
                <div><span style={{ color: C.textDim }}>url</span> <span style={{ color: C.teal }}>=</span> {metadata.activeUrl}</div>
              )}
            </div>
          )}

          {/* Context Label */}
          <div style={{
            fontFamily: "'Source Code Pro', monospace", fontSize: 10, color: C.textDim,
            marginBottom: 6, display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ color: C.teal }}>&gt;</span> context
          </div>

          {/* Text Annotation */}
          <textarea
            ref={textareaRef}
            value={annotation}
            onChange={(e) => setAnnotation(e.target.value)}
            placeholder="// what should your AI do with this?"
            style={{
              width: "100%", minHeight: 80, background: C.forest,
              border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "8px 10px", color: C.cream, fontSize: 12,
              fontFamily: "Verdana, Geneva, sans-serif",
              resize: "vertical", outline: "none", boxSizing: "border-box",
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = C.teal}
            onBlur={(e) => e.currentTarget.style.borderColor = C.border}
          />

          {/* Voice Button */}
          <button
            onClick={toggleRecording}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              marginTop: 10, padding: "8px 10px", borderRadius: 10,
              border: `1px solid ${isRecording ? "rgba(192,70,42,0.3)" : C.border}`,
              background: isRecording ? "rgba(192,70,42,0.08)" : C.forest,
              cursor: "pointer", width: "100%", boxSizing: "border-box",
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              background: isRecording ? "rgba(192,70,42,0.15)" : "rgba(46,139,122,0.12)",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isRecording ? C.sienna : C.teal} strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <span style={{ fontSize: 12, color: C.textMuted }}>
              {isRecording ? "Stop recording" : "Record voice note"}
            </span>
          </button>

          {/* Transcript */}
          {(isRecording || transcript) && (
            <div style={{
              marginTop: 8, padding: "8px 10px",
              background: "rgba(46, 139, 122, 0.06)",
              border: `1px solid rgba(46, 139, 122, 0.15)`,
              borderRadius: 10,
            }}>
              <div style={{
                fontFamily: "'Source Code Pro', monospace", fontSize: 10, color: C.teal,
                marginBottom: 4, display: "flex", alignItems: "center", gap: 4,
              }}>
                {isRecording && (
                  <div style={{ width: 6, height: 6, background: C.teal, borderRadius: "50%", animation: "pulse 1.5s infinite" }} />
                )}
                <span>stdout</span>
              </div>
              <div style={{ fontSize: 11, color: C.teal, fontStyle: "italic" }}>
                {isRecording ? "Listening..." : `"${transcript}"`}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Credits */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 8, padding: "6px 10px",
            background: C.forest, borderRadius: 8,
            fontFamily: "'Source Code Pro', monospace",
          }}>
            <span style={{ fontSize: 10, color: C.textDim }}>this_capture</span>
            <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>{captureCredits} credits</span>
          </div>
          <div style={{
            textAlign: "center", fontSize: 10, color: C.textDim, marginBottom: 10,
            fontFamily: "'Source Code Pro', monospace",
          }}>
            session_total <span style={{ color: C.teal }}>=</span> {sessionCredits + captureCredits}
          </div>

          {/* Send Button */}
          <button
            onClick={handleSubmit}
            style={{
              width: "100%", padding: "10px 0", background: C.teal,
              border: "none", borderRadius: 10, color: C.cream,
              fontSize: 13, fontWeight: 600, fontFamily: "Verdana, Geneva, sans-serif",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              letterSpacing: "0.02em",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#35a08c"}
            onMouseLeave={(e) => e.currentTarget.style.background = C.teal}
          >
            <span>Copy to Clipboard</span>
            <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 11, opacity: 0.7 }}>|</span>
            <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 11, opacity: 0.7 }}>pbcopy</span>
          </button>

          {/* Keyboard Hint */}
          <div style={{
            textAlign: "center", marginTop: 6, fontSize: 10, color: C.textDim,
            fontFamily: "'Source Code Pro', monospace",
          }}>
            &#8629; pipe it <span style={{ color: C.teal }}>|</span> esc cancel
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Drawing tool button ──
function ToolButton({ icon, active, onClick, title }: { icon: string; active: boolean; onClick: () => void; title: string }) {
  const bg = active ? C.teal : C.forest;
  const strokeColor = active ? C.cream : C.textMuted;

  const renderIcon = () => {
    switch (icon) {
      case "pen": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
      case "rect": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>;
      case "arrow": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>;
      case "circle": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>;
      case "text": return <span style={{ fontSize: 14, fontWeight: 700, color: strokeColor }}>T</span>;
      case "undo": return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>;
      case "redo": return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" /></svg>;
      default: return null;
    }
  };

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 32, height: 32, background: bg, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", border: "none", transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.border; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = C.forest; }}
    >
      {renderIcon()}
    </button>
  );
}

export default App;
