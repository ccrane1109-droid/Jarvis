/* ==========================================================================
   JARVIS — Goals: the rules behind the Goals dashboard (pure functions; no page, storage or network, so they can be tested
   outside the browser).

   A goal is a record in jarvisGoals (Habits > Progress > Goals). Records made before the dashboard are read exactly as they were saved;
   everything new is an optional field with a default, so nothing is rewritten or lost:

     id, name, description, category, targetDate, createdAt     as before
     hasNumericTarget, startValue*, currentValue, targetValue, unit, manualProgressPct, completed
     trackMode*     "milestones" | "numeric" | "manual". Old goals without it are "numeric" if they had a numeric target and "manual"
                    otherwise, so their progress is never recalculated behind your back.
     priority*      "high" | "medium" | "low" (medium when missing): how much it matters, chosen by you
     milestones     [ { id, text, done, due*, taskId*, doneAt* } ]   (older ones only had id, text, done)
     completedAt*, updatedAt*                                          (* = new, optional)

   A milestone can have one task (taskId, a task in the To-Do list / Calendar). While the task exists, the milestone is done exactly when
   the task is: the task is the one source of truth, so completing it in the Calendar completes the milestone and there is nothing to
   keep in step. Nothing here ever changes progress by itself: milestone progress is counted from milestones, and numeric and manual
   progress change only when you change them.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisGoalsLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATEGORIES = [["business", "Business"], ["health", "Health"], ["learning", "Learning"], ["personal", "Personal"]];
  const MODES = ["milestones", "numeric", "manual"];
  const PRIORITIES = ["high", "medium", "low"];
  const NAME_MAX = 80, CAT_MAX = 40, MS_MAX = 80, DESC_MAX = 500, SOON_DAYS = 14, SOON_STEP_DAYS = 7, MS_LIMIT = 60;

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 1000); }
  function isDate(d) { return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T12:00:00Z")); }
  function num(v, d) { const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function dayNo(d) { return Math.round(Date.parse(d + "T12:00:00Z") / 86400000); }
  function diffDays(a, b) { return dayNo(b) - dayNo(a); }
  function addDays(d, n) { return new Date((dayNo(d) + n) * 86400000 + 43200000).toISOString().slice(0, 10); }
  function live(goals) { return (Array.isArray(goals) ? goals : []).filter(function (g) { return isObj(g) && typeof g.id === "string" && g.id; }); }
  function rankOf(p) { return p === "high" ? 0 : p === "low" ? 2 : 1; }
  function priorityOf(g) { return PRIORITIES.indexOf(g && g.priority) !== -1 ? g.priority : "medium"; }

  /* ---------------- reading a goal ---------------- */

  function mode(g) {
    if (g && MODES.indexOf(g.trackMode) !== -1) return g.trackMode;
    return g && g.hasNumericTarget ? "numeric" : "manual";
  }
  function milestones(g) {
    return (g && Array.isArray(g.milestones) ? g.milestones : []).filter(function (m) { return isObj(m) && typeof m.id === "string" && m.id; }).map(function (m) {
      return { id: m.id, text: str(m.text, MS_MAX), done: !!m.done, due: isDate(m.due) ? m.due : "", taskId: typeof m.taskId === "string" ? m.taskId : "", doneAt: typeof m.doneAt === "number" ? m.doneAt : 0 };
    });
  }
  function taskOf(tasks, id) { if (!id || !Array.isArray(tasks)) return null; for (let i = 0; i < tasks.length; i++) if (tasks[i] && tasks[i].id === id) return tasks[i]; return null; }
  // A milestone with a live task is done when that task is; otherwise it is done when it was ticked.
  function milestoneDone(m, tasks) { const t = taskOf(tasks, m.taskId); return t ? !!t.completed : !!m.done; }

  // -> { mode, pct, done, total, start, current, target, remaining, unit, reached }
  function progress(g, tasks) {
    const md = mode(g), out = { mode: md, pct: 0, done: 0, total: 0, start: 0, current: 0, target: 0, remaining: 0, unit: str(g && g.unit, 20), reached: false };
    if (md === "milestones") {
      const ms = milestones(g);
      out.total = ms.length; out.done = ms.filter(function (m) { return milestoneDone(m, tasks); }).length;
      out.pct = out.total ? Math.round(100 * out.done / out.total) : 0;
      out.reached = out.total > 0 && out.done === out.total;
    } else if (md === "numeric") {
      out.start = num(g.startValue, 0); out.current = num(g.currentValue, 0); out.target = num(g.targetValue, 0);
      const span = out.target - out.start;
      if (span === 0) out.pct = clamp(Math.round(num(g.manualProgressPct, 0)), 0, 100);
      else out.pct = clamp(Math.round(100 * (out.current - out.start) / span), 0, 100);
      out.remaining = span >= 0 ? Math.max(0, out.target - out.current) : Math.max(0, out.current - out.target);
      out.reached = span !== 0 && (span > 0 ? out.current >= out.target : out.current <= out.target);
    } else {
      out.pct = clamp(Math.round(num(g && g.manualProgressPct, 0)), 0, 100);
      out.reached = out.pct >= 100;
    }
    if (g && g.completed) out.pct = 100;
    return out;
  }

  /* ---------------- dates and wording ---------------- */

  // -> { days, tone: "none" | "overdue" | "soon" | "later", text }
  function dueInfo(date, today) {
    if (!isDate(date) || !isDate(today)) return { days: null, tone: "none", text: "No target date" };
    const n = diffDays(today, date);
    if (n < 0) return { days: n, tone: "overdue", text: n === -1 ? "Overdue by 1 day" : "Overdue by " + (-n) + " days" };
    if (n === 0) return { days: 0, tone: "soon", text: "Due today" };
    if (n === 1) return { days: 1, tone: "soon", text: "Due tomorrow" };
    const tone = n <= SOON_DAYS ? "soon" : "later";
    return { days: n, tone: tone, text: n <= 60 ? "Due in " + n + " days" : "Due in " + Math.round(n / 30) + " months" };
  }

  /* ---------------- categories and the list ---------------- */

  function categoryKey(cat) {
    const c = str(cat, CAT_MAX).toLowerCase();
    for (let i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i][0] === c) return CATEGORIES[i][0];
    return "other";
  }
  // The filter chips: All Goals, the four categories, and "Other" only when some goal has some other (or no) category. -> [ { key, label, count } ]
  function chips(goals) {
    const list = live(goals), count = {};
    list.forEach(function (g) { const k = categoryKey(g.category); count[k] = (count[k] || 0) + 1; });
    const out = [{ key: "all", label: "All Goals", count: list.length }];
    CATEGORIES.forEach(function (c) { out.push({ key: c[0], label: c[1], count: count[c[0]] || 0 }); });
    if (count.other) out.push({ key: "other", label: "Other", count: count.other });
    return out;
  }
  function filter(goals, key) { return live(goals).filter(function (g) { return !key || key === "all" || categoryKey(g.category) === key; }); }
  // Active goals first (soonest target date first, then the ones you marked more important), finished ones last (latest first).
  function order(goals) {
    const arr = live(goals).map(function (g, i) { return { g: g, i: i }; });
    arr.sort(function (a, b) {
      const ca = a.g.completed ? 1 : 0, cb = b.g.completed ? 1 : 0;
      if (ca !== cb) return ca - cb;
      if (ca) return (b.g.completedAt || b.g.createdAt || 0) - (a.g.completedAt || a.g.createdAt || 0) || a.i - b.i;
      const da = isDate(a.g.targetDate) ? a.g.targetDate : "9999", db = isDate(b.g.targetDate) ? b.g.targetDate : "9999";
      return da < db ? -1 : da > db ? 1 : rankOf(priorityOf(a.g)) - rankOf(priorityOf(b.g)) || a.i - b.i;
    });
    return arr.map(function (x) { return x.g; });
  }

  /* ---------------- the four numbers on top ---------------- */

  // -> { active, completed, dueSoon, overdue, overall (the average progress of the active goals, or null with none) }
  function stats(goals, tasks, today) {
    const list = live(goals), active = list.filter(function (g) { return !g.completed; });
    let soon = 0, over = 0, sum = 0;
    active.forEach(function (g) {
      sum += progress(g, tasks).pct;
      if (isDate(g.targetDate) && isDate(today)) { const n = diffDays(today, g.targetDate); if (n < 0) over++; if (n <= SOON_DAYS) soon++; }
    });
    return { active: active.length, completed: list.length - active.length, dueSoon: soon, overdue: over, overall: active.length ? Math.round(sum / active.length) : null };
  }

  /* ---------------- what to do next ---------------- */

  // Every open step of every active goal: its unfinished milestones, and its open tasks that are not a milestone's own task.
  // Ranked by how soon it is due (overdue, then within a week, then later, then undated), and inside each of those by how much
  // you said the goal (or task) matters, then by date. Reading this changes nothing.
  // -> [ { key, kind: "milestone" | "task", goalId, goalName, milestoneId, taskId, title, due, scheduled, tier, overdue, onToday, priority } ]
  function steps(goals, tasks, today) {
    const out = [], claimed = {}, list = Array.isArray(tasks) ? tasks : [];
    live(goals).forEach(function (g) { milestones(g).forEach(function (m) { if (m.taskId && taskOf(list, m.taskId)) claimed[m.taskId] = true; }); });
    live(goals).forEach(function (g, gi) {
      if (g.completed) return;
      const gp = priorityOf(g);
      milestones(g).forEach(function (m, mi) {
        if (milestoneDone(m, list)) return;
        const t = taskOf(list, m.taskId), date = m.due || (t && isDate(t.date) ? t.date : "");
        out.push({ key: "ms:" + g.id + ":" + m.id, kind: "milestone", goalId: g.id, goalName: str(g.name, NAME_MAX), milestoneId: m.id, taskId: t ? t.id : "", title: m.text, due: date, scheduled: t && isDate(t.date) ? t.date : "", priority: gp, gi: gi, mi: mi });
      });
      list.forEach(function (t, ti) {
        if (!t || t.goalId !== g.id || t.completed || claimed[t.id]) return;
        const tp = PRIORITIES.indexOf(t.priority) !== -1 ? t.priority : "medium";
        out.push({ key: "task:" + t.id, kind: "task", goalId: g.id, goalName: str(g.name, NAME_MAX), milestoneId: "", taskId: t.id, title: str(t.text, 140), due: isDate(t.date) ? t.date : "", scheduled: isDate(t.date) ? t.date : "", priority: rankOf(tp) < rankOf(gp) ? tp : gp, gi: gi, mi: 1000 + ti });
      });
    });
    out.forEach(function (s) {
      const n = isDate(s.due) && isDate(today) ? diffDays(today, s.due) : null;
      s.overdue = n !== null && n < 0;
      s.tier = n === null ? 3 : n < 0 ? 0 : n <= SOON_STEP_DAYS ? 1 : 2;
      s.onToday = s.scheduled === today;
    });
    out.sort(function (a, b) {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const pa = rankOf(a.priority), pb = rankOf(b.priority);
      if (pa !== pb) return pa - pb;
      const da = a.due || "9999", db = b.due || "9999";
      return da < db ? -1 : da > db ? 1 : a.gi - b.gi || a.mi - b.mi;
    });
    return out;
  }
  function nextFor(list, goalId) { for (let i = 0; i < list.length; i++) if (list[i].goalId === goalId) return list[i]; return null; }

  /* ---------------- making and changing goals (each returns a new list; the old one is left alone) ---------------- */

  function validateInput(i, errors) {
    const f = {};
    f.name = str(i.name, NAME_MAX);
    if (!f.name) errors.name = "Give the goal a name.";
    f.description = String(i.description === undefined || i.description === null ? "" : i.description).replace(/\r\n?/g, "\n").trim().slice(0, DESC_MAX);
    f.category = str(i.category, CAT_MAX);
    if (i.targetDate !== undefined && i.targetDate !== "" && !isDate(i.targetDate)) errors.targetDate = "That isn't a date.";
    f.targetDate = isDate(i.targetDate) ? i.targetDate : "";
    f.priority = PRIORITIES.indexOf(i.priority) !== -1 ? i.priority : "medium";
    f.trackMode = MODES.indexOf(i.trackMode) !== -1 ? i.trackMode : "milestones";
    f.hasNumericTarget = f.trackMode === "numeric";
    // Only the fields of the chosen way of tracking are set here, so changing the way never wipes what was saved for another one.
    if (f.trackMode === "numeric") {
      const s = String(i.startValue === undefined || i.startValue === null ? "" : i.startValue).trim(), c = String(i.currentValue === undefined || i.currentValue === null ? "" : i.currentValue).trim(), t = String(i.targetValue === undefined || i.targetValue === null ? "" : i.targetValue).trim();
      f.unit = str(i.unit, 20);
      if (t === "" || !isFinite(Number(t))) errors.targetValue = "Enter the number you are aiming for.";
      if (s !== "" && !isFinite(Number(s))) errors.startValue = "Enter a number.";
      if (c !== "" && !isFinite(Number(c))) errors.currentValue = "Enter a number.";
      f.startValue = s === "" ? 0 : Number(s); f.targetValue = t === "" ? 0 : Number(t);
      f.currentValue = c === "" ? f.startValue : Number(c);
      if (!errors.targetValue && f.targetValue === f.startValue) errors.targetValue = "The target has to be different from the starting value.";
    } else if (f.trackMode === "manual") f.manualProgressPct = clamp(Math.round(num(i.manualProgressPct, 0)), 0, 100);
    return f;
  }
  function newMilestones(rows, ctx, keep) {
    const out = [], seen = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (out.length >= MS_LIMIT) return;
      const row = isObj(r) ? r : { text: r }, text = str(row.text, MS_MAX);
      if (!text) return;
      const old = row.id && keep ? keep[row.id] : null;
      const id = old ? old.id : (ctx.makeId ? ctx.makeId("milestone") : "milestone_" + out.length + "_" + (ctx.now || 0));
      if (seen[id]) return; seen[id] = true;
      const m = Object.assign({}, old || {}, { id: id, text: text, done: old ? !!old.done : false });
      if (isDate(row.due)) m.due = row.due; else delete m.due;
      out.push(m);
    });
    return out;
  }
  // input: { name, description, category, targetDate, priority, trackMode, startValue, currentValue, targetValue, unit, manualProgressPct, milestones: [ { text, due } ] }
  // ctx: { now, makeId }. -> { ok, goals, goal } or { ok: false, goals, errors }
  function create(goals, input, ctx) {
    const c = ctx || {}, errors = {}, f = validateInput(isObj(input) ? input : {}, errors), list = Array.isArray(goals) ? goals : [];
    if (Object.keys(errors).length) return { ok: false, goals: list, errors: errors };
    const now = typeof c.now === "number" ? c.now : Date.now();
    const goal = Object.assign({ startValue: 0, currentValue: 0, targetValue: 0, unit: "", manualProgressPct: 0 }, f, { id: c.makeId ? c.makeId("goal") : "goal_" + now, completed: false, milestones: newMilestones(input.milestones, Object.assign({ now: now }, c)), createdAt: now, updatedAt: now });
    return { ok: true, goals: list.concat([goal]), goal: goal };
  }
  // Same fields; milestones listed in input.milestones keep their state (done, task) by id, new ones are added, ones left out are removed.
  // Without input.milestones the milestones are not touched. A goal's completed flag and its other saved fields are kept.
  function update(goals, id, input, ctx) {
    const c = ctx || {}, errors = {}, list = Array.isArray(goals) ? goals : [], cur = live(list).filter(function (g) { return g.id === id; })[0];
    if (!cur) return { ok: false, goals: list, errors: { name: "That goal isn't there any more." } };
    const f = validateInput(Object.assign({}, input), errors);
    if (Object.keys(errors).length) return { ok: false, goals: list, errors: errors };
    const now = typeof c.now === "number" ? c.now : Date.now();
    const next = Object.assign({}, cur, f, { updatedAt: now });
    if (Array.isArray(input.milestones)) {
      const keep = {}; milestones(cur).forEach(function (m) { keep[m.id] = (cur.milestones || []).filter(function (x) { return x && x.id === m.id; })[0]; });
      next.milestones = newMilestones(input.milestones, Object.assign({ now: now }, c), keep);
    }
    return { ok: true, goals: list.map(function (g) { return g === cur ? next : g; }), goal: next };
  }
  function patch(goals, id, fn) {
    const list = Array.isArray(goals) ? goals : [], cur = list.filter(function (g) { return isObj(g) && g.id === id; })[0];
    if (!cur) return { ok: false, goals: list };
    const next = fn(cur);
    return next ? { ok: true, goals: list.map(function (g) { return g === cur ? next : g; }), goal: next } : { ok: false, goals: list };
  }
  function setCompleted(goals, id, done, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    return patch(goals, id, function (g) { const n = Object.assign({}, g, { completed: !!done, updatedAt: now }); if (done) n.completedAt = now; else delete n.completedAt; return n; });
  }
  // Numeric goals: the number you are at now. It never completes the goal for you (progress shows it; the Complete button is yours).
  function setCurrent(goals, id, value, ctx) {
    const v = String(value === undefined || value === null ? "" : value).trim(), now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    if (v === "" || !isFinite(Number(v))) return { ok: false, goals: goals, error: "Enter a number." };
    const r = patch(goals, id, function (g) { return mode(g) === "numeric" ? Object.assign({}, g, { currentValue: Number(v), updatedAt: now }) : null; });
    return r.ok ? r : { ok: false, goals: goals, error: "That goal isn't tracked with a number." };
  }
  // Manual goals: up or down by a step, from the percentage you set.
  function stepManual(goals, id, delta, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    return patch(goals, id, function (g) { return mode(g) === "manual" ? Object.assign({}, g, { manualProgressPct: clamp(Math.round(num(g.manualProgressPct, 0)) + delta, 0, 100), updatedAt: now }) : null; });
  }
  function setPriority(goals, id, p, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    return patch(goals, id, function (g) { return PRIORITIES.indexOf(p) === -1 ? null : Object.assign({}, g, { priority: p, updatedAt: now }); });
  }

  /* ---------------- milestones ---------------- */

  function mapMilestone(g, msId, fn, now) {
    let found = null;
    const ms = (Array.isArray(g.milestones) ? g.milestones : []).map(function (m) { if (isObj(m) && m.id === msId) { found = m; return fn(m); } return m; });
    return found ? Object.assign({}, g, { milestones: ms, updatedAt: now }) : null;
  }
  function addMilestone(goals, goalId, row, ctx) {
    const c = ctx || {}, now = typeof c.now === "number" ? c.now : Date.now(), text = str(isObj(row) ? row.text : row, MS_MAX);
    if (!text) return { ok: false, goals: goals, error: "Write the milestone first." };
    const r = patch(goals, goalId, function (g) {
      const cur = Array.isArray(g.milestones) ? g.milestones : [];
      if (cur.length >= MS_LIMIT) return null;
      const m = { id: c.makeId ? c.makeId("milestone") : "milestone_" + now + "_" + cur.length, text: text, done: false };
      if (isObj(row) && isDate(row.due)) m.due = row.due;
      return Object.assign({}, g, { milestones: cur.concat([m]), updatedAt: now });
    });
    return r.ok ? r : { ok: false, goals: goals, error: "A goal can have up to " + MS_LIMIT + " milestones." };
  }
  // fields: { text, due } (either). -> also taskPatch { taskId, date } when the milestone's task was on the old due date, so they stay together.
  function editMilestone(goals, goalId, msId, fields, tasks, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now(), f = fields || {};
    let taskPatch = null;
    const r = patch(goals, goalId, function (g) {
      return mapMilestone(g, msId, function (m) {
        const n = Object.assign({}, m);
        if (f.text !== undefined) { const t = str(f.text, MS_MAX); if (t) n.text = t; }
        if (f.due !== undefined) {
          const was = isDate(m.due) ? m.due : "", to = isDate(f.due) ? f.due : "";
          if (to) n.due = to; else delete n.due;
          const t = taskOf(tasks, m.taskId);
          if (t && !t.completed && to && t.date === was && was !== to) taskPatch = { taskId: t.id, date: to };
        }
        return n;
      }, now);
    });
    return r.ok ? Object.assign({}, r, { taskPatch: taskPatch }) : r;
  }
  function removeMilestone(goals, goalId, msId, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    return patch(goals, goalId, function (g) {
      const ms = (g.milestones || []).filter(function (m) { return !(isObj(m) && m.id === msId); });
      return ms.length === (g.milestones || []).length ? null : Object.assign({}, g, { milestones: ms, updatedAt: now });
    });
  }
  // Ticks (or unticks) a milestone. If it has a live task, the task is what changes (taskPatch); the milestone follows it.
  // -> { ok, goals, taskPatch: { taskId, completed } | null }
  function setMilestoneDone(goals, goalId, msId, done, tasks, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    let taskPatch = null;
    const r = patch(goals, goalId, function (g) {
      return mapMilestone(g, msId, function (m) {
        const t = taskOf(tasks, m.taskId), n = Object.assign({}, m, { done: !!done });
        if (done) n.doneAt = now; else delete n.doneAt;
        if (t && !!t.completed !== !!done) taskPatch = { taskId: t.id, completed: !!done };
        return n;
      }, now);
    });
    return r.ok ? Object.assign({}, r, { taskPatch: taskPatch }) : r;
  }
  function linkTask(goals, goalId, msId, taskId, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    return patch(goals, goalId, function (g) { return mapMilestone(g, msId, function (m) { const n = Object.assign({}, m); if (taskId) n.taskId = taskId; else delete n.taskId; return n; }, now); });
  }
  // Keeps what is saved on the milestones in step with their tasks, so deleting a finished task later cannot reopen its milestone.
  // A task that no longer exists is let go (the milestone stays, as it was last). -> { goals, changed }
  function syncFromTasks(goals, tasks, ctx) {
    const now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now(), list = Array.isArray(goals) ? goals : [];
    let changed = false;
    const out = list.map(function (g) {
      if (!isObj(g) || !Array.isArray(g.milestones) || !g.milestones.some(function (m) { return isObj(m) && m.taskId; })) return g;
      let dirty = false;
      const ms = g.milestones.map(function (m) {
        if (!isObj(m) || !m.taskId) return m;
        const t = taskOf(tasks, m.taskId);
        if (!t) { dirty = true; const n = Object.assign({}, m); delete n.taskId; return n; }
        if (!!t.completed === !!m.done) return m;
        dirty = true;
        const n = Object.assign({}, m, { done: !!t.completed });
        if (t.completed) n.doneAt = now; else delete n.doneAt;
        return n;
      });
      if (!dirty) return g;
      changed = true;
      return Object.assign({}, g, { milestones: ms, updatedAt: now });
    });
    return { goals: changed ? out : list, changed: changed };
  }
  // The task to make for a milestone (or, with no milestone, for the goal): { text, date, time, priority, goalId }.
  function taskDraft(g, m, opts) {
    const o = opts || {}, text = str(o.text || (m ? m.text : ""), 140);
    return { text: text, date: isDate(o.date) ? o.date : (m && isDate(m.due) ? m.due : (isDate(o.today) ? o.today : "")), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time || "") ? o.time : "", priority: PRIORITIES.indexOf(o.priority) !== -1 ? o.priority : priorityOf(g), goalId: g.id };
  }

  /* ---------------- on the Calendar ---------------- */

  // What the Calendar shows for goals from..to: a goal's target date, and its milestones' dates. A milestone that has a task is not listed
  // (its task is already on the Calendar), so nothing appears twice. -> items in the Calendar's own shape (all-day points, source "goal").
  function calendarItems(goals, tasks, from, to) {
    const out = [], inRange = function (d) { return isDate(d) && d >= from && d <= to; };
    const base = function (o) {
      return { key: o.key, id: o.id, occDate: o.date, source: "goal", title: o.title, description: o.description || "", kind: "milestone", category: "personal", priority: o.priority, recurring: false, linked: null, status: "", reminders: [],
        completed: !!o.completed, point: true, tz: "", allDay: true, date: o.date, endDate: o.date, time: "", endTime: "", startMin: null, endMin: null, startMs: null, endMs: null, readOnly: !o.tickable, conflict: false,
        goalId: o.goalId, milestoneId: o.milestoneId || "", goalName: o.goalName };
    };
    live(goals).forEach(function (g) {
      const name = str(g.name, NAME_MAX);
      if (!name) return;
      if (inRange(g.targetDate)) out.push(base({ key: "goal:" + g.id, id: g.id, date: g.targetDate, title: "Goal: " + name, priority: priorityOf(g), completed: !!g.completed, goalId: g.id, goalName: name }));
      milestones(g).forEach(function (m) {
        if (!inRange(m.due) || !m.text || (m.taskId && taskOf(tasks, m.taskId))) return;
        out.push(base({ key: "ms:" + g.id + ":" + m.id, id: g.id, date: m.due, title: "Milestone: " + m.text, description: name, priority: priorityOf(g), completed: milestoneDone(m, tasks), tickable: true, goalId: g.id, milestoneId: m.id, goalName: name }));
      });
    });
    return out;
  }

  return {
    CATEGORIES: CATEGORIES, MODES: MODES, PRIORITIES: PRIORITIES, NAME_MAX: NAME_MAX, MS_MAX: MS_MAX, MS_LIMIT: MS_LIMIT, SOON_DAYS: SOON_DAYS,
    mode: mode, milestones: milestones, milestoneDone: milestoneDone, progress: progress, dueInfo: dueInfo, categoryKey: categoryKey, chips: chips, filter: filter, order: order,
    stats: stats, steps: steps, nextFor: nextFor, create: create, update: update, setCompleted: setCompleted, setCurrent: setCurrent, stepManual: stepManual, setPriority: setPriority,
    addMilestone: addMilestone, editMilestone: editMilestone, removeMilestone: removeMilestone, setMilestoneDone: setMilestoneDone, linkTask: linkTask, syncFromTasks: syncFromTasks,
    taskDraft: taskDraft, calendarItems: calendarItems, priorityOf: priorityOf, isDate: isDate, addDays: addDays, diffDays: diffDays
  };
});
