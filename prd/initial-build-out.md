# Branch Progress: initial-build-out

This document tracks progress on the `initial-build-out` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-05-02 14:10 PDT
*(Most recent updates at top)*

### Summary of changes since last update

Added a one-command release pipeline at `scripts/release.sh` that builds a polished, signed, notarized, stapled `.dmg` and copies it into the sibling `visionpipe-web` project's `public/downloads/` for deployment. Fixed the missing app icon on the bundled `.app` (the prior commit's `bundle` block overrode Tauri's default icon discovery without re-declaring `bundle.icon`). Documented the release workflow in `CLAUDE.md` so future sessions know to use the script instead of `pnpm tauri build`.

### Detail of changes made:

- **`scripts/release.sh`** (new, executable): Seven-step pipeline — build .app via Tauri (with `APPLE_ID`/`APPLE_PASSWORD` temporarily unset so Tauri skips its own flaky notarization polling), notarize and staple the .app via `ditto` + `notarytool submit --wait`, rebuild a polished .dmg around the stapled .app via `create-dmg` (drag-to-Applications layout with the .app icon on the left and an Applications symlink on the right), sign + notarize + staple the .dmg, verify with `spctl -a -t open --context context:primary-signature -vv`, and copy the result into `../visionpipe-web/public/downloads/` as both `VisionPipe-<version>.dmg` (versioned) and `VisionPipe.dmg` (stable "latest" link). Reads `.env.local` for credentials. Fails fast if any prerequisite is missing (cert in keychain, `create-dmg` installed, env vars set).
- **`src-tauri/tauri.conf.json`**: Added `bundle.icon` array referencing `icons/32x32.png`, `icons/128x128.png`, `icons/icon.icns`, `icons/icon.png`. Without this, the `.app` bundled with no icon and showed the default macOS placeholder. Tauri auto-detects icons by convention only when `bundle` is unset — declaring `bundle` requires also declaring `bundle.icon` explicitly.
- **`CLAUDE.md`**: Added a "Releasing a signed + notarized build" section documenting why `pnpm tauri build` should not be used directly for releases (Tauri's notarization polling fires before Apple responds), what `scripts/release.sh` does, and the prerequisites needed before running it (.env.local, Developer ID Application cert, Apple Developer ID G2 intermediate CA, `create-dmg`).
- **`create-dmg`** installed via `brew install create-dmg` (not in repo).
- **Final artifact verified**: `VisionPipe_0.1.0_aarch64.dmg`, 6.1 MB. Gatekeeper reports `accepted, source=Notarized Developer ID`. Camera icon shows correctly on the .app inside the DMG window.

### Potential concerns to address:

- **Apple Silicon only**: The DMG filename includes `aarch64`. Intel-Mac users won't be able to run this build. Estimated mid-2026 active install base is ~70-85% Apple Silicon (early-adopter audience likely higher), so shipping ARM-only for v0.1.0 is a reasonable trade-off. To add Intel support, change the `pnpm tauri build` line in `scripts/release.sh` to `pnpm tauri build --target universal-apple-darwin` — doubles compile time and adds ~5-10 MB to the DMG.
- **Hardcoded paths in `scripts/release.sh`**: `WEB_PROJECT="/Users/drodio/Projects/visionpipe-web"` is hardcoded to the user's machine. Anyone else cloning the repo would need to either change this or set it via env var. Consider parameterizing if the project gets contributors.
- **No `.dmg` background image**: `create-dmg` falls back to a plain white window with no arrow art pointing from the app to the Applications folder. Functional but not maximally polished. Add a `--background path/to/bg.png` flag (and a 660x400 background asset) when a designer is available.
- **App-specific password in `.env.local`**: The `notarytool` calls inline credentials from env vars. For a future CI release pipeline we should switch to `xcrun notarytool store-credentials` (which puts the credentials in the keychain as a named profile) and reference the profile by name. That avoids exposing the password in env-var-readable contexts.
- **Each release commit adds ~6 MB to `visionpipe-web` git history**: Acceptable for a small project but will compound. If shipping multiple releases per week, consider Git LFS for the .dmg files or moving downloads to S3/R2 with the website linking to external URLs.
- **`bundle.icon` change is a "fix-the-fix" pattern**: When I added the `bundle` block earlier today, I didn't realize it would override Tauri's default icon discovery. Worth a comment in `tauri.conf.json` noting that adding new `bundle` fields requires re-checking that all defaults are explicitly declared.

---

## Progress Update as of 2026-05-02 13:55 PDT
*(Most recent updates at top)*

### Summary of changes since last update

Set up Apple Developer ID code signing + notarization end-to-end. VisionPipe now builds as a signed and notarized `.dmg` that passes Gatekeeper with `source=Notarized Developer ID`. Renamed the bundle identifier from `com.visionpipe.app` (warned by Tauri due to `.app` suffix conflict) to `com.visionpipe.desktop`. Added the macOS bundle config to `tauri.conf.json`, an `entitlements.plist` for the hardened runtime, and worked around Tauri's flaky notarization polling by manually creating + signing + notarizing the `.dmg` via `notarytool --wait`.

### Detail of changes made:

- **`src-tauri/tauri.conf.json`**: Renamed `identifier` from `com.visionpipe.app` → `com.visionpipe.desktop` (Tauri warned the old one conflicts with the `.app` extension). Added a `bundle` section with `macOS.providerShortName: "M7GJV3YJ26"`, `macOS.entitlements: "entitlements.plist"`, `macOS.hardenedRuntime: true`, `macOS.minimumSystemVersion: "10.13"`. The `signingIdentity` is intentionally left null in the config — Tauri reads it from the `APPLE_SIGNING_IDENTITY` env var at build time.
- **`src-tauri/entitlements.plist`** (new): Hardened runtime entitlements. Includes `com.apple.security.cs.allow-jit` (WebView JS engine), `com.apple.security.cs.allow-unsigned-executable-memory`, `com.apple.security.cs.disable-library-validation` (Tauri loads dynamic libs), and `com.apple.security.automation.apple-events` (the metadata collector uses AppleScript to query browsers and the frontmost window).
- **`.env.local`** (gitignored, not in this commit): Holds `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD` (app-specific from appleid.apple.com), and `APPLE_SIGNING_IDENTITY`. All values now quoted so the file is shell-sourceable. **The build process requires sourcing this file**: `set -a && . ./.env.local && set +a && pnpm tauri build`.
- **Apple Developer ID Application certificate** (in keychain, not in repo): Generated via `openssl genrsa` + `openssl req -new` + `security import` after the GUI Keychain Access flow lost the original private key. The corresponding `.p12` (private key + cert bundled) and the raw `.pem` private key are stored in 1Password — losing those means re-doing the cert flow from scratch.
- **Apple Developer ID G2 intermediate CA** (in keychain): Downloaded from `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer` and imported. Without this, `codesign` reported `unable to build chain to self-signed root` and `find-identity` returned 0 valid identities even though both the cert and key were in the keychain. Modern macOS builds usually include this — this Mac apparently didn't.
- **Build pipeline confirmed working** (`src-tauri/target/release/bundle/dmg/VisionPipe_0.1.0_aarch64.dmg`, 5.5 MB): `spctl -a -t open -vv` reports `accepted, source=Notarized Developer ID`. `codesign --verify --deep --strict` reports `valid on disk, satisfies its Designated Requirement`. `xcrun stapler staple` succeeded for both the `.app` and the `.dmg`.

### Potential concerns to address:

- **Tauri's notarization polling times out**: The first `pnpm tauri build` failed with `NSURLErrorDomain Code=-1001 "The request timed out"` while waiting for Apple. Apple actually accepted the submission (verified via `xcrun notarytool info <id>`) — Tauri just gave up polling too early. Workaround in this commit: build the `.app` via Tauri (signing happens fine), then manually `hdiutil create` a `.dmg`, `codesign --timestamp` it, `xcrun notarytool submit ... --wait` (no client-side timeout), and `xcrun stapler staple`. **For future releases, consider scripting this end-to-end** (`scripts/build-release.sh`) instead of relying on Tauri's bundled notarization.
- **Bundle identifier rename invalidates prior installs**: The change from `com.visionpipe.app` to `com.visionpipe.desktop` means macOS treats this as a brand-new app — the old app's preferences, accessibility/screen-recording grants, and Login Items entry don't carry over. Acceptable here since v0.1.0 isn't shipped yet, but worth flagging for any future identifier changes.
- **Architecture-specific build**: The `.dmg` filename is `VisionPipe_0.1.0_aarch64.dmg` — Apple Silicon only. Intel users on macOS would need a separate `x86_64` build (or a universal binary built via `pnpm tauri build --target universal-apple-darwin`). Decide whether to ship a universal build or only Apple Silicon.
- **`.dmg` has no custom layout / background**: We used a plain `hdiutil create -format UDZO`, not Tauri's nicer create-dmg path with the drag-to-Applications layout. Functional but unpolished. When we automate the release script, switch back to `create-dmg` or use Tauri's bundler with the polling fix.
- **Notarytool credentials live in `.env.local`**: Sourcing the file exports the credentials into every subprocess Tauri spawns. Acceptable for local builds; for CI we'd want to use `notarytool store-credentials` to put them in the keychain instead, then reference by profile name.

---

## Progress Update as of 2026-05-02 12:15 PDT
*(Most recent updates at top)*

### Summary of changes since last update

Backfilled four progress entries covering the seven commits from 2026-04-11 through 2026-04-13 that landed without log updates, then set up automation so this never happens again: a project-scoped `CLAUDE.md` codifies the per-commit log workflow, a `.git/hooks/pre-commit` reminder warns when the log is unstaged, and a Claude Code `PostToolUse` hook on `Bash(git commit *)` injects a reminder when committing through Claude.

### Detail of changes made:

- **Backfilled entries** (`prd/initial-build-out.md`): Added 4 dated entries above the prior `2026-04-11 21:00 UTC` entry, covering `7f6b3b8` + `b9853c2` (region offset fixes), `07246fb` (Retina via `screencapture`), `274cf0e` + `8bfca6e` + `eab2aaa` (two-column panel + Finder-paste clipboard), and `436f703` (PRD reorg + icons + `Cargo.lock` cleanup). All new entries use Pacific time and the `*(Most recent updates at top)*` subtitle. Older entries left in their original UTC format — not retroactively rewritten.
- **Project-scoped `CLAUDE.md`** (new, project root): Codifies the per-commit log workflow: find `prd/<branch>.md`, prepend a new dated entry in the specified format, stage alongside code changes, and confirm to the user explicitly after committing. Project root location means it only applies to this project, not other Claude sessions (e.g., Storytell work).
- **Pre-commit reminder** (`.git/hooks/pre-commit`, executable, non-blocking): Prints a warning if `prd/<current-branch>.md` exists but isn't staged in the current commit. Always exits 0 — never blocks a commit. Catches the case where the user commits from terminal without Claude.
- **Claude Code `PostToolUse` hook** (`.claude/settings.json`): Filtered with `if: "Bash(git commit *)"`, outputs JSON with `hookSpecificOutput.additionalContext` reminding Claude to update the log when a commit lands through Claude. Validated by piping a synthetic Bash payload through `jq` — output is well-formed and the schema passes `jq -e` against `.hooks.PostToolUse[].hooks[].command`.
- **`.gitignore`** (`/.claude/settings.local.json` added): Per-user permissions file is now gitignored so personal skill grants don't leak into the repo. The team-shared `.claude/settings.json` remains tracked.

### Potential concerns to address:

- **Git hooks aren't versioned**: `.git/hooks/pre-commit` lives outside git's tracked tree. If the repo is cloned to another machine, the hook is gone. Worth wrapping in `husky` or a `prepare` script in `package.json` later if multiple machines need it.
- **Older entries still use UTC**: The pre-2026-04-13 entries were not retroactively rewritten to Pacific. Mixed timezones in the same log file is a minor inconsistency. Decide whether to convert them or accept the mixed format.
- **`PostToolUse` hook fires after the commit lands**: If Claude forgets to stage the log update, the hook reminds it post-fact and a follow-up commit (or `--amend` in some cases) is needed. The pre-commit hook is the better-timed reminder; the `PostToolUse` hook is a backstop.
- **Hook reload caveat**: The Claude Code settings watcher only observes directories that had a settings file at session start. For the current session this is fine (`.claude/settings.local.json` was already present), but if `.claude/` is created fresh in a future session, `/hooks` may need to be opened once to register the new file.

---

## Progress Update as of 2026-04-13 03:30 PDT
*(Most recent updates at top)*

### Summary of changes since last update

Reorganized PRD materials into the `prd/` folder, refreshed the app icons with the camera logo at proper sizes, added a no-background logo variant, and cleaned up `Cargo.lock` after the `screenshots` and `image` crates were removed in the prior Retina switch. Also dropped Tauri-generated schema files into the repo.

### Detail of changes made:

- **PRD reorganization** (`prd/`): Moved `PRD.md` → `prd/PRD.md`. Added `prd/PRD-1.0-041126.md` (449-line consolidated PRD). Brought in `PRD Brainstorming.pdf`, the Storytell marketing doc PDF, and the two Zight design mockup screenshots.
- **App icons refreshed** (`src-tauri/icons/`): Updated `32x32.png`, `128x128.png`, `256x256.png`, `icon.png`, and `icon.icns` to use the camera logo. Note `icon.icns` shrank from 1.65 MB to 1.25 MB and `icon.png` grew from 64 KB to 185 KB (now uses higher-quality source).
- **New logo variant** (`src/images/visionpipe-logo-no-background.png`): 746 KB transparent-background variant added; original `logo1.png` renamed to `visionpipe-logo.png` for clarity.
- **Cargo.lock sync** (`src-tauri/Cargo.lock`): 780 lines removed after dropping the `screenshots` and `image` crates (replaced by macOS native `screencapture` in `07246fb`). Net `Cargo.lock` shrank substantially.
- **Generated schemas committed** (`src-tauri/gen/schemas/`): `desktop-schema.json`, `macOS-schema.json`, `acl-manifests.json`, `capabilities.json` added. These are Tauri-generated capability schemas — usually `.gitignore`d, so worth checking whether this was intentional.

### Potential concerns to address:

- **Generated schemas in git**: `src-tauri/gen/schemas/*.json` are normally regenerated per build. Committing them risks merge conflicts and stale specs. Consider `.gitignore`-ing this directory.
- **Two logo PNGs now in tree**: `visionpipe-logo.png` (renamed from `logo1.png`) and `visionpipe-logo-no-background.png` plus the SVG. Consolidate or document which is canonical.
- **No PRD-1.0 vs PRD.md reconciliation**: Two PRD markdown files now coexist. Unclear which is current — needs a header note or one of them deleted.

---

## Progress Update as of 2026-04-12 17:30 PDT
*(Most recent updates at top)*

### Summary of changes since last update

Restructured the composite image panel into a two-column layout, switched annotation copy to LLM-prompt-injection-safe attribution-based phrasing, captured at native Retina resolution via the `-r` flag, and added Finder-paste support by saving the PNG to `~/Pictures/VisionPipe/` and putting both PNG bytes and a file URL on the macOS NSPasteboard.

### Detail of changes made:

- **Two-column composite panel** (`src/App.tsx`): Restructured the annotation panel below the screenshot into left/right columns — left has user attribution and the quoted user request, right has capture metadata. Same font size on both columns lets the text be larger overall.
- **Native Retina capture** (`src-tauri/src/capture.rs`): Added `-r` flag to `screencapture`, producing 3024×1964 instead of 1512×982 on 2x displays.
- **LLM-safe annotation format** (`src/App.tsx`): Rewrote the annotation payload to follow attribution-based phrasing ("Annotation by VisionPipe.ai", "Submitted by: username") rather than model-directed commands. Added `[User input, passed verbatim]` marker around the user's free text to make injection attempts visible. Removed the conditional fallback instruction strings.
- **Real captured-image dims** (`src/App.tsx`): Added `measureImageDims()` to report the actual captured image size and file bytes in the metadata block instead of estimating from selection coordinates.
- **PNG saved to disk + clipboard file URL** (commit `8bfca6e`, `src-tauri/src/lib.rs`): New `save_and_copy_image` Rust command writes the composite PNG to `~/Pictures/VisionPipe/<timestamp>.png` and uses NSPasteboard via JXA to put both PNG image data AND a file URL on the clipboard. The file URL is what makes Finder/Desktop paste actually create a file. Falls back to AppleScript clipboard if NSPasteboard fails.
- **Clipboard NSPasteboardItem fix** (commit `eab2aaa`, `src-tauri/src/lib.rs`): The first JXA implementation had two bugs — `clearContents` needed parens, and calling `writeObjects` after `setDataForType` cleared the PNG data. Rewrote to use a single `NSPasteboardItem` holding both PNG and file-URL representations, so the same paste yields a file in Finder and an image in image-aware apps. Stderr is now logged on failure.
- **Diagnostic capture-resolution logging** (`src/App.tsx`): Added console output of captured image dimensions to verify Retina mode is working.

### Potential concerns to address:

- **`~/Pictures/VisionPipe/` grows unbounded**: Every capture writes a timestamped PNG. No cleanup, no rotation, no settings UI to manage it. Will eventually fill the user's disk on heavy use.
- **JXA clipboard depends on JavaScript for Automation**: `osascript -l JavaScript` works on macOS 10.10+ but is a relatively niche path; if Apple deprecates JXA the clipboard write breaks. The AppleScript fallback covers image-only paste but not Finder paste.
- **NSPasteboard via JXA spawns a subprocess per capture**: Adds noticeable latency vs a native pasteboard call from Rust. Worth benchmarking.
- **Prompt-injection safety is best-effort**: The `[User input, passed verbatim]` marker and attribution phrasing reduce risk but a determined attacker can still embed model-directed text in a screenshot. Document the threat model.

---

## Progress Update as of 2026-04-11 21:00 PDT
*(Most recent updates at top)*

### Summary of changes since last update

Replaced the `screenshots` Rust crate with macOS-native `screencapture` CLI to get full-resolution Retina captures. The crate was always returning 1x images, making text in captures blurry on 2x displays.

### Detail of changes made:

- **Switch to `screencapture`** (`src-tauri/src/capture.rs`): Region capture now shells out to `/usr/sbin/screencapture` instead of calling `CGDisplayCreateImageForRect` via the `screenshots` crate. Native macOS CLI captures at the display's actual resolution, so Retina displays get 2x pixel data automatically.
- **Removed crate dependencies** (`src-tauri/Cargo.toml`): Dropped `screenshots` and the `image` crate (only used to encode the screenshots-crate output to PNG). Reduces Rust dependency surface significantly.

### Potential concerns to address:

- **Subprocess spawn cost**: `screencapture` is a fork+exec on every capture. Imperceptible to humans but slower than the in-process crate path. Acceptable for an interactive tool.
- **macOS-only**: This commit further entrenches macOS-only behavior. Cross-platform region capture will need a different code path (Windows: `Graphics.Capture` API; Linux: X11/Wayland-specific).
- **`screencapture` requires Screen Recording permission** in System Settings → Privacy & Security. Unprompted on first use but the user must grant it manually — needs onboarding UI.

---

## Progress Update as of 2026-04-11 14:30 PDT
*(Most recent updates at top)*

### Summary of changes since last update

Two fixes for the region-capture coordinate math, plus an Enter-key fullscreen capture path and a polished overlay prompt. The region offset was visibly wrong on Retina displays and was visibly wrong even on non-Retina until logical (point) coordinates were used end-to-end.

### Detail of changes made:

- **Add window outerPosition offset** (commit `7f6b3b8`, `src/App.tsx`): The `clientX`/`clientY` from mouse events are window-relative, but the Rust `take_screenshot` command expects screen-relative coordinates. Now adds the Tauri window's `outerPosition` to the selection rectangle before sending to Rust. Fixes capture being off by the window's position from the screen origin.
- **Use logical coordinates, not physical** (commit `b9853c2`, `src/App.tsx`): The `screenshots` crate's `CGDisplayCreateImageForRect` takes points (logical pixels), not physical pixels. We were multiplying by DPR, which doubled coordinates on Retina displays and shifted the captured region from the selection. Removed the DPR multiplication — CSS pixel values pass straight through.
- **Enter-key fullscreen capture** (`src-tauri/src/lib.rs`, `src/App.tsx`): Pressing Enter during selection mode triggers a full-screen capture instead of a region. Useful when you want everything on screen without dragging.
- **Polished overlay prompt** (`src/App.tsx`): Added a semi-transparent background pill behind the crosshair prompt. New copy: "Let's screenshot | llm it!" with a subtitle showing drag/enter/esc options. Instruction text changed to "parse the image".
- **Annotation panel font sizing** (`src/App.tsx`): Cap the annotation text panel at 20% of the captured image height with a binary-searched font size (min 8px) to fit. Prevents overflow on tall captures with long annotations.
- **Devtools disabled by default** (`src-tauri/src/lib.rs`): Devtools were shifting the webview offset, which compounded the coordinate bug. Disabled outside debug builds.

### Potential concerns to address:

- **DPR math removed entirely**: Now there's no DPR handling anywhere in the capture path. If a future change uses physical-pixel APIs (e.g., direct `CGImage`), this will quietly capture at the wrong size. Worth a comment in `App.tsx` explaining why DPR multiplication is intentionally absent.
- **Enter-key fullscreen doesn't show preview**: Pressing Enter immediately captures the whole screen with no confirmation. Easy to trigger accidentally. Consider a brief flash or a confirmation step.
- **Devtools disable applies to debug builds too?**: Verify the gating — earlier debug-only `open_devtools()` was load-bearing for diagnosing the permissions issue. If it's now off in debug too, that hurts dev velocity.

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
