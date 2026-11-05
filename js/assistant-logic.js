/* ==========================================================================
   JARVIS — Planning assistant: the rules (pure functions, no page access, so they can be tested outside the browser).

   This is a set of written rules, not an AI model: nothing is sent anywhere, nothing costs anything, and the same
   calendar always gives the same answer. Every suggestion says why it was made.

   The one thing that matters most: the assistant only PROPOSES. Every function here that looks at the calendar
   returns proposals (add / move / delete) and changes nothing. A change happens only in apply* / applyTasks, and
   those do nothing for a proposal unless its id is in the list of ids you approved. Passing no ids changes nothing.

   What it uses (all editable, see Calendar.settings().plan): the hours it may plan in, the days, the length of one
   work session, how many tasks a day it will pile on when catching up, and the minutes a week you want for each
   focus area. It knows nothing about you beyond what is in your calendar and tasks.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./calendar-logic.js"));
  else root.JarvisAssistantLogic = factory(root.JarvisCalendarLogic);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const STEP = 15, MIN_BLOCK = 30, HORIZON_DAYS = 14, MAX_SPAN = 60, LOOKBACK_DAYS = 30, MAX_PROPOSALS = 60;
  const FOCUS = C.FOCUS_AREAS;

  /* ---------------- small helpers ---------------- */

  function ceilStep(m) { return Math.ceil(m / STEP) * STEP; }
  // Cuts `total` minutes into sessions of at most `max`, as even as quarter hours allow, none shorter than MIN_BLOCK.
  // The sizes add up to the total rounded up to a quarter hour, never more.
  function evenSizes(total, max) {
    const units = Math.ceil(total / STEP);
    let n = Math.max(1, Math.ceil(units * STEP / Math.max(max, MIN_BLOCK)));
    n = Math.max(1, Math.min(n, Math.floor(units * STEP / MIN_BLOCK)));
    const base = Math.floor(units / n), extra = units % n, out = [];
    for (let k = 0; k < n; k++) out.push((base + (k < extra ? 1 : 0)) * STEP);
    return out;
  }
  function prioRank(p) { p = String(p || "").toLowerCase(); return p === "high" ? 3 : p === "low" ? 1 : 2; }
  function mins(t) { return C.minutesOf(t); }
  function str(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim(); }
  function dayLabel(date) { return C.fmtDate(date, { weekday: "short", month: "short", day: "numeric" }); }
  function clock(min) { return C.timeLabel(C.timeOf(min)); }
  function whenLabel(date, start, end) { return dayLabel(date) + " · " + clock(start) + (end !== undefined && end !== null ? " – " + clock(end) : ""); }
  function hoursLabel(m) { const h = m / 60; return (Number.isInteger(h) ? h : Math.round(h * 10) / 10) + " h"; }
  function makeIds(prefix) { let n = 0; return function () { n += 1; return (prefix || "p") + n; }; }
  function mergeIntervals(list) {
    const s = list.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }), out = [];
    s.forEach(function (iv) { const last = out[out.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else out.push([iv[0], iv[1]]); });
    return out;
  }
  function cleanPlan(plan) { return C.planSettings(plan); }
  function nowOf(now) { return now && C.isDate(now.date) ? { date: now.date, min: Number.isFinite(now.min) ? now.min : 0 } : { date: "0000-01-01", min: 0 }; }

  /* ---------------- the board: what is busy, what is free ---------------- */

  // Timed things that take up time on a date (in the view zone): events with a length, and timed tasks (drawn as 30 minutes).
  function busyOf(items, date, skip) {
    const out = [];
    (items || []).forEach(function (it) {
      if (!it || it.allDay || it.completed || it.startMin === null || it.startMin === undefined) return;
      if (skip && skip[it.key]) return;
      if (it.date > date || (it.endDate || it.date) < date) return;
      let s, e;
      if (it.source === "task") { s = it.startMin; e = it.endMin > s ? it.endMin : s + 30; }
      else if (it.source === "event" && !it.point) { s = it.date < date ? 0 : it.startMin; e = (it.endDate || it.date) > date ? 1440 : it.endMin; }
      else return;
      if (e > s) out.push([s, e]);
    });
    return out;
  }

  // A working copy of the day-by-day free time. Taking a slot here never touches the real calendar.
  function board(items, plan, now) {
    const p = cleanPlan(plan), n = nowOf(now), extra = {}, skip = {}, cache = {};
    const lo = mins(p.start), hi = mins(p.end);
    function busy(date) {
      if (!cache[date]) cache[date] = mergeIntervals(busyOf(items, date, skip).concat(extra[date] || []));
      return cache[date];
    }
    // Free stretches of at least `minutes` inside the planning hours (and after now, today). Starts are on the quarter hour.
    function free(date, minutes, opts) {
      if (date < n.date) return [];
      if (!(opts && opts.anyDay) && p.days.indexOf(C.weekday(date)) === -1) return [];
      let from = lo; if (date === n.date) from = Math.max(from, ceilStep(n.min));
      const out = []; let cursor = from;
      busy(date).concat([[hi, hi]]).forEach(function (iv) {
        const gapEnd = Math.min(iv[0], hi), gapStart = ceilStep(cursor);
        if (gapEnd - gapStart >= minutes) out.push({ start: gapStart, end: gapEnd });
        cursor = Math.max(cursor, iv[1]);
      });
      return out;
    }
    function freeTotal(date) { return free(date, STEP).reduce(function (t, g) { return t + g.end - g.start; }, 0); }
    function take(date, start, end) { (extra[date] = extra[date] || []).push([start, end]); delete cache[date]; }
    function release(key) { skip[key] = true; Object.keys(cache).forEach(function (k) { delete cache[k]; }); }
    return { plan: p, now: n, free: free, freeTotal: freeTotal, take: take, release: release };
  }
  function planDates(from, to, b) {
    const out = [];
    for (let d = from, k = 0; d <= to && k <= MAX_SPAN; d = C.addDays(d, 1), k++) if (d >= b.now.date && b.plan.days.indexOf(C.weekday(d)) !== -1) out.push(d);
    return out;
  }

  /* ---------------- find a time ---------------- */

  // The earliest openings for something that takes `minutes`. At most two a day so the choices are spread out.
  // -> { ok, slots: [{ date, start, end, label, reason }] } | { ok:false, error }
  function suggestTimes(items, o) {
    const minutes = Number(o && o.minutes);
    if (!Number.isInteger(minutes) || minutes < STEP || minutes > 480) return { ok: false, error: "Say how long it takes, from 15 minutes to 8 hours." };
    if (!C.isDate(o.from) || !C.isDate(o.to) || o.to < o.from) return { ok: false, error: "Pick the days to look in." };
    if (C.diffDays(o.from, o.to) > MAX_SPAN) return { ok: false, error: "Look at " + MAX_SPAN + " days or fewer at a time." };
    const b = board(items, o.plan, o.now), limit = Math.min(Math.max(Number(o.limit) || 6, 1), 12), slots = [];
    for (let d = o.from; d <= o.to && slots.length < limit; d = C.addDays(d, 1)) {
      b.free(d, minutes).slice(0, 2).forEach(function (g) {
        if (slots.length >= limit) return;
        slots.push({ date: d, start: g.start, end: g.start + minutes, label: whenLabel(d, g.start, g.start + minutes), reason: "Free from " + clock(g.start) + " to " + clock(g.end) + "." });
      });
    }
    return { ok: true, slots: slots, planHours: clock(mins(b.plan.start)) + " – " + clock(mins(b.plan.end)) };
  }

  /* ---------------- proposals ---------------- */

  function addProposal(id, group, title, date, start, end, fields, reason) {
    const input = Object.assign({ title: title.slice(0, C.TITLE_MAX), kind: "block", category: "work", priority: "medium", date: date, time: C.timeOf(start), endDate: date, endTime: C.timeOf(end) }, fields || {});
    return { id: id, kind: "add", group: group, title: input.title, detail: whenLabel(date, start, end), reason: reason, add: { input: input } };
  }
  function moveProposal(id, group, source, it, from, to, detail, reason) {
    return { id: id, kind: "move", group: group, title: it.title, detail: detail, reason: reason, move: { source: source, id: it.id, occDate: it.occDate || from.date, from: from, to: to } };
  }

  /* ---------------- clashes ---------------- */

  // Two timed things that overlap: move the lower-priority one (the later one if they match) to the nearest free time.
  // Repeating events are never moved by the assistant. -> { proposals, unfixed: [{ a, b, why }] }
  function fixClashes(items, o) {
    const b = board(items, o && o.plan, o && o.now), id = makeIds((o && o.idPrefix) || "fix"), proposals = [], unfixed = [], moved = {};
    const pairs = C.findConflicts(items || []);
    const pos = function (it) { return moved[it.key] || { date: it.date, start: it.startMin, end: it.endMin }; };
    pairs.forEach(function (pr) {
      const A = pr.a, B = pr.b, pa = pos(A), pb = pos(B);
      const label = A.title + " and " + B.title;
      if (!(pa.date === pb.date && pa.start < pb.end && pb.start < pa.end)) return;       // already settled by an earlier move
      if (A.date !== A.endDate || B.date !== B.endDate) { unfixed.push({ a: A, b: B, why: "One of them runs past midnight, so I left it for you." }); return; }
      const movable = [A, B].filter(function (x) { return !x.recurring && x.date === x.endDate; });
      if (!movable.length) { unfixed.push({ a: A, b: B, why: "Both repeat. I don't move repeating events; change one yourself." }); return; }
      let mv = movable[0];
      if (movable.length === 2) mv = prioRank(A.priority) < prioRank(B.priority) ? A : prioRank(B.priority) < prioRank(A.priority) ? B : (A.startMs <= B.startMs ? B : A);
      const other = mv === A ? B : A, len = pos(mv).end - pos(mv).start, from = pos(mv);
      b.release(mv.key);
      let dest = null;
      for (let d = from.date, k = 0; d <= C.addDays(from.date, HORIZON_DAYS) && !dest; d = C.addDays(d, 1), k++) {
        const gaps = b.free(d, len);
        if (!gaps.length) continue;
        if (k === 0) { gaps.sort(function (x, y) { return Math.abs(x.start - from.start) - Math.abs(y.start - from.start); }); }
        dest = { date: d, start: gaps[0].start, end: gaps[0].start + len };
      }
      if (!dest) { unfixed.push({ a: A, b: B, why: "I couldn't find a free " + len + "-minute stretch in the next " + HORIZON_DAYS + " days inside your planning hours." }); busyBack(b, mv, from); return; }
      b.take(dest.date, dest.start, dest.end);
      moved[mv.key] = dest;
      const why = mv.recurring ? "" : "It overlaps “" + other.title + "” for " + pr.minutes + " minutes. " + (movable.length === 2 && prioRank(A.priority) !== prioRank(B.priority) ? "It's the lower priority of the two." : movable.length === 2 ? "They have the same priority, so the later one moves." : "The other one repeats, so this one moves.");
      proposals.push(moveProposal(id(), "clash", "event", mv, { date: from.date, time: C.timeOf(from.start) }, { date: dest.date, time: C.timeOf(dest.start) },
        from.date === dest.date ? dayLabel(from.date) + " · " + clock(from.start) + " → " + clock(dest.start) + " – " + clock(dest.end) : dayLabel(from.date) + " " + clock(from.start) + " → " + whenLabel(dest.date, dest.start, dest.end), why));
    });
    return { proposals: proposals, unfixed: unfixed, count: pairs.length };
  }
  function busyBack(b, it, pos) { b.take(pos.date, pos.start, pos.end); }

  /* ---------------- focus time ---------------- */

  function focusMinutes(items, area, from, to) {
    let t = 0;
    (items || []).forEach(function (it) {
      if (it.source !== "event" || !it.linked || it.linked.type !== "assistant" || it.linked.id !== area || it.allDay || it.date !== it.endDate) return;
      if (it.date >= from && it.date <= to) t += Math.max(0, it.endMin - it.startMin);
    });
    return t;
  }

  // Time blocks toward the weekly minutes you set for each focus area. Only blocks the assistant planned count toward
  // the goal, so it never claims credit for something it can't tell is the same thing.
  // -> { proposals, unplaced: [{ area, label, minutes }], status: [{ area, label, goal, planned }] }
  function focusBlocks(items, o) {
    const b = board(items, o.plan, o.now), id = makeIds((o && o.idPrefix) || "foc"), proposals = [], unplaced = [], status = [];
    const from = o.weekFrom, to = C.addDays(from, 6), days = planDates(from, to, b);
    const onDay = {};   // area -> { date: true } so one area doesn't take the whole week in one day
    (items || []).forEach(function (it) { if (it.source === "event" && it.linked && it.linked.type === "assistant") (onDay[it.linked.id] = onDay[it.linked.id] || {})[it.date] = true; });
    FOCUS.forEach(function (area) {
      const goal = b.plan.goals[area.id] || 0, have = focusMinutes(items, area.id, from, to);
      status.push({ area: area.id, label: area.label, goal: goal, planned: have });
      if (!goal) return;
      const short = goal - have;
      if (short < MIN_BLOCK) return;
      const sizes = evenSizes(short, b.plan.session), n = sizes.length;
      for (let i = 0; i < n; i++) {
        const size = sizes[i];
        const spread = days.filter(function (d) { return !(onDay[area.id] && onDay[area.id][d]); });
        const pools = [spread, days];
        let placed = false;
        for (let p = 0; p < pools.length && !placed; p++) {
          const order = pools[p].filter(function (d) { return b.free(d, size).length; }).sort(function (x, y) { return b.freeTotal(y) - b.freeTotal(x) || (x < y ? -1 : 1); });
          if (!order.length) continue;
          const d = order[0], g = b.free(d, size)[0];
          b.take(d, g.start, g.start + size); (onDay[area.id] = onDay[area.id] || {})[d] = true; placed = true;
          proposals.push(addProposal(id(), "focus", "Focus: " + area.label, d, g.start, g.start + size, { category: area.category, linked: { type: "assistant", id: area.id }, description: "Planned by the planning assistant toward " + hoursLabel(goal) + " of " + area.label.toLowerCase() + " this week." },
            "You asked for " + hoursLabel(goal) + " of " + area.label.toLowerCase() + " a week and " + hoursLabel(have) + " " + (have === 1 ? "is" : "are") + " planned. This day had the most open time."));
        }
        if (!placed) { unplaced.push({ area: area.id, label: area.label, minutes: sizes.slice(i).reduce(function (t, x) { return t + x; }, 0) }); break; }
      }
    });
    return { proposals: proposals.slice(0, MAX_PROPOSALS), unplaced: unplaced, status: status };
  }

  /* ---------------- catching up on unfinished tasks ---------------- */

  // Unfinished tasks from the past, moved to the next days with room: highest priority first, then the oldest, with
  // at most plan.perDay tasks on a day (counting what is already there).
  // tasks: your To-Do/Habits tasks. bizTasks: Business tasks (their deadline is what moves). items: calendar items (Task kind).
  // -> { proposals, unplaced: n, older: n }
  function catchUp(o) {
    const p = cleanPlan(o.plan), n = nowOf(o.now), id = makeIds((o && o.idPrefix) || "cu");
    const tasks = Array.isArray(o.tasks) ? o.tasks : [], biz = Array.isArray(o.bizTasks) ? o.bizTasks : [], items = Array.isArray(o.items) ? o.items : [];
    const cutoff = C.addDays(n.date, -LOOKBACK_DAYS), late = [], count = {};
    const bump = function (d) { if (C.isDate(d)) count[d] = (count[d] || 0) + 1; };
    let older = 0;
    const consider = function (entry) { if (entry.date >= n.date) { bump(entry.date); return; } if (entry.date < cutoff) { older++; return; } late.push(entry); };
    tasks.forEach(function (t) { if (t && !t.completed && typeof t.id === "string" && C.isDate(t.date) && str(t.text)) consider({ source: "task", id: t.id, title: str(t.text), date: t.date, prio: prioRank(t.priority), occDate: t.date }); });
    biz.forEach(function (t) { if (t && !t.completed && typeof t.id === "string" && C.isDate(t.deadline) && str(t.text)) consider({ source: "bizTask", id: t.id, title: str(t.text), date: t.deadline, prio: prioRank(t.priority), occDate: t.deadline }); });
    items.forEach(function (it) { if (it && it.source === "event" && it.kind === "task" && !it.completed && !it.recurring && C.isDate(it.date)) consider({ source: "event", id: it.id, title: it.title, date: it.date, time: it.allDay ? "" : it.time, prio: prioRank(it.priority), occDate: it.occDate }); });
    late.sort(function (a, b) { return b.prio - a.prio || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.title < b.title ? -1 : 1); });
    const b = board([], p, n), room = [];
    for (let d = n.date, k = 0; k <= HORIZON_DAYS; d = C.addDays(d, 1), k++) {
      if (p.days.indexOf(C.weekday(d)) === -1) continue;
      if (d === n.date && n.min > mins(p.end) - 60) continue;      // too late today to start something new
      room.push({ date: d, left: p.perDay - (count[d] || 0) });
    }
    const proposals = []; let unplaced = 0;
    late.forEach(function (e) {
      const slot = room.filter(function (r) { return r.left > 0; })[0];
      if (!slot) { unplaced++; return; }
      slot.left--;
      const days = C.diffDays(e.date, n.date), src = e.source;
      proposals.push(moveProposal(id(), "catchup", src, { id: e.id, title: e.title, occDate: e.occDate }, e.time ? { date: e.date, time: e.time } : { date: e.date }, e.time ? { date: slot.date, time: e.time } : { date: slot.date },
        dayLabel(e.date) + " → " + dayLabel(slot.date), (src === "bizTask" ? "Business task, due " + days + (days === 1 ? " day" : " days") + " ago. The due date moves." : "Not done, " + days + (days === 1 ? " day" : " days") + " late.") + (e.prio === 3 ? " High priority goes first." : "")));
    });
    return { proposals: proposals.slice(0, MAX_PROPOSALS), unplaced: unplaced, older: older, total: late.length };
  }

  /* ---------------- splitting a big project ---------------- */

  // A project of `minutes` total, finished by `deadline`, cut into even work sessions on days that have room.
  // Sessions are spaced out, so the last one lands before the deadline when there are enough days.
  // -> { ok, proposals, unplacedMinutes, sessions } | { ok:false, error }
  function splitProject(items, o) {
    const title = str(o && o.title);
    if (!title) return { ok: false, error: "Give the project a name." };
    const total = Number(o.minutes);
    if (!Number.isInteger(total) || total < MIN_BLOCK || total > 4800) return { ok: false, error: "Say how much work it is: 30 minutes to 80 hours." };
    if (!C.isDate(o.deadline)) return { ok: false, error: "Pick the deadline." };
    const b = board(items, o.plan, o.now), id = makeIds((o && o.idPrefix) || "prj");
    if (o.deadline < b.now.date) return { ok: false, error: "That deadline has already passed." };
    if (C.diffDays(b.now.date, o.deadline) > 366) return { ok: false, error: "Pick a deadline within a year." };
    const session = Math.min(Math.max(Number(o.session) || b.plan.session, MIN_BLOCK), 240);
    const sizes = evenSizes(total, session), n = sizes.length, big = sizes[0];
    const cat = C.CATEGORIES.some(function (c) { return c.value === o.category; }) ? o.category : "work";
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
    const days = []; for (let d = b.now.date, k = 0; d <= o.deadline && k <= 366; d = C.addDays(d, 1), k++) if (b.free(d, big).length) days.push(d);
    const picks = [];
    if (days.length >= n) for (let i = 0; i < n; i++) picks.push(days[Math.floor(i * days.length / n)]);
    else { days.forEach(function (d) { picks.push(d); }); }
    const placed = []; let next = 0;                                   // sizes are handed out in order, biggest first
    const place = function (d) { if (next >= n) return false; const size = sizes[next], g = b.free(d, size)[0]; if (!g) return false; b.take(d, g.start, g.start + size); placed.push({ d: d, start: g.start, size: size }); next++; return true; };
    picks.forEach(place);
    for (let pass = 0; next < n && pass < n; pass++) { let any = false; days.forEach(function (d) { if (next < n && place(d)) any = true; }); if (!any) break; }   // second sessions on days with room
    placed.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : x.start - y.start; });
    const out = placed.map(function (pr, i) {
      return addProposal(id(), "project", title + " (" + (i + 1) + "/" + n + ")", pr.d, pr.start, pr.start + pr.size, { category: cat, linked: { type: "assistant", id: "project:" + slug }, description: "Part " + (i + 1) + " of " + n + " for “" + title + "”, due " + dayLabel(o.deadline) + "." },
        "Session " + (i + 1) + " of " + n + " (" + pr.size + " minutes, " + hoursLabel(total) + " in all) before " + dayLabel(o.deadline) + ".");
    });
    return { ok: true, proposals: out, sessions: n, size: big, unplacedMinutes: sizes.slice(next).reduce(function (t, x) { return t + x; }, 0) };
  }

  /* ---------------- taking planned blocks back off ---------------- */

  // Blocks the assistant planned that are still ahead and not done. Only ever offers things it made itself.
  function clearPlanned(items, o) {
    const n = nowOf(o && o.now), id = makeIds((o && o.idPrefix) || "clr"), out = [];
    (items || []).forEach(function (it) {
      if (it.source !== "event" || !it.linked || it.linked.type !== "assistant" || it.completed || it.recurring) return;
      if (it.date < n.date || (it.date === n.date && !it.allDay && it.startMin !== null && it.startMin < n.min)) return;
      out.push({ id: id(), kind: "delete", group: "clear", title: it.title, detail: whenLabel(it.date, it.startMin, it.endMin), reason: "Planned earlier by the assistant and not done.", del: { id: it.id, occDate: it.occDate, linkedType: "assistant" } });
    });
    return { proposals: out.slice(0, MAX_PROPOSALS) };
  }

  /* ---------------- the numbers on the assistant's front page ---------------- */

  function overview(items, o) {
    const n = nowOf(o && o.now), tasks = o.tasks || [], biz = o.bizTasks || [];
    const clashes = C.findConflicts(items || []).length;
    const cutoff = C.addDays(n.date, -LOOKBACK_DAYS);
    const late = tasks.filter(function (t) { return t && !t.completed && C.isDate(t.date) && t.date < n.date && t.date >= cutoff; }).length
      + biz.filter(function (t) { return t && !t.completed && C.isDate(t.deadline) && t.deadline < n.date && t.deadline >= cutoff; }).length
      + (items || []).filter(function (it) { return it.source === "event" && it.kind === "task" && !it.completed && !it.recurring && it.date < n.date && it.date >= cutoff; }).length;
    const p = cleanPlan(o.plan), to = C.addDays(o.weekFrom, 6);
    const focus = FOCUS.filter(function (a) { return p.goals[a.id] > 0; }).map(function (a) { return { area: a.id, label: a.label, goal: p.goals[a.id], planned: focusMinutes(items, a.id, o.weekFrom, to) }; });
    return { clashes: clashes, late: late, focus: focus, anyGoal: focus.length > 0 };
  }

  /* ---------------- what the calendar would look like ---------------- */

  // A copy of the items as they would be if these proposals were applied, so the next suggestion (made in the same
  // sitting) works around them. Nothing real is touched and nothing is saved.
  function preview(items, proposals, zone) {
    const list = (items || []).slice();
    (proposals || []).forEach(function (p) {
      if (p.kind === "add" && p.add) {
        const i = p.add.input;
        list.push({ key: "pending:" + p.id, id: "pending:" + p.id, source: "event", kind: i.kind, title: i.title, category: i.category, priority: i.priority, recurring: false, linked: i.linked || null, completed: false, point: false, allDay: false,
          date: i.date, endDate: i.endDate || i.date, time: i.time, endTime: i.endTime, startMin: mins(i.time), endMin: mins(i.endTime), occDate: i.date,
          startMs: zone ? C.wallToInstant(i.date, i.time, zone) : null, endMs: zone ? C.wallToInstant(i.date, i.time, zone) + (mins(i.endTime) - mins(i.time)) * 60000 : null });
      } else if (p.kind === "move" && p.move && p.move.source === "event" && p.move.to.time) {
        for (let k = 0; k < list.length; k++) {
          const it = list[k];
          if (it.source === "event" && it.id === p.move.id && it.occDate === p.move.occDate && !it.allDay && it.startMin !== null) {
            const len = it.endMin - it.startMin, startMs = zone ? C.wallToInstant(p.move.to.date, p.move.to.time, zone) : it.startMs + ((C.diffDays(it.date, p.move.to.date)) * 1440 + (mins(p.move.to.time) - it.startMin)) * 60000;
            list[k] = Object.assign({}, it, { date: p.move.to.date, endDate: p.move.to.date, time: p.move.to.time, startMin: mins(p.move.to.time), endMin: mins(p.move.to.time) + len, endTime: C.timeOf(mins(p.move.to.time) + len), startMs: startMs, endMs: startMs + len * 60000 });
          }
        }
      } else if (p.kind === "delete" && p.del) {
        for (let k = list.length - 1; k >= 0; k--) if (list[k].source === "event" && list[k].id === p.del.id) list.splice(k, 1);
      }
    });
    return list;
  }

  /* ---------------- the approval gate ---------------- */

  // Only the proposals whose id you approved. No ids, or ids that match nothing, give an empty list.
  function select(proposals, approvedIds) {
    if (!Array.isArray(approvedIds) || !approvedIds.length) return [];
    const ok = {}; approvedIds.forEach(function (x) { if (typeof x === "string") ok[x] = true; });
    const seen = {};
    return (Array.isArray(proposals) ? proposals : []).filter(function (p) { if (!p || !ok[p.id] || seen[p.id]) return false; seen[p.id] = true; return true; });
  }

  function clashAt(events, ctx, date, time, minutes, exceptKey) {
    const startMs = C.wallToInstant(date, time, ctx.zone), endMs = startMs + minutes * 60000;
    const day = C.expand(events, C.addDays(date, -1), C.addDays(date, 1), ctx.zone);
    return C.conflictsWith(day, startMs, endMs, exceptKey);
  }

  // Calendar events: add / move / delete, for approved proposals only. Each one is checked against the calendar as it is
  // NOW (not as it was when proposed): a time that has been taken, or an event that has changed, is skipped and said so.
  // Proposals about tasks (move.source "task" / "bizTask") are not touched here; see applyTasks and the page.
  // -> { events, applied: [id], skipped: [{ id, error }], changed: boolean }
  function apply(events, proposals, approvedIds, ctx) {
    const chosen = select(proposals, approvedIds), applied = [], skipped = [];
    let cur = events;
    chosen.forEach(function (p) {
      if (p.kind === "add" && p.add) {
        const inp = p.add.input, len = mins(inp.endTime) - mins(inp.time);
        if (clashAt(cur, ctx, inp.date, inp.time, len).length) { skipped.push({ id: p.id, error: "That time is taken now." }); return; }
        const r = C.add(cur, inp, ctx);
        if (!r.ok) { skipped.push({ id: p.id, error: r.error }); return; }
        cur = r.events; applied.push(p.id);
      } else if (p.kind === "move" && p.move && p.move.source === "event") {
        const ev = C.byId(cur, p.move.id);
        if (!ev) { skipped.push({ id: p.id, error: "That event isn't there any more." }); return; }
        if (ev.repeat) { skipped.push({ id: p.id, error: "That event repeats now, so I left it." }); return; }
        const occ = C.occurrence(ev, p.move.occDate, ctx.zone);
        if (occ.date !== p.move.from.date || (p.move.from.time && occ.time !== p.move.from.time)) { skipped.push({ id: p.id, error: "It was moved since I looked." }); return; }
        if (!occ.allDay && p.move.to.time && occ.endMs > occ.startMs && clashAt(cur, ctx, p.move.to.date, p.move.to.time, Math.round((occ.endMs - occ.startMs) / 60000), occ.key).length) { skipped.push({ id: p.id, error: "That time is taken now." }); return; }
        const r = C.moveTo(cur, p.move.id, p.move.occDate, p.move.to, "all", ctx);
        if (!r.ok) { skipped.push({ id: p.id, error: r.error }); return; }
        cur = r.events; applied.push(p.id);
      } else if (p.kind === "delete" && p.del) {
        const ev = C.byId(cur, p.del.id);
        if (!ev) { skipped.push({ id: p.id, error: "That is already gone." }); return; }
        if (!ev.linked || ev.linked.type !== "assistant") { skipped.push({ id: p.id, error: "I only remove blocks I planned." }); return; }
        const r = C.remove(cur, p.del.id, ctx);
        if (!r.ok) { skipped.push({ id: p.id, error: r.error }); return; }
        cur = r.events; applied.push(p.id);
      }
    });
    return { events: cur, applied: applied, skipped: skipped, changed: cur !== events };
  }

  // Your To-Do / Habits tasks: approved moves only. A task that is done, gone or already moved is skipped.
  // -> { tasks, applied: [id], skipped: [{ id, error }], changed }
  function applyTasks(tasks, proposals, approvedIds) {
    const chosen = select(proposals, approvedIds).filter(function (p) { return p.kind === "move" && p.move && p.move.source === "task" && C.isDate(p.move.to && p.move.to.date); });
    const applied = [], skipped = []; let cur = tasks;
    chosen.forEach(function (p) {
      const t = (cur || []).filter(function (x) { return x && x.id === p.move.id; })[0];
      if (!t) { skipped.push({ id: p.id, error: "That task isn't there any more." }); return; }
      if (t.completed) { skipped.push({ id: p.id, error: "That task is done now." }); return; }
      if (t.date !== p.move.from.date) { skipped.push({ id: p.id, error: "That task was moved since I looked." }); return; }
      cur = cur.map(function (x) { return x.id === p.move.id ? Object.assign({}, x, { date: p.move.to.date }) : x; }); applied.push(p.id);
    });
    return { tasks: cur, applied: applied, skipped: skipped, changed: cur !== tasks };
  }

  return {
    STEP: STEP, MIN_BLOCK: MIN_BLOCK, HORIZON_DAYS: HORIZON_DAYS, LOOKBACK_DAYS: LOOKBACK_DAYS, FOCUS_AREAS: FOCUS,
    board: board, suggestTimes: suggestTimes, fixClashes: fixClashes, focusBlocks: focusBlocks, catchUp: catchUp, splitProject: splitProject, clearPlanned: clearPlanned, overview: overview,
    preview: preview, select: select, apply: apply, applyTasks: applyTasks, hoursLabel: hoursLabel, dayLabel: dayLabel, whenLabel: whenLabel
  };
});
