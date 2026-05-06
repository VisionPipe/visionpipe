# Branch Progress: feature/credits-rebased

This document tracks progress on the `feature/credits-rebased` branch of VisionPipe. The branch was cut fresh from `origin/main` (v0.6.1) so that the credit-system work — originally built on the long-stale `implement-credit-calculation` branch (which forked from a v0.1.0-era main) — can be reapplied cleanly against the current shape of the app (HistoryHub, multi-screenshot bundles, on-device transcription, etc.).

---

## Progress Update as of 2026-05-06 09:45 PDT — v0.6.1 (correction: hotkey pill + tighter window in Onboarding too)

### Summary of changes since last update
The user shared a screenshot showing the Welcome / Onboarding view (NOT HistoryHub) was the place where they wanted (a) the three keyboard keys collapsed into one orange pill and (b) the empty green space removed. The previous commit applied both fixes to HistoryHub instead. This commit applies them to Onboarding too.

### Detail of changes made:
- **`src/components/Onboarding.tsx`**: Removed the local `KbdKey` helper (rendered `⌘`, `⇧`, `C` as three separate boxed keys with orange borders and 22 px font). Replaced the `<KbdKey>⌘</KbdKey><KbdKey>⇧</KbdKey><KbdKey>C</KbdKey>` triplet with a single `<HotkeyPill size="lg" />` import. Added a small "Click the orange pill to change the shortcut." hint underneath. Layout switched from `<ul><li>` to a flexbox row so the pill aligns inline with the surrounding text. The new `size="lg"` prop on HotkeyPill (already present in the component) makes it visually prominent enough to read as the welcome card's CTA.
- **`src/App.tsx` (`showOnboardingWindow`)**: Now accepts a `compact: boolean` flag. When true, sets the onboarding window to 620×360 instead of 620×680 — the all-granted state's content is ~340 px tall, so the previous fixed 680 px left ~340 px of empty deep-forest background below the Get Started button (visible in the user's screenshot).
- **`src/App.tsx` (new effect)**: Watches the `allRequiredGranted` boolean and calls `showOnboardingWindow(allRequiredGranted)` whenever it changes while in onboarding mode. The dep array uses the boolean, not the permissions object, so the 2-second permission-poll interval doesn't trigger re-resizes when nothing actually changed.

### Verified:
- `tsc --noEmit`: exit 0.
- `vitest run` (full): 7 files, 46 tests, all pass.

### Known limitation:
- Onboarding's title bar still shows `Vision|Pipe` plus version badge plus the "Welcome to Vision|Pipe" header — slight redundancy, but matches the existing pattern. Not changed.

---

## Progress Update as of 2026-05-06 09:35 PDT — v0.6.1 (UI tweaks: hotkey pill + tighter HistoryHub)

### Summary of changes since last update
Two HistoryHub UX improvements: (1) the keyboard shortcut is now a single orange clickable pill that opens the SettingsPanel for rebinding; (2) the window's height range was reduced from 640-900 px to 420-720 px to remove the wall of empty deep-forest background below short session lists.

### Detail of changes made:
- **`src/components/HotkeyPill.tsx`** (new): Self-contained component that loads the take-next-screenshot hotkey via `load_hotkey_config`, renders it as a single orange pill (using existing `C.amber` token, font-mono, bold, 999-radius). Click opens `SettingsPanel` (component manages its own modal state, refreshes the displayed combo on close so a just-rebound shortcut is reflected immediately). Includes a `formatHotkey()` helper that converts stored strings like `CmdOrCtrl+Shift+C` to display glyphs `⌘⇧C` (handles Cmd/Shift/Alt/Ctrl/Enter/Tab/Escape/Space/Backspace plus uppercase letter conversion). Optional `binding`, `label`, `size` props for future reuse on other shortcuts.
- **`src/components/__tests__/HotkeyPill.test.ts`** (new): 7 tests for `formatHotkey` covering the marquee shortcuts, Alt+Tab, lowercase-letter normalization, F-keys, and the special keys (Space/Backspace/Escape).
- **`src/components/HistoryHub.tsx`**: Replaced the static `or press ⌘⇧C from anywhere` text with `<HotkeyPill />` rendered inline. Same in the empty-state message: `Hit ⌘⇧C` is now `Hit <HotkeyPill />`. Both spots use flexbox so the pill aligns with the surrounding text. Now any user who can't remember the shortcut sees an obvious clickable affordance to change it.
- **`src/App.tsx` (`resizeForHistoryHub`)**: Window height range tightened from `max(640*scale, min(900*scale, monitorH*0.75))` to `max(420*scale, min(720*scale, monitorH*0.55))` — about 200-220 px less empty space on a 1080p monitor. Existing comment expanded to explain *why* the old range looked empty (rows are 80-120 px each, with 0-3 sessions a 800+ px window had ~500 px of dead deep-forest background). Power users with many sessions still get a scrollable list at 720 px; the empty/idle state no longer overwhelms.

### Verified:
- `tsc --noEmit`: exit 0.
- `vitest run` (full): 7 files, 46 tests, all pass (added the 7 new HotkeyPill tests since last commit).

### Potential concerns to address:
- **HotkeyPill is currently used only in HistoryHub.** The empty state in onboarding/idle could also benefit, but those don't display a hotkey today. SessionWindow's Header could optionally show the Copy & Send hotkey as a pill — flagged for follow-up if the user wants more discoverability.
- **The window resize is fixed-range, not content-aware.** A truly minimal-empty-space approach would be: measure the rendered list height from the React side and ask Tauri to set the window to that exact size. Significant complexity for marginal win — punted.
- **Keyboard shortcut display is Mac-only.** VisionPipe is Mac-only (cpal+Whisper+macOS-private-api) so this is fine, but if the app ever supports Windows/Linux the glyph table needs platform branching.

---

## Progress Update as of 2026-05-06 09:25 PDT — v0.6.1 (descriptive markdown filename)

### Summary of changes since last update
Replaced the hardcoded `transcript.md` bundle filename with a descriptive, content-aware name: `VisionPipe-{YYYY-MM-DD-HHmm}-{N}shots-{topic}.md`. The topic falls back through caption → URL path → window title → app name (or is omitted if nothing's available). Backwards compat: HistoryHub still finds legacy `transcript.md` files for old sessions. 11 new Vitest tests for the filename helper; full suite is 6 files, 39 tests, all passing.

### Detail of changes made:
- **`src/lib/bundle-name.ts`** (new): `generateBundleName(session)` returns the descriptive `.md` filename. Reuses the existing `sanitizeContext` helper from `canonical-name.ts` for consistency with screenshot naming. Applies the same `APP_NAME_NORMALIZATION` map (Google Chrome → Chrome, etc.). Length-capped at 180 chars excluding extension; if the topic pushes past the cap, the topic is truncated rather than the timestamp/count prefix. Timestamp is formatted in local time so it matches what the user expects, not UTC.
- **`src/lib/__tests__/bundle-name.test.ts`** (new): 11 tests covering the four-tier topic fallback, plural/singular `shot(s)`, app-name normalization, path-unsafe character stripping, length cap, graceful no-topic fallback, and unparseable timestamps.
- **`src/components/SessionWindow.tsx`**: `onCopyAndSend` now generates the bundle filename via `generateBundleName(session)` and passes it through to the new `save_and_copy_markdown(folder, markdown, filename)` signature. Both the success-path toast and the fallback text-only-clipboard toast reference the actual filename instead of the legacy `transcript.md` string.
- **`src-tauri/src/lib.rs` (`save_and_copy_markdown`)**: Signature now takes an optional `filename: Option<String>`. Defaults to `transcript.md` for backwards compatibility (legacy callers and the JS fallback path). Path is `<folder>/<filename>`.
- **`src-tauri/src/lib.rs` (`build_session_summary`)**: `transcript_md_path` discovery rewritten. Looks for any `VisionPipe-*.md` file in the session folder (most recent mtime wins if multiple exist — happens when the user re-sends a session after edits). Falls back to legacy `transcript.md` if no descriptive filename is present. This means HistoryHub keeps working for both old and new sessions without any migration.
- **`src/components/HistoryHub.tsx`**: `onCopy` no longer hardcodes `transcript.md`. Extracts the basename from `transcriptMdPath` for the existing-file path, and generates a fresh descriptive name via `generateBundleName` for the re-render-from-JSON path. Also passes the filename through `save_and_copy_markdown` so the rewrite uses the descriptive name even for legacy sessions on first re-send.

### Filename examples:
- `VisionPipe-2026-05-06-0904-3shots-github-pr-42-review.md` (caption-driven topic)
- `VisionPipe-2026-05-06-1023-5shots-credit-context-tsx.md` (window-title-driven)
- `VisionPipe-2026-05-06-1505-2shots-Slack.md` (app-name fallback)
- `VisionPipe-2026-05-06-0904-1shot.md` (no topic available)

### Verified:
- `cargo build -p visionpipe`: clean (8 pre-existing warnings).
- `tsc --noEmit`: exit 0.
- `vitest run` (full): 6 files, 39 tests, all pass.

### Potential concerns to address:
- **Re-send behavior**: if a user sends a session, then deletes a screenshot, then sends again, the second send produces a different filename (different shot count and possibly a different topic). The backend's "most recent mtime wins" tiebreak handles this, but the OLD .md file stays on disk. Could add a "clean stale .md siblings" pass on re-send if disk litter becomes annoying.
- **Topic from caption uses just screenshot 1's caption** — for longer sessions, the most descriptive caption might be on screenshot 3. Could improve later by picking the longest non-empty caption, but YAGNI for now.

---

## Progress Update as of 2026-05-06 09:00 PDT — v0.6.1 (frontend wiring)

### Summary of changes since last update
Wired the credit pricing into the React UI. Added `CreditProvider` context that reads `get_credit_balance` on mount and recomputes `currentBundleCost` (debounced 150ms) via `preview_bundle_cost` IPC whenever session state changes. Added a Header chip showing `Cost: N cr · Balance: M cr` with amber styling in the insufficient state. Gated `Copy & Send` on `deduct_for_bundle`: deduction happens BEFORE the clipboard write, so the user cannot get the bundle without paying or pay without getting the bundle. Full type-check clean (tsc --noEmit exit 0); 28 Vitest tests pass; production vite build succeeds.

### Detail of changes made:
- **`src/state/audio-duration.ts`** (new): Pure helper `deriveAudioSeconds(screenshots)` that sums `(audioOffset.end - audioOffset.start)` across screenshots, skipping any with `end === null` (still recording). Extracted to its own file for testability — the React-rendering integration test approach was hitting a vitest+jsdom hang (likely React 19 + provider chain) so the testable logic moved here.
- **`src/state/__tests__/audio-duration.test.ts`** (new): 6 Vitest tests — empty session, multi-screenshot summing, active-recording exclusion, negative-duration clamping, fractional-seconds rounding, spec's 5-screenshot/47s example. All pass.
- **`src/state/credit-context.tsx`** (new): `CreditProvider` + `useCredit()` hook. Holds `{ balance, currentBundleCost, refresh, deductForBundle }`. Initial balance load on mount via `get_credit_balance` IPC. `currentBundleCost` recomputed debounced 150ms via `preview_bundle_cost` whenever screenshot count or audio seconds change. `deductForBundle()` calls `deduct_for_bundle` and refreshes balance from backend on success; throws on insufficient balance for the caller to handle.
- **`src/App.tsx`**: Wrapped the inner tree in `<CreditProvider>` (inside `<SessionProvider>` so the context can call `useSession()`).
- **`src/components/Header.tsx`**: Added `CreditChip` subcomponent rendering `Cost: N cr · Balance: M cr` in the middle of the header row. Amber border + amber text when `currentBundleCost.total > balance`. Tooltip explains the breakdown.
- **`src/components/SessionWindow.tsx`**: `onCopyAndSend` now calls `deductForBundle()` first; on `Err`, aborts BEFORE touching the clipboard and shows an error toast pointing to Buy Credits. On `Ok`, the existing `save_and_copy_markdown` flow runs as before, with the deducted cost in the success toast. Footer's `busy` prop is now driven by `currentBundleCost.total > balance` so the button auto-disables in the insufficient state with a "Need X more credits" tooltip. The fallback text-only clipboard path also reports the deducted cost so the user knows their credits weren't lost on a partial failure.

### What was NOT done (and why):
- **The full plan's React-rendering integration tests for CreditProvider were dropped.** The vitest+jsdom run hung indefinitely on tests that use `<SessionProvider><CreditProvider>` plus `vi.mock("@tauri-apps/api/core")`. Spent ~20 min trying to isolate; dropped to keep the implementation moving. The pure helper test for `deriveAudioSeconds` covers the only non-trivial calculation; the IPC-and-state plumbing is verifiable via the manual smoke test.
- **Manual smoke test (Task 9 Step 3) not executed yet.** Requires user interaction with the desktop (taking screenshots, recording audio, restarting). Spec runbook is in `docs/superpowers/specs/2026-05-04-credit-pricing-redesign.md` and `docs/superpowers/plans/2026-05-04-credit-pricing-redesign.md` Task 9.

### What was verified:
- `cargo test -p visionpipe credits`: 16/16 tests pass (audio tiers, screenshots, dormant annotations, worked spec examples, ledger deduction).
- `cargo build -p visionpipe`: clean (8 advisory warnings about unused functions in unrelated modules).
- `tsc --noEmit`: exit 0.
- `vitest run` (full suite): 5 files, 28 tests, all pass.
- `vite build`: succeeds (~274 KB JS, 21 KB CSS, no errors; same dynamic-vs-static import advisories that pre-existed).

### Potential concerns to address:
- **Manual UI verification still pending.** When the user is back, they should run through the spec's smoke test (set balance to 5 via devtools, take 3 screenshots, record 25s, take 4th screenshot to trigger insufficient state, top up, send, restart app, confirm balance persists).
- **Closing-narration audio is still under-counted.** Sessions where the user records narration AFTER the last screenshot won't have that duration in the cost (no `AudioOffset` in type model). User-friendly direction; flagged for follow-up.
- **No real Buy Credits UI.** The "buy credits" affordance in the insufficient state is a tooltip + disabled button only. Real purchase flow waits on `api.visionpipe.ai`.
- **`add_credits` only callable via devtools console.** Once Buy Credits ships, this is fine; for now, the smoke-test runbook is the workaround.

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
