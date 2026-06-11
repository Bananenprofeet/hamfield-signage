#!/usr/bin/env bash
# Used by the software_update remote command (runs as the "signage" user,
# which owns /opt/signage). Downloads a release tarball from
# SIGNAGE_UPDATE_URL (set in /etc/signage/agent.env), swaps it in and restarts.
# The tarball must contain the layout produced by `install.sh --bundle`:
#   agent/        (built agent with node_modules)
#   player-ui/    (built player UI)
#   bin/          (helper scripts)
set -eu

if [ -z "${SIGNAGE_UPDATE_URL:-}" ]; then
  echo "SIGNAGE_UPDATE_URL is not set in /etc/signage/agent.env — nothing to update from" >&2
  exit 1
fi

WORK="$(mktemp -d /tmp/signage-update.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "Downloading $SIGNAGE_UPDATE_URL"
curl -fsSL "$SIGNAGE_UPDATE_URL" -o "$WORK/release.tar.gz"
mkdir -p "$WORK/release"
tar -xzf "$WORK/release.tar.gz" -C "$WORK/release"

if [ ! -d "$WORK/release/agent/dist" ]; then
  echo "Tarball does not look like a signage release (missing agent/dist)" >&2
  exit 1
fi

# Swap in the new version; keep the previous one for manual rollback.
rm -rf /opt/signage/agent.previous /opt/signage/player-ui.previous
mv /opt/signage/agent /opt/signage/agent.previous
mv /opt/signage/player-ui /opt/signage/player-ui.previous
mv "$WORK/release/agent" /opt/signage/agent
mv "$WORK/release/player-ui" /opt/signage/player-ui
if [ -d "$WORK/release/bin" ]; then
  cp -f "$WORK/release/bin/"* /opt/signage/bin/
  chmod +x /opt/signage/bin/*
fi

echo "Update applied — restarting agent"
# Restart in the background so this command can still report success first.
(sleep 2 && systemctl restart signage-agent.service) &
echo "ok"
