#!/usr/bin/env bash
# ==============================================================================
# VisionPipe release build script
# ==============================================================================
# Every run bumps the version, builds + signs + notarizes + staples a .dmg,
# copies it into ../visionpipe-web/public/downloads/, prepends an entry to
# prd/initial-build-out.md, and git-commits + pushes in both projects.
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
APP_PATH="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/$APP_NAME"
WEB_DOWNLOADS="$WEB_PROJECT/$WEB_DOWNLOADS_RELATIVE"
NOTES_FILE="$PROJECT_ROOT/scripts/.release-notes.md"
PROGRESS_LOG="$PROJECT_ROOT/prd/initial-build-out.md"

cd "$PROJECT_ROOT"

# --- helpers -----------------------------------------------------------------

step() { printf '\n\033[1;36m→ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }

# --- parse args --------------------------------------------------------------

BUMP_TYPE="patch"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump=*) BUMP_TYPE="${1#*=}"; shift ;;
    --bump)   BUMP_TYPE="${2:-patch}"; shift 2 ;;
    *)        shift ;;
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

[ -d "$APP_PATH" ] || fail ".app not found after Tauri build at $APP_PATH"
ok ".app built and signed"

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

step "Prepending entry to prd/initial-build-out.md"

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

# Build the new entry block
NEW_ENTRY=$(cat <<EOF
## Progress Update as of $TIMESTAMP — v${VERSION}
*(Most recent updates at top)*

$ENTRY_BODY

---

EOF
)

# Insert the new entry after the first '---' separator (which sits below
# the file's intro paragraph and above the first existing entry).
TMP=$(mktemp)
awk -v entry="$NEW_ENTRY" '
  /^---$/ && !inserted {
    print
    print ""
    print entry
    inserted = 1
    next
  }
  { print }
' "$PROGRESS_LOG" > "$TMP" && mv "$TMP" "$PROGRESS_LOG"

ok "Log entry prepended"

# --- step 9: commit + push visionpipe ---------------------------------------

step "Committing release v${VERSION} in visionpipe"

cd "$PROJECT_ROOT"
git add -A
git commit -m "Release v${VERSION}"
git push

ok "Pushed visionpipe"

# --- step 10: commit + push visionpipe-web ----------------------------------

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

# --- step 11: clean up release-notes file -----------------------------------

if [ -f "$NOTES_FILE" ]; then
  rm -f "$NOTES_FILE"
  ok "Cleared $NOTES_FILE for the next release"
fi

# --- done --------------------------------------------------------------------

printf '\n\033[1;32m═══════════════════════════════════════════════════════════════════\033[0m\n'
printf '\033[1;32m✓ Release v%s complete and pushed\033[0m\n' "$VERSION"
printf '\033[1;32m═══════════════════════════════════════════════════════════════════\033[0m\n\n'
echo "  DMG:       $DMG_PATH"
echo "  Versioned: $DEST_VERSIONED"
echo "  Latest:    $DEST_LATEST"
echo ""
