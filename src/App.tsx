import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";

function App() {
  const [annotation, setAnnotation] = useState("");
  const [captured, setCaptured] = useState(false);
  const [screenshotPath, setScreenshotPath] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unlisten = listen("start-capture", async () => {
      setCaptured(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annotation.trim()) return;

    // Copy annotation to clipboard — user pastes into Claude Code
    // along with the screenshot
    const message = screenshotPath
      ? `See screenshot at ${screenshotPath}\n\n${annotation}`
      : annotation;

    await writeText(message);

    // Reset and hide window
    setAnnotation("");
    setCaptured(false);
    const window = getCurrentWindow();
    await window.hide();
  };

  const handleCancel = async () => {
    setAnnotation("");
    setCaptured(false);
    const window = getCurrentWindow();
    await window.hide();
  };

  if (!captured) {
    return null;
  }

  return (
    <div className="flex items-center justify-center h-screen bg-black/80 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="bg-zinc-900 rounded-xl border border-zinc-700 p-4 w-80 shadow-2xl"
      >
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          What should Claude do with this?
        </label>
        <input
          ref={inputRef}
          type="text"
          value={annotation}
          onChange={(e) => setAnnotation(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && handleCancel()}
          placeholder="e.g. Fix the spacing on this button"
          className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-500 transition"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
