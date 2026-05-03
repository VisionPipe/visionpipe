import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SessionProvider, useSession } from "./state/session-context";
import { MicProvider } from "./state/mic-context";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { SessionWindow } from "./components/SessionWindow";
import { IdleScreen } from "./components/IdleScreen";
import { Onboarding } from "./components/Onboarding";
import { createRecorder, type RecorderHandle } from "./lib/audio-recorder";
import { connectDeepgram, type DeepgramClient, type TranscriptEvent } from "./lib/deepgram-client";
import { generateCanonicalName } from "./lib/canonical-name";
import type { PermissionStatus } from "./lib/permissions-types";
import type { CaptureMetadata, Screenshot } from "./types/session";
import type { NetworkState } from "./components/Header";

// "onboarding" is the initial mode on every launch. We check permissions
// immediately and either keep showing the onboarding card (any missing) or
// fall through to "idle". The System Events check may trigger an osascript
// TCC prompt; showing the card first gives the user context before the
// system dialog fires.
type AppMode = "idle" | "onboarding" | "selecting" | "session";

function AppInner() {
  const { state, dispatch } = useSession();
  const [mode, setMode] = useState<AppMode>("onboarding");
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const modeRef = useRef<AppMode>("onboarding");
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ── Master audio recorder lifecycle ──
  // The recorder is created lazily on first capture (so we don't request mic
  // permission until the user actually begins a session). Stored as a ref
  // because we mutate it from async callbacks; mirrored into React state
  // (`micRecording`) for UI updates. After END_SESSION the ref is cleared so
  // the next first-capture branch creates a fresh recorder.
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [micRecording, setMicRecording] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  // ── Deepgram WebSocket lifecycle ──
  // Connects in parallel with the master recorder on first capture. Failure
  // (or a mid-session drop after one retry) flips us into `local-only` mode
  // and any new screenshots taken in that state are stamped `offline: true`.
  // `sessionRef` mirrors `state.session` so the async `dg.onEvent` callback
  // (closure-captured at connect time) always sees the latest screenshot list
  // when deciding whether to append to the active segment vs. closing narration.
  const dgRef = useRef<DeepgramClient | null>(null);
  const [networkState, setNetworkState] = useState<NetworkState>("local-only");
  const sessionRef = useRef(state.session);
  useEffect(() => { sessionRef.current = state.session; }, [state.session]);

  // ── Show/resize/center the window for onboarding ──
  const showOnboardingWindow = useCallback(async () => {
    const win = getCurrentWindow();
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await win.setSize(new LogicalSize(620, 680));
    await win.setAlwaysOnTop(false);
    await win.center();
    await win.show();
    await win.setFocus();
  }, []);

  // ── On mount: set onboarding mode immediately, then fetch permission state.
  // Order matters: the welcome card must be visible before osascript fires
  // its TCC prompt for System Events.
  useEffect(() => {
    (async () => {
      setMode("onboarding");
      await showOnboardingWindow();
      try {
        const status = await invoke<PermissionStatus>("check_permissions");
        setPermissions(status);
        // If all permissions are already granted on first check, skip the card.
        if (
          status.screenRecording &&
          status.systemEvents &&
          status.accessibility &&
          status.microphone &&
          status.speechRecognition
        ) {
          setMode("idle");
          const win = getCurrentWindow();
          await win.hide();
        }
      } catch (err) {
        console.error("[VisionPipe] check_permissions failed:", err);
      }
    })();
  }, [showOnboardingWindow]);

  // ── Auto-poll permissions every 2 s while onboarding is visible ──
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

  // ── Listen for tray menu "Show Onboarding" event ──
  useEffect(() => {
    const unlisten = listen("show-onboarding", async () => {
      try {
        const status = await invoke<PermissionStatus>("check_permissions");
        setPermissions(status);
      } catch {/* ignore */}
      setMode("onboarding");
      await showOnboardingWindow();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [showOnboardingWindow]);

  // ── Listen for the global hotkey event from Rust ──
  useEffect(() => {
    const unlisten = listen<string>("start-capture", () => {
      // Ignore if not in idle mode (e.g. onboarding visible, mid-capture)
      if (modeRef.current !== "idle") {
        console.log("[VisionPipe] start-capture ignored, mode is", modeRef.current);
        return;
      }
      console.log("[VisionPipe] start-capture received");
      setMode("selecting");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ── Listen for the in-app "Take next screenshot" trigger from SessionWindow ──
  useEffect(() => {
    const handler = () => setMode("selecting");
    window.addEventListener("vp-take-next-screenshot", handler);
    return () => window.removeEventListener("vp-take-next-screenshot", handler);
  }, []);

  // ── Persist last-used viewMode to localStorage as a per-user preference ──
  useEffect(() => {
    if (state.session) localStorage.setItem("vp-default-view", state.session.viewMode);
  }, [state.session?.viewMode]);

  // ── Re-check permissions on demand (Onboarding button click) ──
  const recheckPermissions = useCallback(async () => {
    try {
      const status = await invoke<PermissionStatus>("check_permissions");
      setPermissions(status);
    } catch (err) {
      console.error("[VisionPipe] recheck failed:", err);
    }
  }, []);

  // ── Dismiss onboarding (Got it! button — only enabled when all granted) ──
  const dismissOnboarding = useCallback(async () => {
    setMode("idle");
    const win = getCurrentWindow();
    await win.hide();
  }, []);

  const onCapture = useCallback(async (pngBytes: Uint8Array) => {
    const metadata = await invoke<CaptureMetadata>("get_metadata");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const sessionId = state.session?.id ?? ts;

    let folder = state.session?.folder;
    if (!state.session) {
      folder = await invoke<string>("create_session_folder", { sessionId });
      const defaultView = (localStorage.getItem("vp-default-view") as "interleaved" | "split" | null) ?? "interleaved";
      dispatch({
        type: "START_SESSION",
        session: {
          id: sessionId, folder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          audioFile: "audio-master.webm", viewMode: defaultView,
          screenshots: [], closingNarration: "",
        },
      });
      // Kick off the master audio recorder once per session. After a previous
      // session ends, recorderRef is cleared (see onNewSession in
      // SessionWindow), so this branch always creates a fresh handle here.
      if (!recorderRef.current) {
        try {
          recorderRef.current = await createRecorder();
          await recorderRef.current.start();
          setMicRecording(true);

          // ── Wire MediaRecorder chunks → Deepgram WebSocket ──
          // The recorder fan-outs each 1s chunk to all listeners; we add a
          // listener that forwards into the dg socket (the dg client itself
          // silently no-ops if the socket isn't OPEN yet, so we don't have to
          // gate on connection state here).
          recorderRef.current.onChunk((chunk) => {
            dgRef.current?.send(chunk);
          });

          // ── Shared transcript-event handler used by both the initial
          // connect and the single retry attempt below. Pulled into a closure
          // here so the retry path doesn't have to re-reference `dispatch` /
          // `sessionRef` from a potentially stale snapshot.
          const handleFinal = (text: string) => {
            const withSpace = text + " ";
            if ((sessionRef.current?.screenshots.length ?? 0) === 0) {
              dispatch({ type: "APPEND_TO_CLOSING_NARRATION", text: withSpace });
            } else {
              dispatch({ type: "APPEND_TO_ACTIVE_SEGMENT", text: withSpace });
            }
          };

          // ── Connect Deepgram (best-effort) ──
          // If the initial connect throws (no network, edge down, token
          // issuance failed), settle straight into local-only — we don't
          // bother with a retry storm; the user will start a new session if
          // they want to try again. Mid-session drops get one retry after 3s,
          // then settle into local-only permanently.
          try {
            const dg = await connectDeepgram();
            dgRef.current = dg;
            dg.onEvent((e: TranscriptEvent) => {
              if (e.type === "open") {
                setNetworkState("live");
              } else if (e.type === "close" || e.type === "error") {
                setNetworkState("reconnecting");
                // One retry, then settle. Avoids reconnect storm.
                setTimeout(async () => {
                  try {
                    const dg2 = await connectDeepgram();
                    dgRef.current = dg2;
                    dg2.onEvent((e2: TranscriptEvent) => {
                      if (e2.type === "open") setNetworkState("live");
                      else if (e2.type === "close" || e2.type === "error") setNetworkState("local-only");
                      else if (e2.type === "final") handleFinal(e2.text);
                      // interim events: skipped on the retry path for simplicity
                    });
                  } catch {
                    setNetworkState("local-only");
                  }
                }, 3000);
              } else if (e.type === "final") {
                handleFinal(e.text);
              }
              // Interim events: skip for v0.2 (live preview = future polish)
            });
          } catch (err) {
            console.warn("[VisionPipe] Deepgram connect failed (offline mode):", err);
            setNetworkState("local-only");
          }
        } catch (err) {
          console.warn("[VisionPipe] Mic permission denied or recorder init failed:", err);
          setMicPermissionDenied(true);
        }
      }
    }

    const seq = (state.session?.screenshots[state.session.screenshots.length - 1]?.seq ?? 0) + 1;
    const canonicalName = generateCanonicalName({
      seq, timestamp: ts, app: metadata.app,
      activeUrl: metadata.activeUrl, windowTitle: metadata.window,
    });

    await invoke("write_session_file", {
      folder: folder!, filename: `${canonicalName}.png`, bytes: Array.from(pngBytes),
    });

    const screenshot: Screenshot = {
      seq, canonicalName, capturedAt: new Date().toISOString(),
      audioOffset: { start: 0, end: null }, // reducer overwrites .start using audioElapsedSec; placeholder safe
      caption: "", transcriptSegment: "", reRecordedAudio: null,
      metadata, offline: networkState !== "live",
    };
    dispatch({ type: "APPEND_SCREENSHOT", screenshot, audioElapsedSec: recorderRef.current?.elapsedSec() ?? 0 });

    setMode("session");
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
    await win.setAlwaysOnTop(false);

    // ── Resize the (currently fullscreen) window down to a session-friendly
    // size centered on the current monitor. The Rust hotkey handler grew it
    // to monitor.size() so the SelectionOverlay could cover the screen; now
    // that the overlay is gone, shrink it back. Use Physical units so this
    // matches the Rust handler's PhysicalSize / PhysicalPosition pattern and
    // we don't fight DPR (the monitor query returns physical pixels).
    try {
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      if (monitor) {
        const { PhysicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
        const scale = monitor.scaleFactor ?? 1;
        const monitorW = monitor.size.width;
        const monitorH = monitor.size.height;
        // Min/max caps are expressed in logical pixels; convert to physical.
        const minWPhys = Math.round(800 * scale);
        const minHPhys = Math.round(600 * scale);
        const maxWPhys = Math.round(1600 * scale);
        const maxHPhys = Math.round(1000 * scale);
        const targetW = Math.max(minWPhys, Math.min(maxWPhys, Math.round(monitorW * 0.70)));
        const targetH = Math.max(minHPhys, Math.min(maxHPhys, Math.round(monitorH * 0.85)));
        const targetX = monitor.position.x + Math.round((monitorW - targetW) / 2);
        const targetY = monitor.position.y + Math.round((monitorH - targetH) / 2);
        await win.setSize(new PhysicalSize(targetW, targetH));
        await win.setPosition(new PhysicalPosition(targetX, targetY));
      }
    } catch (err) {
      console.error("[VisionPipe] session window resize failed:", err);
    }
  }, [state.session, dispatch]);

  const onCancelCapture = useCallback(async () => {
    if (state.session) {
      setMode("session");
      const win = getCurrentWindow();
      await win.show();
    } else {
      setMode("idle");
      const win = getCurrentWindow();
      await win.hide();
    }
  }, [state.session]);

  // ── Mic toggle (Header button) — pause/resume the master recorder ──
  const onToggleMic = useCallback(() => {
    if (!recorderRef.current) return;
    if (recorderRef.current.isRecording()) {
      recorderRef.current.pause();
      setMicRecording(false);
    } else {
      recorderRef.current.resume();
      setMicRecording(true);
    }
  }, []);

  // ── Clear the recorder ref after SessionWindow flushes audio at session end.
  // Exposed via MicContext so SessionWindow's "New session" handler can null
  // out the ref here, ensuring the next first-capture creates a fresh handle.
  const clearRecorder = useCallback(() => {
    recorderRef.current = null;
    setMicRecording(false);
  }, []);

  // ── Close the Deepgram WebSocket and reset network state.
  // Exposed via MicContext so SessionWindow's "New session" handler can tear
  // down the live transcription stream alongside the master recorder.
  const closeDeepgram = useCallback(() => {
    dgRef.current?.close();
    dgRef.current = null;
    setNetworkState("local-only");
  }, []);

  // ── Flush master audio on window close / app quit ──
  // The browser fires `beforeunload` when the Tauri window is being torn down.
  // We stop the recorder, await the Blob, and synchronously kick off a write
  // via `write_session_file`. Best-effort: a hard kill of the process won't
  // run this. Re-bound when state.session changes so the closure captures the
  // current folder.
  useEffect(() => {
    const handler = async () => {
      if (recorderRef.current && state.session) {
        try {
          const blob = await recorderRef.current.stop();
          const buf = new Uint8Array(await blob.arrayBuffer());
          await invoke("write_session_file", {
            folder: state.session.folder,
            filename: state.session.audioFile,
            bytes: Array.from(buf),
          });
          recorderRef.current = null;
          setMicRecording(false);
        } catch (err) {
          console.warn("[VisionPipe] Audio flush failed on close:", err);
        }
      }
      // Tear down the Deepgram socket if it's still open. Best-effort: a hard
      // process kill won't run this, but a clean window close will.
      if (dgRef.current) {
        try { dgRef.current.close(); } catch { /* ignore */ }
        dgRef.current = null;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.session]);

  let view: ReactNode;
  if (mode === "onboarding") {
    view = (
      <Onboarding
        permissions={permissions}
        onRecheck={recheckPermissions}
        onDismiss={dismissOnboarding}
      />
    );
  } else if (mode === "selecting") {
    view = <SelectionOverlay onCapture={onCapture} onCancel={onCancelCapture} />;
  } else if (mode === "session" || state.session) {
    view = <SessionWindow />;
  } else {
    view = <IdleScreen />;
  }

  return (
    <MicProvider value={{
      recording: micRecording,
      permissionDenied: micPermissionDenied,
      onToggle: onToggleMic,
      recorder: recorderRef.current,
      networkState,
      clearRecorder,
      closeDeepgram,
    }}>
      {view}
    </MicProvider>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <AppInner />
    </SessionProvider>
  );
}
