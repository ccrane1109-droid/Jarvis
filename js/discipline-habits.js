/* ==========================================================================
   JARVIS — Discipline x Habits: what Discipline reads from the routine kept in
   Habits (pure functions, no page access, so they can be tested outside the browser).

   Habits is where the routine lives. Discipline only READS it (jarvisHabits and
   jarvisTasks), never changes it, and never invents anything: every number and
   name below comes from what was ticked in Habits.

   A habit is { id, name, targetDays (1-7 days a week), dailyTarget, completions
   { "YYYY-MM-DD": count } }. For a given day it is
     done  - that day's count reached the daily target
     met   - not done today, but this week's target was already reached before today
     open  - still to do (the week's target is not reached and today isn't done)
   The week runs Monday to Sunday, like the Habits tab.

   The coach lines are fixed wording picked by simple rules from those numbers.
   They are encouragement grounded in your own record, not AI and not a promise.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./discipline-logic"));
  else root.JarvisDisciplineHabits = factory(root.JarvisDisciplineLogic);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    return isFinite(n) && n >= min && n <= max ? n : fallback;
  }

  // Habits as stored, cleaned up. Older ones that kept a list of dates are read as one check-in per date.
  function normalizeHabits(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      const name = String(r.name === undefined || r.name === null ? "" : r.name).replace(/\s+/g, " ").trim().slice(0, 60);
      if (!name) return;
      const completions = {};
      if (r.completions && typeof r.completions === "object" && !Array.isArray(r.completions)) {
        Object.keys(r.completions).forEach(function (d) { const n = Number(r.completions[d]); if (L.isISODate(d) && isFinite(n) && n >= 0) completions[d] = n; });
      } else if (Array.isArray(r.completedDates)) {
        r.completedDates.forEach(function (d) { if (L.isISODate(d)) completions[d] = 1; });
      }
      out.push({ id: String(r.id || name), name: name, targetDays: clampInt(r.targetDays, 1, 7, 7), dailyTarget: clampInt(r.dailyTarget, 1, 50, 1), completions: completions });
    });
    return out;
  }

  function countOn(h, date) { return h.completions[date] || 0; }
  function isDone(h, date) { return countOn(h, date) >= h.dailyTarget; }
  function weekStart(date) { return L.addDays(date, -((L.weekdayOf(date) + 6) % 7)); }

  // Check-ins counted toward the week (each day capped at the daily target) from Monday up to and including `end`.
  function weekDoneThrough(h, end, monday) {
    let sum = 0;
    for (let d = monday; d <= end; d = L.addDays(d, 1)) sum += Math.min(countOn(h, d), h.dailyTarget);
    return sum;
  }

  // Days in a row ending on `date` if it is done, otherwise ending the day before (so a streak is not lost by it being morning).
  function streak(h, date) {
    let cursor = isDone(h, date) ? date : L.addDays(date, -1);
    let n = 0;
    while (n < 400 && isDone(h, cursor)) { n++; cursor = L.addDays(cursor, -1); }
    return n;
  }

  // The routine for one day, as Habits recorded it.
  function routineFor(habits, date) {
    const monday = weekStart(date);
    let done = 0, met = 0, open = 0, weekDone = 0, weekTarget = 0;
    const items = habits.map(function (h) {
      const isToday = isDone(h, date);
      const before = weekDoneThrough(h, L.addDays(date, -1), monday);
      const target = h.targetDays * h.dailyTarget;
      const state = isToday ? "done" : before >= target ? "met" : "open";
      if (state === "done") done++; else if (state === "met") met++; else open++;
      const wd = before + Math.min(countOn(h, date), h.dailyTarget);
      weekDone += Math.min(wd, target); weekTarget += target;
      return { id: h.id, name: h.name, state: state, count: countOn(h, date), dailyTarget: h.dailyTarget, streak: streak(h, date), daily: h.targetDays === 7, weekDone: Math.min(wd, target), weekTarget: target };
    });
    return { date: date, total: habits.length, done: done, met: met, open: open, items: items, weekDone: weekDone, weekTarget: weekTarget };
  }

  // What to put in the review's "followed your planned routine?" box, as a suggestion the person can change.
  // null when there are no habits to go by.
  function suggestAnswer(routine) {
    if (!routine || !routine.total) return null;
    return routine.open === 0 ? "done" : "not";
  }

  // The part of the routine kept with a saved review (counts only: no names, no private detail).
  function snapshot(routine) {
    return routine && routine.total ? { done: routine.done + routine.met, open: routine.open, total: routine.total } : null;
  }

  function names(list) {
    const shown = list.slice(0, 3).map(function (i) { return i.name; });
    const rest = list.length - shown.length;
    return shown.length === 1 ? shown[0] : shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1] + (rest > 0 ? " (+" + rest + " more)" : "");
  }
  function days(n) { return n + (n === 1 ? " day" : " days"); }

  // One line of encouragement taken from the record, and (when something is still open) what is left.
  //   -> { kind, text, left } | null
  function coach(habits, routine, date) {
    if (!habits.length) {
      return { kind: "setup", text: "Add the habits that make up your routine in Habits, and Discipline will check them with you each day.", left: "" };
    }
    const open = routine.items.filter(function (i) { return i.state === "open"; });
    const left = open.length ? "Left today: " + names(open) + "." : "";
    if (!open.length) {
      return routine.done
        ? { kind: "done", text: "Routine done for today: " + routine.done + " of " + routine.total + " checked off. Doing it on the days you don't feel like it is what builds discipline.", left: "" }
        : { kind: "met", text: "You have already hit this week's targets. Rest is part of a routine too.", left: "" };
    }
    // A daily habit that had a run of 3+ days and was missed yesterday: one miss is data, the next day is the repeat.
    const lost = habits.filter(function (h) {
      return h.targetDays === 7 && !isDone(h, date) && !isDone(h, L.addDays(date, -1)) && streak(h, L.addDays(date, -2)) >= 3;
    }).map(function (h) { return { name: h.name, n: streak(h, L.addDays(date, -2)) }; }).sort(function (a, b) { return b.n - a.n; })[0];
    if (lost) return { kind: "recover", text: lost.name + " ran " + days(lost.n) + " in a row, then yesterday was missed. One miss is data. Today is the repeat: do it first.", left: left };
    // The longest run still alive: today would make it one longer.
    const alive = routine.items.filter(function (i) { return i.daily && i.state === "open" && i.streak >= 2; }).sort(function (a, b) { return b.streak - a.streak; })[0];
    if (alive) return { kind: "streak", text: alive.name + ": " + days(alive.streak) + " in a row. Today makes " + (alive.streak + 1) + ".", left: left };
    if (routine.weekDone > 0) return { kind: "week", text: "This week so far: " + routine.weekDone + " of " + routine.weekTarget + " habit check-ins done. Keep stacking them.", left: left };
    return { kind: "start", text: "A fresh week. Start with the smallest habit and the rest gets easier.", left: left };
  }

  // Unfinished Habits tasks for a day, most important first, for offering as plan priorities.
  function openTasks(rawTasks, date, limit) {
    return (Array.isArray(rawTasks) ? rawTasks : []).filter(function (t) {
      return t && typeof t === "object" && t.date === date && !t.completed && String(t.text || "").trim();
    }).sort(function (a, b) {
      const pa = PRIORITY_RANK[a.priority] === undefined ? 1 : PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority] === undefined ? 1 : PRIORITY_RANK[b.priority];
      return pa - pb || (Number(a.order) || 0) - (Number(b.order) || 0);
    }).slice(0, limit || 5).map(function (t) {
      const cat = String(t.category || "").trim().toLowerCase();
      const hit = L.TASK_CATEGORIES.filter(function (c) { return c.key === cat || c.label.toLowerCase() === cat; })[0];
      const time = typeof t.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : "";
      return { id: String(t.id || t.text), text: String(t.text).replace(/\s+/g, " ").trim().slice(0, L.PRIORITY_MAX), due: time, category: hit ? hit.key : "" };
    });
  }

  return {
    normalizeHabits: normalizeHabits, routineFor: routineFor, streak: streak, weekStart: weekStart,
    suggestAnswer: suggestAnswer, snapshot: snapshot, coach: coach, openTasks: openTasks
  };
});
