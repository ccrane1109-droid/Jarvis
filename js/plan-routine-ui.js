/* ==========================================================================
   JARVIS — Planning › Routines: reusable sequences you put on days.

   Rules are in plan-routine-logic.js (tested). This file is the screens:
     Routines list     each routine: Apply, Edit, ⋯ (Duplicate, Pause or Resume, Update future days, Remove future days, Delete)
     New / Edit        name, kind, start time, steps (name, minutes, gap before it, an optional linked habit), move or remove a step
     Apply             start time, weekdays, how far ahead; shows what would be added and what is already there; then you confirm
   A routine puts ordinary time blocks on the Calendar (the same blocks the Weekly plan makes). It remembers which, so "Update future days"
   can replace its future blocks after you edit it; days that have passed are never touched. Applying and updating can be undone.
   Stored: jarvisPlanRoutines (synced, merged by id).
   ========================================================================== */

(function () {
  "use strict";

  const R = window.JarvisPlanRoutineLogic;
  if (!R) return;
  const KEY = "jarvisPlanRoutines";
  const WEEK = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
  const KIND_DAYS = { "school-morning": [1, 2, 3, 4, 5], "after-school": [1, 2, 3, 4, 5], "weekend-morning": [6, 0], "sunday-reset": [0] };
  const HORIZONS = [[7, "The next 7 days"], [14, "The next 14 days"], [28, "The next 28 days"]];
  let list = [];

  function core() { return window.JarvisCore; }
  function A() { return window.JarvisPlanApp || null; }
  function esc(s) { return core().escapeHtml(String(s === undefined || s === null ? "" : s)); }
  function today() { return core().todayISODate(); }
  function say(t) { try { core().showToast(t); } catch (e) { /* nothing to tell */ } }
  function ctx() { return { now: Date.now(), makeId: function (p) { return core().uid(p); } }; }
  function load() { list = R.clean(core().loadJSON(KEY, []), ctx()); }
  function save(next) {
    const prev = list;
    list = next;
    if (!core().saveJSON(KEY, list)) { list = prev; say("That couldn't be saved. The browser may be full or blocking storage."); return false; }
    return true;
  }
  function store() { const S = window.JarvisPlanStore; try { if (S) S.init(); } catch (e) { /* the plan store starts itself */ } return S; }
  function W() { return window.JarvisPlanWeekLogic; }
  function habitMap() {
    const h = window.JarvisHabits, out = {};
    try { (h && h.getHabits ? h.getHabits() : []).forEach(function (x) { if (x && x.id && x.name && !x.archivedAt) out[x.id] = x.name; }); } catch (e) { /* no habits */ }
    return out;
  }
  function timeLabel(t) { return window.JarvisCalendarLogic ? window.JarvisCalendarLogic.timeLabel(t) : t; }
  function dateLabel(d) { return window.JarvisCalendarLogic ? window.JarvisCalendarLogic.fmtDate(d, { weekday: "short", month: "short", day: "numeric" }) : d; }
  function undoable(text, fn) { const c = window.JarvisCalendar; if (c && c.notice) c.notice(text, "Undo", fn); else say(text); }
  function timeOptions() { const o = []; for (let m = 0; m < 1440; m += 15) { const t = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); o.push([t, timeLabel(t)]); } return o; }

  /* ---------------- the Calendar's blocks, changed in one step ---------------- */

  // Adds blocks for `entries` ({ date, title, start, end, stepId }); returns { ok, blocks (all), made: [{ date, blockId, stepId }] } and changes nothing if any is refused.
  function makeBlocks(routine, entries) {
    const S = store(), Wk = W();
    if (!S || !Wk) return { ok: false, error: "Time blocks aren't available right now." };
    let blocks = S.all("blocks"); const made = [], c = ctx();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i], r = Wk.addBlock(blocks, { title: e.title, date: e.date, start: e.start, end: e.end, notes: "From the routine “" + routine.name + "”." }, c);
      if (!r.ok) return { ok: false, error: "“" + e.title + "” on " + dateLabel(e.date) + " couldn't be added: " + (Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0] || "it was refused.") };
      blocks = r.blocks; made.push({ date: e.date, blockId: r.block.id, stepId: e.stepId });
    }
    return { ok: true, blocks: blocks, made: made };
  }
  function liveBlocks() { const S = store(), Wk = W(); return S && Wk ? S.all("blocks").filter(function (b) { return b && !b.deletedAt; }) : []; }
  function writeBlocks(blocks) { const S = store(); return !!(S && S.replace("blocks", blocks)); }

  /* ---------------- the list ---------------- */

  function openList(opener) {
    load();
    const App = A();
    if (!App || !App.openSheet) { say("Routines aren't available right now."); return; }
    const live = R.live(list);
    let body = live.length ? '<ul class="rt-list">' + live.map(function (r) {
      return '<li class="rt-item"><div class="rt-main"><span class="rt-name">' + esc(r.name) + (r.paused ? ' <span class="po-tag">Paused</span>' : "") + '</span><span class="sp-dim">' + esc(R.summary(r) + " · starts " + timeLabel(r.startTime)) + '</span></div>' +
        '<div class="rt-btns"><button type="button" class="btn btn-secondary" data-sheet-act="apply" data-id="' + esc(r.id) + '" aria-label="Apply ' + esc(r.name) + '">Apply</button>' +
        '<button type="button" class="btn btn-secondary" data-sheet-act="edit" data-id="' + esc(r.id) + '" aria-label="Edit ' + esc(r.name) + '">Edit</button>' +
        '<button type="button" class="btn btn-secondary rt-more" data-sheet-act="more" data-id="' + esc(r.id) + '" aria-label="More for ' + esc(r.name) + '" aria-haspopup="dialog">&#8942;</button></div></li>';
    }).join("") + '</ul>' : '<p class="sp-dim">No routines yet. Add a starter and change it to fit you, or make your own.</p>';
    body += '<div class="rt-add"><button type="button" class="btn btn-secondary" data-sheet-act="new">New routine</button><button type="button" class="btn btn-secondary" data-sheet-act="starters">Add a starter…</button></div>';
    App.openSheet({
      title: "Routines", body: body,
      onAct: function (act, el) {
        const id = el.getAttribute("data-id");
        App.closeSheet(true);
        if (act === "new") openEdit(null);
        else if (act === "edit") openEdit(id);
        else if (act === "apply") openApply(id);
        else if (act === "more") openMore(id, opener);
        else if (act === "starters") openStarters(opener);
      }
    });
  }

  function openStarters(opener) {
    window.JarvisMenu.open({
      title: "Add a starter", opener: opener,
      rows: R.STARTERS.map(function (s, i) { return { key: String(i), label: s.name, sub: s.steps.length + " steps, from " + timeLabel(s.startTime) + ". Edit it after." }; }),
      onPick: function (key) {
        const r = R.add(list, R.fromStarter(Number(key)), ctx());
        if (!r.ok) say(r.errors.name || r.errors.steps || "That couldn't be added.");
        else if (save(r.list)) say("Added “" + r.routine.name + "”. Edit it to match your day.");
        openList(opener);
      },
      onDismiss: function () { openList(opener); }
    });
  }

  function openMore(id, opener) {
    const r = R.byId(list, id);
    if (!r) { openList(opener); return; }
    const fut = R.futureApplied(r, today()), liveIds = {};
    liveBlocks().forEach(function (b) { liveIds[b.id] = true; });
    const futLive = fut.filter(function (a) { return liveIds[a.blockId]; });
    const rows = [
      { key: "dup", label: "Duplicate" },
      { key: "pause", label: r.paused ? "Resume" : "Pause", sub: r.paused ? "Use it again" : "Stops it being applied. Days already applied stay." }
    ];
    if (futLive.length) {
      rows.push({ key: "update", label: "Update future days", sub: "Replace its blocks on " + dayCount(futLive) + " to match the routine now. Past days are not changed." });
      rows.push({ key: "removefuture", label: "Remove future days", sub: "Take its blocks off " + dayCount(futLive) + ". Past days are not changed." });
    }
    rows.push({ key: "delete", label: "Delete routine", sub: "Blocks it already put on the Calendar stay.", danger: true });
    window.JarvisMenu.open({
      title: r.name, opener: opener, rows: rows,
      onPick: function (key) {
        if (key === "dup") { const d = R.duplicate(list, id, ctx()); if (d.ok && save(d.list)) say("Duplicated as “" + d.routine.name + "”."); else if (!d.ok) say(d.error || "That couldn't be duplicated."); openList(opener); }
        else if (key === "pause") { const p = R.setPaused(list, id, !r.paused, ctx()); if (p.ok) save(p.list); openList(opener); }
        else if (key === "update") confirmChange("Update future days?", "This replaces the blocks “" + r.name + "” made on " + dayCount(futLive) + " with its current steps and start time. If you moved or edited one of those blocks, it is replaced too. Days that have passed are not changed.", "Update", function () { updateFuture(id); openList(opener); }, opener);
        else if (key === "removefuture") confirmChange("Remove future days?", "This takes the blocks “" + r.name + "” made off " + dayCount(futLive) + ". Days that have passed are not changed.", "Remove", function () { removeFuture(id); openList(opener); }, opener);
        else if (key === "delete") confirmChange("Delete “" + r.name + "”?", "The routine is deleted. Blocks it already put on the Calendar stay where they are.", "Delete", function () { const x = R.remove(list, id, ctx()); if (x.ok && save(x.list)) say("Deleted."); openList(opener); }, opener);
      },
      onDismiss: function () { openList(opener); }
    });
  }
  function dayCount(entries) { const d = {}; entries.forEach(function (a) { d[a.date] = true; }); const n = Object.keys(d).length; return n + (n === 1 ? " day" : " days"); }
  function confirmChange(title, text, yes, onYes, opener) {
    const App = A();
    App.confirmSheet({ title: title, text: text, yes: yes, danger: yes === "Delete" || yes === "Remove", onYes: onYes });
  }

  /* ---------------- new and edit ---------------- */

  function blankDraft() { return { id: "", name: "", kind: "custom", startTime: "07:00", steps: [{ title: "", durationMin: 15, gapMin: 0, habitId: "" }] }; }
  function draftOf(r) { return { id: r.id, name: r.name, kind: r.kind, startTime: r.startTime, steps: r.steps.map(function (s) { return { title: s.title, durationMin: s.durationMin, gapMin: s.gapMin, habitId: s.habitId }; }) }; }
  // The form's current values as a draft, so moving a step or adding one does not lose what was typed.
  function readDraft(root, base) {
    const App = A(), v = App.formValues(root.querySelector("form")), steps = [];
    for (let i = 0; i < (base.steps || []).length; i++) steps.push({ title: v["title_" + i] || "", durationMin: v["dur_" + i], gapMin: i ? v["gap_" + i] : 0, habitId: v["habit_" + i] || "" });
    return { id: base.id, name: v.name || "", kind: v.kind || "custom", startTime: v.startTime || base.startTime, steps: steps };
  }
  function stepRow(s, i, n, habits) {
    const habitOpts = '<option value="">No habit</option>' + Object.keys(habits).map(function (id) { return '<option value="' + esc(id) + '"' + (s.habitId === id ? " selected" : "") + '>' + esc(habits[id]) + '</option>'; }).join("");
    return '<div class="rt-step" role="group" aria-label="Step ' + (i + 1) + '">' +
      '<div class="rt-step-top"><span class="rt-step-n" aria-hidden="true">' + (i + 1) + '</span><input type="text" name="title_' + i + '" value="' + esc(s.title) + '" maxlength="80" placeholder="What happens" aria-label="Step ' + (i + 1) + ' name" autocomplete="off">' +
      '<button type="button" class="po-more" data-sheet-act="up" data-i="' + i + '" aria-label="Move step ' + (i + 1) + ' up"' + (i === 0 ? " disabled" : "") + '>&uarr;</button>' +
      '<button type="button" class="po-more" data-sheet-act="down" data-i="' + i + '" aria-label="Move step ' + (i + 1) + ' down"' + (i === n - 1 ? " disabled" : "") + '>&darr;</button>' +
      '<button type="button" class="po-more" data-sheet-act="del" data-i="' + i + '" aria-label="Remove step ' + (i + 1) + '"' + (n === 1 ? " disabled" : "") + '>&times;</button></div>' +
      '<div class="rt-step-opts"><label>Minutes <input type="number" name="dur_' + i + '" value="' + esc(s.durationMin) + '" min="15" max="240" inputmode="numeric"></label>' +
      (i ? '<label>Gap before (min) <input type="number" name="gap_' + i + '" value="' + esc(s.gapMin || 0) + '" min="0" max="120" inputmode="numeric"></label>' : "") +
      '<label>Linked habit <select name="habit_' + i + '">' + habitOpts + '</select></label></div></div>';
  }

  function openEdit(id, draft) {
    const App = A();
    if (!App) return;
    const habits = habitMap(), base = draft || (id ? (R.byId(list, id) ? draftOf(R.byId(list, id)) : null) : blankDraft());
    if (!base) { say("That routine isn't there any more."); openList(); return; }
    base.id = id || "";
    const body = App.fText("name", "Name", base.name, { max: R.NAME_MAX, required: true, placeholder: "e.g. School morning" }) +
      App.fSelect("kind", "Kind", R.KINDS, base.kind) + App.fSelect("startTime", "Starts at", timeOptions(), base.startTime, { hint: "The first step starts here. Each step follows the one before it." }) +
      '<fieldset class="rt-steps"><legend>Steps</legend>' + base.steps.map(function (s, i) { return stepRow(s, i, base.steps.length, habits); }).join("") +
      '<p class="sp-err hidden" data-err="steps" role="alert"></p>' +
      (base.steps.length < R.MAX_STEPS ? '<button type="button" class="btn btn-secondary" data-sheet-act="add">+ Add a step</button>' : "") +
      '<p class="field-hint">A step linked to a habit makes no block: the habit already has its own time on the Calendar.</p></fieldset>';
    App.openSheet({
      title: id ? "Edit routine" : "New routine", body: body, submit: id ? "Save" : "Add routine", focus: '[name="name"]',
      onAct: function (act, el, root) {
        const d = readDraft(root, base), i = Number(el.getAttribute("data-i"));
        if (act === "add") d.steps.push({ title: "", durationMin: 15, gapMin: 0, habitId: "" });
        else if (act === "del" && d.steps.length > 1) d.steps.splice(i, 1);
        else if (act === "up" && i > 0) { const t = d.steps[i]; d.steps[i] = d.steps[i - 1]; d.steps[i - 1] = t; }
        else if (act === "down" && i < d.steps.length - 1) { const t = d.steps[i]; d.steps[i] = d.steps[i + 1]; d.steps[i + 1] = t; }
        else return;
        App.closeSheet(true);
        openEdit(id, d);
        window.setTimeout(function () { const f = document.querySelector('.sp-sheet-overlay [data-sheet-act="' + act + '"][data-i="' + Math.max(0, act === "up" ? i - 1 : act === "down" ? i + 1 : Math.min(i, d.steps.length - 1)) + '"]') || document.querySelector('.sp-sheet-overlay [data-sheet-act="add"]'); if (f) f.focus(); }, 30);
      },
      onClose: function (saved) { if (saved) window.setTimeout(function () { openList(); }, 0); },
      onSubmit: function (v, form) {
        const d = readDraft(form.closest(".sp-sheet-overlay"), base);
        const r = id ? R.edit(list, id, d, ctx()) : R.add(list, d, ctx());
        if (!r.ok) return { ok: false, errors: r.errors };
        if (!save(r.list)) return { ok: false, message: "That couldn't be saved." };
        const hadFuture = id && R.futureApplied(R.byId(r.list, id), today()).length;
        say(id ? (hadFuture ? "Saved. Days already applied are unchanged; use “Update future days” to refresh them." : "Saved.") : "Routine added.");
        return { ok: true };
      }
    });
  }

  /* ---------------- apply ---------------- */

  function openApply(id) {
    const App = A(), r = R.byId(list, id);
    if (!App || !r) { say("That routine isn't there any more."); return; }
    if (r.paused) { say("“" + r.name + "” is paused. Resume it to use it."); openList(); return; }
    const picked = KIND_DAYS[r.kind] || [1, 2, 3, 4, 5, 6, 0];
    const body = '<p class="sp-dim">' + esc(r.name + " · " + R.summary(r)) + '</p>' +
      App.fSelect("startTime", "Start at", timeOptions(), r.startTime) +
      '<fieldset class="rt-days"><legend>On these days</legend><div class="rt-daychips">' + WEEK.map(function (w) { return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="days" value="' + w[0] + '"' + (picked.indexOf(w[0]) !== -1 ? " checked" : "") + '> ' + w[1] + '</label>'; }).join("") + '</div></fieldset>' +
      App.fSelect("span", "How far ahead", HORIZONS, "14") +
      '<div id="rtPreview" class="rt-preview" aria-live="polite"></div>';
    const compute = function (root) {
      const v = App.formValues(root.querySelector("form")), dates = R.datesFor(today(), Number(v.span), (v.days || []).map(Number));
      const ex = liveBlocks().map(function (b) { return { date: b.date, title: b.title, start: b.start }; });
      return { v: v, dates: dates, plan: R.planApply(r, dates, v.startTime, ex, habitMap(), today()) };
    };
    const show = function (root) {
      const c = compute(root), out = root.querySelector("#rtPreview");
      if (!out) return;
      if (!c.plan.ok) { out.textContent = c.plan.error; return; }
      const days = {}; c.plan.add.forEach(function (a) { days[a.date] = true; });
      let t = c.plan.add.length ? "Adds " + c.plan.add.length + (c.plan.add.length === 1 ? " block" : " blocks") + " on " + Object.keys(days).length + (Object.keys(days).length === 1 ? " day" : " days") + "." : (c.dates.length ? "Nothing to add: everything is already planned." : "Pick at least one day.");
      const already = c.plan.skipped.filter(function (s) { return /^Already/.test(s.reason); }).length;
      if (already) t += " " + already + (already === 1 ? " step is" : " steps are") + " already planned and will be left as they are.";
      if (c.plan.habitSteps.length) t += " " + c.plan.habitSteps.map(function (h) { return "“" + h.title + "” uses your habit (" + h.habitName + ")"; }).join(", ") + ": no block.";
      out.textContent = t;
    };
    App.openSheet({
      title: "Apply routine", body: body, submit: "Apply",
      onOpen: show, onChange: function (el, root) { show(root); },
      onSubmit: function (v, form) {
        const c = compute(form.closest(".sp-sheet-overlay"));
        if (!c.plan.ok) return { ok: false, message: c.plan.error };
        if (!c.plan.add.length) return { ok: false, message: c.dates.length ? "Nothing to add: everything is already planned for those days." : "Pick at least one day." };
        const m = makeBlocks(r, c.plan.add);
        if (!m.ok) return { ok: false, message: m.error };
        const prevBlocks = store().all("blocks"), prevList = list;
        if (!writeBlocks(m.blocks)) return { ok: false, message: "The browser would not save that, so nothing was added." };
        const rec = R.recordApplied(list, id, m.made, ctx());
        if (!rec.ok || !save(rec.list)) { writeBlocks(prevBlocks); list = prevList; return { ok: false, message: "That couldn't be saved, so nothing was added." }; }
        const ids = m.made.map(function (x) { return x.blockId; });
        undoable("Added " + m.made.length + (m.made.length === 1 ? " block" : " blocks") + " from “" + r.name + "”.", function () { undoApply(id, ids); });
        if (window.JarvisCalendar && window.JarvisCalendar.refresh) window.JarvisCalendar.refresh();
        return { ok: true };
      }
    });
  }
  // Takes back what an apply made: those blocks go (and the routine forgets them).
  function undoApply(id, blockIds) {
    const S = store(), Wk = W(), c = ctx();
    let blocks = S.all("blocks");
    blockIds.forEach(function (b) { const x = Wk.removeBlock(blocks, b, c); if (x.ok) blocks = x.blocks; });
    writeBlocks(blocks);
    load();
    save(R.forgetApplied(list, id, blockIds, c).list);
    if (window.JarvisCalendar && window.JarvisCalendar.refresh) window.JarvisCalendar.refresh();
  }

  /* ---------------- update or remove future days ---------------- */

  function liveFuture(r) { const ids = {}; liveBlocks().forEach(function (b) { ids[b.id] = true; }); return R.futureApplied(r, today()).filter(function (a) { return ids[a.blockId]; }); }

  function removeFuture(id) {
    const r = R.byId(list, id), S = store(), Wk = W();
    if (!r || !S || !Wk) return;
    const fut = liveFuture(r), c = ctx(), prevBlocks = S.all("blocks"), prevList = list;
    let blocks = prevBlocks;
    fut.forEach(function (a) { const x = Wk.removeBlock(blocks, a.blockId, c); if (x.ok) blocks = x.blocks; });
    if (!writeBlocks(blocks)) { say("The browser would not save that."); return; }
    if (!save(R.forgetApplied(list, id, fut.map(function (a) { return a.blockId; }), c).list)) { writeBlocks(prevBlocks); list = prevList; return; }
    undoable("Removed " + dayCount(fut) + " of “" + r.name + "”.", function () { writeBlocks(prevBlocks); list = prevList; save(prevList); if (window.JarvisCalendar && window.JarvisCalendar.refresh) window.JarvisCalendar.refresh(); });
    if (window.JarvisCalendar && window.JarvisCalendar.refresh) window.JarvisCalendar.refresh();
  }

  // Replaces the routine's blocks on the future days it was applied to with what it is now.
  function updateFuture(id) {
    const r = R.byId(list, id), S = store(), Wk = W();
    if (!r || !S || !Wk) return;
    if (r.paused) { say("This routine is paused. Resume it first."); return; }
    const fut = liveFuture(r), dates = Object.keys(fut.reduce(function (o, a) { o[a.date] = true; return o; }, {})).sort();
    if (!dates.length) { say("It has no future days to update."); return; }
    const c = ctx(), prevBlocks = S.all("blocks"), prevList = list, gone = {};
    let blocks = prevBlocks;
    fut.forEach(function (a) { const x = Wk.removeBlock(blocks, a.blockId, c); if (x.ok) { blocks = x.blocks; gone[a.blockId] = true; } });
    const ex = blocks.filter(function (b) { return b && !b.deletedAt; }).map(function (b) { return { date: b.date, title: b.title, start: b.start }; });
    const plan = R.planApply(r, dates, r.startTime, ex, habitMap(), today());
    if (!plan.ok) { say(plan.error); return; }
    // add onto the list that already has the old blocks removed
    let made = [], next = blocks;
    for (let i = 0; i < plan.add.length; i++) {
      const e = plan.add[i], x = Wk.addBlock(next, { title: e.title, date: e.date, start: e.start, end: e.end, notes: "From the routine “" + r.name + "”." }, c);
      if (!x.ok) { say("“" + e.title + "” on " + dateLabel(e.date) + " couldn't be added, so nothing was changed."); return; }
      next = x.blocks; made.push({ date: e.date, blockId: x.block.id, stepId: e.stepId });
    }
    if (!writeBlocks(next)) { say("The browser would not save that, so nothing was changed."); return; }
    const upd = R.recordApplied(R.forgetApplied(list, id, Object.keys(gone), c).list, id, made, c);
    if (!upd.ok || !save(upd.list)) { writeBlocks(prevBlocks); list = prevList; say("That couldn't be saved, so nothing was changed."); return; }
    undoable("Updated " + dayCount(fut) + " of “" + r.name + "”.", function () { writeBlocks(prevBlocks); list = prevList; save(prevList); if (window.JarvisCalendar && window.JarvisCalendar.refresh) window.JarvisCalendar.refresh(); });
    if (window.JarvisCalendar && window.JarvisCalendar.refresh) window.JarvisCalendar.refresh();
  }

  window.JarvisPlanRoutines = { openList: openList, list: function () { load(); return R.live(list).slice(); } };
})();
