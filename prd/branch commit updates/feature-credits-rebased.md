# Branch Progress: feature/credits-rebased

This document tracks progress on the `feature/credits-rebased` branch of VisionPipe. The branch was cut fresh from `origin/main` (v0.6.1) so that the credit-system work — originally built on the long-stale `implement-credit-calculation` branch (which forked from a v0.1.0-era main) — can be reapplied cleanly against the current shape of the app (HistoryHub, multi-screenshot bundles, on-device transcription, etc.).

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
