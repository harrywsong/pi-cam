// pi-cam custom viewer: HLS playback (served same-origin via Tailscale
// Funnel) + client-side digital pan/zoom + premium controls.
//
// Playback paths (see `useHlsJs` below for why the order matters):
//  - hls.js wherever Media Source Extensions exist — Chrome/Firefox/Edge,
//    desktop Safari, Android, iPadOS, iPhone on iOS 17.1+. It attaches an
//    Authorization header built from our login form, one consistent UI.
//  - Native <video> HLS only as a last resort (older iPhones): the
//    browser's own HTTP Basic Auth dialog handles credentials, since a
//    <video> element can't attach custom headers.

const STREAM_URL = "/home/index.m3u8"; // same-origin: MediaMTX HLS, proxied by Tailscale Funnel

const loginScreen = document.getElementById("login-screen");
const viewScreen = document.getElementById("view-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const player = document.getElementById("player");
const stage = document.getElementById("stage");
const statusEl = document.getElementById("view-status");

let hls = null;
let storedCreds = null; // set after login on the hls.js path only; native Safari path never collects credentials itself
const nativeHlsSupport = player.canPlayType("application/vnd.apple.mpegurl") !== "";

function showError(key) {
  loginError.textContent = t(key);
  loginError.hidden = false;
}

function enterViewer() {
  loginScreen.hidden = true;
  viewScreen.hidden = false;
}

// Which player to use: hls.js whenever the browser has Media Source
// Extensions (Chrome/Edge/Firefox/desktop Safari/iPadOS, and iPhone on iOS
// 17.1+ via ManagedMediaSource), native <video> HLS only as a last resort.
//
// Do NOT pick native just because canPlayType() says it can: Chrome (desktop
// since ~v141, and Android for years) answers "maybe" for HLS, which used to
// route every Chrome viewer onto the native path — no login form, the
// browser's built-in HLS player, which can't keep up with this LL-HLS stream
// (EXT-X-PART / blocking playlist reloads) and errors out, ending at
// "connection lost — reload". hls.js plays it reliably everywhere MSE exists.
const useHlsJs = !!(window.Hls && window.Hls.isSupported());

// Reconnect with capped exponential backoff, forever: the stream is
// on-demand (the camera can take a few seconds to come up) and a viewer who
// opened the page wants to see it, so a transient failure must never leave
// them stuck on a dead player that only a manual reload fixes.
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 10000;
let retryAttempt = 0;
let retryTimer = null;
let wantPlayback = false; // false after Disconnect — cancels pending retries

function nextRetryDelay() {
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
  retryAttempt += 1;
  return delay;
}

function scheduleRetry(fn) {
  clearTimeout(retryTimer);
  if (!wantPlayback) return;
  statusEl.textContent = t("connecting");
  retryTimer = setTimeout(() => {
    if (wantPlayback) fn();
  }, nextRetryDelay());
}

player.addEventListener("playing", () => {
  retryAttempt = 0; // played successfully, reset the backoff
  statusEl.textContent = "";
});

function destroyHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

function backToLogin(key, logData) {
  wantPlayback = false;
  clearTimeout(retryTimer);
  if (logData) console.error("hls.js fatal error", logData);
  destroyHls();
  showError(key);
  viewScreen.hidden = true;
  loginScreen.hidden = false;
  loginForm.querySelector("button").disabled = false;
}

function startHls() {
  destroyHls();
  const { user, pass } = storedCreds;
  const instance = new window.Hls({
    lowLatencyMode: true,
    // Catch back up to the live edge instead of drifting further behind
    // it over time (the default behavior just keeps playing from
    // wherever it started, so any stall/rebuffer accumulates forever).
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 6,
    maxLiveSyncPlaybackRate: 1.3,
    xhrSetup: (xhr) => {
      xhr.setRequestHeader("Authorization", "Basic " + btoa(`${user}:${pass}`));
    },
  });
  hls = instance;
  let mediaRecoveryTried = false;

  instance.on(window.Hls.Events.ERROR, (_evt, data) => {
    if (!data.fatal || hls !== instance) return;

    if (data.response && (data.response.code === 401 || data.response.code === 403)) {
      backToLogin("wrongCredentials");
      return;
    }
    console.warn("hls.js fatal error, restarting", data.type, data.details);
    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveryTried) {
      // hls.js's documented in-place recovery for decode/buffer errors.
      mediaRecoveryTried = true;
      instance.recoverMediaError();
      return;
    }
    // Anything else (manifest/playlist/fragment load failure, timeout, a
    // second media error): tear down and start a fresh instance. Note
    // hls.startLoad() is NOT enough here — after a fatal manifest error
    // there are no levels to resume, so it silently does nothing and the
    // player sits on "connecting" forever.
    destroyHls();
    scheduleRetry(startHls);
  });

  instance.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (hls !== instance) return;
    enterViewer();
    player.play().catch(() => {
      statusEl.textContent = t("tapToStart");
    });
  });

  // attachMedia before loadSource: hls.js's documented order, avoids
  // edge cases on some mobile browsers where the reverse order silently
  // never fires MANIFEST_PARSED. Listener registered before attachMedia
  // is called, in case it fires MEDIA_ATTACHED synchronously.
  instance.on(window.Hls.Events.MEDIA_ATTACHED, () => {
    if (hls === instance) instance.loadSource(STREAM_URL);
  });
  // iOS ManagedMediaSource only engages when remote playback (AirPlay) is
  // disabled or has an alternate source; we have none, so disable it.
  player.disableRemotePlayback = true;
  instance.attachMedia(player);
}

function startNative() {
  player.src = STREAM_URL;
  player.load();
  player.play().catch(() => {});
}

if (useHlsJs) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loginError.hidden = true;
    loginForm.querySelector("button").disabled = true;
    statusEl.textContent = t("connecting");
    storedCreds = {
      user: document.getElementById("login-user").value.trim(),
      pass: document.getElementById("login-pass").value,
    };
    wantPlayback = true;
    retryAttempt = 0;
    startHls();
  });
} else if (nativeHlsSupport) {
  // Last resort (old iPhones without ManagedMediaSource): skip our login
  // form; a <video> can't send custom headers, so the browser shows its own
  // native username/password prompt the first time it hits a 401.
  enterViewer();
  statusEl.textContent = t("nativePrompt");
  wantPlayback = true;
  player.addEventListener("error", () => scheduleRetry(startNative));
  player.src = STREAM_URL;
} else {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    showError("unsupportedBrowser");
  });
}

// --- Live-edge catch-up (belt and suspenders on top of hls.js's own
// liveSync options above): if playback is more than a few seconds behind
// the live edge — e.g. after the tab was backgrounded and throttled, or a
// stall — jump forward instead of staying permanently delayed. ---

const MAX_DRIFT_SECONDS = 4;

setInterval(() => {
  if (player.paused || player.seeking) return;
  let liveEdge = null;
  if (hls && hls.liveSyncPosition != null) {
    liveEdge = hls.liveSyncPosition;
  } else if (player.seekable && player.seekable.length > 0) {
    liveEdge = player.seekable.end(player.seekable.length - 1);
  }
  if (liveEdge == null) return;
  if (liveEdge - player.currentTime > MAX_DRIFT_SECONDS) {
    player.currentTime = liveEdge - 0.5;
  }
}, 5000);

function disconnect() {
  wantPlayback = false;
  clearTimeout(retryTimer);
  destroyHls();
  player.pause();
  player.removeAttribute("src");
  player.load();
  viewScreen.hidden = true;
  if (useHlsJs) {
    loginScreen.hidden = false;
    loginForm.querySelector("button").disabled = false;
  }
}

document.getElementById("disconnect").addEventListener("click", disconnect);

// --- Play / pause ---

const playPauseBtn = document.getElementById("play-pause");
const iconPause = playPauseBtn.querySelector(".icon-pause");
const iconPlay = playPauseBtn.querySelector(".icon-play");

function syncPlayPauseIcon() {
  const playing = !player.paused && !player.ended;
  iconPause.hidden = !playing;
  iconPlay.hidden = playing;
  playPauseBtn.title = t(playing ? "pauseTitle" : "playTitle");
  playPauseBtn.setAttribute("aria-label", playPauseBtn.title);
}

playPauseBtn.addEventListener("click", () => {
  if (player.paused) player.play().catch(() => {});
  else player.pause();
});
player.addEventListener("play", syncPlayPauseIcon);
player.addEventListener("pause", syncPlayPauseIcon);

// --- Volume / mute ---

const muteBtn = document.getElementById("mute");
const iconVolOn = muteBtn.querySelector(".icon-vol-on");
const iconVolOff = muteBtn.querySelector(".icon-vol-off");
const volumeSlider = document.getElementById("volume");

function syncVolumeIcon() {
  const muted = player.muted || player.volume === 0;
  iconVolOn.hidden = muted;
  iconVolOff.hidden = !muted;
  muteBtn.title = t(muted ? "unmuteTitle" : "muteTitle");
  muteBtn.setAttribute("aria-label", muteBtn.title);
}

muteBtn.addEventListener("click", () => {
  player.muted = !player.muted;
  if (!player.muted && player.volume === 0) {
    player.volume = 1;
    volumeSlider.value = 100;
  }
  syncVolumeIcon();
});

volumeSlider.addEventListener("input", () => {
  const v = Number(volumeSlider.value) / 100;
  player.volume = v;
  player.muted = v === 0;
  syncVolumeIcon();
});

syncVolumeIcon();
syncPlayPauseIcon();
document.addEventListener("picam:langchange", () => {
  syncVolumeIcon();
  syncPlayPauseIcon();
});

// --- Fullscreen ---

document.getElementById("fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    stage.requestFullscreen().catch(() => {});
  }
});

// --- Auto-hide controls after inactivity ---

let hideTimer = null;
function showControls() {
  stage.classList.remove("controls-hidden");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => stage.classList.add("controls-hidden"), 3000);
}
["pointermove", "pointerdown", "touchstart"].forEach((evt) =>
  stage.addEventListener(evt, showControls)
);
showControls();

// --- Digital pan/zoom (client-side only; the camera itself doesn't move) ---

let scale = 1;
let panX = 0;
let panY = 0;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

function applyTransform() {
  player.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  stage.classList.toggle("zoomed", scale > 1);
}

function clampPan() {
  // Keep the visible frame within the stage bounds at the current zoom.
  const maxOffsetX = (stage.clientWidth * (scale - 1)) / 2;
  const maxOffsetY = (stage.clientHeight * (scale - 1)) / 2;
  panX = Math.max(-maxOffsetX, Math.min(maxOffsetX, panX));
  panY = Math.max(-maxOffsetY, Math.min(maxOffsetY, panY));
}

function setScale(next) {
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
  clampPan();
  applyTransform();
}

document.getElementById("zoom-in").addEventListener("click", () => setScale(scale + 0.3));
document.getElementById("zoom-out").addEventListener("click", () => setScale(scale - 0.3));
document.getElementById("zoom-reset").addEventListener("click", () => {
  scale = 1;
  panX = 0;
  panY = 0;
  applyTransform();
});

stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    setScale(scale - e.deltaY * 0.001 * scale);
  },
  { passive: false }
);

let dragging = false;
let lastX = 0;
let lastY = 0;

stage.addEventListener("pointerdown", (e) => {
  if (scale <= 1) return;
  dragging = true;
  stage.classList.add("dragging");
  lastX = e.clientX;
  lastY = e.clientY;
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  panX += e.clientX - lastX;
  panY += e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  clampPan();
  applyTransform();
});

["pointerup", "pointercancel"].forEach((evt) =>
  stage.addEventListener(evt, () => {
    dragging = false;
    stage.classList.remove("dragging");
  })
);

// Pinch-to-zoom on touch devices
let pinchStartDist = null;
let pinchStartScale = 1;

stage.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    pinchStartDist = touchDist(e.touches);
    pinchStartScale = scale;
  }
});

stage.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length === 2 && pinchStartDist) {
      e.preventDefault();
      const dist = touchDist(e.touches);
      setScale(pinchStartScale * (dist / pinchStartDist));
    }
  },
  { passive: false }
);

stage.addEventListener("touchend", () => {
  pinchStartDist = null;
});

function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

// --- Settings panel (mic / output device / input volume) ---

const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const settingsClose = document.getElementById("settings-close");
const micSelect = document.getElementById("mic-select");
const outputSelect = document.getElementById("output-select");
const outputDeviceRow = document.getElementById("output-device-row");
const inputVolumeSlider = document.getElementById("input-volume");

const outputSelectionSupported = typeof player.setSinkId === "function";
if (outputSelectionSupported) outputDeviceRow.hidden = false;

let devicesPopulated = false;

async function populateDevices() {
  try {
    // Device labels are blank until a permission has been granted at least
    // once; request+immediately release the mic just to unlock them.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((track) => track.stop());
  } catch (_) {
    // User may deny mic permission entirely — device list will just show
    // generic labels, and push-to-talk will fail with a clear error later.
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  micSelect.innerHTML = "";
  devices
    .filter((d) => d.kind === "audioinput")
    .forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${i + 1}`;
      micSelect.appendChild(opt);
    });

  if (outputSelectionSupported) {
    outputSelect.innerHTML = "";
    devices
      .filter((d) => d.kind === "audiooutput")
      .forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Output ${i + 1}`;
        outputSelect.appendChild(opt);
      });
  }

  devicesPopulated = true;
}

settingsToggle.addEventListener("click", async () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  if (!settingsPanel.hidden && !devicesPopulated) await populateDevices();
});
settingsClose.addEventListener("click", () => {
  settingsPanel.hidden = true;
});

outputSelect?.addEventListener("change", () => {
  if (outputSelectionSupported) {
    player.setSinkId(outputSelect.value).catch((err) => console.error("setSinkId failed", err));
  }
});

// --- Push-to-talk ---
//
// Captures the selected mic through a Web Audio graph (so the input-volume
// slider can apply real gain, not just mute/unmute), records it as Opus/
// WebM, and streams chunks over a websocket to the Pi, which decodes and
// plays it out through the Bose speaker. Browsers can't attach an
// Authorization header to a WebSocket handshake, so a short-lived token is
// fetched over a normal (header-capable) request first.

const pttBtn = document.getElementById("push-to-talk");
const talkBadge = document.getElementById("talk-badge");

let micStream = null;
let audioCtx = null;
let gainNode = null;
let micDest = null;
let recorder = null;
let talkSocket = null;

async function ensureMicGraph() {
  const deviceId = micSelect.value || undefined;
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
  }
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(micStream);
  gainNode = audioCtx.createGain();
  gainNode.gain.value = Number(inputVolumeSlider.value) / 100;
  micDest = audioCtx.createMediaStreamDestination();
  source.connect(gainNode).connect(micDest);
}

inputVolumeSlider.addEventListener("input", () => {
  if (gainNode) gainNode.gain.value = Number(inputVolumeSlider.value) / 100;
});

async function fetchAuthToken() {
  const headers = {};
  if (storedCreds) {
    headers.Authorization = "Basic " + btoa(`${storedCreds.user}:${storedCreds.pass}`);
  }
  // No stored creds (native Safari path): the browser will show its own
  // native Basic Auth prompt here the first time, same as it already does
  // for the video stream itself.
  const resp = await fetch("/auth-token", { headers });
  if (!resp.ok) throw new Error(`auth-token: ${resp.status}`);
  const data = await resp.json();
  return data.token;
}

async function startTalking() {
  try {
    await ensureMicGraph();
    const token = await fetchAuthToken();
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    talkSocket = new WebSocket(`${proto}//${location.host}/talk-ws?token=${token}`);
    talkSocket.binaryType = "arraybuffer";

    await new Promise((resolve, reject) => {
      talkSocket.addEventListener("open", resolve, { once: true });
      talkSocket.addEventListener(
        "error",
        () => reject(new Error("auth-token socket error")),
        { once: true }
      );
    });

    recorder = new MediaRecorder(micDest.stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && talkSocket && talkSocket.readyState === WebSocket.OPEN) {
        e.data.arrayBuffer().then((buf) => talkSocket.send(buf));
      }
    };
    recorder.start(250);

    pttBtn.classList.add("active");
    talkBadge.hidden = false;
  } catch (err) {
    console.error("push-to-talk failed to start", err);
    statusEl.textContent = t(err && err.message && err.message.includes("auth-token") ? "talkError" : "micError");
    stopTalking();
  }
}

function stopTalking() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
  if (talkSocket) {
    try {
      talkSocket.close();
    } catch (_) {
      /* ignore */
    }
  }
  talkSocket = null;
  pttBtn.classList.remove("active");
  talkBadge.hidden = true;
}

pttBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startTalking();
});
["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
  pttBtn.addEventListener(evt, stopTalking)
);

// --- Manual chime test buttons (settings panel) ---

const toneTestStatus = document.getElementById("tone-test-status");

async function testTone(kind) {
  toneTestStatus.textContent = t("tonePlaying");
  try {
    const token = await fetchAuthToken();
    const resp = await fetch(`/play-tone?type=${kind}&token=${token}`, { method: "POST" });
    toneTestStatus.textContent = resp.ok ? t("toneOk") : t("toneError");
  } catch (err) {
    console.error("tone test failed", err);
    toneTestStatus.textContent = t("toneError");
  }
}

document.getElementById("test-connect-tone").addEventListener("click", () => testTone("connect"));
document.getElementById("test-disconnect-tone").addEventListener("click", () => testTone("disconnect"));
