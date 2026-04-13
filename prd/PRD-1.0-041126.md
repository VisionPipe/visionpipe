# Vision|Pipe — Product Requirements Document

**Version:** 0.1.0  
**Status:** Active Development — `initial-build-out` branch  
**Last Updated:** April 11, 2026  
**Owner:** VisionPipe  
**Tagline:** `screenshot | llm` — now a reality.

---

## 1. Executive Summary

VisionPipe is the missing primitive between what developers see on their screens and what their AI models understand. It is not a screenshot tool. It is a **context transport layer** — a lightweight, cross-platform desktop utility (macOS and Windows) that captures a screen region, attaches multi-modal annotation (voice, text, or drawing), bundles rich environmental metadata, and copies everything to the clipboard in a single keystroke. The user pastes into any LLM. Done.

The product is built on the Unix philosophy: do one thing, do it well, compose it with everything else.

**The problem it solves in one sentence:** Developers waste cycles describing their screen state to an AI in words when they could just show it.

---

## 2. Problem Statement

**Situation:** AI coding assistants — GPT-4, Gemini, Claude, OpenAI Codex — have become integral to developer workflows. These models accept images. Developers routinely need to share visual context: a misaligned component, a failing test output, a UI bug in Safari, an error in VS Code.

**Complication:** The friction is prohibitive. Existing tools (Zight, Snagit, CleanShot, macOS screenshot) were built to share screenshots *with humans*. They optimize for human-readable markup. They do not capture environmental metadata. They do not annotate at the moment of capture. They force the developer to context-switch into an LLM chat window and re-describe what is visually obvious.

**Resolution:** VisionPipe removes all of that friction. One hotkey. Region selection. Annotate (speak, type, or draw). Enter. Paste. The LLM receives the image, the intent, and the full environmental context in a single clipboard payload — no uploads, no integrations, no accounts.

---

## 3. Strategic Positioning

VisionPipe is positioned as **human-in-the-loop vision piping** — the interactive, ad hoc counterpart to programmatic tools like Playwright.

> *"Playwright gives your test suite vision. VisionPipe gives you vision."*

| Tool | Built For | LLM-Native | Annotate at Capture | Rich Metadata |
|---|---|---|---|---|
| Playwright | Programmatic browser automation | No | No | Partial |
| Zight / CleanShot X | Sharing with humans | No | Post-capture only | No |
| Snagit | Documentation and tutorials | No | Post-capture only | No |
| macOS Screenshot | General capture | No | No | No |
| **Vision\|Pipe** | **Piping visual context into LLMs** | **Yes** | **Yes — voice, text, or drawing** | **Yes** |

---

## 4. Target Users

**Primary: Software Engineers (Individual Contributors)**
- Actively using LLMs for coding assistance, code review, and debugging
- Work across VS Code, JetBrains IDEs, terminal, and browsers
- Value keyboard-first, zero-friction workflows
- Already comfortable with the Unix pipe mental model

**Secondary: QA Engineers and Technical Designers**
- Report UI bugs and visual regressions frequently
- Need to communicate precise visual context with precision to AI and human reviewers
- Spend disproportionate time re-explaining context in chat windows

**Tertiary: AI Power Users**
- Non-engineering professionals who regularly feed context to LLMs
- May not identify as developers but operate AI-heavy workflows

**Anti-user:** End users who want to share screenshots socially or with human colleagues. Those users have Zight. VisionPipe is designed for your AI, not your Slack.

---

## 5. Core Use Cases

| ID | Use Case | Trigger | Outcome |
|---|---|---|---|
| UC-01 | Bug report to LLM | UI rendering error visible on screen | LLM receives screenshot + voice description + window/browser metadata |
| UC-02 | Code review request | Code visible in VS Code | LLM receives screenshot + text annotation + active file/window context |
| UC-03 | Drawing-directed analysis | Need to point LLM at specific element | Arrow/circle markup focuses LLM attention without words |
| UC-04 | Rapid debugging | Exception thrown in terminal | Full terminal screenshot + spoken description piped instantly |
| UC-05 | Design feedback | Figma or browser preview open | Screenshot + text comment + display resolution metadata |

---

## 6. Feature Requirements

### 6.1 Screen Capture

| ID | Requirement | Priority |
|---|---|---|
| F-01 | Global hotkey triggers capture mode — `Cmd+Shift+V` (macOS), `Ctrl+Shift+V` (Windows) | P0 |
| F-02 | Region selection: click-drag crosshair to define capture area | P0 |
| F-03 | Full screen capture mode | P1 |
| F-04 | Active window capture mode | P1 |
| F-05 | Capture outputs PNG at native resolution (Retina/HiDPI aware) | P0 |
| F-06 | Overlay opens immediately post-region-selection with no perceptible lag | P0 |

### 6.2 Multi-Modal Annotation

All three annotation modes can be used simultaneously and are bundled into the single clipboard payload.

**Voice (Speak It)**

| ID | Requirement | Priority |
|---|---|---|
| F-07 | One-button voice recording within the annotation overlay | P0 |
| F-08 | On-device transcription via Whisper — no audio sent to external services | P0 |
| F-09 | Transcript is appended to the clipboard payload as plain text | P0 |
| F-10 | Recording indicator with visual feedback (waveform or pulse animation) | P1 |

**Text (Type It)**

| ID | Requirement | Priority |
|---|---|---|
| F-11 | Text input field in sidebar: `// what should your AI do with this?` | P0 |
| F-12 | Text area accepts multi-line input, expands vertically | P1 |
| F-13 | Text is appended to clipboard payload with clear labeling | P0 |

**Drawing (Draw It)**

| ID | Requirement | Priority |
|---|---|---|
| F-14 | Freehand pen/pencil tool | P0 |
| F-15 | Rectangle tool | P0 |
| F-16 | Arrow tool | P0 |
| F-17 | Circle/oval tool | P0 |
| F-18 | Text label tool (place text directly on image) | P1 |
| F-19 | Color picker — defaults to Amber (`#d4882a`) | P0 |
| F-20 | Undo / Redo (unlimited within session) | P0 |
| F-21 | Drawing annotations are rasterized into the final PNG payload | P0 |

### 6.3 Rich Metadata Capture

All metadata is automatically appended to the clipboard payload as structured text — zero configuration required.

**Spatial & Display**

| Field | Example |
|---|---|
| Capture region (x, y) | `x: 240, y: 180` |
| Capture dimensions | `1200 x 800 px` |
| Screen resolution | `2560 x 1600` |
| DPI / scale factor | `2x (Retina)` |
| Monitor index | `Monitor 1 of 2` |
| Monitor name | `LG UltraFine 5K` |
| Display orientation | `Landscape` |
| Color profile | `Display P3` |

**Window & Application**

| Field | Example |
|---|---|
| Active application name | `Visual Studio Code` |
| Application bundle ID | `com.microsoft.VSCode` |
| Window title | `App.tsx — visionpipe` |
| Window position & size | `(100, 50) — 1440 x 900` |
| Window state | `Windowed / Maximized / Fullscreen` |
| Process ID | `PID 4821` |

**Browser Context** *(when a browser is the active window)*

| Field | Example |
|---|---|
| Browser name & version | `Chrome 124.0` |
| Active tab URL | `https://github.com/yourname/visionpipe` |
| Page title | `VisionPipe — GitHub` |
| Viewport dimensions | `1440 x 789` |

> Browser metadata is captured via macOS Accessibility API and Windows UI Automation. No browser extension required.

**Cursor & Input**

| Field | Example |
|---|---|
| Cursor position at capture | `x: 540, y: 320` |
| Cursor type | `Pointer / Text / Crosshair` |

**Capture Metadata**

| Field | Example |
|---|---|
| Capture method | `Region / Full Screen / Window` |
| Annotation type(s) used | `Voice + Drawing` |
| Image format | `PNG` |
| Timestamp (ISO 8601) | `2026-04-11T14:32:01Z` |
| VisionPipe version | `0.1.0` |
| Operating system | `macOS 15.3.2` |

### 6.4 Clipboard Payload

| ID | Requirement | Priority |
|---|---|---|
| F-22 | Payload bundles: screenshot PNG + text annotation + voice transcript + metadata block | P0 |
| F-23 | Metadata is formatted as structured plain text appended beneath the annotation | P0 |
| F-24 | `Copy to Clipboard / pbcopy` is the primary action, triggered by Enter | P0 |
| F-25 | Payload is compatible with any LLM accepting image input: GPT-4, Gemini, Claude, OpenAI Codex | P0 |
| F-26 | No accounts, API keys, or external integrations required | P0 |

### 6.5 System Tray & Persistence

| ID | Requirement | Priority |
|---|---|---|
| F-27 | App runs as a system tray process — no Dock presence required | P0 |
| F-28 | Global hotkey remains active while app is backgrounded | P0 |
| F-29 | Tray icon reflects app state (idle, capturing, recording) | P1 |

### 6.6 Settings

| ID | Requirement | Priority |
|---|---|---|
| F-30 | Custom hotkey configuration | P1 |
| F-31 | Default annotation mode preference | P2 |
| F-32 | Default drawing color preference | P2 |
| F-33 | Whisper model size selection (speed vs. accuracy tradeoff) | P2 |

### 6.7 Roadmap Features (Post-v1.0)

| Feature | Priority |
|---|---|
| Screenshot history / clipboard manager | P2 |
| Structured JSON metadata export | P2 |
| Browser metadata via Accessibility APIs | P2 |
| API for programmatic access | P3 |
| MCP server implementation (integration with coding agents) | P2 |
| Linux support | P3 |

---

## 7. Technical Architecture

### 7.1 Stack

| Layer | Technology | Rationale |
|---|---|---|
| App framework | Tauri v2 | Lightweight, secure, native — not Electron. Minimal CPU/memory footprint |
| Frontend | Vite + React + TypeScript | Component-based UI, fast HMR, type safety |
| Backend | Rust | Systems-level performance for metadata capture, screen APIs, clipboard |
| Voice transcription | Whisper (on-device) | Privacy-preserving, no network dependency |
| Clipboard | Tauri clipboard plugin | Cross-platform clipboard write with image support |
| Hotkeys | Tauri global-shortcut plugin | OS-level hotkey registration |
| System tray | Tauri tray plugin | Persistent background presence |

### 7.2 Architecture Flow

```
[User presses Cmd+Shift+V]
        ↓
[Rust: global shortcut fires]
        ↓
[Rust: Crosshair overlay renders full-screen transparent window]
        ↓
[User drags region selection]
        ↓
[Rust: screen region captured → PNG in memory]
        ↓
[Rust: metadata collectors fire in parallel]
  - Spatial/display data (CoreGraphics / Win32)
  - Window/app context (Accessibility API)
  - Browser context (a11y API, if browser active)
  - Cursor position + type
        ↓
[Tauri: annotation overlay window opens with screenshot displayed]
        ↓
[User annotates: draw (canvas), type (sidebar), voice (Whisper)]
        ↓
[User hits Enter]
        ↓
[Rust: drawing rasterized onto PNG]
[Rust: voice transcript retrieved from Whisper]
[Rust: metadata serialized to structured text]
        ↓
[Rust: clipboard payload assembled: PNG + text block]
        ↓
[Tauri clipboard plugin: write to system clipboard]
        ↓
[User pastes into any LLM]
```

### 7.3 Commit History (as of April 11, 2026 — `main` branch)

| Commit | Description |
|---|---|
| `5ae0402` | Tauri v2 scaffold: Vite + React + TypeScript + Rust backend, system tray, global shortcut (`Cmd+Shift+C`), clipboard/dialog/hotkey plugins |
| `9a7c1d8` | Annotation overlay UI with developer personality, earthy rebrand design integrated |
| Inherited | PRD, Whisper transcription setup, credit-based consumption model |

### 7.4 Current Branch Status (`initial-build-out`)

**Completed (inherited from `main`):**
- Tauri v2 scaffold with system tray and global hotkey
- Annotation overlay UI (React/TypeScript) — visual design complete
- Rust backend modules: metadata capture skeleton, screen capture API hooks
- Whisper integration setup (transcription pipeline initialized)
- Credit-based consumption model (UI layer)
- Earthy rebrand design applied to overlay

**Pending (critical path for v1.0):**
- Functional region-selection crosshair (currently UI-only placeholder)
- Drawing tool implementations (pen, rectangle, arrow, circle are rendered but not functional)
- Whisper model integration end-to-end (pipeline wired but not fully connected)
- Browser metadata capture via macOS Accessibility API
- Windows platform equivalents (UI Automation for metadata, Win32 for capture)
- Settings panel
- Homebrew formula and Windows installer pipeline

---

## 8. UI/UX Specification

### 8.1 Annotation Overlay — Layout

The overlay opens as a full-application window post-capture, divided into two zones:

**Left Zone — Capture Canvas (primary)**
- Screenshot displayed at native captured size
- Drawing canvas layer rendered on top (transparent, interactive)
- Toolbar anchored to the top-left

**Right Zone — Context Sidebar (fixed width ~260px)**
- Metadata display: app, window title, resolution, OS (read-only, auto-populated)
- AI context input: `// what should your AI do with this?` (multi-line text area)
- Voice recording button with waveform feedback
- Credit counter: `this_capture: 3 credits` / `session_total: 47` (in Amber)
- Primary CTA: `Copy to Clipboard | pbcopy` (teal button, full width)

**Top Bar — Toolbar**
- Capture dimensions and scale factor displayed: `1200x800 | 2x | region`
- Drawing tools (left-to-right): Pen, Rectangle, Arrow, Circle, Text
- Color picker (defaults to Amber `#d4882a`)
- Undo / Redo

### 8.2 Design System — Earthy Rebrand

Colors are pulled directly from the VisionPipe camera logo. The aesthetic is inspired by PostHog: warm, approachable, technically precise without feeling cold.

**Color Palette**

| Token | Hex | Usage |
|---|---|---|
| Teal | `#2e8b7a` | CTA buttons, pipe separators, active tool highlight, interactive states |
| Amber | `#d4882a` | Drawing color default, credit counter accent, annotation highlights |
| Cream | `#f5f0e8` | Headings, button text — warm off-white |
| Forest | `#1a2a20` | Primary background (replaces navy/indigo) |
| Deep Forest | `#141e18` | Secondary background, sidebar panels |
| Burnt Sienna | `#c0462a` | Destructive actions, error states |

**Typography**

| Role | Typeface |
|---|---|
| UI / body | IBM Plex Sans |
| Monospace / code / metadata | Source Code Pro |

**Logo Usage**
- 32px camera icon anchored in sidebar header
- Vintage-style retro camera with teal/orange color scheme on dark background
- Logo reinforces the earthy brand identity at every interaction point

---

## 9. Platform Requirements

### 9.1 macOS

| Requirement | Specification |
|---|---|
| Minimum OS | macOS 13 (Ventura) |
| Distribution | Homebrew: `brew install visionpipe`; direct DMG download from Releases |
| Screen capture | CoreGraphics API |
| Metadata | macOS Accessibility API for window/browser context |
| Hotkey | `Cmd+Shift+V` (configurable) |
| Permissions required | Screen Recording, Accessibility, Microphone |

### 9.2 Windows

| Requirement | Specification |
|---|---|
| Minimum OS | Windows 10 (build 19041+) |
| Distribution | MSI / NSIS installer from Releases |
| Screen capture | Win32 GDI / DXGI |
| Metadata | Windows UI Automation for window/browser context |
| Hotkey | `Ctrl+Shift+V` (configurable) |
| Permissions required | Microphone access via Windows permission prompt |

---

## 10. Licensing Model

VisionPipe uses a **Revenue-Trigger License** (PolyForm Noncommercial 1.0.0). The payment obligation is triggered by revenue, not intent.

| Use Case | License |
|---|---|
| Personal project, hobby, learning | **Free** |
| Open source contribution, non-profit, educational | **Free** |
| Business or company use | **Paid** |
| Revenue-generating products or workflows | **Paid** |
| Client work or consulting (billed output) | **Paid** |
| Commercial websites and applications | **Paid** |

This is a source-available model (not OSI-certified open source). The code is visible and forkable. Commercial licensing terms are negotiated directly.

---

## 11. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Hotkey-to-overlay in <200ms |
| Performance | Clipboard write after Enter <500ms (excluding Whisper transcription time) |
| Performance | Minimal idle CPU/memory — Tauri (not Electron) is a hard requirement |
| Privacy | Voice transcription is on-device via Whisper — no audio leaves the machine |
| Privacy | No telemetry, no accounts, no API keys required for core functionality |
| Security | No persistent screen recording — capture is ephemeral and clipboard-only |
| Reliability | Global hotkey must remain registered after system sleep/wake cycle |
| Accessibility | Keyboard-navigable overlay (Tab order, Enter to submit, Escape to cancel) |
| Compatibility | LLM-agnostic — clipboard payload works with any model that accepts images |

---

## 12. Success Metrics

**v1.0 Launch (within 90 days)**

| Metric | Target |
|---|---|
| GitHub stars | 1,000 within 30 days of launch |
| Homebrew installs (macOS) | 500 in first 30 days |
| Windows installer downloads | 300 in first 30 days |
| Annotation usage rate | >60% of sessions include at least one annotation mode |
| Capture-to-clipboard latency (p95) | <700ms total |

**Ongoing Health**

| Metric | Target |
|---|---|
| Crash-free session rate | >99.5% |
| Voice transcription accuracy | >92% WER on developer terminology |
| Commercial license conversion | >5% of active business users |

---

## 13. Open Questions

| Question | Owner | Target Resolution |
|---|---|---|
| Should credit model remain visible in v1.0 or be deferred to commercial tier? | Product | Before v1.0 RC |
| Whisper model size default (tiny vs. base vs. small) — latency vs. accuracy tradeoff | Engineering | During `initial-build-out` |
| Windows browser metadata: Chrome/Edge support via UI Automation vs. browser extension? | Engineering | v1.1 scoping |
| MCP server implementation: bundle with app or ship as separate package? | Product | v1.1 scoping |
| Domain registration: `visionpipe.com` and `visionpipe.ai` — current status? | Founder | Immediate |

---

*Built with the Unix philosophy: do one thing, do it well.*
