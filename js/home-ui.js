/* ==========================================================================
   JARVIS — Home: the Upcoming Schedule card and quick actions.

   Draws what schedule-logic.js works out from the same items the Calendar shows (events, your tasks, and the
   dates kept in Business). Nothing is saved here: ticking, opening and creating all go through the Calendar,
   so Home never disagrees with it. The Daily Briefing reads its one-line summary from here too.
   ========================================================================== */

(function () {
  "use strict";

  const C = window.JarvisCalendarLogic;
  const S = window.JarvisScheduleLogic;
  const PREVIEW = 5;
  const COLORS = {};
  (C ? C.CATEGORIES : []).forEach(function (c) { COLORS[c.value] = c.color; });

  let last = { byKey: {}, summary: null }, lastDay = "", showEarlier = false;

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(s); }
  function cal() { return window.JarvisCalendar && window.JarvisCalendar.itemsBetween ? window.JarvisCalendar : null; }
  function panelActive() { const p = $("panel-home"); return !!(p && p.classList.contains("active") && p.offsetParent !== null); }
  function announce(text) { const el = $("hmLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }
  function colorOf(it) { return it.source === "task" ? "#7d8fb3" : (COLORS[it.category] || "#9aa3b8"); }

  function clock() {
    const z = cal().zone(), w = C.instantToWall(Date.now(), z);
    return { zone: z, today: w.date, nowMin: C.minutesOf(w.time), hour: Number(w.time.slice(0, 2)) };
  }
  function compute() {
    const c = clock(), k = cal(), st = k.getSettings();
    const items = k.itemsBetween(C.addDays(c.today, -S.LOOKBACK_DAYS), C.addDays(c.today, 30));
    return { clock: c, summary: S.summarize(items, { today: c.today, nowMin: c.nowMin, weekStart: st.weekStart }) };
  }

  /* ---------------- drawing ---------------- */

  function rowHtml(it, opts) {
    const o = opts || {};
    const time = it.allDay ? "All day" : C.timeLabel(it.time);
    const sub = [];
    if (o.when) sub.push(o.when);
    if (o.timeInSub && !it.allDay) sub.push(C.timeLabel(it.time) + (it.point || !it.endTime ? "" : " \u2013 " + C.timeLabel(it.endTime)));
    if (it.source === "task") sub.push("Task");
    else if (it.source === "bizTask") sub.push("Business task");
    else if (it.source === "bizGoal" || it.source === "launch" || it.source === "goal") sub.push(it.category === "launch" ? "Launch" : "Goal");
    else { const cat = C.categoryInfo(it.category).label; if (it.kind !== "event" && C.kindInfo(it.kind).label !== cat) sub.push(C.kindInfo(it.kind).label); sub.push(cat); }
    const tickable = it.source === "task" || it.source === "bizTask" || (it.source === "event" && it.point);
    const state = o.state === "now" ? '<span class="hm-badge">On now</span>' : "";
    return '<div class="hm-row' + (it.passed ? " is-passed" : "") + '" style="--cc:' + colorOf(it) + '">' +
      '<button type="button" class="hm-open" data-hm="open" data-key="' + esc(it.key) + '" aria-label="' + esc(it.title + ", " + (o.when ? o.when + ", " : "") + time + (it.completed ? ", done" : "")) + '">' +
        '<span class="hm-time">' + esc(o.hideTime ? "" : time) + '</span><span class="hm-bar"></span>' +
        '<span class="hm-main"><span class="hm-rtitle' + (it.completed ? " is-done" : "") + '">' + esc(it.title) + '</span><span class="hm-sub">' + esc(sub.join(" · ")) + '</span></span>' + state +
      '</button>' +
      (tickable ? '<button type="button" class="hm-tick' + (it.completed ? " done" : "") + '" data-hm="tick" data-key="' + esc(it.key) + '" aria-pressed="' + !!it.completed + '" aria-label="' + (it.completed ? "Done: " : "Mark done: ") + esc(it.title) + '">' + (it.completed ? "&#10003;" : "") + '</button>' : "") +
    '</div>';
  }

  function section(title, count, bodyHtml, extra) {
    return '<section class="hm-sec' + (extra ? " " + extra : "") + '"><h3 class="hm-sec-title">' + esc(title) + (count !== null ? ' <span class="hm-sec-n">' + count + '</span>' : "") + '</h3>' + bodyHtml + '</section>';
  }
  function more(list, shown, label) {
    return list.length > shown ? '<button type="button" class="hm-more" data-hm="calendar">' + esc("+" + (list.length - shown) + " more in " + label) + '</button>' : "";
  }

  // Today, hour by hour. Tap an hour to add something there (it opens the calendar's popup on that hour).
  function dayHtml(r) {
    const s = r.summary, c = r.clock;
    const d = S.daySlots(s.today, { today: c.today, nowHour: c.hour, showEarlier: showEarlier });
    const nowKey = s.nextUp && s.nextUp.state === "now" ? s.nextUp.item.key : "";
    let html = "";
    if (!s.today.length) html += '<p class="hm-hint">Nothing scheduled yet. Tap an hour to add something.</p>';
    if (d.allDay.length) html += '<div class="hm-hour hm-allday"><div class="hm-hl">All day</div><div class="hm-hbody">' + d.allDay.map(function (it) { return rowHtml(it, { hideTime: true }); }).join("") + '</div></div>';
    if (d.earlier) html += '<button type="button" class="hm-earlier" data-hm="earlier" aria-expanded="false">Earlier today (' + d.earlier.hours + ' hours' + (d.earlier.items ? ", " + d.earlier.items + (d.earlier.items === 1 ? " item" : " items") : "") + ')</button>';
    else if (d.canCollapse) html += '<button type="button" class="hm-earlier" data-hm="earlier" aria-expanded="true">Hide earlier hours</button>';
    d.slots.forEach(function (sl) {
      const label = C.hourLabel(sl.hour);
      html += '<div class="hm-hour' + (sl.isNow ? " is-now" : "") + (sl.items.length ? "" : " is-free") + '"' + (sl.isNow ? ' aria-current="time"' : "") + '>' +
        '<div class="hm-hl">' + esc(label) + (sl.isNow ? '<span class="hm-nowtag">Now</span>' : "") + '</div>' +
        '<div class="hm-hbody">' + (sl.items.length
          ? sl.items.map(function (it) { return rowHtml(it, { hideTime: true, timeInSub: true, state: it.key === nowKey ? "now" : "" }); }).join("")
          : '<button type="button" class="hm-slot" data-hm="add-hour" data-hour="' + sl.hour + '" aria-label="Add something at ' + esc(label) + '">+ Add</button>') + '</div>' +
        (sl.items.length ? '<button type="button" class="hm-plus" data-hm="add-hour" data-hour="' + sl.hour + '" aria-label="Add something at ' + esc(label) + '">+</button>' : "") +
      '</div>';
    });
    return html;
  }

  function scheduleHtml(r) {
    const s = r.summary, today = r.clock.today, all = s.counts.today + s.counts.overdue + s.deadlines.length + s.priorities.length + (s.nextTask ? 1 : 0);
    let html = "";

    // today, hour by hour
    html += section("Today", s.today.length ? s.today.length : null, dayHtml(r), "hm-dayplan");

    // next task
    if (s.nextTask) html += section("Next task", null, rowHtml(s.nextTask, { when: S.whenLabel(s.nextTask.date, today), hideTime: s.nextTask.allDay }), "hm-next");
    else html += section("Next task", null, '<p class="hm-empty">No upcoming tasks. Add a task with a date and it will show here.</p>');

    // overdue
    if (s.overdue.length) html += section("Overdue", s.overdue.length, s.overdue.slice(0, PREVIEW).map(function (it) { return rowHtml(it, { when: S.whenLabel(it.date, today), hideTime: it.allDay }); }).join("") + more(s.overdue, PREVIEW, "Calendar"), "hm-late");

    // deadlines
    html += section("Upcoming deadlines", s.deadlines.length || null, s.deadlines.length
      ? s.deadlines.slice(0, PREVIEW).map(function (it) { return rowHtml(it, { when: S.whenLabel(it.date, today), hideTime: it.allDay }); }).join("") + more(s.deadlines, PREVIEW, "Calendar")
      : '<p class="hm-empty">No deadlines in the next ' + S.DEADLINE_DAYS + ' days.</p>');

    // weekly priorities
    html += section("Priorities this week", s.priorities.length || null, s.priorities.length
      ? s.priorities.slice(0, PREVIEW).map(function (it) { return rowHtml(it, { when: S.whenLabel(it.date, today), hideTime: it.allDay }); }).join("") + more(s.priorities, PREVIEW, "Calendar")
      : '<p class="hm-empty">Nothing marked high priority for the rest of this week.</p>');

    if (!all) html = '<p class="hm-empty hm-empty-all">Your schedule is empty. Tap an hour below to add something, or give a task a date, and it will show here.</p>' + html;
    return html;
  }

  function glanceHtml() {
    const h = window.JarvisHabits && window.JarvisHabits.getSummary ? window.JarvisHabits.getSummary() : null;
    const tasks = window.JarvisHabits && window.JarvisHabits.getTasks ? window.JarvisHabits.getTasks() : [];
    const today = clock().today, mine = tasks.filter(function (t) { return t && t.date === today; }), done = mine.filter(function (t) { return t.completed; }).length;
    const box = function (value, label) { return '<div class="stat-box"><span class="stat-value">' + esc(value) + '</span><span class="stat-label">' + esc(label) + '</span></div>'; };
    return box(done + " / " + mine.length, "Tasks done today") + box(h ? h.doneToday + " / " + h.total : "0 / 0", "Habits done today");
  }

  function greeting(hour) { return hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; }

  function render() {
    if (!$("panel-home") || !cal()) return;
    const r = compute();
    last = { summary: r.summary, byKey: {} };
    const note = function (it) { last.byKey[it.key] = it; };
    r.summary.today.forEach(note); r.summary.overdue.forEach(note); r.summary.deadlines.forEach(note); r.summary.priorities.forEach(note); if (r.summary.nextTask) note(r.summary.nextTask);
    $("hmGreeting").textContent = greeting(r.clock.hour);
    $("hmDate").textContent = C.fmtDate(r.clock.today, { weekday: "long", month: "long", day: "numeric" });
    const n = r.summary.counts, parts = [];
    parts.push(n.today + " today");
    if (n.overdue) parts.push(n.overdue + " overdue");
    $("hmCounts").textContent = parts.join(" · ");
    $("hmCounts").classList.toggle("is-late", n.overdue > 0);
    $("hmScheduleBody").innerHTML = scheduleHtml(r);
    $("hmGlance").innerHTML = glanceHtml();
    lastDay = r.clock.today;
  }

  /* ---------------- taps ---------------- */

  function openCalendar(view) {
    const b = $("navBtnCalendar"); if (b) b.click();
    const k = cal(); if (k && view) k.goTo(clock().today, view);
  }
  function onClick(e) {
    const el = e.target.closest("[data-hm]");
    if (!el) return;
    const act = el.getAttribute("data-hm"), it = last.byKey[el.getAttribute("data-key")];
    if (act === "add-hour") { cal().openNew({ date: clock().today, time: C.timeOf(Number(el.getAttribute("data-hour")) * 60) }); return; }
    if (act === "earlier") { showEarlier = !showEarlier; render(); const again = document.querySelector('#hmScheduleBody [data-hm="earlier"]'); if (again) again.focus(); return; }
    if (act === "calendar") { openCalendar("agenda"); return; }
    if (!it) return;
    if (act === "tick") {
      const key = it.key;
      cal().toggleItem(it); render(); announce((it.completed ? "Not done: " : "Done: ") + it.title + ".");
      const again = document.querySelector('#hmScheduleBody [data-hm="tick"][data-key="' + key + '"]'); if (again) again.focus();
      return;
    }
    if (act === "open") {
      if (it.source === "event") cal().openEvent(it.id, it.occDate); else cal().openItem(it);
    }
  }

  // One line for the Daily Briefing.
  function briefingLine() {
    if (!cal() || !S) return "";
    const r = compute();
    return S.briefingLine(r.summary, r.clock.today, C.timeLabel);
  }

  function onShow() { render(); }
  function init() {
    if (!$("panel-home") || !C || !S) return;
    $("hmScheduleBody").addEventListener("click", onClick);
    document.addEventListener("jarvis-calendar-changed", function () { if (panelActive()) render(); });
    document.addEventListener("jarvis-habits-day-changed", function () { if (panelActive()) render(); });
    // A once-a-minute redraw keeps "now" and "overdue" right, but never while you are using a button here.
    window.setInterval(function () {
      if (!panelActive() || document.hidden) return;
      const busy = document.activeElement && $("hmScheduleBody").contains(document.activeElement);
      if (!busy || clock().today !== lastDay) render();
    }, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && panelActive()) render(); });
    render();
  }

  window.JarvisHome = { init: init, onShow: onShow, briefingLine: briefingLine };
})();
