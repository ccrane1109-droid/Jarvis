/* ==========================================================================
   JARVIS — Habits in the Day planner and Calendar (pure rules: no page, storage or network, so they can be tested outside
   the browser).

   A habit is still one record in jarvisHabits ({ id, name, targetDays, dailyTarget, completions: { "YYYY-MM-DD": count }, createdAt }).
   Nothing about a habit is copied into the task list, the calendar or the plan. To put a habit on the planner it gets four
   optional fields, all on the same record:

     planTime   "HH:MM"  its usual time. A habit with no planTime is not on the planner (this is how every older habit reads)
     planDays   [0..6]   the weekdays it is planned on (0 = Sunday). Left out on a habit that is done 7 days a week: every day
     planFrom   date     the first day it is on the planner, so days before you added it do not suddenly show it as missed
     planMoves  { "YYYY-MM-DD": "HH:MM" }   a different time on one day only. The usual time and days are not touched

   What is on a day is worked out when it is asked for, from those fields. No occurrence is ever stored, so a habit can not
   appear twice on a day, switching between days can not make copies, and a habit that was not done is never "overdue": it is
   simply not ticked on the day it belonged to. Ticking it is the habit's own completion for that date (completions[date]),
   the same number the Habits screen shows, so the two can not disagree or be counted twice.

   The Habits screen only keeps "how many days a week" (targetDays), not which days, so a habit done fewer than 7 days a week
   needs its days chosen once when it is put on the planner. Nothing here guesses them.

   Nothing in this file changes what it is given: every edit returns a new list.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./habit-logic.js"));
  else root.JarvisHabitPlan = factory(root.JarvisHabitLogic);
})(typeof self !== "undefined" ? self : this, function (HL) {
  "use strict";

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const SHOWN_MIN = 30;            // a habit has no length; on a time grid it is drawn as this many minutes (only how it looks)
  const MAX_RANGE_DAYS = 400, MAX_MOVES = 400;
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  function isDate(s) {
    if (typeof s !== "string" || !DATE_RE.test(s)) return false;
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8)));     // 2026-02-30 is not a day: it would roll over to March
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function isTime(s) { return typeof s === "string" && TIME_RE.test(s); }
  function minutesOf(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); }
  function timeOf(m) { const x = Math.max(0, Math.min(1439, m)); return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); }
  function weekday(date) { return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8))).getUTCDay(); }
  function addDays(date, n) { return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8) + n)).toISOString().slice(0, 10); }

  /* ---------------- reading the saved fields ---------------- */

  function cleanDays(v) {
    const seen = {};
    (Array.isArray(v) ? v : []).forEach(function (d) { const n = Number(d); if (typeof d !== "boolean" && d !== null && d !== "" && Number.isInteger(n) && n >= 0 && n <= 6) seen[n] = true; });
    return ALL_DAYS.filter(function (d) { return seen[d]; });
  }
  function cleanMoves(v) {
    const out = {};
    if (v && typeof v === "object" && !Array.isArray(v)) Object.keys(v).forEach(function (d) { if (isDate(d) && isTime(v[d])) out[d] = v[d]; });
    return out;
  }

  // The plan fields of a saved habit that are valid, and only those: what a habit keeps when it is loaded. A damaged field is dropped, a good one is kept.
  function fields(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    if (isTime(raw.planTime)) out.planTime = raw.planTime;
    const days = cleanDays(raw.planDays);
    if (days.length) out.planDays = days;
    if (isDate(raw.planFrom)) out.planFrom = raw.planFrom;
    const moves = cleanMoves(raw.planMoves);
    if (Object.keys(moves).length) out.planMoves = moves;
    return out;
  }

  // -> null (not on the planner) or { time, days, from }. A habit with a time and no saved days is on every day if it is done 7 days a week, and on none otherwise.
  function plan(h) {
    if (!h || typeof h !== "object" || !isTime(h.planTime)) return null;
    let days = cleanDays(h.planDays);
    if (!days.length) days = Number(h.targetDays) >= 7 || h.targetDays === undefined ? ALL_DAYS.slice() : [];
    return { time: h.planTime, days: days, from: isDate(h.planFrom) ? h.planFrom : "" };
  }
  function onPlanner(h) { return !!plan(h); }

  // Is the habit planned on this day?
  function occursOn(h, date) {
    const p = plan(h);
    if (!p || !isDate(date)) return false;
    return p.days.indexOf(weekday(date)) !== -1 && (!p.from || date >= p.from);
  }
  // The time on that day: the one-day move if there is one, otherwise its usual time. "" when it is not on the planner.
  function timeOn(h, date) {
    const p = plan(h);
    if (!p) return "";
    const moves = cleanMoves(h.planMoves);
    return moves[date] || p.time;
  }
  function isMoved(h, date) { const p = plan(h); return !!p && !!cleanMoves(h.planMoves)[date] && cleanMoves(h.planMoves)[date] !== p.time; }

  // "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri".
  function daysLabel(days) {
    const d = cleanDays(days), key = d.join("");
    if (d.length === 7) return "Every day";
    if (key === "12345") return "Weekdays";
    if (key === "06") return "Weekends";
    return d.length ? d.map(function (x) { return DAY_SHORT[x]; }).join(", ") : "No days";
  }

  /* ---------------- what is on the days ---------------- */

  // Calendar items for the planned habits from..to (inclusive). One per habit per planned day.
  // opts: { today } the day that counts as today (days after it can be looked at but not ticked).
  function items(habits, from, to, opts) {
    const out = [], today = opts && opts.today;
    if (!Array.isArray(habits) || !isDate(from) || !isDate(to) || to < from) return out;
    const last = addDays(from, MAX_RANGE_DAYS) < to ? addDays(from, MAX_RANGE_DAYS) : to;
    const seen = {};
    habits.forEach(function (h) {
      if (!h || typeof h.id !== "string" || !h.id || !h.name || !plan(h) || seen[h.id]) return;
      seen[h.id] = true;
      for (let d = from; d <= last; d = addDays(d, 1)) {
        if (!occursOn(h, d)) continue;
        const time = timeOn(h, d), s = minutesOf(time), target = HL.dailyTarget(h), count = HL.countOn(h, d);
        out.push({
          key: "habit:" + h.id + "@" + d, id: h.id, occDate: d, source: "habit", title: String(h.name), description: "", kind: "habit", category: "other", priority: "medium",
          recurring: false, linked: null, status: "", reminders: [], completed: HL.isDone(h, d), point: true, tz: "",
          allDay: false, date: d, endDate: d, time: time, endTime: timeOf(Math.min(1439, s + SHOWN_MIN)), startMin: s, endMin: Math.min(1439, s + SHOWN_MIN), startMs: null, endMs: null,
          readOnly: false, scheduled: true,       // scheduled: never overdue (see task-kind-logic.js / schedule-logic.js)
          count: count, target: target, moved: isMoved(h, d), editable: HL.canEdit(d, today), days: plan(h).days.slice()
        });
      }
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0); });
  }

  // { done, total } of the habit items on one day.
  function dayTotals(list, date) {
    const day = (list || []).filter(function (it) { return it && it.source === "habit" && it.date === date; });
    return { done: day.filter(function (it) { return it.completed; }).length, total: day.length };
  }

  /* ---------------- changing the plan ---------------- */

  const PLAN_KEYS = ["planTime", "planDays", "planFrom", "planMoves"];
  function find(habits, id) { return Array.isArray(habits) ? habits.filter(function (h) { return h && h.id === id; })[0] || null : null; }
  function swap(habits, id, fn) { return habits.map(function (h) { return h && h.id === id ? fn(h) : h; }); }
  function without(h, keys) { const o = Object.assign({}, h); keys.forEach(function (k) { delete o[k]; }); return o; }

  // input: { time, days, from } -> { ok, habits, errors }. Puts a habit on the planner, or changes its time and days. Its one-day moves are kept.
  function setPlan(habits, id, input) {
    const h = find(habits, id);
    if (!h) return { ok: false, habits: habits, errors: {}, error: "That habit isn't there any more." };
    const i = input || {}, errors = {}, days = cleanDays(i.days);
    if (!isTime(i.time)) errors.time = "Choose a time.";
    if (!days.length) errors.days = "Choose at least one day.";
    if (!isDate(i.from)) errors.from = "Choose the first day.";
    if (Object.keys(errors).length) return { ok: false, habits: habits, errors: errors, error: errors.time || errors.days || errors.from };
    const patch = { planTime: i.time, planDays: days, planFrom: i.from };
    return { ok: true, habits: swap(habits, id, function (x) { return Object.assign({}, x, patch); }), errors: {} };
  }

  // Puts a habit's planner fields back exactly as they were (undo). `saved` is what fields() gave before the change ({} = it was not on the planner).
  function restorePlan(habits, id, saved) {
    if (!find(habits, id)) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    return { ok: true, habits: swap(habits, id, function (x) { return Object.assign(without(x, PLAN_KEYS), fields(saved)); }) };
  }

  // Takes a habit off the planner. The habit, its streak and every completion stay exactly as they were.
  function clearPlan(habits, id) {
    if (!find(habits, id)) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    return { ok: true, habits: swap(habits, id, function (x) { return without(x, PLAN_KEYS); }) };
  }

  // A different time for one day. Moving it back to its usual time removes the move.
  function moveOn(habits, id, date, time) {
    const h = find(habits, id);
    if (!h) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    if (!isTime(time)) return { ok: false, habits: habits, error: "That isn't a time." };
    if (!occursOn(h, date)) return { ok: false, habits: habits, error: "That habit isn't planned for that day." };
    const p = plan(h);
    return { ok: true, habits: swap(habits, id, function (x) {
      const moves = cleanMoves(x.planMoves);
      if (time === p.time) delete moves[date]; else moves[date] = time;
      const keys = Object.keys(moves).sort();
      while (keys.length > MAX_MOVES) delete moves[keys.shift()];
      return Object.keys(moves).length ? Object.assign({}, x, { planMoves: moves }) : without(x, ["planMoves"]);
    }) };
  }
  function clearMove(habits, id, date) {
    const h = find(habits, id);
    return h ? moveOn(habits, id, date, plan(h) ? plan(h).time : "") : { ok: false, habits: habits, error: "That habit isn't there any more." };
  }

  return {
    SHOWN_MIN: SHOWN_MIN, DAY_SHORT: DAY_SHORT, ALL_DAYS: ALL_DAYS, isDate: isDate, isTime: isTime, weekday: weekday, minutesOf: minutesOf, timeOf: timeOf,
    cleanDays: cleanDays, cleanMoves: cleanMoves, fields: fields, plan: plan, onPlanner: onPlanner, occursOn: occursOn, timeOn: timeOn, isMoved: isMoved, daysLabel: daysLabel,
    items: items, dayTotals: dayTotals, setPlan: setPlan, restorePlan: restorePlan, clearPlan: clearPlan, moveOn: moveOn, clearMove: clearMove
  };
});
