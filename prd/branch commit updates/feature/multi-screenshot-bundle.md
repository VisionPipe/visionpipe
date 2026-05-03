# Branch Progress: feature/multi-screenshot-bundle

This document tracks progress on the `feature/multi-screenshot-bundle` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-05-03 12:04 PDT — v0.6.0
*(Most recent updates at top)*


## v0.6.0 — History view + cpal cleanup

**New: in-app History hub**
- When Vision|Pipe is the active app and no session is in progress, the
  window now shows a "Recent screenshot bundles" view instead of hiding.
- Each row: 3 thumbnails + label ("Today at 9:42 AM · 3 screenshots") +
  first caption / transcript snippet. Click a row to expand: full
  thumbnail grid + transcript snippet + folder path.
- Per-row actions: **Copy** (writes transcript.md + sets clipboard with
  dual text + file URL representation, same as in-session Copy & Send) and
  **Show in Finder** (selects transcript.md if it exists, otherwise opens
  the session folder — drag from there into Claude Code).
- "+ New Screenshot Bundle" button in the header triggers the standard
  capture pipeline (same path as ⌘⇧C).
- After "End Session" or onboarding dismiss, the user lands on the
  History view (was previously a hidden window — felt like the app
  had quit).

**Tray menu now shows recent SESSIONS, not individual PNGs**
- The tray's "Recent" submenu used to list the last 10 .png files. It now
  lists the last 10 sessions (bundles) with the same friendly label as
  the History view. Click opens the session folder in Finder.

**Re-record narration ported to cpal**
- ReRecordModal previously used the browser's MediaRecorder + saved a
  separate .webm file per re-record (which the markdown then referenced
  as "supplemental audio"). With the v0.5.2 cpal switch this approach
  was stale. It now pauses the master cpal recording (drains its
  in-flight transcript so nothing is lost), starts a fresh segment,
  and on Stop replaces the screenshot's transcript text outright.

**Code cleanup: removed dead Deepgram + MediaRecorder paths**
- Deleted `src/lib/deepgram-client.ts` and `src/lib/audio-recorder.ts`
  (both were unused after the v0.5.2 on-device switch).
- Removed the `recorder` field from MicContext (cpal lives in Rust;
  there's no JS-side handle to expose).
- SessionWindow's "New Session" handler no longer tries to write a
  webm blob — it just drains the master mic via `clearRecorder`.

**New Tauri commands**
- `list_recent_sessions_cmd(limit)` — returns SessionSummary[] for the
  History view + tray menu.
- `reveal_in_finder(path)` — `open -R` wrapper used by both surfaces.
- `read_session_file(folder, filename)` — needed so Copy from history
  can re-render markdown for sessions that never had Copy & Send run.

---


## Progress Update as of 2026-05-03 11:22 PDT — v0.5.1
*(Most recent updates at top)*

### Summary of changes since last update

Release v0.5.1 (auto-generated entry — no `scripts/.release-notes.md` was provided).

### Detail of changes made:

- On-device transcription + click-to-expand + detached layout rewrite + Re-record gating
- Fix metadata-at-hotkey-press, canonicalName format, duration; Copy & Send writes file
- Release v0.5.0
- Release v0.4.3
- Bug fixes + ScreenshotCard layout restructure with lucide icons
- Release v0.4.1
- Defer mic onboarding to first mic-button click + welcome card cleanup
- Release v0.4.0
- Commit scrolling-capture source already shipped in v0.3.8 binary
- Release v0.3.8

### Potential concerns to address:

- Auto-generated entry; a human-written summary would be more useful for future LLM context.

---


## Progress Update as of 2026-05-03 10:42 PDT — v0.5.0
*(Most recent updates at top)*

### Summary of changes since last update

Persistent app-level logging shipped. Vision|Pipe now writes a daily-rotated log file to `~/Library/Logs/com.visionpipe.desktop/visionpipe.log` capturing both Rust-side logs and JavaScript console output (which was previously invisible because devtools are disabled in production builds). Two new tray menu items make it easy to find or share these logs: "Reveal Logs in Finder…" opens the log directory, and "Save Diagnostic Bundle…" zips up the current logs + version + macOS system info into `~/Downloads/` and reveals the zip in Finder so users can drag it into a chat with us when something goes wrong. Bumping minor because of the new infrastructure + new tray items.

### Detail of changes made:

- **`src-tauri/Cargo.toml`** — Added `tauri-plugin-log = "2"` and `log = "0.4"` dependencies.
- **`package.json`** — Added `@tauri-apps/plugin-log` for the JS bridge.
- **`src-tauri/src/lib.rs`** — Initialized `tauri-plugin-log` with three targets (Stdout, LogDir with file_name "visionpipe", Webview), level driven by `VISIONPIPE_LOG_LEVEL` env var (defaults to Info; supports trace/debug/info/warn/error). Daily rotation via `KeepAll` strategy with 5 MB max file size.
- **`src-tauri/src/lib.rs`** — New `reveal_logs_in_finder` Tauri command: opens `~/Library/Logs/com.visionpipe.desktop/` in Finder, creating the directory if it doesn't exist yet.
- **`src-tauri/src/lib.rs`** — New `save_diagnostic_bundle` Tauri command: copies the log directory into a `/tmp` staging dir, writes `version.txt` (Vision|Pipe version + build timestamp) and `system.txt` (`sw_vers`, `hw.model`, `cpu.brand_string`), zips the staging dir into `~/Downloads/visionpipe-diagnostic-YYYYMMDD-HHMMSS.zip`, then reveals the zip in Finder. Cleans up staging after.
- **`src-tauri/src/lib.rs`** — Tray menu now has two new entries: "Reveal Logs in Finder…" and "Save Diagnostic Bundle…", placed right under "Show Onboarding…" and above the Quit separator.
- **`src/main.tsx`** — Bridge installed BEFORE React mounts: `console.log/warn/error/debug` now also call the log plugin's corresponding functions, so all JS console output flows into the file. Added `window.onerror` and `unhandledrejection` listeners that forward to `logError` so frontend crashes are captured even if no `console.error` was called. Original console methods still execute first, so dev devtools see everything as before.
- **`src-tauri/capabilities/default.json`** — Added `log:default` permission so the JS plugin bridge can call into the Rust log plugin.
- **Privacy**: The diagnostic bundle is purely local — the file lands in your Downloads folder and stays there until you choose to share it. Nothing is uploaded to any server. No analytics. The log file itself contains app events + JS console output; if you want to inspect it before sharing, "Reveal Logs in Finder…" gets you there.

### Potential concerns to address:

- **Existing `eprintln!` calls in lib.rs are not yet migrated to `log::info!`/`error!`** — they still go to stderr (visible via `log show --process visionpipe`) but don't land in the new persistent log file. Migrating them is a mechanical follow-up; everything still works during the transition because both paths are alive.
- **Log file can grow** to 5 MB before rotation, and `KeepAll` keeps every rotated file. On heavy use over months that adds up. Worth switching to `KeepLastN(7)` (one week) or pruning old logs in `save_diagnostic_bundle`.
- **`log:default` permission grants the JS side access to all log levels.** Acceptable for our use; if we ever ship a third-party JS dependency that does noisy logging, it'd land in the file too. Worth narrowing if that becomes a concern.
- **The diagnostic bundle does NOT include**: TCC permission state per-service, `~/Pictures/VisionPipe/` directory listing, or the user's `.release-notes.md`. Adding those is a one-liner each if it'd help diagnose specific issues.

---


## Progress Update as of 2026-05-03 10:33 PDT — v0.4.3
*(Most recent updates at top)*

### Summary of changes since last update

The menu-bar tray icon (top of the macOS menu bar) now actually does something useful when clicked. Previously it had just "Show Onboarding" and "Quit" — now it lists your last 5 captures (clicking one opens it in Preview) and adds quick-access items for taking a new capture without the keyboard shortcut. Tray menu auto-refreshes after every capture so the recent list is always current.

### Detail of changes made:

- **`src-tauri/src/lib.rs`** — Added `list_recent_captures()` helper that scans `~/Pictures/VisionPipe/` for `.png` files, sorts by mtime descending, and returns the top 5 with friendly labels like `Today at 9:42 AM — 2026-05-03_09-42-13`. Added `build_tray_menu(app, recents)` that constructs the menu dynamically. Added `refresh_tray_menu(app)` that rebuilds the menu and updates the shared `RecentCapturesState` mutex.
- **`src-tauri/src/lib.rs`** — Tray menu now contains:
  - **Recent captures** section (or "No recent captures yet" if folder is empty) — each item opens the file in Preview when clicked
  - **Take Capture (⌘⇧C)** — emits `start-capture` to the frontend so users can trigger a capture from the menu bar without remembering the hotkey
  - **Take Scrolling Capture (⌘⇧S)** — same, for the new scrolling mode
  - **Open Captures Folder…** — opens `~/Pictures/VisionPipe/` in Finder
  - **Show Onboarding…** (existing)
  - **Quit Vision|Pipe** (existing)
- **`src-tauri/src/lib.rs`** — Tray icon is now built with `TrayIconBuilder::with_id("main")` so we can look it up later via `app.tray_by_id("main")` and replace its menu when captures change.
- **`src-tauri/src/lib.rs`** — `save_and_copy_image` now takes an `AppHandle` parameter and calls `refresh_tray_menu(&app)` after writing the new PNG, so the tray menu's Recent captures list updates in real time.
- **`RecentCapturesState`** — new shared mutex of `Vec<String>` (file paths) keyed by ID. The on-menu-event handler resolves `recent_<N>` IDs back to paths via this state, since menu IDs are static strings and we want the click target to update with the menu.

### Potential concerns to address:

- **No persistent app log file yet**: deferred to next patch (was going to bundle here but the tray work alone was substantial). Plan: add `tauri-plugin-log` so JS console output goes to a real file at `~/Library/Logs/com.visionpipe.desktop/visionpipe.log`, plus tray menu items "Reveal Logs in Finder" and "Save Diagnostic Bundle".
- **Recent captures show by mtime, not session**: a user who renames or copies an old PNG into `~/Pictures/VisionPipe/` could push real captures off the list. Acceptable; that folder is Vision|Pipe's domain.
- **Refresh fires after every save**: cheap (just lists 5 files + rebuilds a small menu) but if we ever did rapid sequential captures, the rebuilds would chain. Not worth optimizing.
- **Tray menu items are not localized**: "Today at 9:42 AM" uses English month names + AM/PM. Same as everywhere else in the app — i18n is a future concern.
- **Parallel-agent coordination**: the merge-best-of-both work stream and another agent doing multi-screenshot-bundle work both touch `lib.rs` and `App.tsx`. Pulled latest before this build (was clean). Future builds should keep doing that.

---


## Progress Update as of 2026-05-03 09:54 PDT — v0.4.1
*(Most recent updates at top)*

### Summary of changes since last update

Fix the "app flashes for a second and disappears" bug that landed in v0.4.0. On launch, when all five macOS permissions were already granted (the common case for returning users), the mount-time `useEffect` was calling `setMode("idle") + win.hide()` immediately after rendering the welcome card. The card painted for one frame, then the window vanished — looked like a crash from the user's perspective, but the app was actually running fine in the tray. Removed the auto-hide. The welcome card now stays visible until the user clicks "Get Started" themselves, on every launch.

### Detail of changes made:

- **`src/App.tsx`** — On-mount useEffect: removed the conditional `setMode("idle") + win.hide()` block that fired when all five permissions were granted. Replaced it with a comment documenting why we *don't* auto-hide. The welcome card now stays visible on every launch until explicit user dismissal.

### Potential concerns to address:

- **Returning users will see the welcome card every launch**: this is the v0.3.x behavior the user explicitly asked for ("when it quits & re-opens, I would like to get an 'all set' and instructions"). If anyone later wants the auto-hide back as an opt-in, add a "Don't show on next launch" checkbox on the welcome card.
- **No persistent app logs yet**: the diagnosis for this bug required `/usr/bin/log show --process visionpipe` while the issue was happening. A `tauri-plugin-log` integration would let us read logs after the fact and would also forward JS `console.log` output (currently invisible in production builds since devtools are disabled). Recommended follow-up.

---


## Progress Update as of 2026-05-03 09:45 PDT — v0.4.0
*(Most recent updates at top)*

### Summary of changes since last update

New feature: **scrolling screenshot capture**. Press ⌘⇧S anywhere, drag a region (over the part of a page you want to capture), and Vision|Pipe will hide itself, send Page Down to the focused app five times, capture the same region after each scroll, and stitch all the frames vertically into one tall PNG. Result drops into the annotation card the same way a regular capture does. Bumping minor because it's a new user-facing capture mode + a new global hotkey.

### Detail of changes made:

- **`src-tauri/src/capture.rs`** — New `capture_scrolling_region(x, y, w, h, num_scrolls)` function. For each frame: shells out to `screencapture -R <rect>` (same Retina capture path as the existing region capture), sends `osascript … key code 121` (Page Down) between frames, sleeps 250ms for the scroll to settle. Stitches the resulting PNGs vertically using the `image` crate (`image::imageops::overlay` onto an `ImageBuffer<Rgba<u8>>`). Returns a base64 data URI of the stitched image.
- **`src-tauri/src/lib.rs`** — New `take_scrolling_screenshot(x, y, width, height, numScrolls)` Tauri command. Defaults to 5 frames if `numScrolls < 2`. Registered in the invoke handler.
- **`src-tauri/src/lib.rs`** — New `Cmd+Shift+S` global shortcut. Mirrors the regular capture shortcut's setup (resize window to monitor size, show, focus, always-on-top), then emits `start-scroll-capture` event. The frontend's listener flips capture mode and enters the same selection overlay.
- **`src/App.tsx`** — Added `captureMode: "region" | "scrolling"` state. New listener for `start-scroll-capture` event sets `captureMode = "scrolling"` and `mode = "selecting"`. The existing `start-capture` listener sets `captureMode = "region"`.
- **`src/components/SelectionOverlay.tsx`** — Now accepts a `captureMode` prop. When mode is `"scrolling"`: hint text changes to amber-on-dark explaining the flow; `completeSelection` invokes `take_scrolling_screenshot` instead of `take_screenshot`. Also added a `win.hide()` + 300ms delay before the invoke so the target app gets keyboard focus before our Page Down events start firing.
- **`src/components/Onboarding.tsx`** — Added a third bullet to the "How to use" list mentioning the new ⌘⇧S shortcut.
- **`src-tauri/Cargo.toml`** — Added `image = { version = "0.25", default-features = false, features = ["png"] }` for the stitching.

### Potential concerns to address:

- **Scroll amount = exactly one Page Down.** Most browsers Page-Down by ~90% of the viewport (slight overlap into the next view). Apps differ. Without overlap detection, the stitched image may show tiny duplication or, less commonly, gaps between frames. Acceptable for v0.3.6 MVP; future work: add overlap-detection via image diff, or scroll by exact pixel amount via accessibility APIs.
- **Fixed 5 frames.** Doesn't auto-detect end of page. If the page is shorter than 5 viewports, frames 4-5 will repeat the bottom of the page (visually fine but redundant). If longer, we cut off. Future: stop early when the new frame is visually identical to the previous (= no scroll happened, end of page reached).
- **Only sends Page Down to whatever's focused.** If the user's target app doesn't accept Page Down (Notion, some chat apps, custom-scroll React apps), nothing scrolls and you get 5 identical frames. Worst case = same PNG repeated 5x. User notices and falls back to regular ⌘⇧C.
- **No keyboard cancel mid-capture.** Once the user releases the mouse on the selection, the 5 frames + scrolls happen synchronously over ~1.5s. Esc cancellation isn't wired during that window. Acceptable.
- **No progress indicator.** The selection overlay disappears after mouseup, then ~1.5s later the annotation card appears. User sees a brief blank period. Future: show a small "Capturing scrolling screenshot…" toast.
- **Does not yet support a UI button alternative to ⌘⇧S.** If the user is in selecting mode (regular ⌘⇧C) and wants to switch to scrolling mid-flow, they have to Esc and ⌘⇧S. A toggle button on the selection overlay would be nicer.

---


## Progress Update as of 2026-05-03 09:37 PDT — v0.3.8
*(Most recent updates at top)*

### Summary of changes since last update

Release v0.3.8 (auto-generated entry — no `scripts/.release-notes.md` was provided).

### Detail of changes made:

- Fix mic entitlement (was blocking the prompt) + add version badge
- Release v0.3.7
- Fix mic + speech recognition onboarding buttons (call Apple SDK first)
- Release v0.3.6
- Release v0.3.5
- Update README to reflect v0.3.3 reality (8 inaccuracies fixed)
- Release v0.3.4
- Spec 1 implementation complete; overnight subagent-driven run finished
- Release v0.3.3
- Add manual smoke-test checklist for Spec 1 verification

### Potential concerns to address:

- Auto-generated entry; a human-written summary would be more useful for future LLM context.

---


## Progress Update as of 2026-05-03 09:29 PDT — v0.3.7
*(Most recent updates at top)*

### Summary of changes since last update

Release v0.3.7 (auto-generated entry — no `scripts/.release-notes.md` was provided).

### Detail of changes made:

- Fix mic + speech recognition onboarding buttons (call Apple SDK first)
- Release v0.3.6
- Release v0.3.5
- Update README to reflect v0.3.3 reality (8 inaccuracies fixed)
- Release v0.3.4
- Spec 1 implementation complete; overnight subagent-driven run finished
- Release v0.3.3
- Add manual smoke-test checklist for Spec 1 verification
- Disclose Deepgram cloud dependency honestly in README v0.2 transcription section
- Wire window-scoped hotkeys for copy/toggle/rerecord

### Potential concerns to address:

- Auto-generated entry; a human-written summary would be more useful for future LLM context.

---


## Progress Update as of 2026-05-03 09:23 PDT — v0.3.6
*(Most recent updates at top)*

### Summary of changes since last update

Release v0.3.6 (auto-generated entry — no `scripts/.release-notes.md` was provided).

### Detail of changes made:

- Release v0.3.5
- Update README to reflect v0.3.3 reality (8 inaccuracies fixed)
- Release v0.3.4
- Spec 1 implementation complete; overnight subagent-driven run finished
- Release v0.3.3
- Add manual smoke-test checklist for Spec 1 verification
- Disclose Deepgram cloud dependency honestly in README v0.2 transcription section
- Wire window-scoped hotkeys for copy/toggle/rerecord
- Add Settings panel with hotkey rebinding and conflict detection
- Add persistent hotkey config in app config dir

### Potential concerns to address:

- Auto-generated entry; a human-written summary would be more useful for future LLM context.

---


## Progress Update as of 2026-05-03 08:20 PDT — v0.3.5
*(Most recent updates at top)*

### Summary of changes since last update

UI cleanup of the welcome card's "you're all set" view. Removed the "Heads up — macOS will ask you a couple more times" callout box (was getting in the way more than it helped). Made the "How to use" section bigger and the keyboard-shortcut pill buttons (⌘ ⇧ C, Enter, Esc) roughly 5× the original size — bigger font, bigger padding, amber border, drop shadow — so the call-to-action shortcut is the first thing the user sees.

### Detail of changes made:

- **`src/components/Onboarding.tsx`** — Deleted the amber-bordered "Heads up" `<div>` that listed the bypass-window-picker and per-browser Apple Events prompts. Bumped the "How to use:" label from fontSize 12 → 14, and the `<ul>` of usage instructions from fontSize 13 line-height 1.8 → fontSize 16 line-height 2.2 (more breathing room).
- **`src/components/Onboarding.tsx`** — `KbdKey` component restyled: padding `1px 6px → 8px 14px`, fontSize `11 → 22` (bold), border `1px solid C.border → 2px solid C.amber`, borderRadius `4 → 8`, added `boxShadow: 0 2px 0 rgba(0,0,0,0.3)` for the pressable-key feel, `verticalAlign: middle` so they sit cleanly inline with the surrounding text. Net visual size is roughly 5× the original.

### Potential concerns to address:

- **The welcome card might overflow 680px height** with the larger text + spacing. If the "Got it" button gets pushed below the fold, bump the window size (`showOnboardingWindow` in App.tsx) by another ~80px. Easy follow-up.
- **No `aria-label` on the kbd elements**: screen readers will read the literal characters. Acceptable for now since the surrounding sentence describes the action.

---


## Progress Update as of 2026-05-03 08:16 PDT — v0.3.4
*(Most recent updates at top)*

### Summary of changes since last update

Two real fixes wrapped in one patch. (1) Critical bug: when the Cargo workspace was added (root `Cargo.toml`, `crates/`), Tauri's build output moved from `src-tauri/target/` to the workspace root `target/`, but `release.sh` still hardcoded the old path. Result: every release after the workspace was added (v0.3.0+ when run from a branch with crates) signed, notarized, and shipped a STALE `.app` from `src-tauri/target/` containing a previous build's binary. **The published v0.3.3 DMG actually contains the v0.2.7 binary.** Fixed: `release.sh` now resolves `APP_PATH` after `pnpm tauri build` and prefers the workspace `target/` path, with the legacy path as fallback. Also added a sanity check that hard-fails if the bundled `Info.plist` version doesn't match the version we just bumped to. (2) Re-enabled the macOS traffic-light window controls (close/minimize/zoom) at top-left by switching to `decorations: true` + `titleBarStyle: "Overlay"`. The chrome bar's left padding was already 80px from earlier work, so the logo + wordmark stay clear of the buttons.

### Detail of changes made:

- **`scripts/release.sh`** — `APP_PATH` is now resolved AFTER `pnpm tauri build` finishes. Tries workspace `target/release/bundle/macos/VisionPipe.app` first, falls back to `src-tauri/target/...`. New post-build sanity check reads `CFBundleShortVersionString` from the bundle's Info.plist and fails the release if it doesn't match the bumped version. This would have caught the v0.3.3 stale-bundle issue immediately.
- **`src-tauri/tauri.conf.json`** — Window config: `decorations: true`, added `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`. Native traffic-light buttons now show at top-left of every Vision|Pipe window. The `Overlay` style makes them float on top of our custom chrome bar without the standard title bar interfering.

### Potential concerns to address:

- **The published v0.3.3 GitHub release + brew tap entry both reference a DMG that contains a v0.2.7 binary**. Once v0.3.4 ships (this release), brew users will get the right thing. Anyone who installed v0.3.3 between when it shipped and v0.3.4 has a misversioned install — the binary is signed/notarized/working but reports as v0.2.7 in the metadata panel. Consider deleting the v0.3.3 GitHub release entirely to avoid future confusion.
- **The sanity check assumes Tauri's `Info.plist` always has `CFBundleShortVersionString`**. If Tauri changes the key name in a future release, the check would fail spuriously — easy to fix when it happens.
- **Selection mode + traffic lights**: ⌘⇧C now opens a full-screen window that has traffic lights at top-left. They aren't hidden during selection. Acceptable trade-off; future work can toggle decorations per-mode.

---


## Progress Update as of 2026-05-03 08:09 PDT — v0.3.3
*(Most recent updates at top)*

### Summary of changes since last update

Re-enable the standard macOS "traffic light" window controls (red/yellow/green close/minimize/zoom buttons) at the top-left of every window. Previous builds had `decorations: false` to support the custom transparent chrome bar, which also hid the system controls. Switched to `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle: true` so the traffic lights float over our custom chrome bar without the standard title bar interfering. Added 80px left-padding to the chrome bar's content so the logo + wordmark don't get hidden behind the buttons.

### Detail of changes made:

- **`src-tauri/tauri.conf.json`** — Window config: `decorations: false → true`, added `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`. The Overlay style is the macOS-native way to keep traffic-light buttons while hiding the default title bar so our custom chrome shows through.
- **`src/App.tsx`** — `ChromeBar` left section now has `padding-left: 80px` (was `12px`) so the logo + wordmark start past the traffic-light buttons. The grip icon stays centered on the bar (it's in the middle flex section, not the left, so the asymmetric padding doesn't move it).

### Potential concerns to address:

- **Selection mode also has the traffic lights now** — when ⌘⇧C launches the full-screen selection overlay, the traffic-light buttons are visible at top-left. They aren't broken (clicking close still closes the window), just visually present during what should be an "edge-to-edge" selection. Could conditionally hide them in selecting mode by toggling decorations at runtime, but that's complex. Acceptable for now.
- **80px padding is a magic number** based on roughly counting the traffic-light buttons (3 × ~14px + spacing). If macOS changes the spacing in a future version, we'd want to bump it. No way to query the exact width programmatically.
- **Resize handles are now active** because `decorations: true`. User can resize the annotation card by dragging edges. The card's `flex: 1` layout adapts gracefully, but onboarding card may look odd at extreme sizes.

---


