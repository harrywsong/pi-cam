# pi-cam

A private, two-person home camera feed off a webcam plugged into a Raspberry Pi.

## Goals

- Only two specific people can ever view the feed.
- No ports exposed to the public internet, ever.
- Credentials are per-person, not shared.
- Survives reboots and crashes without manual intervention.

## Architecture

```
Webcam --(v4l2)--> ffmpeg --(RTSP push)--> MediaMTX --(WebRTC/HLS, authenticated)--> Tailscale --> your devices
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
- `systemd/` — systemd unit files for the capture + server processes.
- `scripts/` — install/helper scripts to run on the Pi.

Start with `docs/SETUP.md`.
