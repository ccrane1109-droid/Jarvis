/* ==========================================================================
   JARVIS — Focus sessions (pure rules; no page, storage or network).

   A focus session is time you spend on one thing, started from a task, a habit or a time block. This file keeps the arithmetic honest:

   * Time is worked out from timestamps, never counted by a timer, so a refreshed or closed page loses nothing: startedAt, the time spent paused,
     and (while paused) when the pause began are enough to say how long you have worked at any moment.
   * Paused time is not work. Pausing, resuming and finishing never change what was already worked.
   * A session with a planned length (2, 15, 25, 50 minutes or your own) is "up" when the worked time reaches it; it keeps running until you
     finish it, so time you really worked past the plan is recorded, not cut off.
   * A break is a session too ("break"), but it is never counted as work.
   * Finishing a session makes ONE record (id, day it started, worked minutes, planned length, what it was for). The same session cannot be
     recorded twice, and a session that worked under a second is not recorded at all.

   active (this device, while it runs):
     { id, kind: "focus" | "break", title, itemKey, taskId, habitId, plannedMin (0 = open), startedAt, pausedMs, pausedAt (null while running) }
   record (kept, one per finished focus session):
     { id, kind: "focus", date (YYYY-MM-DD, local, the day it started), startedAt, endedAt, focusMs, plannedMin, title, itemKey, taskId, habitId, updatedAt }
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisFocusLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PRESETS = [
    { key: "start", label: "2-minute start", minutes: 2, sub: "Just begin. Stop after two minutes if you want." },
    { key: "15", label: "15 minutes", minutes: 15 },
    { key: "25", label: "25 minutes", minutes: 25 },
    { key: "50", label: "50 minutes", minutes: 50 }
  ];
  const MIN_RECORD_MS = 1000, MAX_MIN = 600, TITLE_MAX = 140;

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function localDay(ms) { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  // A planned length in minutes from what was typed: a whole number from 1 to 600, else 0 (not valid).
  function minutesFrom(v) {
    const n = Math.round(Number(v));
    return isFinite(n) && n >= 1 && n <= MAX_MIN ? n : 0;
  }

  // Cleans an active session read from storage. null when it isn't one.
  function readActive(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || !(num(raw.startedAt) > 0)) return null;
    const started = num(raw.startedAt), pausedMs = Math.max(0, num(raw.pausedMs));
    const pausedAt = raw.pausedAt === null || raw.pausedAt === undefined ? null : (num(raw.pausedAt) >= started ? num(raw.pausedAt) : null);
    return {
      id: raw.id.slice(0, 60), kind: raw.kind === "break" ? "break" : "focus", title: str(raw.title, TITLE_MAX) || "Focus",
      itemKey: str(raw.itemKey, 120), taskId: str(raw.taskId, 60), habitId: str(raw.habitId, 60),
      plannedMin: Math.max(0, Math.min(MAX_MIN, Math.round(num(raw.plannedMin)))), startedAt: started, pausedMs: pausedMs, pausedAt: pausedAt
    };
  }

  function start(input, now, makeId) {
    const o = isObj(input) ? input : {}, planned = o.plannedMin === 0 || o.plannedMin === "" || o.plannedMin === undefined ? 0 : minutesFrom(o.plannedMin);
    if (o.plannedMin !== undefined && o.plannedMin !== 0 && o.plannedMin !== "" && !planned) return { ok: false, error: "Choose a length from 1 to " + MAX_MIN + " minutes." };
    return { ok: true, active: readActive({
      id: typeof makeId === "function" ? makeId() : "fs_" + now.toString(36), kind: o.kind === "break" ? "break" : "focus", title: o.title, itemKey: o.itemKey, taskId: o.taskId, habitId: o.habitId,
      plannedMin: planned, startedAt: now, pausedMs: 0, pausedAt: null
    }) };
  }

  // Milliseconds worked so far: wall time since the start, less every pause (a pause that is still going counts up to when it began).
  function elapsedMs(a, now) {
    if (!a) return 0;
    const end = a.pausedAt !== null ? a.pausedAt : now;
    return Math.max(0, end - a.startedAt - a.pausedMs);
  }
  function remainingMs(a, now) { return a && a.plannedMin ? a.plannedMin * 60000 - elapsedMs(a, now) : null; }
  function isUp(a, now) { const r = remainingMs(a, now); return r !== null && r <= 0; }
  function isPaused(a) { return !!a && a.pausedAt !== null; }

  function pause(a, now) { return !a || a.pausedAt !== null ? a : Object.assign({}, a, { pausedAt: Math.max(now, a.startedAt) }); }
  function resume(a, now) {
    if (!a || a.pausedAt === null) return a;
    return Object.assign({}, a, { pausedMs: a.pausedMs + Math.max(0, now - a.pausedAt), pausedAt: null });
  }
  // More minutes on a session that is up ("add 5 minutes"): the planned length grows, what was worked stays.
  function extend(a, minutes) { return a && a.plannedMin ? Object.assign({}, a, { plannedMin: Math.min(MAX_MIN, a.plannedMin + Math.max(0, Math.round(minutes))) }) : a; }

  // The record a finished focus session leaves (null for a break, or one that worked under a second).
  function finish(a, now) {
    if (!a || a.kind !== "focus") return null;
    const focus = elapsedMs(a, now);
    if (focus < MIN_RECORD_MS) return null;
    return { id: a.id, kind: "focus", date: localDay(a.startedAt), startedAt: a.startedAt, endedAt: Math.max(now, a.startedAt), focusMs: Math.round(focus), plannedMin: a.plannedMin, title: a.title, itemKey: a.itemKey, taskId: a.taskId, habitId: a.habitId, updatedAt: now };
  }

  /* ---------------- the kept records ---------------- */

  function cleanRecord(r) {
    if (!isObj(r) || typeof r.id !== "string" || !r.id || r.deletedAt) return null;
    const focus = num(r.focusMs);
    if (!(focus >= MIN_RECORD_MS) || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) return null;
    return { id: r.id, kind: "focus", date: r.date, startedAt: num(r.startedAt), endedAt: num(r.endedAt), focusMs: Math.round(focus), plannedMin: Math.max(0, Math.round(num(r.plannedMin))), title: str(r.title, TITLE_MAX), itemKey: str(r.itemKey, 120), taskId: str(r.taskId, 60), habitId: str(r.habitId, 60), updatedAt: num(r.updatedAt) };
  }
  function live(list) { return (Array.isArray(list) ? list : []).map(cleanRecord).filter(Boolean); }
  // Adds a record unless that session is already in the list (finishing twice cannot count twice).
  function add(list, rec) {
    const have = Array.isArray(list) ? list : [];
    if (!rec || have.some(function (x) { return x && x.id === rec.id; })) return have;
    return have.concat([rec]);
  }

  // Worked minutes (whole minutes, rounded once from the exact milliseconds) in [from, to], by day, overall, and per task.
  function totals(list, from, to) {
    const recs = live(list).filter(function (r) { return r.date >= from && r.date <= to; });
    const ms = recs.reduce(function (n, r) { return n + r.focusMs; }, 0), byDay = {}, byTask = {};
    recs.forEach(function (r) { byDay[r.date] = (byDay[r.date] || 0) + r.focusMs; if (r.taskId) byTask[r.taskId] = (byTask[r.taskId] || 0) + r.focusMs; });
    const mins = function (x) { return Math.round(x / 60000); };
    const out = { sessions: recs.length, minutes: mins(ms), byDay: {}, byTask: {} };
    Object.keys(byDay).forEach(function (d) { out.byDay[d] = mins(byDay[d]); });
    Object.keys(byTask).forEach(function (t) { out.byTask[t] = mins(byTask[t]); });
    return out;
  }

  // "12:05" for a countdown or a count-up. Under an hour is m:ss; an hour or more is h:mm:ss.
  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const two = function (n) { return (n < 10 ? "0" : "") + n; };
    return h ? h + ":" + two(m) + ":" + two(sec) : m + ":" + two(sec);
  }

  return { PRESETS: PRESETS, MAX_MIN: MAX_MIN, minutesFrom: minutesFrom, readActive: readActive, start: start, elapsedMs: elapsedMs, remainingMs: remainingMs, isUp: isUp, isPaused: isPaused, pause: pause, resume: resume, extend: extend, finish: finish, cleanRecord: cleanRecord, live: live, add: add, totals: totals, clock: clock, localDay: localDay };
});
