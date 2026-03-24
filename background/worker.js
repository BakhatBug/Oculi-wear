/**
 * Sleep Cycle Optimizer — Service Worker (background/worker.js)
 * Handles tab classification, alarm scheduling, session tracking,
 * dimming broadcasts, and message routing.
 */

/* ────────────────────────── Strings ────────────────────────── */
const STRINGS = {
  alarmBedtime: "bedtimeWarning",
  alarmSnooze:  "snoozeAlarm",
  alarmCheck:   "phaseCheck",
  alarmBreak:   "eyeBreak",
  alarmMidnight: "midnightRoll",
  notifTitle:   "Sleep Cycle Optimizer",
  notifWarning: "🌙 Bedtime is approaching — time to wind down.",
  notifBedtime: "😴 It's past your bedtime! Close those tabs and rest.",
  notifBreak:   "👁️ Eye Break — Look 20 ft away for 20 seconds.",
};

/* ────────────────────── Sleep Disruptors ────────────────────── */
const SLEEP_DISRUPTORS = {
  social: [
    "instagram.com", "twitter.com", "x.com", "tiktok.com",
    "reddit.com", "facebook.com", "threads.net",
  ],
  streaming: [
    "youtube.com", "netflix.com", "twitch.tv", "primevideo.com",
    "hulu.com", "disneyplus.com",
  ],
  news: [
    "cnn.com", "bbc.com", "foxnews.com", "theguardian.com",
    "nytimes.com", "huffpost.com",
  ],
  messaging: [
    "discord.com", "whatsapp.com", "telegram.org", "messenger.com",
  ],
};

/* ────────────────────── Default Settings ────────────────────── */
const DEFAULT_SETTINGS = {
  bedtime: "23:00",
  warningMinutes: 30,
  dimIntensity: 3,
  categories: {
    social: true,
    streaming: true,
    news: true,
    messaging: true,
  },
  customDomains: [],
  enabled: true,
  focusMode: false,
  eyeProtection: false,
  eyeIntensity: 2,
  breakReminders: false,
  breakInterval: 25,
  wakeTime: "07:00",
  sleepDurationTarget: 8,
  todayLog: [],
  weeklyLogs: {},
  isPremium: false,
  stripeCustomerId: null,
  lastReportDate: null,
  streak: 0,
  lastStreakDate: null,
};

/* ────────────────────── State ────────────────────── */
/** Tracks active tab timers: tabId → { domain, category, startTs } */
const activeTimers = new Map();
let defaultsEnsured = false;

/**
 * Ensure new settings keys exist for users upgrading from older versions.
 */
async function ensureDefaults() {
  const current = await chrome.storage.local.get(null);
  const updates = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      updates[key] = value;
    }
  }

  const mergedCategories = {
    ...DEFAULT_SETTINGS.categories,
    ...(current.categories || {}),
  };
  const sameCategories = JSON.stringify(mergedCategories) === JSON.stringify(current.categories || {});
  if (!sameCategories) {
    updates.categories = mergedCategories;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

async function ensureDefaultsOnce() {
  if (defaultsEnsured) return;
  await ensureDefaults();
  defaultsEnsured = true;
}

/* ────────────────────── Helpers ────────────────────── */

/**
 * Classify a URL into a sleep-disruptor category.
 * @param {string} url - The tab URL to classify.
 * @param {object} categories - Enabled category flags from settings.
 * @param {string[]} customDomains - User-added custom domains.
 * @returns {string|null} Category name or null if not disruptive.
 */
function classifyTab(url, categories = {}, customDomains = []) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const [cat, domains] of Object.entries(SLEEP_DISRUPTORS)) {
      if (categories[cat] === false) continue;
      if (domains.some((d) => host.endsWith(d))) return cat;
    }
    if (customDomains.some((d) => host.endsWith(d))) return "custom";
  } catch {
    /* invalid URL — ignore */
  }
  return null;
}

/**
 * Get today's date key in YYYY-MM-DD format.
 * @returns {string}
 */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Determine the current bedtime phase (0 = safe, 1-3 = warning/bedtime).
 * @param {string} bedtime - HH:MM string.
 * @param {number} warningMinutes - Minutes before bedtime for first warning.
 * @returns {{ phase: number, minutesLeft: number }}
 */
function getBedtimePhase(bedtime, warningMinutes) {
  const [h, m] = bedtime.split(":").map(Number);
  const now = new Date();
  const bed = new Date();
  bed.setHours(h, m, 0, 0);

  // Handle past-midnight bedtimes
  if (bed.getHours() < 12 && now.getHours() > 12) {
    bed.setDate(bed.getDate() + 1);
  }

  const diffMin = (bed - now) / 60000;

  if (diffMin <= 0) return { phase: 3, minutesLeft: 0 };
  if (diffMin <= warningMinutes / 2) return { phase: 2, minutesLeft: Math.round(diffMin) };
  if (diffMin <= warningMinutes) return { phase: 1, minutesLeft: Math.round(diffMin) };
  return { phase: 0, minutesLeft: Math.round(diffMin) };
}

/**
 * Map dim intensity setting (1–5) and phase to overlay opacity.
 * @param {number} intensity - 1–5 user setting.
 * @param {number} phase - 1, 2, or 3.
 * @returns {number}
 */
function phaseOpacity(intensity, phase) {
  const base = [0, 0.15, 0.30, 0.55];
  const scale = intensity / 3; // 3 is default → 1×
  return Math.min(base[phase] * scale, 0.85);
}

/* ────────────────────── Sleep Score & Streak ────────────────────── */

/**
 * Build an array of 7 { day, date, score } entries (oldest → newest).
 */
function computeWeeklyScores(weeklyLogs, todayLog) {
  const DAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const scores = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const log = i === 0 ? todayLog : (weeklyLogs[key] || []);
    const score = log.length > 0 ? computeSleepScore(log, 30) : null;
    scores.push({ date: key, day: DAY_ABBR[d.getDay()], score });
  }
  return scores;
}

/**
 * Compute a sleep score (0–100) based on today's disruptive browsing.
 * 100 = no disruptive time; loses ~10 pts per 10 min of disruptive browsing.
 */
function computeSleepScore(todayLog, warningMinutes) {
  const totalMs = todayLog.reduce((s, e) => s + e.durationMs, 0);
  const totalMin = totalMs / 60000;
  const deduction = Math.min(100, Math.round(totalMin));
  return Math.max(0, 100 - deduction);
}

/**
 * Update the streak counter. Call at end of bedtime window.
 * If score >= 70, increment streak; otherwise reset to 0.
 */
async function updateStreak() {
  try {
    const { todayLog = [], warningMinutes = 30, streak = 0, lastStreakDate = null } =
      await chrome.storage.local.get(["todayLog", "warningMinutes", "streak", "lastStreakDate"]);

    const today = todayKey();
    if (lastStreakDate === today) return; // already updated today

    const score = computeSleepScore(todayLog, warningMinutes);
    const newStreak = score >= 70 ? streak + 1 : 0;
    await chrome.storage.local.set({ streak: newStreak, lastStreakDate: today });
  } catch (err) {
    console.error("updateStreak error:", err);
  }
}

/* ────────────────────── Alarm Scheduling ────────────────────── */

/**
 * Schedule (or reschedule) the nightly bedtime-warning alarm.
 */
async function scheduleAlarms() {
  try {
    const { bedtime = "23:00", warningMinutes = 30 } =
      await chrome.storage.local.get(["bedtime", "warningMinutes"]);
    const [h, m] = bedtime.split(":").map(Number);

    const now = new Date();
    const target = new Date();
    target.setHours(h, m - warningMinutes, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    const delayMin = (target - now) / 60000;
    // Only clear bedtime alarm, preserve snooze
    await chrome.alarms.clear(STRINGS.alarmBedtime);
    await chrome.alarms.clear(STRINGS.alarmCheck);
    await chrome.alarms.create(STRINGS.alarmBedtime, {
      delayInMinutes: delayMin,
      periodInMinutes: 1440,
    });
  } catch (err) {
    console.error("scheduleAlarms error:", err);
  }
}

/**
 * Schedule a daily midnight rollover alarm.
 */
async function scheduleMidnightRoll() {
  const now = new Date();
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 0);
  const delayMin = (nextMidnight - now) / 60000;

  await chrome.alarms.clear(STRINGS.alarmMidnight);
  await chrome.alarms.create(STRINGS.alarmMidnight, {
    delayInMinutes: Math.max(1, delayMin),
    periodInMinutes: 1440,
  });
}

function isInjectableTab(tab) {
  return Boolean(
    tab &&
    tab.id &&
    tab.url &&
    !tab.url.startsWith("chrome://") &&
    !tab.url.startsWith("chrome-extension://") &&
    !tab.url.startsWith("edge://") &&
    !tab.url.startsWith("about:")
  );
}

async function ensureTabScripts(tab) {
  if (!isInjectableTab(tab)) return false;

  try {
    const ping = await chrome.tabs.sendMessage(tab.id, { type: "PING_DIMMER" });
    if (ping?.ok) return true;
  } catch {
    /* content script not available yet */
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/dimmer.css"],
    });
  } catch {
    /* CSS may already exist or tab may reject CSS injection */
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/dimmer.js"],
    });
  } catch {
    /* Script may already exist or tab may reject script injection */
  }

  return true;
}

/* ────────────────────── Dimming Broadcast ────────────────────── */

/**
 * Send a DIM message to all active tabs.
 * @param {number} opacity - Overlay opacity.
 * @param {number} phase - 1, 2, or 3.
 */
async function broadcastDim(opacity, phase) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!isInjectableTab(tab)) continue;
      try {
        await ensureTabScripts(tab);
        await chrome.tabs.sendMessage(tab.id, { type: "DIM", opacity, phase });
      } catch {
        /* restricted tab or page lifecycle issue — skip */
      }
    }
  } catch (err) {
    console.error("broadcastDim error:", err);
  }
}

/**
 * Broadcast eye-protection state to all tabs.
 */
async function broadcastEyeProtection(enabled, intensity) {
  const OPACITY = { 1: 0.04, 2: 0.07, 3: 0.11, 4: 0.16, 5: 0.22 };
  const opacity = OPACITY[intensity] || 0.07;
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!isInjectableTab(tab)) continue;
      await ensureTabScripts(tab);
      chrome.tabs.sendMessage(tab.id, { type: "EYE_PROTECT", enabled, opacity }).catch(() => {});
    }
  } catch (err) {
    console.error("broadcastEyeProtection error:", err);
  }
}

/**
 * Send a BREAK_REMIND message to the active tab only.
 */
async function broadcastBreakRemind() {
  try {
    const [win] = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    if (!win) return;
    const activeTab = win.tabs?.find(t => t.active);
    if (!isInjectableTab(activeTab)) return;
    await ensureTabScripts(activeTab);
    chrome.tabs.sendMessage(activeTab.id, { type: "BREAK_REMIND" }).catch(() => {});
    chrome.notifications.create("sco-break", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: STRINGS.notifTitle,
      message: STRINGS.notifBreak,
    }).catch(() => {});
  } catch (err) {
    console.error("broadcastBreakRemind error:", err);
  }
}

/**
 * Create or clear the eye-break alarm based on settings.
 */
async function scheduleBreakReminder(enabled, intervalMin) {
  await chrome.alarms.clear(STRINGS.alarmBreak);
  if (enabled && intervalMin > 0) {
    await chrome.alarms.create(STRINGS.alarmBreak, {
      delayInMinutes: intervalMin,
      periodInMinutes: intervalMin,
    });
  }
}

/**
 * Send an UNDIM message to all active tabs.
 */
async function broadcastUndim() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!isInjectableTab(tab)) continue;
      await ensureTabScripts(tab);
      chrome.tabs.sendMessage(tab.id, { type: "UNDIM" }).catch(() => {});
    }
  } catch (err) {
    console.error("broadcastUndim error:", err);
  }
}

/**
 * Evaluate current bedtime phase and broadcast dim if needed.
 * Also handles focus mode blocking and badge updates.
 */
async function activateDimming() {
  try {
    const {
      bedtime = "23:00",
      warningMinutes = 30,
      dimIntensity = 3,
      enabled = true,
      focusMode = false,
      doneTonightTs = null,
    } = await chrome.storage.local.get([
      "bedtime", "warningMinutes", "dimIntensity", "enabled", "focusMode", "doneTonightTs",
    ]);

    const { phase: schedulePhase, minutesLeft } = getBedtimePhase(bedtime, warningMinutes);
    let activePhase = schedulePhase;

    // If user said "done for tonight", skip automatic activation
    if (doneTonightTs) {
      const doneDate = new Date(doneTonightTs).toDateString();
      const todayDate = new Date().toDateString();
      if (doneDate === todayDate) {
        // If it's bedtime, we respect "done". But if user toggles manually, we will let it through.
        // For simplicity: if doneTonight is true, we ONLY dim if enabled is manually force-toggled (which we handle in TOGGLE_ENABLED case).
        // Actually, let's just use enabled as the master.
        if (schedulePhase > 0) {
           await updateBadge(0);
           await broadcastUndim();
           return;
        }
      } else {
        await chrome.storage.local.remove("doneTonightTs");
      }
    }

    // NEW LOGIC: If enabled is TRUE, we always dim. 
    // If it's NOT bedtime (phase 0) but enabled is true, we use "Phase 1" as manual intensity.
    if (enabled) {
      const effectivePhase = Math.max(activePhase, 1);
      const opacity = phaseOpacity(dimIntensity, effectivePhase);
      
      await broadcastDim(opacity, effectivePhase);
      await updateBadge(activePhase); // Show actual schedule phase on badge
      
      if (focusMode && activePhase >= 2) {
        await broadcastFocusBlock();
      }

      // Phase-based notifications (only if it's actually schedule time)
      if (activePhase > 0) {
        try {
          const msg = activePhase === 3 ? STRINGS.notifBedtime : STRINGS.notifWarning;
          await chrome.notifications.create(`sco-phase-${activePhase}`, {
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: STRINGS.notifTitle,
            message: msg,
          });
        } catch {}
      }
    } else {
      // If NOT enabled, remove dimming
      await broadcastUndim();
      await updateBadge(0);
    }

  } catch (err) {
    console.error("activateDimming error:", err);
  }
}

/**
 * Broadcast a FOCUS_BLOCK message to disruptive tabs.
 */
async function broadcastFocusBlock() {
  try {
    const { categories = DEFAULT_SETTINGS.categories, customDomains = [] } =
      await chrome.storage.local.get(["categories", "customDomains"]);
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!isInjectableTab(tab)) continue;
      const cat = classifyTab(tab.url, categories, customDomains);
      if (!cat) continue;
      try {
        await ensureTabScripts(tab);
        await chrome.tabs.sendMessage(tab.id, { type: "FOCUS_BLOCK" });
      } catch {
        /* restricted tab */
      }
    }
  } catch (err) {
    console.error("broadcastFocusBlock error:", err);
  }
}

/**
 * Update extension badge with bedtime phase info.
 */
async function updateBadge(phase) {
  try {
    if (phase === 0) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    const { todayLog = [] } = await chrome.storage.local.get("todayLog");
    const totalMin = Math.round(todayLog.reduce((s, e) => s + e.durationMs, 0) / 60000);
    await chrome.action.setBadgeText({ text: totalMin > 0 ? `${totalMin}m` : "!" });
    const colors = { 1: "#f59e0b", 2: "#f97316", 3: "#ef4444" };
    await chrome.action.setBadgeBackgroundColor({ color: colors[phase] || "#8b5cf6" });
  } catch (err) {
    console.error("updateBadge error:", err);
  }
}

/* ────────────────────── Tab Session Tracking ────────────────────── */

/**
 * Start tracking time on a disruptive tab.
 * @param {number} tabId
 * @param {string} url
 */
async function startTimer(tabId, url) {
  try {
    const { categories = DEFAULT_SETTINGS.categories, customDomains = [] } =
      await chrome.storage.local.get(["categories", "customDomains"]);
    const category = classifyTab(url, categories, customDomains);
    if (!category) return;
    const host = new URL(url).hostname.replace(/^www\./, "");
    activeTimers.set(tabId, { domain: host, category, startTs: Date.now() });
  } catch (err) {
    console.error("startTimer error:", err);
  }
}

/**
 * Stop timer for a tab and persist the session entry to todayLog.
 * @param {number} tabId
 */
async function stopTimer(tabId) {
  const timer = activeTimers.get(tabId);
  if (!timer) return;
  activeTimers.delete(tabId);

  const durationMs = Date.now() - timer.startTs;
  if (durationMs < 2000) return; // ignore < 2s visits

  try {
    const { todayLog = [] } = await chrome.storage.local.get("todayLog");
    todayLog.push({
      domain: timer.domain,
      category: timer.category,
      startTs: timer.startTs,
      durationMs,
    });
    await chrome.storage.local.set({ todayLog });
  } catch (err) {
    console.error("stopTimer error:", err);
  }
}

/**
 * Roll todayLog into weeklyLogs at midnight and prune entries older than 28 days.
 */
async function rollDailyLog() {
  try {
    const { todayLog = [], weeklyLogs = {} } = await chrome.storage.local.get([
      "todayLog", "weeklyLogs",
    ]);
    const key = todayKey();
    if (todayLog.length > 0) {
      weeklyLogs[key] = todayLog;
    }

    // Prune entries older than 28 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    for (const dateKey of Object.keys(weeklyLogs)) {
      if (new Date(dateKey) < cutoff) delete weeklyLogs[dateKey];
    }

    await chrome.storage.local.set({ todayLog: [], weeklyLogs });
  } catch (err) {
    console.error("rollDailyLog error:", err);
  }
}

/**
 * Generate a weekly report object from weeklyLogs (premium feature).
 */
async function generateWeeklyReport() {
  try {
    const { weeklyLogs = {}, bedtime = "23:00", isPremium = false } =
      await chrome.storage.local.get(["weeklyLogs", "bedtime", "isPremium"]);

    if (!isPremium) return;

    const now = new Date();
    if (now.getDay() !== 0) return; // Only on Sundays

    const categoryTotals = {};
    const domainCounts = {};
    let totalMs = 0;

    for (const [, entries] of Object.entries(weeklyLogs)) {
      for (const entry of entries) {
        totalMs += entry.durationMs;
        categoryTotals[entry.category] = (categoryTotals[entry.category] || 0) + entry.durationMs;
        domainCounts[entry.domain] = (domainCounts[entry.domain] || 0) + 1;
      }
    }

    const topDomains = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count }));

    const report = {
      generatedAt: now.toISOString(),
      totalBrowsingMinutes: Math.round(totalMs / 60000),
      categoryBreakdown: categoryTotals,
      topDisruptiveDomains: topDomains,
      configuredBedtime: bedtime,
    };

    await chrome.storage.local.set({ lastReport: report, lastReportDate: todayKey() });
  } catch (err) {
    console.error("generateWeeklyReport error:", err);
  }
}

/* ────────────────────── Event Listeners ────────────────────── */

/**
 * On extension install — set default storage values and schedule alarms.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    if (details.reason === "install") {
      await chrome.storage.local.set({ ...DEFAULT_SETTINGS });
    } else {
      await ensureDefaults();
    }
    await scheduleAlarms();
    await scheduleMidnightRoll();
    chrome.idle.setDetectionInterval(300);

    // Initial Injection into all open tabs
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (isInjectableTab(tab)) {
        await ensureTabScripts(tab).catch(() => {});
      }
    }
  } catch (err) {
    console.error("onInstalled error:", err);
  }
});

/* Idle detection — stop tracking when user is away */
chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "idle" || newState === "locked") {
    for (const [tabId] of activeTimers) {
      await stopTimer(tabId);
    }
  }
});

/* Keyboard shortcuts */
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "toggle-eye-protection") {
      const { eyeProtection = false, eyeIntensity = 2 } =
        await chrome.storage.local.get(["eyeProtection", "eyeIntensity"]);
      const next = !eyeProtection;
      await chrome.storage.local.set({ eyeProtection: next });
      await broadcastEyeProtection(next, eyeIntensity);
    }
    if (command === "toggle-dimming") {
      const { enabled = true } = await chrome.storage.local.get("enabled");
      const next = !enabled;
      await chrome.storage.local.set({ enabled: next });
      if (!next) await broadcastUndim();
    }
  } catch (err) {
    console.error("onCommand error:", err);
  }
});

/**
 * On service worker startup — reschedule alarms (they persist but good to verify).
 */
chrome.runtime.onStartup.addListener(async () => {
  try {
    await ensureDefaults();
    await rollDailyLog();
    await scheduleAlarms();
    await scheduleMidnightRoll();
    // Reschedule break reminder if enabled
    const { breakReminders = false, breakInterval = 25 } =
      await chrome.storage.local.get(["breakReminders", "breakInterval"]);
    await scheduleBreakReminder(breakReminders, breakInterval);
    // Initialize idle detection
    chrome.idle.setDetectionInterval(300); // 5 minutes
  } catch (err) {
    console.error("onStartup error:", err);
  }
});

/**
 * Tab activated — classify and start timer.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    // Stop timer on previously active tab in this window
    for (const [id] of activeTimers) {
      if (id !== activeInfo.tabId) await stopTimer(id);
    }
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) await startTimer(activeInfo.tabId, tab.url);
  } catch (err) {
    console.error("onActivated error:", err);
  }
});

/**
 * Tab URL updated — reclassify.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    await stopTimer(tabId);
    await startTimer(tabId, changeInfo.url);
  }
});

/**
 * Tab removed — stop timer, save duration.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await stopTimer(tabId);
});

/**
 * Alarm fired — evaluate bedtime phase and dim.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === STRINGS.alarmBedtime) {
    // Warning window started — set enabled to true for automatic activation
    await chrome.storage.local.set({ enabled: true });
    // begin checking every minute for phase progression
    await chrome.alarms.create(STRINGS.alarmCheck, { periodInMinutes: 1 });
    await activateDimming();
    await generateWeeklyReport();
    await updateStreak();
  }
  if (alarm.name === STRINGS.alarmCheck) {
    await activateDimming();
  }
  if (alarm.name === STRINGS.alarmSnooze) {
    await activateDimming();
  }
  if (alarm.name === STRINGS.alarmBreak) {
    await broadcastBreakRemind();
  }
  if (alarm.name === STRINGS.alarmMidnight) {
    await rollDailyLog();
    await generateWeeklyReport();
  }
});

/**
 * Message router — popup, content script, and options communicate through here.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      await ensureDefaultsOnce();
      switch (msg.type) {
        case "PING": {
          sendResponse({ ok: true, ts: Date.now() });
          break;
        }

        case "GET_STATS": {
          const {
            todayLog = [], bedtime = "23:00", warningMinutes = 30,
            enabled = true, streak = 0, focusMode = false,
            weeklyLogs = {}, eyeProtection = false, eyeIntensity = 2,
          } = await chrome.storage.local.get([
            "todayLog", "bedtime", "warningMinutes", "enabled", "streak", "focusMode",
            "weeklyLogs", "eyeProtection", "eyeIntensity",
          ]);
          const { phase, minutesLeft } = getBedtimePhase(bedtime, warningMinutes);
          const totalMs = todayLog.reduce((s, e) => s + e.durationMs, 0);

          // Category breakdown (ms per category)
          const categoryBreakdown = {};
          const catCounts = {};
          for (const e of todayLog) {
            categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + e.durationMs;
            catCounts[e.category] = (catCounts[e.category] || 0) + 1;
          }
          const topCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];

          // Sleep score: 100 base, lose points for disruptive time during warning window
          const sleepScore = computeSleepScore(todayLog, warningMinutes);
          const weeklyScores = computeWeeklyScores(weeklyLogs, todayLog);

          sendResponse({
            phase,
            minutesLeft,
            bedtime,
            enabled,
            focusMode,
            eyeProtection,
            eyeIntensity,
            disruptiveTabs: todayLog.length,
            timeSpentMin: Math.round(totalMs / 60000),
            topCategory: topCategory ? topCategory[0] : "—",
            categoryBreakdown,
            sleepScore,
            streak,
            weeklyScores,
          });
          break;
        }

        case "SNOOZE": {
          await broadcastUndim();
          const snoozeMin = msg.minutes || 10;
          await chrome.alarms.create(STRINGS.alarmSnooze, { delayInMinutes: snoozeMin });
          sendResponse({ ok: true });
          break;
        }

        case "DONE_TONIGHT": {
          await broadcastUndim();
          await chrome.storage.local.set({ doneTonightTs: Date.now() });
          sendResponse({ ok: true });
          break;
        }

        case "TOGGLE_ENABLED": {
          await chrome.storage.local.set({ enabled: msg.enabled });
          if (!msg.enabled) {
            await broadcastUndim();
          } else {
            await activateDimming();
          }
          sendResponse({ ok: true });
          break;
        }

        case "TEST_DIM": {
          // Instant test: broadcast phase 3 dimming to all tabs
          const { dimIntensity = 3 } = await chrome.storage.local.get("dimIntensity");
          const testPhase = msg.phase || 3;
          const opacity = phaseOpacity(dimIntensity, testPhase);
          await broadcastDim(opacity, testPhase);
          sendResponse({ ok: true, opacity, phase: testPhase });
          break;
        }

        case "TOGGLE_FOCUS": {
          await chrome.storage.local.set({ focusMode: msg.enabled });
          if (!msg.enabled) {
            // Unblock any focus-blocked tabs
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
              if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) continue;
              chrome.tabs.sendMessage(tab.id, { type: "FOCUS_UNBLOCK" }).catch(() => {});
            }
          } else {
            await activateDimming();
          }
          sendResponse({ ok: true });
          break;
        }

        case "SET_EYE_PROTECTION": {
          const intensity = msg.intensity ?? 2;
          await chrome.storage.local.set({ eyeProtection: msg.enabled, eyeIntensity: intensity });
          await broadcastEyeProtection(msg.enabled, intensity);
          sendResponse({ ok: true });
          break;
        }

        case "CLOSE_DISRUPTORS": {
          const { categories = DEFAULT_SETTINGS.categories, customDomains = [] } =
            await chrome.storage.local.get(["categories", "customDomains"]);
          const allTabs = await chrome.tabs.query({});
          let closed = 0;
          for (const tab of allTabs) {
            if (!tab.id || !tab.url) continue;
            if (classifyTab(tab.url, categories, customDomains)) {
              await chrome.tabs.remove(tab.id);
              closed++;
            }
          }
          sendResponse({ ok: true, closed });
          break;
        }

        case "SET_BREAK_REMINDER": {
          await chrome.storage.local.set({ breakReminders: msg.enabled, breakInterval: msg.interval || 25 });
          await scheduleBreakReminder(msg.enabled, msg.interval || 25);
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ error: "Unknown message type" });
      }
    } catch (err) {
      console.error("onMessage error:", err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // keep message channel open for async sendResponse
});

/**
 * Storage changed — reschedule alarms when bedtime settings change.
 */
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.bedtime || changes.warningMinutes) {
    await scheduleAlarms();
  }
  if (changes.breakReminders || changes.breakInterval) {
    const { breakReminders = false, breakInterval = 25 } =
      await chrome.storage.local.get(["breakReminders", "breakInterval"]);
    await scheduleBreakReminder(breakReminders, breakInterval);
  }
  if (changes.eyeProtection || changes.eyeIntensity) {
    const { eyeProtection = false, eyeIntensity = 2 } =
      await chrome.storage.local.get(["eyeProtection", "eyeIntensity"]);
    await broadcastEyeProtection(eyeProtection, eyeIntensity);
  }
});
