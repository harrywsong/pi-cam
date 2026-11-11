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
- **Always-on microphone.** The stream carries continuous audio from the
  Pi's mic. Anyone with valid credentials can listen in at any time. If
  that's ever unwanted, stop `picam-ffmpeg`'s audio input (drop the
  `-f alsa -i ...` lines) or unplug the mic.
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
- **The `publisher` password is visible locally via `ps`/`/proc`.** ffmpeg's
  RTSP output embeds it in the URL it's invoked with (`rtsp://publisher:
  PASS@127.0.0.1:8554/home`), which is unavoidable with ffmpeg's RTSP client
  — there's no out-of-band credential option. This only matters to local
  root on the Pi (who already has full access anyway), never to anything
  over the network, and it's a separate, publish-only credential from the
  two viewer passwords, so it doesn't widen the public-facing surface.
  Avoid running `systemctl status`/`ps` for this unit somewhere it might be
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
