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
  `/dev/video0`) and a supported resolution/framerate — adjust the
  `runOnDemand` command in `mediamtx/mediamtx.yml` if yours differs from
  1920x1080@30 MJPEG.

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

The webcam+mic capture itself isn't a separate always-running service —
it's the `runOnDemand` command inside `mediamtx/mediamtx.yml`'s `paths.home`
section, which MediaMTX starts the moment someone's actually watching and
stops a minute after the last viewer leaves (see `docs/THREAT_MODEL.md` and
the comments in that file for why). Edit that command if your device isn't
MJPEG 1920x1080@30 (e.g. switch `-input_format mjpeg` to `-input_format
yuyv422` if that's what it reports, and adjust resolution/framerate — drop
`-b:v`/`-maxrate`/`-bufsize` proportionally for a lower resolution). Editing
`mediamtx.yml` doesn't need a restart — MediaMTX picks up path config
changes automatically.

## 3b. Pick your microphone

The C920 (and most webcams) has a built-in mic, which is what
`PICAM_AUDIO_DEVICE` should normally point at. Find its ALSA device name:

```bash
arecord -l
```

Look for the webcam in the list (e.g. `card 2: C920 [HD Pro Webcam C920]`) and
use `plughw:CARD=C920,DEV=0` (substitute the actual card name) as
`PICAM_AUDIO_DEVICE` in `/etc/picam/ffmpeg.env` — see step 4. This is
listen-in audio (Pi mic → viewers); for push-to-talk the other direction,
see step 3c.

## 3c. Set up push-to-talk (optional — needs a USB speaker)

If your Pi runs the default Raspberry Pi OS desktop, PipeWire/WirePlumber
(under your own login user) already claims any USB speaker exclusively —
confirm yours shows up:

```bash
pactl list sinks short
```

Two things make the speaker reachable from `picam-web`/`picam-keepalive`
(both of which run as your login user for exactly this reason — see
`docs/THREAT_MODEL.md` for the trade-off):

```bash
sudo loginctl enable-linger "$USER"   # keeps your PipeWire session (and the keep-alive tone) alive even logged out
sudo usermod -aG picam "$USER"        # lets your user read /etc/picam (mediamtx.yml, web/) which is otherwise picam-only
```

`systemd/picam-web.service` and `systemd/picam-keepalive.service` both
assume UID 1000 (`/run/user/1000/pulse/native`) and `User=hws` — edit both
files to match your actual username/UID (`id "$USER"`) before installing
them if they differ.

Test playback: `ffmpeg -f lavfi -i sine=frequency=440 -ac 2 -t 2 -f pulse default`
should play a short beep. Then enable the keep-alive tone (battery-powered
portable speakers auto-power-off after a few minutes of silence otherwise —
this plays a continuous, near-inaudible 19Hz tone to prevent that):

```bash
sudo systemctl enable --now picam-keepalive
```

If you don't have a speaker, skip this step — the mic selector and
push-to-talk button still appear in the settings panel but will show an
error when pressed, since there's nowhere for the audio to play.

## 4. Generate credentials (one per person)

MediaMTX's `internal` auth method accepts a sha256 hash of the password —
but it must be the **base64-encoded** digest, not hex (`sha256sum`'s default
output). Using hex will silently fail auth with a 401. Generate one per
person (do this locally, not pasted into chat/repo):

```bash
printf 'the-actual-password' | openssl dgst -sha256 -binary | base64
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

Then create the env file (loaded by `mediamtx.service`, which is what
actually runs the capture command — see `mediamtx.yml`'s `runOnDemand`):

```bash
sudo tee /etc/picam/ffmpeg.env > /dev/null <<'EOF'
PICAM_PUBLISHER_PASS=the-publisher-password-you-hashed-above
PICAM_AUDIO_DEVICE=plughw:CARD=C920,DEV=0
EOF
sudo chmod 600 /etc/picam/ffmpeg.env
sudo chown picam:picam /etc/picam/ffmpeg.env /etc/picam/mediamtx.yml
```

(If you ever change this file later — e.g. a new mic — `sudo systemctl
restart mediamtx` to pick it up; unlike `mediamtx.yml`'s path settings,
`EnvironmentFile` is only read at process start.)

## 5. Lock down the firewall

```bash
sudo systemctl enable --now picam-firewall
```

This is defense in depth — `mediamtx.yml` and `picam-web.service` already
bind everything to `127.0.0.1`, so nothing is reachable from the LAN or
internet directly regardless. The only path in is Tailscale Funnel's own
local reverse proxy (next step).

**Don't** persist this with `nft list ruleset > /etc/nftables.conf` — on a
Pi that's already running Tailscale (or Docker, or anything else that
manages its own iptables/nftables rules), that command snapshots *all*
currently-loaded tables, including ones those services recreate themselves
on every boot (e.g. Tailscale's own `ts-input`/`ts-forward` chains), and
freezing a stale copy of those into a static boot-time file can conflict
with what they set up fresh at startup. `picam-firewall.service` avoids
that: it only ever (re)applies `firewall.sh`'s own `inet picam` table on
boot, never anyone else's rules.

## 6. Start everything

```bash
sudo systemctl enable --now mediamtx
sudo systemctl enable --now picam-web
sudo systemctl status mediamtx picam-web
```

There's no `picam-ffmpeg` service to start — MediaMTX runs that command
itself, on demand, as configured in `mediamtx.yml`. Check logs if
something's wrong: `journalctl -u mediamtx -f` (the capture command's own
output shows up interleaved in here, since MediaMTX is what's running it),
`journalctl -u picam-web -f`.

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

The camera and mic aren't running 24/7 — MediaMTX starts that capture the
moment the page actually requests the stream, so the very first connect
can take a couple of seconds longer than normal while it spins up (the
viewer's own auto-reconnect logic covers this, no action needed), and it
stops itself again about a minute after the last viewer disconnects. If
you set up a speaker in step 3c, a short rising chime plays when a session
starts and a lower/falling one when it ends — audible to anyone in the
room regardless of whether they're looking at a screen.

Both playback paths give you: live video, listen-in audio from the Pi's
mic, digital pan/zoom (drag to pan once zoomed in, scroll/pinch to zoom,
⤾ to reset) — this crops into the fixed camera frame in software, it
doesn't move the camera, since the C920 has no motorized PTZ — and the
gear icon opens a settings panel for picking a microphone, input volume,
and (where the browser supports `setSinkId`, mainly Chrome) which output
device the stream plays through. The mic-shaped button is push-to-talk,
if you set up a speaker in step 3c. The language toggle (EN/KO) remembers
your choice.

Bookmark the URL on each person's device/home screen.

## Optional: self-hosted control plane (Headscale)

If you don't want to trust Tailscale's hosted coordination server at all,
[Headscale](https://github.com/juanfont/headscale) is an open-source,
self-hosted, API-compatible replacement for the Pi's own `tailscale` client
to point at. Note Headscale does not support Funnel, though — you'd need a
different way to expose the stream publicly (your own reverse proxy +
DDNS + Let's Encrypt), which is a meaningfully bigger operational lift.
