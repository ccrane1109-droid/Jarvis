/* ==========================================================================
   JARVIS — Habits: the rules for counting and for checking a habit off on any day
   (pure functions, no page access, so they can be tested outside the browser).

   A habit is { id, name, targetDays, dailyTarget, completions: { "YYYY-MM-DD": count }, createdAt }.
   A simple check-off habit has dailyTarget 1; a counting habit (8 cups of water) has more.

   Any day up to and including today can be filled in, so a habit you forgot to tick yesterday can
   still be ticked. A day that has not happened yet cannot: you can't have done it already.
   Changing a day only changes that day's count; streaks and weekly totals are worked out from the
   counts, so they follow.

   Nothing here changes what it is given: every edit returns a new list.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisHabitLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------------- dates (local calendar days; never parsed as UTC) ---------------- */

  function parseISO(iso) { const p = String(iso).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function toISO(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function mondayOf(iso) { const d = parseISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISO(d); }
  function weekDates(mondayIso) { const out = []; for (let i = 0; i < 7; i++) out.push(addDays(mondayIso, i)); return out; }
  function isDay(v) { return typeof v === "string" && DAY_RE.test(v); }

  /* ---------------- counting ---------------- */

  function dailyTarget(h) { return h && h.dailyTarget > 1 ? h.dailyTarget : 1; }
  function countOn(h, date) { return (h && h.completions && Number(h.completions[date])) || 0; }
  function isDone(h, date) { return countOn(h, date) >= dailyTarget(h); }

  // Days in a row ending today. Today has to be done for the streak to run (the same rule the Habits screen has always used).
  function currentStreak(h, today) {
    let streak = 0, cursor = today;
    while (isDone(h, cursor)) { streak++; cursor = addDays(cursor, -1); }
    return streak;
  }

  function longestStreak(h) {
    const days = Object.keys((h && h.completions) || {}).filter(function (d) { return isDone(h, d); }).sort();
    if (!days.length) return 0;
    let longest = 1, run = 1;
    for (let i = 1; i < days.length; i++) {
      const gap = Math.round((parseISO(days[i]) - parseISO(days[i - 1])) / 86400000);
      run = gap === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    return longest;
  }

  function weeklyDone(h, dates) { return dates.reduce(function (sum, d) { return sum + Math.min(countOn(h, d), dailyTarget(h)); }, 0); }
  function weeklyTarget(h) { return (Number(h.targetDays) || 7) * dailyTarget(h); }
  function totalCompletions(h) { return Object.keys((h && h.completions) || {}).reduce(function (sum, d) { return sum + (Number(h.completions[d]) || 0); }, 0); }

  /* ---------------- which days may be edited ---------------- */

  // Today and any earlier day. Not a day that hasn't happened yet, and not something that isn't a day.
  function canEdit(date, today) { return isDay(date) && isDay(today) && date <= today; }
  function whyNot(date, today) { return !isDay(date) ? "That isn't a day." : "That day hasn't happened yet."; }

  function describeDay(date, today) {
    if (date === today) return "today";
    if (date === addDays(today, -1)) return "yesterday";
    return date < today ? "past" : "future";
  }

  /* ---------------- changing a day ---------------- */

  function replace(habits, id, fn) {
    let found = false;
    const next = habits.map(function (h) { if (h.id !== id) return h; found = true; return fn(h); });
    return found ? next : null;
  }

  // Mark a habit done (its daily target) or not done on one day. -> { ok, habits, error }
  function setDone(habits, id, date, done, today) {
    if (!canEdit(date, today)) return { ok: false, habits: habits, error: whyNot(date, today) };
    const next = replace(habits, id, function (h) { return Object.assign({}, h, { completions: Object.assign({}, h.completions, (function () { const o = {}; o[date] = done ? dailyTarget(h) : 0; return o; })()) }); });
    return next ? { ok: true, habits: next } : { ok: false, habits: habits, error: "That habit isn't there." };
  }

  // Add or take away from a counting habit on one day (never below 0). -> { ok, habits, error }
  function adjust(habits, id, date, delta, today) {
    if (!canEdit(date, today)) return { ok: false, habits: habits, error: whyNot(date, today) };
    const next = replace(habits, id, function (h) { const o = {}; o[date] = Math.max(0, countOn(h, date) + Number(delta)); return Object.assign({}, h, { completions: Object.assign({}, h.completions, o) }); });
    return next ? { ok: true, habits: next } : { ok: false, habits: habits, error: "That habit isn't there." };
  }

  /* ---------------- a day at a glance ---------------- */

  // { done, total, missed: [habit, ...] } for one day.
  function dayStatus(habits, date) {
    const missed = habits.filter(function (h) { return !isDone(h, date); });
    return { done: habits.length - missed.length, total: habits.length, missed: missed };
  }

  // "Mon, Nov 2" / "Today" / "Yesterday" for a heading.
  function dayLabel(date, today) {
    const d = describeDay(date, today);
    if (d === "today") return "Today";
    if (d === "yesterday") return "Yesterday";
    return parseISO(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  return {
    parseISO: parseISO, toISO: toISO, addDays: addDays, mondayOf: mondayOf, weekDates: weekDates, isDay: isDay,
    dailyTarget: dailyTarget, countOn: countOn, isDone: isDone, currentStreak: currentStreak, longestStreak: longestStreak,
    weeklyDone: weeklyDone, weeklyTarget: weeklyTarget, totalCompletions: totalCompletions,
    canEdit: canEdit, describeDay: describeDay, setDone: setDone, adjust: adjust, dayStatus: dayStatus, dayLabel: dayLabel
  };
});
