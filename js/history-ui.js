/* ==========================================================================
   JARVIS — History: a month calendar, search and filters, readable workout cards, and a
   detail sheet to look closer, change the date, time or notes, or delete a workout (with
   undo). The History tab of Workout.

   Same in-memory data as the rest of Workout (window.JarvisWorkout.api). The rules for what
   to show are in progress-logic.js. Sheets and the undo bar are shared with the logger
   (window.JarvisWorkoutUI.kit).

   What is promised on screen:
     - Nothing is hidden: a card says how many sets and how much volume, and the detail sheet
       lists every set that was saved.
     - Deleting asks first, then can be undone for a few seconds.
     - Changing a workout's date or notes never touches its sets.
   ========================================================================== */

(function () {
  "use strict";

  const PL = window.JarvisProgressLogic;
  const WL = window.JarvisWorkoutLogic;
  const RL = window.JarvisRoutineLogic;
  const PAGE = 10;

  let started = false;
  const state = { year: 0, month: 0, day: null, query: "", routine: "", shown: PAGE };

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v === undefined || v === null ? "" : String(v)); }
  function api() { return window.JarvisWorkout.api; }
  function kit() { return window.JarvisWorkoutUI && window.JarvisWorkoutUI.kit; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function num(n) { return Number(n).toLocaleString("en-US"); }
  function exInfo(id) { return window.JarvisExercises.getExerciseById(id) || { id: id, name: "Unknown exercise", muscleGroup: "", equipment: "" }; }
  function todayKey() { return WL.dayKey(Date.now()); }
  function dateOf(key) { const p = String(key).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function prettyDate(key) { return dateOf(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function longDate(key) { return dateOf(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }

  function ctx() {
    const routines = api().getRoutines(), programs = api().getPrograms();
    return {
      label: function (w) { return RL ? RL.sessionLabel(w, routines) : (w.routineName || ""); },
      exerciseName: function (id) { return exInfo(id).name; },
      programText: function (w) {
        if (!w.programId) return "";
        const p = programs.filter(function (x) { return x.id === w.programId; })[0];
        if (!p) return "";
        const d = (p.days || []).filter(function (x) { return x.id === w.programDayId; })[0];
        return p.name + (d ? " · " + d.label : "");
      }
    };
  }

  /* ---------------- the calendar ---------------- */

  function monthIndex(year, month) { return year * 12 + month; }

  function calendarHtml(all) {
    const today = todayKey();
    const cal = PL.calendarMonth(all, state.year, state.month, today);
    const first = all.map(function (w) { return w.date; }).filter(Boolean).sort()[0];
    const firstIdx = first ? monthIndex(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1) : monthIndex(state.year, state.month);
    const nowIdx = monthIndex(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1);
    const cur = monthIndex(state.year, state.month);
    const head = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(function (d) { return '<th scope="col" abbr="' + d + '">' + d.charAt(0) + '</th>'; }).join("");
    const rows = cal.weeks.map(function (week) {
      return '<tr>' + week.map(function (d) {
        if (!d.inMonth) return '<td class="hs-cell is-out"></td>';
        const cls = "hs-day" + (d.count ? " is-on" : "") + (d.today ? " is-today" : "") + (d.future ? " is-future" : "") + (state.day === d.date ? " is-picked" : "");
        const dots = d.count ? '<span class="hs-dots" aria-hidden="true">' + new Array(Math.min(3, d.count) + 1).join('<i></i>') + '</span>' : "";
        if (!d.count) return '<td class="hs-cell"><span class="' + cls + '"><span class="hs-dn">' + d.day + '</span></span></td>';
        return '<td class="hs-cell"><button type="button" class="' + cls + '" data-hs="day" data-day="' + d.date + '" aria-pressed="' + (state.day === d.date) + '" aria-label="' + esc(longDate(d.date) + ": " + d.count + " " + plural(d.count, "workout")) + '"><span class="hs-dn">' + d.day + '</span>' + dots + '</button></td>';
      }).join("") + '</tr>';
    }).join("");
    return '<section class="card hs-calcard" aria-labelledby="hsCalTitle"><div class="hs-calhead">' +
      '<button type="button" class="wk-icon-btn" data-hs="prev" aria-label="Previous month"' + (cur <= firstIdx ? " disabled" : "") + '><span aria-hidden="true">&lsaquo;</span></button>' +
      '<div class="hs-calmid"><h2 class="hs-caltitle" id="hsCalTitle">' + esc(cal.title) + '</h2><span class="hs-calcount">' + cal.total + ' ' + plural(cal.total, "workout") + '</span></div>' +
      '<button type="button" class="wk-icon-btn" data-hs="next" aria-label="Next month"' + (cur >= nowIdx ? " disabled" : "") + '><span aria-hidden="true">&rsaquo;</span></button></div>' +
      '<table class="hs-cal"><caption class="visually-hidden">' + esc(cal.title) + ' workouts. Days with a workout are buttons: choose one to list just that day.</caption><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></section>';
  }

  /* ---------------- filters and the list ---------------- */

  function controlsHtml(all) {
    const opts = PL.routineOptions(all, ctx());
    return '<div class="hs-controls"><div class="form-row"><label for="hsSearch">Search</label><input type="search" id="hsSearch" placeholder="Routine, exercise or note" value="' + esc(state.query) + '" autocomplete="off" autocapitalize="off" enterkeyhint="search"></div>' +
      (opts.length > 1 ? '<div class="form-row"><label for="hsRoutine">Routine</label><select id="hsRoutine"><option value="">All workouts</option>' + opts.map(function (o) { return '<option value="' + esc(o.key) + '"' + (state.routine === o.key ? " selected" : "") + '>' + esc(o.label) + ' (' + o.count + ')</option>'; }).join("") + '</select></div>' : "") + '</div>';
  }

  function cardHtml(it) {
    const meta1 = [prettyDate(it.date), it.time, it.minutes ? it.minutes + " min" : ""].filter(Boolean).join(" · ");
    if (it.kind === "legacy") {
      return '<article class="hs-card"><button type="button" class="hs-open" data-hs="open" data-id="' + esc(it.id) + '"><span class="hs-top"><span class="hs-title">' + esc(it.title) + '</span></span>' +
        '<span class="hs-meta">' + esc([prettyDate(it.date), it.sub, it.minutes ? it.minutes + " min" : ""].filter(Boolean).join(" · ")) + '</span>' + (it.notes ? '<span class="hs-lines">' + esc(it.notes) + '</span>' : "") + '</button></article>';
    }
    const lines = it.exercises.slice(0, 2).map(function (e) { return esc(e.name) + ": " + e.sets + " " + plural(e.sets, "set") + (e.best ? ", best " + num(e.best.weight) + " × " + e.best.reps : ""); }).join("<br>");
    const more = it.exercises.length > 2 ? '<br><span class="hs-more">+' + (it.exercises.length - 2) + ' more ' + plural(it.exercises.length - 2, "exercise") + '</span>' : "";
    return '<article class="hs-card"><button type="button" class="hs-open" data-hs="open" data-id="' + esc(it.id) + '"><span class="hs-top"><span class="hs-title">' + esc(it.title) + '</span>' +
      (it.prs ? '<span class="hs-badge">' + it.prs + ' ' + plural(it.prs, "record") + '</span>' : "") + '</span>' +
      '<span class="hs-meta">' + esc(meta1) + '</span>' +
      '<span class="hs-meta">' + it.sets + ' ' + plural(it.sets, "set") + ' &middot; ' + num(it.volume) + ' lb volume' + (it.program ? ' &middot; ' + esc(it.program) : '') + '</span>' +
      '<span class="hs-lines">' + lines + more + '</span></button></article>';
  }

  function resultsHtml(all) {
    const c = ctx();
    const found = PL.filterHistory(all, { query: state.query, routine: state.routine, day: state.day }, c);
    const counts = PL.recordCountBySession(all);
    const shown = found.slice(0, state.shown);
    const filtered = !!(state.query || state.routine || state.day);
    const dayChip = state.day ? '<span class="hs-chip">' + esc(prettyDate(state.day)) + '</span>' : "";
    const head = '<div class="hs-resulthead"><p class="hs-count" id="hsCount" tabindex="-1" role="status" aria-live="polite">' + found.length + ' ' + plural(found.length, "workout") + (filtered ? " found" : "") + '</p>' + dayChip +
      (filtered ? '<button type="button" class="wk-link" data-hs="clear">Clear filters</button>' : "") + '</div>';
    if (!found.length) return head + '<p class="wk-empty">Nothing matches. Try fewer words, or clear the filters.</p>';
    return head + '<div class="hs-list">' + shown.map(function (w) { return cardHtml(PL.historyItem(w, c, counts)); }).join("") + '</div>' +
      (found.length > shown.length ? '<button type="button" class="btn btn-secondary wk-big-btn hs-more-btn" data-hs="more">Show more (' + (found.length - shown.length) + ' older)</button>' : "");
  }

  function render() {
    const root = $("hsRoot");
    if (!root) return;
    const all = api().getWorkouts().filter(function (w) { return w && typeof w.date === "string"; });
    if (!all.length) {
      root.innerHTML = '<section class="wk-block"><p class="wk-empty">No workouts yet. When you finish one, it shows up here with its sets, volume and any records.</p><button type="button" class="btn btn-primary wk-big-btn" data-wk-go="wk-home">Back to Home</button></section>';
      return;
    }
    const keepSearch = document.activeElement && document.activeElement.id === "hsSearch";
    root.innerHTML = calendarHtml(all) + '<div id="hsControls">' + controlsHtml(all) + '</div><div id="hsResults">' + resultsHtml(all) + '</div>';
    if (keepSearch) { const s = $("hsSearch"); if (s) { s.focus(); try { s.setSelectionRange(s.value.length, s.value.length); } catch (e) { /* not all input types allow it */ } } }
  }

  function renderResultsOnly() {
    const all = api().getWorkouts().filter(function (w) { return w && typeof w.date === "string"; });
    const res = $("hsResults"), cal = document.querySelector("#hsRoot .hs-calcard");
    if (!res) { render(); return; }
    res.innerHTML = resultsHtml(all);
    if (cal) cal.outerHTML = calendarHtml(all);
  }

  /* ---------------- one workout ---------------- */

  function findWorkout(id) { return api().getWorkouts().filter(function (w) { return w.id === id; })[0] || null; }

  function setText(s) {
    let t = num(s.weight) + " × " + s.reps;
    if (s.warmup) t += " (warm-up)"; else if (s.dropset) t += " (drop set)";
    if (s.rpe !== undefined && s.rpe !== null && s.rpe !== "") t += " @" + s.rpe;
    return t;
  }

  function detailHtml(w) {
    const c = ctx(), all = api().getWorkouts();
    if (w.schema !== 2 || !Array.isArray(w.exercises)) {
      return '<p class="wk-sheet-text">' + esc([prettyDate(w.date), w.category, w.duration ? w.duration + " min" : ""].filter(Boolean).join(" · ")) + '</p>' + (w.notes ? '<p class="wk-sheet-text">' + esc(w.notes) + '</p>' : "") +
        '<p class="field-hint">This is an entry from before sets were saved, so there is nothing more to show.</p>' +
        '<div class="wk-sheet-actions"><button type="button" class="btn btn-danger wk-big-btn" data-hs="delete" data-id="' + esc(w.id) + '">Delete workout</button></div>';
    }
    const it = PL.historyItem(w, c, PL.recordCountBySession(all));
    const prs = WL.sessionPRs(all, w);
    const stats = '<ul class="hs-stats"><li><strong>' + it.sets + '</strong><span>' + plural(it.sets, "working set") + '</span></li><li><strong>' + num(it.volume) + '</strong><span>lb volume</span></li><li><strong>' + (it.minutes ? it.minutes : "–") + '</strong><span>' + (it.minutes ? "min" : "no time saved") + '</span></li></ul>';
    const records = prs.length ? '<h3 class="wk-sheet-sub">Records</h3><ul class="hs-plain">' + prs.map(function (p) { return '<li>' + esc(exInfo(p.exerciseId).name) + ': ' + num(p.weight) + ' × ' + p.reps + ', est. 1RM ' + Math.round(p.e1rm) + ' (was ' + Math.round(p.previousE1rm) + ')</li>'; }).join("") + '</ul>' : "";
    const exercises = w.exercises.filter(function (se) { return (se.sets || []).length; }).map(function (se) {
      return '<div class="hs-ex"><h4 class="hs-ex-name">' + esc(exInfo(se.exerciseId).name) + '</h4><p class="hs-ex-sets">' + se.sets.map(function (s) { return esc(setText(s)); }).join(" &middot; ") + '</p></div>';
    }).join("");
    return '<p class="wk-sheet-text">' + esc([longDate(w.date), it.time, it.program].filter(Boolean).join(" · ")) + '</p>' + stats + records +
      '<h3 class="wk-sheet-sub">Sets</h3>' + exercises + (w.notes ? '<h3 class="wk-sheet-sub">Notes</h3><p class="wk-sheet-text">' + esc(w.notes) + '</p>' : "") +
      '<p class="field-hint">Volume is weight &times; reps over working sets. Warm-ups are not counted. A record beats everything saved before it.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-secondary wk-big-btn" data-hs="edit" data-id="' + esc(w.id) + '">Change date, time or notes</button>' +
      '<button type="button" class="btn btn-danger wk-big-btn" data-hs="delete" data-id="' + esc(w.id) + '">Delete workout</button></div>';
  }

  function openDetail(id) {
    const w = findWorkout(id);
    if (!w) return;
    const title = w.schema === 2 ? (ctx().label(w) || "Workout") : (w.name || "Workout");
    kit().openSheet(title, detailHtml(w));
  }

  function openEdit(id) {
    const w = findWorkout(id);
    if (!w || w.schema !== 2) return;
    kit().closeSheet(true);
    kit().openSheet("Change workout details",
      '<div class="form-row"><label for="hsWhen">Date and time</label><input type="datetime-local" id="hsWhen" value="' + esc(w.dateTime) + '"></div>' +
      '<div class="form-row"><label for="hsMinutes">Length in minutes (optional)</label><input type="number" id="hsMinutes" inputmode="numeric" min="1" max="1440" step="1" value="' + esc(w.duration || "") + '"></div>' +
      '<div class="form-row"><label for="hsNotes">Notes</label><textarea id="hsNotes" rows="3" maxlength="500">' + esc(w.notes || "") + '</textarea></div>' +
      '<p class="dc-error" id="hsErr" role="alert"></p><p class="field-hint">Your sets are not changed. Moving the date moves the workout in History and in your progress.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-hs="edit-save" data-id="' + esc(id) + '">Save</button></div>', { focus: "#hsWhen" });
  }

  function saveEdit(id) {
    const w = findWorkout(id);
    if (!w) return;
    const when = $("hsWhen").value, mins = $("hsMinutes").value.trim(), err = $("hsErr");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(when)) { err.textContent = "Pick a date and time."; $("hsWhen").focus(); return; }
    let duration = null;
    if (mins !== "") {
      const n = Math.round(Number(mins));
      if (!isFinite(n) || n < 1 || n > 1440) { err.textContent = "Length must be from 1 to 1440 minutes, or empty."; $("hsMinutes").focus(); return; }
      duration = n;
    }
    const next = Object.assign({}, w, { dateTime: when.slice(0, 16), date: when.slice(0, 10), duration: duration, notes: $("hsNotes").value.trim(), updatedAt: Date.now() });
    const list = api().getWorkouts().map(function (x) { return x.id === id ? next : x; });
    if (!api().replaceWorkouts(list)) { err.textContent = "Your phone wouldn't save it (storage may be full). Nothing was changed."; return; }
    kit().closeSheet(true);
    core().showToast("Saved.");
    kit().announce("Workout details saved.");
    render();
  }

  function askDelete(id) {
    const w = findWorkout(id);
    if (!w) return;
    const title = w.schema === 2 ? (ctx().label(w) || "Workout") : (w.name || "Workout");
    const sets = w.schema === 2 ? WL.sessionStats(w).workingSets : 0;
    kit().closeSheet(true);
    kit().openSheet("Delete this workout?",
      '<p class="wk-sheet-text">' + esc(title) + ', ' + esc(prettyDate(w.date)) + (sets ? ': ' + sets + ' ' + plural(sets, "set") : '') + '.</p>' +
      '<p class="wk-sheet-text">It is removed from History, and from your progress and records. You can undo this for a few seconds afterwards.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-danger wk-big-btn" data-hs="delete-confirm" data-id="' + esc(id) + '">Delete workout</button>' +
      '<button type="button" class="btn btn-secondary wk-big-btn" data-wk="sheet-close">Keep it</button></div>');
  }

  function doDelete(id) {
    const before = api().getWorkouts();
    const w = before.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    kit().closeSheet(true);
    if (!api().replaceWorkouts(before.filter(function (x) { return x.id !== id; }))) { core().showToast("Couldn't save that. Nothing was deleted."); return; }
    kit().pushUndo("Deleted workout.", null, function () { api().replaceWorkouts(before); render(); });
    if (state.day && !api().getWorkouts().some(function (x) { return x.date === state.day; })) state.day = null;
    render();
    kit().announce("Workout deleted. Undo is available for a few seconds.");
    const c = $("hsCount"); if (c) c.focus({ preventScroll: true });
  }

  /* ---------------- events ---------------- */

  function onClick(e) {
    const el = e.target.closest("[data-hs]");
    if (!el) return;
    const act = el.getAttribute("data-hs"), id = el.getAttribute("data-id");
    switch (act) {
      case "prev": case "next": {
        const s = PL.shiftMonth(state.year, state.month, act === "prev" ? -1 : 1); state.year = s.year; state.month = s.month; renderResultsOnly();
        const again = document.querySelector('#hsRoot [data-hs="' + act + '"]');   // the calendar was redrawn: keep focus on the same arrow (or the title when it ran out)
        if (again && !again.disabled) again.focus({ preventScroll: true }); else { const t = $("hsCalTitle"); if (t) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); } }
        break;
      }
      case "day": {
        const d = el.getAttribute("data-day"); state.day = state.day === d ? null : d; state.shown = PAGE; renderResultsOnly();
        const again = document.querySelector('#hsRoot [data-day="' + d + '"]'); if (again) again.focus({ preventScroll: true });
        break;
      }
      case "clear": state.query = ""; state.routine = ""; state.day = null; state.shown = PAGE; render(); break;
      case "more": state.shown += PAGE; renderResultsOnly(); break;
      case "open": openDetail(id); break;
      case "edit": openEdit(id); break;
      case "edit-save": saveEdit(id); break;
      case "delete": askDelete(id); break;
      case "delete-confirm": doDelete(id); break;
      default: break;
    }
  }

  function onInput(e) {
    if (e.target.id === "hsSearch") { state.query = e.target.value; state.shown = PAGE; renderResultsOnly(); }
  }
  function onChange(e) {
    if (e.target.id === "hsRoutine") { state.routine = e.target.value; state.shown = PAGE; renderResultsOnly(); }
  }

  function init() {
    if (started) return;
    if (!PL || !WL || !$("hsRoot") || !window.JarvisWorkout || !window.JarvisWorkout.api || !kit()) { const l = $("hsLegacy"), m = $("hsRoot"); if (l) l.hidden = false; if (m) m.hidden = true; return; }
    started = true;
    // Start on this month, or on the month of your latest workout when this month has none yet (an empty grid helps nobody).
    const t = todayKey();
    const dates = api().getWorkouts().map(function (w) { return w.date; }).filter(function (d) { return typeof d === "string" && d <= t; }).sort();
    const shown = dates.some(function (d) { return d.slice(0, 7) === t.slice(0, 7); }) || !dates.length ? t : dates[dates.length - 1];
    state.year = Number(shown.slice(0, 4)); state.month = Number(shown.slice(5, 7)) - 1;
    const panel = $("panel-workout");
    panel.addEventListener("click", onClick);
    panel.addEventListener("input", onInput);
    panel.addEventListener("change", onChange);
    document.addEventListener("jarvis-workout-changed", function () { if (!(document.activeElement && document.activeElement.id === "hsSearch")) render(); });
    const tab = $("workoutSubNavWkHistory");
    if (tab) tab.addEventListener("click", function () { window.setTimeout(render, 0); });
    render();
  }

  window.JarvisHistoryUI = { init: init, render: render };
})();
