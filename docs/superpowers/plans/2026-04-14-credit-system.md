# Credit System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a credit system that calculates capture cost based on pixel count (ceiling division by 1M), charges annotation (+1) and voice (+1) surcharges, persists balance via `tauri-plugin-store`, and exposes cost preview + balance management to the frontend.

**Architecture:** New `credits.rs` module in `src-tauri/src/` owns all credit logic (calculation, ledger, deduction). Balance is stored in a `Mutex<CreditLedger>` managed by Tauri's state system and persisted to `visionpipe.json` via `tauri-plugin-store`. Three new Tauri commands (`get_credit_balance`, `add_credits`, `preview_capture_cost`) expose the system to the React frontend, which shows a cost breakdown before capture and blocks submission on insufficient balance.

**Tech Stack:** Rust (Tauri v2), `tauri-plugin-store` for persistence, React/TypeScript frontend

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/src/credits.rs` | Create | CreditLedger, CaptureJob, CreditCost structs; `calculate_cost()`, `deduct()` logic; unit tests |
| `src-tauri/src/lib.rs` | Modify | Register 3 new commands, add `tauri-plugin-store` init, manage `Mutex<CreditLedger>` state |
| `src-tauri/Cargo.toml` | Modify | Add `tauri-plugin-store` dependency |
| `src-tauri/capabilities/default.json` | Modify | Add store plugin permissions |
| `src/App.tsx` | Modify | Replace session-only credit tracking with backend-backed balance, cost preview, insufficient-credits guard |

---

### Task 1: Credit Calculation — Pure Logic and Tests

**Files:**
- Create: `src-tauri/src/credits.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod credits;`)

This task implements the core calculation function and all unit tests. No persistence, no Tauri commands — just pure Rust logic.

- [ ] **Step 1: Create `credits.rs` with structs and `calculate_cost`**

Create `src-tauri/src/credits.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLedger {
    pub balance: u64,
}

pub struct CaptureJob {
    pub width: u32,
    pub height: u32,
    pub has_annotation: bool,
    pub has_voice: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditCost {
    pub capture: u64,
    pub annotation: u64,
    pub voice: u64,
    pub total: u64,
}

pub fn calculate_cost(job: &CaptureJob) -> CreditCost {
    let pixels = job.width as u64 * job.height as u64;
    let block_size: u64 = 1_000_000;
    let capture = pixels.div_ceil(block_size);

    let annotation = if job.has_annotation { 1 } else { 0 };
    let voice = if job.has_voice { 1 } else { 0 };
    let total = capture + annotation + voice;

    CreditCost { capture, annotation, voice, total }
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

    pub fn deduct(&mut self, cost: &CreditCost) -> Result<u64, InsufficientCredits> {
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

    #[test]
    fn test_1080p_capture_cost() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 3); // 2,073,600 pixels / 1M = 2.07 -> ceil = 3
        assert_eq!(cost.total, 3);
    }

    #[test]
    fn test_small_region_capture_cost() {
        let job = CaptureJob { width: 400, height: 300, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 1); // 120,000 pixels / 1M = 0.12 -> ceil = 1
        assert_eq!(cost.total, 1);
    }

    #[test]
    fn test_4k_capture_cost() {
        let job = CaptureJob { width: 3840, height: 2160, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 9); // 8,294,400 pixels / 1M = 8.29 -> ceil = 9
        assert_eq!(cost.total, 9);
    }

    #[test]
    fn test_1440p_capture_cost() {
        let job = CaptureJob { width: 2560, height: 1440, has_annotation: false, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.capture, 4); // 3,686,400 / 1M = 3.69 -> ceil = 4
        assert_eq!(cost.total, 4);
    }

    #[test]
    fn test_annotation_surcharge() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: true, has_voice: false };
        let cost = calculate_cost(&job);
        assert_eq!(cost.annotation, 1);
        assert_eq!(cost.voice, 0);
        assert_eq!(cost.total, 4); // 3 capture + 1 annotation
    }

    #[test]
    fn test_voice_surcharge() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: false, has_voice: true };
        let cost = calculate_cost(&job);
        assert_eq!(cost.annotation, 0);
        assert_eq!(cost.voice, 1);
        assert_eq!(cost.total, 4); // 3 capture + 1 voice
    }

    #[test]
    fn test_both_surcharges() {
        let job = CaptureJob { width: 1920, height: 1080, has_annotation: true, has_voice: true };
        let cost = calculate_cost(&job);
        assert_eq!(cost.annotation, 1);
        assert_eq!(cost.voice, 1);
        assert_eq!(cost.total, 5); // 3 + 1 + 1
    }

    #[test]
    fn test_deduction_success() {
        let mut ledger = CreditLedger::new(10);
        let cost = CreditCost { capture: 3, annotation: 1, voice: 0, total: 4 };
        let result = ledger.deduct(&cost);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 6);
        assert_eq!(ledger.balance, 6);
    }

    #[test]
    fn test_deduction_insufficient() {
        let mut ledger = CreditLedger::new(2);
        let cost = CreditCost { capture: 3, annotation: 1, voice: 0, total: 4 };
        let result = ledger.deduct(&cost);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.required, 4);
        assert_eq!(err.available, 2);
        assert_eq!(ledger.balance, 2); // unchanged
    }

    #[test]
    fn test_deduction_exact_balance() {
        let mut ledger = CreditLedger::new(5);
        let cost = CreditCost { capture: 3, annotation: 1, voice: 1, total: 5 };
        let result = ledger.deduct(&cost);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
        assert_eq!(ledger.balance, 0);
    }
}
```

- [ ] **Step 2: Register the module in `lib.rs`**

Add `mod credits;` to `src-tauri/src/lib.rs` after the existing module declarations (line 8, after `mod speech;`):

```rust
mod audio;
mod speech;
mod credits;
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/drodio/projects/visionpipe && cargo test -p visionpipe --lib credits::tests`

Expected: All 9 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/credits.rs src-tauri/src/lib.rs
git commit -m "feat: add credit calculation logic with unit tests"
```

---

### Task 2: Add `tauri-plugin-store` Dependency and Permissions

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

This task adds the persistence dependency. No code changes — just wiring.

- [ ] **Step 1: Add `tauri-plugin-store` to Cargo.toml**

In `src-tauri/Cargo.toml`, add after the `tauri-plugin-shell` line (line 23):

```toml
tauri-plugin-store = "2"
```

- [ ] **Step 2: Add store permissions to `capabilities/default.json`**

In `src-tauri/capabilities/default.json`, add to the `permissions` array after `"shell:default"`:

```json
"store:default"
```

- [ ] **Step 3: Add store plugin to `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, replace the empty `"plugins": {}` with:

```json
"plugins": {
  "store": {}
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/drodio/projects/visionpipe && cargo check -p visionpipe`

Expected: Compiles without errors (the plugin is declared but not yet initialized in code).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/capabilities/default.json src-tauri/tauri.conf.json
git commit -m "chore: add tauri-plugin-store dependency and permissions"
```

---

### Task 3: Tauri Commands and State Management

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/credits.rs` (add persistence helper)

This task wires the credit system into Tauri: initializes the store plugin, loads the ledger into managed state, and registers the three new commands.

- [ ] **Step 1: Add persistence helpers to `credits.rs`**

Add these functions at the end of `credits.rs` (before the `#[cfg(test)]` block):

```rust
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "visionpipe.json";
const BALANCE_KEY: &str = "credit_balance";

/// Load credit balance from the store, defaulting to 0 for new installs.
pub fn load_balance(app: &tauri::AppHandle) -> u64 {
    let store = app.store(STORE_FILE).expect("failed to open store");
    store
        .get(BALANCE_KEY)
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

/// Persist credit balance to the store.
pub fn save_balance(app: &tauri::AppHandle, balance: u64) {
    let store = app.store(STORE_FILE).expect("failed to open store");
    store.set(BALANCE_KEY, serde_json::json!(balance));
}
```

Also add at the top of the file:

```rust
use serde_json;
```

(Note: `serde_json` is already in Cargo.toml dependencies.)

- [ ] **Step 2: Add Tauri commands and state initialization to `lib.rs`**

Add these imports at the top of `lib.rs`:

```rust
use std::sync::Mutex;
```

Add the three new Tauri commands after the existing commands (before the `run()` function):

```rust
#[tauri::command]
fn get_credit_balance(state: tauri::State<Mutex<credits::CreditLedger>>) -> u64 {
    state.lock().unwrap().balance
}

#[tauri::command]
fn add_credits(amount: u64, state: tauri::State<Mutex<credits::CreditLedger>>, app: tauri::AppHandle) -> u64 {
    let mut ledger = state.lock().unwrap();
    ledger.balance += amount;
    credits::save_balance(&app, ledger.balance);
    ledger.balance
}

#[tauri::command]
fn preview_capture_cost(width: u32, height: u32, has_annotation: bool, has_voice: bool) -> credits::CreditCost {
    credits::calculate_cost(&credits::CaptureJob { width, height, has_annotation, has_voice })
}

#[tauri::command]
fn deduct_credits(
    width: u32,
    height: u32,
    has_annotation: bool,
    has_voice: bool,
    state: tauri::State<Mutex<credits::CreditLedger>>,
    app: tauri::AppHandle,
) -> Result<credits::CreditCost, String> {
    let cost = credits::calculate_cost(&credits::CaptureJob { width, height, has_annotation, has_voice });
    let mut ledger = state.lock().unwrap();
    ledger.deduct(&cost).map_err(|e| e.to_string())?;
    credits::save_balance(&app, ledger.balance);
    Ok(cost)
}
```

- [ ] **Step 3: Initialize the store plugin and managed state in `run()`**

In the `run()` function, add the store plugin registration after the existing plugins:

```rust
.plugin(tauri_plugin_store::Builder::default().build())
```

Add managed state — add `.manage()` call before `.setup()`:

```rust
.manage(Mutex::new(credits::CreditLedger::new(0)))
```

In the `setup` closure, after the existing setup code (after the global shortcut registration, before `Ok(())`), load the persisted balance:

```rust
// Load persisted credit balance
{
    let balance = credits::load_balance(&app.handle());
    let state: tauri::State<Mutex<credits::CreditLedger>> = app.state();
    state.lock().unwrap().balance = balance;
}
```

- [ ] **Step 4: Register new commands in the invoke handler**

Update the `.invoke_handler(tauri::generate_handler![...])` line to include the 4 new commands:

```rust
.invoke_handler(tauri::generate_handler![
    take_screenshot, capture_fullscreen, get_metadata, save_and_copy_image,
    check_permissions, open_permission_settings, request_microphone_access,
    request_speech_recognition, start_recording, stop_recording,
    get_credit_balance, add_credits, preview_capture_cost, deduct_credits
])
```

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/drodio/projects/visionpipe && cargo check -p visionpipe`

Expected: Compiles without errors.

- [ ] **Step 6: Run existing tests still pass**

Run: `cd /Users/drodio/projects/visionpipe && cargo test -p visionpipe --lib credits::tests`

Expected: All 9 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/credits.rs
git commit -m "feat: add credit Tauri commands with store persistence"
```

---

### Task 4: Frontend — Cost Preview and Balance Display

**Files:**
- Modify: `src/App.tsx`

This task replaces the session-only credit counter with the backend-backed credit system: loads balance on startup, previews cost before submit, and blocks on insufficient credits.

- [ ] **Step 1: Replace credit state variables**

In `src/App.tsx`, find the state declarations (around line 156). Replace:

```typescript
const [sessionCredits, setSessionCredits] = useState(0);
```

With:

```typescript
const [creditBalance, setCreditBalance] = useState<number | null>(null);
const [captureCost, setCaptureCost] = useState<{ capture: number; annotation: number; voice: number; total: number } | null>(null);
```

- [ ] **Step 2: Remove old `captureCredits` computed value**

Remove this line (around line 174):

```typescript
const captureCredits = 1 + (transcript ? 2 : 0);
```

- [ ] **Step 3: Add balance loading on startup**

After the existing `useEffect` that hides the window on startup (around line 177), add:

```typescript
// Load credit balance from backend
useEffect(() => {
  invoke<number>("get_credit_balance").then(setCreditBalance).catch(console.error);
}, []);
```

- [ ] **Step 4: Add cost preview when capture context changes**

After the balance loading effect, add:

```typescript
// Preview capture cost whenever capture dimensions or features change
useEffect(() => {
  if (mode !== "annotating" || !metadata) {
    setCaptureCost(null);
    return;
  }
  const w = metadata.captureWidth || 800;
  const h = metadata.captureHeight || 600;
  const hasAnnotation = annotation.trim().length > 0 || drawnShapes.length > 0;
  const hasVoice = transcript.trim().length > 0;
  invoke<{ capture: number; annotation: number; voice: number; total: number }>(
    "preview_capture_cost",
    { width: w, height: h, hasAnnotation, hasVoice }
  ).then(setCaptureCost).catch(console.error);
}, [mode, metadata, annotation, drawnShapes.length, transcript]);
```

- [ ] **Step 5: Update `handleSubmit` to deduct credits**

In the `handleSubmit` callback (around line 556), add credit deduction **before** the canvas composition begins. Insert right after the `if (!metadata) return;` check:

```typescript
// Deduct credits before proceeding
const w = metadata.captureWidth || 800;
const h = metadata.captureHeight || 600;
const hasAnnotation = annotation.trim().length > 0 || drawnShapes.length > 0;
const hasVoice = transcript.trim().length > 0;
try {
  await invoke("deduct_credits", { width: w, height: h, hasAnnotation, hasVoice });
  const newBalance = await invoke<number>("get_credit_balance");
  setCreditBalance(newBalance);
} catch (err) {
  console.error("[VisionPipe] Credit deduction failed:", err);
  // Don't proceed — user sees the insufficient credits state in the UI
  return;
}
```

Remove the old credit increment near the end of `handleSubmit` (around line 781):

```typescript
setSessionCredits((c) => c + captureCredits);
```

- [ ] **Step 6: Update the `handleSubmit` useCallback dependency array**

Update the dependency array of the `handleSubmit` useCallback to remove `captureCredits` and `sessionCredits` references. It should be:

```typescript
}, [annotation, transcript, metadata, croppedScreenshot, drawnShapes, drawShapeOnCtx]);
```

(This is the same as the current array minus `captureCredits`.)

- [ ] **Step 7: Update the credits UI section**

Replace the credits display block (lines 1410-1425) with:

```tsx
{/* Credits */}
<div style={{
  display: "flex", justifyContent: "space-between", alignItems: "center",
  marginBottom: 4, padding: "6px 10px",
  background: C.forest, borderRadius: 8,
  fontFamily: "'Source Code Pro', monospace",
}}>
  <span style={{ fontSize: 10, color: C.textDim }}>balance</span>
  <span style={{ fontSize: 11, color: C.teal, fontWeight: 600 }}>
    {creditBalance !== null ? creditBalance : "..."} credits
  </span>
</div>
{captureCost && (
  <div style={{
    padding: "4px 10px", marginBottom: 8,
    fontFamily: "'Source Code Pro', monospace", fontSize: 10, color: C.textDim,
  }}>
    <span>this_capture </span>
    <span style={{ color: C.amber }}>{captureCost.capture}</span>
    {captureCost.annotation > 0 && <span> + <span style={{ color: C.amber }}>{captureCost.annotation}</span> annot</span>}
    {captureCost.voice > 0 && <span> + <span style={{ color: C.amber }}>{captureCost.voice}</span> voice</span>}
    <span style={{ color: C.teal }}> = {captureCost.total}</span>
  </div>
)}
```

- [ ] **Step 8: Update the submit button to block on insufficient credits**

Replace the submit button (around line 1428) with:

```tsx
{/* Send Button */}
{creditBalance !== null && captureCost && creditBalance < captureCost.total ? (
  <div style={{
    width: "100%", padding: "10px 0", textAlign: "center",
    background: C.forest, borderRadius: 10, color: C.sienna,
    fontSize: 12, fontWeight: 600, fontFamily: "Verdana, Geneva, sans-serif",
  }}>
    Insufficient credits — purchase more to continue.
  </div>
) : (
  <button
    onClick={handleSubmit}
    style={{
      width: "100%", padding: "10px 0", background: C.teal,
      border: "none", borderRadius: 10, color: C.cream,
      fontSize: 13, fontWeight: 600, fontFamily: "Verdana, Geneva, sans-serif",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      letterSpacing: "0.02em",
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = "#35a08c"}
    onMouseLeave={(e) => e.currentTarget.style.background = C.teal}
  >
    <span>Copy to Clipboard</span>
    <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 11, opacity: 0.7 }}>|</span>
    <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 11, opacity: 0.7 }}>pbcopy</span>
  </button>
)}
```

Note: `C.sienna` is `"#c0462a"` — already defined in the color constants object at the top of App.tsx.

- [ ] **Step 9: Verify the app compiles (frontend + backend)**

Run: `cd /Users/drodio/projects/visionpipe && cargo check -p visionpipe && pnpm exec tsc --noEmit`

Expected: No compile errors.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate credit balance, cost preview, and deduction in frontend"
```

---

### Task 5: Smoke Test and Dev Top-Up

**Files:** None new — verification only

This task verifies the full flow works end-to-end.

- [ ] **Step 1: Run all unit tests**

Run: `cd /Users/drodio/projects/visionpipe && cargo test -p visionpipe --lib credits::tests`

Expected: All 9 tests pass.

- [ ] **Step 2: Build the full app**

Run: `cd /Users/drodio/projects/visionpipe && cargo build -p visionpipe`

Expected: Builds successfully.

- [ ] **Step 3: Start the dev server and test**

Run: `cd /Users/drodio/projects/visionpipe && pnpm tauri dev`

Test the following flow:
1. App launches — credits display shows `0 credits`
2. Press Cmd+Shift+C — select a region
3. Cost preview appears (e.g., `this_capture 3`)
4. Submit button is replaced with "Insufficient credits" message
5. Use devtools console: `window.__TAURI__.invoke("add_credits", { amount: 100 })` to add test credits
6. Balance updates to `100`
7. Submit button appears — click it
8. Balance decreases by the previewed amount

- [ ] **Step 4: Verify persistence**

1. Quit the app
2. Relaunch with `pnpm tauri dev`
3. Credits display shows the balance from step 3 (not 0)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete credit system with persistence and frontend integration"
```
