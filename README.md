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

- **Video + audio.** The Logitech C920's built-in mic streams alongside
  video (listen-in only — the Pi has no speaker, so there's no talk-back).
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
- `systemd/` — systemd unit files for the capture, MediaMTX, and web viewer.
- `scripts/` — install/firewall/Funnel helper scripts to run on the Pi.
- `web/` — static custom viewer page (login, HLS player, pan/zoom controls).

Start with `docs/SETUP.md`.
