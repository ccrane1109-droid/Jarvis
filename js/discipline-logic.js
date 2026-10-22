/* ==========================================================================
   JARVIS — Discipline tracker: the rules (pure functions, no page access, so
   they can be tested outside the browser).

   Everything here comes from what you typed in. Nothing is estimated, guessed
   or filled in for you, and no AI is involved.

   The daily score (out of 100):
     Following through on priorities   30   the one task that makes the day a win counts double,
                                            each other priority (up to 3) counts once
     Focus and phone                   20   focus rating 10, phone time against your limit 10
     Time management                   15   how closely you kept your plan, rated 1-5
     School and business               15   school work 7, a business block that made something 8
     Healthy routines                  10   bed on time 4, phone out of the bedroom 3, trained or rested as planned 3
     Reflection                        10   a morning plan saved 4, the evening questions answered 6

   An item marked "not today" (sick, exam, planned rest, travel...) is left out
   of both what you earned and what was possible, so the score is out of what
   was attainable that day. Days with excused items are counted and shown in
   the trends, so they can't hide. A day is scored only once every item is
   answered; a day with no review has no score (it is never counted as zero).
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisDisciplineLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATEGORIES = [
    { key: "followThrough", label: "Following through", max: 30 },
    { key: "focus", label: "Focus and phone", max: 20 },
    { key: "time", label: "Time management", max: 15 },
    { key: "consistency", label: "School and business", max: 15 },
    { key: "routines", label: "Healthy routines", max: 10 },
    { key: "reflection", label: "Reflection", max: 10 }
  ];

  // Yes/no items (answered "done", "not" or "na" = not today).
  const ITEMS = {
    school: { label: "School work", category: "consistency", points: 7 },
    gratiel: { label: "Business block that made something", category: "consistency", points: 8 },
    bedOnTime: { label: "Bed on time", category: "routines", points: 4 },
    phoneOut: { label: "Phone out of the bedroom", category: "routines", points: 3 },
    training: { label: "Trained or rested as planned", category: "routines", points: 3 }
  };
  const PHONE_POINTS = 10;
  const FOCUS_POINTS = 10;
  const PLAN_POINTS = 4;
  const NOTES_POINTS = 6;
  const NOTE_FIELDS = ["procrastinated", "distractions", "wentWell", "improve"];

  // Which items a kind of day usually excuses. Only a starting point: each can still be changed.
  const DAY_TYPES = {
    normal: { label: "Normal day", na: [] },
    exam: { label: "Exam or heavy school day", na: ["gratiel"] },
    sick: { label: "Sick or recovering", na: ["gratiel", "training", "phone"] },
    rest: { label: "Planned rest day", na: ["training"] },
    travel: { label: "Travel or event day", na: ["gratiel", "training"] }
  };

  const PRIORITY_MAX = 100;
  const NOTE_MAX = 240;
  const DEFAULT_PHONE_LIMIT = 5;
  const MIN_NOTE_CHARS = 3;
  const MIN_DAYS_FOR_AVERAGES = 3;
  const MIN_DAYS_FOR_WEEKDAYS = 14;

  /* ---------------- dates (plain YYYY-MM-DD strings, never parsed as UTC instants) ---------------- */

  function isISODate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekdayOf(iso) { return new Date(iso + "T00:00:00Z").getUTCDay(); } // 0 = Sunday
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }

  /* ---------------- cleaning what is stored or typed ---------------- */

  function clean(v, max) {
    return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  }
  function rating(v) {
    const n = Number(v);
    return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  }
  function hours(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isFinite(n) && n >= 0 && n <= 24 ? Math.round(n * 10) / 10 : null;
  }
  function limit(v) {
    const n = Number(v);
    return isFinite(n) && n >= 0.5 && n <= 24 ? Math.round(n * 10) / 10 : DEFAULT_PHONE_LIMIT;
  }
  function state(v) { return v === "done" || v === "not" || v === "na" ? v : null; }
  function stamp(v) { return Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : Date.now(); }

  function sanitizeMorning(raw) {
    if (!raw || typeof raw !== "object") return null;
    const list = Array.isArray(raw.priorities) ? raw.priorities : [];
    const priorities = [];
    for (let i = 0; i < 3; i++) {
      const p = list[i] || {};
      const text = clean(p.text, PRIORITY_MAX);
      priorities.push({ text: text, done: !!text && p.done === true });
    }
    const key = raw.keyTask || {};
    const keyText = clean(key.text, PRIORITY_MAX);
    const savedAt = stamp(raw.savedAt);
    return {
      priorities: priorities,
      keyTask: { text: keyText, done: !!keyText && key.done === true },
      distraction: clean(raw.distraction, NOTE_MAX),
      plan: clean(raw.plan, NOTE_MAX),
      savedAt: savedAt,
      // When the priorities last changed. A plan changed after its day was scored is flagged on the score card.
      editedAt: raw.editedAt ? stamp(raw.editedAt) : savedAt
    };
  }

  function sanitizeReview(raw) {
    if (!raw || typeof raw !== "object") return null;
    const items = {};
    Object.keys(ITEMS).concat(["phone"]).forEach(function (k) { items[k] = state(raw.items && raw.items[k]); });
    const review = {
      screenHours: hours(raw.screenHours),
      phoneLimit: limit(raw.phoneLimit),
      items: items,
      focus: rating(raw.focus),
      time: rating(raw.time),
      output: clean(raw.output, NOTE_MAX),
      savedAt: stamp(raw.savedAt)
    };
    NOTE_FIELDS.forEach(function (f) { review[f] = clean(raw[f], NOTE_MAX); });
    return review;
  }

  function sanitizeDay(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    return {
      type: DAY_TYPES[d.type] ? d.type : "normal",
      morning: sanitizeMorning(d.morning),
      review: sanitizeReview(d.review)
    };
  }

  // The whole saved object: { settings: { phoneLimit }, days: { "YYYY-MM-DD": day } }. Bad dates and junk are dropped.
  function sanitizeStore(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const days = {};
    Object.keys(r.days && typeof r.days === "object" ? r.days : {}).forEach(function (date) {
      if (!isISODate(date)) return;
      const day = sanitizeDay(r.days[date]);
      if (day.morning || day.review || day.type !== "normal") days[date] = day;
    });
    return { settings: { phoneLimit: limit(r.settings && r.settings.phoneLimit) }, days: days };
  }

  /* ---------------- the daily score ---------------- */

  // What still has to be answered before a day can be scored (keys: "focus", "time", an item key, or "phone").
  function unanswered(review) {
    const out = [];
    if (review.focus === null) out.push("focus");
    if (review.time === null) out.push("time");
    if (review.items.phone !== "na" && review.screenHours === null) out.push("phone");
    Object.keys(ITEMS).forEach(function (k) { if (review.items[k] === null) out.push(k); });
    return out;
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  // -> { complete: false, score: null, missing: [...] } until every item is answered, then
  //    { complete: true, score, earned, possible, categories: [{ key, label, max, earned, possible }],
  //      excused: [labels], gap, strong, detail }
  function scoreDay(rawDay) {
    const day = sanitizeDay(rawDay);
    const review = day.review;
    if (!review) return { complete: false, score: null, missing: ["review"] };
    const missing = unanswered(review);
    if (missing.length) return { complete: false, score: null, missing: missing };

    const cats = {};
    CATEGORIES.forEach(function (c) { cats[c.key] = { key: c.key, label: c.label, max: c.max, earned: 0, possible: 0 }; });
    const excused = [];

    // Following through: the key task counts double.
    const m = day.morning;
    let doneWeight = 0, totalWeight = 0, prioritiesDone = 0, prioritiesTotal = 0;
    if (m) {
      if (m.keyTask.text) { totalWeight += 2; if (m.keyTask.done) doneWeight += 2; }
      m.priorities.forEach(function (p) {
        if (!p.text) return;
        prioritiesTotal++; totalWeight += 1;
        if (p.done) { prioritiesDone++; doneWeight += 1; }
      });
    }
    cats.followThrough.possible = 30;
    cats.followThrough.earned = totalWeight ? 30 * doneWeight / totalWeight : 0;

    // Focus and phone.
    cats.focus.possible += FOCUS_POINTS;
    cats.focus.earned += FOCUS_POINTS * (review.focus - 1) / 4;
    if (review.items.phone === "na") {
      excused.push("Phone time");
    } else {
      cats.focus.possible += PHONE_POINTS;
      const over = Math.max(0, review.screenHours - review.phoneLimit);
      cats.focus.earned += PHONE_POINTS * Math.max(0, 1 - over / review.phoneLimit);
    }

    // Time management.
    cats.time.possible = 15;
    cats.time.earned = 15 * (review.time - 1) / 4;

    // Yes/no items.
    Object.keys(ITEMS).forEach(function (k) {
      const item = ITEMS[k];
      const s = review.items[k];
      if (s === "na") { excused.push(item.label); return; }
      cats[item.category].possible += item.points;
      if (s === "done") cats[item.category].earned += item.points;
    });

    // Reflection.
    const planned = !!m && (!!m.keyTask.text || m.priorities.some(function (p) { return !!p.text; }));
    cats.reflection.possible = PLAN_POINTS + NOTES_POINTS;
    cats.reflection.earned = (planned ? PLAN_POINTS : 0);
    const answered = NOTE_FIELDS.filter(function (f) { return review[f].length >= MIN_NOTE_CHARS; }).length;
    cats.reflection.earned += NOTES_POINTS * answered / NOTE_FIELDS.length;

    const list = CATEGORIES.map(function (c) { return cats[c.key]; });
    const earned = list.reduce(function (s, c) { return s + c.earned; }, 0);
    const possible = list.reduce(function (s, c) { return s + c.possible; }, 0);
    const categories = list.map(function (c) { return { key: c.key, label: c.label, max: c.max, earned: round1(c.earned), possible: c.possible }; });

    let gap = null;
    let gapRatio = 1;
    list.forEach(function (c) {
      if (!c.possible) return;
      const ratio = c.earned / c.possible;
      if (ratio < gapRatio - 1e-9) { gapRatio = ratio; gap = { key: c.key, label: c.label, earned: round1(c.earned), possible: c.possible }; }
    });
    const strong = list.filter(function (c) { return c.possible && c.earned / c.possible >= 0.9; }).map(function (c) { return c.label; });

    return {
      complete: true,
      score: Math.round(100 * earned / possible),
      earned: round1(earned), possible: possible,
      categories: categories, excused: excused, gap: gap, strong: strong,
      detail: { prioritiesDone: prioritiesDone, prioritiesTotal: prioritiesTotal, keyTaskDone: !!(m && m.keyTask.text && m.keyTask.done), keyTaskSet: !!(m && m.keyTask.text), planned: planned, notesAnswered: answered }
    };
  }

  // Which items to pre-mark "not today" for a kind of day (before any answer is given).
  function excusedFor(type) { return (DAY_TYPES[type] || DAY_TYPES.normal).na.slice(); }

  /* ---------------- streaks, gaps, trends ---------------- */

  function isScored(days, date) { return !!days[date] && scoreDay(days[date]).complete; }

  // Consecutive scored days ending today, or yesterday while today hasn't been scored yet.
  function reviewStreak(days, todayISO) {
    let cursor = isScored(days, todayISO) ? todayISO : addDays(todayISO, -1);
    let n = 0;
    while (isScored(days, cursor)) { n++; cursor = addDays(cursor, -1); }
    return n;
  }

  // The most recent scored day on or before todayISO: { date, score } or null.
  function lastScored(days, todayISO) {
    const dates = Object.keys(days).filter(function (d) { return d <= todayISO && isScored(days, d); }).sort();
    if (!dates.length) return null;
    const date = dates[dates.length - 1];
    return { date: date, score: scoreDay(days[date]).score };
  }

  // Summary of the last `windowDays` days ending today.
  function trendSummary(days, todayISO, windowDays) {
    const all = Object.keys(days).filter(function (d) { return days[d].morning || days[d].review; }).sort();
    const firstUse = all.length ? all[0] : null;
    const daily = [];
    const results = [];
    let missed = 0;
    for (let i = windowDays - 1; i >= 0; i--) {
      const date = addDays(todayISO, -i);
      const day = days[date];
      const result = day ? scoreDay(day) : null;
      const scored = !!(result && result.complete);
      if (scored) results.push({ date: date, result: result, day: sanitizeDay(day) });
      // A day is "missed" once it has passed without a scored review, from the first day anything was logged.
      if (!scored && date < todayISO && firstUse && date >= firstUse) missed++;
      daily.push({ date: date, score: scored ? result.score : null, planned: !!(day && day.morning), reviewed: scored, type: day ? day.type : "normal" });
    }
    const enough = results.length >= MIN_DAYS_FOR_AVERAGES;
    const scores = results.map(function (r) { return r.result.score; });
    let best = null, worst = null;
    results.forEach(function (r) {
      if (!best || r.result.score > best.score) best = { date: r.date, score: r.result.score };
      if (!worst || r.result.score < worst.score) worst = { date: r.date, score: r.result.score };
    });

    let categories = null;
    if (enough) {
      categories = CATEGORIES.map(function (c) {
        let sum = 0, n = 0;
        results.forEach(function (r) {
          const cat = r.result.categories.filter(function (x) { return x.key === c.key; })[0];
          if (cat && cat.possible) { sum += cat.earned / cat.possible; n++; }
        });
        return { key: c.key, label: c.label, pct: n ? Math.round(100 * sum / n) : null, days: n };
      });
    }
    let weakest = null;
    if (categories) categories.forEach(function (c) { if (c.pct !== null && (!weakest || c.pct < weakest.pct)) weakest = c; });

    const phoneDays = results.filter(function (r) { return r.day.review.items.phone !== "na" && r.day.review.screenHours !== null; });
    const phone = {
      days: phoneDays.length,
      averageHours: phoneDays.length ? round1(phoneDays.reduce(function (s, r) { return s + r.day.review.screenHours; }, 0) / phoneDays.length) : null,
      overLimit: phoneDays.filter(function (r) { return r.day.review.screenHours > r.day.review.phoneLimit; }).length
    };

    let weekdays = null, weakestWeekday = null;
    if (results.length >= MIN_DAYS_FOR_WEEKDAYS) {
      weekdays = [0, 1, 2, 3, 4, 5, 6].map(function (w) {
        const list = results.filter(function (r) { return weekdayOf(r.date) === w; });
        return { weekday: w, days: list.length, average: list.length ? Math.round(list.reduce(function (s, r) { return s + r.result.score; }, 0) / list.length) : null };
      });
      weekdays.forEach(function (w) { if (w.days >= 2 && (!weakestWeekday || w.average < weakestWeekday.average)) weakestWeekday = w; });
    }

    return {
      windowDays: windowDays,
      scoredDays: results.length,
      enough: enough,
      average: enough ? Math.round(scores.reduce(function (s, x) { return s + x; }, 0) / scores.length) : null,
      best: best, worst: worst,
      categories: categories, weakest: weakest,
      phone: phone,
      missed: missed,
      excusedDays: results.filter(function (r) { return r.result.excused.length > 0; }).length,
      daily: daily,
      weekdays: weekdays, weakestWeekday: weakestWeekday
    };
  }

  return {
    CATEGORIES: CATEGORIES, ITEMS: ITEMS, DAY_TYPES: DAY_TYPES, NOTE_FIELDS: NOTE_FIELDS,
    PRIORITY_MAX: PRIORITY_MAX, NOTE_MAX: NOTE_MAX, DEFAULT_PHONE_LIMIT: DEFAULT_PHONE_LIMIT,
    MIN_DAYS_FOR_AVERAGES: MIN_DAYS_FOR_AVERAGES, MIN_DAYS_FOR_WEEKDAYS: MIN_DAYS_FOR_WEEKDAYS,
    isISODate: isISODate, addDays: addDays, weekdayOf: weekdayOf, daysBetween: daysBetween,
    sanitizeDay: sanitizeDay, sanitizeStore: sanitizeStore,
    scoreDay: scoreDay, unanswered: unanswered, excusedFor: excusedFor,
    reviewStreak: reviewStreak, lastScored: lastScored, trendSummary: trendSummary
  };
});
