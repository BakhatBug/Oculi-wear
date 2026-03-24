/**
 * Sleep Optimizer — Robust Content Script (content/dimmer.js)
 */

(() => {
  // Constants for element IDs
  const IDS = {
    overlay: "sco-overlay",
    eye: "sco-eye-overlay",
    banner: "sco-banner",
    focus: "sco-focus-block",
  };

  const STRINGS = {
    phase2Msg: "🌙 Bedtime soon — time to wrap up",
    phase3Msg: "😴 It's your bedtime! Time to rest.",
    snoozeBtn: "Snooze 10 min",
    doneBtn: "Done for tonight",
    focusTitle: "Focus Mode Active",
    focusMsg: "This site is blocked during your bedtime hours. Get some rest!",
  };

  const getRoot = () => document.body || document.documentElement;
  const getEl = (id) => document.getElementById(id);

  /* ── Overlay Helpers ── */
  function ensureElement(id, tag = "div") {
    let el = getEl(id);
    if (!el) {
      el = document.createElement(tag);
      el.id = id;
      getRoot()?.appendChild(el);
    }
    return el;
  }

  /* ── Core Actions ── */
  function applyDim(opacity, phase) {
    const el = ensureElement(IDS.overlay);
    el.style.background = `rgba(10, 5, 20, ${opacity})`;
    el.classList.add("active");
    if (phase >= 2) showBanner(phase);
    else removeBanner();
  }

  function removeDim() {
    getEl(IDS.overlay)?.remove();
    removeBanner();
  }

  function applyEyeProtection(opacity) {
    const el = ensureElement(IDS.eye);
    el.style.background = `rgba(255, 155, 40, ${opacity})`;
  }

  function removeEyeProtection() {
    getEl(IDS.eye)?.remove();
  }

  function showBanner(phase) {
    removeBanner();
    const banner = document.createElement("div");
    banner.id = IDS.banner;
    banner.innerHTML = `
      <div class="sco-title">Sleep Optimizer</div>
      <div class="sco-msg">${phase === 3 ? STRINGS.phase3Msg : STRINGS.phase2Msg}</div>
      <div class="sco-actions">
        <button class="sco-btn sco-btn-snooze" id="sco-snooze-btn">${STRINGS.snoozeBtn}</button>
        <button class="sco-btn sco-btn-done" id="sco-done-btn">${STRINGS.doneBtn}</button>
      </div>
    `;
    getRoot()?.appendChild(banner);
    document.getElementById("sco-snooze-btn")?.addEventListener("click", () => chrome.runtime.sendMessage({ type: "SNOOZE", minutes: 10 }));
    document.getElementById("sco-done-btn")?.addEventListener("click", () => chrome.runtime.sendMessage({ type: "DONE_TONIGHT" }));
  }

  function removeBanner() { getEl(IDS.banner)?.remove(); }

  function showFocusBlock() {
    if (getEl(IDS.focus)) return;
    const block = document.createElement("div");
    block.id = IDS.focus;
    block.innerHTML = `
      <div class="sco-block-icon">🌙</div>
      <div class="sco-block-title">${STRINGS.focusTitle}</div>
      <div class="sco-block-msg">${STRINGS.focusMsg}</div>
    `;
    getRoot()?.appendChild(block);
  }

  function removeFocusBlock() { getEl(IDS.focus)?.remove(); }

  /* ── Messaging ── */
  const onMessage = (msg, sender, sendResponse) => {
    try {
      switch (msg.type) {
        case "PING_DIMMER": 
          sendResponse({ ok: true }); 
          break;
        case "DIM": 
          console.log("[SCO] DIM message received:", { opacity: msg.opacity, phase: msg.phase });
          applyDim(msg.opacity, msg.phase); 
          break;
        case "UNDIM": 
          console.log("[SCO] UNDIM message received");
          removeDim(); 
          break;
        case "EYE_PROTECT": 
          console.log("[SCO] EYE_PROTECT message:", { enabled: msg.enabled, opacity: msg.opacity });
          if (msg.enabled) applyEyeProtection(msg.opacity);
          else removeEyeProtection();
          break;
        case "FOCUS_BLOCK": 
          console.log("[SCO] FOCUS_BLOCK message received");
          showFocusBlock(); 
          break;
        case "FOCUS_UNBLOCK": 
          console.log("[SCO] FOCUS_UNBLOCK message received");
          removeFocusBlock(); 
          break;
        default:
          console.warn("[SCO] Unknown message type:", msg.type);
      }
    } catch (err) {
      console.error("[SCO] Message handler error:", err);
    }
  };

  // Re-hook listener reliably
  if (globalThis.__SCO_LISTENER__) {
    chrome.runtime.onMessage.removeListener(globalThis.__SCO_LISTENER__);
  }
  globalThis.__SCO_LISTENER__ = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);

  /* ── Initial State Sync ── */
  try {
    chrome.runtime.sendMessage({ type: "GET_CURRENT_DIM_STATE" }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn("[SCO] Could not get initial state:", chrome.runtime.lastError);
        return;
      }
      if (!res) return;
      
      console.log("[SCO] Initial state sync:", res);
      
      if (res.eyeProtection) {
        applyEyeProtection(res.eyeOpacity);
      }
      
      if (res.enabled) {
        applyDim(res.opacity, res.phase);
      }
    });
  } catch (e) {
    console.warn("[SCO] Initial load error:", e);
  }

})();
