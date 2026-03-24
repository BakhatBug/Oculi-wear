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
    switch (msg.type) {
      case "PING_DIMMER": sendResponse({ ok: true }); break;
      case "DIM": applyDim(msg.opacity, msg.phase); break;
      case "UNDIM": removeDim(); break;
      case "EYE_PROTECT": 
        if (msg.enabled) applyEyeProtection(msg.opacity);
        else removeEyeProtection();
        break;
      case "FOCUS_BLOCK": showFocusBlock(); break;
      case "FOCUS_UNBLOCK": removeFocusBlock(); break;
    }
  };

  // Re-hook listener reliably
  if (globalThis.__SCO_LISTENER__) {
    chrome.runtime.onMessage.removeListener(globalThis.__SCO_LISTENER__);
  }
  globalThis.__SCO_LISTENER__ = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);

  /* ── Initial State Sync ── */
  chrome.storage.local.get(["enabled", "eyeProtection", "eyeIntensity", "bedtime", "warningMinutes", "dimIntensity"], (res) => {
    try {
      // Apply eye protection if enabled
      if (res.eyeProtection) {
        const OPACITY = { 1: 0.04, 2: 0.07, 3: 0.11, 4: 0.16, 5: 0.22 };
        applyEyeProtection(OPACITY[res.eyeIntensity] || 0.07);
      }

      // Apply dimming if enabled
      if (res.enabled) {
        const bedtime = res.bedtime || "23:00";
        const warningMinutes = res.warningMinutes || 30;
        const dimIntensity = res.dimIntensity || 3;

        // Calculate current bedtime phase
        const [h, m] = bedtime.split(":").map(Number);
        const now = new Date();
        const bed = new Date();
        bed.setHours(h, m, 0, 0);

        // Handle past-midnight bedtimes
        if (bed.getHours() < 12 && now.getHours() > 12) {
          bed.setDate(bed.getDate() + 1);
        }

        const diffMin = (bed - now) / 60000;
        let phase = 0;
        if (diffMin <= 0) phase = 3;
        else if (diffMin <= warningMinutes / 2) phase = 2;
        else if (diffMin <= warningMinutes) phase = 1;

        // Calculate opacity based on phase
        const base = [0, 0.15, 0.30, 0.55];
        const scale = dimIntensity / 3;
        const opacity = Math.min(base[phase] * scale, 0.85);

        // Apply dimming (use at least phase 1 if enabled manually)
        const effectivePhase = Math.max(phase, 1);
        applyDim(opacity, effectivePhase);
      }
    } catch (e) {
      console.warn("[SCO] Initial load error (likely invalidated context):", e);
    }
  });

})();
