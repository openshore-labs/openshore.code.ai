#!/usr/bin/env bash
# Pack the OpenShore server package (connect-anywhere, 2026-10-07): the built
# engine, its production dependencies, and the Node it runs on, as one tarball
# that install-server.sh unpacks to /opt/openshore/current. Run from the repo
# root after `pnpm --filter os-code build`, before anything rebuilds node-pty
# for Electron (the server runs Node's ABI, not Electron's).
#
#   os-code/scripts/pack-server.sh <version> <out-dir> [node-tarball]
#
# Without a node tarball it downloads the .nvmrc version from nodejs.org and
# checks it against that release's SHASUMS256.txt. The package is for the
# machine that packs it (x64 or arm64): node-pty is built for this machine's
# processor on install, so an arm64 package is packed on an arm64 runner.
set -euo pipefail

VERSION=${1:?version, like 0.1.9}
OUT=${2:?output directory}
NODE_TARBALL=${3:-}
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *)
    echo "pack-server.sh: no server package for $(uname -m)" >&2
    exit 1
    ;;
esac
NAME="openshore-server-$VERSION-linux-$ARCH"
NODE_VERSION=$(tr -d 'v[:space:]' <.nvmrc)
NODE_DIST="node-v$NODE_VERSION-linux-$ARCH"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ROOT="$STAGE/$NAME"
mkdir -p "$ROOT/bin" "$OUT"

if [ -z "$NODE_TARBALL" ]; then
  NODE_TARBALL="$STAGE/$NODE_DIST.tar.xz"
  curl -fsSL -o "$NODE_TARBALL" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_DIST.tar.xz"
  curl -fsSL -o "$STAGE/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$STAGE" && grep " $NODE_DIST.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
fi
mkdir -p "$ROOT/node"
tar -xJf "$NODE_TARBALL" -C "$ROOT/node" --strip-components=1
rm -rf "$ROOT/node/include" "$ROOT/node/share" "$ROOT/node/lib/node_modules/npm" \
  "$ROOT/node/lib/node_modules/corepack" "$ROOT/node/bin/npm" "$ROOT/node/bin/npx" \
  "$ROOT/node/bin/corepack"

# The engine and only its production dependencies, flattened out of the
# workspace. Source, tests and docs stay behind; dist is what runs.
pnpm --filter os-code deploy --prod --legacy "$ROOT/engine"
rm -rf "$ROOT/engine/src" "$ROOT/engine/test" "$ROOT/engine/docs" "$ROOT/engine/scripts" \
  "$ROOT/engine/curation"

cat >"$ROOT/bin/osc" <<'WRAP'
#!/bin/sh
# Runs the engine on the Node bundled beside it.
HERE=$(dirname "$(readlink -f "$0")")
exec "$HERE/../node/bin/node" "$HERE/../engine/dist/bin/osc.js" "$@"
WRAP
chmod 755 "$ROOT/bin/osc"
printf '%s\n' "$VERSION" >"$ROOT/VERSION"

# Owned by root in the archive, whoever packs it (tech review 2026-10-08):
# the runner's own user id must never own the engine on a server.
tar --owner=0 --group=0 --numeric-owner -czf "$OUT/$NAME.tar.gz" -C "$STAGE" "$NAME"
cp os-code/scripts/install-server.sh "$OUT/install-server.sh"
echo "Packed $OUT/$NAME.tar.gz"
