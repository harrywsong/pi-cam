# Setup guide

Read `docs/THREAT_MODEL.md` first so the "why" behind each step makes sense.

## 0. Prerequisites

- Raspberry Pi (any model with a USB port) running Raspberry Pi OS (or any
  Debian-based distro), with the webcam plugged in.
- Two people, each with their own device(s) (phone/laptop) that can run the
  Tailscale app.
- Confirm the webcam shows up: `v4l2-ctl --list-devices` and
  `v4l2-ctl --device=/dev/video0 --list-formats-ext` (install `v4l-utils` if
  missing: `sudo apt install v4l-utils`). Note the device path (usually
  `/dev/video0`) and a supported resolution/framerate — adjust
  `systemd/picam-ffmpeg.service` if yours differs from 1280x720@15.

## 1. Install Tailscale on the Pi and both viewers' devices

On the Pi:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Follow the printed login URL to associate the Pi with your tailnet. Do the
same (install the Tailscale app, sign in) on each of the two people's
phones/laptops — they need to use the **same tailnet** (e.g. invite them as
shared users, or add their accounts, depending on how your tailnet is
organized).

In the Tailscale admin console (https://login.tailscale.com/admin):

- **Settings → Device management**: turn on "require re-authentication" and
  "device approval" so a stolen/reused login can't silently add a device.
- **Access controls (ACLs)**: scope things down so only the two people's
  devices/tags can reach the Pi's node. Example ACL snippet (adapt tags/users
  to your actual tailnet):

  ```json
  {
    "acls": [
      {
        "action": "accept",
        "src": ["user1@example.com", "user2@example.com"],
        "dst": ["tag:picam:8888,8889"]
      }
    ],
    "tagOwners": {
      "tag:picam": ["user1@example.com"]
    }
  }
  ```

  Then tag the Pi's device: `sudo tailscale up --advertise-tags=tag:picam`.

This step is what actually enforces "only two people" at the network level —
everything else is defense in depth on top of it.

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

## 4. Generate credentials (one per person)

MediaMTX's `internal` auth method accepts a sha256 hash of the password.
Generate one per person (do this locally, not pasted into chat/repo):

```bash
printf 'the-actual-password' | sha256sum | awk '{print $1}'
```

Put `sha256:<hash>` into `/etc/picam/mediamtx.yml` for `person1` and
`person2`, and a third one for `publisher` (the ffmpeg capture process).
Pick three distinct, strong, random passwords — a password manager's
generator is fine. **Never commit real hashes or passwords to this repo** —
`mediamtx.yml` in this repo is a template with placeholders only; the real
one lives at `/etc/picam/mediamtx.yml` on the Pi, outside git.

Then create the ffmpeg publisher's env file:

```bash
sudo tee /etc/picam/ffmpeg.env > /dev/null <<'EOF'
PICAM_PUBLISHER_PASS=the-publisher-password-you-hashed-above
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

Verify nothing is reachable from outside the tailnet by trying to hit
`http://<pi-tailscale-ip>:8888` from a device **not** on the tailnet (e.g.
your phone with Tailscale off, or mobile data) — it should simply time out.

## 6. Start everything

```bash
sudo systemctl enable --now mediamtx
sudo systemctl enable --now picam-ffmpeg
sudo systemctl status mediamtx picam-ffmpeg
```

Check logs if something's wrong: `journalctl -u mediamtx -f` and
`journalctl -u picam-ffmpeg -f`.

## 7. View the feed

Find the Pi's Tailscale IP: `tailscale ip -4` (run on the Pi), or look it up
in the admin console. From a device on the tailnet:

- **WebRTC (best, lowest latency):**
  `http://<pi-tailscale-ip>:8889/home` — opens MediaMTX's built-in WHEP web
  player; enter the `person1`/`person2` credentials when prompted.
- **HLS (fallback, works everywhere incl. older Safari/iOS):**
  `http://<pi-tailscale-ip>:8888/home/index.m3u8` with the same credentials
  via basic auth, or open `http://<pi-tailscale-ip>:8888/home` for the
  built-in HLS player page.

Bookmark it on each person's device. Since it's only reachable over
Tailscale, make sure Tailscale is running on the viewing device before the
link will load.

## Optional: self-hosted control plane (Headscale)

If you don't want to trust Tailscale's hosted coordination server at all,
[Headscale](https://github.com/juanfont/headscale) is an open-source,
self-hosted, API-compatible replacement you can run on a machine you
control. The Pi/viewer-side `tailscale` client works unmodified — you just
point it at your Headscale server instead of `login.tailscale.com`. This is
a meaningfully bigger operational lift (you now run and patch another
internet-facing service), so only go this route if that trust boundary
specifically matters to you.
