# In-App Credit Purchase (Desktop App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add device ID generation, server balance sync, Stripe Checkout flow, and "Buy Credits" UI to the VisionPipe Tauri desktop app.

**Architecture:** Device ID (UUID v4) is generated on first launch and persisted in `tauri-plugin-store`. The app registers with the backend API on launch, syncs credit balance from the server, and opens Stripe Checkout in the system browser for purchases. Local `CreditLedger` becomes a cache of server-side balance.

**Tech Stack:** Rust (Tauri v2), `uuid` crate, `reqwest` for HTTP, `tauri-plugin-store` for persistence, React/TypeScript frontend

**Repo:** `VisionPipe/visionpipe` on branch `implement-credit-calculation`

**API Base URL:** Configurable, defaults to `https://visionpipe.ai` (the Next.js app serves API routes at `/api/*`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/src/credits.rs` | Modify | Add device ID helpers, API sync functions, checkout flow |
| `src-tauri/src/lib.rs` | Modify | Register new commands: `sync_credits`, `start_checkout`, `get_device_id` |
| `src-tauri/Cargo.toml` | Modify | Add `uuid` and `reqwest` dependencies |
| `src/App.tsx` | Modify | Balance sync on launch, "Buy Credits" UI, remove `app = visionpipe` box, polling after checkout |

---

### Task 1: Add `uuid` and `reqwest` Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependencies to Cargo.toml**

In `src-tauri/Cargo.toml`, add after the `chrono = "0.4"` line:

```toml
uuid = { version = "1", features = ["v4"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
tokio = { version = "1", features = ["rt"] }
```

Note: `reqwest` with `rustls-tls` avoids needing OpenSSL. `tokio` is needed for async HTTP calls within Tauri commands.

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/drodio/projects/visionpipe && cargo check -p visionpipe`

Expected: Compiles (new deps downloaded but unused).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add uuid and reqwest dependencies for credit sync"
```

---

### Task 2: Device ID Generation and Persistence

**Files:**
- Modify: `src-tauri/src/credits.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add device ID constants and functions to `credits.rs`**

In `src-tauri/src/credits.rs`, add after the `BALANCE_KEY` constant (line 67), before the `load_balance` function:

```rust
const DEVICE_ID_KEY: &str = "device_id";

/// Get or create a device ID. Generated once on first launch, persisted forever.
pub fn get_or_create_device_id(app: &tauri::AppHandle) -> String {
    let store = app.store(STORE_FILE).expect("failed to open store");
    if let Some(id) = store.get(DEVICE_ID_KEY).and_then(|v| v.as_str().map(|s| s.to_string())) {
        return id;
    }
    let id = uuid::Uuid::new_v4().to_string();
    store.set(DEVICE_ID_KEY, serde_json::json!(id));
    id
}
```

- [ ] **Step 2: Add `get_device_id` Tauri command to `lib.rs`**

In `src-tauri/src/lib.rs`, add after the existing credit commands (after the `deduct_credits` function):

```rust
#[tauri::command]
fn get_device_id(app: tauri::AppHandle) -> String {
    credits::get_or_create_device_id(&app)
}
```

- [ ] **Step 3: Register the command in the invoke handler**

In `lib.rs`, add `get_device_id` to the `generate_handler!` macro:

```rust
.invoke_handler(tauri::generate_handler![
    take_screenshot, capture_fullscreen, get_metadata, save_and_copy_image,
    check_permissions, open_permission_settings, request_microphone_access,
    request_speech_recognition, start_recording, stop_recording,
    get_credit_balance, add_credits, preview_capture_cost, deduct_credits,
    get_device_id
])
```

- [ ] **Step 4: Initialize device ID on app startup**

In `lib.rs`, in the `setup` closure, add after the credit balance loading block (after `state.lock().unwrap().balance = balance;`):

```rust
// Ensure device ID exists (generated on first launch)
let device_id = credits::get_or_create_device_id(&app.handle());
eprintln!("[VisionPipe] Device ID: {}", device_id);
```

- [ ] **Step 5: Verify compilation and tests**

Run: `cd /Users/drodio/projects/visionpipe && cargo check -p visionpipe && cargo test -p visionpipe --lib credits::tests`

Expected: Compiles, all 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/credits.rs src-tauri/src/lib.rs
git commit -m "feat: add device ID generation and persistence"
```

---

### Task 3: API Sync Functions

**Files:**
- Modify: `src-tauri/src/credits.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add API base URL constant and sync functions to `credits.rs`**

In `src-tauri/src/credits.rs`, add after the `get_or_create_device_id` function (before `load_balance`):

```rust
const API_BASE: &str = "https://visionpipe.ai";

/// Register device with the backend API. Idempotent — safe to call on every launch.
/// Returns the server-side balance.
pub async fn register_device(device_id: &str) -> Result<u64, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/devices/register", API_BASE))
        .json(&serde_json::json!({ "deviceId": device_id }))
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body["balance"].as_u64().unwrap_or(0))
}

/// Fetch current balance from the server.
pub async fn fetch_balance(device_id: &str) -> Result<u64, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/balance?deviceId={}", API_BASE, device_id))
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body["balance"].as_u64().unwrap_or(0))
}

/// Request a Stripe Checkout URL from the backend.
pub async fn create_checkout(device_id: &str, pack_id: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/checkout", API_BASE))
        .json(&serde_json::json!({ "deviceId": device_id, "packId": pack_id }))
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    body["url"].as_str().map(|s| s.to_string()).ok_or("No checkout URL in response".into())
}

/// Sync a deduction to the server. Returns the server-side balance.
pub async fn sync_deduction(device_id: &str, amount: u64) -> Result<u64, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/deduct", API_BASE))
        .json(&serde_json::json!({ "deviceId": device_id, "amount": amount }))
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(balance) = body["balance"].as_u64() {
        Ok(balance)
    } else {
        Err(body["error"].as_str().unwrap_or("Unknown error").to_string())
    }
}
```

- [ ] **Step 2: Add `sync_credits` and `start_checkout` Tauri commands to `lib.rs`**

In `src-tauri/src/lib.rs`, add after the `get_device_id` command:

```rust
#[tauri::command]
async fn sync_credits(
    state: tauri::State<'_, Mutex<credits::CreditLedger>>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let device_id = credits::get_or_create_device_id(&app);
    let balance = credits::fetch_balance(&device_id).await?;
    let mut ledger = state.lock().unwrap();
    ledger.balance = balance;
    credits::save_balance(&app, balance);
    Ok(balance)
}

#[tauri::command]
async fn start_checkout(pack_id: String, app: tauri::AppHandle) -> Result<String, String> {
    let device_id = credits::get_or_create_device_id(&app);
    let url = credits::create_checkout(&device_id, &pack_id).await?;
    // Open checkout URL in system browser
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(url)
}
```

- [ ] **Step 3: Register new commands**

Update the `generate_handler!` macro in `lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    take_screenshot, capture_fullscreen, get_metadata, save_and_copy_image,
    check_permissions, open_permission_settings, request_microphone_access,
    request_speech_recognition, start_recording, stop_recording,
    get_credit_balance, add_credits, preview_capture_cost, deduct_credits,
    get_device_id, sync_credits, start_checkout
])
```

- [ ] **Step 4: Update `deduct_credits` to sync with server**

In `lib.rs`, update the existing `deduct_credits` command to also sync the deduction to the server in the background:

```rust
#[tauri::command]
async fn deduct_credits(
    width: u32,
    height: u32,
    has_annotation: bool,
    has_voice: bool,
    state: tauri::State<'_, Mutex<credits::CreditLedger>>,
    app: tauri::AppHandle,
) -> Result<credits::CreditCost, String> {
    let cost = credits::calculate_cost(&credits::CaptureJob { width, height, has_annotation, has_voice });

    // Deduct locally first for instant UX
    {
        let mut ledger = state.lock().unwrap();
        ledger.deduct(&cost).map_err(|e| e.to_string())?;
        credits::save_balance(&app, ledger.balance);
    }

    // Sync deduction to server in background
    let device_id = credits::get_or_create_device_id(&app);
    let app_clone = app.clone();
    let total = cost.total;
    tokio::spawn(async move {
        match credits::sync_deduction(&device_id, total).await {
            Ok(server_balance) => {
                if let Ok(state) = app_clone.try_state::<Mutex<credits::CreditLedger>>() {
                    let mut ledger = state.lock().unwrap();
                    ledger.balance = server_balance;
                    credits::save_balance(&app_clone, server_balance);
                }
            }
            Err(e) => eprintln!("[VisionPipe] Server deduction sync failed: {}", e),
        }
    });

    Ok(cost)
}
```

- [ ] **Step 5: Register device on startup**

In `lib.rs`, in the `setup` closure, replace the existing credit balance loading block with:

```rust
// Register device and sync balance from server
{
    let device_id = credits::get_or_create_device_id(&app.handle());
    let app_handle = app.handle().clone();
    tokio::spawn(async move {
        match credits::register_device(&device_id).await {
            Ok(balance) => {
                if let Ok(state) = app_handle.try_state::<Mutex<credits::CreditLedger>>() {
                    let mut ledger = state.lock().unwrap();
                    ledger.balance = balance;
                    credits::save_balance(&app_handle, balance);
                }
                eprintln!("[VisionPipe] Registered device, balance: {}", balance);
            }
            Err(e) => {
                eprintln!("[VisionPipe] Server registration failed (offline?): {}", e);
                // Fall back to local balance
                let balance = credits::load_balance(&app_handle);
                if let Ok(state) = app_handle.try_state::<Mutex<credits::CreditLedger>>() {
                    state.lock().unwrap().balance = balance;
                }
            }
        }
    });
}
```

- [ ] **Step 6: Verify compilation**

Run: `cd /Users/drodio/projects/visionpipe && cargo check -p visionpipe`

Expected: Compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/credits.rs src-tauri/src/lib.rs
git commit -m "feat: add API sync, checkout flow, and server-side deduction"
```

---

### Task 4: Frontend — Balance Sync, Buy Credits UI, and UI Cleanup

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add balance sync on app launch**

In `src/App.tsx`, find the existing balance loading effect (around line 184):

```typescript
// Load credit balance from backend
useEffect(() => {
  invoke<number>("get_credit_balance").then(setCreditBalance).catch(console.error);
}, []);
```

Replace it with:

```typescript
// Sync credit balance from server on launch, fall back to local
useEffect(() => {
  invoke<number>("sync_credits")
    .then(setCreditBalance)
    .catch(() => {
      // Server unreachable — use local balance
      invoke<number>("get_credit_balance").then(setCreditBalance).catch(console.error);
    });
}, []);
```

- [ ] **Step 2: Add pack selection state and checkout handler**

After the existing state declarations (around line 163, after the `permissions` state), add:

```typescript
const [showPacks, setShowPacks] = useState(false);
const [checkoutPolling, setCheckoutPolling] = useState(false);
```

After the cost preview `useEffect` (around line 200), add:

```typescript
// Poll for balance updates after checkout
useEffect(() => {
  if (!checkoutPolling) return;
  const interval = setInterval(async () => {
    try {
      const balance = await invoke<number>("sync_credits");
      setCreditBalance(balance);
      if (balance > 0) {
        setCheckoutPolling(false);
      }
    } catch { /* ignore */ }
  }, 3000);
  const timeout = setTimeout(() => setCheckoutPolling(false), 120000);
  return () => { clearInterval(interval); clearTimeout(timeout); };
}, [checkoutPolling]);

const handleBuyCredits = async (packId: string) => {
  try {
    await invoke<string>("start_checkout", { packId });
    setShowPacks(false);
    setCheckoutPolling(true);
  } catch (err) {
    console.error("[VisionPipe] Checkout failed:", err);
  }
};
```

- [ ] **Step 3: Update the credits UI section with Buy Credits flow**

Find the credits display block in the sidebar (the `{/* Credits */}` section, around line 1443). Replace the entire credits section (from `{/* Credits */}` through the cost breakdown `div`) with:

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
    padding: "4px 10px", marginBottom: 4,
    fontFamily: "'Source Code Pro', monospace", fontSize: 10, color: C.textDim,
  }}>
    <span>this_capture </span>
    <span style={{ color: C.amber }}>{captureCost.capture}</span>
    {captureCost.annotation > 0 && <span> + <span style={{ color: C.amber }}>{captureCost.annotation}</span> annot</span>}
    {captureCost.voice > 0 && <span> + <span style={{ color: C.amber }}>{captureCost.voice}</span> voice</span>}
    <span style={{ color: C.teal }}> = {captureCost.total}</span>
  </div>
)}
{checkoutPolling && (
  <div style={{
    padding: "4px 10px", marginBottom: 4,
    fontFamily: "'Source Code Pro', monospace", fontSize: 10, color: C.teal,
    fontStyle: "italic",
  }}>
    Waiting for payment...
  </div>
)}
<button
  onClick={() => setShowPacks(!showPacks)}
  style={{
    background: "none", border: "none", cursor: "pointer",
    fontFamily: "'Source Code Pro', monospace", fontSize: 10,
    color: C.teal, padding: "2px 10px", marginBottom: 4,
    textDecoration: "underline", textUnderlineOffset: 2,
  }}
>
  {showPacks ? "hide packs" : "buy credits"}
</button>
{showPacks && (
  <div style={{ padding: "4px 10px", marginBottom: 8 }}>
    {[
      { id: "starter", name: "Starter", credits: "999", price: "$9.99" },
      { id: "pro", name: "Pro", credits: "2,999", price: "$29.99" },
      { id: "business", name: "Business", credits: "9,999", price: "$99.99" },
    ].map((pack) => (
      <button
        key={pack.id}
        onClick={() => handleBuyCredits(pack.id)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          width: "100%", padding: "6px 8px", marginBottom: 4,
          background: C.forest, border: `1px solid ${C.border}`, borderRadius: 6,
          cursor: "pointer", color: C.cream, fontSize: 11,
          fontFamily: "'Source Code Pro', monospace",
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = C.teal}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = C.border}
      >
        <span>{pack.name} <span style={{ color: C.textDim }}>({pack.credits})</span></span>
        <span style={{ color: C.amber }}>{pack.price}</span>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 4: Update the insufficient credits message**

Find the insufficient credits block (the `{/* Send Button */}` section). Update the message div to include a buy link:

```tsx
{creditBalance !== null && captureCost && creditBalance < captureCost.total ? (
  <div
    onClick={() => setShowPacks(true)}
    style={{
      width: "100%", padding: "10px 0", textAlign: "center",
      background: C.forest, borderRadius: 10, color: C.sienna,
      fontSize: 12, fontWeight: 600, fontFamily: "Verdana, Geneva, sans-serif",
      cursor: "pointer",
    }}
  >
    Insufficient credits — click to purchase.
  </div>
) : (
```

(The rest of the button stays the same.)

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Users/drodio/projects/visionpipe && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add buy credits UI, balance sync, and checkout polling"
```

---

### Task 5: Build Verification

**Files:** None — verification only

- [ ] **Step 1: Run unit tests**

Run: `cd /Users/drodio/projects/visionpipe && cargo test -p visionpipe --lib credits::tests`

Expected: All 10 tests pass.

- [ ] **Step 2: Full build**

Run: `cd /Users/drodio/projects/visionpipe && cargo build -p visionpipe`

Expected: Builds successfully.

- [ ] **Step 3: TypeScript check**

Run: `cd /Users/drodio/projects/visionpipe && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: build verification for in-app purchase feature"
```
