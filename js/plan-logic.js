/* ==========================================================================
   JARVIS — Strategic Planning Center: the rules for the plan itself (pure functions; no page, storage or
   network, so they can be tested outside the browser).

   The chain, top to bottom:
     Three-year vision -> Yearly objectives -> Quarterly priorities -> Monthly milestones -> Tasks -> Time blocks
   The first four are "plan nodes". Tasks are the ones you already have (jarvisTasks); a task is linked to AT MOST ONE node
   (or none), so it can never be counted twice. Time blocks live in plan-week-logic.js.

   Lists, each in its own storage key and its own cloud-backup key (merged by id, deleted records kept as tombstones for 30 days):
     nodes     jarvisPlanNodes     { id, type: objective|priority|milestone, title, notes, parentId, year, quarter, month,
                                     due, status: active|paused|dropped, measure: tasks|revenue|budget|number|goal,
                                     target, current, unit, goalId, doneAt, order, createdAt, updatedAt, deletedAt? }
     periods   jarvisPlanPeriods   { id: "y:2026" | "q:2026-Q1" | "m:2026-11", scope, key, revenueTarget, budget, revenue,
                                     spend, hiresPlanned, hiresMade, hiringNote, updatedAt }
     links     jarvisPlanLinks     { id (= the task's id), nodeId, estMin, createdAt, updatedAt, deletedAt? }
     settings  jarvisPlanSettings  { startYear, vision, revenueMetric: sales|mrr, dayStart, dayEnd, interval, updatedAt }

   How progress is worked out (nothing is guessed):
     tasks     done tasks / all tasks linked to this node or anything under it. Each task is counted once. A milestone
               with no tasks counts as one item that you tick off yourself.
     revenue   the revenue you typed in for the months it covers / its target. For Gratiel that is monthly sales revenue
               (summed); with "MRR" chosen it is the latest month you entered (MRR is a snapshot, not a total).
     budget    what you typed in as spent over the months it covers / its limit. This is how much of it is used.
     number    current / target, typed by you (for example "hires made").
     goal      the progress of one of your existing Goals (Habits > Goals), read as it stands.
   Revenue and budget never use task completion, and task progress never uses money.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisPlanLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEYS = {
    nodes: "jarvisPlanNodes", periods: "jarvisPlanPeriods", links: "jarvisPlanLinks", settings: "jarvisPlanSettings",
    ingredients: "jarvisPlanIngredients", blocks: "jarvisPlanBlocks", weeks: "jarvisPlanWeeks"
  };
  const TYPES = ["objective", "priority", "milestone"];
  const TYPE_LABEL = { objective: "Yearly objective", priority: "Quarterly priority", milestone: "Monthly milestone" };
  const MEASURES = [
    { key: "tasks", label: "Tasks I complete", hint: "Progress is the share of linked tasks that are done." },
    { key: "revenue", label: "Revenue", hint: "Progress is the revenue you have entered for the months it covers." },
    { key: "budget", label: "Spending limit", hint: "Progress is how much of the limit you have spent." },
    { key: "number", label: "A number I track", hint: "You update the current number yourself, e.g. hires made." },
    { key: "goal", label: "One of my Goals", hint: "Follows the progress of a goal from Habits > Goals." }
  ];
  const STATUSES = [{ key: "active", label: "Active" }, { key: "paused", label: "Paused" }, { key: "dropped", label: "Dropped" }];
  const MAX_PER_SLOT = 3;          // three yearly objectives per year, three priorities per quarter
  const TITLE_MAX = 140, NOTES_MAX = 2000, UNIT_MAX = 16, MONEY_MAX = 1e12, TOMBSTONE_DAYS = 30;
  const HIRES_MAX = 10000;

  /* ---------------- dates ---------------- */
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isDate(s) {
    if (typeof s !== "string" || !DATE_RE.test(s)) return false;
    const p = s.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function isMonth(s) { return typeof s === "string" && MONTH_RE.test(s); }
  function toUTC(date) { const p = date.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function fromUTC(ms) { const d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function addDays(date, n) { return fromUTC(toUTC(date) + n * 86400000); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }       // m is 1-12
  function monthKey(y, m) { return y + "-" + pad(m); }
  function monthStart(mk) { return mk + "-01"; }
  function monthEnd(mk) { const y = Number(mk.slice(0, 4)), m = Number(mk.slice(5)); return mk + "-" + pad(daysInMonth(y, m)); }
  function monthOfDate(date) { return date.slice(0, 7); }
  function quarterOfMonth(m) { return Math.floor((m - 1) / 3) + 1; }
  function quarterOfDate(date) { return quarterOfMonth(Number(date.slice(5, 7))); }
  function quarterKey(y, q) { return y + "-Q" + q; }
  function quarterMonths(y, q) { const out = []; for (let i = 0; i < 3; i++) out.push(monthKey(y, (q - 1) * 3 + 1 + i)); return out; }
  function yearMonths(y) { const out = []; for (let m = 1; m <= 12; m++) out.push(monthKey(y, m)); return out; }
  function quarterRange(y, q) { const ms = quarterMonths(y, q); return { start: monthStart(ms[0]), end: monthEnd(ms[2]) }; }
  function yearRange(y) { return { start: y + "-01-01", end: y + "-12-31" }; }
  function monthName(mk, long) { return new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5)) - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: long ? "long" : "short" }); }
  function yearOf(date) { return Number(date.slice(0, 4)); }

  /* ---------------- small helpers ---------------- */
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function oneLine(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim(); }
  function text(v, max) { return String(v === undefined || v === null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, max); }
  function intIn(v, lo, hi) { const n = Number(v); return v !== "" && v !== null && v !== undefined && Number.isInteger(n) && n >= lo && n <= hi ? n : null; }
  // A typed-in amount: "" -> null (not set); "$12,500.50" -> 12500.5; anything unusable -> undefined (an error).
  function amount(v, max) {
    if (v === "" || v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n >= 0 && n <= (max || MONEY_MAX) ? Math.round(n * 100) / 100 : undefined;
  }
  function live(list) { return (Array.isArray(list) ? list : []).filter(function (r) { return isObj(r) && !r.deletedAt; }); }
  function stamp(r, now) { return Object.assign({}, r, { updatedAt: now }); }
  function tombstone(r, now) { return Object.assign({}, r, { deletedAt: now, updatedAt: now }); }
  function restoreRec(r, now) { const c = Object.assign({}, r, { updatedAt: now }); delete c.deletedAt; return c; }
  function purge(list, now) { const cutoff = now - TOMBSTONE_DAYS * 86400000; return (Array.isArray(list) ? list : []).filter(function (r) { return !(isObj(r) && r.deletedAt && r.deletedAt < cutoff); }); }
  function ctxOf(c) {
    const x = Object.assign({ now: Date.now(), makeId: null, today: "" }, c || {});
    if (!x.makeId) x.makeId = function (p) { return p + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); };
    return x;
  }
  function nextOrder(list) { return list.reduce(function (m, r) { return Math.max(m, Number(r.order) || 0); }, 0) + 1; }

  /* ---------------- settings ---------------- */
  const DEFAULT_SETTINGS = { startYear: 0, vision: "", revenueMetric: "sales", dayStart: "06:00", dayEnd: "22:00", interval: 30, updatedAt: 0 };
  function isTime(t) { return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  function settings(raw, today) {
    const r = isObj(raw) ? raw : {};
    const s = Object.assign({}, DEFAULT_SETTINGS);
    const y = intIn(r.startYear, 2000, 2100);
    s.startYear = y !== null ? y : (isDate(today) ? yearOf(today) : new Date().getFullYear());
    s.vision = text(r.vision, 600);
    s.revenueMetric = r.revenueMetric === "mrr" ? "mrr" : "sales";
    if (isTime(r.dayStart) && isTime(r.dayEnd) && r.dayStart < r.dayEnd) { s.dayStart = r.dayStart; s.dayEnd = r.dayEnd; }
    s.interval = Number(r.interval) === 60 ? 60 : 30;
    s.updatedAt = Number(r.updatedAt) || 0;
    return s;
  }
  function planYears(s) { return [s.startYear, s.startYear + 1, s.startYear + 2]; }

  /* ---------------- reading what's stored ---------------- */
  // Records this version understands, cleaned; anything it doesn't is handed back in `kept` and written back untouched.
  function readNodes(raw) {
    const items = [], kept = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      if (!isObj(r) || typeof r.id !== "string" || !r.id || TYPES.indexOf(r.type) === -1) { kept.push(r); return; }
      const n = Object.assign({}, r);
      n.title = oneLine(r.title).slice(0, TITLE_MAX) || "Untitled";
      n.notes = text(r.notes, NOTES_MAX);
      n.parentId = typeof r.parentId === "string" ? r.parentId : "";
      n.status = STATUSES.some(function (s) { return s.key === r.status; }) ? r.status : "active";
      n.measure = MEASURES.some(function (m) { return m.key === r.measure; }) ? r.measure : "tasks";
      n.due = isDate(r.due) ? r.due : "";
      n.doneAt = isDate(r.doneAt) ? r.doneAt : "";
      n.unit = oneLine(r.unit).slice(0, UNIT_MAX);
      n.goalId = typeof r.goalId === "string" ? r.goalId : "";
      n.target = amount(r.target) === undefined ? null : amount(r.target);
      n.current = amount(r.current) === undefined ? null : amount(r.current);
      n.order = Number(r.order) || 0;
      const y = intIn(r.year, 2000, 2100), q = intIn(r.quarter, 1, 4);
      n.year = y; n.quarter = q;
      n.month = isMonth(r.month) ? r.month : "";
      if (n.type === "milestone" && n.month) { n.year = Number(n.month.slice(0, 4)); n.quarter = quarterOfMonth(Number(n.month.slice(5))); }
      if (n.year === null) { kept.push(r); return; }        // no usable year: not understood, kept as it was
      items.push(n);
    });
    return { items: items, kept: kept };
  }
  function readLinks(raw) {
    const items = [], kept = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      if (!isObj(r) || typeof r.id !== "string" || !r.id) { kept.push(r); return; }
      const est = intIn(r.estMin, 0, 1440);
      items.push(Object.assign({}, r, { nodeId: typeof r.nodeId === "string" ? r.nodeId : "", estMin: est === null ? 0 : est }));
    });
    return { items: items, kept: kept };
  }

  /* ---------------- plan nodes: make, edit, delete ---------------- */
  function liveNodes(nodes) { return live(nodes).filter(function (n) { return TYPES.indexOf(n.type) !== -1; }); }
  function byId(nodes, id) { return liveNodes(nodes).filter(function (n) { return n.id === id; })[0] || null; }

  // Checks what was typed in the form and returns { ok, errors, node } where node holds only the cleaned fields.
  function checkNode(input, ctx) {
    const c = ctxOf(ctx), i = input || {}, errors = {}, nodes = c.nodes || [];
    const type = TYPES.indexOf(i.type) !== -1 ? i.type : "";
    if (!type) return { ok: false, errors: { type: "Pick what this is." }, node: null };
    const node = { type: type };
    const title = oneLine(i.title);
    if (!title) errors.title = "Give it a title."; else if (title.length > TITLE_MAX) errors.title = "Keep the title to " + TITLE_MAX + " characters or fewer.";
    node.title = title.slice(0, TITLE_MAX);
    node.notes = text(i.notes, NOTES_MAX + 1);
    if (node.notes.length > NOTES_MAX) errors.notes = "Keep the notes to " + NOTES_MAX + " characters or fewer.";
    node.due = "";
    if (i.due !== undefined && i.due !== null && i.due !== "") { if (isDate(i.due)) node.due = i.due; else errors.due = "Pick a valid deadline."; }

    // where it sits in time
    let parent = null;
    if (i.parentId) {
      parent = byId(nodes, i.parentId);
      if (!parent) errors.parentId = "That item isn't there any more.";
    }
    node.parentId = parent ? parent.id : "";
    if (type === "objective") {
      const y = intIn(i.year, 2000, 2100);
      if (y === null) errors.year = "Pick the year."; else node.year = y;
      node.parentId = ""; node.quarter = null; node.month = "";
    } else if (type === "priority") {
      const y = intIn(i.year, 2000, 2100), q = intIn(i.quarter, 1, 4);
      if (y === null) errors.year = "Pick the year."; else node.year = y;
      if (q === null) errors.quarter = "Pick the quarter."; else node.quarter = q;
      node.month = "";
      if (parent) {
        if (parent.type !== "objective") errors.parentId = "A quarterly priority belongs under a yearly objective.";
        else if (y !== null && parent.year !== y) errors.parentId = "That objective is for " + parent.year + ", not " + y + ".";
      }
    } else {
      if (!isMonth(i.month)) errors.month = "Pick the month."; else { node.month = i.month; node.year = Number(i.month.slice(0, 4)); node.quarter = quarterOfMonth(Number(i.month.slice(5))); }
      if (parent && isMonth(i.month)) {
        if (parent.type === "milestone") errors.parentId = "A milestone belongs under a quarterly priority or a yearly objective.";
        else if (parent.year !== node.year) errors.parentId = "That item is for " + parent.year + ", not " + node.year + ".";
        else if (parent.type === "priority" && parent.quarter !== node.quarter) errors.parentId = "That priority is for Q" + parent.quarter + ", but this month is in Q" + node.quarter + ".";
      }
    }

    // how it is measured
    const measure = MEASURES.some(function (m) { return m.key === i.measure; }) ? i.measure : "tasks";
    node.measure = measure; node.target = null; node.current = null; node.unit = ""; node.goalId = "";
    if (measure === "revenue" || measure === "budget") {
      const t = amount(i.target);
      if (t === undefined || t === null || t <= 0) errors.target = measure === "revenue" ? "Enter the revenue target (more than 0)." : "Enter the spending limit (more than 0).";
      else node.target = t;
    } else if (measure === "number") {
      const t = amount(i.target, 1e9), cur = amount(i.current, 1e9);
      if (t === undefined || t === null || t <= 0) errors.target = "Enter the number you are aiming for (more than 0).";
      else node.target = t;
      if (cur === undefined) errors.current = "Enter the current number (0 or more)."; else node.current = cur === null ? 0 : cur;
      node.unit = oneLine(i.unit).slice(0, UNIT_MAX);
    } else if (measure === "goal") {
      const g = typeof i.goalId === "string" ? i.goalId : "";
      if (!g) errors.goalId = "Pick one of your goals.";
      else if (Array.isArray(c.goals) && !c.goals.some(function (x) { return x && x.id === g; })) errors.goalId = "That goal isn't there any more.";
      else node.goalId = g;
    }
    node.status = STATUSES.some(function (s) { return s.key === i.status; }) ? i.status : "active";

    // three to a slot
    if (!errors.year && !errors.quarter && (type === "objective" || type === "priority")) {
      const same = liveNodes(nodes).filter(function (n) {
        return n.id !== c.selfId && n.type === type && n.year === node.year && (type === "objective" || n.quarter === node.quarter) && n.status !== "dropped";
      });
      if (node.status !== "dropped" && same.length >= MAX_PER_SLOT) {
        errors.title = type === "objective"
          ? "A year holds " + MAX_PER_SLOT + " objectives. Drop or delete one first, or put this in another year."
          : "A quarter holds " + MAX_PER_SLOT + " priorities. Drop or delete one first, or put this in another quarter.";
      }
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, node: node };
  }

  function addNode(nodes, input, ctx) {
    const c = ctxOf(ctx);
    const r = checkNode(input, Object.assign({}, c, { nodes: nodes }));
    if (!r.ok) return { ok: false, nodes: nodes, errors: r.errors };
    const rec = Object.assign({}, r.node, { id: c.makeId("pn"), doneAt: "", order: nextOrder(nodes || []), createdAt: c.now, updatedAt: c.now });
    return { ok: true, nodes: (nodes || []).concat([rec]), node: rec };
  }
  function editNode(nodes, id, patch, ctx) {
    const c = ctxOf(ctx), cur = byId(nodes, id);
    if (!cur) return { ok: false, nodes: nodes, errors: { title: "That isn't there any more." } };
    const merged = Object.assign({}, cur, patch || {}, { type: cur.type });
    const r = checkNode(merged, Object.assign({}, c, { nodes: nodes, selfId: id }));
    if (!r.ok) return { ok: false, nodes: nodes, errors: r.errors };
    const next = Object.assign({}, cur, r.node, { updatedAt: c.now });
    // a goal/number/revenue node is "achieved" by its own measure; clear a manual tick when the measure changed away from tasks
    if (next.measure !== "tasks" && cur.measure === "tasks") next.doneAt = "";
    return { ok: true, nodes: nodes.map(function (n) { return n === cur || n.id === id ? next : n; }), node: next };
  }
  function removeNode(nodes, id, ctx) {
    const c = ctxOf(ctx), cur = byId(nodes, id);
    if (!cur) return { ok: false, nodes: nodes };
    return { ok: true, nodes: nodes.map(function (n) { return n.id === id ? tombstone(n, c.now) : n; }), node: cur };
  }
  function restoreNode(nodes, id, ctx) {
    const c = ctxOf(ctx);
    return { ok: true, nodes: nodes.map(function (n) { return n.id === id && n.deletedAt ? restoreRec(n, c.now) : n; }) };
  }
  // Ticks a node off by hand. Only allowed where there are no tasks to complete (the model says so); see Model.canMarkDone.
  function setDoneAt(nodes, id, done, ctx) {
    const c = ctxOf(ctx), cur = byId(nodes, id);
    if (!cur) return { ok: false, nodes: nodes };
    const day = isDate(c.today) ? c.today : new Date(c.now).toISOString().slice(0, 10);
    const next = Object.assign({}, cur, { doneAt: done ? day : "", updatedAt: c.now });
    return { ok: true, nodes: nodes.map(function (n) { return n.id === id ? next : n; }), node: next };
  }
  function setCurrent(nodes, id, value, ctx) {
    const c = ctxOf(ctx), cur = byId(nodes, id), v = amount(value, 1e9);
    if (!cur || cur.measure !== "number") return { ok: false, nodes: nodes, error: "That isn't a number you track." };
    if (v === undefined || v === null) return { ok: false, nodes: nodes, error: "Enter a number (0 or more)." };
    const next = Object.assign({}, cur, { current: v, updatedAt: c.now });
    return { ok: true, nodes: nodes.map(function (n) { return n.id === id ? next : n; }), node: next };
  }
  function setStatus(nodes, id, status, ctx) {
    const c = ctxOf(ctx);
    if (!STATUSES.some(function (s) { return s.key === status; })) return { ok: false, nodes: nodes };
    return editNode(nodes, id, { status: status }, c);
  }
  // Moves a node up or down among the ones sharing its slot (same type, year and quarter).
  function move(nodes, id, dir, ctx) {
    const c = ctxOf(ctx), cur = byId(nodes, id);
    if (!cur) return nodes;
    const sibs = liveNodes(nodes).filter(function (n) { return n.type === cur.type && n.year === cur.year && n.quarter === cur.quarter && n.month === cur.month; })
      .sort(function (a, b) { return (a.order - b.order) || (a.createdAt - b.createdAt); });
    const at = sibs.findIndex(function (n) { return n.id === id; }), to = at + (dir < 0 ? -1 : 1);
    if (at < 0 || to < 0 || to >= sibs.length) return nodes;
    const a = sibs[at], b = sibs[to], ao = a.order, bo = b.order === a.order ? a.order + (dir < 0 ? -1 : 1) : b.order;
    return nodes.map(function (n) {
      if (n.id === a.id) return Object.assign({}, n, { order: bo, updatedAt: c.now });
      if (n.id === b.id) return Object.assign({}, n, { order: ao, updatedAt: c.now });
      return n;
    });
  }

  /* ---------------- money, hiring: the period records ---------------- */
  function periodId(scope, key) { return (scope === "year" ? "y:" : scope === "quarter" ? "q:" : "m:") + key; }
  function validKey(scope, key) {
    return scope === "year" ? /^\d{4}$/.test(String(key)) : scope === "quarter" ? /^\d{4}-Q[1-4]$/.test(String(key)) : scope === "month" ? isMonth(key) : false;
  }
  function periodOf(periods, scope, key) {
    const id = periodId(scope, key);
    return live(periods).filter(function (p) { return p.id === id; })[0] || null;
  }
  const PERIOD_AMOUNTS = { year: ["revenueTarget", "budget"], quarter: ["revenueTarget", "budget"], month: ["revenueTarget", "budget", "revenue", "spend"] };
  // patch holds only the fields being changed ("" clears one). Returns { ok, periods, errors }.
  function setPeriod(periods, scope, key, patch, ctx) {
    const c = ctxOf(ctx), p = patch || {}, errors = {};
    if (!validKey(scope, key)) return { ok: false, periods: periods, errors: { key: "That period isn't valid." } };
    const blank = { id: periodId(scope, key), scope: scope, key: String(key), revenueTarget: null, budget: null };
    if (scope === "month") { blank.revenue = null; blank.spend = null; } else { blank.hiresPlanned = null; blank.hiresMade = null; blank.hiringNote = ""; }
    const cur = periodOf(periods, scope, key) || blank;
    const next = Object.assign({}, cur);
    PERIOD_AMOUNTS[scope].forEach(function (f) {
      if (!(f in p)) return;
      const v = amount(p[f]);
      if (v === undefined) errors[f] = "Enter an amount (0 or more), or leave it empty."; else next[f] = v;
    });
    if (scope !== "month") {
      ["hiresPlanned", "hiresMade"].forEach(function (f) {
        if (!(f in p)) return;
        if (p[f] === "" || p[f] === null) { next[f] = null; return; }
        const v = intIn(p[f], 0, HIRES_MAX);
        if (v === null) errors[f] = "Enter a whole number (0 or more), or leave it empty."; else next[f] = v;
      });
      if ("hiringNote" in p) {
        const t = text(p.hiringNote, 500);
        next.hiringNote = t;
      }
    }
    if (Object.keys(errors).length) return { ok: false, periods: periods, errors: errors };
    next.updatedAt = c.now; delete next.deletedAt;
    const id = next.id, had = (periods || []).some(function (r) { return r && r.id === id; });
    return { ok: true, periods: had ? periods.map(function (r) { return r && r.id === id ? next : r; }) : (periods || []).concat([next]), period: next };
  }
  function periodMonths(scope, key) {
    if (scope === "month") return [key];
    if (scope === "quarter") return quarterMonths(Number(String(key).slice(0, 4)), Number(String(key).slice(6)));
    return yearMonths(Number(key));
  }
  // What the months in a period add up to. Revenue by metric: "sales" adds the months up; "mrr" is the latest month entered.
  function monthTotals(periods, months, metric) {
    let spend = null, revenue = null, lastRev = null, targets = null;
    months.forEach(function (m) {
      const p = periodOf(periods, "month", m);
      if (!p) return;
      if (p.spend !== null && p.spend !== undefined) spend = (spend || 0) + p.spend;
      if (p.revenue !== null && p.revenue !== undefined) { revenue = (revenue || 0) + p.revenue; lastRev = p.revenue; }
      if (p.revenueTarget !== null && p.revenueTarget !== undefined) targets = (targets || 0) + p.revenueTarget;
    });
    return { revenue: metric === "mrr" ? lastRev : revenue, spend: spend, monthTargets: targets };
  }
  // Everything the screens show about one year, quarter or month, from what was typed in.
  function periodSummary(periods, scope, key, metric) {
    const rec = periodOf(periods, scope, key) || {};
    const t = monthTotals(periods, periodMonths(scope, key), metric);
    let childTargets = null;
    if (scope === "year") {
      const y = Number(key), kids = [1, 2, 3, 4].map(function (q) { const r = periodOf(periods, "quarter", quarterKey(y, q)); return r && r.revenueTarget !== null && r.revenueTarget !== undefined ? r.revenueTarget : null; });
      if (kids.some(function (v) { return v !== null; })) childTargets = kids.reduce(function (s, v) { return s + (v || 0); }, 0);
    } else if (scope === "quarter") childTargets = t.monthTargets;
    const target = rec.revenueTarget === undefined ? null : rec.revenueTarget, budget = rec.budget === undefined ? null : rec.budget;
    return {
      scope: scope, key: String(key), revenueTarget: target, revenueActual: t.revenue, revenuePct: target && t.revenue !== null ? Math.round(100 * t.revenue / target) : null,
      budget: budget, spendActual: t.spend, spendPct: budget && t.spend !== null ? Math.round(100 * t.spend / budget) : null,
      overBudget: budget !== null && t.spend !== null && t.spend > budget,
      hiresPlanned: rec.hiresPlanned === undefined ? null : rec.hiresPlanned, hiresMade: rec.hiresMade === undefined ? null : rec.hiresMade, hiringNote: rec.hiringNote || "",
      childTargets: childTargets, childTargetsDiffer: childTargets !== null && target !== null && Math.round(childTargets) !== Math.round(target),
      monthsEntered: periodMonths(scope, key).filter(function (m) { const r = periodOf(periods, "month", m); return r && (r.revenue !== null && r.revenue !== undefined || r.spend !== null && r.spend !== undefined); }).length,
      metric: metric === "mrr" ? "mrr" : "sales"
    };
  }
  function purgePeriods(periods) {
    return (Array.isArray(periods) ? periods : []).filter(function (p) {
      if (!isObj(p)) return true;
      return ["revenueTarget", "budget", "revenue", "spend", "hiresPlanned", "hiresMade"].some(function (f) { return p[f] !== null && p[f] !== undefined; }) || !!p.hiringNote;
    });
  }

  /* ---------------- links between tasks and nodes ---------------- */
  function linkOf(links, taskId) { return live(links).filter(function (l) { return l.id === taskId; })[0] || null; }
  // Links a task to a node (or, with nodeId "", unlinks it). The task itself is never touched.
  function setLink(links, taskId, nodeId, ctx) {
    const c = ctxOf(ctx);
    if (typeof taskId !== "string" || !taskId) return { ok: false, links: links };
    const cur = (links || []).filter(function (l) { return l && l.id === taskId; })[0] || null;
    if (nodeId && c.nodes && !byId(c.nodes, nodeId)) return { ok: false, links: links, error: "That item isn't there any more." };
    if (!cur) {
      if (!nodeId) return { ok: true, links: links };
      const rec = { id: taskId, nodeId: nodeId, estMin: 0, createdAt: c.now, updatedAt: c.now };
      return { ok: true, links: (links || []).concat([rec]), link: rec };
    }
    if (!nodeId && !cur.estMin) {
      if (cur.deletedAt) return { ok: true, links: links };
      return { ok: true, links: links.map(function (l) { return l === cur ? tombstone(l, c.now) : l; }) };
    }
    const next = restoreRec(Object.assign({}, cur, { nodeId: nodeId || "" }), c.now);
    return { ok: true, links: links.map(function (l) { return l === cur ? next : l; }), link: next };
  }
  function setEstimate(links, taskId, minutes, ctx) {
    const c = ctxOf(ctx), m = minutes === "" || minutes === null || minutes === undefined ? 0 : intIn(minutes, 0, 1440);
    if (m === null) return { ok: false, links: links, error: "Enter whole minutes (0 to 1440)." };
    const cur = (links || []).filter(function (l) { return l && l.id === taskId; })[0] || null;
    if (!cur) {
      if (!m) return { ok: true, links: links };
      const rec = { id: taskId, nodeId: "", estMin: m, createdAt: c.now, updatedAt: c.now };
      return { ok: true, links: (links || []).concat([rec]), link: rec };
    }
    if (!m && !cur.nodeId) return { ok: true, links: links.map(function (l) { return l === cur ? tombstone(l, c.now) : l; }) };
    const next = restoreRec(Object.assign({}, cur, { estMin: m }), c.now);
    return { ok: true, links: links.map(function (l) { return l === cur ? next : l; }), link: next };
  }
  // Links belonging to tasks that no longer exist are dropped once they are 30 days old (a task may simply not have synced yet).
  function purgeLinks(links, taskIds, now) {
    const have = {}; (taskIds || []).forEach(function (id) { have[id] = true; });
    const cutoff = now - TOMBSTONE_DAYS * 86400000;
    return purge(links, now).filter(function (l) { return !(isObj(l) && !have[l.id] && (Number(l.updatedAt) || 0) < cutoff); });
  }

  /* ---------------- the model: progress, health, roll-ups ---------------- */
  // data: { nodes, links, tasks, periods, settings, goals, today }. Everything is worked out from these, never stored.
  function model(data) {
    const d = data || {};
    const s = settings(d.settings, d.today), today = isDate(d.today) ? d.today : "";
    const nodes = liveNodes(d.nodes), tasks = (Array.isArray(d.tasks) ? d.tasks : []).filter(function (t) { return isObj(t) && typeof t.id === "string"; });
    const goals = Array.isArray(d.goals) ? d.goals : [];
    const taskById = {}; tasks.forEach(function (t) { taskById[t.id] = t; });
    const nodeById = {}; nodes.forEach(function (n) { nodeById[n.id] = n; });
    const memo = {};

    function sort(list) { return list.slice().sort(function (a, b) { return (a.order - b.order) || (a.createdAt - b.createdAt); }); }
    // A parent that has been deleted (or never existed) means "not linked": children keep their own place in time.
    function parentOf(n) { const p = n.parentId ? nodeById[n.parentId] : null; return p && p.id !== n.id && p.type !== "milestone" ? p : null; }
    const kids = {};
    nodes.forEach(function (n) { const p = parentOf(n); if (p) (kids[p.id] = kids[p.id] || []).push(n); });
    function children(id) { return sort(kids[id] || []); }
    // The node a task counts under: its link, if that node still exists.
    const tasksAt = {};
    live(d.links).forEach(function (l) {
      if (l.nodeId && nodeById[l.nodeId] && taskById[l.id]) (tasksAt[l.nodeId] = tasksAt[l.nodeId] || []).push(taskById[l.id]);
    });
    function nodeOfTask(taskId) {
      const l = linkOf(d.links, taskId);
      return l && l.nodeId && nodeById[l.nodeId] ? nodeById[l.nodeId] : null;
    }
    function tasksDirect(id) { return (tasksAt[id] || []).slice(); }

    // Every item that counts toward this node's task progress, each once: tasks, and milestones with no tasks of their own.
    function units(id) {
      const out = {}, seen = {};
      (function walk(nid) {
        if (seen[nid]) return;
        seen[nid] = true;
        const n = nodeById[nid];
        (tasksAt[nid] || []).forEach(function (t) { out["t:" + t.id] = !!t.completed; });
        children(nid).forEach(function (k) { if (k.status !== "dropped") walk(k.id); });
        void n;
      })(id);
      const hasTasks = Object.keys(out).length > 0;
      const root = nodeById[id];
      // a tick-off milestone: counted when there are no tasks under it, and it is measured by tasks
      (function walkMs(nid, seenM) {
        if (seenM[nid]) return;
        seenM[nid] = true;
        const n = nodeById[nid];
        if (n.type === "milestone" && n.measure === "tasks" && n.status !== "dropped" && !(tasksAt[nid] || []).length) out["m:" + nid] = !!n.doneAt;
        children(nid).forEach(function (k) { if (k.status !== "dropped") walkMs(k.id, seenM); });
      })(id, {});
      return { map: out, hasTasks: hasTasks, root: root };
    }

    function window(n) {
      if (n.type === "objective") return { months: yearMonths(n.year), range: yearRange(n.year) };
      if (n.type === "priority") return { months: quarterMonths(n.year, n.quarter), range: quarterRange(n.year, n.quarter) };
      return { months: [n.month], range: { start: monthStart(n.month), end: monthEnd(n.month) } };
    }
    function goalFor(id) { return goals.filter(function (g) { return g && g.id === id; })[0] || null; }
    function goalPct(g) {
      if (!g) return null;
      if (g.completed) return 100;
      if (g.hasNumericTarget && Number(g.targetValue) > 0) return Math.max(0, Math.min(100, Math.round(100 * (Number(g.currentValue) || 0) / Number(g.targetValue))));
      const m = Number(g.manualProgressPct);
      return Number.isFinite(m) ? Math.max(0, Math.min(100, Math.round(m))) : null;
    }

    function progress(id) {
      if (memo[id]) return memo[id];
      const n = nodeById[id];
      if (!n) return null;
      const w = window(n);
      const out = { id: id, measure: n.measure, pct: null, done: 0, total: 0, actual: null, target: n.target, unit: n.unit, complete: false, over: false, note: "", manual: false };
      if (n.measure === "tasks") {
        const u = units(id), keys = Object.keys(u.map);
        out.total = keys.length;
        out.done = keys.filter(function (k) { return u.map[k]; }).length;
        const nTasks = keys.filter(function (k) { return k.charAt(0) === "t"; }).length, nMiles = out.total - nTasks;
        if (out.total) out.pct = Math.round(100 * out.done / out.total);
        else if (n.doneAt) { out.pct = 100; out.manual = true; }
        out.complete = out.pct === 100;
        if (!out.total) out.note = n.doneAt ? "Marked done" : "No tasks yet";
        else if (n.type === "milestone" && !nTasks) out.note = n.doneAt ? "Marked done" : "Not ticked off yet";
        else out.note = out.done + " of " + out.total + (nMiles ? (nTasks ? " items" : (out.total === 1 ? " milestone" : " milestones")) : (out.total === 1 ? " task" : " tasks")) + " done";
      } else if (n.measure === "revenue") {
        const t = monthTotals(d.periods, w.months, s.revenueMetric);
        out.actual = t.revenue; out.target = n.target;
        if (t.revenue !== null && n.target) out.pct = Math.round(100 * t.revenue / n.target);
        out.complete = out.pct !== null && out.pct >= 100;
        out.note = t.revenue === null ? "No revenue entered yet" : "$" + fmt(t.revenue) + " of $" + fmt(n.target) + (s.revenueMetric === "mrr" ? " MRR" : " in sales");
      } else if (n.measure === "budget") {
        const t = monthTotals(d.periods, w.months, s.revenueMetric);
        out.actual = t.spend; out.target = n.target;
        if (t.spend !== null && n.target) out.pct = Math.round(100 * t.spend / n.target);
        out.over = t.spend !== null && n.target > 0 && t.spend > n.target;
        out.note = t.spend === null ? "No spending entered yet" : "$" + fmt(t.spend) + " spent of $" + fmt(n.target) + (out.over ? " (over)" : "");
      } else if (n.measure === "number") {
        out.actual = n.current === null ? 0 : n.current; out.target = n.target;
        if (n.target) out.pct = Math.round(100 * out.actual / n.target);
        out.complete = out.pct !== null && out.pct >= 100;
        out.note = fmt(out.actual) + " of " + fmt(n.target) + (n.unit ? " " + n.unit : "");
      } else if (n.measure === "goal") {
        const g = goalFor(n.goalId);
        out.pct = goalPct(g);
        out.complete = out.pct === 100;
        out.note = !g ? "That goal was deleted" : (out.pct === null ? "No progress set on this goal" : "Goal: " + g.name);
      }
      memo[id] = out;
      return out;
    }

    // The deadline everything is measured against: the one you set, else the end of its month / quarter / year.
    function deadline(n) { return n.due || window(n).range.end; }
    function startOf(n) { return window(n).range.start; }

    function health(id) {
      const n = nodeById[id];
      if (!n) return "";
      const p = progress(id);
      if (n.status === "dropped") return "dropped";
      if (n.status === "paused") return "paused";
      if (p.complete) return "done";
      if (p.over) return "over";
      const end = deadline(n), start = startOf(n);
      if (today && end < today && n.measure !== "budget") return "overdue";
      if (today && today < start) return "upcoming";
      if (p.pct === null) return "nodata";
      const span = Math.max(1, diffDays(start, end));
      const elapsed = today ? Math.max(0, Math.min(1, diffDays(start, today) / span)) : 0, expected = elapsed * 100;
      if (n.measure === "budget") return p.pct <= expected + 10 ? "ontrack" : p.pct <= expected + 25 ? "atrisk" : "behind";
      return p.pct >= expected - 10 ? "ontrack" : p.pct >= expected - 25 ? "atrisk" : "behind";
    }
    function overdue(id) { return health(id) === "overdue"; }
    // A node can be ticked off by hand only when there are no tasks that would say otherwise.
    function canMarkDone(id) {
      const n = nodeById[id];
      if (!n) return false;
      if (n.measure !== "tasks") return false;
      return !units(id).hasTasks && !children(id).some(function (k) { return k.status !== "dropped" && units(k.id).hasTasks; });
    }

    function all(type) { return sort(nodes.filter(function (n) { return !type || n.type === type; })); }
    function objectivesOf(year) { return sort(nodes.filter(function (n) { return n.type === "objective" && n.year === year; })); }
    function prioritiesOf(year, quarter) { return sort(nodes.filter(function (n) { return n.type === "priority" && n.year === year && n.quarter === quarter; })); }
    function milestonesOf(parentId) { return children(parentId).filter(function (k) { return k.type === "milestone"; }); }
    function milestonesIn(month) { return sort(nodes.filter(function (n) { return n.type === "milestone" && n.month === month; })); }
    function ancestors(id) {
      const out = []; let n = nodeById[id], guard = 0;
      while (n && guard++ < 6) { const p = parentOf(n); if (!p) break; out.push(p); n = p; }
      return out;
    }
    function overdueMilestones() { return all("milestone").filter(function (n) { return health(n.id) === "overdue"; }); }
    function periods(scope, key) { return periodSummary(d.periods, scope, key, s.revenueMetric); }

    return {
      settings: s, today: today, node: function (id) { return nodeById[id] || null; }, all: all, children: children, parentOf: parentOf,
      objectivesOf: objectivesOf, prioritiesOf: prioritiesOf, milestonesOf: milestonesOf, milestonesIn: milestonesIn, ancestors: ancestors,
      nodeOfTask: nodeOfTask, tasksDirect: tasksDirect, units: units, progress: progress, health: health, overdue: overdue, deadline: deadline,
      canMarkDone: canMarkDone, overdueMilestones: overdueMilestones, periods: periods, window: window, goalFor: goalFor, goalPct: goalPct,
      // the path from the top, e.g. "2026 objective > Q2 priority > Jun milestone"
      path: function (id) { return ancestors(id).reverse().map(function (n) { return n.title; }); }
    };
  }

  function fmt(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  const HEALTH_LABEL = { done: "Done", ontrack: "On track", atrisk: "At risk", behind: "Behind", overdue: "Overdue", over: "Over budget", upcoming: "Not started", paused: "Paused", dropped: "Dropped", nodata: "No data yet" };

  return {
    KEYS: KEYS, TYPES: TYPES, TYPE_LABEL: TYPE_LABEL, MEASURES: MEASURES, STATUSES: STATUSES, MAX_PER_SLOT: MAX_PER_SLOT, HEALTH_LABEL: HEALTH_LABEL,
    TITLE_MAX: TITLE_MAX, NOTES_MAX: NOTES_MAX, TOMBSTONE_DAYS: TOMBSTONE_DAYS,
    isDate: isDate, isMonth: isMonth, addDays: addDays, diffDays: diffDays, daysInMonth: daysInMonth, monthKey: monthKey, monthStart: monthStart, monthEnd: monthEnd,
    monthOfDate: monthOfDate, quarterOfMonth: quarterOfMonth, quarterOfDate: quarterOfDate, quarterKey: quarterKey, quarterMonths: quarterMonths, yearMonths: yearMonths,
    quarterRange: quarterRange, yearRange: yearRange, monthName: monthName, yearOf: yearOf,
    amount: amount, fmt: fmt, live: live, stamp: stamp, tombstone: tombstone, purge: purge,
    settings: settings, planYears: planYears, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    readNodes: readNodes, readLinks: readLinks, liveNodes: liveNodes, byId: byId,
    checkNode: checkNode, addNode: addNode, editNode: editNode, removeNode: removeNode, restoreNode: restoreNode, setDoneAt: setDoneAt, setCurrent: setCurrent, setStatus: setStatus, move: move,
    periodId: periodId, periodOf: periodOf, setPeriod: setPeriod, periodMonths: periodMonths, monthTotals: monthTotals, periodSummary: periodSummary, purgePeriods: purgePeriods,
    linkOf: linkOf, setLink: setLink, setEstimate: setEstimate, purgeLinks: purgeLinks,
    model: model
  };
});
