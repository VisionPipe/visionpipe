# Branch Progress: main

This document tracks progress on the `main` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-05-06 20:33 PDT — v0.10.1
*(Most recent updates at top)*


### Summary of changes since last update

v0.10.1 — after a successful Copy to Clipboard or Save to Disk, VisionPipe now drops you back to HistoryHub so you see your just-shipped bundle in the list. Previously you stayed on the active SessionWindow with the toast as the only confirmation; the bundle was already done but the UI didn't say so unambiguously.

### Detail of changes made:

- **`src/components/SessionWindow.tsx`**: new `endSessionAfterSuccess` helper called after either Copy to Clipboard or Save to Disk completes successfully. 1.5 second `setTimeout` so the success toast is readable before SessionWindow unmounts (toast lives inside SessionWindow; on END_SESSION it goes with the rest of the tree). The toast text now ends with "Returning to history…" so the user knows what's about to happen instead of being surprised by the navigation.
- Both the primary Copy success path and the text-only fallback path get the same auto-return treatment.
- Save to Disk now also auto-returns to history on success (same UX consistency).
- Failure paths (insufficient credits, save dialog cancelled, clipboard write failed entirely) still leave the user on SessionWindow so they can retry.

### Potential concerns to address:

- 1.5 s might feel rushed for users who want to read the full toast text. If feedback comes in, easy to tune (or replace with an explicit "✓ Sent" interstitial).
- The toast text references the saved-to-folder path, which the user no longer sees because they're navigating away. The toast still reads in 1.5 s; the path is also captured in the session folder if they ever go back. Acceptable.
- `--skip-web` again because `visionpipe-web` is still on `update-website-copy-2026-05-04`.

---


## Progress Update as of 2026-05-06 20:30 PDT — v0.10.1 prep (auto-return-to-history on success)

### Summary of changes since last update
After Copy to Clipboard or Save to Disk succeeds, the app now drops back to HistoryHub instead of leaving the user on the SessionWindow. 1.5 s delay so the success toast is readable. Failure paths still keep the user on SessionWindow so they can retry.

### Detail of changes made:
- **`src/components/SessionWindow.tsx`**: added `endSessionAfterSuccess` helper that wraps the existing END_SESSION + stop_recording + refresh_tray dance in a `setTimeout(1500)`. Called from the primary Copy success path, the text-only fallback path, and the Save-to-disk success path. Toast text amended to include "Returning to history…" so the navigation isn't a surprise.

### Potential concerns to address:
- 1.5 s might be too short for slow readers. If users complain, easy to bump or replace with an explicit "✓ Sent" interstitial.
- Failure paths (insufficient credits, save dialog cancelled) still keep the user on SessionWindow, intentionally — they'd want to retry from where they are.

---

## Progress Update as of 2026-05-06 17:09 PDT — v0.10.0
*(Most recent updates at top)*


### Summary of changes since last update

v0.10.0 — audio recording redesigned to be **fully on-demand per screenshot**, not session-wide. The app no longer records continuously when it's open; each screenshot has its own Record / Pause / Resume controls under its Narration label. The Header mic button + the "Recording · Local-only" status pill are gone. The pop-up Re-record modal is gone. HistoryHub header gets the bold + orange-pipe brand and a version badge top-right.

### Detail of changes made:

#### Audio recording redesign (the big one)

- **No more session-wide / auto-recording.** The Header mic button is removed. App.tsx no longer auto-starts a cpal recording on first capture or auto-stops + transcribes on each subsequent capture boundary. Sessions are silent by default until the user explicitly clicks Record on a screenshot.

- **Per-screenshot RecordingControls component** (`src/components/RecordingControls.tsx`) lives between each card's "Narration" label and the transcript textarea. State machine: idle → `[🎙 Record audio]`; recording → `[🔴 0:14 Recording] [Pause]`; paused → `[🔴 0:14 Paused] [Resume]`. Click the red-dot pill in either active state to stop, transcribe, and APPEND the transcript to the screenshot's existing transcriptSegment (Q2=B from the 2026-05-06 design call). Click Pause to stop the chunk and park its transcribed text in an internal accumulator; Resume kicks off a fresh start_recording (Q1=B "stop-and-restart" pause — simpler than a true streaming pause, with virtually identical UX).

- **`src/state/recording-context.tsx`** owns the state machine. cpal is a singleton — only one active recording at a time. The context tracks `activeSeq` (which screenshot's controls show the recording state), `mode`, and `elapsedSec`. Clicking Record on a different card while one is already active auto-stops + finalises the first one before starting the new one. A `busyRef` guards against double-click double-fire.

- **Mic onboarding modal** (Mic + Speech Recognition explainer) is now triggered by the FIRST Record click on any card, gated by `localStorage.vp-mic-onboarded`. Previously the trigger lived on the now-deleted Header mic button. After grant, user clicks Record again to actually begin (no auto-start — matches the manual model).

- **Deleted files:** `src/components/ReRecordModal.tsx` (popup re-record flow superseded), `src/state/mic-context.tsx` (master-recorder lifecycle no longer needed). Header's `NetworkState` type export is removed.

- **`src/App.tsx`** is meaningfully smaller — dropped `initSessionAudio`, `stopAndTranscribeCurrentSegment`, `onToggleMic`, `clearRecorder`, `closeDeepgram`, the `MicProvider` wrap, the `vp-rerecord-segment` hotkey dispatch, and the master-recorder beforeunload drain. Replaced beforeunload drain with a best-effort `invoke("stop_recording")` so a stray cpal stream doesn't outlive the app.

- **Touched callers** that were passing `onRequestRerecord`: `InterleavedView.tsx`, `SplitView.tsx` — prop dropped. `SessionWindow.tsx` no longer manages `rerecordSeq` state, no longer imports `useMic` / `ReRecordModal`. `Header.tsx` Props simplified (no mic props).

#### HistoryHub header polish

- **`src/components/HistoryHub.tsx`** title bar: `Vision|Pipe — History` reformatted with bold + orange `|` (`Vision<span style={{ color: amber }}>|</span>Pipe`) on the left, and a `<VersionBadge />` in the top-right corner — matches the Onboarding card's chrome layout.

### Potential concerns to address:

- The cpal start/stop boundary at every Pause/Resume can produce a tiny transcription glitch (e.g., SFSpeechRecognizer might re-capitalise the first word of chunk 2). Acceptable trade-off vs. the implementation cost of a true streaming pause.
- The session-reducer still has `APPEND_TO_ACTIVE_SEGMENT` and `APPEND_TO_CLOSING_NARRATION` actions that no caller dispatches. Cleanup pass for v0.11.x.
- The `Screenshot` type still has `audioOffset` and `reRecordedAudio` fields tied to the old master-audio-and-slicing model. Vestigial; existing sessions continue to display fine. Removing them would be a breaking type change — defer.
- The "rerecord active segment" hotkey is still in `hotkey_config.rs` and shows up in Settings. The Settings UI lets you rebind it but the rebound combo will fire to nothing. Will quietly remove from the hotkey config + Settings rows in a follow-up; non-blocking for v0.10.0.
- `--skip-web` again because visionpipe-web is still on `update-website-copy-2026-05-04`.

---


## Progress Update as of 2026-05-06 17:05 PDT — v0.10.0 prep (audio redesign + HistoryHub header)

### Summary of changes since last update
v0.10.0 audio recording redesign: from "always-on master recorder + per-screenshot slicing" to "per-screenshot on-demand record/pause/resume with a Record button under each Narration label." Header mic button + NetworkState pill removed. ReRecordModal deleted. Plus HistoryHub header now shows bold-brand + orange-pipe + version badge.

### Detail of changes made:
- **`src/state/recording-context.tsx`** (new): owns the per-screenshot recording state machine (`activeSeq`, `mode`, `elapsedSec`). cpal singleton means only one card can be recording at a time; clicking Record on a different card stops + finalises the first one. Pause/Resume = stop-and-restart (Q1=B): Pause stops the cpal stream + transcribes + parks text in an accumulator; Resume calls start_recording fresh. Stop drains accumulator into the screenshot's transcriptSegment via APPEND (Q2=B). `busyRef` guards against double-fire. Mic onboarding (vp-mic-onboarded localStorage flag) gates the first Record click.
- **`src/components/RecordingControls.tsx`** (new): three visual states — `[🎙 Record audio]` (idle), `[🔴 0:14 Recording] [Pause]` (recording), `[🔴 0:14 Paused] [Resume]` (paused). Whole record-state pill is one click target that stops/finalises. Renders inside ScreenshotCard between the "Narration" label and the transcript textarea.
- **`src/App.tsx`**: dropped initSessionAudio, stopAndTranscribeCurrentSegment, onToggleMic, clearRecorder, closeDeepgram, MicProvider wrap, vp-rerecord-segment hotkey dispatch, and the master-recorder beforeunload drain. Replaced beforeunload drain with best-effort `invoke("stop_recording")`. Wrapped inner tree in `<RecordingProvider>`. ~80 lines smaller.
- **`src/components/Header.tsx`**: removed mic button + NetworkState pill + dotColor/networkLabel helpers. Props simplified to just `onToggleViewMode`, `onOpenSettings`, `onNewSession`, `onOpenSessionFolder`. Middle column now just renders CreditChip.
- **`src/components/SessionWindow.tsx`**: dropped useMic + rerecordSeq state + ReRecordModal import + requestRerecord handler + the vp-rerecord-segment listener. onCancel + onNewSession now best-effort `invoke("stop_recording")` instead of mic.clearRecorder/closeDeepgram.
- **`src/components/InterleavedView.tsx` + `SplitView.tsx`**: dropped `onRequestRerecord` prop.
- **`src/components/ScreenshotCard.tsx`**: replaced the "Re-record" button with `<RecordingControls seq={...} />`. Dropped the `onRequestRerecord` prop. Layout: Narration label, controls, then textarea (controls now flow vertically rather than sit beside the label).
- **Deleted**: `src/components/ReRecordModal.tsx`, `src/state/mic-context.tsx`.
- **`src/components/HistoryHub.tsx`**: title bar now has bold-brand with orange-pipe (`Vision<span color=amber>|</span>Pipe`) on the left + `<VersionBadge />` top-right. Matches Onboarding card chrome layout.

### Verified:
- `cargo build -p visionpipe`: clean.
- `tsc --noEmit`: exit 0.
- `vitest run`: 7 files, 47 tests, all pass.

### Potential concerns to address:
- cpal start/stop boundary at each Pause/Resume can produce a tiny transcription glitch (e.g., re-capitalising first word of chunk 2). Acceptable trade-off vs. true streaming pause.
- Session-reducer still has `APPEND_TO_ACTIVE_SEGMENT` / `APPEND_TO_CLOSING_NARRATION` actions with no caller. Cleanup follow-up.
- `Screenshot.audioOffset` + `reRecordedAudio` are vestigial in the new model. Existing sessions still display fine.
- "Rerecord active segment" hotkey still in hotkey_config.rs + Settings rows but no handler dispatches. Non-blocking; follow-up.

---

## Progress Update as of 2026-05-06 15:12 PDT — v0.9.5
*(Most recent updates at top)*


### Summary of changes since last update

v0.9.5 — fixes two bugs that turned up in a user diagnostic-bundle dump: (1) `window.confirm()` calls have been silently failing since v0.8.0 because the dialog plugin's `confirm` ACL wasn't allowed (the Cancel button + Delete Screenshot prompts never appeared), (2) opening Settings then closing it could leave the app with NO global hotkeys until restart because a single failed re-registration aborted the whole sequence.

### Detail of changes made:

- **`src-tauri/capabilities/default.json`**: added `dialog:allow-confirm`, `dialog:allow-message`, `dialog:allow-ask` alongside the existing `dialog:allow-save`. Tauri 2 routes `window.confirm()` / `window.alert()` / `window.prompt()` through `plugin:dialog` for native-feel dialogs; without the corresponding `allow-*` capabilities each call rejected with `Command plugin:dialog|confirm not allowed by ACL`. Visible in the user's log as 4 separate failures across the v0.8.x → v0.9.4 lifetime, each one a Cancel-session or Delete-Screenshot click that should have prompted but did nothing. The four allow-* together cover all three browser-builtin dialog APIs.

- **`src-tauri/src/lib.rs register_global_shortcuts`**: was strict-fail — the first `on_shortcut` call that errored bailed the entire function, leaving the app with NO global hotkeys until restart. The user's log captured this happening to Cmd+Shift+O after a Settings rebind: pause_global_shortcuts unregistered everything, resume_global_shortcuts retried registering Cmd+Shift+O first, that errored ("RegisterEventHotKey failed for KeyO" — likely transient OS-level state from the unregister), and the capture combo (Cmd+Shift+C) + scroll combo (Cmd+Shift+S) were never even attempted. Now each of the three registrations is independent: a failure on one logs a warning + continues to the next. Plus a defensive `unregister_all()` at the start of register_global_shortcuts to guard against partial-pause ghost state.

### Potential concerns to address:

- The defensive `unregister_all()` runs even on first-launch setup() where it's a no-op. Cheap; not worth gating.
- If Cmd+Shift+O fails to register because some OTHER app has claimed it, the user can no longer use that shortcut to re-open the welcome card. Tray menu → "Show Onboarding…" is the alternative; surface this in a future release if it becomes a frequent issue.
- We're not yet retrying with backoff after a failed register. Adding that would handle the transient-OS-state case properly. For now, the user can close + reopen Settings to retry; if the failure is persistent (another app holds the combo), no amount of retry helps.
- `--skip-web` again because `visionpipe-web` is still on `update-website-copy-2026-05-04`.

---


## Progress Update as of 2026-05-06 14:50 PDT — capabilities.json schema regen for v0.9.5

### Summary of changes since last update
Auto-regenerated `src-tauri/gen/schemas/capabilities.json` after the dialog-ACL additions in commit `039b3f0`. Tauri's build script regenerates this schema file whenever `capabilities/default.json` changes; it had been regenerated locally but not committed, which blocked `release.sh`'s preflight (clean-tree check).

### Detail of changes made:
- **`src-tauri/gen/schemas/capabilities.json`**: regenerated to reflect the three new dialog permissions (`dialog:allow-confirm`, `dialog:allow-message`, `dialog:allow-ask`). Auto-generated; human-irrelevant; committed only because preflight requires a clean tree.

### Potential concerns to address:
- This regen-then-commit dance is recurring whenever capabilities change. Could add `gen/schemas/` to a special-cased preflight skip OR auto-commit the regen as part of release.sh. Flagging for future polish; not worth changing right now.

---

## Progress Update as of 2026-05-06 14:40 PDT — diagnostic-bundle bugs (dialog ACL + hotkey re-register)

### Summary of changes since last update
User shared a `visionpipe-diagnostic-*.zip` from the in-app "Save diagnostic bundle" action. The log surfaced two real bugs invisible from outside: (1) every `window.confirm()` since v0.8.0 has been failing silently because the dialog plugin's `confirm` ACL wasn't on the capabilities list, (2) `register_global_shortcuts` was strict-fail — a single hotkey-registration error after a Settings pause/resume cycle left the app with NO global hotkeys until restart. Both fixed for v0.9.5.

### Detail of changes made:
- **`src-tauri/capabilities/default.json`**: added `dialog:allow-confirm`, `dialog:allow-message`, `dialog:allow-ask` next to the existing `dialog:allow-save`. Tauri 2 routes `window.confirm()` / `window.alert()` / `window.prompt()` through `plugin:dialog` — without these capabilities each call was failing with `Command plugin:dialog|confirm not allowed by ACL`. The Cancel button (Footer) and Delete Screenshot button were the visible casualties: clicking them did nothing because the confirm dialog couldn't open.
- **`src-tauri/src/lib.rs register_global_shortcuts`**: refactored from strict-fail (first `on_shortcut` error aborts everything) to best-effort per shortcut. Each of the three registrations (Cmd+Shift+O onboarding, configurable capture combo, Cmd+Shift+S scrolling) is now wrapped in `if let Err(e) = ... { log::warn!(...); }` so a failure on one doesn't kill the others. Also added a defensive `unregister_all()` at the top to guard against ghost OS-level state from a partial pause.

### Potential concerns to address:
- If a user's Cmd+Shift+O is permanently claimed by another app, the welcome-card shortcut is dead — tray-menu "Show Onboarding…" is the workaround. Could surface in-app if it becomes a frequent issue.
- We don't retry after a failed register. The diagnostic-log failure looked transient (next time the user pressed Cmd+Shift+C it worked again after restart); adding a backoff retry would catch that class.
- The dialog capability additions are global (whole window). If a future capability scope lets us narrow per-pane, worth doing — for now, "all dialogs allowed" is fine.

---

## Progress Update as of 2026-05-06 14:36 PDT — v0.9.4
*(Most recent updates at top)*


### Summary of changes since last update

v0.9.4 — capture is ~10× faster (no more 20-second stall after taking a screenshot), plus the "Drag a region" pill is now bright amber so it actually catches the eye against busy desktops.

### Detail of changes made:

- **Capture flow no longer round-trips PNG bytes through JSON IPC.** The pre-v0.9.4 path was: Rust captures → reads bytes → base64 → returns 11MB string → JS atob() → Uint8Array → `Array.from(uint8array)` (~32MB JSON array of decimal numbers) → IPC back to Rust → Rust JSON-deserialises → writes to disk. For a Retina region capture (~5-15 MB) that round-trip cost ~10-20 seconds end-to-end. Now `take_screenshot` / `take_scrolling_screenshot` / `capture_fullscreen` all return the temp PNG path directly, and a new `move_capture_to_session` Tauri command renames the file from `/tmp` into the session folder under its canonical name. Bytes never cross the IPC boundary. Should bring post-capture stall from 20 s → ~1 s.

- **`SelectionOverlay` "Drag a region" pill: amber + drop shadow + heavier weight.** Was previously dark-green-on-busy-desktops, easy to miss. Now `rgba(212, 136, 42, 0.95)` (amber) with a `0 4px 14px rgba(0,0,0,0.4)` shadow and `font-weight: 700` so the affordance is unambiguous. Scrolling-capture mode already used amber; the regular mode now matches.

### Potential concerns to address:

- **Cross-volume rename fallback**: `move_capture_to_session` first tries `std::fs::rename` (intra-volume, atomic, near-instant); if that fails (rare — only happens when `/tmp` is on a different filesystem than `~/Pictures`), falls back to `copy + delete`. Slightly slower but still much faster than the old IPC round-trip.

- **`/tmp` cleanup**: each capture writes `/tmp/visionpipe-capture-<nanos>.png`. The successful path moves the file out of `/tmp` immediately. If JS crashes between the capture finishing and the move call, an orphan PNG could linger. macOS clears `/tmp` on reboot anyway; flagging for visibility.

- **Two smaller `Array.from(bytes)` paths NOT changed**: `state/persistence.ts` writes `transcript.json` (~10-50 KB) and the SessionWindow fallback writes the markdown body (~1-50 KB). Both are small enough that the IPC overhead is invisible. Refactoring them isn't urgent.

---


## Progress Update as of 2026-05-06 14:35 PDT — v0.9.4 prep (capture speed + pill + chip text)

### Summary of changes since last update
Three fixes destined for v0.9.4: (1) capture flow no longer round-trips PNG bytes through JSON IPC — should eliminate the 20-second post-capture stall reported by the user; (2) "Drag a region" pill is now bright amber with a drop shadow so it catches the eye against busy desktops; (3) credit chip in the Header now reads "Cost: 1 credit · Balance: 1,000 credits" with proper singular/plural and thousands separator (was "1 cr · 1000 cr").

### Detail of changes made:
- **Capture-speed fix**: pre-v0.9.4, `take_screenshot` returned a base64 data URI (~11 MB string for a 8 MB Retina PNG), JS decoded it via atob + Uint8Array.from + Array.from, then sent the resulting 8 M-element JSON array of numbers BACK to Rust as `write_session_file`'s bytes parameter. Each leg was multi-second on Retina captures. New flow: Rust capture commands write to `/tmp/visionpipe-capture-<nanos>.png` and return the path. JS calls a new `move_capture_to_session` Tauri command which `std::fs::rename`s (or `copy + delete` if cross-volume) the file into the session folder. Bytes never cross IPC.
- **Touched**: `src-tauri/src/capture.rs` (return path instead of base64; new `fresh_temp_path` helper); `src-tauri/src/lib.rs` (new `move_capture_to_session` command + registration); `src/components/SelectionOverlay.tsx` (drop the atob/Uint8Array.from chain, just pass the path); `src/App.tsx onCapture` (signature now takes path string; uses `move_capture_to_session` instead of `write_session_file` with bytes).
- **Pill style**: `src/components/SelectionOverlay.tsx` — both modes now use `rgba(212, 136, 42, 0.95)` (amber) with `0 4px 14px rgba(0,0,0,0.4)` drop shadow and `font-weight: 700`. Scrolling mode already used amber; regular mode caught up.
- **Credit chip text**: `src/components/Header.tsx` — `{N} cr` → `{N.toLocaleString()} {N === 1 ? 'credit' : 'credits'}`. Renders "Cost: 1 credit · Balance: 1,000 credits" instead of "Cost: 1 cr · Balance: 1000 cr".

### Potential concerns to address:
- The cross-volume rename fallback (copy + delete) only triggers if `/tmp` and the session folder are on different filesystems — rare on a default macOS install.
- Two smaller `Array.from(bytes)` paths still exist (`persistence.ts` writes ~10-50 KB transcript.json; `SessionWindow.tsx` fallback writes ~1-50 KB markdown). Both are small enough that the IPC overhead is invisible. Not refactored.

---

## Progress Update as of 2026-05-06 14:17 PDT — v0.9.3
*(Most recent updates at top)*


### Summary of changes since last update

v0.9.3 — skip the Welcome / Get Started screen on launch when permissions are still granted, AND default fresh-install credit balance to 1,000 (was 0) so testers aren't locked behind devtools console gymnastics until the Buy Credits backend ships.

### Detail of changes made:

- **`src/App.tsx` skip-onboarding-on-launch**: mount effect now branches on a `vp-onboarded` localStorage flag (set when the user dismisses onboarding). If the flag is set, silently call `check_permissions` and — if all three required permissions (Screen Recording, System Events, Accessibility) are still granted — go straight to `idle` mode + show HistoryHub. The Tauri window starts hidden (`visible: false` in `tauri.conf.json`), so the brief permissions check happens with nothing visible — no flash-and-quit. If the flag is missing, or any permission was revoked since last launch, fall through to the existing onboarding flow.

- **`src/App.tsx dismissOnboarding`** writes `localStorage.setItem("vp-onboarded", "1")` before transitioning to idle. One-way switch — once user clicks "Get Started" once, every subsequent launch (with permissions still granted) skips the welcome card. Tray menu → "Show Onboarding…" still works for manual re-entry.

- **`src-tauri/src/lib.rs DEFAULT_CREDIT_BALANCE = 1000`** replaces the prior `unwrap_or(0)` for fresh-install balance. 1,000 credits = $10.00 of capture budget. Until `api.visionpipe.ai` ships (Buy Credits backend), shipping with 0 walled every new user behind a devtools-console workaround. 1,000 is enough for first-day exploration without giving away the farm. Existing users with a non-zero `credit_balance` in their `visionpipe.json` store are unaffected — only fresh installs (no store file, or no `credit_balance` key) hit the new default.

### Potential concerns to address:

- A user already at 0 credits won't be auto-bumped to 1000 — they need to either delete their `~/Library/Application Support/com.visionpipe.desktop/visionpipe.json`, hand-edit the value, or use `add_credits` via devtools. Could add a one-time migration ("if balance = 0 AND no Buy Credits backend yet, bump to 1000") but that's surprising behavior; flagging here for visibility.
- The skip-onboarding silent re-verify uses the same `check_permissions` Tauri command that runs `osascript` for System Events. On a known-granted system this returns silently. On a freshly-revoked system the osascript fires from a hidden process — functionally correct (we fall through to onboarding) but worth noting for future debugging.
- `--skip-web` again because visionpipe-web is still on `update-website-copy-2026-05-04`.

---


## Progress Update as of 2026-05-06 13:50 PDT — skip onboarding + default 1000 credits

### Summary of changes since last update
Two small UX fixes destined for v0.9.3: (1) skip the Welcome / Get Started screen on launch when the user has been through onboarding once and all required permissions are still granted, (2) default fresh-install credit balance bumped from 0 to 1,000 so testers aren't walled behind devtools-console gymnastics until the Buy Credits backend ships.

### Detail of changes made:
- **`src/App.tsx` mount effect** — branches on `localStorage.getItem("vp-onboarded")`. If flag set AND `check_permissions` silently returns all three required permissions granted, jump straight to `idle` mode + HistoryHub-sized window. Tauri window starts hidden so the brief silent check doesn't flash anything. Falls through to onboarding when flag missing or any permission revoked.
- **`src/App.tsx dismissOnboarding`** — sets `localStorage.setItem("vp-onboarded", "1")` before transitioning to idle. One-way switch; tray menu → "Show Onboarding…" still works for manual re-entry.
- **`src-tauri/src/lib.rs`** — new `DEFAULT_CREDIT_BALANCE = 1000` constant replaces the prior `unwrap_or(0)` in `load_balance`. Fresh installs land with 1000 credits ($10 of capture budget). Existing users with a non-zero balance in `~/Library/Application Support/com.visionpipe.desktop/visionpipe.json` are unaffected.

### Potential concerns to address:
- Existing testers with 0 credits won't auto-bump — they need to delete the store file, edit the value, or use `add_credits` via devtools. Could add a one-time migration but that's surprising behavior. Flagged for the user.
- The 1000 default is a temporary bridge until Buy Credits ships against `api.visionpipe.ai`. When the backend is real, decide whether new users still get a credit-grant via the server (e.g. signup bonus) or whether the default drops back to 0 and Buy Credits is mandatory before first send.

---

## Progress Update as of 2026-05-06 13:37 PDT — v0.9.2
*(Most recent updates at top)*


### Summary of changes since last update

v0.9.2 — capture overlay matches native macOS Cmd+Shift+4 behavior: crosshair-only on initial press (no full-screen darkening), traffic-light controls hidden during capture, and dimming kicks in only OUTSIDE the selection rectangle once dragging starts.

### Detail of changes made:

- **`src/components/SelectionOverlay.tsx` — no dim until drag.** Dropped the always-on `background: "rgba(0,0,0,0.2)"` fullscreen overlay. The container is now `background: "transparent"` until the user mousedowns. Once a selection exists, four absolutely-positioned dim rectangles (`rgba(0,0,0,0.45)`) render around the selection (top / bottom / left / right of the selection rect), with the selection itself remaining fully transparent so the user can see exactly what will be captured. Mirrors native macOS screenshot UX.

- **`src/components/SelectionOverlay.tsx` — no traffic-light controls during capture.** New `useEffect` that calls `getCurrentWindow().setDecorations(false)` on mount and `setDecorations(true)` on unmount. The macOS red/yellow/green window controls disappear while the capture overlay is visible and come back on the main HistoryHub / SessionWindow surfaces.

- The hint pill at top center of the overlay ("Drag a region · Enter for fullscreen · Esc to cancel") gets `pointer-events: none` so it doesn't intercept clicks.

### Potential concerns to address:

- `setDecorations(false)` toggling assumes nothing else concurrently modifies decoration state. If a future feature also wants to toggle, switch to a "decoration suspended" counter rather than a boolean.
- The 0.45 alpha for dimming was picked by feel; native macOS uses something close. Tunable later.
- This release is `--skip-web` again because `visionpipe-web` is still on `update-website-copy-2026-05-04`. Website download button stays at v0.6.1 until that branch merges.

---


## Progress Update as of 2026-05-06 13:35 PDT — capture overlay UX

### Summary of changes since last update
User reported the screenshot capture flow felt jarring: pressing the global hotkey (⌘⇧C) showed the macOS traffic-light controls in the top-left AND darkened the entire screen *before* any selection had been made. Standard macOS Cmd+Shift+4 muscle memory expects: crosshair-only on initial press, dimming only outside the selection rectangle once dragging starts. This fix matches that.

### Detail of changes made:
- **`src/components/SelectionOverlay.tsx`**: dropped the always-on `background: "rgba(0,0,0,0.2)"` fullscreen overlay. The container is now `background: "transparent"` until the user mousedowns. Once a selection exists, four absolutely-positioned dim rectangles (`rgba(0,0,0,0.45)`) render around the selection (top / bottom / left / right of the selection rect), with the selection itself remaining fully transparent so the user can see exactly what will be captured. Mirrors native Cmd+Shift+4.
- **`src/components/SelectionOverlay.tsx`**: new `useEffect` that calls `getCurrentWindow().setDecorations(false)` on mount and `setDecorations(true)` on unmount. Hides the macOS traffic-light controls during the capture overlay; restores them so HistoryHub / SessionWindow keep their normal close/minimize buttons.
- The hint pill ("Drag a region · Enter for fullscreen · Esc to cancel") gets `pointer-events: none` so it doesn't block clicks at the top center of the overlay.

### Potential concerns to address:
- `setDecorations(false)` toggling assumes nothing else is concurrently modifying decoration state. If a future feature also wants to toggle, they need to coordinate (e.g. use a "decoration suspended" counter rather than a boolean).
- The 0.45 alpha for the dimming was picked by feel. Native macOS uses something close to that but slightly less; tunable later.
- Not yet released — the user wants to manual-smoke-test before shipping per the small-cadence + verify-before-completion discipline. The fix is on main; running `pnpm tauri dev` from main exercises it.

---

## Progress Update as of 2026-05-06 13:21 PDT — v0.9.1
*(Most recent updates at top)*


### Summary of changes since last update

v0.9.1 — fixes Settings panel overflow + traffic-light overlap, replaces the broken three-dot prompt menu with a real dropdown (with Reveal Logs / Save Diagnostic Bundle entries), and changes the Copy to Clipboard disabled-state cursor from "wait" (which looked like a spinner) to "not-allowed".

### Detail of changes made:

- **SettingsPanel modal scroll** — outer overlay uses `align-items: flex-start` + `overflow-y: auto` so the modal scrolls inside the viewport when taller than the window. Previously the "Reset all to defaults" button + the bottom note were below the visible area on the (newly-tightened) HistoryHub window. 80 px left padding inside the card clears the macOS traffic-light dots so the "Settings" header doesn't overlap them. Backdrop click (clicking the dimmed area outside the card) closes the modal.

- **Header three-dot menu rewritten as a real dropdown.** Was previously `window.prompt("Choose: 1) New session 2) ... (1/2/3)")`, which on at least one user's setup silently dropped — the menu button felt unresponsive. New menu: New session / Open session folder / Settings… / Reveal logs in Finder… / Save diagnostic bundle… Each item is one click. Closes on item select, outside click, or Escape.

- **Copy to Clipboard disabled cursor** — was `cursor: wait` (renders as a spinner on macOS), which made users think the click was pending instead of rejected. Now `cursor: not-allowed` (slashed circle) plus a dimmed background so the disabled state reads as "no" rather than "thinking".

- **`--skip-web` flag added to `release.sh`.** Lets the operator ship a desktop hot-fix to GitHub releases + homebrew tap while `visionpipe-web` is mid-rewrite on a feature branch (and therefore can't accept the new DMG commit on main). The script's pre-flight + post-flight visionpipe-web checks are both bypassed when `--skip-web` is passed. The website itself stays at whatever's currently on `visionpipe-web origin/main` until the operator merges. This release uses `--skip-web` because `visionpipe-web` is on `update-website-copy-2026-05-04`.

- **Stale "Copy & Send" hotkey row label** in Settings → fixed to "Copy to Clipboard" (matches the v0.8.0 Footer rename).

### Potential concerns to address:

- The dropdown menu's hover effect uses imperative `onMouseEnter` / `onMouseLeave` to swap inline `background`. Works fine but a styled-components / CSS module solution would be cleaner if the project standardizes on one.
- "Save diagnostic bundle…" is now one click away — make sure the path it reveals (`~/Downloads/visionpipe-diagnostic-<timestamp>.zip`) doesn't accidentally include anything sensitive. Currently it bundles `~/Library/Logs/com.visionpipe.desktop/`, version info, and `sw_vers`/`hw.model`/`machdep.cpu.brand_string` — no user data.
- This release is `--skip-web`, so visionpipe.ai download button continues to point at v0.6.1 until the website rewrite branch merges.

---


## Progress Update as of 2026-05-06 13:25 PDT — Header dropdown + Footer cursor + --skip-web

### Summary of changes since last update
User reported two real bugs visible in v0.9.0: (a) clicking "Copy to Clipboard" with 0 credits shows a wait/spinner cursor that misreads as "thinking" instead of "rejected"; (b) clicking the three-dot overflow menu in the Header does nothing visible — silent failure of the underlying `window.prompt("Choose 1/2/3")` stub, depends on webview/macOS combo. Fixed both, plus added a `--skip-web` flag to `release.sh` so we can ship the desktop hot-fix without forcing the website rewrite to merge first.

### Detail of changes made:
- **`src/components/Header.tsx` overflow menu**: replaced the `window.prompt`-based stub with a proper React dropdown. Items: New session / Open session folder / Settings… / Reveal logs in Finder… / Save diagnostic bundle… Closes on item select, outside click, or Escape. Two new helpers (`MenuItem`, `MenuDivider`) inside the same file. Imports `invoke` so menu items can call `reveal_logs_in_finder` and `save_diagnostic_bundle` directly.
- **`src/components/Footer.tsx` Copy-to-Clipboard disabled state**: `cursor: wait` → `cursor: not-allowed`, plus a dimmed teal background when `busy === true`. Reads as "rejected" instead of "in progress" — addresses the user's confusion about the spinner.
- **`scripts/release.sh` `--skip-web` flag**: bypasses the `visionpipe-web on main` preflight check AND the visionpipe-web-side `git add/commit/push` AND the post-flight visionpipe-web verification. Use only when the website is mid-rewrite and the operator knows visionpipe.ai will lag the new build. Prints a warning at preflight time so it's visible.

### Potential concerns to address:
- The dropdown menu's hover effect uses imperative inline-style swaps (`onMouseEnter`/`onMouseLeave`). Functional but ugly; CSS modules or styled-components would be cleaner if the project standardises on one.
- `--skip-web` is a one-way escape hatch. Repeated use leaves visionpipe.ai stale until someone manually merges. Each `--skip-web` release prints a warning to keep it visible; revisit if it gets used more than 2-3 times in a row.
- This commit goes onto main as a feature commit; release.sh will add the actual `Release v0.9.1` commit on top.

---

## Progress Update as of 2026-05-06 13:10 PDT — fix SettingsPanel overflow + label

### Summary of changes since last update
SettingsPanel modal rendered taller than the (newly tightened) HistoryHub window in v0.9.0, hiding the "Reset all to defaults" button and the bottom note. The modal also collided with the macOS traffic-light controls on top-left. Both visible immediately when opening Settings on a short window — should have been caught by manually clicking through Settings before shipping v0.9.0. Fix: outer overlay scrolls instead of using `align-items: center` (which clips overflow at the top), modal gets 80 px left padding to clear the dots, plus a backdrop-click handler that closes the modal. Also fixed the stale "Copy & Send" row label → "Copy to Clipboard" (matches the v0.8.0 Footer rename).

### Detail of changes made:
- **`src/components/SettingsPanel.tsx`**: outer overlay now uses `display: flex, align-items: flex-start, padding: 24, overflow-y: auto` so the modal scrolls inside the viewport when it's taller than the window. Inner card uses `width: 100%; max-width: 720` to keep the existing visual width while the outer wrapper handles overflow. Inner padding tweaked to `20px 28px 20px 80px` so the macOS chrome dots (top-left) don't overlap the Settings header. Backdrop click (clicking the dimmed area outside the card) now closes the modal — `e.target === e.currentTarget` guard so clicks inside the card don't bubble.
- **`src/components/SettingsPanel.tsx`**: `<HotkeyBindingRow label="Copy & Send" />` → `label="Copy to Clipboard"`. The hotkey row label now matches the Footer button label introduced in v0.8.0.

### Potential concerns to address:
- Did not run `release.sh` because preflight would block (visionpipe-web is on `update-website-copy-2026-05-04` with 10 unpushed commits — by design until the user merges the website rewrite). The fix is on main; whoever runs `pnpm tauri dev` from main gets it. The next release after the website branch merges will include this fix.
- This is the kind of layout bug a 30-second manual smoke test ("open Settings, can I click everything?") would have caught before shipping v0.9.0. Adding manual smoke-test discipline to the release flow per the user's earlier feedback about basic errors.

---

## Progress Update as of 2026-05-06 13:30 PDT — release.sh sync guards (post-v0.9.0)

### Summary of changes since last update
Added pre-flight + post-flight checks to `scripts/release.sh` so future releases can't silently leave a public channel stale (the failure mode that hit `visionpipe-web` during the v0.7.0–v0.9.0 burst, where release commits stacked on a feature branch and never reached production). Also pushed the homebrew tap to v0.9.0 manually (the killed v0.9.0 release.sh ran past the visionpipe push but never reached the homebrew tap step).

### Detail of changes made:
- **`scripts/release.sh` preflight** (after `--bump` validation): refuses to run unless this repo is on `main` with a clean working tree; refuses unless `visionpipe-web` is on `main`; refuses unless `gh` CLI is authenticated. Each failure prints why and how to fix it.
- **`scripts/release.sh` post-flight** (right before the success banner): verifies `visionpipe origin/main` HEAD message is `Release v$VERSION`; verifies the GitHub release exists with a DMG attached; verifies the homebrew tap public version (read via `gh api`) equals `$VERSION`; verifies `visionpipe-web origin/main` contains both the versioned and stable DMGs. Each failed check prints the specific `gh release upload` / `cp + commit + push` / etc. command to fix it manually. Read-only — never modifies state.
- **Homebrew tap manual catch-up**: `~/.homebrew-visionpipe` cask file was at v0.8.2 because the killed v0.9.0 release.sh died before the tap-bump step. Manually updated `Casks/visionpipe.rb` to v0.9.0 + sha256 of `VisionPipe-0.9.0.dmg`, committed + pushed to `VisionPipe/homebrew-visionpipe`.

### Potential concerns to address:
- The post-flight DMG check confirms files are present in `visionpipe-web/origin/main` but doesn't compare hashes between the versioned and stable copies. Sufficient for the failure modes seen so far (push rejected, file missing); a stricter check would compare `git cat-file blob` of both.
- The preflight blocks releasing while `visionpipe-web` is on a non-main branch. Currently `visionpipe-web` is on `update-website-copy-2026-05-04` with 10 unpushed commits (including 4 historical Release commits from this session). Until that branch merges to main, no further release from this script is possible — by design. If a desktop hot-fix is needed before the website rewrite is ready, add a `--skip-web` flag.

---

## Progress Update as of 2026-05-06 12:39 PDT — v0.9.0
*(Most recent updates at top)*


### Summary of changes since last update

v0.9.0 — Settings panel rebuilt: Hex-style key-cap rendering for shortcuts, the row itself is the click target (no separate "Change" button), and rebinding actually works now (was previously eaten by the live global shortcut). Hotkey changes also take effect immediately, no app restart needed.

### Detail of changes made:

- **Settings hotkey rows redesigned.** Each row's combo is now rendered as the same dark Hex-style key-caps used in HotkeyPill (one cap per key — ⌘ ⇧ C — instead of the old `CmdOrCtrl+Shift+C` text in an amber outline box). The whole keycap cluster is the click target — clicking it starts a "Press shortcut…" capture state. The separate "Change" button is gone. Reset button stays.

- **Bug fix: rebinding actually persists now.** Before this release, pressing the existing global capture combo (⌘⇧C by default) inside the Settings rebind UI was consumed by the live global shortcut handler — the Rust side fired its capture flow (showing the selection overlay) and the JS keydown listener never saw the event. Fix: new `pause_global_shortcuts` / `resume_global_shortcuts` Tauri commands. The Settings row calls `pause_global_shortcuts` before listening for keystrokes, and `resume_global_shortcuts` after the user either captures a new combo or hits Esc to cancel. `resume_global_shortcuts` re-reads `settings.json` from disk and re-registers all global shortcuts, so a freshly-saved combo is live the same instant — no app restart required (the prior "Note: hotkey changes take effect after the next app restart." text is gone).

- **Refactor: `register_global_shortcuts(&AppHandle)` extracted from `setup()`** so both the launch path and the Settings rebind resume path share one implementation. Shortcut callbacks (capture, scroll capture, show-onboarding) now use `log::info!` instead of `eprintln!` so they land in the rotating log file.

- **Settings panel padding.** Bumped top padding to 36 px so the "Settings" header doesn't crash into the macOS chrome / window controls.

- **`splitKeys` lifted from HotkeyPill into a new `KeyCaps` shared component** (`src/components/KeyCaps.tsx`). Both the inline HotkeyPill and the Settings rebind row now render through `<KeyCaps combo={...} size="sm|md|lg" />`. Single source of truth for the key-cap visual.

### Potential concerns to address:

- `pause_global_shortcuts` calls `unregister_all()` which clears every global shortcut registered by the app. If we ever add new global shortcuts that aren't routed through `register_global_shortcuts()`, they'll be silently lost on a Settings rebind. Consolidating registration through that one helper is the design intent — but worth a comment if future shortcuts are added elsewhere.
- The Settings panel's `persist()` now invokes `resume_global_shortcuts` after every save, which re-registers the closures. With three rows and three `persist` calls (one per row touched), there are extra redundant registrations — harmless because Tauri's `unregister_all` runs implicitly on the next pause, but a Real Implementation would diff config changes and only re-register what moved.
- Clicking outside a capturing row doesn't currently cancel the capture (only Escape does). The cleanup-on-unmount effect handles the case where Settings is closed mid-capture, but lingering listeners across in-panel interactions could be a polish item.

---


## Progress Update as of 2026-05-06 12:31 PDT — v0.8.2
*(Most recent updates at top)*


### Summary of changes since last update

v0.8.2 — keyboard shortcut display redesigned to match the Hex / native macOS keycap aesthetic, plus brand polish (orange `|` pipe, "Give Your LLM Vision" subtitle).

### Detail of changes made:

- **Hotkey display redesign — Hex-style key-caps.** The single-pill design (orange capsule with all keys jammed into one chip) is replaced with three separate dark-gray rounded-square key-caps (one per key in the combo), each with a subtle inset top highlight + bottom shadow so they read as physical keys rather than a flat badge. Keys are 56×56 px on the Welcome card (lg) and 36×36 px in HistoryHub (sm). The whole cluster is one click target — clicking any key opens the SettingsPanel for rebinding. Internally `HotkeyPill` now uses a `splitKeys()` helper that returns `["⌘", "⇧", "C"]` instead of the prior single concatenated string; the test file (`HotkeyPill.test.ts`) was updated to match.

- **Orange `|` pipe in the brand wordmark.** `Vision|Pipe` now renders the pipe in `C.amber` everywhere — in the Onboarding title bar, the Welcome H1, and the SessionWindow Header. Helps the wordmark visually echo the orange-tinged brand accent.

- **Subtitle copy:** "Give your LLM eyes." → "Give Your LLM Vision" on the Welcome card. Matches the earlier "How to give your LLM vision:" copy change and lands on a single consistent product tagline.

- **Hint text update:** "Click the orange pill to change the shortcut." → "Click the keys to change the shortcut." since the pill is no longer a pill.

### Potential concerns to address:

- Key-cap colors (`#262b29` background, `#3a4240` border) are hardcoded rather than living in `lib/ui-tokens.ts`. Worth promoting to a `C.keyCap` token if more places end up needing this look.
- The "Click the keys to change the shortcut." hint is only on the Welcome card — HistoryHub's smaller in-text usage doesn't surface it. The button's tooltip (`title="Click to change keyboard shortcut"`) carries the affordance there, which seems sufficient.

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


