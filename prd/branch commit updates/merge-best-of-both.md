# Branch Progress: merge-best-of-both

This document tracks progress on the `merge-best-of-both` branch, which exists to integrate `initial-build-out` (onboarding flow + release pipeline) with `main`'s app-iteration work (CLI + MCP server + voice transcription) before merging back to `main`.

---

## Progress Update as of 2026-05-02 18:50 PDT — v0.3.0
*(Most recent updates at top)*

### Summary of changes since last update

First release build off the merged branch — confirms the integrated codebase compiles, signs, notarizes, and produces a working `.dmg` end-to-end. The release script's pre-flight workspace build correctly picked up the new `crates/` workspace + the `audio.rs` / `speech.rs` / `speech_bridge.m` ObjC bridge from main without any link-time issues. Bumped minor (0.2.7 → 0.3.0) for the substantial new surface area: voice recording + speech transcription + CLI + MCP server are all part of this build (even if the voice UI isn't wired yet).

### Detail of changes made:

- **Verified**: `pnpm tauri build --bundles app` succeeds against the merged Cargo workspace. `cargo check` for the new modules (`audio`, `speech` linking against `speech_bridge.m`) builds clean in release mode.
- **DMG**: `VisionPipe_0.3.0_aarch64.dmg` is signed (`Developer ID Application: DANIEL RUBEN ODIO (M7GJV3YJ26)`), notarized (Apple submission `0701a3a2-8685-4bf0-af15-e423c97ce57e` accepted), and stapled. `spctl -a -t open` reports `accepted, source=Notarized Developer ID`.
- **Onboarding card** now shows 5 permission rows on launch: Screen Recording, Automation: System Events, Accessibility, Microphone, Speech Recognition. The latter two are described as optional (only needed for voice notes).
- **Tauri commands** exposed: `take_screenshot`, `capture_fullscreen`, `get_metadata`, `save_and_copy_image`, `permissions::check_permissions`, `permissions::open_settings_pane`, `request_microphone_access`, `request_speech_recognition`, `start_recording`, `stop_recording`.
- **Release-script bug found**: the script assumed `prd/branch commit updates/<branch>.md` already exists for the current branch. On a fresh branch (this one) it didn't. Workaround for this release: created the log file by hand. **Follow-up: update `scripts/release.sh` to auto-create the file with a `# Branch Progress: <branch>` header + intro paragraph if missing.**

### Potential concerns to address:

- **Release script doesn't auto-create the per-branch progress log file** — caused this release to fail mid-script. Fix is small: in the prepend step, if `$PROGRESS_LOG` doesn't exist, create it with the standard header before the awk insert. File a small follow-up patch.
- **Voice recording UI is still not wired** — the Tauri commands exist and are exposed, but the annotation card's voice button is placeholder. Voice notes won't actually transcribe end-to-end until the React click handlers call `invoke("start_recording")` / `invoke("stop_recording")`.
- **5-permission onboarding card may overflow the 620×680 window** — we didn't bump dimensions. If the user reports clipping, grow the window or compact the rows.
- **CLI (`vp-cli`) and MCP server (`visionpipe-mcp`)** are part of the workspace but aren't being released as separate artifacts. They build alongside the desktop app but only the `.dmg` is published. Worth a follow-up to publish CLI binaries as part of the release process if they're meant for end users.
- **Duplicate code**: `src-tauri/src/{capture,metadata}.rs` and `crates/visionpipe-core/src/{capture,metadata}.rs` both exist. The Tauri app uses the local copies (which have the v0.2.7 battery-parser fix); the CLI/MCP use the shared crate. Worth porting our local fixes to the shared crate and deleting the duplicates.

---
