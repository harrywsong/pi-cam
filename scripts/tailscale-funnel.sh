#!/usr/bin/env bash
# Expose pi-cam to the public internet via Tailscale Funnel, so the two
# viewers can reach it from any browser without installing Tailscale
# themselves. Run on the Pi as root (or a user in the right group), after
# `tailscale up` has already associated the Pi with your tailnet.
#
# Prerequisites (one-time, in the Tailscale admin console):
#   - Enable HTTPS certificates for your tailnet (DNS -> HTTPS Certificates).
#   - Enable Funnel for this node (or your whole tailnet) under
#     Access controls, or run `tailscale funnel` once and follow the prompt.
#
# This maps one public hostname (https://<pi-name>.<tailnet>.ts.net) to two
# local backends by path, so the viewer page and the HLS stream it fetches
# are same-origin from the browser's point of view:
#   /          -> picam-web  (127.0.0.1:8080)  the login + player page
#   /home/*    -> mediamtx   (127.0.0.1:8888)   the HLS stream (auth-gated)

set -euo pipefail

echo "==> Mapping / -> web viewer (127.0.0.1:8080)"
tailscale serve --bg --https=443 / http://127.0.0.1:8080

echo "==> Mapping /home -> MediaMTX HLS output (127.0.0.1:8888)"
tailscale serve --bg --https=443 /home http://127.0.0.1:8888/home

echo "==> Enabling Funnel on 443"
tailscale funnel --bg 443 on

echo ""
echo "Current serve/funnel config:"
tailscale serve status

echo ""
echo "Find your public URL with: tailscale status (look for this device's"
echo "<name>.<tailnet>.ts.net hostname) and share https://<that hostname>/"
echo "with the two viewers, along with their person1/person2 credentials."
echo ""
echo "To undo: tailscale funnel --https=443 off && tailscale serve --https=443 off"
