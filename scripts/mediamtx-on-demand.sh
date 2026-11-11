#!/bin/bash
# Run by MediaMTX itself (paths.home's runOnDemand in mediamtx.yml) the
# moment a viewer requests the stream and nobody's publishing yet. Plays a
# short "someone's watching now" chime (via web/server.py's /play-tone,
# since this script runs as the unprivileged `picam` user which can't
# reach the speaker's PipeWire session directly — see docs/THREAT_MODEL.md)
# and then becomes the actual capture process via `exec`, so MediaMTX's
# SIGINT-on-runOnDemandCloseAfter targets the real ffmpeg, not a wrapper.
set -u

TONE_SECRET="$(cat /etc/picam/tone-secret 2>/dev/null || true)"
curl -s -m 2 -X POST -H "X-Tone-Secret: $TONE_SECRET" \
  "http://127.0.0.1:8080/play-tone?type=connect" >/dev/null 2>&1 || true

# -framerate 15, not 30: measured directly with v4l2-ctl --stream-mmap on
# the real hardware, the C920 only *actually* delivers ~15fps sustained
# regardless of resolution (1080p and 720p both measured ~15fps), even
# though the driver happily accepts a 30fps request — classic UVC
# behavior, where auto-exposure extends shutter time in non-bright
# conditions and effectively halves the real frame rate. Requesting 30
# while only 15 arrive doesn't error, it just makes ffmpeg duplicate every
# other frame to pad up to the requested rate, which is what was actually
# behind "More than N frames duplicated" (a steady, fixed-rate duplication
# from the start, not drift) and almost certainly contributed to the
# playback instability reported over the real (Funnel) path. Asking for
# what the camera can actually deliver removes the whole problem.
#
# -use_wallclock_as_timestamps + -thread_queue_size: still worth keeping
# as a second line of defense against v4l2/ALSA clock drift between the
# two independent hardware clocks. -g/-keyint_min 15 (1s GOP at 15fps) +
# -sc_threshold 0 give a keyframe exactly once a second to cut LL-HLS
# segments on. -bf 0 drops reordering latency.
exec ffmpeg -hide_banner -loglevel warning \
  -use_wallclock_as_timestamps 1 -thread_queue_size 1024 \
  -f v4l2 -input_format mjpeg -video_size 1920x1080 -framerate 15 -i /dev/video0 \
  -use_wallclock_as_timestamps 1 -thread_queue_size 1024 \
  -f alsa -i "$PICAM_AUDIO_DEVICE" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset veryfast -tune zerolatency -g 15 -keyint_min 15 -sc_threshold 0 -bf 0 \
  -b:v 2000k -maxrate 2000k -bufsize 2000k \
  -c:a aac -b:a 96k -ar 44100 -ac 1 -af aresample=async=1 \
  -f rtsp -rtsp_transport tcp "rtsp://publisher:$PICAM_PUBLISHER_PASS@127.0.0.1:$RTSP_PORT/$MTX_PATH"
