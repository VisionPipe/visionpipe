import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

const LOGO_DATA_URI = "data:image/png;base64,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";

type AppMode = "idle" | "selecting" | "annotating";
type DrawTool = "pen" | "rect" | "arrow" | "circle" | "text";

interface CaptureMetadata {
  app: string;
  window: string;
  resolution: string;
  scale: string;
  os: string;
  timestamp: string;
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
  const [drawColor, setDrawColor] = useState("#ef4444");
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

    if (w < 10 || h < 10) return; // too small

    console.log(`[VisionPipe] Selection: ${x},${y} ${w}x${h}`);

    // Hide the overlay window first so it's not in the screenshot
    const win = getCurrentWindow();
    await win.hide();

    // Brief delay for the window to fully hide
    await new Promise((r) => setTimeout(r, 150));

    // Now capture the selected region via Rust
    const dpr = window.devicePixelRatio || 1;
    const physX = Math.round(x * dpr);
    const physY = Math.round(y * dpr);
    const physW = Math.round(w * dpr);
    const physH = Math.round(h * dpr);

    try {
      console.log(`[VisionPipe] Capturing region: ${physX},${physY} ${physW}x${physH}`);
      const screenshot = await invoke<string>("take_screenshot", {
        x: physX, y: physY, width: physW, height: physH
      });
      setCroppedScreenshot(screenshot);
      console.log("[VisionPipe] Region captured successfully");
    } catch (err) {
      console.error("[VisionPipe] Region capture failed:", err);
      setCroppedScreenshot(null);
    }

    // Fetch metadata
    try {
      const meta = await invoke<CaptureMetadata>("get_metadata");
      setMetadata({ ...meta, captureWidth: physW, captureHeight: physH, captureMethod: "region" });
    } catch {
      setMetadata({
        app: "Unknown", window: "Unknown",
        resolution: `${screen.width}x${screen.height}`,
        scale: `${dpr}x`, os: navigator.platform,
        timestamp: new Date().toISOString(),
        captureWidth: physW, captureHeight: physH, captureMethod: "region",
      });
    }

    // Resize to annotation window and show
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await win.setSize(new LogicalSize(920, 520));
    await win.center();
    await win.setAlwaysOnTop(false);
    await win.show();
    await win.setFocus();
    setMode("annotating");
    setTimeout(() => textareaRef.current?.focus(), 200);
  }, []);

  // ── Mouse handlers for region selection ──
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

  // ── Submit annotation to clipboard ──
  const handleSubmit = useCallback(async () => {
    if (!metadata) return;
    const lines: string[] = [];
    if (annotation.trim()) { lines.push(annotation.trim()); lines.push(""); }
    if (transcript.trim()) { lines.push(`[voice] ${transcript.trim()}`); lines.push(""); }
    lines.push("---");
    lines.push(`app: ${metadata.app}`);
    lines.push(`window: ${metadata.window}`);
    lines.push(`resolution: ${metadata.resolution} @ ${metadata.scale}`);
    lines.push(`os: ${metadata.os}`);
    lines.push(`captured: ${metadata.timestamp}`);
    lines.push(`region: ${metadata.captureWidth}x${metadata.captureHeight}`);
    lines.push(`method: ${metadata.captureMethod}`);
    lines.push("---");
    lines.push("VisionPipe v0.1.0");
    await writeText(lines.join("\n"));
    setSessionCredits((c) => c + captureCredits);
    resetAndHide();
  }, [annotation, transcript, metadata, captureCredits]);

  // ── Cancel and hide ──
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

  // ── Keyboard handler ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { resetAndHide(); }
      if (e.key === "Enter" && !e.shiftKey && mode === "annotating" && document.activeElement === textareaRef.current) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [resetAndHide, handleSubmit, mode]);

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      if (!transcript) setTranscript("This dropdown is rendering below the viewport on Safari...");
    } else {
      setIsRecording(true);
      setTranscript("");
    }
  };

  // ════════════════════════════════════════════
  // IDLE — nothing visible
  // ════════════════════════════════════════════
  if (mode === "idle") return null;

  // ════════════════════════════════════════════
  // SELECTING — fullscreen crosshair overlay
  // ════════════════════════════════════════════
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
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          cursor: "crosshair",
          background: "rgba(0, 0, 0, 0.3)",
          zIndex: 99999,
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {/* Selection rectangle */}
        {isDragging && selection && selW > 2 && selH > 2 && (
          <>
            <div
              style={{
                position: "absolute",
                left: selX,
                top: selY,
                width: selW,
                height: selH,
                border: "2px solid #3b82f6",
                background: "rgba(59, 130, 246, 0.1)",
                pointerEvents: "none",
                boxSizing: "border-box",
              }}
            />
            {/* Dimension label */}
            <div
              style={{
                position: "absolute",
                left: selX,
                top: selY + selH + 6,
                background: "rgba(0, 0, 0, 0.8)",
                color: "#3b82f6",
                fontSize: 12,
                fontFamily: "monospace",
                padding: "2px 8px",
                borderRadius: 4,
                pointerEvents: "none",
              }}
            >
              {Math.round(selW)}x{Math.round(selH)}
            </div>
          </>
        )}

        {/* Instructions (shown before drag starts) */}
        {!isDragging && !selection && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ color: "white", fontSize: 18, fontWeight: 600, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
              Drag to select a region
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 6, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
              ESC to cancel
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════
  // ANNOTATING — annotation overlay
  // ════════════════════════════════════════════
  return (
    <div className="flex items-center justify-center h-screen bg-black/80 backdrop-blur-sm">
      <div className="flex rounded-xl overflow-hidden border border-[#333] shadow-2xl max-w-[920px]">

        {/* Left: Screenshot + Drawing Tools */}
        <div className="flex-1 flex flex-col min-w-[560px]">

          {/* Drawing Toolbar */}
          <div className="px-3 py-2 bg-[#1a1a2e] flex items-center gap-1.5 border-b border-[#333]">
            <ToolButton icon="pen" active={activeTool === "pen"} onClick={() => setActiveTool("pen")} title="Freehand draw" />
            <ToolButton icon="rect" active={activeTool === "rect"} onClick={() => setActiveTool("rect")} title="Rectangle" />
            <ToolButton icon="arrow" active={activeTool === "arrow"} onClick={() => setActiveTool("arrow")} title="Arrow" />
            <ToolButton icon="circle" active={activeTool === "circle"} onClick={() => setActiveTool("circle")} title="Circle" />
            <ToolButton icon="text" active={activeTool === "text"} onClick={() => setActiveTool("text")} title="Text label" />
            <div className="w-px h-5 bg-[#444] mx-1" />
            <button
              className="w-6 h-6 rounded-full border-2 border-[#666] cursor-pointer"
              style={{ backgroundColor: drawColor }}
              onClick={() => setDrawColor(drawColor === "#ef4444" ? "#3b82f6" : drawColor === "#3b82f6" ? "#4ade80" : "#ef4444")}
              title="Annotation color"
            />
            <div className="w-px h-5 bg-[#444] mx-1" />
            <ToolButton icon="undo" active={false} onClick={() => {}} title="Undo" />
            <ToolButton icon="redo" active={false} onClick={() => {}} title="Redo" />
            <div className="flex-1" />
            {metadata && (
              <div className="font-mono text-[10px] text-[#555] flex items-center gap-1">
                <span>{metadata.captureWidth}x{metadata.captureHeight}</span>
                <span className="text-blue-500">|</span>
                <span>{metadata.scale}</span>
                <span className="text-blue-500">|</span>
                <span>{metadata.captureMethod}</span>
              </div>
            )}
          </div>

          {/* Screenshot Area */}
          <div className="h-[360px] bg-gradient-to-br from-[#2d2d3d] via-[#1e1e30] to-[#2a2a40] flex items-center justify-center relative">
            {croppedScreenshot ? (
              <img src={croppedScreenshot} alt="Captured screenshot" className="max-w-full max-h-full object-contain" />
            ) : (
              <div className="text-[#555] text-sm text-center">
                <div className="text-4xl mb-2">&#128421;</div>
                Your Screenshot<br />
                <span className="text-xs text-[#444]">No screenshot captured</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="w-[250px] bg-[#12122a] border-l border-[#333] flex flex-col p-4">
          <div className="flex items-center gap-2 mb-4">
            <img src={LOGO_DATA_URI} className="w-7 h-7 rounded-md" alt="VisionPipe logo" />
            <div className="text-[15px] font-bold text-white">
              Vision<span className="text-blue-500 font-mono">|</span><span className="text-blue-500">Pipe</span>
            </div>
          </div>

          {metadata && (
            <div className="font-mono text-[10px] text-[#555] mb-4 leading-relaxed bg-[#0d0d1a] rounded-md p-2 border border-[#1a1a30]">
              <div><span className="text-[#666]">app</span> <span className="text-blue-500">=</span> {metadata.app}</div>
              <div><span className="text-[#666]">win</span> <span className="text-blue-500">=</span> {metadata.window}</div>
              <div><span className="text-[#666]">res</span> <span className="text-blue-500">=</span> {metadata.resolution} @ {metadata.scale}</div>
              <div><span className="text-[#666]">os</span>&nbsp; <span className="text-blue-500">=</span> {metadata.os}</div>
            </div>
          )}

          <div className="font-mono text-[10px] text-[#555] mb-1.5 flex items-center gap-1">
            <span className="text-blue-500">&gt;</span> context
          </div>

          <textarea
            ref={textareaRef}
            value={annotation}
            onChange={(e) => setAnnotation(e.target.value)}
            placeholder="// what should your AI do with this?"
            className="w-full min-h-[90px] bg-[#1a1a30] border border-[#333] rounded-lg px-2.5 py-2 text-[#ccc] text-xs resize-y outline-none focus:border-blue-500 transition-colors"
          />

          <button
            onClick={toggleRecording}
            className={`flex items-center gap-2 mt-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${
              isRecording ? "bg-red-500/10 border-red-500/30" : "bg-[#1a1a30] border-[#333] hover:border-[#444]"
            }`}
          >
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
              isRecording ? "bg-red-500/20" : "bg-[#2a2a3e]"
            }`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isRecording ? "#ef4444" : "#3b82f6"} strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <span className="text-xs text-[#888]">{isRecording ? "Stop recording" : "Record voice note"}</span>
          </button>

          {(isRecording || transcript) && (
            <div className="mt-2 px-2.5 py-2 bg-[#0d1a0d] border border-[#1a3a1a] rounded-lg">
              <div className="font-mono text-[10px] text-[#4ade80] mb-1 flex items-center gap-1">
                {isRecording && <div className="w-1.5 h-1.5 bg-[#4ade80] rounded-full animate-pulse" />}
                <span>stdout</span>
              </div>
              <div className="text-[11px] text-[#6ee7a0] italic">
                {isRecording ? "Listening..." : `"${transcript}"`}
              </div>
            </div>
          )}

          <div className="flex-1" />

          <div className="flex justify-between items-center mb-2 px-2 py-1.5 bg-[#1a1a30] rounded-md font-mono">
            <span className="text-[10px] text-[#555]">this_capture</span>
            <span className="text-[11px] text-blue-500 font-semibold">{captureCredits} credits</span>
          </div>
          <div className="text-center text-[10px] text-[#444] mb-2.5 font-mono">
            session_total <span className="text-blue-500">=</span> {sessionCredits + captureCredits}
          </div>

          <button
            onClick={handleSubmit}
            className="w-full py-2.5 bg-blue-500 hover:bg-blue-400 border-none rounded-lg text-white text-[13px] font-semibold cursor-pointer tracking-wide flex items-center justify-center gap-1.5 transition-colors"
          >
            <span>Copy to Clipboard</span>
            <span className="font-mono text-[11px] opacity-70">|</span>
            <span className="font-mono text-[11px] opacity-70">pbcopy</span>
          </button>

          <div className="text-center mt-1.5 text-[10px] text-[#444] font-mono">
            &#8629; pipe it <span className="text-blue-500">|</span> esc cancel
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolButton({ icon, active, onClick, title }: { icon: string; active: boolean; onClick: () => void; title: string }) {
  const bgClass = active ? "bg-blue-500" : "bg-[#2a2a3e] hover:bg-[#333]";
  const strokeColor = active ? "white" : "#999";
  const renderIcon = () => {
    switch (icon) {
      case "pen": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
      case "rect": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>;
      case "arrow": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>;
      case "circle": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>;
      case "text": return <span className={`text-sm font-bold ${active ? "text-white" : "text-[#999]"}`}>T</span>;
      case "undo": return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>;
      case "redo": return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" /></svg>;
      default: return null;
    }
  };
  return (
    <button onClick={onClick} title={title} className={`w-8 h-8 ${bgClass} rounded-lg flex items-center justify-center cursor-pointer transition-colors border-none`}>
      {renderIcon()}
    </button>
  );
}

export default App;
