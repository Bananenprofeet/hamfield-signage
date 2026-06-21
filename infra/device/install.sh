#!/usr/bin/env bash
# Signage device installer for Raspberry Pi 4/5 and ODROID-C4
# (Debian-based OS: Raspberry Pi OS Lite, Ubuntu, Armbian).
#
# Run from a checkout of the signage-platform repository:
#   sudo ./infra/device/install.sh --server https://signage.example.com --pairing-code ABCD1234
#
# Options:
#   --server <url>         Backend URL (required on first install)
#   --pairing-code <code>  One-time pairing code from the dashboard
#   --no-player            Install the agent only (headless, no Chromium kiosk)
#   --bundle <out.tar.gz>  Don't install; build a release tarball for update.sh
set -eu

SERVER_URL=""
PAIRING_CODE=""
INSTALL_PLAYER=1
BUNDLE_OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER_URL="$2"; shift 2 ;;
    --pairing-code) PAIRING_CODE="$2"; shift 2 ;;
    --no-player) INSTALL_PLAYER=0; shift ;;
    --bundle) BUNDLE_OUT="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$REPO_ROOT/pnpm-workspace.yaml" ]; then
  echo "Run this script from a signage-platform repository checkout" >&2
  exit 1
fi

log() { echo "==> $*"; }

# ---------------------------------------------------------------------------
# Build the agent and player UI
# ---------------------------------------------------------------------------
build_release() {
  local out_dir="$1"

  if ! command -v node > /dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
    log "Installing Node.js 22 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  log "Enabling pnpm via corepack"
  corepack enable

  log "Installing workspace dependencies (this can take a while on a Pi)"
  cd "$REPO_ROOT"
  pnpm install

  log "Building agent and player UI"
  pnpm --filter "@signage/agent..." build
  pnpm --filter @signage/player build

  log "Creating standalone agent deployment"
  rm -rf "$out_dir/agent"
  pnpm --filter @signage/agent deploy --prod "$out_dir/agent"

  rm -rf "$out_dir/player-ui"
  cp -r "$REPO_ROOT/apps/player/dist" "$out_dir/player-ui"

  mkdir -p "$out_dir/bin"
  cp "$SCRIPT_DIR/start-player.sh" "$SCRIPT_DIR/screenshot.sh" "$SCRIPT_DIR/update.sh" "$out_dir/bin/"
  chmod +x "$out_dir/bin/"*
}

# True when an installed Chromium is a real native binary. On Ubuntu the
# `chromium`/`chromium-browser` apt packages are snap stubs (a shell wrapper
# around `snap run`), and the snap cannot run under our systemd service —
# snap-confine rejects the non-snap service cgroup, so the kiosk never starts.
# A native build is an ELF executable; the stub is a script.
chromium_is_native() {
  local bin path
  for bin in chromium chromium-browser; do
    path="$(command -v "$bin" 2> /dev/null)" || continue
    if file -L "$path" 2> /dev/null | grep -q 'ELF'; then
      return 0
    fi
  done
  return 1
}

install_chromium() {
  if chromium_is_native; then
    log "Native Chromium already present"
    return 0
  fi

  log "Installing Chromium"
  apt-get install -y chromium-browser 2> /dev/null \
    || apt-get install -y chromium 2> /dev/null || true
  if chromium_is_native; then
    return 0
  fi

  # Got the Ubuntu snap stub (or nothing). Remove it and install a real .deb
  # from the xtradeb PPA, which packages Chromium for arm64/amd64 to replace
  # the snap. (On Debian/Armbian the apt package above is already native and we
  # never reach here.)
  log "Distro Chromium is a snap stub — installing native build from ppa:xtradeb/apps"
  apt-get purge -y chromium chromium-browser 2> /dev/null || true
  apt-get install -y software-properties-common
  add-apt-repository -y ppa:xtradeb/apps
  apt-get update
  apt-get install -y chromium || true

  if ! chromium_is_native; then
    echo "Could not install a native (non-snap) Chromium for this distro/arch." >&2
    echo "Install one manually so 'chromium' is an ELF binary, then re-run." >&2
    exit 1
  fi
}

# --bundle mode: produce a tarball for SIGNAGE_UPDATE_URL and exit.
if [ -n "$BUNDLE_OUT" ]; then
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  build_release "$WORK"
  tar -czf "$BUNDLE_OUT" -C "$WORK" agent player-ui bin
  log "Release bundle written to $BUNDLE_OUT"
  exit 0
fi

# ---------------------------------------------------------------------------
# Full device install (root required)
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0 ..." >&2
  exit 1
fi
if ! command -v apt-get > /dev/null 2>&1; then
  echo "This installer supports Debian-based systems only (apt-get not found)" >&2
  exit 1
fi

log "Installing base packages"
apt-get update
apt-get install -y curl ca-certificates

if [ "$INSTALL_PLAYER" -eq 1 ]; then
  log "Installing kiosk packages (X server, scrot)"
  apt-get install -y xserver-xorg xinit x11-xserver-utils scrot file
  install_chromium
fi

build_release /opt/signage

log "Creating signage user and directories"
if ! id signage > /dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/signage \
    --shell /usr/sbin/nologin signage
fi
usermod -aG video,render,input,tty,audio signage 2> /dev/null || true
mkdir -p /var/lib/signage /etc/signage
chown -R signage:signage /opt/signage /var/lib/signage

log "Writing configuration"
if [ ! -f /etc/signage/agent.env ]; then
  if [ -z "$SERVER_URL" ]; then
    echo "First install needs --server <url>" >&2
    exit 1
  fi
  cat > /etc/signage/agent.env <<EOF
# Signage device agent configuration. Edit with: signage config
SIGNAGE_SERVER_URL=$SERVER_URL
SIGNAGE_PAIRING_CODE=$PAIRING_CODE
SIGNAGE_DATA_DIR=/var/lib/signage
SIGNAGE_PLAYER_PORT=8080
SIGNAGE_PLAYER_UI_DIR=/opt/signage/player-ui
SIGNAGE_SCREENSHOT_CMD=/opt/signage/bin/screenshot.sh
SIGNAGE_UPDATE_CMD=/opt/signage/bin/update.sh
SIGNAGE_ALLOW_REBOOT=true
SIGNAGE_PLAYER_SERVICE=signage-player.service
SIGNAGE_LOG_LEVEL=info
# Optional: release tarball used by the software_update command
#SIGNAGE_UPDATE_URL=https://example.com/releases/signage-device.tar.gz
EOF
  chmod 600 /etc/signage/agent.env
  chown signage:signage /etc/signage/agent.env
else
  log "/etc/signage/agent.env already exists — keeping it"
  if [ -n "$PAIRING_CODE" ]; then
    sed -i "s|^SIGNAGE_PAIRING_CODE=.*|SIGNAGE_PAIRING_CODE=$PAIRING_CODE|" /etc/signage/agent.env
    log "Updated pairing code"
  fi
fi

log "Installing signage CLI"
install -m 755 "$SCRIPT_DIR/signage" /usr/local/bin/signage

log "Granting service-management rights (polkit)"
mkdir -p /etc/polkit-1/rules.d
install -m 644 "$SCRIPT_DIR/50-signage.rules" /etc/polkit-1/rules.d/50-signage.rules
systemctl restart polkit 2> /dev/null || true

if [ "$INSTALL_PLAYER" -eq 1 ]; then
  log "Allowing the signage user to start X on the console"
  cat > /etc/X11/Xwrapper.config <<EOF
allowed_users=anybody
needs_root_rights=yes
EOF
fi

log "Installing systemd services"
install -m 644 "$SCRIPT_DIR/signage-agent.service" /etc/systemd/system/signage-agent.service
if [ "$INSTALL_PLAYER" -eq 1 ]; then
  install -m 644 "$SCRIPT_DIR/signage-player.service" /etc/systemd/system/signage-player.service
fi
systemctl daemon-reload
systemctl enable --now signage-agent.service
if [ "$INSTALL_PLAYER" -eq 1 ]; then
  systemctl enable --now signage-player.service
fi

log "Done."
echo
echo "  Agent:   systemctl status signage-agent"
if [ "$INSTALL_PLAYER" -eq 1 ]; then
  echo "  Player:  systemctl status signage-player"
fi
echo "  CLI:     signage status | signage logs | signage pair <code>"
if [ -z "$PAIRING_CODE" ]; then
  echo
  echo "  No pairing code set yet. Create a screen in the dashboard and run:"
  echo "    signage pair <CODE>"
fi
