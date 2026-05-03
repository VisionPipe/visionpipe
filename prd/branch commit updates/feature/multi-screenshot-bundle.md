# Branch Progress: feature/multi-screenshot-bundle

This document tracks progress on the `feature/multi-screenshot-bundle` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

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


