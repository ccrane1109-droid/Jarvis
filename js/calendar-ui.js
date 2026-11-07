/* ==========================================================================
   JARVIS — Calendar (the screen).

   The rules are in calendar-logic.js; this file draws them and passes taps, keys and drags to them.

   Saved in two keys (see calendar-logic.js): jarvisCalendarEvents and jarvisCalendarSettings, both in the
   merge-based cloud backup. Your ordinary tasks (jarvisTasks, owned by habits.js) are shown here as items
   too, read from and handed back to habits.js, never copied, so ticking or moving one here changes the
   same task the To-Do list and the Habits planner show.

   Nothing is reported as saved unless it was: if the browser refuses the write, the change is rolled back
   on screen and the problem is shown.
   ========================================================================== */

(function () {
  "use strict";

  const C = window.JarvisCalendarLogic;
  const S = window.JarvisScheduleLogic;
  const EV_KEY = "jarvisCalendarEvents", SET_KEY = "jarvisCalendarSettings";
  const SNAP = 15, UNDO_MS = 8000, TASK_COLOR = "#7d8fb3";
  const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Mexico_City", "America/Sao_Paulo",
    "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Athens", "Africa/Lagos", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "UTC"];

  let events = [], kept = [], settings = C.settings(null);
  let loadError = "", saveError = "";
  let view = "week", anchor = "", selected = "";
  let filters = { q: "", categories: [], hideDone: false }, filtersOpen = false;
  let modal = null;          // the open popup: { kind: "event" | "task" | "settings", ... }
  let undo = null;           // { timer, fn }
  let itemMap = {};          // key -> item, for what is on screen
  let wantScroll = true, ready = false, drag = null, suppressClickUntil = 0, searchTimer = null, nowTimer = null, lastDay = "";

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(s); }
  function habits() { return window.JarvisHabits && window.JarvisHabits.getTasks ? window.JarvisHabits : null; }
  function zone() { return C.viewZone(settings); }
  function today() { return C.todayIn(Date.now(), zone()); }
  function nowMin() { return C.minutesOf(C.instantToWall(Date.now(), zone()).time); }
  function panelActive() { const p = $("panel-calendar"); return !!(p && p.classList.contains("active") && p.offsetParent !== null); }
  function isPhone() { return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches); }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function announce(text) { const el = $("calLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }
  // Focus the first match that is on screen (the same event can be drawn on Home and in the calendar).
  function focusSoon(sel, visibleOnly) {
    window.setTimeout(function () {
      const all = visibleOnly ? Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (e) { return e.offsetParent !== null; }) : [document.querySelector(sel)];
      if (all[0]) all[0].focus();
    }, 0);
  }
  function ctx() { return { now: Date.now(), zone: zone(), defaultDuration: settings.defaultDuration, makeId: function () { return core().uid("ev"); } }; }
  function colorOf(it) { return it.source === "task" ? TASK_COLOR : C.categoryInfo(it.category).color; }
  function shortTime(t) { const h = Number(t.slice(0, 2)), m = t.slice(3); return ((h + 11) % 12 + 1) + (m === "00" ? "" : ":" + m) + (h < 12 ? "a" : "p"); }
  function dayName(date, opts) { return C.fmtDate(date, opts || { weekday: "long", month: "long", day: "numeric" }); }

  /* ---------------- saved data ---------------- */

  function load() {
    loadError = "";
    let raw = null;
    try { raw = localStorage.getItem(EV_KEY); } catch (e) { loadError = "This browser is blocking storage, so the calendar can't be saved."; }
    events = []; kept = [];
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        events = C.sanitizeList(parsed);
        const ok = {}; events.forEach(function (e) { ok[e.id] = true; });
        // Anything this version can't read is kept as it was, so nothing is lost by saving.
        kept = (Array.isArray(parsed) ? parsed : []).filter(function (e) { return !(e && typeof e === "object" && ok[e.id]); });
      } catch (e) { loadError = "The saved calendar could not be read, so it is not shown and nothing will be saved over it."; }
    }
    settings = C.settings(core().loadJSON(SET_KEY, null));
    const purged = C.purge(events, Date.now());
    if (!loadError && purged.length !== events.length) { events = purged; save(); }
  }
  function save() {
    if (loadError) { saveError = loadError; return false; }
    const ok = core().saveJSON(EV_KEY, events.concat(kept));
    saveError = ok ? "" : "The browser would not save the calendar (storage may be full or blocked). Your last change was not kept.";
    return ok;
  }
  // Applies a new list and saves it. If it can't be saved the change is dropped and the error is shown.
  function commit(next) {
    const prev = events;
    events = next;
    if (!save()) { events = prev; renderStatus(); render(); return false; }
    renderStatus();
    notify();
    return true;
  }
  // Tells the Home screen (and anything else showing the schedule) that something changed.
  function notify() { try { document.dispatchEvent(new CustomEvent("jarvis-calendar-changed")); } catch (e) { /* nothing is listening */ } }
  function saveTasks(list) { const h = habits(); if (h) h.commitTasks(list); }
  function changed(prev, next) { const p = {}; prev.forEach(function (e) { p[e.id] = e; }); return next.filter(function (e) { return p[e.id] !== e; }).map(function (e) { return e.id; }); }

  /* ---------------- what is on screen ---------------- */

  function sortItems(a, b) { return (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.startMin || 0) - (b.startMin || 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0); }
  function allItems(from, to) {
    const h = habits();
    const items = C.expand(events, from, to, zone()).concat(h ? C.taskItems(h.getTasks(), from, to) : [], S ? S.goalItems(h && h.getGoals ? h.getGoals() : [], from, to) : []);
    const mark = {};
    C.findConflicts(items).forEach(function (c) { mark[c.a.key] = true; mark[c.b.key] = true; });
    items.forEach(function (it) { it.conflict = !!mark[it.key]; });
    return items;
  }
  function visibleItems(from, to) {
    const all = allItems(from, to), shown = C.filterItems(all, filters);
    itemMap = {}; shown.forEach(function (it) { itemMap[it.key] = it; });
    return { all: all, shown: shown };
  }
  function dayItems(items, date) { return items.filter(function (it) { return it.date <= date && it.endDate >= date; }).sort(sortItems); }
  function itemLabel(it) {
    const d = dayName(it.date, { weekday: "short", month: "short", day: "numeric" });
    const when = it.allDay ? d + (it.endDate !== it.date ? " to " + dayName(it.endDate, { weekday: "short", month: "short", day: "numeric" }) : "") + ", all day" : d + ", " + C.timeLabel(it.time) + (it.point ? "" : " to " + C.timeLabel(it.endTime));
    return it.title + ", " + when + (it.kind !== "event" && it.source !== "task" ? ", " + C.kindInfo(it.kind).label : "") + (it.completed ? ", done" : "") + (it.conflict ? ", overlaps another event" : "");
  }

  /* ---------------- drawing ---------------- */

  function renderToolbar() {
    $("calTitle").textContent = C.viewTitle(view, anchor, settings.weekStart);
    Array.prototype.forEach.call(document.querySelectorAll(".cal-view-btn"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === view)); });
    const n = filters.categories.length + (filters.hideDone ? 1 : 0);
    $("calFilterBtn").textContent = n ? "Filters · " + n : "Filters";
    $("calFilterBtn").setAttribute("aria-expanded", String(filtersOpen));
    const box = $("calFilters");
    box.classList.toggle("hidden", !filtersOpen);
    if (filtersOpen) {
      box.innerHTML = C.CATEGORIES.map(function (c) {
        const on = filters.categories.indexOf(c.value) !== -1;
        return '<button type="button" class="cal-chip-btn" style="--cc:' + c.color + '" data-cal="cat" data-v="' + c.value + '" aria-pressed="' + on + '"><span class="cal-dot"></span>' + esc(c.label) + '</button>';
      }).join("") +
        '<button type="button" class="cal-chip-btn" data-cal="hidedone" aria-pressed="' + filters.hideDone + '">Hide completed</button>' +
        (n || filters.q ? '<button type="button" class="cal-chip-btn" data-cal="clear">Clear all</button>' : "");
    }
    $("calFoot").innerHTML = 'Times are shown in ' + esc(zone().replace(/_/g, " ")) + '. <button type="button" class="cal-more" data-cal="settings">Calendar settings</button> <button type="button" class="cal-more" data-cal="keys">Keyboard shortcuts</button>';
  }

  function renderStatus() {
    const box = $("calStatus"), msg = loadError || saveError;
    if (!msg) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.classList.remove("hidden"); box.classList.add("is-error");
    box.innerHTML = '<span>' + esc(msg) + '</span>' + (saveError && !loadError ? '<button type="button" class="btn btn-secondary" data-cal="dismiss">Dismiss</button>' : "");
  }

  function chipHtml(it) {
    const draggable = it.source === "task" || !it.readOnly;
    return '<button type="button" class="cal-chip' + (it.completed ? " cal-item-done" : "") + '" style="--cc:' + colorOf(it) + '" data-cal="open" data-key="' + esc(it.key) + '"' + (draggable ? ' data-drag="1"' : "") + ' aria-label="' + esc(itemLabel(it)) + '">' +
      (it.allDay ? "" : esc(shortTime(it.time)) + " ") + esc(it.title) + '</button>';
  }

  function monthHtml(items) {
    const g = C.monthGrid(anchor, settings.weekStart), t = today();
    const dows = []; for (let i = 0; i < 7; i++) dows.push(dayName(C.addDays(g.weeks[0][i], 0), { weekday: "short" }));
    let html = '<div class="cal-month">' + dows.map(function (d) { return '<div class="cal-dow">' + esc(d) + '</div>'; }).join("");
    g.weeks.forEach(function (week) {
      week.forEach(function (d) {
        const list = dayItems(items, d), other = d.slice(0, 7) !== g.month;
        html += '<div class="cal-cell' + (other ? " is-other" : "") + (d === t ? " is-today" : "") + (d === selected ? " is-selected" : "") + '" data-date="' + d + '">' +
          '<button type="button" class="cal-num" data-cal="num" data-date="' + d + '" aria-label="' + esc(dayName(d) + (list.length ? ", " + list.length + (list.length === 1 ? " item" : " items") : "")) + '">' + Number(d.slice(8)) + '</button>' +
          list.slice(0, 3).map(chipHtml).join("") +
          (list.length > 3 ? '<button type="button" class="cal-more" data-cal="num" data-date="' + d + '">+' + (list.length - 3) + ' more</button>' : "") +
          '<div class="cal-dots" aria-hidden="true">' + list.slice(0, 4).map(function (it) { return '<span class="cal-dot" style="--cc:' + colorOf(it) + '"></span>'; }).join("") + '</div>' +
          '</div>';
      });
    });
    html += '</div>';
    html += '<div class="cal-daylist"><div class="cal-daylist-head"><h3>' + esc(dayName(selected)) + '</h3>' +
      '<button type="button" class="btn btn-primary" data-cal="new-on" data-date="' + selected + '">+ Add</button></div>' + agendaRows(dayItems(items, selected), selected, true) + '</div>';
    return html;
  }

  function rowHtml(it) {
    const sub = [];
    if (it.source === "task") sub.push("Task");
    else {
      const kind = C.kindInfo(it.kind).label, cat = C.categoryInfo(it.category).label;
      if (it.kind !== "event" && kind !== cat) sub.push(kind);
      sub.push(cat);
    }
    if (it.recurring) sub.push("Repeats");
    const tickable = it.source === "task" || (it.source === "event" && C.isPoint(it.kind));
    const time = it.allDay ? "All day" : C.timeLabel(it.time);
    return '<div class="cal-ag-row" style="--cc:' + colorOf(it) + '" data-key="' + esc(it.key) + '">' +
      '<button type="button" class="cal-ag-open" data-cal="open" data-key="' + esc(it.key) + '" aria-label="' + esc(itemLabel(it)) + '">' +
        '<span class="cal-ag-time">' + esc(time) + '</span><span class="cal-ag-bar"></span>' +
        '<span class="cal-ag-main"><span class="cal-ag-title' + (it.completed ? " cal-item-done" : "") + '">' + esc(it.title) + '</span><span class="cal-ag-sub">' + esc(sub.join(" · ")) + '</span></span>' +
        (it.conflict ? '<span class="cal-ag-flag">Overlaps</span>' : "") +
      '</button>' +
      (tickable ? '<button type="button" class="cal-tick' + (it.completed ? " done" : "") + '" data-cal="tick" data-key="' + esc(it.key) + '" aria-pressed="' + !!it.completed + '" aria-label="' + (it.completed ? "Done: " : "Mark done: ") + esc(it.title) + '">' + (it.completed ? "&#10003;" : "") + '</button>' : "") +
    '</div>';
  }
  function agendaRows(list, date, inMonth) {
    if (!list.length) return '<div class="cal-empty">' + (inMonth ? "Nothing planned for this day." : "Nothing here.") + '</div>';
    return list.map(rowHtml).join("");
  }

  function agendaHtml(items) {
    const r = C.rangeFor("agenda", anchor, settings.weekStart), t = today();
    const days = C.agenda(items, r.from, r.to);
    if (!days.length) {
      const filtered = filters.q || filters.categories.length || filters.hideDone;
      return '<div class="cal-empty"><p>' + (filtered ? "Nothing matches your search and filters in these 30 days." : "Nothing scheduled in the next 30 days.") + '</p>' +
        (filtered ? '<button type="button" class="btn btn-secondary" data-cal="clear">Clear search and filters</button>' : '<button type="button" class="btn btn-primary" data-cal="new">+ New event</button>') + '</div>';
    }
    return days.map(function (d) {
      return '<div class="cal-ag-day' + (d.date === t ? " is-today" : "") + '">' + esc((d.date === t ? "Today · " : "") + dayName(d.date, { weekday: "long", month: "short", day: "numeric" })) + '</div>' + d.items.map(rowHtml).join("");
    }).join("");
  }

  function evBlockHtml(seg, cols) {
    const it = seg.item, top = seg.startMin / 14.4, height = (seg.endMin - seg.startMin) / 14.4;
    const resizable = it.source === "event" && !it.point && !it.recurring && it.date === it.endDate;
    const when = it.allDay ? "" : C.timeLabel(it.time) + (it.point ? "" : " – " + C.timeLabel(it.endTime));
    return '<button type="button" class="cal-ev' + (it.completed ? " cal-item-done" : "") + (it.conflict ? " is-conflict" : "") + (seg.endMin - seg.startMin < 50 ? " is-short" : "") + '" style="--cc:' + colorOf(it) + ';--col:' + seg.col + ';--cols:' + seg.cols + ';top:' + top.toFixed(3) + '%;height:' + height.toFixed(3) + '%" data-cal="open" data-drag="1" data-key="' + esc(it.key) + '" aria-label="' + esc(itemLabel(it)) + '">' +
      '<span class="t">' + esc(it.title) + '</span><span class="m">' + esc(when) + '</span>' + (resizable ? '<span class="cal-resize" data-resize="1" data-key="' + esc(it.key) + '"></span>' : "") + '</button>';
  }

  function gridHtml(dates, items) {
    const t = today(), cols = dates.length;
    let head = '<div class="cal-wk-days" style="--cols:' + cols + '"><div></div>' + dates.map(function (d) {
      return '<button type="button" class="cal-wk-daybtn' + (d === t ? " is-today" : "") + '" data-cal="goto-day" data-date="' + d + '" aria-label="' + esc(dayName(d)) + '">' + (cols > 1 ? esc(dayName(d, { weekday: "short" })) : esc(dayName(d, { weekday: "long" }))) + '<b>' + Number(d.slice(8)) + '</b></button>';
    }).join("") + '</div>';
    const strips = dates.map(function (d) { return C.allDayFor(items, d).sort(sortItems); });
    if (strips.some(function (s) { return s.length; })) {
      head += '<div class="cal-wk-allday" style="--cols:' + cols + '"><div class="cal-gutter-label">All day</div>' + strips.map(function (s) { return '<div>' + s.map(chipHtml).join("") + '</div>'; }).join("") + '</div>';
    }
    let gutter = ''; for (let h = 0; h < 24; h++) gutter += '<div class="cal-hr"><span>' + esc(C.hourLabel(h)) + '</span></div>';
    const colsHtml = dates.map(function (d) {
      const segs = C.layoutDay(items, d);
      return '<div class="cal-col' + (d === t ? " is-today" : "") + '" data-date="' + d + '" data-cal="slot">' + segs.map(function (s) { return evBlockHtml(s, cols); }).join("") +
        (d === t ? '<div class="cal-now" style="top:' + (nowMin() / 14.4).toFixed(3) + '%" aria-hidden="true"></div>' : "") + '</div>';
    }).join("");
    return '<div class="cal-scroll" id="calScroll"><div class="cal-wk-head">' + head + '</div><div class="cal-wk-body" style="--cols:' + cols + '"><div class="cal-hours">' + gutter + '</div>' + colsHtml + '</div></div>';
  }

  function render() {
    if (!ready) return;
    const stage = $("calStage");
    renderToolbar();
    const scroller = $("calScroll"), keep = scroller ? scroller.scrollTop : 0;
    if (loadError) { stage.innerHTML = '<div class="cal-empty"><p>' + esc(loadError) + '</p></div>'; return; }
    const r = C.rangeFor(view, anchor, settings.weekStart), items = visibleItems(r.from, r.to).shown;
    if (view === "month") stage.innerHTML = monthHtml(items);
    else if (view === "agenda") stage.innerHTML = agendaHtml(items);
    else {
      const dates = []; for (let d = r.from; d <= r.to; d = C.addDays(d, 1)) dates.push(d);
      stage.innerHTML = gridHtml(dates, items);
      const s = $("calScroll");
      if (s) {
        if (wantScroll) { s.scrollTop = scrollTarget(items, dates) ; wantScroll = false; } else s.scrollTop = keep;
      }
    }
    lastDay = today();
  }
  function scrollTarget(items, dates) {
    const s = $("calScroll"), col = s && s.querySelector(".cal-col");
    if (!col) return 0;
    const t = today();
    let min = 7 * 60;
    if (dates.indexOf(t) !== -1) min = Math.max(0, nowMin() - 90);
    else { const timed = items.filter(function (i) { return !i.allDay; }).map(function (i) { return i.startMin; }); if (timed.length) min = Math.max(0, Math.min.apply(null, timed) - 45); }
    return col.offsetHeight * (min / 1440);
  }

  /* ---------------- moving around ---------------- */

  function setView(v) {
    if (view === v) return;
    view = v; wantScroll = true;
    if (v === "month") selected = selected && C.rangeFor("month", anchor, settings.weekStart).from <= selected ? selected : anchor;
    render();
    announce(v.charAt(0).toUpperCase() + v.slice(1) + " view.");
  }
  function go(dir) {
    anchor = C.shiftAnchor(view, anchor, dir);
    if (view === "month") selected = anchor.slice(0, 8) + "01" === anchor ? (today().slice(0, 7) === anchor.slice(0, 7) ? today() : anchor) : anchor;
    wantScroll = view === "week" || view === "day";
    render();
    announce($("calTitle").textContent + ".");
  }
  function goToday() { anchor = today(); selected = anchor; wantScroll = true; render(); announce("Today, " + dayName(anchor) + "."); }
  function gotoDay(date) { anchor = date; selected = date; view = "day"; wantScroll = true; render(); announce(dayName(date) + "."); }

  /* ---------------- the event popup ---------------- */

  function defaultStartTime(date) {
    if (date === today()) { const m = Math.min(1380, Math.ceil((nowMin() + 1) / 30) * 30); return C.timeOf(m); }
    return "09:00";
  }
  function addMinutes(date, time, mins) { const total = C.minutesOf(time) + mins; return { date: C.addDays(date, Math.floor(total / 1440)), time: C.timeOf(((total % 1440) + 1440) % 1440) }; }
  function blankForm(date, time) {
    const t = time || defaultStartTime(date), e = addMinutes(date, t, settings.defaultDuration);
    return { title: "", kind: "event", category: "work", priority: "medium", allDay: false, date: date, time: t, endDate: e.date, endTime: e.time, repeatFreq: "", repeatInterval: 1, byDay: [C.weekday(date)], until: "", description: "", notes: "", reminders: settings.defaultReminder >= 0 ? [settings.defaultReminder] : [], linked: null, status: "", scope: "all", tz: zone(), completed: false };
  }
  function formFromEvent(ev, occDate) {
    const od = occDate || ev.date, span = C.diffDays(ev.date, ev.endDate || ev.date);
    return { title: ev.title, kind: ev.kind, category: ev.category, priority: ev.priority, allDay: !!ev.allDay, date: od, time: ev.time, endDate: C.addDays(od, span), endTime: ev.endTime,
      repeatFreq: ev.repeat ? ev.repeat.freq : "", repeatInterval: ev.repeat ? ev.repeat.interval : 1, byDay: ev.repeat && ev.repeat.byDay ? ev.repeat.byDay.slice() : [C.weekday(ev.date)], until: ev.repeat && ev.repeat.until ? ev.repeat.until : "",
      description: ev.description || "", notes: ev.notes || "", reminders: (ev.reminders || []).slice(), linked: ev.linked || null, status: ev.status || "", scope: ev.repeat ? "this" : "all", tz: ev.tz, completed: !!ev.completed };
  }
  function openNew(opts) {
    if (loadError) { renderStatus(); return; }
    const o = opts || {}, date = o.date && C.isDate(o.date) ? o.date : (selected || anchor || today());
    modal = { kind: "event", mode: "new", id: null, occDate: null, form: Object.assign(blankForm(date, o.time), o.form || {}), errors: {}, error: "", opener: document.activeElement };
    showModal();
  }
  function openEdit(it) {
    const ev = C.byId(events, it.id);
    if (!ev) { core().showToast("That isn't there any more."); render(); return; }
    modal = { kind: "event", mode: "edit", id: ev.id, occDate: it.occDate, form: formFromEvent(ev, it.occDate), errors: {}, error: "", opener: document.activeElement };
    showModal();
  }
  function selOpts(list, cur) { return list.map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(cur) ? " selected" : "") + '>' + esc(o.label) + '</option>'; }).join(""); }
  function err(m, k) { return '<p class="cal-err" id="calErr_' + k + '" role="alert">' + esc(m.errors[k] || "") + '</p>'; }

  function eventFormHtml(m) {
    const f = m.form, point = C.isPoint(f.kind), editing = m.mode === "edit", cur = editing ? C.byId(events, m.id) : null, recurring = !!(cur && cur.repeat);
    const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const wholeSeries = !recurring || f.scope === "all";
    let h = '';
    if (m.error) h += '<div class="cal-banner" role="alert">' + esc(m.error) + '</div>';
    h += '<div class="cal-field"><label for="calF_title">Title</label><input type="text" id="calF_title" maxlength="' + C.TITLE_MAX + '" autocomplete="off" value="' + esc(f.title) + '" placeholder="e.g. Film product drop teaser" aria-describedby="calErr_title"' + (m.errors.title ? ' aria-invalid="true"' : "") + '>' + err(m, "title") + '</div>';
    h += '<div class="cal-row"><div class="cal-field"><label for="calF_kind">Type</label><select id="calF_kind">' + selOpts(C.KINDS, f.kind) + '</select></div>' +
      '<div class="cal-field"><label for="calF_category">Category</label><select id="calF_category">' + selOpts(C.CATEGORIES, f.category) + '</select></div></div>';
    if (recurring) h += '<div class="cal-field"><span class="cal-lab" id="calF_scope_l">This event repeats. Change</span><div class="cal-chips" role="group" aria-labelledby="calF_scope_l">' +
      '<button type="button" class="cal-chip-btn" aria-pressed="' + (f.scope === "this") + '" data-cal="scope" data-v="this">Just ' + esc(dayName(m.occDate, { month: "short", day: "numeric" })) + '</button>' +
      '<button type="button" class="cal-chip-btn" aria-pressed="' + (f.scope === "all") + '" data-cal="scope" data-v="all">All of them</button></div></div>';
    if (!point) h += '<label class="cal-check"><input type="checkbox" id="calF_allDay"' + (f.allDay ? " checked" : "") + '> All day</label>';
    h += '<div class="cal-row"><div class="cal-field"><label for="calF_date">' + (point ? "Date" : "Starts") + '</label><input type="date" id="calF_date" value="' + esc(f.date) + '"' + (m.errors.date ? ' aria-invalid="true"' : "") + '>' + err(m, "date") + '</div>' +
      (f.allDay ? "" : '<div class="cal-field"><label for="calF_time">' + (point ? "Time (optional)" : "At") + '</label><input type="time" id="calF_time" value="' + esc(f.time) + '"' + (m.errors.time ? ' aria-invalid="true"' : "") + '>' + err(m, "time") + '</div>') + '</div>';
    if (!point) h += '<div class="cal-row"><div class="cal-field"><label for="calF_endDate">Ends</label><input type="date" id="calF_endDate" value="' + esc(f.endDate) + '"' + (m.errors.endDate ? ' aria-invalid="true"' : "") + '>' + err(m, "endDate") + '</div>' +
      (f.allDay ? "" : '<div class="cal-field"><label for="calF_endTime">At</label><input type="time" id="calF_endTime" value="' + esc(f.endTime) + '"' + (m.errors.endTime ? ' aria-invalid="true"' : "") + '>' + err(m, "endTime") + '</div>') + '</div>';
    if (f.tz && f.tz !== zone() && !f.allDay) h += '<p class="field-hint">This event’s times are in ' + esc(f.tz.replace(/_/g, " ")) + '.</p>';
    if (wholeSeries) {
      h += '<div class="cal-field"><label for="calF_repeat">Repeat</label><select id="calF_repeat"><option value="">Does not repeat</option><option value="daily"' + (f.repeatFreq === "daily" ? " selected" : "") + '>Daily</option><option value="weekly"' + (f.repeatFreq === "weekly" ? " selected" : "") + '>Weekly</option><option value="monthly"' + (f.repeatFreq === "monthly" ? " selected" : "") + '>Monthly</option><option value="yearly"' + (f.repeatFreq === "yearly" ? " selected" : "") + '>Yearly</option></select>' + err(m, "repeat") + '</div>';
      if (f.repeatFreq) {
        h += '<div class="cal-row"><div class="cal-field"><label for="calF_interval">Every</label><input type="number" id="calF_interval" min="1" max="99" inputmode="numeric" value="' + esc(f.repeatInterval) + '"></div><div class="cal-field"><label for="calF_until">Until (optional)</label><input type="date" id="calF_until" value="' + esc(f.until) + '"></div></div>';
        if (f.repeatFreq === "weekly") h += '<div class="cal-field"><span class="cal-lab" id="calF_by_l">On</span><div class="cal-chips" role="group" aria-labelledby="calF_by_l">' + dows.map(function (d, i) { const on = f.byDay.indexOf(i) !== -1; return '<button type="button" class="cal-chip-btn" data-cal="byday" data-v="' + i + '" aria-pressed="' + on + '">' + d + '</button>'; }).join("") + '</div></div>';
      }
    }
    h += reminderPickerHtml(m);
    h += '<div class="cal-field"><label for="calF_priority">Priority</label><select id="calF_priority">' + selOpts(C.PRIORITIES.map(function (p) { return { value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }; }), f.priority) + '</select></div>';
    h += '<div class="cal-field"><label for="calF_description">Description</label><textarea id="calF_description" maxlength="' + C.DESC_MAX + '" rows="2">' + esc(f.description) + '</textarea>' + err(m, "description") + '</div>';
    h += '<div class="cal-field"><label for="calF_notes">Notes (optional)</label><textarea id="calF_notes" maxlength="' + C.NOTES_MAX + '" rows="3">' + esc(f.notes) + '</textarea>' + err(m, "notes") + '</div>';
    h += '<div class="cal-actions"><button type="submit" class="btn btn-primary">' + (editing ? "Save" : "Add to calendar") + '</button><button type="button" class="btn btn-secondary" data-cal="close">Cancel</button></div>';
    if (editing) h += '<div class="cal-actions cal-actions-more"><button type="button" class="btn btn-secondary" data-cal="duplicate">Duplicate</button><button type="button" class="btn btn-danger" data-cal="delete">Delete' + (recurring && f.scope === "this" ? " this one" : recurring ? " all" : "") + '</button></div>';
    return h;
  }

  // "Remind me": up to five of the usual choices. Values saved from elsewhere that aren't in the list are kept and shown.
  function reminderLabel(v) { const c = C.REMINDER_CHOICES.filter(function (x) { return x.value === v; })[0]; return c ? c.label : v >= 1440 && v % 1440 === 0 ? (v / 1440) + " days before" : v >= 60 && v % 60 === 0 ? (v / 60) + " hours before" : v + " minutes before"; }
  function reminderPickerHtml(m) {
    const f = m.form, cur = f.reminders || [], values = C.REMINDER_CHOICES.map(function (c) { return c.value; });
    cur.forEach(function (v) { if (values.indexOf(v) === -1) values.push(v); });
    values.sort(function (a, b) { return a - b; });
    let h = '<fieldset class="cal-rem"><legend>Remind me</legend><div class="cal-rem-list">' + values.map(function (v) {
      return '<label class="cal-check"><input type="checkbox" name="calF_rem" value="' + v + '"' + (cur.indexOf(v) !== -1 ? " checked" : "") + '> ' + esc(reminderLabel(v)) + '</label>';
    }).join("") + '</div>' + (m.errors.reminders ? '<p class="cal-err" role="alert">' + esc(m.errors.reminders) + '</p>' : "");
    h += '<p class="field-hint">Shown in JARVIS while it is open' + (f.allDay ? ", counted from " + C.timeLabel(settings.notify.allDayAt) + " on the day (all-day items have no start time)" : "") + '. ' +
      '<button type="button" class="cal-more" data-cal="rem-settings">Reminder settings</button></p></fieldset>';
    return h;
  }

  function taskSheetHtml(m) {
    const it = m.item, h = habits();
    const when = it.allDay ? dayName(it.date) + " · no time set" : dayName(it.date) + " · " + C.timeLabel(it.time);
    return '<div class="cal-field"><span class="cal-lab">Task</span><p><strong>' + esc(it.title) + '</strong></p><p class="field-hint">' + esc(when) + ' · ' + esc(it.priority) + ' priority</p></div>' +
      '<p class="field-hint">This is one of your tasks from the To-Do list. Changes here change that task.</p>' +
      '<div class="cal-actions"><button type="button" class="btn btn-primary" data-cal="task-toggle">' + (it.completed ? "Mark not done" : "Mark done") + '</button>' +
      (h ? '<button type="button" class="btn btn-secondary" data-cal="task-open">Open in Habits</button>' : "") + '<button type="button" class="btn btn-secondary" data-cal="close">Close</button></div>';
  }

  const EXT = {
    goal: { title: "Goal", where: "Habits \u203a Goals", nav: "navBtnHabits", sub: "habitsSubNavGoals", note: "This date comes from one of your personal goals. Change it in Habits." }
  };
  function externalTitle(it) { return (EXT[it.source] || EXT.goal).title; }
  function externalSheetHtml(m) {
    const it = m.item, x = EXT[it.source] || EXT.goal, canTick = false;
    return '<div class="cal-field"><span class="cal-lab">' + esc(x.title) + '</span><p><strong>' + esc(it.title) + '</strong></p><p class="field-hint">' + esc(dayName(it.date)) + (it.completed ? " \u00b7 done" : "") + '</p></div>' +
      '<p class="field-hint">' + esc(x.note) + '</p>' +
      '<div class="cal-actions">' + (canTick ? '<button type="button" class="btn btn-primary" data-cal="ext-toggle">' + (it.completed ? "Mark not done" : "Mark done") + '</button>' : "") +
      '<button type="button" class="btn ' + (canTick ? "btn-secondary" : "btn-primary") + '" data-cal="ext-open">Open in ' + esc(x.where.split(" \u203a ")[0]) + '</button><button type="button" class="btn btn-secondary" data-cal="close">Close</button></div>';
  }
  // Takes you to where the item lives: the Habits tab and the sub-tab it is on.
  function goToSource(it) {
    const x = EXT[it.source];
    if (!x) return;
    const b = $(x.nav); if (b) b.click();
    const sub = $(x.sub); if (sub) sub.click();
  }

  function settingsFormHtml() {
    const s = settings, dz = C.deviceZone();
    const zones = ZONES.slice(); if (zones.indexOf(dz) === -1) zones.unshift(dz); if (s.timeZone && zones.indexOf(s.timeZone) === -1) zones.unshift(s.timeZone);
    return '<div class="cal-field"><label for="calS_zone">Time zone</label><select id="calS_zone"><option value="">This device (' + esc(dz.replace(/_/g, " ")) + ')</option>' + zones.map(function (z) { return '<option value="' + esc(z) + '"' + (z === s.timeZone ? " selected" : "") + '>' + esc(z.replace(/_/g, " ")) + '</option>'; }).join("") + '</select></div>' +
      '<div class="cal-row"><div class="cal-field"><label for="calS_week">Week starts on</label><select id="calS_week"><option value="1"' + (s.weekStart === 1 ? " selected" : "") + '>Monday</option><option value="0"' + (s.weekStart === 0 ? " selected" : "") + '>Sunday</option></select></div>' +
      '<div class="cal-field"><label for="calS_view">Opens in</label><select id="calS_view">' + selOpts([{ value: "", label: "Automatic" }, { value: "month", label: "Month" }, { value: "week", label: "Week" }, { value: "day", label: "Day" }, { value: "agenda", label: "Agenda" }], s.defaultView) + '</select></div></div>' +
      '<div class="cal-field"><label for="calS_len">New events last</label><select id="calS_len">' + selOpts([30, 45, 60, 90, 120, 180].map(function (n) { return { value: n, label: n < 60 ? n + " minutes" : (n / 60) + (n === 60 ? " hour" : " hours") }; }), s.defaultDuration) + '</select></div>' +
      '<div class="cal-field"><label for="calS_rem">New events remind me</label><select id="calS_rem">' + selOpts([{ value: -1, label: "Not at all" }].concat(C.REMINDER_CHOICES), s.defaultReminder) + '</select></div>' +
      '<button type="button" class="btn btn-secondary" data-cal="rem-settings">Reminder and notification settings</button>' +
      '<button type="button" class="btn btn-secondary" data-cal="ics-open">Google Calendar and calendar files</button>' +
      '<p class="field-hint">Events keep the time zone they were made in, so a 9 AM meeting stays 9 AM there. They are shown here in the zone above.</p>' +
      '<div class="cal-actions"><button type="submit" class="btn btn-primary">Save settings</button><button type="button" class="btn btn-secondary" data-cal="close">Cancel</button></div>';
  }

  function showModal() {
    const overlay = $("calModal"), form = $("calForm");
    $("calModalTitle").textContent = modal.kind === "settings" ? "Calendar settings" : modal.kind === "task" ? "Task" : modal.kind === "external" ? externalTitle(modal.item) : modal.mode === "new" ? "New" : "Edit";
    if (modal.kind === "event") $("calModalTitle").textContent = modal.mode === "new" ? "New event" : "Edit " + C.kindInfo(modal.form.kind).label.toLowerCase();
    if (modal.kind === "keys") $("calModalTitle").textContent = "Keyboard shortcuts";
    form.innerHTML = modal.kind === "keys" ? keysHtml() : modal.kind === "settings" ? settingsFormHtml() : modal.kind === "task" ? taskSheetHtml(modal) : modal.kind === "external" ? externalSheetHtml(modal) : eventFormHtml(modal);
    overlay.classList.remove("hidden");
  }
  function closeModal(focusOpener) {
    const m = modal; modal = null;
    $("calModal").classList.add("hidden"); $("calForm").innerHTML = "";
    if (focusOpener !== false && m && m.opener && m.opener.focus && document.contains(m.opener)) m.opener.focus();
  }
  // Reads the fields back into the form state (called before anything redraws the popup).
  function syncForm() {
    if (!modal || modal.kind !== "event") return;
    const f = modal.form, v = function (id) { const e = $(id); return e ? e.value : undefined; };
    ["title", "kind", "category", "priority", "date", "time", "endDate", "endTime", "description", "notes"].forEach(function (k) { const x = v("calF_" + k); if (x !== undefined) f[k] = x; });
    const ad = $("calF_allDay"); if (ad) f.allDay = ad.checked;
    const rems = document.querySelectorAll('#calForm input[name="calF_rem"]');
    if (rems.length) f.reminders = Array.prototype.filter.call(rems, function (x) { return x.checked; }).map(function (x) { return Number(x.value); });
    const rp = v("calF_repeat"); if (rp !== undefined) f.repeatFreq = rp;
    const iv = v("calF_interval"); if (iv !== undefined) f.repeatInterval = iv;
    const un = v("calF_until"); if (un !== undefined) f.until = un;
  }
  function redrawModal(focusId, stateIsCurrent) { if (!stateIsCurrent) syncForm(); modal.errors = {}; modal.error = ""; showModal(); if (focusId) focusSoon("#" + focusId); }

  function formInput(f, cur, occDate) {
    const input = { title: f.title, kind: f.kind, category: f.category, priority: f.priority, allDay: f.allDay, date: f.date, time: f.time, endDate: f.endDate, endTime: f.endTime, tz: f.tz,
      reminders: f.reminders, description: f.description, notes: f.notes, linked: f.linked, status: f.status, completed: f.completed, repeat: null };
    if (f.repeatFreq && (!cur || !cur.repeat || f.scope === "all")) input.repeat = { freq: f.repeatFreq, interval: f.repeatInterval, byDay: f.byDay, until: f.until };
    if (cur && cur.repeat && f.scope === "all") {
      // The popup shows the day you opened; saving the whole series moves its start by the same number of days.
      const delta = C.diffDays(occDate, f.date), start = C.addDays(cur.date, delta);
      input.date = start; input.endDate = C.addDays(start, C.diffDays(f.date, f.endDate));
    }
    return input;
  }

  function saveModal() {
    if (!modal || modal.kind !== "event") return;
    syncForm();
    const f = modal.form, cur = modal.mode === "edit" ? C.byId(events, modal.id) : null;
    if (modal.mode === "edit" && !cur) { closeModal(); render(); core().showToast("That isn't there any more."); return; }
    const input = formInput(f, cur, modal.occDate);
    let res;
    if (modal.mode === "new") res = C.add(events, input, ctx());
    else if (!cur.repeat) res = C.edit(events, cur.id, input, ctx());
    else if (f.scope === "all") res = C.edit(events, cur.id, input, ctx());
    else res = C.editOccurrence(events, cur.id, modal.occDate, input, "this", ctx());
    if (!res.ok) {
      modal.errors = res.errors || {}; modal.error = res.errors && Object.keys(res.errors).length ? "" : res.error; showModal();
      const first = Object.keys(modal.errors)[0];
      focusSoon("#calF_" + (first === "repeat" ? "repeat" : first || "title")); announce(res.error);
      return;
    }
    const isNew = modal.mode === "new", saved = res.event, opener = modal.opener;
    if (!commit(res.events)) { modal.error = saveError; showModal(); return; }
    closeModal(false);
    if (saved && C.isDate(saved.date)) { if (view !== "agenda" && (saved.date < C.rangeFor(view, anchor, settings.weekStart).from || saved.date > C.rangeFor(view, anchor, settings.weekStart).to)) { anchor = saved.date; selected = saved.date; } }
    render();
    announce((isNew ? "Added " : "Saved ") + saved.title + ".");
    // Opened from another screen (Home)? Put focus back on what opened it. Otherwise on the event just saved.
    if (!panelActive() && opener && opener.focus && document.contains(opener)) opener.focus(); else focusSoon('[data-key^="' + saved.id + '@"]', true);
  }

  /* ---------------- other changes ---------------- */

  function showUndo(label, fn) {
    hideUndo();
    const bar = $("calUndo");
    bar.innerHTML = '<span>' + esc(label) + '</span><button type="button" class="btn btn-secondary" data-cal="undo">Undo</button>';
    bar.classList.remove("hidden");
    undo = { fn: fn, timer: window.setTimeout(hideUndo, UNDO_MS) };
    announce(label + " Undo is available for a few seconds.");
  }
  function hideUndo() { if (undo && undo.timer) window.clearTimeout(undo.timer); undo = null; const bar = $("calUndo"); if (bar) { bar.classList.add("hidden"); bar.innerHTML = ""; } }
  // Puts events back as they were. Each gets a new "updated" time so the undo wins over the change when the copies merge.
  function revertFn(prev, nextIds, createdIds) {
    return function () {
      const byId = {}; prev.forEach(function (e) { byId[e.id] = e; });
      const now = Date.now(), c = ctx();
      let list = events.map(function (e) { return nextIds.indexOf(e.id) !== -1 && byId[e.id] ? Object.assign({}, byId[e.id], { updatedAt: now }) : e; });
      createdIds.forEach(function (id) { const r = C.remove(list, id, c); if (r.ok) list = r.events; });
      if (commit(list)) { render(); announce("Undone."); }
    };
  }
  function withUndo(label, prev, next) {
    const ids = changed(prev, next), created = next.filter(function (e) { return !prev.some(function (p) { return p.id === e.id; }); }).map(function (e) { return e.id; });
    showUndo(label, revertFn(prev, ids, created));
  }

  function chooseScope(title, text) {
    return new Promise(function (resolve) {
      const sheet = $("calScope"), prevFocus = document.activeElement;
      $("calScopeTitle").textContent = title; $("calScopeText").textContent = text;
      sheet.classList.remove("hidden");
      focusSoon('#calScope [data-scope="this"]');
      const done = function (v) { sheet.classList.add("hidden"); sheet.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey, true); if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); resolve(v); };
      const onClick = function (e) { const b = e.target.closest("[data-scope]"); if (b) done(b.getAttribute("data-scope") === "cancel" ? null : b.getAttribute("data-scope")); else if (e.target === sheet) done(null); };
      const onKey = function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } };
      sheet.addEventListener("click", onClick); document.addEventListener("keydown", onKey, true);
    });
  }

  function deleteFromModal() {
    const cur = C.byId(events, modal.id);
    if (!cur) { closeModal(); render(); return; }
    const prev = events, occ = modal.occDate, f = modal.form;
    const res = cur.repeat && f.scope === "this" ? C.removeOccurrence(events, cur.id, occ, ctx()) : C.remove(events, cur.id, ctx());
    if (!res.ok) { core().showToast(res.error); return; }
    if (!commit(res.events)) { modal.error = saveError; showModal(); return; }
    const title = cur.title;
    closeModal(false); render();
    withUndo("Deleted “" + title + "”.", prev, res.events);
  }
  function duplicateFromModal() {
    const res = C.duplicate(events, modal.id, ctx());
    if (!res.ok) { core().showToast(res.error); return; }
    const prev = events;
    if (!commit(res.events)) { modal.error = saveError; showModal(); return; }
    closeModal(false); render();
    withUndo("Duplicated “" + res.event.title + "”.", prev, res.events);
    openEdit({ id: res.event.id, occDate: res.event.date });
  }
  function tick(key) {
    const it = itemMap[key];
    if (!it) return;
    if (it.source === "task") {
      const h = habits(); if (!h) return;
      h.commitTasks(h.getTasks().map(function (t) { return t.id === it.id ? Object.assign({}, t, { completed: !t.completed }) : t; }));
      render(); notify(); announce((it.completed ? "Not done: " : "Done: ") + it.title + "."); return;
    }
    if (it.readOnly) return;
    const res = C.setDone(events, it.id, it.occDate, !it.completed, ctx());
    if (res.ok && commit(res.events)) { render(); announce((it.completed ? "Not done: " : "Done: ") + it.title + "."); }
  }


  /* ---------------- moving by drag ---------------- */

  function moveItem(it, target) {
    if (it.source === "task") {
      const h = habits(); if (!h) return;
      const keepTime = target.time === undefined;
      h.commitTasks(h.getTasks().map(function (t) { return t.id === it.id ? Object.assign({}, t, { date: target.date, time: keepTime ? t.time : target.time }) : t; }));
      render(); notify(); announce("Moved " + it.title + " to " + dayName(target.date) + (keepTime ? "" : " at " + C.timeLabel(target.time)) + "."); return;
    }
    if (it.readOnly) return;
    const ev = C.byId(events, it.id);
    if (!ev) return;
    const go = function (scope) {
      const prev = events, res = C.moveTo(events, it.id, it.occDate, target, scope, ctx());
      if (!res.ok) { core().showToast(res.error); render(); return; }
      if (!commit(res.events)) return;
      render(); withUndo("Moved “" + it.title + "”.", prev, res.events);
      announce("Moved " + it.title + " to " + dayName(target.date) + (target.time ? " at " + C.timeLabel(target.time) : "") + ".");
    };
    if (!ev.repeat) go("all");
    else chooseScope("Move a repeating event", "Move just " + dayName(it.occDate, { month: "short", day: "numeric" }) + ", or every time it repeats?").then(function (s) { if (s) go(s); else render(); });
  }
  function resizeItem(it, end) {
    const prev = events, res = C.resizeTo(events, it.id, it.occDate, end, ctx());
    if (!res.ok) { core().showToast(res.error); render(); return; }
    if (!commit(res.events)) return;
    render(); withUndo("Changed the end of “" + it.title + "”.", prev, res.events);
    announce("Now ends at " + C.timeLabel(end.time) + ".");
  }

  function targetAt(x, y) {
    const e = document.elementFromPoint(x, y);
    return e ? e.closest(".cal-col, .cal-cell") : null;
  }
  function snapMinute(col, y, offsetMin) {
    const r = col.getBoundingClientRect(), raw = (y - r.top) / r.height * 1440 - (offsetMin || 0);
    return Math.max(0, Math.min(1440 - SNAP, Math.round(raw / SNAP) * SNAP));
  }
  function beginDrag() {
    if (!drag || drag.active) return;
    drag.active = true;
    const it = itemMap[drag.key]; if (!it) { cancelDrag(); return; }
    drag.item = it;
    drag.el.classList.add("is-dragging");
    const g = document.createElement("div"); g.className = "cal-ghost"; g.setAttribute("aria-hidden", "true"); g.textContent = it.title; document.body.appendChild(g); drag.ghost = g;
    const r = drag.el.getBoundingClientRect(), col = drag.el.closest(".cal-col");
    drag.grabMin = col ? ((drag.startY - r.top) / col.getBoundingClientRect().height) * 1440 : 0;
    drag.scroll = $("calScroll");
    drag.auto = window.setInterval(autoScroll, 40);
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* not supported */ } }
    updateDrag();
  }
  function autoScroll() {
    if (!drag || !drag.active || !drag.scroll) return;
    const r = drag.scroll.getBoundingClientRect();
    if (drag.y < r.top + 36) { drag.scroll.scrollTop -= 14; updateDrag(); } else if (drag.y > r.bottom - 36) { drag.scroll.scrollTop += 14; updateDrag(); }
  }
  function updateDrag() {
    if (!drag || !drag.active) return;
    const g = drag.ghost;
    g.style.left = Math.min(window.innerWidth - 150, drag.x + 12) + "px"; g.style.top = (drag.y + 12) + "px";
    Array.prototype.forEach.call(document.querySelectorAll(".is-drop"), function (n) { n.classList.remove("is-drop"); });
    const t = targetAt(drag.x, drag.y);
    drag.target = null;
    if (drag.mode === "resize") {
      const col = drag.el.closest(".cal-col"); if (!col) return;
      const em = Math.max(drag.item.startMin + SNAP, Math.min(1425, snapMinute(col, drag.y, 0)));
      drag.target = { date: col.getAttribute("data-date"), time: C.timeOf(em) };
      drag.el.style.height = ((em - drag.item.startMin) / 14.4) + "%";
      g.textContent = "Ends " + C.timeLabel(drag.target.time); return;
    }
    if (!t) { g.textContent = drag.item.title; return; }
    t.classList.add("is-drop");
    const date = t.getAttribute("data-date");
    if (t.classList.contains("cal-col")) {
      const min = snapMinute(t, drag.y, drag.grabMin); drag.target = { date: date, time: C.timeOf(min) };
      g.textContent = dayName(date, { weekday: "short", month: "short", day: "numeric" }) + " · " + C.timeLabel(drag.target.time);
    } else {
      drag.target = { date: date, time: drag.item.allDay ? undefined : drag.item.time };
      g.textContent = dayName(date, { weekday: "short", month: "short", day: "numeric" });
    }
  }
  function cancelDrag() {
    if (!drag) return;
    if (drag.timer) window.clearTimeout(drag.timer);
    if (drag.auto) window.clearInterval(drag.auto);
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (drag.el) drag.el.classList.remove("is-dragging");
    Array.prototype.forEach.call(document.querySelectorAll(".is-drop"), function (n) { n.classList.remove("is-drop"); });
    document.removeEventListener("pointermove", onPointerMove); document.removeEventListener("pointerup", onPointerUp); document.removeEventListener("pointercancel", onPointerCancel);
    drag = null;
  }
  function onPointerDown(e) {
    if (modal || (e.pointerType === "mouse" && e.button !== 0)) return;
    const handle = e.target.closest("[data-resize]"), el = handle ? handle.closest("[data-drag]") : e.target.closest("[data-drag]");
    if (!el) return;
    cancelDrag();
    drag = { mode: handle ? "resize" : "move", key: el.getAttribute("data-key"), el: el, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" || e.pointerType === "pen", active: false, timer: null };
    if (drag.touch && !handle) drag.timer = window.setTimeout(beginDrag, 380);
    document.addEventListener("pointermove", onPointerMove); document.addEventListener("pointerup", onPointerUp); document.addEventListener("pointercancel", onPointerCancel);
  }
  function onPointerMove(e) {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.active) {
      const moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (drag.touch && drag.mode === "move") { if (moved > 10) cancelDrag(); return; }   // moving before the press is held is scrolling
      if (moved > 5) beginDrag(); else return;
    }
    e.preventDefault(); updateDrag();
  }
  function onPointerUp() {
    if (!drag) return;
    const d = drag;
    if (!d.active) { cancelDrag(); return; }
    const target = d.target, it = d.item, mode = d.mode;
    cancelDrag();
    suppressClickUntil = Date.now() + 120;
    if (!target) { render(); return; }
    if (mode === "resize") resizeItem(it, target); else if (target.date !== it.date || (target.time !== undefined && target.time !== it.time)) moveItem(it, target); else render();
  }
  function onPointerCancel() { const was = drag && drag.active; cancelDrag(); if (was) render(); }

  /* ---------------- taps and keys ---------------- */

  function onStageClick(e) {
    if (Date.now() < suppressClickUntil) return;
    const el = e.target.closest("[data-cal]");
    const act = el ? el.getAttribute("data-cal") : null;
    if (act === "open") {
      const key = el.getAttribute("data-key"), it = itemMap[key];
      if (it) openItem(it);
      return;
    }
    if (act === "tick") { tick(el.getAttribute("data-key")); return; }
    if (act === "num") {
      const d = el.getAttribute("data-date");
      if (isPhone()) { selected = d; anchor = d; render(); announce(dayName(d) + "."); } else gotoDay(d);
      return;
    }
    if (act === "goto-day") { gotoDay(el.getAttribute("data-date")); return; }
    if (act === "new-on") { openNew({ date: el.getAttribute("data-date") }); return; }
    if (act === "new") { openNew({}); return; }
    if (act === "clear") { clearFilters(); return; }
    if (act === "slot" && e.target === el) {
      const date = el.getAttribute("data-date"), min = snapMinute(el, e.clientY, 0);
      openNew({ date: date, time: C.timeOf(Math.min(min, 1380)) }); return;
    }
    const cell = e.target.closest(".cal-cell");
    if (cell && !el) {
      const d = cell.getAttribute("data-date");
      if (isPhone()) { selected = d; anchor = d; render(); } else { selected = d; openNew({ date: d }); }
    }
  }
  function openItem(it) {
    if (it.source === "goal") { modal = { kind: "external", item: it, opener: document.activeElement }; showModal(); focusSoon('#calForm [data-cal="ext-open"]'); return; }
    if (it.source === "task") { modal = { kind: "task", item: it, opener: document.activeElement }; showModal(); focusSoon('#calForm [data-cal="task-toggle"]'); return; }
    openEdit(it); focusSoon("#calF_title");
  }
  function clearFilters() { filters = { q: "", categories: [], hideDone: false }; $("calSearch").value = ""; render(); announce("Filters cleared."); }

  function onToolbarClick(e) {
    const el = e.target.closest("[data-cal]"); if (!el) return;
    const act = el.getAttribute("data-cal");
    if (act === "cat") { const v = el.getAttribute("data-v"), i = filters.categories.indexOf(v); if (i === -1) filters.categories.push(v); else filters.categories.splice(i, 1); render(); focusSoon('#calFilters [data-v="' + v + '"]'); }
    else if (act === "hidedone") { filters.hideDone = !filters.hideDone; render(); focusSoon('#calFilters [data-cal="hidedone"]'); }
    else if (act === "clear") clearFilters();
    else if (act === "settings") openSettings();
    else if (act === "keys") openKeys();
    else if (act === "dismiss") { saveError = ""; renderStatus(); }
  }
  // The keys the calendar answers to (when you are not typing in a box). Kept in one list so this screen can't drift from onKey.
  const SHORTCUTS = [["t", "Go to today"], ["m", "Month view"], ["w", "Week view"], ["d", "Day view"], ["a", "Agenda view"], ["n", "New event"], ["p", "Planning assistant"], ["/", "Search"],
    ["\u2190  \u2192  or  k  j", "Previous / next"], ["?", "This list"], ["Esc", "Close what is open"]];
  function keysHtml() {
    return '<p class="field-hint">These work on the Calendar screen when you are not typing in a box.</p><dl class="cal-keys">' + SHORTCUTS.map(function (x) { return '<div class="cal-key-row"><dt><kbd>' + esc(x[0]) + '</kbd></dt><dd>' + esc(x[1]) + '</dd></div>'; }).join("") + '</dl>' +
      '<div class="cal-actions"><button type="submit" class="btn btn-primary">Close</button></div>';
  }
  function openKeys() { modal = { kind: "keys", opener: document.activeElement }; showModal(); focusSoon("#calForm .btn-primary"); }
  function openSettings() { modal = { kind: "settings", opener: document.activeElement }; showModal(); focusSoon("#calS_zone"); }

  function onModalClick(e) {
    const el = e.target.closest("[data-cal]");
    if (!el) return;
    const act = el.getAttribute("data-cal");
    if (act === "close") { closeModal(); return; }
    if (act === "scope") { syncForm(); modal.form.scope = el.getAttribute("data-v"); redrawModal(); focusSoon('#calForm [data-cal="scope"][data-v="' + modal.form.scope + '"]'); return; }
    if (act === "byday") { syncForm(); const d = Number(el.getAttribute("data-v")), a = modal.form.byDay, i = a.indexOf(d); if (i === -1) a.push(d); else if (a.length > 1) a.splice(i, 1); modal.form.byDay = a.sort(function (x, y) { return x - y; }); redrawModal(); focusSoon('#calForm [data-cal="byday"][data-v="' + d + '"]'); return; }
    if (act === "rem-settings") { if (modal && modal.kind === "event") syncForm(); if (window.JarvisCalReminders) window.JarvisCalReminders.openSettings(el); return; }
    if (act === "ics-open") { closeModal(false); if (window.JarvisCalFile) window.JarvisCalFile.open($("calFoot") ? $("calFoot").querySelector('[data-cal="settings"]') : null); return; }   // closed first: the Undo bar must not sit behind it
    if (act === "duplicate") { duplicateFromModal(); return; }
    if (act === "delete") { deleteFromModal(); return; }
    if (act === "ext-toggle") { const it = modal.item; closeModal(); tickItem(it); return; }
    if (act === "ext-open") { const it = modal.item; closeModal(false); goToSource(it); return; }
    if (act === "task-toggle") { const it = modal.item; closeModal(); tickItem(it); return; }
    if (act === "task-open") { const it = modal.item, h = habits(); closeModal(false); const b = $("navBtnHabits"); if (b) b.click(); if (h) h.selectDate(it.date); return; }
  }
  function tickItem(it) { itemMap[it.key] = it; tick(it.key); }

  function onModalChange(e) {
    if (!modal || modal.kind !== "event") return;
    const id = e.target.id;
    const f = modal.form;
    if (id === "calF_kind") {
      const wasPoint = C.isPoint(f.kind);
      syncForm();
      if (C.isPoint(f.kind)) {
        f.allDay = false;
        if (!wasPoint && (f.kind === "task" || f.kind === "milestone")) f.time = "";   // a deadline with no time is the usual case
        else if (!f.time) f.time = defaultStartTime(f.date);
      } else if (!f.time) {
        f.time = defaultStartTime(f.date);
        const e2 = addMinutes(f.date, f.time, settings.defaultDuration); f.endDate = e2.date; f.endTime = e2.time;
      }
      redrawModal("calF_kind", true); return;
    }
    if (id === "calF_allDay" || id === "calF_repeat") { redrawModal(id); return; }
    if (id === "calF_time" || id === "calF_date") {
      // Moving the start moves the end with it, so the length stays the same.
      const before = { date: f.date, time: f.time };
      syncForm();
      if (!C.isPoint(f.kind) && !f.allDay && C.isDate(f.date) && C.isTime(f.time) && C.isDate(before.date) && C.isTime(before.time) && C.isDate(f.endDate) && C.isTime(f.endTime)) {
        const len = (C.diffDays(before.date, f.endDate)) * 1440 + C.minutesOf(f.endTime) - C.minutesOf(before.time);
        if (len > 0) { const e2 = addMinutes(f.date, f.time, len); f.endDate = e2.date; f.endTime = e2.time; const ed = $("calF_endDate"), et = $("calF_endTime"); if (ed) ed.value = f.endDate; if (et) et.value = f.endTime; }
      } else if (f.allDay && id === "calF_date" && C.isDate(f.date) && (!C.isDate(f.endDate) || f.endDate < f.date)) { f.endDate = f.date; const ed = $("calF_endDate"); if (ed) ed.value = f.endDate; }
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!modal) return;
    if (modal.kind === "keys") { closeModal(); return; }
    if (modal.kind === "settings") { saveSettings(); return; }
    if (modal.kind === "event") saveModal();
  }
  function saveSettings() {
    const g = function (id) { return $(id).value; };
    const next = C.settings({ timeZone: g("calS_zone"), weekStart: Number(g("calS_week")), defaultView: g("calS_view"), defaultDuration: Number(g("calS_len")), defaultReminder: Number(g("calS_rem")), plan: settings.plan, notify: settings.notify, updatedAt: Date.now() });
    if (!core().saveJSON(SET_KEY, next)) { saveError = "The browser would not save your settings."; renderStatus(); return; }
    settings = next; closeModal(); render(); announce("Settings saved.");
  }

  function onKey(e) {
    if (e.key === "Escape" && modal) { e.preventDefault(); closeModal(); return; }
    if (modal && modal.kind === "event" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveModal(); return; }
    if (!panelActive() || modal || e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target, tag = tg && tg.tagName ? tg.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (tg && tg.isContentEditable)) { if (e.key === "Escape" && tg.id === "calSearch") { tg.blur(); } return; }
    const k = e.key;
    if (k === "t") goToday(); else if (k === "m") setView("month"); else if (k === "w") setView("week"); else if (k === "d") setView("day"); else if (k === "a") setView("agenda"); else if (k === "p" && window.JarvisAssistant) window.JarvisAssistant.open($("calAssist")); else if (k === "?") { e.preventDefault(); openKeys(); }
    else if (k === "n") { e.preventDefault(); openNew({}); focusSoon("#calF_title"); } else if (k === "/") { e.preventDefault(); $("calSearch").focus(); }
    else if (k === "ArrowLeft" && tag !== "button") go(-1); else if (k === "ArrowRight" && tag !== "button") go(1);
    else if (k === "j") go(1); else if (k === "k") go(-1);
    else return;
  }

  function tickNow() {
    if (!ready || !panelActive() || modal || drag) return;
    if (today() !== lastDay) { render(); return; }
    const line = document.querySelector("#calStage .cal-now");
    if (line) line.style.top = (nowMin() / 14.4).toFixed(3) + "%";
  }

  /* ---------------- start ---------------- */

  function onShow() {
    if (!ready) return;
    wantScroll = true; render();
  }
  function init() {
    if (!$("panel-calendar") || !C) return;
    load();
    anchor = today(); selected = anchor;
    view = settings.defaultView || (isPhone() ? "agenda" : "week");
    $("calPrev").addEventListener("click", function () { go(-1); });
    $("calNext").addEventListener("click", function () { go(1); });
    $("calToday").addEventListener("click", goToday);
    $("calNew").addEventListener("click", function () { openNew({}); focusSoon("#calF_title"); });
    Array.prototype.forEach.call(document.querySelectorAll(".cal-view-btn"), function (b) { b.addEventListener("click", function () { setView(b.getAttribute("data-view")); }); });
    $("calFilterBtn").addEventListener("click", function () { filtersOpen = !filtersOpen; renderToolbar(); });
    $("calFilters").addEventListener("click", onToolbarClick);
    $("calFoot").addEventListener("click", onToolbarClick);
    $("calStatus").addEventListener("click", onToolbarClick);
    $("calSearch").addEventListener("input", function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () { filters.q = $("calSearch").value; render(); }, 120);
    });
    const stage = $("calStage");
    stage.addEventListener("click", onStageClick);
    stage.addEventListener("pointerdown", onPointerDown);
    // Once a press has turned into a drag on a touch screen the page must not scroll with it.
    stage.addEventListener("touchmove", function (e) { if (drag && drag.active && e.cancelable) e.preventDefault(); }, { passive: false });
    $("calUndo").addEventListener("click", function (e) { if (e.target.closest('[data-cal="undo"]')) { const u = undo; hideUndo(); if (u) u.fn(); } });
    const form = $("calForm");
    form.addEventListener("click", onModalClick);
    form.addEventListener("change", onModalChange);
    form.addEventListener("submit", onSubmit);
    $("calModal").addEventListener("click", function (e) { if (e.target === $("calModal")) closeModal(); });
    document.addEventListener("keydown", onKey);
    document.addEventListener("jarvis-habits-day-changed", function () { if (panelActive()) render(); });
    nowTimer = window.setInterval(tickNow, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tickNow(); });
    ready = true;
    renderStatus(); render();
  }

  window.JarvisCalendar = {
    init: init, onShow: onShow, openNew: function (o) { openNew(o || {}); }, goTo: function (date, v) { if (C.isDate(date)) { anchor = date; selected = date; if (v) view = v; wantScroll = true; render(); } },
    getEvents: function () { return events.slice(); }, getSettings: function () { return Object.assign({}, settings); }, zone: zone,
    // Every item from..to (dates in the view zone): events, your tasks and your personal goals, with no filters applied.
    itemsBetween: function (from, to) { return allItems(from, to); },
    // Open an event's popup from another screen (Home).
    openEvent: function (id, occDate) { if (C.byId(events, id)) { openEdit({ id: id, occDate: occDate }); focusSoon("#calF_title"); } },
    // Tick something shown on the schedule, from any screen.
    toggleItem: function (it) { if (it) { itemMap[it.key] = it; tick(it.key); } },
    goToSource: goToSource,
    // Open the popup or sheet for any schedule item from another screen (Home).
    openItem: function (it) { if (it) { itemMap[it.key] = it; openItem(it); } },
    // For the planning assistant (assistant-ui.js): the same saving, undo and settings the rest of the calendar uses.
    // commitEvents saves a new list (false if the browser refused). undoable shows the Undo bar for a change from prev to next,
    // and also() puts back anything outside the calendar that the same change touched (tasks, goals).
    commitEvents: function (next) { return commit(next); },
    undoable: function (label, prev, next, also) {
      const ids = changed(prev, next), created = next.filter(function (e) { return !prev.some(function (p) { return p.id === e.id; }); }).map(function (e) { return e.id; });
      const back = ids.length ? revertFn(prev, ids, created) : null;
      showUndo(label, function () { if (back) back(); if (also) also(); render(); notify(); });
    },
    saveSettings: function (next) {
      if (!core().saveJSON(SET_KEY, next)) { saveError = "The browser would not save your settings."; renderStatus(); return false; }
      settings = next; render(); return true;
    },
    refresh: function () { render(); notify(); },
    // For the reminders screen (calendar-reminders-ui.js): open an event from a reminder, wherever you are in JARVIS.
    showEvent: function (id, occDate) { const b = $("navBtnCalendar"); if (b) b.click(); if (!C.byId(events, id)) return false; anchor = occDate && C.isDate(occDate) ? occDate : anchor; selected = anchor; wantScroll = true; render(); openEdit({ id: id, occDate: occDate }); return true; },
    ctx: ctx, today: today, nowMin: nowMin
  };
})();
