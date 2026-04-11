# Contributing to VisionPipe

Thanks for your interest in contributing! Here's how to get started.

## Getting started

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/visionpipe.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b my-feature`
5. Run the dev server: `pnpm tauri dev`

## Development

- **Frontend** (React + Vite): Edit files in `src/`
- **Backend** (Rust): Edit files in `src-tauri/src/`
- Hot reload works for the frontend; Rust changes require a rebuild

## Pull requests

- Keep PRs focused on a single change
- Include a description of what changed and why
- Make sure `pnpm tauri build` completes without errors
- Add screenshots for UI changes

## Reporting issues

Open an issue on GitHub with:
- OS and version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable

## Code of conduct

Be kind and constructive. We're all here to build something useful.
