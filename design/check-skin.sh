#!/usr/bin/env bash
# Preview a device skin in the three reference styles (default, flat, host brand).
# Usage: design/check-skin.sh <skin> [out-dir]
#   <skin>    a file name in packages/studio/src/skins/ (also linked as design/kit/skins/) without .css, e.g. basalt, quartz, cobalt
#   [out-dir] where to write PNGs (default: a new temp dir)
# Output: <out-dir>/<skin>-default.png, -flat.png, -brand.png and <skin>-check.png (all three stacked).
# Needs: firefox (headless). ImageMagick 'convert' is optional (for the stacked image).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
skin="${1:?usage: design/check-skin.sh <skin> [out-dir]}"
[[ "$skin" =~ ^[a-z0-9-]+$ ]] || { echo "skin name must be lowercase letters, digits, dashes" >&2; exit 1; }
[[ -f "$here/kit/skins/$skin.css" ]] || { echo "no skin file: design/kit/skins/$skin.css" >&2; exit 1; }
grep -q "skins/$skin.css" "$here/kit/index.html" || { echo "add <link rel=\"stylesheet\" href=\"skins/$skin.css\"> to design/kit/index.html first" >&2; exit 1; }
out="${2:-$(mktemp -d)}"; mkdir -p "$out"
profile="$(mktemp -d)"; trap 'rm -rf "$profile"' EXIT
for theme in default flat brand; do
  t="$theme"; [[ "$t" == default ]] && t=""
  url="file://$here/kit/index.html?skin=$skin&theme=$t&solo=1"
  timeout 90 firefox --headless --no-remote --profile "$profile" --window-size=1280,860 \
    --screenshot "$out/$skin-$theme.png" "$url" >/dev/null 2>&1 || true
  [[ -s "$out/$skin-$theme.png" ]] || { echo "screenshot failed for $theme" >&2; exit 1; }
done
if command -v convert >/dev/null; then
  convert "$out/$skin-default.png" "$out/$skin-flat.png" "$out/$skin-brand.png" -resize 50% -append "$out/$skin-check.png"
  echo "$out/$skin-check.png"
else
  ls "$out"/"$skin"-*.png
fi
