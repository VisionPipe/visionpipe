# Branch Progress: feature/credits-rebased

This document tracks progress on the `feature/credits-rebased` branch of VisionPipe. The branch was cut fresh from `origin/main` (v0.6.1) so that the credit-system work — originally built on the long-stale `implement-credit-calculation` branch (which forked from a v0.1.0-era main) — can be reapplied cleanly against the current shape of the app (HistoryHub, multi-screenshot bundles, on-device transcription, etc.).

---

## Progress Update as of 2026-05-04 17:30 PDT — v0.6.1 (Rust impl)

### Summary of changes since last update
Implemented the Rust side of the credit pricing redesign. Replaced the cherry-picked CaptureJob/calculate_cost (pixel-based, per-capture) with BundleCost/calculate_bundle_cost (per-bundle: 1 credit per screenshot, 1 per dormant annotation, 10s-free audio tier then 1 credit per additional 10s). Added four Tauri commands backed by `tauri-plugin-store`. 16 unit tests pass; cargo build is clean.

### Detail of changes made:
- **`src-tauri/src/credits.rs`**: Full rewrite. `BundleCost { screenshots, annotations, audio, total }` with `calculate_bundle_cost(screenshot_count, annotation_count, audio_seconds)`. Audio formula: `if seconds <= 10 { 0 } else { (seconds - 10).div_ceil(10) }`. The `annotations` field stays in the model (calculator just sums whatever the caller passes) so re-enabling the annotation feature is a one-line caller change. `CreditLedger.deduct(&BundleCost) -> Result<u64, InsufficientCredits>` deducts `cost.total` and returns the new balance. 16 inline tests cover audio tiers (0/10/11/20/21/47/120s), screenshot composition, dormant-annotation correctness, three worked spec examples, and three deduction cases.
- **`src-tauri/src/lib.rs`**: Added `use tauri_plugin_store::StoreExt`. Added `CREDIT_STORE_FILE = "visionpipe.json"` and `CREDIT_BALANCE_KEY = "credit_balance"` constants plus `load_balance(app)` (returns 0 for fresh installs) and `save_balance(app, balance)` helpers. Registered `tauri_plugin_store::Builder::new().build()` in the plugin chain (the dependency itself was already added in cherry-pick `79c399d`). `setup` closure now loads the persisted balance and `app.manage(Mutex::new(credits::CreditLedger::new(initial_balance)))`. Four new `#[tauri::command]` handlers: `get_credit_balance` (read), `add_credits` (saturating add + persist), `preview_bundle_cost` (pure calc, no mutation), `deduct_for_bundle` (calculate + deduct + persist; returns Err on insufficient balance). All four registered in the `invoke_handler` macro.

### Potential concerns to address:
- **Default balance is 0** — this means a fresh-install user can't send a bundle until they call `add_credits` (currently only via devtools console or future Buy Credits UI). Spec calls for prominent "Buy Credits" UI on first run; that comes when the backend exists.
- **`closingNarration` audio is invisible to the calculator.** The frontend can't derive its duration from the type model — flagged for follow-up. Direction is user-friendly (we under-charge, never over-charge).
- **No frontend wiring yet** — these commands compile and respond but nothing in the UI calls them. Tasks 5-9 hook them in.

---

## Progress Update as of 2026-05-04 17:30 PDT — v0.6.1

### Summary of changes since last update
Wrote the full implementation plan from the design spec. Plan breaks the work into nine tasks covering Rust impl (replace credits.rs + persistence wiring + four Tauri commands), TDD-driven CreditProvider context with seven Vitest tests, Header chip, Copy & Send guard, and a manual smoke test runbook from the spec. Plan is committed before implementation begins so the history shows it as a discrete artifact.

### Detail of changes made:
- **`docs/superpowers/plans/2026-05-04-credit-pricing-redesign.md`** (new): 9-task implementation plan with concrete code in every step, exact file paths, run commands with expected output, and a commit script per task. Includes self-review notes confirming spec coverage and type-name consistency between Rust (`BundleCost { screenshots, annotations, audio, total }`) and TypeScript (same shape, camelCase method `deductForBundle` calling snake_case `deduct_for_bundle` Tauri command).
- Plan deliberately groups Tasks 1+2+3 under one Rust commit (Task 4) and Tasks 5-9 under one frontend commit so the branch stays at two logical commits for the implementation, plus this plan-creation commit. The commits-per-task pattern (one commit per step) was rejected here because the changes are tightly coupled — splitting them produces unbuildable intermediate states.

### Potential concerns to address:
- Plan's manual smoke test (Task 9, Steps 2-4) requires user interaction with the desktop (taking screenshots, recording audio, restarting the app). The autonomous implementation pass cannot execute those steps; the user runs them when they're back. The plan's automated checks (cargo test, pnpm test, tsc, dev-server launch) ARE executable autonomously and will run.

---

## Progress Update as of 2026-05-04 17:00 PDT — v0.6.1

### Summary of changes since last update
Brainstormed and committed the redesigned credit pricing model in a new design spec. Pricing is now per-screenshot + per-annotation (dormant) + tiered per-second-of-audio with a 10s free tier, replacing the obsolete per-capture pixel-based model from the old branch. Cost is computed live during a session and deducted only at Copy & Send. No code changes yet — implementation plan comes next.

### Detail of changes made:
- **`docs/superpowers/specs/2026-05-04-credit-pricing-redesign.md`** (new, 200+ lines): Full design spec. Pricing rules: 1 credit per screenshot, 1 credit per annotation (dormant — annotation feature was removed in commit `da1c132`), audio is `ceil(max(0, seconds - 10) / 10)`, 1 credit = $0.01. Spec covers worked examples, Deepgram cost-coverage check (~5x margin even worst-case), code-shape changes (replace per-capture `CaptureJob` with per-bundle `BundleCost`), Tauri command surface (`get_credit_balance`, `preview_bundle_cost`, `deduct_for_bundle`, `add_credits`), frontend integration (new `src/state/credit-context.tsx`, header chip, Copy & Send guard), test plan (Rust unit + Vitest + manual smoke), and rollout (default balance 0 for fresh installs, dev `add_credits` shortcut, Stripe/server-sync deferred until backend exists).
- **Brainstorming decisions captured in the spec:**
  - Audio billed at 1 credit / 10s with first 10s free (avoids charging for accidental clicks; still ~5x margin over Deepgram cost).
  - Cost basis = bundle at send time (deleted screenshots and re-recorded audio segments don't double-charge).
  - Annotation line item kept dormant in `BundleCost` so it activates trivially when/if annotation returns to the product.
  - Live in-session preview via `preview_bundle_cost` IPC; deduction only fires on Copy & Send.
  - Default fresh-install balance: 0 (the old branch's testing default of 1,000,000 is not carried forward).

### Potential concerns to address:
- **Implementation plan still needed.** The spec is approved-design but no code has changed. Next step is invoking `superpowers:writing-plans` to break the spec into executable tasks (replace `CaptureJob`/`calculate_cost` with `BundleCost`/`calculate_bundle_cost`, swap the 10 obsolete pixel-based unit tests, add the three new Tauri commands, build `credit-context.tsx`, wire header chip + Copy & Send guard).
- **`preview_bundle_cost` is small but called frequently** (debounced on every session change). If IPC overhead becomes visible, the fallback is a pure-JS duplicate of the formula — but two implementations to keep in sync. Spec recommends starting with the IPC version and only duplicating if measured.
- **`Header.tsx` and `Footer.tsx` changes** need to land in the same PR as the credit-context wiring; otherwise the live cost preview won't render and the design's UX premise (see-the-cost-grow-as-you-capture) fails the manual smoke test.

---

## Progress Update as of 2026-05-04 16:45 PDT — v0.6.1

### Summary of changes since last update
Initial branch setup. Cherry-picked the three reusable, conflict-bounded pieces of credit-system work from the abandoned `implement-credit-calculation` branch onto a fresh base from `origin/main`: the pure credit-cost module + tests, the in-app purchase design spec, and the `tauri-plugin-store` dependency wiring. All 10 credits unit tests pass on the new base.

### Detail of changes made:
- **Branched from `origin/main` at `e1439aa`** (v0.6.1, "Merge pull request #5 from VisionPipe/feature/multi-screenshot-bundle"). The old `implement-credit-calculation` branch was ~90 commits behind main and built against an app shape (single-capture flow, no session bundles, no HistoryHub) that no longer exists, so a rebase/merge was rejected as too lossy.
- **Cherry-pick `d45984b` → `b50fffe`** ("feat: add credit calculation logic with unit tests"): adds `src-tauri/src/credits.rs` (158 lines) with `CreditLedger`, `CaptureJob`, `CreditCost`, `calculate_cost()`, `InsufficientCredits`, and 10 unit tests. Also adds `mod credits;` to `src-tauri/src/lib.rs`. Pure module — not yet wired into any Tauri command.
- **Cherry-pick `fcbe6f1` → `7e1a46f`** ("docs: add in-app credit purchase design spec"): adds `docs/superpowers/specs/2026-04-15-in-app-credit-purchase-design.md` (200 lines). Conflict-resolved by dropping the original commit's progress-log addition.
- **Cherry-pick `164d844` → `79c399d`** ("chore: add tauri-plugin-store dependency and permissions"): adds `tauri-plugin-store = "2"` to `src-tauri/Cargo.toml` and `"store:default"` to `src-tauri/capabilities/default.json`. Three textual conflicts resolved by keeping main's lines and adding the new entries; the bad `"plugins": { "store": {} }` entry from the original commit was deliberately excluded (the later eb7b435 fix established that the store plugin needs no config map, so it would have just been added-then-removed).
- **eb7b435 explicitly skipped** — its fix is already baked into the conflict resolution above.
- **`cargo test -p visionpipe credits`** passes all 10 tests against the new base.
- **`Cargo.lock` + `src-tauri/gen/schemas/*.json` regenerated** as a side-effect of the `tauri-plugin-store` addition; staged into the same cleanup commit as the progress log.

### Pieces deliberately NOT cherry-picked (and why):
- `adcf043` ("feat: add credit Tauri commands with store persistence") — adds 4 Tauri commands (`get_credit_balance`, `add_credits`, `preview_capture_cost`, `deduct_credits`) plus persistence helpers in `credits.rs`. Skipped for now because the wiring into `lib.rs` was built against the old single-capture flow; needs to be redesigned against the multi-screenshot session model on main before reintroducing.
- `c5df370` ("feat: integrate credit balance, cost preview, and deduction in frontend") — adds Buy Credits UI / cost preview / insufficient-credits guard to `App.tsx`. App.tsx has been rewritten on main (HistoryHub, ScreenshotCard, InterleavedView, header/footer split-out, MediaRecorder, settings panel). The UI needs to be re-conceptualized against multi-screenshot pricing, not merged.
- `cee9217` ("feat: TCC crash guard, credit purchase UI, and recording UX improvements") — bundles four unrelated things: device-ID/Stripe Checkout client, default test balance of 1,000,000, recording-button polish, and a TCC crash guard for dev-mode speech/mic auth. The Stripe/device-ID code targets `api.visionpipe.ai`, which doesn't exist; the recording-button polish is likely obsolete given main's recording UX rewrite; the TCC crash guard may or may not be needed against main's current `speech.rs` / `speech_bridge.m` — to be re-evaluated.
- `11d7d39` ("feat: prompt user to select window before capturing screenshot") — capture flow changed substantially with multi-screenshot bundles; would need investigation before porting.

### Potential concerns to address:
- **Credits module is dead code** — the cherry-picked `credits.rs` compiles but nothing calls it. `cargo check` emits 8 "function is never used" warnings. This is intentional at this checkpoint (Task 1 of the rebased plan); Tasks 2+ wire it into the multi-screenshot session flow.
- **Pricing model needs to be redesigned for multi-screenshot bundles.** The original `calculate_cost(width, height, has_annotation, has_voice)` shape was per-capture. With sessions that contain N screenshots + cumulative audio + a single bundle output, "cost per send" is a bigger architectural question than "cost per capture."
- **Backend `api.visionpipe.ai` still doesn't exist.** Any future pickup of the device-ID / Stripe Checkout work (`adcf043`+`cee9217`) is blocked on the web-API implementation plan in `docs/superpowers/plans/2026-04-15-in-app-purchase-web-api.md`.
- **Stranded progress-doc update on `implement-credit-calculation`** is currently held in a `git stash` (label: "stranded progress-doc update from implement-credit-calculation"). If we abandon that branch, the stash can be dropped; if we keep it for archival, the stash should be popped + committed there.
- **Old branch `implement-credit-calculation` is still on origin.** Decide whether to leave it as historical reference or delete after this branch is merged.

---
