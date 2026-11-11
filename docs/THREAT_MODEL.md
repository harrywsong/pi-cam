# Threat model

## In scope / what this protects against

- **Random internet scanners/attackers.** No port is forwarded on your
  router and MediaMTX binds only to the Tailscale interface, so the service
  is simply not addressable from the public internet. Nothing to scan, brute
  force, or exploit.
- **Unauthorized viewers who aren't on your tailnet.** Tailscale ACLs
  restrict which devices/accounts are even allowed to join the tailnet, so a
  stranger can't just "connect" the way they could to an exposed RTSP port.
- **One shared password leaking.** Each of the two people gets a distinct
  MediaMTX credential, so a leaked credential is attributable and revocable
  without rotating the other person's.
- **Casual LAN snooping.** Traffic between viewer devices and the Pi over
  Tailscale is WireGuard-encrypted end-to-end, so someone else on your home
  Wi-Fi (or a coffee-shop Wi-Fi a viewer is on) can't sniff the video.

## Out of scope / residual risk — be aware of these

- **A compromised viewer device.** If one of the two people's phones/laptops
  is compromised (malware, stolen+unlocked), the attacker inherits that
  device's tailnet access and MediaMTX credentials. Tailscale device
  approval + OS-level device security (screen lock, disk encryption) is your
  mitigation here, not anything in this repo.
- **A compromised Tailscale account.** If your Tailscale account itself is
  taken over, an attacker could add their own device to the tailnet. Protect
  it with a strong password + hardware security key / passkey, and enable
  device approval in the Tailscale admin console so new devices need manual
  sign-off before they can join.
- **Physical access to the Pi.** Anyone who can physically reach the Pi can
  unplug the camera, re-image the SD card, or attach their own capture
  device. This is a physical security problem, not a network one — put the
  Pi somewhere you control.
- **MediaMTX / ffmpeg software vulnerabilities.** Keep both updated. Being
  unreachable from the internet also means these can only be exploited by
  someone already inside your tailnet, which is a much smaller trust
  boundary.
- **Tailscale's own infrastructure.** You are trusting Tailscale's
  coordination servers for device key exchange (though actual media traffic
  is typically direct, peer-to-peer WireGuard between devices once
  established). If that trust is unacceptable, a self-hosted Headscale
  control server is a drop-in alternative — see `docs/SETUP.md` notes.

## Recommended hardening checklist

- [ ] Tailscale admin console: enable "device approval" so new devices
      require manual sign-off.
- [ ] Tailscale ACLs: restrict the camera's Pi node so only the two
      specific user accounts/devices can reach it (see `docs/SETUP.md`).
- [ ] Use MFA + a strong, unique password on the Tailscale account (or SSO
      via an already-MFA'd identity provider).
- [ ] Keep the Pi's OS, MediaMTX, and ffmpeg patched.
- [ ] Disable password SSH login to the Pi; use key-based auth only (or
      disable SSH entirely and administer over Tailscale SSH).
- [ ] Physically secure the Pi.
