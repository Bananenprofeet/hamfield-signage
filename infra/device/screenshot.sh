#!/usr/bin/env bash
# Used by the take_screenshot remote command. The agent calls this with one
# argument: the PNG output path.
set -eu

OUT="${1:?usage: screenshot.sh <output.png>}"
export DISPLAY="${DISPLAY:-:0}"

if command -v scrot > /dev/null 2>&1; then
  scrot -o "$OUT"
elif command -v import > /dev/null 2>&1; then
  import -window root "$OUT"
else
  echo "No screenshot tool found (install scrot)" >&2
  exit 1
fi
