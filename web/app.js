// pi-cam custom viewer: HLS playback (served same-origin via Tailscale
// Funnel) + client-side digital pan/zoom.
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

if (nativeHlsSupport) {
  // Safari/iOS: skip our login form entirely. The browser will show its own
  // native username/password prompt the first time it hits a 401.
  loginScreen.hidden = true;
  viewScreen.hidden = false;
  statusEl.textContent = "If prompted, enter your pi-cam username/password.";
  player.src = STREAM_URL;
} else {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const user = document.getElementById("login-user").value.trim();
    const pass = document.getElementById("login-pass").value;

    if (!window.Hls || !window.Hls.isSupported()) {
      loginError.textContent = "This browser can't play HLS. Try Safari or Chrome.";
      loginError.hidden = false;
      return;
    }

    hls = new window.Hls({
      xhrSetup: (xhr) => {
        xhr.setRequestHeader("Authorization", "Basic " + btoa(`${user}:${pass}`));
      },
    });

    hls.on(window.Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        if (data.response && (data.response.code === 401 || data.response.code === 403)) {
          loginError.textContent = "Wrong username/password";
        } else {
          loginError.textContent = "Playback error — see console";
          console.error("hls.js fatal error", data);
        }
        loginError.hidden = false;
        hls.destroy();
        hls = null;
        viewScreen.hidden = true;
        loginScreen.hidden = false;
      }
    });

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      loginScreen.hidden = true;
      viewScreen.hidden = false;
      statusEl.textContent = "";
      player.play().catch(() => {
        statusEl.textContent = "Tap the video to start playback";
      });
    });

    hls.loadSource(STREAM_URL);
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
document.getElementById("mute").addEventListener("click", (e) => {
  player.muted = !player.muted;
  e.target.textContent = player.muted ? "🔇" : "🔊";
});

// --- Digital pan/zoom (client-side only; the camera itself doesn't move) ---

let scale = 1;
let panX = 0;
let panY = 0;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

function applyTransform() {
  player.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
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
