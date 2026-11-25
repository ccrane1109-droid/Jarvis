/* ==========================================================================
   JARVIS — Strategic Planning Center: the Insights tab.

   Four sections: how far each goal has got, how well the work is getting done, where the time goes, and the money. Every figure
   is counted by plan-insights-logic.js from your own records (tasks, links, blocks, hours you logged, workouts, the money you
   entered). Where something hasn't been tracked it says "not tracked" instead of showing 0. Charts come from plan-charts.js.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, I = window.JarvisPlanInsights, Ch = window.JarvisPlanCharts, esc = A.esc, store = A.store, state = A.state;

  function hText(min) { return min === null || min === undefined ? "not tracked" : (Math.round(min / 6) / 10) + " h"; }
  function hNum(min) { return min === null || min === undefined ? null : Math.round(min / 6) / 10; }
  function hFmt(v) { return (Math.round(v * 10) / 10) + " h"; }
  function weekLabel(ws) { return PL.monthName(ws.slice(0, 7), false) + " " + Number(ws.slice(8)); }
  function pctFmt(v) { return Math.round(v) + "%"; }
  function moneyTick(v, axis) { return axis && v >= 10000 ? "$" + (Math.round(v / 100) / 10) + "K" : A.money(v); }
  function tile(label, value, sub, o) {
    o = o || {};
    return '<div class="sp-tile' + (o.tone ? " sp-tone-" + o.tone : "") + '"><span class="sp-tile-l">' + esc(label) + '</span><span class="sp-tile-v">' + value + '</span>' + (o.pct === undefined || o.pct === null ? "" : A.bar(o.pct, label, o.health || "ontrack")) + (sub ? '<span class="sp-tile-s">' + sub + '</span>' : "") + '</div>';
  }
  const NA = '<span class="sp-dim">–</span>';

  /* ---------------- goal progress ---------------- */

  function goalRows(list, empty) {
    if (!list.length) return '<p class="sp-dim">' + esc(empty) + '</p>';
    return '<ul class="sp-prows">' + list.map(function (r) {
      return '<li><button type="button" class="sp-prow" data-act="detail" data-id="' + esc(r.id) + '"><span class="sp-prow-t">' + esc(r.title) + '</span><span class="sp-prow-p">' + esc(A.pctText(r.pct)) + '</span>' + A.bar(r.pct, r.title + " progress", A.model().health(r.id)) + '<span class="sp-prow-s">' + A.statusBadge(r.id) + '<span class="sp-dim">' + esc(r.note) + '</span></span></button></li>';
    }).join("") + '</ul>';
  }
  function goalSection(ic) {
    const g = I.goalProgress(ic), d = I.dashboard(ic), m = A.model(), today = store.today();
    const y = Number(today.slice(0, 4)), q = PL.quarterOfDate(today), mk = PL.monthOfDate(today);
    let h = '<div class="sp-tiles sp-tiles-3">' + tile("This year", d.overall.year === null ? '<span class="sp-dim">no data</span>' : d.overall.year + "%", y + " objectives", { pct: d.overall.year }) +
      tile("3-year", d.overall.threeYear === null ? '<span class="sp-dim">no data</span>' : d.overall.threeYear + "%", "all three years", { pct: d.overall.threeYear }) +
      tile("This month", d.monthStats.milestones ? d.monthStats.milestonesDone + "/" + d.monthStats.milestones : '<span class="sp-dim">none</span>', "milestones done") + '</div>';
    h += '<h4 class="sp-h4">Yearly objectives, ' + y + '</h4>' + goalRows(g.objectives, "No objectives for this year yet.");
    h += '<h4 class="sp-h4">Quarterly priorities, Q' + q + '</h4>' + goalRows(g.priorities, "No priorities for this quarter yet.");
    h += '<h4 class="sp-h4">Monthly milestones, ' + esc(PL.monthName(mk, false)) + '</h4>' + goalRows(g.milestones, "No milestones for this month yet.");
    void m;
    return A.section("in-goals", "Goal progress", h, { open: true, summary: d.overall.year === null ? "no data yet" : "this year " + d.overall.year + "%" });
  }

  /* ---------------- execution ---------------- */

  function executionSection(ic) {
    const series = I.weeklySeries(ic, 8), cur = series[series.length - 1], late = I.overdueCount(ic);
    const past = series.filter(function (s) { return !s.future && s.rate !== null; });
    const avg = past.length ? Math.round(past.reduce(function (sum, s) { return sum + s.rate; }, 0) / past.length) : null;
    const labels = series.map(function (s) { return weekLabel(s.weekStart); });
    let h = '<div class="sp-tiles">' + tile("Done this week", cur.total ? cur.done + "/" + cur.total : '<span class="sp-dim">none</span>', cur.rate === null ? "no tasks dated" : cur.rate + "%", { pct: cur.rate }) +
      tile("Average", avg === null ? NA : avg + "%", avg === null ? "not enough weeks" : "of " + A.plural(past.length, "week") + " with tasks") +
      tile("Overdue", late, late ? "tasks still open" : "none open", { tone: late ? "red" : "" }) +
      tile("Hours", cur.plannedMin ? esc(hText(cur.plannedMin)) : NA, cur.loggedMin === null ? "none logged" : esc(hText(cur.loggedMin)) + " worked") + '</div>';
    h += Ch.line({ title: "Weekly completion rate", summary: "Share of tasks done in each of the last 8 weeks. " + series.map(function (s, i) { return labels[i] + ": " + (s.rate === null ? "no tasks" : s.rate + "%"); }).join("; ") + ".", labels: labels, format: pctFmt, height: 180,
      emptyText: "No tasks were dated in the last 8 weeks, so there is no rate to draw.", series: [{ name: "Tasks done", color: "var(--viz-1)", values: series.map(function (s) { return s.rate; }) }] });
    h += Ch.bars({ title: "Hours planned and worked, by week", summary: "Hours planned in blocks and hours logged, for each of the last 8 weeks.", labels: labels, format: function (v) { return hFmt(v); }, height: 190,
      emptyText: "No blocks were planned in the last 8 weeks.", series: [{ name: "Planned", color: "var(--viz-1)", values: series.map(function (s) { return s.plannedMin ? hNum(s.plannedMin) : null; }) }, { name: "Worked", color: "var(--viz-2)", values: series.map(function (s) { return hNum(s.loggedMin); }) }] });
    h += '<p class="sp-dim sp-ins-note">A week with no tasks has no rate (a gap in the line, not 0%). “Worked” is only the time you logged on blocks, plus workout sessions you logged in Workouts, counted once.</p>';
    try {
      const F = window.JarvisFocus, PLg = window.JarvisPlanLogic;
      if (F && F.totals && PLg && cur.weekStart) {
        const wk = F.totals(cur.weekStart, PLg.addDays(cur.weekStart, 6)), all = F.totals(PLg.addDays(cur.weekStart, -49), PLg.addDays(cur.weekStart, 6));
        if (all.sessions) h += '<p class="sp-ins-note">Focus timer: ' + (wk.sessions ? esc(hText(wk.minutes)) + " in " + A.plural(wk.sessions, "session") + " this week" : "no sessions this week") + " · " + esc(hText(all.minutes)) + " in " + A.plural(all.sessions, "session") + " over the last 8 weeks. Kept apart from “Worked”, so time you also logged on a block is not counted twice.</p>";
      }
    } catch (e) { /* the focus log is optional here */ }
    return A.section("in-exec", "Execution", h, { open: true, summary: cur.rate === null ? "no tasks this week" : cur.rate + "% done this week" + (late ? " · " + late + " overdue" : "") });
  }

  /* ---------------- time ---------------- */

  function timeSection(ic) {
    const ws = ic.weekStart, now = I.timeAllocation(ic, ws), total = now.plannedMin;
    const kind = I.KIND_GROUPS.some(function (g) { return g[0] === state.insKind; }) ? state.insKind : "gratiel", label = I.KIND_GROUPS.filter(function (g) { return g[0] === kind; })[0][1];
    let h = '<p class="sp-dim">This week, ' + esc(weekLabel(ws)) + ' onwards.</p>';
    if (!total) h += '<p class="sp-dim">No time is planned in blocks this week yet.</p>';
    else h += '<ul class="sp-alloc">' + now.groups.filter(function (g) { return g.plannedMin > 0 || g.loggedMin !== null; }).map(function (g) {
      const share = total ? Math.round(100 * g.plannedMin / total) : 0;
      return '<li><span class="sp-alloc-name">' + esc(g.label) + '</span><span class="sp-alloc-n">' + esc(hText(g.plannedMin)) + ' planned · ' + (g.loggedMin === null ? '<span class="sp-dim">worked: not tracked</span>' : esc(hText(g.loggedMin)) + ' worked') + ' · ' + share + '%</span>' + A.bar(share, g.label + " share of planned time", "ontrack") + '</li>';
    }).join("") + '</ul>';
    h += '<div class="form-row sp-ins-pick"><label for="spInsKind">Trend for</label><select id="spInsKind" data-ins="kind">' + I.KIND_GROUPS.map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === kind ? " selected" : "") + '>' + esc(g[1]) + '</option>'; }).join("") + '</select></div>';
    const series = I.allocationSeries(ic, 8, kind), labels = series.map(function (s) { return weekLabel(s.weekStart); });
    h += Ch.bars({ title: label + ": hours planned and worked, last 8 weeks", summary: label + " hours by week. " + series.map(function (s, i) { return labels[i] + ": planned " + hText(s.plannedMin) + ", worked " + hText(s.loggedMin); }).join("; ") + ".", labels: labels, format: function (v) { return hFmt(v); }, height: 190,
      emptyText: "Nothing is planned or logged for " + label.toLowerCase() + " in the last 8 weeks.", series: [{ name: "Planned", color: "var(--viz-1)", values: series.map(function (s) { return s.plannedMin ? hNum(s.plannedMin) : null; }) }, { name: "Worked", color: "var(--viz-2)", values: series.map(function (s) { return hNum(s.loggedMin); }) }] });
    return A.section("in-time", "Time allocation", h, { open: true, summary: total ? hText(total) + " planned this week" : "nothing planned this week" });
  }

  /* ---------------- money ---------------- */

  function moneySection() {
    const m = A.model(), today = store.today(), mk = PL.monthOfDate(today), year = Number(today.slice(0, 4));
    const mo = m.periods("month", mk), rec = PL.periodOf(store.all("periods"), "month", mk) || {}, yr = m.periods("year", String(year));
    const budget = rec.budget === undefined ? null : rec.budget, left = budget !== null && mo.spendActual !== null ? budget - mo.spendActual : null;
    const months = I.lastMonths(mk, 6), fin = I.financeSeries(store.all("periods"), months);
    let h = '<div class="sp-tiles sp-tiles-3">' + tile(PL.monthName(mk, false) + " revenue", mo.revenueActual === null ? '<span class="sp-dim">not entered</span>' : esc(A.money(mo.revenueActual)), mo.revenueTarget ? "target " + esc(A.money(mo.revenueTarget)) : "no target set") +
      tile(PL.monthName(mk, false) + " spent", mo.spendActual === null ? '<span class="sp-dim">not entered</span>' : esc(A.money(mo.spendActual)), budget !== null ? "budget " + esc(A.money(budget)) : "no budget set") +
      tile("Budget left", left === null ? NA : esc(A.money(left)), left === null ? (budget === null ? "set a budget" : "enter spending") : left < 0 ? "over budget" : "this month", { tone: left !== null && left < 0 ? "red" : "" }) + '</div>';
    h += '<div class="sp-tiles sp-tiles-3">' + tile(year + " revenue", yr.revenueActual === null ? '<span class="sp-dim">not entered</span>' : esc(A.money(yr.revenueActual)), yr.revenueTarget ? "of " + esc(A.money(yr.revenueTarget)) + (yr.revenueActual === null ? "" : " · " + Math.round(100 * yr.revenueActual / yr.revenueTarget) + "%") : "no target set", { pct: yr.revenueTarget && yr.revenueActual !== null ? Math.round(100 * yr.revenueActual / yr.revenueTarget) : null }) +
      tile(year + " spent", yr.spendActual === null ? '<span class="sp-dim">not entered</span>' : esc(A.money(yr.spendActual)), yr.budget ? "of " + esc(A.money(yr.budget)) : "no budget set", { pct: yr.budget && yr.spendActual !== null ? Math.round(100 * yr.spendActual / yr.budget) : null, health: yr.overBudget ? "over" : "ontrack" }) +
      tile("Budget left", yr.budget !== null && yr.spendActual !== null ? esc(A.money(yr.budget - yr.spendActual)) : NA, yr.budget === null ? "set a yearly budget" : yr.spendActual === null ? "enter spending" : "this year") + '</div>';
    h += Ch.line({ title: "Revenue, last 6 months", summary: "Revenue by month. " + fin.map(function (r, i) { return PL.monthName(months[i], false) + ": " + (r.revenue === null ? "not entered" : A.money(r.revenue)); }).join("; ") + ".", labels: months.map(function (x) { return PL.monthName(x, false); }), format: moneyTick, height: 180,
      emptyText: "No revenue has been entered for these months.", series: [{ name: "Revenue", color: "var(--viz-1)", values: fin.map(function (r) { return r.revenue; }) }] });
    h += Ch.bars({ title: "Spending, last 6 months", summary: "Spending by month. " + fin.map(function (r, i) { return PL.monthName(months[i], false) + ": " + (r.spend === null ? "not entered" : A.money(r.spend)); }).join("; ") + ".", labels: months.map(function (x) { return PL.monthName(x, false); }), format: moneyTick, height: 170,
      emptyText: "No spending has been entered for these months.", series: [{ name: "Spending", color: "var(--viz-2)", values: fin.map(function (r) { return r.spend; }) }] });
    h += '<p class="sp-dim sp-ins-note">Money is only what you enter under Monthly. A month you didn\'t enter is a gap, not $0.</p>';
    return A.section("in-money", "Financial", h, { open: true, summary: mo.revenueActual === null ? "no revenue entered this month" : esc(A.money(mo.revenueActual)) + " revenue this month" });
  }

  A.register("insights", {
    html: function () {
      const ic = A.ictx();
      let h = '<h2 class="sp-h2" data-focus-top>Insights</h2><p class="sp-dim">Counted from your own goals, tasks, time blocks and the money you enter. Nothing is estimated, and anything you haven\'t tracked says so.</p>';
      h += goalSection(ic) + executionSection(ic) + timeSection(ic) + moneySection();
      return h;
    },
    change: function (el) { if (el.matches && el.matches('[data-ins="kind"]')) { state.insKind = el.value; A.render(); } }
  });
})();
