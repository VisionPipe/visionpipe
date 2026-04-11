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
- Default: `Cmd+Shift+V` (Mac), `Ctrl+Shift+V` (Windows)
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
On submit, the clipboard contains:
- The screenshot image (PNG)
- Structured text block with:
  - User annotation (transcript + typed text)
  - All metadata fields (see Metadata section below)

Format:
```
[Image is on clipboard — paste to include screenshot]

## Context
Why is this button misaligned in dark mode?

## Metadata
- App: Visual Studio Code (com.microsoft.VSCode)
- Window: visionpipe — App.tsx
- Screen: 2560x1600 @ 2x (Display P3)
- Region: 1200x800 from (240, 180)
- OS: macOS 15.3.2
- Timestamp: 2026-04-11T14:32:01Z
- VisionPipe v0.1.0
```

#### 5. System Tray
- Menu bar icon (Mac) / system tray icon (Windows)
- Click to open settings
- Shows capture history (last 10)
- Quit option

#### 6. Settings
- Hotkey configuration
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

## Open Questions

1. **Hotkey conflict:** `Cmd+Shift+V` is "Paste and Match Style" in some apps. Should we default to a different hotkey?
2. **Clipboard format:** Should the image and text be separate clipboard entries (so pasting in an image-aware app gives the image, pasting in a text field gives the text)? Or bundled?
3. **Commercial licensing:** What pricing model? Per-seat? Per-company? One-time vs subscription?
4. **Whisper model size:** Which Whisper model to bundle? Tiny (39MB) is fast but less accurate. Base (74MB) is better. Small (244MB) might be too large.
5. **Drawing persistence:** Should drawings be baked into the PNG, or sent as a separate SVG overlay?
