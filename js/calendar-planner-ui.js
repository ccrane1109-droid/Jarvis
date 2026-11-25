/* ==========================================================================
   JARVIS — Calendar › Day: the daily planner (the screen).

   One connected planning system: this file owns almost no data. What is on a day comes from what already exists (calendar events,
   your tasks in the To-Do list, the plan's time blocks, goal dates); the Calendar (calendar-ui.js) hands it to this file and draws
   the rest. The only thing saved here is one small record per day (jarvisPlanDays: the top three, notes, a reflection), through
   the plan's storage, so it is backed up with everything else. The rules are in day-planner-logic.js.

   What this file draws:
     the Daily plan (Top 3, tasks still to schedule, notes, an end-of-day reflection), a timeline in time order with the free time
     between things, the Add menu (task, event or time block), and the task form.

   Nothing is reported as done unless it was saved. A box you are typing in is saved when you leave it, when you press Enter, and
   when the page is hidden, so nothing typed is lost.
   ========================================================================== */

(function () {
  "use strict";

  const D = window.JarvisDayPlannerLogic, CL = window.JarvisCalendarLogic, PL = window.JarvisPlanLogic, W = window.JarvisPlanWeekLogic, HPl = window.JarvisHabitPlan;
  const UI_KEY = "jarvisCalPlannerUi", SAVE_MS = 600, SHOW_TASKS = 5;
  const LENGTHS = [[0, "Just a time (no block)"], [15, "15 minutes"], [30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"], [90, "1 hour 30 minutes"], [120, "2 hours"], [180, "3 hours"]];

  let host = null;            // what the Calendar gives this file: see attach()
  let pending = null;         // a note being typed: { type, date, index, text, timer }
  let selfWrite = 0;          // set while this file saves the day's record, so its own save does not redraw the page under the cursor
  let ui = readUi();

  function esc(s) { return window.JarvisCore.escapeHtml(s); }
  function app() { return window.JarvisPlanApp || null; }
  function habits() { return window.JarvisHabits && window.JarvisHabits.getTasks ? window.JarvisHabits : null; }
  function store() { const P = window.JarvisPlanStore; if (P && P.init) P.init(); return P || null; }
  function isPhone() { return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches); }
  function say(text) { if (host && host.say) host.say(text); }
  function tell(text, label, fn) { if (host && host.notice) host.notice(text, label || "", fn); }
  function label(t) { return CL.timeLabel(t); }
  function toTime(min) { return W.toTime(Math.max(0, Math.min(1439, min))); }
  function readUi() {
    try { const v = JSON.parse(window.localStorage.getItem(UI_KEY) || "null"); if (v && typeof v === "object") return { plan: v.plan === "open" || v.plan === "closed" ? v.plan : "", habits: !!v.habits, ref: !!v.ref, allTasks: false, showHabits: v.showHabits !== false }; } catch (e) { /* no saved choice */ }
    return { plan: "", habits: false, ref: false, allTasks: false, showHabits: true };
  }
  function saveUi() { try { window.localStorage.setItem(UI_KEY, JSON.stringify({ plan: ui.plan, habits: ui.habits, ref: ui.ref, showHabits: ui.showHabits })); } catch (e) { /* the choice is only for this visit */ } }
  // The Daily plan is open by default on a wide screen and folded on a phone, so the schedule is the first thing there.
  function planOpen() { return ui.plan ? ui.plan === "open" : !isPhone(); }

  /* ---------------- saving the day's record ---------------- */

  // quiet: saved while a box is being typed in, so the page is not drawn again under the cursor.
  function saveDay(date, change, quiet) {
    const S = store();
    if (!S) return { ok: false, error: "The plan can't be saved here." };
    const r = D.update(S.all("days"), date, change, { now: Date.now() });
    if (!r.ok) return r;
    selfWrite++;
    let saved = false;
    try { saved = S.replace("days", r.records); } finally { selfWrite--; }
    if (!saved) return { ok: false, error: "The browser would not save that." };
    if (host) { if (quiet && host.notify) host.notify(); else if (host.changed) host.changed(); }
    return r;
  }
  function flush() {
    if (!pending) return;
    const p = pending; pending = null;
    window.clearTimeout(p.timer);
    const r = saveDay(p.date, { type: p.type, text: p.text }, true);
    if (!r.ok) tell(r.error || "That couldn't be saved.", "");
  }
  function typed(type, date, text) {
    if (pending && (pending.type !== type || pending.date !== date)) flush();
    if (pending) window.clearTimeout(pending.timer);
    pending = { type: type, date: date, text: text };
    pending.timer = window.setTimeout(flush, SAVE_MS);
  }

  /* ---------------- the timeline ---------------- */

  function dayWindow() {
    const S = store();
    try { const w = W.winOf(S ? S.settings() : null); if (w && w.end > w.start) return { start: w.start, end: w.end }; } catch (e) { /* the default window is used */ }
    return { start: 360, end: 1320 };
  }
  function freeRowHtml(r, past) {
    if (past) return "";
    const t0 = toTime(r.start), t1 = toTime(r.end);
    return '<div class="cdp-free"><button type="button" class="cdp-free-btn" data-cdp="free" data-start="' + t0 + '" data-end="' + t1 + '" aria-label="' + esc("Free " + label(t0) + " to " + label(t1) + ", " + D.hm(r.minutes) + ". Plan something here") + '">' +
      '<span class="cdp-free-time">' + esc(label(t0)) + '<small>' + esc(label(t1)) + '</small></span><span class="cdp-free-bar" aria-hidden="true"></span>' +
      '<span class="cdp-free-main"><span>Free · ' + esc(D.hm(r.minutes)) + '</span><em>+ Plan</em></span></button></div>';
  }
  function nowRowHtml() { return '<div class="cdp-now" role="separator" aria-label="Now"><span>Now</span></div>'; }

  function timelineHtml(date, tl) {
    const t = host.today(), past = date < t, isToday = date === t, nowMin = host.nowMin();
    const rows = tl.rows.filter(function (r) { return !(r.type === "free" && past); });
    let out = "", markedNow = !isToday;
    rows.forEach(function (r) {
      if (!markedNow && r.end > nowMin && (r.type === "free" || !r.point || r.start >= nowMin)) {
        // the row that is on now (or comes next): a line above it, unless it is happening right now
        if (r.start > nowMin) out += nowRowHtml();
        markedNow = true;
      }
      out += r.type === "free" ? freeRowHtml(r, past) : host.rowHtml(r.item);
    });
    if (!markedNow) out += nowRowHtml();
    return out;
  }

  // Taps and typing belong to the day drawn around them (the Day screen, or the selected day in Week); the Day screen's day otherwise.
  function dateOf(el) { const r = el && el.closest ? el.closest("[data-date]") : null; return r && r.getAttribute("data-date") ? r.getAttribute("data-date") : host.date(); }

  /* ---------------- from Strategy: this week's focus, as an optional reference ---------------- */

  // What the weekly plan says for the week of `date`: its top three and the Weekly Intentions. Read only: they are changed in Strategy.
  function reference(date) {
    const S = store(); if (!S) return null;
    const ws = W.mondayOf(date), h = habits(), tasks = h ? h.getTasks() : [];
    const wk = W.weekOf(S.all("weeks"), ws), top = (wk ? W.readWeek(wk).top : []).map(function (x) {
      const t = x.taskId ? tasks.filter(function (k) { return k.id === x.taskId; })[0] : null;
      return { text: t ? t.text : x.text, done: !!(t && t.completed) };
    }).filter(function (x) { return x.text; });
    const I = window.JarvisIntentionsLogic;
    let doItems = [], stopItems = [];
    try { if (I) { const v = I.view(S.all("intentions"), ws, host.today()); doItems = v.doItems.filter(function (x) { return x.text; }); stopItems = v.stopItems.filter(function (x) { return x.text; }); } } catch (e) { /* intentions are optional */ }
    return top.length || doItems.length || stopItems.length ? { top: top, doItems: doItems, stopItems: stopItems } : null;
  }
  function refHtml(date) {
    const r = reference(date);
    if (!r) return "";
    const n = r.top.length + r.doItems.length + r.stopItems.length;
    let html = '<div class="cdp-sec cdp-ref"><button type="button" class="cdp-ref-h" data-cdp="ref-toggle" aria-expanded="' + ui.ref + '"><span>From your weekly plan</span><span class="cdp-plan-sum">' + n + (n === 1 ? " item" : " items") + ' \u00b7 optional</span><span class="cdp-chev" aria-hidden="true"></span></button>';
    if (ui.ref) {
      const list = function (title, arr, fn) { return arr.length ? '<h4 class="cdp-ref-t">' + title + '</h4><ul class="cdp-ref-list">' + arr.map(fn).join("") + '</ul>' : ""; };
      html += '<div class="cdp-ref-body">' + list("Top three this week", r.top, function (x) { return '<li class="' + (x.done ? "is-done" : "") + '">' + (x.done ? "&#10003; " : "") + esc(x.text) + '</li>'; }) +
        list("Things to do this week", r.doItems, function (x) { return '<li class="' + (x.done ? "is-done" : "") + '">' + (x.done ? "&#10003; " : "") + esc(x.text) + '</li>'; }) +
        list("Things to stop doing", r.stopItems, function (x) { return '<li>' + esc(x.text) + '</li>'; }) +
        '<button type="button" class="cal-more" data-cdp="open-strategy">Change these in Strategy</button></div>';
    }
    return html + '</div>';
  }
  function openStrategy() {
    const b = document.getElementById("navBtnStrategy"); if (b) b.click();
    window.setTimeout(function () { if (window.JarvisPlan && window.JarvisPlan.go) window.JarvisPlan.go("weekly"); }, 0);
  }

  /* ---------------- Daily plan ---------------- */

  function tickHtml(done, text, attrs) {
    return '<button type="button" class="cal-tick' + (done ? " done" : "") + '" ' + attrs + ' aria-pressed="' + !!done + '" aria-label="' + (done ? "Done: " : "Mark done: ") + esc(text) + '">' + (done ? "&#10003;" : "") + '</button>';
  }
  function topHtml(date, top) {
    return '<ol class="cdp-top">' + top.map(function (s) {
      const n = s.index + 1;
      if (s.empty) {
        return '<li class="cdp-slot"><span class="cdp-n" aria-hidden="true">' + n + '</span>' +
          '<input type="text" class="cdp-slot-input" data-top="' + s.index + '" maxlength="' + D.TEXT_MAX + '" placeholder="' + (n === 1 ? "Most important thing today" : n === 2 ? "Second priority" : "Third priority") + '" aria-label="Top priority ' + n + '" autocomplete="off">' +
          '<button type="button" class="cdp-pick" data-cdp="top-pick" data-i="' + s.index + '" aria-label="Choose one of today’s tasks for priority ' + n + '">Pick</button></li>';
      }
      return '<li class="cdp-slot' + (s.done ? " is-done" : "") + '"><span class="cdp-n" aria-hidden="true">' + n + '</span>' +
        (s.linked ? tickHtml(s.done, s.text, 'data-cdp="top-tick" data-i="' + s.index + '"') : '<span class="cdp-nolink" aria-hidden="true"></span>') +
        '<button type="button" class="cdp-slot-text" data-cdp="top-open" data-i="' + s.index + '">' + esc(s.text) + (s.taskId && !s.linked ? ' <small>(task removed)</small>' : "") + '</button>' +
        '<button type="button" class="cdp-x" data-cdp="top-clear" data-i="' + s.index + '" aria-label="' + esc("Remove from the top three: " + s.text) + '">&times;</button></li>';
    }).join("") + '</ol>';
  }
  function unschedHtml(date, list) {
    if (!list.length) return '<p class="cdp-none">Nothing is waiting for a time.</p>';
    const shown = ui.allTasks ? list : list.slice(0, SHOW_TASKS);
    return '<ul class="cdp-unsched">' + shown.map(function (t) {
      return '<li class="cdp-us' + (t.completed ? " is-done" : "") + '">' + tickHtml(t.completed, t.text, 'data-cdp="task-tick" data-id="' + esc(t.id) + '"') +
        '<button type="button" class="cdp-us-title" data-cdp="task-open" data-id="' + esc(t.id) + '">' + esc(t.text) + (t.priority === "high" ? ' <small>High</small>' : "") + '</button>' +
        (t.completed ? "" : '<button type="button" class="btn btn-secondary cdp-sched" data-cdp="schedule" data-id="' + esc(t.id) + '" aria-label="' + esc("Give a time to: " + t.text) + '">Schedule</button>') + '</li>';
    }).join("") + '</ul>' + (list.length > SHOW_TASKS ? '<button type="button" class="cal-more" data-cdp="all-tasks" aria-expanded="' + ui.allTasks + '">' + (ui.allTasks ? "Show fewer" : "Show all " + list.length) + '</button>' : "");
  }
  // The next steps of your goals that are not on this day yet, each with a button that puts it on the day.
  function goalStepsHtml(date) {
    const G = window.JarvisGoals;
    if (!G || !G.stepsForDay || date < host.today()) return "";
    const list = G.stepsForDay(date, 3);
    if (!list.length) return "";
    return '<div class="cdp-sec"><h4 class="cdp-h">From your goals</h4><ul class="cdp-gsteps">' + list.map(function (s) {
      return '<li class="cdp-gs' + (s.overdue ? " is-overdue" : "") + '"><span class="cdp-gs-main"><span class="cdp-gs-t">' + esc(s.title) + '</span><span class="cdp-gs-s">' + esc(s.goalName + (s.due ? " \u00b7 " + host.dayName(s.due, { month: "short", day: "numeric" }) : "")) + '</span></span>' +
        '<button type="button" class="btn btn-secondary cdp-sched" data-cdp="goal-step" data-key="' + esc(s.key) + '" aria-label="' + esc("Add to this day: " + s.title) + '">Add to day</button></li>';
    }).join("") + '</ul></div>';
  }
  function planSummary(top, unsched) {
    const set = top.filter(function (s) { return !s.empty; }), done = set.filter(function (s) { return s.done; }).length, open = unsched.filter(function (t) { return !t.completed; }).length;
    const a = set.length ? "Top 3: " + done + " of " + set.length + " done" : "Set your top 3";
    return a + (open ? " · " + open + " to schedule" : "");
  }
  function planHtml(date, view, tasks, unsched) {
    const top = D.topItems(view, tasks), open = planOpen(), isToday = date === host.today();
    let html = '<section class="cdp-plan' + (open ? " is-open" : "") + '" aria-labelledby="cdpPlanH"><h3 class="cdp-plan-h" id="cdpPlanH"><button type="button" class="cdp-plan-toggle" data-cdp="plan-toggle" aria-expanded="' + open + '" aria-controls="cdpPlanBody">' +
      '<span class="cdp-plan-name">Daily plan</span><span class="cdp-plan-sum">' + esc(planSummary(top, unsched)) + '</span><span class="cdp-chev" aria-hidden="true"></span></button></h3>';
    if (open) {
      html += '<div class="cdp-plan-body" id="cdpPlanBody">' +
        '<div class="cdp-sec"><h4 class="cdp-h">Top 3 ' + (isToday ? "today" : "for this day") + '</h4>' + topHtml(date, top) + '</div>' +
        '<div class="cdp-sec"><div class="cdp-h-row"><h4 class="cdp-h">Still to schedule</h4><span class="cdp-h-btns"><button type="button" class="cal-more" data-cdp="add-task">+ Add task</button><button type="button" class="cal-more" data-cdp="add-habit">+ Add habit</button></span></div>' + unschedHtml(date, unsched) + '</div>' +
        goalStepsHtml(date) +
        refHtml(date) +
        '<div class="cdp-sec"><label class="cdp-h" for="cdpNotes">Notes for the day</label><textarea id="cdpNotes" class="cdp-area" data-note="notes" rows="2" maxlength="' + D.NOTE_MAX + '" placeholder="Anything to remember today">' + esc(view.notes) + '</textarea></div>' +
        '<div class="cdp-sec"><label class="cdp-h" for="cdpRefl">End-of-day reflection</label><textarea id="cdpRefl" class="cdp-area" data-note="reflection" rows="2" maxlength="' + D.NOTE_MAX + '" placeholder="What went well? What will you change tomorrow?">' + esc(view.reflection) + '</textarea></div>' +
        '</div>';
    }
    return html + '</section>';
  }

  /* ---------------- the Day screen ---------------- */

  function habitsHtml(date) {
    const h = habits();
    if (!h || !h.getToday || date !== host.today()) return "";
    let g; try { g = h.getToday(); } catch (e) { return ""; }
    if (!g || !g.habits || !g.habits.length) return "";
    const done = g.habits.filter(function (x) { return x.done; }).length;
    return '<section class="cdp-habits"><button type="button" class="cdp-habits-h" data-cdp="habits-toggle" aria-expanded="' + ui.habits + '"><span>Habits</span><span class="cdp-plan-sum">' + done + ' of ' + g.habits.length + ' done</span><span class="cdp-chev" aria-hidden="true"></span></button>' +
      (ui.habits ? '<div class="cdp-habit-list">' + g.habits.map(function (x) {
        const tickable = !(x.target > 1);
        return '<span class="cdp-habit' + (x.done ? " is-done" : "") + '">' + (tickable ? '<button type="button" class="cdp-habit-btn" data-cdp="habit" data-id="' + esc(x.id) + '" aria-pressed="' + !!x.done + '">' + (x.done ? "&#10003; " : "") + esc(x.name) + '</button>' :
          '<span class="cdp-habit-count">' + esc(x.name) + ' ' + x.count + '/' + x.target + '</span>') + '</span>';
      }).join("") + '</div>' : "") + '</section>';
  }
  // The weekly plan's own workload rule: blocks and events in one day over your daily limit (Rest blocks don't count). -> the message, or "".
  function overbooked(date) {
    try {
      const S = store(), h = habits(), C = window.JarvisCalendar;
      if (!S || !C || !C.getEvents) return "";
      const cap = W.capacity({ weekStart: W.mondayOf(date), today: host.today(), blocks: S.all("blocks"), ingredients: S.all("ingredients"), tasks: h ? h.getTasks() : [], links: S.all("links"), settings: S.settings(), events: C.getEvents(), zone: C.zone() });
      const w = cap.warnings.filter(function (x) { return x.kind === "overbooked" && x.date === date; })[0];
      return w ? w.message : "";
    } catch (e) { return ""; }
  }
  function summaryHtml(date, tl, items) {
    const t = host.today(), past = date < t;
    const timed = tl.rows.filter(function (r) { return r.type === "item"; }).length;
    const bits = [];
    bits.push(timed + (timed === 1 ? " thing scheduled" : " things scheduled"));
    if (!past) bits.push(D.hm(tl.freeMin) === "0 min" ? "no free time" : D.hm(tl.freeMin) + " free");
    const over = overbooked(date);
    const warn = over ? ' <span class="cdp-warn">' + esc(over) + '</span>' : "";
    return '<p class="cdp-sum" role="status">' + esc(bits.join(" · ")) + warn + '</p>';
  }

  function dayHtml(date, items) {
    const S = store(), h = habits(), tasks = h ? h.getTasks() : [];
    const tl = D.timeline({ date: date, items: items, window: dayWindow(), nowMin: host.nowMin(), today: host.today() });
    const view = S ? D.view(S.all("days"), date) : D.view([], date), unsched = D.unscheduled(tasks, date);
    const allDay = tl.allDay.concat(tl.untimed).filter(function (it) { return it.source !== "task"; });
    const t = host.today();
    let html = '<div class="cdp" data-date="' + date + '">';
    html += '<div class="cdp-side">' + planHtml(date, view, tasks, unsched) + '</div>';
    html += '<div class="cdp-main">';
    html += summaryHtml(date, tl, items);
    if (allDay.length) html += '<div class="cdp-allday" role="group" aria-label="All day">' + allDay.map(host.chipHtml).join("") + '</div>';
    html += habitsNoteHtml(date);
    html += habitsHtml(date);
    const rows = timelineHtml(date, tl);
    html += rows ? '<div class="cdp-timeline" role="group" aria-label="Schedule">' + rows + '</div>' :
      '<div class="cal-empty"><p>' + (date < t ? "Nothing was scheduled." : "Nothing scheduled yet.") + '</p><button type="button" class="btn btn-primary" data-cdp="add" data-date="' + date + '">+ Add</button></div>';
    html += '</div></div>';
    return html;
  }

  /* ---------------- Week ---------------- */

  function topMiniHtml(date) {
    const S = store(), h = habits(), v = D.view(S ? S.all("days") : [], date), top = D.topItems(v, h ? h.getTasks() : []).filter(function (s) { return !s.empty; });
    if (!top.length) return '<p class="cdw-notop">No top 3 set for this day.</p>';
    return '<ol class="cdw-top" aria-label="Top 3">' + top.map(function (s) {
      return '<li class="cdw-top-i' + (s.done ? " is-done" : "") + '"><span class="cdp-n" aria-hidden="true">' + (s.index + 1) + '</span>' + (s.linked ? tickHtml(s.done, s.text, 'data-cdp="top-tick" data-i="' + s.index + '"') : "") +
        '<button type="button" class="cdp-slot-text" data-cdp="top-open" data-i="' + s.index + '">' + esc(s.text) + '</button></li>';
    }).join("") + '</ol>';
  }
  // Tasks dated that day with no time yet, under the day's top three, each with Schedule.
  function weekUnschedHtml(date) {
    const h = habits(), list = D.unscheduled(h ? h.getTasks() : [], date).filter(function (t) { return !t.completed; });
    if (!list.length) return "";
    return '<div class="cdw-unsched"><h4 class="cdp-h">Still to schedule</h4>' + unschedHtml(date, list) + '</div>';
  }
  // Week on a phone: a compact strip of the seven days; the chosen day's plan below it.
  function weekHtml(dates, items, sel) {
    const t = host.today(), win = dayWindow();
    const strip = '<div class="cdw-strip" role="group" aria-label="Choose a day">' + dates.map(function (d) {
      const n = host.dayItems(items, d).length;
      return '<button type="button" class="cdw-day' + (d === t ? " is-today" : "") + (d === sel ? " is-sel" : "") + '" data-cdp="wk-day" data-date="' + d + '" aria-pressed="' + (d === sel) + '" aria-label="' + esc(host.dayName(d, { weekday: "long", month: "long", day: "numeric" }) + ", " + n + (n === 1 ? " item" : " items")) + '">' +
        '<span class="cdw-dow">' + esc(host.dayName(d, { weekday: "short" })) + '</span><b>' + Number(d.slice(8)) + '</b><span class="cdw-n' + (n ? "" : " is-zero") + '" aria-hidden="true">' + (n || "") + '</span></button>';
    }).join("") + '</div>';
    const dayItems = host.dayItems(items, sel), tl = D.timeline({ date: sel, items: dayItems, window: win, nowMin: host.nowMin(), today: t });
    const allDay = tl.allDay.concat(tl.untimed).filter(function (it) { return it.source !== "task"; });
    const rows = timelineHtml(sel, tl);
    let html = '<div class="cdw">' + strip + '<section class="cdw-panel" data-date="' + sel + '" aria-label="' + esc(host.dayName(sel)) + '"><div class="cdw-head"><h3>' + esc((sel === t ? "Today \u00b7 " : "") + host.dayName(sel, { weekday: "long", month: "short", day: "numeric" })) + '</h3>' +
      '<button type="button" class="cal-more" data-cal="goto-day" data-date="' + sel + '">Open day</button></div>' + topMiniHtml(sel) + summaryHtml(sel, tl, dayItems) + habitsNoteHtml(sel) + weekUnschedHtml(sel) + refHtml(sel);
    if (allDay.length) html += '<div class="cdp-allday" role="group" aria-label="All day">' + allDay.map(host.chipHtml).join("") + '</div>';
    html += rows ? '<div class="cdp-timeline" role="group" aria-label="Schedule">' + rows + '</div>' : '<div class="cal-empty"><p>Nothing scheduled.</p><button type="button" class="btn btn-primary" data-cdp="add" data-date="' + sel + '">+ Add</button></div>';
    return html + '</section></div>';
  }
  // Week on a wide screen: under the day names, each day's top three.
  function weekPrioHtml(dates) {
    const S = store(), h = habits(), tasks = h ? h.getTasks() : [], days = S ? S.all("days") : [];
    const cells = dates.map(function (d) {
      const top = D.topItems(D.view(days, d), tasks).filter(function (s) { return !s.empty; });
      return '<div><button type="button" class="cal-wk-prio-cell" data-cal="goto-day" data-date="' + d + '" aria-label="' + esc("Top 3 for " + host.dayName(d) + (top.length ? ": " + top.map(function (s) { return s.text + (s.done ? " (done)" : ""); }).join("; ") : ": none set")) + '">' +
        (top.length ? top.map(function (s) { return '<span class="' + (s.done ? "is-done" : "") + '">' + (s.done ? "&#10003; " : "") + esc(s.text) + '</span>'; }).join("") : '<span class="cal-wk-prio-none">&ndash;</span>') + '</button></div>';
    }).join("");
    return '<div class="cal-wk-prio" style="--cols:' + dates.length + '"><div class="cal-gutter-label">Top 3</div>' + cells + '</div>';
  }

  /* ---------------- the Add menu ---------------- */

  function openAdd(o) {
    const opts = o || {}, date = opts.date || host.date(), opener = opts.opener || document.activeElement;
    window.JarvisMenu.open({
      title: "Add", opener: opener,
      rows: [
        { key: "task", label: "Task", sub: "Something to do. Gets a time if you give it one" },
        { key: "habit", label: "Habit", sub: "Put one of your habits on the planner at a time" },
        { key: "block", label: "Time block", sub: "Set time aside for a kind of work" },
        { key: "event", label: "Event", sub: "An appointment or meeting" }
      ],
      onPick: function (key) {
        if (key === "task") openTaskSheet({ date: date, time: opts.time });
        else if (key === "habit") openHabitSheet({ date: date, time: opts.time });
        else if (key === "block") { const A = app(); if (A && A.openBlockSheet) A.openBlockSheet({ date: date, start: opts.time, end: opts.end }); }
        else if (key === "event") host.openEvent({ date: date, time: opts.time });
      }
    });
  }

  /* ---------------- the task form ---------------- */

  function timeChoices(cur) {
    const out = [["", "No time"]]; let seen = false;
    for (let m = 0; m < 1440; m += 15) { const t = W.toTime(m); if (t === cur) seen = true; out.push([t, label(t)]); }
    if (cur && !seen) out.push([cur, label(cur)]);
    return out;
  }
  function lengthChoices(cur) {
    const list = LENGTHS.slice(); if (!list.some(function (x) { return x[0] === cur; })) list.push([cur, D.hm(cur)]);
    return list.map(function (x) { return [String(x[0]), x[1]]; });
  }
  function openTaskSheet(o) {
    const A = app(), h = habits(), S = store();
    if (!A || !h || !S) { tell("Tasks can't be added here right now.", ""); return; }
    const t = o.id ? A.taskById(o.id) : null;
    if (o.id && !t) { tell("That task isn't there any more.", ""); return; }
    const blocks = S.all("blocks"), blk = t ? W.blockOfTask(blocks, t.id) : null;
    const date = t ? t.date : (o.date || host.today());
    const start = blk ? blk.start : (t ? (t.time || "") : (o.time || ""));
    const len = blk ? W.toMin(blk.end) - W.toMin(blk.start) : (t ? 0 : (start ? 30 : 0));
    const cats = [["", "No category"]].concat(W.liveIngredients(S.all("ingredients")).map(function (i) { return [i.id, i.name]; }));
    let body = A.fText("text", "What do you need to do?", t ? t.text : "", { required: true, max: 200 });
    body += A.fText("date", "Day", date, { type: "date" });
    body += A.fSelect("start", "Start time (optional)", timeChoices(start), start);
    body += '<div data-for-time>' + A.fSelect("len", "Length", lengthChoices(len), String(len), { hint: "A length puts it on the timeline as a block, so you can see the free time around it." }) +
      '<div data-for-len>' + A.fSelect("ingredientId", "Category", cats, blk ? blk.ingredientId : "") + '</div></div>';
    body += A.fSelect("priority", "Priority", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], t ? (t.priority || "medium") : "medium");
    if (t) body += '<div class="form-row"><button type="button" class="btn btn-danger" data-sheet-act="delete">Delete this task</button></div>';
    function sync(root) {
      const s = root.querySelector('[name="start"]').value, l = root.querySelector('[name="len"]').value;
      root.querySelector("[data-for-time]").classList.toggle("hidden", !s);
      root.querySelector("[data-for-len]").classList.toggle("hidden", !(Number(l) > 0));
    }
    A.openSheet({
      title: t ? "Edit task" : "New task", body: body, submit: t ? "Save" : "Add task", focus: '[name="text"]',
      onOpen: sync,
      onChange: function (el, root) {
        if (el.name === "start" && el.value && Number(root.querySelector('[name="len"]').value) === 0 && !t) root.querySelector('[name="len"]').value = "30";
        sync(root);
      },
      onAct: function (act) { if (act === "delete") { A.closeSheet(true); deleteTask(t.id); } },
      onSubmit: function (v) { return saveTask(v, t, blk); }
    });
  }
  function saveTask(v, t, blk) {
    const A = app(), h = habits(), S = store();
    const text = String(v.text || "").replace(/\s+/g, " ").trim();
    if (!text) return { ok: false, errors: { text: "Write what you need to do." } };
    if (!PL.isDate(v.date)) return { ok: false, errors: { date: "Choose a day." } };
    const time = v.start || "", len = time ? Number(v.len) || 0 : 0;
    if (len && W.toMin(time) + len > 1439) return { ok: false, errors: { len: "That would run past midnight. Start earlier or make it shorter." } };
    const priority = ["low", "medium", "high"].indexOf(v.priority) !== -1 ? v.priority : "medium";
    const prevTasks = h.getTasks(), prevBlocks = S.all("blocks");
    let id = t ? t.id : "";
    if (t) {
      h.commitTasks(h.getTasks().map(function (x) { return x.id === t.id ? Object.assign({}, x, { text: text, date: v.date, time: time, priority: priority }) : x; }));
    } else {
      const made = h.addTask({ text: text, date: v.date, time: time, priority: priority, kind: "scheduled" });
      if (!made) return { ok: false, message: "That task couldn't be added." };
      id = made.id;
    }
    if (blk && !len) {                              // it had a block and should not any more: the block goes, the task keeps what was just chosen
      const r = W.unplaceTask(S.all("blocks"), id, {});
      if (r.ok && !S.replace("blocks", r.blocks)) { S.replace("blocks", prevBlocks); h.commitTasks(prevTasks); return { ok: false, message: "The browser would not save that." }; }
      h.commitTasks(h.getTasks().map(function (x) { return x.id === id ? Object.assign({}, x, { date: v.date, time: time }) : x; }));
    } else if (len) {
      const ok = A.placeTaskAt(id, { date: v.date, start: time, end: toTime(W.toMin(time) + len), ingredientId: v.ingredientId || "" });
      if (!ok) { if (!t) h.commitTasks(prevTasks); return { ok: false, message: "That time couldn't be set. The task was not saved." }; }
    }
    if (host.changed) host.changed();
    say(t ? "Task saved." : "Task added.");
    return { ok: true };
  }
  function deleteTask(id) {
    const A = app(), h = habits(), S = store();
    const t = A && A.taskById(id);
    if (!t) return;
    const prevTasks = h.getTasks(), prevBlocks = S.all("blocks"), prevDays = S.all("days");
    const r = W.unplaceTask(prevBlocks, id, {});
    if (r.ok) S.replace("blocks", r.blocks);
    h.commitTasks(prevTasks.filter(function (x) { return x.id !== id; }));
    if (host.changed) host.changed();
    tell("Deleted “" + t.text + "”.", "Undo", function () {
      S.replace("blocks", prevBlocks); S.replace("days", prevDays); h.commitTasks(prevTasks);
      if (host.changed) host.changed(); say("Undone.");
    });
  }
  function toggleTask(id) {
    const h = habits(); if (!h) return;
    const t = h.getTasks().filter(function (x) { return x.id === id; })[0]; if (!t) return;
    h.commitTasks(h.getTasks().map(function (x) { return x.id === id ? Object.assign({}, x, { completed: !x.completed }) : x; }));
    if (host.changed) host.changed();
    say((t.completed ? "Not done: " : "Done: ") + t.text + ".");
  }

  /* ---------------- habits on the planner ---------------- */

  function habitsShown() { return ui.showHabits !== false; }
  function setHabitsShown(on) { ui.showHabits = !!on; saveUi(); }
  // How many habits are planned on that day, whether or not they are shown.
  function plannedCount(date) {
    const h = habits();
    try { return h && h.getHabits && HPl ? HPl.items(h.getHabits(), date, date, { today: host.today() }).length : 0; } catch (e) { return 0; }
  }
  // When habits are hidden: say so (and how many are), with the way back. Nothing is shown when they are on, or when the day has none.
  function habitsNoteHtml(date) {
    if (habitsShown()) return "";
    const n = plannedCount(date);
    if (!n) return "";
    return '<p class="cdp-hidden-note" role="status">' + n + (n === 1 ? " habit is" : " habits are") + ' hidden. <button type="button" class="cal-more" data-cdp="habits-show">Show habits</button></p>';
  }
  function openHabitsScreen() {
    const b = document.getElementById("navBtnHabits"); if (b) b.click();
    const t = document.getElementById("habitsSubNavToday"); if (t) t.click();
  }
  function dayChipsHtml(days) {
    return '<div class="cal-chips">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="days" value="' + d + '"' + (days.indexOf(d) !== -1 ? " checked" : "") + '> ' + HPl.DAY_SHORT[d] + '</label>';
    }).join("") + '</div>';
  }
  // The first day it shows from `from`, for the "added" message.
  function firstDay(rec, from) {
    for (let i = 0; i < 8; i++) { const d = CL.addDays(from, i); if (HPl.occursOn(rec, d)) return d; }
    return "";
  }
  // Add a habit to the planner, or change a planned habit's usual time and days. It is the same habit record the Habits screen has: nothing is copied.
  // o: { date, time, id } (id: edit that habit).
  function openHabitSheet(o) {
    const A = app(), h = habits(), opts = o || {};
    if (!A || !h || !h.getHabits || !HPl) { tell("Habits can't be added here right now.", ""); return; }
    const list = h.getHabits().filter(function (x) { return x && typeof x.id === "string" && x.name; });
    if (!list.length) { tell("You have no habits yet. Make one in Habits first.", "Open Habits", openHabitsScreen); return; }
    const editing = opts.id ? list.filter(function (x) { return x.id === opts.id; })[0] : null;
    if (opts.id && !editing) { tell("That habit isn't there any more.", ""); return; }
    const date = opts.date || host.date(), today = host.today(), startDay = date < today ? today : date;
    const first = editing || list.filter(function (x) { return !HPl.onPlanner(x); })[0] || list[0];
    const nextHalf = toTime(Math.ceil((host.nowMin() + 1) / 30) * 30);
    function defaults(rec) {
      const p = HPl.plan(rec);
      return { time: p ? p.time : (opts.time || (date === today ? nextHalf : "09:00")), days: p ? p.days : (Number(rec.targetDays) >= 7 ? HPl.ALL_DAYS.slice() : []), from: p && p.from ? p.from : startDay, planned: !!p };
    }
    function daysHint(rec, d) { return !d.planned && Number(rec.targetDays) < 7 ? "Its goal in Habits is " + rec.targetDays + " days a week. Choose the days you plan to do it." : ""; }
    const d0 = defaults(first);
    let body = editing ? '<p class="cdp-sheet-habit"><strong>' + esc(editing.name) + '</strong></p><input type="hidden" name="habit" value="' + esc(editing.id) + '">' :
      A.fSelect("habit", "Habit", list.map(function (x) { return [x.id, x.name + (HPl.onPlanner(x) ? " (on your planner)" : "")]; }), first.id);
    body += A.fSelect("time", "Time", timeChoices(d0.time).slice(1), d0.time);
    body += '<div class="form-row"><fieldset class="cdp-days"><legend>Days</legend>' + dayChipsHtml(d0.days) + '<p class="field-hint" data-hint="days">' + esc(daysHint(first, d0)) + '</p><p class="sp-err hidden" data-err="days" role="alert"></p></fieldset></div>';
    body += A.fText("from", "Starts", d0.from, { type: "date", hint: "It shows on these days from this day on. Ticking it here ticks it in Habits, and the other way round." });
    if (editing && d0.planned) body += '<div class="form-row"><button type="button" class="btn btn-danger" data-sheet-act="remove">Remove from planner</button><p class="field-hint">The habit, its streak and everything you have ticked stay in Habits.</p></div>';
    function fill(root, rec) {
      const d = defaults(rec);
      root.querySelector('[name="time"]').value = d.time;
      if (!root.querySelector('[name="time"]').value) { const op = document.createElement("option"); op.value = d.time; op.textContent = label(d.time); root.querySelector('[name="time"]').appendChild(op); root.querySelector('[name="time"]').value = d.time; }
      Array.prototype.forEach.call(root.querySelectorAll('[name="days"]'), function (c) { c.checked = d.days.indexOf(Number(c.value)) !== -1; });
      root.querySelector('[name="from"]').value = d.from;
      const hint = root.querySelector('[data-hint="days"]'); if (hint) hint.textContent = daysHint(rec, d);
    }
    A.openSheet({
      title: editing ? "Edit habit schedule" : "Add a habit", body: body, submit: editing || d0.planned ? "Save" : "Add to planner", focus: editing ? '[name="time"]' : '[name="habit"]',
      onChange: function (el, root) {
        if (el.name !== "habit") return;
        const rec = list.filter(function (x) { return x.id === el.value; })[0];
        if (rec) fill(root, rec);
      },
      onAct: function (act) { if (act === "remove" && editing) { A.closeSheet(true); removeHabitFromPlanner(editing.id); } },
      onSubmit: function (v) { return saveHabitPlan(v); }
    });
  }
  function saveHabitPlan(v) {
    const h = habits(), rec = h.getHabits().filter(function (x) { return x.id === v.habit; })[0];
    if (!rec) return { ok: false, message: "That habit isn't there any more." };
    const before = HPl.fields(rec), wasPlanned = HPl.onPlanner(rec);
    const r = h.planHabit(rec.id, { time: v.time, days: (v.days || []).map(Number), from: v.from });
    if (!r.ok) return Object.keys(r.errors || {}).length ? { ok: false, errors: r.errors } : { ok: false, message: r.error };
    const now = h.getHabits().filter(function (x) { return x.id === rec.id; })[0], p = HPl.plan(now), fd = firstDay(now, p.from);
    if (host.changed) host.changed();
    tell((wasPlanned ? "Saved \u201c" : "Added \u201c") + rec.name + "\u201d: " + HPl.daysLabel(p.days) + " at " + label(p.time) + "." + (fd ? " Next: " + host.dayName(fd, { weekday: "short", month: "short", day: "numeric" }) + "." : ""), "Undo", function () {
      const u = h.restoreHabitPlan(rec.id, before);
      if (!u.ok) { tell(u.error, ""); return; }
      if (host.changed) host.changed(); say("Undone.");
    });
    return { ok: true };
  }
  function removeHabitFromPlanner(id) {
    const h = habits(), rec = h && h.getHabits().filter(function (x) { return x.id === id; })[0];
    if (!rec) return;
    const before = HPl.fields(rec), r = h.unplanHabit(id);
    if (!r.ok) { tell(r.error, ""); return; }
    if (host.changed) host.changed();
    tell("Removed \u201c" + rec.name + "\u201d from your planner. It is still in Habits.", "Undo", function () {
      const u = h.restoreHabitPlan(id, before);
      if (!u.ok) { tell(u.error, ""); return; }
      if (host.changed) host.changed(); say("Undone.");
    });
  }

  /* ---------------- categories (what a time block is for) ---------------- */

  function openCategories() {
    const A = app(), S = store();
    if (!A || !S) return;
    const list = W.liveIngredients(S.all("ingredients"));
    let body = '<p class="field-hint">Categories say what a time block is for (deep work, admin, training...). They are the same ones your weekly plan uses.</p>';
    body += list.length ? '<ul class="cdp-cats">' + list.map(function (i) {
      return '<li><span class="cdp-cat-dot" style="--cc:' + esc(i.color) + '" aria-hidden="true"></span><span class="cdp-cat-name">' + esc(i.name) + '</span><button type="button" class="btn btn-secondary" data-sheet-act="edit" data-id="' + esc(i.id) + '" aria-label="Edit ' + esc(i.name) + '">Edit</button></li>';
    }).join("") + '</ul>' : '<p class="cdp-none">No categories yet.</p>';
    body += '<div class="form-row cdp-cat-actions"><button type="button" class="btn btn-secondary" data-sheet-act="new">+ New category</button>' + (list.length ? "" : '<button type="button" class="btn btn-secondary" data-sheet-act="starters">Add a starter set</button>') + '</div>';
    A.openSheet({
      title: "Time block categories", body: body, focus: "[data-sheet-act]",
      onAct: function (act, el) {
        if (act === "new") A.openIngredientSheet("");
        else if (act === "edit") A.openIngredientSheet(el.getAttribute("data-id"));
        else if (act === "starters") { A.addStarterCategories(); openCategories(); }
      }
    });
  }

  /* ---------------- the hours the planner plans in ---------------- */

  // Where the day starts and ends on the timeline (free time is counted inside these hours), and how much work in one day is too much.
  function openHours() {
    const A = app(), S = store();
    if (!A || !S) return;
    const s = S.settings(), hoursOpts = function () { const o = []; for (let h = 0; h < 24; h++) { const t = (h < 10 ? "0" : "") + h + ":00"; o.push([t, label(t)]); } return o; };
    const body = '<p class="field-hint">Free time on the Day timeline is counted between these hours.</p><div class="form-row two-col"><div>' + A.fSelect("dayStart", "Day starts", hoursOpts(), s.dayStart) + '</div><div>' + A.fSelect("dayEnd", "Day ends", hoursOpts(), s.dayEnd) + '</div></div>' +
      A.fSelect("dailyLimitHours", "Daily workload limit", [6, 7, 8, 9, 10, 11, 12, 14].map(function (h) { return [String(h), h + " hours"]; }), String(s.dailyLimitHours), { hint: "A day with more planned than this gets a warning on the Day screen." });
    A.openSheet({
      title: "Planner hours", body: body, submit: "Save",
      onSubmit: function (v) {
        if (v.dayStart >= v.dayEnd) return { ok: false, errors: { dayEnd: "The day has to end after it starts." } };
        if (!S.setSettings({ dayStart: v.dayStart, dayEnd: v.dayEnd, dailyLimitHours: Number(v.dailyLimitHours) })) return { ok: false, message: S.error() || "The browser would not save that." };
        if (host && host.changed) host.changed();
        say("Planner hours saved.");
        return { ok: true };
      }
    });
  }

  /* ---------------- taps and typing ---------------- */

  function pickTop(index, opener, date) {
    const h = habits(), S = store(); if (!h || !S) return;
    const view = D.view(S.all("days"), date), used = {};
    view.top.forEach(function (x) { if (x.taskId) used[x.taskId] = true; });
    const open = h.getTasks().filter(function (t) { return t.date === date && !t.completed && !used[t.id]; });
    if (!open.length) { tell("No open tasks for this day. Type one into the box instead.", ""); return; }
    window.JarvisMenu.open({
      title: "Choose a task", opener: opener,
      rows: open.slice(0, 12).map(function (t) { return { key: t.id, label: t.text, sub: t.time ? label(t.time) : "No time yet" }; }),
      onPick: function (key) {
        const t = open.filter(function (x) { return x.id === key; })[0]; if (!t) return;
        const r = saveDay(date, { type: "top", index: index, taskId: t.id, text: t.text });
        if (!r.ok) tell(r.error, "");
      }
    });
  }
  function commitTopText(input) {
    const date = dateOf(input), i = Number(input.getAttribute("data-top")), text = input.value.replace(/\s+/g, " ").trim();
    if (!text) return;
    const h = habits();
    let taskId = "";
    if (h) { const made = h.addTask({ text: text, date: date, kind: "scheduled" }); if (made) taskId = made.id; }
    const r = saveDay(date, { type: "top", index: i, taskId: taskId, text: text });
    if (!r.ok) {
      // the priority could not be saved, so the task made for it is taken back out: nothing half done
      if (taskId && h) h.commitTasks(h.getTasks().filter(function (t) { return t.id !== taskId; }));
      tell(r.error || "That couldn't be saved.", ""); return;
    }
    say("Priority " + (i + 1) + " set.");
  }
  function openTopTask(i, date) {
    const S = store(), view = D.view(S ? S.all("days") : [], date || host.date()), s = view.top[i];
    if (s && s.taskId && app() && app().taskById(s.taskId)) openTaskSheet({ id: s.taskId });
  }

  function onClick(e) {
    const el = e.target.closest("[data-cdp]");
    if (!el) return;
    flush();
    const act = el.getAttribute("data-cdp"), date = dateOf(el);
    if (act === "plan-toggle") { ui.plan = planOpen() ? "closed" : "open"; saveUi(); host.render(); const b = document.querySelector('[data-cdp="plan-toggle"]'); if (b) b.focus(); return; }
    if (act === "habits-toggle") { ui.habits = !ui.habits; saveUi(); host.render(); const b = document.querySelector('[data-cdp="habits-toggle"]'); if (b) b.focus(); return; }
    if (act === "ref-toggle") { ui.ref = !ui.ref; saveUi(); host.render(); const b = document.querySelector('[data-cdp="ref-toggle"]'); if (b) b.focus(); return; }
    if (act === "open-strategy") { openStrategy(); return; }
    if (act === "wk-day") { host.select(date); return; }
    if (act === "all-tasks") { ui.allTasks = !ui.allTasks; host.render(); const b = document.querySelector('[data-cdp="all-tasks"]'); if (b) b.focus(); return; }
    if (act === "free") { openAdd({ date: date, time: el.getAttribute("data-start"), end: el.getAttribute("data-end"), opener: el }); return; }
    if (act === "add") { openAdd({ date: date, opener: el }); return; }
    if (act === "add-task") { openTaskSheet({ date: date }); return; }
    if (act === "add-habit") { openHabitSheet({ date: date }); return; }
    if (act === "habits-show") { setHabitsShown(true); host.render(); say("Habits are shown."); const b = document.querySelector('[data-cdp="habits-hide"]'); if (b) b.focus(); return; }
    if (act === "habits-hide") { setHabitsShown(false); host.render(); say("Habits are hidden."); const b = document.querySelector('[data-cdp="habits-show"]'); if (b) b.focus(); return; }
    if (act === "top-pick") { pickTop(Number(el.getAttribute("data-i")), el, date); return; }
    if (act === "top-open") { openTopTask(Number(el.getAttribute("data-i")), date); return; }
    if (act === "top-clear") { const r = saveDay(date, { type: "top", index: Number(el.getAttribute("data-i")), taskId: "", text: "" }); if (!r.ok) tell(r.error, ""); else say("Removed from the top three."); return; }
    if (act === "top-tick") {
      const S = store(), s = S ? D.view(S.all("days"), date).top[Number(el.getAttribute("data-i"))] : null;
      if (s && s.taskId) toggleTask(s.taskId);
      return;
    }
    if (act === "task-tick") { toggleTask(el.getAttribute("data-id")); return; }
    if (act === "task-open") { openTaskSheet({ id: el.getAttribute("data-id") }); return; }
    if (act === "goal-step") {
      const G = window.JarvisGoals; if (!G || !G.addStepToDay) return;
      const r = G.addStepToDay(el.getAttribute("data-key"), date);
      if (!r.ok) { tell(r.error || "That couldn't be added.", ""); return; }
      if (r.same) { tell("\u201c" + r.title + "\u201d is already on this day.", ""); return; }
      if (host.changed) host.changed(); else host.render();
      tell((r.moved ? "Moved \u201c" : "Added \u201c") + r.title + "\u201d to " + (date === host.today() ? "today" : host.dayName(date, { month: "short", day: "numeric" })) + ".", "Undo", function () { r.undo(); if (host.changed) host.changed(); else host.render(); say("Undone."); });
      return;
    }
    if (act === "schedule") { const A = app(); if (A && A.scheduleTask) A.scheduleTask(el.getAttribute("data-id"), date); return; }
    if (act === "habit") { const h = habits(); if (h && h.toggleToday && h.toggleToday(el.getAttribute("data-id"))) { if (host.changed) host.changed(); } return; }
  }
  function onInput(e) {
    const a = e.target.closest ? e.target.closest("[data-note]") : null;
    if (a) typed(a.getAttribute("data-note"), dateOf(a), a.value);
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches && t.matches("[data-note]")) { typed(t.getAttribute("data-note"), dateOf(t), t.value); flush(); return; }
    if (t.matches && t.matches("[data-top]")) { commitTopText(t); return; }
  }
  function onKeydown(e) {
    const t = e.target;
    if (e.key === "Enter" && t.matches && t.matches("[data-top]")) { e.preventDefault(); t.blur(); }
  }

  /* ---------------- joining the Calendar ---------------- */

  // host: { date(), today(), nowMin(), dayName(date, opts), dayItems(items, date), select(date), rowHtml(item), chipHtml(item), render(), changed(), notify(), say(text), notice(text, label, fn), openEvent({ date, time }) }
  function attach(h) {
    host = h;
    const stage = document.getElementById("calStage");
    if (stage) {
      stage.addEventListener("click", onClick);
      stage.addEventListener("input", onInput);
      stage.addEventListener("change", onChange);
      stage.addEventListener("keydown", onKeydown);
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
    const S = store();
    if (S && S.subscribe) S.subscribe(function (kind) {
      if (kind !== "days" || selfWrite || !host) return;
      const a = document.activeElement;
      if (a && a.closest && a.closest("#calStage") && /^(input|textarea|select)$/i.test(a.tagName)) return;   // not under your cursor
      host.render();
    });
  }

  window.JarvisCalPlanner = {
    attach: attach, dayHtml: dayHtml, weekHtml: weekHtml, weekPrioHtml: weekPrioHtml, openAdd: openAdd, saveDay: saveDay, pickTop: pickTop, openTopTask: openTopTask, openTask: openTaskSheet, openHabit: openHabitSheet, habitsShown: habitsShown, setHabitsShown: setHabitsShown, openCategories: openCategories, openHours: openHours, flush: flush
  };
})();
