# Branch Progress: initial-build-out

This document tracks progress on the `initial-build-out` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-04-11 21:00 UTC

### Summary of changes since last update

Expanded metadata collection from 6 fields to 19 fields, updated the composite image panel to use consistent 14px Verdana body font for metadata (matching instruction text styling), and expanded the sidebar metadata display.

### Detail of changes made:

- **Expanded metadata.rs** (`src-tauri/src/metadata.rs`): Rewrote from ~30 lines to ~420 lines. Added 13 new fields: `osBuild`, `hostname`, `username`, `locale`, `timezone`, `displayCount`, `primaryDisplay`, `colorSpace`, `cpu`, `memoryGb`, `darkMode`, `battery`, `uptime`, `activeUrl`. Each field uses macOS-specific system commands (AppleScript, `system_profiler`, `sysctl`, `sw_vers`, `pmset`, `defaults`) with cross-platform stubs returning sensible defaults.
- **Updated TypeScript CaptureMetadata interface** (`src/App.tsx`): Expanded from 6 fields to 19+ fields (including 3 frontend-added fields: `captureWidth`, `captureHeight`, `captureMethod`) with proper camelCase field names matching Rust's `#[serde(rename_all = "camelCase")]`.
- **Composite image panel metadata styling** (`src/App.tsx`): Changed metadata lines from `monoFont` (12px Source Code Pro) / `C.textDim` to `bodyFont` (14px Verdana) / `C.textMuted`, matching the fallback instruction text styling. All new metadata fields displayed in the composite image with pipe-separated formatting.
- **Sidebar metadata block** (`src/App.tsx`): Expanded from 4 lines (app, window, resolution, os) to 9 lines including CPU, memory, user@hostname, battery, and active URL. Added `maxHeight: 120` with `overflowY: auto` to prevent sidebar overflow. Reduced font to 9px to fit more info.
- **Text fallback clipboard** (`src/App.tsx`): Updated text-only fallback to include all expanded metadata fields.
- **Browser URL detection** (`metadata.rs`): Detects active URL from Safari, Chrome, Firefox, Arc, Brave, Edge, Opera, and Vivaldi via AppleScript.

### Potential concerns to address:

- **Long metadata lines in composite image**: Some metadata lines (CPU name, display info) can be very long and may overflow the canvas width on narrow screenshots. Consider word-wrapping or truncating.
- **AppleScript permissions**: Several metadata collection functions use AppleScript (`osascript`). Users may see permission dialogs on first use, especially for `get_active_url` which accesses browser data.
- **`system_profiler` performance**: `get_screen_info` and `get_display_info` both call `system_profiler SPDisplaysDataType -json` independently. Could be combined into a single call for performance.
- **Drawing tools still non-functional**: Canvas drawing not implemented — toolbar is visual only.
- **Voice transcription still stubbed**.

---

## Progress Update as of 2026-04-11 20:15 UTC

### Summary of changes since last update

Applied the earthy color rebrand (Teal/Amber/Cream/Forest/Sienna palette), switched to SVG logo, implemented composite image clipboard output (screenshot + annotation + metadata baked into one PNG), and fixed annotation UI layout with fixed dimensions.

### Detail of changes made:

- **Earthy rebrand** (`App.tsx`, `styles.css`): Replaced all blue (#3b82f6) with Teal (#2e8b7a), navy backgrounds with Forest (#1a2a20) and Deep Forest (#141e18), red with Burnt Sienna (#c0462a), green accents with Amber (#d4882a). Text uses Cream (#f5f0e8) for headings, muted green (#8a9a8a) for secondary. Typography changed to Verdana for UI, Source Code Pro for monospace. All colors defined in a `C` constant object for consistency.
- **SVG logo** (`App.tsx`): Replaced the inline base64 PNG (which rendered poorly) with the proper SVG file at `src/images/visionpipe-logo.svg`. Imported as a Vite asset URL, rendered at 32x32px in the sidebar.
- **Composite image clipboard** (`App.tsx`): The `handleSubmit` function now creates a canvas, draws the captured screenshot at the top, then renders a dark panel below with the annotation text (word-wrapped at 70 chars), voice transcript, and structured metadata. The entire canvas is converted to PNG and written to the clipboard via `navigator.clipboard.write(ClipboardItem)`. Falls back to text-only if image clipboard fails.
- **Fixed annotation UI layout** (`App.tsx`): Switched outer container from Tailwind `h-screen` classes to inline styles with fixed dimensions (880x460px card). Sidebar is 250px fixed width. Screenshot area fills remaining space with `flex: 1`. This prevents the layout from stretching to fill a full-screen window.
- **Added clipboard image permission** (`capabilities/default.json`): Added `clipboard-manager:allow-write-image` and `clipboard-manager:allow-read-text`.
- **All styles converted to inline**: Moved from Tailwind classes to inline `style` props throughout the annotation UI to avoid class resolution issues and ensure reliable rendering.

### Potential concerns to address:

- **Composite image font rendering**: Canvas text rendering uses system fonts. If Verdana or Source Code Pro aren't installed, the fallback fonts may look different from the UI. Consider bundling fonts or using a simpler font stack for the canvas.
- **`navigator.clipboard.write` compatibility**: The web Clipboard API for images may not work in all Tauri webview configurations. May need to fall back to Tauri's `clipboard-manager:write-image` plugin instead.
- **SVG logo is 197KB**: The logo SVG has very complex paths (likely exported from a design tool). Could be optimized with SVGO to reduce size significantly.
- **Drawing tools still non-functional**: Canvas drawing not implemented — toolbar is visual only.
- **Voice transcription still stubbed**.

---

## Progress Update as of 2026-04-11 19:45 UTC

### Summary of changes since last update

Implemented working region selection capture flow, replaced app icons with the VisionPipe camera logo, added Tauri v2 capabilities permissions (root cause of most prior failures), embedded the logo as base64, added fullscreen capture command, and enabled devtools for debugging.

### Detail of changes made:

- **Added Tauri v2 capabilities/permissions** (`src-tauri/capabilities/default.json`): This was the root cause of the UI never responding to events. Tauri v2 requires explicit permission grants for every frontend API call. Without `core:event:allow-listen`, the `listen("start-capture", ...)` call was silently rejected, so the React app never received the hotkey event. Permissions now cover: core events, window management (show/hide/resize/position/fullscreen/always-on-top), clipboard, dialog, global-shortcut, and shell.
- **Rewrote capture flow** (`App.tsx`): Three-mode state machine: `idle` → `selecting` → `annotating`. Selection mode shows a dark semi-transparent overlay (`rgba(0,0,0,0.3)`) with crosshair cursor over the transparent Tauri window. User drags to select a region (blue border + dimension label). On mouse release, the overlay hides, waits 150ms, then captures just the selected region via Rust `take_screenshot` command. This avoids the VisionPipe window appearing in the screenshot.
- **Added fullscreen capture command** (`lib.rs`, `capture.rs`): New `capture_fullscreen` Rust command and `capture::capture_fullscreen()` function for future use. The hotkey handler now sizes the window to fill the monitor using physical pixel dimensions, sets it always-on-top, and emits a simple `"ready"` string payload (not the screenshot data — the original approach of sending megabytes of base64 through the event system was failing silently).
- **Replaced app icons** (`src-tauri/icons/`): Generated properly-sized RGBA PNGs (32x32, 128x128, 256x256) and a `.icns` bundle from `src/images/logo1.png` using Pillow and `iconutil`. The app now shows the camera logo in Cmd+Tab, dock, and system tray instead of a solid blue square.
- **Embedded logo as base64** (`App.tsx`): The sidebar logo now uses an inline base64 data URI (`LOGO_DATA_URI` constant) instead of importing the 814KB `logo1.png` file. Renders at 28x28px.
- **Enabled devtools** (`lib.rs`): `window.open_devtools()` called in debug builds so console errors are visible during development. This was critical for diagnosing the permissions issue.
- **Removed fragile focus fallback**: The `window.focus` event listener that was causing duplicate captures has been removed. Only the Tauri `start-capture` event triggers the flow now.

### Potential concerns to address:

- **Screenshot timing**: The 150ms delay between hiding the overlay and capturing the region is a heuristic. On slower machines or with window animation, the overlay might still be visible in the capture. May need to increase or use a more reliable signal.
- **DPR scaling for region capture**: The selection coordinates are in CSS pixels but `take_screenshot` expects physical pixels. The current `dpr` multiplication may not be accurate on all monitor configurations (e.g., non-integer scaling, multi-monitor with different DPRs).
- **Drawing tools still non-functional**: The toolbar buttons change `activeTool` state but no canvas drawing is implemented.
- **Voice transcription still stubbed**: Returns a hardcoded string.

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
