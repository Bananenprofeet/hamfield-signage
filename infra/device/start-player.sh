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

# Size the kiosk to the connected display's active mode. No window manager runs
# in this kiosk, so nothing auto-maximizes Chromium — we must pass the window
# size explicitly, and some ARM boards come up with an oversized/double-height
# canvas, so we also pin the framebuffer to the visible mode. Detect the active
# mode of the first connected output; fall back to 1080p if detection fails.
SCREEN_W=1920
SCREEN_H=1080
if command -v xrandr > /dev/null 2>&1; then
  OUTPUT="$(xrandr | awk '/ connected/{print $1; exit}')"
  MODE="$(xrandr | awk '/ connected/{c=1; next} c && /\*/{print $1; exit}')"
  if [ -n "$OUTPUT" ] && [ -n "$MODE" ]; then
    xrandr --output "$OUTPUT" --mode "$MODE" --pos 0x0 --fb "$MODE" || true
    SCREEN_W="${MODE%x*}"
    SCREEN_H="${MODE#*x}"
  fi
fi

# Find a Chromium binary (name differs across distros). Prefer the real
# `chromium` over `chromium-browser`, which on Ubuntu is a snap stub that
# cannot run under this systemd service.
CHROMIUM=""
for candidate in chromium chromium-browser google-chrome; do
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
    --window-position=0,0 \
    --window-size="${SCREEN_W},${SCREEN_H}" \
    --force-device-scale-factor=1 \
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
