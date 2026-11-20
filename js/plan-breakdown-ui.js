/* ==========================================================================
   JARVIS — Strategic Planning Center: Goal Breakdown and templates.

   Goal Breakdown walks you down the chain one step at a time: yearly objective → quarterly priority → monthly milestone → this
   week's priority → the first daily task. Nothing is saved until the last step. Then the pieces are created together and linked
   to each other (the priority under the objective, the milestone under the priority, the tasks counting toward the milestone),
   so the relationships hold without you wiring anything. The weekly priority and the daily task are real tasks (the same records
   Habits uses); the weekly one can go straight into this week's top three. Undo takes the whole lot back out.

   Templates are ready-made breakdowns (a few built in, plus any objective you save). Using one builds an objective with its
   priorities and milestones for the year and quarter you pick.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, W = window.JarvisPlanWeekLogic, store = A.store, esc = A.esc;
  const NEW = "__new";
  const STEPS = ["Objective", "Priority", "Milestone", "This week", "First task"];

  function ctx() { return { goals: A.goals(), today: store.today() }; }
  function liveObjectives() { return A.model().all("objective").filter(function (o) { return o.status !== "dropped"; }); }

  // Builds the objective / priority / milestone from what has been typed, on a copy of the plan. Existing pieces are checked to still exist.
  // -> { ok, errors: { field: message }, nodes, obj, pri, ms, created: [ids] }
  function build(st) {
    let nodes = store.all("nodes"), obj, pri, ms; const created = [], errors = {};
    function add(input, map) {
      const r = PL.addNode(nodes, input, Object.assign(ctx(), { nodes: nodes }));
      if (!r.ok) { Object.keys(r.errors || {}).forEach(function (k) { errors[(map && map[k]) || k] = r.errors[k]; }); return null; }
      nodes = r.nodes; created.push(r.node.id); return r.node;
    }
    if (st.obj.id && st.obj.id !== NEW) {
      obj = A.model().node(st.obj.id);
      if (!obj) errors.objId = "That objective isn't there any more.";
    } else obj = add({ type: "objective", title: st.obj.title, year: st.obj.year }, { title: "objTitle", year: "objYear" });
    if (obj && st.step >= 2) {
      if (st.pri.id && st.pri.id !== NEW) {
        pri = A.model().node(st.pri.id);
        if (!pri || pri.parentId !== obj.id) errors.priId = "Pick one of this objective's priorities.";
      } else pri = add({ type: "priority", title: st.pri.title, year: obj.year, quarter: st.pri.quarter, parentId: obj.id }, { title: "priTitle", quarter: "priQuarter" });
    }
    if (obj && pri && st.step >= 3) ms = add({ type: "milestone", title: st.ms.title, criteria: st.ms.criteria, month: obj.year + "-" + st.ms.month, parentId: pri.id }, { title: "msTitle", month: "msMonth", criteria: "msCriteria" });
    return { ok: Object.keys(errors).length === 0, errors: errors, nodes: nodes, obj: obj, pri: pri, ms: ms, created: created };
  }

  function chainHtml(b, st) {
    const li = function (label, text, note) { return '<li><span class="sp-bd-k">' + esc(label) + '</span><span class="sp-bd-v">' + esc(text) + (note ? ' <span class="sp-dim">' + esc(note) + '</span>' : "") + '</span></li>'; };
    let h = '<ol class="sp-bd-chain">';
    if (b.obj) h += li("Yearly objective", b.obj.title, st.obj.id && st.obj.id !== NEW ? "(already in your plan)" : "(new)");
    if (b.pri) h += li("Quarterly priority", b.pri.title, (st.pri.id && st.pri.id !== NEW ? "(already in your plan)" : "(new)") + " · Q" + b.pri.quarter);
    if (b.ms) h += li("Monthly milestone", b.ms.title, PL.monthName(b.ms.month, true));
    if (st.step >= 4 && String(st.wk.text || "").trim()) h += li("This week's priority", st.wk.text.trim(), st.wk.top ? "(into your top three)" : "");
    if (st.step >= 5 && String(st.dy.text || "").trim()) h += li("First daily task", st.dy.text.trim(), A.fmtShort(st.dy.date));
    return h + "</ol>";
  }

  function readStep(st, v) {
    if (st.step === 1) { st.obj.id = v.objId || (liveObjectives().length ? "" : NEW); if (v.objTitle !== undefined) st.obj.title = v.objTitle; if (v.objYear) st.obj.year = Number(v.objYear); }
    else if (st.step === 2) { st.pri.id = v.priId !== undefined ? v.priId : NEW; if (v.priTitle !== undefined) st.pri.title = v.priTitle; if (v.priQuarter) st.pri.quarter = Number(v.priQuarter); }
    else if (st.step === 3) { st.ms.title = v.msTitle || ""; st.ms.month = v.msMonth || st.ms.month; st.ms.criteria = v.msCriteria || ""; }
    else if (st.step === 4) { st.wk.text = v.wkText || ""; st.wk.est = v.wkEst || ""; st.wk.top = !!v.wkTop; }
    else if (st.step === 5) { st.dy.text = v.dyText || ""; st.dy.est = v.dyEst || ""; st.dy.date = v.dyDate || st.dy.date; }
  }

  function stepBody(st) {
    const m = A.model(), years = PL.planYears(store.settings()), today = store.today();
    let b = '<p class="sp-bd-step" aria-live="polite">' + (st.step <= 5 ? "Step " + st.step + " of 5 · " + STEPS[st.step - 1] : "Review") + '</p><div class="sp-bd-bar" aria-hidden="true">' + STEPS.map(function (x, i) { return '<span class="' + (i + 1 <= Math.min(st.step, 5) ? "is-on" : "") + '"></span>'; }).join("") + '</div>';
    const back = st.step > st.firstStep ? '<button type="button" class="btn btn-secondary sp-bd-back" data-sheet-act="back">Back</button>' : "";
    if (st.step === 1) {
      const objs = liveObjectives();
      b += '<p>What is the big goal for the year this belongs to?</p>';
      if (objs.length) b += A.fSelect("objId", "Yearly objective", objs.map(function (o) { return [o.id, o.year + " · " + o.title]; }).concat([[NEW, "A new objective…"]]), st.obj.id || objs[0].id);
      b += '<div data-for-obj="' + NEW + '"' + (objs.length && st.obj.id !== NEW ? ' class="hidden"' : "") + '>' + A.fText("objTitle", "New yearly objective", st.obj.title, { max: PL.TITLE_MAX, placeholder: "e.g. Launch Gratiel and establish consistent sales" }) + A.fSelect("objYear", "Year", years.map(function (y) { return [String(y), String(y)]; }), String(st.obj.year)) + '</div>';
    } else if (st.step === 2) {
      const obj = st.obj.id && st.obj.id !== NEW ? m.node(st.obj.id) : null, pris = obj ? m.children(obj.id).filter(function (k) { return k.type === "priority" && k.status !== "dropped"; }) : [];
      b += '<p>What matters most this quarter to move “' + esc(obj ? obj.title : st.obj.title) + '” forward?</p>';
      if (pris.length) b += A.fSelect("priId", "Quarterly priority", pris.map(function (p) { return [p.id, "Q" + p.quarter + " · " + p.title]; }).concat([[NEW, "A new priority…"]]), st.pri.id || pris[0].id);
      b += '<div data-for-pri="' + NEW + '"' + (pris.length && st.pri.id !== NEW ? ' class="hidden"' : "") + '>' + A.fText("priTitle", "New quarterly priority", st.pri.title, { max: PL.TITLE_MAX, placeholder: "e.g. Prepare the first clothing drop" }) +
        A.fSelect("priQuarter", "Quarter", [["1", "Q1 (Jan–Mar)"], ["2", "Q2 (Apr–Jun)"], ["3", "Q3 (Jul–Sep)"], ["4", "Q4 (Oct–Dec)"]], String(st.pri.quarter)) + '</div>';
    } else if (st.step === 3) {
      const b0 = build(st), q = b0.pri ? b0.pri.quarter : st.pri.quarter, months = PL.quarterMonths(b0.obj ? b0.obj.year : st.obj.year, q);
      b += '<p>What checkpoint, by the end of a month, proves “' + esc(b0.pri ? b0.pri.title : st.pri.title) + '” is on its way?</p>' + A.fText("msTitle", "Monthly milestone", st.ms.title, { max: PL.TITLE_MAX, placeholder: "e.g. Finalize manufacturer and product samples" }) +
        A.fSelect("msMonth", "Month", months.map(function (mk) { return [mk.slice(5), PL.monthName(mk, false) + " " + mk.slice(0, 4)]; }), st.ms.month && months.some(function (mk) { return mk.slice(5) === st.ms.month; }) ? st.ms.month : months[0].slice(5)) +
        A.fArea("msCriteria", "How will you know it's done? (optional)", st.ms.criteria, { rows: 2, max: 500, placeholder: "e.g. one manufacturer chosen and approved samples in hand" });
    } else if (st.step === 4) {
      const wkStart = W.mondayOf(today), top = W.weekOf(store.all("weeks"), wkStart), topCount = top ? W.readWeek(top).top.length : 0;
      b += '<p>What is the one thing to get done <strong>this week</strong> for that milestone? You can skip this.</p>' + A.fText("wkText", "This week's priority", st.wk.text, { max: 140, placeholder: "e.g. Compare three manufacturers" }) + A.fText("wkEst", "Time you expect it to take (minutes, optional)", st.wk.est, { mode: "numeric" }) +
        (topCount < 3 ? '<label class="pw-check"><input type="checkbox" name="wkTop"' + (st.wk.top !== false ? " checked" : "") + '> Put it in this week\'s top three</label>' : '<p class="sp-dim">This week\'s top three is already full, so it won\'t be added there.</p>');
    } else if (st.step === 5) {
      b += '<p>What is the very first thing to do? A small, concrete task. You can skip this.</p>' + A.fText("dyText", "First daily task", st.dy.text, { max: 140, placeholder: "e.g. Contact a manufacturer" }) +
        '<div class="form-row two-col"><div><label for="spf_dyDate">Day</label><input type="date" id="spf_dyDate" name="dyDate" value="' + esc(st.dy.date) + '"></div><div><label for="spf_dyEst">Minutes (optional)</label><input id="spf_dyEst" name="dyEst" inputmode="numeric" value="' + esc(st.dy.est || "") + '" autocomplete="off"></div></div><p class="sp-err hidden" data-err="dyEst" role="alert"></p>';
    } else {
      const bb = build(Object.assign({}, st, { step: 3 }));
      b += '<p>Here is what will be created. Everything is linked, so finishing the tasks moves the milestone, which moves the priority, which moves the objective.</p>' + chainHtml(bb, st);
    }
    return back + b;
  }

  // st: the answers so far. Every step re-opens the same sheet with the next screen.
  function show(st) {
    const labelNext = st.step === 6 ? "Create" : st.step === 5 ? "Review" : "Next";
    A.openSheet({
      title: "Break down a goal", body: stepBody(st) + (st.step === 4 || st.step === 5 ? '<button type="button" class="sp-link" data-sheet-act="skip">Skip this step</button>' : ""), submit: labelNext,
      onOpen: function (root) { syncNew(root, st); },
      onChange: function (el, root) { if (el.name === "objId" || el.name === "priId") syncNew(root, st); },
      onAct: function (act, el, root) {
        const v = A.formValues(root.querySelector("form"));
        if (act === "back") { readStep(st, v); st.step = Math.max(st.firstStep, st.step - 1); show(st); return; }
        if (act === "skip") {
          if (st.step === 4) { st.wk.text = ""; st.wk.est = ""; st.wk.top = false; } else if (st.step === 5) { st.dy.text = ""; st.dy.est = ""; }
          st.step++; show(st);
        }
      },
      onSubmit: function (v, form) {
        readStep(st, v);
        const probe = build(Object.assign({}, st, { step: Math.min(st.step, 3) }));
        if (st.step <= 3 && !probe.ok) return { ok: false, errors: probe.errors };
        if (st.step === 4 || st.step === 5) {
          const est = PL.setEstimate([], "probe", st.step === 4 ? st.wk.est : st.dy.est, {});
          if (!est.ok) return { ok: false, errors: st.step === 4 ? { wkEst: est.error } : { dyEst: est.error } };
        }
        if (st.step < 6) { st.step++; window.setTimeout(function () { show(st); }, 0); return { ok: false, errors: {}, keep: true }; }
        return commit(st);
      }
    });
  }
  // Show or hide the "new …" fields for the select above them.
  function syncNew(root, st) {
    [["objId", "data-for-obj"], ["priId", "data-for-pri"]].forEach(function (x) {
      const sel = root.querySelector('[name="' + x[0] + '"]'), grp = root.querySelector("[" + x[1] + "]");
      if (grp) grp.classList.toggle("hidden", !!sel && sel.value !== NEW);
    });
    void st;
  }

  function commit(st) {
    const b = build(Object.assign({}, st, { step: 3 }));
    if (!b.ok) return { ok: false, errors: b.errors };
    const H = window.JarvisHabits;
    if (!H || !H.addTask) return { ok: false, message: "Tasks aren't available right now." };
    const prev = { nodes: store.all("nodes"), links: store.all("links"), weeks: store.all("weeks") };
    const before = A.tasks().map(function (t) { return t.id; });
    let links = prev.links, weeks = prev.weeks;
    const made = [], today = store.today();
    function task(text, date, est) {
      const t = H.addTask({ text: text.trim(), date: date, priority: "medium", kind: "deadline" });
      if (!t) return null;
      made.push(t.id);
      const l = PL.setLink(links, t.id, b.ms.id, { nodes: b.nodes }); if (l.ok) links = l.links;
      if (est) { const e = PL.setEstimate(links, t.id, est, {}); if (e.ok) links = e.links; }
      return t;
    }
    function undoTasks() { if (made.length) H.commitTasks(A.tasks().filter(function (t) { return made.indexOf(t.id) === -1; })); }
    let wkTask = null;
    if (String(st.wk.text || "").trim()) wkTask = task(st.wk.text, today, st.wk.est);
    if (String(st.dy.text || "").trim()) task(st.dy.text, st.dy.date || today, st.dy.est);
    let topChanged = false;
    if (wkTask && st.wk.top) {
      const ws = W.mondayOf(today), cur = W.weekOf(weeks, ws), top = cur ? W.readWeek(cur).top : [];
      if (top.length < 3) { const r = W.setWeek(weeks, ws, { top: top.concat([{ taskId: wkTask.id, text: "" }]) }, {}); if (r.ok) { weeks = r.weeks; topChanged = true; } }
    }
    if (!store.replaceMany({ nodes: b.nodes, links: links, weeks: weeks })) { undoTasks(); return { ok: false, message: store.error() }; }
    A.say("Created the breakdown for " + b.ms.title);
    const note = "Created “" + b.ms.title + "”" + (made.length ? " and " + A.plural(made.length, "task") : "") + ", all linked.";
    A.notice(note, "Undo", function () {
      let nodes = store.all("nodes"), lk = store.all("links");
      b.created.forEach(function (id) { const r = PL.removeNode(nodes, id, {}); if (r.ok) nodes = r.nodes; });
      made.forEach(function (id) { const r = PL.setLink(lk, id, "", {}); if (r.ok) lk = PL.setEstimate(r.links, id, 0, {}).links; });   // unlink, then drop the estimate: the link record goes away
      const changes = { nodes: nodes, links: lk };
      if (topChanged) changes.weeks = prev.weeks;
      store.replaceMany(changes);
      undoTasks();
      A.render();
    });
    void before;
    return { ok: true };
  }

  A.openBreakdown = function (o) {
    o = o || {};
    const m = A.model(), today = store.today(), nowYear = Number(today.slice(0, 4)), years = PL.planYears(store.settings());
    const year = years.indexOf(nowYear) !== -1 ? nowYear : years[0], q = String(year) === today.slice(0, 4) ? PL.quarterOfDate(today) : 1;
    const objs = liveObjectives();
    const st = { step: 1, firstStep: 1, obj: { id: objs.length ? objs[0].id : NEW, title: "", year: year }, pri: { id: "", title: "", quarter: q }, ms: { title: "", month: "", criteria: "" }, wk: { text: "", est: "", top: true }, dy: { text: "", est: "", date: today } };
    // pick the objective that has the most room, or the one passed in
    if (!o.objectiveId && !o.priorityId && objs.length) {
      const cur = objs.filter(function (x) { return x.year === year; })[0];
      if (cur) st.obj.id = cur.id;
    }
    if (o.priorityId) {
      const p = m.node(o.priorityId);
      if (p && p.parentId) { st.obj.id = p.parentId; st.pri.id = p.id; st.pri.quarter = p.quarter; st.step = 3; st.firstStep = 3; }
      else if (p) { A.notice("That priority isn't under a yearly objective, so there is nothing to break down from it. Link it to one first.", ""); return; }
    } else if (o.objectiveId) { st.obj.id = o.objectiveId; st.step = 2; st.firstStep = 2; }
    if (st.step >= 2) { const ob = m.node(st.obj.id); if (ob) st.obj.year = ob.year; if (!st.pri.id) { const ps = ob ? m.children(ob.id).filter(function (k) { return k.type === "priority" && k.status !== "dropped"; }) : []; st.pri.id = ps.length ? ps[0].id : NEW; } }
    show(st);
  };

  /* ---------------- templates ---------------- */

  function treeSize(t) { let ms = 0; (t.priorities || []).forEach(function (p) { ms += (p.milestones || []).length; }); return A.plural((t.priorities || []).length, "priority", "priorities") + " · " + A.plural(ms, "milestone"); }

  A.openTemplates = function () {
    const mine = store.list("templates"), all = PL.BUILTIN_TEMPLATES.concat(mine);
    const body = '<p class="sp-dim">A template builds an objective with its quarterly priorities and monthly milestones, ready for you to link tasks to. Nothing is added until you pick a year and quarter.</p><ul class="sp-tpls">' + all.map(function (t) {
      return '<li class="sp-tpl"><div><strong>' + esc(t.name) + '</strong><span class="sp-dim">' + esc(t.about || "") + '</span><span class="sp-dim">' + esc(treeSize(t.tree || {})) + (t.builtin ? "" : " · yours") + '</span></div>' +
        '<div class="sp-tpl-btns"><button type="button" class="btn btn-secondary" data-sheet-act="use" data-id="' + esc(t.id) + '">Use</button>' + (t.builtin ? "" : '<button type="button" class="btn btn-secondary" data-sheet-act="drop" data-id="' + esc(t.id) + '" aria-label="Delete the template ' + esc(t.name) + '">Delete</button>') + '</div></li>';
    }).join("") + '</ul>' + (mine.length ? "" : '<p class="sp-dim">To make your own, open one of your objectives and choose “Save as template”.</p>');
    A.openSheet({
      title: "Templates", body: body,
      onAct: function (act, el) {
        const id = el.getAttribute("data-id"), tpl = all.filter(function (t) { return t.id === id; })[0];
        if (!tpl) return;
        if (act === "use") useTemplate(tpl);
        else if (act === "drop") {
          const r = PL.removeTemplate(store.all("templates"), id, {});
          if (r.ok && store.replace("templates", r.templates)) { A.notice("Deleted the template “" + tpl.name + "”.", "Undo", function () { store.replace("templates", PL.restoreTemplate(store.all("templates"), id, {}).templates); A.render(); }); A.openTemplates(); } else A.saveFailed();
        }
      }
    });
  };

  function useTemplate(tpl) {
    const years = PL.planYears(store.settings()), today = store.today(), nowYear = Number(today.slice(0, 4)), year = years.indexOf(nowYear) !== -1 ? nowYear : years[0];
    A.openSheet({
      title: "Use “" + tpl.name + "”", submit: "Add to my plan",
      body: '<p class="sp-dim">' + esc(treeSize(tpl.tree || {})) + '. You can rename or change anything afterwards.</p>' + A.fSelect("year", "Year", years.map(function (y) { return [String(y), String(y)]; }), String(year)) +
        A.fSelect("quarter", "Quarter for its priorities", [["1", "Q1 (Jan–Mar)"], ["2", "Q2 (Apr–Jun)"], ["3", "Q3 (Jul–Sep)"], ["4", "Q4 (Oct–Dec)"]], String(String(year) === today.slice(0, 4) ? PL.quarterOfDate(today) : 1)),
      onSubmit: function (v) {
        const r = PL.applyTemplate(store.all("nodes"), tpl, { year: v.year, quarter: v.quarter }, Object.assign(ctx(), { nodes: store.all("nodes") }));
        if (!r.ok) return { ok: false, message: Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0] || "That couldn't be added.", errors: r.errors };
        if (!store.replace("nodes", r.nodes)) return { ok: false, message: store.error() };
        const created = r.created;
        A.say("Added " + r.objective.title);
        A.notice("Added “" + r.objective.title + "” with " + A.plural(created.length - 1, "item") + " under it.", "Undo", function () {
          let nodes = store.all("nodes");
          created.forEach(function (id) { const x = PL.removeNode(nodes, id, {}); if (x.ok) nodes = x.nodes; });
          store.replace("nodes", nodes); A.render();
        });
        return { ok: true };
      }
    });
  }

  A.acts["breakdown"] = function () { A.openBreakdown({}); };
  A.acts["breakdown-from"] = function (el) {
    const n = A.model().node(el.getAttribute("data-id"));
    if (n) A.openBreakdown(n.type === "objective" ? { objectiveId: n.id } : { priorityId: n.id });
  };
  A.acts["templates"] = function () { A.openTemplates(); };
  A.acts["save-template"] = function (el) {
    const id = el.getAttribute("data-id"), o = A.model().node(id);
    if (!o) return;
    A.openSheet({
      title: "Save as template", submit: "Save template",
      body: '<p class="sp-dim">Saves “' + esc(o.title) + '” with its quarterly priorities and the milestones under them, so you can build it again. Tasks, money and dates are not saved.</p>' + A.fText("name", "Template name", o.title, { max: 60, required: true }),
      onSubmit: function (v) {
        const tpl = PL.templateFromObjective(A.model(), id, v.name, {});
        if (!tpl) return { ok: false, message: "That couldn't be saved as a template." };
        const r = PL.addTemplate(store.all("templates"), tpl, {});
        if (!r.ok) return { ok: false, errors: { name: r.error } };
        if (!store.replace("templates", r.templates)) return { ok: false, message: store.error() };
        A.say("Template saved");
        A.notice("Saved the template “" + r.template.name + "”.", "", null);
        return { ok: true };
      }
    });
  };
})();
