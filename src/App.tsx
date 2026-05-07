import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SessionProvider, useSession } from "./state/session-context";
import { CreditProvider } from "./state/credit-context";
import { RecordingProvider } from "./state/recording-context";
import { MicOnboardingModal } from "./components/MicOnboardingModal";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { SessionWindow } from "./components/SessionWindow";
import { HistoryHub } from "./components/HistoryHub";
import { Onboarding } from "./components/Onboarding";
import { generateCanonicalName } from "./lib/canonical-name";
import type { PermissionStatus } from "./lib/permissions-types";
import type { CaptureMetadata, Screenshot } from "./types/session";

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

  // ── Mic permissions are deferred to the FIRST time the user clicks
  // "Record audio" on a screenshot card (see RecordingControls). The
  // onboarding modal is the explainer; after the user grants both Mic +
  // Speech Recognition permissions (recorded via localStorage
  // `vp-mic-onboarded` = "1"), subsequent Record clicks go directly to
  // start_recording without re-prompting.
  const [showMicModal, setShowMicModal] = useState(false);

  const sessionRef = useRef(state.session);
  useEffect(() => { sessionRef.current = state.session; }, [state.session]);

  // ── Show/resize/center the window for onboarding ──
  // The onboarding card has two states: (a) one or more permissions
  // missing → renders three permission rows + footer (~620 px tall), or
  // (b) all granted → renders just the welcome line, hotkey pill, and
  // Get Started button (~340 px tall). We size the window to whichever
  // state is showing so the "all set" screen doesn't end with a wall of
  // empty deep-forest background below the button.
  const showOnboardingWindow = useCallback(async (compact: boolean = false) => {
    const win = getCurrentWindow();
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const height = compact ? 360 : 680;
    await win.setSize(new LogicalSize(620, height));
    await win.setAlwaysOnTop(false);
    await win.center();
    await win.show();
    await win.setFocus();
  }, []);

  // ── On mount: decide whether to show onboarding or jump straight to HistoryHub
  //
  // First-run / permissions-revoked path: show the onboarding card. Welcome
  //   card MUST be visible before osascript fires its TCC prompt for System
  //   Events, so we render onboarding-then-check, not check-then-render.
  //
  // Returning-user path: if localStorage says they've dismissed onboarding
  //   before AND all three required permissions silently re-verify, skip
  //   onboarding and go straight to HistoryHub. Tauri window starts hidden
  //   (`visible: false` in tauri.conf.json), so the window doesn't flash
  //   anything during the brief check.
  useEffect(() => {
    (async () => {
      const previouslyOnboarded = localStorage.getItem("vp-onboarded") === "1";

      if (previouslyOnboarded) {
        try {
          const status = await invoke<PermissionStatus>("check_permissions");
          setPermissions(status);
          const allGranted = !!(
            status.screenRecording && status.systemEvents && status.accessibility
          );
          if (allGranted) {
            setMode("idle");
            await resizeForHistoryHub();
            const win = getCurrentWindow();
            await win.show();
            await win.setFocus();
            return;
          }
          // Permission was revoked since last launch — fall through to
          // onboarding so the user can re-grant whatever's missing.
        } catch (err) {
          console.error("[VisionPipe] silent permission check failed:", err);
          // Treat errors as "not all granted" and show onboarding.
        }
      }

      setMode("onboarding");
      await showOnboardingWindow();
      try {
        const status = await invoke<PermissionStatus>("check_permissions");
        setPermissions(status);
      } catch (err) {
        console.error("[VisionPipe] check_permissions failed:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── Resize onboarding window when entering the "all set" state ──
  // The Onboarding component renders a much shorter card when all three
  // required permissions are granted. Keeping the window at 680 px tall
  // leaves ~340 px of empty deep-forest background below the Get Started
  // button. Watch the permissions state and shrink the window the moment
  // it flips to all-granted. Depend on the boolean (not the permissions
  // object reference) so we don't re-fire every 2 s while polling.
  const allRequiredGranted = !!(
    permissions?.screenRecording &&
    permissions?.systemEvents &&
    permissions?.accessibility
  );
  useEffect(() => {
    if (mode !== "onboarding") return;
    void showOnboardingWindow(allRequiredGranted);
  }, [mode, allRequiredGranted, showOnboardingWindow]);

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
        // Width: same as before — wide enough for thumbnail rows + actions.
        const targetW = Math.max(Math.round(900 * scale), Math.min(Math.round(1400 * scale), Math.round(monitorW * 0.55)));
        // Height: shrunken from prior 640-900 px range. The HistoryHub
        // typically shows a list whose natural height is ~80-120 px per
        // row plus ~140 px of chrome (top-bar + new-bundle button + a
        // small tip footer); with 0-3 sessions, the old 800+ px window
        // had a wall of empty deep-forest background below the list.
        // 420-720 keeps power users with many sessions happy (the list
        // still scrolls) but doesn't overwhelm the empty/idle state.
        const targetH = Math.max(Math.round(420 * scale), Math.min(Math.round(720 * scale), Math.round(monitorH * 0.55)));
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
      }
      // The "rerecord active segment" hotkey was removed in v0.10.0 along
      // with the modal-based re-record flow. Recording is now per-card via
      // RecordingControls. The hotkey config still has a slot for it
      // (Settings panel) for backward-compat, but no handler fires.
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
    // Durable record that the user has been through the onboarding flow.
    // On future launches, we silently re-verify permissions and skip
    // the welcome card entirely if they're still all granted. The flag
    // gates the skip-path; revoking a permission still falls through
    // to onboarding because the silent check_permissions returns false.
    localStorage.setItem("vp-onboarded", "1");
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
  // Mic onboarding modal: shown the first time the user clicks
  // "Record audio" on any ScreenshotCard. After the modal completes
  // (whether user grants or denies), `vp-mic-onboarded` localStorage is
  // set so subsequent Record clicks bypass the modal and go straight to
  // RecordingProvider's start_recording call.
  const onMicOnboardComplete = useCallback(async (_granted: { microphone: boolean; speechRecognition: boolean }) => {
    setShowMicModal(false);
    localStorage.setItem("vp-mic-onboarded", "1");
    // Do not auto-start a recording — the user explicitly clicks Record
    // again to begin (matches the per-screenshot manual model).
  }, []);

  const onMicOnboardSkip = useCallback(() => {
    setShowMicModal(false);
    // Don't persist; user can click Record again later to re-trigger.
  }, []);

  const onCapture = useCallback(async (capturePath: string) => {
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
    }
    // Audio is no longer auto-started on capture (v0.10.0). Each screenshot
    // gets its own Record button via RecordingControls; sessions are silent
    // by default until the user explicitly clicks Record on a card.

    const seq = (state.session?.screenshots[state.session.screenshots.length - 1]?.seq ?? 0) + 1;
    const canonicalName = generateCanonicalName({
      seq, timestamp: ts, app: metadata.app,
      activeUrl: metadata.activeUrl, windowTitle: metadata.window,
    });

    // Move the captured PNG from /tmp into the session folder under its
    // canonical name. This replaces the old bytes-over-IPC path
    // (Array.from(uint8array) + JSON serialise + 4× size blowup) which
    // was responsible for the 10-20 s post-capture stall on Retina
    // captures. The intra-volume rename is near-instant.
    await invoke("move_capture_to_session", {
      srcPath: capturePath,
      folder: folder!,
      filename: `${canonicalName}.png`,
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
  }, [state.session, dispatch]);

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

  // ── Best-effort: stop any in-flight cpal recording on window close.
  // Without a master recorder running, this is rarely needed — only fires
  // if the user is mid-Record on some card and the window is being torn
  // down. Saves a stray cpal stream from outliving the app.
  useEffect(() => {
    const handler = () => { void invoke("stop_recording").catch(() => {/* ignore */}); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

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
    <>
      {view}
      {showMicModal && (
        <MicOnboardingModal
          onComplete={onMicOnboardComplete}
          onSkip={onMicOnboardSkip}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <CreditProvider>
        <RecordingProvider>
          <AppInner />
        </RecordingProvider>
      </CreditProvider>
    </SessionProvider>
  );
}
