/* ==========================================================================
   JARVIS — Workout tracker
   localStorage keys:
     jarvisWorkouts        — session log (mixed schema: legacy quick-log
                              entries have no "schema" field; new structured
                              sessions have schema: 2)
     jarvisRoutines        — saved routines (named exercise lists)
     jarvisBodyweight      — body weight history
     jarvisStrengthSettings — which published standards to compare against
     jarvisWorkoutDraft    — in-progress (unsaved) session, so a refresh
                              mid-log doesn't lose data
   ========================================================================== */

(function () {
  "use strict";

  const LS_WORKOUTS = "jarvisWorkouts";
  const LS_ROUTINES = "jarvisRoutines";
  const LS_BODYWEIGHT = "jarvisBodyweight";
  const LS_STRENGTH_SETTINGS = "jarvisStrengthSettings";
  const LS_DRAFT = "jarvisWorkoutDraft";

  let workouts = [];
  let routines = [];
  let bodyweightEntries = [];
  let strengthSettings = { compareSex: "male" };
  let draft = null;

  /* ---------------- persistence ---------------- */

  function load() {
    const core = window.JarvisCore;
    workouts = core.loadJSON(LS_WORKOUTS, []);
    if (!Array.isArray(workouts)) workouts = [];

    routines = core.loadJSON(LS_ROUTINES, []);
    if (!Array.isArray(routines)) routines = [];

    bodyweightEntries = core.loadJSON(LS_BODYWEIGHT, []);
    if (!Array.isArray(bodyweightEntries)) bodyweightEntries = [];

    let st = core.loadJSON(LS_STRENGTH_SETTINGS, null);
    if (!st || typeof st !== "object" || ["male", "female", "none"].indexOf(st.compareSex) === -1) {
      st = { compareSex: "male" };
    }
    strengthSettings = st;

    draft = core.loadJSON(LS_DRAFT, null);
    if (!draft || typeof draft !== "object" || !Array.isArray(draft.exercises)) {
      draft = { dateTime: core.nowLocalDateTimeInputValue(), routineId: "", notes: "", exercises: [] };
    }
  }

  function saveWorkouts() { window.JarvisCore.saveJSON(LS_WORKOUTS, workouts); }
  function saveRoutines() { window.JarvisCore.saveJSON(LS_ROUTINES, routines); }
  function saveBodyweight() { window.JarvisCore.saveJSON(LS_BODYWEIGHT, bodyweightEntries); }
  function saveStrengthSettings() { window.JarvisCore.saveJSON(LS_STRENGTH_SETTINGS, strengthSettings); }
  function saveDraft() { window.JarvisCore.saveJSON(LS_DRAFT, draft); }

  function isNonNegativeNumber(v) {
    const n = Number(v);
    return isFinite(n) && n >= 0;
  }

  function getMuscleGroupsForExerciseIds(exerciseIds) {
    const set = new Set();
    exerciseIds.forEach(function (id) {
      const ex = window.JarvisExercises.getExerciseById(id);
      if (ex) set.add(ex.muscleGroup);
    });
    return Array.from(set).sort();
  }

  function muscleGroupBadgesHtml(muscleGroups) {
    const core = window.JarvisCore;
    return muscleGroups.map(function (m) { return '<span class="badge badge-neutral">' + core.escapeHtml(m) + '</span>'; }).join("");
  }

  /* ---------------- exercise / routine pickers ---------------- */

  function populateFilterSelect(selectEl, values) {
    const core = window.JarvisCore;
    const current = selectEl.value;
    const optionsHtml = values.map(function (v) {
      return '<option value="' + core.escapeHtml(v) + '">' + core.escapeHtml(v) + '</option>';
    }).join("");
    selectEl.innerHTML = selectEl.options[0].outerHTML + optionsHtml;
    if (values.indexOf(current) !== -1) selectEl.value = current;
  }

  function populateExerciseSelect(selectEl, muscle, equipment) {
    const core = window.JarvisCore;
    const all = window.JarvisExercises.getExercises();
    const filtered = all.filter(function (ex) {
      if (muscle && ex.muscleGroup !== muscle) return false;
      if (equipment && ex.equipment !== equipment) return false;
      return true;
    });
    if (filtered.length === 0) {
      selectEl.innerHTML = '<option value="">No exercises match this filter</option>';
      return;
    }
    const groups = {};
    filtered.forEach(function (ex) {
      if (!groups[ex.muscleGroup]) groups[ex.muscleGroup] = [];
      groups[ex.muscleGroup].push(ex);
    });
    const groupNames = Object.keys(groups).sort();
    selectEl.innerHTML = groupNames.map(function (g) {
      const opts = groups[g].map(function (ex) {
        return '<option value="' + core.escapeHtml(ex.id) + '">' + core.escapeHtml(ex.name) + " (" + core.escapeHtml(ex.equipment) + ")</option>";
      }).join("");
      return '<optgroup label="' + core.escapeHtml(g) + '">' + opts + "</optgroup>";
    }).join("");
  }

  function initPickers() {
    const JE = window.JarvisExercises;
    populateFilterSelect(document.getElementById("exercisePickerMuscleFilter"), JE.MUSCLE_GROUPS);
    populateFilterSelect(document.getElementById("exercisePickerEquipmentFilter"), JE.EQUIPMENT_TYPES);
    populateFilterSelect(document.getElementById("routinePickerMuscleFilter"), JE.MUSCLE_GROUPS);
    populateFilterSelect(document.getElementById("routinePickerEquipmentFilter"), JE.EQUIPMENT_TYPES);
    refreshExercisePicker();
    refreshRoutinePicker();
  }

  function refreshExercisePicker() {
    populateExerciseSelect(
      document.getElementById("exercisePickerSelect"),
      document.getElementById("exercisePickerMuscleFilter").value,
      document.getElementById("exercisePickerEquipmentFilter").value
    );
  }

  function refreshRoutinePicker() {
    populateExerciseSelect(
      document.getElementById("routinePickerSelect"),
      document.getElementById("routinePickerMuscleFilter").value,
      document.getElementById("routinePickerEquipmentFilter").value
    );
  }

  function populateRoutineSelect() {
    const core = window.JarvisCore;
    const sel = document.getElementById("sessionRoutineSelect");
    const current = sel.value;
    sel.innerHTML = '<option value="">Freestyle (no routine)</option>' +
      routines.map(function (r) { return '<option value="' + core.escapeHtml(r.id) + '">' + core.escapeHtml(r.name) + "</option>"; }).join("");
    if (routines.some(function (r) { return r.id === current; })) sel.value = current;
  }

  function switchToWorkoutSubTab(targetId) {
    const btn = document.querySelector('.workout-sub-nav-btn[data-subtarget="' + targetId + '"]');
    if (btn) btn.click();
  }

  /* ---------------- draft session (Log tab) ---------------- */

  function renderSessionExerciseList() {
    const core = window.JarvisCore;
    const container = document.getElementById("sessionExerciseList");
    const muscleGroupsEl = document.getElementById("sessionMuscleGroups");
    const musclesTrained = getMuscleGroupsForExerciseIds(draft.exercises.map(function (se) { return se.exerciseId; }));
    muscleGroupsEl.innerHTML = muscleGroupBadgesHtml(musclesTrained);
    if (draft.exercises.length === 0) {
      container.innerHTML = '<div class="empty-state">No exercises added yet. Add one above to start logging sets.</div>';
      return;
    }
    container.innerHTML = draft.exercises.map(function (se) {
      const ex = window.JarvisExercises.getExerciseById(se.exerciseId);
      const exName = ex ? ex.name : "Unknown exercise";
      const muscle = ex ? ex.muscleGroup : "";
      const setsHtml = se.sets.length === 0
        ? '<div class="field-hint">No sets yet.</div>'
        : se.sets.map(function (s, i) {
            return '<div class="set-row"><span>Set ' + (i + 1) + ': ' + core.escapeHtml(s.weight) + ' &times; ' + core.escapeHtml(s.reps) + '</span>' +
              '<button type="button" class="btn-icon danger remove-set-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" data-set-index="' + i + '" aria-label="Remove set">&times;</button></div>';
          }).join("");
      const pr = getExercisePrAndE1rm(se.exerciseId);
      const prHint = pr.bestSet
        ? '<span class="list-item-meta">PR: ' + core.escapeHtml(pr.bestSet.weight) + ' &times; ' + core.escapeHtml(pr.bestSet.reps) + ' &middot; Est. 1RM: ' + Math.round(pr.bestE1rm) + '</span>'
        : '<span class="list-item-meta">No previous sets logged for this exercise yet.</span>';
      return (
        '<div class="list-item session-exercise-block" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(exName) + ' <span class="badge badge-neutral">' + core.escapeHtml(muscle) + '</span></span>' +
              prHint +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger remove-session-exercise-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">Remove Exercise</button>' +
            '</div>' +
          '</div>' +
          '<div class="set-rows">' + setsHtml + '</div>' +
          '<div class="add-set-row" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">' +
            '<input type="number" class="add-set-weight-input" min="0" step="0.5" placeholder="Weight" aria-label="Weight for ' + core.escapeHtml(exName) + '">' +
            '<input type="number" class="add-set-reps-input" min="1" step="1" placeholder="Reps" aria-label="Reps for ' + core.escapeHtml(exName) + '">' +
            '<button type="button" class="btn btn-secondary add-set-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">Add Set</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function loadRoutineIntoDraft(routineId) {
    const routine = routines.find(function (r) { return r.id === routineId; });
    if (!routine) return;
    const core = window.JarvisCore;
    const existingIds = draft.exercises.map(function (se) { return se.exerciseId; });
    routine.exercises.forEach(function (re) {
      if (existingIds.indexOf(re.exerciseId) === -1) {
        draft.exercises.push({ sessionExId: core.uid("sesx"), exerciseId: re.exerciseId, sets: [] });
      }
    });
    draft.routineId = routineId;
    saveDraft();
    renderSessionExerciseList();
  }

  function handleAddExerciseToSession() {
    const core = window.JarvisCore;
    const exerciseId = document.getElementById("exercisePickerSelect").value;
    if (!exerciseId) { core.showToast("Choose an exercise first."); return; }
    draft.exercises.push({ sessionExId: core.uid("sesx"), exerciseId: exerciseId, sets: [] });
    saveDraft();
    renderSessionExerciseList();
  }

  function handleSessionExerciseListClick(e) {
    const core = window.JarvisCore;

    const addSetBtn = e.target.closest(".add-set-btn");
    if (addSetBtn) {
      const row = addSetBtn.closest(".add-set-row");
      const weightInput = row.querySelector(".add-set-weight-input");
      const repsInput = row.querySelector(".add-set-reps-input");
      const weight = Number(weightInput.value);
      const reps = Number(repsInput.value);
      if (!isNonNegativeNumber(weight)) { core.showToast("Weight can't be negative."); return; }
      if (!core.isPositiveNumber(reps)) { core.showToast("Reps must be a positive number."); return; }
      const sessionExId = addSetBtn.getAttribute("data-session-ex-id");
      const se = draft.exercises.find(function (x) { return x.sessionExId === sessionExId; });
      if (!se) return;
      se.sets.push({ weight: weight, reps: Math.round(reps) });
      saveDraft();
      renderSessionExerciseList();
      return;
    }

    const removeSetBtn = e.target.closest(".remove-set-btn");
    if (removeSetBtn) {
      const sessionExId = removeSetBtn.getAttribute("data-session-ex-id");
      const setIndex = Number(removeSetBtn.getAttribute("data-set-index"));
      const se = draft.exercises.find(function (x) { return x.sessionExId === sessionExId; });
      if (!se) return;
      se.sets.splice(setIndex, 1);
      saveDraft();
      renderSessionExerciseList();
      return;
    }

    const removeExBtn = e.target.closest(".remove-session-exercise-btn");
    if (removeExBtn) {
      const sessionExId = removeExBtn.getAttribute("data-session-ex-id");
      draft.exercises = draft.exercises.filter(function (x) { return x.sessionExId !== sessionExId; });
      saveDraft();
      renderSessionExerciseList();
    }
  }

  function resetDraft() {
    draft = { dateTime: window.JarvisCore.nowLocalDateTimeInputValue(), routineId: "", notes: "", exercises: [] };
    saveDraft();
    document.getElementById("sessionRoutineSelect").value = "";
    document.getElementById("sessionDateTime").value = draft.dateTime;
    document.getElementById("sessionNotes").value = "";
    renderSessionExerciseList();
  }

  function handleSaveWorkout() {
    const core = window.JarvisCore;
    const withSets = draft.exercises.filter(function (se) { return se.sets.length > 0; });
    if (withSets.length === 0) {
      core.showToast("Add at least one set before saving.");
      return;
    }
    const dateTime = document.getElementById("sessionDateTime").value || core.nowLocalDateTimeInputValue();
    const session = {
      id: core.uid("workout"),
      schema: 2,
      dateTime: dateTime,
      date: dateTime.slice(0, 10),
      routineId: draft.routineId || null,
      notes: document.getElementById("sessionNotes").value.trim(),
      exercises: withSets.map(function (se) { return { exerciseId: se.exerciseId, sets: se.sets.slice() }; }),
      createdAt: Date.now()
    };
    workouts.push(session);
    saveWorkouts();
    resetDraft();
    renderAll();
    core.showToast("Workout saved.");
  }

  function handleDiscardDraft() {
    resetDraft();
    window.JarvisCore.showToast("Draft cleared.");
  }

  /* ---------------- stats & history ---------------- */

  function dayStreak() {
    if (workouts.length === 0) return 0;
    const dates = new Set(workouts.map(function (w) { return w.date; }));
    let streak = 0;
    let cursor = new Date();
    for (;;) {
      const tzOffset = cursor.getTimezoneOffset() * 60000;
      const iso = new Date(cursor.getTime() - tzOffset).toISOString().slice(0, 10);
      if (dates.has(iso)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function thisWeekCount() {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return workouts.filter(function (w) {
      const d = new Date(w.date);
      return !isNaN(d.getTime()) && d >= start;
    }).length;
  }

  function renderStats() {
    document.getElementById("workoutStatTotal").textContent = workouts.length;
    document.getElementById("workoutStatWeek").textContent = thisWeekCount();
    document.getElementById("workoutStatStreak").textContent = dayStreak();
  }

  function bestSetOf(sets) {
    return sets.reduce(function (best, s) {
      if (!best) return s;
      if (s.weight > best.weight) return s;
      if (s.weight === best.weight && s.reps > best.reps) return s;
      return best;
    }, null);
  }

  // All-time best set (PR) and best estimated 1RM for a given exercise, across every logged session.
  function getExercisePrAndE1rm(exerciseId) {
    const JE = window.JarvisExercises;
    let bestSet = null;
    let bestE1rm = 0;
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      const se = w.exercises.find(function (x) { return x.exerciseId === exerciseId; });
      if (!se) return;
      se.sets.forEach(function (s) {
        if (!bestSet || s.weight > bestSet.weight || (s.weight === bestSet.weight && s.reps > bestSet.reps)) bestSet = s;
        const e1rm = JE.estimateOneRepMax(s.weight, s.reps);
        if (e1rm > bestE1rm) bestE1rm = e1rm;
      });
    });
    return { bestSet: bestSet, bestE1rm: bestE1rm };
  }

  function renderExercisePrList() {
    const core = window.JarvisCore;
    const JE = window.JarvisExercises;
    const container = document.getElementById("exercisePrList");
    const loggedIds = new Set();
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      w.exercises.forEach(function (se) { if (se.sets.length > 0) loggedIds.add(se.exerciseId); });
    });
    if (loggedIds.size === 0) {
      container.innerHTML = '<div class="empty-state">Log some sets to see your PRs and estimated 1-rep max here.</div>';
      return;
    }
    const exercises = Array.from(loggedIds).map(function (id) { return JE.getExerciseById(id); }).filter(Boolean);
    exercises.sort(function (a, b) { return a.name.localeCompare(b.name); });
    container.innerHTML = exercises.map(function (ex) {
      const pr = getExercisePrAndE1rm(ex.id);
      const prText = pr.bestSet ? (core.escapeHtml(pr.bestSet.weight) + " &times; " + core.escapeHtml(pr.bestSet.reps)) : "--";
      const e1rmText = pr.bestE1rm > 0 ? Math.round(pr.bestE1rm) : "--";
      return (
        '<div class="list-item">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(ex.name) + ' <span class="badge badge-neutral">' + core.escapeHtml(ex.muscleGroup) + '</span></span>' +
              '<span class="list-item-meta">PR: ' + prText + ' &middot; Est. 1RM: ' + e1rmText + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderWorkoutList() {
    const core = window.JarvisCore;
    const container = document.getElementById("workoutList");
    if (workouts.length === 0) {
      container.innerHTML = '<div class="empty-state">No workouts logged yet. Add your first session above.</div>';
      return;
    }
    const sorted = workouts.slice().sort(function (a, b) {
      return new Date(b.dateTime || b.date) - new Date(a.dateTime || a.date) || (b.createdAt || 0) - (a.createdAt || 0);
    });
    container.innerHTML = sorted.map(function (w) {
      if (w.schema === 2) {
        const routine = w.routineId ? routines.find(function (r) { return r.id === w.routineId; }) : null;
        const title = routine ? routine.name : "Freestyle Workout";
        const musclesTrained = getMuscleGroupsForExerciseIds(w.exercises.map(function (se) { return se.exerciseId; }));
        const exerciseLines = w.exercises.map(function (se) {
          const ex = window.JarvisExercises.getExerciseById(se.exerciseId);
          const exName = ex ? ex.name : "Unknown exercise";
          const best = bestSetOf(se.sets);
          const bestText = best ? (best.weight + " &times; " + best.reps) : "";
          return '<span class="list-item-meta">' + core.escapeHtml(exName) + ": " + se.sets.length + " set" + (se.sets.length === 1 ? "" : "s") +
            (bestText ? " &middot; best " + bestText : "") + "</span>";
        }).join("");
        return (
          '<div class="list-item" data-id="' + core.escapeHtml(w.id) + '">' +
            '<div class="list-item-row">' +
              '<div class="list-item-main">' +
                '<span class="list-item-title">' + core.escapeHtml(title) + '</span>' +
                '<span class="list-item-meta">' + core.formatDateTime(w.dateTime || w.date) + '</span>' +
                '<div class="badge-row">' + muscleGroupBadgesHtml(musclesTrained) + '</div>' +
                exerciseLines +
                (w.notes ? '<span class="list-item-meta">Notes: ' + core.escapeHtml(w.notes) + '</span>' : '') +
              '</div>' +
              '<div class="list-item-actions">' +
                '<button type="button" class="btn-icon danger workout-delete-btn" data-id="' + core.escapeHtml(w.id) + '">Delete</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }
      const durationText = w.duration ? core.escapeHtml(w.duration) + " min" : "";
      const notesText = w.notes ? " — " + core.escapeHtml(w.notes) : "";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(w.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(w.name) + ' <span class="badge badge-neutral">' + core.escapeHtml(w.category) + '</span></span>' +
              '<span class="list-item-meta">' + core.formatDate(w.date) + (durationText ? " &middot; " + durationText : "") + notesText + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger workout-delete-btn" data-id="' + core.escapeHtml(w.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleWorkoutListClick(e) {
    const btn = e.target.closest(".workout-delete-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    workouts = workouts.filter(function (w) { return w.id !== id; });
    saveWorkouts();
    renderAll();
  }

  /* ---------------- routines ---------------- */

  let routineBuilder = { editId: null, exercises: [] };

  function renderRoutineBuilderList() {
    const core = window.JarvisCore;
    const container = document.getElementById("routineBuilderList");
    const muscleGroupsEl = document.getElementById("routineBuilderMuscleGroups");
    const musclesTrained = getMuscleGroupsForExerciseIds(routineBuilder.exercises.map(function (re) { return re.exerciseId; }));
    muscleGroupsEl.innerHTML = muscleGroupBadgesHtml(musclesTrained);
    if (routineBuilder.exercises.length === 0) {
      container.innerHTML = '<div class="empty-state">No exercises added to this routine yet.</div>';
      return;
    }
    container.innerHTML = routineBuilder.exercises.map(function (re, i) {
      const ex = window.JarvisExercises.getExerciseById(re.exerciseId);
      const exName = ex ? ex.name : "Unknown exercise";
      return (
        '<div class="list-item">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(exName) + '</span>' +
              '<span class="list-item-meta">' + core.escapeHtml(re.targetSets) + ' sets &times; ' + core.escapeHtml(re.targetReps) + ' reps</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger routine-builder-remove-btn" data-index="' + i + '">Remove</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleAddExerciseToRoutine() {
    const core = window.JarvisCore;
    const exerciseId = document.getElementById("routinePickerSelect").value;
    const targetSets = Number(document.getElementById("routineTargetSets").value);
    const targetReps = Number(document.getElementById("routineTargetReps").value);
    if (!exerciseId) { core.showToast("Choose an exercise first."); return; }
    if (!core.isPositiveNumber(targetSets)) { core.showToast("Target sets must be a positive number."); return; }
    if (!core.isPositiveNumber(targetReps)) { core.showToast("Target reps must be a positive number."); return; }
    routineBuilder.exercises.push({ exerciseId: exerciseId, targetSets: Math.round(targetSets), targetReps: Math.round(targetReps) });
    renderRoutineBuilderList();
  }

  function handleRoutineBuilderListClick(e) {
    const btn = e.target.closest(".routine-builder-remove-btn");
    if (!btn) return;
    const index = Number(btn.getAttribute("data-index"));
    routineBuilder.exercises.splice(index, 1);
    renderRoutineBuilderList();
  }

  function exitRoutineEditMode() {
    routineBuilder = { editId: null, exercises: [] };
    document.getElementById("routineEditId").value = "";
    document.getElementById("routineNameInput").value = "";
    document.getElementById("routineFormTitle").textContent = "Create a Routine";
    document.getElementById("saveRoutineBtn").textContent = "Save Routine";
    document.getElementById("routineCancelEditBtn").classList.add("hidden");
    renderRoutineBuilderList();
  }

  function enterRoutineEditMode(routine) {
    routineBuilder = { editId: routine.id, exercises: routine.exercises.map(function (e) { return Object.assign({}, e); }) };
    document.getElementById("routineEditId").value = routine.id;
    document.getElementById("routineNameInput").value = routine.name;
    document.getElementById("routineFormTitle").textContent = "Edit Routine";
    document.getElementById("saveRoutineBtn").textContent = "Update Routine";
    document.getElementById("routineCancelEditBtn").classList.remove("hidden");
    renderRoutineBuilderList();
    document.getElementById("routineFormTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSaveRoutine() {
    const core = window.JarvisCore;
    const name = document.getElementById("routineNameInput").value.trim();
    if (!name) { core.showToast("Give this routine a name."); return; }
    if (routineBuilder.exercises.length === 0) { core.showToast("Add at least one exercise."); return; }

    if (routineBuilder.editId) {
      const existing = routines.find(function (r) { return r.id === routineBuilder.editId; });
      if (existing) {
        existing.name = name;
        existing.exercises = routineBuilder.exercises.slice();
      }
      core.showToast("Routine updated.");
    } else {
      routines.push({ id: core.uid("routine"), name: name, exercises: routineBuilder.exercises.slice(), createdAt: Date.now() });
      core.showToast("Routine saved.");
    }
    saveRoutines();
    exitRoutineEditMode();
    renderRoutineList();
    populateRoutineSelect();
  }

  function renderRoutineList() {
    const core = window.JarvisCore;
    const container = document.getElementById("routineList");
    if (routines.length === 0) {
      container.innerHTML = '<div class="empty-state">No routines yet. Build one above.</div>';
      return;
    }
    container.innerHTML = routines.map(function (r) {
      const exLines = r.exercises.map(function (re) {
        const ex = window.JarvisExercises.getExerciseById(re.exerciseId);
        const exName = ex ? ex.name : "Unknown exercise";
        return '<span class="list-item-meta">' + core.escapeHtml(exName) + ": " + core.escapeHtml(re.targetSets) + " &times; " + core.escapeHtml(re.targetReps) + '</span>';
      }).join("");
      const musclesTrained = getMuscleGroupsForExerciseIds(r.exercises.map(function (re) { return re.exerciseId; }));
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(r.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(r.name) + ' <span class="badge badge-neutral">' + r.exercises.length + ' exercise' + (r.exercises.length === 1 ? "" : "s") + '</span></span>' +
              '<div class="badge-row">' + muscleGroupBadgesHtml(musclesTrained) + '</div>' +
              exLines +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon routine-start-btn" data-id="' + core.escapeHtml(r.id) + '">Log This</button>' +
              '<button type="button" class="btn-icon routine-edit-btn" data-id="' + core.escapeHtml(r.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger routine-delete-btn" data-id="' + core.escapeHtml(r.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleRoutineListClick(e) {
    const startBtn = e.target.closest(".routine-start-btn");
    if (startBtn) {
      const id = startBtn.getAttribute("data-id");
      document.getElementById("sessionRoutineSelect").value = id;
      loadRoutineIntoDraft(id);
      switchToWorkoutSubTab("workout-log");
      return;
    }
    const editBtn = e.target.closest(".routine-edit-btn");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      const routine = routines.find(function (r) { return r.id === id; });
      if (routine) enterRoutineEditMode(routine);
      return;
    }
    const delBtn = e.target.closest(".routine-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      routines = routines.filter(function (r) { return r.id !== id; });
      saveRoutines();
      renderRoutineList();
      populateRoutineSelect();
    }
  }

  /* ---------------- body weight ---------------- */

  function toLb(weight, unit) {
    return unit === "kg" ? weight * 2.20462 : weight;
  }

  function getMostRecentBodyweightLb() {
    if (bodyweightEntries.length === 0) return null;
    const sorted = bodyweightEntries.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    return toLb(sorted[0].weight, sorted[0].unit);
  }

  function getBodyweightLbAsOf(dateStr) {
    if (bodyweightEntries.length === 0) return null;
    const sorted = bodyweightEntries.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    let candidate = null;
    for (let i = 0; i < sorted.length; i++) {
      if (new Date(sorted[i].date) <= new Date(dateStr)) candidate = sorted[i];
      else break;
    }
    if (!candidate) candidate = sorted[0];
    return toLb(candidate.weight, candidate.unit);
  }

  function renderBodyweightList() {
    const core = window.JarvisCore;
    const container = document.getElementById("bodyweightList");
    if (bodyweightEntries.length === 0) {
      container.innerHTML = '<div class="empty-state">No body weight logged yet.</div>';
      return;
    }
    const sorted = bodyweightEntries.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    container.innerHTML = sorted.map(function (e) {
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(e.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(e.weight) + ' ' + core.escapeHtml(e.unit) + '</span>' +
              '<span class="list-item-meta">' + core.formatDate(e.date) + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger bodyweight-delete-btn" data-id="' + core.escapeHtml(e.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleBodyweightSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const weight = Number(document.getElementById("bodyweightInput").value);
    const unit = document.getElementById("bodyweightUnit").value;
    const date = document.getElementById("bodyweightDate").value || core.todayISODate();
    if (!core.isPositiveNumber(weight)) { core.showToast("Weight must be a positive number."); return; }
    bodyweightEntries.push({ id: core.uid("bw"), weight: weight, unit: unit, date: date, createdAt: Date.now() });
    saveBodyweight();
    renderBodyweightList();
    renderStrengthSection();
    renderProgressTab();
    document.getElementById("bodyweightForm").reset();
    document.getElementById("bodyweightDate").value = "";
    document.getElementById("bodyweightUnit").value = unit;
    core.showToast("Body weight logged.");
  }

  function handleBodyweightListClick(e) {
    const btn = e.target.closest(".bodyweight-delete-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    bodyweightEntries = bodyweightEntries.filter(function (x) { return x.id !== id; });
    saveBodyweight();
    renderBodyweightList();
    renderStrengthSection();
    renderProgressTab();
  }

  /* ---------------- strength score ---------------- */

  function setsForBenchmark(benchmarkKey, cutoffDate) {
    const results = [];
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      if (cutoffDate && new Date(w.date) > new Date(cutoffDate)) return;
      w.exercises.forEach(function (se) {
        const ex = window.JarvisExercises.getExerciseById(se.exerciseId);
        if (ex && ex.benchmarkKey === benchmarkKey) {
          se.sets.forEach(function (s) { results.push({ set: s, date: w.date }); });
        }
      });
    });
    return results;
  }

  function bestE1rmForBenchmark(benchmarkKey, cutoffDate) {
    const JE = window.JarvisExercises;
    const entries = setsForBenchmark(benchmarkKey, cutoffDate);
    let best = 0;
    entries.forEach(function (entry) {
      let loadWeight = entry.set.weight;
      if (benchmarkKey === "pullup") {
        const bwLb = getBodyweightLbAsOf(entry.date);
        if (bwLb === null) return;
        loadWeight = bwLb + entry.set.weight; // set.weight = added weight for pull-ups
      }
      const e1rm = JE.estimateOneRepMax(loadWeight, entry.set.reps);
      if (e1rm > best) best = e1rm;
    });
    return best;
  }

  function computeStrengthBreakdown(cutoffDate) {
    const JE = window.JarvisExercises;
    const bodyweightLb = cutoffDate ? getBodyweightLbAsOf(cutoffDate) : getMostRecentBodyweightLb();
    if (bodyweightLb === null) return null;

    const benchmarks = JE.getBenchmarkExercises();
    const seenKeys = [];
    const breakdown = [];
    benchmarks.forEach(function (ex) {
      if (seenKeys.indexOf(ex.benchmarkKey) !== -1) return;
      seenKeys.push(ex.benchmarkKey);
      const bestE1rm = bestE1rmForBenchmark(ex.benchmarkKey, cutoffDate);
      if (bestE1rm <= 0) {
        breakdown.push({ benchmarkKey: ex.benchmarkKey, label: ex.name, hasData: false });
        return;
      }
      const ratio = bestE1rm / bodyweightLb;
      let score = null, level = null;
      if (strengthSettings.compareSex !== "none") {
        const standard = JE.getStandard(ex.benchmarkKey, strengthSettings.compareSex);
        if (standard) {
          const result = JE.scoreForRatio(ratio, standard.thresholds);
          score = result.score;
          level = result.level;
        }
      }
      breakdown.push({ benchmarkKey: ex.benchmarkKey, label: ex.name, hasData: true, bestE1rm: bestE1rm, ratio: ratio, score: score, level: level });
    });

    const scored = breakdown.filter(function (b) { return b.hasData && b.score !== null; });
    const overallScore = scored.length ? scored.reduce(function (s, b) { return s + b.score; }, 0) / scored.length : null;
    return { breakdown: breakdown, overallScore: overallScore, bodyweightLb: bodyweightLb };
  }

  function renderStrengthSection() {
    const core = window.JarvisCore;
    document.getElementById("strengthCompareSelect").value = strengthSettings.compareSex;

    const result = computeStrengthBreakdown(null);
    const scoreEl = document.getElementById("overallStrengthScore");
    const levelEl = document.getElementById("overallStrengthLevel");
    const listEl = document.getElementById("strengthBreakdownList");

    if (!result) {
      scoreEl.textContent = "--";
      levelEl.textContent = "Log your body weight to see your Strength Score.";
      listEl.innerHTML = '<div class="empty-state">Log a benchmark lift (Squat, Bench, Deadlift, Overhead Press, or Pull-Up) and your body weight.</div>';
      return;
    }

    if (strengthSettings.compareSex === "none") {
      scoreEl.textContent = "--";
      levelEl.textContent = "Standards comparison is off. Showing your best estimated 1-rep max per lift instead.";
    } else if (result.overallScore === null) {
      scoreEl.textContent = "--";
      levelEl.textContent = "Log a benchmark lift to see your score.";
    } else {
      scoreEl.textContent = Math.round(result.overallScore);
      levelEl.textContent = "Overall score across logged benchmark lifts";
    }

    if (result.breakdown.every(function (b) { return !b.hasData; })) {
      listEl.innerHTML = '<div class="empty-state">Log a benchmark lift (Squat, Bench, Deadlift, Overhead Press, or Pull-Up) to see a breakdown.</div>';
      return;
    }

    listEl.innerHTML = result.breakdown.map(function (b) {
      if (!b.hasData) {
        return (
          '<div class="list-item">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(b.label) + '</span>' +
              '<span class="list-item-meta">Not logged yet</span>' +
            '</div>' +
          '</div>'
        );
      }
      const e1rmText = Math.round(b.bestE1rm) + " lb est. 1RM";
      if (b.score === null) {
        return (
          '<div class="list-item">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(b.label) + '</span>' +
              '<span class="list-item-meta">' + e1rmText + '</span>' +
            '</div>' +
          '</div>'
        );
      }
      return (
        '<div class="list-item">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(b.label) + ' <span class="badge badge-neutral">' + core.escapeHtml(b.level || "Below Beginner") + '</span></span>' +
            '<span class="list-item-meta">' + e1rmText + ' &middot; ' + b.ratio.toFixed(2) + '&times; body weight</span>' +
            '<div class="strength-progress-track"><div class="strength-progress-fill" style="width:' + Math.round(b.score) + '%"></div></div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleStrengthSettingsSubmit(e) {
    e.preventDefault();
    strengthSettings.compareSex = document.getElementById("strengthCompareSelect").value;
    saveStrengthSettings();
    renderStrengthSection();
    renderProgressTab();
    window.JarvisCore.showToast("Strength settings saved.");
  }

  /* ---------------- charts ---------------- */

  function renderLineChart(containerId, points, opts) {
    const core = window.JarvisCore;
    const container = document.getElementById(containerId);
    if (!points || points.length < 2) {
      container.innerHTML = '<div class="empty-state">' + (opts.emptyMessage || "Not enough data yet.") + '</div>';
      return;
    }
    const width = 640, height = 220;
    const padding = { top: 16, right: 16, bottom: 24, left: 44 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;
    const xs = points.map(function (p) { return p.t; });
    const ys = points.map(function (p) { return p.v; });
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const maxY = Math.max.apply(null, ys) * 1.15 || 1;

    function xPos(t) { return padding.left + (maxX === minX ? plotW / 2 : ((t - minX) / (maxX - minX)) * plotW); }
    function yPos(v) { return padding.top + plotH - (v / maxY) * plotH; }

    const pathD = points.map(function (p, i) { return (i === 0 ? "M" : "L") + xPos(p.t).toFixed(1) + "," + yPos(p.v).toFixed(1); }).join(" ");
    const circles = points.map(function (p) {
      const label = core.escapeHtml(p.label) + ": " + core.escapeHtml(opts.yFormat ? opts.yFormat(p.v) : p.v);
      return '<circle cx="' + xPos(p.t).toFixed(1) + '" cy="' + yPos(p.v).toFixed(1) + '" r="4" fill="var(--accent)"><title>' + label + '</title></circle>';
    }).join("");

    const gridY0 = yPos(0), gridY1 = yPos(maxY);
    const gridLines =
      '<line x1="' + padding.left + '" y1="' + gridY0.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + gridY0.toFixed(1) + '" stroke="var(--card-border)" stroke-width="1"/>' +
      '<text x="4" y="' + (gridY0 + 4).toFixed(1) + '" font-size="10" fill="var(--text-faint)">0</text>' +
      '<text x="4" y="' + (gridY1 + 10).toFixed(1) + '" font-size="10" fill="var(--text-faint)">' + core.escapeHtml(opts.yFormat ? opts.yFormat(maxY) : Math.round(maxY)) + '</text>';

    container.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" class="progress-chart-svg" role="img" aria-label="' + core.escapeHtml(opts.ariaLabel || "progress chart") + '">' +
        gridLines +
        '<path d="' + pathD + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        circles +
      '</svg>';
  }

  function populateProgressExerciseSelect() {
    const core = window.JarvisCore;
    const loggedIds = new Set();
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      w.exercises.forEach(function (se) { if (se.sets.length > 0) loggedIds.add(se.exerciseId); });
    });
    const sel = document.getElementById("progressExerciseSelect");
    const current = sel.value;
    if (loggedIds.size === 0) {
      sel.innerHTML = '<option value="">Log some sets to see progress</option>';
      return;
    }
    const exercises = Array.from(loggedIds).map(function (id) { return window.JarvisExercises.getExerciseById(id); }).filter(Boolean);
    exercises.sort(function (a, b) { return a.name.localeCompare(b.name); });
    sel.innerHTML = exercises.map(function (ex) { return '<option value="' + core.escapeHtml(ex.id) + '">' + core.escapeHtml(ex.name) + '</option>'; }).join("");
    if (loggedIds.has(current)) sel.value = current;
  }

  function renderExerciseProgressChart() {
    const core = window.JarvisCore;
    const JE = window.JarvisExercises;
    const exerciseId = document.getElementById("progressExerciseSelect").value;
    const currentEl = document.getElementById("progressCurrentE1rm");
    const prEl = document.getElementById("progressAllTimePr");
    const countEl = document.getElementById("progressSessionCount");

    if (!exerciseId) {
      currentEl.textContent = "--";
      prEl.textContent = "--";
      countEl.textContent = "0";
      renderLineChart("exerciseProgressChart", [], { emptyMessage: "Log a couple of sessions for this exercise to see a trend line." });
      return;
    }

    const points = [];
    let allTimeBest = null;
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      const se = w.exercises.find(function (x) { return x.exerciseId === exerciseId; });
      if (!se || se.sets.length === 0) return;
      let bestE1rmThisSession = 0;
      se.sets.forEach(function (s) {
        const e1rm = JE.estimateOneRepMax(s.weight, s.reps);
        if (e1rm > bestE1rmThisSession) bestE1rmThisSession = e1rm;
        if (!allTimeBest || s.weight > allTimeBest.weight || (s.weight === allTimeBest.weight && s.reps > allTimeBest.reps)) {
          allTimeBest = s;
        }
      });
      points.push({ t: new Date(w.dateTime || w.date).getTime(), v: bestE1rmThisSession, label: core.formatDate(w.date) });
    });
    points.sort(function (a, b) { return a.t - b.t; });

    countEl.textContent = points.length;
    currentEl.textContent = points.length ? Math.round(points[points.length - 1].v) + " lb" : "--";
    prEl.textContent = allTimeBest ? (allTimeBest.weight + " &times; " + allTimeBest.reps) : "--";

    const ex = JE.getExerciseById(exerciseId);
    renderLineChart("exerciseProgressChart", points, {
      emptyMessage: "Log a couple of sessions for this exercise to see a trend line.",
      yFormat: function (v) { return Math.round(v) + " lb"; },
      ariaLabel: "Estimated one rep max trend for " + (ex ? ex.name : "exercise")
    });
  }

  function renderStrengthScoreChart() {
    const core = window.JarvisCore;
    const dateSet = new Set();
    workouts.forEach(function (w) { if (w.schema === 2) dateSet.add(w.date); });
    bodyweightEntries.forEach(function (e) { dateSet.add(e.date); });
    const dates = Array.from(dateSet).sort(function (a, b) { return new Date(a) - new Date(b); });

    const points = [];
    dates.forEach(function (d) {
      const result = computeStrengthBreakdown(d);
      if (result && result.overallScore !== null) {
        points.push({ t: new Date(d).getTime(), v: result.overallScore, label: core.formatDate(d) });
      }
    });

    renderLineChart("strengthScoreChart", points, {
      emptyMessage: "Log benchmark lifts (Squat, Bench, Deadlift, Overhead Press, Pull-Up) and body weight to see this trend.",
      yFormat: function (v) { return Math.round(v); },
      ariaLabel: "Overall strength score trend"
    });
  }

  function renderProgressTab() {
    renderExercisePrList();
    populateProgressExerciseSelect();
    renderExerciseProgressChart();
    renderStrengthScoreChart();
  }

  /* ---------------- render all / init ---------------- */

  function renderAll() {
    renderStats();
    renderWorkoutList();
    renderRoutineList();
    populateRoutineSelect();
    renderBodyweightList();
    renderStrengthSection();
    renderProgressTab();
  }

  function getSummary() {
    const sorted = workouts.slice().sort(function (a, b) { return new Date(b.dateTime || b.date) - new Date(a.dateTime || a.date); });
    const last = sorted[0] || null;
    let lastWorkout = null;
    if (last) {
      let name;
      if (last.schema === 2) {
        const routine = last.routineId ? routines.find(function (r) { return r.id === last.routineId; }) : null;
        if (routine) {
          name = routine.name;
        } else {
          const firstEx = last.exercises[0] ? window.JarvisExercises.getExerciseById(last.exercises[0].exerciseId) : null;
          name = firstEx ? (firstEx.name + (last.exercises.length > 1 ? " + more" : "")) : "Workout";
        }
      } else {
        name = last.name;
      }
      lastWorkout = { name: name, date: last.date };
    }
    return { total: workouts.length, thisWeek: thisWeekCount(), streak: dayStreak(), lastWorkout: lastWorkout };
  }

  function onSubTabChange(targetId) {
    if (targetId === "workout-progress") renderProgressTab();
  }

  function init() {
    load();
    initPickers();

    document.getElementById("sessionDateTime").value = draft.dateTime || window.JarvisCore.nowLocalDateTimeInputValue();
    document.getElementById("sessionNotes").value = draft.notes || "";

    document.getElementById("exercisePickerMuscleFilter").addEventListener("change", refreshExercisePicker);
    document.getElementById("exercisePickerEquipmentFilter").addEventListener("change", refreshExercisePicker);
    document.getElementById("addExerciseToSessionBtn").addEventListener("click", handleAddExerciseToSession);
    document.getElementById("sessionExerciseList").addEventListener("click", handleSessionExerciseListClick);
    document.getElementById("sessionRoutineSelect").addEventListener("change", function () {
      if (this.value) loadRoutineIntoDraft(this.value);
      else { draft.routineId = ""; saveDraft(); }
    });
    document.getElementById("sessionNotes").addEventListener("change", function () { draft.notes = this.value; saveDraft(); });
    document.getElementById("sessionDateTime").addEventListener("change", function () { draft.dateTime = this.value; saveDraft(); });
    document.getElementById("saveWorkoutBtn").addEventListener("click", handleSaveWorkout);
    document.getElementById("discardDraftBtn").addEventListener("click", handleDiscardDraft);
    document.getElementById("workoutList").addEventListener("click", handleWorkoutListClick);

    document.getElementById("routinePickerMuscleFilter").addEventListener("change", refreshRoutinePicker);
    document.getElementById("routinePickerEquipmentFilter").addEventListener("change", refreshRoutinePicker);
    document.getElementById("addExerciseToRoutineBtn").addEventListener("click", handleAddExerciseToRoutine);
    document.getElementById("routineBuilderList").addEventListener("click", handleRoutineBuilderListClick);
    document.getElementById("saveRoutineBtn").addEventListener("click", handleSaveRoutine);
    document.getElementById("routineCancelEditBtn").addEventListener("click", exitRoutineEditMode);
    document.getElementById("routineList").addEventListener("click", handleRoutineListClick);

    document.getElementById("bodyweightForm").addEventListener("submit", handleBodyweightSubmit);
    document.getElementById("bodyweightList").addEventListener("click", handleBodyweightListClick);
    document.getElementById("strengthSettingsForm").addEventListener("submit", handleStrengthSettingsSubmit);

    document.getElementById("progressExerciseSelect").addEventListener("change", renderExerciseProgressChart);

    renderSessionExerciseList();
    renderAll();
  }

  window.JarvisWorkout = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
