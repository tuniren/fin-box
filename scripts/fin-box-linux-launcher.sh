#!/bin/sh

set -eu

app_binary=/opt/FinBox/fin-box-electron-react

if [ -n "${WAYLAND_DISPLAY:-}" ] && [ -n "${DISPLAY:-}" ]; then
  exec "$app_binary" --ozone-platform=x11 "$@"
fi

exec "$app_binary" "$@"
