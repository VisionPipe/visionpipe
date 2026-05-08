---
name: VisionPipe release workflow
description: How to cut a release when the user asks — run scripts/release.sh, which handles version bump, build/sign/notarize/DMG, drops both versioned and stable DMGs into visionpipe-web/public/downloads, and commits + pushes in both repos.
type: feedback
originSessionId: 71743ae3-56f9-4d99-83a5-21ed6397d398
---
When the user asks for a release ("ship it", "cut a release", "release this fix", "let's get this out"), run `./scripts/release.sh` from the visionpipe project root. The script is fully automated end-to-end — do NOT do these steps manually.

**Why:** User explicitly asked for a fix-and-release cadence (2026-05-06): "Let's get into a cadence here where you can cut new releases as you fix things." Re-explaining the pipeline every session wastes tokens and risks me missing a step (e.g., forgetting to update the homebrew tap, or pushing to only one of the two repos).

**How to apply:**

1. **Default to PATCH bumps. Always.** Per a 2026-05-06 user correction ("we are incrementing too aggressively, I want more of these to be small changes"). Most releases — even visible UX tweaks, small refactors, small bug fixes — should be patch. Only use `--bump minor` if the user EXPLICITLY says "minor" or describes the change in those terms ("new feature", "ship a feature release"). Use `--bump major` only when the user explicitly says so. When in doubt, ask which bump they want or default to patch.

2. **Optional — write rich release notes first** to `scripts/.release-notes.md` (gitignored). Frontmatter `bump: minor|major` overrides the CLI flag. The body is used for both the progress log entry AND the GitHub release notes. If absent, the script auto-generates a thin entry from the last 10 commits.

3. **Run** `./scripts/release.sh` (or `./scripts/release.sh --bump minor`). It will:
   - Bump version across `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
   - Build `.app` via Tauri, inject privacy usage descriptions into `Info.plist`, re-sign
   - Notarize + staple via `xcrun notarytool submit --wait`
   - Build polished `.dmg` via `create-dmg`, sign + notarize + staple it
   - Verify via `spctl -a -t open --context context:primary-signature -vv`
   - Copy the `.dmg` into `../visionpipe-web/public/downloads/` as **both** `VisionPipe-<version>.dmg` (versioned, archival) AND `VisionPipe.dmg` (stable "latest" link the website Download button points at)
   - Prepend a progress log entry to `prd/branch commit updates/<branch>.md`
   - `git add -A && git commit "Release v<version>" && git push` in **visionpipe**
   - Create a GitHub release on `VisionPipe/visionpipe` with the `.dmg` attached
   - Update the homebrew tap (`VisionPipe/homebrew-visionpipe`): bump version + sha256, commit + push
   - `git commit + push` in **visionpipe-web** (the new DMG)
   - Clear `scripts/.release-notes.md` for the next run

4. **Tell the user the release shipped** with the new version number and confirmation that the website + homebrew + GitHub release are all updated.

**What I CANNOT do solo and must have user-environment ready:**
- `.env.local` must contain `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_SIGNING_IDENTITY`
- Developer ID Application certificate in keychain
- Apple Developer ID G2 intermediate CA in keychain (download: `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer`)
- `create-dmg` installed (`brew install create-dmg`)
- `gh` CLI authenticated (`gh auth status`)
- The script clones `~/.homebrew-visionpipe` if not present (uses HTTPS so that requires git-credential cache or `gh auth setup-git` to push)

If a prerequisite is missing the script fails with a clear error — surface that to the user and ask them to fix the env, then retry.

**Branch caveat:** the script doesn't enforce being on `main`. It commits and pushes whatever branch you're on. If the user wants a release from a feature branch, that's fine — but ask first if it's clear the branch hasn't been merged yet, since releasing off a non-main branch is unusual.

**Authorization:** the user said "cut new releases as you fix things" so for the established cadence I don't need to re-ask each time — but I should still summarize what's in the release ("about to release v0.6.2 with the permission fix and the bundle filename rename, OK?") for non-trivial changes, and skip the confirmation only for one-line patch fixes the user just asked for.
