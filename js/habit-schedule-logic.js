/* ==========================================================================
   JARVIS — Habit schedules: which days a habit is for, and what each day of it means (pure rules; no page, storage or network).

   A habit's record (jarvisHabits) already says how many days a week it is for (targetDays) and, if you put it on the planner, its time and
   weekdays (planTime, planDays). This adds the meaning of a DAY, so nothing is called "missed" that was never a chance to do it:

     scheduled   the habit is for this weekday (its planDays, or every day for a 7-days-a-week habit)
     flexible    "3 days a week" with no chosen weekdays: any day counts, so no single day can be missed; only the week is measured
     unscheduled a weekday it is not for, a day before it began, a day after it was archived, a paused day

   Optional fields added to a habit (a habit made before this has none of them and reads as it always did):
     skips     { "YYYY-MM-DD": true }            a day you chose to skip on purpose (not a miss, and not counted against it)
     pauses    [{ from, until }]                  while paused ("until" empty = until you resume) its days are not scheduled
     archivedAt  number                           hidden from Today, Overview and the Calendar from then on; every completion is kept

   A day is one of:  done · skipped · missed (scheduled, over, not done) · pending (today, not done yet) · upcoming (after today) ·
                     paused · unscheduled.   Days after today are never anything but "upcoming": they cannot count against a habit.
   Consistency = done ÷ scheduled days that have passed (skipped and paused days are not chances, so they are left out).
   For a flexible habit it is the weeks that have ended: days done (up to the target) ÷ the target.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./habit-logic.js"), require("./habit-plan-logic.js"));
  else root.JarvisHabitSchedule = factory(root.JarvisHabitLogic, root.JarvisHabitPlan);
})(typeof self !== "undefined" ? self : this, function (HL, HP) {
  "use strict";

  const MAX_PAUSES = 24, MAX_SKIPS = 400;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isDate(s) { return typeof s === "string" && DATE_RE.test(s); }
  function toUTC(d) { const p = d.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { return new Date(toUTC(d) + n * 86400000).toISOString().slice(0, 10); }
  function weekday(d) { return new Date(toUTC(d)).getUTCDay(); }            // 0 = Sunday
  function mondayOf(d) { return addDays(d, -((weekday(d) + 6) % 7)); }
  function localDay(ms) { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function find(list, id) { return (Array.isArray(list) ? list : []).filter(function (h) { return h && h.id === id; })[0] || null; }
  function swap(list, id, fn) { return list.map(function (h) { return h && h.id === id ? fn(h) : h; }); }

  /* ---------------- what a habit is for ---------------- */

  // The first day that counts: the day it was put on the planner, else the day it was made. "" when unknown.
  function startDay(h) {
    if (h && isDate(h.planFrom)) return h.planFrom;
    return h && typeof h.createdAt === "number" && h.createdAt > 0 ? localDay(h.createdAt) : "";
  }
  function endDay(h) { return h && typeof h.archivedAt === "number" && h.archivedAt > 0 ? localDay(h.archivedAt) : ""; }
  function isArchived(h) { return !!(h && typeof h.archivedAt === "number" && h.archivedAt > 0); }

  function cleanPauses(v) {
    const out = [];
    (Array.isArray(v) ? v : []).forEach(function (p) {
      if (p && isDate(p.from) && (p.until === "" || p.until === undefined || isDate(p.until)) && (!p.until || p.until >= p.from)) out.push({ from: p.from, until: p.until || "" });
    });
    return out.slice(-MAX_PAUSES);
  }
  function cleanSkips(v) {
    const out = {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    Object.keys(v).sort().slice(-MAX_SKIPS).forEach(function (d) { if (isDate(d) && v[d]) out[d] = true; });
    return out;
  }
  function isPaused(h, date) { return cleanPauses(h && h.pauses).some(function (p) { return date >= p.from && (!p.until || date <= p.until); }); }
  function isSkipped(h, date) { return !!cleanSkips(h && h.skips)[date]; }

  // { mode: "days" | "daily" | "flexible", days: [0..6 Sunday first], time: "HH:MM" | "", perWeek }.
  //   days     chosen weekdays (fewer than 7)       daily     every day       flexible   N days a week, any days
  function scheduleOf(h) {
    const chosen = HP.cleanDays(h && h.planDays), target = Math.max(1, Math.min(7, Math.round(Number(h && h.targetDays)) || 7));
    const time = h && HP.isTime(h.planTime) ? h.planTime : "";
    let mode, days;
    if (chosen.length && chosen.length < 7) { mode = "days"; days = chosen; }
    else if (chosen.length === 7 || target >= 7) { mode = "daily"; days = HP.ALL_DAYS.slice(); }
    else { mode = "flexible"; days = []; }
    return { mode: mode, days: days, time: time, perWeek: mode === "days" ? days.length : mode === "daily" ? 7 : target };
  }

  // Is this a day the habit is for? (A paused, archived, not-yet-started or flexible habit has no scheduled days.)
  function scheduledOn(h, date) {
    if (!h || !isDate(date)) return false;
    const s = scheduleOf(h), st = startDay(h), en = endDay(h);
    if (s.mode === "flexible") return false;
    if (st && date < st) return false;
    if (en && date > en) return false;
    if (isPaused(h, date)) return false;
    return s.days.indexOf(weekday(date)) !== -1;
  }

  // done | skipped | missed | pending | upcoming | paused | unscheduled. A day that was done is "done" even if it was not scheduled (an extra day).
  function dayState(h, date, today) {
    if (!h || !isDate(date)) return "unscheduled";
    if (HL.isDone(h, date)) return "done";
    if (isPaused(h, date)) return "paused";
    if (!scheduledOn(h, date)) return "unscheduled";
    if (isSkipped(h, date)) return "skipped";
    if (date > today) return "upcoming";
    return date === today ? "pending" : "missed";
  }

  // morning (before 12:00) · afternoon (12:00 to 16:59) · evening (17:00 on) · anytime (no time on the planner)
  function partOfDay(h, date) {
    const t = HP.timeOn(h, date) || (h && HP.isTime(h.planTime) ? h.planTime : "");
    if (!t) return "anytime";
    const m = HP.minutesOf(t);
    return m < 720 ? "morning" : m < 1020 ? "afternoon" : "evening";
  }

  /* ---------------- a day, a week ---------------- */

  // Today's habits for the Today screen and the Overview: grouped, with what is done and what is skipped.
  //   { groups: { morning, afternoon, evening, anytime: [row] }, flexible: [row], paused: [row], counts: { done, total, skipped } }
  //   row: { habit, state, time, count, target, done, skipped }.  Archived habits are not listed.
  function today(habits, date, now) {
    const groups = { morning: [], afternoon: [], evening: [], anytime: [] }, flexible = [], paused = [];
    const wk = mondayOf(date);
    let done = 0, total = 0, skipped = 0;
    (Array.isArray(habits) ? habits : []).forEach(function (h) {
      if (!h || typeof h.id !== "string" || !h.name || isArchived(h)) return;
      const s = scheduleOf(h), st = dayState(h, date, now);
      const row = { habit: h, state: st, time: HP.timeOn(h, date) || (s.time || ""), count: HL.countOn(h, date), target: HL.dailyTarget(h), done: HL.isDone(h, date), skipped: st === "skipped" };
      if (st === "paused") { paused.push(row); return; }
      if (s.mode === "flexible") {
        const w = weekProgress(h, wk, now);
        flexible.push(Object.assign(row, { week: w }));
        return;
      }
      if (st === "unscheduled" && !row.done) return;
      groups[partOfDay(h, date)].push(row);
      if (!scheduledOn(h, date)) return;                  // an extra day (done though it was not one of its days) is listed but not counted
      if (st === "skipped") skipped++; else { total++; if (row.done) done++; }
    });
    const byTime = function (a, b) { return (a.time || "99:99") < (b.time || "99:99") ? -1 : (a.time || "99:99") > (b.time || "99:99") ? 1 : (a.habit.name < b.habit.name ? -1 : 1); };
    Object.keys(groups).forEach(function (k) { groups[k].sort(byTime); });
    return { groups: groups, flexible: flexible, paused: paused, counts: { done: done, total: total, skipped: skipped } };
  }

  // One week of one habit (Monday first): days done against the days it is for. Days after `now` are listed as upcoming and are never counted as missed.
  //   { days: [{ date, state }], done, target, missed, mode }  target = scheduled days (not skipped, not paused) for a scheduled habit, targetDays for a flexible one.
  function weekProgress(h, monday, now) {
    const dates = []; for (let i = 0; i < 7; i++) dates.push(addDays(monday, i));
    const s = scheduleOf(h), days = dates.map(function (d) { return { date: d, state: dayState(h, d, now) }; });
    const doneDays = dates.filter(function (d) { return HL.isDone(h, d); }).length;
    if (s.mode === "flexible") return { days: days, done: Math.min(doneDays, s.perWeek), target: s.perWeek, missed: 0, mode: "flexible", extra: Math.max(0, doneDays - s.perWeek) };
    const sched = days.filter(function (x) { return x.state === "done" ? scheduledOn(h, x.date) : (x.state === "pending" || x.state === "upcoming" || x.state === "missed"); });
    return {
      days: days, done: days.filter(function (x) { return x.state === "done" && scheduledOn(h, x.date); }).length, target: sched.length,
      missed: days.filter(function (x) { return x.state === "missed"; }).length, mode: s.mode, extra: days.filter(function (x) { return x.state === "done" && !scheduledOn(h, x.date); }).length
    };
  }

  // Consistency between two days (inclusive), counting only the chances that have passed.
  //   { mode, chances, done, skipped, missed, rate }  rate is null when there was no chance yet (never 0 for "nothing to measure").
  function consistency(h, from, to, now) {
    const s = scheduleOf(h), last = to > now ? now : to;
    if (!isDate(from) || !isDate(last) || last < from) return { mode: s.mode, chances: 0, done: 0, skipped: 0, missed: 0, rate: null };
    if (s.mode === "flexible") {
      let chances = 0, done = 0;
      for (let m = mondayOf(from); addDays(m, 6) <= last; m = addDays(m, 7)) {
        if (addDays(m, 6) < from) continue;
        const st = startDay(h);
        if (st && addDays(m, 6) < st) continue;
        const p = weekProgress(h, m, now);
        chances += p.target; done += p.done;
      }
      return { mode: "flexible", chances: chances, done: done, skipped: 0, missed: Math.max(0, chances - done), rate: chances ? done / chances : null };
    }
    let chances = 0, done = 0, skipped = 0;
    for (let d = from; d <= last; d = addDays(d, 1)) {
      const st = dayState(h, d, now);
      if (st === "done" && scheduledOn(h, d)) { chances++; done++; }
      else if (st === "missed") chances++;               // today (pending) is not over yet, so it is not a chance that was missed
      else if (st === "skipped") skipped++;
    }
    const missed = chances - done;
    return { mode: s.mode, chances: chances, done: done, skipped: skipped, missed: missed, rate: chances ? done / chances : null };
  }

  // A warning for a habit whose chosen weekdays do not match its weekly target ("5 days chosen but a target of 3 a week"), else null.
  function mismatch(h) {
    const s = scheduleOf(h), target = Math.max(1, Math.min(7, Math.round(Number(h && h.targetDays)) || 7));
    if (s.mode !== "days" || s.days.length === target) return null;
    return { chosen: s.days.length, target: target, text: s.days.length + " day" + (s.days.length === 1 ? "" : "s") + " chosen, but the target is " + target + " a week." };
  }

  /* ---------------- changing a habit (each returns { ok, habits } and leaves the input alone) ---------------- */

  function skip(habits, id, date, on, now) {
    const h = find(habits, id);
    if (!h) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    if (!isDate(date)) return { ok: false, habits: habits, error: "That isn't a day." };
    if (on && HL.isDone(h, date)) return { ok: false, habits: habits, error: "That day is already done." };
    if (on && !scheduledOn(h, date)) return { ok: false, habits: habits, error: "That isn't one of this habit's days." };
    return { ok: true, habits: swap(habits, id, function (x) {
      const sk = cleanSkips(x.skips);
      if (on) sk[date] = true; else delete sk[date];
      const o = Object.assign({}, x);
      if (Object.keys(sk).length) o.skips = sk; else delete o.skips;
      return o;
    }) };
  }

  // Pause from a day (until a day, or until resumed).
  function pause(habits, id, from, until) {
    const h = find(habits, id);
    if (!h) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    if (!isDate(from) || (until && (!isDate(until) || until < from))) return { ok: false, habits: habits, error: "That isn't a good range of days." };
    return { ok: true, habits: swap(habits, id, function (x) { return Object.assign({}, x, { pauses: cleanPauses((x.pauses || []).concat([{ from: from, until: until || "" }])) }); }) };
  }
  // Ends every open-ended pause the day before `today` (a pause that began today leaves no trace).
  function resume(habits, id, today) {
    const h = find(habits, id);
    if (!h) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    return { ok: true, habits: swap(habits, id, function (x) {
      const list = cleanPauses(x.pauses).map(function (p) { return !p.until || p.until >= today ? { from: p.from, until: addDays(today, -1) } : p; }).filter(function (p) { return p.until >= p.from; });
      const o = Object.assign({}, x);
      if (list.length) o.pauses = list; else delete o.pauses;
      return o;
    }) };
  }
  function archive(habits, id, now) {
    const h = find(habits, id);
    if (!h) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    return { ok: true, habits: swap(habits, id, function (x) { return Object.assign({}, x, { archivedAt: typeof now === "number" && now > 0 ? now : Date.now() }); }) };
  }
  function unarchive(habits, id) {
    const h = find(habits, id);
    if (!h) return { ok: false, habits: habits, error: "That habit isn't there any more." };
    return { ok: true, habits: swap(habits, id, function (x) { const o = Object.assign({}, x); delete o.archivedAt; return o; }) };
  }

  // Which part of a habit's record is the schedule fields: kept through a read and a write.
  function fields(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    const sk = cleanSkips(raw.skips), pa = cleanPauses(raw.pauses);
    if (Object.keys(sk).length) out.skips = sk;
    if (pa.length) out.pauses = pa;
    if (typeof raw.archivedAt === "number" && raw.archivedAt > 0) out.archivedAt = raw.archivedAt;
    return out;
  }

  return {
    startDay: startDay, endDay: endDay, isArchived: isArchived, isPaused: isPaused, isSkipped: isSkipped, scheduleOf: scheduleOf, scheduledOn: scheduledOn,
    dayState: dayState, partOfDay: partOfDay, today: today, weekProgress: weekProgress, consistency: consistency, mismatch: mismatch,
    skip: skip, pause: pause, resume: resume, archive: archive, unarchive: unarchive, fields: fields, cleanPauses: cleanPauses, cleanSkips: cleanSkips,
    mondayOf: mondayOf, addDays: addDays, weekday: weekday
  };
});
