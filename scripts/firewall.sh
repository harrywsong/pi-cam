#!/usr/bin/env bash
# Lock down pi-cam's ports so only Tailscale-tailnet traffic can reach them.
# Run on the Pi as root. Idempotent-ish: flushes and rebuilds the relevant
# chain rules each time you run it.
#
# Assumes ufw is NOT already managing these ports in a conflicting way.
# Adjust TAILSCALE_SUBNET if your tailnet uses a different CGNAT range
# (100.64.0.0/10 is Tailscale's default).

set -euo pipefail

TAILSCALE_SUBNET="100.64.0.0/10"
WEBRTC_PORT=8889
HLS_PORT=8888
# MediaMTX WebRTC also needs a UDP range for ICE/media; adjust to match
# your mediamtx.yml webrtcICEUDPMuxAddress / port range if you set one.
WEBRTC_ICE_UDP_RANGE="8189:8189"

echo "Installing nftables rules (tailnet-only access to pi-cam ports)..."

nft add table inet picam 2>/dev/null || true
nft flush table inet picam
nft add chain inet picam input '{ type filter hook input priority 0; policy accept; }'

# Allow from tailnet subnet
nft add rule inet picam input ip saddr "$TAILSCALE_SUBNET" tcp dport "{ $WEBRTC_PORT, $HLS_PORT }" accept
nft add rule inet picam input ip saddr "$TAILSCALE_SUBNET" udp dport "$WEBRTC_ICE_UDP_RANGE" accept

# Drop everything else hitting those ports, regardless of source
nft add rule inet picam input tcp dport "{ $WEBRTC_PORT, $HLS_PORT }" drop
nft add rule inet picam input udp dport "$WEBRTC_ICE_UDP_RANGE" drop

echo "Done. Verify with: sudo nft list table inet picam"
echo "Persist across reboots: sudo nft list ruleset > /etc/nftables.conf"
echo "                        sudo systemctl enable nftables"
