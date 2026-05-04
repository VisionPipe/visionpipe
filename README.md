# Vision|Pipe

## Give your LLM eyes. `screenshot | llm` is now a reality.

Vision|Pipe is a lightweight open source Mac and Windows utility that captures your screen and pipes it — along with your voice, text or visual annotations plus rich contextual metadata — directly into any LLM. GPT-4, Gemini, Claude / Claude Code, OpenAI Codex, or any AI that accepts images. Capture, annotate, and paste full visual context in one keystroke.

**Built for developers who think in pipes** 
- Free for personal use.
- DM us on Twitter/X at [Vision_Pipe](https://x.com/vision_pipe).
  
---

## Why Vision|Pipe

**The Problem:** You're working with an AI and need to show it what's on your screen. You describe it in words. It misunderstands. You describe again. Repeat.

**The Solution:** Vision|Pipe skips the description. Capture the screen. Annotate however feels natural — speak it, type it, or draw it. Paste the full context — image, annotation, and metadata — into your LLM in one action.

Local-first. Sessions live on disk in `~/Pictures/VisionPipe/`. Real-time voice transcription is opt-in and cloud-routed via Deepgram (`vp-edge` proxy); on-device WhisperKit is on the v0.3 roadmap for users who prefer to keep audio fully local.

---

## How It Works

1. Press your hotkey (default `Cmd+Shift+C` on Mac; configurable in Settings)
2. Select the area of your screen to capture
3. The session window opens with your first card. Talk naturally as you work — Vision|Pipe transcribes in real time.
4. Take more screenshots with the "+" button (or your configured hotkey); each becomes its own card with its own segment of narration. Edit captions inline.
5. Hit "📋 Copy & Send" — a structured markdown bundle (image references + transcript + metadata) is copied to clipboard.
6. Paste directly into Claude Code, GPT-4, Gemini, or any LLM that accepts images.

---

## Multi-Modal Annotation

Vision|Pipe captures what you *mean*, not just what you see.

### Speak It

Record continuous voice narration alongside your screenshots — narrate naturally as you take captures within a session, and Vision|Pipe transcribes in real time.

**v0.2 (current):** Real-time transcription via Deepgram Nova-3, routed through Vision|Pipe's `vp-edge` proxy. **Audio is sent off-device for transcription.** No account or API key needed; per-install rate limits keep usage capped at 60 minutes/day during the free trial. Audio is always preserved locally as `audio-master.webm` even when offline.

**v0.3 (planned):** On-device WhisperKit will be available as an opt-in for users who prefer to keep audio fully local. Cloud-based real-time transcription will remain the default for the lowest-friction experience.

```
"This dropdown is rendering below the viewport on Safari — why?"
```

### Type It
Add a written comment at the moment of capture. Your intent travels with the image.

```
Why is this button misaligned in dark mode?
```

### Draw It (planned — v0.3)
Circle the problem. Highlight the element. Draw an arrow. A lightweight markup layer is on the roadmap — for now, voice and text annotation cover most cases.

Voice and text combine in the markdown bundle today. Drawing/markup joins in v0.3.

---

## Rich Metadata Capture

Vision|Pipe does not just send a screenshot. It sends the full context of *where* and *what* the image was captured from — automatically appended to every clipboard payload. This gives your LLM the environmental context it needs to give accurate, targeted answers.

### Spatial & Display
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

### Window & Application
| Field | Example |
|---|---|
| Active application name | `Visual Studio Code` |
| Application bundle ID | `com.microsoft.VSCode` |
| Window title | `visionpipe — README.md` |
| Window position & size | `(100, 50) — 1440 x 900` |
| Window state | `Windowed / Maximized / Fullscreen` |
| Process ID | `PID 4821` |

### Browser Context *(when a browser is the active window)*
| Field | Example |
|---|---|
| Browser name & version | `Chrome 124.0` |
| Active tab URL | `https://github.com/VisionPipe/visionpipe` |
| Page title | `VisionPipe — GitHub` |
| Viewport dimensions | `1440 x 789` |

> Browser metadata is captured via macOS Accessibility API. Windows UI Automation support is on the roadmap. No browser extension required.

### System
| Field | Example |
|---|---|
| Timestamp (ISO 8601) | `2026-04-11T14:32:01Z` |
| Operating system | `macOS 15.3.2` |
| Hostname | `colins-macbook-pro` |
| Active user | `colin` |
| Screen count | `2` |

### Cursor & Input
| Field | Example |
|---|---|
| Cursor position at capture | `x: 540, y: 320` |
| Cursor type | `Pointer / Text / Crosshair` |

### Capture Metadata
| Field | Example |
|---|---|
| Capture method | `Region / Full Screen / Window` |
| Annotation type(s) used | `Voice + Text` |
| Image format | `PNG` |
| Vision\|Pipe version | `0.3.3` |

All metadata is included in the markdown clipboard payload as a structured `**Context:**` block beneath each screenshot, giving your LLM the full picture — literally and contextually.

---

## Why Not Just Use a Screenshot Tool?

Existing tools — Loom, Zight, Snagit, CleanShot — were designed to share screenshots **with humans.** They optimize for markup that helps a *person* understand what they're looking at.

Vision|Pipe is designed for a different audience: **your AI.**

The annotation and metadata are captured at the moment of intent — not after, not in a separate window. Your screenshot, context, and environment travel together in one clipboard payload.

> **If Playwright gives your test suite vision, Vision|Pipe gives your LLM vision while you're working with it.**

| Tool | Built For | LLM-Native | Annotate at Capture | Rich Metadata |
|---|---|---|---|---|
| Playwright | Programmatic browser automation | No | No | Partial |
| Zight / CleanShot X | Sharing with humans | No | Post-capture only | No |
| Snagit | Documentation and tutorials | No | Post-capture only | No |
| macOS Screenshot | General capture | No | No | No |
| **Vision|Pipe** | **Piping visual context into LLMs** | **Yes** | **Yes — voice, text, or drawing** | **Yes** |

---

## Installation

### macOS
Download the signed/notarized DMG from [Releases](https://github.com/VisionPipe/visionpipe/releases). Apple Silicon (`aarch64`) only at present; Intel + Universal builds are on the roadmap. A Homebrew formula is also planned.

### Windows (planned)
Windows builds are not yet shipped — see roadmap. The Tauri code base supports cross-compilation; contributions welcome.

---

## Built With

- [Tauri 2](https://tauri.app) — lightweight, secure native app framework
- [Rust](https://www.rust-lang.org) — systems-level metadata capture and performance
- [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org) — frontend
- [Deepgram Nova-3](https://deepgram.com) — real-time voice transcription (cloud, via `vp-edge` proxy)
- [WhisperKit](https://github.com/argmaxinc/WhisperKit) — on-device transcription opt-in (planned, v0.3)

---

## Features

- Lightweight — minimal CPU and memory footprint (Tauri, not Electron)
- Fast — capture in milliseconds
- **Multi-screenshot sessions** — string captures together with continuous narration; one shareable bundle
- **Real-time voice transcription** — talk while you capture; transcripts stream into each card live (Deepgram cloud; on-device WhisperKit planned)
- **Per-segment re-record** — fix any single piece of narration without losing the rest
- **Two view modes** — interleaved (cards + inline narration) or split (cards left, transcript right)
- Rich metadata — spatial, window, browser, system context bundled automatically into the markdown output
- **Markdown output optimized for LLM consumption** — Claude Code, GPT-4, Gemini, etc. read the structured bundle directly; image references resolve via local file paths
- **Offline fallback** — audio always preserved locally even when the transcription proxy is unreachable
- Customizable hotkeys via in-app Settings
- macOS native — Apple Silicon shipping; Windows + Linux on roadmap

---

## License

Vision|Pipe is **free for personal and creative use**. A commercial license is required for business and revenue-generating applications.

### Personal & Creative Use (Free)

You can use Vision|Pipe at no cost for:
- Personal projects and hobby work
- Learning and experimentation
- Open source contributions
- Non-profit and educational use
- Any work that does not generate revenue

### Commercial Use (Paid License Required)

A commercial license is required if Vision|Pipe is used in any workflow, product, or service that generates revenue — directly or indirectly. This includes:
- Use at a business or company
- Building or maintaining revenue-generating products
- Client work and consulting (where you bill for output)
- Commercial websites and applications
- Any context where Vision|Pipe contributes to revenue

**To obtain a commercial license:** DM us on Twitter/X at [Vision_Pipe](https://x.com/vision_pipe) to discuss pricing and terms.

---

## Contributing

We welcome contributions. Here's how:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -am 'Add your feature'`)
4. Push and open a Pull Request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup.

---

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
- [ ] Drawing and markup layer
- [ ] Browser metadata via Accessibility APIs
- [ ] Structured JSON metadata export
- [ ] API for programmatic access

---

## Questions?

Open an issue or reach out on [X](https://x.com/vision_pipe).

---

**Built with the Unix philosophy: do one thing, do it well.**
