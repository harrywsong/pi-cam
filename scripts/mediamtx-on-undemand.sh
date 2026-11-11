#!/bin/bash
# Run by MediaMTX itself (paths.home's runOnUnDemand in mediamtx.yml) the
# moment the last viewer disconnects — fires immediately, independently of
# runOnDemandCloseAfter's grace period before the capture process itself
# is actually stopped. Just plays a "nobody's watching anymore" chime; see
# scripts/mediamtx-on-demand.sh for why this goes through web/server.py's
# /play-tone instead of calling ffmpeg directly.
curl -s -m 2 -X POST "http://127.0.0.1:8080/play-tone?type=disconnect" >/dev/null 2>&1 || true
