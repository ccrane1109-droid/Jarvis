/* ==========================================================================
   JARVIS — Schedule: what is coming up, and what is late (pure functions, no page access, so they can be
   tested outside the browser).

   Everything works on calendar items (the shape calendar-logic.js makes): events, your tasks, and the dates that
   live in Business (task deadlines, goal target dates, product and brand launch dates). The Home screen's
   Upcoming Schedule card, the Daily Briefing and the Calendar all read the same items, so they never disagree.

   Nothing here invents anything: a date nobody entered is not on the schedule, and an item you ticked is
   never overdue.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./calendar-logic.js"));
  else root.JarvisScheduleLogic = factory(root.JarvisCalendarLogic);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const LOOKBACK_DAYS = 60, DEADLINE_DAYS = 14, LIST_MAX = 5;

  function pri(p) { const v = String(p || "").toLowerCase(); return v === "high" || v === "low" ? v : "medium"; }
  function rank(p) { return p === "high" ? 0 : p === "low" ? 2 : 1; }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  /* ---------------- dates that live in Business, as calendar items ---------------- */

  function dateItem(o) {
    return {
      key: o.key, id: o.id, occDate: o.date, source: o.source, title: o.title, description: "", kind: o.kind, category: o.category, priority: pri(o.priority),
      recurring: false, linked: null, status: "", reminders: [], completed: !!o.completed, point: true, tz: "", allDay: true,
      date: o.date, endDate: o.date, time: "", endTime: "", startMin: null, endMin: null, startMs: null, endMs: null, readOnly: !!o.readOnly, conflict: false
    };
  }

  // biz: the Business data ({ tasks, goals, products, profile }); personalGoals: the Habits goals. -> items dated from..to.
  function businessItems(biz, personalGoals, from, to) {
    const b = biz && typeof biz === "object" ? biz : {}, out = [];
    const inRange = function (d) { return C.isDate(d) && d >= from && d <= to; };
    (Array.isArray(b.tasks) ? b.tasks : []).forEach(function (t) {
      if (t && typeof t.id === "string" && str(t.text) && inRange(t.deadline)) out.push(dateItem({ key: "biztask:" + t.id, id: t.id, source: "bizTask", title: str(t.text), kind: "task", category: "business", priority: t.priority, completed: t.completed, date: t.deadline }));
    });
    (Array.isArray(b.goals) ? b.goals : []).forEach(function (g) {
      if (g && typeof g.id === "string" && str(g.title) && inRange(g.targetDate)) out.push(dateItem({ key: "bizgoal:" + g.id, id: g.id, source: "bizGoal", title: "Goal: " + str(g.title), kind: "milestone", category: "business", priority: g.priority, completed: g.status === "Complete", date: g.targetDate, readOnly: true }));
    });
    (Array.isArray(b.products) ? b.products : []).forEach(function (p) {
      if (p && typeof p.id === "string" && str(p.name) && inRange(p.launchDate)) out.push(dateItem({ key: "launch:" + p.id, id: p.id, source: "launch", title: "Launch: " + str(p.name), kind: "milestone", category: "launch", priority: "high", completed: p.status === "Live", date: p.launchDate, readOnly: true }));
    });
    (Array.isArray(b.content) ? b.content : []).forEach(function (c) {
      if (c && typeof c.id === "string" && str(c.title) && inRange(c.scheduledDate)) out.push(dateItem({ key: "bizcontent:" + c.id, id: c.id, source: "bizContent", title: "Post: " + str(c.title), kind: "content", category: "content", priority: "medium", completed: c.status === "Posted", date: c.scheduledDate, readOnly: true }));
    });
    const prof = b.profile && typeof b.profile === "object" ? b.profile : {};
    if (inRange(prof.launchDate)) out.push(dateItem({ key: "launch:brand", id: "brand", source: "launch", title: "Launch: " + (str(prof.name) || "your brand"), kind: "milestone", category: "launch", priority: "high", completed: false, date: prof.launchDate, readOnly: true }));
    (Array.isArray(personalGoals) ? personalGoals : []).forEach(function (g) {
      if (g && typeof g.id === "string" && str(g.name) && inRange(g.targetDate)) out.push(dateItem({ key: "goal:" + g.id, id: g.id, source: "goal", title: "Goal: " + str(g.name), kind: "milestone", category: "personal", priority: "medium", completed: !!g.completed, date: g.targetDate, readOnly: true }));
    });
    return out;
  }

  /* ---------------- what is coming up ---------------- */

  function byDay(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.startMin || 0) - (b.startMin || 0) || rank(a.priority) - rank(b.priority) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  }
  function overlapsDay(it, d) { return it.date <= d && it.endDate >= d; }
  // A task or milestone with a date that nobody has ticked, and whose day (or time, today) has passed.
  function isOverdue(it, today, nowMin) {
    if (!it.point || it.completed) return false;
    if (it.date < today) return C.diffDays(it.date, today) <= LOOKBACK_DAYS;
    return it.date === today && !it.allDay && it.startMin < nowMin;
  }
  function daysUntil(date, today) { return C.diffDays(today, date); }
  function whenLabel(date, today) {
    const n = daysUntil(date, today);
    return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n > 1 ? "In " + n + " days" : -n + " days ago";
  }

  // items: everything from (today - 60 days) to (today + 14 days) at least. opts: { today, nowMin, weekStart }.
  // -> { today: [...], nextUp, nextTask, overdue: [...], deadlines: [...], priorities: [...], counts }
  function summarize(items, opts) {
    const o = opts || {}, today = o.today, nowMin = typeof o.nowMin === "number" ? o.nowMin : 0, weekStart = o.weekStart === 0 ? 0 : 1;
    const list = (Array.isArray(items) ? items : []).slice().sort(byDay);
    const todays = list.filter(function (it) { return overlapsDay(it, today); }).map(function (it) {
      return Object.assign({}, it, { passed: !it.allDay && it.date === today && (it.point ? it.startMin < nowMin : (it.endDate === today ? it.endMin <= nowMin : false)) });
    });
    const overdue = list.filter(function (it) { return isOverdue(it, today, nowMin); });
    const overdueKeys = {}; overdue.forEach(function (it) { overdueKeys[it.key] = true; });

    // the event that is on now, or the next one today
    let nextUp = null;
    for (let i = 0; i < todays.length; i++) {
      const it = todays[i];
      if (it.allDay || it.point || it.completed || it.date !== today) continue;
      if (it.startMin <= nowMin && nowMin < it.endMin) { nextUp = { item: it, state: "now" }; break; }
      if (it.startMin >= nowMin) { nextUp = { item: it, state: "next" }; break; }
    }

    const open = list.filter(function (it) { return it.point && !it.completed && !overdueKeys[it.key] && it.date >= today; });
    const nextTask = open.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a.priority) - rank(b.priority) || (a.allDay ? 1 : 0) - (b.allDay ? 1 : 0) || (a.startMin || 0) - (b.startMin || 0); })[0] || null;

    const last = C.addDays(today, DEADLINE_DAYS);
    const deadlines = open.filter(function (it) { return it.date > today && it.date <= last; }).sort(byDay);

    const week = C.rangeFor("week", today, weekStart);
    const priorities = list.filter(function (it) {
      return it.priority === "high" && !it.completed && !overdueKeys[it.key] && it.endDate >= today && it.date <= week.to;
    }).filter(function (it) {
      return !(it.date === today && !it.allDay && (it.point ? it.startMin < nowMin : it.endMin <= nowMin));
    }).sort(byDay);

    return {
      today: todays, nextUp: nextUp, nextTask: nextTask, overdue: overdue, deadlines: deadlines, priorities: priorities,
      counts: {
        today: todays.length,
        eventsToday: todays.filter(function (it) { return !it.point; }).length,
        openToday: todays.filter(function (it) { return it.point && !it.completed; }).length,
        overdue: overdue.length, deadlines: deadlines.length, priorities: priorities.length
      }
    };
  }

  /* ---------------- today, hour by hour ---------------- */

  const DAY_START = 6, DAY_END = 22;   // the hours shown even when nothing is in them: 6 AM to 10 PM

  // Today's items laid out by hour for the Home schedule. items: the items that touch today (summarize().today).
  // opts: { today, nowHour, showEarlier }. Hours before the one just gone are folded away unless showEarlier.
  // -> { allDay: [...], slots: [{ hour, isNow, items: [...] }], earlier: { hours, items } | null, canCollapse }
  function daySlots(items, opts) {
    const o = opts || {}, today = o.today, nowHour = typeof o.nowHour === "number" ? o.nowHour : 12, show = !!o.showEarlier;
    const list = Array.isArray(items) ? items : [];
    const allDay = list.filter(function (it) { return it.allDay; });
    const timed = list.filter(function (it) { return !it.allDay; });
    const hourOf = function (it) { return it.date < today ? 0 : Math.floor((it.startMin || 0) / 60); };   // one that began on an earlier day sits at midnight
    const hours = timed.map(hourOf);
    const lo = Math.min.apply(null, [DAY_START, nowHour].concat(hours)), hi = Math.max.apply(null, [DAY_END, nowHour].concat(hours));
    const from = show ? lo : Math.max(lo, nowHour - 1);
    const slots = [];
    for (let h = from; h <= hi; h++) slots.push({ hour: h, isNow: h === nowHour, items: timed.filter(function (it) { return hourOf(it) === h; }).sort(byDay) });
    const hidden = timed.filter(function (it) { return hourOf(it) < from; });
    return { allDay: allDay.sort(byDay), slots: slots, earlier: from > lo ? { hours: from - lo, items: hidden.length } : null, canCollapse: show && lo < nowHour - 1 };
  }

  // The one line the Daily Briefing shows.
  function briefingLine(s, today, timeLabel) {
    const parts = [];
    const n = s.counts.eventsToday;
    parts.push(n === 0 ? "no events today" : n + " event" + (n === 1 ? "" : "s") + " today");
    if (s.nextUp) parts.push((s.nextUp.state === "now" ? "on now: " : "next: ") + s.nextUp.item.title + " at " + timeLabel(s.nextUp.item.time));
    if (s.counts.overdue) parts.push(s.counts.overdue + " overdue");
    if (s.deadlines.length) parts.push("next deadline: " + s.deadlines[0].title + " (" + whenLabel(s.deadlines[0].date, today).toLowerCase() + ")");
    return parts.join(" · ");
  }

  return {
    LOOKBACK_DAYS: LOOKBACK_DAYS, DEADLINE_DAYS: DEADLINE_DAYS, LIST_MAX: LIST_MAX,
    businessItems: businessItems, summarize: summarize, daySlots: daySlots, DAY_START: DAY_START, DAY_END: DAY_END, isOverdue: isOverdue, whenLabel: whenLabel, daysUntil: daysUntil, briefingLine: briefingLine, byDay: byDay
  };
});
