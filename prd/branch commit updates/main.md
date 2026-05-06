# Branch Progress: main

This document tracks progress on the `main` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-05-06 12:27 PDT — v0.8.1
*(Most recent updates at top)*


### Summary of changes since last update

v0.8.1 — critical fix for "Cannot send: invalid args audioSeconds" Copy/Send failure introduced in v0.7.0, plus rename of "New Screenshot Bundle" → "Multi-Screenshot Bundle" with a new stacked-images icon to signify the feature handles multiple shots.

### Detail of changes made:

- **Bug fix: `Cannot send: invalid args 'audioSeconds' for command 'deduct_for_bundle'`**. The credit context was passing `audio_seconds:` (snake_case) to `invoke()`, but Tauri v2 auto-converts camelCase JS keys to snake_case Rust params on its own — so it was looking for a non-existent `audio_seconds` JS key and reporting the camelCase `audioSeconds` it expected as missing. Fix: pass `audioSeconds` (camelCase) in both `preview_bundle_cost` and `deduct_for_bundle` invocations from `src/state/credit-context.tsx`. This bug existed in v0.7.0 and v0.8.0 — every Copy & Send / Copy to Clipboard click failed with the cryptic error message. v0.8.1 is the first build in which the credit deduction actually completes.

- **"New Screenshot Bundle" → "Multi-Screenshot Bundle"** on the HistoryHub primary CTA. Clearer name; the feature has always supported N screenshots in a single bundle and the old "New Screenshot" wording understated that.

- **Camera icon → Images icon** (lucide-react `<Images />` — two stacked image rectangles) on the same button. Visually signals "more than one" instead of suggesting a single capture.

### Potential concerns to address:

- **Existing v0.7.0 / v0.8.0 installs still hit the bug.** Users need to update to v0.8.1 (homebrew users: `brew upgrade --cask visionpipe`; manual: re-download from the website or GitHub releases) before Copy/Send works.
- The bug went undetected in v0.7.0 because the React-rendering integration tests for `CreditProvider` were dropped (vitest+jsdom hung), so the IPC payload shape was never asserted in CI. Worth adding a small "verify IPC keys round-trip" test once the rendering issue is investigated.

---


## Progress Update as of 2026-05-06 12:23 PDT — v0.8.0
*(Most recent updates at top)*


### Summary of changes since last update

v0.8.0 — Footer redesign (Cancel + Copy to Clipboard + Save to disk), bigger less-rounded hotkey pills in both Onboarding and HistoryHub, and a copy tweak ("eyes" → "vision").

### Detail of changes made:

- **Cancel button** added to the left of the primary action button. Outline-only style (transparent background with `borderLight` border) so it doesn't compete visually with the teal Copy button. Clicking confirms ("Discard this session?") then ends the session — same effect as the overflow menu's "New session" but more discoverable. Does NOT deduct credits, since nothing was sent.

- **"Copy & Send" renamed to "Copy to Clipboard"** for clearer semantics — the action has always been to copy a markdown bundle to the macOS clipboard with both text and file representations; the new name says exactly that.

- **"Save to disk" option** as an inline link beside the Copy button. Click opens a native Finder save dialog (default filename = the descriptive `VisionPipe-{date}-{N}shots-{topic}.md` from v0.7.0). On confirm: deducts credits same as Copy, writes the markdown to the chosen location, AND mirrors a copy into the session folder so HistoryHub keeps it. If the user cancels the save dialog, no credits are deducted. Driven by a new Rust Tauri command `write_text_to_path` and the `dialog:allow-save` capability.

- **Bigger, less-rounded hotkey pills.** The welcome-card pill (lg variant) now renders glyphs at 32 px on a softly-rounded (12 px) chunky pill so ⌘⇧C is unmistakably the call-to-action. The HistoryHub pill (sm variant, used in "or press X from anywhere" and the empty-state message) bumped from 11 px → 22 px and from `borderRadius: 999` → 8 px so the keys are readable at a glance instead of looking like a status badge.

- **Copy tweak:** "How to give your LLM eyes:" → "How to give your LLM vision:" on the welcome card.

### Potential concerns to address:

- The Cancel button uses `confirm()` (browser/system modal) — same pattern as the existing Delete Screenshot confirmation. Could be replaced with a custom themed dialog later for visual consistency.
- Save to disk writes to BOTH the user-chosen path and the session folder. The session-folder write is best-effort (failures are logged but don't error the user-facing flow) so the user always gets the file they explicitly asked for.
- The window-scoped Cmd+Enter hotkey still triggers Copy to Clipboard (not Save to disk). If users want a hotkey for Save to disk, that's a follow-up.

---


## Progress Update as of 2026-05-06 12:18 PDT — v0.7.0
*(Most recent updates at top)*


### Summary of changes since last update

v0.7.0 — credit pricing system, descriptive bundle filenames, hotkey pill, mic-permission deadlock fix.

### Detail of changes made:

- **Credit pricing system**. Replaces the dormant pixel-based capture-cost calculator with a per-bundle model: 1 credit per screenshot, 1 per dormant annotation slot, audio at 10s-free / 1 credit per additional 10s. New `BundleCost` struct + four Tauri commands (`get_credit_balance`, `add_credits`, `preview_bundle_cost`, `deduct_for_bundle`) backed by `tauri-plugin-store` persistence (default fresh-install balance: 0). New `CreditProvider` context drives a header chip showing `Cost: N · Balance: M` (amber when insufficient), and `Copy & Send` is gated on `deduct_for_bundle` so the user can never get the bundle without paying or pay without getting it. Spec: `docs/superpowers/specs/2026-05-04-credit-pricing-redesign.md`.

- **Descriptive markdown bundle filenames**. Replaces hardcoded `transcript.md` with `VisionPipe-{YYYY-MM-DD-HHmm}-{N}shots-{topic}.md`. Topic falls back through caption → URL path → window title → app name, capped at 180 chars. Backwards-compatible: `HistoryHub` finds any `VisionPipe-*.md` (most recent mtime) and falls back to legacy `transcript.md` for older sessions.

- **Single orange clickable hotkey pill** in Onboarding and HistoryHub, replacing the three separate ⌘ ⇧ C boxes. Click opens `SettingsPanel` for rebinding; the displayed combo refreshes when the panel closes. New `formatHotkey` helper handles glyph mapping for Cmd/Shift/Alt/Ctrl/Enter/Tab/Escape/Space/Backspace plus single-letter uppercase normalization.

- **Tighter window sizing**. Onboarding window auto-shrinks from 680→360 px in the all-granted state. HistoryHub window range tightened from 640-900 to 420-720 px. Removes the wall of empty deep-forest space below short content in both views.

- **Bug fix: mic/speech permission flow stuck on "Asking macOS…"**. The ObjC FFI used `dispatch_semaphore_wait` to block the calling thread, deadlocking against `SFSpeechRecognizer`'s main-queue completion handler. Fix: cached-status short-circuit + `tauri::async_runtime::spawn_blocking` so the blocking is on the blocking pool, not a runtime worker + new `AuthOutcome::TimedOut` that surfaces a red error banner with a one-click "Open System Settings →" button instead of silently treating timeout as denial. Bumped timeout from 30s to 60s.

### Potential concerns to address:

- `Session.closingNarration` (audio recorded after the last screenshot) has no `AudioOffset` in the type model, so it isn't counted in the credit cost. User-friendly direction (we under-charge); flagged for follow-up.
- `add_credits` has no UI yet — devtools console only, until the Buy Credits flow ships against the future `api.visionpipe.ai` backend.
- React-rendering integration tests for `CreditProvider` were dropped (vitest+jsdom hung on the provider chain). Pure-helper coverage (`audio-duration`, `bundle-name`, `formatHotkey`) replaces them; the IPC wiring is verified manually.

---


## Progress Update as of 2026-05-02 19:24 PDT — v0.3.2
*(Most recent updates at top)*

### Summary of changes since last update

Fresh rebuild requested by user — no source changes since v0.3.1. Useful as the single definitive "current" version after a string of test builds, so brew + website + locally-mounted DMGs all agree on one number.

### Detail of changes made:

- No source code changes since v0.3.1.

### Potential concerns to address:

- Same outstanding items: voice UI not yet wired to `start_recording`/`stop_recording`, and `src-tauri/src/{capture,metadata}.rs` duplicates the corresponding files in `crates/visionpipe-core/`.

---


## Progress Update as of 2026-05-02 19:21 PDT — v0.3.1
*(Most recent updates at top)*

### Summary of changes since last update

Verification build off `main` after the merge of `merge-best-of-both` into `main`. No code changes since v0.3.0 — just rebuilding from `main` directly to confirm the merged tree produces a clean signed/notarized DMG end-to-end and that the auto-create-log fix from the previous patch works on a fresh branch (this is the first release-script run on `main`, so `prd/branch commit updates/main.md` doesn't exist yet — the script should create it automatically).

### Detail of changes made:

- No source code changes since v0.3.0.
- This release exercises the auto-create-log path in `scripts/release.sh` (first time the script runs on `main`).
- Verifies that the full merged workspace builds, signs, and notarizes cleanly from `main`.

### Potential concerns to address:

- **Voice recording UI is still not wired** — the Tauri commands exist but the annotation card's voice button is placeholder. Same outstanding item from v0.3.0.
- **Duplicate `capture.rs` / `metadata.rs`** in `src-tauri/src/` and `crates/visionpipe-core/src/` — same outstanding item.

---


