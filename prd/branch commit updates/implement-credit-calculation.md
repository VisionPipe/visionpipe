# Branch Progress: implement-credit-calculation

This document tracks progress on the `implement-credit-calculation` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

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
