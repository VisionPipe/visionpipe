# Branch Progress: app-iteration

This document tracks progress on the `app-iteration` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-04-14 12:00 UTC

### Summary of changes since last update

Added a three-layer architecture for CLI, MCP server, and Claude Code plugin integration. Extracted capture and metadata modules into a shared `visionpipe-core` library crate, built a `vp` CLI binary with window listing and per-app capture, created an MCP server for native Claude Code tool integration, and added a `/screenshot` command with auto-activating skill.

### Detail of changes made:

- **Cargo workspace restructure** (`Cargo.toml`): Created a root workspace manifest with four members: `crates/visionpipe-core`, `crates/vp-cli`, `crates/visionpipe-mcp`, and `src-tauri`. All crates build with a single `cargo build` command.
- **visionpipe-core library** (`crates/visionpipe-core/`): Extracted `capture.rs` and `metadata.rs` from `src-tauri/src/` into a shared library with zero Tauri dependencies. Added three new modules:
  - `window.rs` (72 lines): Lists visible macOS windows via JXA calling `CGWindowListCopyWindowInfo`, returning CGWindowIDs. Uses `ObjC.castRefToObject()` to bridge CFArray to NSArray (the `ObjC.deepUnwrap()` approach silently returns empty arrays). `find_window_id()` does case-insensitive substring matching on app names.
  - `save.rs` (38 lines): Decodes base64 data URI, saves PNG + JSON metadata to `~/Pictures/VisionPipe/` with timestamped filenames.
  - `capture.rs`: Added `capture_window(window_id: u32)` using `screencapture -l <CGWindowID>` for per-window capture. Made `png_file_to_data_uri` public.
- **vp CLI binary** (`crates/vp-cli/`, 86 lines): Uses `clap` derive for three subcommands:
  - `vp list [--json]`: Lists visible windows with ID, app name, and title
  - `vp capture [--app "Name"]`: Captures fullscreen or a specific app's window, saves to disk, prints file paths to stdout
  - `vp metadata`: Prints system/app metadata as JSON
- **MCP server** (`crates/visionpipe-mcp/`, 263 lines): JSON-RPC 2.0 over stdio, wraps the `vp` CLI via subprocess. Exposes three tools: `list_windows`, `capture_screenshot` (with optional `app_name` param), `get_metadata`. Looks for the `vp` binary next to itself first, then falls back to PATH.
- **Tauri app updated** (`src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`): Added `visionpipe-core` dependency. Replaced `mod capture; mod metadata;` with `use visionpipe_core::{capture, metadata};`.
- **Claude Code plugin** (`.claude/commands/screenshot.md`, `.claude/skills/visionpipe-capture/SKILL.md`): `/screenshot` slash command guides Claude through MCP capture workflow with CLI fallback. Skill auto-activates on phrases like "what's on my screen" or "take a screenshot".
- **MCP config** (`.mcp.json`): Registers `visionpipe-mcp` as a local stdio MCP server pointing to the release binary.

### Potential concerns to address:

- **Absolute path in `.mcp.json`**: The MCP config uses `/Users/drodio/visionpipe/target/release/visionpipe-mcp`. This must be updated if the project moves (planned move to `~/projects/visionpipe`). Should consider a relative path or dynamic resolution.
- **Screen recording permission for CLI**: The `vp` binary needs its own macOS Screen Recording permission grant, separate from `VisionPipe.app`. Users will see a system prompt on first use.
- **JXA window listing quirk**: `ObjC.deepUnwrap()` silently fails on `CGWindowListCopyWindowInfo` results — must use `ObjC.castRefToObject()` instead. This is documented in `window.rs` but could surprise future contributors.
- **MCP server not yet tested end-to-end**: The server compiles and the protocol implementation is correct, but it hasn't been tested in a live Claude Code session with the MCP tools appearing in the tool palette. Need to verify after project move and new session.
- **`target/` directory is untracked but large**: The Cargo build output is gitignored but the release binaries must be built before the MCP server works. No install script or Makefile exists yet.
- **No tests**: Still no unit or integration tests for any component.

---

## Progress Update as of 2026-04-14 18:30 UTC

### Summary of changes since last update

Major feature additions: onboarding flow with macOS permission checks, native voice recording and transcription via macOS Speech framework (replacing the stubbed Whisper approach), drawing tools implementation on the capture canvas, Rust workspace restructure into separate crates, and Claude Code automation infrastructure (CLAUDE.md, branch progress tracking, permissions settings).

### Detail of changes made:

- **Onboarding flow** (`src/App.tsx`): New `"onboarding"` app mode with a multi-step wizard (`ONBOARDING_STEPS` array) that walks users through granting Screen Recording, Accessibility, and Microphone permissions. Each step shows a description, checks the permission status via `check_permissions` Tauri command, and offers a button to open System Settings to the correct pane. Onboarding state persisted in `localStorage` (`visionpipe_onboarded`). The app now launches showing the onboarding flow on first run, then hides to idle after completion.
- **Permission checking system** (`src-tauri/src/lib.rs`): New `check_permissions` Tauri command that checks Screen Recording (via test `screencapture`), Accessibility (via AppleScript to System Events), Microphone (via native `AVCaptureDevice` bridge), and Speech Recognition (via native `SFSpeechRecognizer` bridge). Returns a `HashMap<String, bool>`. Also added `open_permission_settings` command that opens the correct `x-apple.systempreferences` URL for each permission type, and `request_microphone_access`/`request_speech_recognition` commands for triggering native permission prompts.
- **Native speech transcription** (`src-tauri/src/speech.rs`, `src-tauri/src/speech_bridge.m`): Replaced the stubbed Whisper/Candle approach with native macOS Speech framework via Objective-C FFI. `speech_bridge.m` (103 lines) implements C functions: `speech_auth_status`, `speech_request_auth`, `mic_auth_status`, `mic_request_auth`, and `speech_transcribe_file` which uses `SFSpeechRecognizer` with `SFSpeechURLRecognitionRequest` on a WAV file. The Rust side (`speech.rs`, 66 lines) provides safe wrappers. This approach means TCC permission prompts correctly show "VisionPipe" as the requesting app.
- **Audio recording** (`src-tauri/src/audio.rs`, 297 lines): New module using `cpal` for microphone capture. Records audio to a global `RecordingState` (using `OnceLock` + `AtomicBool` + `Mutex`), writes to WAV at `/tmp/visionpipe-recording.wav`, then calls `speech::transcribe_file` for on-device transcription. Exposed as `start_recording` and `stop_recording` Tauri commands.
- **Build system update** (`src-tauri/build.rs`): Now compiles `speech_bridge.m` via the `cc` crate with `-fobjc-arc` flag, and links `Speech` and `AVFoundation` frameworks.
- **Rust workspace crates** (`crates/`): Extracted shared logic into a workspace structure:
  - `visionpipe-core`: capture, metadata, save, window management modules
  - `visionpipe-mcp`: MCP server implementation (263 lines)
  - `vp-cli`: CLI tool (86 lines)
  - `lib.rs` now imports from `visionpipe_core` instead of local modules
- **Drawing tools** (`src/App.tsx`): `DrawnShape` interface defined with support for pen, rect, arrow, circle, and text tools with points array and color. Canvas drawing appears to be wired up (shape state management, tool selection).
- **Window management improvements** (`src-tauri/src/lib.rs`): Onboarding window launches at 600x480 logical size, centered, with focus. Shortcut handler unchanged but the invoke handler now registers 10 commands (up from 4).
- **Claude Code infrastructure**: Created `CLAUDE.md` with branch progress documentation instructions. Created `prd/branch commit updates/` folder with progress docs for both `initial-build-out` and `app-iteration` branches. Configured `~/.claude/settings.json` with comprehensive tool permissions. Moved `initial-build-out.md` from `prd/` root into the new subfolder.
- **Added `.mcp.json`**: MCP server configuration file (untracked).
- **Added `Info.plist`** (`src-tauri/Info.plist`): macOS app metadata (untracked).

### Potential concerns to address:

- **Candle/Whisper dependencies still in Cargo.toml**: The native Speech framework approach replaces Whisper, but the heavy Candle ML dependencies (`candle-core`, `candle-nn`, `candle-transformers`, `hf-hub`) may still be declared, adding significant compile time and binary size for unused code.
- **Audio recording uses global mutable state**: `OnceLock<RecordingState>` with `unsafe impl Send/Sync` is a pattern that could cause issues if recording commands are called concurrently from multiple frontend instances.
- **WAV file at fixed path**: Recording always writes to `/tmp/visionpipe-recording.wav`, which could conflict if multiple VisionPipe instances run simultaneously.
- **Objective-C bridge requires macOS**: The `speech_bridge.m` FFI approach is completely macOS-specific. No cross-platform fallback exists for speech recognition.
- **Permission check is expensive**: `check_permissions` runs `screencapture` and `osascript` subprocesses on every call. If called frequently (e.g., polling during onboarding), this could cause noticeable lag.
- **No error handling in onboarding**: If permission checks fail for unexpected reasons (not just "not granted"), the onboarding flow may get stuck.
- **`bypassPermissions` mode in settings**: The Claude Code settings use `bypassPermissions` (or `dontAsk`) which disables all safety prompts. This is convenient but could be risky if the project is shared with others.
- **Drawing tools completeness unknown**: The `DrawnShape` interface exists but the full canvas rendering/interaction implementation needs verification.
- **No tests**: Still no unit or integration tests for any component.

---

## Progress Update as of 2026-04-14 06:00 UTC

### Summary of changes since last update

This is the initial entry for the `app-iteration` branch, which was created from `initial-build-out`. The branch includes 5 commits focused on switching to macOS native `screencapture` for Retina-quality screenshots, redesigning the annotation UI to a two-column panel layout, saving captures to disk with Finder-compatible clipboard references, and consolidating PRD documents and icons.

### Detail of changes made:

- **Switched from `screenshots` crate to macOS `screencapture` CLI** (`src-tauri/src/capture.rs`): Replaced the Rust `screenshots` crate (which produced 72-DPI non-Retina images) with a shell call to `/usr/sbin/screencapture -R x,y,w,h -t png <tmpfile>`. This produces full Retina-resolution captures matching the display's native DPI. The `screenshots` crate dependency was removed from `Cargo.toml`, significantly shrinking `Cargo.lock` (780 lines removed).
- **Two-column annotation panel layout** (`src/App.tsx`): Redesigned the annotation UI from a single-panel layout to a two-column design — screenshot preview on the left, metadata/annotation controls on the right. This gives more screen real estate to the captured image.
- **Safer LLM annotation format** (`src/App.tsx`): Updated the annotation text format sent to the clipboard to be more structured and parseable by downstream LLMs.
- **Save PNG to ~/Pictures/VisionPipe/** (`src-tauri/src/lib.rs`): New `save_and_copy_image` Tauri command that writes PNG bytes to `~/Pictures/VisionPipe/VisionPipe_YYYY-MM-DD_HH-MM-SS.png` and sets the macOS pasteboard with both PNG data (for image-accepting apps) and a file URL (for Finder paste). Uses JXA (JavaScript for Automation) with `NSPasteboardItem` to hold multiple representations on a single pasteboard item.
- **Fixed clipboard file reference for Finder paste** (`src-tauri/src/lib.rs`): Rewrote the clipboard-setting code from AppleScript to JXA. The original AppleScript approach using `writeObjects` with a URL array conflicted with the PNG data representation. The JXA version uses a single `NSPasteboardItem` with both `NSPasteboardTypePNG` and `NSPasteboardTypeFileURL` types, so paste works in both Finder (pastes file) and Claude/Preview (pastes image).
- **Consolidated PRD documents** (`prd/`): Moved `PRD.md` into the `prd/` directory. Added `PRD-1.0-041126.md` (a versioned snapshot), `PRD Brainstorming.pdf`, Storytell marketing output PDF, and Zight design screenshots. Renamed logo files to `visionpipe-logo.png` and added a no-background variant.
- **Updated app icons** (`src-tauri/icons/`): Regenerated 128x128, 256x256, 32x32 PNGs and `icon.icns` with updated VisionPipe branding.
- **Added `chrono` dependency** (`Cargo.toml`): Used for timestamped filenames in the save-and-copy flow.

### Potential concerns to address:

- **macOS-only capture path**: The `screencapture` CLI is macOS-specific. No Windows or Linux capture implementation exists — `capture.rs` will need platform-specific alternatives for cross-platform support.
- **Coordinate system for capture**: The screencapture command uses logical (point) coordinates, not physical pixels. This was a source of bugs in earlier commits on `initial-build-out` (commits `b9853c2`, `7f6b3b8`). The current implementation should be verified on multi-monitor setups with different DPRs.
- **JXA clipboard approach is fragile**: The JXA script shells out to `osascript` and constructs an Objective-C bridge call. This could break with macOS sandbox restrictions or future OS changes. A native Rust NSPasteboard binding would be more robust.
- **No cleanup of saved PNGs**: Files accumulate in `~/Pictures/VisionPipe/` with no automatic cleanup, size limit, or management UI.
- **Drawing tools still non-functional**: Canvas drawing toolbar is visual only — no drawing implementation exists.
- **Voice transcription still stubbed**: Whisper/Candle dependencies exist in Cargo.toml but no transcription code is wired up.
- **No tests**: No unit or integration tests for any component.
