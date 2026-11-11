#!/usr/bin/env python3
"""
pi-cam web backend — replaces the plain `python3 -m http.server` used
before push-to-talk existed. Serves the static viewer files and adds:

- /talk-ws: decodes incoming mic audio (webm/opus from the browser's
  MediaRecorder) and plays it out through the Bose speaker.
- /play-tone: plays a short connect/disconnect chime. Called locally (over
  loopback, no auth — see below) by MediaMTX's runOnDemand/runOnUnDemand
  hooks (scripts/mediamtx-on-demand.sh, scripts/mediamtx-on-undemand.sh)
  when a viewer's session starts/ends. It's here and not in those scripts
  directly because they run as mediamtx's own unprivileged `picam` user,
  which (like mediamtx itself) can't reach the PipeWire session that owns
  the speaker — this process can, for the same reason push-to-talk needs
  to run as the interactive login user (see docs/THREAT_MODEL.md).
  No token/auth: it only ever plays a sound, bound to 127.0.0.1 same as
  everything else here, and the hook scripts that call it have no way to
  carry a browser-issued token anyway.

(The webcam/mic capture itself runs on-demand — started/stopped by
MediaMTX's own runOnDemand/runOnDemandCloseAfter, configured in
mediamtx.yml's paths.home — not by anything in this file.)

Credentials are not duplicated here: they're read straight out of
mediamtx.yml (the same sha256 hashes MediaMTX itself checks), so there is
exactly one place a password/hash ever needs to change.

Browsers can't attach an Authorization header to a WebSocket handshake, so
push-to-talk uses a short-lived token instead of ever putting the real
password in a URL: GET /auth-token (Basic Auth) -> one-time token, then
GET /talk-ws?token=... opens the audio socket.
"""

import asyncio
import base64
import hashlib
import os
import secrets
import time

import yaml
from aiohttp import web

STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
MEDIAMTX_CONF = "/etc/picam/mediamtx.yml"
# Playback is routed through PipeWire's PulseAudio-compatible socket
# (ffmpeg's `-f pulse` output), not raw ALSA: PipeWire/WirePlumber already
# claims the USB speaker exclusively on Raspberry Pi OS, so a second
# process can't open it directly — PipeWire's job is exactly this kind of
# concurrent mixing (push-to-talk audio alongside the keep-alive tone). See
# systemd/picam-web.service for the PULSE_SERVER/XDG_RUNTIME_DIR env this
# process needs (inherited by the ffmpeg subprocess below automatically).
TOKEN_TTL_SECONDS = 30

# Two deliberately different-shaped chimes: connect rises and is quick/bright
# (two short high notes), disconnect falls and is slower/lower (two longer
# low notes) — distinguishable by ear without having to listen closely.
TONE_FILTERS = {
    "connect": (
        "[0:a]atrim=duration=0.12,asetpts=PTS-STARTPTS[a0];"
        "[1:a]atrim=duration=0.18,asetpts=PTS-STARTPTS[a1];"
        "[a0][a1]concat=n=2:v=0:a=1,volume=0.6[out]"
    ),
    "disconnect": (
        "[0:a]atrim=duration=0.18,asetpts=PTS-STARTPTS[a0];"
        "[1:a]atrim=duration=0.3,asetpts=PTS-STARTPTS[a1];"
        "[a0][a1]concat=n=2:v=0:a=1,volume=0.6[out]"
    ),
}
TONE_FREQUENCIES = {
    "connect": (784, 1175),  # G5 -> D6, rising
    "disconnect": (587, 392),  # D5 -> G4, falling
}

_tokens = {}  # token -> expiry epoch seconds


def load_users():
    try:
        with open(MEDIAMTX_CONF) as f:
            cfg = yaml.safe_load(f)
    except OSError:
        return {}
    users = {}
    for u in cfg.get("authInternalUsers", []):
        name = u.get("user")
        pw = u.get("pass", "")
        if name == "publisher" or not pw.startswith("sha256:"):
            continue
        users[name] = pw[len("sha256:") :]
    return users


def check_password(username, password):
    users = load_users()
    if username not in users:
        return False
    digest = base64.b64encode(hashlib.sha256(password.encode()).digest()).decode()
    return secrets.compare_digest(digest, users[username])


def parse_basic_auth(request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(header[6:]).decode()
        user, pw = decoded.split(":", 1)
        return user, pw
    except Exception:
        return None


def _prune_expired_tokens():
    now = time.time()
    for tok in [t for t, exp in _tokens.items() if exp < now]:
        _tokens.pop(tok, None)


async def auth_token(request):
    creds = parse_basic_auth(request)
    if not creds or not check_password(*creds):
        return web.Response(
            status=401,
            headers={"WWW-Authenticate": 'Basic realm="picam"'},
        )
    _prune_expired_tokens()
    token = secrets.token_urlsafe(24)
    _tokens[token] = time.time() + TOKEN_TTL_SECONDS
    return web.json_response({"token": token})


async def talk_ws(request):
    token = request.query.get("token", "")
    _prune_expired_tokens()
    if token not in _tokens:
        return web.Response(status=401)
    _tokens.pop(token, None)  # one-time use

    ws = web.WebSocketResponse()
    await ws.prepare(request)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "webm",
        "-i",
        "pipe:0",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "pulse",
        "default",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.BINARY:
                if proc.stdin and not proc.stdin.is_closing():
                    try:
                        proc.stdin.write(msg.data)
                        await proc.stdin.drain()
                    except (BrokenPipeError, ConnectionResetError):
                        break
            elif msg.type in (web.WSMsgType.ERROR, web.WSMsgType.CLOSE):
                break
    finally:
        if proc.stdin and not proc.stdin.is_closing():
            try:
                proc.stdin.close()
            except Exception:
                pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=3)
        except asyncio.TimeoutError:
            proc.kill()

    return ws


async def play_tone(request):
    kind = request.query.get("type", "")
    if kind not in TONE_FILTERS:
        return web.Response(status=400, text="type must be connect or disconnect")

    f1, f2 = TONE_FREQUENCIES[kind]
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        f"sine=frequency={f1}:sample_rate=48000",
        "-f",
        "lavfi",
        "-i",
        f"sine=frequency={f2}:sample_rate=48000",
        "-filter_complex",
        TONE_FILTERS[kind],
        "-map",
        "[out]",
        "-ac",
        "2",
        "-f",
        "pulse",
        "default",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
    return web.Response(text="ok")


async def index(request):
    return web.FileResponse(os.path.join(STATIC_DIR, "index.html"))


def build_app():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/auth-token", auth_token)
    app.router.add_get("/talk-ws", talk_ws)
    app.router.add_post("/play-tone", play_tone)
    app.router.add_static("/", STATIC_DIR, show_index=False)
    return app


if __name__ == "__main__":
    # access_log=None: this endpoint's query strings/headers can carry
    # auth-adjacent tokens, so avoid writing request lines to journald.
    web.run_app(build_app(), host="127.0.0.1", port=8080, access_log=None)
