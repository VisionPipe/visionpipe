# Vision|Pipe — project-specific instructions

These instructions apply to **any Claude session working in this project**. They do not apply to other projects.

## Project structure

- `src-tauri/` — Rust backend for the Tauri v2 desktop app (audio, speech, capture, metadata, permissions, lib.rs entry)
- `src/` — React + TypeScript frontend (Vite); `App.tsx` holds the onboarding card and capture/annotation flow
- `crates/` — Rust workspace crates (`visionpipe-core` shared library, `visionpipe-mcp` MCP server, `vp-cli` command-line tool)
- `prd/` — product requirements, design docs, and `prd/branch commit updates/<branch>.md` per-branch progress logs
- `docs/superpowers/specs/` — design specs (one per major feature)
- `docs/superpowers/plans/` — implementation plans
- `scripts/release.sh` — full release pipeline (version bump → build → sign → notarize → DMG → GitHub release → brew tap → commit + push)

## Progress logging on every commit

For **every commit** on a development branch, the corresponding progress log in `prd/branch commit updates/<branch-name>.md` must be updated. The log gives a future Claude session enough context to ramp up without re-reading every commit.

### Workflow

1. **Find the log file.** Run `git rev-parse --abbrev-ref HEAD` to get the branch name. Look for `prd/branch commit updates/<branch-name>.md`.
2. **If the log file exists**, read its most recent entry, then prepend a new dated entry at the top.
3. **If the log file does not exist**, create it with `# Branch Progress: <branch-name>` as the header and add the first entry.
4. **Stage the log file alongside your code changes** so the commit includes both. Do not split the doc update into a separate commit.
5. **After committing, tell the user explicitly: "I committed and updated `prd/branch commit updates/<branch-name>.md`."**

### Entry format

```
## Progress Update as of [YYYY-MM-DD HH:MM Pacific] — v[X.Y.Z]
*(Most recent updates at top)*

### Summary of changes since last update
[One paragraph maximum summarizing what's changed since the previous entry.]

### Detail of changes made:
- [Bullet points with enough context for a future LLM to ramp up quickly on the branch. Reference file paths, function names, architectural decisions, and why things were done a certain way.]

### Potential concerns to address:
- [Bullet points calling out anything in the codebase that is or could become an issue.]

---
```

Use Pacific time. Round to the nearest 15 minutes.

### Backstops

- `.git/hooks/pre-commit` prints a warning if the progress log isn't staged.
- `.claude/settings.json` has a PreToolUse `prompt` hook that **blocks** `git commit` if the progress log wasn't updated this session.

## Version bump on every release build

**Every run of `./scripts/release.sh` bumps the version.** This is non-negotiable. The minimum bump is **patch** (`+0.0.1`) — there's no such thing as "rebuild without bumping."

The script keeps `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` in sync. Don't edit version strings by hand.

Default is **patch**; specify `--bump minor` / `--bump major` to override (or set `bump:` in the frontmatter of `scripts/.release-notes.md`).

**Patch (`+0.0.1`)** — bug fixes, copy tweaks, style adjustments, single layout nudges, comment/log changes, retry-the-build builds.

**Minor (`+0.1.0`)** — new features, new flows, new components, behavior changes, new dependencies, anything worth a paragraph in release notes.

**Major (`+1.0.0`)** — first production release (`1.0.0`), removing/renaming a public API, fundamental rewrites, bundle-identifier changes.

The new version goes into the progress-log entry heading: e.g. `## Progress Update as of 2026-05-02 18:10 PDT — v0.2.7`.

## Releasing a signed + notarized build

Use **`./scripts/release.sh`** for any release. Do not run `pnpm tauri build` directly for releases — Tauri's built-in notarization polls Apple with a short timeout that often fires before Apple responds. The script uses `xcrun notarytool submit --wait` instead.

What `release.sh` does on every run:

1. Reads optional `scripts/.release-notes.md` (gitignored; frontmatter `bump: patch|minor|major` overrides the CLI flag).
2. Bumps version across all three files.
3. Builds the `.app` via Tauri (`--bundles app`), then injects privacy usage descriptions into `Info.plist` via `plutil -insert` and re-signs.
4. Notarizes + staples the `.app` (`ditto` + `notarytool submit --wait` + `stapler staple`).
5. Builds a polished `.dmg` via `create-dmg` (drag-to-Applications layout).
6. Signs, notarizes, and staples the `.dmg`.
7. Verifies via `spctl -a -t open --context context:primary-signature -vv`.
8. Copies the `.dmg` into `../visionpipe-web/public/downloads/` as both `VisionPipe-<version>.dmg` (versioned) and `VisionPipe.dmg` (stable "latest" link).
9. Prepends a progress log entry to `prd/branch commit updates/<branch>.md`.
10. `git add + commit "Release v<version>" + git push` in `visionpipe`.
11. Creates a GitHub release on `VisionPipe/visionpipe` with the `.dmg` attached (notes from `.release-notes.md`).
12. Updates the homebrew tap (`VisionPipe/homebrew-visionpipe`) — bumps version + sha256 + bundle-id zap paths, commits + pushes.
13. `git add + commit + push` in `visionpipe-web` (with the new DMG).
14. Clears `.release-notes.md` for next time.

After this, `brew install --cask visionpipe` and the website's "Download for Mac" button serve identical, signed + notarized DMGs.

### Prerequisites (verify before running)

- `.env.local` contains `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD` (app-specific), and `APPLE_SIGNING_IDENTITY`
- Developer ID Application cert is in the keychain (`security find-identity -v -p codesigning`)
- Apple Developer ID G2 intermediate CA is in the keychain (download from `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer` if `codesign` reports "unable to build chain to self-signed root")
- `create-dmg` installed (`brew install create-dmg`)
- `gh` CLI authenticated (`gh auth status` shows you're logged in)

Currently builds Apple Silicon (`aarch64`) only. For a Universal binary, pass `--target universal-apple-darwin` to the `pnpm tauri build` line.

## General guidelines

- Be comprehensive in progress logs — another agent should read it and fully understand branch state.
- Include file paths and function names when referencing changes.
- Note architectural decisions and trade-offs, not just what changed.
- Flag known issues, tech debt, and incomplete features as "Potential concerns".
- After committing, always tell the user you updated the progress log so they know it was done.
