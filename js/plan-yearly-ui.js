/* ==========================================================================
   JARVIS — Strategic Planning Center: the Yearly view, a three-year roadmap.

   A horizontal timeline across the top (Year 1 → Year 3: the theme of each year and how far it has got), then one collapsible
   section per year with its theme, planned against actual, up to three objectives, and the revenue and budget targets. Each
   objective shows the quarterly priorities that feed it and how much each one counts for. Every figure is from the plan's own
   records (see plan-logic.js); nothing is estimated.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, esc = A.esc, store = A.store;

  function yearProgress(m, year) {
    const list = m.objectivesOf(year).filter(function (o) { return o.status !== "dropped"; });
    const known = list.map(function (o) { return m.progress(o.id).pct; }).filter(function (p) { return p !== null; });
    return { count: list.length, pct: known.length ? Math.round(known.reduce(function (s, p) { return s + Math.min(100, p); }, 0) / known.length) : null, known: known.length };
  }
  // Planned against actual for a whole year: the share of the year that has passed, next to the average progress of its objectives.
  function yearPace(year, pct, today) {
    const start = year + "-01-01", end = year + "-12-31", span = Math.max(1, PL.diffDays(start, end));
    const state = today < start ? "before" : today > end ? "after" : "during";
    const expected = state === "before" ? 0 : state === "after" ? 100 : Math.round(100 * PL.diffDays(start, today) / span);
    return { expected: expected, actual: pct, gap: pct === null ? null : pct - expected, start: start, end: end, state: state };
  }

  // The priorities under an objective and what each one contributes to it.
  function priorityRows(m, obj) {
    const kids = m.children(obj.id).filter(function (k) { return k.type === "priority"; });
    if (!kids.length) return '<p class="sp-dim">No quarterly priorities under this yet.</p>';
    const parts = m.progress(obj.id).parts, wsum = parts.reduce(function (s, x) { return s + x.weight; }, 0);
    return '<h4 class="sp-h4">Quarterly priorities that feed it</h4><ul class="sp-sublist sp-contrib">' + kids.map(function (k) {
      const p = m.progress(k.id), h = m.health(k.id), part = parts.filter(function (x) { return x.kind === "node" && x.id === k.id; })[0];
      const counts = k.status === "dropped" ? "dropped, not counted" : part ? "counts " + part.weight + " of " + wsum : k.measure !== "tasks" ? "tracked by " + (k.measure === "revenue" ? "revenue" : k.measure === "budget" ? "spending" : "its number") + ", not averaged in" : "not counted yet (nothing to measure)";
      return '<li><button type="button" class="sp-link" data-act="open-node" data-id="' + esc(k.id) + '">Q' + k.quarter + ' · ' + esc(k.title) + '</button> <span class="sp-dim">' + esc(p.pct === null ? p.note : p.pct + "%") + ' · ' + esc(counts) + '</span> ' + A.healthBadge(h) + '</li>';
    }).join("") + '</ul>';
  }

  function themeOf(year) { return (store.settings().themes || {})[String(year)] || ""; }

  function timelineItem(m, year, index, today) {
    const yp = yearProgress(m, year), isNow = String(year) === today.slice(0, 4), theme = themeOf(year);
    return '<li class="sp-rail-item' + (isNow ? " is-now" : "") + '"><button type="button" class="sp-rail-btn" data-act="year-jump" data-year="' + year + '" aria-label="Go to ' + year + (isNow ? ", this year" : "") + '">' +
      '<span class="sp-rail-dot" aria-hidden="true"></span>' +
      '<span class="sp-rail-label">Year ' + (index + 1) + ' · ' + year + '</span><span class="sp-rail-pct">' + (yp.pct === null ? "no data yet" : yp.pct + "%") + '</span>' + A.bar(yp.pct, "Year " + year + " progress", yp.pct === null ? "" : "ontrack") +
      '<span class="sp-rail-theme' + (theme ? "" : " is-empty") + '">' + esc(theme || "No theme yet") + '</span><span class="sp-rail-sub">' + A.plural(yp.count, "objective") + (isNow ? " · now" : "") + '</span></button></li>';
  }

  function yearSection(m, year, index, today, firstOpen) {
    const objs = m.objectivesOf(year), live = objs.filter(function (o) { return o.status !== "dropped"; });
    const yp = yearProgress(m, year), isNow = String(year) === today.slice(0, 4), theme = themeOf(year);
    let b = '<p class="sp-theme"><span class="sp-theme-l">Theme</span> ' + (theme ? '<strong>' + esc(theme) + '</strong>' : '<span class="sp-dim">none yet. A word or phrase for the year, like “Launch” or “Build the base”.</span>') + ' <button type="button" class="sp-link" data-act="year-theme" data-year="' + year + '">' + (theme ? "Change" : "Set a theme") + '</button></p>';
    b += A.paceBars(yearPace(year, yp.pct, today), yp.pct === null ? "" : "ontrack");
    b += '<h4 class="sp-h4">Objectives <span class="sp-dim">(' + live.length + ' of ' + PL.MAX_PER_SLOT + ')</span></h4>';
    b += '<div class="sp-stack">' + objs.map(function (o) {
      return A.nodeCard(o, { children: priorityRows(m, o), add: '<button type="button" class="btn btn-secondary" data-act="add-priority" data-id="' + esc(o.id) + '">Add quarterly priority</button>' });
    }).join("") + '</div>';
    for (let i = live.length; i < PL.MAX_PER_SLOT; i++) {
      b += '<button type="button" class="sp-slot" data-act="add-objective" data-year="' + year + '" aria-label="Add yearly objective ' + (i + 1) + ' of ' + PL.MAX_PER_SLOT + ' for ' + year + '"><span aria-hidden="true">+</span> Add yearly objective</button>';
    }
    b += '<h4 class="sp-h4">Revenue, budget and hiring</h4>' + A.periodBlock("year", String(year)) +
      '<button type="button" class="btn btn-secondary" data-act="period" data-scope="year" data-key="' + year + '">Edit ' + year + ' targets</button>';
    const sum = (yp.pct === null ? "no data yet" : yp.pct + "%") + " · " + A.plural(yp.count, "objective") + (theme ? " · " + esc(theme) : "");
    return '<div class="sp-year' + (isNow ? " is-now" : "") + '" id="spYear' + year + '">' + A.section("yr-" + year, "Year " + (index + 1) + " · " + year + (isNow ? " (this year)" : ""), b, { open: isNow || firstOpen, summary: sum }) + '</div>';
  }

  function goalsPanel(m) {
    const goals = A.goals().filter(function (g) { return !m.all("objective").concat(m.all("priority"), m.all("milestone")).some(function (n) { return n.measure === "goal" && n.goalId === g.id; }); });
    if (!goals.length) return "";
    return A.section("yr-goals", "Your personal goals", '<p class="sp-dim">These are the goals you already track under Habits → Goals. They are unchanged. Add one to the plan to follow its progress here.</p>' +
      '<ul class="sp-sublist">' + goals.slice(0, 12).map(function (g) {
        const pct = m.goalPct(g);
        return '<li><span>' + esc(g.name) + '</span> <span class="sp-dim">' + (pct === null ? "no progress set" : pct + "%") + '</span> <button type="button" class="btn btn-secondary" data-act="adopt-goal" data-id="' + esc(g.id) + '" aria-label="Add the goal ' + esc(g.name) + ' to the plan">Add to plan</button></li>';
      }).join("") + '</ul>', { open: false, summary: A.plural(goals.length, "goal") + " not in the plan yet" });
  }

  A.register("yearly", {
    html: function () {
      const m = A.model(), s = m.settings, years = PL.planYears(s), today = store.today();
      const nowIn = years.some(function (y) { return String(y) === today.slice(0, 4); });
      let h = '<div class="sp-head"><h2 class="sp-h2" data-focus-top>Three-year roadmap</h2><div class="sp-head-btns"><button type="button" class="btn btn-secondary" data-act="breakdown">Break down a goal</button><button type="button" class="btn btn-secondary" data-act="templates">Templates</button><button type="button" class="btn btn-secondary" data-act="plan-settings">Settings</button></div></div>';
      h += A.section("yr-vision", "Your vision", (s.vision ? '<p class="sp-vision-text">' + esc(s.vision) + '</p>' : '<p class="sp-dim">Write where you want to be in three years. It stays at the top of your roadmap.</p>') +
        '<button type="button" class="btn btn-secondary" data-act="plan-settings">' + (s.vision ? "Edit vision" : "Write your vision") + '</button>', { open: true, summary: s.vision ? esc(s.vision.length > 60 ? s.vision.slice(0, 57) + "…" : s.vision) : "not written yet" });
      h += '<ol class="sp-rail" aria-label="Timeline from Year 1 to Year 3">' + years.map(function (y, i) { return timelineItem(m, y, i, today); }).join("") + '</ol>';
      h += '<div class="sp-roadmap">' + years.map(function (y, i) { return yearSection(m, y, i, today, !nowIn && i === 0); }).join("") + '</div>';
      h += goalsPanel(m);
      return h;
    }
  });

  A.acts["add-objective"] = function (el) { A.openNodeSheet({ type: "objective", year: Number(el.getAttribute("data-year")) }); };
  A.acts["add-priority"] = function (el) {
    const o = A.model().node(el.getAttribute("data-id"));
    if (!o) return;
    const today = store.today(), q = String(o.year) === today.slice(0, 4) ? PL.quarterOfDate(today) : 1;
    A.openNodeSheet({ type: "priority", year: o.year, quarter: q, parentId: o.id });
  };
  A.acts["adopt-goal"] = function (el) {
    const g = A.goals().filter(function (x) { return x.id === el.getAttribute("data-id"); })[0];
    if (!g) return;
    const s = store.settings(), thisYear = Number(store.today().slice(0, 4));
    A.openNodeSheet({ type: "objective", year: PL.planYears(s).indexOf(thisYear) !== -1 ? thisYear : s.startYear, measure: "goal", goalId: g.id, title: g.name });
  };
  // From the timeline: open that year's section and scroll to it.
  A.acts["year-jump"] = function (el) {
    const year = el.getAttribute("data-year"), id = "yr-" + year;
    if (!A.isOpen(id, false)) { A.ui.collapsed[id] = false; A.saveUi(); A.render(); }
    const target = document.getElementById("spYear" + year);
    if (target) { target.scrollIntoView({ block: "start", behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); const btn = target.querySelector(".sp-sec-btn"); if (btn) btn.focus({ preventScroll: true }); }
  };
  A.acts["year-theme"] = function (el) {
    const year = el.getAttribute("data-year"), cur = themeOf(year);
    A.openSheet({
      title: "Theme for " + year, submit: "Save",
      body: '<p class="sp-dim">One short phrase that says what this year is about.</p>' + A.fText("theme", "Theme", cur, { max: 80, placeholder: "e.g. Launch, Build the base, Scale" }),
      onSubmit: function (v) {
        const themes = Object.assign({}, store.settings().themes || {});
        const t = String(v.theme || "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (t) themes[year] = t; else delete themes[year];
        if (!store.setSettings({ themes: themes })) return { ok: false, message: store.error() };
        A.say(t ? "Theme saved" : "Theme cleared");
        return { ok: true };
      }
    });
  };
})();
