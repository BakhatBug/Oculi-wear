/**
 * Sleep Cycle Optimizer — Options Script (options/options.js)
 * Settings, Stripe links, premium, reports, focus mode, data export.
 */

const STRINGS = {
  saved: "✓ Settings saved",
  reset: "All settings reset to defaults",
  premiumFree: "Free tier — Upgrade for weekly sleep reports & analytics",
  premiumActive: "✅ Premium active — Weekly reports enabled",
  confirmReset: "This will erase all your data and settings. Are you sure?",
};

const STRIPE_LINKS = {
  premium: "https://buy.stripe.com/YOUR_PREMIUM_LINK",
  tip1: "https://buy.stripe.com/YOUR_TIP_1_LINK",
  tip3: "https://buy.stripe.com/YOUR_TIP_3_LINK",
  tip5: "https://buy.stripe.com/YOUR_TIP_5_LINK",
};

const DEFAULT_SETTINGS = {
  bedtime: "23:00",
  warningMinutes: 30,
  dimIntensity: 3,
  wakeTime: "07:00",
  sleepDurationTarget: 8,
  eyeProtection: false,
  eyeIntensity: 2,
  breakReminders: false,
  breakInterval: 25,
  categories: { social: true, streaming: true, news: true, messaging: true },
  customDomains: [],
  enabled: true,
  focusMode: false,
  todayLog: [],
  weeklyLogs: {},
  isPremium: false,
  stripeCustomerId: null,
  lastReportDate: null,
  streak: 0,
  lastStreakDate: null,
};

/* ── DOM ── */
const $ = (id) => document.getElementById(id);
const inputBedtime    = $("input-bedtime");
const selectWarning   = $("select-warning");
const rangeIntensity  = $("range-intensity");
const intensityValue  = $("intensity-value");
const inputWakeTime   = $("input-wake-time");
const selectSleepDur  = $("select-sleep-duration");
const suggestedBed    = $("suggested-bedtime");
const toggleEyeOpt    = $("toggle-eye-opt");
const rangeEyeInt     = $("range-eye-intensity");
const eyeIntValue     = $("eye-intensity-value");
const toggleBreaks    = $("toggle-breaks");
const selectBreakInt  = $("select-break-interval");
const breakIntField   = $("break-interval-field");
const toggleFocus     = $("toggle-focus-opt");
const catSocial       = $("cat-social");
const catStreaming     = $("cat-streaming");
const catNews         = $("cat-news");
const catMessaging    = $("cat-messaging");
const textareaDomains = $("textarea-domains");
const premiumStatus   = $("premium-status");
const btnPremium      = $("btn-premium");
const btnVerify       = $("btn-verify");
const reportArea      = $("report-area");
const reportBody      = $("report-body");
const btnDownloadPdf  = $("btn-download-pdf");
const btnExportCsv    = $("btn-export-csv");
const btnExportJson   = $("btn-export-json");
const btnTip1         = $("btn-tip-1");
const btnTip3         = $("btn-tip-3");
const btnTip5         = $("btn-tip-5");
const btnReset        = $("btn-reset");
const toast           = $("toast");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reliable runtime messaging for MV3 worker wakeups.
 */
async function safeSendMessage(payload, retries = 2, timeoutMs = 3000) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await Promise.race([
        chrome.runtime.sendMessage(payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error("message timeout")), timeoutMs)),
      ]);
      if (res && res.error) throw new Error(res.error);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await delay(160 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function isPlaceholderLink(url) {
  return /YOUR_[A-Z0-9_]+_LINK/.test(url);
}

function openStripeLink(url, label) {
  if (isPlaceholderLink(url)) {
    showToast(`${label} link not configured`);
    return;
  }
  chrome.tabs.create({ url });
}

/* ── Toast ── */
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ── Load ── */
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(null);

    inputBedtime.value = data.bedtime || "23:00";
    selectWarning.value = String(data.warningMinutes || 30);
    rangeIntensity.value = data.dimIntensity || 3;
    intensityValue.textContent = data.dimIntensity || 3;

    inputWakeTime.value = data.wakeTime || "07:00";
    selectSleepDur.value = String(data.sleepDurationTarget || 8);
    updateBedtimeSuggestion();

    toggleEyeOpt.checked = data.eyeProtection || false;
    rangeEyeInt.value = data.eyeIntensity || 2;
    eyeIntValue.textContent = data.eyeIntensity || 2;

    toggleBreaks.checked = data.breakReminders || false;
    selectBreakInt.value = String(data.breakInterval || 25);
    breakIntField.style.display = data.breakReminders ? "block" : "none";

    toggleFocus.checked = data.focusMode || false;

    const cats = data.categories || DEFAULT_SETTINGS.categories;
    catSocial.checked = cats.social !== false;
    catStreaming.checked = cats.streaming !== false;
    catNews.checked = cats.news !== false;
    catMessaging.checked = cats.messaging !== false;

    textareaDomains.value = (data.customDomains || []).join("\n");

    if (data.isPremium) {
      premiumStatus.textContent = STRINGS.premiumActive;
      btnPremium.style.display = "none";
      btnVerify.style.display = "none";
      reportArea.style.display = "block";
      loadReport(data.lastReport);
    } else {
      btnVerify.style.display = "inline-flex";
    }
  } catch (err) {
    console.error("loadSettings error:", err);
  }
}

/* ── Save ── */
async function saveSettings() {
  try {
    const customDomains = textareaDomains.value
      .split("\n")
      .map((d) => d.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
      .filter(Boolean);

    await chrome.storage.local.set({
      bedtime: inputBedtime.value,
      warningMinutes: Number(selectWarning.value),
      dimIntensity: Number(rangeIntensity.value),
      wakeTime: inputWakeTime.value,
      sleepDurationTarget: Number(selectSleepDur.value),
      eyeProtection: toggleEyeOpt.checked,
      eyeIntensity: Number(rangeEyeInt.value),
      breakReminders: toggleBreaks.checked,
      breakInterval: Number(selectBreakInt.value),
      focusMode: toggleFocus.checked,
      categories: {
        social: catSocial.checked,
        streaming: catStreaming.checked,
        news: catNews.checked,
        messaging: catMessaging.checked,
      },
      customDomains,
    });
    showToast(STRINGS.saved);
  } catch (err) {
    console.error("saveSettings error:", err);
  }
}

/* ── Auto-save ── */
for (const el of [inputBedtime, selectWarning, rangeIntensity, toggleFocus,
                  inputWakeTime, selectSleepDur,
                  catSocial, catStreaming, catNews, catMessaging]) {
  el.addEventListener("change", saveSettings);
}
textareaDomains.addEventListener("blur", saveSettings);

rangeIntensity.addEventListener("input", () => {
  intensityValue.textContent = rangeIntensity.value;
});

/* ── Wake time → bedtime suggestion ── */
function updateBedtimeSuggestion() {
  const wt = inputWakeTime.value;
  if (!wt || !suggestedBed) return;
  const [wH, wM] = wt.split(":").map(Number);
  const dur = parseInt(selectSleepDur.value, 10) || 8;
  let bH = wH - dur;
  if (bH < 0) bH += 24;
  const bM = wM;
  const period = bH >= 12 ? "PM" : "AM";
  const displayH = bH > 12 ? bH - 12 : (bH === 0 ? 12 : bH);
  suggestedBed.textContent = `${displayH}:${String(bM).padStart(2, "0")} ${period}`;
}
inputWakeTime.addEventListener("input", updateBedtimeSuggestion);
selectSleepDur.addEventListener("change", updateBedtimeSuggestion);

/* ── Eye protection ── */
toggleEyeOpt.addEventListener("change", async () => {
  try {
    await saveSettings();
    await safeSendMessage({
      type: "SET_EYE_PROTECTION",
      enabled: toggleEyeOpt.checked,
      intensity: Number(rangeEyeInt.value),
    });
  } catch (err) {
    console.error("toggleEyeOpt error:", err);
    showToast("Could not update Eye Protection");
  }
});

rangeEyeInt.addEventListener("input", () => {
  eyeIntValue.textContent = rangeEyeInt.value;
});
rangeEyeInt.addEventListener("change", async () => {
  try {
    await saveSettings();
    if (toggleEyeOpt.checked) {
      await safeSendMessage({
        type: "SET_EYE_PROTECTION",
        enabled: true,
        intensity: Number(rangeEyeInt.value),
      });
    }
  } catch (err) {
    console.error("rangeEyeInt change error:", err);
    showToast("Could not update eye intensity");
  }
});

/* ── Break reminders ── */
toggleBreaks.addEventListener("change", async () => {
  try {
    breakIntField.style.display = toggleBreaks.checked ? "block" : "none";
    await saveSettings();
    await safeSendMessage({
      type: "SET_BREAK_REMINDER",
      enabled: toggleBreaks.checked,
      interval: Number(selectBreakInt.value),
    });
  } catch (err) {
    console.error("toggleBreaks error:", err);
    showToast("Could not update break reminders");
  }
});

selectBreakInt.addEventListener("change", async () => {
  try {
    await saveSettings();
    if (toggleBreaks.checked) {
      await safeSendMessage({
        type: "SET_BREAK_REMINDER",
        enabled: true,
        interval: Number(selectBreakInt.value),
      });
    }
  } catch (err) {
    console.error("selectBreakInt error:", err);
    showToast("Could not update break interval");
  }
});

/* ── Premium ── */
btnPremium.addEventListener("click", () => openStripeLink(STRIPE_LINKS.premium, "Premium"));
btnVerify.addEventListener("click", async () => {
  try {
    await chrome.storage.local.set({ isPremium: true });
    premiumStatus.textContent = STRINGS.premiumActive;
    btnPremium.style.display = "none";
    btnVerify.style.display = "none";
    reportArea.style.display = "block";
    await safeSendMessage({ type: "GET_STATS" });
    showToast("Premium activated!");
  } catch (err) {
    console.error("Verify error:", err);
    showToast("Premium activation failed");
  }
});

/* ── Tips ── */
btnTip1.addEventListener("click", () => openStripeLink(STRIPE_LINKS.tip1, "Tip"));
btnTip3.addEventListener("click", () => openStripeLink(STRIPE_LINKS.tip3, "Tip"));
btnTip5.addEventListener("click", () => openStripeLink(STRIPE_LINKS.tip5, "Tip"));

/* ── Report ── */
function loadReport(report) {
  if (!report) {
    reportBody.innerHTML = '<tr><td colspan="2" style="color:var(--text-dim)">No report yet — generated on Sunday nights.</td></tr>';
    return;
  }
  const rows = [];
  rows.push(["Total browsing (min)", report.totalBrowsingMinutes]);
  rows.push(["Configured bedtime", report.configuredBedtime]);
  if (report.categoryBreakdown) {
    for (const [cat, ms] of Object.entries(report.categoryBreakdown)) {
      rows.push([`  ${cat}`, `${Math.round(ms / 60000)} min`]);
    }
  }
  if (report.topDisruptiveDomains) {
    rows.push(["Top disruptive domains", ""]);
    for (const { domain, count } of report.topDisruptiveDomains) {
      rows.push([`  ${domain}`, `${count} visits`]);
    }
  }
  rows.push(["Report generated", new Date(report.generatedAt).toLocaleDateString()]);

  reportBody.innerHTML = rows
    .map(([label, val]) => `<tr><td>${esc(String(label))}</td><td>${esc(String(val))}</td></tr>`)
    .join("");
}

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

btnDownloadPdf.addEventListener("click", () => window.print());

/* ── Export Data ── */
btnExportCsv.addEventListener("click", async () => {
  try {
    const { todayLog = [], weeklyLogs = {} } = await chrome.storage.local.get(["todayLog", "weeklyLogs"]);
    const allEntries = [...todayLog];
    for (const entries of Object.values(weeklyLogs)) {
      allEntries.push(...entries);
    }
    const header = "domain,category,startTs,durationMs\n";
    const csv = header + allEntries
      .map((e) => `${e.domain},${e.category},${e.startTs},${e.durationMs}`)
      .join("\n");
    downloadFile(csv, "sleep-optimizer-data.csv", "text/csv");
    showToast("CSV exported!");
  } catch (err) {
    console.error("Export CSV error:", err);
  }
});

btnExportJson.addEventListener("click", async () => {
  try {
    const data = await chrome.storage.local.get(null);
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, "sleep-optimizer-data.json", "application/json");
    showToast("JSON exported!");
  } catch (err) {
    console.error("Export JSON error:", err);
  }
});

/**
 * Trigger a file download in the browser.
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Reset ── */
btnReset.addEventListener("click", async () => {
  if (!confirm(STRINGS.confirmReset)) return;
  try {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ ...DEFAULT_SETTINGS });
    showToast(STRINGS.reset);
    loadSettings();
  } catch (err) {
    console.error("Reset error:", err);
  }
});

/* ── Init ── */
loadSettings();
