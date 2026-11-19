/* ==========================================================================
   JARVIS — Goals dashboard (the screen). Planning > Habits > Progress > Goals.

   What am I working toward, how close am I, and what should I do next: four numbers, your goals as compact cards, and the next steps
   of the goals that are still open. The rules are in goals-logic.js; the goals themselves stay in jarvisGoals (habits.js keeps the
   list and saves it) and the tasks stay in jarvisTasks, so nothing here is a second copy of anything:

     a milestone's task is an ordinary task (the To-Do list and the Calendar show and tick it); the milestone is done when it is,
     a goal's deadline and its milestones' dates are shown on the Calendar by calendar-ui.js,
     a Strategy item that follows a goal (Strategy's own "One of my Goals" measure) is how a goal is linked to a strategic objective.

   Nothing is reported as saved unless it was. A change that can be undone has an Undo for a few seconds.
   ========================================================================== */

(function () {
  "use strict";

  const GL = window.JarvisGoalsLogic, PL = window.JarvisPlanLogic;
  const UNDO_MS = 8000, STEPS_SHOWN = 5;
  const CAT_OPTS = [["", "No category"]].concat(GL.CATEGORIES.map(function (c) { return [c[0], c[1]]; })).concat([["__other", "Other…"]]);
  const PRI_OPTS = [["high", "High"], ["medium", "Medium"], ["low", "Low"]];
  const MODE_OPTS = [["milestones", "Milestones (a checklist)"], ["numeric", "A number (books, money, hours…)"], ["manual", "Manually (a percentage)"]];

  let ready = false, undo = null;
  const ui = { filter: "all", open: {}, updating: "", allSteps: false, showDone: false };

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(s); }
  function H() { return window.JarvisHabits && window.JarvisHabits.getGoals ? window.JarvisHabits : null; }
  function A() { return window.JarvisPlanApp || null; }
  // Copies of the lists, so a list kept for Undo is not changed by the add or remove that comes after it.
  function goals() { const h = H(); return h ? h.getGoals().slice() : []; }
  function tasks() { const h = H(); return h && h.getTasks ? h.getTasks().slice() : []; }
  function today() { return core().todayISODate(); }
  function panelActive() { const p = $("habits-goals"); return !!(p && p.classList.contains("active") && p.offsetParent !== null); }
  function say(t) { const el = $("gdLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = t; }, 30); } }
  function ctx() { return { now: Date.now(), makeId: function (p) { return core().uid(p); } }; }
  function goalById(id) { return goals().filter(function (g) { return g.id === id; })[0] || null; }
  function fmtDate(d) {
    if (!GL.isDate(d)) return "";
    const dt = new Date(d + "T12:00:00"), same = d.slice(0, 4) === today().slice(0, 4);
    return dt.toLocaleDateString(undefined, same ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  function nf(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function priLabel(p) { return p === "high" ? "High" : p === "low" ? "Low" : "Medium"; }
  // The category as it should read: one of the four shows its proper name even if it was saved in lower case; anything else shows as saved.
  function catLabel(g) { const k = GL.categoryKey(g.category); const c = GL.CATEGORIES.filter(function (x) { return x[0] === k; })[0]; return c ? c[1] : (g.category ? String(g.category) : ""); }
  // 1,800 and a "$" read $1,800; 7 and "books" read 7 books.
  function isSymbol(u) { return !!u && u.length <= 2 && !/[A-Za-z0-9]/.test(u); }
  function val(n, u) { return isSymbol(u) ? u + nf(n) : nf(n); }
  function tail(u) { return u && !isSymbol(u) ? " " + u : ""; }

  /* ---------------- messages and undo ---------------- */

  function hideUndo() { if (undo && undo.timer) window.clearTimeout(undo.timer); undo = null; const b = $("gdUndo"); if (b) { b.classList.add("hidden"); b.innerHTML = ""; } }
  function notice(text, label, fn) {
    hideUndo();
    const b = $("gdUndo"); if (!b) return;
    b.innerHTML = '<span>' + esc(text) + '</span>' + (label ? '<button type="button" class="btn btn-secondary" data-gd="undo">' + esc(label) + '</button>' : "");
    b.classList.remove("hidden");
    undo = { fn: fn || function () {}, timer: window.setTimeout(hideUndo, UNDO_MS) };
    say(text);
  }
  function failed() { notice("The browser would not save that. Nothing was changed.", ""); }

  /* ---------------- saving ---------------- */

  // Saves the list; false (and a message) if the browser refused.
  function save(next) { const h = H(); if (!h || !h.commitGoals(next)) { failed(); render(); return false; } return true; }
  function saveTasks(next) { const h = H(); if (!h) return false; h.commitTasks(next); return true; }
  // Keeps the ticks saved on milestones in step with their tasks (the tasks are the truth while they exist).
  function reconcile() {
    const r = GL.syncFromTasks(goals(), tasks(), ctx());
    if (r.changed) { const h = H(); if (h) h.commitGoals(r.goals); }
  }

  /* ---------------- drawing ---------------- */

  function supports(goalId) {
    try {
      const S = window.JarvisPlanStore; if (!S || !PL) return [];
      S.init();
      const nodes = PL.liveNodes(S.all("nodes"));
      return nodes.filter(function (n) { return n.measure === "goal" && n.goalId === goalId; }).map(function (n) {
        let top = n, guard = 0;
        while (top.parentId && guard++ < 6) { const p = PL.byId(nodes, top.parentId); if (!p) break; top = p; }
        return { id: n.id, title: n.title, chain: top.id === n.id ? n.title : top.title + " › " + n.title, type: n.type };
      });
    } catch (e) { return []; }
  }

  function statsHtml(st) {
    const tile = function (n, l, sub) { return '<div class="gd-stat"><span class="gd-stat-n">' + esc(n) + '</span><span class="gd-stat-l">' + esc(l) + '</span>' + (sub ? '<span class="gd-stat-s">' + esc(sub) + '</span>' : "") + '</div>'; };
    return '<div class="gd-stats" role="group" aria-label="Goal summary">' + tile(st.active, "Active goals") + tile(st.completed, "Goals completed") + tile(st.dueSoon, "Due soon", st.overdue ? st.overdue + " overdue" : "") +
      tile(st.overall === null ? "–" : st.overall + "%", "Overall progress") + '</div>';
  }
  function chipsHtml(list) {
    return '<div class="gd-filters" role="group" aria-label="Show goals">' + GL.chips(list).map(function (c) {
      return '<button type="button" class="gd-chip" data-gd="filter" data-v="' + c.key + '" aria-pressed="' + (ui.filter === c.key) + '">' + esc(c.label) + ' <span class="gd-chip-n">' + c.count + '</span></button>';
    }).join("") + '</div>';
  }
  function barHtml(pct, name, done) {
    return '<div class="gd-bar' + (done ? " is-done" : "") + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="' + esc("Progress for " + name) + '"><span style="width:' + pct + '%"></span></div>';
  }
  function figuresHtml(g, p) {
    const id = esc(g.id);
    if (p.mode === "numeric") {
      const u = p.unit;
      let h = '<p class="gd-fig"><span>' + esc(val(p.current, u) + " of " + val(p.target, u) + tail(u)) + '</span><span class="gd-fig-dim">' + esc(p.reached ? "Target reached" : val(p.remaining, u) + tail(u) + " to go") + '</span>' +
        (g.completed ? "" : '<button type="button" class="gd-link" data-gd="upd-open" data-id="' + id + '" aria-expanded="' + (ui.updating === g.id) + '">Update</button>') + '</p>';
      if (ui.updating === g.id && !g.completed) h += '<div class="gd-upd"><label class="visually-hidden" for="gdUpd_' + id + '">' + esc("Where " + g.name + " stands now") + '</label><input type="text" inputmode="decimal" id="gdUpd_' + id + '" class="gd-upd-in" data-gd-upd="' + id + '" value="' + esc(String(p.current)) + '" autocomplete="off"><button type="button" class="btn btn-primary" data-gd="upd-save" data-id="' + id + '">Save</button></div>';
      return h;
    }
    if (p.mode === "milestones") return '<p class="gd-fig"><span>' + (p.total ? p.done + ' of ' + p.total + (p.total === 1 ? ' milestone' : ' milestones') : 'No milestones yet') + '</span>' + (p.reached && !g.completed ? '<span class="gd-fig-dim">All done</span>' : "") + '</p>';
    return '<p class="gd-fig"><span>Tracked by hand</span>' + (g.completed ? "" : '<span class="gd-step"><button type="button" class="gd-step-btn" data-gd="step" data-d="-5" data-id="' + id + '" aria-label="' + esc("Lower " + g.name + " by 5%") + '">&minus;</button><button type="button" class="gd-step-btn" data-gd="step" data-d="5" data-id="' + id + '" aria-label="' + esc("Raise " + g.name + " by 5%") + '">+</button></span>') + '</p>';
  }
  function msListHtml(g, p) {
    const ms = GL.milestones(g), tl = tasks();
    let h = '<ul class="gd-ms" aria-label="' + esc("Milestones for " + g.name) + '">' + ms.map(function (m) {
      const done = GL.milestoneDone(m, tl), t = m.taskId ? tl.filter(function (x) { return x.id === m.taskId; })[0] : null, due = GL.dueInfo(m.due, today());
      return '<li class="gd-ms-i' + (done ? " is-done" : "") + '"><button type="button" class="cal-tick' + (done ? " done" : "") + '" data-gd="ms-tick" data-id="' + esc(g.id) + '" data-ms="' + esc(m.id) + '" aria-pressed="' + done + '" aria-label="' + (done ? "Done: " : "Mark done: ") + esc(m.text) + '">' + (done ? "&#10003;" : "") + '</button>' +
        '<button type="button" class="gd-ms-t" data-gd="ms-open" data-id="' + esc(g.id) + '" data-ms="' + esc(m.id) + '"><span class="gd-ms-name">' + esc(m.text) + '</span>' +
        '<span class="gd-ms-sub">' + (m.due ? '<span class="gd-due is-' + (done ? "later" : due.tone) + '">' + esc(fmtDate(m.due)) + '</span>' : '<span class="gd-ms-nodate">No date</span>') + (t ? '<span class="gd-ms-task">On your calendar' + (t.date ? ' · ' + esc(fmtDate(t.date)) : "") + '</span>' : "") + '</span></button></li>';
    }).join("") + '</ul>';
    h += '<div class="gd-add"><label class="visually-hidden" for="gdMsIn_' + esc(g.id) + '">' + esc("Add a milestone to " + g.name) + '</label><input type="text" id="gdMsIn_' + esc(g.id) + '" class="gd-add-in" data-gd-ms-in="' + esc(g.id) + '" maxlength="' + GL.MS_MAX + '" placeholder="Add a milestone" autocomplete="off"><button type="button" class="btn btn-secondary" data-gd="ms-add" data-id="' + esc(g.id) + '">Add</button></div>';
    return h;
  }
  function looseTasks(g) {
    const claimed = {}; GL.milestones(g).forEach(function (m) { if (m.taskId) claimed[m.taskId] = true; });
    return tasks().filter(function (t) { return t.goalId === g.id && !claimed[t.id]; }).sort(function (a, b) { return (a.completed ? 1 : 0) - (b.completed ? 1 : 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); });
  }
  function moreHtml(g, p) {
    const sup = supports(g.id), loose = looseTasks(g);
    let h = '<div class="gd-more" id="gdMore_' + esc(g.id) + '">';
    if (g.description) h += '<p class="gd-desc">' + esc(g.description) + '</p>';
    h += '<h3 class="gd-h4">Milestones</h3>' + msListHtml(g, p);
    h += '<h3 class="gd-h4">Tasks</h3>';
    h += loose.length ? '<ul class="gd-tasks">' + loose.slice(0, 6).map(function (t) {
      return '<li class="gd-task' + (t.completed ? " is-done" : "") + '"><button type="button" class="cal-tick' + (t.completed ? " done" : "") + '" data-gd="task-tick" data-task="' + esc(t.id) + '" aria-pressed="' + !!t.completed + '" aria-label="' + (t.completed ? "Done: " : "Mark done: ") + esc(t.text) + '">' + (t.completed ? "&#10003;" : "") + '</button><span class="gd-task-t">' + esc(t.text) + '</span><span class="gd-task-d">' + esc(fmtDate(t.date)) + '</span></li>';
    }).join("") + '</ul>' : '<p class="gd-none">No tasks yet.</p>';
    h += '<div class="gd-more-actions"><button type="button" class="btn btn-secondary" data-gd="task-new" data-id="' + esc(g.id) + '">+ Add a task</button><button type="button" class="btn btn-secondary" data-gd="link" data-id="' + esc(g.id) + '">' + (sup.length ? "Change Strategy link" : "Link to Strategy") + '</button></div>';
    return h + '</div>';
  }
  function cardHtml(g, steps) {
    const p = GL.progress(g, tasks()), due = GL.dueInfo(g.targetDate, today()), open = !!ui.open[g.id], id = esc(g.id), pri = GL.priorityOf(g), sup = supports(g.id), nx = GL.nextFor(steps, g.id);
    const cat = catLabel(g);
    let h = '<article class="gd-card' + (g.completed ? " is-done" : "") + '" data-goal="' + id + '" aria-labelledby="gdN_' + id + '">';
    h += '<div class="gd-top"><button type="button" class="gd-main" data-gd="toggle" data-id="' + id + '" aria-expanded="' + open + '" aria-controls="gdMore_' + id + '"><span class="gd-name" id="gdN_' + id + '">' + esc(g.name) + '</span>' +
      '<span class="gd-meta">' + (cat ? '<span class="gd-cat">' + esc(cat) + '</span>' : "") + (pri !== "medium" && !g.completed ? '<span class="gd-prio is-' + pri + '">' + priLabel(pri) + ' priority</span>' : "") +
      (g.completed ? '<span class="gd-due is-done">Completed</span>' : GL.isDate(g.targetDate) ? '<span class="gd-due is-' + due.tone + '">' + esc(fmtDate(g.targetDate)) + ' · ' + esc(due.text.replace(/^Due /, "")) + '</span>' : '<span class="gd-due is-none">No target date</span>') + '</span></button>' +
      '<span class="gd-pct" aria-hidden="true">' + p.pct + '%</span></div>';
    h += barHtml(p.pct, g.name, g.completed) + '<span class="visually-hidden">' + p.pct + ' percent complete</span>';
    h += figuresHtml(g, p);
    if (!g.completed && (nx || p.mode === "milestones")) h += nx ? '<p class="gd-next"><span class="gd-next-l">Next</span> ' + esc(nx.title) + (nx.due ? ' <span class="gd-next-d' + (nx.overdue ? " is-overdue" : "") + '">· ' + esc(fmtDate(nx.due)) + '</span>' : "") + '</p>' : '<p class="gd-next gd-next-none">' + (p.mode === "milestones" && !p.total ? "Add a milestone to see what is next." : "No next step yet.") + '</p>';
    if (sup.length) h += '<p class="gd-supports">Supports: ' + esc(sup[0].chain) + (sup.length > 1 ? ' +' + (sup.length - 1) : "") + '</p>';
    h += '<div class="gd-actions"><button type="button" class="btn btn-secondary" data-gd="edit" data-id="' + id + '">Edit</button><button type="button" class="btn ' + (p.reached && !g.completed ? "btn-primary" : "btn-secondary") + '" data-gd="complete" data-id="' + id + '">' + (g.completed ? "Reopen" : "Complete") + '</button></div>';
    if (open) h += moreHtml(g, p);
    return h + '</article>';
  }
  function stepRowHtml(s) {
    const due = s.due ? GL.dueInfo(s.due, today()) : null;
    return '<li class="gd-step-row' + (s.overdue ? " is-overdue" : "") + '"><button type="button" class="cal-tick" data-gd="step-tick" data-key="' + esc(s.key) + '" aria-pressed="false" aria-label="' + esc("Mark done: " + s.title) + '"></button>' +
      '<button type="button" class="gd-step-main" data-gd="step-goal" data-id="' + esc(s.goalId) + '"><span class="gd-step-t">' + esc(s.title) + '</span><span class="gd-step-s"><span>' + esc(s.goalName) + '</span>' +
      (due ? ' · <span class="gd-due is-' + due.tone + '">' + esc(s.overdue ? due.text : fmtDate(s.due)) + '</span>' : "") + '</span></button>' +
      (s.onToday ? '<span class="gd-ontoday">On today</span>' : '<button type="button" class="btn btn-secondary gd-today" data-gd="step-today" data-key="' + esc(s.key) + '" aria-label="' + esc("Add to today: " + s.title) + '">+ Today</button>') + '</li>';
  }

  function render() {
    const root = $("gdRoot");
    if (!root || !ready || !H()) return;
    reconcile();
    const all = goals(), tl = tasks(), td = today(), st = GL.stats(all, tl, td);
    const shown = GL.order(GL.filter(all, ui.filter)), steps = GL.steps(all, tl, td);
    const active = shown.filter(function (g) { return !g.completed; }), done = shown.filter(function (g) { return g.completed; });
    const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest("#gdRoot") ? focusKey(document.activeElement) : "";
    let h = '<div class="gd-head"><h2 class="gd-title">Goals</h2><button type="button" class="btn btn-primary gd-new" data-gd="new">+ New Goal</button></div>';
    if (!all.length) {
      h += '<div class="gd-empty"><p class="gd-empty-t">What are you working toward?</p><p class="gd-empty-s">Set a goal, split it into milestones, and JARVIS will show how close you are and what to do next.</p><button type="button" class="btn btn-primary" data-gd="new">+ New Goal</button></div>';
    } else {
      h += statsHtml(st) + chipsHtml(all);
      h += active.length ? '<div class="gd-grid">' + active.map(function (g) { return cardHtml(g, steps); }).join("") + '</div>' : '<p class="gd-none gd-none-pad">' + (ui.filter === "all" ? "No active goals. Everything is complete." : "No active goals in this category.") + '</p>';
      if (done.length) {
        h += '<button type="button" class="gd-done-toggle" data-gd="show-done" aria-expanded="' + ui.showDone + '">Completed goals <span class="gd-chip-n">' + done.length + '</span><span class="cdp-chev" aria-hidden="true"></span></button>';
        if (ui.showDone) h += '<div class="gd-grid">' + done.map(function (g) { return cardHtml(g, steps); }).join("") + '</div>';
      }
      const visible = ui.filter === "all" ? steps : steps.filter(function (s) { return GL.categoryKey((goalById(s.goalId) || {}).category) === ui.filter; });
      h += '<section class="gd-nextsteps" aria-labelledby="gdNextH"><div class="gd-ns-head"><h3 class="gd-h3" id="gdNextH">Next steps</h3>' + (visible.length ? '<span class="gd-ns-n">' + visible.length + '</span>' : "") + '</div>';
      if (visible.length) {
        const list = ui.allSteps ? visible : visible.slice(0, STEPS_SHOWN);
        h += '<ul class="gd-steps">' + list.map(stepRowHtml).join("") + '</ul>';
        if (visible.length > STEPS_SHOWN) h += '<button type="button" class="gd-link gd-more-steps" data-gd="all-steps" aria-expanded="' + ui.allSteps + '">' + (ui.allSteps ? "Show fewer" : "Show all " + visible.length) + '</button>';
      } else h += '<p class="gd-none">Nothing to do yet. Add milestones or tasks to your goals and the most urgent ones show up here.</p>';
      h += '<p class="gd-hint">Ordered by how soon they are due, then by the priority you gave the goal. Nothing here changes a goal until you do.</p></section>';
    }
    h += '<p class="gd-foot"><button type="button" class="gd-link" data-open-strategy>Open Strategy</button> to see the bigger plan your goals support.</p>';
    root.innerHTML = h;
    if (keep) refocus(keep);
  }
  function focusKey(el) {
    const k = el.getAttribute && el.getAttribute("data-gd");
    if (!k) return el.id ? "#" + el.id : "";
    let sel = '[data-gd="' + k + '"]';
    ["data-id", "data-ms", "data-key", "data-task", "data-v", "data-d"].forEach(function (a) { const v = el.getAttribute(a); if (v !== null) sel += "[" + a + '="' + String(v).replace(/"/g, '\\"') + '"]'; });
    return sel;
  }
  function refocus(sel) { window.setTimeout(function () { try { const e = document.querySelector("#gdRoot " + sel) || document.querySelector(sel); if (e) e.focus(); } catch (x) { /* the thing is gone */ } }, 0); }
  function openCard(id) { ui.open[id] = true; render(); const c = document.querySelector('#gdRoot [data-goal="' + id + '"]'); if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest", behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }

  /* ---------------- doing things ---------------- */

  function completeGoal(id) {
    const g = goalById(id); if (!g) return;
    const prev = goals(), r = GL.setCompleted(prev, id, !g.completed, ctx());
    if (!r.ok || !save(r.goals)) return;
    render();
    notice(g.completed ? "Reopened “" + g.name + "”." : "Completed “" + g.name + "”.", "Undo", function () { if (save(prev)) { render(); say("Undone."); } });
  }
  function quickCurrent(id) {
    const inp = document.querySelector('#gdRoot [data-gd-upd="' + id + '"]'); if (!inp) return;
    const r = GL.setCurrent(goals(), id, inp.value, ctx());
    if (!r.ok) { notice(r.error || "That isn't a number.", ""); refocus('[data-gd-upd="' + id + '"]'); return; }
    if (!save(r.goals)) return;
    ui.updating = ""; render(); say("Progress updated to " + GL.progress(r.goal, tasks()).pct + " percent.");
  }
  function stepGoal(id, d) {
    const r = GL.stepManual(goals(), id, d, ctx());
    if (r.ok && save(r.goals)) { render(); say(GL.progress(r.goal, tasks()).pct + " percent."); }
  }
  // Ticks a milestone. With a task, the task is what changes (so the Calendar, the To-Do list and the milestone all agree).
  // Ticks or unticks a milestone, and its task when it has one. Says nothing on screen: whoever asked (this screen or the Calendar) tells the person.
  function tickMilestone(goalId, msId) {
    const g = goalById(goalId); if (!g) return { ok: false };
    const m = GL.milestones(g).filter(function (x) { return x.id === msId; })[0]; if (!m) return { ok: false };
    const prevGoals = goals(), prevTasks = tasks(), done = !GL.milestoneDone(m, prevTasks);
    const r = GL.setMilestoneDone(prevGoals, goalId, msId, done, prevTasks, ctx());
    if (!r.ok) return { ok: false };
    if (r.taskPatch) saveTasks(prevTasks.map(function (t) { return t.id === r.taskPatch.taskId ? Object.assign({}, t, { completed: r.taskPatch.completed }) : t; }));
    if (!save(r.goals)) { if (r.taskPatch) saveTasks(prevTasks); return { ok: false }; }
    return { ok: true, done: done, text: m.text, undo: function () { saveTasks(prevTasks); return save(prevGoals); } };
  }
  function toggleMilestone(goalId, msId) {
    const r = tickMilestone(goalId, msId); if (!r.ok) return false;
    render();
    notice((r.done ? "Done: " : "Not done: ") + r.text + ".", "Undo", function () { if (r.undo()) { render(); say("Undone."); } });
    return true;
  }
  function addMilestones(goalId, text) {
    const lines = String(text || "").split(/\r?\n/).map(function (x) { return x.replace(/^[\s\-*•\d.)]+/, "").trim(); }).filter(Boolean);
    if (!lines.length) { notice("Write the milestone first.", ""); return; }
    let list = goals();
    for (let i = 0; i < lines.length; i++) { const r = GL.addMilestone(list, goalId, lines[i], ctx()); if (!r.ok) { notice(r.error || "That couldn't be added.", ""); break; } list = r.goals; }
    if (list === goals() || !save(list)) return;
    render(); say(lines.length === 1 ? "Milestone added." : lines.length + " milestones added."); refocus('[data-gd-ms-in="' + goalId + '"]');
  }
  function toggleTask(id) {
    const tl = tasks(), t = tl.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    saveTasks(tl.map(function (x) { return x.id === id ? Object.assign({}, x, { completed: !x.completed }) : x; }));
    reconcile(); render(); say((t.completed ? "Not done: " : "Done: ") + t.text + ".");
  }
  // Makes a task for a milestone (or for the goal) and links it, so it is one thing in the To-Do list, the Calendar and here. Rolls back if it can't be saved.
  function makeTask(goalId, msId, fields) {
    const h = H(), g = goalById(goalId); if (!h || !g) return { ok: false, error: "That goal isn't there any more." };
    const m = msId ? GL.milestones(g).filter(function (x) { return x.id === msId; })[0] : null;
    const d = GL.taskDraft(g, m, Object.assign({ today: today() }, fields || {}));
    if (!d.text) return { ok: false, error: "Write what needs to be done." };
    if (!GL.isDate(d.date)) return { ok: false, error: "Choose a day." };
    const prevGoals = goals(), prevTasks = tasks(), made = h.addTask({ text: d.text, date: d.date, time: d.time, priority: d.priority, goalId: g.id });
    if (!made) return { ok: false, error: "That task couldn't be added." };
    if (m) {
      const r = GL.linkTask(prevGoals, goalId, msId, made.id, ctx());
      if (!r.ok || !h.commitGoals(r.goals)) { saveTasks(prevTasks); return { ok: false, error: "The browser would not save that." }; }
    }
    return { ok: true, task: made, undo: function () { saveTasks(prevTasks); h.commitGoals(prevGoals); } };
  }
  // Puts a step on a day: a milestone with no task gets one, a task that is already there is moved. Says nothing on screen; the caller tells the person.
  function putStepOnDay(key, date) {
    const st = GL.steps(goals(), tasks(), today()).filter(function (s) { return s.key === key; })[0];
    if (!st) return { ok: false, error: "That step isn't there any more." };
    if (st.taskId) {
      const tl = tasks(), t = tl.filter(function (x) { return x.id === st.taskId; })[0];
      if (!t) return { ok: false, error: "That task isn't there any more." };
      if (t.date === date) return { ok: true, same: true, title: st.title };
      saveTasks(tl.map(function (x) { return x.id === t.id ? Object.assign({}, x, { date: date }) : x; }));
      return { ok: true, moved: true, title: st.title, undo: function () { saveTasks(tl); } };
    }
    const r = makeTask(st.goalId, st.milestoneId, { date: date });
    if (!r.ok) return r;
    return { ok: true, made: true, title: st.title, undo: r.undo };
  }
  // + Today: the step's task goes on today's calendar.
  function addToToday(key) {
    const r = putStepOnDay(key, today());
    if (!r.ok) { notice(r.error, ""); return; }
    if (r.same) { notice("\u201c" + r.title + "\u201d is already on today's calendar.", ""); return; }
    render(); notice((r.moved ? "Moved \u201c" + r.title + "\u201d to today." : "Added \u201c" + r.title + "\u201d to today's calendar."), "Undo", function () { r.undo(); render(); say("Undone."); });
  }
  // For the Day planner: the next steps of active goals that are not already on that day, most important first.
  function stepsForDay(date, limit) {
    return GL.steps(goals(), tasks(), today()).filter(function (s) { return s.scheduled !== date; }).slice(0, limit || 3).map(function (s) {
      return { key: s.key, title: s.title, goalName: s.goalName, due: s.due, overdue: !!s.overdue };
    });
  }
  function addStepToDay(key, date) {
    const r = putStepOnDay(key, date);
    if (r.ok && !r.same) render();
    return r;
  }
  function tickStep(key) {
    const st = GL.steps(goals(), tasks(), today()).filter(function (s) { return s.key === key; })[0]; if (!st) return;
    if (st.kind === "milestone") toggleMilestone(st.goalId, st.milestoneId); else toggleTask(st.taskId);
  }

  /* ---------------- sheets ---------------- */

  function dateField(a, name, label, value, o) { return a.fText(name, label, value, Object.assign({ type: "date" }, o || {})); }
  function msRowHtml(i, m) {
    return '<div class="gd-ms-row" data-ms-row><input type="hidden" name="msId_' + i + '" value="' + esc(m.id || "") + '">' +
      '<input type="text" name="msText_' + i + '" class="gd-ms-in" maxlength="' + GL.MS_MAX + '" value="' + esc(m.text || "") + '" placeholder="Milestone" aria-label="Milestone ' + (i + 1) + '" autocomplete="off">' +
      '<input type="date" name="msDue_' + i + '" class="gd-ms-date" value="' + esc(m.due || "") + '" aria-label="Date for milestone ' + (i + 1) + '">' +
      '<button type="button" class="btn-icon gd-ms-x" data-sheet-act="ms-del" aria-label="Remove milestone ' + (i + 1) + '">&times;</button></div>';
  }
  function readMilestoneRows(v) {
    const rows = [];
    Object.keys(v).forEach(function (k) { const m = /^msText_(\d+)$/.exec(k); if (m) rows.push(Number(m[1])); });
    rows.sort(function (a, b) { return a - b; });
    return rows.map(function (i) { return { id: v["msId_" + i] || "", text: v["msText_" + i], due: v["msDue_" + i] || "" }; });
  }

  function openGoalSheet(o) {
    const a = A(), h = H(); if (!a || !h) return;
    const g = o && o.id ? goalById(o.id) : null;
    if (o && o.id && !g) { notice("That goal isn't there any more.", ""); return; }
    const mode = g ? GL.mode(g) : "milestones", known = g ? GL.categoryKey(g.category) : (GL.CATEGORIES.some(function (c) { return c[0] === ui.filter; }) ? ui.filter : "");
    const catVal = g ? (g.category ? (known === "other" ? "__other" : known) : "") : known, catOther = g && known === "other" ? g.category : "";
    const ms = g ? GL.milestones(g) : [];
    const body = a.fText("name", "Goal name", g ? g.name : "", { required: true, max: GL.NAME_MAX, placeholder: "e.g. Launch Gratiel Drop 001" }) +
      '<div class="form-row two-col"><div>' + a.fSelect("category", "Category", CAT_OPTS, catVal) + '</div><div>' + dateField(a, "targetDate", "Target date", g ? g.targetDate : "") + '</div></div>' +
      '<div data-for="other">' + a.fText("categoryOther", "Your category", catOther, { max: 40 }) + '</div>' +
      a.fSelect("priority", "Priority", PRI_OPTS, g ? GL.priorityOf(g) : "medium") +
      a.fSelect("trackMode", "How will you track progress?", MODE_OPTS, mode, { hint: "Milestones count the ones you finish. A number tracks something you can measure. Manual is a percentage you set." }) +
      '<div data-for="numeric"><div class="form-row two-col"><div>' + a.fText("startValue", "Starting value", g && g.startValue ? g.startValue : "", { mode: "decimal", placeholder: "0" }) + '</div><div>' + a.fText("targetValue", "Target value", g && g.hasNumericTarget ? g.targetValue : "", { mode: "decimal", placeholder: "e.g. 5000" }) + '</div></div>' +
        '<div class="form-row two-col"><div>' + a.fText("currentValue", "Where you are now", g && g.hasNumericTarget ? g.currentValue : "", { mode: "decimal", placeholder: "same as start" }) + '</div><div>' + a.fText("unit", "Unit (optional)", g ? g.unit : "", { max: 20, placeholder: "e.g. $, books, hours" }) + '</div></div></div>' +
      '<div data-for="manual">' + a.fText("manualProgressPct", "Progress (%)", g ? Math.round(Number(g.manualProgressPct) || 0) : 0, { mode: "numeric" }) + '</div>' +
      '<fieldset class="gd-ms-set"><legend>Milestones</legend><p class="field-hint" data-ms-hint></p><div data-ms-rows>' + (ms.length ? ms.map(function (m, i) { return msRowHtml(i, m); }).join("") : msRowHtml(0, {})) + '</div><button type="button" class="btn btn-secondary" data-sheet-act="ms-add">+ Add milestone</button></fieldset>' +
      '<details class="gd-desc-set"' + (g && g.description ? " open" : "") + '><summary>Description (optional)</summary>' + a.fArea("description", "Description", g ? g.description : "", { rows: 2, max: 500 }) + '</details>';
    function sync(root) {
      const md = root.querySelector('[name="trackMode"]').value, cat = root.querySelector('[name="category"]').value;
      root.querySelector('[data-for="other"]').classList.toggle("hidden", cat !== "__other");
      root.querySelector('[data-for="numeric"]').classList.toggle("hidden", md !== "numeric");
      root.querySelector('[data-for="manual"]').classList.toggle("hidden", md !== "manual");
      root.querySelector("[data-ms-hint]").textContent = md === "milestones" ? "Progress is counted from the milestones you finish. Give any a date to see it on your Calendar." : "Optional checklist. Progress follows your " + (md === "numeric" ? "number" : "percentage") + ", not these.";
    }
    function addRow(root, text) {
      const box = root.querySelector("[data-ms-rows]"), i = box.querySelectorAll("[data-ms-row]").length;
      const tmp = document.createElement("div"); tmp.innerHTML = msRowHtml(i, { text: text || "" });
      const row = tmp.firstChild; box.appendChild(row); return row.querySelector(".gd-ms-in");
    }
    a.openSheet({
      title: g ? "Edit goal" : "New goal", body: body, submit: g ? "Save" : "Create goal", focus: '[name="name"]',
      onOpen: function (root) {
        sync(root);
        root.addEventListener("paste", function (e) {       // several lines pasted into a milestone become several milestones
          const t = e.target;
          if (!t || !t.classList || !t.classList.contains("gd-ms-in")) return;
          const txt = (e.clipboardData || window.clipboardData).getData("text");
          if (!/\r?\n/.test(txt)) return;
          e.preventDefault();
          const lines = txt.split(/\r?\n/).map(function (x) { return x.replace(/^[\s\-*•\d.)]+/, "").trim(); }).filter(Boolean);
          lines.forEach(function (ln, k) { if (k === 0 && !t.value) t.value = ln; else addRow(root, ln); });
        });
      },
      onChange: function (el, root) { sync(root); },
      onAct: function (act, el, root) {
        if (act === "ms-add") { const inp = addRow(root, ""); if (inp) inp.focus(); }
        else if (act === "ms-del") { const row = el.closest("[data-ms-row]"); if (row) { const box = row.parentNode; if (box.querySelectorAll("[data-ms-row]").length > 1) row.parentNode.removeChild(row); else row.querySelectorAll("input").forEach(function (i) { if (i.type !== "hidden") i.value = ""; }); } }
      },
      onSubmit: function (v) {
        let cat = v.category === "__other" ? String(v.categoryOther || "").trim() : (v.category ? GL.CATEGORIES.filter(function (c) { return c[0] === v.category; })[0][1] : "");
        if (g && v.category && v.category !== "__other" && GL.categoryKey(g.category) === v.category) cat = g.category;   // same category as before: keep the words you typed (e.g. "business")
        const input = { name: v.name, description: v.description, category: cat, targetDate: v.targetDate, priority: v.priority, trackMode: v.trackMode, startValue: v.startValue, currentValue: v.currentValue, targetValue: v.targetValue, unit: v.unit, manualProgressPct: v.manualProgressPct, milestones: readMilestoneRows(v) };
        const prev = goals(), r = g ? GL.update(prev, g.id, input, ctx()) : GL.create(prev, input, ctx());
        if (!r.ok) return { ok: false, errors: r.errors };
        if (!h.commitGoals(r.goals)) return { ok: false, message: "The browser would not save that." };
        if (!g) { ui.open[r.goal.id] = false; if (ui.filter !== "all" && GL.categoryKey(r.goal.category) !== ui.filter) ui.filter = "all"; }
        render();
        notice(g ? "Saved “" + r.goal.name + "”." : "Created “" + r.goal.name + "”.", "Undo", function () { if (save(prev)) { render(); say("Undone."); } });
        return { ok: true };
      },
      onClose: function () { /* focus returns to the opener */ }
    });
    if (g) {            // Delete lives in the edit form, away from the everyday buttons
      const form = document.querySelector("#spSheetForm .form-actions");
      if (form) {
        const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-danger gd-del"; b.textContent = "Delete goal";
        b.addEventListener("click", function () { a.closeSheet(true); deleteGoal(g.id); });
        form.appendChild(b);
      }
    }
  }
  function deleteGoal(id) {
    const g = goalById(id), h = H(); if (!g || !h) return;
    const a = A();
    const go = function () {
      const prevGoals = goals(), prevTasks = tasks();
      const linked = prevTasks.filter(function (t) { return t.goalId === id; }).length;
      h.releaseGoalTasks(id);                                 // tasks are un-linked, never deleted
      if (!h.commitGoals(prevGoals.filter(function (x) { return x.id !== id; }))) { saveTasks(prevTasks); failed(); return; }
      render();
      notice("Deleted “" + g.name + "”" + (linked ? " (its " + linked + (linked === 1 ? " task stays" : " tasks stay") + " in your To-Do list)." : "."), "Undo", function () { saveTasks(prevTasks); if (save(prevGoals)) { render(); say("Undone."); } });
    };
    if (a && a.confirmSheet) a.confirmSheet({ title: "Delete this goal?", text: "“" + g.name + "” and its milestones will be removed. Tasks you linked to it are kept.", yes: "Delete", onYes: go });
    else go();
  }

  function openMilestoneSheet(goalId, msId) {
    const a = A(), g = goalById(goalId); if (!a || !g) return;
    const m = GL.milestones(g).filter(function (x) { return x.id === msId; })[0]; if (!m) return;
    const t = m.taskId ? tasks().filter(function (x) { return x.id === m.taskId; })[0] : null;
    let body = a.fText("text", "Milestone", m.text, { required: true, max: GL.MS_MAX }) + dateField(a, "due", "Date (optional)", m.due, { hint: "Shown on your Calendar." });
    if (t) body += '<div class="form-row gd-task-box"><span class="gd-h4">Task</span><p class="gd-task-line">' + esc(t.text) + ' · ' + esc(fmtDate(t.date)) + (t.completed ? " · done" : "") + '</p><div class="gd-more-actions">' +
      (t.date === today() || t.completed ? "" : '<button type="button" class="btn btn-secondary" data-sheet-act="t-today">Move to today</button>') + '<button type="button" class="btn btn-secondary" data-sheet-act="t-unlink">Unlink task</button></div></div>';
    else body += '<div class="form-row gd-task-box"><span class="gd-h4">Put it on your calendar</span>' + dateField(a, "taskDate", "Do it on", m.due || today()) + '<button type="button" class="btn btn-secondary" data-sheet-act="t-make">Add as a task</button><p class="field-hint">Makes one task in your To-Do list and Calendar. Completing it completes this milestone.</p></div>';
    body += '<div class="form-row"><button type="button" class="btn btn-danger" data-sheet-act="ms-remove">Remove milestone</button></div>';
    const applyFields = function (v) {
      const prev = goals(), r = GL.editMilestone(prev, goalId, msId, { text: v.text, due: v.due || "" }, tasks(), ctx());
      if (!r.ok) return null;
      return r;
    };
    a.openSheet({
      title: "Milestone", body: body, submit: "Save", focus: '[name="text"]',
      onAct: function (act, el, root) {
        const v = a.formValues(root.querySelector("form")), prev = goals(), prevTasks = tasks();
        if (act === "ms-remove") {
          const r = GL.removeMilestone(prev, goalId, msId, ctx());
          a.closeSheet(true);
          if (r.ok && save(r.goals)) { render(); notice("Removed “" + m.text + "”.", "Undo", function () { if (save(prev)) { render(); say("Undone."); } }); }
        } else if (act === "t-make") {
          if (!String(v.text || "").trim()) return;
          const e = applyFields(v); if (e && !save(e.goals)) return;
          const r = makeTask(goalId, msId, { date: v.taskDate, text: String(v.text).trim() });
          if (!r.ok) { notice(r.error, ""); return; }
          a.closeSheet(true); render();
          notice("Added to your calendar for " + fmtDate(r.task.date) + ".", "Undo", function () { r.undo(); if (e) save(prev); render(); say("Undone."); });
        } else if (act === "t-today") {
          saveTasks(prevTasks.map(function (x) { return x.id === m.taskId ? Object.assign({}, x, { date: today() }) : x; }));
          a.closeSheet(true); render(); notice("Moved the task to today.", "Undo", function () { saveTasks(prevTasks); render(); say("Undone."); });
        } else if (act === "t-unlink") {
          const r = GL.linkTask(prev, goalId, msId, "", ctx());
          a.closeSheet(true);
          if (r.ok && save(r.goals)) { render(); notice("Unlinked. The task is still in your To-Do list.", "Undo", function () { if (save(prev)) { render(); say("Undone."); } }); }
        }
      },
      onSubmit: function (v) {
        if (!String(v.text || "").trim()) return { ok: false, errors: { text: "Write the milestone." } };
        if (v.due && !GL.isDate(v.due)) return { ok: false, errors: { due: "That isn't a date." } };
        const prev = goals(), prevTasks = tasks(), r = applyFields(v);
        if (!r) return { ok: false, message: "That milestone isn't there any more." };
        if (r.taskPatch) saveTasks(prevTasks.map(function (x) { return x.id === r.taskPatch.taskId ? Object.assign({}, x, { date: r.taskPatch.date }) : x; }));
        if (!H().commitGoals(r.goals)) { if (r.taskPatch) saveTasks(prevTasks); return { ok: false, message: "The browser would not save that." }; }
        render(); notice("Saved.", "Undo", function () { saveTasks(prevTasks); if (save(prev)) { render(); say("Undone."); } });
        return { ok: true };
      }
    });
  }

  function openTaskSheet(goalId) {
    const a = A(), g = goalById(goalId); if (!a || !g) return;
    const open = GL.milestones(g).filter(function (m) { return !m.taskId && !GL.milestoneDone(m, tasks()); });
    const body = a.fText("text", "What needs to be done?", "", { required: true, max: 140 }) + '<div class="form-row two-col"><div>' + dateField(a, "date", "Day", today()) + '</div><div>' + a.fText("time", "Time (optional)", "", { type: "time" }) + '</div></div>' +
      (open.length ? a.fSelect("msId", "For which milestone?", [["", "None (a task for the goal)"]].concat(open.map(function (m) { return [m.id, m.text]; })), "", { hint: "Completing the task completes that milestone." }) : "");
    a.openSheet({
      title: "New task for “" + g.name + "”", body: body, submit: "Add task", focus: '[name="text"]',
      onChange: function (el, root) { if (el.name === "msId") { const m = open.filter(function (x) { return x.id === el.value; })[0]; const t = root.querySelector('[name="text"]'), d = root.querySelector('[name="date"]'); if (m) { if (!t.value) t.value = m.text; if (m.due) d.value = m.due; } } },
      onSubmit: function (v) {
        const r = makeTask(goalId, v.msId || "", { text: v.text, date: v.date, time: v.time });
        if (!r.ok) return { ok: false, errors: /day/i.test(r.error) ? { date: r.error } : /Write/.test(r.error) ? { text: r.error } : undefined, message: /day|Write/i.test(r.error) ? undefined : r.error };
        render(); notice("Added to your calendar for " + fmtDate(r.task.date) + ".", "Undo", function () { r.undo(); render(); say("Undone."); });
        return { ok: true };
      }
    });
  }

  /* ---------------- linking a goal to Strategy ---------------- */

  function openLinkSheet(goalId) {
    const a = A(), g = goalById(goalId), S = window.JarvisPlanStore; if (!a || !g || !S || !PL) return;
    S.init();
    if (S.blocked && S.blocked()) { notice("Strategy can't be read right now, so goals can't be linked to it.", ""); return; }
    const nodes = PL.liveNodes(S.all("nodes")).filter(function (n) { return n.status !== "dropped"; });
    const label = function (n) { const p = n.parentId ? PL.byId(nodes, n.parentId) : null; return (PL.TYPE_LABEL[n.type] || n.type) + ": " + (p && p.type !== "milestone" ? p.title + " › " : "") + n.title; };
    const cur = supports(goalId), linkedIds = {}; cur.forEach(function (c) { linkedIds[c.id] = true; });
    const opts = [["", "Pick an objective, priority or milestone…"]].concat(nodes.filter(function (n) { return !linkedIds[n.id]; }).map(function (n) { return [n.id, label(n)]; }));
    if (!nodes.length) { notice("Strategy has no objectives yet. Add one there first, then link this goal to it.", ""); return; }
    let body = '<p class="field-hint">Link “' + esc(g.name) + '” to the larger objective it supports. Nothing is copied: the Strategy item follows this goal\'s progress.</p>';
    if (cur.length) body += '<ul class="gd-links">' + cur.map(function (c) { return '<li><span>' + esc(c.chain) + '</span><button type="button" class="btn btn-secondary" data-sheet-act="unlink" data-id="' + esc(c.id) + '">Unlink</button></li>'; }).join("") + '</ul>';
    body += a.fSelect("nodeId", cur.length ? "Link another" : "Supports", opts, "") + '<p class="field-hint" data-link-note></p>';
    const note = function (root) {
      const id = root.querySelector('[name="nodeId"]').value, n = id ? PL.byId(nodes, id) : null, el = root.querySelector("[data-link-note]");
      el.textContent = !n ? "" : n.measure === "goal" ? "It already follows another goal. Linking will switch it to this one." : n.measure === "tasks" ? "It will follow this goal's progress instead of counting its tasks." : "It will follow this goal's progress instead of its " + (n.measure === "revenue" ? "revenue" : n.measure === "budget" ? "budget" : "number") + ".";
    };
    const apply = function (id, measure, goal) {
      const prev = S.all("nodes"), r = PL.editNode(prev, id, { measure: measure, goalId: goal }, { goals: goals(), now: Date.now(), makeId: function (p) { return core().uid(p); } });
      if (!r.ok) return { ok: false, message: r.errors && (r.errors.goalId || r.errors.title) || "That couldn't be linked." };
      if (!S.replace("nodes", r.nodes)) return { ok: false, message: "The browser would not save that." };
      if (a.bump) a.bump();
      return { ok: true, prev: prev };
    };
    a.openSheet({
      title: "Link to Strategy", body: body, submit: "Link", focus: '[name="nodeId"]',
      onChange: function (el, root) { note(root); },
      onAct: function (act, el) {
        if (act !== "unlink") return;
        const r = apply(el.getAttribute("data-id"), "tasks", "");
        a.closeSheet(true);
        if (!r.ok) { notice(r.message, ""); return; }
        render(); notice("Unlinked from Strategy.", "Undo", function () { S.replace("nodes", r.prev); if (a.bump) a.bump(); render(); say("Undone."); });
      },
      onSubmit: function (v) {
        if (!v.nodeId) return { ok: false, errors: { nodeId: "Pick the item this goal supports." } };
        const r = apply(v.nodeId, "goal", goalId);
        if (!r.ok) return r;
        render(); notice("Linked to Strategy.", "Undo", function () { S.replace("nodes", r.prev); if (a.bump) a.bump(); render(); say("Undone."); });
        return { ok: true };
      }
    });
  }

  /* ---------------- taps and keys ---------------- */

  function onClick(e) {
    const el = e.target.closest("[data-gd]");
    if (!el) return;
    const act = el.getAttribute("data-gd"), id = el.getAttribute("data-id");
    if (act === "undo") { const u = undo; hideUndo(); if (u) u.fn(); return; }
    if (act === "new") openGoalSheet({});
    else if (act === "edit") openGoalSheet({ id: id });
    else if (act === "complete") completeGoal(id);
    else if (act === "toggle") { ui.open[id] = !ui.open[id]; render(); }
    else if (act === "filter") { ui.filter = el.getAttribute("data-v"); render(); }
    else if (act === "show-done") { ui.showDone = !ui.showDone; render(); }
    else if (act === "all-steps") { ui.allSteps = !ui.allSteps; render(); }
    else if (act === "upd-open") { ui.updating = ui.updating === id ? "" : id; render(); if (ui.updating) refocus('[data-gd-upd="' + id + '"]'); }
    else if (act === "upd-save") quickCurrent(id);
    else if (act === "step") stepGoal(id, Number(el.getAttribute("data-d")));
    else if (act === "ms-tick") toggleMilestone(id, el.getAttribute("data-ms"));
    else if (act === "ms-open") openMilestoneSheet(id, el.getAttribute("data-ms"));
    else if (act === "ms-add") { const inp = document.querySelector('#gdRoot [data-gd-ms-in="' + id + '"]'); addMilestones(id, inp ? inp.value : ""); }
    else if (act === "task-tick") toggleTask(el.getAttribute("data-task"));
    else if (act === "task-new") openTaskSheet(id);
    else if (act === "link") openLinkSheet(id);
    else if (act === "step-tick") tickStep(el.getAttribute("data-key"));
    else if (act === "step-today") addToToday(el.getAttribute("data-key"));
    else if (act === "step-goal") openCard(id);
  }
  function onKeydown(e) {
    const t = e.target;
    if (e.key === "Enter" && t.getAttribute) {
      if (t.hasAttribute("data-gd-upd")) { e.preventDefault(); quickCurrent(t.getAttribute("data-gd-upd")); }
      else if (t.hasAttribute("data-gd-ms-in")) { e.preventDefault(); addMilestones(t.getAttribute("data-gd-ms-in"), t.value); }
    } else if (e.key === "Escape" && t.hasAttribute && t.hasAttribute("data-gd-upd")) { ui.updating = ""; render(); }
  }
  function onPaste(e) {
    const t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute("data-gd-ms-in")) return;
    const txt = (e.clipboardData || window.clipboardData).getData("text");
    if (/\r?\n/.test(txt.trim())) { e.preventDefault(); addMilestones(t.getAttribute("data-gd-ms-in"), txt); }
  }

  function init() {
    if (ready || !$("gdRoot") || !H() || !GL) return;
    ready = true;
    const root = $("gdRoot");
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeydown);
    root.addEventListener("paste", onPaste);
    $("gdUndo").addEventListener("click", onClick);
    document.addEventListener("jarvis-tasks-changed", function () { reconcile(); if (panelActive()) render(); });
    document.addEventListener("jarvis-goals-changed", function () { if (panelActive()) render(); });
    render();
  }

  window.JarvisGoals = {
    init: init, render: render, toggleMilestone: toggleMilestone, tickMilestone: tickMilestone, stepsForDay: stepsForDay, addStepToDay: addStepToDay,
    // Opens the Goals screen with one goal's card open (from the Calendar, Home and the like).
    show: function (goalId) {
      const b = $("navBtnHabits"); if (b) b.click();
      const s = $("habitsSubNavGoals"); if (s) s.click();
      window.setTimeout(function () { if (goalId && goalById(goalId)) { ui.filter = "all"; openCard(goalId); } else render(); }, 0);
    }
  };

  if (document.readyState !== "loading") init(); else document.addEventListener("DOMContentLoaded", init);
  document.addEventListener("jarvis-ready-to-start", function () { init(); render(); });
})();
