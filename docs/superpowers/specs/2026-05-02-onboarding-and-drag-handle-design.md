# First-launch onboarding flow + draggable annotation window

**Date:** 2026-05-02
**Status:** Approved, ready to implement

## Goal

Eliminate the "raw macOS permission dialogs out of nowhere" experience for new VisionPipe users. On first launch (and on any subsequent launch where required permissions are missing), show a friendly window that explains what permissions VisionPipe needs and links straight into the right pane of System Settings. Once everything is granted, no friction. Also: make the annotation window draggable.

## Non-goals (YAGNI)

- A "Skip" button on either permission. Both are required for full functionality; skip would just produce a broken app.
- Animations / confetti / progress bars on permission grant.
- Per-browser URL permissions in the onboarding. Those happen lazily, in-context, on first browser capture — that's better UX than a 9-permission wall.
- Settings panel, capture history, account login, or any other feature that hasn't been asked for.

## State machine

Frontend `AppMode` adds an `onboarding` mode:

```
                ┌─→ onboarding ─┐
launch ─────────┤               ├─→ idle (hidden) ── ⌘⇧C ──→ selecting → annotating
                └───────────────┘
```

Decision logic on launch:

1. Rust calls `check_permissions()` immediately during `setup`.
2. Rust emits `permissions-status` event with `{screenRecording: bool, systemEvents: bool}`.
3. Frontend reads the event:
   - both granted → mode = `idle`, window stays hidden
   - either missing → mode = `onboarding`, window shows as 600×440 centered

When the user completes onboarding (both green and clicks "Got it"), the window hides and mode flips to `idle`. Standard Cmd+Shift+C flow takes over from there.

## Onboarding UI

Single-page card with a 32px draggable chrome bar at the top, two permission cards stacked vertically, and a footer that appears once both are granted.

```
┌────────────────────────────────────────────────────┐
│  [logo]  VisionPipe                            ⠿   │  ← chrome bar (drag region)
├────────────────────────────────────────────────────┤
│  Welcome to VisionPipe                             │
│  Two permissions and you're set.                   │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ ✗  Screen Recording                          │  │
│  │    Required to capture screenshots.          │  │
│  │    [ Open System Settings ]    [ Re-check ]  │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ ✗  System Events (Apple Events)              │  │
│  │    Reads the active app and window for       │  │
│  │    metadata in your captures.                │  │
│  │    [ Open System Settings ]    [ Re-check ]  │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  Optional: per-browser URL capture grants happen   │
│  automatically the first time you capture from a   │
│  browser. No setup needed.                         │
│                                                    │
│  ─── (footer appears when both ✓) ───              │
│  You're all set. Press ⌘⇧C to capture. [ Got it ]  │
└────────────────────────────────────────────────────┘
```

Status icon: `✗` (sienna) when missing, `✓` (teal) when granted. Updates immediately after Re-check or auto-poll.

Button behavior:

- **Open System Settings** (Screen Recording) → `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`
- **Open System Settings** (System Events) → `x-apple.systempreferences:com.apple.preference.security?Privacy_Automation`
- **Re-check** → invokes `check_permissions()` Rust command, updates UI immediately
- **Got it** (footer, only when both ✓) → hides window, mode = `idle`
- **Auto-poll** → frontend sets a 2000ms interval while in onboarding mode that calls `check_permissions()`. Stops on mode exit. This catches the case where the user grants in System Settings and switches back without clicking Re-check.

## Implementation hooks

### Permission detection (Rust)

New file `src-tauri/src/permissions.rs`:

```rust
#[tauri::command]
pub fn check_permissions() -> PermissionStatus {
    PermissionStatus {
        screen_recording: cg_preflight_screen_capture_access(),
        system_events: ae_check_automation_target("com.apple.systemevents"),
    }
}
```

- `cg_preflight_screen_capture_access` → FFI to `CGPreflightScreenCaptureAccess()` from CoreGraphics (read-only, no prompt).
- `ae_check_automation_target` → FFI to `AEDeterminePermissionToAutomateTarget` with `askUserIfNeeded: false`. "not determined" is treated as denied so the user has to actually grant.

Cargo.toml gets `objc2` (for raw selector calls) and `core-foundation` (for CFString conversion).

`lib.rs` calls `check_permissions()` after the window is configured but before any capture flow runs, and emits `permissions-status`.

### Tray menu (Rust)

Replace the current no-op tray builder with one that has:

- "Show Onboarding…" → emits `permissions-status` and shows the window (regardless of granted state — the user might want to re-read what each permission does)
- separator
- "Quit VisionPipe" → standard Tauri `predefined_quit` item

This also gives users an explicit way to quit. Today, there's no UI affordance for quitting — they have to use Activity Monitor or `pkill`.

### Drag region (frontend)

The chrome bar at the top of the onboarding card AND the annotation card is a single React component. Wrapped with `data-tauri-drag-region` (Tauri's webview reads this attribute and treats the element as a native drag region — no JS handlers needed).

Contains:
- VisionPipe logo (16×16) + "VisionPipe" wordmark on the left
- `⠿` grip icon centered for visual affordance

NOT rendered in `selecting` mode (full-screen capture overlay) — a draggable element would interfere with the selection rectangle.

### Hotkey gating (frontend, no Rust change)

`lib.rs` continues to emit `start-capture` on every Cmd+Shift+C press. The frontend's listener checks the current mode:

- `idle` → switch to `selecting` (existing behavior)
- `onboarding` → ignore (no-op; window is already visible)
- `selecting` / `annotating` → ignore (re-pressing while a capture is in flight shouldn't restart)

This keeps the Rust side simple and doesn't require frontend↔Rust mode synchronization.

## Edge cases

| Case | Behavior |
|---|---|
| User denies a permission | Stays in onboarding card; "Got it" button doesn't render. They can quit via the tray menu. |
| User force-quits mid-onboarding | Next launch checks permissions again; if missing, onboarding reappears. No flag state to corrupt. |
| Permission revoked later in System Settings | Next launch detects, shows onboarding again. Self-healing. |
| Cmd+Shift+C while onboarding visible | Frontend listener ignores (no capture, no mode flip). |
| Onboarding visible during `pnpm tauri dev` | Same flow. Useful for dev iteration. |
| User grants permission but doesn't click Re-check | 2-second auto-poll catches it; ✓ appears within 2s. |

## Testing

- **Rust permission detection** is hard to unit-test (requires real macOS with TCC state). Verified manually via the dev iteration loop. Cost > benefit on mocking.
- **Frontend state machine** — Vitest test for mode transitions (launch with both granted → idle, launch with one missing → onboarding, all-granted event → idle, Cmd+Shift+C in onboarding → no-op, Cmd+Shift+C in idle → selecting).
- **Manual verification checklist** covers: fresh-permissions flow, "Open System Settings" deep links, Re-check button, auto-poll, Got it / hide, tray Show Onboarding / Quit, drag handle in both modes, drag handle absent in selecting mode.

## Files changed

- **New:** `src-tauri/src/permissions.rs`
- **Modified:** `src-tauri/src/lib.rs` (call check_permissions on startup, emit event, replace tray builder)
- **Modified:** `src-tauri/Cargo.toml` (add `objc2`, `core-foundation`)
- **Modified:** `src/App.tsx` (new `onboarding` mode + UI, drag-region chrome bar, Cmd+Shift+C gating, auto-poll)
- **Possibly new:** `src/Onboarding.tsx` if the onboarding UI grows past ~150 lines (pull it out for cleanliness)
- **New:** Vitest test for state machine transitions
