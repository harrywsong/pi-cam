# Threat model

This setup is deliberately **public-facing** (via Tailscale Funnel), so
that the two viewers don't need Tailscale themselves. That's a different
trade-off than a tailnet-only setup: there is no network-level gate at all
— **credentials are the only thing standing between a stranger and the
feed.** Read this whole page before deploying.

## In scope / what this protects against

- **Casual discovery.** The public URL is an unguessable, unpublished
  `https://<random-looking-name>.<tailnet>.ts.net/` hostname — nobody finds
  it by scanning IP ranges or port-scanning, only by being given the link.
- **One shared password leaking.** Each of the two people gets a distinct
  MediaMTX credential, so a leaked credential is attributable and revocable
  without rotating the other person's.
- **Transport snooping.** Funnel terminates TLS with a real, automatically
  renewed certificate, so traffic between a viewer and the Pi is encrypted
  in transit (unlike a bare HTTP port-forward).
- **Direct exploitation of MediaMTX/ffmpeg from random scanners.** MediaMTX,
  ffmpeg's RTSP output, and the web viewer are all bound to `127.0.0.1`
  only — the only thing actually listening on a reachable interface is
  Tailscale's own `tailscaled`/Funnel proxy, which is a well-audited,
  frequently-patched piece of infrastructure, not this repo's code.

## On-demand capture

The webcam and mic only run while at least one viewer is actually
connected — MediaMTX's own `runOnDemand`/`runOnDemandCloseAfter` (configured
in `mediamtx.yml`'s `paths.home`) starts the capture command on the first
reader and sends it SIGINT about a minute after the last one disconnects,
rather than it running as an always-on systemd service. The obvious benefit
is privacy/wear (a camera that isn't recording when nobody's watching).

## Camera capture settings — a real-hardware finding

The C920 is configured for 1920x1080 at **15fps**, not the 30fps it was
originally set to and nominally reports supporting. Measured directly on
this Pi with `v4l2-ctl --stream-mmap`, bypassing ffmpeg entirely: the
camera only *actually* delivers ~15fps sustained, at both 1080p and 720p,
regardless of the 30fps request the driver happily accepts. This is
ordinary UVC webcam behavior — auto-exposure extends the shutter time in
anything less than bright light, which effectively halves the real frame
rate even though the nominal setting doesn't change. Requesting 30fps while
only 15 arrive doesn't error, it just makes ffmpeg duplicate every other
frame to pad up to the requested rate, which produced a steady,
fixed-timing "More than N frames duplicated" warning and very likely
contributed to the playback instability reported over the real (Funnel)
path — never caught by testing that only exercised the capture over
localhost. If your lighting is consistently bright enough for a true 30fps,
you can try raising it back in `scripts/mediamtx-on-demand.sh`, but verify
with `v4l2-ctl --stream-mmap` first rather than trusting the requested
value.

## Out of scope / residual risk — be aware of these

- **Credential compromise is now the main risk, full stop.** If either
  password leaks (shoulder-surfed, phished, reused and breached elsewhere,
  found in a synced notes app), anyone who has it can watch and listen from
  anywhere, with no second factor. There is no Tailscale device-approval
  layer behind this one anymore. Mitigate with long random unique passwords
  (a password manager's generator, not something memorized) and rotate a
  credential immediately if you suspect it leaked (`docs/SETUP.md` step 4).
- **The hostname itself is a bearer secret.** Anyone who gets the
  `*.ts.net` URL still has to also have valid credentials, but if you'd
  rather the URL not even be guessable/discoverable long-term, avoid
  posting it anywhere public or searchable.
- **The microphone is live whenever anyone's watching, not just the camera.**
  The capture (video + audio together) only runs while at least one viewer
  is connected — see "On-demand capture" below — but for the duration of
  that session, anyone with valid credentials can listen in. If that's ever
  unwanted independent of viewing, remove the `-f alsa -i ...` lines from
  `mediamtx.yml`'s `runOnDemand` command, or unplug the mic.
- **A compromised viewer device.** If one of the two people's phones/
  laptops is compromised (malware, stolen+unlocked, browser autofill
  exposed), the attacker inherits whatever credentials are saved there.
  OS-level device security (screen lock, disk encryption, not saving the
  password in an insecure place) is your mitigation here.
- **A compromised Tailscale account on the Pi.** If the Pi's own Tailscale
  account is taken over, an attacker could reconfigure Funnel/serve routing
  or otherwise mess with the Pi's tailnet presence. Protect it with MFA/a
  passkey and enable device approval in the Tailscale admin console.
- **Physical access to the Pi.** Anyone who can physically reach the Pi can
  unplug the camera, re-image the SD card, or attach their own capture
  device. Put the Pi somewhere you control.
- **MediaMTX / ffmpeg software vulnerabilities.** Keep both updated —
  unlike the tailnet-only design, a bug in MediaMTX's HTTP/HLS handling is
  now reachable (through Funnel's proxy) by anyone who can reach the
  hostname and pass auth, which is a larger trust boundary than "anyone on
  my tailnet."
- **Digital pan/zoom is purely client-side.** It only crops the decoded
  video in the viewer's own browser; it doesn't change what's captured or
  sent, and one viewer's pan/zoom never affects another's. No new surface.
- **`web/server.py` is a second piece of custom code with network exposure**
  (where before it was just a stock static-file server). It reuses the same
  credentials as MediaMTX (reads the sha256 hashes straight out of
  `mediamtx.yml` — one source of truth, not a second place for a password
  to go stale), and `/talk-ws`/`/play-tone` both require a short-lived,
  single-use token fetched over `/auth-token` rather than ever taking a
  real password in a URL/websocket. `/play-tone` also accepts a local
  shared secret (`/etc/picam/tone-secret`, generated at install time) via
  an `X-Tone-Secret` header, since MediaMTX's hook scripts
  (`scripts/mediamtx-on-demand.sh`/`-on-undemand.sh`) have no browser
  session to get a viewer token from. **This binds to 127.0.0.1 like
  everything else here, but that does not make it loopback-only** —
  Tailscale Funnel's local reverse proxy also connects from 127.0.0.1, so
  every route on this port is reachable from the public internet, Funnel
  being the only thing standing in front of it; don't add a new route here
  without auth just because it binds to a loopback address, that was
  actually wrong once already (`/play-tone` initially shipped with no auth
  at all, on the mistaken assumption loopback-bound meant unreachable
  externally — fixed before anyone would have likely noticed, but worth
  remembering for the next endpoint). Keep `python3-aiohttp` updated along
  with everything else.
- **Push-to-talk audio plays on a real speaker in the room, unauthenticated
  beyond the same credential check as everything else.** Anyone with valid
  credentials can speak into the room at will. This is the same trust
  level as the existing listen-in audio, just in the other direction.
- **`picam-web` and `picam-keepalive` run as your interactive login user,
  not the isolated `picam` system account everything else uses.** This is
  a real, deliberate trade-off, not an oversight: on Raspberry Pi OS,
  PipeWire/WirePlumber (which owns the USB speaker) runs per logged-in
  user, so reaching it at all means running as that user. In practice this
  means the one component with a public-reachable websocket endpoint
  (`server.py`) has as much system privilege as your own account, where
  the rest of the stack (MediaMTX, ffmpeg capture) is confined to a
  no-login, no-home-directory service account. If this matters more to
  you than push-to-talk does, the mitigation is to not install
  `picam-keepalive`/push-to-talk and keep `picam-web` serving plain static
  files as the unprivileged `picam` user, same as before this feature.
- **The `publisher` password is visible locally via `ps`/`/proc`.** ffmpeg's
  RTSP output embeds it in the URL it's invoked with (`rtsp://publisher:
  PASS@127.0.0.1:$RTSP_PORT/$MTX_PATH`), which is unavoidable with ffmpeg's
  RTSP client — there's no out-of-band credential option. This only matters
  to local root on the Pi (who already has full access anyway), never to
  anything over the network, and it's a separate, publish-only credential
  from the two viewer passwords, so it doesn't widen the public-facing
  surface. Avoid running `ps`/`ps aux` for this process (it shows up as a
  child of `mediamtx`, spawned by its `runOnDemand`) somewhere it might be
  logged or screen-shared.

## If you want the stronger, tailnet-only alternative

A prior version of this setup kept everything strictly inside a private
Tailscale tailnet (no public exposure at all, both viewers running the
Tailscale app). That's a meaningfully stronger threat model — network-level
access control *and* credentials, instead of credentials alone — at the
cost of both viewers needing to install and sign into Tailscale. If that
trade-off becomes preferable later, it mainly means: re-enable `webrtc` and
bind `hlsAddress`/`webrtcAddress`/`picam-web` to `0.0.0.0` again, restrict
them with tailnet-subnet nftables rules instead of a loopback-only drop
rule, skip `scripts/tailscale-funnel.sh`, and add the two people's devices
to the tailnet with a restrictive ACL.

## Recommended hardening checklist

- [ ] Long, random, unique passwords for `person1`/`person2`/`publisher` —
      a password manager's generator, not anything memorable.
- [ ] Don't post or search-index the `*.ts.net` URL anywhere public.
- [ ] Tailscale admin console: enable "device approval" and MFA/passkey on
      the account the Pi itself is signed into.
- [ ] Keep the Pi's OS, MediaMTX, and ffmpeg patched.
- [ ] Disable password SSH login to the Pi; use key-based auth only (or
      disable SSH entirely and administer over Tailscale SSH).
- [ ] Physically secure the Pi.
- [ ] If a credential is ever suspected leaked, rotate it immediately
      (new password, new hash in `mediamtx.yml`, restart `mediamtx`).
