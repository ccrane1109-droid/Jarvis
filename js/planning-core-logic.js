/* ==========================================================================
   JARVIS — Planning core: one occurrence, one completion (pure rules; no page, storage or network, so they can be tested outside the browser).

   The same activity can be written down in more than one place: a task on the To-Do list or the Day planner, and a habit that is planned
   for the same time ("5:10 AM Cold shower" as a task and as a habit). This module keeps them from being two things to finish.

   A LINK is one optional field on a task: habitId. A task with habitId is "the task form of one habit, on the day the task has". It shares
   that habit's completion for that day, so ticking either one ticks both, and undoing either one undoes both:

     task { id, date, time, text, completed, habitId?, separate?: [id, ...] }
     habit { id, name, completions: { "YYYY-MM-DD": count }, ... }       (see habit-logic.js)

   * Nothing is stored in a new place and no record is merged or deleted by this module. A link is added or removed only when asked.
   * A habit's day is "done" when its count reaches its daily target (habit-logic.js isDone). A linked task is completed on exactly the days
     the habit is done. A habit that counts (3 cups) is filled to its target when its task is ticked, and emptied when it is unticked.
   * Days after today cannot be ticked on a habit (habit-logic.js canEdit). A linked task on a future day keeps its own tick until that day
     comes; nothing here fills a habit for a day that has not happened.
   * separate[] is how a task remembers "I looked at this and it is meant to be a different item": it is never suggested as a duplicate of
     that habit or task again.

   Names are compared after normalizing them (case, accents, punctuation and little words such as "the" and "my" are ignored). Similar
   names only ever SUGGEST; they never change anything on their own.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./habit-logic.js"));
  else root.JarvisPlanningCore = factory(root.JarvisHabitLogic);
})(typeof self !== "undefined" ? self : this, function (HL) {
  "use strict";

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const STOP = { the: 1, a: 1, an: 1, my: 1, some: 1 };
  const NEAR_MIN = 30;                 // two things at the same time of day mean "the same occurrence" within this many minutes
  const MAX_SEPARATE = 40;

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function isDate(s) { return typeof s === "string" && DATE_RE.test(s); }
  function isTime(s) { return typeof s === "string" && TIME_RE.test(s); }
  function minOf(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); }
  function toUTC(d) { const p = d.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  function addDays(d, n) { return new Date(toUTC(d) + n * 86400000).toISOString().slice(0, 10); }
  function find(list, id) { return (Array.isArray(list) ? list : []).filter(function (x) { return x && x.id === id; })[0] || null; }

  /* ---------------- names ---------------- */

  // "Take a COLD shower!" -> "take cold shower". Case, accents, punctuation and the little words (the, a, an, my, some) are ignored.
  function normName(s) {
    let t = String(s === undefined || s === null ? "" : s);
    try { t = t.normalize("NFKD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* an old engine without normalize: compare as typed */ }
    return t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(function (w) { return w && !STOP[w]; }).join(" ");
  }

  // How alike two names are: 1 = the same once normalized, 0.8 = the same words in another order, 0.6 = every word of the shorter is in the longer
  // (and the shorter is two words or at least six letters), 0 = not alike. Only ever a suggestion.
  function nameMatch(a, b) {
    const x = normName(a), y = normName(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const tx = x.split(" "), ty = y.split(" ");
    if (tx.length === ty.length && tx.slice().sort().join(" ") === ty.slice().sort().join(" ")) return 0.8;
    const small = tx.length <= ty.length ? tx : ty, big = tx.length <= ty.length ? ty : tx;
    if ((small.length >= 2 || small.join("").length >= 6) && small.every(function (w) { return big.indexOf(w) !== -1; })) return 0.6;
    return 0;
  }

  // Both times given and further apart than NEAR_MIN: not the same occurrence. A missing time is not a difference.
  function timesAgree(a, b) {
    if (!isTime(a) || !isTime(b)) return true;
    return Math.abs(minOf(a) - minOf(b)) <= NEAR_MIN;
  }

  /* ---------------- keys ---------------- */

  // One identifier per occurrence, the same everywhere: "task:<id>", "habit:<id>@<date>", "event:<id>@<date>", "block:<id>@<date>".
  function occKey(kind, id, date) { return kind === "task" ? "task:" + id : kind + ":" + id + "@" + date; }

  /* ---------------- finding duplicates (suggestions only) ---------------- */

  function separateFrom(rec, otherId) { return !!(rec && Array.isArray(rec.separate) && rec.separate.indexOf(otherId) !== -1); }

  // data: { tasks, habits, events: [{ id, title, date, time, allDay }] }; ctx: { habitOn(habit, date) -> bool, habitTime(habit, date) -> "HH:MM" | "" }
  // cand: { type: "task" | "habit" | "event" | "block", id?, name, date?, time?, separate?: [ids] }
  // -> [{ type, id, name, date, time, strength, why }]  best first. Things already linked to the candidate, or marked separate, are left out.
  function findDuplicates(cand, data, ctx) {
    const out = [], d = data || {}, c = ctx || {};
    if (!cand || !normName(cand.name)) return out;
    const date = isDate(cand.date) ? cand.date : "", time = isTime(cand.time) ? cand.time : "";
    const push = function (type, rec, name, rdate, rtime, strength, why) {
      if (separateFrom(cand, rec.id) || separateFrom(rec, cand.id)) return;
      out.push({ type: type, id: rec.id, name: name, date: rdate || "", time: rtime || "", strength: strength, why: why });
    };
    const habitDay = function (h, dt) { return typeof c.habitOn === "function" ? !!c.habitOn(h, dt) : false; };
    const habitAt = function (h, dt) { return typeof c.habitTime === "function" ? (c.habitTime(h, dt) || "") : ""; };

    if (cand.type === "habit") {
      // A habit with the same name already: a second one would split its history in two.
      (d.habits || []).forEach(function (h) {
        if (!h || !h.name || h.id === cand.id) return;
        const s = nameMatch(cand.name, h.name);
        if (s >= 0.8) push("habit", h, h.name, "", "", s, "You already have a habit with this name.");
      });
      // A new habit: tasks with the same name on days that are not past are "the same thing" written as a task.
      const from = isDate(c.from) ? c.from : "";
      (d.tasks || []).forEach(function (t) {
        if (!t || !t.text || t.habitId || t.id === cand.id || !isDate(t.date) || (from && t.date < from)) return;
        const s = nameMatch(cand.name, t.text);
        if (s >= 0.6) push("task", t, t.text, t.date, t.time, s, "A task with the same name on " + t.date + ".");
      });
      return rank(out);
    }

    if (cand.type === "task" || cand.type === "event" || cand.type === "block") {
      if (!date) return out;
      (d.habits || []).forEach(function (h) {
        if (!h || !h.name || !habitDay(h, date)) return;
        const s = nameMatch(cand.name, h.name), ht = habitAt(h, date);
        if (s >= 0.6 && timesAgree(time, ht)) {
          // a task that already stands for this habit on this day: the new one would be a second copy of it
          if (cand.type === "task" && (d.tasks || []).some(function (t) { return t && t.habitId === h.id && t.date === date && t.id !== cand.id; })) return;
          push("habit", h, h.name, date, ht, s, "The habit " + h.name + " is planned for this day" + (ht ? " at " + ht : "") + ".");
        }
      });
      (d.tasks || []).forEach(function (t) {
        if (!t || !t.text || t.id === cand.id || t.date !== date) return;
        const s = nameMatch(cand.name, t.text);
        if (s >= 0.6 && timesAgree(time, t.time)) push("task", t, t.text, t.date, t.time, s, "A task with the same name on this day.");
      });
      (d.events || []).forEach(function (e) {
        if (!e || !e.title || e.id === cand.id || e.date !== date) return;
        const s = nameMatch(cand.name, e.title);
        if (s >= 0.8 && timesAgree(time, e.time)) push("event", e, e.title, e.date, e.time, s, "A calendar event with the same name on this day.");
      });
    }
    return rank(out);
  }

  function rank(list) { return list.sort(function (a, b) { return b.strength - a.strength || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); }); }

  // Looks through what already exists for things that may be the same occurrence entered twice. Suggestions only: each has an id that stays the
  // same while the two records stay the same, so a dismissed one is not suggested again.
  //   kind "task-habit": a task and a habit planned for the same day (link them so one tick does both)
  //   kind "task-task":  two tasks with the same name on a day (keep both, or delete one)
  //   kind "task-event": a task and a calendar event with the same name on a day (keep both, or delete the task)
  // opts: { from, to }  the days to look at (default: the week just gone to 60 days ahead of ctx.today)
  function scan(data, ctx, opts) {
    const d = data || {}, c = ctx || {}, o = opts || {};
    const today = isDate(c.today) ? c.today : "";
    const from = isDate(o.from) ? o.from : (today ? addDays(today, -7) : "0000-00-00"), to = isDate(o.to) ? o.to : (today ? addDays(today, 60) : "9999-99-99");
    const out = [], seen = {};
    const add = function (s) { if (!seen[s.id]) { seen[s.id] = true; out.push(s); } };
    const tasks = (d.tasks || []).filter(function (t) { return t && t.text && typeof t.id === "string" && isDate(t.date) && t.date >= from && t.date <= to; });
    tasks.forEach(function (t) {
      if (!t.habitId) {
        (d.habits || []).forEach(function (h) {
          if (!h || !h.name || separateFrom(t, h.id)) return;
          if (!(typeof c.habitOn === "function" && c.habitOn(h, t.date))) return;
          const s = nameMatch(t.text, h.name);
          if (s < 0.6 || !timesAgree(t.time, typeof c.habitTime === "function" ? c.habitTime(h, t.date) : "")) return;
          // the habit already has a linked task on that day: this one is a second copy
          if (tasks.some(function (x) { return x.habitId === h.id && x.date === t.date; })) return;
          add({ id: "th:" + t.id + ":" + h.id, kind: "task-habit", strength: s, date: t.date, task: pick(t), habit: { id: h.id, name: h.name, time: typeof c.habitTime === "function" ? c.habitTime(h, t.date) : "" } });
        });
      }
    });
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i], b = tasks[j];
        if (a.date !== b.date || separateFrom(a, b.id) || separateFrom(b, a.id)) continue;
        const s = nameMatch(a.text, b.text);
        if (s < 0.8 || !timesAgree(a.time, b.time)) continue;
        const ids = [a.id, b.id].sort();
        add({ id: "tt:" + ids[0] + ":" + ids[1], kind: "task-task", strength: s, date: a.date, a: pick(a), b: pick(b) });
      }
    }
    (d.events || []).forEach(function (e) {
      if (!e || !e.title || typeof e.id !== "string" || !isDate(e.date) || e.date < from || e.date > to) return;
      tasks.forEach(function (t) {
        if (t.date !== e.date || separateFrom(t, e.id) || t.habitId) return;
        const s = nameMatch(t.text, e.title);
        if (s < 0.8 || !timesAgree(t.time, e.time)) return;
        add({ id: "te:" + t.id + ":" + e.id + "@" + e.date, kind: "task-event", strength: s, date: t.date, task: pick(t), event: { id: e.id, title: e.title, time: e.time || "", date: e.date } });
      });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : b.strength - a.strength || (a.id < b.id ? -1 : 1); });
  }
  function pick(t) { return { id: t.id, text: t.text, date: t.date, time: t.time || "", completed: !!t.completed }; }

  /* ---------------- links ---------------- */

  // Links a task to a habit. The day's state is shared from now on: if either was already done, both are (a completion is never lost by linking).
  // -> { ok, tasks, habits, error }
  function link(tasks, habits, taskId, habitId, today) {
    const t = find(tasks, taskId), h = find(habits, habitId);
    if (!t) return { ok: false, tasks: tasks, habits: habits, error: "That task isn't there any more." };
    if (!h) return { ok: false, tasks: tasks, habits: habits, error: "That habit isn't there any more." };
    if (!isDate(t.date)) return { ok: false, tasks: tasks, habits: habits, error: "That task has no day." };
    const habitDone = HL.isDone(h, t.date), done = !!t.completed || habitDone;
    let nextHabits = habits;
    if (done && !habitDone) {
      const r = HL.setDone(habits, habitId, t.date, true, today);
      if (r && r.ok) nextHabits = r.habits;
      else if (!HL.canEdit(t.date, today)) { /* a future day: the task keeps its own tick until the day comes */ }
    }
    const taskDone = done;                 // done if either side was (a future day keeps the task's own tick)
    const nextTasks = tasks.map(function (x) {
      if (x.id !== taskId) return x;
      const o = Object.assign({}, x, { habitId: habitId, completed: taskDone });
      if (Array.isArray(o.separate)) { o.separate = o.separate.filter(function (s) { return s !== habitId; }); if (!o.separate.length) delete o.separate; }
      return o;
    });
    return { ok: true, tasks: nextTasks, habits: nextHabits };
  }

  // Lets go of the link. The task and the habit both keep whatever they have now.
  function unlink(tasks, taskId) {
    const t = find(tasks, taskId);
    if (!t) return { ok: false, tasks: tasks, error: "That task isn't there any more." };
    return { ok: true, tasks: tasks.map(function (x) { if (x.id !== taskId) return x; const o = Object.assign({}, x); delete o.habitId; return o; }) };
  }

  // "These are meant to be different." Remembered on the task (up to MAX_SEPARATE ids), so the pair is not suggested again.
  function markSeparate(tasks, taskId, otherId) {
    const t = find(tasks, taskId);
    if (!t || typeof otherId !== "string" || !otherId) return { ok: false, tasks: tasks, error: "That task isn't there any more." };
    return { ok: true, tasks: tasks.map(function (x) {
      if (x.id !== taskId) return x;
      const have = Array.isArray(x.separate) ? x.separate : [];
      return have.indexOf(otherId) !== -1 ? x : Object.assign({}, x, { separate: have.concat([otherId]).slice(-MAX_SEPARATE) });
    }) };
  }

  /* ---------------- keeping completion in step ---------------- */

  // A task list was changed (prev -> next). For every linked task whose tick changed, the habit follows on that task's day.
  // -> { habits, changed: [habitId...] }   (habits is the same list object when nothing needed to change)
  function syncFromTasks(prevTasks, nextTasks, habits, today) {
    const before = {};
    (prevTasks || []).forEach(function (t) { if (t && t.id) before[t.id] = t; });
    let hs = habits;
    const changed = [];
    (nextTasks || []).forEach(function (n) {
      if (!n || !n.habitId || !isDate(n.date)) return;
      const p = before[n.id];
      if (!p || !!p.completed === !!n.completed) return;
      const h = find(hs, n.habitId);
      if (!h || HL.isDone(h, n.date) === !!n.completed || !HL.canEdit(n.date, today)) return;
      const r = HL.setDone(hs, n.habitId, n.date, !!n.completed, today);
      if (r && r.ok) { hs = r.habits; changed.push(n.habitId); }
    });
    return { habits: hs, changed: changed };
  }

  // A habit list was changed (prev -> next). For every day a habit became done or not done, the tasks linked to it on that day follow.
  // -> { tasks, changed: [taskId...] }
  function syncFromHabits(prevHabits, nextHabits, tasks) {
    const before = {};
    (prevHabits || []).forEach(function (h) { if (h && h.id) before[h.id] = h; });
    const flips = {};
    let any = false;
    (nextHabits || []).forEach(function (h) {
      const p = before[h && h.id];
      if (!p) return;
      const days = {};
      Object.keys(p.completions || {}).concat(Object.keys(h.completions || {})).forEach(function (d) { days[d] = true; });
      Object.keys(days).forEach(function (d) {
        const was = HL.isDone(p, d), now = HL.isDone(h, d);
        if (was !== now) { flips[h.id + "@" + d] = now; any = true; }
      });
    });
    if (!any) return { tasks: tasks, changed: [] };
    const changed = [];
    const next = (tasks || []).map(function (t) {
      if (!t || !t.habitId) return t;
      const k = t.habitId + "@" + t.date;
      if (Object.prototype.hasOwnProperty.call(flips, k) && !!t.completed !== flips[k]) { changed.push(t.id); return Object.assign({}, t, { completed: flips[k] }); }
      return t;
    });
    return { tasks: changed.length ? next : tasks, changed: changed };
  }

  // One row for one occurrence, in a list of calendar items. Three ways the same occurrence can be on the list, and the richest row stays:
  //   a time block holding a linked task   -> the block stays (it has the time and the category), the habit row goes
  //   a linked task and its habit's row    -> the habit row stays, the task row goes
  //   a linked task whose habit is not on the list that day (a habit with no planner time) stays, so nothing disappears.
  // taskById (optional): { taskId: task } so a block can say which habit its task stands for.
  function unifyItems(items, taskById) {
    const list = Array.isArray(items) ? items : [], byId = taskById || {};
    const habitRows = {}, blockHabit = {};
    list.forEach(function (it) {
      if (!it) return;
      if (it.source === "habit") habitRows[it.id + "@" + it.date] = true;
      if (it.taskId && byId[it.taskId] && byId[it.taskId].habitId) blockHabit[byId[it.taskId].habitId + "@" + it.date] = true;
    });
    return list.filter(function (it) {
      if (!it) return false;
      if (it.source === "task" && it.habitId && habitRows[it.habitId + "@" + it.date]) return false;
      if (it.source === "habit" && blockHabit[it.id + "@" + it.date]) return false;
      return true;
    });
  }

  // Habit ids and the tasks that belong to them on one day (for showing "linked" notes). -> { habitId: [taskId...] }
  function linksOn(tasks, date) {
    const out = {};
    (tasks || []).forEach(function (t) { if (t && t.habitId && t.date === date) (out[t.habitId] = out[t.habitId] || []).push(t.id); });
    return out;
  }

  // Deleting a habit must not leave tasks pointing at nothing: the links of its tasks are let go (the tasks stay). -> tasks
  function dropHabitLinks(tasks, habitId) {
    let any = false;
    const next = (tasks || []).map(function (t) { if (t && t.habitId === habitId) { any = true; const o = Object.assign({}, t); delete o.habitId; return o; } return t; });
    return any ? next : tasks;
  }

  return {
    normName: normName, nameMatch: nameMatch, timesAgree: timesAgree, occKey: occKey, NEAR_MIN: NEAR_MIN,
    findDuplicates: findDuplicates, scan: scan, link: link, unlink: unlink, markSeparate: markSeparate,
    syncFromTasks: syncFromTasks, syncFromHabits: syncFromHabits, unifyItems: unifyItems, linksOn: linksOn, dropHabitLinks: dropHabitLinks
  };
});
