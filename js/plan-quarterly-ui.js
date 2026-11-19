/* ==========================================================================
   JARVIS — Strategic Planning Center: the Quarterly view (Q1-Q4 timeline) and the Monthly view.

   Quarterly: a timeline of the four quarters; pick one to see its (up to three) priorities, each linked to a yearly objective,
   the quarter's revenue and budget, and its months with their milestones. Monthly: that month's milestones, its money
   (actual sales revenue and spending that you enter), and the month's tasks, linked or not. Overdue items are marked in red.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, esc = A.esc, state = A.state;
  const QNAME = ["", "Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

  function avg(m, list) {
    const known = list.map(function (n) { return m.progress(n.id).pct; }).filter(function (p) { return p !== null; });
    return known.length ? Math.round(known.reduce(function (s, p) { return s + Math.min(100, p); }, 0) / known.length) : null;
  }
  function inQuarter(n, year, q) { return n.year === year && n.quarter === q; }

  function stepper(label, prevAct, nextAct, prevLabel, nextLabel) {
    return '<div class="sp-stepper"><button type="button" class="btn btn-secondary" data-act="' + prevAct + '" data-dir="-1" aria-label="' + esc(prevLabel) + '">‹</button><span class="sp-stepper-label" data-focus-top>' + esc(label) + '</span><button type="button" class="btn btn-secondary" data-act="' + nextAct + '" data-dir="1" aria-label="' + esc(nextLabel) + '">›</button></div>';
  }

  /* ---------------- milestone rows ---------------- */

  // A milestone as one line: tick it off here when there are no tasks to complete, otherwise it shows its task progress.
  function milestoneRow(m, n) {
    const p = m.progress(n.id), h = m.health(n.id), tick = m.canMarkDone(n.id);
    return '<li class="sp-ms' + (h === "overdue" ? " sp-overdue" : "") + (h === "done" ? " sp-complete" : "") + '">' +
      (tick ? '<label class="sp-ms-check"><input type="checkbox" data-act="ms-toggle" data-id="' + esc(n.id) + '"' + (n.doneAt ? " checked" : "") + '><span class="sp-ms-title">' + esc(n.title) + '</span></label>' : '<span class="sp-ms-check"><span class="sp-ms-title">' + esc(n.title) + '</span></span>') +
      '<span class="sp-ms-meta">' + esc(PL.monthName(n.month, false)) + (n.due ? " · due " + esc(A.fmtShort(n.due)) : "") + (tick ? "" : " · " + esc(p.pct === null ? p.note : p.pct + "%")) + '</span>' +
      '<span class="sp-ms-badge">' + A.healthBadge(h === "ontrack" || h === "nodata" || h === "upcoming" ? "" : h) + '</span>' +
      '<button type="button" class="btn btn-secondary sp-ms-open" data-act="open-node" data-id="' + esc(n.id) + '" aria-label="Open ' + esc(n.title) + '">Open</button></li>';
  }

  /* ---------------- Quarterly ---------------- */

  function timeline(m, year, today) {
    const nowQ = String(year) === today.slice(0, 4) ? PL.quarterOfDate(today) : 0;
    let h = '<ol class="sp-qline" aria-label="Quarters of ' + year + '">';
    for (let q = 1; q <= 4; q++) {
      const pr = m.prioritiesOf(year, q).filter(function (p) { return p.status !== "dropped"; });
      const s = m.periods("quarter", PL.quarterKey(year, q));
      const late = m.all("priority").concat(m.all("milestone")).filter(function (n) { return inQuarter(n, year, q) && m.health(n.id) === "overdue"; }).length;
      const pct = avg(m, pr);
      h += '<li><button type="button" class="sp-qbtn' + (q === state.quarter ? " is-on" : "") + (late ? " has-late" : "") + '" data-act="pick-quarter" data-v="' + q + '" aria-pressed="' + (q === state.quarter) + '">' +
        '<span class="sp-q-name">Q' + q + (nowQ === q ? ' <span class="sp-now">now</span>' : "") + '</span><span class="sp-q-months">' + QNAME[q] + '</span>' +
        '<span class="sp-q-line">' + A.plural(pr.length, "priority", "priorities") + (pct === null ? "" : " · " + pct + "%") + '</span>' +
        '<span class="sp-q-line">' + (s.revenueTarget === null ? (s.revenueActual === null ? "no revenue entered" : esc(A.money(s.revenueActual))) : esc(A.money(s.revenueActual === null ? 0 : s.revenueActual)) + " of " + esc(A.money(s.revenueTarget))) + '</span>' +
        (late ? '<span class="sp-q-late">' + A.plural(late, "overdue item") + '</span>' : "") + A.bar(pct, "Q" + q + " progress", pct === null ? "" : "ontrack") + '</button></li>';
    }
    return h + '</ol>';
  }

  function priorityCard(m, p) {
    const ms = m.milestonesOf(p.id);
    const rows = ms.length ? '<h4 class="sp-h4">Monthly milestones</h4><ul class="sp-ms-list">' + ms.map(function (n) { return milestoneRow(m, n); }).join("") + '</ul>' : '<p class="sp-dim">No milestones yet. Break this priority into steps by month.</p>';
    const add = '<button type="button" class="btn btn-secondary" data-act="add-milestone" data-parent="' + esc(p.id) + '">Add milestone</button>';
    return A.nodeCard(p, { children: rows, add: add, parentLine: true });
  }

  function monthBlock(m, mk, q) {
    const s = m.periods("month", mk), ms = m.milestonesIn(mk), isNow = mk === A.store.today().slice(0, 7);
    let b = ms.length ? '<ul class="sp-ms-list">' + ms.map(function (n) { return milestoneRow(m, n); }).join("") + '</ul>' : '<p class="sp-dim">No milestones for this month.</p>';
    b += '<div class="sp-card-actions"><button type="button" class="btn btn-secondary" data-act="add-milestone" data-month="' + esc(mk) + '">Add milestone</button>' +
      '<button type="button" class="btn btn-secondary" data-act="period" data-scope="month" data-key="' + esc(mk) + '">Enter ' + esc(PL.monthName(mk, false)) + ' money</button>' +
      '<button type="button" class="btn btn-secondary" data-act="open-month" data-v="' + esc(mk) + '">Open month</button></div>';
    const done = ms.filter(function (n) { return m.progress(n.id).pct === 100; }).length;
    const sum = (ms.length ? done + " of " + ms.length + " milestones" : "no milestones") + " · " + (s.revenueActual === null ? "no revenue entered" : esc(A.money(s.revenueActual)) + (s.revenueTarget ? " of " + esc(A.money(s.revenueTarget)) : "") + (s.metric === "mrr" ? " MRR" : " in sales"));
    return '<div class="sp-month" aria-label="' + esc(A.monthLabel(mk)) + '">' + A.section("q-mo-" + mk, PL.monthName(mk, true) + (isNow ? " (this month)" : ""), b, { open: isNow, summary: sum }) + '</div>';
  }

  function overdueBox(m, list) {
    if (!list.length) return "";
    return '<section class="sp-alert" role="region" aria-label="Overdue"><h3 class="sp-h3">' + A.plural(list.length, "item") + ' overdue</h3><ul class="sp-sublist">' + list.map(function (n) {
      return '<li><button type="button" class="sp-link" data-act="open-node" data-id="' + esc(n.id) + '">' + esc(n.title) + '</button> <span class="sp-dim">' + esc(A.typeLabel(n.type)) + ' · was due ' + esc(A.fmtShort(m.deadline(n))) + '</span></li>';
    }).join("") + '</ul></section>';
  }

  /* ---------------- the quarter at a glance ---------------- */

  const HELP_BTN = { "enter-money": ["period-month", "Enter it"], "link-parent": ["edit-node", "Link to an objective"], breakdown: ["breakdown-from", "Break it down"], open: ["detail", "Open it"], "link-tasks": ["link-tasks", "Add tasks"], "schedule-week": ["go-weekly", "Open the week"] };
  function helpRow(h) {
    const b = HELP_BTN[h.kind];
    return '<li><span class="sp-help-t">' + esc(h.text) + '</span>' + (b ? '<button type="button" class="btn btn-secondary sp-help-b" data-act="' + b[0] + '" data-id="' + esc(h.id) + '">' + esc(b[1]) + '</button>' : "") + '</li>';
  }
  function overviewHtml(o, m) {
    const nt = function (x) { return x === null ? "–" : x + "%"; };
    const c = o.counts, parts = [];
    if (c.completed) parts.push(c.completed + " completed");
    if (c.ontrack) parts.push(c.ontrack + " on track");
    if (c.atrisk) parts.push(c.atrisk + " at risk");
    if (c.notstarted) parts.push(c.notstarted + " not started");
    if (c.paused) parts.push(c.paused + " paused");
    let h = '<div class="sp-tiles sp-tiles-q">' +
      '<div class="sp-tile"><span class="sp-tile-l">Complete</span><span class="sp-tile-v">' + (o.actual === null ? '<span class="sp-dim">no data</span>' : o.actual + "%") + '</span>' + A.bar(o.actual, "Quarter completion", o.gap !== null && o.gap < -10 ? "atrisk" : "ontrack") + '</div>' +
      '<div class="sp-tile"><span class="sp-tile-l">Time passed</span><span class="sp-tile-v">' + nt(o.expected) + '</span>' + A.bar(o.expected, "Time passed", "") + '</div>' +
      '<div class="sp-tile"><span class="sp-tile-l">Milestones</span><span class="sp-tile-v">' + (o.milestones.total ? o.milestones.done + "/" + o.milestones.total : '<span class="sp-dim">none</span>') + '</span></div>' +
      '<div class="sp-tile' + (o.overdue ? " sp-tone-red" : "") + '"><span class="sp-tile-l">Overdue</span><span class="sp-tile-v">' + o.overdue + '</span></div></div>';
    h += A.paceBars({ expected: o.expected, actual: o.actual, gap: o.gap, state: o.state, start: o.start }, o.gap !== null && o.gap < -10 ? "atrisk" : "ontrack");
    h += '<p class="sp-q-facts">' + (parts.length ? esc(A.plural(o.priorities, "priority", "priorities") + ": " + parts.join(", ")) + ". " : "") + (o.tasks.total ? esc(o.tasks.done + " of " + o.tasks.total + " linked tasks done. ") : "") +
      (o.revenueTarget !== null ? esc("Revenue " + A.money(o.revenueActual) + " of " + A.money(o.revenueTarget) + ".") : "") + '</p>';
    h += '<h4 class="sp-h4">Behind or at risk</h4>';
    if (!o.priorities) h += '<p class="sp-dim">No priorities for this quarter yet.</p>';
    else if (!o.behind.length) h += '<p class="sp-dim">' + (o.actual === null ? "Not enough data yet to say who is behind." : "Nothing is behind its pace.") + '</p>';
    else h += '<ul class="sp-behind">' + o.behind.map(function (b) {
      return '<li class="sp-behind-item"><button type="button" class="sp-link sp-behind-t" data-act="detail" data-id="' + esc(b.id) + '">' + esc(b.title) + '</button><span class="sp-dim">' + esc(b.phrase) + '</span>' +
        (b.helps.length ? '<p class="sp-help-h">What would help</p><ul class="sp-help">' + b.helps.map(helpRow).join("") + '</ul>' : "") + '</li>';
    }).join("") + '</ul>';
    void m;
    return h;
  }

  A.register("quarterly", {
    html: function () {
      const m = A.model(), year = state.year, q = state.quarter, today = A.store.today();
      const key = PL.quarterKey(year, q), I = window.JarvisPlanInsights;
      let h = '<h2 class="visually-hidden">Quarterly plan</h2><div class="sp-head">' + stepper(String(year), "year-nav", "year-nav", "Previous year", "Next year") + '</div>';
      h += timeline(m, year, today);
      const late = m.all("priority").concat(m.all("milestone")).filter(function (n) { return inQuarter(n, year, q) && m.health(n.id) === "overdue"; });
      h += '<h2 class="sp-h2 sp-qtitle">Q' + q + ' ' + year + ' <span class="sp-dim">' + QNAME[q] + '</span></h2>' + overdueBox(m, late);
      const ov = I.quarterOverview(A.ictx(), year, q);
      h += A.section("q-perf", "How the quarter is going", overviewHtml(ov, m), { open: true, summary: (ov.actual === null ? "no data yet" : ov.actual + "% done") + " · " + ov.expected + "% of the time" + (ov.behind.length ? " · " + ov.behind.length + " behind" : "") });
      const pri = m.prioritiesOf(year, q), live = pri.filter(function (p) { return p.status !== "dropped"; });
      h += '<h3 class="sp-h3">Priorities <span class="sp-dim">(' + live.length + ' of ' + PL.MAX_PER_SLOT + ')</span></h3><div class="sp-stack">' + pri.map(function (p) { return priorityCard(m, p); }).join("") + '</div>';
      for (let i = live.length; i < PL.MAX_PER_SLOT; i++) h += '<button type="button" class="sp-slot" data-act="add-quarter-priority" aria-label="Add quarterly priority ' + (i + 1) + ' of ' + PL.MAX_PER_SLOT + '"><span aria-hidden="true">+</span> Add quarterly priority</button>';
      const money = m.periods("quarter", key);
      h += A.section("q-money", "Revenue, budget and hiring for the quarter", A.periodBlock("quarter", key) + '<button type="button" class="btn btn-secondary" data-act="period" data-scope="quarter" data-key="' + key + '">Edit Q' + q + ' targets</button>',
        { open: false, summary: money.revenueTarget === null ? (money.revenueActual === null ? "nothing entered" : esc(A.money(money.revenueActual))) : esc(A.money(money.revenueActual === null ? 0 : money.revenueActual)) + " of " + esc(A.money(money.revenueTarget)) });
      h += '<h3 class="sp-h3">Month by month</h3><div class="sp-months">' + PL.quarterMonths(year, q).map(function (mk) { return monthBlock(m, mk, q); }).join("") + '</div>';
      return h;
    }
  });

  /* ---------------- Monthly ---------------- */

  function shiftMonth(mk, dir) {
    let y = Number(mk.slice(0, 4)), mo = Number(mk.slice(5)) + dir;
    if (mo < 1) { mo = 12; y--; } else if (mo > 12) { mo = 1; y++; }
    return PL.monthKey(y, mo);
  }

  // What you have typed into the month's task filters is kept while you are on the screen; it is not saved.
  const mf = state.mf = state.mf || { q: "", status: "open", group: "milestone", category: "", priority: "", page: 1 };

  function moneyTick(v, axis) { return axis && v >= 10000 ? "$" + (Math.round(v / 100) / 10) + "K" : A.money(v); }

  function outcomeRow(o) {
    return '<li class="sp-outcome"><button type="button" class="sp-outcome-b" data-act="detail" data-id="' + esc(o.id) + '"><span class="sp-outcome-t">' + esc(o.title) + '</span><span class="sp-outcome-p">' + esc(A.pctText(o.pct)) + '</span>' + A.bar(o.pct, o.title + " progress", o.status === "atrisk" ? "atrisk" : "ontrack") + '<span class="sp-outcome-w">' + esc(o.why) + '</span></button></li>';
  }
  function monthOverviewHtml(ov) {
    const t = ov.tasks;
    let h = '<div class="sp-tiles sp-tiles-q"><div class="sp-tile"><span class="sp-tile-l">Milestones</span><span class="sp-tile-v">' + (ov.milestones.total ? ov.milestones.done + "/" + ov.milestones.total : '<span class="sp-dim">none</span>') + '</span></div>' +
      '<div class="sp-tile"><span class="sp-tile-l">Tasks done</span><span class="sp-tile-v">' + (t.total ? t.done + "/" + t.total : '<span class="sp-dim">none</span>') + '</span></div>' +
      '<div class="sp-tile"><span class="sp-tile-l">Still open</span><span class="sp-tile-v">' + t.open + '</span><span class="sp-tile-s">' + t.linkedOpen + ' linked</span></div>' +
      '<div class="sp-tile' + (t.overdue ? " sp-tone-red" : "") + '"><span class="sp-tile-l">Overdue</span><span class="sp-tile-v">' + t.overdue + '</span></div></div>';
    h += '<h4 class="sp-h4">The most important outcomes</h4>' + (ov.outcomes.length ? '<ul class="sp-outcomes">' + ov.outcomes.map(outcomeRow).join("") + '</ul>' : '<p class="sp-dim">Nothing planned for this month yet. Add a milestone below.</p>');
    h += '<h4 class="sp-h4">Coming up this month</h4>' + (ov.deadlines.length ? '<ul class="sp-dl">' + ov.deadlines.map(function (d) {
      return '<li><button type="button" class="sp-dl-btn' + (d.daysLeft <= 1 ? " is-late" : "") + '" data-act="' + (d.kind === "node" ? "detail" : "task-detail") + '" data-id="' + esc(d.id) + '"><span class="sp-dl-t">' + esc(d.title) + '</span><span class="sp-dl-k">' + (d.kind === "node" ? esc(A.typeLabel(d.type)) : "Task") + '</span><span class="sp-dl-d">' + esc(A.fmtShort(d.date)) + '</span></button></li>';
    }).join("") + '</ul>' : '<p class="sp-dim">No deadlines left this month.</p>');
    return h;
  }

  function financeHtml(m, mk) {
    const I = window.JarvisPlanInsights, Ch = window.JarvisPlanCharts, s = m.periods("month", mk), rec = PL.periodOf(A.store.all("periods"), "month", mk) || {};
    const budget = rec.budget === undefined ? null : rec.budget, spend = s.spendActual;
    const remaining = budget !== null && spend !== null ? budget - spend : null;
    let h = '<div class="sp-tiles sp-tiles-3">' +
      '<div class="sp-tile"><span class="sp-tile-l">Revenue</span><span class="sp-tile-v">' + (s.revenueActual === null ? '<span class="sp-dim">not entered</span>' : esc(A.money(s.revenueActual))) + '</span><span class="sp-tile-s">' + (s.revenueTarget ? "target " + esc(A.money(s.revenueTarget)) + (s.revenueActual === null ? "" : " · " + Math.round(100 * s.revenueActual / s.revenueTarget) + "%") : "no target set") + '</span></div>' +
      '<div class="sp-tile"><span class="sp-tile-l">Spent</span><span class="sp-tile-v">' + (spend === null ? '<span class="sp-dim">not entered</span>' : esc(A.money(spend))) + '</span><span class="sp-tile-s">' + (budget !== null ? "budget " + esc(A.money(budget)) : "no budget set") + '</span></div>' +
      '<div class="sp-tile' + (remaining !== null && remaining < 0 ? " sp-tone-red" : "") + '"><span class="sp-tile-l">Budget left</span><span class="sp-tile-v">' + (remaining === null ? '<span class="sp-dim">–</span>' : esc(A.money(remaining))) + '</span><span class="sp-tile-s">' + (remaining === null ? (budget === null ? "set a budget" : "enter spending") : remaining < 0 ? "over budget" : "still to spend") + '</span></div></div>';
    const months = I.lastMonths(mk, 6), fin = I.financeSeries(A.store.all("periods"), months);
    h += Ch.bars({ title: "Revenue and spending, last 6 months", summary: "Revenue and spending for the six months up to " + A.monthLabel(mk) + ". " + fin.map(function (r, i) { return PL.monthName(months[i], false) + ": revenue " + (r.revenue === null ? "not entered" : A.money(r.revenue)) + ", spending " + (r.spend === null ? "not entered" : A.money(r.spend)); }).join("; ") + ".",
      labels: months.map(function (x) { return PL.monthName(x, false); }), format: moneyTick, height: 190, emptyText: "No revenue or spending has been entered for these months. Enter " + PL.monthName(mk, false) + "'s money to start the graph.",
      series: [{ name: "Revenue", color: "var(--viz-1)", values: fin.map(function (r) { return r.revenue; }) }, { name: "Spending", color: "var(--viz-2)", values: fin.map(function (r) { return r.spend; }) }] });
    h += '<button type="button" class="btn btn-secondary" data-act="period" data-scope="month" data-key="' + esc(mk) + '">Enter ' + esc(PL.monthName(mk, false)) + ' money</button>';
    return h;
  }

  /* ---- the month's tasks and the inbox ---- */

  function listRow(t, m, withGoal) {
    const n = m.nodeOfTask(t.id), over = !t.completed && t.date < A.store.today();
    return '<li class="sp-trow' + (t.completed ? " is-done" : "") + '"><label class="sp-check44"><input type="checkbox" class="sp-trow-check" data-act="task-toggle" data-id="' + esc(t.id) + '"' + (t.completed ? " checked" : "") + ' aria-label="Done: ' + esc(t.text) + '"></label>' +
      '<button type="button" class="sp-trow-t" data-act="task-detail" data-id="' + esc(t.id) + '"><span class="sp-trow-n">' + esc(t.text) + '</span><span class="sp-trow-s' + (over ? " sp-late" : "") + '">' + esc(A.fmtShort(t.date)) + (over ? " · overdue" : "") + (t.priority === "high" ? " · high" : "") + (t.category ? " · " + esc(t.category) : "") + (withGoal && n ? " · " + esc(n.title) : "") + '</span></button></li>';
  }
  function groupsHtml(r, m) {
    if (!r.total) return '<p class="sp-dim">No tasks are dated this month.</p>';
    if (!r.groups.length) return '<p class="sp-dim">' + (r.linkedCount === 0 && r.matching === 0 ? "No tasks match these filters." : "No linked tasks to show.") + '</p>';
    return r.groups.map(function (g) {
      return '<section class="sp-tgroup" aria-label="' + esc(g.title) + '"><h4 class="sp-tgroup-h"><span class="sp-tgroup-t">' + esc(g.title) + '</span><span class="sp-dim">' + (g.node ? esc(A.pctText(g.node.pct)) + " · " : "") + g.open + ' open</span></h4><ul class="sp-trows">' + g.tasks.map(function (t) { return listRow(t, m, false); }).join("") + '</ul></section>';
    }).join("");
  }
  function inboxRow(t) {
    const over = !t.completed && t.date < A.store.today();
    return '<li class="sp-inbox-row' + (t.completed ? " is-done" : "") + '"><div class="sp-inbox-main"><label class="sp-check44"><input type="checkbox" class="sp-trow-check" data-act="task-toggle" data-id="' + esc(t.id) + '"' + (t.completed ? " checked" : "") + ' aria-label="Done: ' + esc(t.text) + '"></label>' +
      '<button type="button" class="sp-trow-t" data-act="task-detail" data-id="' + esc(t.id) + '"><span class="sp-trow-n">' + esc(t.text) + '</span><span class="sp-trow-s' + (over ? " sp-late" : "") + '">' + esc(A.fmtShort(t.date)) + (over ? " · overdue" : "") + (t.priority === "high" ? " · high" : "") + (t.category ? " · " + esc(t.category) : "") + '</span></button></div>' +
      '<div class="sp-inbox-btns"><button type="button" class="btn btn-secondary" data-act="link-task" data-id="' + esc(t.id) + '" aria-label="Link ' + esc(t.text) + ' to a goal">Link</button><button type="button" class="btn btn-secondary" data-act="task-schedule-go" data-id="' + esc(t.id) + '" aria-label="Schedule ' + esc(t.text) + '">Schedule</button><button type="button" class="btn btn-secondary" data-act="task-category" data-id="' + esc(t.id) + '" aria-label="Set a category for ' + esc(t.text) + '">Category</button><button type="button" class="btn btn-secondary" data-act="task-archive" data-id="' + esc(t.id) + '" aria-label="Put ' + esc(t.text) + ' away">Put away</button></div></li>';
  }
  function inboxHtml(r) {
    const ib = r.inbox;
    let h = '';
    if (!ib.all) h += '<p class="sp-dim">Nothing is waiting. Every task this month counts toward a goal' + (r.archivedCount ? " or has been put away" : "") + '.</p>';
    else if (!ib.total) h += '<p class="sp-dim">No inbox tasks match these filters (' + ib.all + ' waiting in all).</p>';
    else {
      h += '<ul class="sp-inbox">' + ib.items.map(inboxRow).join("") + '</ul>';
      if (ib.pages > 1) h += '<div class="sp-pager"><button type="button" class="btn btn-secondary" data-act="inbox-page" data-dir="-1"' + (ib.page <= 1 ? " disabled" : "") + '>Previous</button><span class="sp-dim" aria-live="polite">' + ((ib.page - 1) * ib.size + 1) + '–' + Math.min(ib.total, ib.page * ib.size) + ' of ' + ib.total + '</span><button type="button" class="btn btn-secondary" data-act="inbox-page" data-dir="1"' + (ib.page >= ib.pages ? " disabled" : "") + '>Next</button></div>';
      else h += '<p class="sp-dim">' + A.plural(ib.total, "task") + ' waiting.</p>';
    }
    if (r.archivedCount) h += '<details class="sp-away"><summary>Put away (' + r.archivedCount + ')</summary><ul class="sp-trows">' + r.archived.map(function (t) {
      return '<li class="sp-trow"><span class="sp-trow-t"><span class="sp-trow-n">' + esc(t.text) + '</span><span class="sp-trow-s">' + esc(A.fmtShort(t.date)) + '</span></span><button type="button" class="btn btn-secondary" data-act="task-restore" data-id="' + esc(t.id) + '" aria-label="Bring ' + esc(t.text) + ' back">Bring back</button></li>';
    }).join("") + '</ul></details>';
    return h;
  }
  function filterBar(r) {
    const opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + '>' + esc(label) + '</option>'; };
    return '<div class="sp-filters"><div class="form-row sp-f-search"><label for="spmq">Search this month\'s tasks</label><input type="search" id="spmq" data-mf="q" value="' + esc(mf.q) + '" placeholder="Search by name or category" autocomplete="off"></div>' +
      '<div class="sp-f-row"><div class="form-row"><label for="spmstatus">Show</label><select id="spmstatus" data-mf="status">' + opt("open", "Open", mf.status) + opt("done", "Done", mf.status) + opt("all", "All", mf.status) + '</select></div>' +
      '<div class="form-row"><label for="spmgroup">Group by</label><select id="spmgroup" data-mf="group">' + opt("milestone", "Milestone", mf.group) + opt("priority", "Priority", mf.group) + opt("category", "Category", mf.group) + '</select></div></div>' +
      '<div class="sp-f-row"><div class="form-row"><label for="spmprio">Priority</label><select id="spmprio" data-mf="priority">' + opt("", "Any", mf.priority) + opt("high", "High", mf.priority) + opt("medium", "Medium", mf.priority) + opt("low", "Low", mf.priority) + '</select></div>' +
      '<div class="form-row"><label for="spmcat">Category</label><select id="spmcat" data-mf="category">' + opt("", "Any", mf.category) + r.categories.map(function (c) { return opt(c, c, mf.category); }).join("") + '</select></div></div></div>';
  }
  function monthLists() { return window.JarvisPlanInsights.monthTaskLists(A.ictx(), state.month, mf); }
  // Only the lists are redrawn when a filter changes, so the search box keeps its focus while you type.
  function redrawLists() {
    const g = A.$("spMonthGroups"), ib = A.$("spInbox");
    if (!g || !ib) { A.render(); return; }
    const r = monthLists(), m = A.model();
    g.innerHTML = groupsHtml(r, m);
    ib.innerHTML = inboxHtml(r);
    const sum = A.$("spInboxSum"); if (sum) sum.textContent = A.plural(r.inbox.all, "task") + " waiting";
  }

  // The monthly review: a summary counted from your records, then four prompts. "Start from the summary" fills only empty boxes.
  function monthReviewHtml(mk) {
    const I = window.JarvisPlanInsights, W = window.JarvisPlanWeekLogic, rv = I.monthReview(A.ictx(), mk), rec = W.reviewOf(A.store.all("reviews"), mk), r = W.readReview(rec || { month: mk }), today = A.store.today();
    const names = function (list) { return list.map(function (n) { return n.title; }).join("; "); };
    let h = '<h4 class="sp-h4">Your month, from your records</h4><ul class="sp-sublist pw-rv-sum">' + rv.sentences.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>';
    h += '<h4 class="sp-h4">Milestones</h4>' + (rv.milestones.length ? '<ul class="sp-sublist">' + rv.milestones.map(function (n) { return '<li>' + esc(n.title) + ' ' + A.statusBadge(n.id) + '</li>'; }).join("") + '</ul>' : '<p class="sp-dim">None were set for this month.</p>');
    h += '<h4 class="sp-h4">Goals behind or at risk</h4>' + (rv.behind.length ? '<ul class="sp-sublist">' + rv.behind.map(function (n) { const p = A.model().progress(n.id); return '<li><button type="button" class="sp-link" data-act="detail" data-id="' + esc(n.id) + '">' + esc(n.title) + '</button> <span class="sp-dim">' + esc(A.typeLabel(n.type)) + ' · ' + esc(A.pctText(p.pct)) + '</span></li>'; }).join("") + '</ul>' : '<p class="sp-dim">Nothing is behind its pace.</p>');
    h += '<h4 class="sp-h4">Progress toward this quarter\'s priorities</h4>' + (rv.priorities.length ? '<ul class="sp-sublist">' + rv.priorities.map(function (p) { return '<li>' + esc(p.title) + ' <span class="sp-dim">' + esc(A.pctText(p.pct)) + '</span> ' + A.statusBadge(p.id) + '</li>'; }).join("") + '</ul>' : '<p class="sp-dim">No priorities this quarter.</p>');
    h += '<form id="spMonthReviewForm" class="pw-review-form" novalidate data-month="' + esc(mk) + '" data-wins="' + esc(rv.completed.length ? "Milestones completed: " + names(rv.completed) + "." : "") + '" data-behind="' + esc(rv.behind.length ? names(rv.behind) : "") + '" data-next="' + esc(names(rv.nextUp)) + '">' +
      '<div class="form-row"><label for="mrWins">What were your biggest wins?</label><textarea id="mrWins" name="wins" rows="3" maxlength="2000">' + esc(r.wins) + '</textarea></div>' +
      '<div class="form-row"><label for="mrBehind">Which goals fell behind, and why?</label><textarea id="mrBehind" name="fellBehind" rows="3" maxlength="2000">' + esc(r.fellBehind) + '</textarea></div>' +
      '<div class="form-row"><label for="mrProg">How is the quarter\'s progress going?</label><textarea id="mrProg" name="progress" rows="3" maxlength="2000">' + esc(r.progress) + '</textarea></div>' +
      '<div class="form-row"><label for="mrNext">What are next month\'s priorities?</label><textarea id="mrNext" name="nextFocus" rows="3" maxlength="2000">' + esc(r.nextFocus) + '</textarea>' + (rv.nextUp.length ? '<p class="field-hint">Still open or coming up: ' + esc(names(rv.nextUp)) + '.</p>' : "") + '</div>' +
      '<div class="sp-card-actions"><button type="submit" class="btn btn-primary">Save review</button><button type="button" class="btn btn-secondary" data-act="month-review-prefill">Start from the summary</button></div></form>';
    const ended = mk < today.slice(0, 7) || (mk === today.slice(0, 7) && today >= PL.addDays(PL.monthEnd(mk), -2));
    return A.section("m-review", "Monthly review", h, { open: ended && !r.reviewedAt, summary: r.reviewedAt ? "reviewed" : ended ? "ready to write" : "not written yet" });
  }

  A.register("monthly", {
    html: function () {
      const m = A.model(), mk = state.month, I = window.JarvisPlanInsights;
      let h = '<h2 class="visually-hidden">Monthly plan</h2><div class="sp-head">' + stepper(A.monthLabel(mk), "month-nav", "month-nav", "Previous month", "Next month") + '</div>';
      const late = m.overdueMilestones().filter(function (n) { return n.month === mk; });
      h += overdueBox(m, late);
      const ov = I.monthOverview(A.ictx(), mk);
      h += A.section("m-overview", "Overview", monthOverviewHtml(ov), { open: true, summary: (ov.milestones.total ? ov.milestones.done + " of " + ov.milestones.total + " milestones" : "no milestones") + " · " + (ov.tasks.total ? ov.tasks.done + " of " + ov.tasks.total + " tasks" : "no tasks") });
      const ms = m.milestonesIn(mk);
      h += A.section("m-milestones", "Milestones", (ms.length ? '<div class="sp-stack">' + ms.map(function (n) { return A.nodeCard(n, { parentLine: true }); }).join("") + '</div>' : '<p class="sp-dim">No milestones for this month yet.</p>') +
        '<button type="button" class="btn btn-secondary" data-act="add-milestone" data-month="' + esc(mk) + '">Add milestone</button>', { open: true, summary: A.plural(ms.length, "milestone") });
      const fin = m.periods("month", mk);
      h += A.section("m-finance", "Finances", financeHtml(m, mk), { open: false, summary: (fin.revenueActual === null ? "no revenue entered" : esc(A.money(fin.revenueActual)) + (fin.revenueTarget ? " of " + esc(A.money(fin.revenueTarget)) : "")) + " · " + (fin.spendActual === null ? "no spending entered" : esc(A.money(fin.spendActual)) + " spent") });
      const r = monthLists();
      h += A.section("m-tasks", "Tasks", filterBar(r) + '<div id="spMonthGroups">' + groupsHtml(r, m) + '</div>', { open: true, summary: A.plural(r.linkedCount, "linked task") });
      h += A.section("m-inbox", "Task inbox", '<p class="sp-dim">Tasks this month that don\'t count toward any goal yet. Link one, give it a time, or put it away.</p><div id="spInbox">' + inboxHtml(r) + '</div>', { open: false, summary: '<span id="spInboxSum">' + esc(A.plural(r.inbox.all, "task") + " waiting") + '</span>' });
      h += monthReviewHtml(mk);
      return h;
    }
  });

  /* ---------------- clicks ---------------- */

  A.acts["period-month"] = function (el) { A.acts["period"]({ getAttribute: function (k) { return k === "data-scope" ? "month" : k === "data-key" ? el.getAttribute("data-id") : null; } }); };
  A.acts["month-review-prefill"] = function () {
    const f = document.getElementById("spMonthReviewForm");
    if (!f) return;
    const put = function (name, value) { if (value && !String(f[name].value).trim()) f[name].value = value; };
    put("wins", f.getAttribute("data-wins"));
    put("fellBehind", f.getAttribute("data-behind") ? "Behind or at risk: " + f.getAttribute("data-behind") + "." : "");
    put("nextFocus", f.getAttribute("data-next"));
    A.say("Filled the empty boxes from your records. Edit them as you like.");
  };
  document.addEventListener("submit", function (e) {
    if (!e.target || e.target.id !== "spMonthReviewForm") return;
    e.preventDefault();
    const f = e.target, W = window.JarvisPlanWeekLogic, mk = f.getAttribute("data-month");
    const r = W.setReview(A.store.all("reviews"), mk, { wins: f.wins.value, fellBehind: f.fellBehind.value, progress: f.progress.value, nextFocus: f.nextFocus.value, reviewedAt: Date.now() }, {});
    if (!r.ok || !A.store.replace("reviews", r.reviews)) { A.saveFailed(); return; }
    A.notice("Monthly review saved.", "");
    A.render();
  });
  A.acts["inbox-page"] = function (el) { mf.page = Math.max(1, (mf.page || 1) + Number(el.getAttribute("data-dir"))); redrawLists(); };
  A.acts["task-schedule-go"] = function (el) { A.scheduleTask(el.getAttribute("data-id")); };
  A.acts["task-archive"] = function (el) {
    const id = el.getAttribute("data-id"), t = A.taskById(id);
    if (!t) return;
    const r = PL.setArchived(A.store.all("links"), id, true, {});
    if (!r.ok || !A.store.replace("links", r.links)) { A.saveFailed(); return; }
    A.notice("Put “" + t.text + "” away. It is still in your task list; the plan just stops showing it.", "Undo", function () { A.store.replace("links", PL.setArchived(A.store.all("links"), id, false, {}).links); A.render(); });
    A.render();
  };
  A.acts["task-restore"] = function (el) {
    const id = el.getAttribute("data-id");
    if (!A.store.replace("links", PL.setArchived(A.store.all("links"), id, false, {}).links)) { A.saveFailed(); return; }
    A.say("Brought back"); A.render();
  };
  A.acts["task-category"] = function (el) { A.openCategorySheet(el.getAttribute("data-id")); };
  // A category is the free text the Habits task form already has; this only writes that same field.
  A.openCategorySheet = function (taskId) {
    const t = A.taskById(taskId);
    if (!t) return;
    const cats = {}; A.tasks().forEach(function (x) { if (x && x.category) cats[x.category] = true; });
    A.openSheet({
      title: "Category", submit: "Save",
      body: '<p class="sp-dim">For “' + esc(t.text) + '”. Leave it empty to clear it.</p>' + A.fText("category", "Category", t.category || "", { max: 40, placeholder: "e.g. Gratiel, School, Personal" }) +
        '<datalist id="spCatList">' + Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("") + '</datalist>',
      onOpen: function (root) { const i = root.querySelector('[name="category"]'); if (i) i.setAttribute("list", "spCatList"); },
      onSubmit: function (v) {
        const H = window.JarvisHabits, c = String(v.category || "").replace(/\s+/g, " ").trim().slice(0, 40);
        if (!H || !H.commitTasks) return { ok: false, message: "Tasks aren't available right now." };
        H.commitTasks(A.tasks().map(function (x) { return x.id === taskId ? Object.assign({}, x, { category: c }) : x; }));
        A.say(c ? "Category saved" : "Category cleared");
        return { ok: true };
      }
    });
  };
  // the month's filters
  (function () {
    function onFilter(e) {
      const el = e.target, k = el && el.getAttribute && el.getAttribute("data-mf");
      if (!k) return;
      mf[k] = el.value; mf.page = 1;
      if (k === "q") { window.clearTimeout(onFilter.t); onFilter.t = window.setTimeout(redrawLists, 120); } else redrawLists();
    }
    document.addEventListener("input", function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute("data-mf") === "q") onFilter(e); });
    document.addEventListener("change", onFilter);
  })();
  A.acts["year-nav"] = function (el) { state.year += Number(el.getAttribute("data-dir")); A.render(); };
  A.acts["pick-quarter"] = function (el) { state.quarter = Number(el.getAttribute("data-v")); A.render(); };
  A.acts["month-nav"] = function (el) { state.month = shiftMonth(state.month, Number(el.getAttribute("data-dir"))); state.year = Number(state.month.slice(0, 4)); A.render(); };
  A.acts["open-month"] = function (el) { A.go("monthly", { month: el.getAttribute("data-v"), year: Number(el.getAttribute("data-v").slice(0, 4)) }); };
  A.acts["add-quarter-priority"] = function () { A.openNodeSheet({ type: "priority", year: state.year, quarter: state.quarter }); };
  A.acts["add-milestone"] = function (el) {
    const m = A.model(), parentId = el.getAttribute("data-parent") || "", parent = parentId ? m.node(parentId) : null;
    let month = el.getAttribute("data-month") || "";
    if (!month && parent && parent.type === "priority") month = PL.quarterMonths(parent.year, parent.quarter)[0];
    if (!month) month = state.month;
    A.openNodeSheet({ type: "milestone", year: parent ? parent.year : Number(month.slice(0, 4)), month: month, parentId: parentId });
  };
  A.acts["ms-toggle"] = function (el) {
    const id = el.getAttribute("data-id"), n = A.store.get("nodes", id);
    if (!n || !A.model().canMarkDone(id)) { A.render(); return; }
    const r = PL.setDoneAt(A.store.all("nodes"), id, el.checked, { today: A.store.today() });
    if (!A.store.replace("nodes", r.nodes)) { A.saveFailed(); return; }
    A.render();
  };
})();
