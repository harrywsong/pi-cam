// pi-cam custom viewer: HLS playback (served same-origin via Tailscale
// Funnel) + client-side digital pan/zoom + premium controls.
//
// Two playback paths:
//  - Safari/iOS (native HLS support): just point <video> at the stream and
//    let the browser's own HTTP Basic Auth dialog handle credentials — a
//    <video> element can't attach custom headers, so this is the only
//    reliable way to authenticate there.
//  - Everything else (Chrome/Firefox/Edge, desktop and Android): use hls.js,
//    which lets us attach an Authorization header built from the login form
//    so there's one consistent UI.

const STREAM_URL = "/home/index.m3u8"; // same-origin: MediaMTX HLS, proxied by Tailscale Funnel

const loginScreen = document.getElementById("login-screen");
const viewScreen = document.getElementById("view-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const player = document.getElementById("player");
const stage = document.getElementById("stage");
const statusEl = document.getElementById("view-status");

let hls = null;
const nativeHlsSupport = player.canPlayType("application/vnd.apple.mpegurl") !== "";

function showError(key) {
  loginError.textContent = t(key);
  loginError.hidden = false;
}

function enterViewer() {
  loginScreen.hidden = true;
  viewScreen.hidden = false;
}

if (nativeHlsSupport) {
  // Safari/iOS: skip our login form entirely. The browser will show its own
  // native username/password prompt the first time it hits a 401.
  enterViewer();
  statusEl.textContent = t("nativePrompt");
  player.addEventListener("loadeddata", () => {
    statusEl.textContent = "";
  });
  player.addEventListener("error", () => {
    statusEl.textContent = t("reconnectHint");
  });
  player.src = STREAM_URL;
} else {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const user = document.getElementById("login-user").value.trim();
    const pass = document.getElementById("login-pass").value;
    document.getElementById("login-form").querySelector("button").disabled = true;
    statusEl.textContent = t("connecting");

    if (!window.Hls || !window.Hls.isSupported()) {
      showError("unsupportedBrowser");
      return;
    }

    hls = new window.Hls({
      lowLatencyMode: true,
      xhrSetup: (xhr) => {
        xhr.setRequestHeader("Authorization", "Basic " + btoa(`${user}:${pass}`));
      },
    });

    hls.on(window.Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        if (data.response && (data.response.code === 401 || data.response.code === 403)) {
          showError("wrongCredentials");
        } else {
          showError("playbackError");
          console.error("hls.js fatal error", data);
        }
        hls.destroy();
        hls = null;
        viewScreen.hidden = true;
        loginScreen.hidden = false;
        loginForm.querySelector("button").disabled = false;
      }
    });

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      enterViewer();
      statusEl.textContent = "";
      player.play().catch(() => {
        statusEl.textContent = t("tapToStart");
      });
    });

    // attachMedia before loadSource: hls.js's documented order, avoids
    // edge cases on some mobile browsers where the reverse order silently
    // never fires MANIFEST_PARSED. Listener registered before attachMedia
    // is called, in case it fires MEDIA_ATTACHED synchronously.
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(STREAM_URL);
    });
    hls.attachMedia(player);
  });
}

function disconnect() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  player.pause();
  player.removeAttribute("src");
  player.load();
  viewScreen.hidden = true;
  if (!nativeHlsSupport) loginScreen.hidden = false;
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
