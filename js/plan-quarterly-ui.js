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
    return A.nodeCard(p, { children: rows, add: add });
  }

  function monthBlock(m, mk, q) {
    const s = m.periods("month", mk), ms = m.milestonesIn(mk);
    let h = '<section class="sp-month" aria-label="' + esc(A.monthLabel(mk)) + '"><header class="sp-month-head"><h4 class="sp-h4">' + esc(PL.monthName(mk, true)) + '</h4><span class="sp-dim">' +
      (s.revenueActual === null ? "no revenue entered" : esc(A.money(s.revenueActual)) + (s.revenueTarget ? " of " + esc(A.money(s.revenueTarget)) : "") + (s.metric === "mrr" ? " MRR" : " in sales")) + '</span></header>';
    h += ms.length ? '<ul class="sp-ms-list">' + ms.map(function (n) { return milestoneRow(m, n); }).join("") + '</ul>' : '<p class="sp-dim">No milestones for this month.</p>';
    h += '<div class="sp-card-actions"><button type="button" class="btn btn-secondary" data-act="add-milestone" data-month="' + esc(mk) + '">Add milestone</button>' +
      '<button type="button" class="btn btn-secondary" data-act="period" data-scope="month" data-key="' + esc(mk) + '">Enter ' + esc(PL.monthName(mk, false)) + ' money</button>' +
      '<button type="button" class="btn btn-secondary" data-act="open-month" data-v="' + esc(mk) + '">Open month</button></div></section>';
    return h;
  }

  function overdueBox(m, list) {
    if (!list.length) return "";
    return '<section class="sp-alert" role="region" aria-label="Overdue"><h3 class="sp-h3">' + A.plural(list.length, "item") + ' overdue</h3><ul class="sp-sublist">' + list.map(function (n) {
      return '<li><button type="button" class="sp-link" data-act="open-node" data-id="' + esc(n.id) + '">' + esc(n.title) + '</button> <span class="sp-dim">' + esc(A.typeLabel(n.type)) + ' · was due ' + esc(A.fmtShort(m.deadline(n))) + '</span></li>';
    }).join("") + '</ul></section>';
  }

  A.register("quarterly", {
    html: function () {
      const m = A.model(), year = state.year, q = state.quarter, today = A.store.today();
      const key = PL.quarterKey(year, q);
      let h = '<div class="sp-head">' + stepper(String(year), "year-nav", "year-nav", "Previous year", "Next year") + '</div>';
      h += timeline(m, year, today);
      const late = m.all("priority").concat(m.all("milestone")).filter(function (n) { return inQuarter(n, year, q) && m.health(n.id) === "overdue"; });
      h += '<h2 class="sp-h2 sp-qtitle">Q' + q + ' ' + year + ' <span class="sp-dim">' + QNAME[q] + '</span></h2>' + overdueBox(m, late);
      const pri = m.prioritiesOf(year, q), live = pri.filter(function (p) { return p.status !== "dropped"; });
      h += '<h3 class="sp-h3">Priorities <span class="sp-dim">(' + live.length + ' of ' + PL.MAX_PER_SLOT + ')</span></h3><div class="sp-stack">' + pri.map(function (p) { return priorityCard(m, p); }).join("") + '</div>';
      for (let i = live.length; i < PL.MAX_PER_SLOT; i++) h += '<button type="button" class="sp-slot" data-act="add-quarter-priority" aria-label="Add quarterly priority ' + (i + 1) + ' of ' + PL.MAX_PER_SLOT + '"><span aria-hidden="true">+</span> Add quarterly priority</button>';
      h += '<h3 class="sp-h3">Revenue, budget and hiring for the quarter</h3>' + A.periodBlock("quarter", key) +
        '<button type="button" class="btn btn-secondary" data-act="period" data-scope="quarter" data-key="' + key + '">Edit Q' + q + ' targets</button>';
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
      let h = '<div class="sp-head">' + stepper(A.monthLabel(mk), "month-nav", "month-nav", "Previous month", "Next month") + '</div>';
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
