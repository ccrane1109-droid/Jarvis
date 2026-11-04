/* ==========================================================================
   JARVIS — Workout: the Home screen and the live logger (the Workout tab).
   The rules (what was done last time, records, rest timing, what to save) live in
   workout-logic.js. The data is the same in-memory data as workout.js, through
   window.JarvisWorkout.api, so the older Log screen (still reachable from the
   Workout tab) always shows the same workout.

   localStorage key owned here:
     jarvisWorkoutPrefs — { restSeconds, restAuto, restSound }

   How logging works:
     - Starting a routine fills each set's reps from the plan and its weight from last
       time. Those numbers are SUGGESTIONS (shown dimmer) and count for nothing until
       you tap Done on that set. Only sets you marked done are ever saved.
     - Done saves the draft at once (it survives a refresh, a crash or the phone
       locking), starts the rest timer and moves on to the next set.
     - Anything destructive (a set, an exercise, the whole workout) can be undone from
       a bar at the bottom for a few seconds.
   The rest timer stores when it ends, not how long is left, so it is right after the
   screen has been off. iPhone web apps can't buzz the phone, so the end of a rest is a
   sound (if the ringer allows it) and a change on screen.
   ========================================================================== */

(function () {
  "use strict";

  const WL = window.JarvisWorkoutLogic;
  const RL = window.JarvisRoutineLogic || null;
  const LS_PREFS = "jarvisWorkoutPrefs";
  const UNDO_MS = 9000;
  const RPE_CHOICES = ["", 6, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  const REST_CHOICES = [{ label: "Off", sec: 0 }, { label: "60s", sec: 60 }, { label: "90s", sec: 90 }, { label: "2 min", sec: 120 }, { label: "3 min", sec: 180 }];

  let prefs = null;
  let expanded = {};        // exercise cards the user opened
  let collapsed = {};       // exercise cards the user closed
  let undo = null;          // { label, snapshot, timer }
  let summary = null;       // the finish summary on screen
  let failed = null;        // a session whose save failed, kept so Retry saves the very same one
  let restored = false;     // show "restored" once after the app opens on an unfinished workout
  let audio = null;
  let restFinishedAt = 0;
  let sheet = null;
  let started = false;

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v === undefined || v === null ? "" : String(v)); }
  function api() { return window.JarvisWorkout.api; }
  function draft() { return api().getDraft(); }
  function reduceMotion() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function num(n) { return String(Number(n)); }

  function exInfo(id) { return window.JarvisExercises.getExerciseById(id) || { id: id, name: "Unknown exercise", muscleGroup: "", equipment: "" }; }
  function prettyDate(date) {
    const p = String(date).split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function minutesText(min) { return min >= 60 ? (Math.floor(min / 60) + " h" + (min % 60 ? " " + String(min % 60).padStart(2, "0") + " min" : "")) : min + " min"; }
  function elapsedText(d) { return d.startedAt ? WL.formatClock(Date.now() - d.startedAt) : "0:00"; }

  /* ---------------- preferences ---------------- */

  function loadPrefs() { prefs = WL.sanitizePrefs(core().loadJSON(LS_PREFS, null)); }
  function savePrefs() { core().saveJSON(LS_PREFS, prefs); }
  function restSecondsNow() { return prefs.restAuto ? prefs.restSeconds : 0; }

  /* ---------------- what is going on ---------------- */

  // A workout is in progress once it has been started, or any set has been marked done.
  function isActive() {
    const d = draft();
    return typeof d.startedAt === "number" || d.exercises.some(function (se) { return se.sets.some(function (s) { return s.completed; }); });
  }
  function ensureReady() {
    const d = draft();
    const stale = d.exercises.some(function (se) { return !se.sessionExId || se.sets.some(function (s) { return !s.id; }); });
    if (stale) { WL.migrateDraft(d); api().saveDraft(); }
  }
  function save() { api().saveDraft(); }
  function announce(text) { const el = $("wkLive"); if (el) { el.textContent = ""; window.setTimeout(function () { el.textContent = text; }, 30); } }

  function routineName(id) { const r = id ? api().routineById(id) : null; return r ? r.name : ""; }
  // Routines you can start, schedule or pick (archived ones are left out).
  function activeRoutines() { return api().activeRoutines ? api().activeRoutines() : api().getRoutines(); }
  function workoutTitle(d) { return routineName(d.routineId) || "Workout"; }

  /* ---------------- undo ---------------- */

  // Remember how the workout was just before a change, so the bar at the bottom can put it back.
  // restore (optional) is a function that puts back something other than the workout, e.g. a routine you archived.
  function pushUndo(label, snapshot, restore) {
    if (undo && undo.timer) window.clearTimeout(undo.timer);
    undo = { label: label, snapshot: restore ? null : (snapshot || WL.cloneDraft(draft())), restore: restore || null, timer: window.setTimeout(clearUndo, UNDO_MS) };
    renderUndo();
  }
  function clearUndo() { if (undo && undo.timer) window.clearTimeout(undo.timer); undo = null; renderUndo(); }
  function renderUndo() {
    const bar = $("wkUndoBar");
    if (!bar) return;
    bar.classList.toggle("hidden", !undo);
    if (undo) bar.querySelector(".wk-undo-text").textContent = undo.label;
  }
  function doUndo() {
    if (!undo) return;
    const snap = undo.snapshot, restore = undo.restore;
    clearUndo();
    if (restore) { restore(); announce("Undone."); return; }
    api().replaceDraft(snap);
    summary = null;
    renderAll();
    announce("Undone.");
  }

  /* ---------------- sheets (dialogs that slide up) ---------------- */

  function focusables(root) { return Array.prototype.slice.call(root.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')).filter(function (e) { return !e.disabled && e.getClientRects().length > 0; }); }

  function openSheet(title, bodyHtml, opts) {
    const keptOpener = sheet ? sheet.opener : null;   // a sheet opened from another sheet returns focus to the original button
    closeSheet(true);
    const root = $("wkSheetRoot");
    const opener = keptOpener || document.activeElement;
    root.innerHTML = '<div class="wk-backdrop" data-wk="sheet-close"></div>' +
      '<div class="wk-sheet" role="dialog" aria-modal="true" aria-labelledby="wkSheetTitle">' +
        '<div class="wk-sheet-grip" aria-hidden="true"></div>' +
        '<div class="wk-sheet-head"><h2 id="wkSheetTitle" class="wk-sheet-title">' + esc(title) + '</h2><button type="button" class="wk-icon-btn" data-wk="sheet-close" aria-label="Close">&times;</button></div>' +
        '<div class="wk-sheet-body">' + bodyHtml + '</div></div>';
    root.classList.remove("hidden");
    sheet = { opener: opener, onClose: opts && opts.onClose };
    const first = (opts && opts.focus && root.querySelector(opts.focus)) || focusables(root.querySelector(".wk-sheet-body"))[0] || root.querySelector('[data-wk="sheet-close"]');
    if (first) first.focus({ preventScroll: true });
  }
  function closeSheet(silent) {
    const root = $("wkSheetRoot");
    if (!root || !sheet) return;
    const s = sheet;
    sheet = null;
    root.classList.add("hidden");
    root.innerHTML = "";
    if (!silent) { if (s.onClose) s.onClose(); if (s.opener && document.body.contains(s.opener) && s.opener.focus) s.opener.focus({ preventScroll: true }); }
  }
  function onSheetKey(e) {
    if (!sheet) return;
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const items = focusables($("wkSheetRoot").querySelector(".wk-sheet"));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------------- starting a workout ---------------- */

  function nowLocal() { return core().nowLocalDateTimeInputValue(); }
  function goTo(id) { const b = document.querySelector('.workout-sub-nav-btn[data-subtarget="' + id + '"]'); if (b) b.click(); }

  function begin(build, keepUndo) {
    const d = WL.emptyDraft(nowLocal());
    build(d);
    d.startedAt = Date.now();
    d.activeIndex = 0;
    summary = null; failed = null; expanded = {}; collapsed = {}; restored = false;
    api().replaceDraft(d);
    if (!keepUndo) clearUndo();
    goTo("wk-session");
    renderAll();
    announce("Workout started.");
  }

  function startWith(build) {
    if (!isActive()) { begin(build); return; }
    openSheet("Workout already in progress",
      '<p class="wk-sheet-text">You have a workout going: ' + esc(workoutTitle(draft())) + ', ' + WL.pendingSets(draft()).done + ' ' + plural(WL.pendingSets(draft()).done, "set") + ' done.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-wk="resume-close">Resume it</button>' +
      '<button type="button" class="btn btn-secondary wk-big-btn" data-wk="replace-confirm">Replace it</button></div>' +
      '<p class="field-hint">Replacing it can be undone for a few seconds.</p>');
    pendingBuild = build;
  }
  let pendingBuild = null;

  function startRoutine(id) {
    const routine = api().routineById(id);
    if (!routine) { core().showToast("That routine isn't here any more. Pick another."); return; }
    if (routine.archivedAt) { core().showToast("That routine is archived. Restore it from Routines to use it."); return; }
    startWith(function (d) { d.exercises = WL.exercisesFromRoutine(routine, api().getWorkouts()); d.routineId = routine.id; });
  }
  function startProgram(id) {
    const p = api().getPrograms().filter(function (x) { return x.id === id; })[0];
    if (!p || !p.days.length) return;
    const day = p.days[p.currentIndex % p.days.length];
    const routine = api().routineById(day.routineId);
    if (!routine || routine.archivedAt) { goTo("workout-programs"); core().showToast("That day needs a routine. Pick one for it here."); return; }
    startWith(function (d) { d.exercises = WL.exercisesFromRoutine(routine, api().getWorkouts()); d.routineId = routine.id; d.programId = p.id; d.programDayId = day.id; });
  }
  function startEmpty() { startWith(function () {}); window.setTimeout(function () { if (isActive() && !draft().exercises.length) openPicker(); }, 50); }
  function repeatLast() {
    const exs = WL.exercisesFromLastWorkout(api().getWorkouts());
    if (!exs) { core().showToast("Nothing to repeat yet. Log a workout first."); return; }
    const plan = WL.lastWorkoutPlan(api().getWorkouts());
    startWith(function (d) { d.exercises = exs; d.routineId = plan.routineId && api().routineById(plan.routineId) ? plan.routineId : ""; });
  }

  /* ---------------- Home ---------------- */

  function lastUsedText(routineId, workouts) {
    const last = WL.recentRoutines(workouts, api().getRoutines()).filter(function (r) { return r.routine.id === routineId; })[0];
    return last && last.lastUsed ? "last " + prettyDate(last.lastUsed.slice(0, 10)) : "not used yet";
  }
  function typicalMinutes(routineId, workouts) {
    const d = WL.sessionsOf(workouts).filter(function (w) { return w.routineId === routineId && w.duration > 0; });
    if (d.length < 2) return null;
    return Math.round(d.reduce(function (t, w) { return t + w.duration; }, 0) / d.length);
  }

  function renderHome() {
    const root = $("wkHomeRoot");
    if (!root) return;
    const a = api(), workouts = a.getWorkouts(), routines = activeRoutines(), now = Date.now();
    const d = draft();
    const trainedToday = WL.sessionsOf(workouts).some(function (w) { return w.date === WL.dayKey(now); });
    const today = a.routineScheduledToday();
    let hero;
    if (isActive()) {
      const p = WL.pendingSets(d);
      hero = '<section class="wk-hero card" aria-labelledby="wkHeroTitle"><p class="wk-kicker">Workout in progress</p><h2 class="wk-hero-title" id="wkHeroTitle">' + esc(workoutTitle(d)) + '</h2>' +
        '<p class="wk-hero-meta"><span class="wk-elapsed">' + esc(elapsedText(d)) + '</span> &middot; ' + p.done + ' of ' + p.total + ' sets done</p>' +
        '<button type="button" class="btn btn-primary wk-big-btn" data-wk="resume">Resume workout</button></section>';
    } else if (today) {
      const typical = typicalMinutes(today.id, workouts);
      hero = '<section class="wk-hero card" aria-labelledby="wkHeroTitle"><p class="wk-kicker">' + (trainedToday ? "Today &middot; you already trained" : "Today") + '</p><h2 class="wk-hero-title" id="wkHeroTitle">' + esc(today.name) + '</h2>' +
        '<p class="wk-hero-meta">' + today.exercises.length + ' ' + plural(today.exercises.length, "exercise") + ' &middot; ' + esc(lastUsedText(today.id, workouts)) + (typical ? ' &middot; usually about ' + typical + ' min' : '') + '</p>' +
        '<button type="button" class="btn btn-primary wk-big-btn" data-wk="start-routine" data-id="' + esc(today.id) + '">Start ' + esc(today.name) + '</button></section>';
    } else {
      const last = WL.sessionsOf(workouts).slice().sort(function (x, y) { return x.dateTime < y.dateTime ? 1 : -1; })[0];
      hero = '<section class="wk-hero card" aria-labelledby="wkHeroTitle"><p class="wk-kicker">Ready when you are</p><h2 class="wk-hero-title" id="wkHeroTitle">Start a workout</h2>' +
        '<p class="wk-hero-meta">' + (last ? 'Last workout: ' + esc(routineName(last.routineId) || last.routineName || "Workout") + ', ' + esc(prettyDate(last.date)) : 'Pick a routine below, or start from nothing.') + '</p>' +
        '<button type="button" class="btn btn-primary wk-big-btn" data-wk="start-empty">Start empty workout</button></section>';
    }

    const plan = WL.lastWorkoutPlan(workouts);
    const quick = '<div class="wk-quick"><button type="button" class="btn btn-secondary wk-wide-btn" data-wk="start-empty">Empty workout</button>' +
      '<button type="button" class="btn btn-secondary wk-wide-btn" data-wk="repeat-last"' + (plan ? "" : " disabled") + '>Repeat last' + (plan ? ' <span class="wk-btn-sub">' + esc(routineName(plan.routineId) || prettyDate(plan.date)) + '</span>' : '') + '</button></div>';

    // The routine already shown as today's big button isn't repeated in the list under it.
    const heroRoutineId = !isActive() && today ? today.id : null;
    const recents = WL.recentRoutines(workouts, routines).filter(function (r) { return r.routine.id !== heroRoutineId; }).slice(0, 4);
    const routinesHtml = recents.length
      ? '<section class="wk-block" aria-labelledby="wkRoutinesH"><div class="wk-block-head"><h2 id="wkRoutinesH" class="wk-block-title">Your routines</h2><button type="button" class="btn-icon" data-wk-go="workout-routines">See all</button></div><div class="wk-list">' +
        recents.map(function (r) {
          return '<button type="button" class="wk-row" data-wk="start-routine" data-id="' + esc(r.routine.id) + '"><span class="wk-row-main"><span class="wk-row-title">' + esc(r.routine.name) + '</span><span class="wk-row-sub">' + r.routine.exercises.length + ' ' + plural(r.routine.exercises.length, "exercise") + ' &middot; ' + esc(r.lastUsed ? "last " + prettyDate(r.lastUsed.slice(0, 10)) : "not used yet") + '</span></span><span class="wk-row-go" aria-hidden="true">Start</span></button>';
        }).join("") + '</div></section>'
      : '<section class="wk-block"><h2 class="wk-block-title">Your routines</h2><p class="wk-empty">No routines yet. <button type="button" class="wk-link" data-wk-go="workout-routines">Build one in about a minute</button>, or start an empty workout.</p></section>';

    const scheduledDays = {};
    routines.forEach(function (r) { (r.scheduledDays || []).forEach(function (x) { scheduledDays[x] = true; }); });
    const target = Object.keys(scheduledDays).length;
    const wk = WL.weekSummary(workouts, now, target);
    const names = ["M", "T", "W", "T", "F", "S", "S"];
    const longNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const weekHtml = '<section class="wk-block" aria-labelledby="wkWeekH"><h2 id="wkWeekH" class="wk-block-title">This week</h2><div class="card wk-week">' +
      '<p class="wk-week-count"><strong>' + wk.count + '</strong>' + (wk.target ? ' of ' + wk.target + ' ' + plural(wk.target, "workout") + ' planned' : ' ' + plural(wk.count, "workout")) + '</p>' +
      '<ol class="wk-dots" aria-label="Days this week">' + wk.days.map(function (day, i) {
        return '<li class="wk-dot' + (day.trained ? " is-on" : "") + (day.today ? " is-today" : "") + '" aria-label="' + longNames[i] + (day.trained ? ", trained" : day.future ? ", still to come" : day.today ? ", today, not yet" : ", rest") + '"><span aria-hidden="true">' + names[i] + '</span></li>';
      }).join("") + '</ol>' +
      '<p class="wk-week-meta">' + (wk.minutes ? minutesText(wk.minutes) + ' &middot; ' : '') + (wk.volume ? wk.volume.toLocaleString() + ' lb volume &middot; ' : '') + 'last week: ' + wk.lastWeekCount + '</p></div></section>';

    const prs = WL.recentPRs(workouts, { limit: 3, sinceDate: WL.addDays(WL.dayKey(now), -60) });
    const prHtml = prs.length
      ? '<section class="wk-block" aria-labelledby="wkPrH"><h2 id="wkPrH" class="wk-block-title">Recent records</h2><div class="card"><ul class="wk-prs">' + prs.map(function (p) {
          return '<li><span class="wk-pr-name">' + esc(exInfo(p.exerciseId).name) + '</span><span class="wk-pr-set">' + num(p.weight) + ' &times; ' + p.reps + '</span><span class="wk-pr-meta">' + esc(prettyDate(p.date)) + ' &middot; est. 1RM ' + Math.round(p.e1rm) + ' (was ' + Math.round(p.previousE1rm) + ')</span></li>';
        }).join("") + '</ul><p class="field-hint">Estimated 1RM is worked out from weight and reps. It is not a tested max.</p></div></section>'
      : "";

    const programs = a.getPrograms().filter(function (p) { return p.days.length > 0; });
    const progHtml = programs.length
      ? '<section class="wk-block" aria-labelledby="wkProgH"><h2 id="wkProgH" class="wk-block-title">Programs</h2><div class="wk-list">' + programs.map(function (p) {
          const day = p.days[p.currentIndex % p.days.length];
          const r = a.routineById(day.routineId);
          const usable = r && !r.archivedAt;
          return usable
            ? '<button type="button" class="wk-row" data-wk="start-program" data-id="' + esc(p.id) + '"><span class="wk-row-main"><span class="wk-row-title">' + esc(p.name) + '</span><span class="wk-row-sub">' + esc(day.label) + ' &middot; ' + esc(r.name) + '</span></span><span class="wk-row-go" aria-hidden="true">Start</span></button>'
            : '<div class="wk-row wk-row-warn"><span class="wk-row-main"><span class="wk-row-title">' + esc(p.name) + '</span><span class="wk-row-sub">' + esc(day.label) + ' needs a routine. ' + (r ? 'The one it used, ' + esc(r.name) + ', is archived.' : 'The one it used is gone.') + '</span></span><button type="button" class="btn btn-secondary" data-wk-go="workout-programs">Fix it</button></div>';
        }).join("") + '</div></section>'
      : "";

    const tools = '<div class="wk-tools"><button type="button" class="wk-link" data-wk-go="workout-programs">Programs</button><button type="button" class="wk-link" data-wk-go="workout-form-check">Form check (beta)</button></div>';
    root.innerHTML = hero + quick + routinesHtml + weekHtml + prHtml + progHtml + tools;
  }

  /* ---------------- the live logger ---------------- */

  function isOpen(se, idx) {
    if (expanded[se.sessionExId]) return true;
    if (collapsed[se.sessionExId]) return false;
    return idx === draft().activeIndex;
  }
  function findEx(id) { const d = draft(); for (let i = 0; i < d.exercises.length; i++) if (d.exercises[i].sessionExId === id) return { se: d.exercises[i], idx: i }; return null; }
  function findSet(se, id) { for (let i = 0; i < se.sets.length; i++) if (se.sets[i].id === id) return { s: se.sets[i], idx: i }; return null; }
  function workingNumber(sets, i) { let n = 0; for (let j = 0; j <= i; j++) if (!sets[j].warmup) n++; return n; }

  function setRowHtml(se, s, i, ctx) {
    const sugg = ctx.sugg[i];
    const pending = !s.completed && !s.touched && (s.weight !== "" || s.reps !== "");
    const tag = s.warmup ? "W" : s.dropset ? "D" : String(workingNumber(se.sets, i));
    const tagWord = s.warmup ? "Warm-up" : s.dropset ? "Drop set" : "Set " + tag;
    const notes = [];
    if (isFinite(Number(s.rpe)) && s.rpe !== "") notes.push("RPE " + num(s.rpe));
    if (ctx.prSet === s.id) notes.push("Record");
    return '<div class="wk-set' + (s.completed ? " is-done" : "") + (pending ? " is-suggested" : "") + '" data-set-row="' + esc(s.id) + '">' +
      '<button type="button" class="wk-set-tag' + (s.warmup ? " is-warm" : s.dropset ? " is-drop" : "") + '" data-wk="set-menu" data-ex="' + esc(se.sessionExId) + '" data-set="' + esc(s.id) + '" aria-label="' + esc(tagWord + " options") + '">' + esc(tag) + '</button>' +
      '<span class="wk-last-cell">' + (sugg ? num(sugg.weight) + '&times;' + sugg.reps : '&ndash;') + '</span>' +
      '<input class="wk-in" type="number" inputmode="decimal" step="0.5" min="0" enterkeyhint="next" data-wk-field="weight" data-ex="' + esc(se.sessionExId) + '" data-set="' + esc(s.id) + '" value="' + esc(s.weight) + '" placeholder="0" aria-label="Weight in pounds, ' + esc(tagWord.toLowerCase()) + '">' +
      '<input class="wk-in" type="number" inputmode="numeric" step="1" min="1" enterkeyhint="done" data-wk-field="reps" data-ex="' + esc(se.sessionExId) + '" data-set="' + esc(s.id) + '" value="' + esc(s.reps) + '" placeholder="0" aria-label="Reps, ' + esc(tagWord.toLowerCase()) + '">' +
      '<button type="button" class="wk-done" data-wk="done" data-ex="' + esc(se.sessionExId) + '" data-set="' + esc(s.id) + '" aria-pressed="' + (s.completed ? "true" : "false") + '" aria-label="' + esc(tagWord) + ' done"><span class="wk-check" aria-hidden="true"></span></button>' +
      (notes.length ? '<div class="wk-set-note">' + esc(notes.join(" · ")) + '</div>' : '') +
      '</div>';
  }

  function exerciseHtml(se, idx, ctx) {
    const info = exInfo(se.exerciseId);
    const open = isOpen(se, idx);
    const done = se.sets.filter(function (s) { return s.completed && WL.validSet(s); }).length;
    const allDone = se.sets.length > 0 && done === se.sets.length;
    const prev = ctx.prev[se.exerciseId];
    const last = prev ? WL.lastTimeText(prev) : "";
    const best = ctx.best[se.exerciseId];
    const bodyId = "wkBody" + idx;
    const sugg = WL.suggestForPlan(se.sets.map(function (s) { return s.warmup ? "warmup" : s.dropset ? "dropset" : "normal"; }), prev ? prev.sets : []);
    let prSet = null, prVal = 0;
    if (best && best.e1rm) se.sets.forEach(function (s) { if (s.completed && !s.warmup && WL.validSet(s)) { const v = WL.e1rm(s.weight, s.reps); if (v > best.e1rm.value + 0.05 && v > prVal) { prVal = v; prSet = s.id; } } });
    const rows = se.sets.map(function (s, i) { return setRowHtml(se, s, i, { sugg: sugg, prSet: prSet }); }).join("");
    return '<section class="wk-ex' + (open ? " is-open" : "") + (allDone ? " is-complete" : "") + '" data-ex-card="' + esc(se.sessionExId) + '">' +
      '<div class="wk-ex-head">' +
        '<button type="button" class="wk-ex-toggle" aria-expanded="' + open + '" aria-controls="' + bodyId + '" data-wk="toggle-ex" data-ex="' + esc(se.sessionExId) + '">' +
          '<span class="wk-chev" aria-hidden="true"></span>' +
          '<span class="wk-ex-text"><span class="wk-ex-name">' + esc(info.name) + '</span><span class="wk-ex-sub">' + esc([info.muscleGroup, info.equipment].filter(Boolean).join(" · ")) + (se.supersetGroup ? ' · Superset' : '') + '</span></span>' +
          '<span class="wk-ex-count" aria-label="' + done + ' of ' + se.sets.length + ' sets done">' + done + '/' + se.sets.length + '</span>' +
        '</button>' +
        '<button type="button" class="wk-icon-btn" data-wk="ex-menu" data-ex="' + esc(se.sessionExId) + '" aria-label="Options for ' + esc(info.name) + '"><span aria-hidden="true">&#8943;</span></button>' +
      '</div>' +
      (open
        ? '<div class="wk-ex-body" id="' + bodyId + '">' +
            '<p class="wk-last">' + (last ? 'Last time: ' + esc(last) : 'First time logging this exercise.') + (best && best.e1rm ? ' &middot; best est. 1RM ' + Math.round(best.e1rm.value) : '') + '</p>' +
            (window.JarvisInsights ? window.JarvisInsights.loggerNote(draft(), se) : '') +
            '<div class="wk-sets" role="group" aria-label="Sets for ' + esc(info.name) + '"><div class="wk-set wk-set-head" aria-hidden="true"><span>Set</span><span>Last</span><span>Weight</span><span>Reps</span><span></span></div>' + rows + '</div>' +
            '<button type="button" class="wk-add-set" data-wk="add-set" data-ex="' + esc(se.sessionExId) + '">+ Add set</button>' +
          '</div>'
        : '') +
    '</section>';
  }

  function loggerHtml() {
    const d = draft();
    const p = WL.pendingSets(d);
    const ctx = { prev: {}, best: {} };
    const workouts = api().getWorkouts();
    d.exercises.forEach(function (se) { if (!(se.exerciseId in ctx.prev)) { ctx.prev[se.exerciseId] = WL.previousPerformance(workouts, se.exerciseId); ctx.best[se.exerciseId] = WL.bestSets(workouts, se.exerciseId); } });
    const finishReady = p.total > 0 && p.open === 0;
    return (restored ? '<div class="wk-notice" role="status"><span>Restored your workout. Nothing was lost.</span><button type="button" class="btn-icon" data-wk="dismiss-restored">OK</button></div>' : '') +
      (failed ? '<div class="wk-notice wk-notice-bad" role="alert"><span>Your workout couldn\'t be saved. Nothing is lost. Check your phone\'s storage and try again.</span><button type="button" class="btn btn-secondary" data-wk="finish-retry">Try again</button></div>' : '') +
      '<div class="wk-bar"><div class="wk-bar-main"><span class="wk-bar-title">' + esc(workoutTitle(d)) + '</span><span class="wk-bar-sub"><span class="wk-elapsed">' + esc(elapsedText(d)) + '</span> &middot; ' + p.done + '/' + p.total + ' sets</span></div>' +
        '<button type="button" class="btn ' + (finishReady ? "btn-primary" : "btn-secondary") + ' wk-finish" data-wk="finish">Finish</button>' +
        '<button type="button" class="wk-icon-btn" data-wk="bar-menu" aria-label="Workout options"><span aria-hidden="true">&#8943;</span></button></div>' +
      (d.exercises.length
        ? '<div class="wk-exlist">' + d.exercises.map(function (se, i) { return exerciseHtml(se, i, ctx); }).join("") + '</div>'
        : '<div class="wk-empty-logger"><p>No exercises yet.</p></div>') +
      '<button type="button" class="wk-add-ex" data-wk="add-ex">+ Add exercise</button>' +
      '<div class="wk-tools"><button type="button" class="wk-link" data-wk="classic">Use the classic logger instead</button></div>';
  }

  function idleHtml() {
    const workouts = api().getWorkouts();
    const plan = WL.lastWorkoutPlan(workouts);
    const recents = WL.recentRoutines(workouts, api().getRoutines()).slice(0, 5);
    return '<section class="wk-hero card"><p class="wk-kicker">No workout in progress</p><h2 class="wk-hero-title">Start one</h2>' +
      '<button type="button" class="btn btn-primary wk-big-btn" data-wk="start-empty">Start empty workout</button>' +
      '<button type="button" class="btn btn-secondary wk-big-btn" data-wk="repeat-last"' + (plan ? "" : " disabled") + '>Repeat last workout</button></section>' +
      (recents.length ? '<section class="wk-block"><h2 class="wk-block-title">Or pick a routine</h2><div class="wk-list">' + recents.map(function (r) {
        return '<button type="button" class="wk-row" data-wk="start-routine" data-id="' + esc(r.routine.id) + '"><span class="wk-row-main"><span class="wk-row-title">' + esc(r.routine.name) + '</span><span class="wk-row-sub">' + r.routine.exercises.length + ' ' + plural(r.routine.exercises.length, "exercise") + '</span></span><span class="wk-row-go" aria-hidden="true">Start</span></button>';
      }).join("") + '</div></section>' : '') +
      '<div class="wk-tools"><button type="button" class="wk-link" data-wk="classic">Open the classic logger</button></div>';
  }

  function summaryHtml() {
    const s = summary, st = s.stats;
    const stat = function (v, l) { return '<div class="wk-stat"><span class="wk-stat-v">' + v + '</span><span class="wk-stat-l">' + l + '</span></div>'; };
    const cmp = s.cmp;
    const lines = [];
    if (cmp) {
      if (cmp.volumePct !== null) lines.push('Volume ' + (cmp.volumePct === 0 ? 'matched' : Math.abs(cmp.volumePct) + '% ' + (cmp.volumePct > 0 ? 'higher than' : 'lower than')) + ' your last ' + esc(routineName(s.session.routineId) || 'time') + ' (' + esc(prettyDate(cmp.date)) + ').');
      if (cmp.durationDelta !== null && cmp.durationDelta !== 0) lines.push(Math.abs(cmp.durationDelta) + ' min ' + (cmp.durationDelta < 0 ? 'shorter' : 'longer') + ' than that session.');
      if (cmp.setsDelta !== 0) lines.push(Math.abs(cmp.setsDelta) + ' ' + (cmp.setsDelta > 0 ? 'more' : 'fewer') + ' working ' + plural(Math.abs(cmp.setsDelta), 'set') + '.');
    }
    return '<section class="wk-summary" aria-labelledby="wkSumH"><p class="wk-kicker">' + esc(prettyDate(s.session.date)) + '</p><h2 class="wk-hero-title" id="wkSumH">Workout complete</h2><p class="wk-hero-meta">' + esc(routineName(s.session.routineId) || 'Workout') + '</p>' +
      '<div class="wk-sumstats">' + stat(st.exercises, plural(st.exercises, 'exercise')) + stat(st.workingSets, 'working ' + plural(st.workingSets, 'set')) + stat(st.durationMin !== null ? minutesText(st.durationMin) : '&ndash;', 'time') + stat(st.volume.toLocaleString(), 'lb volume') + '</div>' +
      '<p class="field-hint">Volume is weight &times; reps over working sets. Warm-ups are not counted.</p>' +
      '<div class="card wk-sum-card"><h3 class="wk-block-title">Records</h3>' + (s.prs.length
        ? '<ul class="wk-prs">' + s.prs.map(function (p) { return '<li><span class="wk-pr-name">' + esc(exInfo(p.exerciseId).name) + '</span><span class="wk-pr-set">' + num(p.weight) + ' &times; ' + p.reps + '</span><span class="wk-pr-meta">est. 1RM ' + Math.round(p.e1rm) + ' (was ' + Math.round(p.previousE1rm) + ')</span></li>'; }).join("") + '</ul><p class="field-hint">Estimated 1RM is worked out from weight and reps. It is not a tested max.</p>'
        : '<p class="wk-empty">No new records this time. That\'s normal. Records come from beating what you logged before.</p>') + '</div>' +
      (lines.length ? '<div class="card wk-sum-card"><h3 class="wk-block-title">Compared with last time</h3><ul class="wk-lines">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="form-row"><label for="wkSumNotes">Notes (optional)</label><textarea id="wkSumNotes" rows="3" maxlength="500" placeholder="How did it feel?">' + esc(s.session.notes) + '</textarea></div>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-wk="summary-done">Done</button><button type="button" class="btn btn-secondary wk-big-btn" data-wk="summary-history">See in History</button></div></section>';
  }

  function renderSession() {
    const root = $("wkSessionRoot");
    if (!root) return;
    ensureReady();
    const keepScroll = window.scrollY;
    const typed = document.activeElement && document.activeElement.closest && document.activeElement.closest("#wkSessionRoot") ? document.activeElement : null;
    if (typed && typed.matches && typed.matches("input, textarea")) return; // never redraw under a field being typed in
    root.innerHTML = summary ? summaryHtml() : isActive() ? loggerHtml() : idleHtml();
    if (!summary && isActive()) window.scrollTo(0, keepScroll);
    renderRest();
  }

  // While a workout is on screen the page title and subtitle step aside, so the sets get the room.
  function syncFocusMode() {
    const panel = $("panel-workout"), tab = $("wk-session");
    if (panel && tab) panel.classList.toggle("wk-focus", tab.classList.contains("active") && isActive() && !summary);
    const header = document.querySelector(".app-header");
    if (panel && header) panel.style.setProperty("--wk-header-h", header.offsetHeight + "px");
  }

  function renderAll() { renderHome(); renderSession(); renderRest(); syncFocusMode(); }

  /* ---------------- sets ---------------- */

  function focusSoon(selector, scroll) {
    window.setTimeout(function () {
      const el = document.querySelector(selector);
      if (!el) return;
      el.focus({ preventScroll: true });
      if (scroll !== false && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    }, 30);
  }

  function unlockAudio() {
    try {
      if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); }
      if (audio && audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }
  function beep() {
    if (!prefs.restSound || !audio) return;
    try {
      [0, 0.22].forEach(function (delay) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, audio.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + delay + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + delay + 0.18);
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + delay); o.stop(audio.currentTime + delay + 0.2);
      });
    } catch (e) { /* no sound is fine: the screen still shows it */ }
  }

  function toggleDone(exId, setId) {
    const f = findEx(exId);
    if (!f) return;
    const hit = findSet(f.se, setId);
    if (!hit) return;
    const s = hit.s;
    unlockAudio();
    if (s.completed) {
      s.completed = false; s.doneAt = null; save();
      renderSession();
      focusSoon('[data-wk="done"][data-set="' + setId + '"]', false);
      announce("Set marked not done.");
      return;
    }
    if (!WL.validSet(s)) {
      const missing = s.weight === "" || !isFinite(Number(s.weight)) || Number(s.weight) < 0 ? "weight" : "reps";
      const input = document.querySelector('[data-wk-field="' + missing + '"][data-set="' + setId + '"]');
      if (input) { input.setAttribute("aria-invalid", "true"); input.classList.add("is-shake"); input.focus(); window.setTimeout(function () { input.classList.remove("is-shake"); }, 400); }
      announce("Enter " + (missing === "weight" ? "a weight" : "the reps") + " first.");
      return;
    }
    s.completed = true; s.doneAt = Date.now(); s.touched = true;
    const d = draft();
    const after = WL.afterComplete(d, f.idx, hit.idx);
    if (after.rest && restSecondsNow() > 0) d.restEndsAt = WL.startRest(Date.now(), restSecondsNow());
    else if (!after.rest) d.restEndsAt = null;
    if (after.focus) {
      d.activeIndex = after.focus.exIdx;
      delete collapsed[d.exercises[after.focus.exIdx].sessionExId];
      if (after.focus.exIdx !== f.idx) {
        // In a superset you swap between the two exercises, so the one you just left stays open.
        const sameGroup = f.se.supersetGroup && d.exercises[after.focus.exIdx].supersetGroup === f.se.supersetGroup;
        if (sameGroup) { expanded[f.se.sessionExId] = true; delete collapsed[f.se.sessionExId]; }
        else delete expanded[f.se.sessionExId];
      }
      const nx = d.exercises[after.focus.exIdx].sets[after.focus.setIdx];
      if (nx && !nx.touched && nx.weight === "" && s.weight !== "") { nx.weight = s.weight; if (nx.reps === "") nx.reps = s.reps; }
    }
    save();
    renderSession();
    renderRest();
    if (after.focus) { const nx = d.exercises[after.focus.exIdx].sets[after.focus.setIdx]; focusSoon('[data-wk="done"][data-set="' + nx.id + '"]'); announce("Set saved. Next: " + exInfo(d.exercises[after.focus.exIdx].exerciseId).name + "."); }
    else { focusSoon('[data-wk="finish"]'); announce("All sets done. You can finish the workout."); }
  }

  function addSet(exId) {
    const f = findEx(exId);
    if (!f) return;
    const sets = f.se.sets;
    const lastWork = sets.slice().reverse().filter(function (s) { return !s.warmup; })[0] || sets[sets.length - 1];
    let weight = "", reps = "";
    if (lastWork && WL.validSet(lastWork)) { weight = lastWork.weight; reps = lastWork.reps; }
    else {
      const prev = WL.previousPerformance(api().getWorkouts(), f.se.exerciseId);
      const g = WL.suggestForPlan(["normal"], prev ? prev.sets : [])[0];
      if (g) { weight = g.weight; reps = g.reps; }
    }
    const ns = WL.newSet({ weight: weight, reps: reps });
    sets.push(ns);
    delete collapsed[exId]; expanded[exId] = true; draft().activeIndex = f.idx;
    save();
    renderSession();
    focusSoon(weight === "" ? '[data-wk-field="weight"][data-set="' + ns.id + '"]' : '[data-wk="done"][data-set="' + ns.id + '"]');
  }

  function onFieldInput(el) {
    const f = findEx(el.getAttribute("data-ex"));
    if (!f) return;
    const hit = findSet(f.se, el.getAttribute("data-set"));
    if (!hit) return;
    const raw = el.value.trim();
    if (el.getAttribute("data-wk-field") === "weight") hit.s.weight = raw === "" || !isFinite(Number(raw)) ? "" : Number(raw);
    else hit.s.reps = raw === "" || !isFinite(Number(raw)) ? "" : Math.round(Number(raw));
    hit.s.touched = true;
    el.removeAttribute("aria-invalid");
    const row = el.closest(".wk-set");
    if (row) row.classList.remove("is-suggested");
    save();
  }

  /* ---------------- menus ---------------- */

  function openSetMenu(exId, setId, opener) {
    const f = findEx(exId); if (!f) return;
    const hit = findSet(f.se, setId); if (!hit) return;
    const s = hit.s;
    const type = s.warmup ? "warmup" : s.dropset ? "dropset" : "normal";
    const typeBtn = function (v, l) { return '<button type="button" class="wk-chip' + (type === v ? " is-on" : "") + '" data-wk="set-type" data-value="' + v + '" aria-pressed="' + (type === v) + '">' + l + '</button>'; };
    const rpeBtn = function (v) { const on = String(s.rpe) === String(v); return '<button type="button" class="wk-chip' + (on ? " is-on" : "") + '" data-wk="set-rpe" data-value="' + v + '" aria-pressed="' + on + '">' + (v === "" ? "Not set" : v) + '</button>'; };
    openSheet("Set options",
      '<div data-sheet-ex="' + esc(exId) + '" data-sheet-set="' + esc(setId) + '">' +
      '<h3 class="wk-sheet-sub">Type</h3><div class="wk-chips" role="group" aria-label="Set type">' + typeBtn("normal", "Normal") + typeBtn("warmup", "Warm-up") + typeBtn("dropset", "Drop set") + '</div>' +
      '<h3 class="wk-sheet-sub">How hard was it? (RPE, optional)</h3><div class="wk-chips" role="group" aria-label="Rate of perceived exertion">' + RPE_CHOICES.map(rpeBtn).join("") + '</div>' +
      '<p class="field-hint">RPE 10 means you could not have done another rep.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-danger wk-big-btn" data-wk="set-delete">Delete this set</button></div></div>');
  }

  function sheetTarget() {
    const el = document.querySelector("[data-sheet-ex]");
    if (!el) return null;
    const f = findEx(el.getAttribute("data-sheet-ex"));
    if (!f) return null;
    const hit = el.getAttribute("data-sheet-set") ? findSet(f.se, el.getAttribute("data-sheet-set")) : null;
    return { f: f, hit: hit };
  }

  function openExMenu(exId) {
    const f = findEx(exId); if (!f) return;
    const d = draft(), info = exInfo(f.se.exerciseId);
    const hasNext = f.idx < d.exercises.length - 1;
    const btn = function (action, label, extra) { return '<button type="button" class="wk-menu-item' + (extra || "") + '" data-wk="' + action + '">' + label + '</button>'; };
    openSheet(info.name,
      '<div data-sheet-ex="' + esc(exId) + '">' +
      (window.JarvisLibraryUI ? '<button type="button" class="wk-menu-item" data-lb="open" data-id="' + esc(f.se.exerciseId) + '">How to do it</button>' : "") +
      btn("ex-warmups", "Add warm-up sets") +
      (window.JarvisInsights ? window.JarvisInsights.swapMenuItem(f.se) : "") +
      btn("ex-up", "Move up") + btn("ex-down", "Move down") +
      (f.se.supersetGroup ? btn("ex-unlink", "Remove from superset") : (hasNext ? btn("ex-link", "Superset with the next exercise") : "")) +
      btn("ex-fav", window.JarvisExercises.isFavorite(f.se.exerciseId) ? "Remove from favorites" : "Add to favorites") +
      btn("ex-remove", "Remove exercise", " is-danger") + '</div>');
  }

  function openBarMenu() {
    const btn = function (action, label, extra) { return '<button type="button" class="wk-menu-item' + (extra || "") + '" data-wk="' + action + '">' + label + '</button>'; };
    openSheet("Workout options",
      btn("edit-time", "Change date and time") + btn("edit-notes", "Workout notes") + btn("rest-settings", "Rest timer: " + (prefs.restAuto ? prefs.restSeconds + " seconds" : "off")) + btn("discard", "Discard workout", " is-danger"));
  }

  function openRestSettings() {
    const cur = prefs.restAuto ? prefs.restSeconds : 0;
    openSheet("Rest timer",
      '<p class="wk-sheet-text">After you mark a set done, a timer starts so you know when to go again.</p>' +
      '<div class="wk-chips" role="group" aria-label="Rest time">' + REST_CHOICES.map(function (c) { const on = c.sec === cur; return '<button type="button" class="wk-chip' + (on ? " is-on" : "") + '" data-wk="rest-set" data-value="' + c.sec + '" aria-pressed="' + on + '">' + c.label + '</button>'; }).join("") + '</div>' +
      '<label class="wk-check-row"><input type="checkbox" id="wkRestSound"' + (prefs.restSound ? " checked" : "") + '> <span>Play a sound when rest ends</span></label>' +
      '<p class="field-hint">iPhone web apps can\'t vibrate. The sound only plays if your ringer is on, and the timer is also shown on screen.</p>');
  }

  function doExAction(action) {
    const t = sheetTarget(); if (!t) return;
    const d = draft(), f = t.f;
    if (action === "ex-up" || action === "ex-down") {
      const to = f.idx + (action === "ex-up" ? -1 : 1);
      if (to < 0 || to >= d.exercises.length) { closeSheet(); return; }
      const tmp = d.exercises[to]; d.exercises[to] = d.exercises[f.idx]; d.exercises[f.idx] = tmp;
      d.activeIndex = to;
    } else if (action === "ex-link") {
      const next = d.exercises[f.idx + 1];
      const g = f.se.supersetGroup || WL.makeId("ss");
      f.se.supersetGroup = g; next.supersetGroup = g;
    } else if (action === "ex-unlink") {
      const g = f.se.supersetGroup; f.se.supersetGroup = null;
      const left = d.exercises.filter(function (e) { return e.supersetGroup === g; });
      if (left.length === 1) left[0].supersetGroup = null;
    } else if (action === "ex-fav") {
      const now = window.JarvisExercises.toggleFavorite(f.se.exerciseId);
      closeSheet(); core().showToast(now ? "Added to favorites." : "Removed from favorites."); return;
    } else if (action === "ex-remove") {
      pushUndo("Removed " + exInfo(f.se.exerciseId).name + ".");
      d.exercises.splice(f.idx, 1);
      d.activeIndex = Math.max(0, Math.min(d.activeIndex, d.exercises.length - 1));
    } else if (action === "ex-warmups") {
      const best = WL.bestSets(api().getWorkouts(), f.se.exerciseId).heaviest;
      const firstWork = f.se.sets.filter(function (s) { return !s.warmup && WL.validSet(s); })[0];
      const top = best ? best.weight : (firstWork ? Number(firstWork.weight) : 0);
      if (!(top > 0)) { closeSheet(); core().showToast("Log a working weight first. Warm-ups are suggested from it."); return; }
      const ramp = [{ pct: 0.4, reps: 10 }, { pct: 0.6, reps: 6 }, { pct: 0.8, reps: 3 }].map(function (r) { return WL.newSet({ weight: Math.round(top * r.pct / 5) * 5, reps: r.reps, warmup: true }); });
      const at = f.se.sets.findIndex(function (s) { return !s.warmup; });
      f.se.sets.splice(at === -1 ? f.se.sets.length : at, 0, ramp[0], ramp[1], ramp[2]);
      expanded[f.se.sessionExId] = true; delete collapsed[f.se.sessionExId];
      announce("Added 3 warm-up sets. They are not marked done.");
    }
    save(); closeSheet(); renderSession();
  }

  /* ---------------- adding exercises ---------------- */

  // The exercise picker. With no argument it adds one exercise to the workout on screen. The Routines screen passes a target:
  //   { multi: true, title, taken: {exerciseId: true}, takenLabel, selected: [], doneLabel(n), onDone(ids) }
  // to tick several exercises and add them all at once.
  let pickTarget = null;

  function openPicker(target) {
    pickTarget = target || null;
    const multi = !!(pickTarget && pickTarget.multi);
    if (multi && !pickTarget.selected) pickTarget.selected = [];
    const JE = window.JarvisExercises;
    openSheet(pickTarget && pickTarget.title ? pickTarget.title : "Add exercise",
      '<div class="wk-search"><label class="visually-hidden" for="wkPickSearch">Search exercises</label><input id="wkPickSearch" type="search" placeholder="Search exercises" autocomplete="off" autocapitalize="off" enterkeyhint="search"></div>' +
      '<div class="form-row two-col wk-pick-filter"><div><label for="wkPickMuscle">Muscle group</label><select id="wkPickMuscle"><option value="">All</option>' + JE.MUSCLE_GROUPS.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join("") + '</select></div>' +
      '<div><label for="wkPickEquip">Equipment</label><select id="wkPickEquip"><option value="">All</option>' + JE.EQUIPMENT_TYPES.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join("") + '</select></div></div>' +
      '<div id="wkPickList" class="wk-pick-list"></div>' +
      (multi ? '<div class="wk-pick-foot"><button type="button" class="btn btn-primary wk-big-btn" id="wkPickDone" data-wk="pick-done" disabled>Choose exercises</button></div>' : ""), { focus: "#wkPickSearch" });
    sheet.picker = { muscle: "", equipment: "" };
    drawPicker();
    updatePickFoot();
  }

  function updatePickFoot() {
    const b = $("wkPickDone");
    if (!b || !pickTarget || !pickTarget.multi) return;
    const n = pickTarget.selected.length;
    b.disabled = n === 0;
    b.textContent = n === 0 ? "Choose exercises" : (pickTarget.doneLabel ? pickTarget.doneLabel(n) : "Add " + n + " " + plural(n, "exercise"));
  }

  // Tick or untick one exercise in the multi picker without redrawing the list (so your place in it isn't lost).
  function toggleSelected(id) {
    const t = pickTarget, at = t.selected.indexOf(id);
    if (at === -1) t.selected.push(id); else t.selected.splice(at, 1);
    const on = at === -1;
    Array.prototype.forEach.call(document.querySelectorAll('#wkPickList [data-wk="pick"]'), function (b) {
      if (b.getAttribute("data-id") === id) { b.setAttribute("aria-pressed", String(on)); b.classList.toggle("is-picked", on); }
    });
    updatePickFoot();
    announce(exInfo(id).name + (on ? " selected. " : " removed. ") + t.selected.length + " chosen.");
  }

  function pickExercise(id) {
    if (pickTarget && pickTarget.multi) {
      if (pickTarget.taken && pickTarget.taken[id]) { core().showToast("That exercise is already in this routine."); return; }
      if (!$("wkPickList")) { if (pickTarget.selected.indexOf(id) === -1) pickTarget.selected.push(id); openPicker(pickTarget); return; }   // from the "you already have it" link in the custom form
      toggleSelected(id);
      return;
    }
    addExercise(id);
  }

  function pickerResults(query, muscle, equipment) {
    const JE = window.JarvisExercises;
    const EL = window.JarvisExerciseLogic;
    const all = JE.getExercises();
    const q = query.toLowerCase().trim();
    const match = function (e) { return (!muscle || e.muscleGroup === muscle) && (!equipment || e.equipment === equipment) && (!q || e.name.toLowerCase().indexOf(q) !== -1 || (e.equipment || "").toLowerCase().indexOf(q) !== -1); };
    const byName = function (a, b) { return a.name < b.name ? -1 : 1; };
    // Every word you type has to match the name, the muscle group or the equipment ("db bench", "chest cable"); best matches first.
    if (q || muscle || equipment) return [{ title: "Results", items: (EL ? EL.filterExercises(all, { query: query, muscle: muscle, equipment: equipment }) : all.filter(match).sort(byName)).slice(0, 80) }];
    const favIds = JE.loadFavoriteIds();
    const favs = favIds.map(JE.getExerciseById).filter(Boolean);
    const recentIds = [];
    WL.sessionsOf(api().getWorkouts()).slice().sort(function (a, b) { return a.dateTime < b.dateTime ? 1 : -1; }).forEach(function (w) { w.exercises.forEach(function (se) { if (recentIds.indexOf(se.exerciseId) === -1) recentIds.push(se.exerciseId); }); });
    const recent = recentIds.slice(0, 8).map(JE.getExerciseById).filter(Boolean).filter(function (e) { return favIds.indexOf(e.id) === -1; });
    return [{ title: "Favorites", items: favs }, { title: "Recent", items: recent }, { title: "All exercises", items: all.slice().sort(byName) }].filter(function (g) { return g.items.length; });
  }

  function drawPicker() {
    const JE = window.JarvisExercises;
    const list = $("wkPickList");
    if (!list) return;
    const muscle = sheet.picker.muscle, equipment = sheet.picker.equipment, query = $("wkPickSearch").value;
    const groups = pickerResults(query, muscle, equipment);
    const multi = !!(pickTarget && pickTarget.multi);
    const inDraft = multi && pickTarget.taken ? pickTarget.taken : {};
    if (!multi) draft().exercises.forEach(function (se) { inDraft[se.exerciseId] = true; });
    const takenLabel = multi && pickTarget.takenLabel ? pickTarget.takenLabel : "in workout";
    const picked = multi ? pickTarget.selected : [];
    const total = groups.reduce(function (t, g) { return t + g.items.length; }, 0);
    list.innerHTML = (total ? groups.map(function (g) {
      return (g.title ? '<h3 class="wk-sheet-sub">' + esc(g.title) + '</h3>' : '') + g.items.map(function (e) {
        const isPicked = picked.indexOf(e.id) !== -1;
        return '<div class="wk-pick-row"><button type="button" class="wk-pick' + (isPicked ? " is-picked" : "") + '" data-wk="pick" data-id="' + esc(e.id) + '"' + (multi ? ' aria-pressed="' + isPicked + '"' + (inDraft[e.id] ? " disabled" : "") : "") + '><span class="wk-row-title">' + esc(e.name) + (inDraft[e.id] ? ' <span class="wk-tag">' + esc(takenLabel) + '</span>' : '') + '</span><span class="wk-row-sub">' + esc([e.muscleGroup, e.equipment].filter(Boolean).join(" · ")) + '</span></button>' +
          '<button type="button" class="wk-icon-btn" data-wk="pick-fav" data-id="' + esc(e.id) + '" aria-pressed="' + JE.isFavorite(e.id) + '" aria-label="' + (JE.isFavorite(e.id) ? "Remove " : "Add ") + esc(e.name) + (JE.isFavorite(e.id) ? " from favorites" : " to favorites") + '"><svg class="wk-star' + (JE.isFavorite(e.id) ? " is-on" : "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7l-5.9 3.1 1.2-6.5L2.5 9.7l6.6-.9z"/></svg></button></div>';
      }).join("");
    }).join("") : '<p class="wk-empty">Nothing matches.</p>') +
      '<button type="button" class="wk-menu-item" data-wk="custom-open">Create a custom exercise' + (query.trim() ? ': ' + esc(query.trim()) : '') + '</button>';
  }

  function addExercise(id) {
    const d = draft();
    const existing = d.exercises.findIndex(function (se) { return se.exerciseId === id; });
    if (existing !== -1) {
      closeSheet(); d.activeIndex = existing; delete collapsed[d.exercises[existing].sessionExId]; expanded[d.exercises[existing].sessionExId] = true;
      save(); renderSession(); focusSoon('[data-ex-card="' + d.exercises[existing].sessionExId + '"] .wk-ex-toggle');
      core().showToast("That exercise is already in this workout."); return;
    }
    const se = WL.exerciseFromHistory(id, api().getWorkouts());
    d.exercises.push(se);
    d.activeIndex = d.exercises.length - 1;
    if (!d.startedAt) d.startedAt = Date.now();
    save(); closeSheet(); renderAll();
    const first = se.sets[0];
    focusSoon(first.weight === "" ? '[data-wk-field="weight"][data-set="' + first.id + '"]' : '[data-wk="done"][data-set="' + first.id + '"]');
    announce(exInfo(id).name + " added.");
  }

  function openCustomForm(prefill) {
    const JE = window.JarvisExercises;
    const opt = function (list) { return list.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(""); };
    openSheet("Custom exercise",
      '<form id="wkCustomForm" class="stacked-form" novalidate>' +
      '<div class="form-row"><label for="wkCustName">Name</label><input id="wkCustName" type="text" maxlength="60" value="' + esc(prefill || "") + '" autocomplete="off"></div>' +
      '<div class="form-row two-col"><div><label for="wkCustMuscle">Muscle group</label><select id="wkCustMuscle">' + opt(JE.MUSCLE_GROUPS) + '</select></div><div><label for="wkCustEquip">Equipment</label><select id="wkCustEquip">' + opt(JE.EQUIPMENT_TYPES) + '</select></div></div>' +
      '<p class="dc-error" id="wkCustError" role="alert"></p>' +
      '<div class="wk-sheet-actions"><button type="submit" class="btn btn-primary wk-big-btn">Add and use it</button></div></form>', { focus: "#wkCustName" });
  }

  function saveCustom(e) {
    e.preventDefault();
    const JE = window.JarvisExercises;
    const name = $("wkCustName").value.replace(/\s+/g, " ").trim();
    const err = $("wkCustError");
    if (!name) { err.textContent = "Give it a name."; $("wkCustName").focus(); return; }
    const EL = window.JarvisExerciseLogic;
    const equip = $("wkCustEquip").value;
    const found = EL ? EL.findSimilar(name, equip, JE.getExercises()) : { exact: WL.findDuplicate(name, JE.getExercises()), similar: [] };
    if (found.exact) {
      err.innerHTML = 'You already have &ldquo;' + esc(found.exact.name) + '&rdquo;. <button type="button" class="wk-link" data-wk="pick" data-id="' + esc(found.exact.id) + '">Use that one</button>';
      return;
    }
    const sig = name.toLowerCase() + "|" + equip;
    const form = e.target;
    if (found.similar.length && form.getAttribute("data-ack") !== sig) {
      form.setAttribute("data-ack", sig);
      err.innerHTML = 'This looks like ' + found.similar.map(function (s) { return '&ldquo;' + esc(s.exercise.name) + '&rdquo; <button type="button" class="wk-link" data-wk="pick" data-id="' + esc(s.exercise.id) + '">Use that one</button>'; }).join(' or ') + '. Using it keeps your history in one place. If yours is different, tap Add and use it again.';
      announce("This looks like an exercise you already have. Tap the button again to add yours anyway.");
      return;
    }
    const created = JE.addCustomExercise({ name: name, muscleGroup: $("wkCustMuscle").value, equipment: $("wkCustEquip").value });
    if (pickTarget && pickTarget.multi) {
      if (pickTarget.selected.indexOf(created.id) === -1) pickTarget.selected.push(created.id);
      openPicker(pickTarget);
      announce(created.name + " created and selected.");
      return;
    }
    addExercise(created.id);
  }

  /* ---------------- finishing ---------------- */

  function askFinish() {
    const p = WL.pendingSets(draft());
    if (p.done === 0) {
      openSheet("Nothing logged yet", '<p class="wk-sheet-text">Mark at least one set done and it will be saved. Or discard this workout.</p>' +
        '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-wk="sheet-close">Keep going</button><button type="button" class="btn btn-danger wk-big-btn" data-wk="discard-confirm">Discard workout</button></div>');
      return;
    }
    if (p.open > 0) {
      openSheet("Finish with " + p.open + " " + plural(p.open, "set") + " not done?",
        '<p class="wk-sheet-text">Sets you haven\'t marked done won\'t be saved. You have ' + p.done + ' done.</p>' +
        '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-wk="finish-confirm">Finish and save ' + p.done + '</button><button type="button" class="btn btn-secondary wk-big-btn" data-wk="sheet-close">Keep going</button></div>');
      return;
    }
    finishNow();
  }

  function finishNow() {
    closeSheet(true);
    const session = failed || WL.buildSession(draft(), { now: Date.now(), routineName: routineName(draft().routineId) });
    if (!session) return;
    const result = api().commitSession(session, {});
    if (!result.ok) { failed = session; renderSession(); return; }
    failed = null;
    const all = api().getWorkouts();
    summary = { session: session, stats: WL.sessionStats(session), prs: WL.sessionPRs(all, session), cmp: WL.compareToPrevious(all, session) };
    expanded = {}; collapsed = {};
    clearUndo();
    renderAll();
    window.scrollTo(0, 0);
    announce("Workout saved.");
  }

  function discardNow() {
    closeSheet(true);
    pushUndo("Workout discarded.");
    api().replaceDraft(WL.emptyDraft(nowLocal()));
    expanded = {}; collapsed = {}; failed = null;
    renderAll();
    goTo("wk-home");
  }

  /* ---------------- the rest timer bar ---------------- */

  function renderRest() {
    const bar = $("wkRestBar");
    if (!bar) return;
    const d = draft(), now = Date.now();
    const left = WL.restRemainingMs(d.restEndsAt, now);
    const showDone = restFinishedAt && now - restFinishedAt < 4000;
    const show = isActive() && !summary && (left > 0 || showDone);
    bar.classList.toggle("hidden", !show);
    bar.classList.toggle("is-over", !!showDone && left === 0);
    if (!show) return;
    $("wkRestTime").textContent = left > 0 ? WL.formatClock(left) : "Rest over";
    const total = restSecondsNow() * 1000 || 90000;
    $("wkRestFill").style.width = left > 0 ? Math.max(0, Math.min(100, (1 - left / Math.max(total, left)) * 100)) + "%" : "100%";
  }

  function tick() {
    const d = draft();
    const now = Date.now();
    if (isActive()) document.querySelectorAll(".wk-elapsed").forEach(function (el) { el.textContent = elapsedText(d); });
    if (d.restEndsAt && d.restEndsAt <= now) {
      d.restEndsAt = null; restFinishedAt = now; save(); beep();
      announce("Rest over.");
      window.setTimeout(renderRest, 4100);
    }
    renderRest();
  }

  /* ---------------- clicks ---------------- */

  function onClick(e) {
    const focused = document.activeElement;
    if (focused && focused.matches && focused.matches("input, textarea, select") && !e.target.closest("input, textarea, select")) focused.blur();   // values are already saved as they were typed
    const go = e.target.closest("[data-wk-go]");
    if (go) { closeSheet(true); goTo(go.getAttribute("data-wk-go")); return; }
    const el = e.target.closest("[data-wk]");
    if (!el) return;
    const act = el.getAttribute("data-wk");
    const exId = el.getAttribute("data-ex"), setId = el.getAttribute("data-set"), id = el.getAttribute("data-id");
    switch (act) {
      case "resume": goTo("wk-session"); break;
      case "start-routine": startRoutine(id); break;
      case "start-program": startProgram(id); break;
      case "start-empty": startEmpty(); break;
      case "repeat-last": repeatLast(); break;
      case "resume-close": closeSheet(); goTo("wk-session"); break;
      case "replace-confirm": { const b = pendingBuild; const before = WL.cloneDraft(draft()); closeSheet(true); begin(b, true); pushUndo("Replaced your workout.", before); break; }
      case "toggle-ex": { const f = findEx(exId); if (!f) break; if (isOpen(f.se, f.idx)) { collapsed[exId] = true; delete expanded[exId]; } else { expanded[exId] = true; delete collapsed[exId]; draft().activeIndex = f.idx; save(); } renderSession(); focusSoon('[data-ex-card="' + exId + '"] .wk-ex-toggle', false); break; }
      case "done": toggleDone(exId, setId); break;
      case "add-set": addSet(exId); break;
      case "add-ex": openPicker(); break;
      case "ex-menu": openExMenu(exId); break;
      case "set-menu": openSetMenu(exId, setId, el); break;
      case "bar-menu": openBarMenu(); break;
      case "finish": askFinish(); break;
      case "finish-confirm": finishNow(); break;
      case "finish-retry": finishNow(); break;
      case "discard": closeSheet(true); openSheet("Discard this workout?", '<p class="wk-sheet-text">Everything you logged in it will be removed. You can undo this for a few seconds afterwards.</p><div class="wk-sheet-actions"><button type="button" class="btn btn-danger wk-big-btn" data-wk="discard-confirm">Discard workout</button><button type="button" class="btn btn-secondary wk-big-btn" data-wk="sheet-close">Keep it</button></div>'); break;
      case "discard-confirm": discardNow(); break;
      case "sheet-close": closeSheet(); break;
      case "dismiss-restored": restored = false; renderSession(); break;
      case "classic": api().openClassicLogger(); break;
      case "undo": doUndo(); break;
      case "summary-done": summary = null; renderAll(); goTo("wk-home"); window.scrollTo(0, 0); break;
      case "summary-history": summary = null; renderAll(); goTo("wk-history"); window.scrollTo(0, 0); break;
      case "rest-add": case "rest-sub": { const d = draft(); d.restEndsAt = WL.adjustRest(d.restEndsAt, act === "rest-add" ? 15 : -15, Date.now()); save(); renderRest(); break; }
      case "rest-skip": { const d = draft(); d.restEndsAt = null; restFinishedAt = 0; save(); renderRest(); break; }
      case "rest-settings": closeSheet(true); openRestSettings(); break;
      case "rest-set": { const sec = Number(el.getAttribute("data-value")); if (sec === 0) prefs.restAuto = false; else { prefs.restAuto = true; prefs.restSeconds = sec; } savePrefs(); closeSheet(); core().showToast(sec ? "Rest timer: " + sec + " seconds." : "Rest timer off."); break; }
      case "edit-time": { closeSheet(true); const d = draft(); openSheet("Date and time", '<div class="form-row"><label for="wkWhen">When did this workout happen?</label><input type="datetime-local" id="wkWhen" value="' + esc(d.dateTime || nowLocal()) + '"></div><p class="field-hint">Use this to log a workout you did earlier.</p><div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-wk="when-save">Save</button></div>', { focus: "#wkWhen" }); break; }
      case "when-save": { const v = $("wkWhen").value; if (v) { draft().dateTime = v; save(); } closeSheet(); break; }
      case "edit-notes": { closeSheet(true); openSheet("Workout notes", '<div class="form-row"><label for="wkNotes">Notes</label><textarea id="wkNotes" rows="4" maxlength="500">' + esc(draft().notes) + '</textarea></div><div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-wk="notes-save">Save</button></div>', { focus: "#wkNotes" }); break; }
      case "notes-save": draft().notes = $("wkNotes").value; save(); closeSheet(); break;
      case "ex-warmups": case "ex-up": case "ex-down": case "ex-link": case "ex-unlink": case "ex-fav": case "ex-remove": doExAction(act); break;
      case "set-type": case "set-rpe": case "set-delete": {
        const t = sheetTarget(); if (!t || !t.hit) break;
        const s = t.hit.s;
        if (act === "set-type") { const v = el.getAttribute("data-value"); s.warmup = v === "warmup"; s.dropset = v === "dropset"; }
        else if (act === "set-rpe") { const v = el.getAttribute("data-value"); s.rpe = v === "" ? "" : Number(v); }
        else { pushUndo("Set deleted."); t.f.se.sets.splice(t.hit.idx, 1); }
        save(); closeSheet(); renderSession(); break;
      }
      case "pick": pickExercise(id); break;
      case "pick-done": { const t = pickTarget; if (!t || !t.selected.length) break; const ids = t.selected.slice(); closeSheet(); pickTarget = null; t.onDone(ids); break; }
      case "pick-fav": window.JarvisExercises.toggleFavorite(id); drawPicker(); break;
      case "custom-open": { const q = $("wkPickSearch") ? $("wkPickSearch").value.trim() : ""; closeSheet(true); openCustomForm(q); break; }
      default: break;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.matches && t.matches("[data-wk-field]")) { onFieldInput(t); return; }
    if (t.id === "wkPickSearch") drawPicker();
    if (t.id === "wkRestSound") { prefs.restSound = t.checked; savePrefs(); }
    if (t.id === "wkSumNotes") { if (summary) { summary.session.notes = t.value; } }
  }
  function onChange(e) {
    if (e.target.id === "wkPickMuscle" && sheet && sheet.picker) { sheet.picker.muscle = e.target.value; drawPicker(); return; }
    if (e.target.id === "wkPickEquip" && sheet && sheet.picker) { sheet.picker.equipment = e.target.value; drawPicker(); return; }
    if (e.target.id === "wkSumNotes" && summary) api().updateSessionNotes(summary.session.id, e.target.value);
  }
  function onKeyDown(e) {
    if (e.key === "Enter" && e.target.matches && e.target.matches('[data-wk-field="reps"]')) {
      e.preventDefault();
      const exId = e.target.getAttribute("data-ex"), setId = e.target.getAttribute("data-set");
      const f = findEx(exId), hit = f && findSet(f.se, setId);
      // The screen is never redrawn under a field that has focus, so let go of it first; the typed values are already saved.
      e.target.blur();
      if (hit && hit.s.completed) return;   // Enter on a finished set just closes the keyboard; it never un-does the set
      toggleDone(exId, setId);
    }
    if (e.key === "Enter" && e.target.matches && e.target.matches('[data-wk-field="weight"]')) { e.preventDefault(); const r = e.target.closest(".wk-set").querySelector('[data-wk-field="reps"]'); if (r) r.focus(); }
  }
  function onBlurCapture(e) {
    if (e.target.id === "wkSumNotes" && summary) api().updateSessionNotes(summary.session.id, e.target.value);
  }

  /* ---------------- public ---------------- */

  function ensureChrome() {
    const panel = $("panel-workout");
    if (!panel) return;
    if (!$("wkRestBar")) {
      const div = document.createElement("div");
      div.innerHTML = '<div id="wkDock" class="wk-dock wk-scope">' +
        '<div id="wkRestBar" class="wk-rest hidden" role="group" aria-label="Rest timer"><div class="wk-rest-main"><span class="wk-rest-label">Rest</span><span id="wkRestTime" class="wk-rest-time" role="timer" aria-live="off">0:00</span></div>' +
        '<div class="wk-rest-actions"><button type="button" class="btn btn-secondary" data-wk="rest-sub">&minus;15</button><button type="button" class="btn btn-secondary" data-wk="rest-add">+15</button><button type="button" class="btn btn-secondary" data-wk="rest-skip">Skip</button></div><div class="wk-rest-progress" aria-hidden="true"><span id="wkRestFill"></span></div></div>' +
        '<div id="wkUndoBar" class="wk-undo hidden" role="status"><span class="wk-undo-text"></span><button type="button" class="btn btn-secondary" data-wk="undo">Undo</button></div></div>' +
        '<div id="wkSheetRoot" class="wk-sheet-root wk-scope hidden"></div><p id="wkLive" class="visually-hidden" role="status" aria-live="polite"></p>';
      while (div.firstChild) panel.appendChild(div.firstChild);
    }
  }

  function init() {
    if (started || !WL || !window.JarvisWorkout || !window.JarvisWorkout.api || !$("wk-home")) return;
    started = true;
    loadPrefs();
    ensureChrome();
    restored = isActive();
    const panel = $("panel-workout");
    panel.addEventListener("click", onClick);
    panel.addEventListener("input", onInput);
    panel.addEventListener("change", onChange);
    panel.addEventListener("keydown", onKeyDown);
    panel.addEventListener("blur", onBlurCapture, true);
    panel.addEventListener("submit", function (e) { if (e.target.id === "wkCustomForm") saveCustom(e); });
    document.addEventListener("keydown", onSheetKey);
    document.addEventListener("jarvis-workout-changed", function () { renderHome(); if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#wkSessionRoot"))) renderSession(); });
    ["workoutSubNavWkHome", "workoutSubNavWkSession", "navBtnWorkout"].forEach(function (id) { const b = $(id); if (b) b.addEventListener("click", function () { window.setTimeout(renderAll, 0); }); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { tick(); renderAll(); } });
    window.setInterval(tick, 1000);
    window.addEventListener("resize", syncFocusMode);
    renderAll();
  }

  // The pieces the Routines screen (routines-ui.js) shares with the logger: sheets, the exercise picker, the undo bar.
  const kit = {
    openSheet: openSheet, closeSheet: closeSheet, isSheetOpen: function () { return !!sheet; },
    openPicker: openPicker, pushUndo: pushUndo, announce: announce, focusSoon: focusSoon, goTo: goTo
  };
  window.JarvisWorkoutUI = { init: init, render: renderAll, startRoutine: startRoutine, startProgram: startProgram, kit: kit };
})();
