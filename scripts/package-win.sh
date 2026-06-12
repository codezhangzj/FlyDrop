#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="FlyDrop"
RELEASE_DIR="$ROOT_DIR/release"
WINDOWS_ELECTRON_VERSION="${WINDOWS_ELECTRON_VERSION:-33.4.11}"
# sharp 0.33.5 仅提供 win32 x64 / ia32 预编译二进制（无 win32-arm64）。
WINDOWS_ARCHES="${WINDOWS_ARCHES:-x64}"

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
sharp_cpu_targets=()
for arch in $WINDOWS_ARCHES; do
  case "$arch" in
    x64|ia32)
      builder_arch_flags+=("--$arch")
      sharp_cpu_targets+=("$arch")
      ;;
    arm64)
      fail "sharp 0.33.5 没有 win32-arm64 预编译二进制，无法打包 Windows arm64。请仅使用 x64 / ia32。"
      ;;
    *) fail "Unsupported Windows architecture: $arch. Use x64 and/or ia32." ;;
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
log "Using Electron $WINDOWS_ELECTRON_VERSION"
npm run build:web
npm run build:electron

# 关键：为目标架构安装 win32 平台的 sharp 原生二进制。
# npm 安装可选依赖时只装「当前平台」对应的包，跨平台打包（如在 macOS/Linux 上打 Windows）
# 或架构不符时，node_modules 里不会有 win32 的 sharp 二进制，导致安装后报
# "Could not load the sharp module using the win32-x64 runtime"。
# 用 --os/--cpu 显式拉取目标平台二进制，确保 electron-builder 能把它打进包。
SHARP_VERSION="$(node -p "require('./node_modules/sharp/package.json').version")"
for cpu in "${sharp_cpu_targets[@]}"; do
  log "Installing sharp@$SHARP_VERSION native binary for win32-$cpu"
  npm install --no-save --os=win32 --cpu="$cpu" "sharp@$SHARP_VERSION" \
    || fail "无法安装 win32-$cpu 的 sharp 二进制，请检查网络（可设置 npm 镜像）后重试。"
done

# 校验目标二进制确实就位（以 x64 为例）
for cpu in "${sharp_cpu_targets[@]}"; do
  if [[ ! -f "node_modules/@img/sharp-win32-$cpu/lib/sharp-win32-$cpu.node" ]]; then
    fail "@img/sharp-win32-$cpu 二进制缺失，打包会得到无法启动的应用。"
  fi
  ok "win32-$cpu sharp 二进制已就位"
done

npx electron-builder --win nsis "${builder_arch_flags[@]}" -c.electronVersion="$WINDOWS_ELECTRON_VERSION"

log "Package output"
find "$RELEASE_DIR" -maxdepth 2 \( -name '*.exe' -o -name "${APP_NAME}.exe" \) -print

ok "Windows packaging finished"
