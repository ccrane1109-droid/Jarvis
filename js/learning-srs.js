/* ==========================================================================
   JARVIS — Learning & Research Hub: spaced repetition (pure rules; no page, storage or network).

   A lesson (a note) or a flashcard carries a small "srs" record:
     { on, step, due, paused, started, last, lapses, reviews: [{ d, g, p }] }

   How it schedules (all arithmetic done here, on this device; nothing is estimated by a service):
     STEPS      the waits in days:  1, 3, 7, 14, 30   (the five you asked for), then 60 and 90 so that a lesson you keep
                getting right is still checked now and then instead of being forgotten about.
     step       which wait the item is currently sitting through. A new item starts at step 0: first review after 1 day.
     Good       move to the next step               (1 -> 3 -> 7 -> 14 -> 30 -> 60 -> 90)
     Easy       skip a step                         (1 -> 7, 3 -> 14, ...)
     Hard       stay on the same step but come back sooner: half the wait, at least 1 day
     Forgot     back to step 0: review again tomorrow
   The next date is counted from the day you review, not from the day it was due, so being late never makes the next
   gap shorter than the step says.

   Reviews are recorded in `reviews` ({ d: day, g: grade, p: 1 when it was extra practice that did not move the schedule).
   "Correct" means you recalled it (Easy, Good or Hard); "Forgot" is the only miss.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisLearningSRS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STEPS = [1, 3, 7, 14, 30, 60, 90];
  const GRADES = [{ key: "forgot", label: "Forgot" }, { key: "hard", label: "Hard" }, { key: "good", label: "Good" }, { key: "easy", label: "Easy" }];
  const GRADE_KEYS = GRADES.map(function (g) { return g.key; });
  const MAX_REVIEWS = 300;

  /* ---------------- tiny date helpers (kept here so this file stands alone) ---------------- */
  function isDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function dayMs(s) { return Date.parse(s + "T00:00:00Z"); }
  function addDays(s, n) { return new Date(dayMs(s) + n * 86400000).toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((dayMs(b) - dayMs(a)) / 86400000); }     // b - a
  function labelOf(key) { const g = GRADES.filter(function (x) { return x.key === key; })[0]; return g ? g.label : ""; }

  /* ---------------- the record ---------------- */

  function blank() { return { on: false, step: 0, due: "", paused: false, started: "", last: "", lapses: 0, reviews: [] }; }

  // A new schedule starting today: first review after STEPS[0] days.
  function start(today) { return { on: true, step: 0, due: addDays(today, STEPS[0]), paused: false, started: today, last: "", lapses: 0, reviews: [] }; }

  // What is stored -> a clean record, or null when it isn't one.
  function read(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const step = typeof raw.step === "number" && Math.floor(raw.step) === raw.step && raw.step >= 0 && raw.step < STEPS.length ? raw.step : 0;
    const on = raw.on === true;
    const due = isDate(raw.due) ? raw.due : "";
    const reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).filter(function (r) { return r && typeof r === "object" && isDate(r.d) && GRADE_KEYS.indexOf(r.g) !== -1; })
      .map(function (r) { return r.p ? { d: r.d, g: r.g, p: 1 } : { d: r.d, g: r.g }; }).slice(-MAX_REVIEWS);
    return {
      on: on && !!due, step: step, due: due, paused: raw.paused === true, started: isDate(raw.started) ? raw.started : "", last: isDate(raw.last) ? raw.last : "",
      lapses: typeof raw.lapses === "number" && raw.lapses >= 0 && raw.lapses < 100000 ? Math.floor(raw.lapses) : 0, reviews: reviews
    };
  }

  // Turning the schedule on or off from the editor. Turning it off keeps the history; turning it back on resumes where it was
  // (and is due today if the date had passed).
  function setEnabled(state, on, today) {
    if (!state || (!state.started && !state.due)) {
      if (!on) return state || blank();
      return Object.assign(start(today), { reviews: state ? state.reviews : [] });   // practice done before keeps its history
    }
    if (on) return Object.assign({}, state, { on: true, paused: false, due: !state.due || state.due < today ? today : state.due });
    return Object.assign({}, state, { on: false });
  }
  function pause(state) { return state && state.on ? Object.assign({}, state, { paused: true }) : state; }
  function resume(state, today) { return state && state.on ? Object.assign({}, state, { paused: false, due: !state.due || state.due < today ? today : state.due }) : state; }

  /* ---------------- grading ---------------- */

  function nextStep(step, grade) {
    const last = STEPS.length - 1;
    if (grade === "good") return Math.min(step + 1, last);
    if (grade === "easy") return Math.min(step + 2, last);
    if (grade === "forgot") return 0;
    return step;                                   // hard
  }
  function waitFor(step, grade) {
    const s = nextStep(step, grade);
    return grade === "hard" ? Math.max(1, Math.round(STEPS[s] / 2)) : STEPS[s];
  }

  // The state after a review today. Returns the new record (the old one is not changed).
  function grade(state, g, today) {
    if (GRADE_KEYS.indexOf(g) === -1 || !state || !state.on) return state;
    const s = nextStep(state.step, g);
    return {
      on: true, step: s, due: addDays(today, waitFor(state.step, g)), paused: state.paused, started: state.started || today, last: today,
      lapses: state.lapses + (g === "forgot" ? 1 : 0), reviews: state.reviews.concat([{ d: today, g: g }]).slice(-MAX_REVIEWS)
    };
  }
  // Extra practice: remembered in the history, schedule untouched. Works for an item that has no schedule too.
  function practice(state, g, today) {
    if (GRADE_KEYS.indexOf(g) === -1) return state;
    const base = state || blank();
    return Object.assign({}, base, { reviews: base.reviews.concat([{ d: today, g: g, p: 1 }]).slice(-MAX_REVIEWS) });
  }
  // What each answer would schedule, for the buttons: { forgot: { days, due }, hard: ..., good: ..., easy: ... }
  function preview(state, today) {
    const out = {};
    GRADE_KEYS.forEach(function (g) { const n = state ? waitFor(state.step, g) : STEPS[0]; out[g] = { days: n, due: addDays(today, n) }; });
    return out;
  }

  /* ---------------- what is due ---------------- */

  function isActive(state) { return !!(state && state.on && !state.paused); }
  function isDue(state, today) { return isActive(state) && !!state.due && state.due <= today; }
  function daysUntil(state, today) { return state && state.due ? diffDays(today, state.due) : null; }
  // Words for the schedule: "Due today", "Overdue by 3 days", "In 5 days (Nov 9)" is left to the screen; this gives the parts.
  function when(state, today) {
    if (!state || !state.on) return { kind: "off", days: null };
    if (state.paused) return { kind: "paused", days: daysUntil(state, today) };
    const n = daysUntil(state, today);
    return n === null ? { kind: "off", days: null } : n < 0 ? { kind: "overdue", days: -n } : n === 0 ? { kind: "today", days: 0 } : { kind: "later", days: n };
  }

  // Items are notes or cards (anything with .srs). Oldest due first, then oldest created.
  function dueItems(items, today) {
    return (items || []).filter(function (it) { return !it.deletedAt && isDue(it.srs, today); })
      .sort(function (a, b) { return a.srs.due < b.srs.due ? -1 : a.srs.due > b.srs.due ? 1 : (a.createdAt || 0) - (b.createdAt || 0); });
  }
  function scheduled(items) {
    return (items || []).filter(function (it) { return !it.deletedAt && it.srs && it.srs.on; })
      .sort(function (a, b) { return (a.srs.paused ? 1 : 0) - (b.srs.paused ? 1 : 0) || (a.srs.due < b.srs.due ? -1 : a.srs.due > b.srs.due ? 1 : 0); });
  }
  // { due, overdue, dueSoon (next 7 days, not yet due), paused, scheduled, nextDue: the earliest future date or "" }
  function summary(items, today) {
    const s = { due: 0, overdue: 0, dueSoon: 0, paused: 0, scheduled: 0, nextDue: "" };
    (items || []).forEach(function (it) {
      if (it.deletedAt || !it.srs || !it.srs.on) return;
      s.scheduled++;
      if (it.srs.paused) { s.paused++; return; }
      if (it.srs.due <= today) { s.due++; if (it.srs.due < today) s.overdue++; }
      else { if (diffDays(today, it.srs.due) <= 7) s.dueSoon++; if (!s.nextDue || it.srs.due < s.nextDue) s.nextDue = it.srs.due; }
    });
    return s;
  }

  /* ---------------- history and accuracy ---------------- */

  function isCorrect(g) { return g === "easy" || g === "good" || g === "hard"; }
  // Every review entry of the items between two days (inclusive). opts.practice: true counts only practice, false only scheduled reviews, undefined both.
  function entries(items, from, to, opts) {
    const o = opts || [];
    const out = [];
    (items || []).forEach(function (it) {
      if (it.deletedAt || !it.srs) return;
      it.srs.reviews.forEach(function (r) {
        if ((from && r.d < from) || (to && r.d > to)) return;
        if (o.practice === true && !r.p) return;
        if (o.practice === false && r.p) return;
        out.push({ item: it, d: r.d, g: r.g, p: !!r.p });
      });
    });
    return out;
  }
  function count(items, from, to, opts) { return entries(items, from, to, opts).length; }
  // { total, correct, pct } where pct is null when there is nothing to measure (never a made-up 0).
  function accuracy(items, from, to, opts) {
    const e = entries(items, from, to, opts);
    const correct = e.filter(function (x) { return isCorrect(x.g); }).length;
    return { total: e.length, correct: correct, pct: e.length ? Math.round(correct / e.length * 100) : null };
  }
  // Per item: how often it was recalled. Items with fewer than `min` reviews are left out (too little to say anything).
  function hardest(items, min, n) {
    const rows = [];
    (items || []).forEach(function (it) {
      if (it.deletedAt || !it.srs) return;
      const t = it.srs.reviews.length;
      if (t < (min || 3)) return;
      const c = it.srs.reviews.filter(function (r) { return isCorrect(r.g); }).length;
      rows.push({ item: it, total: t, correct: c, pct: Math.round(c / t * 100) });
    });
    return rows.sort(function (a, b) { return a.pct - b.pct || b.total - a.total; }).slice(0, n || 5);
  }

  return {
    STEPS: STEPS, GRADES: GRADES, GRADE_KEYS: GRADE_KEYS, MAX_REVIEWS: MAX_REVIEWS, labelOf: labelOf,
    blank: blank, start: start, read: read, setEnabled: setEnabled, pause: pause, resume: resume,
    grade: grade, practice: practice, preview: preview, nextStep: nextStep, waitFor: waitFor,
    isActive: isActive, isDue: isDue, daysUntil: daysUntil, when: when, dueItems: dueItems, scheduled: scheduled, summary: summary,
    isCorrect: isCorrect, entries: entries, count: count, accuracy: accuracy, hardest: hardest
  };
});
