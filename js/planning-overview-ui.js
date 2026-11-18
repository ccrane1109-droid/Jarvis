/* ==========================================================================
   JARVIS — Planning › Overview.

   The first screen of the Planning section (Overview | Calendar | Habits | Strategy). It shows three things that
   already exist elsewhere in JARVIS, each with one tap to the screen that owns it:
     - what is coming up on the Calendar (events in the next 7 days, from JarvisCalendar.itemsBetween, the same list
       Home and the Calendar draw from);
     - today's habits (JarvisHabits.getToday; a tick goes through the same code as the Habits Today screen);
     - the current strategic priorities (this quarter's priorities, or this year's goals when there are none, with the
       progress the Strategy tab already works out).
   Nothing is stored or calculated here. A section with nothing in it says so in one line.
   ========================================================================== */

(function () {
  "use strict";

  const C = window.JarvisCalendarLogic;
  const S = window.JarvisScheduleLogic;
  const DAYS = 7, MAX_EVENTS = 4, MAX_HABITS = 6, MAX_GOALS = 3;
  let last = { byKey: {} }, started = false;

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(String(s === null || s === undefined ? "" : s)); }
  function cal() { return window.JarvisCalendar && window.JarvisCalendar.itemsBetween ? window.JarvisCalendar : null; }
  function panelActive() { const p = $("panel-planning"); return !!(p && p.classList.contains("active")); }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }

  function clock() {
    const w = C.instantToWall(Date.now(), cal().zone());
    return { today: w.date, nowMin: C.minutesOf(w.time) };
  }

  /* ---------------- Calendar: what is coming up ---------------- */

  function whenText(date, today) {
    const n = C.diffDays(today, date);
    if (n <= 0) return "Today";
    if (n === 1) return "Tomorrow";
    return C.fmtDate(date, { weekday: "short", month: "short", day: "numeric" });
  }
  function timeText(it) {
    if (it.allDay) return "All day";
    return C.timeLabel(it.time) + (it.point || !it.endTime || it.endDate !== it.date ? "" : " – " + C.timeLabel(it.endTime));
  }
  // Still to come: not on an earlier day, and (today) not already over.
  function upcoming(items, c) {
    return items.filter(function (it) {
      if (it.source !== "event") return false;
      if ((it.endDate || it.date) < c.today) return false;
      if (it.date <= c.today && !it.allDay) {
        if (it.date === c.today && (it.point ? it.startMin < c.nowMin : (it.endDate === c.today && it.endMin <= c.nowMin))) return false;
      }
      return true;
    }).map(function (it) {
      return Object.assign({}, it, { shownDate: it.date < c.today ? c.today : it.date });
    }).sort(function (a, b) {
      return a.shownDate < b.shownDate ? -1 : a.shownDate > b.shownDate ? 1 :
        ((a.allDay ? 0 : 1) - (b.allDay ? 0 : 1)) || ((a.startMin || 0) - (b.startMin || 0)) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
    });
  }

  function calendarCard() {
    let body = "", more = "";
    last = { byKey: {} };
    try {
      if (!cal() || !C) throw new Error("no calendar");
      const c = clock();
      const list = upcoming(cal().itemsBetween(c.today, C.addDays(c.today, DAYS)), c);
      if (!list.length) {
        body = '<p class="ov-meta">Nothing coming up in the next ' + DAYS + ' days.</p>';
      } else {
        body = '<ul class="ov-list">' + list.slice(0, MAX_EVENTS).map(function (it) {
          last.byKey[it.key] = it;
          return '<li><button type="button" class="ov-row" data-ov="event" data-key="' + esc(it.key) + '" style="--cc:' + esc(it.color || "var(--accent)") + '" aria-label="' + esc(it.title + ", " + whenText(it.shownDate, c.today) + ", " + timeText(it)) + '">' +
            '<span class="ov-rbar" aria-hidden="true"></span><span class="ov-rmain"><span class="ov-rtitle">' + esc(it.title) + '</span><span class="ov-rsub">' + esc(whenText(it.shownDate, c.today) + " · " + timeText(it)) + '</span></span></button></li>';
        }).join("") + '</ul>';
        if (list.length > MAX_EVENTS) more = '<button type="button" class="ov-more" data-ov="calendar">' + esc("+" + (list.length - MAX_EVENTS) + " more in Calendar") + '</button>';
      }
    } catch (e) {
      body = '<p class="ov-meta">The calendar is not available right now.</p>';
    }
    return '<section class="card ov-card" aria-labelledby="poCalTitle"><h2 class="ov-title" id="poCalTitle">Upcoming</h2>' + body + more +
      '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="add-event">+ Add event</button><button type="button" class="ov-chip" data-ov="calendar">Open Calendar</button></div></section>';
  }

  /* ---------------- Habits: today ---------------- */

  function habitsCard() {
    const H = window.JarvisHabits;
    let title = "Today’s habits", count = "", body = "", chips = '<button type="button" class="ov-chip" data-ov="habits">Open Habits</button>';
    try {
      const t = H && H.getToday ? H.getToday() : null;
      if (!t) throw new Error("no habits");
      if (!t.habits.length) {
        body = '<p class="ov-meta">No habits yet.</p>';
        chips = '<button type="button" class="ov-chip" data-ov="habits-add">Add a habit</button>';
      } else {
        const done = t.habits.filter(function (h) { return h.done; }).length;
        count = '<span class="ov-count">' + done + ' of ' + t.habits.length + ' done</span>';
        // what is still to do first, then what is done; both in the order the Habits screen keeps
        const ordered = t.habits.filter(function (h) { return !h.done; }).concat(t.habits.filter(function (h) { return h.done; }));
        body = '<ul class="ov-list">' + ordered.slice(0, MAX_HABITS).map(function (h) {
          // A habit with a daily count (water, pages...) is stepped up and down on the Habits screen; here it shows its count and opens that screen.
          if (h.target > 1) {
            return '<li><button type="button" class="ov-habit' + (h.done ? " is-done" : "") + '" data-ov="habits" aria-label="' + esc(h.name + ", " + h.count + " of " + h.target + " today. Open Habits to change it.") + '">' +
              '<span class="ov-check ov-check-count" aria-hidden="true">' + (h.done ? "&#10003;" : "") + '</span><span class="ov-hname">' + esc(h.name) + '</span><span class="ov-hcount">' + h.count + '/' + h.target + '</span></button></li>';
          }
          return '<li><button type="button" class="ov-habit' + (h.done ? " is-done" : "") + '" data-ov="habit" data-id="' + esc(h.id) + '" aria-pressed="' + (h.done ? "true" : "false") + '">' +
            '<span class="ov-check" aria-hidden="true">' + (h.done ? "&#10003;" : "") + '</span><span class="ov-hname">' + esc(h.name) + '</span></button></li>';
        }).join("") + '</ul>';
        if (ordered.length > MAX_HABITS) body += '<button type="button" class="ov-more" data-ov="habits">' + esc("+" + (ordered.length - MAX_HABITS) + " more in Habits") + '</button>';
      }
    } catch (e) {
      body = '<p class="ov-meta">Habits are not available right now.</p>';
    }
    return '<section class="card ov-card" aria-labelledby="poHabTitle"><div class="ov-head"><h2 class="ov-title" id="poHabTitle">' + title + '</h2>' + count + '</div>' + body +
      '<div class="ov-chips">' + chips + '</div></section>';
  }

  /* ---------------- Strategy: current priorities ---------------- */

  function priorityCard() {
    let title = "Strategic priorities", body = "";
    try {
      const A = window.JarvisPlanApp, I = window.JarvisPlanInsights;
      if (!A || !I) throw new Error("no strategy");
      // The plan's progress is worked out from your tasks, and it is kept until something changes. Start from a fresh
      // one so these numbers are the ones Strategy shows, even if it was first worked out before the tasks had loaded.
      A.bump();
      const d = I.dashboard(A.ictx()), m = A.model();
      const nodes = d.priorities.length ? d.priorities : d.objectives;
      if (d.priorities.length) title = "Q" + d.quarter + " priorities";
      else if (d.objectives.length) title = d.year + " goals";
      if (!nodes.length) {
        body = '<p class="ov-meta">No priorities yet. Set goals in Strategy and they show here.</p>';
      } else {
        body = '<ul class="ov-list">' + nodes.slice(0, MAX_GOALS).map(function (n) {
          const p = m.progress(n.id), pct = p && typeof p.pct === "number" ? Math.max(0, Math.round(p.pct)) : null;
          return '<li><button type="button" class="ov-row ov-goal" data-ov="goal" data-id="' + esc(n.id) + '"><span class="ov-rmain"><span class="ov-rtitle">' + esc(n.title) + '</span>' +
            (pct === null ? '<span class="ov-rsub">No progress data yet</span>' :
              '<span class="ov-bar" role="progressbar" aria-label="' + esc(n.title) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, pct) + '"><span style="width:' + Math.min(100, pct) + '%"></span></span>') +
            '</span>' + (pct === null ? "" : '<span class="ov-pct">' + pct + '%</span>') + '</button></li>';
        }).join("") + '</ul>';
        if (nodes.length > MAX_GOALS) body += '<button type="button" class="ov-more" data-ov="strategy">' + esc("+" + (nodes.length - MAX_GOALS) + " more in Strategy") + '</button>';
      }
    } catch (e) {
      body = '<p class="ov-meta">Strategy is not available right now.</p>';
    }
    return '<section class="card ov-card" aria-labelledby="poStratTitle"><h2 class="ov-title" id="poStratTitle">' + esc(title) + '</h2>' + body +
      '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="strategy">Open Strategy</button><button type="button" class="ov-chip" data-ov="weekly">This week</button></div></section>';
  }

  /* ---------------- drawing and taps ---------------- */

  function render() {
    const root = $("poRoot");
    if (!root || !core()) return;
    root.innerHTML = calendarCard() + habitsCard() + priorityCard();
  }

  function onClick(e) {
    const el = e.target.closest ? e.target.closest("[data-ov]") : null;
    if (!el) return;
    const go = core().openScreen, act = el.getAttribute("data-ov");
    if (act === "event") {
      const it = last.byKey[el.getAttribute("data-key")];
      if (it && cal()) cal().openEvent(it.id, it.occDate);
    } else if (act === "add-event") {
      if (cal()) cal().openNew({ date: clock().today });
    } else if (act === "calendar") {
      go("navBtnCalendar");
    } else if (act === "habit") {
      const id = el.getAttribute("data-id");
      if (window.JarvisHabits && window.JarvisHabits.toggleToday && window.JarvisHabits.toggleToday(id)) {
        render();
        const again = document.querySelector('#poRoot [data-ov="habit"][data-id="' + id + '"]');
        if (again) again.focus({ preventScroll: true });
      }
    } else if (act === "habits") {
      go("navBtnHabits", "habitsSubNavToday");
    } else if (act === "habits-add") {
      go("navBtnHabits", "habitsSubNavRoutines");
    } else if (act === "strategy" || act === "goal") {
      go("navBtnStrategy");
      if (act === "goal" && window.JarvisPlan && window.JarvisPlan.go) window.JarvisPlan.go("goals");
    } else if (act === "weekly") {
      go("navBtnStrategy");
      if (window.JarvisPlan && window.JarvisPlan.go) window.JarvisPlan.go("weekly");
    }
  }

  function onShow() { render(); }

  function init() {
    const root = $("poRoot");
    if (!root || started || !C || !S) return;
    started = true;
    root.addEventListener("click", onClick);
    ["jarvis-calendar-changed", "jarvis-habits-day-changed", "jarvis-tasks-changed"].forEach(function (name) {
      document.addEventListener(name, function () { if (panelActive()) render(); });
    });
    try {
      const A = window.JarvisPlanApp;
      if (A && A.store && A.store.subscribe) A.store.subscribe(function () { if (panelActive()) render(); });
    } catch (e) { /* the Strategy tab is optional here */ }
    document.addEventListener("visibilitychange", function () { if (!document.hidden && panelActive()) render(); });
    // Keeps "coming up" right as the day goes on, but never redraws under a finger that is on a button here.
    window.setInterval(function () {
      if (document.hidden || !panelActive()) return;
      if (document.activeElement && root.contains(document.activeElement)) return;
      render();
    }, 60000);
    render();
  }

  // app.js starts this with the other screens, once the saved data has loaded.
  window.JarvisPlanningOverview = { init: init, onShow: onShow, render: render };
})();
