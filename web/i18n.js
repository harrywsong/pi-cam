// Minimal i18n: a flat dictionary per language, applied to elements tagged
// with data-i18n (textContent) / data-i18n-title (title + aria-label).

const TRANSLATIONS = {
  en: {
    brandName: "pi-cam",
    loginHint: "Use the username/password you were given. They're kept in this browser tab only.",
    usernameLabel: "Username",
    passwordLabel: "Password",
    connectButton: "Connect",
    wrongCredentials: "Wrong username/password",
    playbackError: "Playback error — see console",
    unsupportedBrowser: "This browser can't play HLS. Try Safari or Chrome.",
    tapToStart: "Tap the video to start playback",
    nativePrompt: "If prompted, enter your pi-cam username/password.",
    connecting: "Connecting…",
    reconnectHint: "Connection lost — reload the page to retry",
    live: "LIVE",
    disconnectTitle: "Disconnect",
    pauseTitle: "Pause",
    playTitle: "Play",
    muteTitle: "Mute",
    unmuteTitle: "Unmute",
    zoomOutTitle: "Zoom out",
    zoomResetTitle: "Reset view",
    zoomInTitle: "Zoom in",
    fullscreenTitle: "Fullscreen",
    settingsTitle: "Settings",
    micLabel: "Microphone",
    inputVolumeLabel: "Input volume",
    pttHint: "Hold the mic button to talk.",
    outputDeviceLabel: "Speaker / headphones",
    closeButton: "Close",
    talking: "Talking…",
    pttTitle: "Push to talk",
    micError: "Couldn't access microphone",
    talkError: "Couldn't start talk — reload and try again",
    toneTestLabel: "Test speaker chimes",
    testConnectTitle: "Play connect chime",
    testDisconnectTitle: "Play disconnect chime",
    tonePlaying: "Playing…",
    toneOk: "Played",
    toneError: "Failed — no speaker set up, or wrong credentials",
  },
  ko: {
    brandName: "pi-cam",
    loginHint: "발급받은 아이디/비밀번호를 입력하세요. 이 브라우저 탭에만 저장됩니다.",
    usernameLabel: "아이디",
    passwordLabel: "비밀번호",
    connectButton: "연결",
    wrongCredentials: "아이디 또는 비밀번호가 올바르지 않습니다",
    playbackError: "재생 오류 — 콘솔을 확인하세요",
    unsupportedBrowser: "이 브라우저에서는 HLS 재생을 지원하지 않습니다. Safari나 Chrome을 사용해 보세요.",
    tapToStart: "영상을 탭하면 재생이 시작됩니다",
    nativePrompt: "로그인 창이 뜨면 아이디와 비밀번호를 입력하세요.",
    connecting: "연결 중…",
    reconnectHint: "연결이 끊어졌습니다 — 새로고침 후 다시 시도하세요",
    live: "실시간",
    disconnectTitle: "연결 종료",
    pauseTitle: "일시정지",
    playTitle: "재생",
    muteTitle: "음소거",
    unmuteTitle: "음소거 해제",
    zoomOutTitle: "축소",
    zoomResetTitle: "화면 초기화",
    zoomInTitle: "확대",
    fullscreenTitle: "전체 화면",
    settingsTitle: "설정",
    micLabel: "마이크",
    inputVolumeLabel: "입력 볼륨",
    pttHint: "마이크 버튼을 누르고 있으면 말할 수 있습니다.",
    outputDeviceLabel: "스피커 / 헤드폰",
    closeButton: "닫기",
    talking: "말하는 중…",
    pttTitle: "눌러서 말하기",
    micError: "마이크에 접근할 수 없습니다",
    talkError: "통화를 시작할 수 없습니다 — 새로고침 후 다시 시도하세요",
    toneTestLabel: "스피커 알림음 테스트",
    testConnectTitle: "연결음 재생",
    testDisconnectTitle: "종료음 재생",
    tonePlaying: "재생 중…",
    toneOk: "재생됨",
    toneError: "실패 — 스피커가 없거나 인증 정보가 올바르지 않습니다",
  },
};

const I18N_STORAGE_KEY = "picam_lang";

function getLang() {
  try {
    const saved = localStorage.getItem(I18N_STORAGE_KEY);
    if (saved && TRANSLATIONS[saved]) return saved;
  } catch (_) {
    /* ignore (private browsing etc.) */
  }
  return navigator.language && navigator.language.startsWith("ko") ? "ko" : "en";
}

function setLang(lang) {
  try {
    localStorage.setItem(I18N_STORAGE_KEY, lang);
  } catch (_) {
    /* ignore */
  }
  applyLang(lang);
}

function applyLang(lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  document.documentElement.lang = lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (dict[key]) {
      el.title = dict[key];
      el.setAttribute("aria-label", dict[key]);
    }
  });

  const nextLang = lang === "ko" ? "en" : "ko";
  const nextLabel = lang === "ko" ? "EN" : "한국어";
  const loginToggle = document.getElementById("lang-toggle-login");
  const viewToggle = document.getElementById("lang-toggle-view");
  if (loginToggle) loginToggle.textContent = nextLabel;
  if (viewToggle) viewToggle.textContent = lang === "ko" ? "EN" : "KO";
  [loginToggle, viewToggle].forEach((btn) => {
    if (btn) btn.dataset.nextLang = nextLang;
  });

  document.dispatchEvent(new CustomEvent("picam:langchange"));
}

function t(key) {
  const dict = TRANSLATIONS[getLang()] || TRANSLATIONS.en;
  return dict[key] || key;
}

document.addEventListener("DOMContentLoaded", () => {
  applyLang(getLang());
  document.querySelectorAll("#lang-toggle-login, #lang-toggle-view").forEach((btn) => {
    btn.addEventListener("click", () => setLang(btn.dataset.nextLang || "ko"));
  });
});
