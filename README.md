# pi-cam

A private, two-person home camera feed off a webcam plugged into a Raspberry Pi.

## Goals

- Only two specific people can ever view (and listen to) the feed.
- No ports exposed to the public internet, ever.
- Credentials are per-person, not shared.
- Survives reboots and crashes without manual intervention.

## Features

- **Video + audio.** The Logitech C920's built-in mic streams alongside
  video (listen-in only — the Pi has no speaker, so there's no talk-back).
- **Digital pan/zoom.** A custom web viewer (`web/`) lets each viewer
  independently crop/zoom into the frame client-side (drag to pan, scroll or
  pinch to zoom). This is software-only: the C920 has no motorized PTZ, so
  the camera itself never physically moves.
- **Custom viewer page**, served alongside MediaMTX's own built-in WebRTC/HLS
  pages, which still work as a fallback.

## Architecture

```
Webcam+mic --(v4l2+alsa)--> ffmpeg --(RTSP push, H264+Opus)--> MediaMTX --(WebRTC/HLS, authenticated)--> Tailscale --> your devices
                                                                   ^
                                                     web/ (static viewer: login, player, pan/zoom)
```

Two layers of access control, not one:

1. **Network layer — Tailscale.** The Pi only listens on its Tailscale
   (`tailscale0`) interface, never on its LAN/public interface. Tailscale is a
   WireGuard mesh VPN with identity-based ACLs — only devices you've
   explicitly authorized into the tailnet can reach the Pi at all. There is
   no port-forwarding on your router and nothing is reachable from the open
   internet. This is the single biggest security win here: an attacker who
   doesn't have a signed-in device in your tailnet cannot even send a packet
   to the stream port.
2. **Application layer — MediaMTX auth.** Even inside the tailnet, MediaMTX
   requires a username/password per stream path. Each of the two people gets
   their own bcrypt-hashed credential, so you can tell them apart in logs and
   revoke one without touching the other.

Why not just port-forward + HTTPS + basic auth? That's strictly weaker: it
puts a listening service on the public internet where it's scanned and
attacked constantly, and a single leaked password is enough. Tailscale
removes that entire attack surface.

## Repo layout

- `docs/SETUP.md` — step-by-step install guide for the Pi.
- `docs/THREAT_MODEL.md` — what this does and doesn't protect against.
- `mediamtx/mediamtx.yml` — MediaMTX config template (auth, paths, bind address).
- `systemd/` — systemd unit files for the capture, MediaMTX, and web viewer.
- `scripts/` — install/helper scripts to run on the Pi.
- `web/` — static custom viewer page (login, WebRTC player, pan/zoom controls).

Start with `docs/SETUP.md`.
