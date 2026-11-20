/* ==========================================================================
   JARVIS — Strategic Planning Center: the overview above the tabs, and the panels that open from it.

   The overview answers four questions: Where am I going? What matters most right now? What should I work on today? Am I making
   progress? It follows the chain from the vision to today's tasks, and every goal in it opens a panel showing the smaller goals,
   milestones and tasks that make it up. Also here: the getting-started card, quick add, search, the panel for one task, and
   marking something complete against its criteria. Every figure comes from plan-insights-logic.js (nothing is estimated).
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, I = window.JarvisPlanInsights, W = window.JarvisPlanWeekLogic, store = A.store, esc = A.esc;
  const TYPE_NOUN = { objective: "objective", priority: "priority", milestone: "milestone" };

  function dayWord(left) {
    if (left === null || left === undefined) return "";
    if (left < 0) return "overdue by " + (-left) + (left === -1 ? " day" : " days");
    if (left === 0) return "today";
    if (left === 1) return "tomorrow";
    return "in " + left + " days";
  }
  function dayShort(left) {
    if (left === null || left === undefined) return "";
    if (left < 0) return (-left) + "d late";
    if (left === 0) return "Today";
    if (left === 1) return "Tomorrow";
    return left + " days";
  }
  function chipHtml(n, o) {
    o = o || {};
    const m = A.model(), p = m.progress(n.id), st = m.statusOf(n.id);
    return '<button type="button" class="sp-chip sp-st-' + st + (m.health(n.id) === "overdue" ? " is-late" : "") + '" data-act="detail" data-id="' + esc(n.id) + '">' +
      '<span class="sp-chip-t">' + esc(n.title) + '</span><span class="sp-chip-p">' + esc(p.pct === null ? (o.empty || "no data") : p.pct + "%") + '</span>' +
      (p.pct === null ? "" : '<span class="sp-chip-bar" aria-hidden="true"><span style="width:' + Math.min(100, p.pct) + '%"></span></span>') + '<span class="visually-hidden"> ' + esc(PL.STATUS_LABEL[st] || "") + ', open details</span></button>';
  }
  function tile(label, value, sub, o) {
    o = o || {};
    return '<div class="sp-tile' + (o.tone ? " sp-tone-" + o.tone : "") + '"><span class="sp-tile-l">' + esc(label) + '</span><span class="sp-tile-v">' + value + '</span>' +
      (o.pct === null || o.pct === undefined ? "" : A.bar(o.pct, label, o.tone === "red" ? "behind" : o.tone === "yellow" ? "atrisk" : "ontrack")) + (sub ? '<span class="sp-tile-s">' + sub + '</span>' : "") + '</div>';
  }
  // A checkbox with a 44-pixel tap area (the box itself stays small).
  function check(id, checked, text, via) {
    return '<label class="sp-check44"><input type="checkbox" class="sp-trow-check" ' + via + '="' + (via === "data-act" ? "task-toggle" : "toggle-task") + '" data-id="' + esc(id) + '"' + (checked ? " checked" : "") + ' aria-label="Done: ' + esc(text) + '"></label>';
  }
  function taskRow(t, m, o) {
    o = o || {};
    const chain = m.chainOfTask(t.id), last = chain[chain.length - 1];
    return '<li class="sp-trow' + (t.completed ? " is-done" : "") + '">' + check(t.id, t.completed, t.text, "data-act") +
      '<button type="button" class="sp-trow-t" data-act="task-detail" data-id="' + esc(t.id) + '"><span class="sp-trow-n">' + esc(t.text) + '</span>' + (last ? '<span class="sp-trow-s">' + esc(last.title) + '</span>' : (o.loose === false ? "" : '<span class="sp-trow-s sp-dim">not linked to a goal</span>')) + '</button></li>';
  }

  /* ---------------- the overview ---------------- */

  function onboardingHtml(d) {
    const s = store.settings();
    if (s.onboardingDismissed) return "";
    const m = A.model(), hasVision = !!s.vision, hasObj = m.all("objective").length > 0, hasChild = m.all("priority").length + m.all("milestone").length > 0;
    const hasLink = A.tasks().some(function (t) { return m.nodeOfTask(t.id); }), hasBlock = store.list("blocks").length > 0;
    const steps = [
      [hasVision, "Write your vision", "Where do you want Gratiel and your life to be in three years?", "plan-settings", "Write it"],
      [hasObj, "Add a yearly objective", "One big thing for this year. Three per year keeps it focused.", "add-objective-first", "Add one"],
      [hasChild, "Break it down", "Jarvis walks you from the objective to a priority, a milestone and a first task.", "breakdown", "Break down a goal"],
      [hasLink, "Link a task to it", "Tasks you finish move its progress. Link one you already have.", "link-first-task", "Link a task"],
      [hasBlock, "Plan time for it", "Put it in a time block on the Weekly tab.", "go-weekly", "Open Weekly"]
    ];
    const done = steps.filter(function (x) { return x[0]; }).length;
    if (done === steps.length) return "";                 // everything is set up: nothing left to teach
    return '<section class="sp-onb" aria-label="Getting started"><div class="sp-onb-head"><h2 class="sp-sec-title">Getting started <span class="sp-dim">' + done + ' of ' + steps.length + '</span></h2><button type="button" class="btn btn-secondary sp-onb-x" data-act="onboarding-dismiss" aria-label="Dismiss getting started">Dismiss</button></div>' +
      '<ol class="sp-onb-list">' + steps.map(function (x) {
        return '<li class="' + (x[0] ? "is-done" : "") + '"><span class="sp-onb-mark" aria-hidden="true">' + (x[0] ? "✓" : "") + '</span><span class="sp-onb-text"><strong>' + esc(x[1]) + '</strong><span class="sp-dim">' + esc(x[2]) + '</span></span>' +
          (x[0] ? '<span class="visually-hidden">Done</span>' : '<button type="button" class="btn btn-secondary" data-act="' + x[3] + '">' + esc(x[4]) + '</button>') + '</li>';
      }).join("") + '</ol></section>';
    void d;
  }

  function dashBody(d, c) {
    const m = A.model(), s = m.settings;
    const next = d.deadlines[0];
    let h = '';
    h += '<div class="sp-q-cap">Am I making progress?</div><div class="sp-tiles">' +
      tile("This year", d.overall.year === null ? '<span class="sp-dim">no data</span>' : d.overall.year + "%", d.overall.threeYear === null ? "Link tasks to goals" : "3-year " + d.overall.threeYear + "%", { pct: d.overall.year, tone: d.overall.year === null ? "" : d.overall.year >= 50 ? "green" : "" }) +
      tile("Tasks, this week", d.week.tasksTotal ? d.week.tasksDone + "/" + d.week.tasksTotal : '<span class="sp-dim">none</span>', d.overdueTaskCount ? '<span class="sp-late">' + d.overdueTaskCount + ' overdue</span>' : (d.week.rate === null ? "none dated" : d.week.rate + "% done"), { pct: d.week.rate, tone: d.overdueTaskCount ? "yellow" : "" }) +
      tile("Gratiel, this week", d.week.gratielLoggedMin === null ? '<span class="sp-dim" aria-hidden="true">—</span><span class="visually-hidden">not tracked</span>' : A.hoursText(d.week.gratielLoggedMin), d.week.gratielPlannedMin === null ? "no Gratiel block yet" : A.hoursText(d.week.gratielPlannedMin) + " planned") +
      tile("Next deadline", next ? esc(dayShort(next.daysLeft)) : '<span class="sp-dim">none soon</span>', next ? esc(next.title) : "nothing in 2 weeks", { tone: next && next.daysLeft < 0 ? "red" : next && next.daysLeft <= 3 ? "yellow" : "" }) + '</div>';

    let chain = '<ol class="sp-chain" aria-label="From your vision to the month">';
    chain += '<li class="sp-q"><span class="sp-q-cap">Where am I going?</span></li>';
    chain += '<li class="sp-lvl"><span class="sp-lvl-tag">3-year vision</span><div class="sp-lvl-body">' + (s.vision ? '<p class="sp-vis">' + esc(s.vision) + '</p>' : '<p class="sp-dim">Write where you want to be in three years.</p>') +
      '<button type="button" class="sp-link" data-act="plan-settings">' + (s.vision ? "Edit vision" : "Write your vision") + '</button></div></li>';
    chain += '<li class="sp-lvl"><span class="sp-lvl-tag">' + d.year + ' objectives</span><div class="sp-lvl-body">' + (d.objectives.length ? '<div class="sp-chips">' + d.objectives.map(function (n) { return chipHtml(n); }).join("") + '</div>' : '<p class="sp-dim">No objectives for this year yet.</p><button type="button" class="btn btn-secondary" data-act="add-objective-first">Add an objective</button>') + '</div></li>';
    chain += '<li class="sp-q"><span class="sp-q-cap">What matters most right now?</span></li>';
    chain += '<li class="sp-lvl"><span class="sp-lvl-tag">Q' + d.quarter + ' priorities</span><div class="sp-lvl-body">' + (d.priorities.length ? '<div class="sp-chips">' + d.priorities.map(function (n) { return chipHtml(n); }).join("") + '</div>' : '<p class="sp-dim">No priorities for this quarter yet.</p><button type="button" class="btn btn-secondary" data-act="go-quarterly">Plan the quarter</button>') + '</div></li>';
    const open = d.milestones.filter(function (n) { return m.statusOf(n.id) !== "completed"; }).sort(function (a, b) { return m.deadline(a) < m.deadline(b) ? -1 : m.deadline(a) > m.deadline(b) ? 1 : 0; });
    chain += '<li class="sp-lvl"><span class="sp-lvl-tag">' + esc(PL.monthName(d.month, true)) + ' milestones</span><div class="sp-lvl-body">' +
      (d.milestones.length ? '<p class="sp-lvl-sum">' + d.monthStats.milestonesDone + ' of ' + d.monthStats.milestones + ' complete · ' + d.monthStats.tasksDone + ' tasks done, ' + d.monthStats.tasksOpen + ' to go</p><div class="sp-chips">' + open.slice(0, 3).map(function (n) { return chipHtml(n); }).join("") + '</div>' + (open.length > 3 ? '<button type="button" class="sp-link" data-act="go-monthly">+' + (open.length - 3) + ' more this month</button>' : "") : '<p class="sp-dim">No milestones this month yet.</p><button type="button" class="btn btn-secondary" data-act="go-monthly">Plan the month</button>') + '</div></li>';
    chain += '</ol>';
    const wide = window.innerWidth >= 700;
    const chainSum = d.year + ': ' + A.plural(d.objectives.length, 'objective', 'objectives') + ' · Q' + d.quarter + ': ' + A.plural(d.priorities.length, 'priority', 'priorities') + ' · ' + PL.monthName(d.month, true) + ': ' + A.plural(d.milestones.length, 'milestone', 'milestones');
    h += A.section('dash-chain', 'Vision to this month', chain, { open: wide, summary: esc(chainSum) });
    h += '<ol class="sp-chain sp-chain-today" aria-label="What to work on today">';
    h += '<li class="sp-q"><span class="sp-q-cap">What should I work on today?</span></li>';
    h += '<li class="sp-lvl"><span class="sp-lvl-tag">This week\'s top three</span><div class="sp-lvl-body">';
    if (d.week.top.length) {
      h += (d.week.topSuggested ? '<p class="sp-dim">Suggested from your plan (not saved yet).</p>' : "") + '<ol class="sp-top3">' + d.week.top.map(function (x) {
        const n = x.node;
        return '<li class="' + (x.done ? "is-done" : "") + '">' + (x.task ? check(x.task.id, x.done, x.text, "data-act") + '<button type="button" class="sp-trow-t" data-act="task-detail" data-id="' + esc(x.task.id) + '"><span class="sp-trow-n">' + esc(x.text) + '</span>' + (n ? '<span class="sp-trow-s">' + esc(n.title) + '</span>' : "") + '</button>' : '<span class="sp-trow-t"><span class="sp-trow-n">' + esc(x.text) + '</span>' + (n ? '<span class="sp-trow-s">' + esc(n.title) + '</span>' : "") + '</span>') + '</li>';
      }).join("") + '</ol><div class="sp-top3-foot">' + (d.week.topSuggested ? '<button type="button" class="btn btn-secondary" data-act="top-accept">Use these three</button>' : "") + '<button type="button" class="sp-link" data-act="go-weekly">Why these? Open the week</button></div>';
    } else h += '<p class="sp-dim">Nothing to rank yet. Add tasks, or link them to your goals.</p>';
    h += '</div></li>';
    const inTop = {}; d.week.top.forEach(function (x) { if (x.task) inTop[x.task.id] = true; });
    const todayRows = d.today.open.filter(function (t) { return !inTop[t.id]; }), hiddenInTop = d.today.open.length - todayRows.length;
    h += '<li class="sp-lvl"><span class="sp-lvl-tag">Today</span><div class="sp-lvl-body">' + (todayRows.length ? '<ul class="sp-trows">' + todayRows.map(function (t) { return taskRow(t, m); }).join("") + '</ul>' + (d.today.openCount > d.today.open.length ? '<p class="sp-dim">+' + (d.today.openCount - d.today.open.length) + ' more today</p>' : "") :
      '<p class="sp-dim">' + (d.today.openCount ? (hiddenInTop ? "What is dated today is in your top three above." : "") : (d.today.done ? "Everything dated today is done." : "No open tasks dated today.")) + '</p>' + (d.today.openCount ? "" : '<button type="button" class="btn btn-secondary" data-act="quick-task">Add a task</button>')) + '</div></li>';
    h += '</ol>';
    if (d.deadlines.length) {
      h += '<div class="sp-dl-wrap"><h3 class="sp-h4">Upcoming deadlines</h3><ul class="sp-dl">' + d.deadlines.slice(0, 5).map(function (x) {
        const late = x.daysLeft < 0;
        return '<li><button type="button" class="sp-dl-btn' + (late ? " is-late" : "") + '" data-act="' + (x.kind === "node" ? "detail" : "task-detail") + '" data-id="' + esc(x.id) + '"><span class="sp-dl-t">' + esc(x.title) + '</span><span class="sp-dl-k">' + (x.kind === "node" ? esc(A.typeLabel(x.type)) : "Task") + '</span><span class="sp-dl-d' + (late ? " sp-late" : "") + '">' + esc(dayWord(x.daysLeft)) + '</span></button></li>';
      }).join("") + '</ul></div>';
    }
    void c;
    return h;
  }

  /* ---------------- suggestions that need your approval ---------------- */
  // Jarvis never changes a deadline, a task date or a priority by itself. It proposes (fixed rules over your own records) and you press Approve
  // or Not now. "Not now" hides it for two weeks.
  const SUG_BTN = { "move-deadline": "Approve", "move-tasks": "Approve", "add-task": "Choose a task", review: "Open the review" };
  function suggestionsHtml(c) {
    const list = I.proposals(c);
    if (!list.length) return "";
    const shown = list.slice(0, 4);
    const body = '<p class="sp-dim">Jarvis only suggests. Nothing changes until you press the button, and a change can be undone.</p><ul class="sp-sugs">' + shown.map(function (p) {
      const nice = function (t) { return String(t).replace(/\d{4}-\d{2}-\d{2}/g, function (d) { return A.fmtDate(d); }); };      // dates read as "Nov 18, 2026", not 2026-11-18
      return '<li class="sp-sug"><div class="sp-sug-t">' + esc(nice(p.title)) + '</div><p class="sp-dim">' + esc(nice(p.detail)) + '</p><div class="sp-sug-btns"><button type="button" class="btn btn-primary" data-act="sug-apply" data-key="' + esc(p.key) + '">' + esc(SUG_BTN[p.kind] || "Approve") + '</button><button type="button" class="btn btn-secondary" data-act="sug-dismiss" data-key="' + esc(p.key) + '">Not now</button></div></li>';
    }).join("") + '</ul>' + (list.length > shown.length ? '<p class="sp-dim">and ' + (list.length - shown.length) + ' more after these.</p>' : "");
    return '<div class="sp-sugwrap">' + A.section("dash-sug", "Suggestions for you", body, { open: window.innerWidth >= 700, summary: A.plural(list.length, "suggestion") + " to review" }) + '</div>';   // on a phone it starts folded so the overview stays on the first screen; the header still says how many there are
  }
  function proposalByKey(key) { return I.proposals(A.ictx()).filter(function (p) { return p.key === key; })[0] || null; }
  A.acts["sug-apply"] = function (el) {
    const p = proposalByKey(el.getAttribute("data-key"));
    if (!p) { A.render(); return; }
    if (p.kind === "add-task") { A.openNewTaskSheet({ nodeId: p.id }); return; }
    if (p.kind === "review") { A.ui.collapsed["wk-review"] = false; A.saveUi(); A.go("weekly", { week: p.apply.weekStart }); return; }
    const H = window.JarvisHabits, r = I.applyProposal(p, { nodes: store.all("nodes"), tasks: A.tasks(), now: Date.now(), today: store.today() });
    if (!r.ok) { A.notice(r.text, ""); A.render(); return; }
    if (r.nodes && !store.replace("nodes", r.nodes)) { A.saveFailed(); return; }
    if (r.tasks) { if (!H || !H.commitTasks) { A.notice("Tasks aren't available right now.", ""); return; } H.commitTasks(r.tasks); }
    A.notice(r.text, "Undo", function () {
      if (r.undo.nodeId) { const e = PL.editNode(store.all("nodes"), r.undo.nodeId, { due: r.undo.due }, { now: Date.now(), today: store.today() }); if (e.ok) store.replace("nodes", e.nodes); }
      if (r.undo.dates && H) H.commitTasks(A.tasks().map(function (t) { return r.undo.dates[t.id] ? Object.assign({}, t, { date: r.undo.dates[t.id] }) : t; }));
      A.render();
    });
    A.render();
  };
  A.acts["sug-dismiss"] = function (el) {
    const key = el.getAttribute("data-key"), now = Date.now(), cur = store.settings().dismissed || {}, keep = {};
    Object.keys(cur).forEach(function (k) { if (now - cur[k] < 30 * 86400000) keep[k] = cur[k]; });         // old ones are forgotten
    keep[key] = now;
    if (!store.setSettings({ dismissed: keep })) { A.saveFailed(); return; }
    A.say("Hidden for two weeks");
    A.render();
  };

  A.renderDash = function () {
    const host = A.$("spDash");
    if (!host) return;
    const c = A.ictx();
    const d = I.dashboard(c), open = A.ui.dash;
    const m = A.model();
    const sum = (d.overall.year === null ? "No goal data yet" : "This year " + d.overall.year + "%") + " · " + (d.week.tasksTotal ? d.week.tasksDone + " of " + d.week.tasksTotal + " tasks this week" : "no tasks this week") + (d.deadlines.length ? " · next: " + dayWord(d.deadlines[0].daysLeft) : "");
    let h = onboardingHtml(d) + suggestionsHtml(c);
    h += '<section class="sp-dash' + (open ? " is-open" : "") + '" aria-label="Overview"><h2 class="sp-dash-h"><button type="button" class="sp-dash-btn" data-act="dash-toggle" aria-expanded="' + open + '" aria-controls="spDashBody"><span class="sp-dash-title">Overview</span><span class="sp-dash-sum">' + (open ? "" : esc(sum)) + '</span><span class="sp-chev" aria-hidden="true"></span></button></h2>' +
      '<div class="sp-dash-body" id="spDashBody"' + (open ? "" : " hidden") + '>' + dashBody(d, c) + '</div></section>';
    host.innerHTML = h;
    void m;
  };

  /* ---------------- one goal: what it is made of ---------------- */

  function crumbs(n) {
    const m = A.model(), s = store.settings(), chain = m.ancestors(n.id).reverse();
    let h = '<nav class="sp-crumbs" aria-label="Where this sits"><span class="sp-crumb sp-crumb-root">' + (s.vision ? "3-year vision" : "Vision") + '</span>';
    chain.forEach(function (x) { h += '<span class="sp-crumb-sep" aria-hidden="true">›</span><button type="button" class="sp-crumb" data-sheet-act="detail" data-id="' + esc(x.id) + '">' + esc(x.title) + '</button>'; });
    return h + '<span class="sp-crumb-sep" aria-hidden="true">›</span><span class="sp-crumb is-here" aria-current="true">' + esc(n.title) + '</span></nav>';
  }
  function factRow(label, value) { return value ? '<div class="sp-fact"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>' : ""; }

  // What the figure is made of, in words: each part and how much it counts.
  function howHtml(n, p) {
    if (n.measure !== "tasks") return '<p class="sp-dim">' + esc(p.note) + '. ' + (n.measure === "revenue" || n.measure === "budget" ? "This uses the money you entered by month, never task completion." : n.measure === "goal" ? "It follows that goal's own progress." : "You update this number yourself.") + '</p>';
    if (n.doneAt) return '<p class="sp-dim">You marked this complete, so it counts as 100%.' + (n.criteria ? " Completion criteria: " + esc(n.criteria) : "") + '</p>';
    if (!p.parts.length) return '<p class="sp-dim">' + (n.type === "milestone" ? "A milestone with no tasks is ticked off by hand: it is 0% until you mark it complete." : "It has no milestones or tasks with a figure yet, so there is nothing to average.") + '</p>';
    const wsum = p.parts.reduce(function (s, x) { return s + x.weight; }, 0);
    return '<p class="sp-dim">The average of its parts, each counting equally unless you gave it more weight. A part with nothing to measure yet is left out.</p><ul class="sp-parts">' + p.parts.map(function (x) {
      return '<li><span class="sp-part-t">' + esc(x.label) + '</span><span class="sp-part-w">weight ' + x.weight + ' of ' + wsum + '</span><span class="sp-part-p">' + x.pct + '%</span></li>';
    }).join("") + '</ul>';
  }

  A.openDetailSheet = function (id) {
    const m = A.model(), n = m.node(id);
    if (!n) { A.notice("That isn't there any more.", ""); return; }
    const p = m.progress(id), st = m.statusOf(id), left = m.daysLeft(id), kids = m.children(id).filter(function (k) { return k.status !== "dropped"; });
    const direct = m.tasksDirect(id).sort(function (a, b) { return (a.completed ? 1 : 0) - (b.completed ? 1 : 0) || (a.date < b.date ? -1 : 1); });
    const habits = A.habitsOf ? A.habitsOf(n) : [];
    let body = crumbs(n);
    body += '<div class="sp-det-top"><span class="sp-det-pct">' + esc(A.pctText(p.pct)) + '</span>' + A.statusBadge(id) + (n.status !== "active" ? "" : "") + '</div>' + A.bar(p.pct, n.title + " progress", A.model().health(id)) + '<p class="sp-dim sp-det-note">' + esc(p.note) + '</p>';
    body += '<dl class="sp-facts sp-det-facts">' + factRow("Deadline", esc(A.fmtDate(m.deadline(n))) + (left === null ? "" : ' <span class="sp-dim">(' + esc(dayWord(left)) + ')</span>')) +
      factRow("Success metric", n.successMetric ? esc(n.successMetric) : "") + factRow("Completion criteria", n.criteria ? esc(n.criteria) : "") + factRow("What it is", n.description ? esc(n.description) : "") +
      factRow("Counts as", n.weight > 1 ? "weight " + n.weight + " of 5" : "") + factRow("Notes", n.notes ? esc(n.notes) : "") + '</dl>';
    body += '<details class="sp-how"><summary>How is this worked out?</summary>' + howHtml(n, p) + '</details>';
    if (kids.length) body += '<h3 class="sp-h4">Made of</h3><ul class="sp-kids">' + kids.map(function (k) {
      const kp = m.progress(k.id);
      return '<li><button type="button" class="sp-kid" data-sheet-act="detail" data-id="' + esc(k.id) + '"><span class="sp-kid-t">' + esc(k.title) + '</span><span class="sp-kid-k">' + esc(A.typeLabel(k.type)) + '</span><span class="sp-kid-p">' + esc(A.pctText(kp.pct)) + '</span>' + A.statusBadge(k.id) + '</button></li>';
    }).join("") + '</ul>';
    if (habits.length) body += '<h3 class="sp-h4">Habits that support it</h3><ul class="sp-sublist">' + habits.map(function (hb) { return '<li>' + esc(hb.name) + ' <span class="sp-dim">' + esc(hb.line) + '</span></li>'; }).join("") + '</ul>';
    body += '<h3 class="sp-h4">Tasks linked straight to it <span class="sp-dim">(' + direct.length + ')</span></h3>';
    if (direct.length) {
      body += '<ul class="sp-trows">' + direct.slice(0, 12).map(function (t) { return '<li class="sp-trow' + (t.completed ? " is-done" : "") + '">' + check(t.id, t.completed, t.text, "data-sheet-act") + '<span class="sp-trow-t"><span class="sp-trow-n">' + esc(t.text) + '</span><span class="sp-trow-s">' + esc(A.fmtShort(t.date)) + '</span></span></li>'; }).join("") + '</ul>' + (direct.length > 12 ? '<p class="sp-dim">Showing 12 of ' + direct.length + '.</p>' : "");
    } else body += '<p class="sp-dim">None yet. Link a task you already have, or add a new one.</p>';
    const childType = n.type === "objective" ? "priority" : n.type === "priority" ? "milestone" : "";
    body += '<div class="sp-det-actions"><button type="button" class="btn btn-secondary" data-sheet-act="link">Link or add tasks</button>' +
      (n.measure === "tasks" ? '<button type="button" class="btn btn-secondary" data-sheet-act="complete">' + (n.doneAt ? "Reopen" : "Mark complete") + '</button>' : "") +
      (childType ? '<button type="button" class="btn btn-secondary" data-sheet-act="add-child">Add ' + childType + '</button>' : "") +
      (n.type !== "milestone" ? '<button type="button" class="btn btn-secondary" data-sheet-act="breakdown">Break it down</button>' : "") +
      '<button type="button" class="btn btn-secondary" data-sheet-act="edit">Edit</button><button type="button" class="btn btn-secondary" data-sheet-act="open-view">Open in ' + (n.type === "objective" ? "Yearly" : n.type === "priority" ? "Quarterly" : "Monthly") + '</button></div>';
    void st; void TYPE_NOUN;
    A.openSheet({
      title: A.typeLabel(n.type), body: body,
      onAct: function (act, el) {
        const target = el.getAttribute("data-id");
        if (act === "detail") { A.openDetailSheet(target); return; }
        if (act === "toggle-task") { A.toggleTask(target); A.openDetailSheet(id); return; }
        A.closeSheet(true);
        if (act === "link") A.openLinkSheet(id);
        else if (act === "complete") A.openCompleteSheet(id);
        else if (act === "add-child") A.openNodeSheet(n.type === "objective" ? { type: "priority", year: n.year, quarter: String(n.year) === store.today().slice(0, 4) ? PL.quarterOfDate(store.today()) : 1, parentId: id } : { type: "milestone", year: n.year, month: n.type === "priority" ? PL.quarterMonths(n.year, n.quarter)[0] : (n.year + "-01"), parentId: id });
        else if (act === "breakdown" && A.openBreakdown) A.openBreakdown({ objectiveId: n.type === "objective" ? id : "", priorityId: n.type === "priority" ? id : "" });
        else if (act === "edit") A.openNodeSheet({ id: id });
        else if (act === "open-view") A.acts["open-node"]({ getAttribute: function () { return id; } });
      }
    });
  };

  // Marking something complete: it shows the criteria you wrote and any tasks still open, and lets you finish those too.
  A.openCompleteSheet = function (id) {
    const m = A.model(), n = m.node(id);
    if (!n) return;
    if (n.doneAt) {
      const r = PL.setDoneAt(store.all("nodes"), id, false, { today: store.today() });
      if (!store.replace("nodes", r.nodes)) { A.saveFailed(); return; }
      A.notice("Reopened “" + n.title + "”.", ""); A.render(); return;
    }
    const open = m.subtreeTasks(id).filter(function (t) { return !t.completed; });
    const body = '<p class="sp-dim">Mark “' + esc(n.title) + '” complete only when what you decided counts as done is true.</p>' +
      (n.criteria ? '<div class="sp-crit"><strong>Completion criteria</strong><p>' + esc(n.criteria) + '</p></div>' : '<p class="sp-dim">You haven\'t written completion criteria for this. You can add them under Edit.</p>') +
      (open.length ? '<p>' + A.plural(open.length, "linked task is", "linked tasks are") + ' still open.</p><label class="pw-check"><input type="checkbox" name="alsoTasks"> Mark ' + (open.length === 1 ? "it" : "them") + ' complete too</label>' : "");
    A.openSheet({
      title: "Mark complete", body: body, submit: "Mark complete",
      onSubmit: function (v) {
        const r = PL.setDoneAt(store.all("nodes"), id, true, { today: store.today() });
        if (!store.replace("nodes", r.nodes)) return { ok: false, message: store.error() };
        if (v.alsoTasks && open.length && window.JarvisHabits) {
          const ids = {}; open.forEach(function (t) { ids[t.id] = true; });
          window.JarvisHabits.commitTasks(A.tasks().map(function (t) { return ids[t.id] ? Object.assign({}, t, { completed: true }) : t; }));
        }
        A.notice("Marked “" + n.title + "” complete.", "Undo", function () { store.replace("nodes", PL.setDoneAt(store.all("nodes"), id, false, { today: store.today() }).nodes); A.render(); });
        return { ok: true };
      }
    });
  };

  /* ---------------- one task ---------------- */

  A.openTaskSheet = function (taskId) {
    const t = A.taskById(taskId);
    if (!t) { A.notice("That task isn't there any more.", ""); return; }
    const m = A.model(), chain = m.chainOfTask(taskId), link = PL.linkOf(store.all("links"), taskId), blk = W ? W.blockOfTask(store.all("blocks"), taskId) : null;
    let body = '<p class="sp-task-name">' + esc(t.text) + '</p><dl class="sp-facts sp-det-facts">' + factRow("Day", esc(A.fmtDate(t.date)) + (t.time ? " at " + esc(t.time) : "")) + factRow("Priority", esc(t.priority || "medium")) +
      factRow("Time estimate", link && link.estMin ? link.estMin + " min" : "") + factRow("Time block", blk ? esc(A.fmtShort(blk.date)) + " " + esc(blk.start) + "–" + esc(blk.end) : "") + factRow("Category", t.category ? esc(t.category) : "") + '</dl>';
    body += '<h3 class="sp-h4">What it contributes to</h3>';
    body += chain.length ? '<ol class="sp-chain-mini">' + chain.map(function (n) { return '<li><button type="button" class="sp-crumb" data-sheet-act="detail" data-id="' + esc(n.id) + '">' + esc(n.title) + '</button><span class="sp-dim"> ' + esc(A.typeLabel(n.type).toLowerCase()) + '</span></li>'; }).join("") + '</ol>' : '<p class="sp-dim">Not linked to a goal. Linking it lets finishing it move your progress.</p>';
    body += '<div class="sp-det-actions"><button type="button" class="btn btn-secondary" data-sheet-act="toggle">' + (t.completed ? "Mark not done" : "Mark done") + '</button><button type="button" class="btn btn-secondary" data-sheet-act="link">' + (chain.length ? "Change link" : "Link to a goal") + '</button>' +
      '<button type="button" class="btn btn-secondary" data-sheet-act="schedule">' + (blk ? "Change time block" : "Schedule it") + '</button>' + (t.date !== store.today() && !t.completed ? '<button type="button" class="btn btn-secondary" data-sheet-act="today">Move to today</button>' : "") + '</div>';
    A.openSheet({
      title: "Task", body: body,
      onAct: function (act, el) {
        if (act === "detail") { A.openDetailSheet(el.getAttribute("data-id")); return; }
        if (act === "toggle") { A.toggleTask(taskId); A.openTaskSheet(taskId); return; }
        A.closeSheet(true);
        if (act === "link") A.openTaskLinkSheet(taskId);
        else if (act === "schedule") A.scheduleTask(taskId);
        else if (act === "today" && window.JarvisHabits) window.JarvisHabits.commitTasks(A.tasks().map(function (x) { return x.id === taskId ? Object.assign({}, x, { date: store.today() }) : x; }));
      }
    });
  };

  /* ---------------- quick add and search ---------------- */

  A.openQuickAdd = function () {
    const body = '<p class="sp-dim">What do you want to add?</p><div class="sp-quick">' +
      [["task", "Task", "Something to do, optionally linked to a goal"], ["objective", "Yearly objective", "A big goal for a year"], ["priority", "Quarterly priority", "What matters most this quarter"], ["milestone", "Monthly milestone", "A checkpoint for a month"],
        ["block", "Time block", "Plan time on the weekly schedule"], ["breakdown", "Break down a goal", "Walk from a goal down to a first task"], ["template", "Start from a template", "Reuse a ready-made breakdown"]].map(function (x) {
        return '<button type="button" class="sp-quick-btn" data-sheet-act="' + x[0] + '"><strong>' + esc(x[1]) + '</strong><span class="sp-dim">' + esc(x[2]) + '</span></button>';
      }).join("") + '</div>';
    A.openSheet({
      title: "Quick add", body: body,
      onAct: function (act) {
        A.closeSheet(true);
        const now = store.today(), y = Number(now.slice(0, 4));
        if (act === "task") A.openNewTaskSheet({});
        else if (act === "objective") A.openNodeSheet({ type: "objective", year: y });
        else if (act === "priority") A.openNodeSheet({ type: "priority", year: y, quarter: PL.quarterOfDate(now) });
        else if (act === "milestone") A.openNodeSheet({ type: "milestone", year: y, month: PL.monthOfDate(now) });
        else if (act === "block") A.openBlockSheet({ date: store.today() });
        else if (act === "breakdown" && A.openBreakdown) A.openBreakdown({});
        else if (act === "template" && A.openTemplates) A.openTemplates();
      }
    });
  };
  // A new task (the same record Habits makes), optionally linked to a plan item right away.
  A.openNewTaskSheet = function (o) {
    const choices = window.JarvisPlan.choices("");
    const opts = '<option value="">Not linked to a goal</option>' + (function () {
      let html = "", group = null;
      choices.forEach(function (c) { if (c.group !== group) { if (group !== null) html += "</optgroup>"; html += '<optgroup label="' + esc(c.group) + '">'; group = c.group; } html += '<option value="' + esc(c.id) + '"' + (o && o.nodeId === c.id ? " selected" : "") + '>' + esc(c.label) + '</option>'; });
      return html + (group !== null ? "</optgroup>" : "");
    })();
    const body = A.fText("text", "Task", (o && o.text) || "", { max: 140, required: true, placeholder: "What needs doing?" }) +
      '<div class="form-row two-col"><div><label for="spf_date">Day</label><input type="date" id="spf_date" name="date" value="' + esc((o && o.date) || store.today()) + '"></div><div><label for="spf_priority">Priority</label><select id="spf_priority" name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></div></div>' +
      A.row("nodeId", "Counts toward", '<select id="spf_nodeId" name="nodeId">' + opts + '</select>') + A.fText("estMin", "Time you expect it to take (minutes, optional)", "", { mode: "numeric" });
    A.openSheet({
      title: "New task", body: body, submit: "Add task",
      onSubmit: function (v) {
        if (!String(v.text || "").trim()) return { ok: false, errors: { text: "Enter a task." } };
        const est = PL.setEstimate(store.all("links"), "probe", v.estMin, {});
        if (!est.ok) return { ok: false, errors: { estMin: est.error } };
        const t = window.JarvisHabits && window.JarvisHabits.addTask ? window.JarvisHabits.addTask({ text: v.text, date: v.date, priority: v.priority, kind: "deadline" }) : null;
        if (!t) return { ok: false, errors: { text: "That task couldn't be added." } };
        let links = store.all("links");
        if (v.estMin) links = PL.setEstimate(links, t.id, v.estMin, {}).links;
        if (v.nodeId) { const r = PL.setLink(links, t.id, v.nodeId, { nodes: store.all("nodes") }); if (r.ok) links = r.links; }
        if (links !== store.all("links") && !store.replace("links", links)) return { ok: false, message: store.error() };
        A.say("Task added");
        return { ok: true };
      }
    });
  };

  A.openSearchSheet = function () {
    const body = '<div class="form-row"><label for="spf_q">Search your goals and tasks</label><input type="search" id="spf_q" name="q" autocomplete="off" placeholder="e.g. samples"></div><div id="spSearchOut" class="sp-search-out" aria-live="polite"></div>';
    function results(root) {
      const q = String(root.querySelector("#spf_q").value || "").trim().toLowerCase(), out = root.querySelector("#spSearchOut");
      if (!q) { out.innerHTML = '<p class="sp-dim">Type to search objectives, priorities, milestones and tasks.</p>'; return; }
      const m = A.model();
      const nodes = m.all().filter(function (n) { return (n.title + " " + n.description + " " + n.notes + " " + n.successMetric).toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
      const tasks = A.tasks().filter(function (t) { return t && t.text && t.text.toLowerCase().indexOf(q) !== -1 && !PL.isArchived(store.all("links"), t.id); }).slice(0, 8);
      out.innerHTML = (nodes.length ? '<h3 class="sp-h4">Goals</h3><ul class="sp-kids">' + nodes.map(function (n) { return '<li><button type="button" class="sp-kid" data-sheet-act="detail" data-id="' + esc(n.id) + '"><span class="sp-kid-t">' + esc(n.title) + '</span><span class="sp-kid-k">' + esc(A.typeLabel(n.type)) + '</span><span class="sp-kid-p">' + esc(A.pctText(m.progress(n.id).pct)) + '</span></button></li>'; }).join("") + '</ul>' : "") +
        (tasks.length ? '<h3 class="sp-h4">Tasks</h3><ul class="sp-kids">' + tasks.map(function (t) { return '<li><button type="button" class="sp-kid" data-sheet-act="task" data-id="' + esc(t.id) + '"><span class="sp-kid-t">' + esc(t.text) + '</span><span class="sp-kid-k">' + esc(A.fmtShort(t.date)) + '</span><span class="sp-kid-p">' + (t.completed ? "done" : "") + '</span></button></li>'; }).join("") + '</ul>' : "") +
        (!nodes.length && !tasks.length ? '<p class="sp-dim">Nothing matches “' + esc(q) + '”.</p>' : "");
    }
    A.openSheet({
      title: "Search", body: body, focus: "#spf_q",
      onOpen: function (root) { results(root); },
      onInput: function (el, root) { if (el.id === "spf_q") results(root); },
      onAct: function (act, el) { const id = el.getAttribute("data-id"); if (act === "detail") A.openDetailSheet(id); else if (act === "task") A.openTaskSheet(id); }
    });
  };

  /* ---------------- clicks ---------------- */

  A.acts["detail"] = function (el) { A.openDetailSheet(el.getAttribute("data-id")); };
  A.acts["task-detail"] = function (el) { A.openTaskSheet(el.getAttribute("data-id")); };
  A.acts["dash-toggle"] = function () { A.ui.dash = !A.ui.dash; A.saveUi(); A.renderDash(); const b = A.$("spDash").querySelector(".sp-dash-btn"); if (b) b.focus(); };
  A.acts["onboarding-dismiss"] = function () { if (!store.setSettings({ onboardingDismissed: true })) { A.saveFailed(); return; } A.render(); A.say("Getting started hidden. You can bring it back under Plan settings."); };
  A.acts["go-weekly"] = function () { A.go("weekly"); };
  A.acts["go-monthly"] = function () { A.go("monthly", { month: A.PL.monthOfDate(store.today()) }); };
  A.acts["go-quarterly"] = function () { A.go("quarterly"); };
  A.acts["quick-task"] = function () { A.openNewTaskSheet({}); };
  A.acts["quick-add"] = function () { A.openQuickAdd(); };
  A.acts["search"] = function () { A.openSearchSheet(); };
  A.acts["add-objective-first"] = function () { const y = Number(store.today().slice(0, 4)); A.openNodeSheet({ type: "objective", year: PL.planYears(store.settings()).indexOf(y) !== -1 ? y : store.settings().startYear }); };
  A.acts["link-first-task"] = function () {
    const m = A.model(), n = m.all("milestone")[0] || m.all("priority")[0] || m.all("objective")[0];
    if (n) A.openLinkSheet(n.id); else A.notice("Add an objective first, then link a task to it.", "");
  };
  A.acts["breakdown"] = function () { if (A.openBreakdown) A.openBreakdown({}); };
  // Use the three suggested tasks as this week's top three (saved, so they stay put).
  A.useTopThree = function (weekStart) {
    const c = A.ictx(weekStart), picks = I.topThreePicks(c).map(function (p) { return { taskId: p.task.id, text: "" }; });
    const r = W.setWeek(store.all("weeks"), c.weekStart, { top: picks }, {});
    if (!r.ok || !store.replace("weeks", r.weeks)) { A.saveFailed(); return false; }
    return true;
  };
  A.acts["top-accept"] = function () { if (A.useTopThree()) { A.render(); A.say("Top three saved"); } };

  // wire the header buttons once the panel exists
  document.addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("#panel-strategy [data-sp-head]");
    if (!b) return;
    const act = A.acts[b.getAttribute("data-sp-head")];
    if (act) act(b, e);
  });
  A.on = function (host) { void host; };
  (function listen() {
    const dash = document.getElementById("spDash");
    if (!dash || dash.getAttribute("data-wired")) { if (!dash) document.addEventListener("DOMContentLoaded", listen); return; }
    dash.setAttribute("data-wired", "1");
    dash.addEventListener("click", function (e) {
      const el = e.target.closest("[data-act]");
      if (!el || el.tagName === "INPUT") return;
      const fn = A.acts[el.getAttribute("data-act")];
      if (fn) fn(el, e);
    });
    dash.addEventListener("change", function (e) {
      const el = e.target;
      if (el.matches && el.matches('input[type="checkbox"][data-act]')) { const fn = A.acts[el.getAttribute("data-act")]; if (fn) fn(el, e); }
    });
  })();
  /* ---------------- the three tabs: Overview and Goals ---------------- */

  // One next step instead of the five-step list: the first thing that is not done yet.
  function nextStepHtml() {
    const s = store.settings();
    if (s.onboardingDismissed) return "";
    const m = A.model();
    const steps = [
      [!!s.vision, "Write your three-year vision", "plan-settings", "Write it"],
      [m.all("objective").length > 0, "Add a yearly objective", "add-objective-first", "Add one"],
      [m.all("priority").length + m.all("milestone").length > 0, "Break an objective down", "breakdown", "Break down a goal"],
      [A.tasks().some(function (t) { return m.nodeOfTask(t.id); }), "Link a task to a goal", "link-first-task", "Link a task"],
      [store.list("blocks").length > 0, "Plan time for it in Weekly", "go-weekly", "Open Weekly"]
    ];
    const next = steps.filter(function (x) { return !x[0]; })[0];
    if (!next) return "";
    const done = steps.filter(function (x) { return x[0]; }).length;
    return '<section class="sp-next" aria-label="Next step"><p class="sp-next-t"><span class="sp-dim">Step ' + (done + 1) + ' of ' + steps.length + '</span> ' + esc(next[1]) + '</p><div class="sp-next-btns"><button type="button" class="btn btn-secondary" data-act="' + next[2] + '">' + esc(next[3]) + '</button>' +
      '<button type="button" class="sp-link" data-act="onboarding-dismiss" aria-label="Hide the next steps">Hide</button></div></section>';
  }

  A.acts["go-insights"] = function () { A.go("insights"); };

  A.register("overview", {
    html: function () {
      const c = A.ictx(), d = I.dashboard(c), m = A.model(), s = m.settings;
      let h = '<h2 class="visually-hidden" data-focus-top>Overview</h2>';
      h += suggestionsHtml(c) + nextStepHtml();
      // the three-year vision, small
      h += '<section class="sp-ov" aria-labelledby="spOvVis"><div class="sp-ov-head"><h3 class="sp-ov-h" id="spOvVis">Three-year vision</h3><button type="button" class="sp-link" data-act="plan-settings">' + (s.vision ? "Edit" : "Write it") + '</button></div>' +
        (s.vision ? '<p class="sp-vis">' + esc(s.vision) + '</p>' : '<p class="sp-dim">Not written yet.</p>') + '</section>';
      // the top three goals of the year (this quarter's priorities when there are no yearly ones)
      const goals = (d.objectives.length ? d.objectives : d.priorities).slice(0, 3);
      h += '<section class="sp-ov" aria-labelledby="spOvGoals"><div class="sp-ov-head"><h3 class="sp-ov-h" id="spOvGoals">Top goals</h3><button type="button" class="sp-link" data-act="go-goals">All goals</button></div>' +
        (goals.length ? '<div class="sp-chips">' + goals.map(function (n) { return chipHtml(n); }).join("") + '</div>'
          : '<p class="sp-dim">No goals yet.</p><button type="button" class="btn btn-secondary" data-act="add-objective-first">Add a goal</button>') + '</section>';
      // the milestones that matter: open ones in order of their dates
      const open = d.milestones.filter(function (n) { return m.statusOf(n.id) !== "completed"; })
        .sort(function (a, b) { return m.deadline(a) < m.deadline(b) ? -1 : m.deadline(a) > m.deadline(b) ? 1 : 0; }).slice(0, 3);
      h += '<section class="sp-ov" aria-labelledby="spOvMs"><h3 class="sp-ov-h" id="spOvMs">Milestones</h3>' +
        (open.length ? '<ul class="sp-dl">' + open.map(function (n) {
          const due = m.deadline(n), left = due ? PL.diffDays(store.today(), due) : null;
          return '<li><button type="button" class="sp-dl-btn' + (left !== null && left < 0 ? " is-late" : "") + '" data-act="detail" data-id="' + esc(n.id) + '"><span class="sp-dl-t">' + esc(n.title) + '</span><span class="sp-dl-k">' + (left === null ? "" : esc(dayShort(left))) + '</span></button></li>';
        }).join("") + '</ul>' : '<p class="sp-dim">None open this month.</p>') + '</section>';
      // what to do next: the top three of the week, else what is dated today
      let focus = "";
      if (d.week.top.length) {
        focus = (d.week.topSuggested ? '<p class="sp-dim">Suggested from your plan.</p>' : "") + '<ol class="sp-top3">' + d.week.top.map(function (x) {
          const n = x.node;
          return '<li class="' + (x.done ? "is-done" : "") + '">' + (x.task ? check(x.task.id, x.done, x.text, "data-act") + '<button type="button" class="sp-trow-t" data-act="task-detail" data-id="' + esc(x.task.id) + '"><span class="sp-trow-n">' + esc(x.text) + '</span>' + (n ? '<span class="sp-trow-s">' + esc(n.title) + '</span>' : "") + '</button>' : '<span class="sp-trow-n">' + esc(x.text) + '</span>') + '</li>';
        }).join("") + '</ol>' + (d.week.topSuggested ? '<button type="button" class="btn btn-secondary" data-act="top-accept">Use these three</button>' : "");
      } else if (d.today.open.length) {
        focus = '<ul class="sp-trows">' + d.today.open.slice(0, 3).map(function (t) { return taskRow(t, m); }).join("") + '</ul>';
      } else focus = '<p class="sp-dim">Nothing to rank yet.</p><button type="button" class="btn btn-secondary" data-act="quick-task">Add a task</button>';
      h += '<section class="sp-ov sp-ov-focus" aria-labelledby="spOvFocus"><div class="sp-ov-head"><h3 class="sp-ov-h" id="spOvFocus">Focus next</h3><button type="button" class="sp-link" data-act="go-weekly">Open the week</button></div>' + focus + '</section>';
      h += '<p class="sp-ov-foot"><button type="button" class="sp-link" data-act="go-insights">More numbers</button></p>';
      return h;
    }
  });
  A.acts["go-goals"] = function () { A.go("goals"); };

  // Goals: the year, the quarter and the month, each folded until opened. Each section is the screen it always was.
  function asSubheads(html) { return String(html).replace(/<h2\b/g, "<h4").replace(/<\/h2>/g, "</h4>"); }
  A.register("goals", {
    html: function () {
      const m = A.model(), s = m.settings, st = A.state, y = st.year, q = st.quarter, mk = st.month;
      const nObj = m.all("objective").length, nPri = m.prioritiesOf(y, q).filter(function (p) { return p.status !== "dropped"; }).length, nMs = m.milestonesIn(mk).length;
      let h = '<h2 class="visually-hidden" data-focus-top>Goals</h2>';
      h += A.section("g-year", "Year", asSubheads(A.viewHtml("yearly")), { open: true, summary: esc(A.plural(nObj, "objective")) });
      h += A.section("g-quarter", "Quarter", asSubheads(A.viewHtml("quarterly")), { open: false, summary: "Q" + q + " " + y + " &middot; " + esc(A.plural(nPri, "priority", "priorities")) });
      h += A.section("g-month", "Month", asSubheads(A.viewHtml("monthly")), { open: false, summary: esc(A.monthLabel(mk)) + " &middot; " + esc(A.plural(nMs, "milestone")) });
      void s;
      return h;
    },
    after: function () {
      const id = A.state.focusSec;
      if (!id) return;
      A.state.focusSec = "";
      const sec = document.querySelector('#spView [data-sec="' + id + '"]');
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "start" });
    }
  });
  // The overview above the tabs is gone: the Overview tab holds it.
  A.renderDash = function () { const host = A.$("spDash"); if (host) host.innerHTML = ""; };

})();
