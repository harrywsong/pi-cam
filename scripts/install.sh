#!/usr/bin/env bash
# pi-cam install script — run on the Raspberry Pi as root (sudo).
# Installs ffmpeg + MediaMTX, lays out config/service files, and creates the
# dedicated system user. Does NOT install/configure Tailscale (do that
# first — see docs/SETUP.md step 1) and does NOT generate your password
# hashes (step 4 in docs/SETUP.md — interactive on purpose).

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo ./install.sh" >&2
  exit 1
fi

MEDIAMTX_VERSION="v1.9.3"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64) MEDIAMTX_ARCH="arm64v8" ;;
  armv7l)  MEDIAMTX_ARCH="armv7" ;;
  *) echo "Unsupported arch: $ARCH (edit this script to add it)" >&2; exit 1 ;;
esac

echo "==> Installing ffmpeg"
apt-get update
apt-get install -y ffmpeg nftables python3 alsa-utils

echo "==> Creating picam system user"
id -u picam &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin -G video,audio picam

echo "==> Downloading MediaMTX ${MEDIAMTX_VERSION} (${MEDIAMTX_ARCH})"
TMPDIR="$(mktemp -d)"
curl -L -o "$TMPDIR/mediamtx.tar.gz" \
  "https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_${MEDIAMTX_ARCH}.tar.gz"
tar -xzf "$TMPDIR/mediamtx.tar.gz" -C "$TMPDIR"
install -m 755 "$TMPDIR/mediamtx" /usr/local/bin/mediamtx
rm -rf "$TMPDIR"

echo "==> Laying out config directory /etc/picam"
mkdir -p /etc/picam
if [[ ! -f /etc/picam/mediamtx.yml ]]; then
  cp "$(dirname "$0")/../mediamtx/mediamtx.yml" /etc/picam/mediamtx.yml
  echo "    -> copied template; EDIT /etc/picam/mediamtx.yml with real password hashes before starting."
else
  echo "    -> /etc/picam/mediamtx.yml already exists, leaving it alone."
fi
chown -R picam:picam /etc/picam
chmod 750 /etc/picam

echo "==> Laying out web viewer /etc/picam/web"
mkdir -p /etc/picam/web
cp "$(dirname "$0")/../web/"*.html "$(dirname "$0")/../web/"*.js "$(dirname "$0")/../web/"*.css /etc/picam/web/
chown -R picam:picam /etc/picam/web

echo "==> Installing systemd units"
cp "$(dirname "$0")/../systemd/mediamtx.service" /etc/systemd/system/mediamtx.service
cp "$(dirname "$0")/../systemd/picam-ffmpeg.service" /etc/systemd/system/picam-ffmpeg.service
cp "$(dirname "$0")/../systemd/picam-web.service" /etc/systemd/system/picam-web.service
systemctl daemon-reload

echo ""
echo "Install complete. Remaining manual steps (see docs/SETUP.md):"
echo "  1. Generate password hashes and fill in /etc/picam/mediamtx.yml"
echo "  2. Create /etc/picam/ffmpeg.env with PICAM_PUBLISHER_PASS and PICAM_AUDIO_DEVICE"
echo "  3. chmod 600 /etc/picam/ffmpeg.env && chown picam:picam /etc/picam/ffmpeg.env"
echo "  4. Confirm /dev/video0 is your webcam (v4l2-ctl --list-devices) and find your"
echo "     mic with 'arecord -l' for PICAM_AUDIO_DEVICE"
echo "  5. Run scripts/firewall.sh"
echo "  6. systemctl enable --now mediamtx picam-ffmpeg picam-web"
