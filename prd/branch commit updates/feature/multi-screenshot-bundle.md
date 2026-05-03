# Branch Progress: feature/multi-screenshot-bundle

This document tracks progress on the `feature/multi-screenshot-bundle` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

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


