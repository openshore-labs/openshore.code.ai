#!/bin/sh
# OpenShore on your server (connect-anywhere, 2026-10-07).
#
#   curl -fsSL https://github.com/openshore-labs/openshore-releases/releases/latest/download/install-server.sh | sh
#
# Puts the OpenShore engine on a Linux server you rent (any provider) or keep
# at home, so your phone and desktop can dock to it over your own Tailscale
# network. What it does, in order:
#   1. checks this is Linux on x64 and that Tailscale is up (it never installs
#      network software for you: it prints Tailscale's own line and stops);
#   2. downloads the newest server package and its .sig from the public
#      release, and refuses it unless the signature checks against the
#      OpenShore desktop release key pinned below (the same key the desktop
#      app pins in app/electron/releaseKeys.ts);
#   3. unpacks it to /opt/openshore (Node is bundled), links `osc`, makes an
#      `openshore` system user, and starts a systemd service running
#      `osc serve --bind tailscale` that restarts on failure and on boot;
#   4. runs `osc pair --server`, which prints a QR for your phone and asks you
#      here whether the phone may dock.
# The daemon never listens on a public address; only your tailnet reaches it.
# Nothing is sent to OpenShore. Read this file before you run it.
set -eu

RELEASES="https://github.com/openshore-labs/openshore-releases/releases"
# The desktop release key's public half (base64 of the 32 raw Ed25519 bytes).
# Kept equal to DESKTOP_RELEASE_PUBLIC_KEY by os-code/test/installServer.test.ts.
RELEASE_PUBLIC_KEY="eZhSikfaYlS9xRQnFK6331uUw2/n/y92SclmhRJUnlI="
PREFIX="/opt/openshore"
SERVICE_USER="openshore"

say() { printf '%s\n' "$*"; }
fail() { printf 'OpenShore: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || fail "this installer is for a Linux server."
case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  *) fail "this server is $(uname -m); the server package is x64 only for now." ;;
esac

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else
  command -v sudo >/dev/null 2>&1 || fail "run this as root, or install sudo."
  SUDO="sudo"
fi
for tool in curl tar openssl sha256sum base64 systemctl; do
  command -v "$tool" >/dev/null 2>&1 || fail "it needs $tool, which this server does not have."
done

if ! command -v tailscale >/dev/null 2>&1 || ! tailscale ip -4 >/dev/null 2>&1; then
  say "Tailscale is how your phone reaches this server, and it is not up here yet."
  say "Install it and sign in to the same tailnet as your phone, then run this again:"
  say "  curl -fsSL https://tailscale.com/install.sh | sh"
  say "  sudo tailscale up"
  exit 1
fi

# The newest release's tag, from GitHub's own redirect.
LATEST_URL=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$RELEASES/latest") ||
  fail "could not reach GitHub to find the newest release."
TAG=${LATEST_URL##*/}
VERSION=${TAG#v}
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "the newest release has an unexpected name ($TAG)." ;;
esac
ASSET="openshore-server-$VERSION-linux-$ARCH.tar.gz"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
say "Downloading OpenShore $VERSION for this server."
curl -fsSL -o "$WORK/$ASSET" "$RELEASES/download/$TAG/$ASSET" ||
  fail "this release has no server package yet ($ASSET)."
curl -fsSL -o "$WORK/$ASSET.sig" "$RELEASES/download/$TAG/$ASSET.sig" ||
  fail "the server package has no signature, so it is not installed."

# The signed message is exactly "openshore-release-v1\n<asset>\n<sha256 hex>",
# as app/electron/releaseVerify.ts and app/scripts/release-sign.mjs have it.
SHA=$(sha256sum "$WORK/$ASSET" | cut -d' ' -f1)
printf 'openshore-release-v1\n%s\n%s' "$ASSET" "$SHA" >"$WORK/message"
base64 -d "$WORK/$ASSET.sig" >"$WORK/sig.bin" 2>/dev/null || fail "the signature is unreadable."
# An Ed25519 SubjectPublicKeyInfo is a fixed 12-byte prefix (hex
# 302a300506032b6570032100, written here in octal) plus the 32 raw bytes.
{
  printf '%s\n' '-----BEGIN PUBLIC KEY-----'
  {
    printf '\060\052\060\005\006\003\053\145\160\003\041\000'
    printf '%s' "$RELEASE_PUBLIC_KEY" | base64 -d
  } | base64 -w0
  printf '\n%s\n' '-----END PUBLIC KEY-----'
} >"$WORK/key.pem"
openssl pkeyutl -verify -pubin -inkey "$WORK/key.pem" -rawin \
  -in "$WORK/message" -sigfile "$WORK/sig.bin" >/dev/null 2>&1 ||
  fail "the signature does not match OpenShore's release key. Nothing was installed."
say "Signature checked."

$SUDO mkdir -p "$PREFIX"
$SUDO rm -rf "$PREFIX/current.new"
$SUDO mkdir -p "$PREFIX/current.new"
$SUDO tar -xzf "$WORK/$ASSET" -C "$PREFIX/current.new" --strip-components=1
$SUDO rm -rf "$PREFIX/current.old"
[ -d "$PREFIX/current" ] && $SUDO mv "$PREFIX/current" "$PREFIX/current.old"
$SUDO mv "$PREFIX/current.new" "$PREFIX/current"
$SUDO ln -sf "$PREFIX/current/bin/osc" /usr/local/bin/osc

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  $SUDO useradd --system --create-home --home-dir "/var/lib/$SERVICE_USER" \
    --shell /usr/sbin/nologin "$SERVICE_USER"
fi
$SUDO chmod 700 "/var/lib/$SERVICE_USER"

$SUDO tee /etc/systemd/system/openshore.service >/dev/null <<'UNIT'
[Unit]
Description=OpenShore engine (docked over your tailnet)
Wants=network-online.target tailscaled.service
After=network-online.target tailscaled.service

[Service]
User=openshore
Environment=HOME=/var/lib/openshore
ExecStart=/usr/local/bin/osc serve --bind tailscale
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now openshore.service >/dev/null
$SUDO systemctl restart openshore.service
$SUDO rm -rf "$PREFIX/current.old"
say "OpenShore $VERSION is running on this server, and starts again on boot."

# Give the service a moment to bind, then dock a phone, as the service's own
# user so the code comes from the daemon that is running.
sleep 2
say ""
say "Now dock your phone: open OpenShore, Computer, Dock to a server, and scan."
if [ -n "$SUDO" ]; then AS_SERVICE="sudo -u $SERVICE_USER"; else AS_SERVICE="runuser -u $SERVICE_USER --"; fi
$AS_SERVICE env HOME="/var/lib/$SERVICE_USER" /usr/local/bin/osc pair --server </dev/tty ||
  say "Run this later to dock a phone: sudo -u $SERVICE_USER env HOME=/var/lib/$SERVICE_USER osc pair --server"
