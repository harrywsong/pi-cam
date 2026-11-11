#!/bin/bash
# Run by MediaMTX itself (paths.home's runOnUnDemand in mediamtx.yml) the
# moment the last viewer disconnects — fires immediately, independently of
# runOnDemandCloseAfter's grace period before the capture process itself
# is actually stopped. Just plays a "nobody's watching anymore" chime; see
# scripts/mediamtx-on-demand.sh for why this goes through web/server.py's
# /play-tone instead of calling ffmpeg directly.
TONE_SECRET="$(cat /etc/picam/tone-secret 2>/dev/null || true)"
curl -s -m 2 -X POST -H "X-Tone-Secret: $TONE_SECRET" \
  "http://127.0.0.1:8080/play-tone?type=disconnect" >/dev/null 2>&1 || true
