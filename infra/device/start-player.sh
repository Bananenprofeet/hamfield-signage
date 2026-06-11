#!/usr/bin/env bash
# Launched by xinit as the X session of the kiosk. Starts Chromium fullscreen
# pointed at the local agent's player server and restarts it if it crashes.
set -u

PLAYER_PORT="${SIGNAGE_PLAYER_PORT:-8080}"
PLAYER_URL="http://127.0.0.1:${PLAYER_PORT}"

# Never blank or power off the screen.
xset s off || true
xset s noblank || true
xset -dpms || true

# Find a Chromium binary (name differs across distros).
CHROMIUM=""
for candidate in chromium-browser chromium google-chrome; do
  if command -v "$candidate" > /dev/null 2>&1; then
    CHROMIUM="$candidate"
    break
  fi
done
if [ -z "$CHROMIUM" ]; then
  echo "No Chromium binary found — install chromium or chromium-browser" >&2
  exit 1
fi

PROFILE_DIR=/var/lib/signage/chromium-profile
mkdir -p "$PROFILE_DIR"

# Chromium shows a "restore pages?" bubble after a crash; clear the flag.
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$PROFILE_DIR/Default/Preferences" 2> /dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PROFILE_DIR/Default/Preferences" 2> /dev/null || true

# Keep relaunching the browser while the X session is alive; systemd
# restarts the whole unit if X itself dies.
while true; do
  "$CHROMIUM" \
    --kiosk "$PLAYER_URL" \
    --user-data-dir="$PROFILE_DIR" \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=TranslateUI \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    --no-first-run \
    --start-fullscreen
  sleep 2
done
