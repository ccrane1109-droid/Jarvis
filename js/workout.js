/* ==========================================================================
   JARVIS — Workout tracker
   localStorage keys:
     jarvisWorkouts        — session log (mixed schema: legacy quick-log
                              entries have no "schema" field; new structured
                              sessions have schema: 2)
     jarvisRoutines        — saved routines (named exercise lists)
     jarvisPrograms        — multi-day cycles that reference routines by id
     jarvisBodyweight      — body weight history
     jarvisMeasurements    — body measurement history (waist, arms, etc.)
     jarvisStrengthSettings — which published standards to compare against
     jarvisWorkoutDraft    — in-progress (unsaved) session, so a refresh
                              mid-log doesn't lose data
   ========================================================================== */

(function () {
  "use strict";

  const LS_WORKOUTS = "jarvisWorkouts";
  const LS_ROUTINES = "jarvisRoutines";
  const LS_PROGRAMS = "jarvisPrograms";
  const LS_BODYWEIGHT = "jarvisBodyweight";
  const LS_MEASUREMENTS = "jarvisMeasurements";
  const LS_STRENGTH_SETTINGS = "jarvisStrengthSettings";
  const LS_DRAFT = "jarvisWorkoutDraft";

  let workouts = [];
  let routines = [];
  let programs = [];
  let bodyweightEntries = [];
  let measurements = [];
  let strengthSettings = { compareSex: "male" };
  let draft = null;

  /* ---------------- persistence ---------------- */

  function load() {
    const core = window.JarvisCore;
    workouts = core.loadJSON(LS_WORKOUTS, []);
    if (!Array.isArray(workouts)) workouts = [];

    routines = core.loadJSON(LS_ROUTINES, []);
    if (!Array.isArray(routines)) routines = [];

    programs = core.loadJSON(LS_PROGRAMS, []);
    if (!Array.isArray(programs)) programs = [];

    bodyweightEntries = core.loadJSON(LS_BODYWEIGHT, []);
    if (!Array.isArray(bodyweightEntries)) bodyweightEntries = [];

    measurements = core.loadJSON(LS_MEASUREMENTS, []);
    if (!Array.isArray(measurements)) measurements = [];

    let st = core.loadJSON(LS_STRENGTH_SETTINGS, null);
    if (!st || typeof st !== "object" || ["male", "female", "none"].indexOf(st.compareSex) === -1) {
      st = { compareSex: "male" };
    }
    strengthSettings = st;

    draft = core.loadJSON(LS_DRAFT, null);
    if (!draft || typeof draft !== "object" || !Array.isArray(draft.exercises)) {
      draft = { dateTime: core.nowLocalDateTimeInputValue(), routineId: "", notes: "", exercises: [], programId: "", programDayId: "" };
    }
  }

  function saveWorkouts() { window.JarvisCore.saveJSON(LS_WORKOUTS, workouts); }
  function saveRoutines() { window.JarvisCore.saveJSON(LS_ROUTINES, routines); }
  function savePrograms() { window.JarvisCore.saveJSON(LS_PROGRAMS, programs); }
  function saveBodyweight() { window.JarvisCore.saveJSON(LS_BODYWEIGHT, bodyweightEntries); }
  function saveMeasurements() { window.JarvisCore.saveJSON(LS_MEASUREMENTS, measurements); }
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

  // Like populateFilterSelect, but with no leading "All ..." placeholder option.
  function populateSelectPlain(selectEl, values) {
    const core = window.JarvisCore;
    const current = selectEl.value;
    selectEl.innerHTML = values.map(function (v) {
      return '<option value="' + core.escapeHtml(v) + '">' + core.escapeHtml(v) + '</option>';
    }).join("");
    if (values.indexOf(current) !== -1) selectEl.value = current;
  }

  function populateExerciseSelect(selectEl, muscle, equipment, search) {
    const core = window.JarvisCore;
    const JE = window.JarvisExercises;
    const all = JE.getExercises();
    const searchLower = (search || "").trim().toLowerCase();
    const favoriteIds = JE.loadFavoriteIds();
    const filtered = all.filter(function (ex) {
      if (muscle && ex.muscleGroup !== muscle) return false;
      if (equipment && ex.equipment !== equipment) return false;
      if (searchLower && ex.name.toLowerCase().indexOf(searchLower) === -1) return false;
      return true;
    });
    if (filtered.length === 0) {
      selectEl.innerHTML = '<option value="">No exercises match this filter</option>';
      return;
    }

    function optionHtml(ex) {
      const star = favoriteIds.indexOf(ex.id) !== -1 ? "★ " : "";
      return '<option value="' + core.escapeHtml(ex.id) + '">' + star + core.escapeHtml(ex.name) + " (" + core.escapeHtml(ex.equipment) + ")</option>";
    }

    const favorites = filtered.filter(function (ex) { return favoriteIds.indexOf(ex.id) !== -1; });
    const favoritesGroup = favorites.length
      ? '<optgroup label="★ Favorites">' + favorites.map(optionHtml).join("") + "</optgroup>"
      : "";

    const groups = {};
    filtered.forEach(function (ex) {
      if (!groups[ex.muscleGroup]) groups[ex.muscleGroup] = [];
      groups[ex.muscleGroup].push(ex);
    });
    const groupNames = Object.keys(groups).sort();
    const mainGroups = groupNames.map(function (g) {
      return '<optgroup label="' + core.escapeHtml(g) + '">' + groups[g].map(optionHtml).join("") + "</optgroup>";
    }).join("");

    selectEl.innerHTML = favoritesGroup + mainGroups;
  }

  function initPickers() {
    const JE = window.JarvisExercises;
    populateFilterSelect(document.getElementById("exercisePickerMuscleFilter"), JE.MUSCLE_GROUPS);
    populateFilterSelect(document.getElementById("exercisePickerEquipmentFilter"), JE.EQUIPMENT_TYPES);
    populateFilterSelect(document.getElementById("routinePickerMuscleFilter"), JE.MUSCLE_GROUPS);
    populateFilterSelect(document.getElementById("routinePickerEquipmentFilter"), JE.EQUIPMENT_TYPES);
    populateSelectPlain(document.getElementById("customExerciseMuscle"), JE.MUSCLE_GROUPS);
    populateSelectPlain(document.getElementById("customExerciseEquipment"), JE.EQUIPMENT_TYPES);
    refreshExercisePicker();
    refreshRoutinePicker();
  }

  function refreshExercisePicker() {
    populateExerciseSelect(
      document.getElementById("exercisePickerSelect"),
      document.getElementById("exercisePickerMuscleFilter").value,
      document.getElementById("exercisePickerEquipmentFilter").value,
      document.getElementById("exercisePickerSearch").value
    );
    updateFavoriteStarButton();
  }

  function refreshRoutinePicker() {
    populateExerciseSelect(
      document.getElementById("routinePickerSelect"),
      document.getElementById("routinePickerMuscleFilter").value,
      document.getElementById("routinePickerEquipmentFilter").value,
      document.getElementById("routinePickerSearch").value
    );
  }

  function updateFavoriteStarButton() {
    const btn = document.getElementById("exercisePickerFavoriteBtn");
    const exerciseId = document.getElementById("exercisePickerSelect").value;
    const isFav = exerciseId && window.JarvisExercises.isFavorite(exerciseId);
    btn.textContent = isFav ? "★" : "☆";
    btn.classList.toggle("active", !!isFav);
  }

  function handleToggleFavorite() {
    const exerciseId = document.getElementById("exercisePickerSelect").value;
    if (!exerciseId) return;
    window.JarvisExercises.toggleFavorite(exerciseId);
    const previousSelection = exerciseId;
    refreshExercisePicker();
    const select = document.getElementById("exercisePickerSelect");
    if (Array.prototype.some.call(select.options, function (o) { return o.value === previousSelection; })) {
      select.value = previousSelection;
    }
    updateFavoriteStarButton();
  }

  function handleShowAddCustomExercise() {
    document.getElementById("addCustomExerciseForm").classList.remove("hidden");
    document.getElementById("customExerciseName").focus();
  }

  function handleCancelAddCustomExercise() {
    document.getElementById("addCustomExerciseForm").classList.add("hidden");
    document.getElementById("customExerciseName").value = "";
  }

  function handleSaveCustomExercise() {
    const core = window.JarvisCore;
    const name = document.getElementById("customExerciseName").value.trim();
    const muscleGroup = document.getElementById("customExerciseMuscle").value;
    const equipment = document.getElementById("customExerciseEquipment").value;
    if (!name) { core.showToast("Give the exercise a name."); return; }
    const exercise = window.JarvisExercises.addCustomExercise({ name: name, muscleGroup: muscleGroup, equipment: equipment });
    refreshExercisePicker();
    refreshRoutinePicker();
    document.getElementById("exercisePickerMuscleFilter").value = "";
    document.getElementById("exercisePickerEquipmentFilter").value = "";
    document.getElementById("exercisePickerSearch").value = "";
    refreshExercisePicker();
    document.getElementById("exercisePickerSelect").value = exercise.id;
    handleCancelAddCustomExercise();
    core.showToast("Added “" + name + "” to your exercise library.");
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

  /* ---------------- rest timer (ephemeral, not persisted) ---------------- */

  const REST_TIMER_DEFAULT_SECONDS = 90;
  let restTimers = {}; // sessionExId -> { remaining: seconds, intervalId }

  function formatTimerSeconds(total) {
    const m = Math.floor(total / 60), s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function restTimerHtml(sessionExId) {
    const timer = restTimers[sessionExId];
    const isResting = !!(timer && timer.remaining > 0);
    const display = isResting ? formatTimerSeconds(timer.remaining) : "--:--";
    return (
      '<div class="rest-timer' + (isResting ? " resting" : "") + '" data-session-ex-id="' + sessionExId + '">' +
        "<span>Rest</span><span class=\"rest-timer-value\">" + display + "</span>" +
        '<div class="rest-timer-actions">' +
          '<button type="button" class="btn-icon rest-timer-add30-btn" data-session-ex-id="' + sessionExId + '">+30s</button>' +
          '<button type="button" class="btn-icon rest-timer-skip-btn" data-session-ex-id="' + sessionExId + '">Skip</button>' +
        "</div>" +
      "</div>"
    );
  }

  function findRestTimerEl(sessionExId) {
    return Array.prototype.find.call(document.querySelectorAll(".rest-timer"), function (el) {
      return el.getAttribute("data-session-ex-id") === sessionExId;
    }) || null;
  }

  function updateRestTimerDom(sessionExId, justFinished) {
    const el = findRestTimerEl(sessionExId);
    if (!el) return;
    const valueEl = el.querySelector(".rest-timer-value");
    const t = restTimers[sessionExId];
    if (t && t.remaining > 0) {
      valueEl.textContent = formatTimerSeconds(t.remaining);
      el.classList.add("resting");
    } else {
      valueEl.textContent = justFinished ? "Done" : "--:--";
      el.classList.remove("resting");
    }
  }

  function stopRestTimer(sessionExId) {
    const t = restTimers[sessionExId];
    if (t && t.intervalId) clearInterval(t.intervalId);
    delete restTimers[sessionExId];
  }

  function stopAllRestTimers() {
    Object.keys(restTimers).forEach(stopRestTimer);
  }

  function startRestTimer(sessionExId, seconds) {
    stopRestTimer(sessionExId);
    restTimers[sessionExId] = { remaining: seconds, intervalId: null };
    updateRestTimerDom(sessionExId);
    restTimers[sessionExId].intervalId = setInterval(function () {
      const t = restTimers[sessionExId];
      if (!t) return;
      t.remaining -= 1;
      if (t.remaining <= 0) {
        stopRestTimer(sessionExId);
        updateRestTimerDom(sessionExId, true);
        return;
      }
      updateRestTimerDom(sessionExId);
    }, 1000);
  }

  function handleRestTimerAdd30(sessionExId) {
    const t = restTimers[sessionExId];
    if (t) { t.remaining += 30; updateRestTimerDom(sessionExId); }
    else startRestTimer(sessionExId, 30);
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
            const warmupTag = s.warmup ? ' <span class="badge badge-neutral">warm-up</span>' : '';
            return '<div class="set-row"><span>Set ' + (i + 1) + ': ' + core.escapeHtml(s.weight) + ' &times; ' + core.escapeHtml(s.reps) + warmupTag + '</span>' +
              '<button type="button" class="btn-icon danger remove-set-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" data-set-index="' + i + '" aria-label="Remove set">&times;</button></div>';
          }).join("");
      const pr = getExercisePrAndE1rm(se.exerciseId);
      const prHint = pr.bestSet
        ? '<span class="list-item-meta">PR: ' + core.escapeHtml(pr.bestSet.weight) + ' &times; ' + core.escapeHtml(pr.bestSet.reps) + ' &middot; Est. 1RM: ' + Math.round(pr.bestE1rm) + '</span>'
        : '<span class="list-item-meta">No previous sets logged for this exercise yet.</span>';
      const lastSet = se.sets.length ? se.sets[se.sets.length - 1] : null;
      const prefillWeight = lastSet ? lastSet.weight : "";
      const prefillReps = lastSet ? lastSet.reps : "";
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
          restTimerHtml(se.sessionExId) +
          '<div class="add-set-row" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">' +
            '<div class="stepper-row">' +
              '<button type="button" class="stepper-btn add-set-weight-minus" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" aria-label="Decrease weight">&minus;</button>' +
              '<input type="number" class="add-set-weight-input" min="0" step="0.5" placeholder="Weight" value="' + core.escapeHtml(prefillWeight) + '" aria-label="Weight for ' + core.escapeHtml(exName) + '">' +
              '<button type="button" class="stepper-btn add-set-weight-plus" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" aria-label="Increase weight">+</button>' +
            '</div>' +
            '<div class="stepper-row">' +
              '<button type="button" class="stepper-btn add-set-reps-minus" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" aria-label="Decrease reps">&minus;</button>' +
              '<input type="number" class="add-set-reps-input" min="1" step="1" placeholder="Reps" value="' + core.escapeHtml(prefillReps) + '" aria-label="Reps for ' + core.escapeHtml(exName) + '">' +
              '<button type="button" class="stepper-btn add-set-reps-plus" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" aria-label="Increase reps">+</button>' +
            '</div>' +
            '<button type="button" class="btn btn-secondary add-set-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">Add Set</button>' +
          '</div>' +
          '<div class="form-actions" style="margin-top:8px;">' +
            '<button type="button" class="btn-icon suggest-warmup-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">Suggest Warm-Up Sets</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function loadRoutineIntoDraft(routineId, programContext) {
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
    draft.programId = programContext ? programContext.programId : "";
    draft.programDayId = programContext ? programContext.programDayId : "";
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
      const roundedReps = Math.round(reps);
      const priorBest = getExercisePrAndE1rm(se.exerciseId);
      se.sets.push({ weight: weight, reps: roundedReps });
      saveDraft();
      renderSessionExerciseList();
      startRestTimer(sessionExId, REST_TIMER_DEFAULT_SECONDS);
      if (priorBest.bestE1rm > 0) {
        const newE1rm = window.JarvisExercises.estimateOneRepMax(weight, roundedReps);
        if (newE1rm > priorBest.bestE1rm) {
          const ex = window.JarvisExercises.getExerciseById(se.exerciseId);
          core.showToast("New PR! " + (ex ? ex.name : "Exercise") + ": " + weight + " × " + roundedReps);
        }
      }
      return;
    }

    const weightMinusBtn = e.target.closest(".add-set-weight-minus");
    const weightPlusBtn = e.target.closest(".add-set-weight-plus");
    if (weightMinusBtn || weightPlusBtn) {
      const row = (weightMinusBtn || weightPlusBtn).closest(".add-set-row");
      const input = row.querySelector(".add-set-weight-input");
      const current = Number(input.value) || 0;
      const next = current + (weightMinusBtn ? -5 : 5);
      input.value = next < 0 ? 0 : next;
      return;
    }

    const repsMinusBtn = e.target.closest(".add-set-reps-minus");
    const repsPlusBtn = e.target.closest(".add-set-reps-plus");
    if (repsMinusBtn || repsPlusBtn) {
      const row = (repsMinusBtn || repsPlusBtn).closest(".add-set-row");
      const input = row.querySelector(".add-set-reps-input");
      const current = Number(input.value) || 0;
      const next = current + (repsMinusBtn ? -1 : 1);
      input.value = next < 1 ? 1 : next;
      return;
    }

    const warmupBtn = e.target.closest(".suggest-warmup-btn");
    if (warmupBtn) {
      const sessionExId = warmupBtn.getAttribute("data-session-ex-id");
      const se = draft.exercises.find(function (x) { return x.sessionExId === sessionExId; });
      if (!se) return;
      const pr = getExercisePrAndE1rm(se.exerciseId);
      if (!pr.bestSet) {
        core.showToast("Log a working set for this exercise first — warm-ups are suggested from your best set.");
        return;
      }
      const target = pr.bestSet.weight;
      const ramp = [{ pct: 0.4, reps: 10 }, { pct: 0.6, reps: 6 }, { pct: 0.8, reps: 3 }];
      ramp.forEach(function (r) {
        const weight = Math.round((target * r.pct) / 5) * 5;
        se.sets.push({ weight: weight, reps: r.reps, warmup: true });
      });
      saveDraft();
      renderSessionExerciseList();
      core.showToast("Added 3 warm-up sets ramping to " + target + ".");
      return;
    }

    const restAdd30Btn = e.target.closest(".rest-timer-add30-btn");
    if (restAdd30Btn) {
      handleRestTimerAdd30(restAdd30Btn.getAttribute("data-session-ex-id"));
      return;
    }

    const restSkipBtn = e.target.closest(".rest-timer-skip-btn");
    if (restSkipBtn) {
      const sessionExId = restSkipBtn.getAttribute("data-session-ex-id");
      stopRestTimer(sessionExId);
      updateRestTimerDom(sessionExId);
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
      stopRestTimer(sessionExId);
      draft.exercises = draft.exercises.filter(function (x) { return x.sessionExId !== sessionExId; });
      saveDraft();
      renderSessionExerciseList();
    }
  }

  function resetDraft() {
    stopAllRestTimers();
    draft = { dateTime: window.JarvisCore.nowLocalDateTimeInputValue(), routineId: "", notes: "", exercises: [], programId: "", programDayId: "" };
    saveDraft();
    document.getElementById("sessionRoutineSelect").value = "";
    document.getElementById("sessionDateTime").value = draft.dateTime;
    document.getElementById("sessionNotes").value = "";
    renderSessionExerciseList();
  }

  function advanceProgramIfApplicable() {
    if (!draft.programId) return;
    const program = programs.find(function (p) { return p.id === draft.programId; });
    if (!program || program.days.length === 0) return;
    const idx = program.days.findIndex(function (d) { return d.id === draft.programDayId; });
    if (idx === -1) return;
    program.currentIndex = (idx + 1) % program.days.length;
    savePrograms();
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
      programId: draft.programId || null,
      programDayId: draft.programDayId || null,
      notes: document.getElementById("sessionNotes").value.trim(),
      exercises: withSets.map(function (se) { return { exerciseId: se.exerciseId, sets: se.sets.slice() }; }),
      createdAt: Date.now()
    };
    workouts.push(session);
    saveWorkouts();
    advanceProgramIfApplicable();
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
        let title = routine ? routine.name : "Freestyle Workout";
        if (w.programId) {
          const program = programs.find(function (p) { return p.id === w.programId; });
          if (program) {
            const day = program.days.find(function (d) { return d.id === w.programDayId; });
            title = program.name + (day ? " — " + day.label : "");
          }
        }
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
    populateProgramDayRoutineSelect();
    renderProgramList();
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
      populateProgramDayRoutineSelect();
      renderProgramList();
    }
  }

  /* ---------------- programs ---------------- */

  let programBuilder = { editId: null, days: [] };

  function populateProgramDayRoutineSelect() {
    const core = window.JarvisCore;
    const sel = document.getElementById("programDayRoutineSelect");
    if (routines.length === 0) {
      sel.innerHTML = '<option value="">Create a routine first</option>';
      return;
    }
    const current = sel.value;
    sel.innerHTML = routines.map(function (r) { return '<option value="' + core.escapeHtml(r.id) + '">' + core.escapeHtml(r.name) + "</option>"; }).join("");
    if (routines.some(function (r) { return r.id === current; })) sel.value = current;
  }

  function renderProgramBuilderList() {
    const core = window.JarvisCore;
    const container = document.getElementById("programBuilderList");
    if (programBuilder.days.length === 0) {
      container.innerHTML = '<div class="empty-state">No days added to this program yet.</div>';
      return;
    }
    container.innerHTML = programBuilder.days.map(function (d, i) {
      const routine = routines.find(function (r) { return r.id === d.routineId; });
      const routineName = routine ? routine.name : "Unknown routine";
      return (
        '<div class="list-item">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">Day ' + (i + 1) + ': ' + core.escapeHtml(d.label) + '</span>' +
              '<span class="list-item-meta">' + core.escapeHtml(routineName) + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon program-builder-up-btn" data-index="' + i + '"' + (i === 0 ? " disabled" : "") + '>&uarr;</button>' +
              '<button type="button" class="btn-icon program-builder-down-btn" data-index="' + i + '"' + (i === programBuilder.days.length - 1 ? " disabled" : "") + '>&darr;</button>' +
              '<button type="button" class="btn-icon danger program-builder-remove-btn" data-index="' + i + '">Remove</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleAddDayToProgram() {
    const core = window.JarvisCore;
    const routineId = document.getElementById("programDayRoutineSelect").value;
    if (!routineId) { core.showToast("Create a routine first, then add it as a day here."); return; }
    const routine = routines.find(function (r) { return r.id === routineId; });
    const labelInput = document.getElementById("programDayLabelInput");
    const label = labelInput.value.trim() || (routine ? routine.name : "Day");
    programBuilder.days.push({ id: core.uid("progday"), label: label, routineId: routineId });
    labelInput.value = "";
    renderProgramBuilderList();
  }

  function handleProgramBuilderListClick(e) {
    const upBtn = e.target.closest(".program-builder-up-btn");
    const downBtn = e.target.closest(".program-builder-down-btn");
    const removeBtn = e.target.closest(".program-builder-remove-btn");
    if (upBtn || downBtn) {
      const index = Number((upBtn || downBtn).getAttribute("data-index"));
      const swapWith = upBtn ? index - 1 : index + 1;
      if (swapWith >= 0 && swapWith < programBuilder.days.length) {
        const tmp = programBuilder.days[index];
        programBuilder.days[index] = programBuilder.days[swapWith];
        programBuilder.days[swapWith] = tmp;
        renderProgramBuilderList();
      }
      return;
    }
    if (removeBtn) {
      const index = Number(removeBtn.getAttribute("data-index"));
      programBuilder.days.splice(index, 1);
      renderProgramBuilderList();
    }
  }

  function exitProgramEditMode() {
    programBuilder = { editId: null, days: [] };
    document.getElementById("programEditId").value = "";
    document.getElementById("programNameInput").value = "";
    document.getElementById("programFormTitle").textContent = "Create a Program";
    document.getElementById("saveProgramBtn").textContent = "Save Program";
    document.getElementById("programCancelEditBtn").classList.add("hidden");
    renderProgramBuilderList();
  }

  function enterProgramEditMode(program) {
    programBuilder = { editId: program.id, days: program.days.map(function (d) { return Object.assign({}, d); }) };
    document.getElementById("programEditId").value = program.id;
    document.getElementById("programNameInput").value = program.name;
    document.getElementById("programFormTitle").textContent = "Edit Program";
    document.getElementById("saveProgramBtn").textContent = "Update Program";
    document.getElementById("programCancelEditBtn").classList.remove("hidden");
    renderProgramBuilderList();
    document.getElementById("programFormTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSaveProgram() {
    const core = window.JarvisCore;
    const name = document.getElementById("programNameInput").value.trim();
    if (!name) { core.showToast("Give this program a name."); return; }
    if (programBuilder.days.length === 0) { core.showToast("Add at least one day."); return; }

    if (programBuilder.editId) {
      const existing = programs.find(function (p) { return p.id === programBuilder.editId; });
      if (existing) {
        existing.name = name;
        existing.days = programBuilder.days.slice();
        if (existing.currentIndex >= existing.days.length) existing.currentIndex = 0;
      }
      core.showToast("Program updated.");
    } else {
      programs.push({ id: core.uid("program"), name: name, days: programBuilder.days.slice(), currentIndex: 0, createdAt: Date.now() });
      core.showToast("Program saved.");
    }
    savePrograms();
    exitProgramEditMode();
    renderProgramList();
  }

  function renderProgramList() {
    const core = window.JarvisCore;
    const container = document.getElementById("programList");
    if (programs.length === 0) {
      container.innerHTML = '<div class="empty-state">No programs yet. Build one above from your existing routines.</div>';
      return;
    }
    container.innerHTML = programs.map(function (p) {
      const dayIndex = p.currentIndex % p.days.length;
      const nextDay = p.days[dayIndex];
      const nextRoutine = nextDay ? routines.find(function (r) { return r.id === nextDay.routineId; }) : null;
      const nextText = nextDay
        ? "Next: " + core.escapeHtml(nextDay.label) + " (" + core.escapeHtml(nextRoutine ? nextRoutine.name : "routine deleted") + ") &middot; day " + (dayIndex + 1) + " of " + p.days.length
        : "This program has no days.";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(p.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(p.name) + ' <span class="badge badge-neutral">' + p.days.length + ' day' + (p.days.length === 1 ? "" : "s") + '</span></span>' +
              '<span class="list-item-meta">' + nextText + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon program-start-btn" data-id="' + core.escapeHtml(p.id) + '">Start Today’s Workout</button>' +
              '<button type="button" class="btn-icon program-skip-btn" data-id="' + core.escapeHtml(p.id) + '">Skip Day</button>' +
              '<button type="button" class="btn-icon program-edit-btn" data-id="' + core.escapeHtml(p.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger program-delete-btn" data-id="' + core.escapeHtml(p.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleProgramListClick(e) {
    const startBtn = e.target.closest(".program-start-btn");
    if (startBtn) {
      const id = startBtn.getAttribute("data-id");
      const program = programs.find(function (p) { return p.id === id; });
      if (!program || program.days.length === 0) return;
      const day = program.days[program.currentIndex % program.days.length];
      const routine = routines.find(function (r) { return r.id === day.routineId; });
      if (!routine) { window.JarvisCore.showToast("That day's routine no longer exists — edit the program to fix it."); return; }
      document.getElementById("sessionRoutineSelect").value = day.routineId;
      loadRoutineIntoDraft(day.routineId, { programId: program.id, programDayId: day.id });
      switchToWorkoutSubTab("workout-log");
      return;
    }
    const skipBtn = e.target.closest(".program-skip-btn");
    if (skipBtn) {
      const id = skipBtn.getAttribute("data-id");
      const program = programs.find(function (p) { return p.id === id; });
      if (!program || program.days.length === 0) return;
      program.currentIndex = (program.currentIndex + 1) % program.days.length;
      savePrograms();
      renderProgramList();
      window.JarvisCore.showToast("Skipped to the next day.");
      return;
    }
    const editBtn = e.target.closest(".program-edit-btn");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      const program = programs.find(function (p) { return p.id === id; });
      if (program) enterProgramEditMode(program);
      return;
    }
    const delBtn = e.target.closest(".program-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      programs = programs.filter(function (p) { return p.id !== id; });
      savePrograms();
      renderProgramList();
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

  /* ---------------- body measurements ---------------- */

  function renderMeasurementList() {
    const core = window.JarvisCore;
    const container = document.getElementById("measurementList");
    if (measurements.length === 0) {
      container.innerHTML = '<div class="empty-state">No measurements logged yet.</div>';
      return;
    }
    const sorted = measurements.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    container.innerHTML = sorted.map(function (m) {
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(m.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(m.type) + ' <span class="badge badge-neutral">' + core.escapeHtml(m.value) + ' ' + core.escapeHtml(m.unit) + '</span></span>' +
              '<span class="list-item-meta">' + core.formatDate(m.date) + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger measurement-delete-btn" data-id="' + core.escapeHtml(m.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleMeasurementSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const type = document.getElementById("measurementType").value.trim();
    const value = Number(document.getElementById("measurementValue").value);
    const unit = document.getElementById("measurementUnit").value;
    const date = document.getElementById("measurementDate").value || core.todayISODate();
    if (!type) { core.showToast("Enter a body part."); return; }
    if (!core.isPositiveNumber(value)) { core.showToast("Value must be a positive number."); return; }
    measurements.push({ id: core.uid("meas"), type: type, value: value, unit: unit, date: date, createdAt: Date.now() });
    saveMeasurements();
    renderMeasurementList();
    renderProgressTab();
    document.getElementById("measurementForm").reset();
    document.getElementById("measurementDate").value = "";
    document.getElementById("measurementUnit").value = unit;
    core.showToast("Measurement logged.");
  }

  function handleMeasurementListClick(e) {
    const btn = e.target.closest(".measurement-delete-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    measurements = measurements.filter(function (x) { return x.id !== id; });
    saveMeasurements();
    renderMeasurementList();
    renderProgressTab();
  }

  function populateProgressMeasurementSelect() {
    const core = window.JarvisCore;
    const sel = document.getElementById("progressMeasurementSelect");
    const current = sel.value;
    const types = Array.from(new Set(measurements.map(function (m) { return m.type; }))).sort();
    if (types.length === 0) {
      sel.innerHTML = '<option value="">Log a measurement to see its trend</option>';
      return;
    }
    sel.innerHTML = types.map(function (t) { return '<option value="' + core.escapeHtml(t) + '">' + core.escapeHtml(t) + '</option>'; }).join("");
    if (types.indexOf(current) !== -1) sel.value = current;
  }

  function renderMeasurementChart() {
    const core = window.JarvisCore;
    const type = document.getElementById("progressMeasurementSelect").value;
    if (!type) {
      renderLineChart("measurementChart", [], { emptyMessage: "Log a couple of measurements for this body part to see a trend line." });
      return;
    }
    // Measurements are shown in whatever unit they were logged in — no
    // cross-unit conversion, unlike body weight's lb normalization.
    const rawPoints = measurements
      .filter(function (m) { return m.type === type; })
      .sort(function (a, b) { return new Date(a.date) - new Date(b.date); })
      .map(function (m) { return { t: new Date(m.date).getTime(), v: m.value, label: core.formatDate(m.date) }; });
    const unit = measurements.filter(function (m) { return m.type === type; })[0].unit;
    renderLineChart("measurementChart", rawPoints, {
      emptyMessage: "Log a couple of measurements for this body part to see a trend line.",
      yFormat: function (v) { return v.toFixed(1) + " " + unit; },
      ariaLabel: type + " measurement trend"
    });
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

    renderPrHistoryList(exerciseId);
  }

  // Chronological list of estimated-1RM PRs for an exercise: every time a
  // logged set beat the best e1rm seen up to that point. Most recent first.
  function getPrHistory(exerciseId) {
    const JE = window.JarvisExercises;
    const sorted = workouts
      .filter(function (w) { return w.schema === 2; })
      .slice()
      .sort(function (a, b) { return new Date(a.dateTime || a.date) - new Date(b.dateTime || b.date); });
    let bestE1rm = 0;
    const history = [];
    sorted.forEach(function (w) {
      const se = w.exercises.find(function (x) { return x.exerciseId === exerciseId; });
      if (!se) return;
      se.sets.forEach(function (s) {
        const e1rm = JE.estimateOneRepMax(s.weight, s.reps);
        if (e1rm > bestE1rm) {
          bestE1rm = e1rm;
          history.push({ date: w.date, weight: s.weight, reps: s.reps, e1rm: e1rm });
        }
      });
    });
    return history.reverse();
  }

  function renderPrHistoryList(exerciseId) {
    const core = window.JarvisCore;
    const container = document.getElementById("exercisePrHistoryList");
    if (!exerciseId) {
      container.innerHTML = '<div class="empty-state">No PRs recorded yet for this exercise.</div>';
      return;
    }
    const history = getPrHistory(exerciseId);
    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state">No PRs recorded yet for this exercise.</div>';
      return;
    }
    container.innerHTML = history.map(function (h) {
      return (
        '<div class="list-item">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(h.weight) + ' &times; ' + core.escapeHtml(h.reps) + ' <span class="badge badge-green">Est. 1RM ' + Math.round(h.e1rm) + '</span></span>' +
              '<span class="list-item-meta">' + core.formatDate(h.date) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderVolumeChart() {
    const core = window.JarvisCore;

    function weekStartIso(dateStr) {
      const d = new Date(dateStr);
      const day = d.getDay();
      const start = new Date(d);
      start.setDate(d.getDate() - day);
      start.setHours(0, 0, 0, 0);
      const tzOffset = start.getTimezoneOffset() * 60000;
      return new Date(start.getTime() - tzOffset).toISOString().slice(0, 10);
    }

    const volumeByWeek = {};
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      const weekStart = weekStartIso(w.date);
      let sessionVolume = 0;
      w.exercises.forEach(function (se) {
        se.sets.forEach(function (s) { sessionVolume += s.weight * s.reps; });
      });
      volumeByWeek[weekStart] = (volumeByWeek[weekStart] || 0) + sessionVolume;
    });

    const points = Object.keys(volumeByWeek)
      .sort(function (a, b) { return new Date(a) - new Date(b); })
      .map(function (weekStart) {
        return { t: new Date(weekStart).getTime(), v: volumeByWeek[weekStart], label: "Week of " + core.formatDate(weekStart) };
      });

    renderLineChart("volumeChart", points, {
      emptyMessage: "Log a couple of weeks of workouts to see your volume trend.",
      yFormat: function (v) { return Math.round(v).toLocaleString() + " lb"; },
      ariaLabel: "Weekly training volume trend"
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
    renderVolumeChart();
    populateProgressMeasurementSelect();
    renderMeasurementChart();
    renderStrengthScoreChart();
  }

  /* ---------------- render all / init ---------------- */

  function renderAll() {
    renderStats();
    renderWorkoutList();
    renderRoutineList();
    populateRoutineSelect();
    populateProgramDayRoutineSelect();
    renderProgramList();
    renderBodyweightList();
    renderMeasurementList();
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
    document.getElementById("exercisePickerSearch").addEventListener("input", refreshExercisePicker);
    document.getElementById("exercisePickerSelect").addEventListener("change", updateFavoriteStarButton);
    document.getElementById("exercisePickerFavoriteBtn").addEventListener("click", handleToggleFavorite);
    document.getElementById("showAddCustomExerciseBtn").addEventListener("click", handleShowAddCustomExercise);
    document.getElementById("cancelCustomExerciseBtn").addEventListener("click", handleCancelAddCustomExercise);
    document.getElementById("saveCustomExerciseBtn").addEventListener("click", handleSaveCustomExercise);
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
    document.getElementById("routinePickerSearch").addEventListener("input", refreshRoutinePicker);
    document.getElementById("addExerciseToRoutineBtn").addEventListener("click", handleAddExerciseToRoutine);
    document.getElementById("routineBuilderList").addEventListener("click", handleRoutineBuilderListClick);
    document.getElementById("saveRoutineBtn").addEventListener("click", handleSaveRoutine);
    document.getElementById("routineCancelEditBtn").addEventListener("click", exitRoutineEditMode);
    document.getElementById("routineList").addEventListener("click", handleRoutineListClick);

    document.getElementById("addDayToProgramBtn").addEventListener("click", handleAddDayToProgram);
    document.getElementById("programBuilderList").addEventListener("click", handleProgramBuilderListClick);
    document.getElementById("saveProgramBtn").addEventListener("click", handleSaveProgram);
    document.getElementById("programCancelEditBtn").addEventListener("click", exitProgramEditMode);
    document.getElementById("programList").addEventListener("click", handleProgramListClick);

    document.getElementById("bodyweightForm").addEventListener("submit", handleBodyweightSubmit);
    document.getElementById("bodyweightList").addEventListener("click", handleBodyweightListClick);
    document.getElementById("measurementForm").addEventListener("submit", handleMeasurementSubmit);
    document.getElementById("measurementList").addEventListener("click", handleMeasurementListClick);
    document.getElementById("strengthSettingsForm").addEventListener("submit", handleStrengthSettingsSubmit);

    document.getElementById("progressExerciseSelect").addEventListener("change", renderExerciseProgressChart);
    document.getElementById("progressMeasurementSelect").addEventListener("change", renderMeasurementChart);

    renderSessionExerciseList();
    renderAll();
  }

  window.JarvisWorkout = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
