#!/usr/bin/env bash
# Belt-and-suspenders lockdown for pi-cam's internal ports. Run on the Pi as
# root. Idempotent-ish: flushes and rebuilds the relevant chain rules each
# time you run it.
#
# Everything (MediaMTX's RTSP/HLS/API and the picam-web viewer) is already
# bound to 127.0.0.1 only in mediamtx.yml and picam-web.service, so none of
# it is reachable from the LAN or the internet at the OS level regardless.
# The only path in is Tailscale Funnel's own local reverse proxy
# (scripts/tailscale-funnel.sh), which also connects over loopback.
#
# These nftables rules exist purely as defense in depth, in case a future
# change accidentally rebinds one of these services to a real interface.

set -euo pipefail

HLS_PORT=8888
WEB_UI_PORT=8080
RTSP_PORT=8554
API_PORT=9997
METRICS_PORT=9998

echo "Installing nftables rules (drop any external traffic to pi-cam's internal ports)..."

nft add table inet picam 2>/dev/null || true
nft flush table inet picam
nft add chain inet picam input '{ type filter hook input priority 0; policy accept; }'

# Loopback traffic (ffmpeg -> MediaMTX, Funnel's local proxy -> services) is
# always allowed; everything else hitting these ports is dropped regardless
# of source, since nothing legitimate should ever reach them non-locally.
nft add rule inet picam input iifname lo accept
nft add rule inet picam input tcp dport "{ $HLS_PORT, $WEB_UI_PORT, $RTSP_PORT, $API_PORT, $METRICS_PORT }" drop

echo "Done. Verify with: sudo nft list table inet picam"
echo "Persist across reboots: sudo nft list ruleset > /etc/nftables.conf"
echo "                        sudo systemctl enable nftables"
