/* ==========================================================================
   JARVIS — Strategic Planning Center: what it adds to Home and Business.

   Home gets a small "Today's focus" card: the few open tasks that matter most today (the same ranking the weekly top three uses, shown
   with the goal each one serves), and how far this year and this quarter's priorities have got. Business gets a "Business goals" card:
   the money goals you set, this month's revenue against its target, and the time and tasks going to Gratiel this week. Both only read
   the plan; ticking a task goes through the same place everything else does (Habits), so nothing can disagree.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, I = window.JarvisPlanInsights, esc = A.esc, store = A.store;
  function $(id) { return document.getElementById(id); }
  function hText(min) { return min === null || min === undefined ? "not tracked" : (Math.round(min / 6) / 10) + " h"; }

  /* ---------------- Home ---------------- */

  function renderHome() {
    const card = $("hmPlanCard"), body = $("hmPlanBody");
    if (!card || !body) return;
    const ic = A.ictx(), d = I.dashboard(ic), m = A.model(), today = store.today();
    const picks = I.rankTasks(ic).filter(function (r) { return !r.task.completed && r.task.date <= today; }).slice(0, 3);
    const hasPlan = m.all().length > 0 || !!store.settings().vision;
    if (!hasPlan && !picks.length) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    let h = "";
    if (picks.length) h += '<ul class="hm-plan-list">' + picks.map(function (r) {
      const t = r.task, chain = r.chain, last = chain[chain.length - 1], late = t.date < today;
      return '<li><label class="hm-plan-check"><input type="checkbox" data-hm-plan="tick" data-id="' + esc(t.id) + '" aria-label="Done: ' + esc(t.text) + '"></label><span class="hm-plan-main"><span class="hm-plan-t">' + esc(t.text) + '</span><span class="hm-plan-s' + (late ? " is-late" : "") + '">' + (late ? "overdue · " : "") + (last ? esc(last.title) : "not tied to a goal") + '</span></span></li>';
    }).join("") + '</ul>';
    else h += '<p class="hm-plan-none">Nothing open is due today.</p>';
    if (hasPlan) h += '<div class="hm-plan-prog">' +
      '<div><span class="hm-plan-l">This year</span><span class="hm-plan-v">' + (d.overall.year === null ? "no data" : d.overall.year + "%") + '</span>' + A.bar(d.overall.year, "This year's progress", "ontrack") + '</div>' +
      '<div><span class="hm-plan-l">Q' + d.quarter + ' priorities</span><span class="hm-plan-v">' + (d.priorities.length ? (function () { const ks = d.priorities.map(function (n) { return m.progress(n.id).pct; }).filter(function (v) { return v !== null; }); return ks.length ? Math.round(ks.reduce(function (s, v) { return s + Math.min(100, v); }, 0) / ks.length) + "%" : "no data"; })() : "none") + '</span></div></div>';
    body.innerHTML = h;
  }

  /* ---------------- Business ---------------- */

  function renderBusiness() {
    const host = $("bzGoals");
    if (!host) return;
    const ic = A.ictx(), m = A.model(), today = store.today(), year = Number(today.slice(0, 4)), mk = PL.monthOfDate(today);
    const money = m.all().filter(function (n) { return n.status === "active" && (n.measure === "revenue" || n.measure === "budget") && (n.year === year); });
    const mo = m.periods("month", mk), ws = ic.weekStart, dates = ic.tasks.filter(function (t) { return t && PL.isDate(t.date) && t.date >= ws && t.date <= PL.addDays(ws, 6) && !PL.isArchived(ic.links, t.id); });
    const gr = I.gratielMinutes(ic, ws, PL.addDays(ws, 6));
    const gratielTasks = dates.filter(function (t) { return /gratiel|business|brand|clothing/i.test(String(t.category || "")); });
    const counting = dates.filter(function (t) { return m.nodeOfTask(t.id); });
    if (!money.length && mo.revenueActual === null && !gratielTasks.length && !(gr.plannedMin > 0)) { host.classList.add("hidden"); return; }
    host.classList.remove("hidden");
    let h = '<div class="card-title-row"><h2 class="card-title" id="bzGoalsTitle">Business goals</h2><button type="button" class="btn btn-secondary" data-open-strategy>Open Strategy</button></div><p class="field-hint">From your plan in Strategy: only the money you entered there and the tasks and time you logged.</p>';
    h += '<ul class="bz-goal-list">' + money.map(function (n) {
      const p = m.progress(n.id);
      return '<li><span class="bz-goal-t">' + esc(n.title) + '</span><span class="bz-goal-p">' + esc(A.pctText(p.pct)) + '</span>' + A.bar(p.pct, n.title, m.health(n.id)) + '<span class="bz-goal-n">' + esc(p.note) + '</span></li>';
    }).join("") + '</ul>';
    h += '<dl class="bz-facts"><div><dt>' + esc(PL.monthName(mk, false)) + ' revenue</dt><dd>' + (mo.revenueActual === null ? "not entered" : esc(A.money(mo.revenueActual)) + (mo.revenueTarget ? " of " + esc(A.money(mo.revenueTarget)) : "")) + '</dd></div>' +
      '<div><dt>Gratiel time this week</dt><dd>' + (gr.plannedMin === null ? "no Gratiel category" : esc(hText(gr.plannedMin)) + " planned · " + (gr.loggedMin === null ? "none logged" : esc(hText(gr.loggedMin)) + " logged")) + '</dd></div>' +
      '<div><dt>Tasks counting toward a goal</dt><dd>' + (dates.length ? counting.filter(function (t) { return t.completed; }).length + " of " + counting.length + " done this week" : "no tasks this week") + '</dd></div>' +
      (gratielTasks.length ? '<div><dt>Tasks marked Gratiel or business</dt><dd>' + gratielTasks.filter(function (t) { return t.completed; }).length + " of " + gratielTasks.length + ' done this week</dd></div>' : "") + '</dl>';
    host.innerHTML = h;
  }

  // A.bump() first: the plan's progress is kept until something changes, and the first one is worked out at page load,
  // before the tasks it counts have loaded, so Home used to start with lower numbers than the Strategy tab shows.
  function refresh() { try { A.bump(); renderHome(); renderBusiness(); } catch (e) { if (window.console) console.error(e); } }

  document.addEventListener("change", function (e) {
    const el = e.target;
    if (!el || !el.getAttribute || el.getAttribute("data-hm-plan") !== "tick") return;
    A.toggleTask(el.getAttribute("data-id"));
    refresh();
  });
  document.addEventListener("jarvis-tasks-changed", refresh);
  document.addEventListener("jarvis-habits-day-changed", refresh);
  store.subscribe(function () { A.bump(); refresh(); });
  ["navBtnHome", "navBtnBusiness"].forEach(function (id) { const b = $(id); if (b) b.addEventListener("click", function () { window.setTimeout(refresh, 0); }); });
  document.addEventListener("jarvis-ready-to-start", function () { window.setTimeout(refresh, 400); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { window.setTimeout(refresh, 0); }); else window.setTimeout(refresh, 0);
  window.JarvisPlanApp.refreshOutside = refresh;
})();
