# Setup guide

Read `docs/THREAT_MODEL.md` first so the "why" behind each step makes sense.

Only the **Pi** needs Tailscale installed. The two viewers just open a URL
in any normal browser on desktop or mobile — no app to install on their
side. Public reachability is via Tailscale Funnel; the only thing actually
gating access is the username/password each person has.

## 0. Prerequisites

- Raspberry Pi (any model with a USB port) running Raspberry Pi OS (or any
  Debian-based distro), with the webcam plugged in.
- Confirm the webcam shows up: `v4l2-ctl --list-devices` and
  `v4l2-ctl --device=/dev/video0 --list-formats-ext` (install `v4l-utils` if
  missing: `sudo apt install v4l-utils`). Note the device path (usually
  `/dev/video0`) and a supported resolution/framerate — adjust
  `systemd/picam-ffmpeg.service` if yours differs from 1280x720@15.

## 1. Install Tailscale on the Pi only

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Follow the printed login URL to associate the Pi with your tailnet. In the
Tailscale admin console (https://login.tailscale.com/admin):

- **DNS → HTTPS Certificates**: turn this on (required for Funnel's
  automatic TLS certs).
- **Access controls**: make sure Funnel is allowed for this node. A default
  ACL usually already permits it; if `scripts/tailscale-funnel.sh` later
  complains about Funnel not being enabled, it'll tell you which ACL
  attribute to add.

## 2. Run the installer

Clone/copy this repo onto the Pi, then:

```bash
sudo ./scripts/install.sh
```

This installs ffmpeg, downloads MediaMTX, creates a locked-down `picam`
system user, and installs the systemd units — but does not start anything
yet.

## 3. Pick ffmpeg capture settings

Check what your webcam actually supports:

```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

Edit `systemd/picam-ffmpeg.service`'s `ExecStart` line if your device isn't
MJPEG 1280x720@15 (e.g. switch `-input_format mjpeg` to `-input_format
yuyv422` if that's what it reports, and adjust resolution/framerate). Then:

```bash
sudo cp systemd/picam-ffmpeg.service /etc/systemd/system/
sudo systemctl daemon-reload
```

## 3b. Pick your microphone

The C920 (and most webcams) has a built-in mic, which is what
`PICAM_AUDIO_DEVICE` should normally point at. Find its ALSA device name:

```bash
arecord -l
```

Look for the webcam in the list (e.g. `card 2: C920 [HD Pro Webcam C920]`) and
use `plughw:CARD=C920,DEV=0` (substitute the actual card name) as
`PICAM_AUDIO_DEVICE` in `/etc/picam/ffmpeg.env` — see step 4. This is
listen-in audio only (Pi mic → viewers); there's no speaker on the Pi, so
there's no talk-back path.

## 4. Generate credentials (one per person)

MediaMTX's `internal` auth method accepts a sha256 hash of the password.
Generate one per person (do this locally, not pasted into chat/repo):

```bash
printf 'the-actual-password' | sha256sum | awk '{print $1}'
```

Put `sha256:<hash>` into `/etc/picam/mediamtx.yml` for `person1` and
`person2`, and a third one for `publisher` (the ffmpeg capture process).
**Pick long, random, unique passwords** — this is now the entire access
control, since the stream is reachable from the public internet via Funnel,
not just from a private tailnet. A password manager's generator is strongly
recommended over anything memorable. **Never commit real hashes or
passwords to this repo** — `mediamtx.yml` in this repo is a template with
placeholders only; the real one lives at `/etc/picam/mediamtx.yml` on the
Pi, outside git.

Then create the ffmpeg publisher's env file:

```bash
sudo tee /etc/picam/ffmpeg.env > /dev/null <<'EOF'
PICAM_PUBLISHER_PASS=the-publisher-password-you-hashed-above
PICAM_AUDIO_DEVICE=plughw:CARD=C920,DEV=0
EOF
sudo chmod 600 /etc/picam/ffmpeg.env
sudo chown picam:picam /etc/picam/ffmpeg.env /etc/picam/mediamtx.yml
```

## 5. Lock down the firewall

```bash
sudo ./scripts/firewall.sh
sudo nft list ruleset > /etc/nftables.conf
sudo systemctl enable nftables
```

This is defense in depth — `mediamtx.yml` and `picam-web.service` already
bind everything to `127.0.0.1`, so nothing is reachable from the LAN or
internet directly regardless. The only path in is Tailscale Funnel's own
local reverse proxy (next step).

## 6. Start everything

```bash
sudo systemctl enable --now mediamtx
sudo systemctl enable --now picam-ffmpeg
sudo systemctl enable --now picam-web
sudo systemctl status mediamtx picam-ffmpeg picam-web
```

Check logs if something's wrong: `journalctl -u mediamtx -f`,
`journalctl -u picam-ffmpeg -f`, `journalctl -u picam-web -f`.

## 7. Expose it publicly with Tailscale Funnel

```bash
sudo ./scripts/tailscale-funnel.sh
```

This maps your Pi's `https://<name>.<tailnet>.ts.net` hostname to the web
viewer (`/`) and MediaMTX's HLS output (`/home`), and turns Funnel on. See
the script's comments if `tailscale funnel` refuses to enable — it'll name
the missing admin-console setting.

## 8. View the feed

Share `https://<name>.<tailnet>.ts.net/` (find the exact hostname with
`tailscale status` on the Pi) with the two people, along with their
`person1`/`person2` username/password. From any browser, desktop or
mobile, no app install required:

- Open the URL. On Chrome/Firefox/Edge/Android, you'll get the custom
  viewer's login form (`web/`) — enter the username/password once, kept
  only in that browser tab's `sessionStorage`.
- On Safari/iOS, the page skips the form and the browser itself will pop up
  its native login dialog the first time it needs credentials (a `<video>`
  element can't attach custom headers, so this is the reliable path there).

Both give you: live video, listen-in audio from the Pi's mic, and digital
pan/zoom (drag to pan once zoomed in, scroll/pinch to zoom, ⤾ to reset) —
this crops into the fixed camera frame in software, it doesn't move the
camera, since the C920 has no motorized PTZ.

Bookmark the URL on each person's device/home screen.

## Optional: self-hosted control plane (Headscale)

If you don't want to trust Tailscale's hosted coordination server at all,
[Headscale](https://github.com/juanfont/headscale) is an open-source,
self-hosted, API-compatible replacement for the Pi's own `tailscale` client
to point at. Note Headscale does not support Funnel, though — you'd need a
different way to expose the stream publicly (your own reverse proxy +
DDNS + Let's Encrypt), which is a meaningfully bigger operational lift.
