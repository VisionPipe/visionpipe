#!/usr/bin/env bash
# ==============================================================================
# VisionPipe release build script
# ==============================================================================
# Builds a signed + notarized + stapled .dmg with the polished drag-to-
# Applications layout, then copies it into the visionpipe-web project's
# public/downloads folder for deployment.
#
# Usage:
#   ./scripts/release.sh
#
# Prerequisites:
#   - .env.local with APPLE_ID, APPLE_TEAM_ID, APPLE_PASSWORD, APPLE_SIGNING_IDENTITY
#   - Developer ID Application certificate installed in keychain
#   - Apple Developer ID G2 intermediate CA in keychain
#   - create-dmg installed: brew install create-dmg
#
# Why this exists instead of just `pnpm tauri build`:
#   Tauri's built-in notarization polls Apple with a short timeout that
#   sometimes fires before Apple responds, even when the submission is
#   ultimately accepted. This script uses `xcrun notarytool submit --wait`
#   which waits indefinitely, so it can't time out.
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

cd "$PROJECT_ROOT"

# --- helpers -----------------------------------------------------------------

step() { printf '\n\033[1;36m→ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }

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

pnpm tauri build

export APPLE_ID="$SAVED_APPLE_ID"
export APPLE_PASSWORD="$SAVED_APPLE_PASSWORD"

[ -d "$APP_PATH" ] || fail ".app not found after Tauri build at $APP_PATH"
ok ".app built and signed"

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

# --- done --------------------------------------------------------------------

printf '\n\033[1;32m═══════════════════════════════════════════════════════════════════\033[0m\n'
printf '\033[1;32m✓ Release build complete\033[0m\n'
printf '\033[1;32m═══════════════════════════════════════════════════════════════════\033[0m\n\n'
echo "  Source:    $DMG_PATH"
echo "  Versioned: $DEST_VERSIONED"
echo "  Latest:    $DEST_LATEST"
echo ""
echo "To deploy:"
echo "  cd $WEB_PROJECT"
echo "  git add $WEB_DOWNLOADS_RELATIVE"
echo "  git commit -m \"Release v${VERSION}\""
echo "  git push"
echo ""
