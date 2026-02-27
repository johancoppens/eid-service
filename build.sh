#!/usr/bin/env bash
# Build script for Belgian eID Local WebSocket Service
#
# Compiles host.js into a standalone binary using Bun.
# The native pcsc-mini addon (.node file) is placed next to the binary
# since it cannot be embedded inside the compiled executable.
#
# Output:
#   dist/
#   ├── eid-service                           (compiled binary, ~97MB)
#   ├── addon.node                            (native PC/SC addon, ~100KB)
#   └── eid-service-{os}-{arch}.tar.gz        (release archive)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
BUILD_TMP="$SCRIPT_DIR/.build-tmp"

# Detect platform-specific addon package
detect_addon_package() {
  local platform arch abi target

  platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$platform" in
    linux)
      # Detect glibc vs musl
      if ldd --version 2>&1 | grep -qi musl; then
        abi="musl"
      else
        abi="gnu"
      fi
      case "$arch" in
        x86_64)  echo "@pcsc-mini/linux-${arch}-${abi}" ;;
        aarch64) echo "@pcsc-mini/linux-${arch}-${abi}" ;;
        *)       echo "Unsupported arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    darwin)
      case "$arch" in
        arm64)   echo "@pcsc-mini/macos-aarch64" ;;
        x86_64)  echo "@pcsc-mini/macos-x86_64" ;;
        *)       echo "Unsupported arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    *)
      echo "Unsupported platform: $platform" >&2
      exit 1
      ;;
  esac
}

ADDON_PKG="$(detect_addon_package)"
echo "Platform addon: $ADDON_PKG"

# Verify source addon exists
ADDON_SRC="$SCRIPT_DIR/node_modules/$ADDON_PKG/addon.node"
if [ ! -f "$ADDON_SRC" ]; then
  echo "Error: Native addon not found at $ADDON_SRC"
  echo "Run 'npm install' in $SCRIPT_DIR first."
  exit 1
fi

# Clean previous build
rm -rf "$BUILD_TMP" "$DIST_DIR"
mkdir -p "$BUILD_TMP" "$DIST_DIR"

# Create patched addon.node.js that loads the native addon from next to the executable
# instead of using package resolution (which doesn't work in compiled binaries)
cat > "$BUILD_TMP/addon.node.js" << 'PATCH'
"use strict";
const path = require("node:path");
const addonPath = path.join(path.dirname(process.execPath), "addon.node");
const mod = { exports: {} };
process.dlopen(mod, addonPath);
module.exports = mod.exports;
PATCH

# Copy pcsc-mini source and apply patch
cp -r "$SCRIPT_DIR/node_modules/pcsc-mini" "$BUILD_TMP/pcsc-mini"
cp "$BUILD_TMP/addon.node.js" "$BUILD_TMP/pcsc-mini/build/addon.node.js"

# Create a temporary entry point that imports from the patched copy
# This ensures Bun bundles our patched pcsc-mini, not the original
cat > "$BUILD_TMP/host-entry.js" << ENTRY
// Re-export host.js but with pcsc-mini resolved from .build-tmp
// The import map in bunfig.toml handles the resolution
import "$SCRIPT_DIR/host.js"
ENTRY

# Create bunfig.toml to remap pcsc-mini to our patched version
cat > "$BUILD_TMP/bunfig.toml" << TOML
[install]
[bundle]

[bundle.packages]
"pcsc-mini" = "$BUILD_TMP/pcsc-mini"
TOML

echo "Compiling with Bun..."

# We need to make Bun resolve pcsc-mini from our patched copy.
# Strategy: Use --external for the native addon package only,
# and point NODE_PATH to our patched modules
#
# Actually, simplest approach: create a node_modules symlink in .build-tmp
# pointing to our patched pcsc-mini
mkdir -p "$BUILD_TMP/node_modules"
ln -sf "$BUILD_TMP/pcsc-mini" "$BUILD_TMP/node_modules/pcsc-mini"
ln -sf "$SCRIPT_DIR/node_modules/ws" "$BUILD_TMP/node_modules/ws"

# Copy host.js to build-tmp so it resolves pcsc-mini from there
cp "$SCRIPT_DIR/host.js" "$BUILD_TMP/host.js"

# Compile — the @pcsc-mini/* packages are not needed at bundle time
# because our patched addon.node.js doesn't require() them
bun build --compile \
  "$BUILD_TMP/host.js" \
  --outfile "$DIST_DIR/eid-service"

# Copy native addon next to the binary
cp "$ADDON_SRC" "$DIST_DIR/addon.node"

# Clean up
rm -rf "$BUILD_TMP"

# --- Create platform-named archive ---

detect_archive_name() {
  local platform arch
  platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$platform" in
    linux)  platform="linux" ;;
    darwin) platform="darwin" ;;
    *)      platform="unknown" ;;
  esac

  case "$arch" in
    x86_64|amd64)  arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)             arch="unknown" ;;
  esac

  echo "eid-service-${platform}-${arch}.tar.gz"
}

ARCHIVE_NAME="$(detect_archive_name)"
ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"

tar -czf "$ARCHIVE_PATH" -C "$DIST_DIR" eid-service addon.node

echo ""
echo "Build complete!"
echo "  Binary:  $DIST_DIR/eid-service ($(du -h "$DIST_DIR/eid-service" | cut -f1))"
echo "  Addon:   $DIST_DIR/addon.node ($(du -h "$DIST_DIR/addon.node" | cut -f1))"
echo "  Archive: $ARCHIVE_PATH ($(du -h "$ARCHIVE_PATH" | cut -f1))"
echo ""
echo "Test: $DIST_DIR/eid-service"
