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

  A.register("monthly", {
    html: function () {
      const m = A.model(), mk = state.month, today = A.store.today();
      let h = '<h2 class="visually-hidden">Monthly plan</h2><div class="sp-head">' + stepper(A.monthLabel(mk), "month-nav", "month-nav", "Previous month", "Next month") + '</div>';
      const late = m.overdueMilestones().filter(function (n) { return n.month === mk; });
      h += overdueBox(m, late);
      h += '<h3 class="sp-h3">Money for ' + esc(PL.monthName(mk, true)) + '</h3>' + A.periodBlock("month", mk) +
        '<button type="button" class="btn btn-secondary" data-act="period" data-scope="month" data-key="' + esc(mk) + '">Enter ' + esc(PL.monthName(mk, false)) + ' money</button>';
      const ms = m.milestonesIn(mk);
      h += '<h3 class="sp-h3">Milestones</h3>' + (ms.length ? '<div class="sp-stack">' + ms.map(function (n) { return A.nodeCard(n, {}); }).join("") + '</div>' : '<p class="sp-dim">No milestones for this month yet.</p>') +
        '<button type="button" class="btn btn-secondary" data-act="add-milestone" data-month="' + esc(mk) + '">Add milestone</button>';
      // the month's tasks: the ones counting toward the plan, then the ones that are not linked to anything
      const tasks = A.tasks().filter(function (t) { return t && typeof t.date === "string" && t.date.slice(0, 7) === mk; }).sort(function (a, b) { return a.date.localeCompare(b.date) || (a.order || 0) - (b.order || 0); });
      const linked = tasks.filter(function (t) { return m.nodeOfTask(t.id); }), loose = tasks.filter(function (t) { return !m.nodeOfTask(t.id); });
      h += '<h3 class="sp-h3">Tasks this month <span class="sp-dim">(' + linked.length + ' linked, ' + loose.length + ' not linked)</span></h3>';
      if (!tasks.length) h += '<p class="sp-dim">No tasks dated this month.</p>';
      const row = function (t) {
        const n = m.nodeOfTask(t.id);
        return '<li class="sp-task' + (t.completed ? " is-done" : "") + '"><label class="sp-task-check"><input type="checkbox" data-act="task-toggle" data-id="' + esc(t.id) + '"' + (t.completed ? " checked" : "") + '><span class="sp-task-text">' + esc(t.text) + '</span></label>' +
          '<span class="sp-task-meta">' + esc(A.fmtShort(t.date)) + (n ? " · " + esc(n.title) : "") + '</span><button type="button" class="btn btn-secondary sp-task-unlink" data-act="link-task" data-id="' + esc(t.id) + '" aria-label="' + (n ? "Change the link of " : "Link ") + esc(t.text) + '">' + (n ? "Change" : "Link") + '</button></li>';
      };
      if (linked.length) h += '<h4 class="sp-h4">Counting toward the plan</h4><ul class="sp-tasks">' + linked.map(row).join("") + '</ul>';
      if (loose.length) h += '<h4 class="sp-h4">Not linked to anything</h4><ul class="sp-tasks">' + loose.slice(0, 60).map(row).join("") + '</ul>' + (loose.length > 60 ? '<p class="sp-dim">Showing the first 60.</p>' : "");
      void today;
      return h;
    }
  });

  /* ---------------- clicks ---------------- */

  A.acts["period-month"] = function (el) { A.acts["period"]({ getAttribute: function (k) { return k === "data-scope" ? "month" : k === "data-key" ? el.getAttribute("data-id") : null; } }); };
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
