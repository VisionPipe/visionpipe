---
name: VisionPipe Tauri/Rust gotchas — read before writing native code
description: Concrete failure modes hit while writing this project's Tauri integration. Read this BEFORE adding a new Tauri command, IPC call, or global shortcut, not after the bug ships.
type: project
originSessionId: 71743ae3-56f9-4d99-83a5-21ed6397d398
---
Lessons from real bugs that shipped in v0.7.0 / v0.8.0 / v0.9.0 and required emergency patch releases. The pattern: each was a "basic" platform-knowledge mistake that wasn't visible from unit tests because it lived on the JS↔Rust boundary or the OS-level event-flow boundary. Read this before touching `src-tauri/src/` or any code that calls `invoke(...)`.

## 1. Tauri auto-converts JS keys camelCase → Rust args snake_case

**Bug shipped:** `Cannot send: invalid args 'audioSeconds' for command 'deduct_for_bundle': missing required key audioSeconds.` Every Copy/Send click failed in v0.7.0 + v0.8.0.

**Cause:** the Rust command was `fn deduct_for_bundle(... audio_seconds: u64)`. The JS call passed `{ audio_seconds: ... }` (snake_case). Tauri v2's serde rename layer converts incoming **camelCase JS** keys into snake_case Rust args — so it expected `audioSeconds` from JS and reported the missing camelCase key.

**Rule:** **Always pass camelCase from JS to invoke, even when the Rust param is snake_case.**

```ts
// ✓ Correct
await invoke("deduct_for_bundle", { screenshots, annotations, audioSeconds });

// ✗ Wrong — produces "missing required key audioSeconds"
await invoke("deduct_for_bundle", { screenshots, annotations, audio_seconds });
```

Single-word keys are unambiguous (`folder`, `markdown`, `path`, `content`) and work either way. The bug only shows up on multi-word keys (`audio_seconds`, `take_next_screenshot`, etc.).

**How this would have been caught:** an integration test that mocked `invoke` and asserted the exact key shape. The unit tests we shipped only covered pure helper functions (`splitKeys`, `deriveAudioSeconds`) — they never exercised the IPC contract. Vitest+jsdom-with-React-providers hung in this project, which is what caused us to drop those tests.

**Future-proof option:** generate TS types from Rust signatures with `tauri-specta` or `specta` so a Rust rename forces a TS compile error. Worth doing if more multi-word IPC keys land.

## 2. Global shortcuts are OS-level — JS keydown listeners can't see them

**Bug shipped:** Settings panel rebind UI accepted clicks but pressing Cmd+Shift+C made the window go full-screen instead of recording the new shortcut. Released as v0.9.0 fix after a user-visible failure.

**Cause:** `tauri-plugin-global-shortcut` registers shortcuts at the macOS level. macOS dispatches the registered handler BEFORE the keystroke reaches the browser. So `window.addEventListener("keydown", ...)` never fires for a key combo that's already a registered global shortcut — no amount of `e.preventDefault()` can recover it.

**Rule:** **If you need to listen for keystrokes inside the app that overlap with a registered global shortcut, you must unregister the global shortcut first.**

The fix that shipped: `pause_global_shortcuts` / `resume_global_shortcuts` Tauri commands that wrap `app.global_shortcut().unregister_all()` and a re-register helper. The JS rebind UI calls pause before listening and resume on completion or cancel.

**Pattern to remember:** anywhere the user expects "type a shortcut" UX, the surrounding flow must temporarily disable global shortcut handling.

## 3. Tauri capability declaration ≠ command registration

To expose a new Tauri command, all three are required:

1. **Define** the `#[tauri::command] async fn ...` in Rust.
2. **Register** it in `tauri::generate_handler![...]` in `lib.rs`.
3. **For plugin commands** (dialog, store, fs): add the capability to `src-tauri/capabilities/default.json` (e.g. `"dialog:allow-save"`). Plugin commands fail at runtime with "permission denied" if the capability isn't listed, even when the plugin itself is registered.

Custom `#[tauri::command]` functions don't need capabilities — only commands provided by official plugins do. (`tauri-plugin-dialog`'s `save()`, `tauri-plugin-store`'s `set()`, etc.)

## 4. macOS TCC permission prompts can deadlock the calling thread

**Bug shipped:** Modal stuck on "Asking macOS…" when granting mic / speech recognition. Fixed in v0.7.0.

**Cause:** the ObjC bridge used `dispatch_semaphore_wait` to block until the user answered. `SFSpeechRecognizer.requestAuthorization` dispatches its completion to the main queue. If the calling thread is or contends with main, completion never fires and we time out at 30 s.

**Rule:** **Wrap any blocking ObjC FFI in `tauri::async_runtime::spawn_blocking(...)`** so the wait happens on the blocking task pool, not a runtime worker. Also short-circuit the request when the cached `authorizationStatus` is already determined (Apple won't show a prompt for non-`notDetermined` states anyway).

## 5. Tauri commands run on tokio workers, not main — but BLOCKING in them still hurts

Async `#[tauri::command]` functions run on tokio's runtime. Blocking FFI inside them blocks the worker thread for the duration of the call. With one worker the runtime stalls; with multiple workers other commands keep running but the offending one freezes. Either way, prefer `spawn_blocking` for any FFI that waits on user input or network.

## 6. `git add -A` in `release.sh` sweeps EVERYTHING

`scripts/release.sh` runs `git add -A` before the release commit. Any uncommitted source change in the working tree gets folded into the `Release vX.Y.Z` commit — but the binary that's already been built + signed + notarized doesn't include those changes. Result: the commit history says "v0.8.0 includes feature X" but users downloading v0.8.0 don't see X.

**Rule:** Never edit source files while a release is mid-flight. If you must, stash the changes before the script reaches its commit step, then pop after.

## 7. `release.sh` historically didn't enforce branch — fixed in 81c2ece

Before the 2026-05-06 sync-guards commit, `release.sh` would happily append release commits to whatever branch `visionpipe-web` was checked out on. Result: 4 release commits stacked on the user's `update-website-copy-2026-05-04` feature branch and the public website stayed at v0.6.1 for the entire v0.7.0–v0.9.0 sequence. Pre-flight now refuses to release unless `visionpipe-web` is on `main`.

## Manual smoke test — do this before claiming "release ready"

The bugs above were visible the moment a user touched the affected flow. None were visible from `cargo build`, `cargo test`, `pnpm tsc --noEmit`, or `pnpm test`. The cheapest catch is:

1. `pnpm tauri dev`
2. Touch the specific flow that changed: take a screenshot if you touched capture, click Copy/Send if you touched credits, click the Settings rebind row if you touched hotkey config, etc.
3. Watch for: errors in console, unexpected window state, the IPC actually round-tripping.

If you can't realistically test the flow (UI requires real screen interaction, mic input, etc.) flag it explicitly to the user as "needs manual smoke test before release."

## 8. macOS traffic-light dots vs title-bar height (visual alignment)

**Bug shipped:** The HistoryHub title bar (`Vision|Pipe — History`) appeared on a SECOND row visibly below the macOS red/yellow/green window controls in v0.7.0–v0.10.2. Looked like the title was unaware of where the dots were.

**Cause:** With `titleBarStyle: "Overlay"` in `tauri.conf.json`, the macOS traffic-light dots are drawn by the OS at a fixed offset from the top-left corner of the window — roughly **centered at y≈13 px**, vertical extent y≈6–20 px. If our title-bar div has `height: 40` and `alignItems: center`, the brand text centers at y=20 — visibly BELOW the dots, looking like a stacked second row.

**Rule:** Title-bar containers that share a row with the macOS chrome dots should use **`height: 28`** with `alignItems: center` and `lineHeight: 1` to keep the text vertically inside the dots' visual band. **`paddingLeft: 92`** clears the leftmost dot with breathing room (the dots cluster ends around x≈80; 92 gives ~12 px of padding).

```tsx
// Right
<div data-tauri-drag-region style={{
  height: 28, paddingLeft: 92, paddingRight: 16,
  display: "flex", alignItems: "center", justifyContent: "space-between",
  background: C.deepForest, borderBottom: `1px solid ${C.border}`,
}}>
  <span style={{ fontSize: 12, lineHeight: 1, color: C.textMuted }}>
    Vision<span style={{ color: C.amber }}>|</span>Pipe — History
  </span>
  <VersionBadge />
</div>

// Wrong — brand sits in a second row below the dots
<div style={{ height: 40, paddingLeft: 80, ... }}>
```

The Onboarding card was already getting this right (`height: 28, paddingLeft: 80`) — HistoryHub just hadn't been brought into alignment.

## 9. Visual layout / pixel-perfect alignment is a class I CANNOT verify from inside the session

I cannot run `pnpm tauri dev` and look at the result. `tsc --noEmit` and `vitest run` confirm the code COMPILES; they say nothing about whether `height: 40` looks right next to the OS chrome. Every visual bug I've shipped — chrome alignment, modal overflow, dimmed-cursor-confused-as-spinner, traffic-lights-vs-title-bar-row — followed the same pattern: I declared "verified" because the automated tests passed, the user opened the app and saw it was visibly wrong.

**Rule:** When the change is purely visual (margin / padding / height / color / alignment / font-size), explicitly tell the user "I picked these values; eyeball them before we ship — I cannot see the result." Don't claim "verified" or "looks good." Lean on the user as the visual oracle. Smaller releases + their feedback is the working loop.

## When you hit a NEW Tauri/Rust gotcha

Append a numbered section to this file (don't replace existing ones — keep the running history). The point of the file is to compound knowledge across sessions, not snapshot a single moment.
