/* ==========================================================================
   JARVIS — Wake check: the rules (pure functions, no page access, so they can
   be tested outside the browser).

   What it is: your own alarm rings (the Clock app does that, JARVIS can't). In
   the minutes after, you type a phrase in JARVIS. A few minutes later you type a
   second one. A morning where you typed both in time counts toward a streak.

   What it can and can't say, and the screens keep to this:
     - It records that a phrase was typed at the right time. It cannot see
       whether you are awake. Typing is the only evidence there is.
     - It cannot stop you silencing an alarm, or ignoring this screen.
     - A morning is "missed" only when a window really closed with the phrase
       not typed. Days the check isn't scheduled never count for or against you.

   Timing (mine, written down so nothing is a surprise):
     - The first window opens at your wake time and lasts `window` minutes.
     - Typing the first phrase starts the delay. The second window opens
       `delay` minutes after that and also lasts `window` minutes.
     - A phrase typed before its window opens, or after it closes, is refused.
     - Times use the clock and time zone of the phone.

   The store (localStorage key jarvisWakeCheck):
     { settings: { enabled, time "HH:MM", days [0..6, 0 = Sunday], phrase1, phrase2,
                   delay, window, caseSensitive, trackedFrom (ISO), updatedAt (ISO) },
       days: { "<YYYY-MM-DD>": { wake, delay, window, first, due, second } } }
   A day's record keeps the schedule it was judged by, so changing the time or
   the window later never rewrites a past morning. `first`, `due` and `second`
   are ISO moments, null until it happens.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisWakeCheckLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PHRASE_MAX = 60;
  const DELAY_RANGE = { min: 1, max: 60 };
  const WINDOW_RANGE = { min: 3, max: 30 };
  const MAX_DAYS = 1100;
  const MIN_MS = 60000;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  // The iPhone keyboard turns ' into ’. All of these count as the same apostrophe.
  const APOSTROPHES = /[’‘ʼ＇´`]/g;
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const DEFAULTS = { enabled: false, time: "07:00", days: [0, 1, 2, 3, 4, 5, 6], phrase1: "I'm awake", phrase2: "I'm still awake", delay: 5, window: 10, caseSensitive: false, trackedFrom: null, updatedAt: null };

  /* ---------------- phrases ---------------- */

  function tidy(text) { return String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim(); }
  function normalize(text) { return tidy(String(text === undefined || text === null ? "" : text).normalize("NFC").replace(APOSTROPHES, "'")); }

  // Capital letters are ignored unless caseSensitive. Extra spaces and the apostrophe style are always ignored. Nothing else is.
  function phraseMatches(typed, expected, caseSensitive) {
    const want = normalize(expected);
    if (!want) return false;
    const got = normalize(typed);
    return caseSensitive ? got === want : got.toLowerCase() === want.toLowerCase();
  }

  /* ---------------- dates (local time, DST-safe) ---------------- */

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateKey(ms) { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseKey(k) { const p = String(k).split("-").map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function addDays(k, n) {
    const p = parseKey(k);
    const u = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return u.getUTCFullYear() + "-" + pad(u.getUTCMonth() + 1) + "-" + pad(u.getUTCDate());
  }
  function weekdayOf(k) { const p = parseKey(k); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  // The moment HH:MM on that date, on this phone's clock.
  function momentOf(k, hhmm) {
    const p = parseKey(k), t = TIME_RE.exec(hhmm);
    return new Date(p.y, p.m - 1, p.d, Number(t[1]), Number(t[2]), 0, 0).getTime();
  }
  function iso(ms) { return new Date(ms).toISOString(); }
  function isoOrNull(v) { if (typeof v !== "string") return null; const t = Date.parse(v); return isNaN(t) ? null : new Date(t).toISOString(); }

  function formatHHMM(hhmm) {
    const m = TIME_RE.exec(String(hhmm));
    if (!m) return String(hhmm);
    const h = Number(m[1]);
    return (h % 12 === 0 ? 12 : h % 12) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM");
  }
  function formatMs(ms) { const d = new Date(ms); return formatHHMM(pad(d.getHours()) + ":" + pad(d.getMinutes())); }
  function countdownText(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }
  function dayName(k) { return WEEKDAYS[weekdayOf(k)]; }

  /* ---------------- settings ---------------- */

  function clampInt(v, lo, hi, dflt) { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; }
  function cleanPhrase(v, dflt) { const t = tidy(v).slice(0, PHRASE_MAX); return t || dflt; }
  function cleanDays(v) {
    const out = [];
    (Array.isArray(v) ? v : DEFAULTS.days).forEach(function (n) { n = Number(n); if (Number.isInteger(n) && n >= 0 && n <= 6 && out.indexOf(n) === -1) out.push(n); });
    out.sort(function (a, b) { return a - b; });
    return out.length ? out : DEFAULTS.days.slice();
  }

  function sanitizeSettings(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: s.enabled === true,
      time: TIME_RE.test(s.time) ? s.time : DEFAULTS.time,
      days: cleanDays(s.days),
      phrase1: cleanPhrase(s.phrase1, DEFAULTS.phrase1),
      phrase2: cleanPhrase(s.phrase2, DEFAULTS.phrase2),
      delay: clampInt(s.delay, DELAY_RANGE.min, DELAY_RANGE.max, DEFAULTS.delay),
      window: clampInt(s.window, WINDOW_RANGE.min, WINDOW_RANGE.max, DEFAULTS.window),
      caseSensitive: s.caseSensitive === true,
      trackedFrom: isoOrNull(s.trackedFrom),
      updatedAt: isoOrNull(s.updatedAt)
    };
  }

  // What the form entered, checked before anything is saved. -> { ok, settings } or { ok:false, field, error }
  function validateSettings(input) {
    const i = input || {};
    const bad = function (field, error) { return { ok: false, field: field, error: error }; };
    if (!TIME_RE.test(i.time)) return bad("time", "Pick the time your alarm rings.");
    if (!Array.isArray(i.days) || !i.days.length) return bad("days", "Pick at least one day.");
    const p1 = normalize(i.phrase1), p2 = normalize(i.phrase2);
    if (!p1) return bad("phrase1", "Type the phrase you'll use after the alarm.");
    if (p1.length > PHRASE_MAX) return bad("phrase1", "Keep the first phrase to " + PHRASE_MAX + " characters, so it's easy to type half asleep.");
    if (!p2) return bad("phrase2", "Type the phrase you'll use for the check-in.");
    if (p2.length > PHRASE_MAX) return bad("phrase2", "Keep the check-in phrase to " + PHRASE_MAX + " characters, so it's easy to type half asleep.");
    const delay = Number(i.delay), win = Number(i.window);
    if (!Number.isInteger(delay) || delay < DELAY_RANGE.min || delay > DELAY_RANGE.max) return bad("delay", "Enter a delay between " + DELAY_RANGE.min + " and " + DELAY_RANGE.max + " minutes.");
    if (!Number.isInteger(win) || win < WINDOW_RANGE.min || win > WINDOW_RANGE.max) return bad("window", "Enter a time to answer between " + WINDOW_RANGE.min + " and " + WINDOW_RANGE.max + " minutes.");
    return { ok: true, settings: sanitizeSettings(i) };
  }

  /* ---------------- the store ---------------- */

  function sanitizeDay(raw) {
    if (!raw || typeof raw !== "object") return null;
    const first = isoOrNull(raw.first);
    const second = first ? isoOrNull(raw.second) : null;
    return {
      wake: TIME_RE.test(raw.wake) ? raw.wake : null,
      delay: Number.isInteger(raw.delay) && raw.delay >= DELAY_RANGE.min && raw.delay <= DELAY_RANGE.max ? raw.delay : null,
      window: Number.isInteger(raw.window) && raw.window >= WINDOW_RANGE.min && raw.window <= WINDOW_RANGE.max ? raw.window : null,
      first: first,
      due: first ? isoOrNull(raw.due) : null,
      second: second
    };
  }

  function emptyStore() { return { settings: sanitizeSettings({}), days: {} }; }

  function sanitizeStore(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const days = {};
    Object.keys(r.days && typeof r.days === "object" ? r.days : {}).filter(function (k) { return DAY_RE.test(k); }).sort().slice(-MAX_DAYS).forEach(function (k) {
      const d = sanitizeDay(r.days[k]);
      if (d) days[k] = d;
    });
    return { settings: sanitizeSettings(r.settings), days: days };
  }

  /* ---------------- one morning ---------------- */

  function scheduleOf(rec, settings) {
    return { wake: (rec && rec.wake) || settings.time, delay: (rec && rec.delay) || settings.delay, window: (rec && rec.window) || settings.window };
  }

  function timeline(k, rec, settings) {
    const sc = scheduleOf(rec, settings);
    const wake = momentOf(k, sc.wake);
    const firstEnd = wake + sc.window * MIN_MS;
    let due = null, secondEnd = null;
    if (rec && rec.first) {
      due = rec.due ? Date.parse(rec.due) : Date.parse(rec.first) + sc.delay * MIN_MS;
      secondEnd = due + sc.window * MIN_MS;
    }
    return { sc: sc, wake: wake, firstEnd: firstEnd, due: due, secondEnd: secondEnd };
  }

  // upcoming | first (type the first phrase now) | waiting (first typed, check-in not open yet)
  // | second (type the check-in phrase now) | complete | missed
  function stateOf(k, rec, settings, nowMs) {
    if (rec && rec.second) return "complete";
    const t = timeline(k, rec, settings);
    if (!rec || !rec.first) return nowMs < t.wake ? "upcoming" : nowMs < t.firstEnd ? "first" : "missed";
    return nowMs < t.due ? "waiting" : nowMs < t.secondEnd ? "second" : "missed";
  }

  // Does this morning belong in the record? A day with a record always does. Without one it must be a scheduled
  // day whose first window ends after tracking began (so turning it on during the window still counts).
  function counts(k, rec, settings) {
    if (rec) return true;
    if (!settings.enabled || !settings.trackedFrom) return false;
    if (settings.days.indexOf(weekdayOf(k)) === -1) return false;
    return momentOf(k, settings.time) + settings.window * MIN_MS > Date.parse(settings.trackedFrom);
  }

  function nextMorning(store, nowMs) {
    const s = store.settings;
    if (!s.enabled) return null;
    const today = dateKey(nowMs);
    for (let i = 0; i < 15; i++) {
      const k = addDays(today, i);
      if (s.days.indexOf(weekdayOf(k)) === -1 || store.days[k]) continue;
      const wake = momentOf(k, s.time);
      if (wake > nowMs) return { dateKey: k, wake: wake };
    }
    return null;
  }

  /* ---------------- what the screen should show now ---------------- */

  // -> { mode: "off" | "active" | "upcoming" | "complete" | "missed" | "rest", dateKey, state, wake, firstEnd, due, secondEnd, reason, next }
  //   active   a window is open or the delay is running (state: first | waiting | second)
  //   upcoming today's wake time hasn't come yet
  //   complete / missed   today's morning is finished
  //   rest     nothing is scheduled for today (next says when the next one is)
  function view(store, nowMs) {
    const s = store.settings;
    if (!s.enabled) return { mode: "off", next: null };
    const today = dateKey(nowMs), yesterday = addDays(today, -1);
    const next = nextMorning(store, nowMs);
    const out = function (mode, k, rec, extra) { return Object.assign({ mode: mode, dateKey: k, next: next }, timeline(k, rec, s), extra || {}); };
    for (const k of [yesterday, today]) {
      const rec = store.days[k] || null;
      if (!counts(k, rec, s)) continue;
      const st = stateOf(k, rec, s, nowMs);
      if (st === "first" || st === "waiting" || st === "second") return out("active", k, rec, { state: st });
    }
    const rec = store.days[today] || null;
    if (counts(today, rec, s)) {
      const st = stateOf(today, rec, s, nowMs);
      if (st === "upcoming") return out("upcoming", today, rec, { state: st });
      if (st === "complete") return out("complete", today, rec, { state: st });
      if (st === "missed") return out("missed", today, rec, { state: st, reason: rec && rec.first ? "second" : "first" });
    }
    return { mode: "rest", next: next };
  }

  /* ---------------- typing a phrase ---------------- */

  // which: "first" | "second". -> { ok:true, store, state } or { ok:false, code, error }
  //   codes: off, none, early, late, done, needFirst, mismatch
  function answer(store, which, typed, nowMs) {
    const s = store.settings;
    const v = view(store, nowMs);
    const fail = function (code, error) { return { ok: false, code: code, error: error }; };
    if (v.mode === "off") return fail("off", "Wake check is turned off.");
    if (which === "first") {
      if (v.mode === "active" && v.state === "first") {
        if (!phraseMatches(typed, s.phrase1, s.caseSensitive)) return fail("mismatch", "That isn't it. Type it exactly as shown.");
        const rec = { wake: v.sc.wake, delay: v.sc.delay, window: v.sc.window, first: iso(nowMs), due: iso(nowMs + v.sc.delay * MIN_MS), second: null };
        return { ok: true, state: "waiting", store: { settings: s, days: Object.assign({}, store.days, { [v.dateKey]: rec }) } };
      }
      if (v.mode === "upcoming") return fail("early", "Not yet. This opens at " + formatMs(v.wake) + ".");
      if (v.mode === "active" || v.mode === "complete") return fail("done", "You've already typed this one.");
      if (v.mode === "missed") return fail("late", "The time to type it ran out at " + formatMs(v.reason === "first" ? v.firstEnd : v.secondEnd) + ".");
      return fail("none", "There's no check this morning.");
    }
    if (v.mode === "active" && v.state === "second") {
      if (!phraseMatches(typed, s.phrase2, s.caseSensitive)) return fail("mismatch", "That isn't it. Type it exactly as shown.");
      const rec = Object.assign({}, store.days[v.dateKey], { second: iso(nowMs) });
      return { ok: true, state: "complete", store: { settings: s, days: Object.assign({}, store.days, { [v.dateKey]: rec }) } };
    }
    if (v.mode === "active" && v.state === "waiting") return fail("early", "Not yet. The check-in opens at " + formatMs(v.due) + ".");
    if (v.mode === "active" && v.state === "first") return fail("needFirst", "Type the first phrase before this one.");
    if (v.mode === "complete") return fail("done", "You've already finished this morning.");
    if (v.mode === "missed") return fail("late", "The time to type it ran out at " + formatMs(v.reason === "first" ? v.firstEnd : v.secondEnd) + ".");
    return fail("none", "There's no check right now.");
  }

  /* ---------------- history and streaks ---------------- */

  // Writes a "missed" record for every morning whose time has fully run out without one, using the schedule it had.
  // Done when the app opens and before settings change, so a later edit can't change what an earlier morning was.
  function reconcile(store, nowMs) {
    const s = store.settings;
    if (!s.enabled || !s.trackedFrom) return store;
    const to = dateKey(nowMs);
    let days = store.days, changed = false;
    for (let k = dateKey(Date.parse(s.trackedFrom)), n = 0; k <= to && n < 800; k = addDays(k, 1), n++) {
      if (days[k] || !counts(k, null, s)) continue;
      if (nowMs < timeline(k, null, s).firstEnd) continue;
      if (!changed) { days = Object.assign({}, days); changed = true; }
      days[k] = { wake: s.time, delay: s.delay, window: s.window, first: null, due: null, second: null };
    }
    return changed ? { settings: s, days: days } : store;
  }

  // Saves settings the form checked. Reconciles first (under the old schedule). Turning it on, or changing the time or
  // days, starts tracking from now, so editing the time late in the day can't turn the morning into a miss.
  function applySettings(store, input, nowMs) {
    const base = reconcile(store, nowMs);
    const prev = base.settings;
    const next = sanitizeSettings(Object.assign({}, input, { updatedAt: iso(nowMs), trackedFrom: prev.trackedFrom }));
    const scheduleChanged = prev.time !== next.time || prev.days.join() !== next.days.join();
    if (next.enabled && (!prev.enabled || !prev.trackedFrom || scheduleChanged)) next.trackedFrom = iso(nowMs);
    return { settings: next, days: base.days };
  }

  // Oldest first: every morning that counts, as complete, missed or pending (still possible).
  function morningStatuses(store, nowMs) {
    const s = store.settings;
    const today = dateKey(nowMs);
    const keys = Object.keys(store.days).filter(function (k) { return k <= today; });
    if (s.enabled && s.trackedFrom) {
      for (let k = dateKey(Date.parse(s.trackedFrom)), n = 0; k <= today && n < 800; k = addDays(k, 1), n++) {
        if (!store.days[k] && counts(k, null, s)) keys.push(k);
      }
    }
    return keys.sort().map(function (k) {
      const st = stateOf(k, store.days[k] || null, s, nowMs);
      return { dateKey: k, status: st === "complete" ? "complete" : st === "missed" ? "missed" : "pending" };
    });
  }

  // A morning still in progress neither adds to the streak nor breaks it. A missed one ends it.
  function streaks(store, nowMs) {
    const list = morningStatuses(store, nowMs);
    let current = 0, best = 0, run = 0, total = 0, open = true;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].status === "pending") continue;
      if (list[i].status === "missed") open = false;
      else if (open) current++;
    }
    list.forEach(function (m) {
      if (m.status === "complete") { run++; total++; best = Math.max(best, run); } else if (m.status === "missed") run = 0;
    });
    return { current: current, best: best, total: total, mornings: list.length };
  }

  // The last n calendar days up to today, oldest first: complete | missed | pending | rest (nothing was scheduled).
  function recent(store, nowMs, n) {
    const by = {};
    morningStatuses(store, nowMs).forEach(function (m) { by[m.dateKey] = m.status; });
    const today = dateKey(nowMs), out = [];
    for (let i = (n || 14) - 1; i >= 0; i--) {
      const k = addDays(today, -i);
      out.push({ dateKey: k, weekday: weekdayOf(k), status: by[k] || "rest" });
    }
    return out;
  }

  return {
    PHRASE_MAX: PHRASE_MAX, DELAY_RANGE: DELAY_RANGE, WINDOW_RANGE: WINDOW_RANGE, DEFAULTS: DEFAULTS, WEEKDAYS: WEEKDAYS,
    normalize: normalize, phraseMatches: phraseMatches,
    dateKey: dateKey, addDays: addDays, weekdayOf: weekdayOf, momentOf: momentOf, formatHHMM: formatHHMM, formatMs: formatMs, countdownText: countdownText, dayName: dayName,
    sanitizeSettings: sanitizeSettings, validateSettings: validateSettings, sanitizeStore: sanitizeStore, emptyStore: emptyStore,
    timeline: timeline, stateOf: stateOf, view: view, answer: answer,
    reconcile: reconcile, applySettings: applySettings, morningStatuses: morningStatuses, streaks: streaks, recent: recent
  };
});
