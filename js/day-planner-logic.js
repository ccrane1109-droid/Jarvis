/* ==========================================================================
   JARVIS — Calendar › Day: the rules for the daily planner (pure functions; no page, storage or network, so they can be tested
   outside the browser).

   The planner has almost no data of its own. What is on a day comes from what already exists: calendar events, your tasks
   (jarvisTasks, the To-Do list), time blocks (jarvisPlanBlocks) and your goals' dates. The only thing saved here is one small
   record per day (jarvisPlanDays, in the plan's storage, backed up and merged like the other planner records):

     { id: "pd_" + the date, date,
       top:  [ { taskId, text } x 3 ]    the day's top three. Each one is a reference to a real task: ticking it ticks the task
                                         everywhere. "text" is only a fallback for when the task is not there any more.
       notes, reflection,                the day's notes and the end-of-day reflection
       createdAt, updatedAt, deletedAt? }

   Free time is worked out, never saved: the stretches of the day window (the plan's day start and end) that nothing takes up. A
   calendar event or a time block takes its whole length; a task with a time but no block takes taskMin minutes (30), the same
   as the weekly planner's free-time rules; an all-day item takes none.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan-logic"));
  else root.JarvisDayPlannerLogic = factory(root.JarvisPlanLogic);
})(typeof self !== "undefined" ? self : this, function (PL) {
  "use strict";

  const SLOTS = 3, TEXT_MAX = 140, NOTE_MAX = 2000, TASK_MIN = 30, MIN_FREE = 15;

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function oneLine(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
  function note(v) { return String(v === undefined || v === null ? "" : v).replace(/\r\n?/g, "\n").slice(0, NOTE_MAX); }
  function dayId(date) { return "pd_" + date; }
  function live(records) { return (Array.isArray(records) ? records : []).filter(function (r) { return isObj(r) && typeof r.id === "string" && PL.isDate(r.date) && !r.deletedAt; }); }
  function recordOf(records, date) { return live(records).filter(function (r) { return r.id === dayId(date); })[0] || null; }

  /* ---------------- the day record ---------------- */
  function read(rec) {
    const r = isObj(rec) ? rec : {}, top = [], list = Array.isArray(r.top) ? r.top : [];
    for (let i = 0; i < SLOTS; i++) {
      const x = isObj(list[i]) ? list[i] : {};
      top.push({ taskId: typeof x.taskId === "string" ? x.taskId : "", text: oneLine(x.text, TEXT_MAX) });
    }
    return { date: r.date, top: top, notes: note(r.notes), reflection: note(r.reflection) };
  }
  function view(records, date) {
    const rec = recordOf(records, date), c = read(rec || { date: date });
    return Object.assign({ date: date, saved: !!rec }, c);
  }
  // change is one of:
  //   { type: "top", index, taskId, text }      (both empty clears the slot)
  //   { type: "notes", text }      { type: "reflection", text }
  // -> { ok, records, record } or { ok: false, records, error } (the list comes back unchanged)
  function update(records, date, change, ctx) {
    const c = ctx || {}, now = typeof c.now === "number" ? c.now : Date.now(), list = Array.isArray(records) ? records : [];
    const fail = function (error) { return { ok: false, records: list, error: error }; };
    if (!PL.isDate(date)) return fail("That isn't a day.");
    if (!isObj(change)) return fail("Nothing to change.");
    const cur = list.filter(function (r) { return isObj(r) && r.id === dayId(date); })[0] || null, base = read(cur || { date: date });
    const top = base.top.map(function (x) { return { taskId: x.taskId, text: x.text }; });
    let notes = base.notes, reflection = base.reflection;
    if (change.type === "top") {
      const i = Number(change.index);
      if (!Number.isInteger(i) || i < 0 || i >= SLOTS) return fail("There are three slots.");
      const taskId = typeof change.taskId === "string" ? change.taskId : "";
      // one task can only be one of the three
      if (taskId && top.some(function (x, k) { return k !== i && x.taskId === taskId; })) return fail("That task is already one of the three.");
      top[i] = { taskId: taskId, text: oneLine(change.text, TEXT_MAX) };
    } else if (change.type === "notes") notes = note(change.text);
    else if (change.type === "reflection") reflection = note(change.text);
    else return fail("Unknown change.");
    const next = Object.assign({}, cur || { id: dayId(date), date: date, createdAt: now }, { id: dayId(date), date: date, top: top, notes: notes, reflection: reflection, updatedAt: now });
    delete next.deletedAt;
    return { ok: true, records: cur ? list.map(function (r) { return r === cur ? next : r; }) : list.concat([next]), record: next };
  }
  // The three slots with what the tasks say now: { index, taskId, text, done, linked }. A slot whose task is gone keeps its words
  // (linked: false) so nothing disappears silently.
  function topItems(v, tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    return v.top.map(function (x, i) {
      const t = x.taskId ? list.filter(function (k) { return k && k.id === x.taskId; })[0] : null;
      return { index: i, taskId: x.taskId, text: t ? String(t.text || "") : x.text, done: !!(t && t.completed), linked: !!t, empty: !x.taskId && !x.text };
    });
  }

  /* ---------------- tasks for the day ---------------- */
  function isTime(t) { return typeof t === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t); }
  function minOf(t) { const p = String(t).split(":"); return Number(p[0]) * 60 + Number(p[1]); }
  // Tasks dated that day with no time: still to schedule (not ticked first, then in the To-Do list's order).
  function unscheduled(tasks, date) {
    return (Array.isArray(tasks) ? tasks : []).filter(function (t) { return t && t.date === date && !isTime(t.time); })
      .sort(function (a, b) { return (a.completed ? 1 : 0) - (b.completed ? 1 : 0) || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0); });
  }

  /* ---------------- the day as a timeline with its free time ---------------- */
  // opts: { date, items, window: { start, end } (minutes), nowMin (only used when date is today), today, minFree, taskMin }
  // items: what the Calendar shows for that day (events, tasks, time blocks, goal dates): { allDay, date, endDate, startMin, endMin, point, completed, source, taskId, title, ... }
  // -> { allDay: [item], rows: [{ type: "item", item, start, end, point } | { type: "free", start, end, minutes }], untimed: [item], windowMin, busyMin, freeMin, nextFree }
  function timeline(opts) {
    const o = opts || {}, date = o.date, items = Array.isArray(o.items) ? o.items : [], w = o.window || { start: 360, end: 1320 };
    const minFree = o.minFree || MIN_FREE, taskMin = o.taskMin || TASK_MIN;
    const day = items.filter(function (it) { return it && it.date <= date && (it.endDate || it.date) >= date; });
    const allDay = day.filter(function (it) { return it.allDay; });
    const untimed = day.filter(function (it) { return !it.allDay && typeof it.startMin !== "number"; });
    const timed = day.filter(function (it) { return !it.allDay && typeof it.startMin === "number"; }).map(function (it) {
      const multi = (it.endDate || it.date) !== it.date;      // an event over several days: its end minute belongs to its last day
      const start = it.date === date ? it.startMin : 0, point = !!it.point || (!multi && (typeof it.endMin !== "number" || it.endMin <= it.startMin));
      const end = point ? start : ((it.endDate || it.date) === date ? it.endMin : 1440);
      return { item: it, start: start, end: end, point: point };
    }).sort(function (a, b) { return a.start - b.start || a.end - b.end || String(a.item.title).localeCompare(String(b.item.title)); });
    // what takes time: ranges as they are; a task with a time but no block takes taskMin; done tasks and reminders take none
    const busy = timed.map(function (r) {
      if (!r.point) return [r.start, r.end];
      const it = r.item;
      return it.source === "task" && !it.completed ? [r.start, Math.min(1440, r.start + taskMin)] : null;
    }).filter(Boolean).sort(function (a, b) { return a[0] - b[0]; });
    let busyMin = 0, cur = null;
    busy.forEach(function (x) {
      const s = Math.max(x[0], w.start), e = Math.min(x[1], w.end);
      if (e <= s) return;
      if (!cur || s > cur[1]) { if (cur) busyMin += cur[1] - cur[0]; cur = [s, e]; } else cur[1] = Math.max(cur[1], e);
    });
    if (cur) busyMin += cur[1] - cur[0];
    const windowMin = Math.max(0, w.end - w.start);
    // rows: the items in time order with a row for each free stretch of at least minFree minutes between them
    const rows = [];
    let cursor = w.start;
    if (o.today === date && typeof o.nowMin === "number" && o.nowMin > cursor) cursor = o.nowMin;
    const free = function (from, to) { if (to - from >= minFree && from < w.end) rows.push({ type: "free", start: from, end: Math.min(to, w.end), minutes: Math.min(to, w.end) - from }); };
    timed.forEach(function (r) {
      if (r.start > cursor) free(cursor, Math.min(r.start, w.end));
      rows.push({ type: "item", item: r.item, start: r.start, end: r.end, point: r.point });
      const takes = r.point ? (r.item.source === "task" && !r.item.completed ? r.start + taskMin : r.start) : r.end;
      cursor = Math.max(cursor, takes);
    });
    if (cursor < w.end) free(cursor, w.end);
    // overall free time counts the whole window (for today: what is left of it)
    let freeMin = Math.max(0, windowMin - busyMin);
    if (o.today === date && typeof o.nowMin === "number" && o.nowMin > w.start) {
      freeMin = rows.filter(function (r) { return r.type === "free"; }).reduce(function (n, r) { return n + r.minutes; }, 0);
    }
    const first = rows.filter(function (r) { return r.type === "free"; })[0] || null;
    return { allDay: allDay, rows: rows, untimed: untimed, windowMin: windowMin, busyMin: busyMin, freeMin: freeMin, nextFree: first ? { start: first.start, end: first.end, minutes: first.minutes } : null };
  }
  // Where a task of `minutes` fits: the first few free stretches that are long enough, as { start, end } (start of the stretch, end = start + minutes).
  function fits(rows, minutes, limit) {
    const out = [];
    (rows || []).forEach(function (r) { if (r.type === "free" && r.minutes >= minutes && out.length < (limit || 3)) out.push({ start: r.start, end: r.start + minutes }); });
    return out;
  }

  /* ---------------- wording ---------------- */
  function hm(min) { const h = Math.floor(min / 60), m = min % 60; return h ? h + " h" + (m ? " " + m + " min" : "") : m + " min"; }

  return { SLOTS: SLOTS, TEXT_MAX: TEXT_MAX, NOTE_MAX: NOTE_MAX, TASK_MIN: TASK_MIN, MIN_FREE: MIN_FREE, dayId: dayId, read: read, view: view, update: update, topItems: topItems, unscheduled: unscheduled, timeline: timeline, fits: fits, hm: hm, minOf: minOf, isTime: isTime };
});
