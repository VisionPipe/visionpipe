# Credit Pricing Redesign

**Date:** 2026-05-04
**Branch:** `feature/credits-rebased`
**Status:** Approved design — implementation plan pending

---

## Summary

Replace the original per-capture, pixel-based credit pricing with a flat per-screenshot model that fits VisionPipe's current multi-screenshot session flow. Audio gets a 10-second free tier, then 1 credit per additional 10 seconds. Annotation pricing is defined in the model but currently dormant (annotation feature was removed in the May 2 multi-screenshot rewrite; the line item is reserved for when it returns). Cost is calculated continuously during a session for live UI feedback, but charged only once when the user clicks "Copy & Send."

**1 credit = $0.01.** Pricing is calibrated to comfortably cover any cloud transcription cost (Deepgram, etc.) if/when cloud transcription returns to the product.

---

## Pricing rules

| Item | Cost |
|---|---|
| Each screenshot in the final bundle | 1 credit |
| Each annotation (dormant — annotation feature is currently removed) | 1 credit |
| Audio, first 10 seconds | Free |
| Audio, every 10 seconds after the first 10 | 1 credit (rounded up) |

Formula:

```
audio_credits = ceil(max(0, audio_seconds - 10) / 10)
total = screenshots + annotations + audio_credits
```

### Worked examples

| Bundle | Cost |
|---|---|
| 1 screenshot, 0s audio | 1 credit ($0.01) |
| 3 screenshots, 5s audio | 3 credits ($0.03) |
| 5 screenshots, 47s audio | 5 + ceil(37/10) = 9 credits ($0.09) |
| 1 screenshot, 120s audio | 1 + ceil(110/10) = 12 credits ($0.12) |

### Cost-coverage check (Deepgram margin)

Deepgram Nova streaming is roughly $0.0043/min in current pricing; even worst-case cloud STT runs ~$0.01/min. A 47s recording costs us ~$0.008 to transcribe and charges the user $0.04 — roughly 5× margin. The free first 10 seconds is intentional so users don't get charged for an accidental click or a "wait, restart" moment.

### Cost basis = the bundle at send time

What charges is **what's in the bundle when the user clicks Copy & Send**, not what passed through the session. Specifically:

- Screenshots deleted from the session before send → not charged.
- Audio segments re-recorded → only the kept segment counts, not the abandoned take. (Already the case in the data model: `audioOffset.start/end` reflects the segment that survived.)
- Sessions abandoned without sending → no charge.

---

## Code shape

### `src-tauri/src/credits.rs`

Replace the per-capture `CaptureJob` (pixel-based, obsolete) with a per-bundle cost struct:

```rust
pub struct BundleCost {
    pub screenshots: u64,   // count of screenshots in the bundle
    pub annotations: u64,   // dormant — always 0 until annotation returns
    pub audio: u64,         // ceil(max(0, audio_seconds - 10) / 10)
    pub total: u64,
}

pub fn calculate_bundle_cost(
    screenshot_count: u64,
    annotation_count: u64,
    audio_seconds: u64,
) -> BundleCost { /* ... */ }

pub struct CreditLedger { pub balance: u64 }

impl CreditLedger {
    pub fn deduct(&mut self, cost: &BundleCost) -> Result<u64, InsufficientCredits>;
}
```

The annotation field stays in `BundleCost` and `calculate_bundle_cost` correctly handles non-zero annotation counts; callers just always pass `0` until the annotation feature returns.

### Tauri commands

| Command | Purpose | Caller |
|---|---|---|
| `get_credit_balance() -> u64` | Read current balance for the header chip | App startup, post-deduct refresh |
| `preview_bundle_cost(screenshots, annotations, audio_secs) -> BundleCost` | Pure calculation; no state change | On any session state change (debounced) |
| `deduct_for_bundle(screenshots, annotations, audio_secs) -> Result<BundleCost, String>` | Calculate + deduct + persist | Copy & Send button handler |
| `add_credits(amount: u64)` | For purchases / dev top-ups | Buy Credits flow (later); dev shortcut |

### Persistence

Unchanged from the cherry-picked store wiring: `tauri-plugin-store` writing `credit_balance` to `visionpipe.json` in the app config dir. Default balance for a fresh install is **0** (the `1,000,000` test default from the old branch is *not* carried forward).

---

## Frontend integration

### State derivation

All inputs to the pricing calc are already in the session reducer; no new session state needed:

- Screenshot count: `session.screenshots.length`
- Audio seconds: sum of `(audioOffset.end - audioOffset.start)` across screenshots (re-records already excluded by the data model)
- Annotation count: `0` (no field exists today)

### New module: `src/state/credit-context.tsx`

A thin React context wrapping the three Tauri commands:

```ts
type CreditContext = {
  balance: number;
  currentBundleCost: BundleCost;     // updated live as session changes
  refresh: () => Promise<void>;       // re-read balance from backend
  deductForBundle: () => Promise<DeductResult>;
};
```

Computes `currentBundleCost` via `preview_bundle_cost` whenever session state changes (debounced).

### UI placement

| Location | Behavior | File |
|---|---|---|
| Header chip | `Cost: 9 cr · Balance: 142 cr`, updates live | `src/components/Header.tsx` |
| Insufficient state | `Cost 9 / Balance 6 — buy credits` link replaces the chip | `Header.tsx` |
| Copy & Send button | Disabled when `total > balance`; tooltip `Need X more credits` | `src/components/Footer.tsx` |
| HistoryHub items | No credit display (already-shipped sessions) | unchanged |

### Data flow on Copy & Send

1. User clicks **Copy & Send**.
2. Frontend calls `deduct_for_bundle(...)` first.
3. On `Ok(BundleCost)`: refresh `creditBalance` and proceed with the existing `save_and_copy_markdown` flow.
4. On `Err("InsufficientCredits...")`: abort. Do **not** write to the clipboard. Show a toast directing the user to Buy Credits.

This ordering matters: the deduction must succeed before the side effect (clipboard write) happens, so a user can't accidentally consume credits without getting the bundle, or get the bundle without paying.

### Optional polish

A subtle "+1 cr" indicator that fades in for ~800ms when a screenshot is captured, to make the pricing feel concrete. Flagged for the implementation plan; cuttable from MVP.

---

## Testing

### Rust unit tests (`src-tauri/src/credits.rs`)

Replaces the existing 10 pixel-based tests:

- Audio: `0s = 0`, `10s = 0`, `11s = 1`, `20s = 1`, `21s = 2`, `47s = 4`, `120s = 11`
- Screenshots: `0 = 0`, `1 = 1`, `5 = 5`
- Annotations (proves dormant field calculates correctly when fed): `0 = 0`, `3 = 3`
- Bundle composition: `5 screenshots + 47s audio = 9`, `3 screenshots + 5s audio = 3`
- Deduction: `success`, `insufficient_balance` returns `Err`, `exact_balance = balance ends at 0`

### Frontend tests (Vitest + Testing Library)

- `credit-context` recomputes `currentBundleCost` when screenshot count changes.
- `credit-context` recomputes when audio segment duration changes.
- Copy & Send aborts when balance < cost; clipboard is **not** written.
- Balance updates after a successful deduct.

### Manual smoke test

Critical because UI feedback drives the model:

1. Use a dev command (or hand-edit the store) to set balance to `5`.
2. Take 3 screenshots → header shows `3 / 5`.
3. Record 25s of audio → header shows `5 / 5`.
4. Add a 4th screenshot → header shows `6 / 5` in red, Copy & Send disabled, "buy credits" link visible.
5. Use the dev `add_credits` shortcut to add 10 → header shows `6 / 14`, Copy & Send re-enabled.
6. Click Copy & Send → balance drops to 8, markdown lands in clipboard.

---

## Rollout

- **Default balance for fresh installs: 0.** Show the Buy Credits prompt prominently on first run. (The `1,000,000` testing default from the abandoned branch is not carried forward.)
- **Dev shortcut for `add_credits`** so we can exercise the system without a purchase flow.
- The annotation surcharge is dormant in the data model; no UI surface for it until the annotation feature returns.

### Out of scope for this branch (follow-ups)

- **Buy Credits UI + Stripe Checkout.** Waits on `api.visionpipe.ai` being built (web-API plan: `docs/superpowers/plans/2026-04-15-in-app-purchase-web-api.md`).
- **Server-side balance sync** + device ID registration. Same blocker.
- **Annotation surcharge wiring.** Activates when the annotation feature returns to the product.

---

## Open decisions deferred to implementation

- Exact debounce interval for `preview_bundle_cost` (likely 100–250ms).
- Whether `currentBundleCost` is recomputed in Rust (extra IPC traffic, simpler) or duplicated as pure JS (less IPC, two implementations to keep in sync). Current lean: Rust-side via `preview_bundle_cost` IPC — small payload, single source of truth.
- Visual treatment of the "buy credits" link in the header (button vs. underlined link vs. icon).

---

## Related historical context

- The original credit module (cherry-picked from the abandoned `implement-credit-calculation` branch) used a per-capture, pixel-based pricing model: `ceil(width × height / 1,000,000)`. That model fit the v0.1.0-era app where each screenshot was an independent submission. It does not fit the multi-screenshot session flow on main today, which is why we're redesigning rather than migrating.
- "Annotation" historically meant two things in this codebase: (1) a text comment field, (2) a graphical overlay (arrows/boxes/text on the screenshot). Both were removed in commit `da1c132` (May 2, 2026) — the multi-screenshot bundle rewrite — which dropped 1,231 lines from `App.tsx`. The pricing model reserves a slot for annotation so the flip-on cost when/if it returns is trivial.
