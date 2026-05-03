# VisionPipe — project-specific instructions

These instructions apply to **any Claude session working in this project**. They do not apply to other projects.

## Progress logging on every commit

For **every commit** on a development branch in this project, the corresponding progress log in `prd/` must be updated. The log gives a future Claude session enough context to ramp up on the branch without re-reading every commit.

### Workflow

1. **Find the log file.** Run `git rev-parse --abbrev-ref HEAD` to get the current branch name. Look for `prd/<branch-name>.md`.
2. **If the log file exists**, read its most recent entry to understand what was last documented, then prepend a new dated entry at the top.
3. **If the log file does not exist**, create it with the branch's name and add the first entry. Use the same `# Branch Progress: <branch-name>` header that other branch logs use.
4. **Stage the log file alongside your code changes** so the commit includes both. Do not split the doc update into a separate commit — code and log update belong in the same commit.
5. **After committing, tell the user explicitly: "I committed and updated `prd/<branch-name>.md`."** This is non-negotiable — the user needs the confirmation to know the log is current.

### Version bump on every build

**Every release build bumps the version.** This is non-negotiable — `./scripts/release.sh` does it automatically. The minimum bump is **patch** (`+0.0.1`), even for a single-character fix. There is no such thing as "rebuild without bumping."

Choose the bump size based on the magnitude of the change. The script defaults to **patch**; specify `--bump minor` or `--bump major` to override (or set it in the frontmatter of `scripts/.release-notes.md`).

**Patch (`+0.0.1` — e.g. `0.1.0 → 0.1.1`)** — the default. Use for:
- Bug fixes
- Copy / wording tweaks
- Style adjustments (color, spacing, font size)
- Small UI nudges (a single layout tweak)
- Tweaks to log messages, comments, or internal naming
- Re-bundling without code changes (e.g. retrying a build that failed)

**Minor (`+0.1.0` — e.g. `0.1.5 → 0.2.0`)** — meaningful additions or behavior changes. Use for:
- New features (a new screen, a new keyboard shortcut, a new CLI flag)
- A new UI flow or user-facing component
- Refactors that change observable behavior
- Adding a new dependency or system integration
- Changes that warrant a paragraph in the release notes

**Major (`+1.0.0` — e.g. `0.9.0 → 1.0.0`)** — breaking or milestone. Use for:
- The first production-stable release
- Removing or renaming a public API
- A fundamental rewrite or architecture change
- Bundle-identifier changes
- Any release a user would describe as "the new version"

The script keeps the version in sync across **three files**: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. Don't edit them by hand.

The new version is written into the progress log entry's heading — e.g. `## Progress Update as of 2026-05-02 17:30 PDT — v0.1.1`. This makes the version-to-commit mapping trivially findable.

### Entry format

Use this exact format. Newest entries go at the top of the file.

```
## Progress Update as of [YYYY-MM-DD HH:MM Pacific] — v[X.Y.Z]
*(Most recent updates at top)*

### Summary of changes since last update
[One paragraph maximum summarizing what's changed since the previous entry.]

### Detail of changes made:
- [Bullet points with enough context for a future LLM to ramp up quickly on the branch and the work in this commit. Reference file paths and commit hashes where useful.]

### Potential concerns to address:
- [Bullet points calling out anything in the codebase that is or could become an issue as work continues.]

---
```

Use Pacific time (PDT in summer, PST in winter) for the timestamp. Round to the nearest 15 minutes.

### Backstops

These hooks exist to remind you, not to enforce — the expectation is that you follow the workflow above without needing the prompts:

- **`.git/hooks/pre-commit`** prints a warning if `prd/<branch-name>.md` exists but is not staged in the current commit.
- **`.claude/settings.json`** has a `PostToolUse` hook on `Bash(git commit *)` that injects a reminder if you commit through Claude.

## Releasing a signed + notarized build

Use **`./scripts/release.sh`** for any release build. Do not run `pnpm tauri build` directly for releases — Tauri's built-in notarization polls Apple with a short timeout that often fires before Apple responds, even when the submission is ultimately accepted. The script uses `xcrun notarytool submit --wait` (no client-side timeout) instead.

What the script does:
1. Builds `.app` via Tauri (with signing, but with `APPLE_ID`/`APPLE_PASSWORD` temporarily unset so Tauri skips its own notarization)
2. Notarizes and staples the `.app` (`ditto` + `notarytool submit --wait` + `stapler staple`)
3. Re-bundles the stapled `.app` into a polished `.dmg` via `create-dmg` (drag-to-Applications layout)
4. Signs, notarizes, and staples the `.dmg`
5. Verifies with `spctl -a -t open --context context:primary-signature -vv`
6. Copies the result into `../visionpipe-web/public/downloads/` as both `VisionPipe-<version>.dmg` (versioned) and `VisionPipe.dmg` (latest)

Prerequisites (verify before running):
- `.env.local` contains `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD` (app-specific), and `APPLE_SIGNING_IDENTITY`
- Developer ID Application cert is in keychain (`security find-identity -v -p codesigning`)
- Apple Developer ID G2 intermediate CA is in keychain — without it, `codesign` reports "unable to build chain to self-signed root". Download from `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer` if missing.
- `create-dmg` is installed: `brew install create-dmg`

After the script finishes, deploy the new download:

```
cd ../visionpipe-web
git add public/downloads
git commit -m "Release v<version>"
git push
```

Currently builds Apple Silicon (`aarch64`) only. For a Universal binary (Intel + Apple Silicon), pass `--target universal-apple-darwin` to the `pnpm tauri build` line in the script.
