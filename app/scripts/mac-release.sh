#!/bin/bash
# Build the Mac desktop app on this Mac and ship it into a GitHub release, the
# local twin of codemagic.yaml's mac-desktop job (founder, 2026-09-23: the Mac
# build is also made by hand, offline, as a dmg).
#
#   pnpm --filter oscode-app release:mac            # newest release
#   pnpm --filter oscode-app release:mac v0.1.7     # a specific one
#   pnpm --filter oscode-app release:mac --no-upload
#
# It stamps the app with that release's version (so an installed Mac compares
# versions correctly and its update bar clears after updating), builds
# unsigned, then uploads the dmg and zip into the release. The desktop app's
# own updater (electron/main.ts) picks either one up, so a Mac that is behind
# shows its update bar and updates in one click. With --no-upload, or with no
# network, it only builds: the files are in app/release/ to hand out directly
# or upload later with `gh release upload <tag> release/*.dmg release/*.zip`.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=openshore-labs/openshore.code.ai
UPLOAD=1
TAG=""
for arg in "$@"; do
  case "$arg" in
    --no-upload) UPLOAD=0 ;;
    v*) TAG="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(uname)" != "Darwin" ]; then
  echo "This builds the macOS app, so it has to run on a Mac." >&2
  exit 1
fi

if [ -z "$TAG" ]; then
  if command -v gh >/dev/null 2>&1 && TAG=$(gh release view --repo "$REPO" --json tagName -q .tagName 2>/dev/null); then
    echo "Building for the newest release, $TAG."
  else
    echo "Could not look up the newest release (no gh, not signed in, or offline)." >&2
    echo "Pass the tag to build for, for example: release:mac v0.1.7" >&2
    exit 1
  fi
fi
VERSION="${TAG#v}"

ORIGINAL=$(node -p "require('./package.json').version")
restore() { npm pkg set version="$ORIGINAL" >/dev/null; }
trap restore EXIT
npm pkg set version="$VERSION" >/dev/null
echo "Stamped version $VERSION (restored to $ORIGINAL when done)."

rm -f release/*.dmg release/*.zip release/*.blockmap release/latest-mac.yml
pnpm --filter os-code build
pnpm --filter oscode-app build
pnpm --filter oscode-app rebuild:native
pnpm exec electron-builder --mac --publish never

shopt -s nullglob
FILES=(release/*.dmg release/*.zip release/*.blockmap release/latest-mac.yml)
echo "Built:"; printf '  %s\n' "${FILES[@]}"

if [ "$UPLOAD" = 0 ]; then
  echo "Skipping the upload (--no-upload)."
  exit 0
fi
if ! gh release upload "$TAG" --repo "$REPO" --clobber "${FILES[@]}"; then
  echo "The upload did not go through (offline?). The files are in app/release/;" >&2
  echo "upload them later with: gh release upload $TAG --repo $REPO --clobber release/*.dmg release/*.zip" >&2
  exit 1
fi
echo "Uploaded to $TAG. Installed Macs behind it will show the update bar."
