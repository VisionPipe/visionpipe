# VisionPipe

## Give your LLM eyes. `screenshot | llm` — now a reality.

VisionPipe is a lightweight open source Mac and Windows utility built with [Tauri](https://tauri.app) that captures your screen and pipes it — along with rich contextual metadata — directly into any LLM. GPT-4, Gemini, Claude, OpenAI Codex, or any AI that accepts images. Capture, annotate, and paste full visual context in one keystroke.

**Built for developers who think in pipes** 
- Free for personal use.
- DM us on Twitter/X at [Vision_Pipe](https://x.com/vision_pipe).
  
---

## Why VisionPipe

**The Problem:** You're working with an AI and need to show it what's on your screen. You describe it in words. It misunderstands. You describe again. Repeat.

**The Solution:** VisionPipe skips the description. Capture the screen. Annotate however feels natural — speak it, type it, or draw it. Paste the full context — image, annotation, and metadata — into your LLM in one action.

No uploads. No integrations. No UI sprawl. Just the Unix philosophy applied to AI vision.

---

## How It Works

1. Press your hotkey (default `Cmd+Shift+V` on Mac, `Ctrl+Shift+V` on Windows)
2. Select the area of your screen to capture
3. Annotate using any combination of voice, text, or drawing
4. Hit Enter — the screenshot, annotation, and metadata are bundled and copied to clipboard
5. Paste directly into GPT-4, Gemini, Claude, OpenAI Codex, or any LLM

---

## Multi-Modal Annotation

VisionPipe captures what you *mean*, not just what you see.

### Speak It
Record a voice note alongside your screenshot. VisionPipe transcribes it automatically and bundles the transcript with the image.

```
"This dropdown is rendering below the viewport on Safari — why?"
```

### Type It
Add a written comment at the moment of capture. Your intent travels with the image.

```
Why is this button misaligned in dark mode?
```

### Draw It
Circle the problem. Highlight the element. Draw an arrow. VisionPipe includes a lightweight markup layer so your LLM knows exactly what to focus on — no words required.

All three modes can be combined. The full context — image, transcript, text, and markup — is bundled into one clipboard payload.

---

## Rich Metadata Capture

VisionPipe does not just send a screenshot. It sends the full context of *where* and *what* the image was captured from — automatically appended to every clipboard payload. This gives your LLM the environmental context it needs to give accurate, targeted answers.

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

> Browser metadata is captured via macOS Accessibility API and Windows UI Automation. No browser extension required.

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
| Annotation type(s) used | `Voice + Drawing` |
| Image format | `PNG` |
| VisionPipe version | `0.1.0` |

All metadata is included in the clipboard payload as structured text appended beneath the annotation, giving your LLM the full picture — literally and contextually.

---

## Why Not Just Use a Screenshot Tool?

Existing tools — Zight, Snagit, CleanShot — were designed to share screenshots **with humans.** They optimize for markup that helps a *person* understand what they're looking at.

VisionPipe is designed for a different audience: **your AI.**

The annotation and metadata are captured at the moment of intent — not after, not in a separate window. Your screenshot, context, and environment travel together in one clipboard payload.

> **If Playwright gives your test suite vision, VisionPipe gives you vision.**

| Tool | Built For | LLM-Native | Annotate at Capture | Rich Metadata |
|---|---|---|---|---|
| Playwright | Programmatic browser automation | No | No | Partial |
| Zight / CleanShot X | Sharing with humans | No | Post-capture only | No |
| Snagit | Documentation and tutorials | No | Post-capture only | No |
| macOS Screenshot | General capture | No | No | No |
| **VisionPipe** | **Piping visual context into LLMs** | **Yes** | **Yes — voice, text, or drawing** | **Yes** |

---

## Installation

### macOS
```bash
brew install visionpipe
```

Or download from [Releases](https://github.com/VisionPipe/visionpipe/releases).

### Windows
Download the installer from [Releases](https://github.com/VisionPipe/visionpipe/releases).

---

## Built With

- [Tauri](https://tauri.app) — lightweight, secure native app framework
- [Rust](https://www.rust-lang.org) — systems-level metadata capture and performance
- [Whisper](https://openai.com/research/whisper) — on-device voice transcription

---

## Features

- Lightweight — minimal CPU and memory footprint (Tauri, not Electron)
- Fast — capture and copy in milliseconds
- Multi-modal annotation — voice, text, and drawing
- Auto-transcription — voice notes converted to text on-device
- Rich metadata — spatial, window, browser, system context bundled automatically so your LLM knows exactly what you're running
- Cross-platform — Mac and Windows
- Keyboard-first — one hotkey does everything
- LLM-agnostic — works with any AI that accepts images

---

## License

VisionPipe is **free for personal and creative use**. A commercial license is required for business and revenue-generating applications.

### Personal & Creative Use (Free)

You can use VisionPipe at no cost for:
- Personal projects and hobby work
- Learning and experimentation
- Open source contributions
- Non-profit and educational use
- Any work that does not generate revenue

### Commercial Use (Paid License Required)

A commercial license is required if VisionPipe is used in any workflow, product, or service that generates revenue — directly or indirectly. This includes:
- Use at a business or company
- Building or maintaining revenue-generating products
- Client work and consulting (where you bill for output)
- Commercial websites and applications
- Any context where VisionPipe contributes to revenue

**To obtain a commercial license:** Contact [your email] to discuss pricing and terms.

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

- [ ] Custom hotkey configuration
- [ ] Voice transcription via on-device Whisper
- [ ] Drawing and markup layer
- [ ] Browser metadata via Accessibility APIs
- [ ] Screenshot history / clipboard manager
- [ ] Linux support
- [ ] Structured JSON metadata export
- [ ] API for programmatic access

---

## Questions?

Open an issue or reach out on [X](https://x.com/vision_pipe).

---

**Built with the Unix philosophy: do one thing, do it well.**
