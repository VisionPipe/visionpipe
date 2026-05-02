# Multi-Screenshot Narrated Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Read first:** [`docs/superpowers/specs/2026-05-02-multi-screenshot-narrated-bundle-design.md`](../specs/2026-05-02-multi-screenshot-narrated-bundle-design.md) — especially §11 "Implementation handoff notes." That section captures the strategic context (brand-promise tradeoffs, why each architectural choice was made, etc.) that this plan does not repeat.

**Goal:** Replace VisionPipe's single-screenshot capture flow with a multi-screenshot session that supports continuous real-time voice narration via Deepgram, persistent auto-saved session folders on disk, and a markdown-on-clipboard output optimized for Claude Code consumption.

**Architecture:** The Tauri app gains a session-aware data model (`Session` containing N `Screenshot`s and one continuous `audio-master.webm`). The frontend manages session state via `useReducer` + Context (no new state-management dep). Audio is captured via the browser `MediaRecorder` API and streamed to Deepgram through a `vp-edge` proxy (mocked locally during this plan; production proxy is a separate plan). Each session writes its own folder to `~/Pictures/VisionPipe/session-<ts>/` containing screenshots, audio, `transcript.json` (machine-readable), and `transcript.md` (clipboard-ready). The existing single-shot composite-image flow in `App.tsx` is replaced wholesale. Two render modes (interleaved-default, split-on-toggle) share one segmented data model.

**Tech Stack:**
- Existing: Tauri 2 (Rust 2021), React 19 + TypeScript, Vite 6, macOS Apple Silicon target
- New frontend: Vitest + @testing-library/react (testing), `useReducer` + Context (state)
- New Rust deps: `keyring` (macOS Keychain access), `dirs` (cross-platform user-dir resolution)
- External services: Deepgram Nova-3 via WebSocket, accessed through `vp-edge` proxy (mocked locally; real proxy is a separate plan)
- No new state-management library, no new audio-encoding library — the browser MediaRecorder produces `audio/webm;codecs=opus` natively

---

## Pre-flight checks (do these before Task 1)

- [ ] Confirm working directory is `/Users/drodio/Projects/visionpipe` and current git branch is a fresh feature branch off `initial-build-out` (e.g., `multi-screenshot-bundle`). Create one if needed: `git checkout -b multi-screenshot-bundle`
- [ ] Confirm `pnpm install` and `pnpm tauri dev` work on a clean checkout before any changes (so any breakage during the plan is attributable)
- [ ] Confirm a Deepgram account exists with API credit available (~$10 covers all of v0.2 development testing) and the API key is exported as `DEEPGRAM_API_KEY` in your shell. If you don't have a key yet, sign up at <https://deepgram.com> — free tier includes $200 credit. The mock proxy can run without a real key (returns canned transcripts), but end-to-end testing requires a real key.
- [ ] Confirm `~/Pictures/VisionPipe/` is writable (the existing app already writes here)

---

## File structure

This plan creates and modifies the following files. Each task notes which files it touches.

**New TypeScript files (frontend):**

| File | Responsibility |
|---|---|
| `src/types/session.ts` | TypeScript types for `Session`, `Screenshot`, `AudioOffset`, `CaptureMetadata` |
| `src/state/session-reducer.ts` | `useReducer` reducer + action types for session state |
| `src/state/session-context.tsx` | React Context provider + `useSession()` hook |
| `src/lib/canonical-name.ts` | Generate `VisionPipe-{seq}-{ts}-{app}-{context}` strings |
| `src/lib/markdown-renderer.ts` | Render `Session` → markdown string for `transcript.md` and clipboard |
| `src/lib/audio-recorder.ts` | `MediaRecorder` wrapper for `audio-master.webm` and re-record blobs |
| `src/lib/deepgram-client.ts` | WebSocket client to `vp-edge` proxy; emits interim + final transcript events |
| `src/lib/install-token.ts` | First-launch token issuance + Keychain access (calls Rust commands) |
| `src/components/SessionWindow.tsx` | Top-level session UI (header + body + footer routing between View B / View A) |
| `src/components/Header.tsx` | Header bar (logo, session id, mic indicator, network state, view toggle, overflow menu) |
| `src/components/Footer.tsx` | Footer bar ("+ Take next screenshot", "Copy & Send") |
| `src/components/ScreenshotCard.tsx` | One card in interleaved view (View B) |
| `src/components/SplitView.tsx` | View A layout (cards left, transcript right) |
| `src/components/Lightbox.tsx` | Full-resolution image viewer modal |
| `src/components/ReRecordModal.tsx` | Modal for re-recording a single segment |
| `src/components/SettingsPanel.tsx` | Settings modal (hotkeys section) |
| `src/components/HotkeyBindingRow.tsx` | One row in the hotkeys section (capture state + conflict detection) |

**New TypeScript test files:**

| File | Tests |
|---|---|
| `src/lib/__tests__/canonical-name.test.ts` | Sanitization, length cap, hostname-vs-window-vs-fallback priority |
| `src/lib/__tests__/markdown-renderer.test.ts` | Golden-file tests for 1, 5, 100 screenshots, with/without captions/re-records/offline gaps |
| `src/state/__tests__/session-reducer.test.ts` | All action types, sequence-number invariants, soft-delete |
| `src/components/__tests__/HotkeyBindingRow.test.tsx` | Conflict detection against macOS-reserved combos |

**New Rust files (backend):**

| File | Responsibility |
|---|---|
| `src-tauri/src/session.rs` | Session folder creation, write `transcript.json`, list session files |
| `src-tauri/src/install_token.rs` | Issue, store (Keychain), retrieve per-install token for `vp-edge` |
| `src-tauri/src/hotkey_config.rs` | Load/save hotkey bindings to `settings.json` |

**New mock service for local development:**

| File | Responsibility |
|---|---|
| `vp-edge-mock/server.mjs` | Node script that runs a WebSocket server at `ws://localhost:8787/transcribe`. Echoes received audio frames and returns canned transcripts on a 1.5s cadence, OR forwards to real Deepgram if `DEEPGRAM_API_KEY` is set. |
| `vp-edge-mock/README.md` | Usage docs for the mock |

**Modified files:**

| File | Change |
|---|---|
| `src/App.tsx` | Major rewrite — collapses to a thin router between `idle` and `session` modes; delegates to `SessionWindow` |
| `src-tauri/src/lib.rs` | Add new commands: `create_session_folder`, `write_session_file`, `move_to_deleted`, `issue_install_token`, `get_install_token`, `load_hotkey_config`, `save_hotkey_config` |
| `src-tauri/src/main.rs` | Wire new modules (`session`, `install_token`, `hotkey_config`) |
| `src-tauri/Cargo.toml` | Add `keyring = "3"`, `dirs = "5"` |
| `src-tauri/capabilities/default.json` | Add `clipboard-manager:allow-write-image` (already present), confirm needed permissions |
| `src-tauri/tauri.conf.json` | No change expected |
| `package.json` | Add devDeps: `vitest`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `@types/ws` (for mock); add scripts: `test`, `test:watch`, `dev:proxy` |
| `vite.config.ts` | Add Vitest config block |
| `README.md` | Update transcription section: honest description that Deepgram is used; on-device WhisperKit on roadmap (per spec §11) |

**Files explicitly NOT touched in this plan** (deferred to v0.3 cleanup or other plans):
- `src-tauri/src/capture.rs`, `src-tauri/src/metadata.rs` — existing capture and metadata logic, used as-is
- The `cpal`, `candle-*`, `whisper-*`, `symphonia`, `rubato`, `tokenizers`, `hf-hub` Rust deps in `Cargo.toml` — were added speculatively for on-device Whisper; no longer used after this plan but left in place to keep this commit focused. Cleanup is a v0.3 task.

---

## Phase A — Foundation: types, session folder, canonical names

### Task 1: Add TypeScript test framework

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test-setup.ts`

- [ ] **Step 1: Install Vitest + Testing Library dev dependencies**

```bash
pnpm add -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/ws
```

Expected: dependencies install cleanly; `package.json` `devDependencies` block grows.

- [ ] **Step 2: Add test scripts to `package.json`**

In `package.json` `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui",
"dev:proxy": "node vp-edge-mock/server.mjs"
```

- [ ] **Step 3: Create `vitest.config.ts` at repo root**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: Create `src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Verify Vitest runs (against zero tests)**

Run: `pnpm test`
Expected: `No test files found, exiting with code 0` (or a similar "no tests" message — exit code 0 is fine; failure mode would be a config error)

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/test-setup.ts
git commit -m "Add Vitest + Testing Library for frontend tests"
```

---

### Task 2: TypeScript session types

**Files:**
- Create: `src/types/session.ts`

- [ ] **Step 1: Write the type file**

Create `src/types/session.ts`:

```ts
/**
 * Multi-screenshot session data model.
 * See docs/superpowers/specs/2026-05-02-multi-screenshot-narrated-bundle-design.md §4.
 */

export interface CaptureMetadata {
  app: string;
  window: string;
  resolution: string;
  scale: string;
  os: string;
  osBuild: string;
  timestamp: string;
  hostname: string;
  username: string;
  locale: string;
  timezone: string;
  displayCount: number;
  primaryDisplay: string;
  colorSpace: string;
  cpu: string;
  memoryGb: string;
  darkMode: boolean;
  battery: string;
  uptime: string;
  activeUrl: string;
  captureWidth: number;
  captureHeight: number;
  captureMethod: string;
  imageSizeKb: number;
}

export interface AudioOffset {
  /** Seconds into audio-master.webm where this segment starts */
  start: number;
  /** Seconds into audio-master.webm where this segment ends; null while still active */
  end: number | null;
}

export interface Screenshot {
  /** Sequence number — assigned at capture time, never reused after delete */
  seq: number;
  /** Full canonical name without extension; used as filename + alt + transcript marker */
  canonicalName: string;
  /** ISO-8601 timestamp of when the capture was taken */
  capturedAt: string;
  /** Position of this segment in audio-master.webm */
  audioOffset: AudioOffset;
  /** User-supplied free-text caption; empty string when unset */
  caption: string;
  /** Transcribed (or hand-edited) text for this segment */
  transcriptSegment: string;
  /** Filename of replacement audio if user re-recorded; null if using audio-master */
  reRecordedAudio: string | null;
  /** Capture metadata at the moment of screenshot */
  metadata: CaptureMetadata;
  /** True when this segment was captured during a network outage */
  offline: boolean;
}

export type ViewMode = "interleaved" | "split";

export interface Session {
  /** Compact timestamp id, e.g. "2026-05-02_14-23-07" */
  id: string;
  /** Absolute path to the session folder under ~/Pictures/VisionPipe/ */
  folder: string;
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601 */
  updatedAt: string;
  /** Filename of the master audio recording inside the session folder */
  audioFile: string;
  /** Last toggle state; "interleaved" is View B (default), "split" is View A */
  viewMode: ViewMode;
  screenshots: Screenshot[];
  /** Anything spoken AFTER the last screenshot until Copy & Send / session close */
  closingNarration: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: No errors. (If errors reference existing files, ignore — only new types must be clean.)

- [ ] **Step 3: Commit**

```bash
git add src/types/session.ts
git commit -m "Add TypeScript types for multi-screenshot session model"
```

---

### Task 3: Canonical name generator (TypeScript)

**Files:**
- Create: `src/lib/canonical-name.ts`
- Create: `src/lib/__tests__/canonical-name.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `src/lib/__tests__/canonical-name.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateCanonicalName, sanitizeContext } from "../canonical-name";

describe("generateCanonicalName", () => {
  const baseTs = "2026-05-02_14-23-07";

  it("uses URL-derived context when activeUrl is present", () => {
    const name = generateCanonicalName({
      seq: 1,
      timestamp: baseTs,
      app: "Google Chrome",
      activeUrl: "https://github.com/anthropics/claude-code/issues/2841",
      windowTitle: "Issue #2841 · anthropics/claude-code",
    });
    expect(name).toBe(
      "VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841"
    );
  });

  it("falls back to window title when no URL", () => {
    const name = generateCanonicalName({
      seq: 2,
      timestamp: baseTs,
      app: "Visual Studio Code",
      activeUrl: "",
      windowTitle: "visionpipe — App.tsx",
    });
    expect(name).toBe(
      "VisionPipe-002-2026-05-02_14-23-07-VSCode-visionpipe-App.tsx"
    );
  });

  it("emits app-only when neither URL nor window title", () => {
    const name = generateCanonicalName({
      seq: 3,
      timestamp: baseTs,
      app: "Terminal",
      activeUrl: "",
      windowTitle: "",
    });
    expect(name).toBe("VisionPipe-003-2026-05-02_14-23-07-Terminal");
  });

  it("zero-pads sequence to 3 digits", () => {
    const n = generateCanonicalName({
      seq: 47,
      timestamp: baseTs,
      app: "Chrome",
      activeUrl: "https://example.com",
      windowTitle: "",
    });
    expect(n).toMatch(/^VisionPipe-047-/);
  });

  it("hard-caps total length at 180 chars by truncating context only", () => {
    const longPath = "a".repeat(500);
    const n = generateCanonicalName({
      seq: 1,
      timestamp: baseTs,
      app: "Chrome",
      activeUrl: `https://example.com/${longPath}`,
      windowTitle: "",
    });
    expect(n.length).toBeLessThanOrEqual(180);
    expect(n.startsWith("VisionPipe-001-2026-05-02_14-23-07-Chrome-")).toBe(true);
  });

  it("strips path-unsafe characters from context", () => {
    const n = generateCanonicalName({
      seq: 1,
      timestamp: baseTs,
      app: "Chrome",
      activeUrl: "",
      windowTitle: 'foo/bar:baz*qux?<>"|',
    });
    expect(n).toBe("VisionPipe-001-2026-05-02_14-23-07-Chrome-foo-bar-baz-qux");
  });

  it("collapses runs of dashes and trims edges", () => {
    expect(sanitizeContext("foo // bar -- baz")).toBe("foo-bar-baz");
    expect(sanitizeContext("---hello---")).toBe("hello");
  });

  it("normalizes well-known app names", () => {
    expect(
      generateCanonicalName({
        seq: 1,
        timestamp: baseTs,
        app: "Visual Studio Code",
        activeUrl: "",
        windowTitle: "x",
      })
    ).toMatch(/-VSCode-/);
    expect(
      generateCanonicalName({
        seq: 1,
        timestamp: baseTs,
        app: "Google Chrome",
        activeUrl: "https://example.com",
        windowTitle: "",
      })
    ).toMatch(/-Chrome-/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: 8 failures, all "Cannot find module '../canonical-name'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/canonical-name.ts`:

```ts
/**
 * Generate canonical screenshot names: VisionPipe-{seq}-{ts}-{app}-{context}.
 * See spec §5 for naming format details.
 */

const MAX_TOTAL_LENGTH = 180;
const PATH_UNSAFE = /[\/\\:*?"<>|]/g;

const APP_NAME_NORMALIZATION: Record<string, string> = {
  "Google Chrome": "Chrome",
  "Visual Studio Code": "VSCode",
  "Microsoft Visual Studio Code": "VSCode",
  "Sublime Text": "Sublime",
  "iTerm2": "iTerm",
};

function shortenAppName(app: string): string {
  if (APP_NAME_NORMALIZATION[app]) return APP_NAME_NORMALIZATION[app];
  // Drop common .app suffix and "Inc." style noise
  return app.replace(/\.app$/, "").replace(/\s+Inc\.?$/, "").trim();
}

export function sanitizeContext(input: string): string {
  return input
    .replace(PATH_UNSAFE, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function urlToContext(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, "").replace(/\/$/, "");
    return sanitizeContext(path ? `${u.hostname}-${path}` : u.hostname);
  } catch {
    return "";
  }
}

interface NameInput {
  seq: number;
  timestamp: string;
  app: string;
  activeUrl: string;
  windowTitle: string;
}

export function generateCanonicalName(input: NameInput): string {
  const seq = String(input.seq).padStart(3, "0");
  const app = sanitizeContext(shortenAppName(input.app));
  const prefix = `VisionPipe-${seq}-${input.timestamp}-${app}`;

  let context = "";
  if (input.activeUrl) {
    context = urlToContext(input.activeUrl);
  }
  if (!context && input.windowTitle) {
    context = sanitizeContext(input.windowTitle);
  }

  if (!context) return prefix;

  const fullName = `${prefix}-${context}`;
  if (fullName.length <= MAX_TOTAL_LENGTH) return fullName;

  const remaining = MAX_TOTAL_LENGTH - prefix.length - 1;
  return `${prefix}-${context.slice(0, remaining)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: 8 passing tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canonical-name.ts src/lib/__tests__/canonical-name.test.ts
git commit -m "Add canonical name generator with sanitization and length cap"
```

---

### Task 4: Rust session folder management

**Files:**
- Create: `src-tauri/src/session.rs`
- Modify: `src-tauri/src/lib.rs` (add module + commands)
- Modify: `src-tauri/src/main.rs` (no change typically; lib.rs is the entry)
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `dirs` dependency for cross-platform user-dir resolution**

Edit `src-tauri/Cargo.toml`, adding under `[dependencies]`:

```toml
dirs = "5"
```

- [ ] **Step 2: Write `src-tauri/src/session.rs`**

```rust
use std::fs;
use std::path::PathBuf;

/// Returns the absolute path to ~/Pictures/VisionPipe/ creating it if needed.
pub fn visionpipe_root() -> Result<PathBuf, String> {
    let pictures = dirs::picture_dir()
        .ok_or_else(|| "Could not resolve user pictures directory".to_string())?;
    let root = pictures.join("VisionPipe");
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create {}: {}", root.display(), e))?;
    Ok(root)
}

/// Creates a new session folder under ~/Pictures/VisionPipe/session-<id>/ and returns its absolute path.
pub fn create_session_folder(session_id: &str) -> Result<String, String> {
    let folder = visionpipe_root()?.join(format!("session-{}", session_id));
    fs::create_dir_all(&folder).map_err(|e| format!("Failed to create session folder: {}", e))?;
    fs::create_dir_all(folder.join(".deleted"))
        .map_err(|e| format!("Failed to create .deleted folder: {}", e))?;
    Ok(folder.to_string_lossy().into_owned())
}

/// Writes raw bytes to <session_folder>/<filename>. Used for screenshots, transcript.json, transcript.md, audio.
pub fn write_session_file(folder: &str, filename: &str, bytes: Vec<u8>) -> Result<String, String> {
    let path = PathBuf::from(folder).join(filename);
    fs::write(&path, bytes).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Soft-deletes a screenshot by moving it to <session_folder>/.deleted/.
pub fn move_to_deleted(folder: &str, filename: &str) -> Result<(), String> {
    let src = PathBuf::from(folder).join(filename);
    let dst = PathBuf::from(folder).join(".deleted").join(filename);
    fs::rename(&src, &dst).map_err(|e| format!("Failed to soft-delete: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn create_session_folder_makes_nested_dirs() {
        let test_id = format!("test-{}", chrono::Local::now().format("%Y%m%d%H%M%S%f"));
        let folder = create_session_folder(&test_id).expect("create_session_folder failed");
        let path = PathBuf::from(&folder);
        assert!(path.is_dir());
        assert!(path.join(".deleted").is_dir());
        // Cleanup
        fs::remove_dir_all(&path).ok();
    }

    #[test]
    fn write_session_file_writes_bytes() {
        let test_id = format!("test-{}", chrono::Local::now().format("%Y%m%d%H%M%S%f"));
        let folder = create_session_folder(&test_id).expect("create_session_folder failed");
        let path = write_session_file(&folder, "hello.txt", b"world".to_vec())
            .expect("write_session_file failed");
        let contents = fs::read_to_string(&path).expect("read failed");
        assert_eq!(contents, "world");
        fs::remove_dir_all(&folder).ok();
    }
}
```

- [ ] **Step 3: Wire `session` module + commands in `src-tauri/src/lib.rs`**

In `src-tauri/src/lib.rs`, after the existing `mod capture;` and `mod metadata;` lines, add:

```rust
mod session;
```

Then add three new `#[tauri::command]` functions before `pub fn run()`:

```rust
#[tauri::command]
async fn create_session_folder(session_id: String) -> Result<String, String> {
    session::create_session_folder(&session_id)
}

#[tauri::command]
async fn write_session_file(folder: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    session::write_session_file(&folder, &filename, bytes)
}

#[tauri::command]
async fn move_to_deleted(folder: String, filename: String) -> Result<(), String> {
    session::move_to_deleted(&folder, &filename)
}
```

In the existing `.invoke_handler(tauri::generate_handler![...])` call, add the three new commands:

```rust
.invoke_handler(tauri::generate_handler![
    take_screenshot,
    capture_fullscreen,
    get_metadata,
    save_and_copy_image,
    create_session_folder,
    write_session_file,
    move_to_deleted,
])
```

- [ ] **Step 4: Run Rust tests to verify**

Run: `cd src-tauri && cargo test session::tests`
Expected: 2 passing tests.

- [ ] **Step 5: Verify the app still builds**

Run: `pnpm tauri build --debug` (faster than full release build)
Expected: build succeeds without errors. (You may see warnings about unused imports for the existing `cpal`/`candle-*` deps — those are pre-existing and ignored for this plan.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/session.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Add Rust session folder management with create/write/soft-delete commands"
```

---

### Task 5: Session reducer + Context

**Files:**
- Create: `src/state/session-reducer.ts`
- Create: `src/state/session-context.tsx`
- Create: `src/state/__tests__/session-reducer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/state/__tests__/session-reducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sessionReducer, initialState, type SessionState } from "../session-reducer";
import type { Screenshot, CaptureMetadata } from "../../types/session";

const fakeMeta = (): CaptureMetadata => ({
  app: "Chrome", window: "GitHub", resolution: "2560x1600", scale: "2x",
  os: "macOS 15.3", osBuild: "24D81", timestamp: "2026-05-02T14:23:07Z",
  hostname: "host", username: "user", locale: "en-US", timezone: "PDT",
  displayCount: 1, primaryDisplay: "Built-in", colorSpace: "Display P3",
  cpu: "M2", memoryGb: "16", darkMode: true, battery: "80%", uptime: "1d",
  activeUrl: "https://github.com", captureWidth: 1200, captureHeight: 800,
  captureMethod: "Region", imageSizeKb: 240,
});

const fakeScreenshot = (seq: number): Screenshot => ({
  seq,
  canonicalName: `VisionPipe-${String(seq).padStart(3, "0")}-x`,
  capturedAt: "2026-05-02T14:23:07Z",
  audioOffset: { start: 0, end: null },
  caption: "",
  transcriptSegment: "",
  reRecordedAudio: null,
  metadata: fakeMeta(),
  offline: false,
});

describe("sessionReducer", () => {
  it("starts in idle state", () => {
    expect(initialState.session).toBeNull();
  });

  it("creates a session on START_SESSION", () => {
    const next = sessionReducer(initialState, {
      type: "START_SESSION",
      session: {
        id: "2026-05-02_14-23-07",
        folder: "/tmp/session-x",
        createdAt: "2026-05-02T14:23:07Z",
        updatedAt: "2026-05-02T14:23:07Z",
        audioFile: "audio-master.webm",
        viewMode: "interleaved",
        screenshots: [],
        closingNarration: "",
      },
    });
    expect(next.session?.id).toBe("2026-05-02_14-23-07");
  });

  it("appends screenshots and assigns audioOffset.end to prior", () => {
    const start: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [{ ...fakeScreenshot(1), audioOffset: { start: 0, end: null } }],
        closingNarration: "",
      },
    };
    const next = sessionReducer(start, {
      type: "APPEND_SCREENSHOT",
      screenshot: fakeScreenshot(2),
      audioElapsedSec: 12.5,
    });
    expect(next.session!.screenshots).toHaveLength(2);
    expect(next.session!.screenshots[0].audioOffset.end).toBe(12.5);
    expect(next.session!.screenshots[1].audioOffset.start).toBe(12.5);
  });

  it("never reuses sequence numbers after delete", () => {
    let state: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [fakeScreenshot(1), fakeScreenshot(2), fakeScreenshot(3)],
        closingNarration: "",
      },
    };
    state = sessionReducer(state, { type: "DELETE_SCREENSHOT", seq: 2 });
    expect(state.session!.screenshots.map(s => s.seq)).toEqual([1, 3]);
    state = sessionReducer(state, {
      type: "APPEND_SCREENSHOT",
      screenshot: fakeScreenshot(4), // caller is responsible for picking the next seq; reducer trusts it
      audioElapsedSec: 30,
    });
    expect(state.session!.screenshots.map(s => s.seq)).toEqual([1, 3, 4]);
  });

  it("updates a caption by seq", () => {
    let state: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [fakeScreenshot(1), fakeScreenshot(2)],
        closingNarration: "",
      },
    };
    state = sessionReducer(state, { type: "UPDATE_CAPTION", seq: 2, caption: "the bug" });
    expect(state.session!.screenshots[1].caption).toBe("the bug");
    expect(state.session!.screenshots[0].caption).toBe("");
  });

  it("toggles view mode", () => {
    let state: SessionState = {
      session: {
        id: "x", folder: "/tmp", createdAt: "", updatedAt: "",
        audioFile: "audio-master.webm", viewMode: "interleaved",
        screenshots: [], closingNarration: "",
      },
    };
    state = sessionReducer(state, { type: "TOGGLE_VIEW_MODE" });
    expect(state.session!.viewMode).toBe("split");
    state = sessionReducer(state, { type: "TOGGLE_VIEW_MODE" });
    expect(state.session!.viewMode).toBe("interleaved");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: failures referencing missing module `../session-reducer`.

- [ ] **Step 3: Write the reducer**

Create `src/state/session-reducer.ts`:

```ts
import type { Session, Screenshot, ViewMode } from "../types/session";

export interface SessionState {
  session: Session | null;
}

export const initialState: SessionState = { session: null };

export type SessionAction =
  | { type: "START_SESSION"; session: Session }
  | { type: "END_SESSION" }
  | { type: "APPEND_SCREENSHOT"; screenshot: Screenshot; audioElapsedSec: number }
  | { type: "DELETE_SCREENSHOT"; seq: number }
  | { type: "UPDATE_CAPTION"; seq: number; caption: string }
  | { type: "UPDATE_TRANSCRIPT_SEGMENT"; seq: number; text: string }
  | { type: "APPEND_TO_ACTIVE_SEGMENT"; text: string }
  | { type: "MARK_OFFLINE"; seq: number; offline: boolean }
  | { type: "SET_RE_RECORDED_AUDIO"; seq: number; filename: string | null }
  | { type: "UPDATE_CLOSING_NARRATION"; text: string }
  | { type: "APPEND_TO_CLOSING_NARRATION"; text: string }
  | { type: "TOGGLE_VIEW_MODE" }
  | { type: "SET_VIEW_MODE"; viewMode: ViewMode };

const touch = (s: Session): Session => ({ ...s, updatedAt: new Date().toISOString() });

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "START_SESSION":
      return { session: action.session };

    case "END_SESSION":
      return { session: null };

    case "APPEND_SCREENSHOT": {
      if (!state.session) return state;
      const updated = state.session.screenshots.map((s, i, arr) =>
        i === arr.length - 1 && s.audioOffset.end === null
          ? { ...s, audioOffset: { ...s.audioOffset, end: action.audioElapsedSec } }
          : s
      );
      const next: Screenshot = {
        ...action.screenshot,
        audioOffset: { start: action.audioElapsedSec, end: null },
      };
      return { session: touch({ ...state.session, screenshots: [...updated, next] }) };
    }

    case "DELETE_SCREENSHOT": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.filter(s => s.seq !== action.seq),
        }),
      };
    }

    case "UPDATE_CAPTION": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, caption: action.caption } : s
          ),
        }),
      };
    }

    case "UPDATE_TRANSCRIPT_SEGMENT": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, transcriptSegment: action.text } : s
          ),
        }),
      };
    }

    case "APPEND_TO_ACTIVE_SEGMENT": {
      if (!state.session) return state;
      const screenshots = [...state.session.screenshots];
      if (screenshots.length === 0) {
        return { session: touch({ ...state.session, closingNarration: state.session.closingNarration + action.text }) };
      }
      const last = screenshots[screenshots.length - 1];
      screenshots[screenshots.length - 1] = { ...last, transcriptSegment: last.transcriptSegment + action.text };
      return { session: touch({ ...state.session, screenshots }) };
    }

    case "MARK_OFFLINE": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, offline: action.offline } : s
          ),
        }),
      };
    }

    case "SET_RE_RECORDED_AUDIO": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          screenshots: state.session.screenshots.map(s =>
            s.seq === action.seq ? { ...s, reRecordedAudio: action.filename } : s
          ),
        }),
      };
    }

    case "UPDATE_CLOSING_NARRATION": {
      if (!state.session) return state;
      return { session: touch({ ...state.session, closingNarration: action.text }) };
    }

    case "APPEND_TO_CLOSING_NARRATION": {
      if (!state.session) return state;
      return { session: touch({ ...state.session, closingNarration: state.session.closingNarration + action.text }) };
    }

    case "TOGGLE_VIEW_MODE": {
      if (!state.session) return state;
      return {
        session: touch({
          ...state.session,
          viewMode: state.session.viewMode === "interleaved" ? "split" : "interleaved",
        }),
      };
    }

    case "SET_VIEW_MODE": {
      if (!state.session) return state;
      return { session: touch({ ...state.session, viewMode: action.viewMode }) };
    }

    default:
      return state;
  }
}
```

- [ ] **Step 4: Create the React Context provider**

Create `src/state/session-context.tsx`:

```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { sessionReducer, initialState, type SessionState, type SessionAction } from "./session-reducer";

interface ContextValue {
  state: SessionState;
  dispatch: Dispatch<SessionAction>;
}

const SessionContext = createContext<ContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  return (
    <SessionContext.Provider value={{ state, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): ContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: all session-reducer tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/state/ src/lib/__tests__/canonical-name.test.ts
git commit -m "Add session reducer and React Context for multi-screenshot state"
```

---

## Phase B — Markdown rendering

### Task 6: Markdown renderer with golden-file tests

**Files:**
- Create: `src/lib/markdown-renderer.ts`
- Create: `src/lib/__tests__/markdown-renderer.test.ts`
- Create: `src/lib/__tests__/__fixtures__/session-2-screenshots.json`
- Create: `src/lib/__tests__/__fixtures__/session-2-screenshots.expected.md`

- [ ] **Step 1: Write the fixture session JSON**

Create `src/lib/__tests__/__fixtures__/session-2-screenshots.json`:

```json
{
  "id": "2026-05-02_14-23-07",
  "folder": "/Users/test/Pictures/VisionPipe/session-2026-05-02_14-23-07",
  "createdAt": "2026-05-02T14:23:07-07:00",
  "updatedAt": "2026-05-02T14:27:25-07:00",
  "audioFile": "audio-master.webm",
  "viewMode": "interleaved",
  "screenshots": [
    {
      "seq": 1,
      "canonicalName": "VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841",
      "capturedAt": "2026-05-02T14:23:07-07:00",
      "audioOffset": { "start": 0, "end": 47.2 },
      "caption": "Login button missing in dark mode — this is the bug I want you to fix",
      "transcriptSegment": "So the issue is the login button just doesn't render in dark mode, you can see in the screenshot that the area where it should be is just empty. This started happening after we switched to the new theme tokens last week.",
      "reRecordedAudio": null,
      "offline": false,
      "metadata": {
        "app": "Google Chrome",
        "window": "Issue #2841 · anthropics/claude-code",
        "resolution": "2560x1600",
        "scale": "2x",
        "os": "macOS 15.3.2",
        "osBuild": "24D81",
        "timestamp": "2026-05-02T21:23:07Z",
        "hostname": "host", "username": "user", "locale": "en-US", "timezone": "PDT",
        "displayCount": 1, "primaryDisplay": "Built-in", "colorSpace": "Display P3",
        "cpu": "Apple M2", "memoryGb": "16", "darkMode": true, "battery": "80%",
        "uptime": "1d", "activeUrl": "https://github.com/anthropics/claude-code/issues/2841",
        "captureWidth": 2400, "captureHeight": 1500, "captureMethod": "Region", "imageSizeKb": 384
      }
    },
    {
      "seq": 2,
      "canonicalName": "VisionPipe-002-2026-05-02_14-23-45-VSCode-visionpipe-src-App.tsx",
      "capturedAt": "2026-05-02T14:23:45-07:00",
      "audioOffset": { "start": 47.2, "end": 198.0 },
      "caption": "This is the handler — line 234 looks suspicious",
      "transcriptSegment": "Here's the handler in App.tsx, line 234, this is where I think the issue is. The conditional check on theme is wrong — it's looking at `isDarkMode` but we renamed that prop to `theme === \"dark\"` two commits ago.",
      "reRecordedAudio": null,
      "offline": false,
      "metadata": {
        "app": "Visual Studio Code",
        "window": "visionpipe — App.tsx",
        "resolution": "2560x1600", "scale": "2x", "os": "macOS 15.3.2",
        "osBuild": "24D81", "timestamp": "2026-05-02T21:23:45Z",
        "hostname": "host", "username": "user", "locale": "en-US", "timezone": "PDT",
        "displayCount": 1, "primaryDisplay": "Built-in", "colorSpace": "Display P3",
        "cpu": "Apple M2", "memoryGb": "16", "darkMode": true, "battery": "80%",
        "uptime": "1d", "activeUrl": "",
        "captureWidth": 2400, "captureHeight": 1500, "captureMethod": "Region", "imageSizeKb": 412
      }
    }
  ],
  "closingNarration": "Can you take a look and fix it? I think the conditional on line 234 is the issue but I'd like you to verify and also check if there are other places where the old prop name is referenced."
}
```

- [ ] **Step 2: Write the expected markdown fixture**

Create `src/lib/__tests__/__fixtures__/session-2-screenshots.expected.md`:

````markdown
# VisionPipe session — 2026-05-02 14:23:07

**Session folder:** `/Users/test/Pictures/VisionPipe/session-2026-05-02_14-23-07/`
**Screenshots:** 2
**Duration:** 3m 18s
**Audio:** `/Users/test/Pictures/VisionPipe/session-2026-05-02_14-23-07/audio-master.webm`

---

## Screenshot 1 — VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841

![VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841](/Users/test/Pictures/VisionPipe/session-2026-05-02_14-23-07/VisionPipe-001-2026-05-02_14-23-07-Chrome-github.com-anthropics-claude-code-issues-2841.png)

**Caption:** Login button missing in dark mode — this is the bug I want you to fix

**Context:**
- App: Google Chrome
- URL: https://github.com/anthropics/claude-code/issues/2841
- Window: Issue #2841 · anthropics/claude-code
- Captured at: 2026-05-02T14:23:07-07:00
- Display: 2560x1600 @ 2x

**Narration:**

> So the issue is the login button just doesn't render in dark mode, you can see in the screenshot that the area where it should be is just empty. This started happening after we switched to the new theme tokens last week.

---

## Screenshot 2 — VisionPipe-002-2026-05-02_14-23-45-VSCode-visionpipe-src-App.tsx

![VisionPipe-002-2026-05-02_14-23-45-VSCode-visionpipe-src-App.tsx](/Users/test/Pictures/VisionPipe/session-2026-05-02_14-23-07/VisionPipe-002-2026-05-02_14-23-45-VSCode-visionpipe-src-App.tsx.png)

**Caption:** This is the handler — line 234 looks suspicious

**Context:**
- App: Visual Studio Code
- Window: visionpipe — App.tsx
- Captured at: 2026-05-02T14:23:45-07:00
- Display: 2560x1600 @ 2x

**Narration:**

> Here's the handler in App.tsx, line 234, this is where I think the issue is. The conditional check on theme is wrong — it's looking at `isDarkMode` but we renamed that prop to `theme === "dark"` two commits ago.

---

## Closing narration

> Can you take a look and fix it? I think the conditional on line 234 is the issue but I'd like you to verify and also check if there are other places where the old prop name is referenced.

---

*Generated by VisionPipe — `screenshot | llm`*
````

- [ ] **Step 3: Write failing renderer tests**

Create `src/lib/__tests__/markdown-renderer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "../markdown-renderer";
import type { Session } from "../../types/session";

const fixtureSession = (name: string): Session =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", `${name}.json`), "utf-8"));

const fixtureExpected = (name: string): string =>
  fs.readFileSync(path.join(__dirname, "__fixtures__", `${name}.expected.md`), "utf-8");

describe("renderMarkdown", () => {
  it("renders a 2-screenshot session matching the golden fixture", () => {
    const session = fixtureSession("session-2-screenshots");
    const md = renderMarkdown(session);
    expect(md).toBe(fixtureExpected("session-2-screenshots"));
  });

  it("renders an empty narration block for offline-captured screenshots", () => {
    const session = fixtureSession("session-2-screenshots");
    session.screenshots[0].transcriptSegment = "";
    session.screenshots[0].offline = true;
    const md = renderMarkdown(session);
    expect(md).toContain("*Transcription unavailable — captured offline.");
    expect(md).toContain("Audio segment available at `audio-master.webm` from 0.0s to 47.2s.");
  });

  it("renders without a Closing narration section when empty", () => {
    const session = fixtureSession("session-2-screenshots");
    session.closingNarration = "";
    const md = renderMarkdown(session);
    expect(md).not.toContain("## Closing narration");
  });

  it("formats Caption block only when caption is non-empty", () => {
    const session = fixtureSession("session-2-screenshots");
    session.screenshots[0].caption = "";
    const md = renderMarkdown(session);
    // first screenshot has no caption now
    const sec1 = md.split("---")[1] ?? md;
    expect(sec1).not.toContain("**Caption:**");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test markdown-renderer`
Expected: 4 failures referencing missing `../markdown-renderer`.

- [ ] **Step 5: Write the renderer**

Create `src/lib/markdown-renderer.ts`:

```ts
import type { Session, Screenshot } from "../types/session";

const formatDuration = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
};

const sessionDurationSec = (session: Session): number => {
  if (session.screenshots.length === 0) return 0;
  const last = session.screenshots[session.screenshots.length - 1];
  return last.audioOffset.end ?? last.audioOffset.start;
};

const stripTimezoneSuffix = (iso: string): string => iso.split(/[T+Z-]/g).slice(0, 3).join("-").replace(/-(\d\d-\d\d)$/, " $1").replace(/-/g, "-").replace(/^(\d{4}-\d\d-\d\d) (\d\d-\d\d)/, "$1 $2:00");
// the helpers above only used for the H1 timestamp; we just want "YYYY-MM-DD HH:MM:SS" in local-ish form
// simpler:
const friendlyTs = (iso: string): string => {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : iso;
};

const renderContext = (s: Screenshot): string => {
  const lines = [`- App: ${s.metadata.app}`];
  if (s.metadata.activeUrl) lines.push(`- URL: ${s.metadata.activeUrl}`);
  if (s.metadata.window) lines.push(`- Window: ${s.metadata.window}`);
  lines.push(`- Captured at: ${s.capturedAt}`);
  lines.push(`- Display: ${s.metadata.resolution} @ ${s.metadata.scale}`);
  return lines.join("\n");
};

const renderNarration = (s: Screenshot): string => {
  if (s.offline && !s.transcriptSegment) {
    const start = s.audioOffset.start.toFixed(1);
    const end = (s.audioOffset.end ?? s.audioOffset.start).toFixed(1);
    return `> *Transcription unavailable — captured offline. Audio segment available at \`audio-master.webm\` from ${start}s to ${end}s.*`;
  }
  return `> ${s.transcriptSegment}`;
};

const renderScreenshot = (s: Screenshot, folder: string): string => {
  const imgPath = `${folder}/${s.canonicalName}.png`;
  const blocks: string[] = [];
  blocks.push(`## Screenshot ${s.seq} — ${s.canonicalName}`);
  blocks.push("");
  blocks.push(`![${s.canonicalName}](${imgPath})`);
  blocks.push("");
  if (s.caption) {
    blocks.push(`**Caption:** ${s.caption}`);
    blocks.push("");
  }
  blocks.push("**Context:**");
  blocks.push(renderContext(s));
  blocks.push("");
  blocks.push("**Narration:**");
  blocks.push("");
  blocks.push(renderNarration(s));
  return blocks.join("\n");
};

export function renderMarkdown(session: Session): string {
  const folder = session.folder.replace(/\/$/, "");
  const audioPath = `${folder}/${session.audioFile}`;
  const duration = formatDuration(sessionDurationSec(session));

  const parts: string[] = [];
  parts.push(`# VisionPipe session — ${friendlyTs(session.createdAt)}`);
  parts.push("");
  parts.push(`**Session folder:** \`${folder}/\``);
  parts.push(`**Screenshots:** ${session.screenshots.length}`);
  parts.push(`**Duration:** ${duration}`);
  parts.push(`**Audio:** \`${audioPath}\``);
  parts.push("");
  parts.push("---");
  parts.push("");

  for (const s of session.screenshots) {
    parts.push(renderScreenshot(s, folder));
    parts.push("");
    parts.push("---");
    parts.push("");
  }

  if (session.closingNarration.trim()) {
    parts.push("## Closing narration");
    parts.push("");
    parts.push(`> ${session.closingNarration}`);
    parts.push("");
    parts.push("---");
    parts.push("");
  }

  parts.push("*Generated by VisionPipe — `screenshot | llm`*");
  parts.push("");

  return parts.join("\n");
}
```

- [ ] **Step 6: Run tests; iterate on whitespace until they match the golden**

Run: `pnpm test markdown-renderer`

If the first test fails on whitespace, do NOT relax the assertion — fix the renderer's output to match the fixture byte-for-byte. The fixture is the contract; the renderer follows it. Use `git diff --no-index` between actual and expected to spot the diff.

Expected eventually: 4 passing tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/markdown-renderer.ts src/lib/__tests__/markdown-renderer.test.ts src/lib/__tests__/__fixtures__/
git commit -m "Add markdown renderer with golden-file tests for clipboard output"
```

---

## Phase C — Session window shell + first-capture flow

### Task 7: Replace App.tsx with thin idle/session router

**Files:**
- Modify: `src/App.tsx` (significant; rewrite)
- Create: `src/components/IdleScreen.tsx`
- Create: `src/components/SessionWindow.tsx` (placeholder; expanded in Task 9)
- Create: `src/components/SelectionOverlay.tsx` (extracted from existing App.tsx)

> **Note:** The existing 847-line `App.tsx` will be largely replaced. Read it once before starting so you can preserve the working pieces (region-select drag math, the metadata fetch, the `take_screenshot` invoke). The pieces that go away: composite-image canvas rendering, single-screenshot annotation panel, sidebar metadata block, the credits HUD.

- [ ] **Step 1: Extract the existing region-select overlay into its own component**

Create `src/components/SelectionOverlay.tsx`. Move the selection-mode UI from `App.tsx` (the full-screen overlay with crosshair, drag handlers, Enter for fullscreen, Esc to cancel). The component takes two callbacks:

```tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  onCapture: (pngBytes: Uint8Array) => void;
  onCancel: () => void;
}

interface SelectionRect { startX: number; startY: number; endX: number; endY: number; }

export function SelectionOverlay({ onCapture, onCancel }: Props) {
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const completeSelection = useCallback(async (rect: SelectionRect) => {
    const x = Math.min(rect.startX, rect.endX);
    const y = Math.min(rect.startY, rect.endY);
    const w = Math.abs(rect.endX - rect.startX);
    const h = Math.abs(rect.endY - rect.startY);
    if (w < 10 || h < 10) return;

    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const dpr = window.devicePixelRatio || 1;
    const screenX = Math.round(x + pos.x / dpr);
    const screenY = Math.round(y + pos.y / dpr);

    const dataUri = await invoke<string>("take_screenshot", {
      x: screenX, y: screenY, width: Math.round(w), height: Math.round(h),
    });
    const base64 = dataUri.split(",")[1];
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    onCapture(bytes);
  }, [onCapture]);

  const captureFullscreen = useCallback(async () => {
    const dataUri = await invoke<string>("capture_fullscreen");
    const base64 = dataUri.split(",")[1];
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    onCapture(bytes);
  }, [onCapture]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") captureFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureFullscreen, onCancel]);

  return (
    <div
      style={{ position: "fixed", inset: 0, cursor: "crosshair", background: "rgba(0,0,0,0.2)" }}
      onMouseDown={(e) => {
        setIsDragging(true);
        setSelection({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY });
      }}
      onMouseMove={(e) => {
        if (!isDragging || !selection) return;
        setSelection({ ...selection, endX: e.clientX, endY: e.clientY });
      }}
      onMouseUp={() => {
        setIsDragging(false);
        if (selection) completeSelection(selection);
      }}
    >
      {selection && (
        <div style={{
          position: "absolute",
          left: Math.min(selection.startX, selection.endX),
          top: Math.min(selection.startY, selection.endY),
          width: Math.abs(selection.endX - selection.startX),
          height: Math.abs(selection.endY - selection.startY),
          border: "2px solid #2e8b7a",
          background: "rgba(46, 139, 122, 0.1)",
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)",
        background: "rgba(20, 30, 24, 0.85)", color: "#cfd8d2",
        padding: "8px 20px", borderRadius: 999, fontSize: 14, fontFamily: "Verdana",
      }}>
        Drag a region · Enter for fullscreen · Esc to cancel
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the placeholder `SessionWindow.tsx`**

Create `src/components/SessionWindow.tsx`:

```tsx
import { useSession } from "../state/session-context";

export function SessionWindow() {
  const { state } = useSession();
  if (!state.session) return null;
  return (
    <div style={{ padding: 24, color: "#cfd8d2", fontFamily: "Verdana" }}>
      <h2>Session {state.session.id}</h2>
      <p>{state.session.screenshots.length} screenshot(s)</p>
      <pre style={{ fontSize: 11, opacity: 0.7 }}>{JSON.stringify(state.session, null, 2)}</pre>
    </div>
  );
}
```

(This is a temporary skeleton. Tasks 8–14 build out the real UI.)

- [ ] **Step 3: Create `IdleScreen.tsx`**

Create `src/components/IdleScreen.tsx`:

```tsx
export function IdleScreen() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", color: "#8a9a8a", fontFamily: "Verdana", fontSize: 14,
    }}>
      Press Cmd+Shift+C to start a capture session.
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `App.tsx` as a thin router**

Replace `src/App.tsx` entirely:

```tsx
import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SessionProvider, useSession } from "./state/session-context";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { SessionWindow } from "./components/SessionWindow";
import { IdleScreen } from "./components/IdleScreen";
import { generateCanonicalName } from "./lib/canonical-name";
import type { CaptureMetadata, Screenshot } from "./types/session";

type AppMode = "idle" | "selecting" | "session";

function AppInner() {
  const { state, dispatch } = useSession();
  const [mode, setMode] = useState<AppMode>("idle");

  // Listen for the global hotkey event from Rust
  useEffect(() => {
    const unlisten = listen<string>("start-capture", () => {
      console.log("[VisionPipe] start-capture received");
      setMode("selecting");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const onCapture = useCallback(async (pngBytes: Uint8Array) => {
    const metadata = await invoke<CaptureMetadata>("get_metadata");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const sessionId = state.session?.id ?? ts;

    let folder = state.session?.folder;
    if (!state.session) {
      folder = await invoke<string>("create_session_folder", { sessionId });
      dispatch({
        type: "START_SESSION",
        session: {
          id: sessionId, folder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          audioFile: "audio-master.webm", viewMode: "interleaved",
          screenshots: [], closingNarration: "",
        },
      });
    }

    const seq = (state.session?.screenshots[state.session.screenshots.length - 1]?.seq ?? 0) + 1;
    const canonicalName = generateCanonicalName({
      seq, timestamp: ts, app: metadata.app,
      activeUrl: metadata.activeUrl, windowTitle: metadata.window,
    });

    await invoke("write_session_file", {
      folder: folder!, filename: `${canonicalName}.png`, bytes: Array.from(pngBytes),
    });

    const screenshot: Screenshot = {
      seq, canonicalName, capturedAt: new Date().toISOString(),
      audioOffset: { start: 0, end: null }, // reducer overwrites .start using audioElapsedSec; placeholder safe
      caption: "", transcriptSegment: "", reRecordedAudio: null,
      metadata, offline: false,
    };
    dispatch({ type: "APPEND_SCREENSHOT", screenshot, audioElapsedSec: 0 });

    setMode("session");
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
    await win.setAlwaysOnTop(false);
  }, [state.session, dispatch]);

  const onCancelCapture = useCallback(async () => {
    if (state.session) {
      setMode("session");
      const win = getCurrentWindow();
      await win.show();
    } else {
      setMode("idle");
      const win = getCurrentWindow();
      await win.hide();
    }
  }, [state.session]);

  // Hide window when entering selection mode
  useEffect(() => {
    if (mode === "selecting") {
      // Window is sized to fullscreen by Rust on hotkey trigger; keep it shown for the overlay
      // (the existing App.tsx already does this dance — keep it).
    }
  }, [mode]);

  if (mode === "selecting") return <SelectionOverlay onCapture={onCapture} onCancel={onCancelCapture} />;
  if (mode === "session" || state.session) return <SessionWindow />;
  return <IdleScreen />;
}

export default function App() {
  return (
    <SessionProvider>
      <AppInner />
    </SessionProvider>
  );
}
```

- [ ] **Step 5: Verify dev build works end-to-end**

Run: `pnpm tauri dev`

Manual smoke test:
- App launches, tray icon visible
- Press `Cmd+Shift+C` → selection overlay appears
- Drag a region → window now shows the placeholder `SessionWindow` with the captured screenshot's canonical name in the JSON dump
- Press hotkey again → another capture appended → screenshot count goes to 2
- Quit and re-launch → no auto-resume; pressing hotkey starts fresh session

If any step fails, do NOT proceed. Debug and fix before commit.

- [ ] **Step 6: Verify session folder is on disk**

Run: `ls ~/Pictures/VisionPipe/`

Expected: at least one `session-<timestamp>/` folder containing `.deleted/` and one or more `VisionPipe-*.png` files.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/IdleScreen.tsx src/components/SelectionOverlay.tsx src/components/SessionWindow.tsx
git commit -m "Wire multi-screenshot session: hotkey, capture, append to session folder"
```

---

### Task 8: Persist transcript.json on every change

**Files:**
- Create: `src/state/persistence.ts`
- Modify: `src/state/session-context.tsx` (wire persistence)

- [ ] **Step 1: Write the persistence helper**

Create `src/state/persistence.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../types/session";

let pending: Session | null = null;
let timer: number | null = null;

const DEBOUNCE_MS = 500;

async function flush() {
  if (!pending) return;
  const s = pending;
  pending = null;
  timer = null;
  try {
    const json = JSON.stringify(s, null, 2);
    const bytes = new TextEncoder().encode(json);
    await invoke("write_session_file", {
      folder: s.folder, filename: "transcript.json", bytes: Array.from(bytes),
    });
  } catch (err) {
    console.error("[VisionPipe] Persistence write failed:", err);
  }
}

/** Schedule a debounced write of the session to transcript.json. */
export function scheduleSessionWrite(session: Session, immediate = false) {
  pending = session;
  if (immediate) {
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS) as unknown as number;
}
```

- [ ] **Step 2: Hook persistence into the Context**

Modify `src/state/session-context.tsx`:

```tsx
import { createContext, useContext, useReducer, useEffect, useRef, type Dispatch, type ReactNode } from "react";
import { sessionReducer, initialState, type SessionState, type SessionAction } from "./session-reducer";
import { scheduleSessionWrite } from "./persistence";

interface ContextValue {
  state: SessionState;
  dispatch: Dispatch<SessionAction>;
}

const SessionContext = createContext<ContextValue | null>(null);

const IMMEDIATE_ACTIONS = new Set<SessionAction["type"]>([
  "APPEND_SCREENSHOT",
  "DELETE_SCREENSHOT",
  "SET_RE_RECORDED_AUDIO",
]);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(sessionReducer, initialState);
  const lastActionType = useRef<SessionAction["type"] | null>(null);

  const dispatch: Dispatch<SessionAction> = (action) => {
    lastActionType.current = action.type;
    baseDispatch(action);
  };

  useEffect(() => {
    if (!state.session) return;
    const immediate = lastActionType.current ? IMMEDIATE_ACTIONS.has(lastActionType.current) : false;
    scheduleSessionWrite(state.session, immediate);
  }, [state.session]);

  return (
    <SessionContext.Provider value={{ state, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): ContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
```

- [ ] **Step 3: Verify dev build + manual test**

Run: `pnpm tauri dev`

Manual smoke test:
- Trigger hotkey, capture a region
- After 500 ms, check `~/Pictures/VisionPipe/session-<id>/transcript.json` exists
- Capture another region → file updates
- `cat` the file → it should be valid JSON matching the session shape

- [ ] **Step 4: Commit**

```bash
git add src/state/persistence.ts src/state/session-context.tsx
git commit -m "Auto-persist transcript.json with debounced writes and immediate flush on capture"
```

---

## Phase D — Card UI

### Task 9: Header bar component

**Files:**
- Create: `src/components/Header.tsx`
- Create: `src/lib/ui-tokens.ts` (palette + fonts)

- [ ] **Step 1: Extract the existing palette into a shared module**

Create `src/lib/ui-tokens.ts`:

```ts
// Earthy palette — copied from prior App.tsx to keep visual consistency.
export const C = {
  teal: "#2e8b7a",
  amber: "#d4882a",
  cream: "#f5f0e8",
  forest: "#1a2a20",
  deepForest: "#141e18",
  sienna: "#c0462a",
  textBright: "#e8efe9",
  textMuted: "#8a9a8a",
  textDim: "#5a6a5a",
  border: "#2a3a2a",
  borderLight: "#3a4a3a",
};

export const FONT_BODY = "Verdana, sans-serif";
export const FONT_MONO = "'Source Code Pro', Menlo, monospace";
```

- [ ] **Step 2: Write the Header component**

Create `src/components/Header.tsx`:

```tsx
import { useSession } from "../state/session-context";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";

export type NetworkState = "live" | "local-only" | "reconnecting";

interface Props {
  micRecording: boolean;
  micPermissionDenied: boolean;
  networkState: NetworkState;
  onToggleMic: () => void;
  onToggleViewMode: () => void;
  onOpenSettings: () => void;
  onNewSession: () => void;
  onOpenSessionFolder: () => void;
}

const dotColor = (s: NetworkState, recording: boolean): string => {
  if (!recording) return C.textDim;
  if (s === "live") return C.sienna;
  if (s === "reconnecting") return C.amber;
  return C.textMuted;
};

const networkLabel = (s: NetworkState): string =>
  s === "live" ? "Live" : s === "reconnecting" ? "Reconnecting…" : "Local-only";

export function Header(props: Props) {
  const { state } = useSession();
  const session = state.session;
  if (!session) return null;

  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 16px", background: C.deepForest,
      borderBottom: `1px solid ${C.border}`, color: C.textBright, fontFamily: FONT_BODY,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontWeight: 700, color: C.teal }}>Vision|Pipe</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textMuted, cursor: "pointer" }}
              title="Click to copy folder path"
              onClick={() => navigator.clipboard.writeText(session.folder)}>
          session-{session.id}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={props.onToggleMic}
          disabled={props.micPermissionDenied}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "transparent", border: `1px solid ${C.borderLight}`,
            color: C.textBright, padding: "4px 10px", borderRadius: 4,
            cursor: props.micPermissionDenied ? "not-allowed" : "pointer", fontFamily: FONT_BODY, fontSize: 12,
          }}
          title={props.micPermissionDenied ? "Microphone permission required" : "Toggle recording"}
        >
          <span style={{
            width: 8, height: 8, borderRadius: 999,
            background: dotColor(props.networkState, props.micRecording),
          }} />
          {props.micRecording ? `Recording · ${networkLabel(props.networkState)}` : "Paused"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={props.onToggleViewMode}
          style={btnStyle()}
          title={session.viewMode === "interleaved" ? "Detach transcript (split view)" : "Attach transcript (interleaved)"}
        >
          ◫ {session.viewMode === "interleaved" ? "Detach transcript" : "Attach transcript"}
        </button>
        <OverflowMenu
          onNewSession={props.onNewSession}
          onOpenFolder={props.onOpenSessionFolder}
          onOpenSettings={props.onOpenSettings}
        />
      </div>
    </header>
  );
}

const btnStyle = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, padding: "4px 10px", borderRadius: 4,
  cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12,
});

function OverflowMenu({ onNewSession, onOpenFolder, onOpenSettings }: {
  onNewSession: () => void; onOpenFolder: () => void; onOpenSettings: () => void;
}) {
  const handle = () => {
    const choice = window.prompt(
      "Choose: 1) New session  2) Open session folder  3) Settings  (1/2/3)",
      ""
    );
    if (choice === "1") onNewSession();
    else if (choice === "2") onOpenFolder();
    else if (choice === "3") onOpenSettings();
  };
  // Replace with a real popover menu in a follow-on polish pass; v0.2 ships with this minimal prompt-based menu.
  return <button onClick={handle} style={btnStyle()}>⋮</button>;
}
```

- [ ] **Step 3: No tests yet (component test landed in Task 14); verify it renders**

Wire the Header into `SessionWindow.tsx` as a placeholder for visual smoke:

```tsx
import { Header } from "./Header";
import { useSession } from "../state/session-context";

export function SessionWindow() {
  const { state, dispatch } = useSession();
  if (!state.session) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0e1410" }}>
      <Header
        micRecording={false}
        micPermissionDenied={false}
        networkState="local-only"
        onToggleMic={() => {}}
        onToggleViewMode={() => dispatch({ type: "TOGGLE_VIEW_MODE" })}
        onOpenSettings={() => alert("Settings will land in Phase H")}
        onNewSession={() => dispatch({ type: "END_SESSION" })}
        onOpenSessionFolder={() => alert(state.session?.folder)}
      />
      <pre style={{ padding: 16, color: "#cfd8d2", overflow: "auto", fontSize: 11 }}>
        {JSON.stringify(state.session, null, 2)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Smoke test in dev**

Run: `pnpm tauri dev`. Trigger a capture; verify the header renders with logo, session id, mic indicator (paused), view-toggle, and overflow menu.

- [ ] **Step 5: Commit**

```bash
git add src/components/Header.tsx src/components/SessionWindow.tsx src/lib/ui-tokens.ts
git commit -m "Add Header component with mic indicator, view toggle, overflow menu"
```

---

### Task 10: Footer bar component

**Files:**
- Create: `src/components/Footer.tsx`

- [ ] **Step 1: Write the Footer**

Create `src/components/Footer.tsx`:

```tsx
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  onTakeNextScreenshot: () => void;
  onCopyAndSend: () => Promise<void> | void;
  copyTooltip: string;
  busy: boolean;
}

export function Footer({ onTakeNextScreenshot, onCopyAndSend, copyTooltip, busy }: Props) {
  return (
    <footer style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 16px", background: C.deepForest,
      borderTop: `1px solid ${C.border}`, fontFamily: FONT_BODY,
    }}>
      <button
        onClick={onTakeNextScreenshot}
        disabled={busy}
        style={{
          background: "transparent", border: `1px solid ${C.borderLight}`,
          color: C.textBright, padding: "8px 16px", borderRadius: 6,
          cursor: busy ? "wait" : "pointer", fontSize: 13,
        }}
      >
        ＋ Take next screenshot
      </button>
      <button
        onClick={() => void onCopyAndSend()}
        disabled={busy}
        title={copyTooltip}
        style={{
          background: C.teal, border: "none",
          color: C.deepForest, padding: "8px 18px", borderRadius: 6,
          cursor: busy ? "wait" : "pointer", fontSize: 13, fontWeight: 700,
        }}
      >
        📋 Copy &amp; Send
      </button>
    </footer>
  );
}
```

- [ ] **Step 2: Wire Footer into SessionWindow**

Modify `src/components/SessionWindow.tsx` — add the Footer element and pass placeholder handlers:

```tsx
import { Header } from "./Header";
import { Footer } from "./Footer";
import { useSession } from "../state/session-context";
import { renderMarkdown } from "../lib/markdown-renderer";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export function SessionWindow() {
  const { state, dispatch } = useSession();
  if (!state.session) return null;
  const session = state.session;

  const onCopyAndSend = async () => {
    const md = renderMarkdown(session);
    await writeText(md);
    // Also persist transcript.md alongside transcript.json:
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = new TextEncoder().encode(md);
    await invoke("write_session_file", {
      folder: session.folder, filename: "transcript.md", bytes: Array.from(bytes),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0e1410" }}>
      <Header
        micRecording={false}
        micPermissionDenied={false}
        networkState="local-only"
        onToggleMic={() => {}}
        onToggleViewMode={() => dispatch({ type: "TOGGLE_VIEW_MODE" })}
        onOpenSettings={() => alert("Settings will land in Phase H")}
        onNewSession={() => dispatch({ type: "END_SESSION" })}
        onOpenSessionFolder={() => alert(session.folder)}
      />
      <main style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <pre style={{ color: "#cfd8d2", fontSize: 11 }}>
          {JSON.stringify(session, null, 2)}
        </pre>
      </main>
      <Footer
        onTakeNextScreenshot={() => {
          // Re-fire the start-capture event by calling the existing flow
          window.dispatchEvent(new CustomEvent("vp-take-next-screenshot"));
        }}
        onCopyAndSend={onCopyAndSend}
        copyTooltip={`Copies markdown for ${session.screenshots.length} screenshots + transcript`}
        busy={false}
      />
    </div>
  );
}
```

- [ ] **Step 3: Wire the "Take next screenshot" event in App.tsx**

In `src/App.tsx` `AppInner()`, add this effect alongside the existing `start-capture` listener:

```tsx
useEffect(() => {
  const handler = () => setMode("selecting");
  window.addEventListener("vp-take-next-screenshot", handler);
  return () => window.removeEventListener("vp-take-next-screenshot", handler);
}, []);
```

- [ ] **Step 4: Smoke test**

Run: `pnpm tauri dev`. Trigger first capture, then click "+ Take next screenshot" → second capture; click "Copy & Send" → paste into a text editor → verify markdown content appears.

- [ ] **Step 5: Commit**

```bash
git add src/components/Footer.tsx src/components/SessionWindow.tsx src/App.tsx
git commit -m "Add Footer with Take-next-screenshot and Copy & Send actions"
```

---

### Task 11: ScreenshotCard component (interleaved view)

**Files:**
- Create: `src/components/ScreenshotCard.tsx`
- Create: `src/components/InterleavedView.tsx`

- [ ] **Step 1: Write `ScreenshotCard.tsx`**

```tsx
import { useState } from "react";
import { useSession } from "../state/session-context";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";
import type { Screenshot } from "../types/session";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  screenshot: Screenshot;
  isActive: boolean;
  onOpenLightbox: (seq: number) => void;
  onRequestRerecord: (seq: number) => void;
  onRequestDelete: (seq: number) => void;
}

export function ScreenshotCard({ screenshot, isActive, onOpenLightbox, onRequestRerecord, onRequestDelete }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(screenshot.caption);

  const imgSrc = convertFileSrc(`${session.folder}/${screenshot.canonicalName}.png`);

  const saveCaption = () => {
    dispatch({ type: "UPDATE_CAPTION", seq: screenshot.seq, caption: captionDraft.trim() });
    setEditingCaption(false);
  };

  return (
    <article style={{
      display: "flex", gap: 12, padding: 12,
      background: C.deepForest, border: `1px solid ${isActive ? C.teal : C.border}`,
      borderRadius: 8, marginBottom: 12,
    }}>
      <img
        src={imgSrc}
        alt={screenshot.canonicalName}
        onClick={() => onOpenLightbox(screenshot.seq)}
        style={{
          width: 160, height: "auto", maxHeight: 120, objectFit: "cover",
          cursor: "zoom-in", borderRadius: 4, border: `1px solid ${C.borderLight}`,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, color: C.textBright, fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <code style={{
            fontFamily: FONT_MONO, fontSize: 10, color: C.textMuted,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={screenshot.canonicalName}>
            {screenshot.canonicalName}
          </code>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onRequestRerecord(screenshot.seq)} style={iconBtn()}>🎙</button>
            <button onClick={() => onRequestDelete(screenshot.seq)} style={iconBtn()}>🗑</button>
          </div>
        </div>
        {editingCaption ? (
          <input
            autoFocus
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onBlur={saveCaption}
            onKeyDown={(e) => e.key === "Enter" && saveCaption()}
            style={{
              width: "100%", padding: "4px 8px", marginBottom: 6,
              background: C.forest, border: `1px solid ${C.borderLight}`,
              color: C.textBright, borderRadius: 4, fontSize: 12,
            }}
          />
        ) : (
          <div
            onClick={() => setEditingCaption(true)}
            style={{
              padding: "4px 8px", marginBottom: 6,
              color: screenshot.caption ? C.amber : C.textDim,
              fontStyle: "italic", fontSize: 12, cursor: "text",
              background: C.forest, borderRadius: 4,
            }}
          >
            {screenshot.caption || "Add a caption…"}
          </div>
        )}
        <textarea
          value={screenshot.transcriptSegment}
          onChange={(e) => dispatch({
            type: "UPDATE_TRANSCRIPT_SEGMENT", seq: screenshot.seq, text: e.target.value,
          })}
          placeholder={screenshot.offline ? "(offline — audio recorded locally; no transcript)" : "Speak or type narration here…"}
          style={{
            width: "100%", minHeight: 60, padding: 8,
            background: C.forest, border: `1px solid ${C.borderLight}`,
            color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
          }}
        />
      </div>
    </article>
  );
}

const iconBtn = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, width: 28, height: 28, borderRadius: 4,
  cursor: "pointer", fontSize: 14,
});
```

- [ ] **Step 2: Write `InterleavedView.tsx`**

```tsx
import { useState } from "react";
import { useSession } from "../state/session-context";
import { ScreenshotCard } from "./ScreenshotCard";
import { Lightbox } from "./Lightbox";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  onTakeNextScreenshot: () => void;
  onRequestRerecord: (seq: number) => void;
  onRequestDelete: (seq: number) => void;
}

export function InterleavedView({ onTakeNextScreenshot, onRequestRerecord, onRequestDelete }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const [lightboxSeq, setLightboxSeq] = useState<number | null>(null);

  return (
    <div style={{ padding: 16 }}>
      {session.screenshots.map((s, i) => (
        <ScreenshotCard
          key={s.seq}
          screenshot={s}
          isActive={i === session.screenshots.length - 1}
          onOpenLightbox={setLightboxSeq}
          onRequestRerecord={onRequestRerecord}
          onRequestDelete={onRequestDelete}
        />
      ))}
      <button
        onClick={onTakeNextScreenshot}
        style={{
          width: "100%", padding: 16, background: "transparent",
          border: `1px dashed ${C.borderLight}`, color: C.textMuted,
          borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 14,
        }}
      >
        ＋ Take next screenshot
      </button>
      <div style={{ marginTop: 24 }}>
        <label style={{ display: "block", color: C.textMuted, fontFamily: FONT_BODY, fontSize: 11, marginBottom: 4 }}>
          CLOSING NARRATION
        </label>
        <textarea
          value={session.closingNarration}
          onChange={(e) => dispatch({ type: "UPDATE_CLOSING_NARRATION", text: e.target.value })}
          placeholder="Anything to say after the last screenshot? (e.g., 'fix this for me')"
          style={{
            width: "100%", minHeight: 60, padding: 8,
            background: C.forest, border: `1px solid ${C.borderLight}`,
            color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
          }}
        />
      </div>
      {lightboxSeq !== null && (
        <Lightbox seq={lightboxSeq} onClose={() => setLightboxSeq(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `src-tauri/capabilities/default.json` to allow file:// scheme for asset loading**

Open `src-tauri/capabilities/default.json` and add to the `permissions` array:

```json
"core:webview:default",
"core:webview:allow-internal-toggle-devtools"
```

If asset protocol needs explicit allow (depends on Tauri version), also add to `tauri.conf.json` under the `app.security` block:

```json
"assetProtocol": {
  "enable": true,
  "scope": ["$PICTURE/VisionPipe/**"]
}
```

- [ ] **Step 4: Update `SessionWindow` to render the InterleavedView (since it's the default)**

Replace the placeholder body in `src/components/SessionWindow.tsx`:

```tsx
import { Header } from "./Header";
import { Footer } from "./Footer";
import { InterleavedView } from "./InterleavedView";
import { useSession } from "../state/session-context";
import { renderMarkdown } from "../lib/markdown-renderer";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";

export function SessionWindow() {
  const { state, dispatch } = useSession();
  if (!state.session) return null;
  const session = state.session;

  const onCopyAndSend = async () => {
    const md = renderMarkdown(session);
    await writeText(md);
    const bytes = new TextEncoder().encode(md);
    await invoke("write_session_file", {
      folder: session.folder, filename: "transcript.md", bytes: Array.from(bytes),
    });
  };

  const takeNext = () => window.dispatchEvent(new CustomEvent("vp-take-next-screenshot"));

  const requestDelete = async (seq: number) => {
    const target = session.screenshots.find(s => s.seq === seq);
    if (!target) return;
    if (!confirm(`Delete Screenshot ${seq}? This will remove the image and its narration. Sequence numbers will not be reused.`)) return;
    await invoke("move_to_deleted", { folder: session.folder, filename: `${target.canonicalName}.png` });
    dispatch({ type: "DELETE_SCREENSHOT", seq });
  };

  const requestRerecord = (seq: number) => {
    window.dispatchEvent(new CustomEvent("vp-rerecord-segment", { detail: { seq } }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0e1410" }}>
      <Header
        micRecording={false}
        micPermissionDenied={false}
        networkState="local-only"
        onToggleMic={() => {}}
        onToggleViewMode={() => dispatch({ type: "TOGGLE_VIEW_MODE" })}
        onOpenSettings={() => alert("Settings will land in Phase H")}
        onNewSession={() => dispatch({ type: "END_SESSION" })}
        onOpenSessionFolder={() => invoke("plugin:shell|open", { path: session.folder })}
      />
      <main style={{ flex: 1, overflow: "auto" }}>
        {/* Phase G adds SplitView toggle; for now interleaved only */}
        <InterleavedView
          onTakeNextScreenshot={takeNext}
          onRequestRerecord={requestRerecord}
          onRequestDelete={requestDelete}
        />
      </main>
      <Footer
        onTakeNextScreenshot={takeNext}
        onCopyAndSend={onCopyAndSend}
        copyTooltip={`Copies markdown for ${session.screenshots.length} screenshots + transcript`}
        busy={false}
      />
    </div>
  );
}
```

- [ ] **Step 5: Smoke test**

Run: `pnpm tauri dev`. Take 3 screenshots, edit captions, verify cards render thumbnails, verify Copy & Send produces correct markdown.

- [ ] **Step 6: Commit**

```bash
git add src/components/ScreenshotCard.tsx src/components/InterleavedView.tsx src/components/SessionWindow.tsx src-tauri/capabilities/default.json src-tauri/tauri.conf.json
git commit -m "Add ScreenshotCard + InterleavedView for default View B"
```

---

### Task 12: Lightbox component

**Files:**
- Create: `src/components/Lightbox.tsx`

- [ ] **Step 1: Write the Lightbox**

```tsx
import { useEffect } from "react";
import { useSession } from "../state/session-context";
import { convertFileSrc } from "@tauri-apps/api/core";
import { C } from "../lib/ui-tokens";

interface Props {
  seq: number;
  onClose: () => void;
}

export function Lightbox({ seq, onClose }: Props) {
  const { state } = useSession();
  const session = state.session!;
  const idx = session.screenshots.findIndex(s => s.seq === seq);
  const screenshot = session.screenshots[idx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!screenshot) return null;
  const src = convertFileSrc(`${session.folder}/${screenshot.canonicalName}.png`);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <img src={src} alt={screenshot.canonicalName}
           style={{ maxWidth: "95vw", maxHeight: "95vh", boxShadow: `0 0 24px ${C.teal}` }} />
    </div>
  );
}
```

- [ ] **Step 2: Smoke test — click a card thumbnail and confirm full-resolution open + Esc closes.**

- [ ] **Step 3: Commit**

```bash
git add src/components/Lightbox.tsx
git commit -m "Add Lightbox for full-resolution screenshot view"
```

---

## Phase E — Audio recording

### Task 13: Audio recorder wrapper

**Files:**
- Create: `src/lib/audio-recorder.ts`

- [ ] **Step 1: Write the recorder**

Create `src/lib/audio-recorder.ts`:

```ts
/**
 * Wraps the browser MediaRecorder API for VisionPipe's needs:
 *  - Continuous recording to an in-memory blob, flushed to disk on stop / pause / chunk-tick.
 *  - Track elapsed time so the reducer can stamp audioOffset.start/end on captures.
 *  - Re-record mode: same API, separate output, original master untouched.
 *  - Emits chunks for downstream WebSocket forwarding (Deepgram client).
 */

export type AudioChunkListener = (chunk: Blob) => void;

export interface RecorderHandle {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<Blob>;
  elapsedSec(): number;
  isRecording(): boolean;
  onChunk(listener: AudioChunkListener): void;
}

const CHUNK_INTERVAL_MS = 1000;

export async function createRecorder(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });

  let chunks: Blob[] = [];
  let listeners: AudioChunkListener[] = [];
  let startTime = 0;
  let pausedAccumulated = 0;
  let pauseStarted = 0;
  let recording = false;

  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
      for (const l of listeners) l(e.data);
    }
  });

  return {
    start: async () => {
      recorder.start(CHUNK_INTERVAL_MS);
      startTime = performance.now();
      pausedAccumulated = 0;
      recording = true;
    },
    pause: () => {
      if (recorder.state === "recording") {
        recorder.pause();
        pauseStarted = performance.now();
        recording = false;
      }
    },
    resume: () => {
      if (recorder.state === "paused") {
        recorder.resume();
        pausedAccumulated += performance.now() - pauseStarted;
        recording = true;
      }
    },
    stop: () => new Promise<Blob>((resolve) => {
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
        chunks = [];
        recording = false;
        stream.getTracks().forEach(t => t.stop());
        resolve(blob);
      }, { once: true });
      recorder.stop();
    }),
    elapsedSec: () => {
      if (startTime === 0) return 0;
      const now = recorder.state === "paused" ? pauseStarted : performance.now();
      return (now - startTime - pausedAccumulated) / 1000;
    },
    isRecording: () => recording,
    onChunk: (l) => { listeners.push(l); },
  };
}
```

- [ ] **Step 2: No automated tests for this module** — MediaRecorder is a browser API not easily testable in jsdom. Manual smoke test in next task confirms behavior.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio-recorder.ts
git commit -m "Add MediaRecorder wrapper with chunk emission and elapsed-time tracking"
```

---

### Task 14: Wire audio recording into session lifecycle

**Files:**
- Modify: `src/App.tsx` (add recorder lifecycle)
- Modify: `src/components/SessionWindow.tsx` (mic toggle wiring)
- Modify: `src/state/session-context.tsx` (expose recorder via Context — or use a separate ref)

To keep concerns separate, use a separate React ref pattern instead of widening Context. Edit `App.tsx`:

- [ ] **Step 1: Add recorder lifecycle to `AppInner`**

In `src/App.tsx`, add at the top of `AppInner()`:

```tsx
import { createRecorder, type RecorderHandle } from "./lib/audio-recorder";
// ...

const recorderRef = useRef<RecorderHandle | null>(null);
const [micRecording, setMicRecording] = useState(false);
const [micPermissionDenied, setMicPermissionDenied] = useState(false);
```

In the `onCapture` callback, after `dispatch({ type: "START_SESSION", ... })`, add:

```tsx
if (!recorderRef.current) {
  try {
    recorderRef.current = await createRecorder();
    await recorderRef.current.start();
    setMicRecording(true);
  } catch (err) {
    console.warn("[VisionPipe] Mic permission denied:", err);
    setMicPermissionDenied(true);
  }
}
```

For subsequent captures (the `else` branch when session already exists), use `recorderRef.current?.elapsedSec()` to compute `audioElapsedSec`:

```tsx
const audioElapsedSec = recorderRef.current?.elapsedSec() ?? 0;
dispatch({ type: "APPEND_SCREENSHOT", screenshot, audioElapsedSec });
```

- [ ] **Step 2: Pass mic state down to `SessionWindow` and the Header**

Modify the App to pass the recorder controls + state:

```tsx
const onToggleMic = () => {
  if (!recorderRef.current) return;
  if (recorderRef.current.isRecording()) {
    recorderRef.current.pause();
    setMicRecording(false);
  } else {
    recorderRef.current.resume();
    setMicRecording(true);
  }
};
```

Then expose these through props or via React Context — for v0.2, just add a `<MicContext>` mini-context in `App.tsx`:

```tsx
import { createContext, useContext } from "react";

interface MicCtx {
  recording: boolean;
  permissionDenied: boolean;
  onToggle: () => void;
  recorder: RecorderHandle | null;
}
const MicContext = createContext<MicCtx | null>(null);
export const useMic = () => {
  const ctx = useContext(MicContext);
  if (!ctx) throw new Error("useMic outside provider");
  return ctx;
};

// In AppInner's render:
<MicContext.Provider value={{
  recording: micRecording,
  permissionDenied: micPermissionDenied,
  onToggle: onToggleMic,
  recorder: recorderRef.current,
}}>
  {mode === "selecting" ? <SelectionOverlay onCapture={onCapture} onCancel={onCancelCapture} /> : null}
  {mode === "session" || state.session ? <SessionWindow /> : null}
  {mode === "idle" && !state.session ? <IdleScreen /> : null}
</MicContext.Provider>
```

- [ ] **Step 3: Update `SessionWindow.tsx` to read `useMic()`**

```tsx
import { useMic } from "../App";  // export the hook from App.tsx

const mic = useMic();
// In the Header:
<Header
  micRecording={mic.recording}
  micPermissionDenied={mic.permissionDenied}
  networkState="local-only"  // Phase F sets this
  onToggleMic={mic.onToggle}
  // ...rest unchanged
/>
```

(Move `MicContext` and `useMic` exports out of `App.tsx` to a new file `src/state/mic-context.tsx` if circular imports become a problem.)

- [ ] **Step 4: Persist `audio-master.webm` on session end / app quit**

Add to `App.tsx` `AppInner`:

```tsx
useEffect(() => {
  const onBeforeUnload = async () => {
    if (recorderRef.current && state.session) {
      const blob = await recorderRef.current.stop();
      const buf = new Uint8Array(await blob.arrayBuffer());
      await invoke("write_session_file", {
        folder: state.session.folder, filename: state.session.audioFile, bytes: Array.from(buf),
      });
    }
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}, [state.session]);
```

Also call this on the `END_SESSION` action — wrap the new-session button to flush audio first.

- [ ] **Step 5: Smoke test**

Run: `pnpm tauri dev`. Capture, talk for 10s, capture again, talk, click "New session" via overflow menu → verify `audio-master.webm` file exists in the session folder and is playable in QuickTime.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/SessionWindow.tsx
git commit -m "Wire MediaRecorder into session lifecycle with mic toggle and audio persistence"
```

---

### Task 15: Re-record modal

**Files:**
- Create: `src/components/ReRecordModal.tsx`
- Modify: `src/App.tsx` (handle `vp-rerecord-segment` event)

- [ ] **Step 1: Write the modal**

Create `src/components/ReRecordModal.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useSession } from "../state/session-context";
import { createRecorder, type RecorderHandle } from "../lib/audio-recorder";
import { invoke } from "@tauri-apps/api/core";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface Props {
  seq: number;
  onClose: () => void;
}

export function ReRecordModal({ seq, onClose }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const screenshot = session.screenshots.find(s => s.seq === seq)!;
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let id: number | null = null;
    (async () => {
      recorderRef.current = await createRecorder();
      await recorderRef.current.start();
      setRecording(true);
      id = window.setInterval(() => {
        setElapsed(recorderRef.current?.elapsedSec() ?? 0);
      }, 250);
    })();
    return () => { if (id) clearInterval(id); };
  }, []);

  const stop = async () => {
    if (!recorderRef.current) return;
    const blob = await recorderRef.current.stop();
    const buf = new Uint8Array(await blob.arrayBuffer());
    const filename = `${screenshot.canonicalName}-rerecord.webm`;
    await invoke("write_session_file", {
      folder: session.folder, filename, bytes: Array.from(buf),
    });
    dispatch({ type: "SET_RE_RECORDED_AUDIO", seq, filename });
    setRecording(false);
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: C.deepForest, border: `1px solid ${C.borderLight}`,
        padding: 32, borderRadius: 8, color: C.textBright, fontFamily: FONT_BODY,
        textAlign: "center", minWidth: 360,
      }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          Re-recording for Screenshot {seq}
        </div>
        <div style={{ fontSize: 28, color: recording ? C.sienna : C.textMuted, margin: "12px 0" }}>
          ● {elapsed.toFixed(1)}s
        </div>
        <button onClick={stop} style={{
          background: C.teal, border: "none", color: C.deepForest,
          padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: "pointer",
        }}>
          Stop
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the event listener in `SessionWindow.tsx`**

```tsx
import { ReRecordModal } from "./ReRecordModal";
import { useState, useEffect } from "react";
// ...

const [rerecordSeq, setRerecordSeq] = useState<number | null>(null);
useEffect(() => {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<{ seq: number }>;
    setRerecordSeq(ce.detail.seq);
  };
  window.addEventListener("vp-rerecord-segment", handler);
  return () => window.removeEventListener("vp-rerecord-segment", handler);
}, []);

// In the JSX:
{rerecordSeq !== null && <ReRecordModal seq={rerecordSeq} onClose={() => setRerecordSeq(null)} />}
```

- [ ] **Step 3: Smoke test**

Run: `pnpm tauri dev`. Take a screenshot, click 🎙 on the card, talk for 5 seconds, click Stop. Verify `<canonicalName>-rerecord.webm` lands in the session folder and `transcript.json` has `reRecordedAudio` set on that screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReRecordModal.tsx src/components/SessionWindow.tsx
git commit -m "Add per-segment re-record modal preserving original master audio"
```

---

## Phase F — Deepgram streaming with mock vp-edge

### Task 16: Mock vp-edge proxy server

**Files:**
- Create: `vp-edge-mock/server.mjs`
- Create: `vp-edge-mock/README.md`
- Create: `vp-edge-mock/package.json`

- [ ] **Step 1: Initialize the mock package**

```bash
mkdir -p vp-edge-mock
cd vp-edge-mock
npm init -y
npm install ws@^8
cd ..
```

- [ ] **Step 2: Write the mock server**

Create `vp-edge-mock/server.mjs`:

```js
#!/usr/bin/env node
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.PORT ?? "8787", 10);
const REAL_DG_KEY = process.env.DEEPGRAM_API_KEY;

const tokens = new Map(); // token -> { issuedAt, minutesUsed }

function nowMin() { return Math.floor(Date.now() / 60000); }

const httpServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/install") {
    const token = randomUUID();
    tokens.set(token, { issuedAt: Date.now(), minutesUsed: 0 });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ token }));
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200); res.end("ok"); return;
  }
  res.writeHead(404); res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/transcribe" });

wss.on("connection", (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  if (!token || !tokens.has(token)) {
    clientWs.close(1008, "Unauthorized");
    return;
  }

  console.log(`[vp-edge-mock] Client connected with token ${token.slice(0, 8)}…`);

  if (REAL_DG_KEY) {
    // Forward to real Deepgram
    const dgWs = new WebSocket(
      "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&interim_results=true&smart_format=true&encoding=opus",
      { headers: { Authorization: `Token ${REAL_DG_KEY}` } }
    );
    dgWs.on("message", (msg) => clientWs.send(msg));
    dgWs.on("close", () => clientWs.close());
    clientWs.on("message", (audio) => dgWs.readyState === WebSocket.OPEN && dgWs.send(audio));
    clientWs.on("close", () => dgWs.close());
  } else {
    // Echo mode: send canned transcripts every 1.5s
    let chunkCount = 0;
    const interval = setInterval(() => {
      chunkCount += 1;
      const isFinal = chunkCount % 3 === 0;
      clientWs.send(JSON.stringify({
        type: "Results",
        is_final: isFinal,
        speech_final: isFinal,
        channel: {
          alternatives: [{
            transcript: `mock transcript chunk ${chunkCount}${isFinal ? "." : "..."}`,
            confidence: 0.95,
          }],
        },
        start: chunkCount * 1.5,
        duration: 1.5,
      }));
    }, 1500);
    clientWs.on("close", () => clearInterval(interval));
  }
});

httpServer.listen(PORT, () => {
  console.log(`[vp-edge-mock] Listening on http://localhost:${PORT}`);
  console.log(`[vp-edge-mock] WebSocket: ws://localhost:${PORT}/transcribe?token=…`);
  console.log(`[vp-edge-mock] Real Deepgram: ${REAL_DG_KEY ? "ENABLED (forwarding)" : "DISABLED (echo mode)"}`);
});
```

- [ ] **Step 3: Document the mock**

Create `vp-edge-mock/README.md`:

```markdown
# vp-edge-mock

Local development mock for the `vp-edge` transcription proxy that production VisionPipe will eventually use.

## Run

```bash
pnpm dev:proxy
# or:
node vp-edge-mock/server.mjs
```

## Endpoints

- `POST /install` — issues an opaque `token` (no auth required for local dev)
- `GET /health` — returns `ok`
- `WSS /transcribe?token=<token>` — streams audio in, transcripts out

## Modes

- **Echo mode** (default): returns canned transcript chunks every 1.5s. No real ASR. Use for UI smoke tests.
- **Forwarding mode**: set `DEEPGRAM_API_KEY=...` in env. Audio is proxied to Deepgram Nova-3 and real transcripts come back. Use for end-to-end testing.

## Spec 1 vs production `vp-edge`

This mock is NOT the production proxy. The real `vp-edge` adds: per-token rate limiting (60 min/day), per-IP throttle on `/install`, monthly spend cap, observability/alerting, deployment to Cloudflare Workers (or similar). Production proxy is a separate plan.
```

- [ ] **Step 4: Verify mock starts**

Run: `pnpm dev:proxy`
Expected: console prints "Listening on http://localhost:8787"

In another terminal:

```bash
curl -X POST http://localhost:8787/install
# Expected: {"token":"<uuid>"}
```

- [ ] **Step 5: Commit**

```bash
git add vp-edge-mock/
git commit -m "Add vp-edge mock server for local Deepgram development"
```

---

### Task 17: Install token management

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `keyring`)
- Create: `src-tauri/src/install_token.rs`
- Modify: `src-tauri/src/lib.rs` (wire commands)
- Create: `src/lib/install-token.ts`

- [ ] **Step 1: Add keyring dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`:

```toml
keyring = "3"
```

- [ ] **Step 2: Write the Rust module**

Create `src-tauri/src/install_token.rs`:

```rust
use keyring::Entry;

const SERVICE: &str = "com.visionpipe.desktop.vp-edge-token";
const ACCOUNT: &str = "default";

pub fn save_token(token: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(token).map_err(|e| e.to_string())
}

pub fn load_token() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 3: Wire commands in `src-tauri/src/lib.rs`**

After the existing `mod` declarations:

```rust
mod install_token;
```

Add commands:

```rust
#[tauri::command]
async fn save_install_token(token: String) -> Result<(), String> {
    install_token::save_token(&token)
}

#[tauri::command]
async fn load_install_token() -> Result<Option<String>, String> {
    install_token::load_token()
}
```

Add to the `invoke_handler` list: `save_install_token, load_install_token`.

- [ ] **Step 4: Write the TypeScript wrapper**

Create `src/lib/install-token.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

const VP_EDGE_HTTP = (import.meta.env.VITE_VP_EDGE_HTTP as string | undefined) ?? "http://localhost:8787";

export async function getOrIssueToken(): Promise<string> {
  let token = await invoke<string | null>("load_install_token");
  if (token) return token;

  const resp = await fetch(`${VP_EDGE_HTTP}/install`, { method: "POST" });
  if (!resp.ok) throw new Error(`Token issuance failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as { token: string };
  await invoke("save_install_token", { token: data.token });
  return data.token;
}
```

- [ ] **Step 5: Build + test**

Run: `pnpm tauri build --debug` to verify Rust compiles.
Run: `pnpm dev:proxy` (in another shell), then `pnpm tauri dev`. On first launch the app's first capture should trigger token issuance under the hood. Verify by inspecting macOS Keychain Access for an entry named `com.visionpipe.desktop.vp-edge-token`.

> Note: token issuance won't happen yet because nothing calls `getOrIssueToken()` — that lands in Task 18. This step just verifies the plumbing compiles.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/install_token.rs src-tauri/src/lib.rs src/lib/install-token.ts
git commit -m "Add per-install token storage in macOS Keychain via keyring crate"
```

---

### Task 18: Deepgram WebSocket client

**Files:**
- Create: `src/lib/deepgram-client.ts`

- [ ] **Step 1: Write the client**

Create `src/lib/deepgram-client.ts`:

```ts
import { getOrIssueToken } from "./install-token";

const VP_EDGE_WS = (import.meta.env.VITE_VP_EDGE_WS as string | undefined) ?? "ws://localhost:8787/transcribe";

export type TranscriptEvent =
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "open" }
  | { type: "close"; reason: string }
  | { type: "error"; error: string };

export type TranscriptListener = (e: TranscriptEvent) => void;

export interface DeepgramClient {
  send(audio: Blob): void;
  close(): void;
  onEvent(listener: TranscriptListener): void;
  isOpen(): boolean;
}

export async function connectDeepgram(): Promise<DeepgramClient> {
  const token = await getOrIssueToken();
  const ws = new WebSocket(`${VP_EDGE_WS}?token=${encodeURIComponent(token)}`);
  ws.binaryType = "arraybuffer";

  let listeners: TranscriptListener[] = [];
  const emit = (e: TranscriptEvent) => listeners.forEach(l => l(e));

  ws.addEventListener("open", () => emit({ type: "open" }));
  ws.addEventListener("close", (ev) => emit({ type: "close", reason: ev.reason || "closed" }));
  ws.addEventListener("error", () => emit({ type: "error", error: "WebSocket error" }));
  ws.addEventListener("message", (msg) => {
    try {
      const data = JSON.parse(typeof msg.data === "string" ? msg.data : new TextDecoder().decode(msg.data));
      const t = data?.channel?.alternatives?.[0]?.transcript ?? "";
      if (!t) return;
      emit({ type: data.is_final ? "final" : "interim", text: t });
    } catch (err) {
      console.warn("[Deepgram] Bad message:", err);
    }
  });

  return {
    send: (audio: Blob) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      audio.arrayBuffer().then(buf => ws.send(buf));
    },
    close: () => ws.close(),
    onEvent: (l) => { listeners.push(l); },
    isOpen: () => ws.readyState === WebSocket.OPEN,
  };
}
```

- [ ] **Step 2: Add `vite-env.d.ts` types for the env vars**

Append to `src/vite-env.d.ts`:

```ts
interface ImportMetaEnv {
  readonly VITE_VP_EDGE_HTTP?: string;
  readonly VITE_VP_EDGE_WS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/deepgram-client.ts src/vite-env.d.ts
git commit -m "Add Deepgram WebSocket client routed through vp-edge proxy"
```

---

### Task 19: Wire streaming transcript into UI

**Files:**
- Modify: `src/App.tsx` (start Deepgram alongside MediaRecorder)
- Modify: `src/state/mic-context.tsx` (or wherever) to expose network state

- [ ] **Step 1: Extend `MicContext` to include network state**

Refactor — move the mic context into its own file `src/state/mic-context.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { RecorderHandle } from "../lib/audio-recorder";
import type { NetworkState } from "../components/Header";

export interface MicCtx {
  recording: boolean;
  permissionDenied: boolean;
  onToggle: () => void;
  recorder: RecorderHandle | null;
  networkState: NetworkState;
}

const MicContext = createContext<MicCtx | null>(null);

export function MicProvider({ value, children }: { value: MicCtx; children: ReactNode }) {
  return <MicContext.Provider value={value}>{children}</MicContext.Provider>;
}

export function useMic(): MicCtx {
  const ctx = useContext(MicContext);
  if (!ctx) throw new Error("useMic outside provider");
  return ctx;
}
```

Update `App.tsx` and `SessionWindow.tsx` imports accordingly.

- [ ] **Step 2: Hook Deepgram lifecycle alongside MediaRecorder in `App.tsx`**

In `AppInner`, add:

```tsx
import { connectDeepgram, type DeepgramClient } from "./lib/deepgram-client";

const dgRef = useRef<DeepgramClient | null>(null);
const [networkState, setNetworkState] = useState<NetworkState>("local-only");
```

In the first-capture branch where `recorderRef.current = await createRecorder()`, after `await recorderRef.current.start()`:

```tsx
recorderRef.current.onChunk(async (chunk) => {
  dgRef.current?.send(chunk);
});

try {
  const dg = await connectDeepgram();
  dgRef.current = dg;
  dg.onEvent((e) => {
    if (e.type === "open") setNetworkState("live");
    else if (e.type === "close" || e.type === "error") {
      setNetworkState("reconnecting");
      // simple retry: try again after 3s
      setTimeout(async () => {
        try {
          const dg2 = await connectDeepgram();
          dgRef.current = dg2;
        } catch { setNetworkState("local-only"); }
      }, 3000);
    } else if (e.type === "interim" || e.type === "final") {
      // Append to active segment (or closing narration if no screenshots remain)
      const text = e.type === "final" ? e.text + " " : e.text;
      // For interim: replace the tail of the active segment to show streaming preview.
      // For simplicity in v0.2, append finals only and let interims show in a separate "live preview" UI.
      if (e.type === "final") {
        // Decide target: closing narration if no screenshot since last final, else last screenshot.
        // For v0.2: always append to last screenshot; if none, append to closing narration.
        if ((dgRef.currentSession?.screenshots.length ?? 0) === 0) {
          dispatch({ type: "APPEND_TO_CLOSING_NARRATION", text });
        } else {
          dispatch({ type: "APPEND_TO_ACTIVE_SEGMENT", text });
        }
      }
    }
  });
} catch (err) {
  console.warn("[VisionPipe] Deepgram connect failed (offline mode):", err);
  setNetworkState("local-only");
}
```

> Note: the `dgRef.currentSession` reference above is conceptual — replace with `state.session` via a closure capture or use a `useRef` mirror of the session for use inside the listener.

- [ ] **Step 3: Mark new screenshots taken while offline**

In `onCapture`, after creating the `screenshot` object but before dispatching:

```tsx
const offline = networkState !== "live";
const screenshot: Screenshot = { ...prior, offline };
```

- [ ] **Step 4: Pass `networkState` through to `MicProvider`**

```tsx
<MicProvider value={{
  recording: micRecording, permissionDenied: micPermissionDenied,
  onToggle: onToggleMic, recorder: recorderRef.current, networkState,
}}>
```

- [ ] **Step 5: Smoke test — full end-to-end with mock**

Terminal 1: `pnpm dev:proxy`
Terminal 2: `pnpm tauri dev`

- Trigger hotkey, capture
- Mic indicator goes "Recording · Live"
- Talk; mock proxy returns canned transcripts every ~1.5s; "mock transcript chunk N." appears in the active card's narration area
- Take another capture; new chunks land in the new card's segment
- Click "Copy & Send" → paste; verify markdown contains the appended chunks

- [ ] **Step 6: Smoke test — offline path**

Stop the mock proxy (Ctrl-C in Terminal 1)
- Trigger another capture in the running app; mic indicator should switch to "Reconnecting…" then "Local-only"
- Take a 3rd screenshot — its segment should show "(offline …)" placeholder
- Restart `pnpm dev:proxy`; new audio chunks should resume real-time streaming on next capture

- [ ] **Step 7: Smoke test — real Deepgram (optional but recommended)**

Stop mock; restart with `DEEPGRAM_API_KEY=<your-key> pnpm dev:proxy`. Capture and speak naturally — real transcripts should appear.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/state/mic-context.tsx src/components/SessionWindow.tsx
git commit -m "Stream Deepgram transcripts into active segment with offline fallback"
```

---

## Phase G — View toggle (Split view)

### Task 20: Split view layout

**Files:**
- Create: `src/components/SplitView.tsx`
- Modify: `src/components/SessionWindow.tsx` (route based on `viewMode`)

- [ ] **Step 1: Write `SplitView.tsx`**

```tsx
import { useState } from "react";
import { useSession } from "../state/session-context";
import { Lightbox } from "./Lightbox";
import { convertFileSrc } from "@tauri-apps/api/core";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";

interface Props {
  onTakeNextScreenshot: () => void;
  onRequestRerecord: (seq: number) => void;
  onRequestDelete: (seq: number) => void;
}

export function SplitView({ onTakeNextScreenshot, onRequestRerecord, onRequestDelete }: Props) {
  const { state, dispatch } = useSession();
  const session = state.session!;
  const [lightboxSeq, setLightboxSeq] = useState<number | null>(null);
  const [activeSeq, setActiveSeq] = useState<number | null>(
    session.screenshots[session.screenshots.length - 1]?.seq ?? null
  );

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <aside style={{
        width: "40%", borderRight: `1px solid ${C.border}`,
        overflowY: "auto", padding: 12, background: C.deepForest,
      }}>
        {session.screenshots.map(s => (
          <div
            key={s.seq}
            onClick={() => setActiveSeq(s.seq)}
            style={{
              display: "flex", gap: 8, padding: 8, marginBottom: 6,
              background: s.seq === activeSeq ? C.forest : "transparent",
              border: `1px solid ${s.seq === activeSeq ? C.teal : C.border}`,
              borderRadius: 4, cursor: "pointer",
            }}
          >
            <img
              src={convertFileSrc(`${session.folder}/${s.canonicalName}.png`)}
              onClick={(e) => { e.stopPropagation(); setLightboxSeq(s.seq); }}
              style={{ width: 60, height: 40, objectFit: "cover", borderRadius: 3 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: C.textMuted,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                   title={s.canonicalName}>
                {s.canonicalName}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.amber,
                            fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.caption || "—"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button onClick={(e) => { e.stopPropagation(); onRequestRerecord(s.seq); }} style={miniBtn()}>🎙</button>
              <button onClick={(e) => { e.stopPropagation(); onRequestDelete(s.seq); }} style={miniBtn()}>🗑</button>
            </div>
          </div>
        ))}
        <button onClick={onTakeNextScreenshot} style={{
          width: "100%", padding: 10, background: "transparent",
          border: `1px dashed ${C.borderLight}`, color: C.textMuted,
          borderRadius: 4, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12,
        }}>
          ＋ Take next screenshot
        </button>
      </aside>

      <section style={{ flex: 1, padding: 16, overflowY: "auto", color: C.textBright, fontFamily: FONT_BODY }}>
        {session.screenshots.map(s => (
          <div key={s.seq} style={{ marginBottom: 24 }}>
            <h3
              onClick={() => setActiveSeq(s.seq)}
              style={{
                fontFamily: FONT_MONO, fontSize: 11, color: C.amber,
                cursor: "pointer", marginBottom: 6,
              }}>
              --- Screenshot {s.seq} — {s.canonicalName} ---
            </h3>
            <textarea
              value={s.transcriptSegment}
              onChange={(e) => dispatch({
                type: "UPDATE_TRANSCRIPT_SEGMENT", seq: s.seq, text: e.target.value,
              })}
              style={{
                width: "100%", minHeight: 80, padding: 8,
                background: C.forest, border: `1px solid ${s.seq === activeSeq ? C.teal : C.borderLight}`,
                color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
              }}
            />
          </div>
        ))}
        <div>
          <h3 style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
            --- Closing narration ---
          </h3>
          <textarea
            value={session.closingNarration}
            onChange={(e) => dispatch({ type: "UPDATE_CLOSING_NARRATION", text: e.target.value })}
            style={{
              width: "100%", minHeight: 60, padding: 8,
              background: C.forest, border: `1px solid ${C.borderLight}`,
              color: C.textBright, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical",
            }}
          />
        </div>
      </section>
      {lightboxSeq !== null && <Lightbox seq={lightboxSeq} onClose={() => setLightboxSeq(null)} />}
    </div>
  );
}

const miniBtn = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, width: 22, height: 22, borderRadius: 3,
  cursor: "pointer", fontSize: 11, padding: 0,
});
```

- [ ] **Step 2: Route between `InterleavedView` and `SplitView` based on `viewMode`**

In `src/components/SessionWindow.tsx`:

```tsx
import { SplitView } from "./SplitView";
// ...
<main style={{ flex: 1, overflow: "hidden" }}>
  {session.viewMode === "interleaved" ? (
    <div style={{ height: "100%", overflow: "auto" }}>
      <InterleavedView
        onTakeNextScreenshot={takeNext}
        onRequestRerecord={requestRerecord}
        onRequestDelete={requestDelete}
      />
    </div>
  ) : (
    <SplitView
      onTakeNextScreenshot={takeNext}
      onRequestRerecord={requestRerecord}
      onRequestDelete={requestDelete}
    />
  )}
</main>
```

- [ ] **Step 3: Persist last-used `viewMode` to localStorage as user preference**

Add to `App.tsx` `AppInner`:

```tsx
useEffect(() => {
  if (state.session) localStorage.setItem("vp-default-view", state.session.viewMode);
}, [state.session?.viewMode]);
```

In the START_SESSION dispatch, set `viewMode` from localStorage:

```tsx
const defaultView = (localStorage.getItem("vp-default-view") as ViewMode | null) ?? "interleaved";
dispatch({ type: "START_SESSION", session: { ...newSession, viewMode: defaultView } });
```

- [ ] **Step 4: Smoke test**

Run dev. Click "Detach transcript" in header — view switches to split layout. Click again → switches back. Quit and re-launch, take a new capture → defaults to your last-used view.

- [ ] **Step 5: Commit**

```bash
git add src/components/SplitView.tsx src/components/SessionWindow.tsx src/App.tsx
git commit -m "Add SplitView (View A) with toggle and per-user persistence"
```

---

## Phase H — Settings + hotkeys

### Task 21: Hotkey config storage (Rust + TS)

**Files:**
- Create: `src-tauri/src/hotkey_config.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the Rust module**

Create `src-tauri/src/hotkey_config.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct HotkeyConfig {
    pub take_next_screenshot: String, // global
    pub copy_and_send: String,        // window-scoped
    pub rerecord_active: String,      // window-scoped
    pub toggle_view_mode: String,     // window-scoped
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            take_next_screenshot: "CmdOrCtrl+Shift+C".into(),
            copy_and_send: "CmdOrCtrl+Enter".into(),
            rerecord_active: "CmdOrCtrl+Shift+R".into(),
            toggle_view_mode: "CmdOrCtrl+T".into(),
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    let dir = dirs::config_dir().ok_or_else(|| "no config dir".to_string())?;
    let app_dir = dir.join("com.visionpipe.desktop");
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    Ok(app_dir.join("settings.json"))
}

pub fn load() -> HotkeyConfig {
    config_path().ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(cfg: &HotkeyConfig) -> Result<(), String> {
    let p = config_path()?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Wire commands**

In `src-tauri/src/lib.rs`:

```rust
mod hotkey_config;

#[tauri::command]
async fn load_hotkey_config() -> hotkey_config::HotkeyConfig {
    hotkey_config::load()
}

#[tauri::command]
async fn save_hotkey_config(cfg: hotkey_config::HotkeyConfig) -> Result<(), String> {
    hotkey_config::save(&cfg)
}
```

Add both to the `invoke_handler` list. Also update the global-shortcut registration to read from config:

```rust
let cfg = hotkey_config::load();
let global_combo = cfg.take_next_screenshot.clone();
app.global_shortcut().on_shortcut(global_combo.as_str(), move |_app, _shortcut, event| {
    // ... existing handler body
})?;
```

- [ ] **Step 3: Build & verify**

```bash
pnpm tauri build --debug
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/hotkey_config.rs src-tauri/src/lib.rs
git commit -m "Add persistent hotkey config in app config dir"
```

---

### Task 22: Settings panel UI

**Files:**
- Create: `src/components/SettingsPanel.tsx`
- Create: `src/components/HotkeyBindingRow.tsx`
- Create: `src/components/__tests__/HotkeyBindingRow.test.tsx`
- Modify: `src/components/SessionWindow.tsx` (open settings from header overflow)

- [ ] **Step 1: Write failing test for conflict detection**

Create `src/components/__tests__/HotkeyBindingRow.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { detectConflict, RESERVED_COMBOS } from "../HotkeyBindingRow";

describe("detectConflict", () => {
  it("flags macOS-reserved combos", () => {
    expect(detectConflict("CmdOrCtrl+Q", [])).toBe("Reserved by macOS (Quit)");
    expect(detectConflict("CmdOrCtrl+W", [])).toBe("Reserved by macOS (Close window)");
    expect(detectConflict("CmdOrCtrl+Tab", [])).toBe("Reserved by macOS (App switcher)");
  });
  it("flags duplicates in the existing bindings list", () => {
    expect(detectConflict("CmdOrCtrl+Shift+C", ["CmdOrCtrl+Shift+C", "CmdOrCtrl+Enter"]))
      .toBe("Conflicts with another VisionPipe binding");
  });
  it("returns null for unique non-reserved combos", () => {
    expect(detectConflict("CmdOrCtrl+Shift+X", ["CmdOrCtrl+Shift+C"])).toBeNull();
  });
  it("RESERVED_COMBOS is a non-empty Map", () => {
    expect(RESERVED_COMBOS.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test HotkeyBindingRow
```

Expected: fails on missing module.

- [ ] **Step 3: Write `HotkeyBindingRow.tsx`**

```tsx
import { useState } from "react";
import { C, FONT_BODY, FONT_MONO } from "../lib/ui-tokens";

export const RESERVED_COMBOS: Map<string, string> = new Map([
  ["CmdOrCtrl+Q", "Reserved by macOS (Quit)"],
  ["CmdOrCtrl+W", "Reserved by macOS (Close window)"],
  ["CmdOrCtrl+Tab", "Reserved by macOS (App switcher)"],
  ["CmdOrCtrl+Space", "Reserved by macOS (Spotlight)"],
  ["CmdOrCtrl+H", "Reserved by macOS (Hide app)"],
  ["CmdOrCtrl+M", "Reserved by macOS (Minimize)"],
]);

export function detectConflict(combo: string, otherBindings: string[]): string | null {
  if (RESERVED_COMBOS.has(combo)) return RESERVED_COMBOS.get(combo)!;
  if (otherBindings.includes(combo)) return "Conflicts with another VisionPipe binding";
  return null;
}

interface Props {
  label: string;
  scope: "global" | "window";
  combo: string;
  otherBindings: string[];
  onChange: (newCombo: string) => void;
  onReset: () => void;
}

const formatKey = (e: KeyboardEvent): string => {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  // Ignore plain modifier presses (no actual key)
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return "";
  let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (k === "Tab" || k === "Enter" || k === "Space" || k === "Escape") k = k;
  parts.push(k);
  return parts.join("+");
};

export function HotkeyBindingRow({ label, scope, combo, otherBindings, onChange, onReset }: Props) {
  const [capturing, setCapturing] = useState(false);
  const conflict = detectConflict(combo, otherBindings);

  const startCapture = () => {
    setCapturing(true);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setCapturing(false);
        window.removeEventListener("keydown", handler);
        return;
      }
      const k = formatKey(e);
      if (!k) return; // modifier-only press
      window.removeEventListener("keydown", handler);
      setCapturing(false);
      onChange(k);
    };
    window.addEventListener("keydown", handler);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 12, alignItems: "center", padding: 8 }}>
      <div style={{ fontFamily: FONT_BODY, color: C.textBright }}>
        {label}
        <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 8 }}>({scope})</span>
      </div>
      <code style={{
        fontFamily: FONT_MONO, fontSize: 12, color: C.amber,
        padding: "4px 10px", border: `1px solid ${C.borderLight}`, borderRadius: 4, minWidth: 160, textAlign: "center",
      }}>
        {capturing ? "Press new shortcut…" : combo}
      </code>
      <button onClick={startCapture} disabled={capturing} style={btnStyle()}>
        {capturing ? "…" : "Change"}
      </button>
      <button onClick={onReset} style={btnStyle()}>Reset</button>
      {conflict && (
        <div style={{ gridColumn: "1 / -1", color: C.sienna, fontSize: 11 }}>{conflict}</div>
      )}
    </div>
  );
}

const btnStyle = (): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.borderLight}`,
  color: C.textBright, padding: "4px 10px", borderRadius: 4,
  cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12,
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm test HotkeyBindingRow
```

Expected: 4 passing tests.

- [ ] **Step 5: Write `SettingsPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HotkeyBindingRow } from "./HotkeyBindingRow";
import { C, FONT_BODY } from "../lib/ui-tokens";

interface HotkeyConfig {
  takeNextScreenshot: string;
  copyAndSend: string;
  rerecordActive: string;
  toggleViewMode: string;
}

const DEFAULTS: HotkeyConfig = {
  takeNextScreenshot: "CmdOrCtrl+Shift+C",
  copyAndSend: "CmdOrCtrl+Enter",
  rerecordActive: "CmdOrCtrl+Shift+R",
  toggleViewMode: "CmdOrCtrl+T",
};

interface Props { onClose: () => void; }

export function SettingsPanel({ onClose }: Props) {
  const [cfg, setCfg] = useState<HotkeyConfig>(DEFAULTS);

  useEffect(() => {
    (async () => {
      const loaded = await invoke<{ take_next_screenshot: string; copy_and_send: string; rerecord_active: string; toggle_view_mode: string; }>("load_hotkey_config");
      setCfg({
        takeNextScreenshot: loaded.take_next_screenshot,
        copyAndSend: loaded.copy_and_send,
        rerecordActive: loaded.rerecord_active,
        toggleViewMode: loaded.toggle_view_mode,
      });
    })();
  }, []);

  const persist = async (next: HotkeyConfig) => {
    setCfg(next);
    await invoke("save_hotkey_config", {
      cfg: {
        take_next_screenshot: next.takeNextScreenshot,
        copy_and_send: next.copyAndSend,
        rerecord_active: next.rerecordActive,
        toggle_view_mode: next.toggleViewMode,
      },
    });
  };

  const all = [cfg.takeNextScreenshot, cfg.copyAndSend, cfg.rerecordActive, cfg.toggleViewMode];

  const others = (k: keyof HotkeyConfig) => all.filter((_, i) => Object.keys(cfg)[i] !== k);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: C.deepForest, padding: 24, borderRadius: 8,
        minWidth: 560, maxWidth: 720, color: C.textBright, fontFamily: FONT_BODY,
        border: `1px solid ${C.borderLight}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: C.textBright,
            fontSize: 20, cursor: "pointer",
          }}>×</button>
        </div>
        <h3 style={{ marginTop: 0, color: C.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          Hotkeys
        </h3>
        <HotkeyBindingRow label="Take next screenshot" scope="global"
          combo={cfg.takeNextScreenshot} otherBindings={others("takeNextScreenshot")}
          onChange={(c) => persist({ ...cfg, takeNextScreenshot: c })}
          onReset={() => persist({ ...cfg, takeNextScreenshot: DEFAULTS.takeNextScreenshot })}
        />
        <HotkeyBindingRow label="Copy & Send" scope="window"
          combo={cfg.copyAndSend} otherBindings={others("copyAndSend")}
          onChange={(c) => persist({ ...cfg, copyAndSend: c })}
          onReset={() => persist({ ...cfg, copyAndSend: DEFAULTS.copyAndSend })}
        />
        <HotkeyBindingRow label="Re-record active segment" scope="window"
          combo={cfg.rerecordActive} otherBindings={others("rerecordActive")}
          onChange={(c) => persist({ ...cfg, rerecordActive: c })}
          onReset={() => persist({ ...cfg, rerecordActive: DEFAULTS.rerecordActive })}
        />
        <HotkeyBindingRow label="Toggle view mode" scope="window"
          combo={cfg.toggleViewMode} otherBindings={others("toggleViewMode")}
          onChange={(c) => persist({ ...cfg, toggleViewMode: c })}
          onReset={() => persist({ ...cfg, toggleViewMode: DEFAULTS.toggleViewMode })}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <button onClick={() => persist(DEFAULTS)} style={{
            background: "transparent", border: `1px solid ${C.borderLight}`,
            color: C.textMuted, padding: "6px 14px", borderRadius: 4, cursor: "pointer",
          }}>Reset all to defaults</button>
          <div style={{ fontSize: 11, color: C.textMuted, alignSelf: "center" }}>
            Note: hotkey changes take effect after the next app restart.
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire Settings into the overflow menu**

In `src/components/SessionWindow.tsx`:

```tsx
import { SettingsPanel } from "./SettingsPanel";
const [settingsOpen, setSettingsOpen] = useState(false);

// In Header props:
onOpenSettings={() => setSettingsOpen(true)}

// In return:
{settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
```

- [ ] **Step 7: Smoke test**

Open Settings from overflow menu (type `3` in the prompt). Change a hotkey, observe it persists in `~/Library/Application Support/com.visionpipe.desktop/settings.json`. Restart app — verify the new global hotkey works.

- [ ] **Step 8: Commit**

```bash
git add src/components/SettingsPanel.tsx src/components/HotkeyBindingRow.tsx src/components/__tests__/HotkeyBindingRow.test.tsx src/components/SessionWindow.tsx
git commit -m "Add Settings panel with hotkey rebinding and conflict detection"
```

---

## Phase I — Final integration tests + verification

### Task 23: Window-scoped hotkey wiring

**Files:**
- Modify: `src/App.tsx` (window-scoped keyboard listeners)

- [ ] **Step 1: Add window-scoped keydown listener that reads loaded hotkey config**

In `AppInner`, add:

```tsx
import type { ViewMode } from "./types/session";

const [hotkeys, setHotkeys] = useState({
  copyAndSend: "CmdOrCtrl+Enter",
  rerecordActive: "CmdOrCtrl+Shift+R",
  toggleViewMode: "CmdOrCtrl+T",
});

useEffect(() => {
  (async () => {
    const cfg = await invoke<any>("load_hotkey_config");
    setHotkeys({
      copyAndSend: cfg.copy_and_send,
      rerecordActive: cfg.rerecord_active,
      toggleViewMode: cfg.toggle_view_mode,
    });
  })();
}, []);

useEffect(() => {
  const matches = (e: KeyboardEvent, combo: string): boolean => {
    const parts = combo.split("+");
    const meta = parts.includes("CmdOrCtrl") && (e.metaKey || e.ctrlKey);
    const shift = parts.includes("Shift") === e.shiftKey;
    const alt = parts.includes("Alt") === e.altKey;
    const key = parts.filter(p => !["CmdOrCtrl", "Shift", "Alt"].includes(p))[0];
    if (!key) return false;
    return meta && shift && alt && (e.key.toUpperCase() === key.toUpperCase() || e.key === key);
  };
  const onKey = (e: KeyboardEvent) => {
    if (matches(e, hotkeys.copyAndSend)) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("vp-copy-and-send"));
    } else if (matches(e, hotkeys.toggleViewMode)) {
      e.preventDefault();
      dispatch({ type: "TOGGLE_VIEW_MODE" });
    } else if (matches(e, hotkeys.rerecordActive)) {
      e.preventDefault();
      const last = state.session?.screenshots[state.session.screenshots.length - 1];
      if (last) window.dispatchEvent(new CustomEvent("vp-rerecord-segment", { detail: { seq: last.seq } }));
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [hotkeys, state.session, dispatch]);
```

In `SessionWindow.tsx`, listen for `vp-copy-and-send`:

```tsx
useEffect(() => {
  const handler = () => void onCopyAndSend();
  window.addEventListener("vp-copy-and-send", handler);
  return () => window.removeEventListener("vp-copy-and-send", handler);
}, [session]);
```

- [ ] **Step 2: Smoke test**

In an active session, press `Cmd+Enter` → markdown copies. Press `Cmd+T` → view toggles. Press `Cmd+Shift+R` → re-record modal opens for the last screenshot.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/components/SessionWindow.tsx
git commit -m "Wire window-scoped hotkeys for copy/toggle/rerecord"
```

---

### Task 24: README update for honest transcription disclosure

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update transcription section**

In `README.md`, change the "Speak It" section under "Multi-Modal Annotation" to clearly disclose the Deepgram cloud dependency in v0.2:

```markdown
### Speak It

Record continuous voice narration alongside your screenshots — narrate naturally as you take captures within a session, and VisionPipe transcribes in real time.

**v0.2 (current):** Real-time transcription via Deepgram Nova-3, routed through VisionPipe's `vp-edge` proxy. **Audio is sent off-device for transcription.** No account or API key needed; per-install rate limits keep usage capped at 60 minutes/day during the free trial. Audio is always preserved locally as `audio-master.webm` even when offline.

**v0.3 (planned):** On-device WhisperKit will be available as an opt-in for users who prefer to keep audio fully local. Cloud-based real-time transcription will remain the default for the lowest-friction experience.
```

Also update the "Roadmap" section:

```markdown
## Roadmap

- [x] Multi-screenshot session capture
- [x] Real-time voice transcription (Deepgram via vp-edge)
- [x] User-configurable hotkeys
- [ ] On-device transcription opt-in (WhisperKit) — v0.3
- [ ] Cloud sharing with secret links — Spec 2 in progress
- [ ] In-app session history browser — v0.3
- [ ] Drag-to-reorder screenshots — v0.3
- [ ] Linux + Windows support — future
- [ ] Resume prior session on app launch — v0.3
- [ ] Custom transcription provider (OpenAI Whisper API key) — v0.3
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Disclose Deepgram cloud dependency honestly in README v0.2 transcription section"
```

---

### Task 25: Integration smoke-test checklist

**Files:**
- Create: `docs/superpowers/plans/2026-05-02-multi-screenshot-narrated-bundle-smoke-tests.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Multi-Screenshot Narrated Bundle — Smoke Test Checklist

Run through these manually on a physical Apple Silicon Mac before claiming Spec 1 implementation complete.

## Prerequisites
- [ ] `pnpm tauri dev` running cleanly
- [ ] `pnpm dev:proxy` running in another shell
- [ ] Mic permission granted (System Settings → Privacy & Security → Microphone → VisionPipe)
- [ ] Screen Recording permission granted

## Happy path

- [ ] Press `Cmd+Shift+C` → region-select overlay appears
- [ ] Drag a region → session window opens with one card
- [ ] Mic indicator shows "Recording · Live"
- [ ] Talk for 5 seconds — text appears in active card's narration
- [ ] Click "+ Take next screenshot" → window hides → drag region → window reappears with second card
- [ ] First card's audioOffset.end is set; second card's audioOffset.start matches
- [ ] Edit caption on card #1 → updates persist after 500ms
- [ ] Click 🎙 on card #1 → modal opens → talk 5s → click Stop
- [ ] `<canonicalName>-rerecord.webm` exists in session folder
- [ ] Toggle view to split → cards on left, transcript on right; toggle back
- [ ] Click "📋 Copy & Send" → paste into a text editor; verify markdown structure matches spec §5
- [ ] Click thumbnail on card → lightbox opens at full resolution; Esc closes

## Offline path

- [ ] With session open, stop `pnpm dev:proxy`
- [ ] Mic indicator switches to "Reconnecting…" within 5s, then to "Local-only"
- [ ] Take a 3rd screenshot — its narration area shows "(offline …)" placeholder
- [ ] `audio-master.webm` is still recording (file size grows)
- [ ] Restart `pnpm dev:proxy` — within ~10s mic indicator returns to "Live"
- [ ] Take a 4th screenshot — its narration streams new transcripts
- [ ] Click "Copy & Send" — markdown for screenshot #3 contains the offline placeholder; #4 contains a real transcript

## Crash recovery

- [ ] Take 2 screenshots in a session
- [ ] Force-quit the app (`pkill -KILL VisionPipe`)
- [ ] Re-launch
- [ ] Open `~/Pictures/VisionPipe/` in Finder — the session folder is there with both screenshots, transcript.json, audio-master.webm (possibly missing the last 1s chunk)
- [ ] Take a new capture — a NEW session folder is created (no auto-resume in v0.2)

## Long session

- [ ] Take 20 screenshots in a single session
- [ ] UI stays responsive
- [ ] Transcript persistence (`transcript.json`) updates after each capture
- [ ] Click "Copy & Send" — markdown is well-formed
- [ ] Paste into Claude Code — verify all 20 image references resolve and Claude can `Read` each one

## Hotkeys

- [ ] Open Settings (overflow menu → 3) → change "Take next screenshot" to `Cmd+Shift+P`
- [ ] Restart app — pressing `Cmd+Shift+P` triggers capture; `Cmd+Shift+C` no longer does
- [ ] Try to bind to `Cmd+Q` → conflict warning appears; binding rejected
- [ ] "Reset all to defaults" → restores `Cmd+Shift+C`

## Permission denial

- [ ] Revoke mic permission in System Settings
- [ ] Take a screenshot — session opens, mic indicator shows "Permission required"
- [ ] Captures still work; manual narration via typing in the textareas works
- [ ] Markdown output omits Narration blocks for offline/silent screenshots
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-02-multi-screenshot-narrated-bundle-smoke-tests.md
git commit -m "Add manual smoke-test checklist for Spec 1 verification"
```

---

### Task 26: Run the smoke checklist; close gaps

- [ ] **Step 1: Walk through every item in the smoke-test checklist**

Mark each item passed/failed in the checklist file as you go. Use the existing `superpowers:verification-before-completion` discipline — run the checks; do not skip any.

- [ ] **Step 2: For any failure, file a fix as a discrete subtask, fix it, commit, re-run that section.**

- [ ] **Step 3: When the entire checklist passes**, commit the marked-up checklist:

```bash
git add docs/superpowers/plans/2026-05-02-multi-screenshot-narrated-bundle-smoke-tests.md
git commit -m "Verify smoke-test checklist passes for Spec 1"
```

- [ ] **Step 4: Run all unit tests one final time**

```bash
pnpm test && cd src-tauri && cargo test && cd ..
```

Expected: all green.

- [ ] **Step 5: Verify the app builds release-mode**

```bash
./scripts/release.sh   # uses the existing pipeline; produces signed/notarized .dmg
```

If the release script fails because of unrelated changes (e.g., the `cpal`/`candle-*` deps you didn't remove), capture the failure but do not patch it in this plan — that's a separate v0.2.1 follow-up.

- [ ] **Step 6: Update the per-branch progress log**

Edit `prd/<current-branch>.md` per CLAUDE.md's progress-log workflow with a final entry summarizing Spec 1 completion. Stage and commit alongside the plan checklist marking.

---

## Self-review (do this before marking the plan complete)

Walk this checklist yourself once the plan is fully written:

- [ ] **Spec coverage** — every section of the spec maps to at least one task:
  - §3 decisions (Q1–Q7): Q1 audio in Tasks 13-15; Q2 markdown in Task 6; Q3 capture in Task 7; Q4 lifecycle in Tasks 4, 8; Q5 naming in Task 3; Q6 layout in Tasks 11, 20; Q7 transcription in Tasks 16-19
  - §4 data model: Tasks 2, 4, 5
  - §5 markdown format: Task 6
  - §6 capture & audio mechanics: Tasks 7, 13-15, 18, 19
  - §7 UI components: Tasks 9-12, 15, 20, 22
  - §8 testing: Tasks 1, 3, 5, 6, 22, 25, 26
  - §9 risk register: addressed by infra commentary in Task 16 README + smoke checklist offline path in Task 25
  - §10 Spec 2 handoff: out of scope; no task needed
  - §11 implementation handoff: addressed at top of plan + Task 24 README disclosure
- [ ] **Placeholder scan** — search for "TBD", "TODO", "fill in" — none should remain
- [ ] **Type consistency** — function names match between tasks (`renderMarkdown`, `generateCanonicalName`, `createRecorder`, `connectDeepgram`, `getOrIssueToken`, `useSession`, `useMic`, `sessionReducer`)
- [ ] **No "see Task N" indirection without context** — each task code block is self-contained

---

## Out of scope for this plan (do NOT do these in this implementation)

- Production `vp-edge` proxy (rate limiting, auth, deployment, ops) — **separate plan**
- Spec 2 (cloud share, secret links, billing tiers, web viewer) — **separate spec + plan**
- On-device WhisperKit transcription — v0.3
- In-app session history browser — v0.3
- Drag-to-reorder screenshots — v0.3
- Resume prior session on app launch — v0.3
- Removing dead `cpal`/`candle-*`/`whisper-*`/`symphonia`/`rubato`/`tokenizers`/`hf-hub` Rust deps from `Cargo.toml` — left in place to keep this commit focused; remove in v0.2.1 cleanup
- Per-screenshot drawing/markup layer — out of spec
- Cross-platform Windows/Linux support — out of spec
