# VisionPipe

Screenshot to AI in one keystroke. Capture any screen region, annotate it, and pipe it directly into Claude Code or any AI assistant.

## How it works

1. Press `Cmd+Shift+C` (Mac) or `Ctrl+Shift+C` (Windows)
2. Drag to select a screen region
3. Type your question or context
4. Paste into Claude Code with `Cmd+V`

## Download

Get the latest release from [visionpipe.dev](https://visionpipe.dev) or from the [Releases](https://github.com/VisionPipe/visionpipe/releases) page.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://rustup.rs/) (latest stable)
- [pnpm](https://pnpm.io/) (v10+)
- Platform-specific dependencies for Tauri: [see Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

### Project structure

```
visionpipe/
├── src/              # Frontend UI (React + Vite)
│   ├── App.tsx       # Annotation popover
│   ├── main.tsx      # Entry point
│   └── styles.css    # Tailwind styles
├── src-tauri/        # Rust backend
│   └── src/
│       ├── main.rs   # Entry point
│       ├── lib.rs    # App setup, hotkeys, tray
│       └── capture.rs # Screen capture logic
├── index.html
├── package.json
└── vite.config.ts
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
