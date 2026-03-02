#!/bin/sh
#
# Belgian eID Service — Installer for Linux and macOS
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/johancoppens/eid-service/main/install.sh | sh
#   curl -sSL ... | sh -s -- --origin https://datahub.edugolo.be
#   curl -sSL ... | sh -s -- --version v1.2.0
#   curl -sSL ... | sh -s -- --uninstall
#
# Environment variables:
#   EID_REPO  — GitHub repo (default: johancoppens/eid-service)
#

set -eu

# --- Defaults ---

EID_REPO="${EID_REPO:-johancoppens/eid-service}"
INSTALL_DIR="${HOME}/.eid-service"
CONFIG_DIR="${HOME}/.config/eid-service"
CONFIG_FILE="${CONFIG_DIR}/config.json"
DEFAULT_PORT=17365
VERSION=""
ORIGIN=""
UNINSTALL=0

# --- Colors (if terminal) ---

if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  RED="\033[31m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" YELLOW="" RED="" RESET=""
fi

info()  { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "  ${YELLOW}⚠${RESET}  %s\n" "$1"; }
error() { printf "  ${RED}✗${RESET} %s\n" "$1"; }
die()   { error "$1"; exit 1; }

# --- Parse arguments ---

while [ $# -gt 0 ]; do
  case "$1" in
    --version)  shift; VERSION="${1:-}"; [ -z "$VERSION" ] && die "--version requires a value" ;;
    --origin)   shift; ORIGIN="${1:-}";  [ -z "$ORIGIN" ]  && die "--origin requires a value" ;;
    --uninstall) UNINSTALL=1 ;;
    --help|-h)
      printf "Usage: install.sh [OPTIONS]\n\n"
      printf "Options:\n"
      printf "  --origin URL     Set allowed origin (repeatable via comma-separated)\n"
      printf "  --version TAG    Install specific version (default: latest)\n"
      printf "  --uninstall      Remove eID service\n"
      printf "  --help           Show this help\n"
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done

# --- Uninstall ---

if [ "$UNINSTALL" = 1 ]; then
  printf "\n  ${BOLD}eID Service — Uninstall${RESET}\n\n"

  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    info "Removed ${INSTALL_DIR}"
  else
    warn "Install directory not found: ${INSTALL_DIR}"
  fi

  if [ -d "$CONFIG_DIR" ]; then
    printf "\n"
    printf "  Remove configuration (${CONFIG_DIR})? [y/N] "
    if [ -t 0 ]; then
      read -r CONFIRM
    else
      CONFIRM="y"
    fi
    case "$CONFIRM" in
      y|Y|yes|YES)
        rm -rf "$CONFIG_DIR"
        info "Removed ${CONFIG_DIR}"
        ;;
      *)
        info "Configuration kept"
        ;;
    esac
  fi

  printf "\n"
  info "eID service uninstalled."
  printf "\n"
  exit 0
fi

# --- Detect platform ---

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)  OS="linux" ;;
    Darwin) OS="darwin" ;;
    *)      die "Unsupported OS: ${OS}. Use install.ps1 for Windows." ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             die "Unsupported architecture: ${ARCH}" ;;
  esac
}

# --- Check Linux prerequisites ---

check_prerequisites() {
  if [ "$OS" != "linux" ]; then
    return
  fi

  if ! command -v pcscd >/dev/null 2>&1; then
    warn "pcscd is not installed — required for smart card reading"
    printf "\n"
    printf "  Install it with:\n"
    if command -v apt-get >/dev/null 2>&1; then
      printf "    sudo apt-get install pcscd libpcsclite-dev\n"
    elif command -v dnf >/dev/null 2>&1; then
      printf "    sudo dnf install pcsc-lite pcsc-lite-devel\n"
    elif command -v pacman >/dev/null 2>&1; then
      printf "    sudo pacman -S pcsclite\n"
    elif command -v apk >/dev/null 2>&1; then
      printf "    sudo apk add pcsc-lite pcsc-lite-dev\n"
    else
      printf "    Install pcscd via your package manager\n"
    fi
    printf "\n"
    printf "  Then enable and start:\n"
    printf "    sudo systemctl enable pcscd && sudo systemctl start pcscd\n"
    printf "\n"
  fi
}

# --- Download helpers ---

fetch() {
  URL="$1"
  DEST="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$DEST" "$URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$DEST" "$URL"
  else
    die "Neither curl nor wget found. Install one and retry."
  fi
}

fetch_text() {
  URL="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$URL"
  else
    die "Neither curl nor wget found."
  fi
}

# --- Resolve version ---

resolve_version() {
  if [ -n "$VERSION" ]; then
    # Strip leading 'v' if present — we'll add it back
    VERSION="${VERSION#v}"
    return
  fi

  printf "  Fetching latest version..."
  LATEST=$(fetch_text "https://api.github.com/repos/${EID_REPO}/releases/latest" 2>/dev/null \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name":[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/')

  if [ -z "$LATEST" ]; then
    die "Could not determine latest version. Use --version to specify."
  fi

  VERSION="$LATEST"
  printf " v${VERSION}\n"
}

# --- Generate fingerprint ---

generate_fingerprint() {
  if [ -f /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    # POSIX fallback — hex from /dev/urandom
    od -An -tx1 -N16 /dev/urandom | tr -d ' \n' | sed 's/\(.\{8\}\)\(.\{4\}\)\(.\{4\}\)\(.\{4\}\)\(.\{12\}\)/\1-\2-\3-\4-\5/'
  fi
}

# ============================================================
# Main
# ============================================================

printf "\n"
printf "  ${BOLD}eID Service — Installer${RESET}\n"
printf "  ========================\n\n"

detect_platform
check_prerequisites

resolve_version

ARCHIVE="eid-service-${OS}-${ARCH}.tar.gz"
DOWNLOAD_URL="https://github.com/${EID_REPO}/releases/download/v${VERSION}/${ARCHIVE}"

info "Platform: ${OS}/${ARCH}"
info "Version:  v${VERSION}"
printf "\n"

# --- Download and extract ---

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

printf "  Downloading ${ARCHIVE}...\n"
fetch "$DOWNLOAD_URL" "${TMP_DIR}/${ARCHIVE}" || die "Download failed. Check that version v${VERSION} exists at:\n    https://github.com/${EID_REPO}/releases"

printf "  Extracting...\n"
mkdir -p "$INSTALL_DIR"
tar -xzf "${TMP_DIR}/${ARCHIVE}" -C "$INSTALL_DIR"
chmod +x "${INSTALL_DIR}/eid-service"

info "Installed to ${INSTALL_DIR}/"

# --- Configure ---

printf "\n"
mkdir -p "$CONFIG_DIR"

# Preserve existing config values
FINGERPRINT=""
EXISTING_ORIGINS_JSON=""
if [ -f "$CONFIG_FILE" ]; then
  EXISTING_FP=$(grep '"fingerprint"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*"fingerprint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)
  if [ -n "$EXISTING_FP" ]; then
    FINGERPRINT="$EXISTING_FP"
    info "Existing fingerprint preserved"
  fi

  # Preserve existing allowedOrigins JSON array
  EXISTING_ORIGINS_JSON=$(grep '"allowedOrigins"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*"allowedOrigins"[[:space:]]*:[[:space:]]*\(\[.*\]\).*/\1/' || true)
fi

if [ -z "$FINGERPRINT" ]; then
  FINGERPRINT=$(generate_fingerprint)
  info "Generated new fingerprint"
fi

# --- Allowed origins ---

ALLOWED_ORIGINS=""

if [ -n "$ORIGIN" ]; then
  # From --origin flag (comma-separated)
  ALLOWED_ORIGINS="$ORIGIN"
elif [ -t 0 ]; then
  # Interactive — ask user
  printf "\n"
  printf "  Which website(s) may use the eID service?\n"
  printf "  Enter full URL(s), e.g. https://datahub.edugolo.be\n"
  printf "  Separate multiple origins with commas.\n"
  printf "  Leave empty to keep current setting.\n\n"

  if [ -n "$EXISTING_ORIGINS_JSON" ] && [ "$EXISTING_ORIGINS_JSON" != "[]" ]; then
    printf "  Current: ${EXISTING_ORIGINS_JSON}\n"
  fi

  printf "  Origin(s): "
  read -r ORIGINS_INPUT

  if [ -n "$ORIGINS_INPUT" ]; then
    ALLOWED_ORIGINS="$ORIGINS_INPUT"
  fi
fi

# Build JSON array from comma-separated input, or preserve existing
if [ -n "$ALLOWED_ORIGINS" ]; then
  # Convert "https://a.com, https://b.com" → ["https://a.com","https://b.com"]
  ORIGINS_JSON=$(printf '%s' "$ALLOWED_ORIGINS" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/\/*$//' | awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"",$0} END{printf "]"}')
  info "Origins configured: ${ORIGINS_JSON}"
elif [ -n "$EXISTING_ORIGINS_JSON" ]; then
  ORIGINS_JSON="$EXISTING_ORIGINS_JSON"
  if [ "$ORIGINS_JSON" = "[]" ]; then
    warn "No origins configured — all origins allowed (development mode)"
  else
    info "Existing origins preserved: ${ORIGINS_JSON}"
  fi
else
  ORIGINS_JSON="[]"
  warn "No origins configured — all origins allowed (development mode)"
fi

# Write config
cat > "$CONFIG_FILE" << EOF
{
  "fingerprint": "${FINGERPRINT}",
  "port": ${DEFAULT_PORT},
  "allowedOrigins": ${ORIGINS_JSON}
}
EOF

info "Config saved: ${CONFIG_FILE}"

# --- Add to PATH hint ---

printf "\n"
printf "  ${BOLD}Setup complete!${RESET}\n\n"

# Check if already in PATH
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    info "Already in PATH"
    ;;
  *)
    printf "  To add to PATH, run:\n\n"
    SHELL_NAME=$(basename "${SHELL:-/bin/sh}")
    case "$SHELL_NAME" in
      zsh)  printf "    echo 'export PATH=\"\$HOME/.eid-service:\$PATH\"' >> ~/.zshrc\n" ;;
      fish) printf "    fish_add_path ~/.eid-service\n" ;;
      *)    printf "    echo 'export PATH=\"\$HOME/.eid-service:\$PATH\"' >> ~/.bashrc\n" ;;
    esac
    printf "\n"
    ;;
esac

printf "  Start the service:\n\n"
printf "    ${INSTALL_DIR}/eid-service\n\n"

printf "  Fingerprint: ${FINGERPRINT}\n"
printf "  Port:        ${DEFAULT_PORT}\n\n"
