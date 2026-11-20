#!/usr/bin/env bash
# Makes the Android launcher icon PNGs from the Workman Chat logo (needs ImageMagick).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="${1:-$ROOT/android/app/src/main/res}"
CONVERT="$(command -v magick || command -v convert)"
# density  legacy-size  adaptive-foreground-size
for spec in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r d legacy fg <<< "$spec"
  dir="$RES/mipmap-$d"
  mkdir -p "$dir"
  "$CONVERT" "$ROOT/icon-512.png" -resize "${legacy}x${legacy}" "$dir/ic_launcher.png"
  "$CONVERT" "$ROOT/icon-512.png" -resize "${legacy}x${legacy}" \
    \( +clone -alpha extract -fill black -colorize 100 -fill white -draw "circle $((legacy/2)),$((legacy/2)) $((legacy/2)),0" \) \
    -alpha off -compose CopyOpacity -composite "$dir/ic_launcher_round.png"
  "$CONVERT" "$ROOT/icon-maskable-512.png" -resize "${fg}x${fg}" "$dir/wc_foreground.png"
done
echo "Launcher icons written to $RES"
