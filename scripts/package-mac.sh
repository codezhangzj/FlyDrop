#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="FlyDrop"
RELEASE_DIR="$ROOT_DIR/release"
BUILD_DIR="$ROOT_DIR/build"

log() {
  printf '\033[1;34m==>\033[0m %s\n' "$1"
}

ok() {
  printf '\033[1;32m✓\033[0m %s\n' "$1"
}

fail() {
  printf '\033[1;31mError:\033[0m %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found in PATH."
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "macOS packaging must be run on macOS."
fi

require_cmd node
require_cmd npm
require_cmd find

log "Checking dependencies"
if [[ ! -d node_modules ]]; then
  log "node_modules not found; installing with npm ci"
  npm ci
else
  ok "node_modules found"
fi

log "Preparing icons"
node scripts/gen-icons.mjs
ok "Application icons are ready"

log "Cleaning previous macOS package output"
rm -rf "$RELEASE_DIR/mac" "$RELEASE_DIR/mac-arm64" "$RELEASE_DIR/mac-universal"
find "$RELEASE_DIR" -maxdepth 1 \( -name '*.dmg' -o -name '*.dmg.blockmap' \) -delete 2>/dev/null || true

log "Building macOS application"
npm run build:web
npm run build:electron
npx electron-builder --mac

log "Package output"
find "$RELEASE_DIR" -maxdepth 2 \( -name '*.dmg' -o -name "${APP_NAME}.app" \) -print

ok "macOS packaging finished"
