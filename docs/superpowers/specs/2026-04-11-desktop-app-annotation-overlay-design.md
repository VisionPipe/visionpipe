# VisionPipe Desktop App — Annotation Overlay Design

## Overview

Design for the annotation overlay window that appears after a user captures a screen region. This is the core UI of VisionPipe — the moment between capture and clipboard.

## Layout: Split Panel

The overlay is a borderless, dark-themed window with two zones:

### Left: Screenshot + Drawing Tools
- **Drawing toolbar** pinned across the top edge — pen, rectangle, arrow, circle, text label, color picker, undo/redo
- **Capture metadata** displayed in the toolbar's right side in monospace: `1200x800 | 2x | region` (dimensions, scale, capture method separated by blue pipe characters)
- **Screenshot** displayed at captured size in the main area, with a drawing canvas layered on top for markup

### Right: Sidebar (250px)
Top to bottom:

1. **Logo**: Camera icon (28px) + `Vision|Pipe` wordmark — the `|` is a monospace pipe character in brand blue (#3b82f6), replacing the space between the words
2. **Metadata block**: Monospace key-value pairs in a dark inset panel — `app = Visual Studio Code`, `win = App.tsx`, `res = 2560x1600 @ 2x`, `os = macOS 15.3.2`. Uses blue `=` signs.
3. **Context label**: `> context` styled like a shell prompt
4. **Text input**: Textarea with placeholder `// what should your AI do with this?`
5. **Voice button**: Microphone icon + "Record voice note" — triggers on-device Whisper transcription
6. **Transcript area**: Green-tinted panel labeled `stdout` (monospace) showing real-time transcription text
7. **Credits**: `this_capture` on left, credit count on right. Below: `session_total = 47`
8. **Action button**: "Copy to Clipboard | pbcopy" — blue button with the `|` pipe and `pbcopy` in monospace as a developer wink
9. **Keyboard hint**: `↵ pipe it | esc cancel`

## Design Language: Subtle Dev Flavor

The app is a polished, modern desktop app — not a terminal emulator. Developer culture shows up in specific, intentional ways:

### The `|` Pipe Motif
- The pipe character is the brand separator: `Vision|Pipe`
- Used as visual separators in the toolbar metadata: `1200x800 | 2x | region`
- Used in the action button: `Copy to Clipboard | pbcopy`
- Used in keyboard hints: `↵ pipe it | esc cancel`

### Monospace Where Data Lives
- Metadata block (app, window, resolution, OS)
- Capture dimensions in toolbar
- Credit counters
- Labels like `> context`, `stdout`, `this_capture`, `session_total`

### Developer-Friendly Copy
- Textarea placeholder: `// what should your AI do with this?` (code comment syntax)
- Voice transcript label: `stdout` (Unix stream name)
- Button text includes `pbcopy` (macOS clipboard command)
- Keyboard hint says "pipe it" not "submit"

### What Stays Clean (Not Dev-Themed)
- The textarea itself — normal proportional font for readability
- The drawing tools — standard icon-based toolbar
- The voice recording UI — standard mic button
- Window chrome — standard borderless dark theme

## Color Palette

| Token | Hex | Usage |
|---|---|---|
| brand-blue | #3b82f6 | Pipe chars, active tools, CTA button, `=` signs |
| bg-deep | #12122a | Sidebar background |
| bg-dark | #1a1a2e | Toolbar, drawing area |
| bg-inset | #0d0d1a | Metadata block background |
| bg-input | #1a1a30 | Text input, voice button, credits |
| bg-tool | #2a2a3e | Inactive tool buttons |
| border | #333 | All borders |
| text-primary | #fff | Headings, logo |
| text-secondary | #ccc | Input text |
| text-muted | #888 | Labels |
| text-dim | #555 | Metadata values, hints |
| text-ghost | #444 | Placeholders, keyboard hints |
| accent-red | #ef4444 | Default annotation color |
| accent-green | #4ade80 | Voice recording indicator, transcript |

## Typography

- **UI text**: System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
- **Monospace**: `'SF Mono', 'Fira Code', 'JetBrains Mono', monospace` — for metadata, labels, credits, hints
- **Logo wordmark**: System font for "Vision", monospace for `|`, system font for "Pipe"

## Window Behavior

- **Size**: Dynamic based on screenshot dimensions + 250px sidebar. Min width 700px.
- **Position**: Centered on the screen where capture occurred
- **Appearance**: Borderless, no title bar, transparent background with dark panels
- **Dismiss**: Escape key or clicking outside
- **Submit**: Enter key or "Copy to Clipboard" button

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Enter | Copy payload to clipboard and close |
| Escape | Cancel and close |
| Tab | Cycle between text input and drawing canvas |
| Cmd+Z / Ctrl+Z | Undo drawing stroke |
| Cmd+Shift+Z / Ctrl+Y | Redo drawing stroke |

## Clipboard Payload (Composite Image Mode)

A single PNG containing:
1. The screenshot with any drawing annotations baked in
2. Below: a rendered panel with the annotation text and all metadata in structured format

This is the default mode. Split Clipboard and Two-Step Paste are future options.

## Scope

This design covers **only the annotation overlay** — the window that appears after region capture. It does not cover:
- Region selection crosshair (separate design needed)
- System tray menu
- Settings panel
- First-launch permission flow

## Tech Stack

- **Frontend**: React 19, TypeScript 5, Tailwind CSS 4, Vite 6
- **Backend**: Tauri v2, Rust
- **Current state**: Basic scaffold exists — hotkey triggers event, simple text-only form appears, text copied to clipboard. Screenshot capture function exists but image is not displayed in UI. Metadata capture, drawing, and voice are not implemented.
