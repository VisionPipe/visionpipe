import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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

type AppMode = "onboarding" | "idle" | "selecting" | "annotating";
type DrawTool = "pen" | "rect" | "arrow" | "circle" | "text";

interface DrawnShape {
  tool: DrawTool;
  color: string;
  /** For pen: array of {x,y} points relative to canvas. For rect/arrow/circle: [start, end]. */
  points: { x: number; y: number }[];
  /** For text tool: the committed string */
  text?: string;
  /** For text tool: font size used */
  fontSize?: number;
}

interface PermissionStatus {
  screen_recording: boolean;
  accessibility: boolean;
  microphone: boolean;
}

const ONBOARDING_STEPS = [
  {
    key: "welcome" as const,
    title: "Welcome to VisionPipe",
    subtitle: "Screenshot to AI in one keystroke",
    description:
      "VisionPipe captures your screen, enriches it with system metadata, and copies a ready-to-paste image to your clipboard. Before we get started, we need a few permissions to make the magic happen.",
    icon: "rocket",
  },
  {
    key: "screen_recording" as const,
    title: "Screen Recording",
    subtitle: "Required to capture screenshots",
    description:
      "VisionPipe uses macOS screen capture to grab exactly the region you select. Without this permission, we can't see what's on your screen. Your captures stay local \u2014 nothing is uploaded anywhere.",
    icon: "screen",
    permission: "screen_recording" as const,
  },
  {
    key: "accessibility" as const,
    title: "Accessibility",
    subtitle: "Required for the global shortcut",
    description:
      "The \u2318\u21e7C shortcut needs Accessibility access to work from any app. This lets VisionPipe listen for the hotkey even when it's running in the background, so you can capture from anywhere.",
    icon: "keyboard",
    permission: "accessibility" as const,
  },
  {
    key: "microphone" as const,
    title: "Microphone Access",
    subtitle: "Optional \u2014 for voice annotations",
    description:
      "VisionPipe can transcribe voice notes and attach them to your captures using on-device speech recognition. Your audio never leaves your Mac. You can skip this and enable it later.",
    icon: "mic",
    permission: "microphone" as const,
  },
  {
    key: "ready" as const,
    title: "You're all set!",
    subtitle: "Press \u2318\u21e7C from anywhere to capture",
    description:
      "VisionPipe will live in your menu bar. Hit \u2318\u21e7C to select a region, add a note, and paste the annotated screenshot into any AI chat, doc, or issue tracker.",
    icon: "check",
  },
];

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
  const needsOnboarding = !localStorage.getItem("visionpipe_onboarded");
  const [mode, setMode] = useState<AppMode>(needsOnboarding ? "onboarding" : "idle");
  const [annotation, setAnnotation] = useState("");
  const [croppedScreenshot, setCroppedScreenshot] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<CaptureMetadata | null>(null);
  const [activeTool, setActiveTool] = useState<DrawTool>("pen");
  const [drawColor, setDrawColor] = useState(C.amber);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sessionCredits, setSessionCredits] = useState(0);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [drawnShapes, setDrawnShapes] = useState<DrawnShape[]>([]);
  const [redoStack, setRedoStack] = useState<DrawnShape[]>([]);
  const [currentShape, setCurrentShape] = useState<DrawnShape | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [permissions, setPermissions] = useState<PermissionStatus>({
    screen_recording: false,
    accessibility: false,
    microphone: false,
  });

  const captureCredits = 1 + (transcript ? 2 : 0);

  // Hide window on startup if onboarding already done
  useEffect(() => {
    if (!needsOnboarding) {
      getCurrentWindow().hide();
    }
  }, []);

  // Poll permissions during onboarding
  useEffect(() => {
    if (mode !== "onboarding") return;
    const poll = async () => {
      try {
        const p = await invoke<PermissionStatus>("check_permissions");
        setPermissions(p);
      } catch (err) {
        console.error("[VisionPipe] Permission check failed:", err);
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [mode]);

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

  // ── Drawing helpers ──
  const drawShapeOnCtx = useCallback((ctx: CanvasRenderingContext2D, shape: DrawnShape, scaleX = 1, scaleY = 1) => {
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
    ctx.lineWidth = 3 * Math.min(scaleX, scaleY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const sx = (p: { x: number; y: number }) => ({ x: p.x * scaleX, y: p.y * scaleY });

    switch (shape.tool) {
      case "pen": {
        if (shape.points.length < 2) break;
        ctx.beginPath();
        const p0 = sx(shape.points[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < shape.points.length; i++) {
          const p = sx(shape.points[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        break;
      }
      case "rect": {
        if (shape.points.length < 2) break;
        const a = sx(shape.points[0]);
        const b = sx(shape.points[shape.points.length - 1]);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        break;
      }
      case "arrow": {
        if (shape.points.length < 2) break;
        const a = sx(shape.points[0]);
        const b = sx(shape.points[shape.points.length - 1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // arrowhead
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const headLen = 14 * Math.min(scaleX, scaleY);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
        break;
      }
      case "circle": {
        if (shape.points.length < 2) break;
        const a = sx(shape.points[0]);
        const b = sx(shape.points[shape.points.length - 1]);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rx = Math.abs(b.x - a.x) / 2;
        const ry = Math.abs(b.y - a.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "text": {
        if (!shape.text || shape.points.length < 1) break;
        const p = sx(shape.points[0]);
        const fs = (shape.fontSize || 16) * Math.min(scaleX, scaleY);
        ctx.font = `bold ${fs}px Verdana, Geneva, sans-serif`;
        ctx.fillText(shape.text, p.x, p.y);
        break;
      }
    }
  }, []);

  // Redraw all shapes on the overlay canvas
  const redrawCanvas = useCallback(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const shape of drawnShapes) {
      drawShapeOnCtx(ctx, shape);
    }
    if (currentShape) {
      drawShapeOnCtx(ctx, currentShape);
    }
  }, [drawnShapes, currentShape, drawShapeOnCtx]);

  // Redraw whenever shapes change
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Resize canvas to match container
  useEffect(() => {
    const container = drawContainerRef.current;
    const canvas = drawCanvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      const img = container.querySelector("img");
      if (img) {
        canvas.width = img.clientWidth;
        canvas.height = img.clientHeight;
        // Position canvas over the image
        canvas.style.width = img.clientWidth + "px";
        canvas.style.height = img.clientHeight + "px";
        canvas.style.left = img.offsetLeft + "px";
        canvas.style.top = img.offsetTop + "px";
      } else {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
      redrawCanvas();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [mode, croppedScreenshot, redrawCanvas]);

  const getCanvasPoint = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleDrawMouseDown = useCallback((e: React.MouseEvent) => {
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (activeTool === "text") {
      // If there's already a text input, commit it first
      if (textInput && textInput.value.trim()) {
        const newShape: DrawnShape = {
          tool: "text", color: drawColor, points: [{ x: textInput.x, y: textInput.y }],
          text: textInput.value, fontSize: 16,
        };
        setDrawnShapes((prev) => [...prev, newShape]);
        setRedoStack([]);
      }
      setTextInput({ x: pt.x, y: pt.y, value: "" });
      return;
    }

    setIsDrawing(true);
    setCurrentShape({ tool: activeTool, color: drawColor, points: [pt] });
  }, [activeTool, drawColor, getCanvasPoint, textInput]);

  const handleDrawMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !currentShape) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (currentShape.tool === "pen") {
      setCurrentShape((prev) => prev ? { ...prev, points: [...prev.points, pt] } : null);
    } else {
      // For rect/arrow/circle, keep start + current end
      setCurrentShape((prev) => prev ? { ...prev, points: [prev.points[0], pt] } : null);
    }
  }, [isDrawing, currentShape, getCanvasPoint]);

  const handleDrawMouseUp = useCallback(() => {
    if (!isDrawing || !currentShape) return;
    if (currentShape.points.length >= 2 || (currentShape.tool === "pen" && currentShape.points.length >= 2)) {
      setDrawnShapes((prev) => [...prev, currentShape]);
      setRedoStack([]);
    }
    setCurrentShape(null);
    setIsDrawing(false);
  }, [isDrawing, currentShape]);

  const handleUndo = useCallback(() => {
    setDrawnShapes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, last]);
      return prev.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setDrawnShapes((s) => [...s, last]);
      return prev.slice(0, -1);
    });
  }, []);

  const commitTextInput = useCallback(() => {
    if (textInput && textInput.value.trim()) {
      const newShape: DrawnShape = {
        tool: "text", color: drawColor, points: [{ x: textInput.x, y: textInput.y }],
        text: textInput.value, fontSize: 16,
      };
      setDrawnShapes((prev) => [...prev, newShape]);
      setRedoStack([]);
    }
    setTextInput(null);
  }, [textInput, drawColor]);

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

    // Build two columns: left = user text, right = capture metadata
    const username = metadata.username || "User";

    // Left column content (attribution + user request)
    type TextBlock = { text: string; bold: boolean; color: string };
    const leftBlocks: TextBlock[] = [];
    leftBlocks.push({ text: `Annotation by VisionPipe.ai`, bold: true, color: C.amber });
    leftBlocks.push({ text: `Submitted by: ${username}`, bold: false, color: C.textMuted });
    leftBlocks.push({ text: "", bold: false, color: C.cream }); // spacer
    leftBlocks.push({ text: `${username}'s request: "${userCommentText}"`, bold: false, color: C.cream });
    leftBlocks.push({ text: `[User input, passed verbatim by VisionPipe]`, bold: false, color: C.textDim });

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
      { text: `VisionPipe v0.1.0`, color: C.textDim },
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

      // Draw annotations scaled from display canvas to actual image dimensions
      const displayCanvas = drawCanvasRef.current;
      if (displayCanvas && drawnShapes.length > 0) {
        const scaleX = imgW / (displayCanvas.width || 1);
        const scaleY = imgH / (displayCanvas.height || 1);
        for (const shape of drawnShapes) {
          drawShapeOnCtx(ctx, shape, scaleX, scaleY);
        }
      }

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
      lines.push("---", "VisionPipe v0.1.0");
      await writeText(lines.join("\n"));
    }

    setSessionCredits((c) => c + captureCredits);
    resetAndHide();
  }, [annotation, transcript, metadata, captureCredits, croppedScreenshot, drawnShapes, drawShapeOnCtx]);

  const resetAndHide = useCallback(async () => {
    setAnnotation("");
    setTranscript("");
    setIsRecording(false);
    setIsTranscribing(false);
    setCroppedScreenshot(null);
    setSelection(null);
    setMetadata(null);
    setIsDragging(false);
    setDrawnShapes([]);
    setRedoStack([]);
    setCurrentShape(null);
    setIsDrawing(false);
    setTextInput(null);
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
      if (e.key === "Enter" && !e.shiftKey && mode === "annotating") {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [resetAndHide, handleSubmit, captureFullScreen, mode]);

  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording and transcribe
      setIsRecording(false);
      setIsTranscribing(true);
      try {
        const text = await invoke<string>("stop_recording");
        setTranscript(text);
      } catch (err) {
        console.error("Transcription failed:", err);
        setTranscript(`(transcription error: ${err})`);
      } finally {
        setIsTranscribing(false);
      }
    } else {
      // Start recording — ensure speech recognition is authorized first
      setTranscript("");
      try {
        await invoke<boolean>("request_speech_recognition");
        await invoke("start_recording");
        setIsRecording(true);
      } catch (err) {
        console.error("Recording failed:", err);
        setTranscript(`(recording error: ${err})`);
      }
    }
  };

  // ═══════════════════════════════════════
  // ONBOARDING
  // ═══════════════════════════════════════
  if (mode === "onboarding") {
    const step = ONBOARDING_STEPS[onboardingStep];
    const isFirst = onboardingStep === 0;
    const isLast = onboardingStep === ONBOARDING_STEPS.length - 1;
    const permKey = "permission" in step ? step.permission : null;
    const permGranted = permKey ? permissions[permKey] : false;

    const handleGrantPermission = async () => {
      if (!permKey) return;
      if (permKey === "microphone") {
        // Trigger the native macOS permission prompt so VisionPipe appears in the list
        try {
          const granted = await invoke<boolean>("request_microphone_access");
          if (granted) {
            setPermissions((p) => ({ ...p, microphone: true }));
            return;
          }
        } catch (err) {
          console.error("[VisionPipe] Microphone request failed:", err);
        }
      }
      await invoke("open_permission_settings", { permission: permKey });
    };

    const handleNext = async () => {
      if (isLast) {
        localStorage.setItem("visionpipe_onboarded", "1");
        setMode("idle");
        const win = getCurrentWindow();
        await win.hide();
      } else {
        setOnboardingStep((s) => s + 1);
      }
    };

    const renderIcon = () => {
      const size = 48;
      const color = C.teal;
      switch (step.icon) {
        case "rocket":
          return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
              <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
            </svg>
          );
        case "screen":
          return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          );
        case "keyboard":
          return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
              <path d="M6 8h.001" /><path d="M10 8h.001" /><path d="M14 8h.001" /><path d="M18 8h.001" />
              <path d="M6 12h.001" /><path d="M10 12h.001" /><path d="M14 12h.001" /><path d="M18 12h.001" />
              <line x1="7" y1="16" x2="17" y2="16" />
            </svg>
          );
        case "mic":
          return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          );
        case "check":
          return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          );
        default:
          return null;
      }
    };

    return (
      <div style={{
        width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: C.deepForest, fontFamily: "Verdana, Geneva, sans-serif",
      }}>
        <div style={{
          width: 480, display: "flex", flexDirection: "column", alignItems: "center",
          padding: "40px 36px 32px",
        }}>
          {/* Drag handle */}
          <div
            onMouseDown={() => getCurrentWindow().startDragging()}
            style={{
              position: "fixed", top: 0, left: 0, right: 0, height: 32,
              cursor: "grab",
            }}
          />

          {/* Step indicator */}
          <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
            {ONBOARDING_STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === onboardingStep ? 24 : 8, height: 8, borderRadius: 4,
                  background: i === onboardingStep ? C.teal : i < onboardingStep ? C.teal : C.border,
                  opacity: i <= onboardingStep ? 1 : 0.4,
                  transition: "all 0.3s ease",
                }}
              />
            ))}
          </div>

          {/* Icon */}
          <div style={{
            width: 80, height: 80, borderRadius: 20,
            background: C.forest, border: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 24,
          }}>
            {renderIcon()}
          </div>

          {/* Title */}
          <div style={{
            fontSize: 22, fontWeight: 700, color: C.cream,
            marginBottom: 6, textAlign: "center",
          }}>
            {step.title}
          </div>

          {/* Subtitle */}
          <div style={{
            fontSize: 13, color: C.teal,
            fontFamily: "'Source Code Pro', monospace",
            marginBottom: 16, textAlign: "center",
          }}>
            {step.subtitle}
          </div>

          {/* Description */}
          <div style={{
            fontSize: 13, color: C.textMuted, lineHeight: 1.7,
            textAlign: "center", maxWidth: 400, marginBottom: 28,
          }}>
            {step.description}
          </div>

          {/* Permission grant button */}
          {permKey && (
            <div style={{ marginBottom: 20, textAlign: "center" }}>
              {permGranted ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 20px", borderRadius: 10,
                  background: "rgba(46, 139, 122, 0.12)", border: `1px solid rgba(46, 139, 122, 0.3)`,
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.teal} strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span style={{ fontSize: 13, color: C.teal, fontWeight: 600 }}>Permission granted</span>
                </div>
              ) : (
                <button
                  onClick={handleGrantPermission}
                  style={{
                    padding: "10px 24px", borderRadius: 10,
                    background: C.amber, border: "none",
                    color: C.cream, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: "Verdana, Geneva, sans-serif",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = "0.85"}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
                >
                  Open System Settings
                </button>
              )}
              {!permGranted && (
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>
                  Grant the permission in System Settings, then come back here
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div style={{ display: "flex", gap: 12, width: "100%", justifyContent: "center" }}>
            {!isFirst && (
              <button
                onClick={() => setOnboardingStep((s) => s - 1)}
                style={{
                  padding: "10px 24px", borderRadius: 10,
                  background: C.forest, border: `1px solid ${C.border}`,
                  color: C.textMuted, fontSize: 13, cursor: "pointer",
                  fontFamily: "Verdana, Geneva, sans-serif",
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = C.borderLight}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = C.border}
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              style={{
                padding: "10px 32px", borderRadius: 10,
                background: C.teal, border: "none",
                color: C.cream, fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "Verdana, Geneva, sans-serif",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#35a08c"}
              onMouseLeave={(e) => e.currentTarget.style.background = C.teal}
            >
              {isFirst ? "Get Started" : isLast ? "Start Using VisionPipe" : permKey && !permGranted ? "Skip for Now" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            background: "rgba(14, 22, 16, 0.88)", borderRadius: 16, padding: "24px 36px",
            border: `1px solid ${C.border}`,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: C.cream, fontSize: 20, fontWeight: 600, letterSpacing: "0.02em" }}>
              Let's <code style={{ fontFamily: "'Source Code Pro', monospace", color: C.teal, background: "rgba(46, 139, 122, 0.12)", padding: "2px 6px", borderRadius: 4 }}>screenshot|llm</code> it!
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
        display: "flex", flexDirection: "column", width: 880, height: 460, borderRadius: 14, overflow: "hidden",
        border: `1px solid ${C.border}`,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(46, 139, 122, 0.1)",
      }}>
        {/* Drag handle */}
        <div
          onMouseDown={() => getCurrentWindow().startDragging()}
          style={{
            height: 28, background: C.deepForest, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "grab", borderBottom: `1px solid ${C.border}`, flexShrink: 0,
          }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: C.borderLight, pointerEvents: "none" }} />
        </div>

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

            <div style={{ position: "relative" }}>
              <button
                style={{
                  width: 24, height: 24, borderRadius: "50%", border: `2px solid ${C.borderLight}`,
                  background: drawColor, cursor: "pointer", padding: 0,
                }}
                onClick={() => setShowColorPicker((v) => !v)}
                title="Annotation color"
              />
              {showColorPicker && (
                <div style={{
                  position: "absolute", top: 32, left: "50%", transform: "translateX(-50%)",
                  background: C.deepForest, border: `1px solid ${C.border}`, borderRadius: 10,
                  padding: 8, display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 100,
                }}>
                  {[
                    "#d4882a", "#e5a840", "#f5d060", "#c0462a", "#e05550", "#f28b82",
                    "#2e8b7a", "#34a853", "#81c995", "#1a73e8", "#4da6ff", "#a0c4ff",
                    "#9334e6", "#c084fc", "#e8b4f8", "#f5f0e8", "#c0c0c0", "#808080",
                    "#ff6d01", "#ff9a76", "#ffcba4", "#1a2a20", "#3a3a3a", "#000000",
                  ].map((color) => (
                    <button
                      key={color}
                      onClick={() => { setDrawColor(color); setShowColorPicker(false); }}
                      style={{
                        width: 22, height: 22, borderRadius: "50%", border: drawColor === color ? `2px solid ${C.cream}` : "2px solid transparent",
                        background: color, cursor: "pointer", padding: 0,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div style={{ width: 1, height: 20, background: C.border, margin: "0 4px" }} />

            <ToolButton icon="undo" active={false} onClick={handleUndo} title="Undo" />
            <ToolButton icon="redo" active={false} onClick={handleRedo} title="Redo" />

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

          {/* Screenshot Area + Drawing Canvas */}
          <div
            ref={drawContainerRef}
            style={{
              flex: 1, background: `linear-gradient(135deg, ${C.forest}, ${C.deepForest})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", overflow: "hidden",
            }}
          >
            {croppedScreenshot ? (
              <>
                <img src={croppedScreenshot} alt="Captured screenshot" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                <canvas
                  ref={drawCanvasRef}
                  onMouseDown={handleDrawMouseDown}
                  onMouseMove={handleDrawMouseMove}
                  onMouseUp={handleDrawMouseUp}
                  onMouseLeave={handleDrawMouseUp}
                  style={{
                    position: "absolute",
                    cursor: activeTool === "text" ? "text" : "crosshair",
                  }}
                />
                {textInput && (
                  <input
                    autoFocus
                    value={textInput.value}
                    onChange={(e) => setTextInput((prev) => prev ? { ...prev, value: e.target.value } : null)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); commitTextInput(); } }}
                    onBlur={commitTextInput}
                    style={{
                      position: "absolute",
                      left: (drawCanvasRef.current?.offsetLeft || 0) + textInput.x,
                      top: (drawCanvasRef.current?.offsetTop || 0) + textInput.y - 18,
                      background: "rgba(0,0,0,0.5)",
                      border: `1px solid ${drawColor}`,
                      color: drawColor,
                      fontSize: 16,
                      fontWeight: "bold",
                      fontFamily: "Verdana, Geneva, sans-serif",
                      padding: "2px 4px",
                      borderRadius: 4,
                      outline: "none",
                      minWidth: 60,
                      zIndex: 10,
                    }}
                  />
                )}
              </>
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
            placeholder="// context for your LLM"
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
              {isRecording ? "Stop recording" : isTranscribing ? "Transcribing..." : "Record voice note"}
            </span>
          </button>

          {/* Transcript */}
          {(isRecording || isTranscribing || transcript) && (
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
                {(isRecording || isTranscribing) && (
                  <div style={{ width: 6, height: 6, background: C.teal, borderRadius: "50%", animation: "pulse 1.5s infinite" }} />
                )}
                <span>stdout</span>
              </div>
              <div style={{ fontSize: 11, color: C.teal, fontStyle: "italic" }}>
                {isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : `"${transcript}"`}
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
