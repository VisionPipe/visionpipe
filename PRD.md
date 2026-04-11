# VisionPipe — Product Requirements Document

## Overview

VisionPipe is a cross-platform desktop utility that captures screen regions and pipes them — along with annotations and rich contextual metadata — directly into any LLM via the clipboard. It is the missing bridge between what a developer sees and what their AI understands.

## Problem

Developers working with LLMs constantly need to share visual context. Current workflow:
1. Take a screenshot with a generic tool
2. Save it somewhere
3. Upload or paste it into the LLM
4. Type a separate description of what they want
5. The LLM lacks context about the environment (what app, what URL, what resolution)

This is slow, lossy, and disconnected. The screenshot arrives without intent or context.

## Solution

VisionPipe collapses the entire workflow into one keystroke:
1. Hotkey triggers region capture
2. Annotation overlay appears (voice, text, drawing)
3. Enter bundles everything to clipboard
4. Paste into any LLM

The clipboard payload includes: the image, all annotations, and structured metadata about the capture environment.

---

## Product 1: Tauri Desktop App (Open Source)

**Repo:** https://github.com/VisionPipe/visionpipe
**License:** Free for personal use, commercial license for business
**Stack:** Tauri v2, Rust, React, Vite, Tailwind CSS

### Core Features (v0.1 — MVP)

#### 1. Global Hotkey
- Default: `Cmd+Shift+C` (Mac), `Ctrl+Shift+C` (Windows)
- Configurable via settings
- Works from any application
- Should not conflict with common system shortcuts

#### 2. Region Capture
- Crosshair overlay appears on hotkey press
- Click and drag to select region
- ESC to cancel
- Visual feedback showing selected area dimensions
- Support for multi-monitor setups (capture from any screen)

#### 3. Annotation Overlay
After region is selected, a floating panel appears with three modes:

**Text Input (default)**
- Auto-focused text field
- Enter to submit, ESC to cancel
- Placeholder: "What should your AI do with this?"

**Voice Input**
- Microphone button to start/stop recording
- On-device transcription via Whisper (no network required)
- Transcript shown in text field for editing before submit
- Visual waveform indicator while recording

**Drawing Markup**
- Lightweight canvas overlay on the captured image
- Tools: freehand pen, arrow, rectangle, circle, text label
- Color picker (default: red)
- Undo/redo
- Drawing is baked into the final image

All three modes can be combined in a single capture.

#### 4. Clipboard Payload
Three clipboard modes (configurable in settings):

**Default: Composite Image**
A single PNG containing the screenshot (with any drawings baked in), plus a rendered panel below with the annotation text and metadata. One image, one paste, works with every LLM.

```
┌─────────────────────────────┐
│                             │
│   [Screenshot with          │
│    drawings baked in]       │
│                             │
├─────────────────────────────┤
│ Context:                    │
│ Why is this button          │
│ misaligned in dark mode?    │
│                             │
│ App: Visual Studio Code     │
│ Window: visionpipe — App.tsx│
│ Screen: 2560x1600 @ 2x     │
│ OS: macOS 15.3.2            │
│ 2026-04-11T14:32:01Z        │
│ VisionPipe v0.1.0           │
└─────────────────────────────┘
```

**Alternative: Split Clipboard**
Image and text placed as separate clipboard types. Image-aware apps receive the image; text fields receive the annotation + metadata as structured text.

**Alternative: Two-Step Paste**
First `Cmd+V` pastes the image. Second `Cmd+V` pastes the annotation + metadata text. VisionPipe manages a two-item clipboard queue.

#### 5. System Tray
- Menu bar icon (Mac) / system tray icon (Windows)
- Click to open settings
- Shows capture history (last 10)
- Quit option

#### 6. Settings
- Hotkey configuration (default: `Cmd+Shift+C` / `Ctrl+Shift+C`)
- Clipboard mode: Composite Image (default), Split Clipboard, Two-Step Paste
- Default annotation mode (text/voice/draw)
- Metadata: toggle which fields to include
- Image format (PNG/JPEG) and quality
- Startup on login toggle
- Check for updates

### Metadata Capture (v0.1)

**Must have:**
- Capture region coordinates and dimensions
- Screen resolution and scale factor
- Active application name and window title
- Timestamp (ISO 8601)
- OS name and version
- Capture method (region/fullscreen/window)
- VisionPipe version

**v0.2+:**
- Monitor name and index
- Color profile
- Application bundle ID / process ID
- Window state (windowed/maximized/fullscreen)
- Browser URL and page title (via Accessibility API)
- Cursor position and type
- Viewport dimensions

### Technical Requirements

#### Performance
- Hotkey to overlay: <100ms
- Capture to clipboard: <500ms (excluding annotation time)
- Memory footprint: <50MB idle
- CPU: near-zero when idle

#### Platform Support
- macOS 12+ (Monterey and later)
- Windows 10/11
- Linux: deferred to v0.3+

#### Permissions
- Screen Recording (macOS)
- Accessibility (macOS, for window/browser metadata)
- Microphone (for voice annotation)
- App should guide user through permission grants on first launch

#### Distribution
- macOS: `.dmg` installer + Homebrew cask
- Windows: `.msi` installer
- Auto-updater via Tauri's built-in updater
- GitHub Releases for all binaries
- Code signing: Apple Developer ID + Windows Authenticode

---

## Product 2: Website (Private)

**Repo:** Private (TBD)
**Hosting:** Vercel
**Stack:** Next.js, React, Tailwind CSS
**Domain:** visionpipe.dev (or similar)

### Pages

#### Landing Page (/)
- Hero: headline, subheadline, demo GIF/video
- "Download for Mac" / "Download for Windows" buttons (link to GitHub Releases or direct download)
- How it works (3-4 step visual)
- Feature highlights with screenshots
- Metadata showcase (what gets captured)
- Comparison table vs other tools
- Open source callout + GitHub link
- Footer with links

#### Pricing (/pricing)
- Personal use: Free
- Commercial license: pricing TBD
- FAQ about what counts as commercial use

#### Docs (/docs)
- Installation guide
- Getting started
- Configuration
- Metadata reference
- Troubleshooting
- API reference (future)

#### Blog (/blog) — future
- Release announcements
- Use case stories

### Technical Requirements
- Static generation where possible (fast loads, good SEO)
- Analytics (Plausible or similar, privacy-respecting)
- Download links that auto-detect OS
- Responsive design (mobile-friendly, even though the app is desktop-only)

---

## Milestones

### M1: MVP (v0.1)
- [ ] Region capture with crosshair overlay
- [ ] Text annotation input
- [ ] Basic metadata (app, window, screen, timestamp, OS)
- [ ] Clipboard payload (image + structured text)
- [ ] System tray with quit
- [ ] macOS build (.dmg)
- [ ] Landing page on Vercel

### M2: Multi-Modal (v0.2)
- [ ] Voice annotation with Whisper transcription
- [ ] Drawing/markup overlay
- [ ] Settings panel
- [ ] Windows build (.msi)
- [ ] Extended metadata (browser URL, cursor, monitor name)
- [ ] Capture history (last 10)
- [ ] Auto-updater

### M3: Polish (v0.3)
- [ ] Custom hotkey configuration
- [ ] Homebrew cask
- [ ] Linux support
- [ ] Docs site
- [ ] Structured JSON metadata export
- [ ] API for programmatic access

---

## Decisions

### Hotkey
- **Default:** `Cmd+Shift+C` (Mac), `Ctrl+Shift+C` (Windows)
- Configurable in settings
- Minor conflict: `Cmd+Shift+C` is "Copy as HTML" in Chrome DevTools (only when DevTools is focused). Acceptable tradeoff — configurable if it bothers anyone.

### Clipboard Format
Three modes, selectable in settings:

| Mode | Description | Default |
|---|---|---|
| **Composite Image** | Screenshot + drawings + annotation text + metadata baked into a single PNG. One paste, works everywhere. | **Yes (default)** |
| **Split Clipboard** | Image and text placed as separate clipboard types. Image-aware apps get the image; text fields get the annotation + metadata. | No |
| **Two-Step Paste** | First `Cmd+V` pastes the image, second `Cmd+V` pastes the text/metadata. VisionPipe manages a two-item clipboard queue. | No |

Composite image is the default because it works with every LLM and every app with a single paste. Power users who want more control can switch to split or two-step.

### Drawing Persistence
Drawings are baked into the PNG. VisionPipe is a capture-and-go tool, not an editor. If someone wants to re-annotate, they take a new capture.

### Whisper Model
Ship with **tiny** (39MB) for fast, small downloads. Allow users to download larger models (base, small) from settings for better accuracy.

## Open Questions

1. **Commercial licensing:** What pricing model? Per-seat? Per-company? One-time vs subscription?
2. **Composite image layout:** Where should annotation text and metadata render on the composite image? Below the screenshot as a dark panel? Side panel? Overlaid with transparency?
