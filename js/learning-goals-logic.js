/* ==========================================================================
   JARVIS — Learning & Research Hub: learning goals (pure rules).

   A goal is a target for something you already record, over a period:
     { id, title, metric, target, period, startDate, deadline, bookId, status, endedOn, result, finalValue, createdAt, updatedAt, deletedAt? }

   metric   pages        pages read                (from the reading log; each page counted once)
            minutes      minutes read              (from reading-time sessions)
            books        books completed           (a book's finish date)
            finishBook   finish one particular book (bookId), by the deadline if there is one
            research     research projects completed (their completed date)
            reviews      lessons and flashcards reviewed (scheduled reviews, not extra practice)
            implemented  ideas implemented         (actions marked Implemented, on that day)
            takeaways    key takeaways recorded    (on the day they were saved)
   period   day | week | month   repeats: each day / week (Mon-Sun) / calendar month is a new try at the same target
            range                one-off: from startDate to deadline (the deadline is optional)

   Progress is never typed in: it is counted from your records, so it can't drift from them or be entered twice.
   Past tries of a repeating goal (its history) are counted the same way from the dates on the records.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./learning-logic"), require("./learning-srs"));
  else root.JarvisLearningGoals = factory(root.JarvisLearningLogic, root.JarvisLearningSRS);
})(typeof self !== "undefined" ? self : this, function (L, S) {
  "use strict";

  const KEY = "jarvisLearnGoals";
  const METRICS = [
    { key: "pages", label: "Pages read", unit: "page", units: "pages" },
    { key: "minutes", label: "Minutes read", unit: "minute", units: "minutes" },
    { key: "books", label: "Books completed", unit: "book", units: "books" },
    { key: "finishBook", label: "Finish a particular book", unit: "book", units: "books" },
    { key: "research", label: "Research projects completed", unit: "project", units: "projects" },
    { key: "reviews", label: "Lessons reviewed", unit: "review", units: "reviews" },
    { key: "implemented", label: "Ideas implemented", unit: "idea", units: "ideas" },
    { key: "takeaways", label: "Key takeaways recorded", unit: "takeaway", units: "takeaways" }
  ];
  const PERIODS = [{ key: "day", label: "Every day" }, { key: "week", label: "Every week" }, { key: "month", label: "Every month" }, { key: "range", label: "By a date (one time)" }];
  const METRIC_KEYS = METRICS.map(function (m) { return m.key; }), PERIOD_KEYS = PERIODS.map(function (p) { return p.key; });
  const MAX_TARGET = 100000, FAR = "9999-12-31";

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function line(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function intIn(v, lo, hi, fb) { const n = typeof v === "number" ? v : (typeof v === "string" && /^\d{1,7}$/.test(v.trim()) ? Number(v) : NaN); return isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi ? n : fb; }
  function undef(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined) delete o[k]; }); return o; }
  function metricOf(key) { return METRICS.filter(function (m) { return m.key === key; })[0]; }
  function monthStart(d) { return d.slice(0, 8) + "01"; }
  function monthEnd(d) { const last = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate(); return d.slice(0, 8) + String(last).padStart(2, "0"); }

  /* ---------------- the record ---------------- */

  function read(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const metric = METRIC_KEYS.indexOf(raw.metric) !== -1 ? raw.metric : "", period = PERIOD_KEYS.indexOf(raw.period) !== -1 ? raw.period : "";
    const target = intIn(raw.target, 1, MAX_TARGET, 0);
    if (!metric || !period || !target || !L.isDate(raw.startDate)) return null;
    const status = raw.status === "archived" ? "archived" : "active";
    return undef({
      id: raw.id, createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt), deletedAt: num(raw.deletedAt) || undefined,
      title: line(raw.title, 200), metric: metric, target: target, period: period, startDate: raw.startDate,
      deadline: period === "range" && L.isDate(raw.deadline) && raw.deadline >= raw.startDate ? raw.deadline : "",
      bookId: typeof raw.bookId === "string" ? raw.bookId.slice(0, 80) : "", status: status,
      endedOn: status === "archived" && L.isDate(raw.endedOn) ? raw.endedOn : undefined,
      result: status === "archived" && ["achieved", "missed", "archived"].indexOf(raw.result) !== -1 ? raw.result : undefined,
      finalValue: status === "archived" && typeof raw.finalValue === "number" && isFinite(raw.finalValue) ? raw.finalValue : undefined
    });
  }
  L.registerKind({ kind: "goals", key: KEY, prefix: "gl", read: read });

  // How a goal reads in words: "Read 50 pages each week", "Finish Atomic Habits by Dec 1".
  function titleFor(goal, bookTitle) {
    const m = metricOf(goal.metric), n = goal.target, u = n === 1 ? m.unit : m.units;
    const per = goal.period === "day" ? " each day" : goal.period === "week" ? " each week" : goal.period === "month" ? " each month" : goal.deadline ? " by " + dateWords(goal.deadline) : "";
    switch (goal.metric) {
      case "pages": return "Read " + n + " " + u + (goal.bookId && bookTitle ? " of " + bookTitle : "") + per;
      case "minutes": return "Read for " + n + " " + u + per;
      case "books": return "Finish " + n + " " + u + per;
      case "finishBook": return "Finish " + (bookTitle || "the book") + per;
      case "research": return "Complete " + n + " research " + u + per;
      case "reviews": return "Review " + n + " " + (n === 1 ? "lesson" : "lessons") + per;
      case "implemented": return "Implement " + n + " " + u + per;
      default: return "Record " + n + " key " + u + per;
    }
  }
  function dateWords(d) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }

  // ctx: { today, books: [live] }
  function check(input, ctx) {
    const c = ctx || {}, i = input || {}, e = {};
    const metric = METRIC_KEYS.indexOf(i.metric) !== -1 ? i.metric : "", period = PERIOD_KEYS.indexOf(i.period) !== -1 ? i.period : "";
    if (!metric) e.metric = "Choose what to count.";
    if (!period) e.period = "Choose how often.";
    const targetRaw = typeof i.target === "string" ? i.target.trim() : i.target;
    let target = metric === "finishBook" && (targetRaw === "" || targetRaw === undefined) ? 1 : intIn(targetRaw, 1, MAX_TARGET, 0);
    if (!target) e.target = "Enter a whole number of at least 1.";
    const startDate = i.startDate ? i.startDate : (c.today || "");
    if (!L.isDate(startDate)) e.startDate = "That start date isn't valid.";
    let deadline = i.deadline || "";
    if (period === "range" && deadline) {
      if (!L.isDate(deadline)) e.deadline = "That deadline isn't valid.";
      else if (L.isDate(startDate) && deadline < startDate) e.deadline = "The deadline can't be before the start date.";
    } else if (period !== "range") deadline = "";
    let bookId = typeof i.bookId === "string" ? i.bookId : "";
    if (metric === "finishBook" && !bookId) e.bookId = "Choose the book.";
    if (bookId && c.books && !c.books.some(function (b) { return b.id === bookId; })) e.bookId = "That book no longer exists.";
    if (metric !== "finishBook" && metric !== "pages" && metric !== "minutes") bookId = "";
    if (Object.keys(e).length) return { ok: false, errors: e };
    if (metric === "finishBook") target = 1;
    const book = bookId && c.books ? c.books.filter(function (b) { return b.id === bookId; })[0] : null;
    const goal = { metric: metric, target: target, period: period, startDate: startDate, deadline: period === "range" ? deadline : "", bookId: bookId };
    return { ok: true, value: Object.assign({ title: line(i.title, 200) || titleFor(goal, book && book.title), status: "active" }, goal) };
  }

  /* ---------------- counting from the records ---------------- */

  // What happened, as dated amounts: [{ d, n }]. state: { books, research, notes, cards, actions, sessions }.
  function events(goal, state) {
    const out = [], live = L.live;
    const st = state || {};
    if (goal.metric === "pages") {
      live(st.books).forEach(function (b) { if (goal.bookId && b.id !== goal.bookId) return; L.dailyPages(b).forEach(function (x) { if (x.pages > 0) out.push({ d: x.d, n: x.pages }); }); });
    } else if (goal.metric === "minutes") {
      live(st.sessions).forEach(function (s) { if (goal.bookId && s.bookId !== goal.bookId) return; if (L.isDate(s.day) && s.minutes > 0) out.push({ d: s.day, n: s.minutes }); });
    } else if (goal.metric === "books") {
      live(st.books).forEach(function (b) { if (b.status === "completed" && L.isDate(b.endDate)) out.push({ d: b.endDate, n: 1 }); });
    } else if (goal.metric === "finishBook") {
      live(st.books).forEach(function (b) { if (b.id === goal.bookId && b.status === "completed" && L.isDate(b.endDate)) out.push({ d: b.endDate, n: 1 }); });
    } else if (goal.metric === "research") {
      live(st.research).forEach(function (r) { if (r.status === "completed" && L.isDate(r.completedAt)) out.push({ d: r.completedAt, n: 1 }); });
    } else if (goal.metric === "reviews") {
      S.entries(live(st.notes).concat(live(st.cards)), "", "", { practice: false }).forEach(function (x) { out.push({ d: x.d, n: 1 }); });
    } else if (goal.metric === "implemented") {
      live(st.actions).forEach(function (a) { if (a.status === "done" && L.isDate(a.implementedAt)) out.push({ d: a.implementedAt, n: 1 }); });
    } else if (goal.metric === "takeaways") {
      live(st.notes).forEach(function (n) { if (n.type !== "takeaway") return; const d = L.isDate(n.day) ? n.day : (n.createdAt ? L.localDate(n.createdAt) : ""); if (d) out.push({ d: d, n: 1 }); });
    }
    return out;
  }

  // The stretch of days a try covers, around a date. -> { from, to ("" = no end) }
  function windowAt(goal, d) {
    if (goal.period === "day") return { from: d, to: d };
    if (goal.period === "week") { const f = L.weekStart(d); return { from: f, to: L.addDays(f, 6) }; }
    if (goal.period === "month") return { from: monthStart(d), to: monthEnd(d) };
    return { from: goal.startDate, to: goal.deadline || "" };
  }
  function inWindow(d, w) { return d >= w.from && (!w.to || d <= w.to); }

  // The try covering a window: how much was done, whether it was enough, and the day the target was first reached.
  function measure(goal, state, w, evs) {
    const list = (evs || events(goal, state)).filter(function (x) { return inWindow(x.d, w); }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    const value = list.reduce(function (s, x) { return s + x.n; }, 0);
    let achievedOn = "", run = 0;
    for (let i = 0; i < list.length; i++) { run += list[i].n; if (run >= goal.target) { achievedOn = list[i].d; break; } }
    return { value: value, target: goal.target, pct: Math.min(100, Math.round(value / goal.target * 100)), met: value >= goal.target, achievedOn: achievedOn, window: w };
  }

  // The full picture of one goal today.
  //   now: the current try (for a repeating goal, this day/week/month; for a one-off, the whole span)
  //   state: "achieved" | "active" | "overdue" (one-off, deadline passed, not reached) | "archived"
  //   daysLeft: to the end of this try or the deadline (null when there is no end)
  function summarize(goal, state, today) {
    const evs = events(goal, state);
    const w = windowAt(goal, goal.period === "range" ? goal.startDate : today);
    const now = measure(goal, state, w, evs);
    let status = goal.status === "archived" ? "archived" : now.met ? "achieved" : (goal.period === "range" && goal.deadline && goal.deadline < today) ? "overdue" : "active";
    const end = w.to || "";
    const out = { goal: goal, now: now, state: status, daysLeft: end ? Math.max(0, L.diffDays(today, end)) : null, upcoming: goal.period === "range" && goal.startDate > today };
    if (goal.metric === "finishBook") {
      const b = L.live(state && state.books).filter(function (x) { return x.id === goal.bookId; })[0];
      out.book = b || null;
      out.bookPct = b ? (b.status === "completed" ? 100 : L.progress(b)) : null;
      if (b && !now.met && b.status === "completed" && L.isDate(b.endDate) && goal.deadline && b.endDate > goal.deadline) out.late = b.endDate;
    }
    out.history = history(goal, state, today, evs);       // empty for a one-time goal
    return out;
  }

  // Past tries of a repeating goal, newest first (not the current one), starting from the try that contains the goal's start day.
  function history(goal, state, today, evs) {
    if (goal.period === "range") return [];
    const out = [], first = windowAt(goal, goal.startDate);
    let w = windowAt(goal, today);
    while (w.from > first.from && out.length < 60) {
      const prev = windowAt(goal, L.addDays(w.from, -1));
      out.push(measure(goal, state, prev, evs));
      w = prev;
    }
    return out;
  }
  function streak(hist) { let n = 0; for (let i = 0; i < hist.length; i++) { if (hist[i].met) n++; else break; } return n; }

  // Tries that were met with the day the target was reached falling inside [from, to]. Used by the weekly review.
  // -> [{ goal, on, window }]
  function achievedBetween(goals, state, from, to) {
    const out = [];
    L.live(goals).forEach(function (g) {
      if (g.startDate > to) return;
      const evs = events(g, state), first = windowAt(g, g.startDate);
      const windows = [];
      if (g.period === "range") windows.push(first);
      else {
        let d = from;
        while (d <= to) { const w = windowAt(g, d); if (w.from >= first.from) windows.push(w); d = L.addDays(w.to, 1); }
      }
      windows.forEach(function (w) {
        const m = measure(g, state, w, evs);
        if (m.met && m.achievedOn >= from && m.achievedOn <= to) out.push({ goal: g, on: m.achievedOn, window: w });
      });
    });
    return out;
  }

  // Archiving: the result is written down so the history doesn't change if records change later.
  function archive(goal, state, today, now) {
    const s = summarize(goal, state, today);
    const result = s.now.met ? "achieved" : (goal.period === "range" && goal.deadline && goal.deadline < today) ? "missed" : "archived";
    return Object.assign({}, goal, { status: "archived", endedOn: today, result: result, finalValue: s.now.value, updatedAt: now });
  }
  function reactivate(goal, now) {
    const g = Object.assign({}, goal, { status: "active", updatedAt: now });
    delete g.endedOn; delete g.result; delete g.finalValue;
    return g;
  }

  // Goals for the Dashboard: active ones, the most pressing first (a one-off with a close deadline, then repeating ones, then open-ended).
  function active(goals, state, today) {
    return L.live(goals).filter(function (g) { return g.status === "active"; }).map(function (g) { return summarize(g, state, today); })
      .sort(function (a, b) {
        const rank = function (s) { return s.state === "overdue" ? 0 : s.state === "achieved" ? 3 : 1; };
        const da = a.daysLeft === null ? 9999 : a.daysLeft, db = b.daysLeft === null ? 9999 : b.daysLeft;
        return rank(a) - rank(b) || da - db || num(b.goal.createdAt) - num(a.goal.createdAt);
      });
  }
  function archived(goals) { return L.live(goals).filter(function (g) { return g.status === "archived"; }).sort(function (a, b) { return (b.endedOn || "") < (a.endedOn || "") ? -1 : (b.endedOn || "") > (a.endedOn || "") ? 1 : 0; }); }

  // Ready-made starting points for the form.
  const EXAMPLES = [
    { label: "Read 50 pages a week", metric: "pages", target: 50, period: "week" },
    { label: "Read 20 pages a day", metric: "pages", target: 20, period: "day" },
    { label: "Finish a book by a date", metric: "finishBook", target: 1, period: "range" },
    { label: "Complete 2 research projects a month", metric: "research", target: 2, period: "month" },
    { label: "Review 10 lessons a week", metric: "reviews", target: 10, period: "week" },
    { label: "Implement 3 ideas from my reading", metric: "implemented", target: 3, period: "range" }
  ];

  return { KEY: KEY, METRICS: METRICS, PERIODS: PERIODS, EXAMPLES: EXAMPLES, metricOf: metricOf, read: read, check: check, titleFor: titleFor, events: events, windowAt: windowAt, measure: measure, summarize: summarize, history: history, streak: streak, achievedBetween: achievedBetween, archive: archive, reactivate: reactivate, active: active, archived: archived };
});
