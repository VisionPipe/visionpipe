import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Bridge JS console output to the Rust log plugin so it ends up in
// ~/Library/Logs/com.visionpipe.desktop/visionpipe.log alongside the
// Rust-side log macros. Without this, JS errors are invisible in the
// production build (devtools are disabled). The original console
// methods are preserved so dev devtools still see everything.
import { info as logInfo, warn as logWarn, error as logError, debug as logDebug } from "@tauri-apps/plugin-log";

const fmt = (args: unknown[]) =>
  args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
      if (typeof a === "object") {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    })
    .join(" ");

const orig = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

console.log = (...args: unknown[]) => { orig.log(...args); logInfo(fmt(args)).catch(() => {}); };
console.warn = (...args: unknown[]) => { orig.warn(...args); logWarn(fmt(args)).catch(() => {}); };
console.error = (...args: unknown[]) => { orig.error(...args); logError(fmt(args)).catch(() => {}); };
console.debug = (...args: unknown[]) => { orig.debug(...args); logDebug(fmt(args)).catch(() => {}); };

window.addEventListener("error", (e: ErrorEvent) => {
  const stack = e.error instanceof Error ? e.error.stack ?? "" : "";
  logError(`[window.onerror] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}\n${stack}`).catch(() => {});
});

window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  const reason =
    e.reason instanceof Error
      ? `${e.reason.message}\n${e.reason.stack ?? ""}`
      : String(e.reason);
  logError(`[unhandledrejection] ${reason}`).catch(() => {});
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
