# Branch Progress: main

This document tracks progress on the `main` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

## Progress Update as of 2026-05-02 19:21 PDT — v0.3.1
*(Most recent updates at top)*

### Summary of changes since last update

Verification build off `main` after the merge of `merge-best-of-both` into `main`. No code changes since v0.3.0 — just rebuilding from `main` directly to confirm the merged tree produces a clean signed/notarized DMG end-to-end and that the auto-create-log fix from the previous patch works on a fresh branch (this is the first release-script run on `main`, so `prd/branch commit updates/main.md` doesn't exist yet — the script should create it automatically).

### Detail of changes made:

- No source code changes since v0.3.0.
- This release exercises the auto-create-log path in `scripts/release.sh` (first time the script runs on `main`).
- Verifies that the full merged workspace builds, signs, and notarizes cleanly from `main`.

### Potential concerns to address:

- **Voice recording UI is still not wired** — the Tauri commands exist but the annotation card's voice button is placeholder. Same outstanding item from v0.3.0.
- **Duplicate `capture.rs` / `metadata.rs`** in `src-tauri/src/` and `crates/visionpipe-core/src/` — same outstanding item.

---


