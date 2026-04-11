import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import logoUrl from "./images/logo1.png";

// Drawing tool types
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

// Placeholder metadata for dev mode / when Rust metadata isn't available yet
const PLACEHOLDER_METADATA: CaptureMetadata = {
  app: "Visual Studio Code",
  window: "App.tsx — visionpipe",
  resolution: "2560x1600",
  scale: "2x",
  os: "macOS 15.3.2",
  timestamp: new Date().toISOString(),
  captureWidth: 1200,
  captureHeight: 800,
  captureMethod: "region",
};

function App() {
  const [annotation, setAnnotation] = useState("");
  const [captured, setCaptured] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<CaptureMetadata>(PLACEHOLDER_METADATA);
  const [activeTool, setActiveTool] = useState<DrawTool>("pen");
  const [drawColor, setDrawColor] = useState("#ef4444");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sessionCredits, setSessionCredits] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Calculate credits for this capture
  const captureCredits = 1 + (annotation.trim() ? 0 : 0) + (transcript ? 2 : 0);

  useEffect(() => {
    const unlisten = listen("start-capture", async () => {
      setCaptured(true);

      // Fetch metadata and screenshot in parallel
      const [metaResult, screenshotResult] = await Promise.allSettled([
        invoke<CaptureMetadata>("get_metadata"),
        invoke<string>("take_screenshot", { x: 0, y: 0, width: 800, height: 600 }),
      ]);

      if (metaResult.status === "fulfilled") {
        setMetadata({
          ...metaResult.value,
          captureWidth: PLACEHOLDER_METADATA.captureWidth,
          captureHeight: PLACEHOLDER_METADATA.captureHeight,
          captureMethod: "region",
        });
      } else {
        setMetadata({ ...PLACEHOLDER_METADATA, timestamp: new Date().toISOString() });
      }

      if (screenshotResult.status === "fulfilled") {
        setScreenshotDataUrl(screenshotResult.value);
      } else {
        setScreenshotDataUrl(null);
      }

      setTimeout(() => textareaRef.current?.focus(), 100);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    const lines: string[] = [];

    if (annotation.trim()) {
      lines.push(annotation.trim());
      lines.push("");
    }
    if (transcript.trim()) {
      lines.push(`[voice] ${transcript.trim()}`);
      lines.push("");
    }

    // Structured metadata
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

    // Reset and hide
    setAnnotation("");
    setTranscript("");
    setScreenshotDataUrl(null);
    setCaptured(false);
    const win = getCurrentWindow();
    await win.hide();
  }, [annotation, transcript, metadata, captureCredits]);

  const handleCancel = useCallback(async () => {
    setAnnotation("");
    setTranscript("");
    setScreenshotDataUrl(null);
    setCaptured(false);
    const win = getCurrentWindow();
    await win.hide();
  }, []);

  // Global keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
      if (e.key === "Enter" && !e.shiftKey && document.activeElement === textareaRef.current) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCancel, handleSubmit]);

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      // Whisper transcription would happen here
      if (!transcript) {
        setTranscript("This dropdown is rendering below the viewport on Safari...");
      }
    } else {
      setIsRecording(true);
      setTranscript("");
    }
  };

  if (!captured) {
    return null;
  }

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

            {/* Color picker */}
            <button
              className="w-6 h-6 rounded-full border-2 border-[#666] cursor-pointer"
              style={{ backgroundColor: drawColor }}
              onClick={() => setDrawColor(drawColor === "#ef4444" ? "#3b82f6" : drawColor === "#3b82f6" ? "#4ade80" : "#ef4444")}
              title="Annotation color"
            />

            <div className="w-px h-5 bg-[#444] mx-1" />

            {/* Undo/Redo */}
            <ToolButton icon="undo" active={false} onClick={() => {}} title="Undo" />
            <ToolButton icon="redo" active={false} onClick={() => {}} title="Redo" />

            <div className="flex-1" />

            {/* Capture metadata in monospace */}
            <div className="font-mono text-[10px] text-[#555] flex items-center gap-1">
              <span>{metadata.captureWidth}x{metadata.captureHeight}</span>
              <span className="text-blue-500">|</span>
              <span>{metadata.scale}</span>
              <span className="text-blue-500">|</span>
              <span>{metadata.captureMethod}</span>
            </div>
          </div>

          {/* Screenshot Area */}
          <div className="h-[360px] bg-gradient-to-br from-[#2d2d3d] via-[#1e1e30] to-[#2a2a40] flex items-center justify-center relative">
            {screenshotDataUrl ? (
              <img
                src={screenshotDataUrl}
                alt="Captured screenshot"
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-[#555] text-sm text-center">
                <div className="text-4xl mb-2">&#128421;</div>
                Your Screenshot<br />
                <span className="text-xs text-[#444]">Displayed at captured size</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="w-[250px] bg-[#12122a] border-l border-[#333] flex flex-col p-4">

          {/* Logo */}
          <div className="flex items-center gap-2 mb-4">
            <img
              src={logoUrl}
              className="w-7 h-7 rounded-md"
              alt="VisionPipe logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="text-[15px] font-bold text-white">
              Vision<span className="text-blue-500 font-mono">|</span><span className="text-blue-500">Pipe</span>
            </div>
          </div>

          {/* Metadata Block */}
          <div className="font-mono text-[10px] text-[#555] mb-4 leading-relaxed bg-[#0d0d1a] rounded-md p-2 border border-[#1a1a30]">
            <div><span className="text-[#666]">app</span> <span className="text-blue-500">=</span> {metadata.app}</div>
            <div><span className="text-[#666]">win</span> <span className="text-blue-500">=</span> {metadata.window}</div>
            <div><span className="text-[#666]">res</span> <span className="text-blue-500">=</span> {metadata.resolution} @ {metadata.scale}</div>
            <div><span className="text-[#666]">os</span>&nbsp; <span className="text-blue-500">=</span> {metadata.os}</div>
          </div>

          {/* Context Label */}
          <div className="font-mono text-[10px] text-[#555] mb-1.5 flex items-center gap-1">
            <span className="text-blue-500">&gt;</span> context
          </div>

          {/* Text Annotation */}
          <textarea
            ref={textareaRef}
            value={annotation}
            onChange={(e) => setAnnotation(e.target.value)}
            placeholder="// what should your AI do with this?"
            className="w-full min-h-[90px] bg-[#1a1a30] border border-[#333] rounded-lg px-2.5 py-2 text-[#ccc] text-xs resize-y outline-none focus:border-blue-500 transition-colors"
          />

          {/* Voice Button */}
          <button
            onClick={toggleRecording}
            className={`flex items-center gap-2 mt-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${
              isRecording
                ? "bg-red-500/10 border-red-500/30"
                : "bg-[#1a1a30] border-[#333] hover:border-[#444]"
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
            <span className="text-xs text-[#888]">
              {isRecording ? "Stop recording" : "Record voice note"}
            </span>
          </button>

          {/* Transcript */}
          {(isRecording || transcript) && (
            <div className="mt-2 px-2.5 py-2 bg-[#0d1a0d] border border-[#1a3a1a] rounded-lg">
              <div className="font-mono text-[10px] text-[#4ade80] mb-1 flex items-center gap-1">
                {isRecording && (
                  <div className="w-1.5 h-1.5 bg-[#4ade80] rounded-full animate-pulse" />
                )}
                <span>stdout</span>
              </div>
              <div className="text-[11px] text-[#6ee7a0] italic">
                {isRecording ? "Listening..." : `"${transcript}"`}
              </div>
            </div>
          )}

          <div className="flex-1" />

          {/* Credits */}
          <div className="flex justify-between items-center mb-2 px-2 py-1.5 bg-[#1a1a30] rounded-md font-mono">
            <span className="text-[10px] text-[#555]">this_capture</span>
            <span className="text-[11px] text-blue-500 font-semibold">{captureCredits} credits</span>
          </div>
          <div className="text-center text-[10px] text-[#444] mb-2.5 font-mono">
            session_total <span className="text-blue-500">=</span> {sessionCredits + captureCredits}
          </div>

          {/* Send Button */}
          <button
            onClick={handleSubmit}
            className="w-full py-2.5 bg-blue-500 hover:bg-blue-400 border-none rounded-lg text-white text-[13px] font-semibold cursor-pointer tracking-wide flex items-center justify-center gap-1.5 transition-colors"
          >
            <span>Copy to Clipboard</span>
            <span className="font-mono text-[11px] opacity-70">|</span>
            <span className="font-mono text-[11px] opacity-70">pbcopy</span>
          </button>

          {/* Keyboard Hint */}
          <div className="text-center mt-1.5 text-[10px] text-[#444] font-mono">
            &#8629; pipe it <span className="text-blue-500">|</span> esc cancel
          </div>
        </div>
      </div>
    </div>
  );
}

// Drawing tool button component
function ToolButton({ icon, active, onClick, title }: {
  icon: string;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  const bgClass = active ? "bg-blue-500" : "bg-[#2a2a3e] hover:bg-[#333]";
  const strokeColor = active ? "white" : "#999";

  const renderIcon = () => {
    switch (icon) {
      case "pen":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        );
      case "rect":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        );
      case "arrow":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        );
      case "circle":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
          </svg>
        );
      case "text":
        return (
          <span className={`text-sm font-bold ${active ? "text-white" : "text-[#999]"}`}>T</span>
        );
      case "undo":
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        );
      case "redo":
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 ${bgClass} rounded-lg flex items-center justify-center cursor-pointer transition-colors border-none`}
    >
      {renderIcon()}
    </button>
  );
}

export default App;
