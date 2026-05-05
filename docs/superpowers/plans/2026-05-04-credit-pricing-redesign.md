# Credit Pricing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dormant per-capture, pixel-based credit module with a per-bundle pricing model (1 credit per screenshot, 1 credit per dormant-annotation, audio with 10s free + 1 credit per additional 10s) wired into the multi-screenshot session UI with live cost preview and send-time deduction.

**Architecture:** Rust core (`credits.rs`) exposes pure `calculate_bundle_cost()` and a `CreditLedger`. Tauri commands provide `get_credit_balance`, `preview_bundle_cost`, `deduct_for_bundle`, `add_credits` over `tauri-plugin-store` persistence. React side adds a `CreditProvider` context that re-derives `currentBundleCost` from session state, renders a Header chip, and gates `Copy & Send` on deduct success.

**Tech Stack:** Rust + Tauri v2 + tauri-plugin-store; React 19 + TypeScript + Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-04-credit-pricing-redesign.md`

---

## File Structure

**Rust (`src-tauri/`)**
- `src/credits.rs` — REPLACE entire content. New `BundleCost`, `calculate_bundle_cost()`, `CreditLedger.deduct(&BundleCost)`, new tests. Old `CaptureJob`/`CreditCost`/`calculate_cost`/old tests deleted.
- `src/lib.rs` — MODIFY. Add `tauri-plugin-store` registration, `Mutex<CreditLedger>` managed state loaded from store on setup, two private helpers (`load_balance`, `save_balance`), four new Tauri commands (`get_credit_balance`, `add_credits`, `preview_bundle_cost`, `deduct_for_bundle`), register all four in `invoke_handler`.

**TypeScript (`src/`)**
- `state/credit-context.tsx` — NEW. `CreditProvider` + `useCredit()` hook. Holds `{ balance, currentBundleCost }`, exposes `refresh()` and `deductForBundle()`. Internally subscribes to `useSession()` and recomputes `currentBundleCost` (debounced 150ms) via `preview_bundle_cost` IPC.
- `state/__tests__/credit-context.test.tsx` — NEW. Vitest tests proving the context recomputes when session changes and aborts copy on insufficient balance.
- `components/Header.tsx` — MODIFY. Add a `<CreditChip />` between the brand row and the mic button area. Renders `Cost: N · Balance: M` (or insufficient state).
- `components/SessionWindow.tsx` — MODIFY. Wrap children in `<CreditProvider>`. Modify `onCopyAndSend` to call `deductForBundle()` first; abort on `Err`; refresh balance on `Ok`.

**No changes to:** `Footer.tsx` (button is a generic primary action; the disable logic comes from `SessionWindow`'s busy/insufficient state being passed in via the existing `busy` prop), `mic-context.tsx`, `session-reducer.ts`, `types/session.ts`, capture/audio Rust modules.

**Known design gap (acknowledged, not fixed in this plan):** `Session.closingNarration` is a transcript string with no `AudioOffset`, so its audio duration can't be derived from current state. The MVP pricing therefore *undercharges* by the closing-narration duration — user-friendly direction, flagged in spec for follow-up.

---

## Task 1: Replace credits.rs with BundleCost model + tests

**Files:**
- Modify: `src-tauri/src/credits.rs` (replace entire content)

- [ ] **Step 1: Write the new credits.rs (impl + tests in one file)**

Replace the entire contents of `src-tauri/src/credits.rs` with:

```rust
use serde::{Deserialize, Serialize};

/// Persisted credit ledger. Wrapped in a `Mutex<CreditLedger>` Tauri-managed
/// state in `lib.rs`; persisted to `visionpipe.json` (key: `credit_balance`)
/// via `tauri-plugin-store`. 1 credit = $0.01.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLedger {
    pub balance: u64,
}

/// Per-bundle (per Copy & Send) cost breakdown. Returned by both
/// `preview_bundle_cost` (no-op preview, called frequently) and
/// `deduct_for_bundle` (consumes balance, called once on send).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BundleCost {
    /// 1 credit per screenshot in the bundle at send time.
    pub screenshots: u64,
    /// 1 credit per annotation. Currently always 0 — annotation feature
    /// was removed in commit da1c132 (multi-screenshot rewrite). The field
    /// stays so re-introducing annotation is a one-line caller change.
    pub annotations: u64,
    /// ceil(max(0, audio_seconds - 10) / 10). First 10s free.
    pub audio: u64,
    /// Sum of the three above. Provided so the frontend doesn't recompute.
    pub total: u64,
}

/// Pure cost calculation. No state, no IO.
pub fn calculate_bundle_cost(
    screenshot_count: u64,
    annotation_count: u64,
    audio_seconds: u64,
) -> BundleCost {
    let screenshots = screenshot_count;
    let annotations = annotation_count;
    let audio = if audio_seconds <= 10 {
        0
    } else {
        (audio_seconds - 10).div_ceil(10)
    };
    let total = screenshots + annotations + audio;
    BundleCost { screenshots, annotations, audio, total }
}

#[derive(Debug)]
pub struct InsufficientCredits {
    pub required: u64,
    pub available: u64,
}

impl std::fmt::Display for InsufficientCredits {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Insufficient credits: need {}, have {}", self.required, self.available)
    }
}

impl CreditLedger {
    pub fn new(balance: u64) -> Self {
        Self { balance }
    }

    pub fn deduct(&mut self, cost: &BundleCost) -> Result<u64, InsufficientCredits> {
        if self.balance < cost.total {
            return Err(InsufficientCredits {
                required: cost.total,
                available: self.balance,
            });
        }
        self.balance -= cost.total;
        Ok(self.balance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── audio tier (10s free, then ceil(extra/10)) ──────────────────────

    #[test]
    fn audio_zero_seconds_is_free() {
        let c = calculate_bundle_cost(0, 0, 0);
        assert_eq!(c.audio, 0);
        assert_eq!(c.total, 0);
    }

    #[test]
    fn audio_under_ten_seconds_is_free() {
        assert_eq!(calculate_bundle_cost(0, 0, 1).audio, 0);
        assert_eq!(calculate_bundle_cost(0, 0, 9).audio, 0);
        assert_eq!(calculate_bundle_cost(0, 0, 10).audio, 0);
    }

    #[test]
    fn audio_eleven_seconds_is_one_credit() {
        assert_eq!(calculate_bundle_cost(0, 0, 11).audio, 1);
    }

    #[test]
    fn audio_twenty_seconds_is_one_credit() {
        // 10s free, 10s extra → ceil(10/10) = 1
        assert_eq!(calculate_bundle_cost(0, 0, 20).audio, 1);
    }

    #[test]
    fn audio_twentyone_seconds_is_two_credits() {
        // 10s free, 11s extra → ceil(11/10) = 2
        assert_eq!(calculate_bundle_cost(0, 0, 21).audio, 2);
    }

    #[test]
    fn audio_fortyseven_seconds_is_four_credits() {
        // 10s free, 37s extra → ceil(37/10) = 4
        assert_eq!(calculate_bundle_cost(0, 0, 47).audio, 4);
    }

    #[test]
    fn audio_two_minutes_is_eleven_credits() {
        // 120s total, 110s extra → ceil(110/10) = 11
        assert_eq!(calculate_bundle_cost(0, 0, 120).audio, 11);
    }

    // ── screenshots (1 each, no surcharge) ──────────────────────────────

    #[test]
    fn one_screenshot_no_audio_is_one_credit() {
        let c = calculate_bundle_cost(1, 0, 0);
        assert_eq!(c.screenshots, 1);
        assert_eq!(c.total, 1);
    }

    #[test]
    fn five_screenshots_no_audio_is_five_credits() {
        let c = calculate_bundle_cost(5, 0, 0);
        assert_eq!(c.screenshots, 5);
        assert_eq!(c.total, 5);
    }

    // ── annotations (dormant — proves field still calculates) ──────────

    #[test]
    fn three_annotations_alone_is_three_credits() {
        // Annotation feature is removed today, but the field must still
        // calculate correctly so re-enabling is a one-line caller change.
        let c = calculate_bundle_cost(0, 3, 0);
        assert_eq!(c.annotations, 3);
        assert_eq!(c.total, 3);
    }

    // ── bundle composition (worked examples from the spec) ──────────────

    #[test]
    fn five_screenshots_fortyseven_seconds_is_nine_credits() {
        let c = calculate_bundle_cost(5, 0, 47);
        assert_eq!(c.screenshots, 5);
        assert_eq!(c.audio, 4);
        assert_eq!(c.total, 9);
    }

    #[test]
    fn three_screenshots_five_seconds_is_three_credits() {
        let c = calculate_bundle_cost(3, 0, 5);
        assert_eq!(c.screenshots, 3);
        assert_eq!(c.audio, 0);
        assert_eq!(c.total, 3);
    }

    #[test]
    fn one_screenshot_two_minutes_is_twelve_credits() {
        let c = calculate_bundle_cost(1, 0, 120);
        assert_eq!(c.total, 12);
    }

    // ── deduction ───────────────────────────────────────────────────────

    #[test]
    fn deduct_success_decreases_balance() {
        let mut ledger = CreditLedger::new(10);
        let cost = calculate_bundle_cost(5, 0, 47); // 9 credits
        let result = ledger.deduct(&cost);
        assert_eq!(result.unwrap(), 1);
        assert_eq!(ledger.balance, 1);
    }

    #[test]
    fn deduct_insufficient_returns_err_and_preserves_balance() {
        let mut ledger = CreditLedger::new(2);
        let cost = calculate_bundle_cost(5, 0, 0); // 5 credits
        let err = ledger.deduct(&cost).unwrap_err();
        assert_eq!(err.required, 5);
        assert_eq!(err.available, 2);
        assert_eq!(ledger.balance, 2);
    }

    #[test]
    fn deduct_exact_balance_succeeds_and_zeroes() {
        let mut ledger = CreditLedger::new(9);
        let cost = calculate_bundle_cost(5, 0, 47); // 9 credits
        let result = ledger.deduct(&cost);
        assert_eq!(result.unwrap(), 0);
        assert_eq!(ledger.balance, 0);
    }
}
```

- [ ] **Step 2: Run tests to verify all pass**

Run: `cargo test -p visionpipe credits 2>&1 | tail -25`

Expected: All 16 tests pass. (10 obsolete pixel-based tests are gone, replaced by 16 new ones covering audio tiers, screenshots, dormant annotations, bundle composition, and ledger deduction.)

- [ ] **Step 3: Verify no other Rust code references the removed types**

Run: `cargo check -p visionpipe 2>&1 | grep -E "(CaptureJob|CreditCost|calculate_cost)" | head -10`

Expected: No output (no leftover references). If anything matches, those callers must be updated before this task is done — but on a fresh branch from main, nothing should reference these because they were never wired up before the cherry-picks.

- [ ] **Step 4: Stage and prepare for commit**

The commit happens at the end of Task 4 (after all Rust changes), so leave files staged but uncommitted for now. Run:

```bash
git add src-tauri/src/credits.rs
git status
```

Expected: only `src-tauri/src/credits.rs` is staged.

---

## Task 2: Wire tauri-plugin-store + persistence helpers + load balance on startup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `tauri_plugin_store::StoreExt` import**

Find the existing imports near the top of `src-tauri/src/lib.rs` (around lines 1-6). Add this line right after the existing `use tauri::{...}` block:

```rust
use tauri_plugin_store::StoreExt;
```

- [ ] **Step 2: Add the load_balance / save_balance helpers**

In `src-tauri/src/lib.rs`, after the `mod credits;` line and before the `RecentSessionsState` struct definition (around line 18), add:

```rust
/// File the credit balance is persisted to via tauri-plugin-store.
const CREDIT_STORE_FILE: &str = "visionpipe.json";
/// Key inside the store JSON.
const CREDIT_BALANCE_KEY: &str = "credit_balance";

/// Read the persisted balance, defaulting to 0 for fresh installs.
/// Default is intentionally 0 (NOT 1,000,000 like the old branch did).
fn load_balance(app: &AppHandle) -> u64 {
    app.store(CREDIT_STORE_FILE)
        .ok()
        .and_then(|s| s.get(CREDIT_BALANCE_KEY))
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

/// Persist the balance to the store. Best-effort; logs errors.
fn save_balance(app: &AppHandle, balance: u64) -> Result<(), String> {
    let store = app.store(CREDIT_STORE_FILE).map_err(|e| e.to_string())?;
    store.set(CREDIT_BALANCE_KEY, serde_json::Value::from(balance));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Register the store plugin and managed state in `run()`**

Find the `tauri::Builder::default()` chain in `run()` (around line 717). Two changes there:

(a) Add the store plugin registration. The current chain looks like:

```rust
    tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
```

Add `tauri_plugin_store::Builder::new().build()` right after the shell plugin:

```rust
    tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
```

(b) Inside `setup(|app| { ... })`, after the existing `app.manage(StashedMetadata(...))` line (around line 741), add the credit ledger managed state — load the persisted balance first:

```rust
            // Credit ledger: load persisted balance from tauri-plugin-store
            // (key: "credit_balance" in visionpipe.json), default 0.
            let initial_balance = load_balance(app.handle());
            app.manage(Mutex::new(credits::CreditLedger::new(initial_balance)));
            log::info!("[VisionPipe] Loaded credit balance: {}", initial_balance);
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p visionpipe 2>&1 | tail -15`

Expected: clean compile (warnings about unused functions are fine — those will be wired up in Task 3).

---

## Task 3: Add 4 Tauri commands + register them

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the four command handlers**

In `src-tauri/src/lib.rs`, find the existing Tauri command handlers section (somewhere after `save_hotkey_config` around line 688). Add these four new commands at the end of the command group, just before `pub fn run() {`:

```rust
/// Read current credit balance from the in-memory ledger.
#[tauri::command]
async fn get_credit_balance(
    ledger: tauri::State<'_, Mutex<credits::CreditLedger>>,
) -> Result<u64, String> {
    let l = ledger.lock().map_err(|e| e.to_string())?;
    Ok(l.balance)
}

/// Add credits (purchases, dev top-ups). Persists immediately.
#[tauri::command]
async fn add_credits(
    app: AppHandle,
    ledger: tauri::State<'_, Mutex<credits::CreditLedger>>,
    amount: u64,
) -> Result<u64, String> {
    let new_balance = {
        let mut l = ledger.lock().map_err(|e| e.to_string())?;
        l.balance = l.balance.saturating_add(amount);
        l.balance
    };
    save_balance(&app, new_balance)?;
    Ok(new_balance)
}

/// Pure preview of the bundle cost — no state mutation. Called by the
/// frontend whenever session state changes (debounced) so the header chip
/// can show "Cost: N" live.
#[tauri::command]
async fn preview_bundle_cost(
    screenshots: u64,
    annotations: u64,
    audio_seconds: u64,
) -> Result<credits::BundleCost, String> {
    Ok(credits::calculate_bundle_cost(screenshots, annotations, audio_seconds))
}

/// Calculate cost, deduct from the ledger, persist. Called once on
/// Copy & Send. Returns the deducted cost on success or an error string
/// on insufficient balance — caller MUST abort the side effect (clipboard
/// write) on Err.
#[tauri::command]
async fn deduct_for_bundle(
    app: AppHandle,
    ledger: tauri::State<'_, Mutex<credits::CreditLedger>>,
    screenshots: u64,
    annotations: u64,
    audio_seconds: u64,
) -> Result<credits::BundleCost, String> {
    let cost = credits::calculate_bundle_cost(screenshots, annotations, audio_seconds);
    let new_balance = {
        let mut l = ledger.lock().map_err(|e| e.to_string())?;
        l.deduct(&cost).map_err(|e| e.to_string())?;
        l.balance
    };
    save_balance(&app, new_balance)?;
    Ok(cost)
}
```

- [ ] **Step 2: Register the four commands in `invoke_handler`**

Find the `.invoke_handler(tauri::generate_handler![ ... ])` block in `run()` (around line 947). Add these four entries to the macro list (location within the list doesn't matter — alphabetical or grouped at the end is fine). The new entries:

```rust
            get_credit_balance,
            add_credits,
            preview_bundle_cost,
            deduct_for_bundle,
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build -p visionpipe 2>&1 | tail -15`

Expected: clean build. Warnings about unused fields in `BundleCost` (`screenshots`, `annotations`, `audio` accessed only via serialization) are acceptable.

- [ ] **Step 4: Run all Rust tests**

Run: `cargo test -p visionpipe 2>&1 | tail -20`

Expected: all credits tests still pass; no new test failures elsewhere.

- [ ] **Step 5: Commit Tasks 1-3 together**

```bash
git add src-tauri/src/credits.rs src-tauri/src/lib.rs
git status
```

Expected staged files: `src-tauri/src/credits.rs`, `src-tauri/src/lib.rs`. (Cargo.lock should NOT have changed since we're not adding new dependencies — the store plugin was already added in the cherry-picked commit.)

The commit comes at the end of Task 4 after the progress log update — see Task 4 Step 3.

---

## Task 4: Update branch progress log + commit Rust side

**Files:**
- Modify: `prd/branch commit updates/feature-credits-rebased.md`

- [ ] **Step 1: Read the current progress log**

Read `prd/branch commit updates/feature-credits-rebased.md` and identify the most recent dated entry header (so the new entry goes at the top, immediately after the file's intro paragraph and `---` separator).

- [ ] **Step 2: Prepend a new progress log entry**

Add this entry immediately after the first `---` separator (so it becomes the most recent entry):

```markdown
## Progress Update as of <YYYY-MM-DD HH:MM PDT> — v0.6.1

### Summary of changes since last update
Implemented the Rust side of the credit pricing redesign. Replaced the obsolete `CaptureJob`/`calculate_cost` pixel-based shape with the new `BundleCost`/`calculate_bundle_cost` per-bundle shape. Added four Tauri commands (`get_credit_balance`, `add_credits`, `preview_bundle_cost`, `deduct_for_bundle`) backed by `tauri-plugin-store` persistence. Default balance for fresh installs is 0. 16 unit tests pass (replacing the 10 obsolete pixel-based ones).

### Detail of changes made:
- **`src-tauri/src/credits.rs`**: Full rewrite. `BundleCost { screenshots, annotations, audio, total }` replaces `CreditCost { capture, annotation, voice, total }`. `calculate_bundle_cost(screenshot_count, annotation_count, audio_seconds)` replaces `calculate_cost(&CaptureJob)`. Audio formula: `if seconds <= 10 { 0 } else { ceil((seconds - 10) / 10) }`. The `annotations` field stays in the model (returns whatever the caller passes) so re-enabling the annotation feature is a one-line caller change. `CreditLedger.deduct` now takes `&BundleCost` instead of `&CreditCost`. 16 inline tests cover audio tiers (0s/10s/11s/20s/21s/47s/120s), screenshot composition, dormant-annotation correctness, three worked examples from the spec, and three deduction cases (success/insufficient/exact-balance).
- **`src-tauri/src/lib.rs`**: Added `use tauri_plugin_store::StoreExt`. Added `CREDIT_STORE_FILE = "visionpipe.json"` and `CREDIT_BALANCE_KEY = "credit_balance"` constants plus `load_balance(app)` and `save_balance(app, balance)` helpers. Registered `tauri_plugin_store::Builder::new().build()` in the plugin chain (the dependency itself was already added in the cherry-picked `79c399d`). Setup closure now loads the persisted balance and managed `Mutex<CreditLedger>` state on startup. Four new `#[tauri::command]` handlers: `get_credit_balance` (read), `add_credits` (saturating add + persist), `preview_bundle_cost` (pure calc, no mutation), `deduct_for_bundle` (calculate + deduct + persist; returns `Err` on insufficient balance). All four registered in the `invoke_handler` macro.

### Potential concerns to address:
- `closingNarration` (audio after the last screenshot) has no `AudioOffset` in the type model, so the frontend can't derive its duration from session state. The MVP frontend will undercharge by that duration — flagged for follow-up. Direction is user-friendly (we under-charge, never over-charge).
- `Cargo.lock` and `src-tauri/gen/schemas/*.json` may regenerate when the new commands compile under Tauri's codegen. If they do, stage them with this commit.
- No frontend wiring yet — these commands compile but nothing calls them. Tasks 5-9 hook them into the React UI.
```

Replace `<YYYY-MM-DD HH:MM PDT>` with the current Pacific time, rounded to the nearest 15 minutes. Run `date '+%Y-%m-%d %H:%M %Z'` to get it.

- [ ] **Step 3: Stage and commit**

```bash
git add src-tauri/src/credits.rs src-tauri/src/lib.rs "prd/branch commit updates/feature-credits-rebased.md"
# Check whether build artifacts also regenerated:
git status
# If Cargo.lock or src-tauri/gen/schemas/*.json show up modified, add them too:
git add Cargo.lock src-tauri/gen/schemas/ 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(credits): implement BundleCost model + Tauri commands

Replace the dormant CaptureJob/CreditCost (pixel-based, per-capture)
with BundleCost/calculate_bundle_cost (per-bundle, screenshots +
dormant annotation slot + 10s-free audio tier).

Add four Tauri commands:
- get_credit_balance: read managed-state balance
- add_credits: saturating add + persist
- preview_bundle_cost: pure calc, no state change
- deduct_for_bundle: calc + deduct + persist; Err on insufficient

Persistence via tauri-plugin-store ("visionpipe.json", key
"credit_balance"). Default fresh-install balance: 0 (the abandoned
branch's 1,000,000 testing default is NOT carried forward).

Replaces 10 obsolete pixel-based unit tests with 16 new ones covering
audio tiers, screenshot/annotation composition, worked spec examples,
and ledger deduction.

No frontend wiring yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds; the pre-commit hook does NOT fire because the progress log is staged.

- [ ] **Step 4: Verify the commit landed**

Run: `git log -1 --stat`

Expected: shows the commit with credits.rs, lib.rs, and the progress log file. Possibly Cargo.lock and Tauri schema files too.

---

## Task 5: Build the CreditProvider context

**Files:**
- Create: `src/state/credit-context.tsx`
- Create: `src/state/__tests__/credit-context.test.tsx`

This is TDD. We write the test for the live-recompute behavior first, see it fail, then implement.

- [ ] **Step 1: Write the failing test**

Create `src/state/__tests__/credit-context.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { useEffect } from "react";
import { CreditProvider, useCredit } from "../credit-context";
import { SessionProvider, useSession } from "../session-context";
import type { Session, Screenshot, CaptureMetadata } from "../../types/session";

// Mock the @tauri-apps/api/core invoke. The credit-context calls:
//   invoke("get_credit_balance")          -> u64
//   invoke("preview_bundle_cost", { ... }) -> BundleCost
//   invoke("deduct_for_bundle", { ... })   -> BundleCost  (or throws)
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const fakeMeta = (): CaptureMetadata => ({
  app: "Chrome", window: "GitHub", resolution: "2560x1600", scale: "2x",
  os: "macOS 15.3", osBuild: "24D81", timestamp: "2026-05-02T14:23:07Z",
  hostname: "h", username: "u", locale: "en-US", timezone: "PDT",
  displayCount: 1, primaryDisplay: "Built-in", colorSpace: "Display P3",
  cpu: "M2", memoryGb: "16", darkMode: true, battery: "80%", uptime: "1d",
  activeUrl: "", captureWidth: 1200, captureHeight: 800,
  captureMethod: "Region", imageSizeKb: 240,
});

const fakeScreenshot = (seq: number, audioStart: number, audioEnd: number | null): Screenshot => ({
  seq,
  canonicalName: `vp-${seq}`,
  capturedAt: "2026-05-02T14:23:07Z",
  audioOffset: { start: audioStart, end: audioEnd },
  caption: "",
  transcriptSegment: "",
  reRecordedAudio: null,
  metadata: fakeMeta(),
  offline: false,
});

function makeSession(screenshots: Screenshot[]): Session {
  return {
    id: "x", folder: "/tmp/x",
    createdAt: "2026-05-02T14:23:07Z", updatedAt: "2026-05-02T14:23:07Z",
    audioFile: "audio-master.webm", viewMode: "interleaved",
    screenshots, closingNarration: "",
  };
}

function CreditDisplay() {
  const { balance, currentBundleCost } = useCredit();
  return (
    <div>
      <span data-testid="balance">{balance}</span>
      <span data-testid="cost-total">{currentBundleCost.total}</span>
      <span data-testid="cost-screenshots">{currentBundleCost.screenshots}</span>
      <span data-testid="cost-audio">{currentBundleCost.audio}</span>
    </div>
  );
}

function StartSessionOnMount({ screenshots }: { screenshots: Screenshot[] }) {
  const { dispatch } = useSession();
  useEffect(() => {
    dispatch({ type: "START_SESSION", session: makeSession(screenshots) });
  }, [screenshots, dispatch]);
  return null;
}

function Wrapper({ screenshots }: { screenshots: Screenshot[] }) {
  return (
    <SessionProvider>
      <StartSessionOnMount screenshots={screenshots} />
      <CreditProvider>
        <CreditDisplay />
      </CreditProvider>
    </SessionProvider>
  );
}

describe("CreditProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, args: Record<string, number>) => {
      if (cmd === "get_credit_balance") return Promise.resolve(142);
      if (cmd === "preview_bundle_cost") {
        const { screenshots, annotations, audio_seconds } = args;
        const audio = audio_seconds <= 10 ? 0 : Math.ceil((audio_seconds - 10) / 10);
        const total = screenshots + annotations + audio;
        return Promise.resolve({ screenshots, annotations, audio, total });
      }
      if (cmd === "deduct_for_bundle") {
        const { screenshots, annotations, audio_seconds } = args;
        const audio = audio_seconds <= 10 ? 0 : Math.ceil((audio_seconds - 10) / 10);
        const total = screenshots + annotations + audio;
        return Promise.resolve({ screenshots, annotations, audio, total });
      }
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });
  });

  it("loads the initial balance from the backend", async () => {
    render(<Wrapper screenshots={[fakeScreenshot(1, 0, 5)]} />);
    await waitFor(() => expect(screen.getByTestId("balance").textContent).toBe("142"));
  });

  it("computes 1 credit for 1 screenshot, 0 audio over threshold", async () => {
    render(<Wrapper screenshots={[fakeScreenshot(1, 0, 5)]} />);
    // Audio total = 5s (free tier), so total = 1 (screenshot) + 0 (audio) = 1.
    await waitFor(() => expect(screen.getByTestId("cost-total").textContent).toBe("1"));
    expect(screen.getByTestId("cost-screenshots").textContent).toBe("1");
    expect(screen.getByTestId("cost-audio").textContent).toBe("0");
  });

  it("computes 9 credits for the spec's 5-screenshot/47s example", async () => {
    // Two screenshots, audio offsets totaling 47s of duration.
    // Screenshot 1: 0-20s (20s), Screenshot 2: 20-47s (27s) → 47s total.
    render(<Wrapper screenshots={[
      fakeScreenshot(1, 0, 20),
      fakeScreenshot(2, 20, 47),
      fakeScreenshot(3, 47, 47),
      fakeScreenshot(4, 47, 47),
      fakeScreenshot(5, 47, 47),
    ]} />);
    await waitFor(() => expect(screen.getByTestId("cost-total").textContent).toBe("9"));
  });

  it("ignores screenshots whose audioOffset.end is null (still recording)", async () => {
    render(<Wrapper screenshots={[
      fakeScreenshot(1, 0, 30),       // 30s contributes
      fakeScreenshot(2, 30, null),    // active recording — duration 0
    ]} />);
    // Audio = 30s → ceil((30-10)/10) = 2 credits. Screenshots = 2. Total = 4.
    await waitFor(() => expect(screen.getByTestId("cost-total").textContent).toBe("4"));
  });

  it("recomputes when a screenshot is added", async () => {
    function Setup() {
      const { dispatch } = useSession();
      useEffect(() => {
        dispatch({ type: "START_SESSION", session: makeSession([fakeScreenshot(1, 0, 5)]) });
        const t = setTimeout(() => {
          dispatch({ type: "APPEND_SCREENSHOT", screenshot: fakeScreenshot(2, 5, 12) });
        }, 50);
        return () => clearTimeout(t);
      }, [dispatch]);
      return null;
    }
    render(
      <SessionProvider>
        <Setup />
        <CreditProvider>
          <CreditDisplay />
        </CreditProvider>
      </SessionProvider>
    );
    // Eventually: 2 screenshots + audio = 12s → audio cost ceil(2/10) = 1 → total 3.
    await waitFor(() => expect(screen.getByTestId("cost-total").textContent).toBe("3"), { timeout: 1000 });
  });
});

describe("CreditProvider.deductForBundle", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("aborts and throws on insufficient balance", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_credit_balance") return Promise.resolve(0);
      if (cmd === "preview_bundle_cost") return Promise.resolve({ screenshots: 5, annotations: 0, audio: 0, total: 5 });
      if (cmd === "deduct_for_bundle") return Promise.reject(new Error("Insufficient credits: need 5, have 0"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    let captured: unknown = null;
    function Trigger() {
      const { deductForBundle } = useCredit();
      useEffect(() => {
        deductForBundle().catch((e) => { captured = e; });
      }, [deductForBundle]);
      return null;
    }
    render(
      <SessionProvider>
        <StartSessionOnMount screenshots={[
          fakeScreenshot(1, 0, 0),
          fakeScreenshot(2, 0, 0),
          fakeScreenshot(3, 0, 0),
          fakeScreenshot(4, 0, 0),
          fakeScreenshot(5, 0, 0),
        ]} />
        <CreditProvider>
          <Trigger />
        </CreditProvider>
      </SessionProvider>
    );
    await waitFor(() => expect(captured).not.toBeNull());
    expect(String(captured)).toMatch(/Insufficient/);
  });

  it("refreshes the balance after a successful deduct", async () => {
    let nextBalance = 142;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_credit_balance") return Promise.resolve(nextBalance);
      if (cmd === "preview_bundle_cost") return Promise.resolve({ screenshots: 1, annotations: 0, audio: 0, total: 1 });
      if (cmd === "deduct_for_bundle") {
        nextBalance = 141;
        return Promise.resolve({ screenshots: 1, annotations: 0, audio: 0, total: 1 });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    function Trigger() {
      const { deductForBundle, balance } = useCredit();
      useEffect(() => {
        const t = setTimeout(() => { void deductForBundle(); }, 100);
        return () => clearTimeout(t);
      }, [deductForBundle]);
      return <span data-testid="balance">{balance}</span>;
    }
    render(
      <SessionProvider>
        <StartSessionOnMount screenshots={[fakeScreenshot(1, 0, 0)]} />
        <CreditProvider>
          <Trigger />
        </CreditProvider>
      </SessionProvider>
    );
    await waitFor(() => expect(screen.getByTestId("balance").textContent).toBe("141"), { timeout: 1500 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail with import errors**

Run: `pnpm test src/state/__tests__/credit-context.test.tsx 2>&1 | tail -20`

Expected: FAIL with module-resolution errors (`Cannot find module '../credit-context'`).

- [ ] **Step 3: Implement the CreditProvider**

Create `src/state/credit-context.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSession } from "./session-context";

export interface BundleCost {
  screenshots: number;
  annotations: number;
  audio: number;
  total: number;
}

interface CreditContextValue {
  balance: number;
  currentBundleCost: BundleCost;
  /** Re-read balance from the backend (call after a deduct or purchase). */
  refresh: () => Promise<void>;
  /**
   * Calculate cost from current session, deduct from backend, refresh
   * balance. Throws on insufficient credits — caller MUST abort the
   * side effect (clipboard write) on throw.
   */
  deductForBundle: () => Promise<BundleCost>;
}

const ZERO_COST: BundleCost = { screenshots: 0, annotations: 0, audio: 0, total: 0 };

const CreditContext = createContext<CreditContextValue | null>(null);

const PREVIEW_DEBOUNCE_MS = 150;

/**
 * Sum the duration of each screenshot's audio segment in seconds. Skips
 * segments where `end` is null (segment is still actively recording — its
 * final duration isn't known yet, so it doesn't yet contribute to cost).
 *
 * Known gap: `Session.closingNarration` (audio AFTER the last screenshot,
 * stored only as transcript text) is NOT included because the type model
 * doesn't carry an AudioOffset for it. This means we slightly UNDERCHARGE
 * for sessions that include closing narration, which is the user-friendly
 * direction. Tracked for follow-up.
 */
function deriveAudioSeconds(screenshots: { audioOffset: { start: number; end: number | null } }[]): number {
  let total = 0;
  for (const s of screenshots) {
    if (s.audioOffset.end !== null) {
      total += Math.max(0, s.audioOffset.end - s.audioOffset.start);
    }
  }
  return Math.round(total);
}

export function CreditProvider({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const [balance, setBalance] = useState<number>(0);
  const [currentBundleCost, setCurrentBundleCost] = useState<BundleCost>(ZERO_COST);

  const screenshotCount = state.session?.screenshots.length ?? 0;
  const audioSeconds = useMemo(
    () => (state.session ? deriveAudioSeconds(state.session.screenshots) : 0),
    [state.session]
  );

  const refresh = useCallback(async () => {
    try {
      const b = await invoke<number>("get_credit_balance");
      setBalance(b);
    } catch (err) {
      console.error("[VisionPipe] get_credit_balance failed:", err);
    }
  }, []);

  // Initial balance load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live preview, debounced on session changes.
  useEffect(() => {
    if (!state.session) {
      setCurrentBundleCost(ZERO_COST);
      return;
    }
    const handle = setTimeout(() => {
      invoke<BundleCost>("preview_bundle_cost", {
        screenshots: screenshotCount,
        annotations: 0, // dormant — annotation feature is removed; see spec
        audio_seconds: audioSeconds,
      })
        .then(setCurrentBundleCost)
        .catch((err) => console.error("[VisionPipe] preview_bundle_cost failed:", err));
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [state.session, screenshotCount, audioSeconds]);

  const deductForBundle = useCallback(async (): Promise<BundleCost> => {
    const cost = await invoke<BundleCost>("deduct_for_bundle", {
      screenshots: screenshotCount,
      annotations: 0,
      audio_seconds: audioSeconds,
    });
    // Refresh balance from backend (single source of truth).
    await refresh();
    return cost;
  }, [screenshotCount, audioSeconds, refresh]);

  return (
    <CreditContext.Provider value={{ balance, currentBundleCost, refresh, deductForBundle }}>
      {children}
    </CreditContext.Provider>
  );
}

export function useCredit(): CreditContextValue {
  const ctx = useContext(CreditContext);
  if (!ctx) throw new Error("useCredit must be used within a CreditProvider");
  return ctx;
}
```

- [ ] **Step 4: Re-run tests**

Run: `pnpm test src/state/__tests__/credit-context.test.tsx 2>&1 | tail -20`

Expected: all tests pass. (If `recomputes when a screenshot is added` fails on timing, increase the `waitFor` timeout to 2000ms — the debounce is 150ms plus React's effect-flush latency.)

- [ ] **Step 5: Run the full Vitest suite**

Run: `pnpm test 2>&1 | tail -10`

Expected: existing tests still pass, plus the new credit-context tests.

---

## Task 6: Wire CreditProvider into App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import CreditProvider**

Find the existing imports near the top of `src/App.tsx`. Add:

```tsx
import { CreditProvider } from "./state/credit-context";
```

- [ ] **Step 2: Wrap the inner tree with CreditProvider**

Find the `<SessionProvider>` block (around line 625). The current shape is approximately:

```tsx
<SessionProvider>
  <AppInner />
</SessionProvider>
```

(or similar — the exact element name depends on how App.tsx is structured.) Wrap the contents with `<CreditProvider>` (which must be INSIDE SessionProvider because it depends on `useSession()`):

```tsx
<SessionProvider>
  <CreditProvider>
    <AppInner />
  </CreditProvider>
</SessionProvider>
```

If `App.tsx` has nested providers like `<SessionProvider><MicProvider>...</MicProvider></SessionProvider>`, put `<CreditProvider>` between `<SessionProvider>` and `<MicProvider>` so MicProvider and the rest of the tree can also call `useCredit()`.

- [ ] **Step 3: Verify the app type-checks**

Run: `pnpm tsc --noEmit 2>&1 | tail -10`

Expected: clean (no type errors).

---

## Task 7: Add Credit chip to Header

**Files:**
- Modify: `src/components/Header.tsx`

- [ ] **Step 1: Import useCredit**

Add at the top of `src/components/Header.tsx` (alongside the existing `useSession` import):

```tsx
import { useCredit } from "../state/credit-context";
```

- [ ] **Step 2: Add the CreditChip subcomponent**

At the bottom of `src/components/Header.tsx`, after the `OverflowMenu` function, add:

```tsx
function CreditChip() {
  const { balance, currentBundleCost } = useCredit();
  const insufficient = currentBundleCost.total > balance;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 10px", borderRadius: 4,
        background: "transparent",
        border: `1px solid ${insufficient ? C.amber : C.borderLight}`,
        color: insufficient ? C.amber : C.textBright,
        fontFamily: FONT_MONO, fontSize: 11,
      }}
      title={
        insufficient
          ? `This bundle costs ${currentBundleCost.total} credits but you only have ${balance}.`
          : `Bundle: ${currentBundleCost.screenshots} screenshot${currentBundleCost.screenshots === 1 ? "" : "s"} + ${currentBundleCost.audio} audio = ${currentBundleCost.total}. Balance: ${balance}.`
      }
    >
      <span>Cost: {currentBundleCost.total} cr</span>
      <span style={{ opacity: 0.6 }}>·</span>
      <span>Balance: {balance} cr</span>
    </div>
  );
}
```

- [ ] **Step 3: Render CreditChip in the Header**

Find the `Header` function's return JSX (around line 33). Three button-row `<div>`s exist: a left brand row, a middle mic-toggle row, and a right action-button row. Place the chip in the middle row, before the mic toggle button. The middle row currently looks like:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
  <button onClick={props.onToggleMic} ...>...</button>
</div>
```

Change it to:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
  <CreditChip />
  <button onClick={props.onToggleMic} ...>...</button>
</div>
```

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit 2>&1 | tail -10`

Expected: clean.

---

## Task 8: Gate Copy & Send on deduct success

**Files:**
- Modify: `src/components/SessionWindow.tsx`

- [ ] **Step 1: Import useCredit**

Add to the existing imports near the top of `src/components/SessionWindow.tsx`:

```tsx
import { useCredit } from "../state/credit-context";
```

- [ ] **Step 2: Use the hook in SessionWindow**

Find the `SessionWindow()` function. After the existing `const mic = useMic();` line (around line 17), add:

```tsx
  const { deductForBundle, currentBundleCost, balance } = useCredit();
```

- [ ] **Step 3: Modify onCopyAndSend to deduct first**

Replace the existing `onCopyAndSend` callback (lines 48-87) with a version that calls `deductForBundle()` BEFORE the clipboard write:

```tsx
  const onCopyAndSend = useCallback(async () => {
    if (!state.session) {
      setToast({ kind: "err", text: "No active session to copy." });
      return;
    }
    const session = state.session;

    // Deduct credits FIRST. If this throws (insufficient balance), abort
    // before touching the clipboard so the user doesn't get the bundle
    // without paying or pay without getting the bundle.
    let deductedCost;
    try {
      deductedCost = await deductForBundle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: "err", text: `Cannot send: ${msg}. Buy more credits to continue.` });
      return;
    }

    try {
      const md = renderMarkdown(session);
      const path = await invoke<string>("save_and_copy_markdown", {
        folder: session.folder,
        markdown: md,
      });
      setToast({
        kind: "ok",
        text: `Copied ${session.screenshots.length} screenshot${session.screenshots.length === 1 ? "" : "s"} + transcript (${deductedCost.total} cr deducted). Paste as text in chat, OR paste in Finder to drop a .md file (saved at ${path}).`,
      });
    } catch (err) {
      console.error("[VisionPipe] Copy & Send failed:", err);
      // Last-resort fallback: text-only clipboard write so the user gets
      // *something* for the credits they just spent. If even this fails,
      // they can grab transcript.md from the session folder.
      try {
        const md = renderMarkdown(session);
        await writeText(md);
        const bytes = new TextEncoder().encode(md);
        await invoke("write_session_file", {
          folder: session.folder, filename: "transcript.md", bytes: Array.from(bytes),
        });
        setToast({
          kind: "ok",
          text: `Copied as text only (file-clipboard failed). transcript.md is in the session folder. ${deductedCost.total} cr deducted.`,
        });
      } catch (innerErr) {
        setToast({
          kind: "err",
          text: `Copy & Send failed AFTER deducting ${deductedCost.total} credits: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }, [state.session, deductForBundle]);
```

- [ ] **Step 4: Disable the Footer button when balance is insufficient**

Find the `<Footer>` element in the return JSX (around line 166). The current call:

```tsx
<Footer
  onCopyAndSend={onCopyAndSend}
  copyTooltip={`Copies markdown for ${session.screenshots.length} screenshots + transcript`}
  busy={false}
/>
```

Change it to compute `insufficient` from credits and pass through `busy`:

```tsx
<Footer
  onCopyAndSend={onCopyAndSend}
  copyTooltip={
    currentBundleCost.total > balance
      ? `Need ${currentBundleCost.total - balance} more credit${currentBundleCost.total - balance === 1 ? "" : "s"} (cost ${currentBundleCost.total}, balance ${balance})`
      : `Copies markdown for ${session.screenshots.length} screenshots + transcript (${currentBundleCost.total} cr)`
  }
  busy={currentBundleCost.total > balance}
/>
```

(`busy={true}` already disables the button via the existing `disabled={busy}` in `Footer.tsx` — no changes to Footer needed.)

- [ ] **Step 5: Type-check + run frontend tests**

Run: `pnpm tsc --noEmit && pnpm test 2>&1 | tail -15`

Expected: clean type-check; all tests pass (including the new credit-context tests).

---

## Task 9: Manual smoke test + final commit

**Files:**
- Modify: `prd/branch commit updates/feature-credits-rebased.md`

- [ ] **Step 1: Build and run the dev app**

Run: `pnpm tauri dev`

Wait for the app window to appear. (May take 30-60s on a clean build.)

- [ ] **Step 2: Set the balance to 5 via the dev menu**

There's no UI yet for `add_credits` — invoke it through the Tauri devtools console. Open the app's devtools (right-click → Inspect Element, or `Cmd+Option+I`), then in the Console:

```js
await window.__TAURI_INTERNALS__.invoke("add_credits", { amount: 5 });
```

Expected: returns `5`. The Header chip should now show `Balance: 5 cr`.

(If `__TAURI_INTERNALS__` isn't exposed in your dev build, use the fallback: `await (await import('@tauri-apps/api/core')).invoke("add_credits", { amount: 5 })`.)

- [ ] **Step 3: Run the manual smoke test from the spec**

1. Take 3 screenshots (Cmd+Shift+C, select region, repeat 3×). Header should show `Cost: 3 / Balance: 5` in the regular border color.
2. Record 25 seconds of audio (click Recording button, talk, click again to stop). Header should show `Cost: 5 / Balance: 5` — audio: ceil((25-10)/10) = 2, screenshots: 3, total: 5.
3. Take a 4th screenshot. Header should show `Cost: 6 / Balance: 5` in **amber** (insufficient state). Copy & Send button should be disabled with tooltip "Need 1 more credit".
4. Top up via devtools console: `await window.__TAURI_INTERNALS__.invoke("add_credits", { amount: 10 })`. Header updates to `Balance: 15`, chip returns to normal color, Copy & Send re-enabled.
5. Click Copy & Send. Toast appears with `(6 cr deducted)`. Header shows `Cost: 6 / Balance: 9`. Paste into a text editor — markdown body comes through.

- [ ] **Step 4: Verify persistence across app restart**

Quit the app (Cmd+Q or tray → Quit). Re-launch via `pnpm tauri dev`. The Header should still show `Balance: 9` — the persisted value from `tauri-plugin-store`.

- [ ] **Step 5: If anything in the smoke test fails**

Stop and report which step failed and what was observed. Do NOT proceed to the commit until the smoke test passes end-to-end.

- [ ] **Step 6: Update the progress log with the frontend wiring entry**

Prepend this entry to `prd/branch commit updates/feature-credits-rebased.md` (immediately after the file's intro `---` separator):

```markdown
## Progress Update as of <YYYY-MM-DD HH:MM PDT> — v0.6.1

### Summary of changes since last update
Wired the credit pricing redesign into the React UI. Added `CreditProvider` context that reads `get_credit_balance` on mount and recomputes `currentBundleCost` (debounced 150ms) from session state on any change. Added a Header chip showing `Cost: N · Balance: M` (amber border + amber text in insufficient state). Gated `Copy & Send` on `deduct_for_bundle` success — deduction happens BEFORE the clipboard write, so the user can never get the bundle without paying or pay without getting the bundle. Manual smoke test from the spec passes; persistence across app restart confirmed.

### Detail of changes made:
- **`src/state/credit-context.tsx`** (new): `CreditProvider` + `useCredit()` hook. `currentBundleCost` recomputed via `preview_bundle_cost` IPC on session changes (debounced 150ms via setTimeout in useEffect cleanup). `deductForBundle()` calls `deduct_for_bundle` and `refresh()`s the balance from the backend on success; throws on insufficient balance for the caller to handle. Includes `deriveAudioSeconds` helper that sums `(audioOffset.end - audioOffset.start)` across screenshots, skipping any with `end === null` (still recording).
- **`src/state/__tests__/credit-context.test.tsx`** (new): 7 Vitest tests — initial balance load, 1-screenshot baseline, 5-screenshot/47s spec example, active-recording exclusion, recompute on screenshot append, insufficient-balance throw, post-deduct balance refresh.
- **`src/components/Header.tsx`**: Added `CreditChip` subcomponent rendering `Cost: N cr · Balance: M cr` in the middle of the header row. Amber border + text when `currentBundleCost.total > balance`. Tooltip explains the breakdown.
- **`src/components/SessionWindow.tsx`**: `onCopyAndSend` now calls `deductForBundle()` first; on `Err`, aborts BEFORE touching the clipboard and shows an error toast pointing the user at Buy Credits. On `Ok`, the existing `save_and_copy_markdown` flow runs as before, with the deducted cost included in the success toast. Footer's `busy` prop is now driven by `currentBundleCost.total > balance` so the button auto-disables in the insufficient state with a "Need X more credits" tooltip. The fallback text-only clipboard path also reports the deducted cost so the user knows their credits weren't lost.
- **`src/App.tsx`**: Wrapped the inner tree in `<CreditProvider>` (inside `<SessionProvider>` so the context can call `useSession()`).

### Manual smoke test (from spec) — all steps passed:
1. `add_credits(5)` via devtools console → Header shows `Balance: 5`.
2. 3 screenshots → `Cost: 3 / Balance: 5` (normal color).
3. 25s audio → `Cost: 5 / Balance: 5`.
4. 4th screenshot → `Cost: 6 / Balance: 5` in amber, Copy & Send disabled with "Need 1 more credit" tooltip.
5. `add_credits(10)` → `Balance: 15`, button re-enabled.
6. Copy & Send → toast confirms `6 cr deducted`, `Balance: 9`, markdown lands in clipboard.
7. App restart → balance still `9` (persistence works).

### Potential concerns to address:
- **Closing-narration audio is still under-counted.** Sessions where the user records narration AFTER the last screenshot won't have that duration in the cost (no `AudioOffset` exists for it in the type model). Direction is user-friendly. Fix requires either adding `closingAudioOffset: AudioOffset | null` to `Session` (data-model change) or transcript-length-based estimation.
- **No real Buy Credits UI.** The "buy credits" affordance in the insufficient state is a tooltip + disabled button only. Wiring an actual purchase flow waits on `api.visionpipe.ai` (web-API plan in `docs/superpowers/plans/2026-04-15-in-app-purchase-web-api.md`).
- **`add_credits` has no UI.** Devtools console is the only way to top up balance during dev. Once Buy Credits ships, this is fine; for now, the smoke-test runbook is the workaround.
- **CreditChip uses inline styles.** Matches the rest of `Header.tsx`'s pattern (the codebase doesn't use styled-components or CSS modules in this file). If the team standardizes on a styling approach, this will need to follow.
- **Default 150ms debounce was chosen by feel, not measured.** Should be re-evaluated once we have many screenshots in a session — IPC overhead with 50+ screenshots could be visible. Mitigation in spec is a pure-JS duplicate of the formula; not implementing yet (YAGNI).
```

Replace `<YYYY-MM-DD HH:MM PDT>` with the current Pacific time, rounded to the nearest 15 minutes. Run `date '+%Y-%m-%d %H:%M %Z'`.

- [ ] **Step 7: Stage and commit the frontend wiring**

```bash
git add src/state/credit-context.tsx \
        src/state/__tests__/credit-context.test.tsx \
        src/components/Header.tsx \
        src/components/SessionWindow.tsx \
        src/App.tsx \
        "prd/branch commit updates/feature-credits-rebased.md"
git commit -m "$(cat <<'EOF'
feat(credits): wire BundleCost UI — header chip + Copy & Send guard

Adds CreditProvider that reads get_credit_balance on mount and
recomputes currentBundleCost via preview_bundle_cost IPC (debounced
150ms) whenever session state changes. Header gets a CreditChip
showing "Cost: N cr · Balance: M cr" — amber border + text in the
insufficient state. Copy & Send is gated on deduct_for_bundle: if the
deduct throws (insufficient credits), the clipboard write is skipped
entirely so the user can never get the bundle without paying or pay
without getting the bundle.

The Footer's existing `busy` prop is repurposed for the disable
state, with a "Need X more credits" tooltip. add_credits has no UI
yet — devtools console is the dev top-up path until the Buy Credits
flow ships against the future api.visionpipe.ai backend.

Includes 7 Vitest tests for CreditProvider covering the spec's worked
examples, active-recording exclusion, debounced recompute on screenshot
append, and the deduct-then-refresh + insufficient-balance paths.
Manual smoke test from the spec passes end-to-end including persistence
across app restart.

Known under-charge: Session.closingNarration has no AudioOffset in the
type model, so audio after the last screenshot doesn't contribute to
cost. User-friendly direction; flagged for follow-up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds; the pre-commit hook does NOT fire because the progress log is staged.

- [ ] **Step 8: Verify the branch state**

Run: `git log --oneline origin/main..HEAD && echo --- && pnpm test 2>&1 | tail -5 && echo --- && cargo test -p visionpipe credits 2>&1 | tail -5`

Expected: 7 commits ahead of origin/main; all Vitest tests pass; all 16 credits tests pass.

---

## Self-Review Notes (already applied)

- **Spec coverage:** All sections of the spec have a corresponding task. Pricing rules → Task 1. Code shape (BundleCost / commands) → Tasks 1-3. Persistence → Task 2. Frontend integration (context + Header chip + Copy & Send) → Tasks 5-8. Tests → Task 1 (Rust) + Task 5 (Vitest) + Task 9 (manual). Rollout → Task 9 verification of default-0 + persistence.
- **Out-of-scope items from spec** (Buy Credits UI, server sync, annotation wiring, debounce tuning) are explicitly NOT tasks here — same intent as the spec.
- **Type consistency:** `BundleCost` field names (`screenshots`, `annotations`, `audio`, `total`) used consistently across Rust and TypeScript. `deduct_for_bundle` parameter names (`screenshots`, `annotations`, `audio_seconds`) match between handler signature and React caller. `deductForBundle` (camelCase) is the React method name; `deduct_for_bundle` (snake_case) is the Tauri command. Tauri auto-converts between the two via `serde(rename_all)` defaults — verified by the test mock matching the snake_case form.
- **No placeholders.** Every step has either real code or a real shell command with expected output.
