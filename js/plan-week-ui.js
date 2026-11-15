/* ==========================================================================
   JARVIS — Strategic Planning Center: the Weekly view, a CEO time-blocking planner.

   Monday to Sunday across the top, the hours down the side. Your "ingredients" (School, Gratiel, Workout ... with colours you
   choose) are the kinds of time you plan with: drag one onto the week to make a block. A block can hold one of your existing
   tasks; then the task takes that day and time, and ticking either one ticks both. Blocks can repeat, and snap to 30 minutes
   or an hour. Under the grid: your top three for the week, the tasks not yet in a block (and suggested times for them),
   planned vs worked time, and an end-of-week review with carry-forward of what you didn't finish.

   The rules and every figure are in plan-week-logic.js. This file draws them and turns drags and taps into those rules.
   Phones show one day at a time (pick it in the row of days); dragging works with a mouse, and by pressing and holding on touch.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisPlanApp, PL = A.PL, W = window.JarvisPlanWeekLogic, store = A.store, esc = A.esc, state = A.state;
  const CL = window.JarvisCalendarLogic;
  const PX = 1.2;                              // pixels per minute: an hour is 72 px
  let drag = null, dragMoved = false, lastIngredient = "", cachedCtx = null;

  /* ---------------- what the screens read ---------------- */

  function habits() { return window.JarvisHabits || null; }
  function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function weekStart() { if (!state.week) state.week = W.mondayOf(store.today()); return state.week; }
  function calEvents() { return window.JarvisCalendar && window.JarvisCalendar.getEvents ? window.JarvisCalendar.getEvents() : []; }
  function calZone() { try { return window.JarvisCalendar && CL ? CL.viewZone(window.JarvisCalendar.getSettings()) : "UTC"; } catch (e) { return "UTC"; } }
  function wctx(extra) {
    const d = A.data();
    return Object.assign({ weekStart: weekStart(), today: d.today, nowMin: nowMin(), blocks: store.all("blocks"), ingredients: store.all("ingredients"), tasks: d.tasks, links: d.links, settings: d.settings, model: A.model(), events: calEvents(), zone: calZone(), weeks: store.all("weeks") }, extra || {});
  }
  function fmtTime(t) { return CL && CL.timeLabel ? CL.timeLabel(t) : t; }
  function hours(min) { return (Math.round(min / 6) / 10) + " h"; }
  function ingColor(c, id) { const i = id ? W.ingredientById(c.ingredients, id) : null; return i ? i.color : "#94a3b8"; }
  function ingName(c, id) { const i = id ? W.ingredientById(c.ingredients, id) : null; return i ? i.name : "No ingredient"; }
  function dayLabel(date) { return W.DAY_SHORT[W.weekday(date)] + " " + date.slice(5, 7).replace(/^0/, "") + "/" + date.slice(8).replace(/^0/, ""); }
  function weekTitle(ws) {
    const a = new Date(ws + "T12:00:00"), b = new Date(PL.addDays(ws, 6) + "T12:00:00");
    const f = function (d, y) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: y ? "numeric" : undefined }); };
    return f(a, false) + " – " + f(b, true);
  }

  /* ---------------- saving ---------------- */

  function applyTaskPatches(patches) {
    const h = habits();
    if (!h || !h.commitTasks || !patches.length) return;
    const by = {}; patches.forEach(function (p) { by[p.taskId] = p; });
    h.commitTasks(A.tasks().map(function (t) { return by[t.id] ? Object.assign({}, t, { date: by[t.id].date, time: by[t.id].time }) : t; }));
  }
  // Saves the blocks, then gives the tasks in them their new day and time. -> true / false
  function saveBlocks(next, patches) {
    if (!store.replace("blocks", next)) { A.saveFailed(); return false; }
    applyTaskPatches(patches || []);
    return true;
  }
  // A task moved elsewhere (Habits, Calendar) takes its block along; a task deleted there lets its block go on plainly.
  function reconcile() {
    store.init();
    const cur = store.all("blocks");
    if (!cur.length) return;
    const next = W.followTasks(cur, A.tasks(), {});
    if (next !== cur) store.replace("blocks", next);
  }
  document.addEventListener("jarvis-tasks-changed", reconcile);

  /* ---------------- drawing the week ---------------- */

  function headHtml(c) {
    const ws = c.weekStart, isThis = ws === W.mondayOf(c.today);
    return '<div class="sp-head"><div class="sp-stepper"><button type="button" class="btn btn-secondary" data-act="week-nav" data-dir="-1" aria-label="Previous week">‹</button><span class="sp-stepper-label pw-week-label" data-focus-top>' + esc(weekTitle(ws)) + '</span><button type="button" class="btn btn-secondary" data-act="week-nav" data-dir="1" aria-label="Next week">›</button></div>' +
      '<div class="sp-head-btns">' + (isThis ? "" : '<button type="button" class="btn btn-secondary" data-act="week-today">This week</button>') +
      '<button type="button" class="btn btn-secondary" data-act="week-interval" aria-pressed="' + (c.settings.interval === 60) + '">' + (c.settings.interval === 60 ? "Hourly blocks" : "30-minute blocks") + '</button>' +
      '<button type="button" class="btn btn-primary" data-act="block-new">Add block</button></div></div>';
  }

  function alertsHtml(c) {
    const cap = W.capacity(c), late = W.unscheduledHigh(c);
    if (!cap.warnings.length && !late.length) return "";
    let h = '<section class="sp-alert pw-alerts" role="region" aria-label="Heads up for this week"><h3 class="sp-h3">Heads up</h3><ul class="sp-sublist">';
    cap.warnings.forEach(function (w) { h += '<li>' + esc(w.message) + '</li>'; });
    late.forEach(function (t) { h += '<li>High priority and not scheduled: “' + esc(t.text) + '” (' + esc(dayLabel(t.date)) + ') <button type="button" class="btn btn-secondary" data-act="task-schedule" data-id="' + esc(t.id) + '" aria-label="Schedule ' + esc(t.text) + '">Schedule</button></li>'; });
    return h + '</ul></section>';
  }

  /* ---- the grid ---- */
  function axisBounds(c, occ) {
    const w = W.winOf(c.settings);
    let s = w.start, e = w.end;
    occ.forEach(function (o) { s = Math.min(s, Math.floor(o.startMin / 60) * 60); e = Math.max(e, Math.ceil(o.endMin / 60) * 60); });
    return { start: s, end: Math.min(1440, e), interval: w.interval };
  }
  function blockHtml(seg, c, bounds) {
    const o = seg.item, t = o.taskId ? c.tasks.filter(function (x) { return x.id === o.taskId; })[0] : null;
    const title = t ? t.text : o.title, color = ingColor(c, o.ingredientId);
    const done = t ? !!t.completed : o.done;
    const top = (seg.startMin - bounds.start) * PX, h = Math.max(18, (seg.endMin - seg.startMin) * PX - 2);
    const past = o.date < c.today || (o.date === c.today && o.endMin <= c.nowMin);
    const len = o.endMin - o.startMin;
    const work = o.workedMin !== null ? o.workedMin + " of " + len + " min" : (past && !done ? "not logged" : "");
    const label = title + ", " + W.DAY_NAMES[W.weekday(o.date)] + " " + fmtTime(o.start) + " to " + fmtTime(o.end) + ", " + ingName(c, o.ingredientId) + (t ? ", task" : "") + (done ? ", done" : "") + (o.recurring ? ", repeats" : "") + ". Press Enter to edit.";
    return '<div class="pw-block' + (done ? " is-done" : "") + (past && !done && o.workedMin === null ? " is-missed" : "") + '" role="button" tabindex="0" data-drag="block" data-block="' + esc(o.blockId) + '" data-date="' + o.date + '" data-len="' + len + '" aria-label="' + esc(label) + '" ' +
      'style="top:' + top + 'px;height:' + h + 'px;left:calc(' + (100 * seg.col / seg.cols) + '% + 2px);width:calc(' + (100 / seg.cols) + '% - 4px);--c:' + color + ';--bg:' + W.tint(color, 0.24) + '">' +
      '<span class="pw-b-main"><span class="pw-b-title">' + esc(title) + '</span>' + (h >= 40 ? '<span class="pw-b-time">' + esc(fmtTime(o.start)) + ' – ' + esc(fmtTime(o.end)) + (o.recurring ? " · repeats" : "") + '</span>' : "") + (h >= 58 && work ? '<span class="pw-b-work">' + esc(work) + '</span>' : "") + '</span>' +
      '<input type="checkbox" class="pw-b-check" data-act="block-done" data-block="' + esc(o.blockId) + '" data-date="' + o.date + '"' + (t ? ' data-task="' + esc(t.id) + '"' : "") + (done ? " checked" : "") + ' aria-label="' + (t ? "Task done: " : "Done: ") + esc(title) + '">' +
      '<span class="pw-resize" data-drag="resize" aria-hidden="true"></span></div>';
  }
  function busyHtml(date, c, bounds) {
    return W.busyOn(date, c).filter(function (b) { return b.kind !== "block"; }).map(function (b) {
      const top = (Math.max(b.start, bounds.start) - bounds.start) * PX, h = Math.max(14, (Math.min(b.end, bounds.end) - Math.max(b.start, bounds.start)) * PX - 1);
      return '<div class="pw-busy" style="top:' + top + 'px;height:' + h + 'px" title="' + esc((b.kind === "event" ? "Calendar: " : "Task at " + W.toTime(b.start) + ": ") + b.title) + '"><span>' + esc(b.title) + '</span></div>';
    }).join("");
  }
  function gridHtml(c, occ) {
    const dates = W.weekDates(c.weekStart), bounds = axisBounds(c, occ), height = (bounds.end - bounds.start) * PX;
    if (!state.day || dates.indexOf(state.day) === -1) state.day = dates.indexOf(c.today) !== -1 ? c.today : dates[0];
    let h = '<div class="pw-board" style="--hr:' + (bounds.interval * PX) + 'px"><div class="pw-heads"><div class="pw-corner" aria-hidden="true"></div>';
    dates.forEach(function (d) {
      const n = occ.filter(function (o) { return o.date === d; }).length;
      h += '<button type="button" class="pw-head' + (d === c.today ? " is-today" : "") + (d === state.day ? " is-sel" : "") + '" data-act="pick-day" data-date="' + d + '" aria-pressed="' + (d === state.day) + '"><span class="pw-head-day">' + W.DAY_SHORT[W.weekday(d)] + '</span><span class="pw-head-date">' + Number(d.slice(8)) + '</span><span class="pw-head-n">' + (n ? A.plural(n, "block") : "") + '</span></button>';
    });
    h += '</div><div class="pw-body" style="height:' + height + 'px"><div class="pw-axis" aria-hidden="true">';
    for (let m = Math.ceil(bounds.start / 60) * 60; m < bounds.end; m += 60) h += '<span style="top:' + ((m - bounds.start) * PX) + 'px">' + esc(CL && CL.hourLabel ? CL.hourLabel(m / 60) : fmtTime(W.toTime(m))) + '</span>';
    h += '</div>';
    dates.forEach(function (d) {
      const items = occ.filter(function (o) { return o.date === d; }).map(function (o) { return Object.assign({}, o, { allDay: false, endDate: o.date }); });
      const segs = CL.layoutDay(items, d, 15);
      h += '<div class="pw-col' + (d === c.today ? " is-today" : "") + (d === state.day ? " is-sel" : "") + '" data-col data-date="' + d + '" data-top="' + bounds.start + '" role="group" aria-label="' + W.DAY_NAMES[W.weekday(d)] + " " + d + '">' + busyHtml(d, c, bounds) + segs.map(function (s) { return blockHtml(s, c, bounds); }).join("");
      if (d === c.today && c.nowMin >= bounds.start && c.nowMin <= bounds.end) h += '<div class="pw-now" style="top:' + ((c.nowMin - bounds.start) * PX) + 'px" aria-hidden="true"></div>';
      h += '</div>';
    });
    return h + '</div></div>';
  }

  /* ---- ingredients ---- */
  function ingredientsHtml(c) {
    const list = W.liveIngredients(c.ingredients);
    let h = '<aside class="pw-side" aria-label="Ingredients"><h3 class="sp-h3">Ingredients</h3><p class="sp-dim pw-side-hint">Drag one onto the week to make a block, or tap it to add one to the day you are looking at.</p>';
    if (!list.length) h += '<p class="sp-dim">Ingredients are the kinds of time you plan with.</p><button type="button" class="btn btn-primary" data-act="ing-starters">Add School, Gratiel, Workout, Studying, Personal and Rest</button>';
    else h += '<ul class="pw-ings">' + list.map(function (i) {
      return '<li class="pw-ing" data-drag="ingredient" data-id="' + esc(i.id) + '" style="--c:' + i.color + '"><button type="button" class="pw-ing-add" data-act="ing-add-block" data-id="' + esc(i.id) + '" aria-label="Add a ' + esc(i.name) + ' block"><span class="pw-dot" aria-hidden="true"></span><span class="pw-ing-name">' + esc(i.name) + '</span></button><button type="button" class="btn btn-secondary pw-ing-edit" data-nodrag data-act="ing-edit" data-id="' + esc(i.id) + '" aria-label="Edit ' + esc(i.name) + '">Edit</button></li>';
    }).join("") + '</ul>';
    h += '<div class="pw-side-actions"><button type="button" class="btn btn-secondary" data-act="ing-new">New ingredient</button>' + (list.length && list.length < W.STARTERS.length + 4 && W.STARTERS.some(function (s) { return !list.some(function (x) { return x.id === s.id; }); }) ? '<button type="button" class="btn btn-secondary" data-act="ing-starters">Add the starter set</button>' : "") + '</div>' + tasksHtml(c) + '</aside>';
    return h;
  }

  /* ---- tasks that are not in a block yet ---- */
  function unscheduledTasks(c) {
    const dates = W.weekDates(c.weekStart);
    return c.tasks.filter(function (t) { return t && !t.completed && dates.indexOf(t.date) !== -1 && !W.scheduledBlock(c.blocks, t); })
      .sort(function (a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || ({ high: 0, medium: 1, low: 2 }[a.priority] || 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] || 1) || (a.order || 0) - (b.order || 0); });
  }
  function tasksHtml(c) {
    const list = unscheduledTasks(c);
    let h = '<section class="pw-side-tasks" aria-label="Tasks not yet in a block"><h3 class="sp-h3">Tasks to schedule <span class="sp-dim">(' + list.length + ')</span></h3>';
    if (!list.length) return h + '<p class="sp-dim pw-side-hint">Every open task dated this week is in a block, or you have none. Tasks come from Habits; add them under Monthly or on any plan item.</p></section>';
    h += '<p class="sp-dim pw-side-hint">Drag a task onto the week, or tap Schedule. The task takes that day and time.</p><ul class="pw-tasks">';
    list.slice(0, 40).forEach(function (t) {
      const l = PL.linkOf(c.links, t.id), n = c.model.nodeOfTask(t.id);
      h += '<li class="pw-task" data-drag="task" data-id="' + esc(t.id) + '"><span class="pw-task-text">' + esc(t.text) + '</span><span class="pw-task-meta">' + esc(dayLabel(t.date)) + (t.priority === "high" ? " · high" : "") + (l && l.estMin ? " · " + l.estMin + " min" : "") + (n ? " · " + esc(n.title) : "") + '</span>' +
        '<button type="button" class="btn btn-secondary pw-task-btn" data-nodrag data-act="task-schedule" data-id="' + esc(t.id) + '" aria-label="Schedule ' + esc(t.text) + '">Schedule</button></li>';
    });
    return h + '</ul>' + (list.length > 40 ? '<p class="sp-dim">Showing the first 40.</p>' : "") + '</section>';
  }
  function suggestHtml(c) {
    const s = W.suggest(c);
    if (!s.length) return "";
    const ings = W.liveIngredients(c.ingredients);
    let h = '<section class="sp-panel" aria-label="Suggested times"><h3 class="sp-h3">Suggested times</h3><p class="sp-dim">The first free time around your blocks, calendar events and timed tasks. Nothing is scheduled until you press Schedule.</p>';
    if (ings.length) h += '<div class="sp-inline"><label for="pwSuggestIng">Plan them as</label><select id="pwSuggestIng" data-pw-suggest-ing>' + '<option value="">No ingredient</option>' + ings.map(function (i) { return '<option value="' + esc(i.id) + '"' + (i.id === lastIngredient ? " selected" : "") + '>' + esc(i.name) + '</option>'; }).join("") + '</select></div>';
    h += '<ul class="sp-sublist pw-suggest">';
    s.forEach(function (x) {
      h += '<li><span class="pw-sg-text"><strong>' + esc(x.text) + '</strong> ' + (x.none ? "" : '→ ' + esc(dayLabel(x.date)) + " " + esc(fmtTime(x.start)) + '–' + esc(fmtTime(x.end))) + '<span class="sp-dim pw-sg-why">' + esc(x.reason) + '</span></span>' +
        (x.none ? "" : '<button type="button" class="btn btn-secondary" data-act="suggest-apply" data-id="' + esc(x.taskId) + '" data-date="' + x.date + '" data-start="' + x.start + '" data-end="' + x.end + '" aria-label="Schedule ' + esc(x.text) + ' on ' + esc(dayLabel(x.date)) + '">Schedule</button>') + '</li>';
    });
    h += '</ul>';
    const ok = s.filter(function (x) { return !x.none; });
    if (ok.length > 1) h += '<button type="button" class="btn btn-secondary" data-act="suggest-all">Schedule all ' + ok.length + '</button>';
    return h + '</section>';
  }

  /* ---- top three ---- */
  function topHtml(c) {
    const wk = W.weekOf(c.weeks, c.weekStart), saved = wk ? W.readWeek(wk).top : [];
    let h = '<section class="sp-panel pw-top" aria-label="Top three this week"><h3 class="sp-h3">Top three this week</h3>';
    if (saved.length) {
      h += '<ol class="pw-top-list">' + saved.map(function (x, i) {
        const t = x.taskId ? c.tasks.filter(function (k) { return k.id === x.taskId; })[0] : null, label = t ? t.text : (x.text || "A task that was deleted");
        return '<li class="' + (t && t.completed ? "is-done" : "") + '">' + (t ? '<label class="sp-task-check"><input type="checkbox" data-act="task-toggle" data-id="' + esc(t.id) + '"' + (t.completed ? " checked" : "") + '><span class="sp-task-text">' + esc(label) + '</span></label>' : '<span class="sp-task-text">' + esc(label) + '</span>') +
          (t && c.model.nodeOfTask(t.id) ? '<span class="sp-dim"> · ' + esc(c.model.nodeOfTask(t.id).title) + '</span>' : "") + '<button type="button" class="btn btn-secondary" data-act="top-remove" data-i="' + i + '" aria-label="Remove ' + esc(label) + ' from the top three">Remove</button></li>';
      }).join("") + '</ol>';
      h += '<button type="button" class="btn btn-secondary" data-act="top-edit">Choose again</button>';
    } else {
      const sug = W.topThree(c);
      if (!sug.length) return h + '<p class="sp-dim">You have no open tasks to rank. Add some under Monthly, or in Habits.</p><button type="button" class="btn btn-secondary" data-act="top-edit">Write my own</button></section>';
      h += '<p class="sp-dim">A starting list from your open tasks: priority, what carried over, and what moves a plan item that is behind. It is a suggestion; you choose.</p><ol class="pw-top-list">' + sug.map(function (x) {
        return '<li><span class="sp-task-text">' + esc(x.task.text) + '</span><span class="sp-dim pw-sg-why">' + esc(x.reasons.join(" · ")) + '</span></li>';
      }).join("") + '</ol><div class="sp-card-actions"><button type="button" class="btn btn-primary" data-act="top-use">Use these three</button><button type="button" class="btn btn-secondary" data-act="top-edit">Choose my own</button></div>';
    }
    return h + '</section>';
  }

  /* ---- the numbers and the review ---- */
  function statsHtml(c, st) {
    let h = '<section class="sp-panel" aria-label="This week in numbers"><h3 class="sp-h3">This week in numbers</h3><dl class="sp-money">';
    const row = function (l, v) { return '<div class="sp-money-row"><dt>' + esc(l) + '</dt><dd>' + v + '</dd></div>'; };
    h += row("Planned in blocks", esc(hours(st.plannedMin)));
    h += row("Time you logged", st.loggedBlocks ? esc(hours(st.actualMin)) + ' <span class="sp-dim">(' + st.loggedBlocks + ' of ' + st.pastBlocks + ' finished blocks)</span>' : '<span class="sp-dim">' + (st.pastBlocks ? "none logged yet, 0 of " + st.pastBlocks + " finished blocks" : "nothing to log yet") + '</span>');
    h += row("Tasks done", st.tasksTotal ? esc(st.tasksDone + " of " + st.tasksTotal) + ' <span class="sp-dim">(' + st.completionRate + '%)</span>' : '<span class="sp-dim">no tasks dated this week</span>');
    h += row("Blocks finished", st.pastBlocks ? esc(st.blocksDone + " of " + st.pastBlocks) : '<span class="sp-dim">none have ended yet</span>');
    h += row("Tasks that count toward the plan", st.tasksTotal ? esc(st.linkedTasks + " of " + st.tasksTotal) + ' <span class="sp-dim">(' + st.alignmentPct + '%)</span>' : '<span class="sp-dim">–</span>');
    h += '</dl>';
    if (st.allocation.length) {
      h += '<h4 class="sp-h4">Time by ingredient</h4><ul class="pw-alloc">' + st.allocation.map(function (a) {
        return '<li><span class="pw-dot" style="--c:' + a.color + '" aria-hidden="true"></span><span class="pw-alloc-name">' + esc(a.name) + '</span><span class="pw-alloc-n">' + esc(hours(a.planned)) + ' planned' + (a.logged ? ', ' + esc(hours(a.actual)) + ' worked' : "") + ' · ' + a.share + '%</span><span class="sp-bar" style="--c:' + a.color + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + a.share + '" aria-label="' + esc(a.name) + ' share of planned time"><span style="width:' + a.share + '%;background:' + a.color + '"></span></span></li>';
      }).join("") + '</ul>';
    }
    if (st.byNode.length) h += '<h4 class="sp-h4">Where this week\'s tasks go</h4><ul class="sp-sublist">' + st.byNode.map(function (n) { return '<li>' + esc(n.title) + ' <span class="sp-dim">' + n.done + ' of ' + n.tasks + ' done</span></li>'; }).join("") + '</ul>';
    return h + '</section>';
  }
  function reviewHtml(c, st) {
    const wk = W.weekOf(c.weeks, c.weekStart), r = wk ? W.readWeek(wk) : W.readWeek({}), carry = W.carryForward(c), target = W.carryTarget(c);
    let h = '<section class="sp-panel pw-review" aria-label="Weekly review"><h3 class="sp-h3">Weekly review</h3>';
    h += '<p class="sp-dim">' + esc(st.plannedMin ? "You planned " + hours(st.plannedMin) + " and logged " + (st.loggedBlocks ? hours(st.actualMin) : "no time") + "; " : "") + (st.tasksTotal ? st.tasksDone + " of " + st.tasksTotal + " tasks are done." : "no tasks are dated this week.") + (wk && wk.reviewedAt ? " Reviewed " + esc(new Date(wk.reviewedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })) + "." : "") + '</p>';
    h += '<form id="pwReviewForm" class="pw-review-form" novalidate>' +
      '<div class="form-row"><label for="pwWins">What went well?</label><textarea id="pwWins" name="wins" rows="3" maxlength="2000">' + esc(r.wins) + '</textarea></div>' +
      '<div class="form-row"><label for="pwLessons">What got in the way, or what would you change?</label><textarea id="pwLessons" name="lessons" rows="3" maxlength="2000">' + esc(r.lessons) + '</textarea></div>' +
      '<div class="form-row"><label for="pwNext">What matters most next week?</label><textarea id="pwNext" name="nextFocus" rows="3" maxlength="2000">' + esc(r.nextFocus) + '</textarea></div>' +
      '<div class="sp-card-actions"><button type="submit" class="btn btn-primary">Save review</button></div></form>';
    if (carry.length) {
      h += '<h4 class="sp-h4">Unfinished from days that have passed</h4><p class="sp-dim">Tick the ones to carry forward. They move to ' + esc(dayLabel(target)) + ' as plain tasks; nothing moves until you press the button.</p><ul class="sp-tasks pw-carry">' +
        carry.map(function (t) { return '<li class="sp-task"><label class="sp-task-check"><input type="checkbox" name="carry" value="' + esc(t.id) + '" checked><span class="sp-task-text">' + esc(t.text) + '</span></label><span class="sp-task-meta">' + esc(dayLabel(t.date)) + '</span></li>'; }).join("") +
        '</ul><button type="button" class="btn btn-secondary" data-act="carry-apply">Move the ticked tasks to ' + esc(dayLabel(target)) + '</button>';
    } else h += '<p class="sp-dim">Nothing unfinished from the days that have passed.</p>';
    return h + '</section>';
  }

  A.register("weekly", {
    html: function () {
      store.init();
      const c = wctx(); cachedCtx = c;
      const occ = W.occurrences(c.blocks, c.weekStart, PL.addDays(c.weekStart, 6)), st = W.weekStats(c);
      let h = headHtml(c) + alertsHtml(c) + topHtml(c);
      h += '<div class="pw-layout">' + ingredientsHtml(c) + gridHtml(c, occ) + '</div>';
      if (!occ.length && W.liveIngredients(c.ingredients).length) h += '<p class="sp-dim pw-empty">Nothing is planned this week yet. Drag an ingredient or a task onto a day.</p>';
      h += '<div class="pw-panels">' + suggestHtml(c) + statsHtml(c, st) + reviewHtml(c, st) + '</div>';
      return h;
    },
    after: function () { /* the drag handlers are attached once, to the page */ },
    change: function (el) {
      if (el.matches && el.matches("[data-pw-suggest-ing]")) lastIngredient = el.value;
    },
    submit: function () {}
  });

  /* ---------------- sheets: a block, an ingredient ---------------- */

  function timeOptions(c, extra, forEnd) {
    const w = W.winOf(c.settings), out = [], seen = {};
    const push = function (m) { const t = W.toTime(m); if (!seen[t]) { seen[t] = true; out.push([t, fmtTime(t)]); } };
    for (let m = w.start + (forEnd ? w.interval : 0); m <= w.end - (forEnd ? 0 : w.interval); m += w.interval) push(m);
    (extra || []).forEach(function (t) { if (W.isTime(t)) push(W.toMin(t)); });
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    return out;
  }
  function openTaskChoices(c, currentId) {
    return c.tasks.filter(function (t) { return t && t.text && (!t.completed || t.id === currentId); })
      .sort(function (a, b) { return (a.date || "").localeCompare(b.date || "") || (a.order || 0) - (b.order || 0); }).slice(0, 150)
      .map(function (t) { return [t.id, (t.date ? dayLabel(t.date) + " · " : "") + t.text]; });
  }

  // o: { id (to edit), date, start, end, ingredientId, taskId }
  function openBlockSheet(o) {
    const c = wctx(), w = W.winOf(c.settings);
    const cur = o.id ? W.occurrence(c.blocks, o.id, o.date) : null, blk = o.id ? W.blockById(c.blocks, o.id) : null;
    if (o.id && (!cur || !blk)) { A.notice("That block isn't there any more.", ""); return; }
    const date = o.date || c.today;
    const start = cur ? cur.start : (o.start || "09:00"), end = cur ? cur.end : (o.end || W.toTime(Math.min(W.toMin(start) + 60, 1439)));
    const ing = cur ? cur.ingredientId : (o.ingredientId !== undefined ? o.ingredientId : lastIngredient), taskId = cur ? cur.taskId : (o.taskId || "");
    const title = cur ? (blk.taskId ? "" : blk.title) : (o.title || "");
    const ingOpts = [["", "No ingredient"]].concat(W.liveIngredients(c.ingredients).map(function (i) { return [i.id, i.name]; }));
    const t = taskId ? c.tasks.filter(function (x) { return x.id === taskId; })[0] : null;
    const repeats = blk && blk.repeat;
    let body = A.fText("title", "Title", title, { max: 140, placeholder: "Defaults to the task or ingredient name" });
    body += A.fSelect("ingredientId", "Ingredient", ingOpts, ing || "");
    body += A.fSelect("taskId", "Task in this block", [["", "No task"]].concat(openTaskChoices(c, taskId)), taskId, { hint: "The task takes this day and time. A block with a task can't repeat." });
    body += A.fText("date", "Day", date, { type: "date" });
    body += '<div class="form-row two-col"><div><label for="spf_start">Start</label><select id="spf_start" name="start">' + A.optionsHtml(timeOptions(c, [start], false), start) + '</select><p class="sp-err hidden" data-err="start" role="alert"></p></div><div><label for="spf_end">End</label><select id="spf_end" name="end">' + A.optionsHtml(timeOptions(c, [end], true), end) + '</select><p class="sp-err hidden" data-err="end" role="alert"></p></div></div>';
    if (repeats) body += '<fieldset class="pw-scope"><legend>Apply changes to</legend><label><input type="radio" name="scope" value="this" checked> This day only</label><label><input type="radio" name="scope" value="all"> Every time it repeats</label></fieldset>';
    const days = repeats ? repeats.byDay : [W.weekday(date)];
    body += '<div data-for-repeat>' + A.fSelect("repeatFreq", "Repeat", [["", "Does not repeat"], ["weekly", "Weekly"], ["daily", "Every day"]], repeats ? repeats.freq : "") +
      '<div class="form-row pw-days" data-for-weekly><span class="pw-days-label" id="pwDaysL">On</span><div role="group" aria-labelledby="pwDaysL" class="pw-days-row">' + W.WEEK_ORDER.map(function (d) { return '<label class="pw-day-pick"><input type="checkbox" name="repeatDays" data-multi value="' + d + '"' + (days.indexOf(d) !== -1 ? " checked" : "") + '><span>' + W.DAY_SHORT[d] + '</span></label>'; }).join("") + '</div></div>' +
      A.fText("until", "Repeat until (optional)", repeats ? repeats.until : "", { type: "date" }) + '</div>';
    body += A.fArea("notes", "Notes", cur ? blk.notes : "", { rows: 2, max: 1000 });
    if (cur) {
      body += '<h3 class="sp-h4">This day</h3>' + A.fText("worked", "Time you actually worked (minutes)", cur.workedMin === null ? "" : cur.workedMin, { mode: "numeric", placeholder: "Planned: " + (cur.endMin - cur.startMin), hint: "Only what you enter is counted as worked. Leave it empty if you didn't track it." });
      body += '<div class="form-row"><label class="pw-check"><input type="checkbox" name="done"' + ((t ? t.completed : cur.done) ? " checked" : "") + '> ' + (t ? "The task is complete (this ticks it in Habits too)" : "Done") + '</label></div>';
    }
    if (cur) body += '<div class="form-row"><button type="button" class="btn btn-danger" data-sheet-act="delete">Delete this block</button></div>';
    function sync(root) {
      const freq = root.querySelector('[name="repeatFreq"]').value, task = root.querySelector('[name="taskId"]').value;
      const scope = root.querySelector('[name="scope"]:checked');
      const rep = root.querySelector("[data-for-repeat]");
      rep.classList.toggle("hidden", !!task || (!!repeats && scope && scope.value === "this"));
      root.querySelector("[data-for-weekly]").classList.toggle("hidden", freq !== "weekly");
      const dateRow = root.querySelector('[name="date"]').closest(".form-row");
      dateRow.classList.toggle("hidden", !!repeats && scope && scope.value === "all");
    }
    A.openSheet({
      title: cur ? "Edit block" : "New block", body: body, submit: cur ? "Save" : "Add block", focus: '[name="title"]',
      onOpen: sync,
      onChange: function (el, root) { sync(root); },
      onAct: function (act, el, root) { if (act === "delete") { const sc = root.querySelector('[name="scope"]:checked'); A.closeSheet(true); deleteBlock(o.id, o.date, sc ? sc.value : "all"); } },
      onSubmit: function (v) { return saveBlockForm(v, o, cur, blk, c); }
    });
  }

  function saveBlockForm(v, o, cur, blk, c) {
    const patches = [], tasks = c.tasks, cc = { ingredients: c.ingredients, tasks: tasks };
    let blocks = store.all("blocks"), message = "", saved = null;
    const fields = { title: v.title, ingredientId: v.ingredientId, notes: v.notes, start: v.start, end: v.end };
    const days = Array.isArray(v.repeatDays) ? v.repeatDays : [];
    lastIngredient = v.ingredientId || lastIngredient;
    if (!cur) {
      let r;
      if (v.taskId) r = W.placeTask(blocks, v.taskId, { date: v.date, start: v.start, end: v.end, ingredientId: v.ingredientId }, tasks, Object.assign({}, cc));
      else r = W.addBlock(blocks, Object.assign({}, fields, { date: v.date, repeatFreq: v.repeatFreq, repeatDays: days, until: v.until }), cc);
      if (!r.ok) return { ok: false, errors: r.errors || { end: r.error } };
      blocks = r.blocks; saved = r.block;
      if (r.taskPatch) patches.push(Object.assign({ taskId: v.taskId }, r.taskPatch));
      if (v.taskId && (v.title || v.notes)) { const e = W.editBlock(blocks, saved.id, { notes: v.notes }, cc); if (e.ok) blocks = e.blocks; }
      if (!saveBlocks(blocks, patches)) return { ok: false, message: store.error() };
      A.say("Block added");
      return { ok: true };
    }
    const scope = v.scope || "all";
    let id = cur.blockId, occDate = cur.date;
    if (blk.repeat && scope === "this") {
      const r = W.editOccurrence(blocks, id, cur.date, Object.assign({}, fields, { date: v.date }), cc);
      if (!r.ok) return { ok: false, errors: r.errors };
      blocks = r.blocks; id = r.block.id; occDate = r.block.date;
    } else {
      const patch = Object.assign({}, fields, { repeatFreq: v.taskId ? "" : v.repeatFreq, repeatDays: days, until: v.until });
      if (!blk.repeat) patch.date = v.date;
      // a block that is moved takes its task along
      const r = W.editBlock(blocks, id, patch, cc);
      if (!r.ok) return { ok: false, errors: r.errors };
      blocks = r.blocks; occDate = blk.repeat ? cur.date : v.date;
      if (blk.taskId === v.taskId && v.taskId && (r.block.date !== blk.date || r.block.start !== blk.start)) patches.push({ taskId: v.taskId, date: r.block.date, time: r.block.start });
    }
    const nowBlock = W.blockById(blocks, id);
    if ((nowBlock.taskId || "") !== (v.taskId || "")) {
      if (nowBlock.taskId) { const rel = W.releaseTask(blocks, id, {}); blocks = rel.blocks; if (rel.taskPatch) patches.push(Object.assign({ taskId: rel.taskId }, rel.taskPatch)); }
      if (v.taskId) {
        const as = W.assignTask(blocks, id, v.taskId, tasks, {});
        if (!as.ok) return { ok: false, errors: { taskId: as.error } };
        blocks = as.blocks; patches.push(Object.assign({ taskId: v.taskId }, as.taskPatch));
        if (as.releasedFrom) message = "“" + as.block.title + "” moved here; its old block is kept as a plain block.";
      }
    }
    const lw = W.logWork(blocks, id, occDate, v.worked, {});
    if (!lw.ok) return { ok: false, errors: { worked: lw.error } };
    blocks = lw.blocks;
    const finalBlock = W.blockById(blocks, id);
    if (!finalBlock.taskId) blocks = W.setBlockDone(blocks, id, occDate, !!v.done, {}).blocks;
    if (!saveBlocks(blocks, patches)) return { ok: false, message: store.error() };
    if (finalBlock.taskId) {
      const t = A.taskById(finalBlock.taskId);
      if (t && !!t.completed !== !!v.done) A.toggleTask(t.id);
    }
    if (message) A.notice(message, ""); else A.say("Saved");
    return { ok: true };
  }

  function deleteBlock(id, occDate, scope) {
    const blocks = store.all("blocks"), blk = W.blockById(blocks, id);
    if (!blk) return;
    if (blk.repeat && scope === "this") {
      const r = W.removeOccurrence(blocks, id, occDate, {});
      if (!r.ok || !store.replace("blocks", r.blocks)) { A.saveFailed(); return; }
      A.notice("Skipped “" + blk.title + "” on " + dayLabel(occDate) + ".", "Undo", function () { store.replace("blocks", W.restoreOccurrence(store.all("blocks"), id, occDate, {}).blocks); A.render(); });
      A.render(); return;
    }
    const patches = [];
    if (blk.taskId) { const un = W.unplaceTask(blocks, blk.taskId, {}); if (un.taskPatch) patches.push(Object.assign({ taskId: blk.taskId }, un.taskPatch)); }
    const r = W.removeBlock(blocks, id, {});
    if (!r.ok || !saveBlocks(r.blocks, patches)) return;
    A.notice("Deleted “" + blk.title + "”.", "Undo", function () {
      const back = W.restoreBlock(store.all("blocks"), id, {});
      saveBlocks(back.blocks, blk.taskId ? [{ taskId: blk.taskId, date: blk.date, time: blk.start }] : []);
      A.render();
    });
    A.render();
  }

  function openIngredientSheet(id) {
    const c = wctx(), cur = id ? W.ingredientById(c.ingredients, id) : null;
    if (id && !cur) return;
    const color = cur ? cur.color : W.COLORS[W.liveIngredients(c.ingredients).length % W.COLORS.length].hex;
    let body = A.fText("name", "Name", cur ? cur.name : "", { max: W.NAME_MAX, required: true, placeholder: "e.g. Reading" });
    const known = W.COLORS.some(function (x) { return x.hex === color; });
    body += '<fieldset class="pw-swatches"><legend>Colour</legend>' + W.COLORS.concat(known ? [] : [{ key: "custom", label: "Current", hex: color }]).map(function (x) {
      return '<label class="pw-swatch" style="--c:' + x.hex + '"><input type="radio" name="color" value="' + x.hex + '"' + (x.hex === color ? " checked" : "") + '><span class="pw-swatch-dot" aria-hidden="true"></span><span class="visually-hidden">' + esc(x.label) + '</span></label>';
    }).join("") + '</fieldset><p class="sp-err hidden" data-err="color" role="alert"></p>';
    body += '<div class="form-row"><label class="pw-check"><input type="checkbox" name="rest"' + (cur && cur.rest ? " checked" : "") + '> This is rest time (it doesn\'t count toward your daily workload)</label></div>';
    if (cur) body += '<div class="form-row"><button type="button" class="btn btn-danger" data-sheet-act="delete">Delete this ingredient</button><p class="field-hint">Blocks that use it are kept and shown as “No ingredient”.</p></div>';
    A.openSheet({
      title: cur ? "Edit ingredient" : "New ingredient", body: body, submit: cur ? "Save" : "Add ingredient",
      onAct: function (act) {
        if (act !== "delete") return;
        A.closeSheet(true);
        const r = W.removeIngredient(store.all("ingredients"), id, {});
        if (!r.ok || !store.replace("ingredients", r.ingredients)) { A.saveFailed(); return; }
        A.notice("Deleted “" + cur.name + "”.", "Undo", function () { store.replace("ingredients", W.restoreIngredient(store.all("ingredients"), id, {}).ingredients); A.render(); });
        A.render();
      },
      onSubmit: function (v) {
        const input = { name: v.name, color: v.color, rest: !!v.rest };
        const r = cur ? W.editIngredient(store.all("ingredients"), id, input, {}) : W.addIngredient(store.all("ingredients"), input, {});
        if (!r.ok) return { ok: false, errors: r.errors };
        if (!store.replace("ingredients", r.ingredients)) return { ok: false, message: store.error() };
        A.say("Saved");
        return { ok: true };
      }
    });
  }

  function openTopSheet() {
    const c = wctx(), wk = W.weekOf(c.weeks, c.weekStart), saved = wk ? W.readWeek(wk).top : [];
    const choices = [["", "A task of my own…"]].concat(openTaskChoices(c, ""));
    let body = '<p class="sp-dim">Pick up to three things that would make this week a success. Choose an existing task, or write your own.</p>';
    for (let i = 0; i < 3; i++) {
      const cur = saved[i] || { taskId: "", text: "" };
      body += '<fieldset class="pw-topfield"><legend>' + (i + 1) + '</legend>' + A.fSelect("task" + i, "Task", choices.concat(cur.taskId && !choices.some(function (x) { return x[0] === cur.taskId; }) ? [[cur.taskId, "(a task from another day)"]] : []), cur.taskId) + A.fText("text" + i, "Or in your own words", cur.text, { max: 140 }) + '</fieldset>';
    }
    A.openSheet({
      title: "Top three this week", body: body, submit: "Save",
      onSubmit: function (v) {
        const top = [0, 1, 2].map(function (i) { return { taskId: v["task" + i] || "", text: v["text" + i] || "" }; }).filter(function (x) { return x.taskId || x.text.trim(); });
        const r = W.setWeek(store.all("weeks"), c.weekStart, { top: top }, {});
        if (!r.ok || !store.replace("weeks", r.weeks)) return { ok: false, message: store.error() || r.error };
        A.say("Saved");
        return { ok: true };
      }
    });
  }

  /* ---------------- clicks ---------------- */

  function placeAt(taskId, target) {
    const c = wctx(), r = W.placeTask(c.blocks, taskId, target, c.tasks, { ingredients: c.ingredients });
    if (!r.ok) { A.notice(r.error || "That couldn't be scheduled.", ""); return false; }
    return saveBlocks(r.blocks, [Object.assign({ taskId: taskId }, r.taskPatch)]);
  }

  A.acts["week-nav"] = function (el) { state.week = PL.addDays(weekStart(), 7 * Number(el.getAttribute("data-dir"))); state.day = ""; A.render(); };
  A.acts["week-today"] = function () { state.week = W.mondayOf(store.today()); state.day = ""; A.render(); };
  A.acts["week-interval"] = function () { if (!store.setSettings({ interval: store.settings().interval === 60 ? 30 : 60 })) A.saveFailed(); A.render(); };
  A.acts["pick-day"] = function (el) { state.day = el.getAttribute("data-date"); A.render(); };
  A.acts["block-new"] = function () { const c = wctx(); openBlockSheet({ date: state.day && W.weekDates(c.weekStart).indexOf(state.day) !== -1 ? state.day : c.today }); };
  A.acts["ing-new"] = function () { openIngredientSheet(""); };
  A.acts["ing-edit"] = function (el) { openIngredientSheet(el.getAttribute("data-id")); };
  A.acts["ing-add-block"] = function (el) {
    if (dragMoved) return;
    const c = wctx();
    openBlockSheet({ date: state.day && W.weekDates(c.weekStart).indexOf(state.day) !== -1 ? state.day : c.today, ingredientId: el.getAttribute("data-id") });
  };
  A.acts["ing-starters"] = function () {
    const r = W.addStarters(store.all("ingredients"), {});
    if (!store.replace("ingredients", r.ingredients)) { A.saveFailed(); return; }
    A.say(r.added + " ingredients added");
    A.render();
  };
  A.acts["task-schedule"] = function (el) {
    const c = wctx(), t = A.taskById(el.getAttribute("data-id"));
    if (!t) return;
    const day = W.weekDates(c.weekStart).indexOf(t.date) !== -1 && t.date >= c.today ? t.date : (state.day || c.today);
    const free = W.freeSlots(day, c, 60, [])[0];
    openBlockSheet({ date: day, taskId: t.id, start: free ? W.toTime(free.start) : undefined, end: free ? W.toTime(free.start + 60) : undefined });
  };
  A.acts["suggest-apply"] = function (el) {
    const id = el.getAttribute("data-id");
    if (placeAt(id, { date: el.getAttribute("data-date"), start: el.getAttribute("data-start"), end: el.getAttribute("data-end"), ingredientId: lastIngredient })) { A.say("Scheduled"); A.render(); }
  };
  A.acts["suggest-all"] = function () {
    const c = wctx(), list = W.suggest(c).filter(function (x) { return !x.none; });
    let blocks = c.blocks; const patches = [];
    list.forEach(function (x) {
      const r = W.placeTask(blocks, x.taskId, { date: x.date, start: x.start, end: x.end, ingredientId: lastIngredient }, c.tasks, { ingredients: c.ingredients });
      if (r.ok) { blocks = r.blocks; patches.push(Object.assign({ taskId: x.taskId }, r.taskPatch)); }
    });
    if (saveBlocks(blocks, patches)) { A.notice(A.plural(patches.length, "task") + " scheduled.", "Undo", function () {
      const undone = c.blocks; const restore = patches.map(function (p) { const t = c.tasks.filter(function (k) { return k.id === p.taskId; })[0]; return t ? { taskId: p.taskId, date: t.date, time: t.time || "" } : null; }).filter(Boolean);
      saveBlocks(undone, restore); A.render();
    }); A.render(); }
  };
  A.acts["block-done"] = function (el) {
    const id = el.getAttribute("data-block"), date = el.getAttribute("data-date"), taskId = el.getAttribute("data-task");
    if (taskId) { A.toggleTask(taskId); return; }
    const r = W.setBlockDone(store.all("blocks"), id, date, el.checked, {});
    if (!store.replace("blocks", r.blocks)) A.saveFailed();
    A.render();
  };
  A.acts["top-use"] = function () {
    const c = wctx(), top = W.topThree(c).map(function (x) { return { taskId: x.task.id, text: "" }; });
    const r = W.setWeek(store.all("weeks"), c.weekStart, { top: top }, {});
    if (!store.replace("weeks", r.weeks)) { A.saveFailed(); return; }
    A.render();
  };
  A.acts["top-edit"] = function () { openTopSheet(); };
  A.acts["top-remove"] = function (el) {
    const c = wctx(), wk = W.weekOf(c.weeks, c.weekStart), top = (wk ? W.readWeek(wk).top : []).filter(function (x, i) { return i !== Number(el.getAttribute("data-i")); });
    const r = W.setWeek(store.all("weeks"), c.weekStart, { top: top }, {});
    if (!store.replace("weeks", r.weeks)) { A.saveFailed(); return; }
    A.render();
  };
  A.acts["carry-apply"] = function () {
    const c = wctx(), ids = Array.prototype.map.call(document.querySelectorAll('#spView input[name="carry"]:checked'), function (e) { return e.value; });
    if (!ids.length) { A.notice("Tick the tasks to carry forward first.", ""); return; }
    const target = W.carryTarget(c), before = A.tasks();
    const h = habits();
    if (!h || !h.commitTasks) return;
    const detached = W.detachTasks(store.all("blocks"), ids, {});
    store.replace("blocks", detached);
    h.commitTasks(W.carryTasks(before, ids, target));
    A.notice(A.plural(ids.length, "task") + " moved to " + dayLabel(target) + ".", "Undo", function () { h.commitTasks(before); A.render(); });
    A.render();
  };

  document.addEventListener("submit", function (e) {
    if (e.target && e.target.id === "pwReviewForm") {
      e.preventDefault();
      const f = e.target, c = wctx();
      const r = W.setWeek(store.all("weeks"), c.weekStart, { wins: f.wins.value, lessons: f.lessons.value, nextFocus: f.nextFocus.value, reviewedAt: Date.now() }, {});
      if (!r.ok || !store.replace("weeks", r.weeks)) { A.saveFailed(); return; }
      A.notice("Review saved.", "");
      A.render();
    }
  });

  // Tap on a block opens it; tap on an empty stretch of a day starts a block there.
  function minuteAt(col, clientY, snap) {
    const rect = col.getBoundingClientRect(), top = Number(col.getAttribute("data-top"));
    return top + Math.round(((clientY - rect.top) / PX) / snap) * snap;
  }
  function onViewClick(e) {
    if (state.view !== "weekly") return;
    if (dragMoved) { dragMoved = false; e.stopPropagation(); e.preventDefault(); return; }
    const blk = e.target.closest(".pw-block");
    if (blk) {
      if (e.target.closest(".pw-b-check")) return;
      openBlockSheet({ id: blk.getAttribute("data-block"), date: blk.getAttribute("data-date") });
      return;
    }
    const col = e.target.closest(".pw-col");
    if (col && e.target === col) {
      const c = wctx(), w = W.winOf(c.settings), m = Math.min(Math.max(minuteAt(col, e.clientY, w.interval), w.start), w.end - w.interval);
      openBlockSheet({ date: col.getAttribute("data-date"), start: W.toTime(m), end: W.toTime(Math.min(m + 60, 1439)) });
    }
  }
  function onViewKey(e) {
    if (state.view !== "weekly" || (e.key !== "Enter" && e.key !== " ")) return;
    const blk = e.target.closest && e.target.closest(".pw-block");
    if (blk && e.target === blk) { e.preventDefault(); openBlockSheet({ id: blk.getAttribute("data-block"), date: blk.getAttribute("data-date") }); }
  }

  /* ---------------- dragging (mouse, and press-and-hold on touch) ---------------- */

  function visibleCols() { return Array.prototype.filter.call(document.querySelectorAll("#spView .pw-col"), function (c) { return c.offsetParent !== null; }); }
  function targetAt(x, y, len, grab) {
    const c = wctx(), w = W.winOf(c.settings), cols = visibleCols();
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 20 && y <= r.bottom + 20) {
        const top = Number(cols[i].getAttribute("data-top")), bottom = top + (r.height / PX);
        let m = minuteAt(cols[i], y - grab * PX, w.interval);
        m = Math.max(top, Math.min(m, Math.floor(bottom / w.interval) * w.interval - len));
        m = Math.max(0, Math.min(m, 1439 - Math.min(len, 1439)));
        return { col: cols[i], date: cols[i].getAttribute("data-date"), start: m, end: Math.min(m + len, 1439) };
      }
    }
    return null;
  }
  function showDrop(t, color) {
    let d = document.querySelector("#spView .pw-drop");
    if (!t) { if (d) d.remove(); return; }
    if (!d || d.parentNode !== t.col) { if (d) d.remove(); d = document.createElement("div"); d.className = "pw-drop"; d.setAttribute("aria-hidden", "true"); t.col.appendChild(d); }
    const top = Number(t.col.getAttribute("data-top"));
    d.style.top = ((t.start - top) * PX) + "px"; d.style.height = Math.max(10, (t.end - t.start) * PX - 2) + "px"; d.style.setProperty("--c", color || "#4f8cff");
    d.textContent = W.toTime(t.start) + " – " + W.toTime(t.end);
  }
  function ghostFor(label, color) {
    const g = document.createElement("div");
    g.className = "pw-ghost"; g.textContent = label; g.style.setProperty("--c", color); g.setAttribute("aria-hidden", "true");
    document.body.appendChild(g);
    return g;
  }
  let scrollTimer = null, lastY = 0;
  function autoScroll() {
    if (!drag || !drag.started) { window.clearInterval(scrollTimer); scrollTimer = null; return; }
    const h = window.innerHeight, edge = 70;
    if (lastY < edge + 70) window.scrollBy(0, -Math.ceil((edge + 70 - lastY) / 6));       // the sticky header covers the top
    else if (lastY > h - edge) window.scrollBy(0, Math.ceil((lastY - (h - edge)) / 6));
  }
  function endDrag() {
    if (!drag) return;
    window.clearInterval(scrollTimer); scrollTimer = null;
    window.clearTimeout(drag.timer);
    if (drag.ghost) drag.ghost.remove();
    if (drag.src) drag.src.classList.remove("is-dragging");
    showDrop(null);
    document.body.classList.remove("pw-dragging");
    drag = null;
  }
  function beginDrag() {
    if (!drag || drag.started) return;
    drag.started = true; dragMoved = true;
    if (!scrollTimer) scrollTimer = window.setInterval(autoScroll, 30);
    document.body.classList.add("pw-dragging");
    const c = wctx();
    if (drag.kind === "block") { drag.src.classList.add("is-dragging"); drag.ghost = ghostFor(drag.label, drag.color); }
    else if (drag.kind === "ingredient" || drag.kind === "task") drag.ghost = ghostFor(drag.label, drag.color);
    void c;
  }
  function onDown(e) {
    if (state.view !== "weekly" || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.target.closest("input, select, textarea, a")) return;
    const src = e.target.closest("[data-drag]");
    if (!src) return;
    const c = wctx(), kind = src.getAttribute("data-drag");
    if (e.target.closest("[data-nodrag]")) return;
    const blockEl = kind === "resize" ? src.closest(".pw-block") : src;
    const d = { kind: kind, src: blockEl, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse", started: false, id: blockEl.getAttribute("data-id") || blockEl.getAttribute("data-block"), date: blockEl.getAttribute("data-date"), len: 60, grab: 0, color: "#4f8cff", label: "" };
    if (kind === "block" || kind === "resize") {
      const o = W.occurrence(c.blocks, blockEl.getAttribute("data-block"), blockEl.getAttribute("data-date"));
      if (!o) return;
      d.id = o.blockId; d.occ = o; d.len = o.endMin - o.startMin; d.color = ingColor(c, o.ingredientId); d.label = o.title + " · " + o.start;
      d.grab = Math.max(0, Math.min(d.len - 5, (e.clientY - blockEl.getBoundingClientRect().top) / PX));
      if (kind === "resize") d.grab = d.len;
    } else if (kind === "ingredient") {
      const ing = W.ingredientById(c.ingredients, d.id);
      if (!ing) return;
      d.color = ing.color; d.label = ing.name; d.len = Math.max(c.settings.interval, 60);
    } else if (kind === "task") {
      const t = A.taskById(d.id);
      if (!t) return;
      const l = PL.linkOf(c.links, t.id);
      d.label = t.text; d.len = Math.max(c.settings.interval, Math.ceil(((l && l.estMin) || 60) / c.settings.interval) * c.settings.interval);
    }
    drag = d;
    if (d.touch) { d.timer = window.setTimeout(function () { if (drag === d) beginDrag(); }, 380); }
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.started) {
      if (drag.touch) { if (Math.abs(dx) + Math.abs(dy) > 10) { window.clearTimeout(drag.timer); drag = null; } return; }
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      beginDrag();
    }
    e.preventDefault();
    lastY = e.clientY;
    if (drag.ghost) { drag.ghost.style.left = (e.clientX + 12) + "px"; drag.ghost.style.top = (e.clientY + 12) + "px"; }
    if (drag.kind === "resize") {
      const col = drag.src.closest(".pw-col"), w = W.winOf(wctx().settings), occ = drag.occ;
      const m = Math.max(occ.startMin + w.interval, minuteAt(col, e.clientY, w.interval));
      drag.target = { col: col, date: occ.date, start: occ.startMin, end: Math.min(m, 1439) };
      showDrop(drag.target, drag.color);
      return;
    }
    drag.target = targetAt(e.clientX, e.clientY, drag.len, drag.grab);
    showDrop(drag.target, drag.color);
  }
  function onUp() {
    if (!drag) return;
    const d = drag, t = d.target;
    const started = d.started;
    endDrag();
    if (!started || !t) { if (started) window.setTimeout(function () { dragMoved = false; }, 0); return; }
    const c = wctx(), to = { date: t.date, start: W.toTime(t.start), end: W.toTime(t.end) };
    if (d.kind === "block") {
      if (to.date === d.occ.date && to.start === d.occ.start) { window.setTimeout(function () { dragMoved = false; }, 0); return; }
      const r = W.moveOccurrence(c.blocks, d.id, d.occ.date, to, {});
      if (!r.ok) A.notice(r.error || "That can't be moved there.", ""); else if (saveBlocks(r.blocks, r.taskPatch ? [Object.assign({ taskId: d.occ.taskId }, r.taskPatch)] : [])) { A.say("Moved to " + dayLabel(to.date) + " " + to.start); }
    } else if (d.kind === "resize") {
      const r = W.resizeOccurrence(c.blocks, d.id, d.occ.date, to.end, {});
      if (!r.ok) A.notice(r.error || "That can't be resized.", ""); else saveBlocks(r.blocks, []);
    } else if (d.kind === "ingredient") {
      lastIngredient = d.id;
      const r = W.addBlock(c.blocks, { title: d.label, ingredientId: d.id, date: to.date, start: to.start, end: to.end }, { ingredients: c.ingredients });
      if (!r.ok) A.notice(r.errors.end || r.errors.date || "That couldn't be added.", ""); else if (saveBlocks(r.blocks, [])) A.notice("Added a " + d.label + " block, " + dayLabel(to.date) + " " + to.start + "–" + to.end + ".", "Undo", function () { store.replace("blocks", W.removeBlock(store.all("blocks"), r.block.id, {}).blocks); A.render(); });
    } else if (d.kind === "task") {
      if (placeAt(d.id, { date: to.date, start: to.start, end: to.end, ingredientId: lastIngredient })) A.say("Scheduled for " + dayLabel(to.date) + " " + to.start);
    }
    A.render();
    window.setTimeout(function () { dragMoved = false; }, 0);
  }
  function onKeyDrag(e) { if (drag && e.key === "Escape") { e.preventDefault(); endDrag(); window.setTimeout(function () { dragMoved = false; }, 0); } }
  function stopTouchScroll(e) { if (drag && drag.started) e.preventDefault(); }

  function wire() {
    const host = document.getElementById("spView");
    if (!host || host.getAttribute("data-pw-wired")) return;
    host.setAttribute("data-pw-wired", "1");
    host.addEventListener("click", onViewClick, true);
    host.addEventListener("keydown", onViewKey);
    host.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", function () { endDrag(); window.setTimeout(function () { dragMoved = false; }, 0); });
    document.addEventListener("keydown", onKeyDrag);
    document.addEventListener("touchmove", stopTouchScroll, { passive: false });
  }
  document.addEventListener("DOMContentLoaded", wire);
  if (document.readyState !== "loading") wire();

  A.weekReconcile = reconcile;
  A.openBlockSheet = openBlockSheet;
  void cachedCtx;
})();
