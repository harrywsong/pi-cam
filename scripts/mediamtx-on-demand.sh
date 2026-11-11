#!/bin/bash
# Run by MediaMTX itself (paths.home's runOnDemand in mediamtx.yml) the
# moment a viewer requests the stream and nobody's publishing yet. Plays a
# short "someone's watching now" chime (via web/server.py's /play-tone,
# since this script runs as the unprivileged `picam` user which can't
# reach the speaker's PipeWire session directly — see docs/THREAT_MODEL.md)
# and then becomes the actual capture process via `exec`, so MediaMTX's
# SIGINT-on-runOnDemandCloseAfter targets the real ffmpeg, not a wrapper.
set -u

curl -s -m 2 -X POST "http://127.0.0.1:8080/play-tone?type=connect" >/dev/null 2>&1 || true

# -use_wallclock_as_timestamps + -thread_queue_size: the webcam's v4l2
# clock and the mic's ALSA clock are two independent hardware clocks that
# drift against each other without a shared timestamp source, which
# otherwise shows up as progressively duplicated frames and eventually an
# ALSA buffer xrun over a long session. -g/-keyint_min 30 (1s GOP at 30fps)
# + -sc_threshold 0 give a keyframe exactly once a second to cut LL-HLS
# segments on. -bf 0 drops reordering latency.
exec ffmpeg -hide_banner -loglevel warning \
  -use_wallclock_as_timestamps 1 -thread_queue_size 1024 \
  -f v4l2 -input_format mjpeg -video_size 1920x1080 -framerate 30 -i /dev/video0 \
  -use_wallclock_as_timestamps 1 -thread_queue_size 1024 \
  -f alsa -i "$PICAM_AUDIO_DEVICE" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset veryfast -tune zerolatency -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
  -b:v 3000k -maxrate 3000k -bufsize 3000k \
  -c:a aac -b:a 96k -ar 44100 -ac 1 -af aresample=async=1 \
  -f rtsp -rtsp_transport tcp "rtsp://publisher:$PICAM_PUBLISHER_PASS@127.0.0.1:$RTSP_PORT/$MTX_PATH"
