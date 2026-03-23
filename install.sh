#!/usr/bin/env sh
set -e

REPO="Reinhartsamuel/clawguard"
BIN_DIR="${CLAWGUARD_INSTALL:-$HOME/.local/bin}"
BIN_NAME="clawguard"

# ── Detect OS and architecture ────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64)  TARGET="clawguard-linux-x64" ;;
      aarch64) TARGET="clawguard-linux-arm64" ;;
      arm64)   TARGET="clawguard-linux-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
    esac
    ;;
  Darwin)
    case "$ARCH" in
      x86_64)  TARGET="clawguard-darwin-x64" ;;
      arm64)   TARGET="clawguard-darwin-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS"
    echo "For Windows, download from https://github.com/$REPO/releases/latest"
    exit 1
    ;;
esac

# ── Fetch latest release tag ──────────────────────────────────────────────────

echo "Fetching latest ClawGuard release..."

if command -v curl > /dev/null 2>&1; then
  FETCH="curl -fsSL"
elif command -v wget > /dev/null 2>&1; then
  FETCH="wget -qO-"
else
  echo "Error: curl or wget is required to install ClawGuard."
  exit 1
fi

LATEST_TAG="$($FETCH "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"

if [ -z "$LATEST_TAG" ]; then
  echo "Error: Could not fetch latest release tag. Check your internet connection."
  exit 1
fi

echo "Installing ClawGuard $LATEST_TAG..."

# ── Download binary ───────────────────────────────────────────────────────────

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/$TARGET"
TMP_FILE="$(mktemp)"

$FETCH "$DOWNLOAD_URL" > "$TMP_FILE"
chmod +x "$TMP_FILE"

# ── Download dashboard assets ─────────────────────────────────────────────────

DASHBOARD_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/dist-dashboard.tar.gz"
TMP_DASHBOARD="$(mktemp)"
$FETCH "$DASHBOARD_URL" > "$TMP_DASHBOARD"

# ── Install ───────────────────────────────────────────────────────────────────

mkdir -p "$BIN_DIR"
mv "$TMP_FILE" "$BIN_DIR/$BIN_NAME"

# Extract dashboard assets next to the binary
tar -xzf "$TMP_DASHBOARD" -C "$BIN_DIR"
rm "$TMP_DASHBOARD"

echo ""
echo "✅ ClawGuard $LATEST_TAG installed to $BIN_DIR/$BIN_NAME"

# ── PATH check ────────────────────────────────────────────────────────────────

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo ""
  echo "⚠️  $BIN_DIR is not in your PATH. Add it by running:"
  echo ""

  SHELL_NAME="$(basename "$SHELL")"
  case "$SHELL_NAME" in
    zsh)  echo '   echo '"'"'export PATH="$HOME/.local/bin:$PATH"'"'"' >> ~/.zshrc && source ~/.zshrc' ;;
    fish) echo '   fish_add_path $HOME/.local/bin' ;;
    *)    echo '   echo '"'"'export PATH="$HOME/.local/bin:$PATH"'"'"' >> ~/.bashrc && source ~/.bashrc' ;;
  esac
fi

echo ""
echo "Get started:"
echo "  clawguard init     # generate .env config"
echo "  clawguard start    # start proxy + dashboard"
echo ""
echo "Docs: https://github.com/$REPO"
