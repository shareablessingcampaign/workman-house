#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RES_DIR="$ROOT_DIR/android/app/src/main/res"
SRC_ICON="$ROOT_DIR/icon-512.png"

if [ ! -f "$SRC_ICON" ]; then
  SRC_ICON="$ROOT_DIR/icon-192.png"
fi

for d in mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  mkdir -p "$RES_DIR/$d"
  if [ -f "$SRC_ICON" ]; then
    cp "$SRC_ICON" "$RES_DIR/$d/ic_launcher.png"
    cp "$SRC_ICON" "$RES_DIR/$d/ic_launcher_round.png"
    cp "$SRC_ICON" "$RES_DIR/$d/ic_launcher_foreground.png"
  fi
done

echo "Icons copied to Android mipmap folders."
