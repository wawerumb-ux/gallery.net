#!/usr/bin/env bash
# Build the Wasm app into dist/ and stage the static assets it shares with
# the JavaScript gallery one directory up (stylesheets, images, logo). The
# image tree is ~900MB, so locally it is symlinked rather than copied.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="${SITE_ROOT:-$(dirname "$HERE")}"

cd "$HERE"
trunk build --release "$@"

cp "$SITE/style.css" "$SITE/download-button.css" "$SITE/hcg-toast.css" dist/
cp -r "$SITE/logo" dist/
ln -sfn "$SITE/images" dist/images
ln -sfn "$SITE/video" dist/video
ln -sfn "$SITE/gallery.json" dist/gallery.json

echo
echo "dist/ is ready:"
du -sh dist
ls -la dist | grep -vE '^total|^d' | awk '{printf "  %-42s %8s\n", $9, $5}'
