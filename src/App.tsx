import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
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

type AppMode = "idle" | "onboarding" | "selecting" | "annotating";
type DrawTool = "pen" | "rect" | "arrow" | "circle" | "text";

interface PermissionStatus {
  screenRecording: boolean;
  systemEvents: boolean;
  accessibility: boolean;
}

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
  imageSizeKb: number;
}

interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** Measure actual image dimensions and file size from a base64 data URI */
async function measureImageDims(dataUri: string | null): Promise<{ captureWidth: number; captureHeight: number; imageSizeKb: number }> {
  if (!dataUri) return { captureWidth: 0, captureHeight: 0, imageSizeKb: 0 };

  // Estimate file size from base64 (data URI header + base64 payload)
  const base64Start = dataUri.indexOf(",") + 1;
  const base64Len = dataUri.length - base64Start;
  const imageSizeKb = Math.round((base64Len * 3) / 4 / 1024);

  // Load image to get actual pixel dimensions
  const img = new Image();
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUri;
  });

  console.log(`[VisionPipe] Actual image: ${dims.w}x${dims.h}, ~${imageSizeKb} KB`);
  return { captureWidth: dims.w, captureHeight: dims.h, imageSizeKb };
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
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [justCopied, setJustCopied] = useState(false);
  const [appVersion, setAppVersion] = useState("0.0.0");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<AppMode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const captureCredits = 1 + (transcript ? 2 : 0);

  // ── Show onboarding window (resize + center + show) ──
  const showOnboardingWindow = useCallback(async () => {
    const win = getCurrentWindow();
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await win.setSize(new LogicalSize(620, 680));
    await win.setAlwaysOnTop(false);
    await win.center();
    await win.show();
    await win.setFocus();
  }, []);

  // ── On mount: show the welcome card FIRST, then check permissions. ──
  // The order matters because check_permissions for System Events uses
  // osascript, which can trigger a TCC prompt on first ever run. We want
  // the welcome card visible behind the prompt so the user has context.
  useEffect(() => {
    (async () => {
      setMode("onboarding");
      await showOnboardingWindow();

      try {
        const status = await invoke<PermissionStatus>("check_permissions");
        setPermissions(status);
      } catch (err) {
        console.error("[VisionPipe] check_permissions failed:", err);
      }
    })();
  }, [showOnboardingWindow]);

  // ── Auto-poll permissions while onboarding is visible ──
  useEffect(() => {
    if (mode !== "onboarding") return;
    const interval = setInterval(async () => {
      try {
        const status = await invoke<PermissionStatus>("check_permissions");
        setPermissions(status);
      } catch {/* ignore */}
    }, 2000);
    return () => clearInterval(interval);
  }, [mode]);

  // ── Listen for tray menu's "Show Onboarding" action ──
  useEffect(() => {
    const unlisten = listen("show-onboarding", async () => {
      try {
        const status = await invoke<PermissionStatus>("check_permissions");
        setPermissions(status);
      } catch {/* ignore */}
      setMode("onboarding");
      await showOnboardingWindow();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [showOnboardingWindow]);

  // ── Listen for hotkey event from Rust ──
  useEffect(() => {
    const unlisten = listen<string>("start-capture", (event) => {
      // Ignore if not in idle mode (e.g., onboarding visible, or mid-capture)
      if (modeRef.current !== "idle") {
        console.log("[VisionPipe] start-capture ignored, mode is", modeRef.current);
        return;
      }
      console.log("[VisionPipe] start-capture received, payload:", event.payload);
      setMode("selecting");
      setSelection(null);
      setIsDragging(false);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Re-check permissions on demand (button click) ──
  const recheckPermissions = useCallback(async () => {
    try {
      const status = await invoke<PermissionStatus>("check_permissions");
      setPermissions(status);
    } catch (err) {
      console.error("[VisionPipe] recheck failed:", err);
    }
  }, []);

  // ── Dismiss onboarding (Got it button) ──
  const dismissOnboarding = useCallback(async () => {
    const win = getCurrentWindow();
    await win.hide();
    setMode("idle");
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
    // 300ms ensures the transparent webview is fully off-screen before
    // screencapture runs — 150ms wasn't always enough on M-series Macs and
    // the selection overlay was getting baked into the captured image.
    await new Promise((r) => setTimeout(r, 300));

    const dpr = window.devicePixelRatio || 1;
    // macOS CGDisplayCreateImageForRect uses point (logical) coords,
    // NOT physical pixels. Pass CSS pixel values directly.
    const captureX = Math.round(x + winPos.x / dpr);
    const captureY = Math.round(y + winPos.y / dpr);
    const captureW = Math.round(w);
    const captureH = Math.round(h);

    let screenshotDataUri: string | null = null;
    try {
      screenshotDataUri = await invoke<string>("take_screenshot", {
        x: captureX, y: captureY, width: captureW, height: captureH
      });
      setCroppedScreenshot(screenshotDataUri);
    } catch (err) {
      console.error("[VisionPipe] Region capture failed:", err);
      setCroppedScreenshot(null);
    }

    // Measure actual image dimensions from the captured data
    const imgDims = await measureImageDims(screenshotDataUri);

    try {
      const meta = await invoke<CaptureMetadata>("get_metadata");
      setMetadata({ ...meta, ...imgDims, captureMethod: "region" });
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
        ...imgDims, captureMethod: "region",
      });
    }

    try {
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      await win.setAlwaysOnTop(false);
      await win.setSize(new LogicalSize(880, 492));
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
    // 300ms ensures the transparent webview is fully off-screen before
    // screencapture runs — 150ms wasn't always enough on M-series Macs and
    // the selection overlay was getting baked into the captured image.
    await new Promise((r) => setTimeout(r, 300));

    const dpr = window.devicePixelRatio || 1;

    let screenshotDataUri: string | null = null;
    try {
      screenshotDataUri = await invoke<string>("capture_fullscreen");
      setCroppedScreenshot(screenshotDataUri);
    } catch (err) {
      console.error("[VisionPipe] Fullscreen capture failed:", err);
      setCroppedScreenshot(null);
    }

    const imgDims = await measureImageDims(screenshotDataUri);

    try {
      const meta = await invoke<CaptureMetadata>("get_metadata");
      setMetadata({ ...meta, ...imgDims, captureMethod: "fullscreen" });
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
        ...imgDims, captureMethod: "fullscreen",
      });
    }

    try {
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      await win.setAlwaysOnTop(false);
      await win.setSize(new LogicalSize(880, 492));
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

    // Show "Copied" overlay IMMEDIATELY so the user sees feedback before
    // the canvas + clipboard work runs. The auto-close timer fires after
    // 1500ms regardless of how long the actual copy takes.
    setJustCopied(true);

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

    // Build two columns: left = user text, right = capture metadata
    const username = metadata.username || "User";

    // Left column content (attribution + user request)
    type TextBlock = { text: string; bold: boolean; color: string };
    const leftBlocks: TextBlock[] = [];
    leftBlocks.push({ text: `Annotation by Vision|Pipe.ai`, bold: true, color: C.amber });
    leftBlocks.push({ text: `Submitted by: ${username}`, bold: false, color: C.textMuted });
    leftBlocks.push({ text: "", bold: false, color: C.cream }); // spacer
    leftBlocks.push({ text: `${username}'s request: "${userCommentText}"`, bold: false, color: C.cream });
    leftBlocks.push({ text: `[User input, passed verbatim by Vision|Pipe]`, bold: false, color: C.textDim });

    // Right column content (capture metadata)
    const sizeStr = metadata.imageSizeKb > 1024
      ? (metadata.imageSizeKb / 1024).toFixed(1) + " MB"
      : metadata.imageSizeKb + " KB";
    const metaLines: { text: string; color: string }[] = [
      { text: "Capture metadata", color: C.amber },
      { text: `${metadata.captureWidth}x${metadata.captureHeight}px (${sizeStr})`, color: C.textMuted },
      { text: `${metadata.captureMethod} | ${metadata.app}`, color: C.textMuted },
      { text: `${metadata.os} (${metadata.osBuild})`, color: C.textMuted },
      { text: `${metadata.resolution} @ ${metadata.scale}`, color: C.textMuted },
      { text: `${metadata.cpu}`, color: C.textMuted },
      { text: `${metadata.memoryGb} | ${metadata.battery}`, color: C.textMuted },
      { text: `${metadata.username}@${metadata.hostname}`, color: C.textMuted },
      { text: `${metadata.timestamp}`, color: C.textMuted },
      { text: `Vision|Pipe v${appVersion}`, color: C.textDim },
    ];

    // Determine canvas width first
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
      console.log(`[VisionPipe] Screenshot dimensions: ${imgW}x${imgH}`);
    }
    const maxW = Math.max(imgW, 500);

    // Target: text panel at most 20% of image height.
    // Single font size for all text, binary-searched to fit. Min 8px.
    const maxPanelH = Math.round(imgH * 0.20);
    const minFontSize = 8;
    const maxFontSize = Math.max(16, Math.round(maxW * 0.018));

    const makeFont = (bold: boolean, size: number) =>
      `${bold ? "bold " : ""}${size}px Verdana, Geneva, sans-serif`;

    // Layout: word-wrap left column into the left 60% of width,
    // right column in the right 35% (5% gap)
    type RenderedLine = { text: string; font: string; color: string; x: number };
    const layoutAtSize = (fontSize: number) => {
      const lh = Math.round(fontSize * 1.55);
      const pad = Math.round(fontSize * 1.5);
      const leftW = Math.round((maxW - pad * 2) * 0.58);
      const rightX = pad + Math.round((maxW - pad * 2) * 0.63);
      const rightW = maxW - rightX - pad;

      // Word-wrap left blocks
      const leftLines: RenderedLine[] = [];
      for (const block of leftBlocks) {
        if (block.text === "") {
          leftLines.push({ text: "", font: makeFont(false, fontSize), color: block.color, x: pad });
          continue;
        }
        const font = makeFont(block.bold, fontSize);
        ctx.font = font;
        const words = block.text.split(/\s+/);
        let cur = "";
        for (const word of words) {
          const test = cur ? cur + " " + word : word;
          if (ctx.measureText(test).width > leftW && cur) {
            leftLines.push({ text: cur, font, color: block.color, x: pad });
            cur = word;
          } else {
            cur = test;
          }
        }
        if (cur) leftLines.push({ text: cur, font, color: block.color, x: pad });
      }

      // Right column: metadata lines (no word-wrap, just truncate if needed)
      const rightLines: RenderedLine[] = metaLines.map((m) => ({
        text: m.text,
        font: m.color === C.amber ? makeFont(true, fontSize) : makeFont(false, fontSize),
        color: m.color,
        x: rightX,
      }));

      const maxLines = Math.max(leftLines.length, rightLines.length);
      const totalH = pad * 2 + maxLines * lh;
      return { leftLines, rightLines, totalH, lh, pad };
    };

    // Binary search for the largest font size that fits
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
    const { leftLines, rightLines, totalH: panelHeight, lh: lineHeight, pad: panelPadding } = layoutAtSize(fontSize);

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

      // Draw left column
      let y = imgH + panelPadding;
      for (const line of leftLines) {
        y += lineHeight * 0.7;
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, line.x, y);
        y += lineHeight * 0.3;
      }

      // Draw right column
      y = imgH + panelPadding;
      for (const line of rightLines) {
        y += lineHeight * 0.7;
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, line.x, y);
        y += lineHeight * 0.3;
      }
    } else {
      // No screenshot — just render the text panel
      canvas.width = 500;
      canvas.height = panelHeight;
      ctx.fillStyle = C.deepForest;
      ctx.fillRect(0, 0, 500, panelHeight);
      let y = panelPadding;
      for (const line of leftLines) {
        y += lineHeight * 0.7;
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, line.x, y);
        y += lineHeight * 0.3;
      }
    }

    // Save PNG to disk and copy to clipboard (with file reference for Finder paste)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
      });
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      console.log(`[VisionPipe] Canvas: ${canvas.width}x${canvas.height}, PNG blob: ${(blob.size / 1048576).toFixed(1)} MB`);
      const savedPath = await invoke<string>("save_and_copy_image", { pngBytes: Array.from(uint8Array) });
      console.log(`[VisionPipe] Saved and copied: ${savedPath}`);
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
      lines.push(`captured: ${metadata.timestamp} | image: ${metadata.captureWidth}x${metadata.captureHeight}px (${metadata.imageSizeKb > 1024 ? (metadata.imageSizeKb / 1024).toFixed(1) + " MB" : metadata.imageSizeKb + " KB"}) | ${metadata.captureMethod}`);
      lines.push("---", `Vision|Pipe v${appVersion}`);
      await writeText(lines.join("\n"));
    }

    setSessionCredits((c) => c + captureCredits);

    // Auto-close after 1.5s. justCopied was set true at the top of handleSubmit.
    setTimeout(() => {
      setJustCopied(false);
      resetAndHide();
    }, 1500);
  }, [annotation, transcript, metadata, captureCredits, croppedScreenshot, appVersion]);

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
  if (mode === "onboarding") {
    return (
      <Onboarding
        permissions={permissions}
        onRecheck={recheckPermissions}
        onDismiss={dismissOnboarding}
      />
    );
  }

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
      width: "100vw", height: "100vh", display: "flex", alignItems: "stretch", justifyContent: "stretch",
      background: "transparent",
      fontFamily: "Verdana, Geneva, sans-serif",
    }}>
      <div style={{
        display: "flex", flexDirection: "column", flex: 1, borderRadius: 14, overflow: "hidden",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      }}>
        <ChromeBar />
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

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
            <img src={logoUrl} style={{ width: 32, height: 32, borderRadius: 8 }} alt="Vision|Pipe logo" />
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

      {justCopied && (
        <div style={{
          position: "fixed", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(20, 30, 24, 0.96)",
          zIndex: 100,
          borderRadius: 14,
          backdropFilter: "blur(4px)",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: 56, color: C.teal, fontWeight: 700, lineHeight: 1, marginBottom: 16,
            }}>✓</div>
            <div style={{
              color: C.cream, fontSize: 22, fontWeight: 700, marginBottom: 6,
              fontFamily: "Verdana, Geneva, sans-serif",
            }}>Copied to clipboard</div>
            <div style={{ color: C.textMuted, fontSize: 13, fontFamily: "Verdana, Geneva, sans-serif" }}>
              Paste into ChatGPT, Claude, or any LLM.
            </div>
          </div>
        </div>
      )}
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

// ── Draggable chrome bar (top of every visible card) ──
function ChromeBar() {
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // left click only
    e.preventDefault();
    getCurrentWindow().startDragging().catch((err) => {
      console.error("[VisionPipe] startDragging failed:", err);
    });
  };

  const dotStyle: React.CSSProperties = {
    width: 3, height: 3, borderRadius: "50%", background: C.textMuted, pointerEvents: "none",
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        height: 32,
        flexShrink: 0,
        background: C.deepForest,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      {/* Left: logo + wordmark */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", gap: 8, pointerEvents: "none" }}>
        <img src={logoUrl} style={{ width: 16, height: 16 }} alt="Vision|Pipe logo" />
        <span style={{ color: C.cream, fontSize: 12, fontWeight: 600, fontFamily: "Verdana, Geneva, sans-serif" }}>Vision|Pipe</span>
      </div>
      {/* Center: 3 columns × 2 rows of dots, centered on the bar */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 3px)",
        gridTemplateRows: "repeat(2, 3px)",
        gap: 3,
        pointerEvents: "none",
      }}>
        <span style={dotStyle} />
        <span style={dotStyle} />
        <span style={dotStyle} />
        <span style={dotStyle} />
        <span style={dotStyle} />
        <span style={dotStyle} />
      </div>
      {/* Right spacer mirrors the left flex so the grip stays centered */}
      <div style={{ flex: 1 }} />
    </div>
  );
}

// ── First-launch / always-on welcome card ──
// Shows on every launch. Content adapts to permission state:
//   - Any missing → permission rows with fix-it buttons
//   - All granted → usage instructions
function Onboarding({ permissions, onRecheck, onDismiss }: {
  permissions: PermissionStatus | null;
  onRecheck: () => void;
  onDismiss: () => void;
}) {
  const allGranted = !!(
    permissions?.screenRecording &&
    permissions?.systemEvents &&
    permissions?.accessibility
  );

  const openPane = async (pane: "screen_recording" | "automation" | "accessibility") => {
    try {
      await invoke("open_settings_pane", { pane });
    } catch (e) {
      console.error("[VisionPipe] open_settings_pane failed:", e);
    }
  };

  return (
    <div style={{
      width: "100vw", height: "100vh", display: "flex", alignItems: "stretch", justifyContent: "stretch",
      background: "transparent",
      fontFamily: "Verdana, Geneva, sans-serif",
    }}>
      <div style={{
        display: "flex", flexDirection: "column", flex: 1, borderRadius: 14, overflow: "hidden",
        border: `1px solid ${C.border}`, background: C.forest,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(46, 139, 122, 0.1)",
      }}>
        <ChromeBar />
        <div style={{ flex: 1, padding: 24, overflowY: "auto", color: C.cream }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Welcome to Vision|Pipe</h1>
          <p style={{ margin: "4px 0 0 0", color: C.amber, fontSize: 14, fontWeight: 700 }}>
            Give your LLM eyes.
          </p>

          {!allGranted ? (
            <>
              <p style={{ marginTop: 8, marginBottom: 16, color: C.textMuted, fontSize: 13 }}>
                Enable three permissions and you'll be ready to capture.
              </p>
              <PermissionRow
                granted={!!permissions?.screenRecording}
                label="Screen Recording"
                description="Required to capture screenshots. If Vision|Pipe isn't already in the list, click the + button and add Vision|Pipe from your Applications folder, then toggle it on."
                onOpen={() => openPane("screen_recording")}
                onRecheck={onRecheck}
              />
              <PermissionRow
                granted={!!permissions?.systemEvents}
                label="Automation: System Events"
                description="Lets Vision|Pipe read the active app and window so it can include them as metadata in captures. Found under System Settings → Privacy & Security → Automation."
                onOpen={() => openPane("automation")}
                onRecheck={onRecheck}
              />
              <PermissionRow
                granted={!!permissions?.accessibility}
                label="Accessibility"
                description="Required so the ⌘⇧C global shortcut works system-wide. Found under System Settings → Privacy & Security → Accessibility. Click + to add Vision|Pipe if it's not listed."
                onOpen={() => openPane("accessibility")}
                onRecheck={onRecheck}
              />
            </>
          ) : (
            <>
              <p style={{ marginTop: 16, marginBottom: 4, color: C.teal, fontSize: 13, fontWeight: 600 }}>
                ✓ You're all set.
              </p>
              <p style={{ marginTop: 0, marginBottom: 16, color: C.textMuted, fontSize: 13 }}>
                All three permissions are granted. Here's how to use Vision|Pipe:
              </p>

              <div style={{
                marginTop: 12, marginBottom: 16, padding: 12, borderRadius: 6,
                background: C.deepForest, border: `1px solid ${C.amber}`,
                fontSize: 12, color: C.cream, lineHeight: 1.55,
              }}>
                <div style={{ color: C.amber, fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
                  ⚠ Heads up — macOS will ask you a couple more times
                </div>
                <div style={{ color: C.textMuted, marginBottom: 6 }}>
                  These show up the first time you capture. Both are normal — click <strong style={{ color: C.cream }}>Allow</strong>:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: C.textMuted }}>
                  <li><strong style={{ color: C.cream }}>"Bypass the system private window picker"</strong> — macOS Sonoma+ adds an extra consent layer for direct screen capture. This is what lets ⌘⇧C grab a region instantly without opening Apple's picker UI.</li>
                  <li><strong style={{ color: C.cream }}>"Control [Safari / Chrome / Firefox / etc.]"</strong> — only fires when you capture from a browser. It's how Vision|Pipe reads the active URL to include in metadata. Skipping this just leaves the URL out.</li>
                </ul>
              </div>

              <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 8 }}>How to use:</div>
              <ul style={{ margin: 0, paddingLeft: 20, color: C.cream, fontSize: 13, lineHeight: 1.8 }}>
                <li>Press <KbdKey>⌘</KbdKey><KbdKey>⇧</KbdKey><KbdKey>C</KbdKey> anywhere to start a capture.</li>
                <li>Drag to select a region, or press <KbdKey>Enter</KbdKey> for a fullscreen capture.</li>
                <li>Press <KbdKey>Esc</KbdKey> to cancel.</li>
                <li>Add an annotation, then click <strong style={{ color: C.amber }}>Pipe it</strong> to copy a markdown-ready capture to your clipboard.</li>
                <li>Paste into ChatGPT, Claude, Gemini, or any LLM that accepts images + text.</li>
              </ul>

              <div style={{ marginTop: 16, fontSize: 12, color: C.textDim }}>
                Re-open this welcome from the menu bar tray icon → <em>Show Onboarding…</em>
              </div>

              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={onDismiss}
                  style={{
                    background: C.teal, color: C.cream, border: "none",
                    padding: "8px 20px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >Got it</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small inline keyboard-key style ──
function KbdKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-block",
      padding: "1px 6px",
      margin: "0 2px",
      fontFamily: "'Source Code Pro', monospace",
      fontSize: 11,
      color: C.cream,
      background: C.deepForest,
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      verticalAlign: "baseline",
    }}>{children}</kbd>
  );
}

// ── Single permission row inside Onboarding ──
function PermissionRow({ granted, label, description, onOpen, onRecheck }: {
  granted: boolean;
  label: string;
  description: string;
  onOpen: () => void;
  onRecheck: () => Promise<void> | void;
}) {
  const [checking, setChecking] = useState(false);

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      // Keep "Checking…" visible long enough for the user to notice
      setTimeout(() => setChecking(false), 400);
    }
  };

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 12,
      background: C.deepForest,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          color: granted ? C.teal : C.sienna, fontWeight: 700, fontSize: 16, width: 16, textAlign: "center",
        }}>{granted ? "✓" : "✗"}</span>
        <span style={{ color: C.cream, fontWeight: 600, fontSize: 14 }}>{label}</span>
      </div>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 8, marginLeft: 24 }}>{description}</div>
      <div style={{ display: "flex", gap: 8, marginLeft: 24, alignItems: "center" }}>
        <button
          onClick={onOpen}
          style={{
            background: C.teal, color: C.cream, border: "none",
            padding: "6px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer", fontWeight: 600,
          }}
        >Open System Settings</button>
        <button
          onClick={handleRecheck}
          disabled={checking}
          style={{
            background: checking ? C.deepForest : "transparent",
            color: checking ? C.amber : C.textMuted,
            border: `1px solid ${checking ? C.amber : C.border}`,
            padding: "6px 12px", borderRadius: 4, fontSize: 12,
            cursor: checking ? "default" : "pointer",
            fontWeight: checking ? 600 : 400,
            transition: "all 150ms ease",
            opacity: checking ? 0.9 : 1,
          }}
        >{checking ? "Checking…" : "Re-check"}</button>
      </div>
    </div>
  );
}

export default App;
