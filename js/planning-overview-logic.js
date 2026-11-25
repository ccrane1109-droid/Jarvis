/* ==========================================================================
   JARVIS — Planning › Overview: the rules behind the daily command center (pure; no page, storage or network).

   It reads what JARVIS already keeps and decides what to put in front of you. Nothing here is stored except which sections you chose.
   Inputs are plain lists: the day's calendar items (events, tasks, time blocks, habits: the same items the Calendar draws, one row for one
   occurrence), the tasks, and the habits' counts. The functions never change what they are given.

   An item: { key, source: "task" | "habit" | "plan" | "event" | "goal", title, date, allDay, time, startMin, endMin, point, completed, scheduled, recurring, kind, category, habitId, taskId }
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisPlanningOverviewLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------- which sections, in what order ---------------- */

  const SECTIONS = [
    { id: "stats", label: "Today in numbers" },
    { id: "next", label: "Up next" },
    { id: "top", label: "Today’s top three" },
    { id: "remaining", label: "Remaining schedule" },
    { id: "habits", label: "Habits" },
    { id: "strategy", label: "Strategic progress" },
    { id: "deadlines", label: "Upcoming deadlines" }
  ];
  const IDS = SECTIONS.map(function (s) { return s.id; });
  const LAYOUTS = {
    simple: ["next", "top", "remaining"],
    balanced: ["stats", "next", "top", "habits", "remaining", "strategy"],
    advanced: IDS.slice()
  };
  const LAYOUT_LABEL = { simple: "Simple", balanced: "Balanced", advanced: "Advanced", custom: "My own" };

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

  // What was saved -> { layout, order, hidden, updatedAt }. Unknown sections are dropped; "balanced" is the default.
  function cleanPrefs(raw) {
    const r = isObj(raw) ? raw : {};
    const layout = r.layout === "simple" || r.layout === "advanced" || r.layout === "custom" ? r.layout : "balanced";
    const order = [], seen = {};
    (Array.isArray(r.order) ? r.order : []).forEach(function (id) { if (IDS.indexOf(id) !== -1 && !seen[id]) { seen[id] = true; order.push(id); } });
    IDS.forEach(function (id) { if (!seen[id]) order.push(id); });
    const hidden = (Array.isArray(r.hidden) ? r.hidden : []).filter(function (id, i, a) { return IDS.indexOf(id) !== -1 && a.indexOf(id) === i; });
    return { layout: layout, order: order, hidden: hidden, updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0 };
  }

  // The sections to draw, in order.
  function sectionsFor(prefs) {
    const p = cleanPrefs(prefs);
    if (p.layout !== "custom") return LAYOUTS[p.layout].slice();
    return p.order.filter(function (id) { return p.hidden.indexOf(id) === -1; });
  }
  // Starting from what is showing now, make it "my own": same sections, same order, ready to be changed.
  function toCustom(prefs) {
    const shown = sectionsFor(prefs), rest = IDS.filter(function (id) { return shown.indexOf(id) === -1; });
    return { layout: "custom", order: shown.concat(rest), hidden: rest, updatedAt: cleanPrefs(prefs).updatedAt };
  }
  function setLayout(prefs, layout, now) {
    const l = LAYOUTS[layout] ? layout : "balanced";
    return Object.assign(cleanPrefs(prefs), { layout: l, updatedAt: now || Date.now() });
  }
  // Show or hide one section (the layout becomes "my own").
  function toggle(prefs, id, now) {
    if (IDS.indexOf(id) === -1) return cleanPrefs(prefs);
    const c = toCustom(prefs), hidden = c.hidden.indexOf(id) !== -1 ? c.hidden.filter(function (x) { return x !== id; }) : c.hidden.concat([id]);
    return Object.assign(c, { hidden: hidden, updatedAt: now || Date.now() });
  }
  // Move a section up (-1) or down (+1) among the sections that are showing.
  function move(prefs, id, delta, now) {
    const c = toCustom(prefs), shown = c.order.filter(function (x) { return c.hidden.indexOf(x) === -1; }), at = shown.indexOf(id), to = at + (delta < 0 ? -1 : 1);
    if (at === -1 || to < 0 || to >= shown.length) return Object.assign(c, { updatedAt: now || Date.now() });
    const a = c.order.indexOf(shown[at]), b = c.order.indexOf(shown[to]), o = c.order.slice();
    o[a] = shown[to]; o[b] = shown[at];
    return Object.assign(c, { order: o, updatedAt: now || Date.now() });
  }

  /* ---------------- the four numbers ---------------- */

  // A task that stands for a habit on its day is counted with the habits, not twice.
  function isHabitTask(t, habitIds) { return !!(t && t.habitId && habitIds && habitIds[t.habitId]); }
  function pct(a, b) { return b > 0 ? Math.round(100 * a / b) : null; }

  // input { today, weekDates: [7 dates], tasks, habitIds: { id: true }, habits: { done, total }, freeMin }
  function stats(input) {
    const i = input || {}, tasks = Array.isArray(i.tasks) ? i.tasks : [], ids = i.habitIds || {};
    const mine = tasks.filter(function (t) { return t && t.text && !isHabitTask(t, ids); });
    const today = mine.filter(function (t) { return t.date === i.today; });
    const week = mine.filter(function (t) { return (i.weekDates || []).indexOf(t.date) !== -1; });
    const done = function (l) { return l.filter(function (t) { return t.completed; }).length; };
    const h = i.habits || { done: 0, total: 0 };
    return {
      tasks: { done: done(today), total: today.length },
      habits: { done: h.done || 0, total: h.total || 0 },
      freeMin: typeof i.freeMin === "number" ? Math.max(0, Math.round(i.freeMin)) : null,
      week: { done: done(week), total: week.length, pct: pct(done(week), week.length) }
    };
  }

  /* ---------------- today's schedule ---------------- */

  function actionable(it) { return !!it && (it.source === "task" || it.source === "habit" || it.source === "plan"); }
  function timed(it) { return it && !it.allDay && typeof it.startMin === "number"; }
  function endOf(it) { return typeof it.endMin === "number" && it.endMin > it.startMin ? it.endMin : it.startMin; }

  // The next thing to do: what is in progress or starts next; failing that, a timed thing from earlier today that is still open (it stays on its
  // day, never overdue); failing that, nothing. { item, state: "now" | "next" | "earlier", minutes }  minutes: until it starts (next) or since it started.
  function upNext(items, nowMin) {
    const open = (Array.isArray(items) ? items : []).filter(function (it) { return actionable(it) && timed(it) && !it.completed; }).sort(function (a, b) { return a.startMin - b.startMin || String(a.title).localeCompare(String(b.title)); });
    const now = open.filter(function (it) { return it.startMin <= nowMin && endOf(it) > nowMin && !it.point; })[0];
    if (now) return { item: now, state: "now", minutes: nowMin - now.startMin };
    const next = open.filter(function (it) { return it.startMin > nowMin; })[0];
    if (next) return { item: next, state: "next", minutes: next.startMin - nowMin };
    const earlier = open.filter(function (it) { return it.startMin <= nowMin; }).pop();
    return earlier ? { item: earlier, state: "earlier", minutes: nowMin - earlier.startMin } : null;
  }

  // What is left of today: open things in time order (anything from earlier today that is still open first, marked), the rest of today's timed
  // events, and tasks with no time ("anytime"). Done things are kept apart. { open: [{ item, when }], done: [item], anytime: [item] }
  function remaining(items, nowMin) {
    const list = Array.isArray(items) ? items : [];
    const open = [], done = [], anytime = [];
    list.forEach(function (it) {
      if (!it || it.allDay && it.source !== "task") return;
      if (it.completed && actionable(it)) { done.push(it); return; }
      if (actionable(it) && !timed(it)) { if (!it.completed) anytime.push(it); return; }
      if (!timed(it)) return;
      if (it.source === "event") { if (endOf(it) > nowMin || it.startMin >= nowMin) open.push({ item: it, when: it.startMin <= nowMin ? "now" : "later" }); return; }
      if (!actionable(it)) return;
      open.push({ item: it, when: it.startMin > nowMin ? "later" : endOf(it) > nowMin && !it.point ? "now" : "earlier" });
    });
    const order = { earlier: 0, now: 1, later: 2 };
    open.sort(function (a, b) { return order[a.when] - order[b.when] || a.item.startMin - b.item.startMin || String(a.item.title).localeCompare(String(b.item.title)); });
    done.sort(function (a, b) { return (a.startMin === undefined || a.startMin === null ? 9999 : a.startMin) - (b.startMin === undefined || b.startMin === null ? 9999 : b.startMin); });
    return { open: open, done: done, anytime: anytime };
  }

  /* ---------------- deadlines and commitments ---------------- */

  function addDays(d, n) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)) + n * 86400000).toISOString().slice(0, 10); }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  // The next commitments, one line each. A deadline task, a goal date or a milestone first (by date); then single events; then repeating ones,
  // grouped ("Wake up · every day this week"), so seven wake-ups never fill the list. Habits and things already done are not listed.
  // items: the next days of calendar items. -> [{ key, kind: "deadline" | "event" | "repeats", title, date, time, count, item }]
  function deadlines(items, today, opts) {
    const o = opts || {}, limit = o.limit || 6, span = o.days || 14, last = addDays(today, span - 1);   // today and the days after it: `span` days in all
    const out = [], groups = {};
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it || it.source === "habit" || it.source === "plan" || it.completed || !it.date || it.date < today || it.date > last) return;
      if (it.source === "task" && it.scheduled !== false) return;            // a task planned for a day is on the schedule, not a deadline
      const isDeadline = it.source === "goal" || (it.source === "task" && it.scheduled === false) || it.kind === "milestone" || it.kind === "task" || it.kind === "deadline";
      if (isDeadline) { out.push({ key: it.key, kind: "deadline", title: it.title, date: it.date, time: it.allDay ? "" : (it.time || ""), count: 1, item: it }); return; }
      if (it.source !== "event") return;
      if (it.recurring) {
        const g = groups[norm(it.title)];
        if (g) g.count++; else { groups[norm(it.title)] = { key: it.key, kind: "repeats", title: it.title, date: it.date, time: it.allDay ? "" : (it.time || ""), count: 1, item: it }; }
        return;
      }
      out.push({ key: it.key, kind: "event", title: it.title, date: it.date, time: it.allDay ? "" : (it.time || ""), count: 1, item: it });
    });
    const byDate = function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "99") < (b.time || "99") ? -1 : (a.time || "99") > (b.time || "99") ? 1 : String(a.title).localeCompare(String(b.title)); };
    const rank = { deadline: 0, event: 1, repeats: 2 };
    return out.concat(Object.keys(groups).map(function (k) { return groups[k]; })).sort(function (a, b) { return rank[a.kind] - rank[b.kind] || byDate(a, b); }).slice(0, limit);
  }

  function hm(min) { const m = Math.max(0, Math.round(min)), h = Math.floor(m / 60); return h ? h + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min"; }

  return { SECTIONS: SECTIONS, LAYOUTS: LAYOUTS, LAYOUT_LABEL: LAYOUT_LABEL, cleanPrefs: cleanPrefs, sectionsFor: sectionsFor, toCustom: toCustom, setLayout: setLayout, toggle: toggle, move: move, stats: stats, upNext: upNext, remaining: remaining, deadlines: deadlines, hm: hm, isHabitTask: isHabitTask };
});
