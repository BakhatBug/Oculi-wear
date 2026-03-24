/**
 * Sleep Optimizer — Redesigned Popup Script (popup/popup.js)
 */

const $ = (id) => document.getElementById(id);

/* ── DOM Elements ── */
const ringFill       = $("ring-fill");
const ringTime       = $("ring-time");
const ringLabel      = $("ring-label");
const phaseBadge     = $("phase-badge");
const statusBed      = $("status-bed");
const sleepScore     = $("sleep-score");
const statTime       = $("stat-time");
const toggleDim      = $("toggle-dim");
const toggleFocus    = $("toggle-focus");
const toggleEye      = $("toggle-eye");
const btnSnooze      = $("btn-snooze");
const btnDone        = $("btn-done");
const btnTest        = $("btn-test");
const btnSettings    = $("link-settings");
const liveClock      = $("live-clock");
const weeklyChart    = $("weekly-chart");
const catBars        = $("cat-bars");
const btnBreathe      = $("btn-breathe");
const collapseTrigger = $("collapse-trigger");
const collapseContent = $("collapse-content");
const collapseIcon    = $("collapse-icon");
const btnCloseDisruptors = $("btn-close-disruptors");

const CIRCUMFERENCE = 2 * Math.PI * 36; // 226.2

const PHASE_MAP = {
  0: { label: "Safe", cls: "safe" },
  1: { label: "Warning", cls: "warning" },
  2: { label: "Warning", cls: "warning" },
  3: { label: "Bedtime", cls: "bedtime" },
};

/* ── Messaging Helper ── */
async function safeSendMessage(payload) {
  try {
    return await chrome.runtime.sendMessage(payload);
  } catch (err) {
    console.error("Message error:", err);
    return null;
  }
}

/* ── Load stats ── */
async function loadStats() {
  const stats = await safeSendMessage({ type: "GET_STATS" });
  if (!stats) return;

  // Phase & Ring
  const phase = PHASE_MAP[stats.phase] || PHASE_MAP[0];
  phaseBadge.className = `phase-badge ${phase.cls}`;
  phaseBadge.textContent = phase.label;

  ringFill.classList.remove("warning", "bedtime");
  if (stats.phase >= 2) ringFill.classList.add("bedtime");
  else if (stats.phase === 1) ringFill.classList.add("warning");

  const hrs = Math.floor(stats.minutesLeft / 60);
  const mins = stats.minutesLeft % 60;
  ringTime.textContent = stats.minutesLeft > 0
    ? (hrs > 0 ? `${hrs}h` : `${mins}m`)
    : "Now";
  ringLabel.textContent = stats.minutesLeft > 0 ? "left" : "bed";

  const { warningMinutes = 30 } = await chrome.storage.local.get("warningMinutes");
  const pct = stats.phase === 0 ? 0 : Math.max(0, Math.min(1, (warningMinutes - stats.minutesLeft) / warningMinutes));
  ringFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - pct);

  statusBed.textContent = `Bed at ${stats.bedtime}`;

  // Quick Stats
  sleepScore.textContent = stats.sleepScore ?? "--";
  statTime.textContent = `${stats.timeSpentMin}m`;

  // Toggles
  toggleDim.checked = stats.enabled;
  toggleEye.checked = stats.eyeProtection;
  toggleFocus.checked = stats.focusMode;

  updateToggleStyles();

  // Collapsible Content
  if (stats.weeklyScores) renderWeeklyChart(stats.weeklyScores);
  if (stats.categoryBreakdown) renderCategoryBars(stats.categoryBreakdown);
}

function updateToggleStyles() {
  [$("label-dim"), $("label-eye"), $("label-focus")].forEach(label => {
    const input = label.querySelector('input');
    label.classList.toggle('active', input.checked);
  });
}

/* ── Renderers ── */
function renderWeeklyChart(scores) {
  weeklyChart.innerHTML = "";
  scores.forEach(({ score }, i) => {
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    const fill = document.createElement("div");
    fill.className = "chart-bar-fill";
    const val = score !== null ? score : 0;
    fill.style.height = `${val}%`;
    if (val < 50) fill.style.background = "var(--red)";
    else if (val < 80) fill.style.background = "var(--amber)";
    bar.appendChild(fill);
    weeklyChart.appendChild(bar);
  });
}

function renderCategoryBars(breakdown) {
  catBars.innerHTML = "";
  const maxMs = Math.max(1, ...Object.values(breakdown));
  Object.entries(breakdown).forEach(([cat, ms]) => {
    const row = document.createElement("div");
    row.className = "cat-mini-row";
    const label = document.createElement("span");
    label.style.width = "60px";
    label.textContent = cat;
    const barWrap = document.createElement("div");
    barWrap.className = "cat-mini-bar";
    const fill = document.createElement("div");
    fill.className = "cat-mini-fill";
    fill.style.width = `${Math.round((ms/maxMs)*100)}%`;
    barWrap.appendChild(fill);
    const time = document.createElement("span");
    time.style.width = "30px";
    time.style.textAlign = "right";
    time.textContent = `${Math.round(ms/60000)}m`;
    
    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(time);
    catBars.appendChild(row);
  });
}

/* ── Event Listeners ── */
toggleDim.addEventListener("change", async () => {
  await safeSendMessage({ type: "TOGGLE_ENABLED", enabled: toggleDim.checked });
  updateToggleStyles();
});

toggleEye.addEventListener("change", async () => {
  const { eyeIntensity = 2 } = await chrome.storage.local.get("eyeIntensity");
  await safeSendMessage({ type: "SET_EYE_PROTECTION", enabled: toggleEye.checked, intensity: eyeIntensity });
  updateToggleStyles();
});

toggleFocus.addEventListener("change", async () => {
  await safeSendMessage({ type: "TOGGLE_FOCUS", enabled: toggleFocus.checked });
  updateToggleStyles();
});

btnSnooze.addEventListener("click", () => {
  safeSendMessage({ type: "SNOOZE", minutes: 30 });
});

btnDone.addEventListener("click", () => {
  safeSendMessage({ type: "DONE_TONIGHT" });
});

btnTest.addEventListener("click", () => {
  safeSendMessage({ type: "TEST_DIM", phase: 3 });
});

btnSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

btnCloseDisruptors.addEventListener("click", async () => {
  const res = await safeSendMessage({ type: "CLOSE_DISRUPTORS" });
  if (res?.closed) btnCloseDisruptors.textContent = `Closed ${res.closed} tabs`;
  setTimeout(() => btnCloseDisruptors.textContent = "🧹 Close Disruptors", 2000);
});

collapseTrigger.addEventListener("click", () => {
  const isShow = collapseContent.classList.toggle("show");
  collapseIcon.textContent = isShow ? "▲" : "▼";
});

/* ── Breathing Exercise ── */
let breathing = false;
btnBreathe.addEventListener("click", () => {
  breathing = !breathing;
  btnBreathe.textContent = breathing ? "Stop Exercise" : "Start Exercise";
  // Simplified version for the compact UI
});

/* ── Init ── */
function updateClock() {
  const now = new Date();
  liveClock.textContent = now.toLocaleTimeString([], { hour12: false });
}

setInterval(updateClock, 1000);
updateClock();
loadStats();
setInterval(loadStats, 10000);
