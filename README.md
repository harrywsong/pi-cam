# pi-cam

A private, two-person home camera feed off a webcam plugged into a
Raspberry Pi — viewable from any browser, desktop or mobile, with no app
install required on the viewer's side.

## Goals

- Only two specific people can ever view (and listen to) the feed.
- Viewers need nothing but a browser — no app, no VPN client, no Tailscale
  account of their own.
- Credentials are per-person, not shared.
- Survives reboots and crashes without manual intervention.

## Features

- **The camera and mic only run while someone's actually watching.** MediaMTX
  starts the capture on the first viewer and stops it ~1 minute after the
  last one leaves (native `runOnDemand`/`runOnDemandCloseAfter`, not a
  custom scheduler) — no permanently-recording webcam, less wear, and
  shorter sessions sidestep a long-session AV-sync drift issue that showed
  up during testing. A short rising chime plays on the Bose speaker when a
  session starts, and a distinctly lower/falling one when it ends — a clear
  audible "you're on camera now" / "not anymore" signal for anyone in the
  room, independent of whether they're looking at anything.
- **Video + two-way audio.** The Logitech C920's built-in mic streams
  alongside video (listen-in), and a push-to-talk button lets a viewer
  speak into a USB speaker on the Pi (`web/server.py`, a small backend that
  decodes the viewer's mic audio and plays it out). A continuous,
  near-inaudible keep-alive tone (`picam-keepalive.service`) stops
  battery-powered portable speakers from auto-powering-off from "silence."
- **A settings panel**: pick which microphone to use, input volume (real
  gain, via Web Audio), and — where the browser supports it — which output
  device (speaker/headphones) plays the incoming stream.
- **Digital pan/zoom.** A custom web viewer (`web/`) lets each viewer
  independently crop/zoom into the frame client-side (drag to pan, scroll or
  pinch to zoom). This is software-only: the C920 has no motorized PTZ, so
  the camera itself never physically moves.
- **Works on desktop and mobile** out of the box: hls.js on Chrome/Firefox/
  Edge/Android, native HLS playback + the browser's own login prompt on
  Safari/iOS.
- **Low-latency HLS** (LL-HLS, ~1-2s instead of classic HLS's 6-10s), with
  ffmpeg's keyframe interval tuned to match MediaMTX's segment boundaries.
- **A real control bar**: play/pause, volume slider + mute, fullscreen, a
  live indicator, and the pan/zoom controls, auto-hiding after a few seconds
  idle, over a dark glass UI.
- **Korean + English**, auto-detected from the browser and switchable with
  one tap (`web/i18n.js`).

## Architecture

```
Webcam+mic --(v4l2+alsa)--> ffmpeg --(RTSP, H264+AAC)--> MediaMTX (HLS, auth)
     ^ started/stopped by MediaMTX's runOnDemand, only while someone's watching
                                                               |
                                                     127.0.0.1-only ports
                                                               |
                                                  Tailscale Funnel (local proxy)
                                                               |
                                                   https://<pi>.ts.net  <-- any browser
```

Only the **Pi** runs Tailscale. [Tailscale Funnel](https://tailscale.com/kb/1223/tailscale-funnel)
turns that into a public `https://<name>.<tailnet>.ts.net` URL — automatic
TLS, no router port-forwarding, no DDNS to manage — and reverse-proxies it
to services that are themselves bound to `127.0.0.1` only. Viewers never
join the tailnet; they just open the URL.

Because the stream is now reachable from the public internet (not gated by
tailnet membership), **credentials are the entire access control**. See
`docs/THREAT_MODEL.md` for what that does and doesn't protect against, and
the hardening checklist there (strong unique passwords are non-negotiable).

## Repo layout

- `docs/SETUP.md` — step-by-step install guide for the Pi.
- `docs/THREAT_MODEL.md` — what this does and doesn't protect against.
- `mediamtx/mediamtx.yml` — MediaMTX config template (auth, paths, bind address).
- `systemd/` — systemd unit files for MediaMTX, the web viewer, the
  keep-alive tone, and the firewall reapply-on-boot unit (the webcam/mic
  capture itself has no unit of its own — see `mediamtx.yml`'s `runOnDemand`).
- `scripts/` — install/firewall/Funnel helper scripts to run on the Pi, plus
  the two MediaMTX on-demand hook scripts (connect/disconnect chimes +
  starting the actual capture command).
- `web/` — viewer page (login, HLS player, pan/zoom, settings, push-to-talk)
  and `server.py`, the backend that serves it and handles push-to-talk audio
  and the connect/disconnect chimes.

Start with `docs/SETUP.md`.
