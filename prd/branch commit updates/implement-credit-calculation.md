# Branch Progress: implement-credit-calculation

This document tracks progress on the `implement-credit-calculation` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-04-21 12:30 UTC

### Summary of changes since last update
Multiple fixes and improvements: TCC crash guard for dev mode (speech/mic auth outside .app bundle), speech recognition permission flow improvements, default credit balance for testing, device registration and server sync infrastructure, credit purchase UI with Stripe checkout flow, UI cleanup (removed metadata block and context label), and improved voice recording button visual feedback.

### Detail of changes made:
- `src-tauri/src/speech_bridge.m`: Added `is_running_in_app_bundle()` guard function. Both `speech_request_auth()` and `mic_request_auth()` now check for .app bundle context before calling TCC APIs, returning `-1` sentinel when outside a bundle instead of crashing the process.
- `src-tauri/src/speech.rs`: Changed `request_speech_auth()` and `request_mic_auth()` return types from `bool` to `Result<bool, String>`. Maps `-1` from ObjC to `Err(...)` with user-facing message directing to System Settings.
- `src-tauri/src/lib.rs`: Updated `request_microphone_access` and `request_speech_recognition` command handlers to propagate `Result` instead of wrapping in `Ok()`. Added `speech_recognition` to `open_permission_settings` URL map. Changed `deduct_credits` to async with background server sync via `tokio::spawn`. Added new commands: `get_device_id`, `sync_credits`, `start_checkout`. Device registration on startup uses `tauri::async_runtime::spawn` (not `tokio::spawn`) to avoid "no reactor running" panic in `.setup()`. Default credit balance changed to 1,000,000 for testing.
- `src-tauri/src/credits.rs`: Added `uuid` and `reqwest` dependencies. New functions: `get_or_create_device_id()`, `register_device()`, `fetch_balance()`, `create_checkout()`, `sync_deduction()` — all hitting `https://api.visionpipe.ai`. Default balance changed from 0 to 1,000,000 for testing.
- `src-tauri/Cargo.toml`: Added `uuid`, `reqwest` (with rustls-tls), and `tokio` dependencies.
- `src/App.tsx`: Removed metadata block (app/win/os/res/cpu/mem/usr/bat display) and `> context` header from sidebar. Removed `request_speech_recognition` pre-check from recording flow — speech auth now checked at transcription time only, with auto-open of System Settings on failure. Added credit purchase UI: "buy credits" link, pack selection (Starter/Pro/Business), checkout polling, "Waiting for payment..." indicator. Improved recording button: solid red circle with pulsing animation, white stop square icon, bold "Recording... tap to stop" text. Added `sync_credits` call on launch with fallback to local balance.

### Potential concerns to address:
- The `api.visionpipe.ai` backend does not exist yet — device registration will fail silently on every launch (handled gracefully with error log).
- Default balance of 1,000,000 is for testing only — must be reverted before production.
- Voice recording mic button click may not be registering in the UI — a debug `console.log` was added to `toggleRecording` but the root cause is still under investigation.
- Several functions in `credits.rs` and `lib.rs` generate "never used" warnings (`register_device`, `fetch_balance`, `create_checkout`) — these are wired up but not yet called from all paths.
- The `checkoutPolling` effect has a dependency on `creditBalance` via `startBalance` closure capture but `creditBalance` is not in the dependency array — may cause stale closure issues.

---

## Progress Update as of 2026-04-15 05:00 UTC

### Summary of changes since last update

Added design spec for in-app credit purchase system using device ID + Stripe Checkout + Next.js API routes.

### Detail of changes made:

- **`docs/superpowers/specs/2026-04-15-in-app-credit-purchase-design.md`** (new): Full design spec covering device ID-based identity (no auth), Vercel Postgres database schema, 5 API routes (register, balance, checkout, webhook, deduct), local-first deduction with server sync, and purchase UI flow. Work spans two repos: `visionpipe` (desktop app) and `visionpipe-web` (Next.js API).

### Potential concerns to address:

- Spec covers two repos — implementation plan needs to clearly separate what goes where.
- Stripe webhook endpoint URL is `api.visionpipe.ai` but the Next.js app may be at a different domain. DNS/proxy config needed.

---

## Progress Update as of 2026-04-15 04:40 UTC

### Summary of changes since last update

Fixed `tauri-plugin-store` configuration that caused a runtime panic on app launch.

### Detail of changes made:

- **`src-tauri/tauri.conf.json`**: Changed `"plugins": { "store": {} }` back to `"plugins": {}`. The store plugin expects a unit type (no config entry), not an empty map — same pattern as the `global-shortcut` plugin issue from the `initial-build-out` branch. With `"store": {}`, Tauri's config deserializer threw: `"invalid type: map, expected unit"`.

### Potential concerns to address:

- A file watcher or linter may be reverting this change back to `"store": {}`. If the app crashes again on launch with the same error, check if something is reformatting `tauri.conf.json`.

---

## Progress Update as of 2026-04-15 01:00 UTC

### Summary of changes since last update

Completed full credit system implementation: Tauri commands with store persistence (Task 3), frontend integration with balance display, cost preview, and insufficient credits guard (Task 4), and verification (Task 5). All 10 unit tests pass, app builds successfully.

### Detail of changes made:

- **`src-tauri/src/credits.rs`**: Added `load_balance()` and `save_balance()` persistence helpers using `tauri_plugin_store::StoreExt`. Store file: `visionpipe.json`, key: `credit_balance`. Default balance: 0 for new installs.
- **`src-tauri/src/lib.rs`**: Added 4 new Tauri commands:
  - `get_credit_balance`: Returns current balance from `Mutex<CreditLedger>` managed state
  - `add_credits`: Adds credits and persists (for purchases/dev top-ups)
  - `preview_capture_cost`: Pure calculation, no state mutation (for frontend cost preview)
  - `deduct_credits`: Calculates cost, validates balance, deducts, persists, returns cost breakdown
  - Initialized `tauri_plugin_store` plugin and `Mutex<CreditLedger>` managed state
  - Loads persisted balance in `setup()` closure
- **`src/App.tsx`**: Replaced session-only credit tracking with backend-backed system:
  - `creditBalance` state loaded from backend on startup via `get_credit_balance`
  - `captureCost` state updated via `preview_capture_cost` when in annotating mode
  - `handleSubmit` calls `deduct_credits` before clipboard composition, returns early on insufficient credits
  - Credits UI shows balance + cost breakdown (capture + annotation + voice = total)
  - Submit button replaced with "Insufficient credits" message when balance < cost

### Potential concerns to address:

- **No frontend refresh on balance change from external source**: If credits are added via devtools or another window, the UI won't update until next `handleSubmit` or app restart. Could add a polling or event-based refresh.
- **No purchase flow**: The `add_credits` command exists but there's no UI for purchasing credits.
- **E2E testing requires manual verification**: The smoke test (Task 5) verifies compilation and unit tests pass, but the full capture-deduct flow needs to be tested interactively via `pnpm tauri dev`.

---

## Progress Update as of 2026-04-15 00:15 UTC

### Summary of changes since last update

Added `tauri-plugin-store` dependency, store permissions, and plugin config to enable persistent credit balance storage.

### Detail of changes made:

- **`src-tauri/Cargo.toml`**: Added `tauri-plugin-store = "2"` dependency after existing Tauri plugins.
- **`src-tauri/capabilities/default.json`**: Added `"store:default"` permission to the capabilities array, required for the frontend to interact with the store.
- **`src-tauri/tauri.conf.json`**: Replaced empty `"plugins": {}` with `"plugins": { "store": {} }` to register the store plugin.
- These are config-only changes — the store plugin is not yet initialized in Rust code (that comes in Task 3).

### Potential concerns to address:

- The store plugin is declared but not yet wired into `lib.rs` setup — this is intentional and will be done in Task 3.

---

## Progress Update as of 2026-04-15 00:00 UTC

### Summary of changes since last update

This is the initial entry. Created `credits.rs` module with pure credit calculation logic, ledger deduction, error types, and 10 unit tests covering all resolution tiers and edge cases.

### Detail of changes made:

- **Created `src-tauri/src/credits.rs`** (158 lines): Core credit system module with:
  - `CreditLedger` struct with `balance: u64` and `deduct()` method
  - `CaptureJob` struct with `width`, `height`, `has_annotation`, `has_voice`
  - `CreditCost` struct with `capture`, `annotation`, `voice`, `total` fields (Serialize/Deserialize for Tauri command returns)
  - `calculate_cost()` function: ceiling division of `(width * height)` by 1,000,000 for capture credits, +1 for annotation, +1 for voice
  - `InsufficientCredits` error type with Display impl
  - 10 unit tests: 1080p (3 credits), 400x300 (1 credit), 4K (9 credits), 1440p (4 credits), annotation surcharge, voice surcharge, both surcharges, deduction success, insufficient balance, exact balance
- **Modified `src-tauri/src/lib.rs`**: Added `mod credits;` after existing `mod speech;` declaration

### Potential concerns to address:

- `div_ceil` is a nightly/recently-stabilized method. If the project's MSRV is older than Rust 1.73, would need `(pixels + block_size - 1) / block_size` fallback. Current project has no specified MSRV so this should be fine.
