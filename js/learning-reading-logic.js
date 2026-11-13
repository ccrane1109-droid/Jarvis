/* ==========================================================================
   JARVIS — Learning & Research Hub: reading analytics and the optional reading timer (pure rules).

   Where the numbers come from
     pages     only from a book's page log (learning-logic.js dailyPages). Each page is counted once: a day's pages are how far
               that day's update went past the furthest page reached so far, so correcting a page number down, or going back to
               re-read, adds nothing. The first update of a book is the starting point and adds nothing.
     minutes   only from reading-time sessions you save (timer or typed in). A session never carries pages, so a timer session
               and a page update for the same reading can never count the same pages twice.
   A "session" for the pages average is one book on one day with pages gained. A "reading day" is a day with pages gained or
   reading time saved. Nothing is estimated: a day with neither is a day with nothing recorded.

   A reading-time session:  { id, bookId, day, minutes, note, createdAt, updatedAt, deletedAt? }
   The timer itself is { bookId, startedAt, accumulated, runSince } kept only on this device: elapsed time is worked out from the
   clock, so it keeps counting while the app is closed and stops counting while paused.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./learning-logic"));
  else root.JarvisLearningReading = factory(root.JarvisLearningLogic);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const KEY = "jarvisLearnSessions", TIMER_KEY = "jarvisLearnTimer";
  const MAX_MINUTES = 720, MIN_TIMER_MS = 30000, MAX_TIMER_MS = 7 * 86400000;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function line(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function undef(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined) delete o[k]; }); return o; }
  function wholeMinutes(v) {
    const n = typeof v === "number" ? v : (typeof v === "string" && /^\d{1,4}$/.test(v.trim()) ? Number(v) : NaN);
    return isFinite(n) && Math.floor(n) === n && n >= 1 && n <= MAX_MINUTES ? n : 0;
  }

  /* ---------------- reading-time sessions ---------------- */

  function read(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const minutes = wholeMinutes(raw.minutes);
    if (!minutes || !L.isDate(raw.day)) return null;
    return undef({
      id: raw.id, createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt), deletedAt: num(raw.deletedAt) || undefined,
      bookId: typeof raw.bookId === "string" && raw.bookId.length <= 80 ? raw.bookId : "", day: raw.day, minutes: minutes, note: line(raw.note, 200)
    });
  }
  L.registerKind({ kind: "sessions", key: KEY, prefix: "rt", read: read });

  // ctx: { today, books } (the live books, to check the one chosen still exists)
  function check(input, ctx) {
    const c = ctx || {}, i = input || {}, e = {};
    const minutes = wholeMinutes(i.minutes);
    if (!minutes) e.minutes = "Enter whole minutes, from 1 to " + MAX_MINUTES + ".";
    const day = typeof i.day === "string" ? i.day : "";
    if (!L.isDate(day)) e.day = "Choose the day you read.";
    else if (c.today && day > c.today) e.day = "That day hasn't happened yet.";
    const bookId = typeof i.bookId === "string" ? i.bookId : "";
    if (bookId && c.books && !c.books.some(function (b) { return b.id === bookId; })) e.bookId = "That book no longer exists.";
    if (Object.keys(e).length) return { ok: false, errors: e };
    return { ok: true, value: { bookId: bookId, day: day, minutes: minutes, note: line(i.note, 200) } };
  }

  /* ---------------- the timer ---------------- */

  function timerRead(raw) {
    if (!isObj(raw) || !isFinite(raw.startedAt) || raw.startedAt <= 0) return null;
    return {
      bookId: typeof raw.bookId === "string" && raw.bookId.length <= 80 ? raw.bookId : "", startedAt: raw.startedAt,
      accumulated: isFinite(raw.accumulated) && raw.accumulated > 0 ? Math.min(raw.accumulated, MAX_TIMER_MS) : 0,
      runSince: isFinite(raw.runSince) && raw.runSince > 0 ? raw.runSince : 0
    };
  }
  function timerStart(bookId, now) { return { bookId: bookId || "", startedAt: now, accumulated: 0, runSince: now }; }
  function timerRunning(t) { return !!t && t.runSince > 0; }
  function timerElapsed(t, now) {
    if (!t) return 0;
    return Math.min(MAX_TIMER_MS, t.accumulated + (t.runSince > 0 ? Math.max(0, now - t.runSince) : 0));      // a clock set backwards adds nothing, never subtracts
  }
  function timerPause(t, now) { return timerRunning(t) ? Object.assign({}, t, { accumulated: timerElapsed(t, now), runSince: 0 }) : t; }
  function timerResume(t, now) { return t && !timerRunning(t) ? Object.assign({}, t, { runSince: now }) : t; }
  // The whole minutes to offer when the timer is stopped: nothing under half a minute; at least one minute after that.
  function minutesFrom(ms) { return ms < MIN_TIMER_MS ? 0 : Math.min(MAX_MINUTES, Math.max(1, Math.round(ms / 60000))); }
  function clock(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const two = function (n) { return String(n).padStart(2, "0"); };
    return h > 0 ? h + ":" + two(m) + ":" + two(sec) : m + ":" + two(sec);
  }

  /* ---------------- what was read, by day ---------------- */

  // Pages gained per day across all books: { "2026-11-04": 30, ... } (only days with pages gained).
  function pageDays(books) {
    const out = {};
    L.live(books).forEach(function (b) { L.dailyPages(b).forEach(function (e) { if (e.pages > 0) out[e.d] = (out[e.d] || 0) + e.pages; }); });
    return out;
  }
  // Minutes saved per day: { day: minutes }.
  function minuteDays(sessions) {
    const out = {};
    L.live(sessions).forEach(function (s) { if (L.isDate(s.day) && s.minutes > 0) out[s.day] = (out[s.day] || 0) + s.minutes; });
    return out;
  }
  // Sessions for the pages average: one per book per day with pages gained -> [{ d, bookId, pages }].
  function pageSessions(books) {
    const out = [];
    L.live(books).forEach(function (b) { L.dailyPages(b).forEach(function (e) { if (e.pages > 0) out.push({ d: e.d, bookId: b.id, pages: e.pages }); }); });
    return out;
  }
  function inRange(d, from, to) { return d >= from && d <= to; }
  function sumDays(map, from, to) { return Object.keys(map).reduce(function (s, d) { return inRange(d, from, to) ? s + map[d] : s; }, 0); }

  // Totals between two dates (inclusive).
  function totals(books, sessions, from, to) {
    const p = pageDays(books), m = minuteDays(sessions), days = {};
    Object.keys(p).forEach(function (d) { if (inRange(d, from, to)) days[d] = true; });
    Object.keys(m).forEach(function (d) { if (inRange(d, from, to)) days[d] = true; });
    return { from: from, to: to, pages: sumDays(p, from, to), minutes: sumDays(m, from, to), activeDays: Object.keys(days).length };
  }
  function monthStart(d) { return d.slice(0, 8) + "01"; }
  function monthEnd(d) { const last = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate(); return d.slice(0, 8) + String(last).padStart(2, "0"); }

  // Books finished in a calendar year, by the date each was marked finished. `undated` counts finished books with no finish date.
  function booksFinished(books, year) {
    let n = 0, undated = 0;
    L.live(books).forEach(function (b) {
      if (b.status !== "completed") return;
      if (!L.isDate(b.endDate)) { undated++; return; }
      if (b.endDate.slice(0, 4) === String(year)) n++;
    });
    return { count: n, undated: undated };
  }

  // Today, this week (Monday to Sunday), this month and this year, with the running averages.
  function overview(books, sessions, today) {
    const wk = L.weekStart(today);
    const ps = pageSessions(books), from30 = L.addDays(today, -29);
    const recent = ps.filter(function (x) { return inRange(x.d, from30, today); });
    const recentPages = recent.reduce(function (s, x) { return s + x.pages; }, 0);
    const allPages = ps.reduce(function (s, x) { return s + x.pages; }, 0);
    const live = L.live(sessions).filter(function (s) { return inRange(s.day, from30, today); });
    const liveAll = L.live(sessions);
    const sum = function (list) { return list.reduce(function (s, x) { return s + x.minutes; }, 0); };
    return {
      today: totals(books, sessions, today, today),
      week: totals(books, sessions, wk, L.addDays(wk, 6)),
      month: totals(books, sessions, monthStart(today), monthEnd(today)),
      year: Object.assign(totals(books, sessions, today.slice(0, 4) + "-01-01", today.slice(0, 4) + "-12-31"), { booksFinished: booksFinished(books, today.slice(0, 4)) }),
      avgPages: { last30: recent.length ? { sessions: recent.length, avg: Math.round(recentPages / recent.length * 10) / 10 } : null, all: ps.length ? { sessions: ps.length, avg: Math.round(allPages / ps.length * 10) / 10 } : null },
      avgMinutes: { last30: live.length ? { sessions: live.length, avg: Math.round(sum(live) / live.length) } : null, all: liveAll.length ? { sessions: liveAll.length, avg: Math.round(sum(liveAll) / liveAll.length) } : null },
      streak: streaks(books, sessions, today)
    };
  }

  // Consecutive days with something recorded. The current streak is still alive if yesterday had reading and today has none yet.
  function streaks(books, sessions, today) {
    const p = pageDays(books), m = minuteDays(sessions), set = {};
    Object.keys(p).forEach(function (d) { set[d] = true; });
    Object.keys(m).forEach(function (d) { set[d] = true; });
    const days = Object.keys(set).filter(function (d) { return d <= today; }).sort();
    let longest = 0, run = 0, prev = "";
    days.forEach(function (d) { run = prev && L.diffDays(prev, d) === 1 ? run + 1 : 1; if (run > longest) longest = run; prev = d; });
    let cur = 0, d = set[today] ? today : L.addDays(today, -1);
    while (set[d]) { cur++; d = L.addDays(d, -1); }
    return { current: cur, longest: longest, lastRead: days.length ? days[days.length - 1] : "", totalDays: days.length };
  }

  /* ---------------- the history graph ---------------- */

  // mode "days" (the last 14), "weeks" (the last 12, Monday to Sunday) or "months" (the last 12) -> [{ from, to, label, title, pages, minutes }]
  function series(books, sessions, mode, today) {
    const points = [];
    if (mode === "weeks") {
      const wk = L.weekStart(today);
      for (let i = 11; i >= 0; i--) { const f = L.addDays(wk, -7 * i); points.push({ from: f, to: L.addDays(f, 6) }); }
    } else if (mode === "months") {
      const y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7)) - 1;
      for (let i = 11; i >= 0; i--) {
        const t = new Date(Date.UTC(y, mo - i, 1)), f = t.toISOString().slice(0, 10);
        points.push({ from: f, to: monthEnd(f) });
      }
    } else {
      for (let i = 13; i >= 0; i--) { const d = L.addDays(today, -i); points.push({ from: d, to: d }); }
    }
    const p = pageDays(books), m = minuteDays(sessions);
    return points.map(function (x) {
      const pages = sumDays(p, x.from, x.to), minutes = sumDays(m, x.from, x.to);
      const dayNo = Number(x.from.slice(8)), monthName = MONTHS[Number(x.from.slice(5, 7)) - 1];
      const label = mode === "months" ? monthName.slice(0, 3) : String(dayNo);
      const when = mode === "months" ? monthName + " " + x.from.slice(0, 4) : mode === "weeks" ? "Week of " + monthName.slice(0, 3) + " " + dayNo : monthName.slice(0, 3) + " " + dayNo;
      return { from: x.from, to: x.to, label: label, title: when + ": " + pages + (pages === 1 ? " page" : " pages") + ", " + minutes + (minutes === 1 ? " minute" : " minutes"), pages: pages, minutes: minutes };
    });
  }

  /* ---------------- the consistency calendar ---------------- */

  // One month as Monday-first weeks. ym "YYYY-MM". Cells outside the month are null.
  function calendar(books, sessions, ym, today) {
    const first = ym + "-01", last = monthEnd(first);
    const p = pageDays(books), m = minuteDays(sessions);
    const weeks = [];
    let d = L.weekStart(first), active = 0;
    while (d <= last) {
      const row = [];
      for (let i = 0; i < 7; i++, d = L.addDays(d, 1)) {
        if (d < first || d > last) { row.push(null); continue; }
        const pages = p[d] || 0, minutes = m[d] || 0, read = pages > 0 || minutes > 0;
        if (read) active++;
        row.push({ d: d, day: Number(d.slice(8)), pages: pages, minutes: minutes, read: read, today: d === today, future: d > today });
      }
      weeks.push(row);
    }
    const y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7));
    const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
    return { ym: ym, title: MONTHS[mo - 1] + " " + y, weeks: weeks, activeDays: active, prev: prev, next: next, canNext: next <= (today || "").slice(0, 7) };
  }

  /* ---------------- lists ---------------- */

  function recentSessions(sessions, n) {
    return L.live(sessions).slice().sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : num(b.createdAt) - num(a.createdAt); }).slice(0, n || 20);
  }
  function bookMinutes(sessions, bookId) { return L.live(sessions).reduce(function (s, x) { return x.bookId === bookId ? s + x.minutes : s; }, 0); }
  // "1 h 5 min", "45 min"
  function minutesText(n) { const h = Math.floor(n / 60), m = n % 60; return h ? h + " h" + (m ? " " + m + " min" : "") : m + " min"; }

  return {
    KEY: KEY, TIMER_KEY: TIMER_KEY, MAX_MINUTES: MAX_MINUTES, MIN_TIMER_MS: MIN_TIMER_MS, MONTHS: MONTHS,
    read: read, check: check,
    timerRead: timerRead, timerStart: timerStart, timerRunning: timerRunning, timerElapsed: timerElapsed, timerPause: timerPause, timerResume: timerResume, minutesFrom: minutesFrom, clock: clock,
    pageDays: pageDays, minuteDays: minuteDays, pageSessions: pageSessions, totals: totals, booksFinished: booksFinished, overview: overview, streaks: streaks,
    series: series, calendar: calendar, recentSessions: recentSessions, bookMinutes: bookMinutes, minutesText: minutesText
  };
});
