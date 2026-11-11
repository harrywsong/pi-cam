// pi-cam custom viewer: WHEP playback + client-side digital pan/zoom.
// Credentials live only in sessionStorage (cleared when the tab closes) and
// are sent straight to MediaMTX's WHEP endpoint via a Basic Auth header —
// there is no backend here, this page is static files only.

const STREAM_PATH = "home"; // must match the path name in mediamtx.yml

const loginScreen = document.getElementById("login-screen");
const viewScreen = document.getElementById("view-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const player = document.getElementById("player");
const stage = document.getElementById("stage");
const statusEl = document.getElementById("view-status");

let pc = null;
let whepResourceUrl = null;

function creds() {
  return {
    user: sessionStorage.getItem("picam_user"),
    pass: sessionStorage.getItem("picam_pass"),
    host: sessionStorage.getItem("picam_host"),
  };
}

function authHeader({ user, pass }) {
  return "Basic " + btoa(`${user}:${pass}`);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value;
  const host = document.getElementById("login-host").value.trim().replace(/\/$/, "");

  sessionStorage.setItem("picam_user", user);
  sessionStorage.setItem("picam_pass", pass);
  sessionStorage.setItem("picam_host", host);

  try {
    await connect();
    loginScreen.hidden = true;
    viewScreen.hidden = false;
  } catch (err) {
    loginError.textContent = err.message || "Failed to connect";
    loginError.hidden = false;
  }
});

async function connect() {
  const { user, pass, host } = creds();
  if (!user || !pass || !host) throw new Error("Missing credentials");

  pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const remoteStream = new MediaStream();
  pc.ontrack = (ev) => {
    remoteStream.addTrack(ev.track);
    player.srcObject = remoteStream;
  };

  pc.onconnectionstatechange = () => {
    statusEl.textContent = `connection: ${pc.connectionState}`;
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      statusEl.textContent += " — reload the page to retry";
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);

  const url = `http://${host}/${STREAM_PATH}/whep`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      Authorization: authHeader({ user, pass }),
    },
    body: pc.localDescription.sdp,
  });

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Wrong username/password");
    }
    throw new Error(`Server returned ${resp.status}`);
  }

  whepResourceUrl = resp.headers.get("Location")
    ? new URL(resp.headers.get("Location"), url).toString()
    : null;

  const answerSdp = await resp.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

async function disconnect() {
  if (whepResourceUrl) {
    try {
      await fetch(whepResourceUrl, {
        method: "DELETE",
        headers: { Authorization: authHeader(creds()) },
      });
    } catch (_) {
      // best-effort cleanup
    }
  }
  if (pc) pc.close();
  pc = null;
  whepResourceUrl = null;
  player.srcObject = null;
  viewScreen.hidden = true;
  loginScreen.hidden = false;
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

// Auto-reconnect if a previous session's creds are already saved (optional
// convenience; comment out if you'd rather always re-enter credentials).
