/* ==========================================================================
   JARVIS — Habits: the Plan tab (a section for each hour of the day).

   The rules are in dayplan-logic.js. This file only draws them and passes taps to them.

   What you plan here is an ordinary task with a time, the same task the To-Do list shows. The list of
   tasks is not copied: it is read from, and handed back to, habits.js (JarvisHabits.getTasks /
   commitTasks), so ticking in either place ticks both and Discipline and backup see the same thing.

   One form is open at a time (adding to an hour, editing an item, or giving a not-scheduled task an
   hour). Deleting is not asked about: it happens, and an Undo bar stays for a few seconds.
   ========================================================================== */

(function () {
  "use strict";

  const D = window.JarvisDayPlanLogic;
  const HL = window.JarvisHabitLogic;

  const UNDO_MS = 8000;

  let ui = null;        // the open form: { mode: "add" | "edit" | "schedule", hour, id, text, time, error }
  let undo = null;      // { fn, timer }
  let renderedHour = -1, renderedToday = "";

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function habits() { return window.JarvisHabits; }
  function esc(s) { return core().escapeHtml(s); }
  function tasks() { return habits().getTasks(); }
  function today() { return core().todayISODate(); }
  function date() { return habits().getSelectedDate() || today(); }
  function panelActive() { const p = $("habits-plan"); return !!(p && p.classList.contains("active") && p.offsetParent !== null); }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function announce(text) { const el = $("dpLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }
  function focusSoon(sel) { window.setTimeout(function () { const el = document.querySelector(sel); if (el) el.focus(); }, 0); }
  function commit(list) { habits().commitTasks(list); }

  /* ---------------- wording ---------------- */

  function dayTitle(d) {
    const t = today();
    if (d === t) return "Today";
    if (d === HL.addDays(t, -1)) return "Yesterday";
    if (d === HL.addDays(t, 1)) return "Tomorrow";
    return HL.parseISO(d).toLocaleDateString("en-US", { weekday: "long" });
  }
  function dayLine(d) {
    const t = today();
    const relative = d === t || d === HL.addDays(t, -1) || d === HL.addDays(t, 1);
    return HL.parseISO(d).toLocaleDateString("en-US", relative ? { weekday: "long", month: "short", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" });
  }
  function summaryText(list, d) {
    const s = D.summary(list, d);
    if (!s.total) return "Nothing planned for this day yet. Tap Add in any hour to plan it.";
    const parts = [];
    if (s.planned) parts.push(s.plannedDone + " of " + s.planned + " planned done");
    else parts.push("Nothing is on the plan yet");
    if (s.unscheduled) parts.push(s.unscheduled + " not scheduled yet");
    return parts.join(" · ");
  }

  /* ---------------- drawing ---------------- */

  function formHtml(f) {
    const isEdit = f.mode === "edit", isSchedule = f.mode === "schedule";
    return (
      '<form class="dp-form" data-dp-form novalidate>' +
        (isSchedule ? "" :
          '<div class="dp-field"><label for="dpText">' + (isEdit ? "What" : "What are you planning?") + '</label>' +
          '<input type="text" id="dpText" maxlength="' + D.TEXT_MAX + '" autocomplete="off" value="' + esc(f.text) + '" placeholder="e.g. Run, study, call Sam"></div>') +
        '<div class="dp-field"><label for="dpTime">Starts at</label><input type="time" id="dpTime" value="' + esc(f.time) + '"></div>' +
        '<p class="dp-error" id="dpError" role="alert">' + esc(f.error || "") + '</p>' +
        '<div class="dp-form-actions">' +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? "Save" : isSchedule ? "Put on the plan" : "Add") + '</button>' +
          '<button type="button" class="btn btn-secondary" data-dp="cancel">Cancel</button>' +
        '</div>' +
        (isEdit ? '<div class="dp-form-actions dp-form-more"><button type="button" class="btn btn-secondary" data-dp="unschedule">Take off the plan</button><button type="button" class="btn btn-danger" data-dp="delete">Delete</button></div>' : "") +
      '</form>'
    );
  }

  function checkHtml(t) {
    return '<button type="button" class="dp-check' + (t.completed ? " done" : "") + '" data-dp="tick" data-id="' + esc(t.id) + '" aria-pressed="' + !!t.completed + '" aria-label="' + (t.completed ? "Done: " : "Mark done: ") + esc(t.text) + '">' + (t.completed ? "&#10003;" : "") + '</button>';
  }

  function itemHtml(t) {
    if (ui && ui.mode === "edit" && ui.id === t.id) return '<li class="dp-item dp-editing" data-id="' + esc(t.id) + '">' + formHtml(ui) + '</li>';
    const label = D.timeLabel(t.time);
    return (
      '<li class="dp-item' + (t.completed ? " is-done" : "") + '" data-id="' + esc(t.id) + '">' +
        checkHtml(t) +
        '<button type="button" class="dp-text" data-dp="edit" data-id="' + esc(t.id) + '" aria-label="Edit ' + esc(t.text) + ', ' + esc(label) + '">' +
          '<span class="dp-time">' + esc(label) + '</span><span class="dp-what">' + esc(t.text) + '</span>' +
        '</button>' +
      '</li>'
    );
  }

  function hourHtml(slot, nowHour) {
    const adding = ui && ui.mode === "add" && ui.hour === slot.hour;
    const editing = !!ui && ui.mode === "edit" && slot.items.some(function (t) { return t.id === ui.id; });
    const isNow = slot.hour === nowHour;
    return (
      '<section class="dp-hour' + (isNow ? " is-now" : "") + (adding || editing ? " has-form" : "") + '" id="dpHour' + slot.hour + '" aria-labelledby="dpH' + slot.hour + '" data-hour="' + slot.hour + '">' +
        '<h3 class="dp-hour-label" id="dpH' + slot.hour + '">' + esc(slot.label) + (isNow ? '<span class="dp-now">Now</span>' : "") + '</h3>' +
        '<div class="dp-hour-body">' +
          (slot.items.length ? '<ul class="dp-items">' + slot.items.map(itemHtml).join("") + '</ul>' : "") +
          (adding ? formHtml(ui) : '<button type="button" class="dp-add" data-dp="add" data-hour="' + slot.hour + '" aria-label="Add something at ' + esc(slot.label) + '">+ Add</button>') +
        '</div>' +
      '</section>'
    );
  }

  function poolHtml(list) {
    return list.map(function (t) {
      const picking = ui && ui.mode === "schedule" && ui.id === t.id;
      return (
        '<div class="dp-pool-item' + (t.completed ? " is-done" : "") + '" data-id="' + esc(t.id) + '">' +
          '<div class="dp-pool-row">' +
            checkHtml(t) +
            '<span class="dp-what">' + esc(t.text) + '</span>' +
            (picking ? "" : '<button type="button" class="btn btn-secondary dp-pick" data-dp="schedule" data-id="' + esc(t.id) + '" aria-label="Pick an hour for ' + esc(t.text) + '">Pick an hour</button>') +
          '</div>' +
          (picking ? formHtml(ui) : "") +
        '</div>'
      );
    }).join("");
  }

  // Keeps what was typed when something else makes the page draw again.
  function syncForm() {
    if (!ui) return;
    const text = $("dpText"), time = $("dpTime");
    if (text) ui.text = text.value;
    if (time) ui.time = time.value;
  }

  function render() {
    const root = $("habits-plan");
    if (!root || !habits() || !habits().getTasks) return;
    syncForm();
    const list = tasks(), d = date(), t = today(), isToday = d === t;
    const nowHour = isToday ? D.currentHour(Date.now()) : -1;
    renderedHour = nowHour; renderedToday = t;

    $("dpTitle").textContent = dayTitle(d);
    $("dpDate").textContent = dayLine(d);
    $("dpSummary").textContent = summaryText(list, d);
    const jump = $("dpToday");
    jump.classList.remove("hidden");
    jump.textContent = isToday ? "Go to now" : "Jump to today";

    const pool = D.unscheduled(list, d);
    $("dpPoolCard").classList.toggle("hidden", !pool.length);
    $("dpPool").innerHTML = poolHtml(pool);

    $("dpHours").innerHTML = D.slots(list, d).map(function (s) { return hourHtml(s, nowHour); }).join("");
  }

  function scrollToHour(h, smooth) {
    const el = $("dpHour" + h);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  }

  /* ---------------- the undo bar ---------------- */

  function hideUndo() {
    const bar = $("dpUndo");
    if (undo && undo.timer) window.clearTimeout(undo.timer);
    undo = null;
    if (bar) { bar.classList.add("hidden"); bar.innerHTML = ""; }
  }
  function showUndo(label, fn) {
    hideUndo();
    const bar = $("dpUndo");
    bar.innerHTML = '<span class="dp-undo-text">' + esc(label) + '</span><button type="button" class="btn btn-secondary" data-dp="undo">Undo</button>';
    bar.classList.remove("hidden");
    undo = { fn: fn, timer: window.setTimeout(hideUndo, UNDO_MS) };
    announce(label + " Undo is available for a few seconds.");
  }

  /* ---------------- changes ---------------- */

  function openerSelector(f) {
    if (!f) return null;
    if (f.mode === "add") return '.dp-add[data-hour="' + f.hour + '"]';
    if (f.mode === "edit") return '.dp-text[data-id="' + f.id + '"]';
    return '.dp-pick[data-id="' + f.id + '"]';
  }

  function openForm(f, focus) {
    syncForm();
    ui = f;
    render();
    focusSoon(focus);
    window.setTimeout(function () { const form = document.querySelector("#habits-plan [data-dp-form]"); if (form && form.scrollIntoView) form.scrollIntoView({ block: "nearest" }); }, 60);
  }

  function closeForm(focusOpener) {
    const sel = openerSelector(ui);
    ui = null;
    render();
    if (focusOpener && sel) focusSoon(sel);
  }

  function nextFreeHour() {
    return date() === today() ? Math.min(23, D.currentHour(Date.now()) + 1) : 9;
  }

  function tick(id) {
    const r = D.toggle(tasks(), id);
    if (!r.ok) { core().showToast(r.error); render(); return; }
    commit(r.tasks);
    render();
    focusSoon('.dp-check[data-id="' + id + '"]');
    announce((r.task.completed ? "Done: " : "Not done: ") + r.task.text + ".");
  }

  function startAdd(hour) { openForm({ mode: "add", hour: hour, text: "", time: D.timeString(hour, 0), error: "" }, "#dpText"); }
  function startEdit(id) {
    const t = tasks().filter(function (x) { return x.id === id; })[0];
    if (!t) { render(); return; }
    openForm({ mode: "edit", id: id, text: t.text, time: t.time, error: "" }, "#dpText");
  }
  function startSchedule(id) { openForm({ mode: "schedule", id: id, time: D.timeString(nextFreeHour(), 0), error: "" }, "#dpTime"); }

  function submit() {
    if (!ui) return;
    const textEl = $("dpText"), timeEl = $("dpTime");
    const text = textEl ? textEl.value : "";
    const time = D.parseTime(timeEl ? timeEl.value : "");
    const f = ui;
    f.text = text; f.time = timeEl ? timeEl.value : "";
    if (!time) { f.error = "Pick the time it starts."; render(); focusSoon("#dpTime"); announce(f.error); return; }

    let res;
    if (f.mode === "add") res = D.add(tasks(), { date: date(), text: text, hour: time.hour, minute: time.minute }, { makeId: function () { return core().uid("task"); }, now: Date.now() });
    else if (f.mode === "edit") res = D.edit(tasks(), f.id, { text: text, hour: time.hour, minute: time.minute });
    else res = D.schedule(tasks(), f.id, time.hour, time.minute);

    if (!res.ok) {
      f.error = res.error; render();
      focusSoon(/Write|Keep/.test(res.error) ? "#dpText" : "#dpTime");
      announce(res.error);
      return;
    }
    commit(res.tasks);
    const saved = res.task;
    ui = null;
    render();
    focusSoon('.dp-text[data-id="' + saved.id + '"]');
    announce((f.mode === "add" ? "Planned " : "Saved ") + saved.text + " at " + D.timeLabel(saved.time) + ".");
  }

  function unschedule() {
    if (!ui || ui.mode !== "edit") return;
    const id = ui.id;
    const cur = tasks().filter(function (x) { return x.id === id; })[0];
    if (!cur) { closeForm(false); return; }
    const was = D.parseTime(cur.time);
    const r = D.unschedule(tasks(), id);
    if (!r.ok) { core().showToast(r.error); closeForm(false); return; }
    commit(r.tasks);
    ui = null;
    render();
    focusSoon('.dp-pick[data-id="' + id + '"]');
    showUndo("Taken off the plan.", function () {
      const back = was ? D.schedule(tasks(), id, was.hour, was.minute) : { ok: false };
      if (back.ok) { commit(back.tasks); render(); focusSoon('.dp-text[data-id="' + id + '"]'); }
    });
  }

  function del() {
    if (!ui || ui.mode !== "edit") return;
    const id = ui.id;
    const r = D.remove(tasks(), id);
    if (!r.ok) { core().showToast(r.error); closeForm(false); return; }
    const removed = r.removed, index = r.index;
    const hour = D.parseTime(removed.time) ? D.parseTime(removed.time).hour : null;
    commit(r.tasks);
    ui = null;
    render();
    if (hour !== null) focusSoon('.dp-add[data-hour="' + hour + '"]');
    showUndo("Deleted “" + removed.text + "”.", function () {
      commit(D.restore(tasks(), removed, index));
      render();
      focusSoon('.dp-text[data-id="' + removed.id + '"]');
    });
  }

  function step(delta) {
    ui = null;
    habits().selectDate(HL.addDays(date(), delta));   // fires jarvis-habits-day-changed, which draws this tab again
    if (!panelActive()) render();
    announce(dayTitle(date()) + ", " + dayLine(date()) + ".");
    focusSoon(delta < 0 ? "#dpPrev" : "#dpNext");
  }

  function jump() {
    const t = today();
    if (date() !== t) { ui = null; habits().selectDate(t); if (!panelActive()) render(); }
    scrollToHour(D.currentHour(Date.now()), true);
  }

  /* ---------------- wiring ---------------- */

  function onClick(e) {
    const el = e.target.closest("[data-dp]");
    if (!el) return;
    const act = el.getAttribute("data-dp"), id = el.getAttribute("data-id");
    if (act === "tick") tick(id);
    else if (act === "add") startAdd(Number(el.getAttribute("data-hour")));
    else if (act === "edit") startEdit(id);
    else if (act === "schedule") startSchedule(id);
    else if (act === "cancel") closeForm(true);
    else if (act === "unschedule") unschedule();
    else if (act === "delete") del();
    else if (act === "undo") { const u = undo; hideUndo(); if (u) { u.fn(); announce("Undone."); } }
  }

  function onShow() {
    ui = null;
    render();
    scrollToHour(D.startHour(tasks(), date(), today(), Date.now()), false);
  }

  function init() {
    const root = $("habits-plan");
    if (!root || !habits() || !habits().getTasks) return;
    root.addEventListener("click", onClick);
    root.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape" && ui) { e.preventDefault(); closeForm(true); } });
    $("dpPrev").addEventListener("click", function () { step(-1); });
    $("dpNext").addEventListener("click", function () { step(1); });
    $("dpToday").addEventListener("click", jump);
    document.addEventListener("jarvis-habits-day-changed", function () { ui = null; if (panelActive()) render(); });
    // The "Now" marker moves on at the top of the hour.
    window.setInterval(function () {
      if (!panelActive() || document.hidden || ui) return;
      if ((date() === today() && D.currentHour(Date.now()) !== renderedHour) || today() !== renderedToday) render();
    }, 30000);
    render();
  }

  window.JarvisDayPlan = { init: init, onShow: onShow };
})();
