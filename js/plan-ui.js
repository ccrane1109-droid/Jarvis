/* ==========================================================================
   JARVIS — Strategic Planning Center: the shell and the pieces every view shares.

   The views are separate files that register themselves here:
     plan-yearly-ui.js     Yearly: the three-year roadmap
     plan-quarterly-ui.js  Quarterly (Q1-Q4) and Monthly
     plan-week-ui.js       Weekly: the time-blocking planner
   A view is { html(), after(host), change(el), submit(form) } and is drawn into #spView. Buttons carry data-act="name"; the
   code for a name is in A.acts (views add theirs). All the rules are in plan-logic.js / plan-week-logic.js, the saving in
   plan-store.js. Your tasks and goals stay where they are (Habits); this tab links to them and never copies them.

   Every number on these screens comes from what you entered or from your own tasks. Nothing is estimated.
   ========================================================================== */

(function () {
  "use strict";

  const PL = window.JarvisPlanLogic;
  const store = window.JarvisPlanStore;
  const VIEWS = [["yearly", "Yearly"], ["quarterly", "Quarterly"], ["monthly", "Monthly"], ["weekly", "Weekly"]];
  const views = {};
  const A = { acts: {}, PL: PL, store: store };
  const state = { view: "yearly", year: 0, quarter: 0, month: "", open: {}, week: "" };
  let started = false, shown = false, sheet = null, undoTimer = null, version = 0, cached = null, cachedVer = -1;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.JarvisCore.escapeHtml(s == null ? "" : String(s)); }
  A.$ = $; A.esc = esc; A.state = state;

  /* ---------------- the data every view reads ---------------- */

  function habits() { return window.JarvisHabits || null; }
  A.tasks = function () { const h = habits(); return h && h.getTasks ? (h.getTasks() || []) : []; };
  A.goals = function () { const h = habits(); return h && h.getGoals ? (h.getGoals() || []) : []; };
  A.data = function () {
    return { nodes: store.all("nodes"), links: store.all("links"), tasks: A.tasks(), periods: store.all("periods"), settings: store.settings(), goals: A.goals(), today: store.today() };
  };
  // The model is worked out once per change, not once per call.
  A.model = function () {
    if (!cached || cachedVer !== version) { cached = PL.model(A.data()); cachedVer = version; }
    return cached;
  };
  A.bump = function () { version++; };

  /* ---------------- small display helpers ---------------- */

  A.money = function (n) { return n === null || n === undefined ? "–" : "$" + PL.fmt(n); };
  A.plural = function (n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); };
  A.fmtDate = function (d) { return PL.isDate(d) ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""; };
  A.fmtShort = function (d) { return PL.isDate(d) ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; };
  A.badge = function (cls, text) { return '<span class="badge badge-' + cls + '">' + esc(text) + '</span>'; };
  const HEALTH_BADGE = { done: "green", ontrack: "green", atrisk: "yellow", behind: "red", overdue: "red", over: "red", upcoming: "neutral", paused: "neutral", dropped: "neutral", nodata: "neutral" };
  A.healthBadge = function (h) { return h ? A.badge(HEALTH_BADGE[h] || "neutral", PL.HEALTH_LABEL[h] || h) : ""; };
  const TONE = { done: "green", ontrack: "green", atrisk: "yellow", behind: "red", overdue: "red", over: "red" };
  // A progress bar. pct null = unknown, so no bar is drawn. Over 100 is drawn full.
  A.bar = function (pct, label, health) {
    if (pct === null || pct === undefined) return "";
    return '<div class="sp-bar ' + (TONE[health] ? "sp-tone-" + TONE[health] : "") + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, pct) + '" aria-label="' + esc(label || "Progress") + '"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>';
  };
  A.typeLabel = function (t) { return PL.TYPE_LABEL[t] || t; };
  A.monthLabel = function (mk) { return PL.monthName(mk, false) + " " + mk.slice(0, 4); };

  /* ---------------- messages ---------------- */

  A.say = function (text) { const e = $("spLive"); if (e) { e.textContent = ""; window.setTimeout(function () { e.textContent = text || ""; }, 30); } };
  // A bar at the bottom with a message and (optionally) one button, for undoing a delete or following up.
  A.notice = function (text, label, fn) {
    const bar = $("spUndo");
    if (!bar) return;
    window.clearTimeout(undoTimer);
    bar.innerHTML = '<span class="sp-undo-text">' + esc(text) + '</span>' + (label ? '<button type="button" class="btn btn-secondary" data-sp-undo>' + esc(label) + '</button>' : "");
    bar.classList.remove("hidden");
    bar._fn = fn || null;
    A.say(text);
    undoTimer = window.setTimeout(function () { bar.classList.add("hidden"); bar._fn = null; }, 9000);
  };
  A.saveFailed = function () { A.notice(store.error() || "That couldn't be saved.", ""); };

  /* ---------------- form fields ---------------- */

  A.row = function (name, label, control, o) {
    o = o || {};
    return '<div class="form-row' + (o.cls ? " " + o.cls : "") + '"' + (o.attrs ? " " + o.attrs : "") + '><label for="spf_' + name + '">' + esc(label) + (o.required ? ' <span class="sp-req" aria-hidden="true">*</span>' : "") + '</label>' + control +
      (o.hint ? '<p class="field-hint" id="sph_' + name + '">' + esc(o.hint) + '</p>' : "") + '<p class="sp-err hidden" data-err="' + name + '" role="alert"></p></div>';
  };
  A.fText = function (name, label, value, o) {
    o = o || {};
    return A.row(name, label, '<input type="' + (o.type || "text") + '" id="spf_' + name + '" name="' + name + '" value="' + esc(value == null ? "" : value) + '"' + (o.max ? ' maxlength="' + o.max + '"' : "") +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : "") + (o.mode ? ' inputmode="' + o.mode + '"' : "") + (o.hint ? ' aria-describedby="sph_' + name + '"' : "") + ' autocomplete="off">', o);
  };
  A.fArea = function (name, label, value, o) {
    o = o || {};
    return A.row(name, label, '<textarea id="spf_' + name + '" name="' + name + '" rows="' + (o.rows || 3) + '"' + (o.max ? ' maxlength="' + o.max + '"' : "") + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : "") + '>' + esc(value == null ? "" : value) + '</textarea>', o);
  };
  A.fSelect = function (name, label, options, value, o) {
    return A.row(name, label, '<select id="spf_' + name + '" name="' + name + '">' + A.optionsHtml(options, value) + '</select>', o);
  };
  A.optionsHtml = function (options, value) {
    return options.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(value) ? " selected" : "") + '>' + esc(x[1]) + '</option>'; }).join("");
  };
  A.formValues = function (form) {
    const out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === "checkbox") {
        if (el.hasAttribute("data-multi")) { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); } else out[el.name] = el.checked;
      } else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
    });
    return out;
  };
  function showErrors(root, errors, message) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-err]"), function (p) { p.textContent = ""; p.classList.add("hidden"); });
    const general = root.querySelector("[data-err-general]");
    if (general) { general.textContent = message || ""; general.classList.toggle("hidden", !message); }
    let first = null;
    Object.keys(errors || {}).forEach(function (k) {
      const p = root.querySelector('[data-err="' + k + '"]');
      if (p) { p.textContent = errors[k]; p.classList.remove("hidden"); }
      const f = root.querySelector('[name="' + k + '"]');
      if (f) { f.setAttribute("aria-invalid", "true"); if (!first) first = f; }
    });
    if (first) first.focus(); else if (message && general) general.focus();
  }

  /* ---------------- sheets: a form over the page ---------------- */

  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')).filter(function (e) { return !e.disabled && e.offsetParent !== null; });
  }
  function onSheetKey(e) {
    if (!sheet) return;
    if (e.key === "Escape") { e.preventDefault(); A.closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = focusables(sheet.el);
    if (!f.length) return;
    const at = f.indexOf(document.activeElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (at === -1 || at === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
  function selectorFor(el) {
    if (!el || !el.getAttribute) return "";
    if (el.id) return "#" + el.id;
    let sel = el.tagName.toLowerCase(), any = false;
    ["data-act", "data-id", "data-v", "data-go", "data-date", "data-type"].forEach(function (a) {
      const v = el.getAttribute(a);
      if (v !== null) { sel += "[" + a + '="' + v.replace(/"/g, '\\"') + '"]'; any = true; }
    });
    return any ? sel : "";
  }
  // o: { title, body (html), submit (label), danger, focus, onSubmit(values, form) -> { ok } | { ok: false, errors, message }, onOpen(el), onChange(el, root), onAct(name, el, root), onClose(saved) }
  A.openSheet = function (o) {
    A.closeSheet(true);
    const el = document.createElement("div");
    el.className = "modal-overlay sheet-overlay sp-sheet-overlay";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "spSheetTitle");
    el.innerHTML = '<div class="modal-box sheet-box sp-sheet"><div class="sheet-handle" aria-hidden="true"></div><h2 id="spSheetTitle" class="sp-sheet-title" tabindex="-1">' + esc(o.title) + '</h2>' +
      '<form id="spSheetForm" novalidate>' + (o.body || "") + '<p class="sp-err hidden" data-err-general role="alert" tabindex="-1"></p>' +
      '<div class="form-actions sp-sheet-actions">' + (o.submit ? '<button type="submit" class="btn ' + (o.danger ? "btn-danger" : "btn-primary") + '">' + esc(o.submit) + '</button>' : "") +
      '<button type="button" class="btn btn-secondary" data-sp-cancel>' + (o.submit ? "Cancel" : "Close") + '</button></div></form></div>';
    sheet = { el: el, opener: document.activeElement, sig: selectorFor(document.activeElement), o: o };
    document.body.appendChild(el);
    document.body.classList.add("sp-sheet-open");
    document.addEventListener("keydown", onSheetKey, true);
    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-sp-cancel]")) { A.closeSheet(); return; }
      const act = e.target.closest("[data-sheet-act]");
      if (act && o.onAct) o.onAct(act.getAttribute("data-sheet-act"), act, el);
    });
    el.addEventListener("change", function (e) { if (o.onChange) o.onChange(e.target, el); });
    el.addEventListener("input", function (e) { if (o.onInput) o.onInput(e.target, el); });
    el.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!o.onSubmit) { A.closeSheet(); return; }
      const form = e.target;
      Array.prototype.forEach.call(form.querySelectorAll("[aria-invalid]"), function (f) { f.removeAttribute("aria-invalid"); });
      const r = o.onSubmit(A.formValues(form), form);
      if (r && r.ok) A.closeSheet(true, true);
      else showErrors(el, r && r.errors, r && r.message);
    });
    if (o.onOpen) o.onOpen(el);
    window.setTimeout(function () {
      const first = o.focus ? el.querySelector(o.focus) : el.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea, select");
      (first || el.querySelector("#spSheetTitle")).focus();
    }, 0);
    return el;
  };
  A.closeSheet = function (quiet, saved) {
    if (!sheet) return;
    const s = sheet; sheet = null;
    document.removeEventListener("keydown", onSheetKey, true);
    document.body.classList.remove("sp-sheet-open");
    s.el.remove();
    if (s.o.onClose) s.o.onClose(!!saved);
    if (quiet === true && !saved) return;          // closed only to open another sheet
    if (shown) A.render();
    window.setTimeout(function () {
      let back = s.opener;
      if (!(back && document.body.contains(back))) back = s.sig ? document.querySelector("#spView " + s.sig) : null;
      if (!back) back = document.querySelector("#spView [data-focus-top]");
      if (back && back.focus) { if (back.hasAttribute("data-focus-top")) back.setAttribute("tabindex", "-1"); back.focus(); }
    }, 0);
  };
  A.confirmSheet = function (o) {
    A.openSheet({ title: o.title, body: '<p>' + esc(o.text) + '</p>', submit: o.yes, danger: o.danger !== false, focus: ".btn-secondary", onSubmit: function (v) { o.onYes(v); return { ok: true }; } });
  };

  /* ---------------- navigation and drawing ---------------- */

  A.register = function (name, view) { views[name] = view; };
  A.go = function (view, extra) {
    if (view && views[view]) state.view = view;
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== "noScroll") state[k] = extra[k]; });
    A.render();
    if (!(extra && extra.noScroll)) window.scrollTo(0, 0);
  };
  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll("#panel-strategy .sp-sub-nav .sub-nav-btn"), function (b) {
      const on = b.getAttribute("data-sp") === state.view;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }
  A.render = function () {
    const host = $("spView");
    if (!host) return;
    A.bump();
    const active = document.activeElement, sig = host.contains(active) ? selectorFor(active) : "";
    const view = views[state.view];
    let blocked = "";
    ["nodes", "links", "periods"].forEach(function (k) { blocked = blocked || store.blocked(k); });
    syncTabs();
    if (!view) { host.innerHTML = '<p class="sp-empty">This view is not available.</p>'; return; }
    host.innerHTML = (blocked ? '<p class="sp-warn" role="alert">' + esc(blocked) + '</p>' : "") + view.html();
    if (view.after) view.after(host);
    if (sig) { const back = host.querySelector(sig); if (back) back.focus(); }
  };

  /* ---------------- tasks: the same records Habits shows ---------------- */

  A.toggleTask = function (id) {
    const h = habits();
    if (!h || !h.commitTasks) return false;
    const list = A.tasks();
    if (!list.some(function (t) { return t.id === id; })) return false;
    h.commitTasks(list.map(function (t) { return t.id === id ? Object.assign({}, t, { completed: !t.completed }) : t; }));
    return true;
  };
  A.taskById = function (id) { return A.tasks().filter(function (t) { return t.id === id; })[0] || null; };
  // Link / unlink one task. Never touches the task itself.
  A.linkTask = function (taskId, nodeId) {
    const r = PL.setLink(store.all("links"), taskId, nodeId, { nodes: store.all("nodes") });
    if (!r.ok) { A.notice(r.error || "That couldn't be linked.", ""); return false; }
    if (!store.replace("links", r.links)) { A.saveFailed(); return false; }
    return true;
  };

  /* ---------------- a plan item: its card ---------------- */

  function taskRow(t, m, o) {
    const link = PL.linkOf(store.all("links"), t.id), est = link && link.estMin ? link.estMin : 0;
    return '<li class="sp-task' + (t.completed ? " is-done" : "") + '"><label class="sp-task-check"><input type="checkbox" data-act="task-toggle" data-id="' + esc(t.id) + '"' + (t.completed ? " checked" : "") + '><span class="sp-task-text">' + esc(t.text) + '</span></label>' +
      '<span class="sp-task-meta">' + (t.date ? esc(A.fmtShort(t.date)) : "") + (t.time ? " " + esc(t.time) : "") + (est ? " · " + est + " min" : "") + (t.priority === "high" ? " · high" : "") + '</span>' +
      '<button type="button" class="btn btn-secondary sp-task-unlink" data-act="task-unlink" data-id="' + esc(t.id) + '" aria-label="Unlink ' + esc(t.text) + ' (the task is kept)">Unlink</button></li>';
  }
  // The expandable card for an objective, a priority or a milestone. o: { children: html to show under it }
  A.nodeCard = function (n, o) {
    o = o || {};
    const m = A.model(), p = m.progress(n.id), h = m.health(n.id), open = !!state.open[n.id];
    const dl = m.deadline(n), parent = m.parentOf(n);
    const direct = m.tasksDirect(n.id);
    const cls = "sp-card sp-" + n.type + (h === "overdue" ? " sp-overdue" : "") + (h === "done" ? " sp-complete" : "") + (n.status !== "active" ? " sp-muted" : "");
    let h5 = '<article class="' + cls + '" data-node="' + esc(n.id) + '" aria-label="' + esc(n.title) + '">' +
      '<button type="button" class="sp-card-head" data-act="toggle-card" data-id="' + esc(n.id) + '" aria-expanded="' + open + '">' +
      '<span class="sp-card-title">' + esc(n.title) + '</span>' +
      '<span class="sp-card-badges">' + A.healthBadge(h) + (o.showType ? A.badge("accent", A.typeLabel(n.type)) : "") + '</span>' +
      '<span class="sp-card-sub">' + esc(p.note) + (n.due ? " · due " + esc(A.fmtShort(n.due)) : "") + '</span>' + A.bar(p.pct, n.title + " progress", h) +
      '</button>';
    if (open) {
      h5 += '<div class="sp-card-body">';
      if (parent && o.showParent !== false) h5 += '<p class="sp-parent">Part of: <button type="button" class="sp-link" data-act="open-node" data-id="' + esc(parent.id) + '">' + esc(parent.title) + '</button></p>';
      if (n.notes) h5 += '<p class="sp-notes">' + esc(n.notes) + '</p>';
      h5 += '<dl class="sp-facts">' + (n.measure !== "tasks" ? '<div><dt>Measured by</dt><dd>' + esc((PL.MEASURES.filter(function (x) { return x.key === n.measure; })[0] || {}).label || "") + '</dd></div>' : "") +
        '<div><dt>Deadline</dt><dd>' + esc(A.fmtDate(dl)) + (n.due ? "" : " (end of its " + (n.type === "objective" ? "year" : n.type === "priority" ? "quarter" : "month") + ")") + '</dd></div></dl>';
      if (o.children) h5 += o.children;
      if (n.measure === "number") h5 += '<div class="sp-inline"><label for="spnum_' + esc(n.id) + '">Current' + (n.unit ? " (" + esc(n.unit) + ")" : "") + '</label><input type="number" inputmode="decimal" min="0" id="spnum_' + esc(n.id) + '" data-num-for="' + esc(n.id) + '" value="' + esc(n.current === null ? 0 : n.current) + '"><button type="button" class="btn btn-secondary" data-act="save-number" data-id="' + esc(n.id) + '">Update</button></div>';
      // tasks: the ones linked straight to this item; the ones under items below it show on those items
      h5 += '<h4 class="sp-h4">Tasks linked here</h4>';
      h5 += direct.length ? '<ul class="sp-tasks">' + direct.map(function (t) { return taskRow(t, m); }).join("") + '</ul>' : '<p class="sp-dim">No tasks linked straight to this yet.</p>';
      h5 += '<div class="sp-card-actions"><button type="button" class="btn btn-secondary" data-act="link-tasks" data-id="' + esc(n.id) + '">Link or add tasks</button>';
      if (m.canMarkDone(n.id)) h5 += '<button type="button" class="btn btn-secondary" data-act="mark-done" data-id="' + esc(n.id) + '">' + (n.doneAt ? "Mark not done" : "Mark done") + '</button>';
      h5 += '<button type="button" class="btn btn-secondary" data-act="edit-node" data-id="' + esc(n.id) + '">Edit</button>';
      if (o.add) h5 += o.add;
      h5 += '<button type="button" class="btn btn-secondary" data-act="move-node" data-dir="-1" data-id="' + esc(n.id) + '" aria-label="Move ' + esc(n.title) + ' up">Move up</button>' +
        '<button type="button" class="btn btn-secondary" data-act="move-node" data-dir="1" data-id="' + esc(n.id) + '" aria-label="Move ' + esc(n.title) + ' down">Move down</button>';
      h5 += '<button type="button" class="btn btn-danger" data-act="delete-node" data-id="' + esc(n.id) + '">Delete</button></div>';
      h5 += '</div>';
    }
    return h5 + '</article>';
  };

  /* ---------------- the form for an objective / priority / milestone ---------------- */

  function parentChoices(type, year, quarter, current) {
    const m = A.model(), out = [["", type === "milestone" ? "Not under anything yet" : "Not linked to a yearly objective"]];
    const objs = m.objectivesOf(year).filter(function (o) { return o.status !== "dropped" || o.id === current; });
    if (type === "priority") objs.forEach(function (o) { out.push([o.id, o.title]); });
    if (type === "milestone") {
      m.prioritiesOf(year, quarter).filter(function (p) { return p.status !== "dropped" || p.id === current; }).forEach(function (p) { out.push([p.id, "Q" + quarter + " priority: " + p.title]); });
      objs.forEach(function (o) { out.push([o.id, "Yearly objective: " + o.title]); });
    }
    return out;
  }
  function monthOptions() { const out = []; for (let i = 1; i <= 12; i++) out.push([(i < 10 ? "0" : "") + i, PL.monthName("2000-" + (i < 10 ? "0" : "") + i, true)]); return out; }
  function yearOptions(extra) {
    const s = store.settings(), ys = PL.planYears(s);
    if (extra && ys.indexOf(Number(extra)) === -1) ys.push(Number(extra));
    return ys.sort().map(function (y) { return [String(y), String(y)]; });
  }

  // o: { type, id (to edit), year, quarter, month, parentId, measure, goalId, title }
  A.openNodeSheet = function (o) {
    const m = A.model(), editing = o.id ? m.node(o.id) : null;
    if (o.id && !editing) { A.notice("That isn't there any more.", ""); return; }
    const n = editing || { type: o.type, title: o.title || "", notes: "", year: o.year || m.settings.startYear, quarter: o.quarter || 1, month: o.month || "", due: "", measure: o.measure || "tasks", target: null, current: null, unit: "", goalId: o.goalId || "", status: "active", parentId: o.parentId || "" };
    const type = n.type, label = A.typeLabel(type).toLowerCase();
    const mm = n.month ? n.month.slice(5) : (state.month ? state.month.slice(5) : "01");
    const goalOpts = [["", "Pick a goal…"]].concat(A.goals().map(function (g) { return [g.id, g.name]; }));
    let body = A.fText("title", type === "objective" ? "What do you want to achieve this year?" : type === "priority" ? "What matters most this quarter?" : "What has to be true by the end of the month?", n.title, { required: true, max: PL.TITLE_MAX });
    if (type !== "milestone") body += A.fSelect("year", "Year", yearOptions(n.year), String(n.year));
    if (type === "priority") body += A.fSelect("quarter", "Quarter", [["1", "Q1 (Jan–Mar)"], ["2", "Q2 (Apr–Jun)"], ["3", "Q3 (Jul–Sep)"], ["4", "Q4 (Oct–Dec)"]], String(n.quarter));
    if (type === "milestone") body += '<div class="form-row two-col"><div><label for="spf_year">Year</label><select id="spf_year" name="year">' + A.optionsHtml(yearOptions(n.year), String(n.year)) + '</select></div><div><label for="spf_month">Month</label><select id="spf_month" name="month">' + A.optionsHtml(monthOptions(), mm) + '</select><p class="sp-err hidden" data-err="month" role="alert"></p></div></div>';
    if (type !== "objective") {
      const q = type === "priority" ? Number(n.quarter) : PL.quarterOfMonth(Number(mm));
      body += A.fSelect("parentId", type === "priority" ? "Supports yearly objective" : "Part of", parentChoices(type, Number(n.year), q, n.id), n.parentId || "", { hint: type === "priority" ? "Optional. A quarterly priority can stand on its own." : "Optional. Pick the priority or objective this milestone moves forward." });
    }
    body += A.fSelect("measure", "How will you measure it?", PL.MEASURES.map(function (x) { return [x.key, x.label]; }), n.measure, { hint: (PL.MEASURES.filter(function (x) { return x.key === n.measure; })[0] || {}).hint });
    body += '<div data-for="revenue budget number">' + A.fText("target", "Target", n.target === null || n.target === undefined ? "" : n.target, { mode: "decimal", placeholder: "e.g. 120000", hint: "Revenue and spending use the money you enter by month; they never use task completion." }) + '</div>';
    body += '<div data-for="number" class="form-row two-col"><div><label for="spf_current">Current number</label><input id="spf_current" name="current" inputmode="decimal" value="' + esc(n.current === null || n.current === undefined ? "" : n.current) + '" autocomplete="off"><p class="sp-err hidden" data-err="current" role="alert"></p></div><div><label for="spf_unit">Unit</label><input id="spf_unit" name="unit" maxlength="16" value="' + esc(n.unit) + '" placeholder="e.g. hires" autocomplete="off"></div></div>';
    body += '<div data-for="goal">' + A.fSelect("goalId", "Your goal", goalOpts, n.goalId, { hint: "Follows that goal's own progress from Habits → Goals." }) + '</div>';
    body += A.fText("due", "Deadline (optional)", n.due, { type: "date", hint: "Leave empty to use the end of the " + (type === "objective" ? "year" : type === "priority" ? "quarter" : "month") + "." });
    body += A.fArea("notes", "Notes", n.notes, { max: PL.NOTES_MAX });
    if (editing) body += A.fSelect("status", "Status", PL.STATUSES.map(function (x) { return [x.key, x.label]; }), n.status, { hint: "Paused keeps it but stops warnings. Dropped takes it out of your parents' progress." });
    function sync(root) {
      const meas = root.querySelector('[name="measure"]').value;
      Array.prototype.forEach.call(root.querySelectorAll("[data-for]"), function (g) { g.classList.toggle("hidden", g.getAttribute("data-for").split(" ").indexOf(meas) === -1); });
      const hint = root.querySelector("#sph_measure");
      const info = PL.MEASURES.filter(function (x) { return x.key === meas; })[0];
      if (hint && info) hint.textContent = info.hint;
    }
    function repopulateParents(root) {
      if (type === "objective") return;
      const sel = root.querySelector('[name="parentId"]'), y = Number(root.querySelector('[name="year"]').value);
      const q = type === "priority" ? Number(root.querySelector('[name="quarter"]').value) : PL.quarterOfMonth(Number(root.querySelector('[name="month"]').value));
      const keep = sel.value;
      const choices = parentChoices(type, y, q, editing ? editing.id : "");
      sel.innerHTML = A.optionsHtml(choices, choices.some(function (c) { return c[0] === keep; }) ? keep : "");
    }
    A.openSheet({
      title: (editing ? "Edit " : "New ") + label, body: body, submit: editing ? "Save" : "Add " + label,
      onOpen: function (root) { sync(root); },
      onChange: function (el, root) { if (el.name === "measure") sync(root); if (el.name === "year" || el.name === "quarter" || el.name === "month") repopulateParents(root); },
      onSubmit: function (v) {
        const input = Object.assign({}, v, { type: type, year: Number(v.year) || n.year });
        if (type === "milestone") input.month = String(input.year) + "-" + v.month;
        if (type === "priority") input.quarter = Number(v.quarter);
        if (type === "objective") { input.parentId = ""; }
        const nodes = store.all("nodes");
        const c = { nodes: nodes, goals: A.goals(), today: store.today() };
        const r = editing ? PL.editNode(nodes, editing.id, input, c) : PL.addNode(nodes, input, c);
        if (!r.ok) return { ok: false, errors: r.errors };
        if (!editing && !store.settingsBlocked() && store.all("nodes").length === 0) store.setSettings({});     // the roadmap's first year is fixed the first time it is used
        if (!store.replace("nodes", r.nodes)) return { ok: false, message: store.error() };
        state.open[r.node.id] = true;
        A.say((editing ? "Saved " : "Added ") + r.node.title);
        return { ok: true };
      }
    });
  };

  A.deleteNode = function (id) {
    const n = store.get("nodes", id);
    if (!n) return;
    A.confirmSheet({
      title: "Delete this " + A.typeLabel(n.type).toLowerCase() + "?", text: "“" + n.title + "” will be removed. Tasks linked to it are kept — they just won't be linked to anything. You can undo this for a few seconds.", yes: "Delete",
      onYes: function () {
        const r = PL.removeNode(store.all("nodes"), id);
        if (!r.ok || !store.replace("nodes", r.nodes)) { A.saveFailed(); return; }
        A.notice("Deleted “" + n.title + "”.", "Undo", function () {
          const back = PL.restoreNode(store.all("nodes"), id);
          if (store.replace("nodes", back.nodes)) { A.say("Restored"); A.render(); } else A.saveFailed();
        });
      }
    });
  };

  /* ---------------- money for a year, quarter or month ---------------- */

  A.periodTitle = function (scope, key) {
    return scope === "year" ? String(key) : scope === "quarter" ? "Q" + String(key).slice(6) + " " + String(key).slice(0, 4) : A.monthLabel(key);
  };
  A.openPeriodSheet = function (scope, key) {
    const rec = PL.periodOf(store.all("periods"), scope, key) || {};
    const s = store.settings(), mrr = s.revenueMetric === "mrr";
    const v = function (f) { return rec[f] === null || rec[f] === undefined ? "" : rec[f]; };
    let body = "";
    if (scope === "month") {
      body += A.fText("revenue", mrr ? "MRR at the end of this month" : "Sales revenue this month", v("revenue"), { mode: "decimal", placeholder: "e.g. 4250", hint: mrr ? "MRR is a snapshot, so the quarter and year show the latest month you enter." : "Gratiel's default: the sales revenue for the month. Quarters and years add the months up." });
      body += A.fText("spend", "Spent this month", v("spend"), { mode: "decimal", placeholder: "e.g. 1200", hint: "What you actually spent. Leave empty if you haven't tracked it." });
      body += A.fText("revenueTarget", "Revenue target for the month (optional)", v("revenueTarget"), { mode: "decimal" });
      body += A.fText("budget", "Budget for the month (optional)", v("budget"), { mode: "decimal" });
    } else {
      body += A.fText("revenueTarget", mrr ? "MRR target" : "Revenue target", v("revenueTarget"), { mode: "decimal", placeholder: "e.g. 120000", hint: scope === "year" ? "Actual revenue is added up from the months you enter under Monthly." : "Actual revenue is added up from this quarter's months." });
      body += A.fText("budget", "Budget", v("budget"), { mode: "decimal", placeholder: "e.g. 24000", hint: "Actual spending is added up from the months." });
      body += '<div class="form-row two-col"><div><label for="spf_hiresPlanned">Hires planned (optional)</label><input id="spf_hiresPlanned" name="hiresPlanned" inputmode="numeric" value="' + esc(v("hiresPlanned")) + '" autocomplete="off"><p class="sp-err hidden" data-err="hiresPlanned" role="alert"></p></div><div><label for="spf_hiresMade">Hires made</label><input id="spf_hiresMade" name="hiresMade" inputmode="numeric" value="' + esc(v("hiresMade")) + '" autocomplete="off"><p class="sp-err hidden" data-err="hiresMade" role="alert"></p></div></div>';
      body += A.fArea("hiringNote", "Hiring notes (optional)", rec.hiringNote || "", { rows: 2, max: 500, placeholder: "e.g. a part-time packer, a freelance designer" });
    }
    A.openSheet({
      title: (scope === "month" ? "Money for " : "Targets for ") + A.periodTitle(scope, key), body: body, submit: "Save",
      onSubmit: function (vals) {
        const r = PL.setPeriod(store.all("periods"), scope, key, vals, {});
        if (!r.ok) return { ok: false, errors: r.errors };
        if (!store.replace("periods", PL.purgePeriods(r.periods))) return { ok: false, message: store.error() };
        A.say("Saved");
        return { ok: true };
      }
    });
  };
  // A short block of what has been entered for a period, used by the views. Everything shown is entered or added up from entries.
  A.periodBlock = function (scope, key) {
    const s = A.model().periods(scope, key), mrr = s.metric === "mrr";
    const row = function (label, value, extra) { return '<div class="sp-money-row"><dt>' + esc(label) + '</dt><dd>' + value + (extra || "") + '</dd></div>'; };
    let h = '<dl class="sp-money">';
    h += row(mrr ? "MRR target" : "Revenue target", esc(A.money(s.revenueTarget)));
    h += row(mrr ? "MRR now" : "Revenue so far", s.revenueActual === null ? '<span class="sp-dim">none entered</span>' : esc(A.money(s.revenueActual)), s.revenuePct !== null ? ' <span class="sp-dim">(' + s.revenuePct + '%)</span>' : "");
    h += row("Budget", esc(A.money(s.budget)));
    h += row("Spent so far", s.spendActual === null ? '<span class="sp-dim">none entered</span>' : esc(A.money(s.spendActual)), s.spendPct !== null ? ' <span class="sp-dim">(' + s.spendPct + '%)</span>' : "");
    if (s.overBudget) h += '<div class="sp-money-row"><dt>Spending</dt><dd>' + A.badge("red", "Over budget") + '</dd></div>';
    if (scope !== "month" && (s.hiresPlanned !== null || s.hiresMade !== null || s.hiringNote)) h += row("Hiring", esc((s.hiresMade === null ? 0 : s.hiresMade) + " of " + (s.hiresPlanned === null ? "?" : s.hiresPlanned) + " hires") + (s.hiringNote ? ' <span class="sp-dim">' + esc(s.hiringNote) + '</span>' : ""));
    h += '</dl>';
    if (s.childTargetsDiffer) h += '<p class="sp-dim sp-note">The ' + (scope === "year" ? "quarterly" : "monthly") + ' targets add up to ' + esc(A.money(s.childTargets)) + ', not ' + esc(A.money(s.revenueTarget)) + '.</p>';
    return h;
  };

  /* ---------------- linking tasks to a plan item ---------------- */

  // Opens a sheet to link existing tasks to a node, or make a new task already linked to it.
  A.openLinkSheet = function (nodeId) {
    const m = A.model(), n = m.node(nodeId);
    if (!n) return;
    const today = store.today(), tasks = A.tasks();
    const cands = tasks.filter(function (t) { return !t.completed && m.nodeOfTask(t.id) !== n; })
      .sort(function (a, b) { return (a.date || "").localeCompare(b.date || "") || (a.order || 0) - (b.order || 0); }).slice(0, 80);
    let list = cands.length ? '<ul class="sp-pick" aria-label="Your open tasks">' + cands.map(function (t) {
      const cur = m.nodeOfTask(t.id);
      return '<li><label class="sp-pick-row"><input type="checkbox" name="pick" data-multi value="' + esc(t.id) + '"><span><span class="sp-pick-text">' + esc(t.text) + '</span><span class="sp-pick-meta">' + esc(A.fmtShort(t.date)) + (t.date && t.date < today ? " · earlier" : "") + (cur ? " · now linked to “" + esc(cur.title) + "” (will move here)" : "") + '</span></span></label></li>';
    }).join("") + '</ul>' : '<p class="sp-dim">You have no open tasks to link. Add one below.</p>';
    const body = '<p class="sp-dim">Linking does not change the task. It just counts toward “' + esc(n.title) + '” and everything above it. A task links to one item at a time.</p>' + list +
      '<h3 class="sp-h4">Or add a new task</h3>' + A.fText("newText", "New task", "", { max: 140, placeholder: "What needs doing?" }) +
      '<div class="form-row two-col"><div><label for="spf_newDate">Day</label><input type="date" id="spf_newDate" name="newDate" value="' + esc(today) + '"></div><div><label for="spf_newPriority">Priority</label><select id="spf_newPriority" name="newPriority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></div></div>' +
      '<p class="sp-err hidden" data-err="pick" role="alert"></p>';
    A.openSheet({
      title: "Tasks for “" + n.title + "”", body: body, submit: "Link / add", focus: '[name="pick"], [name="newText"]',
      onSubmit: function (v) {
        const picks = Array.isArray(v.pick) ? v.pick : [], text = String(v.newText || "").trim();
        if (!picks.length && !text) return { ok: false, errors: { pick: "Pick a task, or type a new one." } };
        let links = store.all("links"), count = 0;
        picks.forEach(function (id) { const r = PL.setLink(links, id, nodeId, { nodes: store.all("nodes") }); if (r.ok) { links = r.links; count++; } });
        if (text) {
          const h = habits();
          const t = h && h.addTask ? h.addTask({ text: text, date: v.newDate, priority: v.newPriority }) : null;
          if (!t) return { ok: false, errors: { newText: "That task couldn't be added." } };
          const r = PL.setLink(links, t.id, nodeId, { nodes: store.all("nodes") });
          if (r.ok) { links = r.links; count++; }
        }
        if (!store.replace("links", links)) return { ok: false, message: store.error() };
        state.open[nodeId] = true;
        A.say(A.plural(count, "task") + " linked");
        return { ok: true };
      }
    });
  };

  // Which plan item one task counts toward (or none), and how long you expect it to take.
  A.openTaskLinkSheet = function (taskId) {
    const t = A.taskById(taskId);
    if (!t) { A.notice("That task isn't there any more.", ""); return; }
    const m = A.model(), cur = m.nodeOfTask(taskId), link = PL.linkOf(store.all("links"), taskId);
    const group = function (label, list) { return list.length ? '<optgroup label="' + esc(label) + '">' + list.map(function (n) { return '<option value="' + esc(n.id) + '"' + (cur && cur.id === n.id ? " selected" : "") + '>' + esc(n.title) + '</option>'; }).join("") + '</optgroup>' : ""; };
    const active = function (type) { return m.all(type).filter(function (n) { return n.status !== "dropped" || (cur && cur.id === n.id); }); };
    const sel = '<select id="spf_nodeId" name="nodeId"><option value=""' + (cur ? "" : " selected") + '>Not linked to the plan</option>' +
      group("Yearly objectives", active("objective")) + group("Quarterly priorities", active("priority")) + group("Monthly milestones", active("milestone")) + '</select>';
    const body = '<p class="sp-task-name">' + esc(t.text) + '</p>' + A.row("nodeId", "Counts toward", sel, { hint: "Completing the task moves this item and everything above it. The task itself is not changed." }) +
      A.fText("estMin", "Time you expect it to take (minutes, optional)", link && link.estMin ? link.estMin : "", { mode: "numeric", placeholder: "e.g. 45" });
    A.openSheet({
      title: "Link task to the plan", body: body, submit: "Save",
      onSubmit: function (v) {
        let links = store.all("links");
        const est = PL.setEstimate(links, taskId, v.estMin, {});
        if (!est.ok) return { ok: false, errors: { estMin: est.error } };
        links = est.links;
        const r = PL.setLink(links, taskId, v.nodeId || "", { nodes: store.all("nodes") });
        if (!r.ok) return { ok: false, errors: { nodeId: r.error } };
        if (!store.replace("links", r.links)) return { ok: false, message: store.error() };
        A.say(v.nodeId ? "Linked" : "Unlinked");
        return { ok: true };
      }
    });
  };

  // The roadmap's own settings: the vision, where it starts, how revenue is measured, and the weekly planner's hours.
  A.openSettingsSheet = function () {
    const s = store.settings(), y = new Date().getFullYear();
    const years = []; for (let i = y - 2; i <= y + 3; i++) years.push([String(i), String(i)]);
    const times = function (name, label, value) {
      const opts = []; for (let h = 0; h < 24; h++) { const t = (h < 10 ? "0" : "") + h + ":00"; opts.push([t, t]); }
      return A.fSelect(name, label, opts, value);
    };
    const body = A.fArea("vision", "Your three-year vision", s.vision, { rows: 4, max: 600, placeholder: "Where do you want Gratiel — and your life — to be three years from now?" }) +
      A.fSelect("startYear", "Year 1 of the roadmap", years, String(s.startYear), { hint: "The roadmap shows this year and the next two." }) +
      A.fSelect("revenueMetric", "How revenue is measured", [["sales", "Monthly sales revenue (default)"], ["mrr", "MRR (monthly recurring revenue)"]], s.revenueMetric, { hint: "Sales revenue adds months up. MRR is a snapshot, so a quarter or year shows its latest month. Only choose MRR if your business has subscriptions." }) +
      '<h3 class="sp-h4">Weekly planner</h3><div class="form-row two-col"><div>' + times("dayStart", "Day starts", s.dayStart) + '</div><div>' + times("dayEnd", "Day ends", s.dayEnd) + '</div></div>' +
      A.fSelect("interval", "Time blocks snap to", [["30", "30 minutes"], ["60", "1 hour"]], String(s.interval)) +
      A.fSelect("dailyLimitHours", "Daily workload limit", [6, 7, 8, 9, 10, 11, 12, 14].map(function (h) { return [String(h), h + " hours"]; }), String(s.dailyLimitHours), { hint: "Blocks and calendar events above this on one day get a warning. Rest blocks don't count." });
    A.openSheet({
      title: "Plan settings", body: body, submit: "Save",
      onSubmit: function (v) {
        if (v.dayStart >= v.dayEnd) return { ok: false, errors: { dayEnd: "The day has to end after it starts." } };
        if (!store.setSettings({ vision: v.vision, startYear: Number(v.startYear), revenueMetric: v.revenueMetric, dayStart: v.dayStart, dayEnd: v.dayEnd, interval: Number(v.interval), dailyLimitHours: Number(v.dailyLimitHours) })) return { ok: false, message: store.error() };
        A.say("Saved");
        return { ok: true };
      }
    });
  };
  A.acts["plan-settings"] = function () { A.openSettingsSheet(); };
  A.acts["link-task"] = function (el) { A.openTaskLinkSheet(el.getAttribute("data-id")); };

  /* ---------------- clicks ---------------- */

  A.acts["toggle-card"] = function (el) { const id = el.getAttribute("data-id"); state.open[id] = !state.open[id]; A.render(); };
  A.acts["open-node"] = function (el) {
    const n = A.model().node(el.getAttribute("data-id"));
    if (!n) return;
    state.open[n.id] = true;
    if (n.type === "objective") A.go("yearly", { year: n.year });
    else if (n.type === "priority") A.go("quarterly", { year: n.year, quarter: n.quarter });
    else A.go("monthly", { year: n.year, month: n.month });
  };
  A.acts["edit-node"] = function (el) { A.openNodeSheet({ id: el.getAttribute("data-id") }); };
  A.acts["delete-node"] = function (el) { A.deleteNode(el.getAttribute("data-id")); };
  A.acts["link-tasks"] = function (el) { A.openLinkSheet(el.getAttribute("data-id")); };
  A.acts["task-toggle"] = function (el) { A.toggleTask(el.getAttribute("data-id")); };
  A.acts["task-unlink"] = function (el) {
    const id = el.getAttribute("data-id"), t = A.taskById(id), prev = PL.linkOf(store.all("links"), id);
    if (A.linkTask(id, "")) {
      A.notice("Unlinked" + (t ? " “" + t.text + "”" : "") + ". The task is kept.", prev ? "Undo" : "", function () { if (prev && A.linkTask(id, prev.nodeId)) A.render(); });
      A.render();
    }
  };
  A.acts["mark-done"] = function (el) {
    const id = el.getAttribute("data-id"), n = store.get("nodes", id);
    if (!n) return;
    const r = PL.setDoneAt(store.all("nodes"), id, !n.doneAt, { today: store.today() });
    if (!store.replace("nodes", r.nodes)) { A.saveFailed(); return; }
    A.render();
  };
  A.acts["move-node"] = function (el) {
    const next = PL.move(store.all("nodes"), el.getAttribute("data-id"), Number(el.getAttribute("data-dir")), {});
    if (next !== store.all("nodes") && !store.replace("nodes", next)) A.saveFailed();
    A.render();
  };
  A.acts["save-number"] = function (el) {
    const id = el.getAttribute("data-id"), inp = document.querySelector('[data-num-for="' + id + '"]');
    const r = PL.setCurrent(store.all("nodes"), id, inp ? inp.value : "", {});
    if (!r.ok) { A.notice(r.error || "That couldn't be saved.", ""); return; }
    if (!store.replace("nodes", r.nodes)) { A.saveFailed(); return; }
    A.render();
  };
  A.acts["period"] = function (el) { A.openPeriodSheet(el.getAttribute("data-scope"), el.getAttribute("data-key")); };

  function onClick(e) {
    const undo = e.target.closest("[data-sp-undo]");
    if (undo) { const bar = $("spUndo"), fn = bar && bar._fn; if (bar) { bar.classList.add("hidden"); bar._fn = null; } if (fn) fn(); return; }
    const el = e.target.closest("[data-act]");
    if (!el || !$("spView").contains(el)) return;
    if (el.tagName === "INPUT" && el.type === "checkbox") return;          // handled by the change event, so the box and the list agree
    const fn = A.acts[el.getAttribute("data-act")];
    if (fn) fn(el, e);
  }
  function onChange(e) {
    const el = e.target;
    if (el.matches && el.matches('input[type="checkbox"][data-act]')) { const fn = A.acts[el.getAttribute("data-act")]; if (fn) fn(el, e); return; }
    const view = views[state.view];
    if (view && view.change) view.change(el, e);
  }

  /* ---------------- starting up ---------------- */

  function start() {
    if (started) return;
    started = true;
    store.init();
    const today = store.today();
    state.year = Number(today.slice(0, 4)); state.quarter = PL.quarterOfDate(today); state.month = PL.monthOfDate(today);
    const panel = $("panel-strategy");
    if (!panel) return;
    Array.prototype.forEach.call(panel.querySelectorAll(".sp-sub-nav .sub-nav-btn"), function (b) {
      b.addEventListener("click", function () { A.go(b.getAttribute("data-sp")); });
    });
    $("spView").addEventListener("click", onClick);
    $("spView").addEventListener("change", onChange);
    $("spUndo").addEventListener("click", onClick);
    store.subscribe(function () { A.bump(); });
    // A task was ticked, added or moved anywhere (Habits, Calendar, here): the progress shown follows it.
    document.addEventListener("jarvis-tasks-changed", function () {
      A.bump();
      const a = document.activeElement;
      if (a && a.matches && a.matches("textarea, input[type=text], input[type=number]") && $("spView").contains(a)) return;   // don't redraw under what is being typed
      if (shown && !sheet) A.render();
    });
    document.addEventListener("jarvis-habits-day-changed", function () { A.bump(); if (shown && !sheet) A.render(); });
  }

  window.JarvisPlan = {
    onShow: function () {
      start(); shown = true; if (A.weekReconcile) A.weekReconcile();
      // links of tasks that were deleted long ago (30+ days) are dropped; only when the task list has loaded
      const have = A.tasks();
      if (have.length) { const cur = store.all("links"), kept = PL.purgeLinks(cur, have.map(function (t) { return t.id; }), Date.now()); if (kept.length !== cur.length) store.replace("links", kept); }
      A.render();
    },
    onHide: function () { shown = false; },
    go: function (view, extra) { start(); A.go(view, extra); },
    app: A,
    // What Habits needs for the task form and the task rows (it never reads the plan's lists itself).
    choices: function (currentId) {
      start();
      const out = [], nodes = PL.liveNodes(store.all("nodes"));
      [["objective", "Yearly objectives"], ["priority", "Quarterly priorities"], ["milestone", "Monthly milestones"]].forEach(function (g) {
        nodes.filter(function (n) { return n.type === g[0] && (n.status !== "dropped" || n.id === currentId); })
          .sort(function (a, b) { return (a.year - b.year) || ((a.quarter || 0) - (b.quarter || 0)) || (a.order - b.order); })
          .forEach(function (n) { out.push({ id: n.id, label: n.title + (n.type === "objective" ? " (" + n.year + ")" : n.type === "priority" ? " (Q" + n.quarter + " " + n.year + ")" : " (" + A.monthLabel(n.month) + ")"), group: g[1] }); });
      });
      return out;
    },
    nodeIdOfTask: function (taskId) { start(); const l = PL.linkOf(store.all("links"), taskId); return l && l.nodeId && store.get("nodes", l.nodeId) ? l.nodeId : ""; },
    nodeTitleOfTask: function (taskId) { start(); const l = PL.linkOf(store.all("links"), taskId), n = l && l.nodeId ? store.get("nodes", l.nodeId) : null; return n ? n.title : ""; },
    setTaskLink: function (taskId, nodeId) { start(); const ok = A.linkTask(taskId, nodeId || ""); if (ok) A.bump(); return ok; }
  };
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-open-strategy]")) { const b = $("navBtnStrategy"); if (b) b.click(); }
  });
  window.JarvisPlanApp = A;
  document.addEventListener("DOMContentLoaded", start);
})();
