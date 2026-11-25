/* ==========================================================================
   JARVIS — Planning › Overview: today's command center.

   The first screen of Planning. It answers "what do I do now, and what is left?" from what JARVIS already keeps, and it changes nothing
   by itself. Every section reads the same records the other screens do and acts through the same code, so a tick here is the tick on the
   Calendar, in Habits and in the To-Do list (one occurrence, one completion; see planning-core-logic.js).

     Today in numbers     tasks done today · habits done · free time left in your day · this week's task completion
     Up next              what is on now or starts next (or the next task with no time): Start a focus session, Complete, Reschedule
     Today's top three    your three, from the Day plan (the same record the Calendar's Daily plan edits); or ask for a suggestion
     Rest of today        what is left, in time order; done things fold away
     Habits               the habits scheduled for today, ticked in place; done ones fold away
     Strategic progress   this week's priority, this month's milestone, this year's goal (from Strategy, never estimated here)
     Upcoming deadlines   deadlines and single events; a repeating one is one line with a count, not one line per day

   Which sections show, and in what order, is yours to choose (Simple, Balanced, Advanced or your own); it is saved (jarvisPlanOverview).
   The rules for each section are in planning-overview-logic.js (tested); this file only draws and acts.
   ========================================================================== */

(function () {
  "use strict";

  const C = window.JarvisCalendarLogic;
  const OL = window.JarvisPlanningOverviewLogic;
  const PREF_KEY = "jarvisPlanOverview";
  const MAX_REMAINING = 5, MAX_ANYTIME = 4, MAX_TOP_PICKS = 5, MAX_DEADLINES = 6, DEADLINE_DAYS = 14, NOTE_MS = 9000;
  let prefs = null, started = false, note = null, noteTimer = null;
  const ui = { layout: false, showDone: false, showAllRemaining: false, showAllAnytime: false, showHabitsDone: false };

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(String(s === null || s === undefined ? "" : s)); }
  function cal() { return window.JarvisCalendar && window.JarvisCalendar.planItems ? window.JarvisCalendar : null; }
  function habits() { return window.JarvisHabits || null; }
  function planner() { return window.JarvisCalPlanner || null; }
  function panelActive() { const p = $("panel-planning"); return !!(p && p.classList.contains("active")); }

  function clock() {
    const w = C.instantToWall(Date.now(), cal().zone());
    return { today: w.date, nowMin: C.minutesOf(w.time) };
  }
  function loadPrefs() { prefs = OL.cleanPrefs(core().loadJSON(PREF_KEY, null)); }
  function savePrefs(next) {
    const keep = prefs;
    prefs = next;
    if (!core().saveJSON(PREF_KEY, prefs)) { prefs = keep; core().showToast("That couldn't be saved. The browser may be full or blocking storage."); return false; }
    return true;
  }
  function hm(m) { return OL.hm(m); }

  /* ---------------- what is known right now ---------------- */

  // Everything the sections need, read once per draw.
  function gather() {
    const c = clock(), calx = cal(), H = habits(), S = window.JarvisPlanStore, W = window.JarvisPlanWeekLogic, D = window.JarvisDayPlannerLogic, PL = window.JarvisPlanLogic;
    const last = C.addDays(c.today, DEADLINE_DAYS - 1);
    const all = calx.planItems(c.today, last);
    const tasks = H && H.getTasks ? H.getTasks() : [], habitList = H && H.getHabits ? H.getHabits() : [];
    const taskById = {}, habitIds = {};
    tasks.forEach(function (t) { if (t && t.id) taskById[t.id] = t; });
    habitList.forEach(function (h) { if (h && h.id) habitIds[h.id] = true; });
    const todayItems = all.filter(function (it) { return it.date === c.today && (it.endDate || it.date) === c.today; });
    let links = [];
    try { if (S) { S.init(); links = S.all("links"); } } catch (e) { links = []; }
    let freeMin = null;
    try {
      if (S && W && D) freeMin = D.timeline({ date: c.today, items: all.filter(function (it) { return it.date <= c.today && (it.endDate || it.date) >= c.today; }), window: W.winOf(S.settings()), nowMin: c.nowMin, today: c.today }).freeMin;
    } catch (e) { freeMin = null; }
    const settings = calx.getSettings ? calx.getSettings() : {};
    const ws = C.startOfWeek(c.today, typeof settings.weekStart === "number" ? settings.weekStart : 1);
    const weekDates = []; for (let i = 0; i < 7; i++) weekDates.push(C.addDays(ws, i));
    let detail = null;
    try { detail = H && H.getTodayDetail ? H.getTodayDetail() : null; } catch (e) { detail = null; }
    let top = [], view = null;
    try { const P = window.JarvisDayPlannerLogic; if (S && P) { view = P.view(S.all("days"), c.today); top = P.topItems(view, tasks); } } catch (e) { top = []; }
    return { c: c, all: all, todayItems: todayItems, tasks: tasks, taskById: taskById, habitIds: habitIds, links: links, PL: PL, freeMin: freeMin, weekDates: weekDates, detail: detail, top: top };
  }

  // Today's open tasks in the order the Strategy engine ranks them (plan-insights-logic.js), each with its short reason. Worked out once per draw.
  function rankOf(g) {
    if (g._rank) return g._rank;
    const A = window.JarvisPlanApp, I = window.JarvisPlanInsights, out = { list: [], byId: {} };
    try {
      if (A && I) {
        A.bump();
        I.rankTasks(A.ictx()).forEach(function (r) {
          if (r.task && r.task.date === g.c.today && !r.task.completed) { out.list.push(r); out.byId[r.task.id] = r; }
        });
      }
    } catch (e) { out.list = []; out.byId = {}; }
    g._rank = out;
    return out;
  }

  function estimateOf(task, g) {
    try { const l = task && g.PL && g.PL.linkOf ? g.PL.linkOf(g.links, task.id) : null; return l && l.estMin ? Number(l.estMin) : 0; } catch (e) { return 0; }
  }
  function taskOf(it, g) { return it.source === "task" ? g.taskById[it.id] : (it.taskId ? g.taskById[it.taskId] : null); }
  function durationOf(it, g) {
    if ((it.source === "plan" || it.source === "event") && !it.point && typeof it.endMin === "number" && it.endMin > it.startMin && it.endDate === it.date) return it.endMin - it.startMin;
    return estimateOf(taskOf(it, g), g);
  }
  function timeText(it) {
    if (it.allDay || !it.time) return "";
    return C.timeLabel(it.time) + (it.point || !it.endTime || it.endDate !== it.date ? "" : " – " + C.timeLabel(it.endTime));
  }
  function metaOf(it, g) {
    const parts = [], t = timeText(it);
    parts.push(t || (it.source === "task" || it.source === "habit" ? "Anytime" : "All day"));
    const tk = taskOf(it, g), cat = it.source === "plan" && it.categoryName ? it.categoryName : (tk && tk.category ? tk.category : (it.source === "habit" ? "Habit" : ""));
    if (cat) parts.push(cat);
    const d = durationOf(it, g); if (d) parts.push(hm(d));
    return parts;
  }
  function focusArgs(it, g, opener) {
    const tk = taskOf(it, g);
    return { title: it.title, itemKey: it.key, taskId: tk ? tk.id : "", habitId: it.source === "habit" ? it.id : (tk && tk.habitId ? tk.habitId : ""), opener: opener };
  }
  function rounded(min) { return Math.ceil(min / 15) * 15; }
  function timeOf(min) { const m = Math.max(0, Math.min(1439, Math.round(min))); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }

  /* ---------------- sections ---------------- */

  function tickBtn(it, label) {
    return '<button type="button" class="po-tick' + (it.completed ? " is-done" : "") + '" data-ov="tick" data-key="' + esc(it.key) + '" aria-pressed="' + (it.completed ? "true" : "false") + '" aria-label="' + esc((it.completed ? "Mark not done: " : "Mark done: ") + (label || it.title)) + '"><span aria-hidden="true">' + (it.completed ? "&#10003;" : "") + '</span></button>';
  }
  function card(id, title, body, extra) {
    return '<section class="card ov-card po-card' + (extra && extra.cls ? " " + extra.cls : "") + '" aria-labelledby="po_' + id + '"><div class="ov-head"><h2 class="ov-title" id="po_' + id + '">' + esc(title) + '</h2>' + ((extra && extra.head) || "") + '</div>' + body + '</section>';
  }

  function statsSection(g, st) {
    // The tile's name is its own words ("1/4 Tasks done"), so what is read is what is seen. A dash is read as "none".
    const tile = function (act, n, of, label) {
      return '<li><button type="button" class="po-stat" data-ov="' + act + '"><span class="po-stat-n">' + n + (of ? '<span class="po-stat-of">' + of + '</span>' : "") + '</span><span class="po-stat-l">' + esc(label) + '</span></button></li>';
    };
    const dash = '<span aria-hidden="true">&ndash;</span><span class="visually-hidden">None</span>';
    const t = st.tasks, h = st.habits;
    const tasksN = t.total ? t.done : dash, habitsN = h.total ? h.done : dash;
    let focus = "";
    try {
      const F = window.JarvisFocus, tt = F && F.totals ? F.totals(g.c.today, g.c.today) : null;
      if (tt && tt.minutes > 0) focus = '<p class="po-focus-note">Focused today: ' + esc(hm(tt.minutes)) + ' in ' + tt.sessions + (tt.sessions === 1 ? ' session' : ' sessions') + '</p>';
    } catch (e) { focus = ""; }
    return '<section class="card ov-card po-card po-wide" aria-label="Today in numbers"><ul class="po-stats">' +
      tile("go-calendar", tasksN, t.total ? "/" + t.total : "", "Tasks done") +
      tile("go-habits", habitsN, h.total ? "/" + h.total : "", "Habits done") +
      tile("go-calendar", st.freeMin === null ? dash : esc(hm(st.freeMin)), "", "Free time left") +
      tile("go-week", st.week.pct === null ? dash : st.week.pct + "%", "", "This week’s tasks") +
      '</ul>' + focus + '</section>';
  }

  // The thing to do now or next.
  function nextSection(g, rem, nx, topIds) {
    let it = nx ? nx.item : null, label = "", kicker = "Up next";
    if (nx) {
      if (nx.state === "now") { kicker = "Now"; label = nx.minutes > 0 ? "Started " + hm(nx.minutes) + " ago" : "Starting now"; }
      else if (nx.state === "next") label = "In " + hm(nx.minutes);
      else { kicker = "Still open"; label = "From earlier today"; }
    } else {
      const rk = rankOf(g);
      const pos = function (x) { const r = rk.byId[x.id]; return r ? rk.list.indexOf(r) : 1e6; };
      const any = rem.anytime.slice().sort(function (a, b) { return (topIds[a.id] ? 0 : 1) - (topIds[b.id] ? 0 : 1) || pos(a) - pos(b); })[0];
      if (any) {
        it = any; kicker = "Next task";
        const r = rk.byId[any.id];
        label = r && r.enough ? "No time set · " + r.short : "No time set";
      }
    }
    if (!it) {
      return card("next", "Up next", '<p class="ov-meta">Nothing else is scheduled for today.</p><div class="ov-chips"><button type="button" class="ov-chip" data-ov="add">Add something</button></div>');
    }
    const actions = '<div class="po-acts"><button type="button" class="btn btn-primary" data-ov="start" data-key="' + esc(it.key) + '">Start</button><button type="button" class="btn btn-secondary" data-ov="complete" data-key="' + esc(it.key) + '">Complete</button><button type="button" class="btn btn-secondary" data-ov="reschedule" data-key="' + esc(it.key) + '">Reschedule</button></div>';
    return card("next", kicker, '<button type="button" class="po-next" data-ov="open" data-key="' + esc(it.key) + '"><span class="ov-main">' + esc(it.title) + '</span><span class="ov-meta">' + esc(metaOf(it, g).join(" · ")) + '</span></button><p class="po-when">' + esc(label) + '</p>' + actions);
  }

  // Only shown when there is something to look at. Each line goes to where it can be dealt with; nothing here changes anything by itself.
  function headsSection(g) {
    let list = [];
    try {
      const P = planner(), soonTo = C.addDays(g.c.today, 1);
      list = OL.headsUp({ items: g.todayItems, soon: g.all.filter(function (it) { return it.date >= g.c.today && it.date <= soonTo; }), today: g.c.today, nowMin: g.c.nowMin, overbooked: P && P.overbooked ? P.overbooked(g.c.today) : "" });
    } catch (e) { list = []; }
    if (!list.length) return "";
    const asst = !!window.JarvisAssistant;
    return card("heads", "Heads up", '<ul class="ov-list">' + list.map(function (x, i) {
      const toAssistant = (x.kind === "overlap" || x.kind === "overload") && asst;
      return '<li><button type="button" class="ov-row" data-ov="heads-go" data-kind="' + x.kind + '" data-key="' + esc(x.key) + '" data-i="' + i + '"><span class="ov-rmain"><span class="ov-rtitle">' + esc(x.text) + '</span><span class="ov-rsub">' + (toAssistant ? "Review with the planning assistant" : "Open it") + '</span></span></button></li>';
    }).join("") + '</ul>');
  }

  function topSection(g) {
    const rows = g.top.map(function (s) {
      if (s.empty) return '<li class="po-top-row is-empty"><button type="button" class="po-top-add" data-ov="top-pick" data-i="' + s.index + '">+ Choose a task for slot ' + (s.index + 1) + '</button></li>';
      const t = s.taskId ? g.taskById[s.taskId] : null;
      return '<li class="po-top-row">' +
        (t ? '<button type="button" class="po-tick' + (s.done ? " is-done" : "") + '" data-ov="top-tick" data-id="' + esc(s.taskId) + '" aria-pressed="' + (s.done ? "true" : "false") + '" aria-label="' + esc((s.done ? "Mark not done: " : "Mark done: ") + s.text) + '"><span aria-hidden="true">' + (s.done ? "&#10003;" : "") + '</span></button>' : '<span class="po-tick po-tick-off" aria-hidden="true"></span>') +
        '<button type="button" class="po-top-text' + (s.done ? " is-done" : "") + '" data-ov="top-open" data-i="' + s.index + '"' + (t ? "" : " disabled") + '>' + esc(s.text) + (t && t.time ? '<span class="ov-rsub">' + esc(C.timeLabel(t.time)) + '</span>' : "") + (!t ? '<span class="ov-rsub">Its task is gone</span>' : "") + '</button>' +
        '<button type="button" class="po-more" data-ov="top-menu" data-i="' + s.index + '" aria-label="Options for ' + esc(s.text) + '" aria-haspopup="dialog">&#8942;</button></li>';
    }).join("");
    const empty = g.top.every(function (s) { return s.empty; });
    return card("top", "Today’s top three",
      (empty ? '<p class="ov-meta">None chosen yet. Pick up to three things that matter most today.</p>' : "") + '<ol class="po-top">' + rows + '</ol>' +
      (g.top.some(function (s) { return s.empty; }) ? '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="suggest">Suggest tasks</button></div>' : ""));
  }

  function rowHtml(it, topIds, g) {
    const tick = it.source === "task" || it.source === "habit" || it.source === "plan" ? tickBtn(it) : '<span class="po-tick po-tick-off" aria-hidden="true"></span>';
    const t = it.allDay ? "" : C.timeLabel(it.time);
    return '<li class="po-rem-row' + (it.completed ? " is-done" : "") + '">' + tick +
      '<button type="button" class="po-rem-main" data-ov="open" data-key="' + esc(it.key) + '"><span class="po-rem-time">' + esc(t || "Anytime") + '</span><span class="po-rem-title">' + esc(it.title) + '</span>' +
      (topIds[it.source === "task" ? it.id : it.taskId] ? '<span class="po-tag">Top 3</span>' : "") + (it.conflict ? '<span class="po-tag is-warn">Overlaps</span>' : "") + '</button></li>';
  }

  function remainingSection(g, rem, nxItem, topIds, habitsShown) {
    const keep = function (it) { return !(nxItem && it.key === nxItem.key) && !(habitsShown && it.source === "habit"); };
    const open = rem.open.filter(function (r) { return keep(r.item); }).map(function (r) { return r.item; });
    const anytime = rem.anytime.filter(keep);
    const done = rem.done.filter(function (it) { return !(habitsShown && it.source === "habit"); });
    const shown = ui.showAllRemaining ? open : open.slice(0, MAX_REMAINING), hiddenN = open.length - shown.length;
    const anyShown = ui.showAllAnytime ? anytime : anytime.slice(0, MAX_ANYTIME), anyHidden = anytime.length - anyShown.length;
    let body = "";
    if (!open.length && !anytime.length) body += '<p class="ov-meta">' + (nxItem ? "That is everything after the next item." : "Nothing left on today’s schedule.") + '</p>';
    if (open.length) body += '<ul class="po-rem">' + shown.map(function (it) { return rowHtml(it, topIds, g); }).join("") + '</ul>' + (hiddenN > 0 ? '<button type="button" class="ov-more" data-ov="more-remaining">+' + hiddenN + ' more</button>' : (ui.showAllRemaining && open.length > MAX_REMAINING ? '<button type="button" class="ov-more" data-ov="more-remaining">Show fewer</button>' : ""));
    if (anytime.length) body += '<h3 class="po-sub">No time set</h3><ul class="po-rem">' + anyShown.map(function (it) { return rowHtml(it, topIds, g); }).join("") + '</ul>' + (anyHidden > 0 ? '<button type="button" class="ov-more" data-ov="more-anytime">+' + anyHidden + ' more</button>' : (ui.showAllAnytime && anytime.length > MAX_ANYTIME ? '<button type="button" class="ov-more" data-ov="more-anytime">Show fewer</button>' : ""));
    if (done.length) body += '<button type="button" class="ov-more po-done-toggle" data-ov="done-toggle" aria-expanded="' + (ui.showDone ? "true" : "false") + '">' + (ui.showDone ? "Hide" : "Show") + ' done today (' + done.length + ')</button>' + (ui.showDone ? '<ul class="po-rem">' + done.map(function (it) { return rowHtml(it, topIds, g); }).join("") + '</ul>' : "");
    body += '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="go-calendar">Open Calendar</button></div>';
    return card("rest", "Rest of today", body);
  }

  function habitRow(r) {
    if (r.target > 1) {
      return '<li class="po-h' + (r.done ? " is-done" : "") + '"><span class="po-h-name">' + esc(r.name) + (r.time ? '<span class="ov-rsub">' + esc(C.timeLabel(r.time)) + '</span>' : "") + '</span>' +
        '<span class="po-step"><button type="button" class="po-stepbtn" data-ov="habit-step" data-id="' + esc(r.id) + '" data-d="-1" aria-label="One less: ' + esc(r.name) + '"' + (r.count <= 0 || !r.editable ? " disabled" : "") + '>&minus;</button><span class="po-count" aria-label="' + r.count + ' of ' + r.target + ' today">' + r.count + '/' + r.target + '</span><button type="button" class="po-stepbtn" data-ov="habit-step" data-id="' + esc(r.id) + '" data-d="1" aria-label="One more: ' + esc(r.name) + '"' + (r.done || !r.editable ? " disabled" : "") + '>+</button></span></li>';
    }
    return '<li class="po-h' + (r.done ? " is-done" : "") + '"><button type="button" class="po-tick' + (r.done ? " is-done" : "") + '" data-ov="habit" data-id="' + esc(r.id) + '" aria-pressed="' + (r.done ? "true" : "false") + '" aria-label="' + esc((r.done ? "Mark not done: " : "Mark done: ") + r.name) + '"' + (r.editable ? "" : " disabled") + '><span aria-hidden="true">' + (r.done ? "&#10003;" : "") + '</span></button>' +
      '<span class="po-h-name">' + esc(r.name) + (r.time ? '<span class="ov-rsub">' + esc(C.timeLabel(r.time)) + '</span>' : "") + '</span></li>';
  }
  function habitsSection(g) {
    const d = g.detail;
    if (!d) return card("habits", "Habits", '<p class="ov-meta">Habits are not available right now.</p>');
    const rows = [].concat(d.groups.morning, d.groups.afternoon, d.groups.evening, d.groups.anytime).filter(function (r) { return !r.skipped; });
    const total = d.counts.total, done = d.counts.done, pct = total ? Math.round(100 * done / total) : 0;
    const open = rows.filter(function (r) { return !r.done; }), fin = rows.filter(function (r) { return r.done; });
    let body = "";
    if (!rows.length && !d.flexible.length) body = '<p class="ov-meta">No habits are scheduled for today.</p><div class="ov-chips"><button type="button" class="ov-chip" data-ov="habits-add">Add a habit</button></div>';
    else {
      body += total ? '<div class="ov-bar" role="progressbar" aria-label="Habits done today" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' : "";
      body += open.length ? '<ul class="po-hlist">' + open.map(habitRow).join("") + '</ul>' : (total ? '<p class="ov-meta">All of today’s habits are done.</p>' : "");
      if (fin.length) body += '<button type="button" class="ov-more po-done-toggle" data-ov="habits-done-toggle" aria-expanded="' + (ui.showHabitsDone ? "true" : "false") + '">' + (ui.showHabitsDone ? "Hide" : "Show") + ' done (' + fin.length + ')</button>' + (ui.showHabitsDone ? '<ul class="po-hlist">' + fin.map(habitRow).join("") + '</ul>' : "");
      if (d.flexible.length) body += '<h3 class="po-sub">This week</h3><ul class="po-hlist">' + d.flexible.map(function (r) { return '<li class="po-h"><span class="po-h-name">' + esc(r.name) + '</span><span class="po-count">' + (r.week ? r.week.done + " of " + r.week.target : "") + '</span></li>'; }).join("") + '</ul>';
      body += '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="go-habits">Open Habits</button></div>';
    }
    return card("habits", "Habits", body, { head: total ? '<span class="ov-count">' + done + ' of ' + total + '</span>' : "" });
  }

  function strategySection() {
    let body = "";
    try {
      const A = window.JarvisPlanApp, I = window.JarvisPlanInsights;
      if (!A || !I) throw new Error("no strategy");
      A.bump();
      const d = I.dashboard(A.ictx()), m = A.model();
      const line = function (label, n, none, sub) {
        if (!n) return '<li><button type="button" class="po-strat" data-ov="strategy"><span class="po-strat-k">' + esc(label) + '</span><span class="ov-rtitle po-dim">' + esc(none) + '</span></button></li>';
        const p = n.id ? m.progress(n.id) : null, pct = p && typeof p.pct === "number" ? Math.max(0, Math.min(100, Math.round(p.pct))) : null;
        return '<li><button type="button" class="po-strat" data-ov="goal" data-id="' + esc(n.id || "") + '"><span class="po-strat-k">' + esc(label) + '</span><span class="ov-rtitle">' + esc(n.title) + '</span>' +
          (pct === null ? '<span class="ov-rsub">' + esc(sub || "No progress data yet") + '</span>' : '<span class="ov-bar" role="progressbar" aria-label="' + esc(n.title) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></span><span class="ov-rsub">' + pct + '%' + (sub ? " · " + esc(sub) : "") + '</span>') + '</button></li>';
      };
      const wk = d.week.top.filter(function (x) { return !x.done; })[0] || d.week.top[0];
      const ms = d.milestones.filter(function (n) { return m.statusOf(n.id) !== "completed"; })[0] || d.milestones[0];
      const ob = d.objectives.filter(function (n) { return m.statusOf(n.id) !== "completed"; })[0] || d.objectives[0];
      body = '<ul class="po-stratlist">' +
        (wk ? '<li><button type="button" class="po-strat" data-ov="weekly"><span class="po-strat-k">This week</span><span class="ov-rtitle">' + esc(wk.text) + '</span><span class="ov-rsub">' + (wk.done ? "Done" : (d.week.topSuggested ? "Suggested, not saved" : "Top priority this week")) + '</span></button></li>' : line("This week", null, "No weekly priority yet")) +
        line("This month", ms, "No milestone for this month", d.monthStats.milestones ? d.monthStats.milestonesDone + " of " + d.monthStats.milestones + " milestones done" : "") +
        line("This year", ob, "No goal for this year", "") + '</ul>';
    } catch (e) {
      body = '<p class="ov-meta">Strategy is not available right now.</p>';
    }
    return card("strategy", "Strategic progress", body + '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="strategy">Open Strategy</button></div>');
  }

  function dayText(date, today) {
    const n = C.diffDays(today, date);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    return C.fmtDate(date, { weekday: "short", month: "short", day: "numeric" });
  }
  function deadlinesSection(g) {
    const list = OL.deadlines(g.all, g.c.today, { limit: MAX_DEADLINES, days: DEADLINE_DAYS });
    let body = "";
    if (!list.length) body = '<p class="ov-meta">No deadlines or events in the next ' + DEADLINE_DAYS + ' days.</p>';
    else body = '<ul class="ov-list">' + list.map(function (x, i) {
      const sub = x.kind === "repeats" ? "Repeats · " + x.count + (x.count === 1 ? " time" : " times") + " in the next " + DEADLINE_DAYS + " days" : dayText(x.date, g.c.today) + (x.time ? " · " + C.timeLabel(x.time) : "") + (x.kind === "deadline" ? " · due" : "");
      return '<li><button type="button" class="ov-row" data-ov="open" data-key="' + esc(x.key) + '" data-i="' + i + '"><span class="ov-rmain"><span class="ov-rtitle">' + esc(x.title) + '</span><span class="ov-rsub">' + esc(sub) + '</span></span></button></li>';
    }).join("") + '</ul>';
    return card("deadlines", "Upcoming deadlines", body + '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="go-calendar">Open Calendar</button></div>');
  }

  /* ---------------- the toolbar and the layout chooser ---------------- */

  function toolbar(c) {
    return '<div class="po-bar"><p class="po-date">' + esc(C.fmtDate(c.today, { weekday: "long", month: "long", day: "numeric" })) + '</p><div class="po-tools">' +
      '<button type="button" class="btn btn-primary po-tool" data-ov="add">+ Add</button>' +
      '<button type="button" class="btn btn-secondary po-tool" data-ov="search">Search</button>' +
      '<button type="button" class="btn btn-secondary po-tool" data-ov="layout" aria-expanded="' + (ui.layout ? "true" : "false") + '" aria-controls="poLayout">Layout · ' + esc(OL.LAYOUT_LABEL[prefs.layout]) + '</button></div></div>';
  }
  function layoutPanel() {
    if (!ui.layout) return "";
    const seg = ["simple", "balanced", "advanced", "custom"].map(function (k) { return '<button type="button" class="po-seg-btn" data-ov="layout-set" data-id="' + k + '" aria-pressed="' + (prefs.layout === k ? "true" : "false") + '">' + esc(OL.LAYOUT_LABEL[k]) + '</button>'; }).join("");
    let list = "";
    if (prefs.layout === "custom") {
      const shown = OL.sectionsFor(prefs);
      list = '<ul class="po-secs">' + prefs.order.map(function (id) {
        const s = OL.SECTIONS.filter(function (x) { return x.id === id; })[0], on = shown.indexOf(id) !== -1, at = shown.indexOf(id);
        return '<li class="po-sec"><label class="po-sec-l"><input type="checkbox" data-ov="sec-toggle" data-id="' + id + '"' + (on ? " checked" : "") + '> ' + esc(s.label) + '</label>' +
          (on ? '<button type="button" class="po-more" data-ov="sec-up" data-id="' + id + '" aria-label="Move ' + esc(s.label) + ' up"' + (at === 0 ? " disabled" : "") + '>&uarr;</button><button type="button" class="po-more" data-ov="sec-down" data-id="' + id + '" aria-label="Move ' + esc(s.label) + ' down"' + (at === shown.length - 1 ? " disabled" : "") + '>&darr;</button>' : "") + '</li>';
      }).join("") + '</ul>';
    }
    const about = prefs.layout === "simple" ? "Next action, top three and what is left of today." : prefs.layout === "balanced" ? "Adds the numbers, habits and strategic progress." : prefs.layout === "advanced" ? "Everything, including upcoming deadlines." : "Choose which sections show and in what order.";
    return '<section class="card ov-card po-card po-wide" id="poLayout" aria-labelledby="po_layout"><h2 class="ov-title" id="po_layout">Overview layout</h2><div class="po-seg" role="group" aria-label="Layout">' + seg + '</div><p class="ov-meta">' + esc(about) + '</p>' + list +
      '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="layout-close">Done</button></div></section>';
  }
  function noteHtml() {
    if (!note) return "";
    return '<p class="po-note" role="status"><span>' + esc(note.text) + '</span>' + (note.undo ? '<button type="button" class="btn btn-secondary" data-ov="undo">Undo</button>' : "") + '</p>';
  }

  /* ---------------- drawing ---------------- */

  function fk(el) { return el.getAttribute("data-ov") + "|" + (el.getAttribute("data-key") || el.getAttribute("data-id") || el.getAttribute("data-i") || "") + (el.getAttribute("data-d") || ""); }

  function render() {
    const root = $("poRoot");
    if (!root || !core()) return;
    if (!prefs) loadPrefs();
    const focusKey = document.activeElement && root.contains(document.activeElement) && document.activeElement.getAttribute("data-ov") ? fk(document.activeElement) : "";
    let html = "";
    try {
      if (!cal() || !C || !OL) throw new Error("no calendar");
      const g = gather(), ids = OL.sectionsFor(prefs);
      const habitIdsOnHabits = ids.indexOf("habits") !== -1;
      const rem = OL.remaining(g.todayItems, g.c.nowMin);
      const nx = OL.upNext(g.todayItems, g.c.nowMin);
      const topIds = {}; g.top.forEach(function (s) { if (s.taskId) topIds[s.taskId] = true; });
      const st = OL.stats({ today: g.c.today, weekDates: g.weekDates, tasks: g.tasks, habitIds: g.habitIds, habits: g.detail ? g.detail.counts : { done: 0, total: 0 }, freeMin: g.freeMin });
      const make = {
        stats: function () { return statsSection(g, st); },
        next: function () { return nextSection(g, rem, nx, topIds); },
        heads: function () { return headsSection(g); },
        top: function () { return topSection(g); },
        remaining: function () { return remainingSection(g, rem, nx ? nx.item : null, topIds, habitIdsOnHabits); },
        habits: function () { return habitsSection(g); },
        strategy: strategySection,
        deadlines: function () { return deadlinesSection(g); }
      };
      html = toolbar(g.c) + noteHtml() + layoutPanel() + (ids.length ? ids.map(function (id) { return make[id](); }).join("") : '<p class="ov-meta po-wide">No sections are showing. Open Layout to choose some.</p>');
      last = { items: g.all, g: g };
    } catch (e) {
      html = '<p class="ov-meta po-wide">The planner is not available right now.</p>';
      last = { items: [], g: null };
    }
    root.innerHTML = html;
    if (focusKey) {
      const again = Array.prototype.filter.call(root.querySelectorAll("[data-ov]"), function (el) { return fk(el) === focusKey && !el.disabled; })[0];
      if (again) again.focus({ preventScroll: true });
    }
  }
  let last = { items: [], g: null };

  /* ---------------- acting ---------------- */

  function setNote(text, undo) {
    window.clearTimeout(noteTimer);
    note = { text: text, undo: undo || null };
    noteTimer = window.setTimeout(function () { note = null; if (panelActive()) render(); }, NOTE_MS);
    render();
  }
  function clearNote() { window.clearTimeout(noteTimer); note = null; }
  function itemByKey(key) {
    const c = clock(), fresh = cal() ? cal().planItems(c.today, C.addDays(c.today, DEADLINE_DAYS - 1)) : [];
    return fresh.filter(function (it) { return it.key === key; })[0] || last.items.filter(function (it) { return it.key === key; })[0] || null;
  }

  function complete(key, undoable) {
    const it = itemByKey(key), calx = cal();
    if (!it || !calx) return;
    calx.toggleItem(it);
    render();
    if (undoable) {
      const after = itemByKey(key);
      if (after && after.completed !== it.completed) setNote((after.completed ? "Done: " : "Not done: ") + it.title + ".", function () { const cur = itemByKey(key); if (cur) cal().toggleItem(cur); render(); });
    }
  }
  function toggleTaskById(id) {
    const H = habits(); if (!H) return;
    const t = H.getTasks().filter(function (x) { return x.id === id; })[0]; if (!t) return;
    H.commitTasks(H.getTasks().map(function (x) { return x.id === id ? Object.assign({}, x, { completed: !x.completed }) : x; }));
    setNote((t.completed ? "Not done: " : "Done: ") + t.text + ".", function () { const h2 = habits(); h2.commitTasks(h2.getTasks().map(function (x) { return x.id === id ? Object.assign({}, x, { completed: !!t.completed }) : x; })); render(); });
  }

  function reschedule(key, opener) {
    const it = itemByKey(key); if (!it) return;
    const c = clock(), rows = [];
    const later = rounded(c.nowMin + 60);
    if ((it.source === "task" || it.source === "habit") && later <= 1425) rows.push({ key: "later", label: "Later today", sub: C.timeLabel(timeOf(later)) });
    if (it.source === "task") rows.push({ key: "tomorrow", label: "Tomorrow", sub: it.time ? "Same time, " + C.timeLabel(it.time) : "No time set" });
    rows.push({ key: "pick", label: "Pick a day and time…", sub: "Opens it so you can change it" });
    window.JarvisMenu.open({
      title: "Reschedule", opener: opener, rows: rows,
      onPick: function (pick) {
        const H = habits();
        if (pick === "pick") { cal().openItem(it); return; }
        if (it.source === "task" && H) {
          const before = H.getTasks().filter(function (x) { return x.id === it.id; })[0]; if (!before) return;
          const patch = pick === "later" ? { time: timeOf(later), date: c.today } : { date: C.addDays(c.today, 1) };
          H.commitTasks(H.getTasks().map(function (x) { return x.id === it.id ? Object.assign({}, x, patch) : x; }));
          setNote(pick === "later" ? "Moved “" + it.title + "” to " + C.timeLabel(timeOf(later)) + "." : "Moved “" + it.title + "” to tomorrow.", function () { const h2 = habits(); h2.commitTasks(h2.getTasks().map(function (x) { return x.id === it.id ? before : x; })); render(); });
        } else if (it.source === "habit" && H && pick === "later") {
          const r = H.moveHabitDay(it.id, it.occDate, timeOf(later));
          if (!r.ok) { core().showToast(r.error || "That couldn't be moved."); return; }
          const oldTime = it.time;
          setNote("Moved “" + it.title + "” to " + C.timeLabel(timeOf(later)) + " today only.", function () { const u = habits().moveHabitDay(it.id, it.occDate, oldTime); if (!u.ok) core().showToast(u.error || "That couldn't be undone."); render(); });
        }
      }
    });
  }

  function topMenu(index, opener) {
    const g = last.g; if (!g) return;
    const s = g.top[index]; if (!s) return;
    window.JarvisMenu.open({
      title: "Top three", opener: opener,
      rows: [{ key: "change", label: "Choose a different task" }, { key: "remove", label: "Remove from top three", minor: true }],
      onPick: function (key) {
        const P = planner();
        if (key === "change") pickTop(index, opener);
        else if (key === "remove" && P) { const r = P.saveDay(g.c.today, { type: "top", index: index, taskId: "", text: "" }); if (!r.ok) core().showToast(r.error || "That couldn't be saved."); else setNote("Removed from the top three."); }
      }
    });
  }
  function openTasksToday(g) {
    const used = {}; g.top.forEach(function (s) { if (s.taskId) used[s.taskId] = true; });
    return g.tasks.filter(function (t) { return t && t.text && t.date === g.c.today && !t.completed && !used[t.id] && !(t.habitId && g.habitIds[t.habitId]); });
  }
  function pickTop(index, opener) {
    const g = last.g, P = planner(); if (!g || !P) return;
    if (!openTasksToday(g).length) { setNote("No open tasks for today. Add one, then choose it here."); return; }
    P.pickTop(index, opener, g.c.today);
  }
  function suggest(opener) {
    const g = last.g, A = window.JarvisPlanApp, P = planner();
    if (!g || !A || !A.openSheet || !P) return;
    const used = {}; g.top.forEach(function (s) { if (s.taskId) used[s.taskId] = true; });
    const ranked = rankOf(g).list.filter(function (r) { return !used[r.task.id]; }).slice(0, MAX_TOP_PICKS);
    if (!ranked.length) { setNote("Nothing to suggest yet. Add tasks for today first."); return; }
    const body = '<p class="sp-dim">Ranked by written rules from your goals, deadlines, priorities and estimates. It is not an AI. You can always choose any task yourself.</p><ul class="po-sgs">' + ranked.map(function (r) {
      return '<li class="po-sg"><div class="po-sg-row"><div class="po-sg-main"><span class="sp-kid-t">' + esc(r.task.text) + '</span><span class="sp-dim">' + esc(r.short) + '</span></div>' +
        '<button type="button" class="btn btn-secondary" data-sheet-act="use" data-id="' + esc(r.task.id) + '" aria-label="' + esc("Use " + r.task.text) + '">Use</button></div>' +
        '<details class="po-why"><summary>Why?</summary><ul>' + window.JarvisPlanInsights.whyLines(r).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join("") + '</ul></details></li>';
    }).join("") + '</ul>';
    A.openSheet({
      title: "Suggested for today", body: body,
      onAct: function (act, el) {
        if (act !== "use") return;
        const slot = g.top.filter(function (x) { return x.empty; })[0];
        const t = g.taskById[el.getAttribute("data-id")];
        A.closeSheet(true);
        if (!slot) { setNote("The top three are full."); return; }
        if (!t) return;
        const r = P.saveDay(g.c.today, { type: "top", index: slot.index, taskId: t.id, text: t.text });
        if (!r.ok) core().showToast(r.error || "That couldn't be saved."); else setNote("Added “" + t.text + "” to your top three.");
      }
    });
  }

  function go(main, sub) { const f = core().openScreen; if (f) f(main, sub); }

  function onClick(e) {
    const el = e.target.closest ? e.target.closest("[data-ov]") : null;
    if (!el || el.disabled) return;
    const act = el.getAttribute("data-ov"), key = el.getAttribute("data-key"), id = el.getAttribute("data-id"), Q = window.JarvisPlanQuick;
    const g = last.g;
    if (act === "add") { if (Q) Q.openAdd({ from: "overview", date: g ? g.c.today : undefined, opener: el }); }
    else if (act === "search") { if (Q) Q.openSearch({ opener: el }); }
    else if (act === "layout") { ui.layout = !ui.layout; render(); const b = document.querySelector('#poRoot [data-ov="layout"]'); if (b) b.focus({ preventScroll: true }); }
    else if (act === "layout-close") { ui.layout = false; render(); const b = document.querySelector('#poRoot [data-ov="layout"]'); if (b) b.focus({ preventScroll: true }); }
    else if (act === "layout-set") { if (savePrefs(id === "custom" ? OL.toCustom(prefs) : OL.setLayout(prefs, id))) render(); }
    else if (act === "sec-up" || act === "sec-down") { if (savePrefs(OL.move(prefs, id, act === "sec-up" ? -1 : 1))) render(); }
    else if (act === "start") { const it = itemByKey(key); if (it && window.JarvisFocus) window.JarvisFocus.start(focusArgs(it, g || gather(), el)); else core().showToast("The focus timer isn't available right now."); }
    else if (act === "complete" || act === "tick") complete(key, true);
    else if (act === "reschedule") reschedule(key, el);
    else if (act === "open") { const it = itemByKey(key); if (it && cal()) cal().openItem(it); }
    else if (act === "top-pick") pickTop(Number(el.getAttribute("data-i")), el);
    else if (act === "top-menu") topMenu(Number(el.getAttribute("data-i")), el);
    else if (act === "top-tick") toggleTaskById(id);
    else if (act === "top-open") { const s = g ? g.top[Number(el.getAttribute("data-i"))] : null; if (s && s.taskId && planner()) planner().openTask({ id: s.taskId }); }
    else if (act === "suggest") suggest(el);
    else if (act === "heads-go") {
      const kind = el.getAttribute("data-kind"), it = key ? itemByKey(key) : null;
      if ((kind === "overlap" || kind === "overload") && window.JarvisAssistant) { go("navBtnCalendar"); window.JarvisAssistant.open(el); }
      else if (it && cal()) cal().openItem(it);
    }
    else if (act === "more-remaining") { ui.showAllRemaining = !ui.showAllRemaining; render(); }
    else if (act === "more-anytime") { ui.showAllAnytime = !ui.showAllAnytime; render(); }
    else if (act === "done-toggle") { ui.showDone = !ui.showDone; render(); }
    else if (act === "habits-done-toggle") { ui.showHabitsDone = !ui.showHabitsDone; render(); }
    else if (act === "habit") {
      const H = habits(), c = clock(), row = g && g.detail ? [].concat(g.detail.groups.morning, g.detail.groups.afternoon, g.detail.groups.evening, g.detail.groups.anytime).filter(function (r) { return r.id === id; })[0] : null;
      if (!H || !row) return;
      const r = H.setHabitDay(id, c.today, !row.done);
      if (!r.ok) { core().showToast(r.error || "That couldn't be saved."); render(); return; }
      setNote((row.done ? "Not done: " : "Done: ") + row.name + ".", function () { const u = habits().setHabitDay(id, clock().today, !!row.done); if (!u.ok) core().showToast(u.error || "That couldn't be undone."); render(); });
    } else if (act === "habit-step") {
      const H = habits(); if (!H) return;
      const d = Number(el.getAttribute("data-d")), r = H.stepHabitDay(id, clock().today, d);
      if (!r.ok) core().showToast(r.error || "That couldn't be saved."); else render();
    }
    else if (act === "go-calendar" || act === "go-week") go("navBtnCalendar");
    else if (act === "go-habits") go("navBtnHabits", "habitsSubNavToday");
    else if (act === "habits-add") go("navBtnHabits", "habitsSubNavRoutines");
    else if (act === "strategy" || act === "goal") { go("navBtnStrategy"); if (act === "goal" && window.JarvisPlan && window.JarvisPlan.go) window.JarvisPlan.go("goals"); }
    else if (act === "weekly") { go("navBtnStrategy"); if (window.JarvisPlan && window.JarvisPlan.go) window.JarvisPlan.go("weekly"); }
    else if (act === "undo") { const fn = note && note.undo; clearNote(); if (fn) fn(); else render(); }
  }

  function onChange(e) {
    const el = e.target;
    if (el && el.getAttribute && el.getAttribute("data-ov") === "sec-toggle") { if (savePrefs(OL.toggle(prefs, el.getAttribute("data-id")))) render(); }
  }

  function onShow() { loadPrefs(); render(); }

  function init() {
    const root = $("poRoot");
    if (!root || started || !C || !OL) return;
    started = true;
    loadPrefs();
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    ["jarvis-calendar-changed", "jarvis-habits-day-changed", "jarvis-habits-changed", "jarvis-tasks-changed", "jarvis-focus-changed", "jarvis-goals-changed"].forEach(function (name) {
      document.addEventListener(name, function () { if (panelActive()) render(); });
    });
    try {
      const A = window.JarvisPlanApp;
      if (A && A.store && A.store.subscribe) A.store.subscribe(function () { if (panelActive()) render(); });
    } catch (e) { /* the Strategy tab is optional here */ }
    document.addEventListener("visibilitychange", function () { if (!document.hidden && panelActive()) render(); });
    // Keeps "up next" and the free time right as the day goes on, but never redraws under a finger that is on a control here.
    window.setInterval(function () {
      if (document.hidden || !panelActive()) return;
      if (document.activeElement && root.contains(document.activeElement)) return;
      render();
    }, 60000);
    render();
  }

  // app.js starts this with the other screens, once the saved data has loaded.
  window.JarvisPlanningOverview = { init: init, onShow: onShow, render: render, prefs: function () { return prefs ? Object.assign({}, prefs) : null; } };
})();
