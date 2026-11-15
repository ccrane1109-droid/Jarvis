/* ==========================================================================
   JARVIS — Strategic Planning Center: the Yearly view, a three-year roadmap.

   Year 1, Year 2 and Year 3 side by side (on a phone: swipe across), each with up to three yearly objectives, its revenue and
   budget targets, and optional hiring goals. Progress is shown on each objective and for each year; the line across the top
   shows how far each year has got. Every figure is from the plan's own records (see plan-logic.js).
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, esc = A.esc;

  function yearProgress(m, year) {
    const list = m.objectivesOf(year).filter(function (o) { return o.status !== "dropped"; });
    const known = list.map(function (o) { return m.progress(o.id).pct; }).filter(function (p) { return p !== null; });
    return { count: list.length, pct: known.length ? Math.round(known.reduce(function (s, p) { return s + Math.min(100, p); }, 0) / known.length) : null, known: known.length };
  }

  function priorityRows(m, obj) {
    const kids = m.children(obj.id).filter(function (k) { return k.type === "priority"; });
    if (!kids.length) return '<p class="sp-dim">No quarterly priorities under this yet.</p>';
    return '<h4 class="sp-h4">Quarterly priorities under it</h4><ul class="sp-sublist">' + kids.map(function (k) {
      const p = m.progress(k.id), h = m.health(k.id);
      return '<li><button type="button" class="sp-link" data-act="open-node" data-id="' + esc(k.id) + '">Q' + k.quarter + ' · ' + esc(k.title) + '</button> <span class="sp-dim">' + esc(p.pct === null ? p.note : p.pct + "%") + '</span> ' + A.healthBadge(h) + '</li>';
    }).join("") + '</ul>';
  }

  function yearColumn(m, year, index, today) {
    const objs = m.objectivesOf(year), live = objs.filter(function (o) { return o.status !== "dropped"; });
    const yp = yearProgress(m, year), isNow = String(year) === today.slice(0, 4);
    let h = '<section class="sp-year' + (isNow ? " is-now" : "") + '" aria-labelledby="spYearH' + year + '"><header class="sp-year-head"><h2 id="spYearH' + year + '" class="sp-year-title">Year ' + (index + 1) + ' <span class="sp-year-num">' + year + '</span></h2>' + (isNow ? A.badge("accent", "This year") : "") + '</header>';
    h += '<p class="sp-year-pct">' + (yp.pct === null ? "No progress to show yet" : yp.pct + "% across " + A.plural(yp.known, "objective")) + '</p>' + A.bar(yp.pct, "Year " + year + " progress", yp.pct === null ? "" : "ontrack");
    h += '<h3 class="sp-h3">Objectives <span class="sp-dim">(' + live.length + ' of ' + PL.MAX_PER_SLOT + ')</span></h3>';
    h += '<div class="sp-stack">' + objs.map(function (o) {
      return A.nodeCard(o, { children: priorityRows(m, o), add: '<button type="button" class="btn btn-secondary" data-act="add-priority" data-id="' + esc(o.id) + '">Add quarterly priority</button>' });
    }).join("") + '</div>';
    for (let i = live.length; i < PL.MAX_PER_SLOT; i++) {
      h += '<button type="button" class="sp-slot" data-act="add-objective" data-year="' + year + '" aria-label="Add yearly objective ' + (i + 1) + ' of ' + PL.MAX_PER_SLOT + ' for ' + year + '"><span aria-hidden="true">+</span> Add yearly objective</button>';
    }
    h += '<h3 class="sp-h3">Revenue, budget and hiring</h3>' + A.periodBlock("year", String(year)) +
      '<button type="button" class="btn btn-secondary" data-act="period" data-scope="year" data-key="' + year + '">Edit ' + year + ' targets</button>';
    return h + '</section>';
  }

  function railItem(m, year, index, today) {
    const yp = yearProgress(m, year);
    return '<li class="sp-rail-item"><span class="sp-rail-label">Year ' + (index + 1) + ' · ' + year + '</span><span class="sp-rail-pct">' + (yp.pct === null ? "no data yet" : yp.pct + "%") + '</span>' + A.bar(yp.pct, "Year " + year + " progress", yp.pct === null ? "" : "ontrack") + '<span class="sp-rail-sub">' + A.plural(yp.count, "objective") + '</span></li>';
  }

  function goalsPanel(m) {
    const goals = A.goals().filter(function (g) { return !m.all("objective").concat(m.all("priority"), m.all("milestone")).some(function (n) { return n.measure === "goal" && n.goalId === g.id; }); });
    if (!goals.length) return "";
    return '<section class="sp-panel"><h2 class="sp-h2">Your personal goals</h2><p class="sp-dim">These are the goals you already track under Habits → Goals. They are unchanged. Add one to the plan to follow its progress here.</p>' +
      '<ul class="sp-sublist">' + goals.slice(0, 12).map(function (g) {
        const pct = m.goalPct(g);
        return '<li><span>' + esc(g.name) + '</span> <span class="sp-dim">' + (pct === null ? "no progress set" : pct + "%") + '</span> <button type="button" class="btn btn-secondary" data-act="adopt-goal" data-id="' + esc(g.id) + '" aria-label="Add the goal ' + esc(g.name) + ' to the plan">Add to plan</button></li>';
      }).join("") + '</ul></section>';
  }

  A.register("yearly", {
    html: function () {
      const m = A.model(), s = m.settings, years = PL.planYears(s), today = A.store.today();
      let h = '<div class="sp-head"><div><h2 class="sp-h2" data-focus-top>Three-year roadmap</h2></div><div class="sp-head-btns"><button type="button" class="btn btn-secondary" data-act="plan-settings">Plan settings</button></div></div>';
      h += '<section class="sp-vision"><h3 class="sp-h3">Your vision</h3>' + (s.vision ? '<p class="sp-vision-text">' + esc(s.vision) + '</p>' : '<p class="sp-dim">Write where you want to be in three years. It stays at the top of your roadmap.</p>') +
        '<button type="button" class="btn btn-secondary" data-act="plan-settings">' + (s.vision ? "Edit vision" : "Write your vision") + '</button></section>';
      h += '<ol class="sp-rail" aria-label="Progress from Year 1 to Year 3">' + years.map(function (y, i) { return railItem(m, y, i, today); }).join("") + '</ol>';
      h += '<div class="sp-roadmap" role="group" aria-label="Year 1 to Year 3, swipe sideways on a phone" tabindex="0">' + years.map(function (y, i) { return yearColumn(m, y, i, today); }).join("") + '</div>';
      h += goalsPanel(m);
      return h;
    }
  });

  A.acts["add-objective"] = function (el) { A.openNodeSheet({ type: "objective", year: Number(el.getAttribute("data-year")) }); };
  A.acts["add-priority"] = function (el) {
    const o = A.model().node(el.getAttribute("data-id"));
    if (!o) return;
    const today = A.store.today(), q = String(o.year) === today.slice(0, 4) ? PL.quarterOfDate(today) : 1;
    A.openNodeSheet({ type: "priority", year: o.year, quarter: q, parentId: o.id });
  };
  A.acts["adopt-goal"] = function (el) {
    const g = A.goals().filter(function (x) { return x.id === el.getAttribute("data-id"); })[0];
    if (!g) return;
    const s = A.store.settings(), thisYear = Number(A.store.today().slice(0, 4));
    A.openNodeSheet({ type: "objective", year: PL.planYears(s).indexOf(thisYear) !== -1 ? thisYear : s.startYear, measure: "goal", goalId: g.id, title: g.name });
  };
})();
