import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SessionProvider, useSession } from "./state/session-context";
import { MicProvider } from "./state/mic-context";
import { MicOnboardingModal } from "./components/MicOnboardingModal";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { SessionWindow } from "./components/SessionWindow";
import { HistoryHub } from "./components/HistoryHub";
import { Onboarding } from "./components/Onboarding";
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
  const [captureMode, setCaptureMode] = useState<"region" | "scrolling">("region");
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const modeRef = useRef<AppMode>("onboarding");
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ── Master audio recorder lifecycle (cpal, on-device) ──
  // We don't hold a JS-side handle anymore — the recorder lives in Rust as
  // a global singleton (see audio.rs). React tracks only whether it's
  // active so the UI mic icon and capture-flow gates can react. After
  // END_SESSION there's nothing JS-side to clear.
  const [micRecording, setMicRecording] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  // Mic + Speech Recognition permissions are deferred to the FIRST time
  // the user clicks the mic button in the Header (see MicOnboardingModal).
  // This preserves the no-fluff onboarding for silent-capture-only users
  // while still surfacing the explainer for users who want voice notes.
  const [micOnboardingShown, setMicOnboardingShown] = useState<boolean>(
    () => localStorage.getItem("vp-mic-onboarded") === "1"
  );
  const [showMicModal, setShowMicModal] = useState(false);

  // networkState is fixed to "local-only" since the v0.5.2 switch from
  // Deepgram (cloud streaming) to Apple SFSpeechRecognizer (on-device
  // batch). Kept as state so the Header indicator API doesn't change; if
  // we re-enable cloud streaming behind a Settings toggle, this flips
  // back to "online" / "offline" / "local-only".
  const [networkState] = useState<NetworkState>("local-only");
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
        // Welcome card stays visible on every launch until the user clicks
        // "Get Started". The previous "auto-hide if all permissions granted"
        // logic made the app appear to flash-and-quit because the only
        // visible UI was hidden one frame after mount.
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

  // Resize to a HistoryHub-friendly window size centered on the current
  // monitor. Used when transitioning into the idle/HistoryHub view from
  // (a) onboarding dismissal, (b) selection-cancel, (c) end-session.
  // Defined here (not later in the file) because the post-END_SESSION
  // effect right below needs to reference it.
  const resizeForHistoryHub = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      if (monitor) {
        const { PhysicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
        const scale = monitor.scaleFactor ?? 1;
        const monitorW = monitor.size.width;
        const monitorH = monitor.size.height;
        const targetW = Math.max(Math.round(900 * scale), Math.min(Math.round(1400 * scale), Math.round(monitorW * 0.55)));
        const targetH = Math.max(Math.round(640 * scale), Math.min(Math.round(900 * scale), Math.round(monitorH * 0.75)));
        const targetX = monitor.position.x + Math.round((monitorW - targetW) / 2);
        const targetY = monitor.position.y + Math.round((monitorH - targetH) / 2);
        await win.setSize(new PhysicalSize(targetW, targetH));
        await win.setPosition(new PhysicalPosition(targetX, targetY));
      }
    } catch (err) {
      console.warn("[VisionPipe] resizeForHistoryHub failed:", err);
    }
  }, []);

  // ── Reset mode to "idle" when the session ends ──
  // SessionWindow's "New Session" button dispatches END_SESSION (clearing
  // state.session) but doesn't touch App's mode. Without this effect, mode
  // would stay at "session" forever after the first end-session, which
  // would cause the global hotkey handler below to ignore ⌘⇧C presses
  // (since it only fires when mode === "idle"). HistoryHub renders correctly
  // either way (it triggers on !state.session), but the hotkey gate breaks.
  // Also shrinks the window back to HistoryHub size — the SessionWindow
  // dimensions (70%×85% of monitor) are too large for the bundle list.
  useEffect(() => {
    if (!state.session && mode === "session") {
      setMode("idle");
      void resizeForHistoryHub();
    }
  }, [state.session, mode, resizeForHistoryHub]);

  // ── Listen for the global hotkey event from Rust ──
  useEffect(() => {
    const unlisten = listen<string>("start-capture", () => {
      // Ignore if not in idle mode (e.g. onboarding visible, mid-capture)
      if (modeRef.current !== "idle") {
        console.log("[VisionPipe] start-capture ignored, mode is", modeRef.current);
        return;
      }
      console.log("[VisionPipe] start-capture received");
      setCaptureMode("region");
      setMode("selecting");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ── Listen for the scroll-capture hotkey (⌘⇧S) from Rust ──
  // Same selection overlay as regular capture, but the SelectionOverlay
  // calls `take_scrolling_screenshot` on confirm so the page scrolls
  // and the frames are stitched into one tall image.
  useEffect(() => {
    const unlisten = listen<string>("start-scroll-capture", () => {
      if (modeRef.current !== "idle") {
        console.log("[VisionPipe] start-scroll-capture ignored, mode is", modeRef.current);
        return;
      }
      console.log("[VisionPipe] start-scroll-capture received");
      setCaptureMode("scrolling");
      setMode("selecting");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ── Listen for "show mic onboarding modal" event ──
  // Dispatched by SessionWindow when the user clicks the per-card
  // Re-record button before completing mic onboarding. Routes the user
  // through the same explainer flow as the Header pill click.
  useEffect(() => {
    const handler = () => setShowMicModal(true);
    window.addEventListener("vp-show-mic-modal", handler);
    return () => window.removeEventListener("vp-show-mic-modal", handler);
  }, []);

  // ── Listen for the in-app "Take next screenshot" trigger from SessionWindow ──
  // Unlike the Rust global-shortcut path (which resizes the window to
  // fullscreen before firing start-capture), the in-app "+" button fires
  // this event directly. After the first capture, the session window has
  // been shrunk to 70%×85% — so we must re-expand to fullscreen here so
  // the SelectionOverlay covers the whole screen and the user can drag
  // any region they want, not just within the small post-capture window.
  useEffect(() => {
    const handler = async () => {
      try {
        // Step 1: hide VP + capture metadata of the previously frontmost
        // app (the user's actual target, not Vision|Pipe). Without this
        // the markdown's "App: …" line would say "visionpipe" because by
        // the time get_metadata runs, VP would still be focused.
        await invoke("prepare_in_app_capture");

        // Step 2: now that metadata is stashed, resize VP to fullscreen
        // for the SelectionOverlay.
        const win = getCurrentWindow();
        const { currentMonitor } = await import("@tauri-apps/api/window");
        const monitor = await currentMonitor();
        if (monitor) {
          const { PhysicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
          await win.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
          await win.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
        }
        await win.show();
        await win.setFocus();
        await win.setAlwaysOnTop(true);
      } catch (err) {
        console.warn("[VisionPipe] vp-take-next-screenshot prepare failed:", err);
      }
      setCaptureMode("region");
      setMode("selecting");
    };
    window.addEventListener("vp-take-next-screenshot", handler);
    return () => window.removeEventListener("vp-take-next-screenshot", handler);
  }, []);

  // ── Persist last-used viewMode to localStorage as a per-user preference ──
  useEffect(() => {
    if (state.session) localStorage.setItem("vp-default-view", state.session.viewMode);
  }, [state.session?.viewMode]);

  // ── Window-scoped hotkey wiring ──
  // Loads user-configured combos from the Rust persistence layer
  // (`load_hotkey_config` — Task 21) on mount, then attaches a single
  // `keydown` listener on `window` that dispatches to the appropriate action.
  // Falls back to the same defaults the Rust side hardcodes if the load fails.
  const [hotkeys, setHotkeys] = useState({
    copyAndSend: "CmdOrCtrl+Enter",
    rerecordActive: "CmdOrCtrl+Shift+R",
    toggleViewMode: "CmdOrCtrl+T",
  });

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<{
          take_next_screenshot: string;
          copy_and_send: string;
          rerecord_active: string;
          toggle_view_mode: string;
        }>("load_hotkey_config");
        setHotkeys({
          copyAndSend: cfg.copy_and_send,
          rerecordActive: cfg.rerecord_active,
          toggleViewMode: cfg.toggle_view_mode,
        });
      } catch (err) {
        console.warn("[VisionPipe] Failed to load hotkey config; using defaults:", err);
      }
    })();
  }, []);

  useEffect(() => {
    const matches = (e: KeyboardEvent, combo: string): boolean => {
      const parts = combo.split("+");
      const wantsMeta = parts.includes("CmdOrCtrl");
      const wantsShift = parts.includes("Shift");
      const wantsAlt = parts.includes("Alt");
      const meta = (e.metaKey || e.ctrlKey);
      const key = parts.filter(p => !["CmdOrCtrl", "Shift", "Alt"].includes(p))[0];
      if (!key) return false;
      if (wantsMeta !== meta) return false;
      if (wantsShift !== e.shiftKey) return false;
      if (wantsAlt !== e.altKey) return false;
      // Compare keys case-insensitively for letters; case-sensitively for named keys
      const eKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const cKey = key.length === 1 ? key.toUpperCase() : key;
      return eKey === cKey;
    };
    const onKey = (e: KeyboardEvent) => {
      if (matches(e, hotkeys.copyAndSend)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("vp-copy-and-send"));
      } else if (matches(e, hotkeys.toggleViewMode)) {
        e.preventDefault();
        if (state.session) dispatch({ type: "TOGGLE_VIEW_MODE" });
      } else if (matches(e, hotkeys.rerecordActive)) {
        e.preventDefault();
        const last = state.session?.screenshots[state.session.screenshots.length - 1];
        if (last) {
          window.dispatchEvent(new CustomEvent("vp-rerecord-segment", { detail: { seq: last.seq } }));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, state.session, dispatch]);

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
  // Switches to "idle" mode and resizes the window to a session-friendly
  // size centered on the current monitor. The window stays VISIBLE so the
  // user lands on HistoryHub (their bundle history + "+ New Bundle" CTA).
  // Previously hid the window, but now that idle = HistoryHub the user
  // needs to actually see something.
  const dismissOnboarding = useCallback(async () => {
    setMode("idle");
    await resizeForHistoryHub();
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  }, [resizeForHistoryHub]);

  // ── Initialize the session's audio recorder for on-device transcription.
  // v0.5.2: switched from MediaRecorder + Deepgram (cloud) to Rust cpal +
  // Apple SFSpeechRecognizer (on-device). Each screenshot's narration is
  // whatever was recorded between that screenshot and the next (or session
  // end). Per-segment batch transcription removes the vp-edge proxy
  // dependency entirely. Cloud streaming (Deepgram) was removed in v0.6.0;
  // git history has the implementation if we need to re-enable it behind a
  // Settings toggle.
  const initSessionAudio = useCallback(async () => {
    try {
      // Start the cpal recording for the FIRST segment of this session.
      // stop_recording_and_transcribe will be called at the next screenshot
      // boundary, returning the transcript of that segment which we'll
      // dispatch into the just-finished screenshot's transcriptSegment.
      await invoke("start_recording");
      setMicRecording(true);
    } catch (err) {
      console.warn("[VisionPipe] start_recording failed (mic permission?):", err);
      setMicPermissionDenied(true);
    }
  }, []);

  // ── Stop the current segment's recording and transcribe it.
  // Returns the transcript text (may be empty if nothing captured).
  // Called at every screenshot boundary AND at session-end / new-session.
  const stopAndTranscribeCurrentSegment = useCallback(async (): Promise<string> => {
    if (!micRecording) return "";
    try {
      const transcript = await invoke<string>("stop_recording");
      setMicRecording(false);
      return transcript ?? "";
    } catch (err) {
      console.warn("[VisionPipe] stop_recording failed:", err);
      setMicRecording(false);
      return "";
    }
  }, [micRecording]);

  // ── Mic onboarding modal: triggered the first time the user clicks the
  // mic button (Header) without having granted mic + speech permissions.
  // Records that the prompt has been shown so we don't re-prompt on every
  // click. If the user grants, immediately wire up the recorder for the
  // current session.
  const onMicOnboardComplete = useCallback(async (granted: { microphone: boolean; speechRecognition: boolean }) => {
    setShowMicModal(false);
    localStorage.setItem("vp-mic-onboarded", "1");
    setMicOnboardingShown(true);
    if (granted.microphone) {
      await initSessionAudio();
    } else {
      setMicPermissionDenied(true);
    }
  }, [initSessionAudio]);

  const onMicOnboardSkip = useCallback(() => {
    setShowMicModal(false);
    // Don't persist; user can click the mic button again later to retry.
  }, []);

  const onCapture = useCallback(async (pngBytes: Uint8Array) => {
    const metadata = await invoke<CaptureMetadata>("get_metadata");
    // Local-time YYYY-MM-DD_HH-MM-SS (matches the canonical-name spec).
    // Previously used ISO with `T` separator which produced names like
    // VisionPipe-001-2026-05-03T17-53-27 — the spec wants underscore.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const sessionId = state.session?.id ?? ts;

    let folder = state.session?.folder;
    const isFirstCapture = !state.session;
    if (isFirstCapture) {
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
      // Kick off the on-device recording for the first segment, only if
      // the user has already gone through the (deferred) mic onboarding.
      // Otherwise sessions start SILENT — user can click the mic button
      // later to trigger the modal and start recording mid-session.
      if (micOnboardingShown) {
        await initSessionAudio();
      }
    } else if (micRecording) {
      // SECOND-OR-LATER capture: stop the segment that was being recorded
      // for the LAST screenshot, transcribe it, and append the result to
      // that screenshot's narration. Then start a fresh segment for the
      // new screenshot.
      const transcript = await stopAndTranscribeCurrentSegment();
      if (transcript.trim()) {
        dispatch({ type: "APPEND_TO_ACTIVE_SEGMENT", text: transcript + " " });
      }
      // Restart recording for the new segment (will be transcribed at the
      // next boundary).
      try {
        await invoke("start_recording");
        setMicRecording(true);
      } catch (err) {
        console.warn("[VisionPipe] start_recording (next segment) failed:", err);
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
      metadata, offline: false, // on-device transcription is never "offline"
    };
    dispatch({ type: "APPEND_SCREENSHOT", screenshot, audioElapsedSec: 0 });

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
  }, [state.session, dispatch, micOnboardingShown, micRecording, initSessionAudio, stopAndTranscribeCurrentSegment]);

  const onCancelCapture = useCallback(async () => {
    const win = getCurrentWindow();
    if (state.session) {
      setMode("session");
      await win.show();
      await win.setAlwaysOnTop(false);
    } else {
      setMode("idle");
      // Window is currently fullscreen (overlay). Shrink back to the
      // HistoryHub size so the user doesn't land on a fullscreen empty
      // panel after a misfire.
      await resizeForHistoryHub();
      await win.show();
      await win.setAlwaysOnTop(false);
    }
  }, [state.session, resizeForHistoryHub]);

  // ── Mic toggle (Header button) ──
  // First click on a fresh install (or after sign-out): show the mic
  // onboarding modal which triggers the macOS permission prompts. After
  // grant, recording starts via onMicOnboardComplete → initSessionAudio.
  // Subsequent clicks toggle the cpal session-level recording on/off.
  // (When toggled off mid-session, no transcript is produced for the
  // partial segment — user can manually type narration.)
  const onToggleMic = useCallback(async () => {
    if (!micOnboardingShown) {
      setShowMicModal(true);
      return;
    }
    if (micRecording) {
      // Pause: stop + (optionally transcribe) the current segment
      const transcript = await stopAndTranscribeCurrentSegment();
      if (transcript.trim()) {
        // Append to last screenshot (or closing narration if no screenshots)
        if ((sessionRef.current?.screenshots.length ?? 0) === 0) {
          dispatch({ type: "APPEND_TO_CLOSING_NARRATION", text: transcript + " " });
        } else {
          dispatch({ type: "APPEND_TO_ACTIVE_SEGMENT", text: transcript + " " });
        }
      }
    } else {
      // Resume: start a fresh recording segment
      try {
        await invoke("start_recording");
        setMicRecording(true);
      } catch (err) {
        console.warn("[VisionPipe] mic-toggle start_recording failed:", err);
      }
    }
  }, [micOnboardingShown, micRecording, stopAndTranscribeCurrentSegment, dispatch]);

  // ── Stop the master recorder and drain its final segment.
  // Called from SessionWindow's "New Session" button before END_SESSION,
  // and from ReRecordModal so cpal's single-recording slot is free.
  // Drains the in-flight segment's transcript into the last screenshot
  // (or closing narration if no screenshots yet) so nothing the user
  // said before stop is lost.
  const clearRecorder = useCallback(async () => {
    if (micRecording) {
      const transcript = await stopAndTranscribeCurrentSegment();
      if (transcript.trim()) {
        if ((sessionRef.current?.screenshots.length ?? 0) === 0) {
          dispatch({ type: "APPEND_TO_CLOSING_NARRATION", text: transcript + " " });
        } else {
          dispatch({ type: "APPEND_TO_ACTIVE_SEGMENT", text: transcript + " " });
        }
      }
    }
    setMicRecording(false);
  }, [micRecording, stopAndTranscribeCurrentSegment, dispatch]);

  // No-op kept for MicContext API stability — Deepgram WebSocket path was
  // removed in v0.5.2 (replaced by Apple SFSpeechRecognizer). If we re-add
  // cloud streaming behind a Settings toggle, this will become the close
  // hook again.
  const closeDeepgram = useCallback(() => {}, []);

  // ── Flush master recorder on window close / app quit ──
  // beforeunload fires when the Tauri window tears down. Drain the
  // in-flight segment so the transcript isn't lost. Best-effort: a hard
  // process kill bypasses this entirely.
  useEffect(() => {
    const handler = () => { void clearRecorder(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [clearRecorder]);

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
    view = <SelectionOverlay onCapture={onCapture} onCancel={onCancelCapture} captureMode={captureMode} />;
  } else if (state.session) {
    view = <SessionWindow />;
  } else {
    // mode === "idle" OR (mode === "session" but session was just ended).
    // After END_SESSION the user lands here, on HistoryHub, instead of the
    // window disappearing — which used to be confusing ("did the app quit?").
    view = <HistoryHub />;
  }

  return (
    <MicProvider value={{
      recording: micRecording,
      permissionDenied: micPermissionDenied,
      onToggle: onToggleMic,
      networkState,
      clearRecorder,
      closeDeepgram,
    }}>
      {view}
      {showMicModal && (
        <MicOnboardingModal
          onComplete={onMicOnboardComplete}
          onSkip={onMicOnboardSkip}
        />
      )}
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
