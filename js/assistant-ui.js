/* ==========================================================================
   JARVIS — Planning assistant (the screen).

   The rules are in assistant-logic.js; this file asks them for proposals, shows each one with the reason, and
   applies only the ones you tick when you press Apply. Saving, the Undo bar and the settings all go through the
   Calendar (window.JarvisCalendar), so the assistant can never write to the calendar any other way.

   It is a set of written rules, not an AI service: nothing is sent anywhere. The page says so.
   ========================================================================== */

(function () {
  "use strict";

  const C = window.JarvisCalendarLogic;
  const A = window.JarvisAssistantLogic;
  let st = null;   // the open sheet: { step, opener, week, review, form, error, found }

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(s); }
  function cal() { return window.JarvisCalendar && window.JarvisCalendar.commitEvents ? window.JarvisCalendar : null; }
  function habits() { return window.JarvisHabits && window.JarvisHabits.getTasks ? window.JarvisHabits : null; }
  function announce(text) { const el = $("calLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }
  // Moves focus after a redraw (the old element is gone, so focus has dropped to the page). If a field has been focused since, the
  // person has already moved on (a busy phone can run this tick late), so focus is left where it is rather than taken from them.
  function focusSoon(sel) {
    window.setTimeout(function () {
      const a = document.activeElement;
      if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
      const e = document.querySelector(sel);
      if (e) e.focus();
    }, 0);
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---------------- what the rules are given ---------------- */

  function gather(toDate) {
    const c = cal(), today = c.today(), settings = c.getSettings();
    const to = toDate && toDate > C.addDays(today, 45) ? toDate : C.addDays(today, 45);
    const items = c.itemsBetween(C.addDays(today, -A.LOOKBACK_DAYS), C.addDays(to, 1));
    const h = habits();
    return {
      c: c, today: today, settings: settings, plan: settings.plan, now: { date: today, min: c.nowMin() }, items: items,
      future: items.filter(function (i) { return (i.endDate || i.date) >= today; }),
      tasks: h ? h.getTasks() : [],
      weekFrom: C.addDays(C.startOfWeek(today, settings.weekStart), 7 * (st ? st.week : 0))
    };
  }

  /* ---------------- building a list of proposals ---------------- */

  function groupFix(g, items) {
    const r = A.fixClashes(items || g.future, { plan: g.plan, now: g.now });
    return { key: "clash", title: "Clashes", proposals: r.proposals,
      empty: r.count === 0 ? "No two things overlap in the next 45 days." : "",
      notes: r.unfixed.map(function (u) { return u.a.title + " and " + u.b.title + ": " + u.why; }) };
  }
  function groupCatch(g) {
    const r = A.catchUp({ tasks: g.tasks, items: g.items, plan: g.plan, now: g.now });
    const notes = [];
    if (r.unplaced) notes.push(plural(r.unplaced, "more task", "more tasks") + " didn't fit in the next " + A.HORIZON_DAYS + " days at " + g.plan.perDay + " a day. Raise the limit in Planning hours if you want them spread out faster.");
    if (r.older) notes.push(plural(r.older, "unfinished task is", "unfinished tasks are") + " older than " + A.LOOKBACK_DAYS + " days, so I left " + (r.older === 1 ? "it" : "them") + " alone. Decide on " + (r.older === 1 ? "it" : "those") + " in your task list.");
    return { key: "catchup", title: "Unfinished tasks", proposals: r.proposals, empty: r.total === 0 ? "Nothing unfinished from the last " + A.LOOKBACK_DAYS + " days." : "", notes: notes };
  }
  function groupFocus(g, items) {
    const r = A.focusBlocks(items || g.items, { plan: g.plan, now: g.now, weekFrom: g.weekFrom });
    const anyGoal = r.status.some(function (s) { return s.goal > 0; });
    const notes = r.unplaced.map(function (u) { return "Couldn't fit " + A.hoursLabel(u.minutes) + " of " + u.label.toLowerCase() + ": no open stretch that long in your planning hours that week."; });
    r.status.filter(function (s) { return s.goal > 0; }).forEach(function (s) { notes.push(s.label + ": " + A.hoursLabel(s.planned) + " of " + A.hoursLabel(s.goal) + " already planned."); });
    return { key: "focus", title: "Focus time · week of " + A.dayLabel(g.weekFrom), proposals: r.proposals,
      empty: !anyGoal ? "You haven't set weekly hours yet. Set how many hours a week you want for content, marketing, research and business development, and I'll plan them." : (!r.proposals.length && !r.unplaced.length ? "The hours you asked for are already planned." : ""),
      notes: notes, needsHours: !anyGoal };
  }

  function makeReview(title, groups) {
    const all = [], sel = {};
    groups.forEach(function (g) { g.proposals.forEach(function (p) { all.push(p); sel[p.id] = p.kind !== "delete"; }); });   // nothing is removed unless you tick it
    return { title: title, groups: groups, all: all, sel: sel };
  }
  function show(step, extra) { st = Object.assign(st, { step: step, error: "" }, extra || {}); draw(); }

  /* ---------------- drawing ---------------- */

  function proposalHtml(p, checked) {
    const kind = p.kind === "add" ? "Add" : p.kind === "move" ? "Move" : "Remove";
    return '<li><label class="as-prop"><input type="checkbox" data-as="pick" value="' + esc(p.id) + '"' + (checked ? " checked" : "") + '><span class="as-body"><span class="as-t"><span class="as-kind as-kind-' + p.kind + '">' + kind + '</span> ' + esc(p.title) + '</span>' +
      '<span class="as-sub">' + esc(p.detail) + '</span><span class="as-why">' + esc(p.reason) + '</span></span></label></li>';
  }
  function applyLabel() {
    const n = st.review.all.filter(function (p) { return st.review.sel[p.id]; }).length;
    return n ? "Apply " + plural(n, "change", "changes") : "Nothing ticked";
  }
  function reviewHtml() {
    const r = st.review;
    let h = '<p class="field-hint"><strong>Nothing changes until you press Apply.</strong> Untick anything you don’t want. Everything here is a suggestion made by written rules, with the reason under it.</p>';
    if (st.error) h += '<div class="cal-banner" role="alert">' + esc(st.error) + '</div>';
    r.groups.forEach(function (g) {
      h += '<section class="as-grp" aria-label="' + esc(g.title) + '"><h3 class="as-h">' + esc(g.title) + (g.proposals.length ? ' <span class="as-n">' + g.proposals.length + '</span>' : '') + '</h3>';
      if (g.proposals.length) h += '<ul class="as-props">' + g.proposals.map(function (p) { return proposalHtml(p, r.sel[p.id]); }).join("") + '</ul>';
      else if (g.empty) h += '<p class="field-hint">' + esc(g.empty) + '</p>';
      if (g.needsHours) h += '<button type="button" class="btn btn-secondary" data-as="hours">Set my weekly hours</button>';
      g.notes.forEach(function (n) { h += '<p class="as-note">' + esc(n) + '</p>'; });
      h += '</section>';
    });
    const anything = r.all.length > 0;
    h += '<div class="cal-actions">' + (anything ? '<button type="submit" class="btn btn-primary" id="asApply">' + esc(applyLabel()) + '</button>' : '') + '<button type="button" class="btn btn-secondary" data-as="home">' + (anything ? "Back" : "Back to the assistant") + '</button></div>';
    return h;
  }

  function homeHtml() {
    const g = gather(), over = A.overview(g.future, { tasks: g.tasks, plan: g.plan, now: g.now, weekFrom: g.weekFrom });
    const planned = A.clearPlanned(g.items, { now: g.now }).proposals.length;
    const hoursLine = C.timeLabel(g.plan.start) + " – " + C.timeLabel(g.plan.end) + ", " + g.plan.days.map(function (d) { return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]; }).join(" ");
    let h = '<p class="field-hint">Built-in rules, not an AI service: nothing is sent anywhere and it costs nothing. I only suggest. <strong>Nothing in your calendar changes until you look at the list and press Apply.</strong></p>';
    h += '<ul class="as-stats" aria-label="Right now">' +
      '<li><strong>' + over.clashes + '</strong> ' + (over.clashes === 1 ? "clash" : "clashes") + ' ahead</li>' +
      '<li><strong>' + over.late + '</strong> unfinished from before</li>' +
      (over.focus.length ? over.focus.map(function (f) { return '<li>' + esc(f.label) + ' <strong>' + A.hoursLabel(f.planned) + '</strong> of ' + A.hoursLabel(f.goal) + '</li>'; }).join("") : '<li>No weekly focus hours set</li>') + '</ul>';
    h += '<div class="as-week" role="group" aria-label="Plan focus time for"><span class="cal-lab">Focus time for</span>' +
      ['This week', 'Next week'].map(function (t, i) { return '<button type="button" class="cal-chip-btn" data-as="week" data-v="' + i + '" aria-pressed="' + (st.week === i) + '">' + t + '</button>'; }).join("") + '</div>';
    h += '<button type="button" class="btn btn-primary as-main" data-as="plan-week">Plan my week</button><p class="field-hint">Fixes clashes, catches up unfinished tasks and adds your focus time, all in one list for you to review.</p>';
    h += '<ul class="as-opts">' + [
      ["find", "Find a time", "The earliest openings for something that takes a set time"],
      ["fix", "Fix clashes", plural(over.clashes, "overlap", "overlaps") + " in the next 45 days"],
      ["catch", "Catch up on unfinished tasks", plural(over.late, "task", "tasks") + " from the last " + A.LOOKBACK_DAYS + " days"],
      ["focus", "Plan focus time", over.anyGoal ? "Toward your weekly hours" : "Set your weekly hours first"],
      ["split", "Split a project", "Cut a big job into work sessions before its deadline"],
      ["clear", "Take back what I planned", planned ? plural(planned, "block", "blocks") + " still ahead" : "Nothing planned ahead"],
      ["hours", "Planning hours and weekly goals", hoursLine]
    ].map(function (o) { return '<li><button type="button" class="as-opt" data-as="' + o[0] + '"><span class="as-opt-t">' + esc(o[1]) + '</span><span class="as-opt-s">' + esc(o[2]) + '</span></button></li>'; }).join("") + '</ul>';
    h += '<div class="cal-actions"><button type="button" class="btn btn-secondary" data-as="close">Close</button></div>';
    return h;
  }

  function opt(list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join(""); }
  const LENGTHS = [[15, "15 minutes"], [30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"], [480, "8 hours"]];

  function timeHtml() {
    const f = st.form;
    let h = '<p class="field-hint">I’ll look inside your planning hours (' + esc(C.timeLabel(st.plan.start) + " – " + C.timeLabel(st.plan.end)) + ') and skip anything already on your calendar. Change them under Planning hours.</p>';
    if (st.error) h += '<div class="cal-banner" role="alert">' + esc(st.error) + '</div>';
    h += '<div class="cal-row"><div class="cal-field"><label for="as_len">It takes</label><select id="as_len">' + opt(LENGTHS, f.minutes) + '</select></div>' +
      '<div class="cal-field"><label for="as_span">Look in the next</label><select id="as_span">' + opt([[7, "7 days"], [14, "14 days"], [30, "30 days"]], f.span) + '</select></div></div>';
    h += '<div class="cal-actions"><button type="submit" class="btn btn-primary">Find times</button><button type="button" class="btn btn-secondary" data-as="home">Back</button></div>';
    if (st.found) {
      h += '<section class="as-grp" aria-label="Openings"><h3 class="as-h">Openings</h3>';
      if (st.found.length) h += '<ul class="as-props">' + st.found.map(function (s, i) {
        return '<li class="as-slot"><span class="as-body"><span class="as-t">' + esc(s.label) + '</span><span class="as-why">' + esc(s.reason) + '</span></span><button type="button" class="btn btn-secondary" data-as="use" data-i="' + i + '">Use this time</button></li>';
      }).join("") + '</ul><p class="field-hint">“Use this time” opens a new event with that time filled in. It isn’t saved until you save it.</p>';
      else h += '<p class="field-hint">No opening that long in the next ' + st.form.span + ' days inside your planning hours. Look further ahead, or widen the hours under Planning hours.</p>';
      h += '</section>';
    }
    return h;
  }

  function splitHtml() {
    const f = st.form;
    let h = '<p class="field-hint">Tell me the job, how much work it is and when it’s due. I’ll cut it into even work sessions on days that have room, spaced out so the last one lands before the deadline.</p>';
    if (st.error) h += '<div class="cal-banner" role="alert">' + esc(st.error) + '</div>';
    h += '<div class="cal-field"><label for="as_name">Project</label><input type="text" id="as_name" maxlength="100" value="' + esc(f.name) + '" autocomplete="off"></div>';
    h += '<div class="cal-row"><div class="cal-field"><label for="as_hours">How much work (hours)</label><input type="number" id="as_hours" min="0.5" max="80" step="0.5" inputmode="decimal" value="' + esc(f.hours) + '"></div>' +
      '<div class="cal-field"><label for="as_deadline">Due</label><input type="date" id="as_deadline" value="' + esc(f.deadline) + '"></div></div>';
    h += '<div class="cal-row"><div class="cal-field"><label for="as_session">Longest session</label><select id="as_session">' + opt([[30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"]], f.session) + '</select></div>' +
      '<div class="cal-field"><label for="as_cat">Show it as</label><select id="as_cat">' + opt(C.CATEGORIES.map(function (c) { return [c.value, c.label]; }), f.category) + '</select></div></div>';
    h += '<div class="cal-actions"><button type="submit" class="btn btn-primary">Suggest sessions</button><button type="button" class="btn btn-secondary" data-as="home">Back</button></div>';
    return h;
  }

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function hoursHtml() {
    const f = st.form;
    let h = '<p class="field-hint">These are starting values for you to change, not things I know about you. I plan only inside these hours and days, in your calendar’s time zone (' + esc(cal().zone()) + ').</p>';
    if (st.error) h += '<div class="cal-banner" role="alert">' + esc(st.error) + '</div>';
    h += '<div class="cal-row"><div class="cal-field"><label for="as_start">Plan from</label><input type="time" id="as_start" step="900" value="' + esc(f.start) + '"></div><div class="cal-field"><label for="as_end">Until</label><input type="time" id="as_end" step="900" value="' + esc(f.end) + '"></div></div>';
    h += '<div class="cal-field" role="group" aria-labelledby="as_days_l"><span class="cal-lab" id="as_days_l">Days I may plan on</span><div class="as-days">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<button type="button" class="cal-chip-btn" data-as="day" data-v="' + d + '" aria-pressed="' + (f.days.indexOf(d) !== -1) + '">' + DAYS[d] + '</button>'; }).join("") + '</div></div>';
    h += '<div class="cal-row"><div class="cal-field"><label for="as_sess">Longest work session</label><select id="as_sess">' + opt([[30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"], [150, "2.5 hours"], [180, "3 hours"], [240, "4 hours"]], f.session) + '</select></div>' +
      '<div class="cal-field"><label for="as_per">Tasks a day when catching up</label><select id="as_per">' + opt([1, 2, 3, 4, 5, 6, 8, 10, 12].map(function (n) { return [n, String(n)]; }), f.perDay) + '</select></div></div>';
    h += '<fieldset class="cc-pick"><legend>Hours a week I want for each (0 = don’t plan it)</legend>' + C.FOCUS_AREAS.map(function (a) {
      return '<div class="as-goal"><label for="as_g_' + a.id + '">' + esc(a.label) + '</label><input type="number" id="as_g_' + a.id + '" min="0" max="40" step="0.25" inputmode="decimal" value="' + esc(f.goals[a.id]) + '"></div>';
    }).join("") + '</fieldset>';
    h += '<div class="cal-actions"><button type="submit" class="btn btn-primary">Save</button><button type="button" class="btn btn-secondary" data-as="home">Cancel</button></div>';
    return h;
  }

  function draw() {
    const body = $("asBody"), title = $("asTitle");
    const titles = { home: "Planning assistant", time: "Find a time", split: "Split a project", hours: "Planning hours and weekly goals", review: st.review ? st.review.title : "Review" };
    title.textContent = titles[st.step] || "Planning assistant";
    body.innerHTML = st.step === "home" ? homeHtml() : st.step === "time" ? timeHtml() : st.step === "split" ? splitHtml() : st.step === "hours" ? hoursHtml() : reviewHtml();
    $("asModal").classList.remove("hidden");
    const first = st.step === "review" ? "#asBody input[type=checkbox], #asBody .btn" : st.step === "home" ? "#asBody .as-main" : "#asBody input, #asBody select";
    focusSoon(first);
  }

  /* ---------------- opening and closing ---------------- */

  function open(opener) {
    if (!cal() || !A) return;
    st = { step: "home", opener: opener || document.activeElement, week: 0, review: null, form: null, error: "", found: null, plan: cal().getSettings().plan };
    draw();
  }
  function close(focusOpener) {
    const s = st; st = null;
    $("asModal").classList.add("hidden"); $("asBody").innerHTML = "";
    if (focusOpener !== false && s && s.opener && s.opener.focus && document.contains(s.opener)) s.opener.focus();
  }

  /* ---------------- the actions ---------------- */

  function planWeek() {
    const g = gather(), fix = groupFix(g);
    // Each suggestion is made around the earlier ones: the focus blocks work around the clash moves as if they had happened.
    const focus = groupFocus(g, A.preview(g.items, fix.proposals, g.c.zone()));
    st.review = makeReview("Your week", [fix, groupCatch(g), focus]);
    show("review");
  }
  function onlyGroup(title, build) { const g = gather(); st.review = makeReview(title, [build(g)]); show("review"); }

  function startTime() {
    st.form = { minutes: 60, span: 14 }; st.found = null; st.plan = cal().getSettings().plan; show("time");
  }
  function runTime() {
    const g = gather(), minutes = Number($("as_len").value), span = Number($("as_span").value);
    st.form = { minutes: minutes, span: span };
    const r = A.suggestTimes(g.items, { minutes: minutes, from: g.today, to: C.addDays(g.today, span), plan: g.plan, now: g.now });
    st.plan = g.plan;
    if (!r.ok) { st.error = r.error; st.found = null; draw(); return; }
    st.error = ""; st.found = r.slots; draw(); focusSoon("#asBody .as-slot .btn");
    announce(r.slots.length ? plural(r.slots.length, "opening", "openings") + " found." : "No openings found.");
  }
  function useTime(i) {
    const s = st.found && st.found[i]; if (!s) return;
    const c = cal(); close(false);
    c.openNew({ date: s.date, time: C.timeOf(s.start), form: { endDate: s.date, endTime: C.timeOf(s.end) } });
  }

  function startSplit() {
    const g = gather();
    st.form = { name: "", hours: "4", deadline: C.addDays(g.today, 14), session: g.plan.session, category: "work" }; show("split");
  }
  function runSplit() {
    const f = { name: $("as_name").value, hours: $("as_hours").value, deadline: $("as_deadline").value, session: Number($("as_session").value), category: $("as_cat").value };
    st.form = f;
    const hours = Number(f.hours), minutes = Math.round(hours * 60 / 15) * 15;
    if (!Number.isFinite(hours)) { st.error = "Say how much work it is, in hours."; draw(); return; }
    const g = gather(C.isDate(f.deadline) ? f.deadline : "");
    const r = A.splitProject(g.items, { title: f.name, minutes: minutes, deadline: f.deadline, session: f.session, category: f.category, plan: g.plan, now: g.now });
    if (!r.ok) { st.error = r.error; draw(); return; }
    const notes = [];
    if (r.unplacedMinutes > 0) notes.push("Only " + A.hoursLabel(minutes - r.unplacedMinutes) + " of " + A.hoursLabel(minutes) + " fit before " + A.dayLabel(f.deadline) + " inside your planning hours. Move the deadline, widen the hours, or add the rest yourself.");
    st.review = makeReview("Split “" + f.name.trim().slice(0, 40) + "”", [{ key: "project", title: plural(r.proposals.length, "work session", "work sessions"), proposals: r.proposals, empty: "No day before " + A.dayLabel(f.deadline) + " has room inside your planning hours.", notes: notes }]);
    show("review");
  }

  function startHours() {
    const p = cal().getSettings().plan, goals = {};
    C.FOCUS_AREAS.forEach(function (a) { goals[a.id] = p.goals[a.id] ? String(p.goals[a.id] / 60) : "0"; });
    st.form = { start: p.start, end: p.end, days: p.days.slice(), session: p.session, perDay: p.perDay, goals: goals }; show("hours");
  }
  function readHours() {
    const f = st.form, v = function (id) { const e = $(id); return e ? e.value : undefined; };
    f.start = v("as_start") || f.start; f.end = v("as_end") || f.end; f.session = Number(v("as_sess")) || f.session; f.perDay = Number(v("as_per")) || f.perDay;
    C.FOCUS_AREAS.forEach(function (a) { const x = v("as_g_" + a.id); if (x !== undefined) f.goals[a.id] = x; });
  }
  function saveHours() {
    readHours();
    const f = st.form, goals = {};
    if (!C.isTime(f.start) || !C.isTime(f.end)) { st.error = "Pick a start and an end time."; draw(); return; }
    if (C.minutesOf(f.end) - C.minutesOf(f.start) < 60) { st.error = "Leave at least an hour between the start and the end."; draw(); return; }
    if (!f.days.length) { st.error = "Pick at least one day."; draw(); return; }
    for (let i = 0; i < C.FOCUS_AREAS.length; i++) {
      const a = C.FOCUS_AREAS[i], hrs = Number(f.goals[a.id]);
      if (!Number.isFinite(hrs) || hrs < 0 || hrs > 40) { st.error = a.label + ": enter hours from 0 to 40."; draw(); return; }
      goals[a.id] = Math.round(hrs * 60 / 15) * 15;
    }
    const c = cal(), plan = C.planSettings({ start: f.start, end: f.end, days: f.days, session: f.session, perDay: f.perDay, goals: goals });
    if (!c.saveSettings(C.settings(Object.assign({}, c.getSettings(), { plan: plan, updatedAt: Date.now() })))) { st.error = "The browser would not save your settings."; draw(); return; }
    announce("Planning hours saved.");
    show("home");
  }

  /* ---------------- applying what you approved ---------------- */

  function applyChosen() {
    const r = st.review, ids = r.all.filter(function (p) { return r.sel[p.id]; }).map(function (p) { return p.id; });
    if (!ids.length) { st.error = "Tick at least one change, or go back."; draw(); return; }
    const c = cal(), h = habits(), prev = c.getEvents(), prevTasks = h ? h.getTasks() : [];
    const ev = A.apply(prev, r.all, ids, c.ctx());
    const tk = h ? A.applyTasks(prevTasks, r.all, ids) : { tasks: prevTasks, applied: [], skipped: [], changed: false };
    if (ev.changed && !c.commitEvents(ev.events)) { st.error = "The browser would not save the calendar, so nothing was changed."; draw(); return; }
    if (tk.changed) h.commitTasks(tk.tasks);
    const movedTasks = A.select(r.all, tk.applied).map(function (p) { return { id: p.move.id, from: p.move.from.date, to: p.move.to.date }; });
    const applied = ev.applied.length + tk.applied.length, skipped = ev.skipped.concat(tk.skipped);
    close(false);
    const label = applied ? "Applied " + plural(applied, "change", "changes") + (skipped.length ? "; skipped " + skipped.length : "") + "." : "Nothing was changed.";
    if (applied) {
      c.undoable(label, prev, ev.events, function () {
        if (movedTasks.length && h) h.commitTasks(h.getTasks().map(function (t) { const m = movedTasks.filter(function (x) { return x.id === t.id && x.to === t.date; })[0]; return m ? Object.assign({}, t, { date: m.from }) : t; }));
      });
    }
    c.refresh();
    if (skipped.length) core().showToast("Skipped " + skipped.length + ": " + skipped[0].error + (skipped.length > 1 ? " (and " + (skipped.length - 1) + " more)" : ""));
    announce(label);
  }

  /* ---------------- events ---------------- */

  function onClick(e) {
    if (!st) return;
    if (e.target === $("asModal")) { close(); return; }
    const el = e.target.closest("[data-as]"); if (!el) return;
    const a = el.getAttribute("data-as");
    if (a === "close") close();
    else if (a === "home") show("home");
    else if (a === "week") { st.week = Number(el.getAttribute("data-v")); draw(); focusSoon('#asBody [data-as="week"][data-v="' + st.week + '"]'); }
    else if (a === "plan-week") planWeek();
    else if (a === "fix") onlyGroup("Clashes", function (g) { return groupFix(g); });
    else if (a === "catch") onlyGroup("Unfinished tasks", groupCatch);
    else if (a === "focus") onlyGroup("Focus time", function (g) { return groupFocus(g); });
    else if (a === "clear") onlyGroup("What I planned", function (g) { const r = A.clearPlanned(g.items, { now: g.now }); return { key: "clear", title: "Blocks I planned that are still ahead", proposals: r.proposals, empty: "Nothing I planned is still ahead of you.", notes: r.proposals.length ? ["These start unticked: nothing is removed unless you tick it."] : [] }; });
    else if (a === "find") startTime();
    else if (a === "split") startSplit();
    else if (a === "hours") startHours();
    else if (a === "use") useTime(Number(el.getAttribute("data-i")));
    else if (a === "day") {
      readHours(); const d = Number(el.getAttribute("data-v")), days = st.form.days, i = days.indexOf(d);
      if (i === -1) days.push(d); else days.splice(i, 1);
      st.form.days = days.sort(function (x, y) { return x - y; }); draw(); focusSoon('#asBody [data-as="day"][data-v="' + d + '"]');
    }
  }
  function onChange(e) {
    if (!st || st.step !== "review" || !e.target.matches('[data-as="pick"]')) return;
    st.review.sel[e.target.value] = e.target.checked;
    const b = $("asApply"); if (b) b.textContent = applyLabel();   // stays pressable: with nothing ticked, pressing it explains instead of doing nothing
  }
  function onSubmit(e) {
    e.preventDefault();
    if (!st) return;
    if (st.step === "review") applyChosen();
    else if (st.step === "time") runTime();
    else if (st.step === "split") runSplit();
    else if (st.step === "hours") saveHours();
  }
  function onKey(e) { if (st && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }

  function init() {
    const btn = $("calAssist"), modal = $("asModal");
    if (!btn || !modal || !C || !A) { if (btn) btn.classList.add("hidden"); return; }
    btn.addEventListener("click", function () { open(btn); });
    modal.addEventListener("click", onClick);
    $("asBody").addEventListener("change", onChange);
    $("asBody").addEventListener("submit", onSubmit);
    document.addEventListener("keydown", onKey, true);
  }

  window.JarvisAssistant = { init: init, open: open };
})();
