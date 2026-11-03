/* ==========================================================================
   JARVIS — Routines: the list, the week, archive / restore, and the step-by-step
   builder (the Routines tab of Workout).

   The rules live in routine-logic.js. The data is the same in-memory data as workout.js,
   through window.JarvisWorkout.api. Sheets, the exercise picker and the undo bar are shared
   with the logger (window.JarvisWorkoutUI.kit).

   localStorage key owned here (this phone only, never synced):
     jarvisRoutineDraft — the routine you were in the middle of building, so a phone call or a
                          closed app doesn't lose it.

   What is promised on screen:
     - Editing a routine never changes a workout you already saved.
     - Archive hides a routine and can be undone; only an archived routine can be deleted, and
       the screen says what that leaves behind first.
     - The builder has two steps: name and days, then exercises. Sets and reps are filled in for you
       (your last workout's numbers if you have them, otherwise 3 x 10).
   ========================================================================== */

(function () {
  "use strict";

  const RL = window.JarvisRoutineLogic;
  const WL = window.JarvisWorkoutLogic;
  const LS_DRAFT = "jarvisRoutineDraft";

  let started = false;
  let builder = null;        // { b, step, errors: { name, exercises, sets: {index: msg}, save }, fromLast: {exerciseId: true} }
  let editingSets = null;    // { index, sets } while the "each set" sheet is open

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v === undefined || v === null ? "" : String(v)); }
  function api() { return window.JarvisWorkout.api; }
  function kit() { return window.JarvisWorkoutUI && window.JarvisWorkoutUI.kit; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function exInfo(id) { return window.JarvisExercises.getExerciseById(id) || { id: id, name: "Unknown exercise", muscleGroup: "", equipment: "" }; }
  function prettyDate(date) { const p = String(date).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function root() { return $("rtRoot"); }

  /* ---------------- the unfinished routine, kept on this phone ---------------- */

  function saveDraft() {
    try {
      if (!builder) localStorage.removeItem(LS_DRAFT);
      else localStorage.setItem(LS_DRAFT, JSON.stringify({ b: builder.b, step: builder.step, savedAt: Date.now() }));
    } catch (e) { /* the screen still works; it just can't be restored later */ }
  }
  function loadDraft() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_DRAFT) || "null");
      if (!raw) return null;
      const b = RL.sanitizeBuilder(raw.b);
      if (!b || !RL.isDirty(b)) return null;
      return { b: b, step: raw.step === 1 ? 1 : 2 };
    } catch (e) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(LS_DRAFT); } catch (e) { /* nothing to clear */ } }

  /* ---------------- the list ---------------- */

  function lastUsedText(id) {
    const u = RL.usageOf(api().getWorkouts(), id);
    return u.lastDate ? "last " + prettyDate(u.lastDate) : "not used yet";
  }

  function exerciseLine(r) {
    const names = r.exercises.map(function (re) { return exInfo(re.exerciseId).name; });
    return names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) + " more" : "");
  }

  function cardHtml(r) {
    const muscles = RL.muscleSummary(r, exInfo);
    const days = RL.dayText(r.scheduledDays || []);
    const n = r.exercises.length;
    return '<article class="rt-card card" aria-labelledby="rtN_' + esc(r.id) + '">' +
      '<h3 class="rt-name" id="rtN_' + esc(r.id) + '">' + esc(r.name) + '</h3>' +
      '<p class="rt-meta">' + n + ' ' + plural(n, "exercise") + ' &middot; ' + RL.workingSetCount(r) + ' sets' + (muscles.length ? ' &middot; ' + esc(muscles.slice(0, 3).join(", ")) : '') + '</p>' +
      '<p class="rt-meta">' + (days ? esc(days) : 'Not on your week') + ' &middot; ' + esc(lastUsedText(r.id)) + '</p>' +
      '<p class="rt-ex-line">' + esc(exerciseLine(r)) + '</p>' +
      '<div class="rt-actions"><button type="button" class="btn btn-primary" data-rt="start" data-id="' + esc(r.id) + '">Start</button>' +
      '<button type="button" class="btn btn-secondary" data-rt="edit" data-id="' + esc(r.id) + '">Edit</button>' +
      '<button type="button" class="wk-icon-btn" data-rt="menu" data-id="' + esc(r.id) + '" aria-label="More for ' + esc(r.name) + '"><span aria-hidden="true">&#8943;</span></button></div></article>';
  }

  function weekHtml() {
    return '<section class="wk-block" aria-labelledby="rtWeekH"><h2 class="wk-block-title" id="rtWeekH">Your week</h2>' +
      '<p class="field-hint">One routine per day. It repeats every week. Doing a routine on another day never changes this.</p>' +
      '<div class="rt-week">' + RL.weekPlan(api().getRoutines()).map(function (d) {
        return '<button type="button" class="rt-day-row" data-rt="week-day" data-day="' + d.day + '"><span class="rt-day-name">' + esc(d.label) + '</span><span class="rt-day-val' + (d.routine ? "" : " is-rest") + '">' + esc(d.routine ? d.routine.name : "Rest day") + '</span><span class="rt-day-go" aria-hidden="true">Change</span></button>';
      }).join("") + '</div></section>';
  }

  function archivedHtml() {
    const list = RL.archived(api().getRoutines());
    if (!list.length) return "";
    return '<details class="rt-archived"><summary>Archived (' + list.length + ')</summary><p class="field-hint">Hidden from your lists and week. Your workouts that used them are still in History.</p>' +
      list.map(function (r) {
        return '<div class="rt-arch-row"><span class="rt-arch-name">' + esc(r.name) + '</span>' +
          '<button type="button" class="btn btn-secondary" data-rt="restore" data-id="' + esc(r.id) + '" aria-label="Restore ' + esc(r.name) + '">Restore</button>' +
          '<button type="button" class="btn btn-danger" data-rt="delete" data-id="' + esc(r.id) + '" aria-label="Delete ' + esc(r.name) + ' for good">Delete</button></div>';
      }).join("") + '</details>';
  }

  function renderList() {
    const el = root();
    if (!el) return;
    const routines = RL.listOrder(api().getRoutines());
    const draft = loadDraft();
    const draftHtml = draft ? '<div class="wk-notice" role="status"><span>Unfinished routine: <strong>' + esc(RL.cleanName(draft.b.name) || "no name yet") + '</strong> (' + draft.b.exercises.length + ' ' + plural(draft.b.exercises.length, "exercise") + ')</span>' +
      '<span class="rt-notice-actions"><button type="button" class="wk-link" data-rt="draft-continue">Continue</button><button type="button" class="wk-link" data-rt="draft-discard">Discard</button></span></div>' : "";
    const empty = '<section class="wk-block"><p class="wk-empty">No routines yet. Build your first one in about a minute: a name, then the exercises. Sets and reps are filled in for you.</p></section>';
    el.innerHTML = draftHtml +
      '<button type="button" class="btn btn-primary wk-big-btn rt-new" data-rt="new" id="rtNewBtn">New routine</button>' +
      (routines.length ? '<section class="wk-block rt-list" aria-labelledby="rtListH"><h2 class="wk-block-title" id="rtListH">Your routines</h2>' + routines.map(cardHtml).join("") + '</section>' : empty) +
      weekHtml() + archivedHtml();
    showGenerator(true);
  }

  function showGenerator(show) { const g = $("rtGenerator"); if (g) g.classList.toggle("hidden", !show); }

  /* ---------------- list actions ---------------- */

  function now() { return Date.now(); }

  function commit(nextRoutines, undoLabel) {
    const before = api().getRoutines();
    if (!api().replaceRoutines(nextRoutines)) { core().showToast("Couldn't save that. Nothing was changed."); return false; }
    if (undoLabel) kit().pushUndo(undoLabel, null, function () { api().replaceRoutines(before); renderList(); });
    renderList();
    return true;
  }

  function openMenu(id) {
    const r = RL.findById(api().getRoutines(), id);
    if (!r) return;
    kit().openSheet(r.name,
      '<button type="button" class="wk-menu-item" data-rt="duplicate" data-id="' + esc(id) + '">Duplicate</button>' +
      '<button type="button" class="wk-menu-item" data-rt="days" data-id="' + esc(id) + '">Change days</button>' +
      '<button type="button" class="wk-menu-item" data-rt="archive" data-id="' + esc(id) + '">Archive<span class="wk-menu-sub">Hides it. Your history stays. You can restore it.</span></button>');
  }

  function archive(id) {
    const r = RL.findById(api().getRoutines(), id);
    if (!r) return;
    kit().closeSheet(true);
    if (commit(RL.archiveRoutine(api().getRoutines(), id, now()), "Archived " + r.name + ".")) kit().announce("Archived " + r.name + ". Undo is available for a few seconds.");
  }

  function restore(id) {
    const r = RL.findById(api().getRoutines(), id);
    if (!r) return;
    const next = RL.restoreRoutine(api().getRoutines(), id, now());
    const back = RL.findById(next, id);
    if (commit(next)) { core().showToast((back && back.name !== r.name ? "Restored as " + back.name + ". " : "Restored. ") + "Give it days in Your week."); kit().announce("Restored."); }
  }

  function askDelete(id) {
    const r = RL.findById(api().getRoutines(), id);
    if (!r || !RL.isArchived(r)) return;
    const impact = RL.deleteImpact(id, api().getWorkouts(), api().getPrograms());
    const lines = [];
    lines.push(impact.sessions
      ? 'It was used in ' + impact.sessions + ' ' + plural(impact.sessions, "workout") + '. They stay in History and keep the name &ldquo;' + esc(r.name) + '&rdquo;.'
      : 'It was never used in a workout.');
    if (impact.programDays.length) lines.push(impact.programDays.map(function (d) { return esc(d.dayLabel) + ' of ' + esc(d.programName); }).join(", ") + ' will need another routine.');
    kit().openSheet("Delete " + r.name + " for good?",
      '<p class="wk-sheet-text">' + lines.join(" ") + '</p><p class="wk-sheet-text">The routine itself (its exercises and sets) is removed.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-danger wk-big-btn" data-rt="delete-confirm" data-id="' + esc(id) + '">Delete for good</button>' +
      '<button type="button" class="btn btn-secondary wk-big-btn" data-wk="sheet-close">Keep it archived</button></div>');
  }

  function doDelete(id) {
    const a = api();
    const r = RL.findById(a.getRoutines(), id);
    if (!r || !RL.isArchived(r)) return;
    kit().closeSheet(true);
    const stamped = RL.stampNames(a.getWorkouts(), r);
    if (stamped.changed && !a.replaceWorkouts(stamped.workouts)) { core().showToast("Couldn't save, so nothing was deleted."); return; }
    if (commit(RL.deleteRoutine(a.getRoutines(), id), "Deleted " + r.name + ".")) kit().announce("Deleted " + r.name + ".");
  }

  function openDays(id) {
    const r = RL.findById(api().getRoutines(), id);
    if (!r) return;
    kit().closeSheet(true);
    kit().openSheet("Days for " + r.name,
      '<p class="wk-sheet-text">Pick the days it repeats on. A day can have one routine, so a day you pick here is taken from another.</p>' +
      daysHtml(r.scheduledDays || [], "sheet", id) + '<p class="field-hint rt-conflict" id="rtSheetConflict"></p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-rt="days-save" data-id="' + esc(id) + '">Save days</button></div>');
    sheetDays = (r.scheduledDays || []).slice();
    updateSheetConflict(id);
  }
  let sheetDays = [];

  function daysHtml(days, where, id) {
    return '<div class="rt-days" role="group" aria-label="Days of the week">' + RL.DAY_LABELS.map(function (label, d) {
      const on = days.indexOf(d) !== -1;
      return '<button type="button" class="rt-day' + (on ? " is-on" : "") + '" data-rt="' + (where === "sheet" ? "sheet-day" : "day-toggle") + '" data-day="' + d + '" aria-pressed="' + on + '" aria-label="' + label + '"><span aria-hidden="true">' + RL.DAY_SHORT[d].slice(0, 3) + '</span></button>';
    }).join("") + '</div>';
  }

  function conflictText(days, selfId) {
    const list = api().getRoutines();
    const taken = [];
    days.forEach(function (d) { const r = RL.routineForDay(list, d); if (r && r.id !== selfId) taken.push(RL.DAY_SHORT[d] + " is " + r.name + " now"); });
    return taken.length ? taken.join(". ") + ". Saving moves it here." : "";
  }
  function updateSheetConflict(id) { const el = $("rtSheetConflict"); if (el) el.textContent = conflictText(sheetDays, id); }

  function saveDays(id) {
    const list0 = api().getRoutines();
    const r = RL.findById(list0, id);
    if (!r) return;
    let list = list0;
    const have = r.scheduledDays || [];
    for (let d = 0; d < 7; d++) {
      const want = sheetDays.indexOf(d) !== -1, has = have.indexOf(d) !== -1;
      if (want && !has) list = RL.assignDay(list, d, id, now());
      if (!want && has) list = RL.assignDay(list, d, "", now());
    }
    kit().closeSheet(true);
    if (list === list0 || commit(list)) { core().showToast("Days saved."); renderList(); }
  }

  function openWeekDay(day) {
    const list = RL.active(api().getRoutines());
    const cur = RL.routineForDay(api().getRoutines(), day);
    kit().openSheet(RL.DAY_LABELS[day],
      '<div class="rt-choices" role="group" aria-label="Routine for ' + esc(RL.DAY_LABELS[day]) + '">' +
      '<button type="button" class="wk-menu-item rt-choice' + (!cur ? " is-on" : "") + '" data-rt="day-set" data-day="' + day + '" data-id="" aria-pressed="' + (!cur) + '">Rest day</button>' +
      list.map(function (r) { const on = cur && cur.id === r.id; return '<button type="button" class="wk-menu-item rt-choice' + (on ? " is-on" : "") + '" data-rt="day-set" data-day="' + day + '" data-id="' + esc(r.id) + '" aria-pressed="' + !!on + '">' + esc(r.name) + '</button>'; }).join("") + '</div>' +
      (list.length ? "" : '<p class="wk-sheet-text">You have no routines yet. Build one first.</p>'));
  }

  function setWeekDay(day, id) {
    kit().closeSheet(true);
    const next = RL.assignDay(api().getRoutines(), day, id, now());
    if (next !== api().getRoutines() && commit(next)) kit().announce(RL.DAY_LABELS[day] + (id ? " is " + RL.findById(next, id).name + "." : " is a rest day."));
  }

  /* ---------------- the builder ---------------- */

  function openBuilder(b, step) {
    builder = { b: b, step: step, errors: { name: null, exercises: null, sets: {}, save: null }, fromLast: {} };
    saveDraft();
    renderBuilder();
    const t = $("rtTitle"); if (t) t.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function closeBuilder() { builder = null; editingSets = null; clearDraft(); renderList(); window.scrollTo(0, 0); }

  function change(nextB) { builder.b = nextB; saveDraft(); }

  function stepHtml1() {
    const b = builder.b, e = builder.errors;
    const ideas = RL.NAME_IDEAS.map(function (n) { const label = n === "Full Body" ? "Full body" : n.replace(/ (Day|Body)$/, ""); return '<button type="button" class="wk-chip" data-rt="idea" data-value="' + esc(n) + '" aria-label="Use the name ' + esc(n) + '">' + esc(label) + '</button>'; }).join("");
    const conflict = conflictText(b.days, b.editId);
    return '<div class="form-row"><label for="rtName">Name</label><input type="text" id="rtName" maxlength="' + RL.NAME_MAX + '" autocomplete="off" enterkeyhint="next" placeholder="e.g. Push Day" value="' + esc(b.name) + '" aria-describedby="rtNameErr"' + (e.name ? ' aria-invalid="true"' : "") + '>' +
      '<p class="dc-error" id="rtNameErr" role="alert">' + esc(e.name || "") + '</p></div>' +
      '<div class="wk-chips rt-ideas" role="group" aria-label="Name ideas">' + ideas + '</div>' +
      '<h3 class="wk-sheet-sub">Days (optional)</h3>' + daysHtml(b.days, "builder") +
      '<p class="field-hint rt-conflict" id="rtConflict">' + esc(conflict) + '</p>' +
      '<div class="rt-nav"><button type="button" class="btn btn-primary wk-big-btn" data-rt="next">Next: exercises</button></div>';
  }

  function steppers(re, i) {
    const planned = RL.plannedSetsOf(re), name = exInfo(re.exerciseId).name;
    if (!RL.isUniform(planned)) {
      return '<div class="rt-uneven"><span class="rt-uneven-text">' + esc(RL.setsLabel(planned)) + ' reps</span><button type="button" class="btn btn-secondary" data-rt="edit-sets" data-i="' + i + '" aria-label="Edit each set of ' + esc(name) + '">Edit sets</button></div>';
    }
    const one = function (kind, label, value) {
      return '<div class="rt-stepper" role="group" aria-label="' + label + ' for ' + esc(name) + '"><span class="rt-stepper-label" aria-hidden="true">' + label + '</span><div class="rt-stepper-row">' +
        '<button type="button" class="rt-step-btn" data-rt="' + kind + '-" data-i="' + i + '" aria-label="Fewer ' + label.toLowerCase() + ' for ' + esc(name) + '">&minus;</button>' +
        '<input type="number" class="rt-num" inputmode="numeric" min="1" max="' + (kind === "sets" ? RL.MAX_SETS : RL.MAX_REPS) + '" step="1" value="' + value + '" data-rt-num="' + kind + '" data-i="' + i + '" aria-label="' + label + ' for ' + esc(name) + '">' +
        '<button type="button" class="rt-step-btn" data-rt="' + kind + '+" data-i="' + i + '" aria-label="More ' + label.toLowerCase() + ' for ' + esc(name) + '">+</button></div></div>';
    };
    return '<div class="rt-steppers">' + one("sets", "Sets", planned.length) + one("reps", "Reps", planned[0].reps) + '</div>';
  }

  function exerciseCardHtml(re, i) {
    const info = exInfo(re.exerciseId);
    const bad = builder.errors.sets[i];
    return '<li class="rt-ex' + (bad ? " has-error" : "") + '" data-ex-index="' + i + '"><div class="rt-ex-head"><div class="rt-ex-text"><span class="rt-ex-name">' + esc(info.name) + '</span>' +
      '<span class="rt-ex-sub">' + esc([info.muscleGroup, info.equipment].filter(Boolean).join(" · ")) + (re.supersetGroup ? ' &middot; Superset' : '') + '</span></div>' +
      '<button type="button" class="wk-icon-btn" data-rt="ex-menu" data-i="' + i + '" aria-label="Options for ' + esc(info.name) + '"><span aria-hidden="true">&#8943;</span></button></div>' +
      steppers(re, i) +
      (builder.fromLast[re.exerciseId] ? '<p class="field-hint">Sets and reps from your last workout.</p>' : '') +
      (bad ? '<p class="dc-error" role="alert">' + esc(bad) + '</p>' : '') + '</li>';
  }

  function stepHtml2() {
    const b = builder.b, e = builder.errors;
    const total = b.exercises.reduce(function (t, re) { return t + RL.plannedSetsOf(re).filter(function (p) { return p.type !== "warmup"; }).length; }, 0);
    return '<div class="rt-summary"><div class="rt-summary-main"><strong>' + esc(RL.cleanName(b.name) || "No name yet") + '</strong><span>' + (b.days.length ? esc(RL.dayText(b.days)) : "No days") + '</span></div>' +
      '<button type="button" class="wk-link" data-rt="step1">Change</button></div>' +
      '<button type="button" class="btn btn-secondary wk-big-btn" data-rt="add-ex" id="rtAddEx">' + (b.exercises.length ? "Add more exercises" : "Add exercises") + '</button>' +
      (e.exercises ? '<p class="dc-error" role="alert">' + esc(e.exercises) + '</p>' : '') +
      (b.exercises.length ? '<ol class="rt-exlist" aria-label="Exercises in this routine">' + b.exercises.map(exerciseCardHtml).join("") + '</ol>' +
        '<p class="rt-total">' + b.exercises.length + ' ' + plural(b.exercises.length, "exercise") + ' &middot; ' + total + ' ' + plural(total, "set") + '</p>' : '<p class="wk-empty">Pick the exercises you do in this session. You can choose several at once.</p>') +
      (e.save ? '<p class="dc-error" role="alert">' + esc(e.save) + '</p>' : '') +
      '<div class="rt-nav"><button type="button" class="btn btn-primary wk-big-btn" data-rt="save" id="rtSave">' + (b.editId ? "Save changes" : "Save routine") + '</button></div>';
  }

  function renderBuilder() {
    const el = root();
    if (!el || !builder) return;
    const b = builder.b, keepScroll = window.scrollY;
    el.innerHTML = '<div class="rt-bar"><button type="button" class="wk-link" data-rt="cancel">Cancel</button><span class="rt-step">Step ' + builder.step + ' of 2</span></div>' +
      '<h2 class="rt-title" id="rtTitle" tabindex="-1">' + (b.editId ? "Edit routine" : "New routine") + '</h2>' +
      (builder.step === 1 ? stepHtml1() : stepHtml2());
    showGenerator(false);
    window.scrollTo(0, keepScroll);
  }

  function focusSel(sel) { const el = root() && root().querySelector(sel); if (el) el.focus({ preventScroll: true }); }

  function goStep(n) {
    builder.step = n;
    saveDraft();
    renderBuilder();
    const t = $("rtTitle"); if (t) t.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    kit().announce("Step " + n + " of 2.");
  }

  function nameProblem() {
    const v = RL.validate(Object.assign({}, builder.b, { exercises: [{ exerciseId: "x", plannedSets: [{ reps: 10, type: "normal" }] }] }), api().getRoutines());
    return v.name;
  }

  function next() {
    const problem = nameProblem();
    if (problem) { builder.errors.name = problem; renderBuilder(); focusSel("#rtName"); kit().announce(problem); return; }
    builder.errors.name = null;
    goStep(2);
  }

  function addExercises(ids) {
    const defs = ids.map(function (id) { const p = RL.suggestedPlan(api().getWorkouts(), id); if (p.from === "last") builder.fromLast[id] = true; return { exerciseId: id, plannedSets: p.plannedSets }; });
    const res = RL.addExercises(builder.b, defs);
    change(res.builder);
    builder.errors.exercises = null;
    renderBuilder();
    focusSel("#rtAddEx");
    kit().announce(res.added + " " + plural(res.added, "exercise") + " added." + (res.skipped ? " " + res.skipped + " already in the routine." : ""));
  }

  function openAddPicker() {
    const taken = {};
    builder.b.exercises.forEach(function (e) { taken[e.exerciseId] = true; });
    kit().openPicker({ multi: true, title: "Add exercises", taken: taken, takenLabel: "in routine", selected: [], doneLabel: function (n) { return "Add " + n + " " + plural(n, "exercise"); }, onDone: addExercises });
  }

  function stepSet(i, kind, dir) {
    const cur = RL.plannedSetsOf(builder.b.exercises[i]);
    const o = {};
    if (kind === "sets") o.sets = cur.length + dir; else o.reps = cur[0].reps + dir;
    change(RL.setUniform(builder.b, i, o));
    delete builder.fromLast[builder.b.exercises[i].exerciseId];
    delete builder.errors.sets[i];
    renderBuilder();
    focusSel('[data-rt="' + kind + (dir > 0 ? "+" : "-") + '"][data-i="' + i + '"]');
  }

  function typedNumber(el) {
    const i = Number(el.getAttribute("data-i")), kind = el.getAttribute("data-rt-num");
    const raw = Math.round(Number(el.value));
    if (!isFinite(raw) || el.value === "") return;
    const max = kind === "sets" ? RL.MAX_SETS : RL.MAX_REPS;
    const o = {}; o[kind] = Math.max(1, Math.min(max, raw));
    change(RL.setUniform(builder.b, i, o));
    delete builder.fromLast[builder.b.exercises[i].exerciseId];
    delete builder.errors.sets[i];
  }

  function exerciseMenu(i) {
    const b = builder.b, re = b.exercises[i], name = exInfo(re.exerciseId).name;
    kit().openSheet(name,
      '<button type="button" class="wk-menu-item" data-rt="edit-sets" data-i="' + i + '">Edit each set<span class="wk-menu-sub">Different reps per set, warm-up or drop sets</span></button>' +
      (i > 0 ? '<button type="button" class="wk-menu-item" data-rt="ex-up" data-i="' + i + '">Move up</button>' : '') +
      (i < b.exercises.length - 1 ? '<button type="button" class="wk-menu-item" data-rt="ex-down" data-i="' + i + '">Move down</button>' : '') +
      (re.supersetGroup ? '<button type="button" class="wk-menu-item" data-rt="ex-link" data-i="' + i + '">Remove from superset</button>' : (i < b.exercises.length - 1 ? '<button type="button" class="wk-menu-item" data-rt="ex-link" data-i="' + i + '">Superset with the next exercise</button>' : '')) +
      '<button type="button" class="wk-menu-item is-danger" data-rt="ex-remove" data-i="' + i + '">Remove from routine</button>');
  }

  function exerciseAction(act, i) {
    const before = builder.b;
    const name = exInfo(before.exercises[i].exerciseId).name;
    kit().closeSheet(true);
    if (act === "ex-up") change(RL.moveExercise(before, i, -1));
    else if (act === "ex-down") change(RL.moveExercise(before, i, 1));
    else if (act === "ex-link") change(RL.toggleSuperset(before, i, WL.makeId("ss")));
    else if (act === "ex-remove") {
      change(RL.removeExercise(before, i));
      builder.errors.sets = {};
      kit().pushUndo("Removed " + name + ".", null, function () { if (builder) { change(before); renderBuilder(); } });
    }
    renderBuilder();
    focusSel("#rtAddEx");
  }

  /* ---- each set (reps and type per set) ---- */

  function setsSheetHtml() {
    const rows = editingSets.sets.map(function (s, k) {
      return '<div class="rt-set-row"><span class="rt-set-n" aria-hidden="true">' + (k + 1) + '</span>' +
        '<div class="rt-set-field"><label class="visually-hidden" for="rtSetReps' + k + '">Set ' + (k + 1) + ' reps</label><input id="rtSetReps' + k + '" class="rt-num" type="number" inputmode="numeric" min="1" max="' + RL.MAX_REPS + '" value="' + s.reps + '" data-rt-set="reps" data-k="' + k + '"></div>' +
        '<div class="rt-set-field"><label class="visually-hidden" for="rtSetType' + k + '">Set ' + (k + 1) + ' type</label><select id="rtSetType' + k + '" data-rt-set="type" data-k="' + k + '">' +
        [["normal", "Normal"], ["warmup", "Warm-up"], ["dropset", "Drop set"]].map(function (t) { return '<option value="' + t[0] + '"' + (s.type === t[0] ? " selected" : "") + '>' + t[1] + '</option>'; }).join("") + '</select></div>' +
        '<button type="button" class="wk-icon-btn" data-rt="set-remove" data-k="' + k + '" aria-label="Remove set ' + (k + 1) + '"' + (editingSets.sets.length <= 1 ? " disabled" : "") + '><span aria-hidden="true">&times;</span></button></div>';
    }).join("");
    return '<div class="rt-set-head" aria-hidden="true"><span></span><span>Reps</span><span>Type</span><span></span></div>' + rows +
      '<button type="button" class="btn btn-secondary wk-big-btn" data-rt="set-add"' + (editingSets.sets.length >= RL.MAX_SETS ? " disabled" : "") + '>+ Add set</button>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-rt="sets-save">Done</button></div>';
  }

  function openSetsSheet(i) {
    kit().closeSheet(true);
    editingSets = { index: i, sets: RL.plannedSetsOf(builder.b.exercises[i]).map(function (s) { return { reps: s.reps, type: s.type }; }) };
    kit().openSheet("Sets: " + exInfo(builder.b.exercises[i].exerciseId).name, '<div id="rtSetsBody">' + setsSheetHtml() + '</div>');
  }
  function redrawSetsSheet(focusSelector) {
    const body = $("rtSetsBody");
    if (!body) return;
    body.innerHTML = setsSheetHtml();
    if (focusSelector) { const f = body.querySelector(focusSelector); if (f) f.focus({ preventScroll: true }); }
  }
  function saveSets() {
    if (!editingSets) return;
    const i = editingSets.index;
    const valid = editingSets.sets.every(function (s) { return Number(s.reps) >= 1; });
    if (!valid) { core().showToast("Every set needs at least 1 rep."); return; }
    change(RL.setPlannedSets(builder.b, i, editingSets.sets));
    delete builder.fromLast[builder.b.exercises[i].exerciseId];
    delete builder.errors.sets[i];
    editingSets = null;
    kit().closeSheet(true);
    renderBuilder();
    focusSel('[data-rt="ex-menu"][data-i="' + i + '"]');
  }

  /* ---- leaving, saving ---- */

  function cancel() {
    if (!RL.isDirty(builder.b)) { closeBuilder(); return; }
    kit().openSheet("Leave without saving?",
      '<p class="wk-sheet-text">What you changed in this routine won\'t be kept.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-wk="sheet-close">Keep editing</button>' +
      '<button type="button" class="btn btn-danger wk-big-btn" data-rt="leave">Leave</button></div>');
  }

  function save() {
    const b = builder.b;
    const v = RL.validate(b, api().getRoutines());
    builder.errors = { name: v.name, exercises: v.exercises, sets: {}, save: null };
    v.sets.forEach(function (s) { builder.errors.sets[s.index] = s.message; });
    if (!v.ok) {
      if (v.name && builder.step === 2) { goStep(1); builder.errors.name = v.name; renderBuilder(); focusSel("#rtName"); }
      else renderBuilder();
      kit().announce(v.name || v.exercises || (v.sets[0] && v.sets[0].message) || "Something needs fixing.");
      if (!v.name) focusSel(v.exercises ? "#rtAddEx" : ".rt-ex.has-error .rt-num, .rt-ex.has-error .btn");
      return;
    }
    let res = RL.applyBuilder(api().getRoutines(), b, { now: now(), id: WL.makeId("routine") });
    let note = "";
    if (!res.ok && res.reason === "missing") {
      res = RL.applyBuilder(api().getRoutines(), Object.assign({}, b, { editId: null }), { now: now(), id: WL.makeId("routine") });
      note = " The routine you were editing had been removed, so this was saved as a new one.";
    }
    if (!res.ok) { builder.errors.save = "Couldn't save this routine."; renderBuilder(); return; }
    if (!api().replaceRoutines(res.routines)) { builder.errors.save = "Your phone wouldn't save it (storage may be full). Nothing was lost. Try again."; renderBuilder(); return; }
    const saved = res.routine;
    builder = null; editingSets = null; clearDraft();
    renderList();
    window.scrollTo(0, 0);
    core().showToast((b.editId && !note ? "Changes saved." : "Routine saved.") + note);
    kit().announce(saved.name + " saved.");
    const card = root().querySelector('[data-rt="start"][data-id="' + saved.id + '"]');
    if (card) card.focus({ preventScroll: true });
  }

  /* ---------------- events ---------------- */

  function onClick(e) {
    const el = e.target.closest("[data-rt]");
    if (!el) return;   // not a click on this screen: leave it (and whatever has focus) alone, the logger handles its own
    const focused = document.activeElement;
    if (focused && focused.matches && focused.matches("input, textarea, select") && !e.target.closest("input, textarea, select")) focused.blur();
    const act = el.getAttribute("data-rt"), id = el.getAttribute("data-id"), i = Number(el.getAttribute("data-i")), day = Number(el.getAttribute("data-day"));
    switch (act) {
      case "new": openBuilder(RL.blankBuilder(), 1); focusSel("#rtName"); break;
      case "start": if (window.JarvisWorkoutUI) window.JarvisWorkoutUI.startRoutine(id); break;
      case "edit": { const r = RL.findById(api().getRoutines(), id); if (r) openBuilder(RL.builderFromRoutine(r), 2); break; }
      case "menu": openMenu(id); break;
      case "duplicate": { const r = RL.findById(api().getRoutines(), id); kit().closeSheet(true); if (r) { openBuilder(RL.builderFromCopy(r, api().getRoutines()), 1); } break; }
      case "days": openDays(id); break;
      case "sheet-day": { const at = sheetDays.indexOf(day); if (at === -1) sheetDays.push(day); else sheetDays.splice(at, 1); el.classList.toggle("is-on", at === -1); el.setAttribute("aria-pressed", String(at === -1)); updateSheetConflict(el.closest(".wk-sheet").querySelector('[data-rt="days-save"]').getAttribute("data-id")); break; }
      case "days-save": saveDays(id); break;
      case "archive": archive(id); break;
      case "restore": restore(id); break;
      case "delete": askDelete(id); break;
      case "delete-confirm": doDelete(id); break;
      case "week-day": openWeekDay(day); break;
      case "day-set": setWeekDay(day, id); break;
      case "draft-continue": { const d = loadDraft(); if (d) openBuilder(d.b, d.step); break; }
      case "draft-discard": clearDraft(); renderList(); break;
      // the builder
      case "cancel": cancel(); break;
      case "leave": kit().closeSheet(true); closeBuilder(); break;
      case "idea": { const name = RL.uniqueName(el.getAttribute("data-value"), api().getRoutines(), "2"); change(RL.setName(builder.b, name)); builder.errors.name = null; renderBuilder(); focusSel('[data-rt="next"]'); break; }
      case "day-toggle": change(RL.toggleDay(builder.b, day)); renderBuilder(); focusSel('[data-rt="day-toggle"][data-day="' + day + '"]'); break;
      case "next": next(); break;
      case "step1": goStep(1); break;
      case "add-ex": openAddPicker(); break;
      case "sets+": stepSet(i, "sets", 1); break;
      case "sets-": stepSet(i, "sets", -1); break;
      case "reps+": stepSet(i, "reps", 1); break;
      case "reps-": stepSet(i, "reps", -1); break;
      case "ex-menu": exerciseMenu(i); break;
      case "ex-up": case "ex-down": case "ex-link": case "ex-remove": exerciseAction(act, i); break;
      case "edit-sets": openSetsSheet(i); break;
      case "set-add": { const last = editingSets.sets[editingSets.sets.length - 1]; editingSets.sets.push({ reps: last ? last.reps : RL.DEFAULT_REPS, type: "normal" }); redrawSetsSheet('[data-rt-set="reps"][data-k="' + (editingSets.sets.length - 1) + '"]'); break; }
      case "set-remove": { const k = Number(el.getAttribute("data-k")); if (editingSets.sets.length > 1) editingSets.sets.splice(k, 1); redrawSetsSheet('[data-rt="set-add"]'); break; }
      case "sets-save": saveSets(); break;
      case "save": save(); break;
      default: break;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.id === "rtName" && builder) {
      change(RL.setName(builder.b, t.value));
      if (builder.errors.name) { builder.errors.name = null; t.removeAttribute("aria-invalid"); const err = $("rtNameErr"); if (err) err.textContent = ""; }
    } else if (t.getAttribute && t.getAttribute("data-rt-num") && builder) {
      typedNumber(t);
    } else if (t.getAttribute && t.getAttribute("data-rt-set") && editingSets) {
      const k = Number(t.getAttribute("data-k"));
      if (t.getAttribute("data-rt-set") === "reps") { const n = Math.round(Number(t.value)); if (t.value !== "" && isFinite(n)) editingSets.sets[k].reps = Math.max(1, Math.min(RL.MAX_REPS, n)); }
      else editingSets.sets[k].type = t.value;
    }
  }

  // When a number box is left, show the value that was actually kept (inside 1..max), without redrawing the screen
  // (a redraw between pressing and releasing a button would swallow the tap).
  function onChange(e) {
    const t = e.target;
    if (builder && t.getAttribute && t.getAttribute("data-rt-num")) {
      const i = Number(t.getAttribute("data-i")), kind = t.getAttribute("data-rt-num");
      const planned = RL.plannedSetsOf(builder.b.exercises[i] || {});
      t.value = kind === "sets" ? planned.length : planned[0].reps;
    } else if (editingSets && t.getAttribute && t.getAttribute("data-rt-set") === "reps") {
      t.value = editingSets.sets[Number(t.getAttribute("data-k"))].reps;
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && builder && e.target.id === "rtName") { e.preventDefault(); next(); }
  }

  /* ---------------- start ---------------- */

  function render() { if (builder) return; renderList(); }

  // If something this screen needs didn't load, show the earlier Routines screen (still in the page) instead of a blank tab.
  function fallBack() {
    const legacy = $("rtLegacy"), mine = root(), gen = $("rtGenerator");
    if (legacy) legacy.hidden = false;
    if (mine) mine.hidden = true;
    if (gen) gen.classList.add("hidden");
  }

  function init() {
    if (started) return;
    if (!RL || !WL || !root() || !window.JarvisWorkout || !window.JarvisWorkout.api || !kit()) { fallBack(); return; }
    started = true;
    const panel = $("panel-workout");
    panel.addEventListener("click", onClick);
    panel.addEventListener("input", onInput);
    panel.addEventListener("change", onChange);
    panel.addEventListener("keydown", onKeyDown);
    document.addEventListener("jarvis-workout-changed", function () { if (!builder && !(document.activeElement && root().contains(document.activeElement) && document.activeElement.matches("input, select, textarea"))) renderList(); });
    const tabBtn = $("workoutSubNavRoutines");
    if (tabBtn) tabBtn.addEventListener("click", function () { window.setTimeout(render, 0); });
    renderList();
  }

  window.JarvisRoutinesUI = { init: init, render: render };
})();
