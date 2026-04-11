# Branch Progress: initial-build-out

This document tracks progress on the `initial-build-out` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-04-11 19:15 UTC

### Summary of changes since last update

Fixed multiple launch-blocking issues preventing the Tauri app from starting and rendering its UI. The app now launches, registers the global hotkey, and displays the annotation overlay when Cmd+Shift+C is pressed.

### Detail of changes made:

- **Fixed global-shortcut plugin crash** (`tauri.conf.json`): The `plugins.global-shortcut` config was using a map with a `shortcuts` array, but the Tauri v2 plugin expects a unit type (empty or absent). Removed the shortcut list from config — shortcut registration is handled in Rust code in `lib.rs`.
- **Fixed macOS transparency** (`tauri.conf.json`): Added `"macOSPrivateApi": true` under the `app` key. Tauri v2 on macOS requires this private API flag to enable transparent window backgrounds. Without it, the window renders as opaque white. Note: this field goes under `app`, not `bundle` (the Tauri schema rejects it under `bundle`).
- **Fixed window not appearing on hotkey** (`lib.rs`): Added `window.center()` before `window.show()` so the window appears centered on screen. Added `ShortcutState::Pressed` check to avoid firing on key release. Added diagnostic `eprintln!` logging for shortcut and event emission.
- **Fixed capture event not reaching React** (`lib.rs`, `App.tsx`): The `start-capture` Tauri event was being emitted before the hidden webview had time to attach its listener. Added a 200ms delay via `std::thread::spawn` before emitting the event. Also added a `window.focus` event listener in React as a fallback trigger for the capture flow.
- **Refactored capture initialization** (`App.tsx`): Extracted `startCapture` as a `useCallback` function. Removed the hardcoded `take_screenshot` call (was using fixed coordinates `0,0,800,600`). The capture flow now only fetches metadata — screenshot capture will be wired up when region selection is implemented.
- **CSS transparency fix** (`styles.css`): Added `!important` on `html, body` background transparency and explicit `#root` transparent background to prevent Tailwind v4 reset from overriding.

### Potential concerns to address:

- **Logo sizing**: The logo image (`src/images/logo1.png`, 814KB) renders at full native size, taking over the entire window. Needs explicit width/height constraints. A base64 version of the logo is available at `src/images/logo-base64.txt` and may be preferable for bundling.
- **Window focus fallback is fragile**: Using the `focus` event as a fallback for capture triggering could cause unintended captures if the window is focused by other means (e.g., Alt-Tab). Should be replaced with a more reliable IPC mechanism once the event timing issue is properly solved.
- **No region selection**: Screenshot capture is completely disabled — there is no crosshair/region-selection UI. The annotation overlay shows but the screenshot area is always the placeholder.
- **Transparent window on non-macOS**: The `macOSPrivateApi` flag is macOS-specific. Windows transparency may need different handling.

---

## Progress Update as of 2026-04-11 18:30 UTC

### Summary of changes since last update

This is the initial entry. The `initial-build-out` branch was created from `main` at commit `9a7c1d8` ("Build annotation overlay UI with developer personality"). The branch inherits 10 commits that established the Tauri v2 desktop app scaffold, PRD, annotation overlay UI, on-device Whisper voice transcription setup, and credit-based consumption model. No new code changes have been made on this branch yet.

### Detail of changes made (inherited from main):

- **Tauri v2 desktop app scaffold** (`5ae0402`): Initial project setup with Vite + React + TypeScript frontend and Rust backend. Configured system tray, global shortcut (`Cmd+Shift+C`), and Tauri plugins for clipboard, dialog, global shortcuts, and shell.
- **PRD and design decisions** (`1ed4bdd`, `c94688a`, `70337bf`): Comprehensive product requirements document at `PRD.md` covering two products (desktop app + website), three clipboard modes (composite image, split clipboard, two-step paste), milestone roadmap (M1-M3), and credit system design.
- **On-device voice transcription** (`ef18bc3`): Added Candle (HuggingFace pure-Rust ML framework) with Metal acceleration and Whisper Base model dependencies. Rust dependencies: `candle-core` (with Metal feature), `candle-nn`, `candle-transformers`, `hf-hub`, `tokenizers`, `symphonia`, `rubato`, `cpal`.
- **Annotation overlay UI** (`3f75c76`, `9a7c1d8`): Full React UI for the capture annotation panel built in `src/App.tsx`. Includes drawing toolbar (pen, rect, arrow, circle, text), color picker, voice recording toggle with transcript display, text annotation input, metadata display sidebar, credit counter, and clipboard submission. Dark theme with blue accent (`#3b82f6`).
- **Rust backend modules**:
  - `src-tauri/src/capture.rs`: Region screenshot capture using the `screenshots` crate, encoding to PNG and returning as base64 data URI.
  - `src-tauri/src/metadata.rs`: Collects frontmost app name and window title (via AppleScript on macOS), screen resolution/scale (via `system_profiler`), OS version, and timestamp. Cross-platform stubs for non-macOS.
  - `src-tauri/src/lib.rs`: Tauri app setup with system tray, global shortcut registration, and two Tauri commands (`take_screenshot`, `get_metadata`).

### PRD brainstorming materials (in `prd/` folder):

- **PRD Brainstorming.pdf**: A Superpowers brainstorming session capture showing the annotation overlay UI mockup with an "Earthy Rebrand" direction. The brainstorm explores replacing the current dark-blue theme with a warmer color palette.
- **Zight screenshot 1** (`Zight 2026-04-11 at 10.59.54 AM.png`): Shows the current annotation overlay UI running in the browser — dark background, blue accents, drawing toolbar at top, metadata sidebar on right, voice transcript area, credit counter, and "Copy to Clipboard | pbcopy" button.
- **Zight screenshot 2** (`Zight 2026-04-11 at 10.59.59 AM.png`): Color palette specification for the earthy rebrand with the following decisions:
  - **Teal** (`#3e867a`): Replaces blue for CTA buttons, pipe separators, active tool highlight; all UI using teal as the primary accent.
  - **Amber** (`#e98B2a`): For annotations and accents — drawing color defaults to amber, credit count uses amber as a warm accent.
  - **Cream** (`#f5f9e4`): Headings and button text use warm off-white from the logo outlines.
  - **Forest Green** (`#1a2a2f`): Replaces navy/indigo with deep forest greens pulled from the camera body for backgrounds.
  - **Burnt Sienna** (`#c84d2a`): Additional warm accent.
  - **Typography**: IBM Plex Sans for UI, Source Code Pro for monospace. Described as "warm, approachable, technical without being cold."
  - **Logo**: 32px camera logo in sidebar, anchoring the brand.

### Potential concerns to address:

- **Drawing tools are UI-only**: The drawing toolbar buttons exist in the React UI but have no canvas implementation behind them. Clicking pen/rect/arrow/circle/text changes the `activeTool` state but nothing renders on the screenshot. Undo/redo buttons are wired to no-ops.
- **Voice transcription is stubbed**: The `toggleRecording` function in `App.tsx` fakes a transcript ("This dropdown is rendering below the viewport on Safari...") rather than invoking Whisper. The Rust-side Candle/Whisper dependencies are declared in `Cargo.toml` but no transcription code exists yet.
- **Screenshot capture is hardcoded**: `take_screenshot` is called with fixed coordinates `(0, 0, 800, 600)` — there is no crosshair/region-selection UI. The user cannot choose what area to capture.
- **No composite image generation**: The clipboard currently only writes structured text (metadata + annotation). The PRD's default mode — a single PNG with the screenshot, drawings, and metadata baked in — is not implemented.
- **System tray is minimal**: The tray icon is created but has no menu, no capture history, no settings, and no quit option.
- **No settings panel**: Hotkey configuration, clipboard mode selection, metadata toggles, and all other settings from the PRD are unimplemented.
- **Earthy rebrand not applied**: The color palette and typography from the brainstorming session have not been implemented in code. The UI still uses the original dark theme with blue (`#3b82f6`) and green (`#4ade80`) accents.
- **No tests**: No unit or integration tests exist for either the Rust backend or the React frontend.
- **Windows support**: Metadata collection (`get_frontmost_app`, `get_screen_info`) returns stub "Unknown" values on non-macOS platforms.
