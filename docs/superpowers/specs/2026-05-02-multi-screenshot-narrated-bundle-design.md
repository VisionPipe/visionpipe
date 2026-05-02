# Multi-Screenshot Narrated Bundle — Design Spec

**Status:** Draft, pending implementation plan
**Author:** Brainstormed via Claude Code session, 2026-05-02
**Spec scope:** Spec 1 of 2. Cloud sharing (secret links, billing gate, web viewer) is deferred to Spec 2.

---

## 1. Summary

Today, VisionPipe captures one screenshot, lets the user annotate it, and copies a single composite image to the clipboard. This spec evolves VisionPipe into a **session-based** tool: the user takes multiple screenshots within a single session, narrates across all of them with continuous real-time audio transcription, and receives a structured markdown document on the clipboard with image references that an LLM (or another human) can consume natively.

The output is optimized for Claude Code as the primary consumer: a markdown document on the clipboard plus a session folder on disk containing all images, audio, and structured metadata. Claude Code reads the markdown, then `Read`s individual screenshot files only when pixel-level inspection is needed — token-efficient even at 100-screenshot sessions.

---

## 2. Goals and non-goals

### Goals

- Multi-screenshot capture within a single session, no upper bound on count
- Continuous real-time voice narration that interleaves with screenshot markers
- Per-segment re-record capability for fixing any single piece of narration
- Auto-saved session folder on disk, recoverable via Finder if the app crashes
- Clipboard payload optimized for Claude Code (markdown text + absolute image paths)
- Two render modes (interleaved-default, split-on-toggle) sharing one data model
- User-configurable hotkeys via Settings panel
- Offline fallback so audio is preserved even when transcription is unavailable

### Non-goals (Spec 1)

- **Cloud upload, secret-link sharing, billing-gated tiers** → Spec 2
- **In-app session history / browser** — sessions are addressable on disk only
- **Drag-to-reorder cards** — defer to v0.3 (introduces audio-offset complexity)
- **Resume prior session on app launch** — defer to v0.3
- **Per-screenshot drawing/markup layer** — existing toolbar stays visual-only for now
- **Streaming transcription replay/buffering of pre-network-loss audio** — v0.3
- **Cross-platform (Windows, Linux)** — Apple Silicon macOS only, matching current ship target

---

## 3. Decisions made during brainstorming

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Audio model:** continuous recording with screenshot markers; per-segment re-record allowed | Matches the natural flow of "narrate while debugging"; re-record adds polish without breaking continuity |
| Q2 | **Output:** markdown on clipboard + images on disk in `~/Pictures/VisionPipe/session-<ts>/` | Optimal for Claude Code consumption (selective image reads); composes with Spec 2 cloud upload |
| Q3 | **Capture flow:** hotkey goes straight into region-select; session window appears after capture #1 | Preserves existing muscle memory; mic auto-arms when window appears |
| Q4 | **Lifecycle:** auto-save to disk from capture #1 onward; "Copy & Send" keeps session open; window close = session preserved on disk | Crash-safe with no in-app history UI work; explicit "New session" or window close starts fresh |
| Q5 | **Naming:** canonical `VisionPipe-{seq}-{ts}-{app}-{context}` for filename + alt + marker; user "Caption" is a separate appended field, never renames the file | Stable file references; user edits never break markdown links |
| Q6 | **Layout:** B (interleaved card+narration) is default; one-button toggle to A (cards left, transcript right); persisted per-user | Same segmented data model under both views; trivial to switch |
| Q7 | **Transcription:** Deepgram Nova-3 streaming via VisionPipe-managed proxy (`vp-edge`); per-install token; 60-min/day default rate limit; offline fallback preserves audio locally | Real-time UX is the goal; managed proxy avoids exposing keys; rate limit caps free-trial cost exposure |

---

## 4. Data model

The `Session` is the core noun. Everything else is a view of it.

```
Session
├── id: <timestamp>                         // e.g., "2026-05-02_14-23-07"
├── folder: ~/Pictures/VisionPipe/session-<id>/
├── createdAt, updatedAt
├── audioFile: audio-master.webm            // continuous recording
├── viewMode: "interleaved" | "split"       // last toggle state, persisted per-user
│                                            // ("interleaved" = View B default; "split" = View A toggle)
└── screenshots: [Screenshot, …]

// Per-install authentication is stored in macOS Keychain, not in Session.
// One vp-edge proxy token per machine, shared across all sessions.

Screenshot
├── seq: 1, 2, 3, …                         // assigned at capture, never reused after delete
├── canonicalName: "VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-..."
├── filename: <canonicalName>.png           // on disk in session folder
├── capturedAt: <iso timestamp>
├── audioOffset: { start: 12.4, end: 47.2 } // seconds into audio-master.webm
├── caption: ""                             // user-editable subtitle
├── transcriptSegment: "..."                // text for THIS screenshot's narration
├── reRecordedAudio: null | "<canonicalName>-rerecord.webm"
│                                            // if set, overrides audio-master for this segment
└── metadata: { app, window, url, … }       // existing CaptureMetadata struct
```

**Closing narration** (anything spoken after the last screenshot until "Copy & Send" or session close) is stored as a top-level field on `Session`, not attached to the last `Screenshot`. This keeps "describing screenshot N" semantically distinct from "concluding remarks."

### Invariants

- Sequence numbers are stable for the lifetime of a session even if a card is deleted. Canonical names never collide; disk references stay valid.
- The transcript is segmented by `audioOffset` against a single master audio file by default. Per-segment re-records produce sibling audio files that override the master for rendering of that segment only.
- `viewMode` persists as a user preference; next session opens in last-used view.
- Auto-save writes after each capture, each transcript update (debounced 500ms), each caption edit, each re-record completion.

### On-disk artifacts per session

```
~/Pictures/VisionPipe/session-<id>/
├── transcript.json             // machine-readable, mirrors the Session struct
├── transcript.md               // rendered form (what gets copied to clipboard)
├── audio-master.webm           // continuous mic recording
├── VisionPipe-001-...-.png     // screenshot files (one per capture)
├── VisionPipe-002-...-.png
├── ...
├── VisionPipe-001-...-rerecord.webm  // sibling re-record audio (only if used)
└── .deleted/                   // soft-deleted screenshots (swept on next session start)
```

---

## 5. Rendered markdown format

What gets written to `transcript.md` and copied to the clipboard on "Copy & Send":

```markdown
# VisionPipe session — 2026-05-02 14:23:07 PDT

**Session folder:** `/Users/drodio/Pictures/VisionPipe/session-2026-05-02_14-23-07/`
**Screenshots:** 2
**Duration:** 4m 18s
**Audio:** `/Users/drodio/Pictures/VisionPipe/session-2026-05-02_14-23-07/audio-master.webm`

---

## Screenshot 1 — VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841

![VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841](/Users/drodio/Pictures/VisionPipe/session-2026-05-02_14-23-07/VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841.png)

**Caption:** Login button missing in dark mode — this is the bug I want you to fix

**Context:**
- App: Google Chrome 124.0
- URL: https://github.com/anthropics/claude-code/issues/2841
- Window: Issue #2841 · anthropics/claude-code
- Captured at: 2026-05-02 14:23:07 PDT
- Display: 2560×1600 @ 2x (Retina)

**Narration:**

> So the issue is the login button just doesn't render in dark mode, you can see in the screenshot that the area where it should be is just empty. This started happening after we switched to the new theme tokens last week.

---

## Screenshot 2 — VisionPipe-002-2026-05-02_14-23-45-VSCode-visionpipe-src-App.tsx

![VisionPipe-002-2026-05-02_14-23-45-VSCode-visionpipe-src-App.tsx](/Users/drodio/Pictures/VisionPipe/session-2026-05-02_14-23-07/VisionPipe-002-2026-05-02_14-23-45-VSCode-visionpipe-src-App.tsx.png)

**Caption:** This is the handler — line 234 looks suspicious

**Context:**
- App: Visual Studio Code 1.95
- Window: visionpipe — App.tsx
- Captured at: 2026-05-02 14:23:45 PDT
- Display: 2560×1600 @ 2x (Retina)

**Narration:**

> Here's the handler in App.tsx, line 234, this is where I think the issue is. The conditional check on theme is wrong — it's looking at `isDarkMode` but we renamed that prop to `theme === "dark"` two commits ago.

---

## Closing narration

> Can you take a look and fix it? I think the conditional on line 234 is the issue but I'd like you to verify and also check if there are other places where the old prop name is referenced.

---

*Generated by VisionPipe v0.2.0 — `screenshot | llm`*
```

### Naming format details

- **Template:** `VisionPipe-{seq}-{timestamp}-{app}-{context}`
- **`{seq}`** — zero-padded sequence number (`001`, `002`, … `100`); sorts correctly in directory listings
- **`{timestamp}`** — local time in `YYYY-MM-DD_HH-MM-SS` form
- **`{app}`** — short app name, sanitized: `Chrome`, `VSCode`, `Terminal`, `Slack`, `Figma`
- **`{context}`** — first non-empty of:
  1. Browser URL → `hostname-path` with `/` → `-` (e.g., `github.com-anthropics-claude-code-issues-2841`)
  2. Window title → last meaningful segment (e.g., `visionpipe-src-App.tsx`)
  3. Empty if neither (rare)
- **Hard cap:** 180 chars before extension. Truncate `{context}` only; never truncate prefix/seq/timestamp/app.
- **Sanitization:** strip `/ \ : * ? " < > |`; collapse runs of `-`; no leading/trailing `-`.

### Offline-segment annotation

If a segment was captured while transcription was unavailable, the markdown notes it inline:

```markdown
**Narration:**

> *Transcription unavailable — captured offline. Audio segment available at `audio-master.webm` from 47.2s to 84.0s.*
```

The audio file path remains in the document so the user can re-transcribe later if desired.

---

## 6. Capture & audio mechanics

### Per-capture flow

Works for both first capture and subsequent:

1. User triggers capture: global hotkey OR "+" button OR "Take next screenshot" button
2. Session window hides; mic keeps recording
3. Full-screen transparent overlay with crosshair appears (existing region-select code)
4. User drags region (or Enter for fullscreen, or Esc to cancel — Esc returns to session window with no new card)
5. Rust runs `screencapture` (existing path) and returns PNG bytes
6. Frontend assigns next `seq`, generates `canonicalName` from metadata, writes `<canonicalName>.png` to session folder
7. Sets prior screenshot's `audioOffset.end` and new screenshot's `audioOffset.start` to current audio elapsed time
8. Appends new `Screenshot` to session, persists `transcript.json`, regenerates `transcript.md`
9. Session window re-appears with new card visible

### First capture — extra setup before step 9

- Create session folder on disk
- Request mic permission if not granted
- Start `MediaRecorder` writing to `audio-master.webm`
- Open WebSocket to `vp-edge` proxy for streaming transcription
- Initialize transcript with empty segments
- Show session window for the first time

### Audio recording

- **Provider:** Browser `MediaRecorder` API (`audio/webm;codecs=opus`) inside the Tauri WebView. No native Rust audio deps. Mic permission goes through the WebView's standard flow.
- **One continuous file** per session: `audio-master.webm`. Chunks written every 1s. Segment boundaries are stored as `audioOffset` ranges in `transcript.json`, never by chopping the file.
- **Re-recording a segment:** click 🎙 on a card → modal "Recording replacement for Screenshot N…" → new `MediaRecorder` writes to `<canonicalName>-rerecord.webm` → set `screenshot.reRecordedAudio` → re-transcribe just that file. The original master file is never modified.
- **Pause/resume:** persistent "● Recording" badge in header; one-click pause toggles `MediaRecorder.pause()` / `.resume()`. The WebSocket is closed during pause and reopened on resume.

### Transcription (Deepgram via vp-edge)

- **Provider:** Deepgram Nova-3 over WebSocket streaming (`wss://api.deepgram.com/v1/listen`)
- **Routing:** App connects to `wss://<vp-edge-host>/transcribe` (the proxy), which authenticates the per-install token, enforces rate limits, and forwards the audio frames upstream to Deepgram. Deepgram's response (interim + final transcripts) flows back through the proxy to the app. Exact `vp-edge` deployment URL is resolved during plan-writing.
- **Per-install token:** issued on first launch by `POST https://<vp-edge-host>/install` (no email, no account). Stored in macOS Keychain under service name `com.visionpipe.desktop.vp-edge-token`. Token is per-machine, not per-user, and is shared across all sessions on that machine.
- **Rate limit:** 60 min/day per token by default. When exceeded, the proxy returns a 429 and the app shows a "Daily transcription limit reached — audio still recording locally" banner.
- **Streaming UX:** as the user talks, interim text appears in italic gray in the active segment. Finalized text replaces it in normal style as Deepgram commits. Taking a new screenshot inserts the marker immediately, closes the active segment, and starts a new one in the same WebSocket stream.

### Offline fallback

- Mic keeps recording to `audio-master.webm` regardless of network state
- Network failure (proxy unreachable, WebSocket closed, no DNS resolution) → transcript area shows: `● Audio recording locally — transcription paused, will resume when reconnected`
- When connection returns mid-session, new segments stream live again. **Already-spoken audio is not retroactively transcribed in v0.2.** (Buffering + batch upload deferred to v0.3.)
- On Copy & Send, the markdown clearly notes per-segment whether transcription was available (see Section 5 example)
- Audio is always preserved — the user can re-export later or paste audio path to a transcription tool of their choice

### Auto-save

- Debounced 500 ms write after any text edit (caption, transcript hand-edit, view-mode toggle)
- Immediate write on capture, re-record finish, card delete
- `audio-master.webm` written continuously by `MediaRecorder` (1-second chunks); finalized on session close, mic toggle off, or app quit
- `transcript.json` regenerated on every state change; `transcript.md` regenerated lazily before each "Copy & Send"

### Edge cases

- **Mic permission denied** — mic button shows "Permission required"; captures still work; transcript area shows "Audio disabled — type captions instead." Caption + manual transcript-text-edit fields produce a valid (audio-less) markdown output.
- **Capture canceled (Esc)** — no card created; mic untouched; session unchanged. Audio recorded during the ~2s capture window attaches to the prior screenshot's segment (no new boundary set).
- **App quit / window close mid-session** — session folder stays on disk with whatever's been auto-saved. Re-opening starts a *new* session. Folder is browsable via Finder.
- **Disk full** — toast notification, capture aborted, mic keeps running (recording is in-memory until next chunk flush).
- **WebSocket disconnect mid-segment** — the segment's `transcriptSegment` retains all text received before the disconnect, with an inline marker `[transcription stopped at HH:MM:SS — offline]` appended at the disconnect point. Banner shows in header. WebSocket auto-reconnects on next reachability change; a new segment boundary is *not* inserted on reconnect (the segment continues).

---

## 7. UI components & interactions

### Window

- Resizable, regular macOS window (not always-on-top, not modal). Min size 600×500.
- Title bar: `VisionPipe — session-2026-05-02_14-23-07`. Click the session id to copy the folder path.
- Window remembers size/position across sessions.

### Header bar (always visible, both views)

- **Left:** VisionPipe logo + session id
- **Center:** `[● Recording]` mic indicator (one-click pause/resume); shows network state — `● Live`, `● Local-only`, `● Reconnecting…`
- **Right:** view toggle button (`◫ Detach transcript` / `◫ Attach transcript`); `⋮` overflow menu (New session, Open session folder, Settings)

### Footer bar (always visible, both views)

- **Left:** `+ Take next screenshot` button (also responds to global hotkey)
- **Right:** `📋 Copy & Send` primary button. Tooltip: "Copies markdown for 2 screenshots + transcript to clipboard"

### View B — Interleaved (default)

Single scrollable column of cards. Each card:

- **Top-left:** thumbnail (~120 px tall; click to open lightbox at full resolution)
- **Top-right:** `canonicalName` (small, monospace, selectable); `Caption: …` (editable inline, placeholder "Add a caption…"); 🎙 re-record button; 🗑 delete button
- **Bottom:** narration text area (editable; live-streaming when this is the active segment; interim text in italic, final in normal)

"+" appears at the bottom of the column after the last card.

### View A — Split (toggled)

- **Left column** (40% width, scrollable): cards stacked vertically, condensed (thumbnail + name + caption only, no inline narration). Active card highlighted.
- **Right column** (60% width, scrollable): one big transcript area showing all segments concatenated with `--- Screenshot N — <name> ---` markers between them. Clicking a marker scrolls the corresponding card into view in the left column. Editing text on the right updates the underlying segment.
- "+" appears at the bottom of the left column.

### Card interactions (both views)

- **Click thumbnail** → lightbox at full resolution; arrow keys navigate; Esc closes
- **Click canonical name** → selects it (for copy)
- **Click caption** → inline edit; Enter or blur saves
- **🎙 re-record** → modal: "Re-recording for Screenshot N. Click Stop when done." Original master audio is preserved; only the segment's `reRecordedAudio` field is updated.
- **🗑 delete** → confirm modal: "Delete Screenshot N? This will remove the image and its narration. Sequence numbers will not be reused." Deleted card vanishes from card list and transcript. The PNG file moves to `<session>/.deleted/`.

### Toggle behavior

Single button in header. Switches the right pane in <50 ms (no data fetch, just re-render). Last-used view persisted in `localStorage` and used as default for next session.

### Empty / loading states

- **Pre-first-capture:** window doesn't exist
- **Mid-capture (window hidden):** no UI; selection overlay only
- **Transcribing on slow network:** interim text streams in italic gray; finalizes when committed
- **Offline:** persistent banner in header; transcript areas show grayed placeholder
- **Mic permission denied:** banner with "Grant access" button → opens System Settings

### Settings panel

Opened from `⋮` overflow menu. Initial scope: hotkeys only.

- **Hotkeys section** with one row per binding:
  - `Take next screenshot` (global; default `Cmd+Shift+C`)
  - `Copy & Send` (window-scoped; default `Cmd+Enter`)
  - `Re-record active segment` (window-scoped; default `Cmd+Shift+R`)
  - `Toggle view mode` (window-scoped; default `Cmd+T`)
- Click a binding → "Press new shortcut…" capture state → press combo → save. Esc cancels capture.
- Conflict detection: detect collisions with macOS-reserved combos (`Cmd+Q`, `Cmd+W`, `Cmd+Tab`, Mission Control bindings) and other VisionPipe bindings; show inline warning and block save.
- "Reset to defaults" per row + global "Reset all" button.
- **Storage:** Tauri app config dir (`~/Library/Application Support/com.visionpipe.desktop/settings.json`); survives app upgrades.

---

## 8. Testing strategy

### Unit tests (Rust)

- `metadata::collect_metadata()` — known-input fixtures for app/window/URL detection per browser
- `generate_canonical_name(seq, ts, app, context)` — sanitization, length cap at 180, hostname-vs-window-vs-fallback priority
- Session folder creation + path resolution — happy path, disk full, permission denied
- Edge proxy token issuance — first-launch token creation, rate-limit accounting

### Unit tests (TypeScript)

- Markdown render from `transcript.json` — golden-file tests for 1, 5, 100 screenshots, with/without captions, with/without re-records, with/without offline gaps
- View-mode toggle — same data renders identically (modulo layout) in B and A
- Auto-save debounce — 500 ms after last edit, immediate on capture/re-record
- Hotkey conflict detection — synthetic combos including macOS-reserved set

### Integration tests

- Full session lifecycle: hotkey → capture #1 → narrate → capture #2 → narrate → re-record #1 → Copy & Send → verify markdown + folder contents byte-for-byte against golden output
- Network kill mid-session: take 2 captures, sever network, take capture 3, restore network, take capture 4 → markdown shows offline note for #3 and live transcript for #4
- Mic permission denied flow: skip mic init, capture flow still works, markdown lacks `Narration` blocks
- Disk full mid-session: capture aborts gracefully; prior captures preserved
- Crash recovery: simulate process kill mid-session → re-launch → confirm session folder is intact and re-openable from Finder

### Manual smoke tests

- Take 1, 5, 25, and 100 captures in a single session — UI responsive, scroll performant, audio file uncorrupted
- Toggle B↔A repeatedly mid-narration — no scroll-position jank, no segment loss
- Paste markdown into actual Claude Code session — verify image references resolve and Claude can `Read` them
- Re-record a segment whose Deepgram transcription is mid-stream — confirm new segment fully overrides the old transcript
- Test on physical Apple Silicon Mac (M1, M2, and M4 if available)

---

## 9. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Deepgram WebSocket goes down at scale → all users lose real-time | High | Offline fallback (audio preserved). Status page for `vp-edge`. Alert on error rate. |
| `vp-edge` proxy gets DDoS'd or abused → bill spike | High | Per-token rate limit (60 min/day default). Hard infra-level cap on monthly spend. Per-IP rate limit on token issuance. Cloudflare in front. |
| 100-screenshot session generates a markdown file exceeding paste buffer | Med | Synthetic 100-screenshot fixture in CI. If real, "Copy & Send" auto-paginates with continuation markers. Defer fix until measured. |
| `audio-master.webm` corrupted by hard quit during MediaRecorder write | Med | MediaRecorder writes 1s chunks; worst case is losing last 1s. Document recovery in README. |
| Browser MediaRecorder behaves differently across macOS versions | Med | Pin Tauri webview version; CI matrix on macOS 13/14/15. |
| On-device transcription requested by privacy-conscious users post-launch | Low | Defer to v0.3 (WhisperKit opt-in path). Document in README. |
| `~/Pictures/VisionPipe/` grows unbounded | Low | "Auto-delete sessions older than N days" setting in v0.3. Sweep `<session>/.deleted/` on session start. |
| Sequence-number leakage on delete reveals prior content | Very Low | Sequence numbers are local-only; not transmitted. Acceptable. |
| Spec-2 cloud upload needs to address all this same data + auth | N/A | Session folder + `transcript.json` is the contract. Spec 2 reads from it; Spec 1 architecture stays cloud-agnostic. |

---

## 10. Spec 2 handoff notes

When Spec 2 (cloud sharing) is brainstormed, it will:

- Read from existing `~/Pictures/VisionPipe/session-<id>/` folders
- Add a "Save to cloud" button in the session window header (or footer next to "Copy & Send")
- Upload `audio-master.webm`, all PNGs, and `transcript.json` to cloud storage
- Rewrite `transcript.md` image references from local paths to public URLs
- Generate a secret link
- Gate the "Save to cloud" button behind billing state (free tier disabled or quota-limited)

Nothing in Spec 1 needs to change for Spec 2 to land. The session folder is the contract.

---

## 11. Out of scope (explicit)

These are intentionally not in this spec, called out so future sessions don't re-litigate:

- Cloud storage, secret links, billing tiers, web viewer (→ Spec 2)
- In-app session history browser (→ v0.3)
- Drag-to-reorder cards (→ v0.3)
- Resume prior session on app launch (→ v0.3)
- Per-screenshot drawing/markup (existing toolbar stays visual-only)
- Streaming retroactive transcription of pre-network-loss audio (→ v0.3)
- Cross-platform Windows/Linux support
- Custom transcription provider (WhisperKit on-device, OpenAI Whisper API, etc.) → v0.3 opt-in
