/* ==========================================================================
   JARVIS — Habits: the day planner's rules (pure functions, no page access, so they can be
   tested outside the browser).

   The planner has no data of its own. An item in an hour is a task (jarvisTasks) that has a time:
   { id, date, text, priority, category, time: "HH:MM", completed, goalId, order, createdAt }.
   So what you plan here is also in your To-Do list, ticking it in either place ticks it in both, and
   everything that already reads tasks (Discipline, backup) keeps working. A task without a time is
   "not scheduled yet" and can be given an hour. A time is when it starts; there is no length.

   Nothing here changes what it is given: every edit returns a new list.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisDayPlanLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const TEXT_MAX = 140;

  /* ---------------- times ---------------- */

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function parseTime(s) { const m = TIME_RE.exec(String(s === undefined || s === null ? "" : s).trim()); return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null; }
  function timeString(hour, minute) { return pad(hour) + ":" + pad(minute || 0); }
  function hourLabel(hour) { return ((hour + 11) % 12 + 1) + (hour < 12 ? " AM" : " PM"); }
  function timeLabel(s) { const t = parseTime(s); return t ? ((t.hour + 11) % 12 + 1) + ":" + pad(t.minute) + (t.hour < 12 ? " AM" : " PM") : ""; }
  function minutesOf(s) { const t = parseTime(s); return t ? t.hour * 60 + t.minute : null; }
  function isPlanned(task) { return !!(task && parseTime(task.time)); }
  function currentHour(nowMs) { return new Date(nowMs).getHours(); }

  /* ---------------- reading a day ---------------- */

  function forDate(tasks, date) { return (Array.isArray(tasks) ? tasks : []).filter(function (t) { return t && t.date === date; }); }
  function byTime(a, b) { return minutesOf(a.time) - minutesOf(b.time) || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0); }

  // 24 slots, midnight first: [{ hour, label, items: [task, ...] }], each hour's items by time.
  function slots(tasks, date) {
    const out = [];
    for (let h = 0; h < 24; h++) out.push({ hour: h, label: hourLabel(h), items: [] });
    forDate(tasks, date).filter(isPlanned).sort(byTime).forEach(function (t) { out[parseTime(t.time).hour].items.push(t); });
    return out;
  }

  // Tasks for the day with no time: not ticked first, in the order of the To-Do list.
  function unscheduled(tasks, date) {
    return forDate(tasks, date).filter(function (t) { return !isPlanned(t); }).sort(function (a, b) { return (a.completed ? 1 : 0) - (b.completed ? 1 : 0) || (a.order || 0) - (b.order || 0); });
  }

  function summary(tasks, date) {
    const day = forDate(tasks, date);
    const planned = day.filter(isPlanned);
    return { planned: planned.length, plannedDone: planned.filter(function (t) { return t.completed; }).length, unscheduled: day.length - planned.length, total: day.length };
  }

  /* ---------------- changing a day ---------------- */

  function check(text, hour, minute) {
    const t = String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim();
    if (!t) return { ok: false, error: "Write what you are planning." };
    if (t.length > TEXT_MAX) return { ok: false, error: "Keep it to " + TEXT_MAX + " characters or fewer." };
    // An empty hour is not midnight: Number("") and Number(null) are 0, so they have to be refused before converting.
    const blank = function (v) { return v === undefined || v === null || String(v).trim() === ""; };
    if (blank(hour)) return { ok: false, error: "Pick an hour." };
    const h = Number(hour), m = blank(minute) ? 0 : Number(minute);
    if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: "Pick an hour." };
    if (!Number.isInteger(m) || m < 0 || m > 59) return { ok: false, error: "Pick the minutes." };
    return { ok: true, text: t, time: timeString(h, m) };
  }

  function nextOrder(tasks, date) {
    const list = forDate(tasks, date);
    return list.length ? Math.max.apply(null, list.map(function (t) { return t.order || 0; })) + 1 : 0;
  }

  // Plan something in an hour. input: { date, text, hour, minute }; ctx: { makeId(), now }. -> { ok, tasks, task, error }
  function add(tasks, input, ctx) {
    const c = check(input && input.text, input && input.hour, input && input.minute);
    if (!c.ok) return { ok: false, tasks: tasks, error: c.error };
    if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, tasks: tasks, error: "Pick a day." };
    const task = { id: ctx.makeId(), date: input.date, text: c.text, priority: "medium", category: "", time: c.time, completed: false, goalId: null, order: nextOrder(tasks, input.date), createdAt: ctx.now };
    return { ok: true, tasks: (tasks || []).concat([task]), task: task };
  }

  function update(tasks, id, fn) {
    let found = null;
    const next = (tasks || []).map(function (t) { if (t.id !== id) return t; found = fn(t); return found; });
    return found ? { ok: true, tasks: next, task: found } : { ok: false, tasks: tasks, error: "That isn't there any more." };
  }

  // Change what it says and/or when it starts. input: { text?, hour?, minute? } (missing parts stay as they are).
  function edit(tasks, id, input) {
    const cur = (tasks || []).filter(function (t) { return t.id === id; })[0];
    if (!cur) return { ok: false, tasks: tasks, error: "That isn't there any more." };
    const t = parseTime(cur.time) || { hour: 0, minute: 0 };
    const c = check(input.text !== undefined ? input.text : cur.text, input.hour !== undefined ? input.hour : t.hour, input.minute !== undefined ? input.minute : t.minute);
    if (!c.ok) return { ok: false, tasks: tasks, error: c.error };
    return update(tasks, id, function (x) { return Object.assign({}, x, { text: c.text, time: c.time }); });
  }

  // Give an unscheduled task an hour (keeps its text).
  function schedule(tasks, id, hour, minute) {
    const cur = (tasks || []).filter(function (t) { return t.id === id; })[0];
    if (!cur) return { ok: false, tasks: tasks, error: "That isn't there any more." };
    return edit(tasks, id, { hour: hour, minute: minute === undefined ? 0 : minute });
  }

  function unschedule(tasks, id) { return update(tasks, id, function (t) { return Object.assign({}, t, { time: "" }); }); }
  function toggle(tasks, id) { return update(tasks, id, function (t) { return Object.assign({}, t, { completed: !t.completed }); }); }

  // -> { ok, tasks, removed, index } so the removal can be put back exactly where it was.
  function remove(tasks, id) {
    const list = tasks || [];
    const index = list.findIndex(function (t) { return t.id === id; });
    if (index === -1) return { ok: false, tasks: tasks, error: "That isn't there any more." };
    return { ok: true, tasks: list.slice(0, index).concat(list.slice(index + 1)), removed: list[index], index: index };
  }

  function restore(tasks, task, index) {
    const list = tasks || [];
    if (list.some(function (t) { return t.id === task.id; })) return list;
    const at = Math.max(0, Math.min(index, list.length));
    return list.slice(0, at).concat([task], list.slice(at));
  }

  // The hour to scroll to when the planner opens: the current hour on today, otherwise the first planned item, otherwise 7 AM.
  function startHour(tasks, date, today, nowMs) {
    if (date === today) return currentHour(nowMs);
    const first = forDate(tasks, date).filter(isPlanned).sort(byTime)[0];
    return first ? parseTime(first.time).hour : 7;
  }

  return {
    TEXT_MAX: TEXT_MAX,
    parseTime: parseTime, timeString: timeString, hourLabel: hourLabel, timeLabel: timeLabel, minutesOf: minutesOf, isPlanned: isPlanned, currentHour: currentHour,
    slots: slots, unscheduled: unscheduled, summary: summary, check: check,
    add: add, edit: edit, schedule: schedule, unschedule: unschedule, toggle: toggle, remove: remove, restore: restore, startHour: startHour
  };
});
