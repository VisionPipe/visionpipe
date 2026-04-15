# Branch Progress: implement-credit-calculation

This document tracks progress on the `implement-credit-calculation` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

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
