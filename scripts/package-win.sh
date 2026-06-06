#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="FlyDrop"
RELEASE_DIR="$ROOT_DIR/release"
WINDOWS_ELECTRON_VERSION="${WINDOWS_ELECTRON_VERSION:-22.3.27}"
WINDOWS_ARCHES="${WINDOWS_ARCHES:-x64 ia32}"

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

builder_arch_flags=()
for arch in $WINDOWS_ARCHES; do
  case "$arch" in
    x64|ia32|arm64) builder_arch_flags+=("--$arch") ;;
    *) fail "Unsupported Windows architecture: $arch. Use x64, ia32, and/or arm64." ;;
  esac
done

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

log "Cleaning previous Windows package output"
rm -rf "$RELEASE_DIR/win-unpacked" "$RELEASE_DIR/win-ia32-unpacked" "$RELEASE_DIR/win-arm64-unpacked"
find "$RELEASE_DIR" -maxdepth 1 \( -name '*.exe' -o -name '*.exe.blockmap' -o -name '*.nsis.7z' \) -delete 2>/dev/null || true

log "Building Windows application for: $WINDOWS_ARCHES"
log "Using Electron $WINDOWS_ELECTRON_VERSION for Windows 7 compatibility"
npm run build:web
npm run build:electron
npx electron-builder --win nsis "${builder_arch_flags[@]}" -c.electronVersion="$WINDOWS_ELECTRON_VERSION"

log "Package output"
find "$RELEASE_DIR" -maxdepth 2 \( -name '*.exe' -o -name "${APP_NAME}.exe" \) -print

ok "Windows packaging finished"
