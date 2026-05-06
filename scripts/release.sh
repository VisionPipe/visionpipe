#!/usr/bin/env bash
# ==============================================================================
# VisionPipe release build script
# ==============================================================================
# Every run bumps the version, builds + signs + notarizes + staples a .dmg,
# copies it into ../visionpipe-web/public/downloads/, prepends an entry to
# prd/branch commit updates/<branch>.md, and git-commits + pushes in both projects.
#
# Usage:
#   ./scripts/release.sh                 # defaults to patch bump
#   ./scripts/release.sh --bump minor    # for new features
#   ./scripts/release.sh --bump major    # for breaking/milestone releases
#
# Optionally write rich release notes first to scripts/.release-notes.md
# (gitignored). Frontmatter `bump: minor` overrides the CLI flag. Body is
# inserted as the log entry. If the file is missing, a minimal entry is
# auto-generated from git log.
#
# Prerequisites:
#   - .env.local with APPLE_ID, APPLE_TEAM_ID, APPLE_PASSWORD, APPLE_SIGNING_IDENTITY
#   - Developer ID Application certificate installed in keychain
#   - Apple Developer ID G2 intermediate CA in keychain
#   - create-dmg installed: brew install create-dmg
# ==============================================================================

set -euo pipefail

# --- config ------------------------------------------------------------------

VOLNAME="VisionPipe"
APP_NAME="VisionPipe.app"
WEB_PROJECT="/Users/drodio/Projects/visionpipe-web"
WEB_DOWNLOADS_RELATIVE="public/downloads"

# --- derived paths -----------------------------------------------------------

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# APP_PATH is resolved AFTER `pnpm tauri build` finishes, because the bundle
# location depends on whether we're in the legacy single-crate layout
# (src-tauri/target/) or the new Cargo workspace (root target/).
APP_PATH=""
WEB_DOWNLOADS="$WEB_PROJECT/$WEB_DOWNLOADS_RELATIVE"
NOTES_FILE="$PROJECT_ROOT/scripts/.release-notes.md"
CURRENT_BRANCH=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD)
PROGRESS_LOG="$PROJECT_ROOT/prd/branch commit updates/${CURRENT_BRANCH}.md"

cd "$PROJECT_ROOT"

# --- helpers -----------------------------------------------------------------

step() { printf '\n\033[1;36m→ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }

# --- parse args --------------------------------------------------------------

BUMP_TYPE="patch"
SKIP_WEB=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump=*)    BUMP_TYPE="${1#*=}"; shift ;;
    --bump)      BUMP_TYPE="${2:-patch}"; shift 2 ;;
    --skip-web)  SKIP_WEB=1; shift ;;
    *)           shift ;;
  esac
done

# --- frontmatter override from .release-notes.md -----------------------------

if [ -f "$NOTES_FILE" ]; then
  FM_BUMP=$(awk '/^bump:[[:space:]]+/ { print $2; exit }' "$NOTES_FILE" || true)
  if [ -n "${FM_BUMP:-}" ]; then
    BUMP_TYPE="$FM_BUMP"
  fi
fi

case "$BUMP_TYPE" in
  patch|minor|major) ;;
  *) fail "Invalid --bump '$BUMP_TYPE' (expected patch, minor, or major)" ;;
esac

# --- preflight: refuse to release into a stale state -------------------------
#
# A previous release attempt (v0.7.0–v0.9.0 sequence on 2026-05-06) silently
# stacked release commits onto a `visionpipe-web` feature branch instead of
# main, leaving the public website at v0.6.1 while everything else moved
# forward. These checks make those failure modes loud and refuse to proceed
# until the operator has fixed them.

step "Preflight checks"

# 1. visionpipe (this repo) — must be on main, working tree clean except for
#    optional `scripts/.release-notes.md`.
VP_BRANCH=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD)
if [ "$VP_BRANCH" != "main" ]; then
  fail "visionpipe is on '$VP_BRANCH', not main. Releases must be cut from main — switch first."
fi
DIRTY=$(git -C "$PROJECT_ROOT" status --porcelain | grep -v "scripts/\.release-notes\.md" || true)
if [ -n "$DIRTY" ]; then
  fail "visionpipe has uncommitted changes. Commit, stash, or discard before releasing:
$DIRTY"
fi

# 2. visionpipe-web — must exist and be on main, otherwise the new DMG commit
#    lands on a feature branch and the public Download button stays stale.
#    Override with --skip-web for hot-fixes while a website rewrite is mid-flight.
[ -d "$WEB_PROJECT" ] || fail "visionpipe-web project not found at $WEB_PROJECT"
if [ "$SKIP_WEB" = "0" ]; then
  WEB_BRANCH=$(git -C "$WEB_PROJECT" rev-parse --abbrev-ref HEAD)
  if [ "$WEB_BRANCH" != "main" ]; then
    fail "visionpipe-web is on '$WEB_BRANCH', not main.
The release script appends DMG commits to whatever branch is checked out, so
running from a feature branch would leave the public website at the old
version. Switch visionpipe-web to main (or merge your branch) and re-run.

If you knowingly need a hotfix that bypasses the website (homebrew + GitHub
release + tap will get the new build, but the visionpipe.ai download button
stays at whatever's on origin/main), re-run with --skip-web."
  fi
else
  echo "  ⚠  --skip-web set: visionpipe-web won't be updated this release."
fi

# 3. gh CLI — required for GitHub release creation later.
gh auth status >/dev/null 2>&1 || fail "gh CLI not authenticated. Run 'gh auth login'."

ok "Preflight passed"

# --- compute new version -----------------------------------------------------

CURRENT_VERSION=$(node -p "require('./package.json').version")
NEW_VERSION=$(node -e "
  const v = '$CURRENT_VERSION'.split('.').map(Number);
  const t = '$BUMP_TYPE';
  if (t === 'major') { v[0]++; v[1] = 0; v[2] = 0; }
  else if (t === 'minor') { v[1]++; v[2] = 0; }
  else { v[2]++; }
  console.log(v.join('.'));
")

step "Bumping version: $CURRENT_VERSION → $NEW_VERSION ($BUMP_TYPE)"

# Update three files in lockstep
sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" \
  package.json && rm package.json.bak
sed -i.bak "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" \
  src-tauri/Cargo.toml && rm src-tauri/Cargo.toml.bak
sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" \
  src-tauri/tauri.conf.json && rm src-tauri/tauri.conf.json.bak

# Verify all three are now the new version
for f in package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json; do
  grep -q "$NEW_VERSION" "$f" || fail "Failed to bump version in $f"
done
ok "Version files updated to $NEW_VERSION"

# Override $VERSION used later in the script with the new value
VERSION="$NEW_VERSION"

# --- prerequisites -----------------------------------------------------------

step "Checking prerequisites"

[ -f .env.local ] || fail ".env.local not found at $PROJECT_ROOT/.env.local"

# shellcheck disable=SC1091
set -a; . ./.env.local; set +a

for var in APPLE_ID APPLE_TEAM_ID APPLE_PASSWORD APPLE_SIGNING_IDENTITY; do
  [ -n "${!var:-}" ] || fail "$var not set in .env.local"
done

command -v create-dmg >/dev/null || fail "create-dmg not installed. Run: brew install create-dmg"
command -v xcrun >/dev/null      || fail "xcrun not found (Xcode Command Line Tools missing?)"
command -v pnpm >/dev/null       || fail "pnpm not found"

security find-identity -v -p codesigning | grep -q "Developer ID Application" \
  || fail "No Developer ID Application identity in keychain. See CLAUDE.md."

VERSION=$(node -p "require('./package.json').version")
echo "  Version:  $VERSION"
echo "  Identity: $APPLE_SIGNING_IDENTITY"
echo "  Apple ID: $APPLE_ID (team $APPLE_TEAM_ID)"

# --- step 1: build .app via Tauri (without Tauri's own notarization) --------

step "Building .app via Tauri (notarization deferred)"

# Hide notarization creds from Tauri so it produces signed-but-not-notarized
# artifacts. We notarize manually below with --wait (no client timeout).
SAVED_APPLE_ID="$APPLE_ID"
SAVED_APPLE_PASSWORD="$APPLE_PASSWORD"
unset APPLE_ID APPLE_PASSWORD

# --bundles app: only build the .app, skip Tauri's own DMG bundling.
# We re-create the DMG with create-dmg below for full control over layout.
pnpm tauri build --bundles app

export APPLE_ID="$SAVED_APPLE_ID"
export APPLE_PASSWORD="$SAVED_APPLE_PASSWORD"

# Resolve APP_PATH now that the build has run. Workspace layout puts the
# bundle at $PROJECT_ROOT/target/...; legacy src-tauri-only layout puts it
# at $PROJECT_ROOT/src-tauri/target/...
if [ -d "$PROJECT_ROOT/target/release/bundle/macos/$APP_NAME" ]; then
  APP_PATH="$PROJECT_ROOT/target/release/bundle/macos/$APP_NAME"
elif [ -d "$PROJECT_ROOT/src-tauri/target/release/bundle/macos/$APP_NAME" ]; then
  APP_PATH="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/$APP_NAME"
else
  fail ".app not found in either target/ or src-tauri/target/"
fi

# Sanity check: the bundled binary's version should match what we just bumped to.
BUNDLE_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "unknown")
if [ "$BUNDLE_VERSION" != "$VERSION" ]; then
  fail "Bundle version $BUNDLE_VERSION at $APP_PATH does not match expected $VERSION — stale build artifact?"
fi
ok ".app built and signed (version $BUNDLE_VERSION at $APP_PATH)"

# Tauri v2 doesn't expose arbitrary Info.plist keys via tauri.conf.json,
# so we inject the macOS privacy usage descriptions post-build. Without
# NSAppleEventsUsageDescription in particular, AEDeterminePermissionToAutomateTarget
# can return false even when the user has granted permission in Settings.
step "Injecting privacy usage descriptions into Info.plist"

INFO_PLIST="$APP_PATH/Contents/Info.plist"

inject_plist_string() {
  local key="$1"
  local value="$2"
  plutil -remove "$key" "$INFO_PLIST" 2>/dev/null || true
  plutil -insert "$key" -string "$value" "$INFO_PLIST"
}

inject_plist_string "NSAppleEventsUsageDescription" \
  "Vision|Pipe uses System Events to read the active application and window title so it can include that context as metadata in your captures."
inject_plist_string "NSScreenCaptureUsageDescription" \
  "Vision|Pipe captures screenshots of the screen region you select so you can annotate them and paste them into any LLM."
inject_plist_string "NSAccessibilityUsageDescription" \
  "Vision|Pipe uses Accessibility access so the ⌘⇧C global keyboard shortcut can trigger captures from anywhere on your Mac."

# Re-sign the .app: modifying Info.plist invalidated Tauri's signature.
step "Re-signing .app after plist modification"
codesign --force --deep --options runtime \
  --entitlements src-tauri/entitlements.plist \
  --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$APP_PATH"
ok ".app re-signed"

# --- step 2: notarize the .app, then staple ---------------------------------

step "Notarizing .app (waiting for Apple — typically 2-10 minutes)"

APP_ZIP="$(mktemp -d)/visionpipe-app.zip"
ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"

xcrun notarytool submit "$APP_ZIP" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_PASSWORD" \
  --wait

xcrun stapler staple "$APP_PATH"
rm -f "$APP_ZIP"
ok ".app notarized and stapled"

# --- step 3: build polished .dmg around the stapled .app --------------------

step "Building polished .dmg with drag-to-Applications layout"

DMG_PATH="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg/${VOLNAME}_${VERSION}_aarch64.dmg"
mkdir -p "$(dirname "$DMG_PATH")"
rm -f "$DMG_PATH"

create-dmg \
  --volname "$VOLNAME" \
  --window-pos 200 120 \
  --window-size 660 400 \
  --icon-size 100 \
  --icon "$APP_NAME" 180 200 \
  --hide-extension "$APP_NAME" \
  --app-drop-link 480 200 \
  "$DMG_PATH" \
  "$APP_PATH"

ok ".dmg built"

# --- step 4: sign the .dmg ---------------------------------------------------

step "Signing .dmg"

codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG_PATH"
ok ".dmg signed"

# --- step 5: notarize and staple the .dmg -----------------------------------

step "Notarizing .dmg (waiting for Apple)"

xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_PASSWORD" \
  --wait

xcrun stapler staple "$DMG_PATH"
ok ".dmg notarized and stapled"

# --- step 6: verify with Gatekeeper -----------------------------------------

step "Verifying with Gatekeeper"

spctl -a -t open --context context:primary-signature -vv "$DMG_PATH"

# --- step 7: copy into visionpipe-web for deploy ----------------------------

step "Copying to visionpipe-web"

[ -d "$WEB_PROJECT" ] || fail "Web project not found at $WEB_PROJECT"

mkdir -p "$WEB_DOWNLOADS"
DEST_VERSIONED="$WEB_DOWNLOADS/${VOLNAME}-${VERSION}.dmg"
DEST_LATEST="$WEB_DOWNLOADS/${VOLNAME}.dmg"

cp "$DMG_PATH" "$DEST_VERSIONED"
cp "$DMG_PATH" "$DEST_LATEST"

ok "Copied to web project"

# --- step 8: prepend new entry to the progress log --------------------------

step "Prepending entry to ${PROGRESS_LOG#$PROJECT_ROOT/}"

# If the log file doesn't exist for this branch yet, create it with the
# standard header. The awk insertion below requires a `---` separator to
# anchor onto, which the header provides.
if [ ! -f "$PROGRESS_LOG" ]; then
  mkdir -p "$(dirname "$PROGRESS_LOG")"
  cat > "$PROGRESS_LOG" <<EOF
# Branch Progress: ${CURRENT_BRANCH}

This document tracks progress on the \`${CURRENT_BRANCH}\` branch of VisionPipe. It is updated with each commit and serves as a context handoff for any future LLM picking up this work.

---

EOF
fi

TIMESTAMP=$(TZ='America/Los_Angeles' date '+%Y-%m-%d %H:%M %Z')

if [ -f "$NOTES_FILE" ]; then
  # Strip frontmatter (everything between the first two --- lines)
  ENTRY_BODY=$(awk '
    /^---$/ { count++; next }
    count >= 2 { print }
  ' "$NOTES_FILE")
else
  # No notes provided — auto-generate from recent commits since last release tag
  COMMIT_LIST=$(git log --pretty=format:"- %s" -n 10 || true)
  ENTRY_BODY="### Summary of changes since last update

Release v${VERSION} (auto-generated entry — no \`scripts/.release-notes.md\` was provided).

### Detail of changes made:

${COMMIT_LIST:-- No recent commits to summarize.}

### Potential concerns to address:

- Auto-generated entry; a human-written summary would be more useful for future LLM context."
fi

# Write the new entry block to a temp file. Going via a file (vs. passing
# a multi-line string to `awk -v`) is more reliable — `awk -v` doesn't
# handle embedded newlines consistently across awk implementations, which
# silently produced empty entries in v0.2.0–v0.2.5.
PREPEND_FILE=$(mktemp)
cat > "$PREPEND_FILE" <<EOF
## Progress Update as of $TIMESTAMP — v${VERSION}
*(Most recent updates at top)*

$ENTRY_BODY

---

EOF

# Insert the prepend file's contents after the first '---' separator (which
# sits below the file's intro paragraph and above the first existing entry).
TMP=$(mktemp)
awk -v prepend="$PREPEND_FILE" '
  /^---$/ && !inserted {
    print
    print ""
    while ((getline line < prepend) > 0) print line
    close(prepend)
    inserted = 1
    next
  }
  { print }
' "$PROGRESS_LOG" > "$TMP" && mv "$TMP" "$PROGRESS_LOG"
rm -f "$PREPEND_FILE"

# Verify the entry actually landed in the file
if ! grep -q "v${VERSION}" "$PROGRESS_LOG"; then
  fail "Log entry for v${VERSION} was not inserted into $PROGRESS_LOG"
fi

ok "Log entry prepended"

# --- step 9: commit + push visionpipe ---------------------------------------

step "Committing release v${VERSION} in visionpipe"

cd "$PROJECT_ROOT"
git add -A
git commit -m "Release v${VERSION}"
git push

ok "Pushed visionpipe"

# --- step 9.5: GitHub release with DMG attached ----------------------------

step "Creating GitHub release v${VERSION} on VisionPipe/visionpipe"

# Notes for the GitHub release: same body as the prd entry (frontmatter stripped)
GH_NOTES_FILE=$(mktemp)
if [ -f "$NOTES_FILE" ]; then
  awk '/^---$/ { c++; next } c >= 2' "$NOTES_FILE" > "$GH_NOTES_FILE"
else
  echo "Routine release v${VERSION}." > "$GH_NOTES_FILE"
fi

if gh release view "v${VERSION}" --repo VisionPipe/visionpipe >/dev/null 2>&1; then
  echo "  Release v${VERSION} already exists — uploading DMG only"
  gh release upload "v${VERSION}" "$DMG_PATH" --repo VisionPipe/visionpipe --clobber
else
  gh release create "v${VERSION}" "$DMG_PATH" \
    --title "v${VERSION}" \
    --notes-file "$GH_NOTES_FILE" \
    --repo VisionPipe/visionpipe
fi

rm -f "$GH_NOTES_FILE"
ok "GitHub release v${VERSION} published"

# --- step 9.6: update homebrew-visionpipe tap ------------------------------

step "Updating homebrew tap to v${VERSION}"

TAP_DIR="$PROJECT_ROOT/.homebrew-visionpipe"
DMG_SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')

if [ ! -d "$TAP_DIR" ]; then
  git clone https://github.com/VisionPipe/homebrew-visionpipe.git "$TAP_DIR"
else
  git -C "$TAP_DIR" fetch origin
  git -C "$TAP_DIR" reset --hard origin/main
fi

CASK_FILE="$TAP_DIR/Casks/visionpipe.rb"
[ -f "$CASK_FILE" ] || fail "Cask file not found at $CASK_FILE"

sed -i.bak "s/^  version \".*\"/  version \"${VERSION}\"/" "$CASK_FILE"
sed -i.bak "s/^  sha256 \".*\"/  sha256 \"${DMG_SHA256}\"/" "$CASK_FILE"
# Bundle ID was renamed in v0.1.x → 0.2.x. Update zap paths to match.
sed -i.bak "s|ai\\.visionpipe\\.app|com.visionpipe.desktop|g" "$CASK_FILE"
rm -f "$CASK_FILE.bak"

# Verify changes
grep -q "version \"${VERSION}\"" "$CASK_FILE" || fail "Cask version not updated"
grep -q "sha256 \"${DMG_SHA256}\"" "$CASK_FILE" || fail "Cask sha256 not updated"

git -C "$TAP_DIR" add Casks/visionpipe.rb
if git -C "$TAP_DIR" diff --cached --quiet; then
  echo "  Tap already up to date"
else
  git -C "$TAP_DIR" commit -m "Bump visionpipe to v${VERSION}"
  git -C "$TAP_DIR" push origin main
  ok "Homebrew tap pushed"
fi

# --- step 10: commit + push visionpipe-web ----------------------------------

if [ "$SKIP_WEB" = "1" ]; then
  step "Skipping visionpipe-web push (--skip-web)"
  echo "  visionpipe.ai will remain at whatever's on origin/main until you merge"
  echo "  whatever branch is currently holding the website work."
else
  step "Committing release v${VERSION} in visionpipe-web"

  cd "$WEB_PROJECT"
  git add "$WEB_DOWNLOADS_RELATIVE"
  if git diff --cached --quiet; then
    echo "  (no DMG changes to commit in visionpipe-web)"
  else
    git commit -m "Release v${VERSION}"
    git push
    ok "Pushed visionpipe-web"
  fi

  cd "$PROJECT_ROOT"
fi

# --- step 11: clean up release-notes file -----------------------------------

if [ -f "$NOTES_FILE" ]; then
  rm -f "$NOTES_FILE"
  ok "Cleared $NOTES_FILE for the next release"
fi

# --- step 12: post-flight sync verification ----------------------------------
#
# Confirms every public channel is actually at $VERSION before declaring
# success. If any channel is stale, prints the specific manual-fix command
# and exits non-zero. This catches partial-failure modes (script killed
# mid-pipeline, push rejected, gh release upload partial) where the
# success banner would otherwise lie about the state.

step "Verifying release sync"
SYNC_FAILED=0

# 1. visionpipe origin/main contains "Release v$VERSION" at HEAD.
git -C "$PROJECT_ROOT" fetch origin main --quiet
EXPECTED_MSG="Release v${VERSION}"
ACTUAL_MSG=$(git -C "$PROJECT_ROOT" log -1 --format="%s" "origin/main")
if [ "$ACTUAL_MSG" = "$EXPECTED_MSG" ]; then
  ok "visionpipe origin/main HEAD: $ACTUAL_MSG"
else
  echo "  ✗ visionpipe origin/main HEAD is '$ACTUAL_MSG', expected '$EXPECTED_MSG'"
  echo "    Fix: git -C $PROJECT_ROOT push origin main"
  SYNC_FAILED=1
fi

# 2. GitHub release exists with the DMG attached.
if gh release view "v${VERSION}" --repo VisionPipe/visionpipe >/dev/null 2>&1; then
  ASSET=$(gh release view "v${VERSION}" --repo VisionPipe/visionpipe --json assets --jq '.assets[].name' | grep -E "VisionPipe.*\.dmg" || true)
  if [ -n "$ASSET" ]; then
    ok "GitHub release v${VERSION} ($ASSET)"
  else
    echo "  ✗ GitHub release v${VERSION} exists but no DMG attached"
    echo "    Fix: gh release upload v${VERSION} '$DMG_PATH' --repo VisionPipe/visionpipe --clobber"
    SYNC_FAILED=1
  fi
else
  echo "  ✗ GitHub release v${VERSION} missing"
  echo "    Fix: gh release create v${VERSION} '$DMG_PATH' --title v${VERSION} --notes 'Release v${VERSION}' --repo VisionPipe/visionpipe"
  SYNC_FAILED=1
fi

# 3. Homebrew tap (public-facing) is at $VERSION.
TAP_VERSION=$(gh api repos/VisionPipe/homebrew-visionpipe/contents/Casks/visionpipe.rb --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | awk -F'"' '/^  version/ {print $2; exit}')
if [ "$TAP_VERSION" = "$VERSION" ]; then
  ok "Homebrew tap public version: v${TAP_VERSION}"
else
  echo "  ✗ Homebrew tap is at v${TAP_VERSION:-unknown}, expected v${VERSION}"
  echo "    Fix: re-run the homebrew section of release.sh, or push '$TAP_DIR' manually"
  SYNC_FAILED=1
fi

# 4. visionpipe-web origin/main has the new versioned DMG and the stable
#    VisionPipe.dmg points at it. Skipped when --skip-web was passed.
if [ "$SKIP_WEB" = "1" ]; then
  echo "  (skipped visionpipe-web check — --skip-web)"
else
  git -C "$WEB_PROJECT" fetch origin main --quiet
  WEB_HAS_VERSIONED=$(git -C "$WEB_PROJECT" ls-tree --name-only "origin/main" -- "$WEB_DOWNLOADS_RELATIVE/VisionPipe-${VERSION}.dmg" 2>/dev/null || true)
  WEB_HAS_LATEST=$(git -C "$WEB_PROJECT" ls-tree --name-only "origin/main" -- "$WEB_DOWNLOADS_RELATIVE/VisionPipe.dmg" 2>/dev/null || true)
  if [ -n "$WEB_HAS_VERSIONED" ] && [ -n "$WEB_HAS_LATEST" ]; then
    ok "visionpipe-web origin/main has VisionPipe-${VERSION}.dmg and VisionPipe.dmg"
  else
    echo "  ✗ visionpipe-web origin/main missing one or both of:"
    echo "      - VisionPipe-${VERSION}.dmg ($([ -n "$WEB_HAS_VERSIONED" ] && echo present || echo MISSING))"
    echo "      - VisionPipe.dmg            ($([ -n "$WEB_HAS_LATEST" ] && echo present || echo MISSING))"
    echo "    Fix: cd $WEB_PROJECT && git checkout main && git pull && cp '$DMG_PATH' '$WEB_DOWNLOADS/' && cp '$DMG_PATH' '$WEB_DOWNLOADS/VisionPipe.dmg' && git add $WEB_DOWNLOADS_RELATIVE && git commit -m 'Release v${VERSION}' && git push"
    SYNC_FAILED=1
  fi
fi

if [ "$SYNC_FAILED" = "1" ]; then
  fail "One or more channels are out of sync. See above for fix commands."
fi

ok "All channels synced at v${VERSION}"

# --- done --------------------------------------------------------------------

printf '\n\033[1;32m═══════════════════════════════════════════════════════════════════\033[0m\n'
printf '\033[1;32m✓ Release v%s complete and pushed\033[0m\n' "$VERSION"
printf '\033[1;32m═══════════════════════════════════════════════════════════════════\033[0m\n\n'
echo "  DMG:       $DMG_PATH"
echo "  Versioned: $DEST_VERSIONED"
echo "  Latest:    $DEST_LATEST"
echo ""
