#!/usr/bin/env bash
# Old-phone (Android 7 and below) launcher icons. Android 8+ uses the adaptive icon that patch-android.js writes.
set -e
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RES_DIR="$ROOT_DIR/android/app/src/main/res"
SRC_ICON="$ROOT_DIR/icon-192.png"
[ -f "$SRC_ICON" ] || { echo "icon-192.png is missing"; exit 1; }

for d in mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  mkdir -p "$RES_DIR/$d"
  cp "$SRC_ICON" "$RES_DIR/$d/ic_launcher.png"
  cp "$SRC_ICON" "$RES_DIR/$d/ic_launcher_round.png"
  # remove the default Capacitor foreground bitmap so it can never be picked up by mistake
  rm -f "$RES_DIR/$d/ic_launcher_foreground.png"
done
echo "Legacy icons copied."
