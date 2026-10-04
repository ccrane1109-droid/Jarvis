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

  // Transient (not persisted) state for the "Generate a Routine" wizard —
  // reset fresh each page load, same as the routine/program builders.
  const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const WEEKDAY_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
  const GENERATOR_GOALS = [
    { id: "muscle", label: "Build Muscle", icon: "💪" },
    { id: "strength", label: "Build Strength", icon: "🏋️" },
    { id: "lean", label: "Get Lean", icon: "🔥" }
  ];
  const GENERATOR_GOAL_SCHEMES = {
    muscle: { primary: { sets: 4, reps: 8 }, accessory: { sets: 3, reps: 11 } },
    strength: { primary: { sets: 5, reps: 4 }, accessory: { sets: 3, reps: 7 } },
    lean: { primary: { sets: 3, reps: 13 }, accessory: { sets: 3, reps: 15 } }
  };
  // Each day template's groups list which muscle groups get an exercise, in
  // order — the first is that day's "main lift" (heavier scheme), the rest
  // are accessories. A group listed twice just means "give this day 2
  // different exercises for that muscle."
  const GENERATOR_SPLITS = {
    2: [
      { label: "Full Body A", groups: ["Chest", "Back", "Quadriceps", "Shoulders", "Hamstrings"] },
      { label: "Full Body B", groups: ["Back", "Chest", "Hamstrings", "Biceps", "Triceps"] }
    ],
    3: [
      { label: "Full Body A", groups: ["Chest", "Back", "Quadriceps", "Shoulders", "Abs / Core"] },
      { label: "Full Body B", groups: ["Back", "Chest", "Hamstrings", "Biceps", "Abs / Core"] },
      { label: "Full Body C", groups: ["Quadriceps", "Shoulders", "Back", "Triceps", "Abs / Core"] }
    ],
    4: [
      { label: "Upper A", groups: ["Chest", "Back", "Shoulders", "Biceps", "Triceps"] },
      { label: "Lower A", groups: ["Quadriceps", "Hamstrings", "Glutes", "Calves"] },
      { label: "Upper B", groups: ["Back", "Chest", "Shoulders", "Triceps", "Biceps"] },
      { label: "Lower B", groups: ["Hamstrings", "Quadriceps", "Glutes", "Calves"] }
    ],
    5: [
      { label: "Push", groups: ["Chest", "Shoulders", "Chest", "Triceps"] },
      { label: "Pull", groups: ["Back", "Back", "Biceps", "Traps"] },
      { label: "Legs", groups: ["Quadriceps", "Hamstrings", "Glutes", "Calves"] },
      { label: "Upper", groups: ["Chest", "Back", "Shoulders", "Biceps", "Triceps"] },
      { label: "Lower", groups: ["Quadriceps", "Hamstrings", "Glutes"] }
    ],
    6: [
      { label: "Push A", groups: ["Chest", "Shoulders", "Chest", "Triceps"] },
      { label: "Pull A", groups: ["Back", "Back", "Biceps", "Traps"] },
      { label: "Legs A", groups: ["Quadriceps", "Hamstrings", "Glutes", "Calves"] },
      { label: "Push B", groups: ["Shoulders", "Chest", "Chest", "Triceps"] },
      { label: "Pull B", groups: ["Back", "Biceps", "Back", "Forearms"] },
      { label: "Legs B", groups: ["Hamstrings", "Quadriceps", "Glutes", "Calves"] }
    ]
  };
  let routineGenerator = {
    goal: "muscle",
    daysPerWeek: 3,
    trainingDays: [], // Monday-first indices (0=Mon..6=Sun) into WEEKDAY_LABELS
    equipment: {} // { "Free Weight": true, ... } — filled in from JarvisExercises.EQUIPMENT_TYPES on init, all true by default
  };

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
      draft = { dateTime: core.nowLocalDateTimeInputValue(), routineId: "", notes: "", exercises: [], programId: "", programDayId: "", activeIndex: 0 };
    }
    if (typeof draft.activeIndex !== "number") draft.activeIndex = 0;
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
    const JE = window.JarvisExercises;
    return muscleGroups.map(function (m) {
      return '<span class="badge badge-neutral">' + JE.iconForMuscleGroup(m) + ' ' + core.escapeHtml(m) + '</span>';
    }).join("");
  }

  /* ---------------- exercise / routine pickers ---------------- */

  function buildPlainOptionsHtml(values) {
    const core = window.JarvisCore;
    return values.map(function (v) {
      return '<option value="' + core.escapeHtml(v) + '">' + core.escapeHtml(v) + '</option>';
    }).join("");
  }

  function populateFilterSelect(selectEl, values) {
    const current = selectEl.value;
    selectEl.innerHTML = selectEl.options[0].outerHTML + buildPlainOptionsHtml(values);
    if (values.indexOf(current) !== -1) selectEl.value = current;
  }

  // Like populateFilterSelect, but with no leading "All ..." placeholder option.
  function populateSelectPlain(selectEl, values) {
    const current = selectEl.value;
    selectEl.innerHTML = buildPlainOptionsHtml(values);
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

    // Exclude favorites here so they don't also appear in their normal
    // muscle-group optgroup — they're already shown above.
    const nonFavorites = filtered.filter(function (ex) { return favoriteIds.indexOf(ex.id) === -1; });
    const groups = {};
    nonFavorites.forEach(function (ex) {
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
    renderMuscleChips();
    renderExercisePickerCards();
  }

  // Catalog-style card grid for picking an exercise, sitting alongside the
  // hidden <select id="exercisePickerSelect"> which stays the actual source
  // of truth (favorites, "Add Exercise" all read its .value) — a card click
  // just sets that select's value and dispatches change, same as if the
  // user had picked it from a dropdown.
  function renderMuscleChips() {
    const core = window.JarvisCore;
    const JE = window.JarvisExercises;
    const container = document.getElementById("exercisePickerMuscleChips");
    if (!container) return;
    const current = document.getElementById("exercisePickerMuscleFilter").value;
    const chips = [{ value: "", label: "All" }].concat(JE.MUSCLE_GROUPS.map(function (m) { return { value: m, label: m }; }));
    container.innerHTML = chips.map(function (c) {
      const activeCls = c.value === current ? " active" : "";
      const icon = c.value ? JE.iconForMuscleGroup(c.value) : "🏋️";
      return '<button type="button" class="muscle-chip' + activeCls + '" data-value="' + core.escapeHtml(c.value) + '">' + icon + ' ' + core.escapeHtml(c.label) + '</button>';
    }).join("");
  }

  function handleMuscleChipsClick(e) {
    const chip = e.target.closest(".muscle-chip");
    if (!chip) return;
    document.getElementById("exercisePickerMuscleFilter").value = chip.getAttribute("data-value");
    refreshExercisePicker();
  }

  function renderExercisePickerCards() {
    const core = window.JarvisCore;
    const JE = window.JarvisExercises;
    const container = document.getElementById("exercisePickerCards");
    if (!container) return;
    const muscle = document.getElementById("exercisePickerMuscleFilter").value;
    const equipment = document.getElementById("exercisePickerEquipmentFilter").value;
    const search = document.getElementById("exercisePickerSearch").value;
    const selectedId = document.getElementById("exercisePickerSelect").value;
    const favoriteIds = JE.loadFavoriteIds();
    const searchLower = (search || "").trim().toLowerCase();
    const filtered = JE.getExercises().filter(function (ex) {
      if (muscle && ex.muscleGroup !== muscle) return false;
      if (equipment && ex.equipment !== equipment) return false;
      if (searchLower && ex.name.toLowerCase().indexOf(searchLower) === -1) return false;
      return true;
    });
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">No exercises match this filter.</div>';
      return;
    }
    container.innerHTML = filtered.map(function (ex) {
      const isFav = favoriteIds.indexOf(ex.id) !== -1;
      const selectedCls = ex.id === selectedId ? " selected" : "";
      return (
        '<div class="exercise-card' + selectedCls + '" data-id="' + core.escapeHtml(ex.id) + '">' +
          '<button type="button" class="exercise-card-fav-btn' + (isFav ? " active" : "") + '" data-id="' + core.escapeHtml(ex.id) + '" aria-label="Toggle favorite">' + (isFav ? "★" : "☆") + '</button>' +
          '<span class="exercise-card-icon">' + JE.iconForMuscleGroup(ex.muscleGroup) + '</span>' +
          '<span class="exercise-card-name">' + core.escapeHtml(ex.name) + '</span>' +
          '<span class="exercise-card-meta">' + core.escapeHtml(ex.equipment) + '</span>' +
        '</div>'
      );
    }).join("");
  }

  function handleExercisePickerCardsClick(e) {
    const favBtn = e.target.closest(".exercise-card-fav-btn");
    if (favBtn) {
      const id = favBtn.getAttribute("data-id");
      window.JarvisExercises.toggleFavorite(id);
      renderExercisePickerCards();
      if (document.getElementById("exercisePickerSelect").value === id) updateFavoriteStarButton();
      return;
    }
    const card = e.target.closest(".exercise-card");
    if (card) {
      const select = document.getElementById("exercisePickerSelect");
      select.value = card.getAttribute("data-id");
      select.dispatchEvent(new Event("change"));
      renderExercisePickerCards();
    }
  }

  function handleAddExerciseToggle() {
    const body = document.getElementById("addExerciseBody");
    const btn = document.getElementById("addExerciseToggleBtn");
    const nowHidden = body.classList.toggle("hidden");
    btn.textContent = nowHidden ? "+ Browse Exercises" : "Hide";
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

  function renderCustomExerciseList() {
    const core = window.JarvisCore;
    const container = document.getElementById("customExerciseList");
    const list = window.JarvisExercises.loadCustomExercises();
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">No custom exercises yet.</div>';
      return;
    }
    container.innerHTML = list.map(function (ex) {
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(ex.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(ex.name) + '</span>' +
              '<span class="list-item-meta">' + core.escapeHtml(ex.muscleGroup) + ' &middot; ' + core.escapeHtml(ex.equipment) + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger custom-exercise-delete-btn" data-id="' + core.escapeHtml(ex.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleShowAddCustomExercise() {
    document.getElementById("addCustomExerciseForm").classList.remove("hidden");
    document.getElementById("customExerciseName").focus();
    renderCustomExerciseList();
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
    document.getElementById("customExerciseName").value = "";
    renderCustomExerciseList();
    core.showToast("Added “" + name + "” to your exercise library.");
  }

  function handleCustomExerciseListClick(e) {
    const btn = e.target.closest(".custom-exercise-delete-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    window.JarvisExercises.deleteCustomExercise(id);
    renderCustomExerciseList();
    refreshExercisePicker();
    refreshRoutinePicker();
    window.JarvisCore.showToast("Custom exercise deleted.");
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

  // Renders one exercise's full logging card (name, sets, rest timer, add-set
  // row) — used by renderSessionExerciseList() to show just the ACTIVE
  // exercise, Liftoff-style, one at a time instead of a long scrolling list
  // of every exercise in the session at once.
  function renderExerciseCard(se) {
    const core = window.JarvisCore;
    const ex = window.JarvisExercises.getExerciseById(se.exerciseId);
      const exName = ex ? ex.name : "Unknown exercise";
      const muscle = ex ? ex.muscleGroup : "";
      const setsHtml = se.sets.length === 0
        ? '<div class="field-hint">No sets yet.</div>'
        : se.sets.map(function (s, i) {
            const warmupTag = s.warmup ? ' <span class="badge badge-neutral">warm-up</span>' : '';
            const dropsetTag = s.dropset ? ' <span class="badge badge-neutral">drop set</span>' : '';
            const weightVal = s.weight === "" || s.weight === null || s.weight === undefined ? "" : s.weight;
            return (
              '<div class="set-row set-row-editable">' +
                '<span class="set-row-label">Set ' + (i + 1) + '</span>' +
                '<input type="number" class="set-weight-input" min="0" step="0.5" placeholder="Weight" value="' + core.escapeHtml(weightVal) + '" ' +
                  'data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" data-set-index="' + i + '" aria-label="Weight for set ' + (i + 1) + '">' +
                '<span>&times;</span>' +
                '<input type="number" class="set-reps-input" min="1" step="1" placeholder="Reps" value="' + core.escapeHtml(s.reps) + '" ' +
                  'data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" data-set-index="' + i + '" aria-label="Reps for set ' + (i + 1) + '">' +
                warmupTag + dropsetTag +
                '<button type="button" class="btn-icon danger remove-set-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '" data-set-index="' + i + '" aria-label="Remove set">&times;</button>' +
              '</div>'
            );
          }).join("");
      const pr = getExercisePrAndE1rm(se.exerciseId);
      const prHint = pr.bestSet
        ? '<span class="list-item-meta">PR: ' + core.escapeHtml(pr.bestSet.weight) + ' &times; ' + core.escapeHtml(pr.bestSet.reps) + ' &middot; Est. 1RM: ' + Math.round(pr.bestE1rm) + '</span>'
        : '<span class="list-item-meta">No previous sets logged for this exercise yet.</span>';
      const lastSet = se.sets.length ? se.sets[se.sets.length - 1] : null;
      const routineTarget = routineTargetForSet(se.exerciseId, se.sets.length);
      const prefillWeight = lastSet ? lastSet.weight : "";
      const prefillReps = routineTarget ? routineTarget.reps : (lastSet ? lastSet.reps : "");
      const prefillType = routineTarget ? routineTarget.type : "normal";
      const supersetBadge = se.supersetGroup ? ' <span class="badge badge-yellow">Superset</span>' : '';
      return (
        '<div class="list-item session-exercise-block" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(exName) + ' <span class="badge badge-neutral">' + core.escapeHtml(muscle) + '</span>' + supersetBadge + '</span>' +
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
            '<select class="add-set-type-select" aria-label="Set type for ' + core.escapeHtml(exName) + '">' + setTypeOptionsHtml(prefillType) + '</select>' +
            '<button type="button" class="btn btn-secondary add-set-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">Add Set</button>' +
          '</div>' +
          '<div class="form-actions" style="margin-top:8px;">' +
            '<button type="button" class="btn-icon suggest-warmup-btn" data-session-ex-id="' + core.escapeHtml(se.sessionExId) + '">Suggest Warm-Up Sets</button>' +
          '</div>' +
        '</div>'
      );
  }

  // Shows the session ONE exercise at a time (the active one, tracked by
  // draft.activeIndex) with a pill nav across the top and Prev/Next controls,
  // instead of one long scrolling list of every exercise's sets at once.
  function renderSessionExerciseList() {
    const core = window.JarvisCore;
    const container = document.getElementById("sessionExerciseList");
    const pillNav = document.getElementById("sessionExercisePillNav");
    const navRow = document.getElementById("sessionNavRow");
    const muscleGroupsEl = document.getElementById("sessionMuscleGroups");
    const musclesTrained = getMuscleGroupsForExerciseIds(draft.exercises.map(function (se) { return se.exerciseId; }));
    muscleGroupsEl.innerHTML = muscleGroupBadgesHtml(musclesTrained);

    if (draft.exercises.length === 0) {
      pillNav.innerHTML = "";
      navRow.classList.add("hidden");
      container.innerHTML = '<div class="empty-state">No exercises added yet. Add one above to start logging sets.</div>';
      return;
    }

    if (draft.activeIndex < 0) draft.activeIndex = 0;
    if (draft.activeIndex > draft.exercises.length - 1) draft.activeIndex = draft.exercises.length - 1;

    pillNav.innerHTML = draft.exercises.map(function (se, i) {
      const ex = window.JarvisExercises.getExerciseById(se.exerciseId);
      const icon = ex ? window.JarvisExercises.iconForMuscleGroup(ex.muscleGroup) : "🏋️";
      const name = ex ? ex.name : "Unknown exercise";
      const hasCompletedSet = se.sets.some(isCompletedSet);
      const activeCls = i === draft.activeIndex ? " active" : "";
      const doneCls = hasCompletedSet ? " done" : "";
      return (
        '<button type="button" class="exercise-pill' + activeCls + doneCls + '" data-index="' + i + '">' +
          '<span class="exercise-pill-icon">' + icon + '</span>' +
          '<span class="exercise-pill-name">' + core.escapeHtml(name) + '</span>' +
          (hasCompletedSet ? '<span class="exercise-pill-check">&#10003;</span>' : '') +
        '</button>'
      );
    }).join("");

    if (draft.exercises.length > 1) {
      navRow.classList.remove("hidden");
      document.getElementById("sessionNavPosition").textContent = "Exercise " + (draft.activeIndex + 1) + " of " + draft.exercises.length;
      document.getElementById("sessionPrevExerciseBtn").disabled = draft.activeIndex === 0;
      document.getElementById("sessionNextExerciseBtn").disabled = draft.activeIndex === draft.exercises.length - 1;
    } else {
      navRow.classList.add("hidden");
    }

    container.innerHTML = renderExerciseCard(draft.exercises[draft.activeIndex]);
  }

  function handleSessionPillNavClick(e) {
    const pill = e.target.closest(".exercise-pill");
    if (!pill) return;
    draft.activeIndex = Number(pill.getAttribute("data-index"));
    saveDraft();
    renderSessionExerciseList();
  }

  function handleSessionPrevExercise() {
    if (draft.activeIndex > 0) { draft.activeIndex--; saveDraft(); renderSessionExerciseList(); }
  }

  function handleSessionNextExercise() {
    if (draft.activeIndex < draft.exercises.length - 1) { draft.activeIndex++; saveDraft(); renderSessionExerciseList(); }
  }

  // The set plan for the NEXT set (0-indexed) of an exercise, from
  // whichever routine this session's draft was loaded from — or null if
  // this exercise wasn't loaded from a routine (or has no set planned at
  // that index). Returns { reps, type }.
  function routineTargetForSet(exerciseId, setIndex) {
    if (!draft.routineId) return null;
    const routine = routines.find(function (r) { return r.id === draft.routineId; });
    if (!routine) return null;
    const re = routine.exercises.find(function (e) { return e.exerciseId === exerciseId; });
    if (!re) return null;
    const plannedSets = getPlannedSets(re);
    return plannedSets[setIndex] || null;
  }

  // The most recently logged session's sets for an exercise (across all
  // history, any routine), used to suggest a starting weight per set index
  // when a routine's plan is auto-loaded — reps/type come from the plan, but
  // the plan doesn't know what weight you lift.
  function mostRecentLoggedSets(exerciseId) {
    let latest = null;
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      const se = w.exercises.find(function (x) { return x.exerciseId === exerciseId; });
      if (!se) return;
      if (!latest || w.dateTime > latest.dateTime) latest = { dateTime: w.dateTime, sets: se.sets };
    });
    return latest ? latest.sets : null;
  }

  // Auto-builds the session's set list for an exercise straight from the
  // active routine's plan (reps + type per set), so logging a routine
  // doesn't require pressing "Add Set" once per planned set. Weight is
  // pre-filled from the same set index the last time this exercise was
  // logged, if there's history for it, and left blank otherwise — a blank
  // weight means "not yet done" and is dropped when the workout is saved.
  // Returns [] when this exercise isn't part of the active routine (or no
  // routine is loaded), leaving freeform-added exercises exactly as before.
  // routineId defaults to the draft's current one; loadRoutineIntoDraft
  // passes it explicitly since it hasn't written it to the draft yet at the
  // point it needs this.
  function buildSetsFromRoutinePlan(exerciseId, routineId) {
    const rid = routineId || draft.routineId;
    if (!rid) return [];
    const routine = routines.find(function (r) { return r.id === rid; });
    if (!routine) return [];
    const re = routine.exercises.find(function (e) { return e.exerciseId === exerciseId; });
    if (!re) return [];
    const plannedSets = getPlannedSets(re);
    const priorSets = mostRecentLoggedSets(exerciseId);
    return plannedSets.map(function (p, i) {
      const priorWeight = priorSets && priorSets[i] ? priorSets[i].weight : "";
      return { weight: priorWeight, reps: p.reps, warmup: p.type === "warmup", dropset: p.type === "dropset" };
    });
  }

  function loadRoutineIntoDraft(routineId, programContext) {
    const routine = routines.find(function (r) { return r.id === routineId; });
    if (!routine) return;
    const core = window.JarvisCore;
    routine.exercises.forEach(function (re) {
      const existing = draft.exercises.find(function (se) { return se.exerciseId === re.exerciseId; });
      if (!existing) {
        draft.exercises.push({
          sessionExId: core.uid("sesx"), exerciseId: re.exerciseId,
          sets: buildSetsFromRoutinePlan(re.exerciseId, routineId), supersetGroup: re.supersetGroup || null
        });
      } else if (existing.sets.length === 0) {
        // Already in the draft (e.g. added before this routine's plan
        // existed, or left with zero sets some other way) — still worth
        // auto-filling from the plan rather than leaving it empty. Never
        // touches an exercise that already has sets, so nothing typed in
        // gets clobbered.
        existing.sets = buildSetsFromRoutinePlan(re.exerciseId, routineId);
        if (!existing.supersetGroup) existing.supersetGroup = re.supersetGroup || null;
      }
    });
    draft.routineId = routineId;
    draft.programId = programContext ? programContext.programId : "";
    draft.programDayId = programContext ? programContext.programDayId : "";
    draft.activeIndex = 0;
    saveDraft();
    renderSessionExerciseList();
  }

  function handleAddExerciseToSession() {
    const core = window.JarvisCore;
    const exerciseId = document.getElementById("exercisePickerSelect").value;
    if (!exerciseId) { core.showToast("Choose an exercise first."); return; }
    draft.exercises.push({ sessionExId: core.uid("sesx"), exerciseId: exerciseId, sets: buildSetsFromRoutinePlan(exerciseId) });
    draft.activeIndex = draft.exercises.length - 1;
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
      const typeSelect = row.querySelector(".add-set-type-select");
      const weight = Number(weightInput.value);
      const reps = Number(repsInput.value);
      const setType = typeSelect ? typeSelect.value : "normal";
      if (!isNonNegativeNumber(weight)) { core.showToast("Weight can't be negative."); return; }
      if (!core.isPositiveNumber(reps)) { core.showToast("Reps must be a positive number."); return; }
      const sessionExId = addSetBtn.getAttribute("data-session-ex-id");
      const se = draft.exercises.find(function (x) { return x.sessionExId === sessionExId; });
      if (!se) return;
      const roundedReps = Math.round(reps);
      const JE = window.JarvisExercises;
      const priorBest = getExercisePrAndE1rm(se.exerciseId);
      // Also factor in sets already logged earlier in this same unsaved
      // session, so repeating an identical set doesn't re-trigger the toast.
      const sessionBestE1rmSoFar = se.sets.reduce(function (max, s) {
        const e1rm = JE.estimateOneRepMax(s.weight, s.reps);
        return e1rm > max ? e1rm : max;
      }, 0);
      const combinedBestE1rm = Math.max(priorBest.bestE1rm, sessionBestE1rmSoFar);
      se.sets.push({ weight: weight, reps: roundedReps, warmup: setType === "warmup", dropset: setType === "dropset" });
      saveDraft();
      renderSessionExerciseList();
      startRestTimer(sessionExId, REST_TIMER_DEFAULT_SECONDS);
      if (combinedBestE1rm > 0) {
        const newE1rm = JE.estimateOneRepMax(weight, roundedReps);
        if (newE1rm > combinedBestE1rm) {
          const ex = JE.getExerciseById(se.exerciseId);
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

  // Editing an auto-populated (or manually added) set's weight/reps inline.
  // Deliberately doesn't re-render the list on every change (would blow away
  // focus mid-typing) — it just persists the draft on blur/enter, same as
  // any other plain input field elsewhere in the app.
  function handleSessionExerciseListChange(e) {
    const weightInput = e.target.closest(".set-weight-input");
    const repsInput = e.target.closest(".set-reps-input");
    if (!weightInput && !repsInput) return;
    const input = weightInput || repsInput;
    const sessionExId = input.getAttribute("data-session-ex-id");
    const setIndex = Number(input.getAttribute("data-set-index"));
    const se = draft.exercises.find(function (x) { return x.sessionExId === sessionExId; });
    if (!se || !se.sets[setIndex]) return;
    const raw = input.value.trim();
    if (weightInput) {
      se.sets[setIndex].weight = raw === "" ? "" : Number(raw);
    } else {
      se.sets[setIndex].reps = raw === "" ? "" : Math.round(Number(raw));
    }
    saveDraft();
    updatePillDoneState(se);
  }

  // Patches just the one pill's "done" checkmark in place rather than a full
  // renderSessionExerciseList() — a full re-render would blow away whatever
  // input the user is mid-editing.
  function updatePillDoneState(se) {
    const index = draft.exercises.indexOf(se);
    if (index === -1) return;
    const pill = document.querySelector('.exercise-pill[data-index="' + index + '"]');
    if (!pill) return;
    const hasCompletedSet = se.sets.some(isCompletedSet);
    pill.classList.toggle("done", hasCompletedSet);
    const existingCheck = pill.querySelector(".exercise-pill-check");
    if (hasCompletedSet && !existingCheck) {
      const span = document.createElement("span");
      span.className = "exercise-pill-check";
      span.innerHTML = "&#10003;";
      pill.appendChild(span);
    } else if (!hasCompletedSet && existingCheck) {
      existingCheck.remove();
    }
  }

  function resetDraft() {
    stopAllRestTimers();
    draft = { dateTime: window.JarvisCore.nowLocalDateTimeInputValue(), routineId: "", notes: "", exercises: [], programId: "", programDayId: "", activeIndex: 0 };
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

  // A set counts as actually performed once it has a real weight and reps.
  // Sets auto-populated from a routine plan start with a blank weight (and
  // possibly a blank reps if the user cleared it) — those are "not done yet"
  // and get quietly dropped here rather than saved as a fake 0 x reps set.
  function isCompletedSet(s) {
    return isNonNegativeNumber(Number(s.weight)) && s.weight !== "" &&
      window.JarvisCore.isPositiveNumber(Number(s.reps)) && s.reps !== "";
  }

  function handleSaveWorkout() {
    const core = window.JarvisCore;
    const withSets = draft.exercises
      .map(function (se) { return { se: se, completedSets: se.sets.filter(isCompletedSet) }; })
      .filter(function (x) { return x.completedSets.length > 0; });
    if (withSets.length === 0) {
      core.showToast("Add at least one set (with a weight and reps filled in) before saving.");
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
      exercises: withSets.map(function (x) {
        return {
          exerciseId: x.se.exerciseId,
          sets: x.completedSets.map(function (s) {
            return { weight: Number(s.weight), reps: Math.round(Number(s.reps)), warmup: !!s.warmup, dropset: !!s.dropset };
          })
        };
      }),
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

  // The Home tab: a hero with streak/stats, a "Continue Workout" card when a
  // draft is already in progress, today's program day(s) if any, and a
  // Quick Start grid of every routine — tapping one jumps straight into the
  // focused Log view, same as the Routines tab's "Log This" button.
  function renderWorkoutHome() {
    const core = window.JarvisCore;
    const JE = window.JarvisExercises;
    document.getElementById("homeStatStreak").textContent = dayStreak();
    document.getElementById("homeStatTotal").textContent = workouts.length;
    document.getElementById("homeStatWeek").textContent = thisWeekCount();

    const continueCard = document.getElementById("homeContinueCard");
    if (draft.exercises.length > 0) {
      continueCard.classList.remove("hidden");
      document.getElementById("homeContinueText").textContent =
        draft.exercises.length + " exercise" + (draft.exercises.length === 1 ? "" : "s") + " in progress.";
    } else {
      continueCard.classList.add("hidden");
    }

    function quickStartCardHtml(cls, id, icon, title, meta) {
      return (
        '<button type="button" class="quick-start-card ' + cls + '" data-id="' + core.escapeHtml(id) + '">' +
          '<span class="quick-start-icon">' + icon + '</span>' +
          '<span class="quick-start-title">' + core.escapeHtml(title) + '</span>' +
          '<span class="quick-start-meta">' + meta + '</span>' +
        '</button>'
      );
    }

    const todayCard = document.getElementById("homeTodayCard");
    const activePrograms = programs.filter(function (p) { return p.days.length > 0; });
    if (activePrograms.length > 0) {
      todayCard.classList.remove("hidden");
      document.getElementById("homeTodayList").innerHTML = activePrograms.map(function (p) {
        const day = p.days[p.currentIndex % p.days.length];
        const routine = routines.find(function (r) { return r.id === day.routineId; });
        const musclesTrained = routine ? getMuscleGroupsForExerciseIds(routine.exercises.map(function (re) { return re.exerciseId; })) : [];
        const icon = musclesTrained.length ? JE.iconForMuscleGroup(musclesTrained[0]) : "🏋️";
        const meta = core.escapeHtml(day.label) + (routine ? " &middot; " + core.escapeHtml(routine.name) : " &middot; routine deleted");
        return quickStartCardHtml("home-today-start-btn", p.id, icon, p.name, meta);
      }).join("");
    } else {
      todayCard.classList.add("hidden");
    }

    const grid = document.getElementById("homeQuickStartGrid");
    if (routines.length === 0) {
      grid.innerHTML = '<div class="empty-state">No routines yet — build one in the Routines tab to see it here.</div>';
    } else {
      grid.innerHTML = routines.map(function (r) {
        const musclesTrained = getMuscleGroupsForExerciseIds(r.exercises.map(function (re) { return re.exerciseId; }));
        const icon = musclesTrained.length ? JE.iconForMuscleGroup(musclesTrained[0]) : "🏋️";
        const meta = r.exercises.length + " exercise" + (r.exercises.length === 1 ? "" : "s");
        return quickStartCardHtml("home-routine-start-btn", r.id, icon, r.name, meta);
      }).join("");
    }
  }

  function handleHomeClick(e) {
    if (e.target.closest("#homeContinueBtn") || e.target.closest("#homeFreestyleBtn")) {
      switchToWorkoutSubTab("workout-log");
      return;
    }
    const routineBtn = e.target.closest(".home-routine-start-btn");
    if (routineBtn) { startRoutineNow(routineBtn.getAttribute("data-id")); return; }
    const todayBtn = e.target.closest(".home-today-start-btn");
    if (todayBtn) { startProgramToday(todayBtn.getAttribute("data-id")); return; }
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
        '<div class="list-item" data-exercise-id="' + core.escapeHtml(ex.id) + '" style="cursor:pointer;">' +
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
  let routineBuilderSelected = []; // indices into routineBuilder.exercises, checked for "group as superset"

  // Set-editor state for whichever exercise is currently being configured
  // (either a brand-new one about to be added, or an existing routine-
  // builder entry being edited in place).
  let setEditorRows = [];
  let setEditorEditIndex = null; // null = adding new; otherwise index into routineBuilder.exercises

  const SET_TYPES = [
    { value: "normal", label: "Normal" },
    { value: "warmup", label: "Warm-up" },
    { value: "dropset", label: "Drop Set" }
  ];

  function setTypeLabel(type) {
    const found = SET_TYPES.filter(function (t) { return t.value === type; })[0];
    return found ? found.label : "Normal";
  }

  function setTypeOptionsHtml(selected) {
    return SET_TYPES.map(function (t) {
      return '<option value="' + t.value + '"' + (t.value === (selected || "normal") ? " selected" : "") + '>' + t.label + '</option>';
    }).join("");
  }

  // Reads a routine-exercise entry in whichever schema it's stored in.
  // Older saved routines used targetSets/targetReps/repsPerSet (all-normal
  // sets, no per-set type) — this reads either shape as a plain array of
  // { reps, type } so the rest of the app only ever deals with one shape.
  // Saving always writes the new plannedSets shape.
  function getPlannedSets(re) {
    if (re.plannedSets) return re.plannedSets;
    const sets = [];
    const count = re.targetSets || 1;
    for (let i = 0; i < count; i++) {
      const reps = (re.repsPerSet && re.repsPerSet[i] !== undefined) ? re.repsPerSet[i] : (re.targetReps || 10);
      sets.push({ reps: reps, type: "normal" });
    }
    return sets;
  }

  function formatPlannedSetsSummary(re) {
    const sets = getPlannedSets(re);
    const parts = sets.map(function (s) {
      return s.type && s.type !== "normal" ? s.reps + " (" + setTypeLabel(s.type).toLowerCase() + ")" : String(s.reps);
    });
    return sets.length + " set" + (sets.length === 1 ? "" : "s") + ": " + parts.join(", ") + " reps";
  }

  /* ---- set editor (shared by "add a new exercise" and "edit an existing one") ---- */

  function renderSetEditorRows() {
    const container = document.getElementById("routineSetEditorRows");
    if (!container) return;
    container.innerHTML = setEditorRows.map(function (row, i) {
      return (
        '<div class="form-row two-col routine-set-editor-row" data-index="' + i + '">' +
          '<div>' +
            '<label>Set ' + (i + 1) + ' reps</label>' +
            '<input type="number" class="routine-set-reps-input" min="1" step="1" value="' + row.reps + '" data-index="' + i + '">' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:flex-end;">' +
            '<div style="flex:1;">' +
              '<label>Type</label>' +
              '<select class="routine-set-type-select" data-index="' + i + '">' + setTypeOptionsHtml(row.type) + '</select>' +
            '</div>' +
            '<button type="button" class="btn-icon danger routine-set-remove-btn" data-index="' + i + '" aria-label="Remove set">&times;</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function resetSetEditor() {
    setEditorRows = [{ reps: 10, type: "normal" }, { reps: 10, type: "normal" }, { reps: 10, type: "normal" }];
    setEditorEditIndex = null;
    document.getElementById("addExerciseToRoutineBtn").textContent = "Add to Routine";
    document.getElementById("routineCancelEditExerciseBtn").classList.add("hidden");
    renderSetEditorRows();
  }

  function loadSetEditorFromEntry(index) {
    setEditorRows = getPlannedSets(routineBuilder.exercises[index]).map(function (s) { return Object.assign({}, s); });
    setEditorEditIndex = index;
    document.getElementById("addExerciseToRoutineBtn").textContent = "Update Exercise";
    document.getElementById("routineCancelEditExerciseBtn").classList.remove("hidden");
    renderSetEditorRows();
    document.getElementById("routineSetEditorRows").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleSetEditorRowsClick(e) {
    const removeBtn = e.target.closest(".routine-set-remove-btn");
    if (!removeBtn) return;
    const index = Number(removeBtn.getAttribute("data-index"));
    setEditorRows.splice(index, 1);
    renderSetEditorRows();
  }

  function handleSetEditorRowsChange(e) {
    const index = Number(e.target.getAttribute("data-index"));
    if (isNaN(index)) return;
    if (e.target.classList.contains("routine-set-reps-input")) {
      setEditorRows[index].reps = Number(e.target.value);
    } else if (e.target.classList.contains("routine-set-type-select")) {
      setEditorRows[index].type = e.target.value;
    }
  }

  function handleAddSetRow() {
    const last = setEditorRows[setEditorRows.length - 1];
    setEditorRows.push({ reps: last ? last.reps : 10, type: "normal" });
    renderSetEditorRows();
  }

  /* ---- builder list (exercises already added to the routine being built) ---- */

  function superscriptGroupLabels() {
    // Assigns a stable, human-friendly letter (A, B, C...) to each distinct
    // supersetGroup id, in the order it first appears.
    const labels = {};
    let next = 0;
    routineBuilder.exercises.forEach(function (re) {
      if (re.supersetGroup && !(re.supersetGroup in labels)) {
        labels[re.supersetGroup] = String.fromCharCode(65 + next);
        next++;
      }
    });
    return labels;
  }

  function renderRoutineBuilderList() {
    const core = window.JarvisCore;
    const container = document.getElementById("routineBuilderList");
    const muscleGroupsEl = document.getElementById("routineBuilderMuscleGroups");
    const musclesTrained = getMuscleGroupsForExerciseIds(routineBuilder.exercises.map(function (re) { return re.exerciseId; }));
    muscleGroupsEl.innerHTML = muscleGroupBadgesHtml(musclesTrained);
    const groupLabels = superscriptGroupLabels();
    const groupBtn = document.getElementById("routineGroupSupersetBtn");
    if (groupBtn) groupBtn.disabled = routineBuilderSelected.length < 2;
    if (routineBuilder.exercises.length === 0) {
      container.innerHTML = '<div class="empty-state">No exercises added to this routine yet.</div>';
      return;
    }
    container.innerHTML = routineBuilder.exercises.map(function (re, i) {
      const ex = window.JarvisExercises.getExerciseById(re.exerciseId);
      const exName = ex ? ex.name : "Unknown exercise";
      const groupBadge = re.supersetGroup
        ? '<span class="badge badge-yellow">Superset ' + core.escapeHtml(groupLabels[re.supersetGroup]) + '</span> ' +
          '<button type="button" class="btn-icon routine-builder-ungroup-btn" data-index="' + i + '">Ungroup</button>'
        : "";
      const checked = routineBuilderSelected.indexOf(i) !== -1 ? " checked" : "";
      return (
        '<div class="list-item">' +
          '<div class="list-item-row">' +
            '<input type="checkbox" class="routine-builder-select" data-index="' + i + '"' + checked + ' aria-label="Select ' + core.escapeHtml(exName) + ' for grouping" style="margin-right:10px;">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(exName) + ' ' + groupBadge + '</span>' +
              '<span class="list-item-meta">' + core.escapeHtml(formatPlannedSetsSummary(re)) + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon routine-builder-edit-btn" data-index="' + i + '">Edit</button>' +
              '<button type="button" class="btn-icon danger routine-builder-remove-btn" data-index="' + i + '">Remove</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleAddExerciseToRoutine() {
    const core = window.JarvisCore;
    if (setEditorRows.length === 0) { core.showToast("Add at least one set."); return; }
    if (setEditorRows.some(function (s) { return !core.isPositiveNumber(s.reps); })) {
      core.showToast("Every set needs a positive number of reps.");
      return;
    }
    const plannedSets = setEditorRows.map(function (s) { return { reps: Math.round(s.reps), type: s.type || "normal" }; });

    if (setEditorEditIndex !== null) {
      routineBuilder.exercises[setEditorEditIndex].plannedSets = plannedSets;
    } else {
      const exerciseId = document.getElementById("routinePickerSelect").value;
      if (!exerciseId) { core.showToast("Choose an exercise first."); return; }
      routineBuilder.exercises.push({ exerciseId: exerciseId, supersetGroup: null, plannedSets: plannedSets });
    }
    resetSetEditor();
    renderRoutineBuilderList();
  }

  function handleRoutineBuilderListClick(e) {
    const selectCheckbox = e.target.closest(".routine-builder-select");
    if (selectCheckbox) {
      const index = Number(selectCheckbox.getAttribute("data-index"));
      const pos = routineBuilderSelected.indexOf(index);
      if (selectCheckbox.checked && pos === -1) routineBuilderSelected.push(index);
      if (!selectCheckbox.checked && pos !== -1) routineBuilderSelected.splice(pos, 1);
      document.getElementById("routineGroupSupersetBtn").disabled = routineBuilderSelected.length < 2;
      return;
    }
    const editBtn = e.target.closest(".routine-builder-edit-btn");
    if (editBtn) { loadSetEditorFromEntry(Number(editBtn.getAttribute("data-index"))); return; }
    const ungroupBtn = e.target.closest(".routine-builder-ungroup-btn");
    if (ungroupBtn) {
      const index = Number(ungroupBtn.getAttribute("data-index"));
      const groupId = routineBuilder.exercises[index].supersetGroup;
      routineBuilder.exercises.forEach(function (re) { if (re.supersetGroup === groupId) re.supersetGroup = null; });
      renderRoutineBuilderList();
      return;
    }
    const removeBtn = e.target.closest(".routine-builder-remove-btn");
    if (removeBtn) {
      const index = Number(removeBtn.getAttribute("data-index"));
      routineBuilder.exercises.splice(index, 1);
      routineBuilderSelected = [];
      if (setEditorEditIndex === index) resetSetEditor();
      renderRoutineBuilderList();
    }
  }

  function handleGroupSuperset() {
    if (routineBuilderSelected.length < 2) return;
    const core = window.JarvisCore;
    const groupId = core.uid("sg");
    routineBuilderSelected.forEach(function (index) {
      if (routineBuilder.exercises[index]) routineBuilder.exercises[index].supersetGroup = groupId;
    });
    routineBuilderSelected = [];
    renderRoutineBuilderList();
  }

  function exitRoutineEditMode() {
    routineBuilder = { editId: null, exercises: [] };
    routineBuilderSelected = [];
    document.getElementById("routineEditId").value = "";
    document.getElementById("routineNameInput").value = "";
    document.getElementById("routineFormTitle").textContent = "Create a Routine";
    document.getElementById("saveRoutineBtn").textContent = "Save Routine";
    document.getElementById("routineCancelEditBtn").classList.add("hidden");
    resetSetEditor();
    renderRoutineBuilderList();
  }

  function enterRoutineEditMode(routine) {
    routineBuilder = {
      editId: routine.id,
      exercises: routine.exercises.map(function (e) {
        return { exerciseId: e.exerciseId, supersetGroup: e.supersetGroup || null, plannedSets: getPlannedSets(e).map(function (s) { return Object.assign({}, s); }) };
      })
    };
    routineBuilderSelected = [];
    document.getElementById("routineEditId").value = routine.id;
    document.getElementById("routineNameInput").value = routine.name;
    document.getElementById("routineFormTitle").textContent = "Edit Routine";
    document.getElementById("saveRoutineBtn").textContent = "Update Routine";
    document.getElementById("routineCancelEditBtn").classList.remove("hidden");
    resetSetEditor();
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

  /* ---------------- "Generate a Routine" wizard ---------------- */

  function initRoutineGenerator() {
    window.JarvisExercises.EQUIPMENT_TYPES.forEach(function (eq) { routineGenerator.equipment[eq] = true; });
  }

  function handleGeneratorToggle() {
    const body = document.getElementById("generatorBody");
    const btn = document.getElementById("generatorToggleBtn");
    const nowHidden = body.classList.toggle("hidden");
    btn.textContent = nowHidden ? "+ Build For Me" : "Hide";
    if (!nowHidden) renderRoutineGenerator();
  }

  function renderRoutineGenerator() {
    const core = window.JarvisCore;

    document.getElementById("generatorGoalGrid").innerHTML = GENERATOR_GOALS.map(function (g) {
      const selectedCls = g.id === routineGenerator.goal ? " selected" : "";
      return (
        '<div class="goal-card' + selectedCls + '" data-id="' + g.id + '">' +
          '<span class="goal-card-icon">' + g.icon + '</span>' +
          '<span class="goal-card-label">' + core.escapeHtml(g.label) + '</span>' +
        '</div>'
      );
    }).join("");

    document.getElementById("generatorDaysPerWeekRow").innerHTML = [2, 3, 4, 5, 6].map(function (n) {
      const selectedCls = n === routineGenerator.daysPerWeek ? " active" : "";
      return '<button type="button" class="muscle-chip' + selectedCls + '" data-days="' + n + '">' + n + '</button>';
    }).join("");

    document.getElementById("generatorTrainingDaysHint").textContent =
      "Pick " + routineGenerator.daysPerWeek + " to match Days Per Week (" + routineGenerator.trainingDays.length + " picked). Jarvis spaces the split across them in order.";

    document.getElementById("generatorTrainingDaysRow").innerHTML = WEEKDAY_SHORT.map(function (label, i) {
      const selectedCls = routineGenerator.trainingDays.indexOf(i) !== -1 ? " selected" : "";
      return '<button type="button" class="day-picker-btn' + selectedCls + '" data-day="' + i + '" aria-label="' + WEEKDAY_LABELS[i] + '" title="' + WEEKDAY_LABELS[i] + '">' + label + '</button>';
    }).join("");

    document.getElementById("generatorEquipmentList").innerHTML = window.JarvisExercises.EQUIPMENT_TYPES.map(function (eq) {
      const checkedCls = routineGenerator.equipment[eq] ? " checked" : "";
      return (
        '<div class="equipment-row' + checkedCls + '" data-equipment="' + core.escapeHtml(eq) + '">' +
          '<span class="equipment-row-label">' + core.escapeHtml(eq) + '</span>' +
          '<span class="equipment-check">&#10003;</span>' +
        '</div>'
      );
    }).join("");
  }

  function handleGeneratorGoalClick(e) {
    const card = e.target.closest(".goal-card");
    if (!card) return;
    routineGenerator.goal = card.getAttribute("data-id");
    renderRoutineGenerator();
  }

  function handleGeneratorDaysPerWeekClick(e) {
    const btn = e.target.closest(".muscle-chip");
    if (!btn) return;
    routineGenerator.daysPerWeek = Number(btn.getAttribute("data-days"));
    // Keep already-picked training days if they still fit; the hint/count
    // will guide the user to adjust rather than silently clearing picks.
    renderRoutineGenerator();
  }

  function handleGeneratorTrainingDayClick(e) {
    const btn = e.target.closest(".day-picker-btn");
    if (!btn) return;
    const day = Number(btn.getAttribute("data-day"));
    const idx = routineGenerator.trainingDays.indexOf(day);
    if (idx !== -1) {
      routineGenerator.trainingDays.splice(idx, 1);
    } else {
      routineGenerator.trainingDays.push(day);
    }
    renderRoutineGenerator();
  }

  function handleGeneratorEquipmentClick(e) {
    const row = e.target.closest(".equipment-row");
    if (!row) return;
    const eq = row.getAttribute("data-equipment");
    routineGenerator.equipment[eq] = !routineGenerator.equipment[eq];
    renderRoutineGenerator();
  }

  // Picks one exercise for a muscle group, respecting the allowed-equipment
  // list with a graceful fallback (ignore the equipment filter entirely)
  // when nothing in that group matches it, so a routine never ends up with
  // a missing slot just because of an unusual equipment combination.
  // Bodyweight exercises are always eligible since they need no equipment.
  // usedIds keeps the same day from repeating an exercise it already picked;
  // seed varies the pick across calls so different days/slots get variety
  // instead of always grabbing the first match.
  function pickExerciseForGroup(muscleGroup, allowedEquipment, usedIds, seed) {
    const all = window.JarvisExercises.getExercises().filter(function (ex) { return ex.muscleGroup === muscleGroup; });
    if (all.length === 0) return null;
    let candidates = all.filter(function (ex) { return allowedEquipment.indexOf(ex.equipment) !== -1 || ex.equipment === "Bodyweight"; });
    if (candidates.length === 0) candidates = all;
    const unused = candidates.filter(function (ex) { return usedIds.indexOf(ex.id) === -1; });
    const pool = unused.length > 0 ? unused : candidates;
    return pool[seed % pool.length];
  }

  function uniqueName(existingNames, base) {
    if (existingNames.indexOf(base) === -1) return base;
    let n = 2;
    while (existingNames.indexOf(base + " " + n) !== -1) n++;
    return base + " " + n;
  }

  function handleGenerateRoutine() {
    const core = window.JarvisCore;
    const daysPerWeek = routineGenerator.daysPerWeek;
    const trainingDays = routineGenerator.trainingDays.slice().sort(function (a, b) { return a - b; });
    const allowedEquipment = Object.keys(routineGenerator.equipment).filter(function (eq) { return routineGenerator.equipment[eq]; });

    if (trainingDays.length !== daysPerWeek) {
      core.showToast("Pick exactly " + daysPerWeek + " training day" + (daysPerWeek === 1 ? "" : "s") + " to match Days Per Week.");
      return;
    }
    if (allowedEquipment.length === 0) {
      core.showToast("Select at least one equipment type.");
      return;
    }

    const template = GENERATOR_SPLITS[daysPerWeek];
    const scheme = GENERATOR_GOAL_SCHEMES[routineGenerator.goal];
    let seed = 0;
    const newRoutineIds = [];

    template.forEach(function (dayTemplate) {
      const usedIds = [];
      const exercises = [];
      dayTemplate.groups.forEach(function (group) {
        const ex = pickExerciseForGroup(group, allowedEquipment, usedIds, seed++);
        if (!ex) return;
        usedIds.push(ex.id);
        const plan = exercises.length === 0 ? scheme.primary : scheme.accessory;
        const plannedSets = [];
        for (let i = 0; i < plan.sets; i++) plannedSets.push({ reps: plan.reps, type: "normal" });
        exercises.push({ exerciseId: ex.id, supersetGroup: null, plannedSets: plannedSets });
      });
      const name = uniqueName(routines.map(function (r) { return r.name; }), dayTemplate.label + " (Generated)");
      const routine = { id: core.uid("routine"), name: name, exercises: exercises, createdAt: Date.now() };
      routines.push(routine);
      newRoutineIds.push(routine.id);
    });
    saveRoutines();

    const programDays = trainingDays.map(function (dayIdx, i) {
      return { id: core.uid("pday"), label: WEEKDAY_LABELS[dayIdx], routineId: newRoutineIds[i] };
    });
    const programName = uniqueName(programs.map(function (p) { return p.name; }), "Generated " + daysPerWeek + "-Day Plan");
    programs.push({ id: core.uid("program"), name: programName, days: programDays, currentIndex: 0, createdAt: Date.now() });
    savePrograms();

    renderRoutineList();
    renderProgramList();
    populateRoutineSelect();
    populateProgramDayRoutineSelect();
    renderWorkoutHome();
    core.showToast("Created " + template.length + " routines and “" + programName + "” — find it in Programs, or start today's from Home.");
    routineGenerator.trainingDays = [];
    renderRoutineGenerator();
  }

  function renderRoutineList() {
    const core = window.JarvisCore;
    const container = document.getElementById("routineList");
    if (routines.length === 0) {
      container.innerHTML = '<div class="empty-state">No routines yet. Build one above.</div>';
      return;
    }
    container.innerHTML = routines.map(function (r) {
      const groupLabels = {};
      let nextLabel = 0;
      r.exercises.forEach(function (re) {
        if (re.supersetGroup && !(re.supersetGroup in groupLabels)) { groupLabels[re.supersetGroup] = String.fromCharCode(65 + nextLabel); nextLabel++; }
      });
      const exLines = r.exercises.map(function (re) {
        const ex = window.JarvisExercises.getExerciseById(re.exerciseId);
        const exName = ex ? ex.name : "Unknown exercise";
        const groupTag = re.supersetGroup ? ' <span class="badge badge-yellow">Superset ' + core.escapeHtml(groupLabels[re.supersetGroup]) + '</span>' : "";
        return '<span class="list-item-meta">' + core.escapeHtml(exName) + groupTag + ": " + core.escapeHtml(formatPlannedSetsSummary(re)) + '</span>';
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

  // Shared by the Routines tab's "Log This" button and the Home tab's
  // Quick Start cards — both just want to load a routine and jump into it.
  function startRoutineNow(id) {
    document.getElementById("sessionRoutineSelect").value = id;
    loadRoutineIntoDraft(id);
    switchToWorkoutSubTab("workout-log");
  }

  function startProgramToday(id) {
    const program = programs.find(function (p) { return p.id === id; });
    if (!program || program.days.length === 0) return;
    const day = program.days[program.currentIndex % program.days.length];
    const routine = routines.find(function (r) { return r.id === day.routineId; });
    if (!routine) { window.JarvisCore.showToast("That day's routine no longer exists — edit the program to fix it."); return; }
    document.getElementById("sessionRoutineSelect").value = day.routineId;
    loadRoutineIntoDraft(day.routineId, { programId: program.id, programDayId: day.id });
    switchToWorkoutSubTab("workout-log");
  }

  function handleRoutineListClick(e) {
    const startBtn = e.target.closest(".routine-start-btn");
    if (startBtn) {
      startRoutineNow(startBtn.getAttribute("data-id"));
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
      startProgramToday(startBtn.getAttribute("data-id"));
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

  /* ---------------- Progress: shared state ---------------- */

  let bodyMapMode = "strength"; // "strength" | "readiness"
  let bodyMapSide = "front"; // "front" | "back" — which single body is shown
  let selectedMuscle = null; // persists across mode/side switches
  let muscleSheetExpanded = false;
  let muscleSheetHistoryOpen = false;
  let exerciseChartRangeDays = null; // null = all time
  let bodyweightChartRangeDays = null;
  let editingBodyweightId = null;
  let editingMeasurementId = null;

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
              '<button type="button" class="btn-icon bodyweight-edit-btn" data-id="' + core.escapeHtml(e.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger bodyweight-delete-btn" data-id="' + core.escapeHtml(e.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function populateBodyweightFormForEdit(id) {
    const entry = bodyweightEntries.find(function (x) { return x.id === id; });
    if (!entry) return;
    editingBodyweightId = id;
    document.getElementById("bodyweightEditId").value = id;
    document.getElementById("bodyweightInput").value = entry.weight;
    document.getElementById("bodyweightUnit").value = entry.unit;
    document.getElementById("bodyweightDate").value = entry.date;
    document.getElementById("bodyweightSubmitBtn").textContent = "Update Body Weight";
    document.getElementById("bodyweightFormCancelBtn").classList.remove("hidden");
  }

  function resetBodyweightForm() {
    editingBodyweightId = null;
    document.getElementById("bodyweightForm").reset();
    document.getElementById("bodyweightEditId").value = "";
    document.getElementById("bodyweightDate").value = "";
    document.getElementById("bodyweightSubmitBtn").textContent = "Log Body Weight";
    document.getElementById("bodyweightFormCancelBtn").classList.add("hidden");
  }

  function handleBodyweightSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const weight = Number(document.getElementById("bodyweightInput").value);
    const unit = document.getElementById("bodyweightUnit").value;
    const date = document.getElementById("bodyweightDate").value || core.todayISODate();
    if (!core.isPositiveNumber(weight)) { core.showToast("Weight must be a positive number."); return; }
    const wasEditing = !!editingBodyweightId;
    if (editingBodyweightId) {
      const entry = bodyweightEntries.find(function (x) { return x.id === editingBodyweightId; });
      if (entry) { entry.weight = weight; entry.unit = unit; entry.date = date; }
    } else {
      bodyweightEntries.push({ id: core.uid("bw"), weight: weight, unit: unit, date: date, createdAt: Date.now() });
    }
    saveBodyweight();
    resetBodyweightForm();
    renderBodyweightList();
    renderStrengthSection();
    renderProgressTab();
    core.showToast(wasEditing ? "Body weight updated." : "Body weight logged.");
  }

  function handleBodyweightListClick(e) {
    const editBtn = e.target.closest(".bodyweight-edit-btn");
    if (editBtn) { populateBodyweightFormForEdit(editBtn.getAttribute("data-id")); return; }
    const btn = e.target.closest(".bodyweight-delete-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!window.confirm("Delete this body weight entry? This can't be undone.")) return;
    bodyweightEntries = bodyweightEntries.filter(function (x) { return x.id !== id; });
    if (editingBodyweightId === id) resetBodyweightForm();
    saveBodyweight();
    renderBodyweightList();
    renderStrengthSection();
    renderProgressTab();
  }

  function computeBodyweightStats() {
    if (bodyweightEntries.length === 0) return null;
    const sorted = bodyweightEntries.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    const lbEntries = sorted.map(function (e) { return { date: e.date, lb: toLb(e.weight, e.unit) }; });
    const current = lbEntries[lbEntries.length - 1].lb;
    const starting = lbEntries[0].lb;
    let highest = -Infinity, lowest = Infinity;
    lbEntries.forEach(function (e) { if (e.lb > highest) highest = e.lb; if (e.lb < lowest) lowest = e.lb; });
    const cutoff = Date.now() - 30 * 86400000;
    const recent = lbEntries.filter(function (e) { return new Date(e.date).getTime() >= cutoff; });
    const avgRecent = recent.length ? recent.reduce(function (s, e) { return s + e.lb; }, 0) / recent.length : current;
    return { current: current, starting: starting, change: current - starting, highest: highest, lowest: lowest, avgRecent: avgRecent };
  }

  // Reads the Nutrition module's own stored profile directly (read-only) so
  // the Bodyweight trend can show a target line without duplicating target-
  // weight storage. Tolerates it being missing/malformed — no target shown.
  function getNutritionTargetWeightLb() {
    try {
      const raw = localStorage.getItem("jarvisNutritionProfile");
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || typeof p.targetWeightKg !== "number" || !isFinite(p.targetWeightKg) || p.targetWeightKg <= 0) return null;
      return p.targetWeightKg * 2.20462;
    } catch (e) {
      return null;
    }
  }

  function renderBodyweightChart(containerId, rangeDays) {
    const core = window.JarvisCore;
    if (bodyweightEntries.length === 0) {
      renderLineChart(containerId, [], { emptyMessage: "Log a couple of body weight entries to see a trend line." });
      return;
    }
    const sorted = bodyweightEntries.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    let points = sorted.map(function (e) { return { t: new Date(e.date).getTime(), v: toLb(e.weight, e.unit), label: core.formatDate(e.date) }; });
    if (rangeDays !== null && rangeDays !== undefined) {
      const cutoff = Date.now() - rangeDays * 86400000;
      points = points.filter(function (p) { return p.t >= cutoff; });
    }
    renderLineChart(containerId, points, {
      emptyMessage: "Log a couple of body weight entries to see a trend line.",
      yFormat: function (v) { return Math.round(v * 10) / 10 + " lb"; },
      ariaLabel: "Body weight trend",
      targetY: getNutritionTargetWeightLb()
    });
  }

  function renderBodyweightTab() {
    const stats = computeBodyweightStats();
    const statsEl = document.getElementById("bodyweightStats");
    if (!stats) {
      statsEl.innerHTML = '<div class="empty-state-compact">Log your body weight to see stats here.</div>';
    } else {
      const changeCls = stats.change > 0 ? "positive" : stats.change < 0 ? "negative" : "";
      statsEl.innerHTML =
        statBoxHtml(Math.round(stats.current * 10) / 10 + " lb", "Current") +
        statBoxHtml(Math.round(stats.starting * 10) / 10 + " lb", "Starting") +
        '<div class="stat-box"><span class="stat-value ' + changeCls + '">' + (stats.change >= 0 ? "+" : "") + Math.round(stats.change * 10) / 10 + ' lb</span><span class="stat-label">Change</span></div>' +
        statBoxHtml(Math.round(stats.highest * 10) / 10 + " lb", "Highest") +
        statBoxHtml(Math.round(stats.lowest * 10) / 10 + " lb", "Lowest") +
        statBoxHtml(Math.round(stats.avgRecent * 10) / 10 + " lb", "Avg (30d)");
    }
    renderBodyweightChart("bodyweightChart", bodyweightChartRangeDays);

    const targetLb = getNutritionTargetWeightLb();
    const noteEl = document.getElementById("bodyweightTargetNote");
    if (targetLb && stats) {
      noteEl.textContent = "Target weight from your Nutrition goals: " + Math.round(targetLb) + " lb (dashed line on the chart).";
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
    }
  }

  function handleBodyweightRangeClick(e) {
    const btn = e.target.closest(".bw-range-btn");
    if (!btn) return;
    document.querySelectorAll("#bodyweightRangeToggle .bw-range-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    const r = btn.getAttribute("data-range");
    bodyweightChartRangeDays = r === "all" ? null : Number(r);
    renderBodyweightChart("bodyweightChart", bodyweightChartRangeDays);
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
              '<button type="button" class="btn-icon measurement-edit-btn" data-id="' + core.escapeHtml(m.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger measurement-delete-btn" data-id="' + core.escapeHtml(m.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function populateMeasurementFormForEdit(id) {
    const m = measurements.find(function (x) { return x.id === id; });
    if (!m) return;
    editingMeasurementId = id;
    document.getElementById("measurementEditId").value = id;
    document.getElementById("measurementType").value = m.type;
    document.getElementById("measurementValue").value = m.value;
    document.getElementById("measurementUnit").value = m.unit;
    document.getElementById("measurementDate").value = m.date;
    document.getElementById("measurementSubmitBtn").textContent = "Update Measurement";
    document.getElementById("measurementFormCancelBtn").classList.remove("hidden");
  }

  function resetMeasurementForm() {
    editingMeasurementId = null;
    document.getElementById("measurementForm").reset();
    document.getElementById("measurementEditId").value = "";
    document.getElementById("measurementDate").value = "";
    document.getElementById("measurementSubmitBtn").textContent = "Log Measurement";
    document.getElementById("measurementFormCancelBtn").classList.add("hidden");
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
    const wasEditing = !!editingMeasurementId;
    if (editingMeasurementId) {
      const m = measurements.find(function (x) { return x.id === editingMeasurementId; });
      if (m) { m.type = type; m.value = value; m.unit = unit; m.date = date; }
    } else {
      measurements.push({ id: core.uid("meas"), type: type, value: value, unit: unit, date: date, createdAt: Date.now() });
    }
    saveMeasurements();
    resetMeasurementForm();
    renderMeasurementList();
    renderProgressTab();
    core.showToast(wasEditing ? "Measurement updated." : "Measurement logged.");
  }

  function handleMeasurementListClick(e) {
    const editBtn = e.target.closest(".measurement-edit-btn");
    if (editBtn) { populateMeasurementFormForEdit(editBtn.getAttribute("data-id")); return; }
    const btn = e.target.closest(".measurement-delete-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!window.confirm("Delete this measurement entry? This can't be undone.")) return;
    measurements = measurements.filter(function (x) { return x.id !== id; });
    if (editingMeasurementId === id) resetMeasurementForm();
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
    const compareEl = document.getElementById("measurementCompareStat");
    if (!type) {
      renderLineChart("measurementChart", [], { emptyMessage: "Log a couple of measurements for this body part to see a trend line." });
      if (compareEl) compareEl.innerHTML = "";
      return;
    }
    // Measurements are shown in whatever unit they were logged in — no
    // cross-unit conversion, unlike body weight's lb normalization.
    const typeEntries = measurements
      .filter(function (m) { return m.type === type; })
      .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    const rawPoints = typeEntries.map(function (m) { return { t: new Date(m.date).getTime(), v: m.value, label: core.formatDate(m.date) }; });
    const unit = typeEntries.length ? typeEntries[0].unit : "";
    renderLineChart("measurementChart", rawPoints, {
      emptyMessage: "Log a couple of measurements for this body part to see a trend line.",
      yFormat: function (v) { return v.toFixed(1) + " " + unit; },
      ariaLabel: type + " measurement trend"
    });

    if (!compareEl) return;
    if (typeEntries.length === 0) {
      compareEl.innerHTML = "";
      return;
    }
    const currentEntry = typeEntries[typeEntries.length - 1];
    const previousEntry = typeEntries.length > 1 ? typeEntries[typeEntries.length - 2] : null;
    let html = statBoxHtml(currentEntry.value.toFixed(1) + " " + currentEntry.unit, "Current");
    if (previousEntry) {
      const change = currentEntry.value - previousEntry.value;
      const cls = change > 0 ? "positive" : change < 0 ? "negative" : "";
      html += statBoxHtml(previousEntry.value.toFixed(1) + " " + previousEntry.unit, "Previous");
      html += '<div class="stat-box"><span class="stat-value ' + cls + '">' + (change >= 0 ? "+" : "") + change.toFixed(1) + ' ' + currentEntry.unit + '</span><span class="stat-label">Change</span></div>';
    }
    compareEl.innerHTML = html;
  }

  function statBoxHtml(value, label) {
    return '<div class="stat-box"><span class="stat-value">' + value + '</span><span class="stat-label">' + label + '</span></div>';
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
      levelEl.textContent = "Not enough data yet — log your body weight to see your Strength Score.";
      listEl.innerHTML = '<div class="empty-state">Log a benchmark lift (Squat, Bench, Deadlift, Overhead Press, or Pull-Up) and your body weight.</div>';
      renderStrengthDistributionBar(null);
      return;
    }

    if (strengthSettings.compareSex === "none") {
      scoreEl.textContent = "--";
      levelEl.textContent = "Standards comparison is off. Showing your best estimated 1-rep max per lift instead.";
    } else if (result.overallScore === null) {
      scoreEl.textContent = "--";
      levelEl.textContent = "Not enough data yet — log a benchmark lift to see your score.";
    } else {
      scoreEl.textContent = Math.round(result.overallScore);
      levelEl.textContent = "Overall score across logged benchmark lifts (Squat, Bench, Deadlift, OHP, Pull-Up) vs. bodyweight-ratio standards";
    }
    renderStrengthDistributionBar(result);

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
    renderBodyMap();
    renderProgressTab();
    window.JarvisCore.showToast("Strength settings saved.");
  }

  // 6-stop color scale shared by the strength distribution bar and the body
  // map's Strength mode (gray -> blue -> purple -> green -> gold, never
  // orange/red — those are reserved for semantic warnings elsewhere).
  const STRENGTH_LEVELS = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite", "World Class"];
  const LEVEL_COLORS = {
    Beginner: "#5b6475", Novice: "#3a5f99", Intermediate: "#4f8cff",
    Advanced: "#9b6bff", Elite: "#33d17a", "World Class": "#ffc857"
  };
  function getMuscleColorForLevel(level) { return LEVEL_COLORS[level] || null; }
  function scoreToLevelLabel(score) {
    if (score >= 100 * 5 / 6) return "World Class";
    if (score >= 100 * 4 / 6) return "Elite";
    if (score >= 100 * 3 / 6) return "Advanced";
    if (score >= 100 * 2 / 6) return "Intermediate";
    if (score >= 100 * 1 / 6) return "Novice";
    return "Beginner";
  }

  // Visualizes the real 0-100 score the app already computes against its own
  // 6 bands, with a "You" marker — not a fabricated population percentile.
  function renderStrengthDistributionBar(result) {
    const container = document.getElementById("strengthDistributionBar");
    if (!container) return;
    if (!result || result.overallScore === null || strengthSettings.compareSex === "none") {
      container.innerHTML = "";
      return;
    }
    const bandsHtml = STRENGTH_LEVELS.map(function (l) { return '<div class="strength-distribution-band" style="background:' + getMuscleColorForLevel(l) + '"></div>'; }).join("");
    const pct = Math.max(2, Math.min(98, result.overallScore));
    container.innerHTML =
      '<div class="strength-distribution-track">' + bandsHtml +
        '<div class="strength-distribution-marker" style="left:' + pct + '%">You</div>' +
      '</div>' +
      '<div class="strength-distribution-labels"><span>Beginner</span><span>World Class</span></div>';
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
    const hasTarget = opts.targetY !== undefined && opts.targetY !== null && isFinite(opts.targetY);
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const maxY = Math.max.apply(null, hasTarget ? ys.concat([opts.targetY]) : ys) * 1.15 || 1;

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

    let targetLine = "";
    if (hasTarget) {
      const ty = yPos(opts.targetY);
      targetLine =
        '<line x1="' + padding.left + '" y1="' + ty.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + ty.toFixed(1) + '" stroke="var(--purple)" stroke-width="1.5" stroke-dasharray="4,4"/>' +
        '<text x="' + (width - padding.right) + '" y="' + (ty - 4).toFixed(1) + '" font-size="10" fill="var(--purple)" text-anchor="end">Target</text>';
    }

    container.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" class="progress-chart-svg" role="img" aria-label="' + core.escapeHtml(opts.ariaLabel || "progress chart") + '">' +
        gridLines +
        targetLine +
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

  function selectExerciseAndRenderDetail(exerciseId) {
    document.getElementById("progressExerciseSelect").value = exerciseId;
    renderExerciseDetail();
  }

  function jumpToExercise(exerciseId) {
    const tabBtn = document.getElementById("progressMainTabExercises");
    if (tabBtn) tabBtn.click();
    selectExerciseAndRenderDetail(exerciseId);
  }

  function filterPointsByRange(points, rangeDays) {
    if (rangeDays === null || rangeDays === undefined) return points;
    const cutoff = Date.now() - rangeDays * 86400000;
    return points.filter(function (p) { return p.t >= cutoff; });
  }

  function renderExerciseDetail() {
    const core = window.JarvisCore;
    const JE = window.JarvisExercises;
    const exerciseId = document.getElementById("progressExerciseSelect").value;
    const e1rmEl = document.getElementById("progressCurrentE1rm");
    const prEl = document.getElementById("progressAllTimePr");
    const bestWeightEl = document.getElementById("progressBestWeight");
    const bestRepsEl = document.getElementById("progressBestReps");
    const totalSetsEl = document.getElementById("progressTotalSets");
    const totalRepsEl = document.getElementById("progressTotalReps");
    const recentVolumeEl = document.getElementById("progressRecentVolume");
    const countEl = document.getElementById("progressSessionCount");
    const lastPerformedEl = document.getElementById("progressLastPerformed");

    if (!exerciseId) {
      [e1rmEl, prEl, bestWeightEl, bestRepsEl, recentVolumeEl, lastPerformedEl].forEach(function (el) { el.textContent = "--"; });
      totalSetsEl.textContent = "0";
      totalRepsEl.textContent = "0";
      countEl.textContent = "0";
      renderLineChart("exerciseProgressChart", [], { emptyMessage: "Log a couple of sessions for this exercise to see a trend line." });
      renderLineChart("exerciseVolumeChart", [], { emptyMessage: "Log a couple of sessions for this exercise to see a trend line." });
      renderLineChart("exerciseBestWeightChart", [], { emptyMessage: "Log a couple of sessions for this exercise to see a trend line." });
      renderPrHistoryList(null);
      return;
    }

    const e1rmPoints = [], volumePoints = [], bestWeightPoints = [];
    let allTimeBest = null, totalSets = 0, totalReps = 0, maxReps = 0, recentVolume = 0, lastPerformed = null;
    const recentCutoff = Date.now() - 28 * 86400000;

    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      const se = w.exercises.find(function (x) { return x.exerciseId === exerciseId; });
      if (!se || se.sets.length === 0) return;
      const t = new Date(w.dateTime || w.date).getTime();
      let bestE1rmThisSession = 0, sessionVolume = 0, bestWeightThisSession = 0;
      se.sets.forEach(function (s) {
        const e1rm = JE.estimateOneRepMax(s.weight, s.reps);
        if (e1rm > bestE1rmThisSession) bestE1rmThisSession = e1rm;
        sessionVolume += (Number(s.weight) || 0) * (Number(s.reps) || 0);
        if (s.weight > bestWeightThisSession) bestWeightThisSession = s.weight;
        if (s.reps > maxReps) maxReps = s.reps;
        if (!allTimeBest || s.weight > allTimeBest.weight || (s.weight === allTimeBest.weight && s.reps > allTimeBest.reps)) allTimeBest = s;
        totalSets++;
        totalReps += Number(s.reps) || 0;
      });
      if (t >= recentCutoff) recentVolume += sessionVolume;
      if (lastPerformed === null || t > lastPerformed) lastPerformed = t;
      e1rmPoints.push({ t: t, v: bestE1rmThisSession, label: core.formatDate(w.date) });
      volumePoints.push({ t: t, v: sessionVolume, label: core.formatDate(w.date) });
      bestWeightPoints.push({ t: t, v: bestWeightThisSession, label: core.formatDate(w.date) });
    });
    [e1rmPoints, volumePoints, bestWeightPoints].forEach(function (arr) { arr.sort(function (a, b) { return a.t - b.t; }); });

    countEl.textContent = e1rmPoints.length;
    e1rmEl.textContent = e1rmPoints.length ? Math.round(e1rmPoints[e1rmPoints.length - 1].v) + " lb" : "--";
    prEl.textContent = allTimeBest ? (allTimeBest.weight + " &times; " + allTimeBest.reps) : "--";
    bestWeightEl.textContent = allTimeBest ? allTimeBest.weight + " lb" : "--";
    bestRepsEl.textContent = totalSets > 0 ? maxReps : "--";
    totalSetsEl.textContent = totalSets;
    totalRepsEl.textContent = totalReps;
    recentVolumeEl.textContent = Math.round(recentVolume).toLocaleString() + " lb";
    lastPerformedEl.textContent = lastPerformed !== null ? core.formatDate(new Date(lastPerformed).toISOString().slice(0, 10)) : "--";

    const ex = JE.getExerciseById(exerciseId);
    renderLineChart("exerciseProgressChart", filterPointsByRange(e1rmPoints, exerciseChartRangeDays), {
      emptyMessage: "Log a couple of sessions for this exercise to see a trend line.",
      yFormat: function (v) { return Math.round(v) + " lb"; },
      ariaLabel: "Estimated one rep max trend for " + (ex ? ex.name : "exercise")
    });
    renderLineChart("exerciseVolumeChart", filterPointsByRange(volumePoints, exerciseChartRangeDays), {
      emptyMessage: "Log a couple of sessions for this exercise to see a trend line.",
      yFormat: function (v) { return Math.round(v).toLocaleString() + " lb"; },
      ariaLabel: "Training volume trend for " + (ex ? ex.name : "exercise")
    });
    renderLineChart("exerciseBestWeightChart", filterPointsByRange(bestWeightPoints, exerciseChartRangeDays), {
      emptyMessage: "Log a couple of sessions for this exercise to see a trend line.",
      yFormat: function (v) { return Math.round(v) + " lb"; },
      ariaLabel: "Best working weight trend for " + (ex ? ex.name : "exercise")
    });

    renderPrHistoryList(exerciseId);
  }

  function handleExerciseRangeClick(e) {
    const btn = e.target.closest(".exercise-range-btn");
    if (!btn) return;
    document.querySelectorAll("#exerciseChartRangeToggle .exercise-range-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    const r = btn.getAttribute("data-range");
    exerciseChartRangeDays = r === "all" ? null : Number(r);
    renderExerciseDetail();
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

  // Sunday-start ISO week key for a given date string, local-timezone-safe.
  function weekStartIso(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const tzOffset = start.getTimezoneOffset() * 60000;
    return new Date(start.getTime() - tzOffset).toISOString().slice(0, 10);
  }

  function renderVolumeChart() {
    const core = window.JarvisCore;
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

  function renderFrequencyChart() {
    const core = window.JarvisCore;
    const byWeek = {};
    workouts.forEach(function (w) { if (w.schema !== 2) return; const ws = weekStartIso(w.date); byWeek[ws] = (byWeek[ws] || 0) + 1; });
    const points = Object.keys(byWeek)
      .sort(function (a, b) { return new Date(a) - new Date(b); })
      .map(function (ws) { return { t: new Date(ws).getTime(), v: byWeek[ws], label: "Week of " + core.formatDate(ws) }; });
    renderLineChart("frequencyChart", points, {
      emptyMessage: "Log a few weeks of workouts to see your frequency trend.",
      yFormat: function (v) { return Math.round(v) + (Math.round(v) === 1 ? " workout" : " workouts"); },
      ariaLabel: "Workout frequency trend"
    });
  }

  /* ---------------- muscle volume (This Week + Trends + body map) ---------------- */

  // Credits each logged set to its exercise's primary muscleGroup (1x) and,
  // for recognizable compound lifts, a fraction (0.5x) to each secondary
  // muscle from JarvisExercises.getSecondaryMuscles — an intelligent split
  // instead of counting every exercise equally. sinceDate=null means all-time.
  function computeMuscleVolume(sinceDate) {
    const JE = window.JarvisExercises;
    const totals = {};
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      if (sinceDate && new Date(w.date) < sinceDate) return;
      w.exercises.forEach(function (se) {
        if (!se.sets.length) return;
        const ex = JE.getExerciseById(se.exerciseId);
        if (!ex) return;
        const n = se.sets.length;
        totals[ex.muscleGroup] = (totals[ex.muscleGroup] || 0) + n;
        JE.getSecondaryMuscles(ex.id).forEach(function (m) { totals[m] = (totals[m] || 0) + n * 0.5; });
      });
    });
    return totals;
  }

  function renderMuscleVolumeList(containerId, totals, emptyMessage) {
    const entries = Object.keys(totals)
      .map(function (k) { return { muscle: k, sets: totals[k] }; })
      .filter(function (e) { return e.sets > 0; })
      .sort(function (a, b) { return b.sets - a.sets; });
    const container = document.getElementById(containerId);
    if (!entries.length) {
      container.innerHTML = '<div class="empty-state">' + emptyMessage + '</div>';
      return;
    }
    const max = entries[0].sets;
    container.innerHTML = entries.map(function (e) {
      const pct = max > 0 ? Math.round((e.sets / max) * 100) : 0;
      return (
        '<div class="nutri-bar-row"><div class="nutri-bar-label"><span>' + e.muscle + '</span>' +
        '<span class="nutri-bar-value">' + (Math.round(e.sets * 10) / 10) + ' sets</span></div>' +
        '<div class="nutri-bar-track"><div class="nutri-bar-fill" style="width:' + pct + '%"></div></div></div>'
      );
    }).join("");
  }

  function renderTrendsMuscleVolume() {
    renderMuscleVolumeList("trendsMuscleVolumeList", computeMuscleVolume(new Date(Date.now() - 56 * 86400000)), "Log some workouts to see your muscle group balance.");
  }

  /* ---------------- This Week ---------------- */

  function getWeekStartDate(now) {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function countPrsSince(start) {
    const ids = {};
    workouts.forEach(function (w) { if (w.schema !== 2) return; w.exercises.forEach(function (se) { ids[se.exerciseId] = true; }); });
    let count = 0;
    Object.keys(ids).forEach(function (id) {
      getPrHistory(id).forEach(function (h) { if (new Date(h.date) >= start) count++; });
    });
    return count;
  }

  function computeThisWeekStats() {
    const JE = window.JarvisExercises;
    const start = getWeekStartDate(new Date());
    const weekWorkouts = workouts.filter(function (w) { return w.schema === 2 && new Date(w.date) >= start; });
    let sets = 0, reps = 0, volume = 0;
    const muscleSet = {}, days = {};
    weekWorkouts.forEach(function (w) {
      days[w.date] = true;
      w.exercises.forEach(function (se) {
        const ex = JE.getExerciseById(se.exerciseId);
        if (ex) muscleSet[ex.muscleGroup] = true;
        se.sets.forEach(function (s) { sets++; reps += Number(s.reps) || 0; volume += (Number(s.weight) || 0) * (Number(s.reps) || 0); });
      });
    });
    return {
      workouts: weekWorkouts.length, sets: sets, reps: reps, volume: volume,
      muscleGroups: Object.keys(muscleSet).length, trainingDays: Object.keys(days).length, prs: countPrsSince(start)
    };
  }

  function renderThisWeekTab() {
    const stats = computeThisWeekStats();
    document.getElementById("thisWeekStats").innerHTML =
      statBoxHtml(stats.workouts, "Workouts") +
      statBoxHtml(stats.sets, "Working sets") +
      statBoxHtml(stats.reps, "Total reps") +
      statBoxHtml(Math.round(stats.volume).toLocaleString() + " lb", "Volume") +
      statBoxHtml(stats.trainingDays, "Training days") +
      statBoxHtml(stats.prs, "PRs this week");
    renderMuscleVolumeList("thisWeekMuscleVolume", computeMuscleVolume(getWeekStartDate(new Date())), "Log a workout this week to see your muscle split.");
  }

  /* ---------------- Your Lifts ---------------- */

  function computeYourLifts(limit) {
    const JE = window.JarvisExercises;
    const byExercise = {};
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      const t = new Date(w.dateTime || w.date).getTime();
      w.exercises.forEach(function (se) {
        if (!se.sets.length) return;
        let best = 0;
        se.sets.forEach(function (s) { const v = JE.estimateOneRepMax(s.weight, s.reps); if (v > best) best = v; });
        if (!byExercise[se.exerciseId]) byExercise[se.exerciseId] = [];
        byExercise[se.exerciseId].push({ t: t, v: best });
      });
    });
    const lifts = Object.keys(byExercise).map(function (id) {
      const sessions = byExercise[id].sort(function (a, b) { return a.t - b.t; });
      const latest = sessions[sessions.length - 1];
      const prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;
      const ex = JE.getExerciseById(id);
      return { id: id, name: ex ? ex.name : "Exercise", e1rm: latest.v, delta: prev ? latest.v - prev.v : null, lastT: latest.t };
    });
    lifts.sort(function (a, b) { return b.lastT - a.lastT; });
    return lifts.slice(0, limit);
  }

  function renderYourLifts() {
    const core = window.JarvisCore;
    const lifts = computeYourLifts(10);
    const container = document.getElementById("yourLiftsScroll");
    if (!lifts.length) {
      container.innerHTML = '<div class="empty-state-compact">Log some sets to see your top lifts here.</div>';
      return;
    }
    container.innerHTML = lifts.map(function (l) {
      let deltaHtml = '<span class="lift-card-delta flat">New</span>';
      if (l.delta !== null) {
        const cls = l.delta > 0.5 ? "positive" : l.delta < -0.5 ? "negative" : "flat";
        const arrow = l.delta > 0.5 ? "&#9650; " : l.delta < -0.5 ? "&#9660; " : "";
        deltaHtml = '<span class="lift-card-delta ' + cls + '">' + arrow + (l.delta >= 0 ? "+" : "") + Math.round(l.delta) + ' lb</span>';
      }
      return (
        '<button type="button" class="lift-card" data-exercise-id="' + core.escapeHtml(l.id) + '">' +
          '<div class="lift-card-name">' + core.escapeHtml(l.name) + '</div>' +
          '<div class="lift-card-value">' + Math.round(l.e1rm) + ' lb</div>' +
          deltaHtml +
          '<div class="lift-card-sub">e1RM</div>' +
        '</button>'
      );
    }).join("");
  }

  /* ---------------- Body map ---------------- */

  // The 17 anatomical regions the map shows — finer than JarvisExercises'
  // coarse MUSCLE_GROUPS (which only This Week / Trends use). Every exercise
  // is classified into these via JarvisExercises.getFineMuscleTargets, which
  // has its own per-exercise mapping plus a coarse-group fallback — see
  // exercises.js for the full table. "Full Body" / "Cardio" exercises still
  // contribute wherever their real primary muscles are (e.g. a clean credits
  // Traps + Quads); cardio-only movements contribute secondary credit only.
  const FINE_MUSCLES = window.JarvisExercises ? window.JarvisExercises.FINE_MUSCLES : [];
  const MUSCLE_DISPLAY_NAMES = {
    Chest: "Chest", FrontDelts: "Front Delts", SideDelts: "Side Delts", RearDelts: "Rear Delts",
    Traps: "Traps", Lats: "Lats", UpperBack: "Upper Back", LowerBack: "Lower Back",
    Biceps: "Biceps", Triceps: "Triceps", Forearms: "Forearms", Abs: "Abs", Obliques: "Obliques",
    Glutes: "Glutes", Quads: "Quads", Hamstrings: "Hamstrings", Calves: "Calves"
  };
  function muscleDisplayName(m) { return MUSCLE_DISPLAY_NAMES[m] || m; }

  const READINESS_COLORS = { fatigued: "var(--red)", recovering: "var(--yellow)", ready: "var(--green)" };

  // Only 4 regions have a real population strength standard in this app (via
  // their linked benchmark lift). Every other region falls back to a
  // personal training-volume tier so the map never claims a population-level
  // "Beginner..World Class" rating it can't actually back up.
  const BENCHMARK_KEYS_FOR_FINE_MUSCLE = { Chest: ["bench"], FrontDelts: ["ohp"], Quads: ["squat"], Lats: ["deadlift", "pullup"] };

  // Fine-grained equivalent of computeMuscleVolume (coarse, used by This Week
  // / Trends — left untouched). Primary credit = 1 set, secondary = 0.5.
  function computeFineMuscleVolume(sinceDate) {
    const JE = window.JarvisExercises;
    const totals = {};
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      if (sinceDate && new Date(w.date) < sinceDate) return;
      w.exercises.forEach(function (se) {
        if (!se.sets.length) return;
        const targets = JE.getFineMuscleTargets(se.exerciseId);
        const n = se.sets.length;
        targets.primary.forEach(function (m) { totals[m] = (totals[m] || 0) + n; });
        targets.secondary.forEach(function (m) { totals[m] = (totals[m] || 0) + n * 0.5; });
      });
    });
    return totals;
  }

  function computeMuscleVolumeTier(muscle) {
    const everTotals = computeFineMuscleVolume(null);
    if (!everTotals[muscle]) return { hasData: false };
    const totals8w = computeFineMuscleVolume(new Date(Date.now() - 56 * 86400000));
    const avgWeekly = (totals8w[muscle] || 0) / 8;
    const score = Math.max(0, Math.min(100, (avgWeekly / 20) * 100));
    const level = scoreToLevelLabel(score);
    return {
      hasData: true, score: score, level: level, basis: "volume", avgWeekly: avgWeekly,
      basisText: "No population strength standard exists for " + muscleDisplayName(muscle) + " — level estimated from ~" + (Math.round(avgWeekly * 10) / 10) +
        " sets/week over the last 8 weeks (common hypertrophy guidelines suggest roughly 10-20 sets/week per muscle)."
    };
  }

  function computeMuscleStrengthLevel(muscle, cutoffDate) {
    const keys = BENCHMARK_KEYS_FOR_FINE_MUSCLE[muscle];
    if (keys && strengthSettings.compareSex !== "none") {
      const result = computeStrengthBreakdown(cutoffDate || null);
      if (result) {
        const candidates = result.breakdown.filter(function (b) { return keys.indexOf(b.benchmarkKey) !== -1 && b.hasData && b.score !== null; });
        if (candidates.length) {
          const best = candidates.reduce(function (a, b) { return b.score > a.score ? b : a; });
          return {
            hasData: true, score: best.score, level: best.level, basis: "standard", liftLabel: best.label,
            basisText: "Based on your " + best.label + " estimated 1RM vs. common bodyweight-ratio strength standards."
          };
        }
      }
      // Standards-eligible muscle but no benchmark lift logged yet (e.g. leg
      // press without ever squatting) — fall through to the volume tier for
      // the CURRENT snapshot, same as any other muscle. A historical "as of"
      // snapshot (cutoffDate set, used only for the 4-weeks-ago comparison)
      // stays "not enough data" instead, since a volume-tier number wouldn't
      // be an apples-to-apples comparison against a standards-based current score.
    }
    if (cutoffDate) return { hasData: false };
    return computeMuscleVolumeTier(muscle);
  }

  function computeMuscleReadiness(muscle) {
    const JE = window.JarvisExercises;
    let lastDate = null;
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      const hasPrimary = w.exercises.some(function (se) {
        if (!se.sets.length) return false;
        return JE.getFineMuscleTargets(se.exerciseId).primary.indexOf(muscle) !== -1;
      });
      if (hasPrimary) { const d = new Date(w.date); if (!lastDate || d > lastDate) lastDate = d; }
    });
    if (!lastDate) return { hasData: false };
    const daysSince = Math.max(0, (Date.now() - lastDate.getTime()) / 86400000);
    const totals7d = computeFineMuscleVolume(new Date(Date.now() - 7 * 86400000));
    const recentSets = totals7d[muscle] || 0;
    const recoveryDays = Math.max(2, Math.min(5, 2 + recentSets * 0.15));
    const pct = Math.max(0, Math.min(100, (daysSince / recoveryDays) * 100));
    const status = pct >= 80 ? "ready" : pct >= 40 ? "recovering" : "fatigued";
    return { hasData: true, pct: pct, status: status, daysSince: Math.round(daysSince), recentSets: recentSets };
  }

  function readinessLabel(status) { return status === "ready" ? "Ready" : status === "recovering" ? "Recovering" : "Fatigued"; }

  // "What would move them to the next level" — a concrete, honest next step
  // rather than a vague platitude, grounded in whichever basis (standard vs.
  // volume) produced the current level.
  function nextLevelHint(data, muscle) {
    if (!data.hasData) return "Log a few sets for " + muscleDisplayName(muscle) + " to see a level here.";
    const idx = STRENGTH_LEVELS.indexOf(data.level);
    if (idx === -1) return null;
    if (idx === STRENGTH_LEVELS.length - 1) return "Already at the top tier tracked here (World Class).";
    const nextLabel = STRENGTH_LEVELS[idx + 1];
    if (data.basis === "standard") {
      return "Reaching " + nextLabel + " means raising your " + data.liftLabel + " 1RM relative to your body weight.";
    }
    return "Reaching " + nextLabel + " means averaging more weekly sets for " + muscleDisplayName(muscle) + " (you're at ~" + (Math.round(data.avgWeekly * 10) / 10) + "/week now).";
  }

  // Trend vs. ~4 weeks ago, using the same basis (standard or volume) as the
  // current level so the comparison is apples-to-apples.
  function recentProgressText(data, muscle) {
    if (!data.hasData) return null;
    const cutoff = new Date(Date.now() - 28 * 86400000);
    let past;
    if (data.basis === "standard") {
      past = computeMuscleStrengthLevel(muscle, cutoff.toISOString().slice(0, 10));
    } else {
      // Isolate the 8-week window ending 4 weeks ago: everything from 12
      // weeks ago to now, minus everything from 4 weeks ago to now.
      const totalsFrom12w = computeFineMuscleVolume(new Date(cutoff.getTime() - 56 * 86400000));
      const totalsFrom4w = computeFineMuscleVolume(cutoff);
      const windowSets = (totalsFrom12w[muscle] || 0) - (totalsFrom4w[muscle] || 0);
      const pastWeekly = windowSets / 8;
      past = { hasData: true, score: Math.max(0, Math.min(100, (pastWeekly / 20) * 100)) };
    }
    if (!past.hasData) return "No 4-week-ago comparison yet.";
    const delta = data.score - past.score;
    if (Math.abs(delta) < 2) return "Holding steady vs. 4 weeks ago.";
    return (delta > 0 ? "Up " : "Down ") + Math.abs(Math.round(delta)) + " points vs. 4 weeks ago.";
  }

  function computeMuscleMapColors() {
    const colors = {};
    FINE_MUSCLES.forEach(function (m) {
      if (bodyMapMode === "strength") {
        const d = computeMuscleStrengthLevel(m);
        colors[m] = d.hasData ? getMuscleColorForLevel(d.level) : null;
      } else {
        const d = computeMuscleReadiness(m);
        colors[m] = d.hasData ? READINESS_COLORS[d.status] : null;
      }
    });
    return colors;
  }

  /* ---- anatomical SVG (original artwork, not based on any copyrighted asset) ---- */

  // Builds a smooth closed path through a small list of [x,y] anchor points:
  // each edge is a quadratic curve from one anchor, through the midpoint to
  // the next — a standard trick for turning a handful of corner points into
  // an organic, rounded "blob" outline without hand-plotting bezier handles.
  function smoothClosedPath(points) {
    function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    const n = points.length;
    if (n < 3) return "";
    const start = mid(points[n - 1], points[0]);
    let d = "M" + start[0].toFixed(1) + "," + start[1].toFixed(1) + " ";
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const next = points[(i + 1) % n];
      const m = mid(p, next);
      d += "Q" + p[0].toFixed(1) + "," + p[1].toFixed(1) + " " + m[0].toFixed(1) + "," + m[1].toFixed(1) + " ";
    }
    return d + "Z";
  }

  function mirrorPoints(points) { return points.map(function (p) { return [220 - p[0], p[1]]; }); }

  function svgRegionAttrs(muscle, colors) {
    const color = colors[muscle];
    let cls = "bodymap-muscle-region" + (color ? "" : " is-unrated");
    if (selectedMuscle) cls += muscle === selectedMuscle ? " is-selected" : " is-dimmed";
    return { cls: cls, style: color ? ' style="fill:' + color + '"' : "" };
  }

  function regionPath(muscle, points, colors) {
    const a = svgRegionAttrs(muscle, colors);
    return '<path class="' + a.cls + '" d="' + smoothClosedPath(points) + '"' + a.style + ' data-muscle="' + muscle + '"><title>' + muscleDisplayName(muscle) + '</title></path>';
  }

  function bilateral(muscle, leftPoints, colors) {
    return regionPath(muscle, leftPoints, colors) + regionPath(muscle, mirrorPoints(leftPoints), colors);
  }

  function basePartPath(points) { return '<path class="bodymap-body-part" d="' + smoothClosedPath(points) + '"/>'; }
  function bilateralBase(leftPoints) { return basePartPath(leftPoints) + basePartPath(mirrorPoints(leftPoints)); }

  // Shared base silhouette (head/neck/torso/arms/legs) in a muted tone, with
  // the colored muscle regions painted on top — same underlying body for
  // front and back, only the overlay regions differ. Torso is a gentle
  // hourglass (wide shoulders, narrow waist, flared hips) and each limb is
  // plotted along its own outer/inner edge (10-12 anchor points) rather than
  // a 4-point box, so the silhouette itself already reads as a body before
  // any muscle region is painted on top of it.
  function bodyBaseSvg() {
    return (
      '<circle cx="110" cy="24" r="17" class="bodymap-body-part"/>' +
      basePartPath([[99, 34], [121, 34], [118, 60], [102, 60]]) +
      basePartPath([[70, 58], [150, 58], [146, 108], [134, 150], [136, 172], [144, 206], [76, 206], [84, 172], [86, 150], [74, 108]]) +
      bilateralBase([[48, 64], [38, 110], [36, 170], [34, 230], [36, 270], [48, 270], [46, 230], [50, 170], [58, 110], [66, 70]]) +
      bilateralBase([[78, 206], [72, 260], [70, 325], [66, 375], [68, 440], [60, 456], [98, 456], [86, 440], [84, 375], [86, 325], [92, 260], [100, 206]])
    );
  }

  // 17 original, anatomically-proportioned shapes per view — not traced from
  // or resembling any specific copyrighted illustration, just the standard
  // muscle-chart convention (teardrop pecs, wing-shaped lats, diamond traps,
  // segmented abs) every strength app in this genre draws, scaled to fit an
  // iPhone-width card without scrolling. Each region is its own path with
  // its own stroke, so adjacent same-colored muscles still read as visually
  // distinct parts, the way real anatomy charts separate them.
  function bodyMapFrontSvg(colors) {
    const regions =
      bilateral("FrontDelts", [[64, 62], [78, 60], [82, 78], [74, 92], [62, 94], [54, 78]], colors) +
      bilateral("SideDelts", [[40, 66], [56, 64], [60, 82], [52, 96], [38, 92], [32, 78]], colors) +
      bilateral("Chest", [[108, 68], [78, 66], [70, 92], [78, 112], [100, 116], [110, 100]], colors) +
      bilateral("Biceps", [[52, 96], [64, 94], [62, 150], [50, 156], [40, 130], [42, 108]], colors) +
      bilateral("Forearms", [[42, 160], [54, 158], [52, 258], [42, 262], [34, 200]], colors) +
      regionPath("Abs", [[96, 112], [124, 112], [126, 145], [122, 175], [112, 198], [98, 198], [94, 175], [90, 145]], colors) +
      bilateral("Obliques", [[80, 114], [96, 112], [92, 145], [88, 178], [96, 196], [82, 188], [72, 150], [74, 128]], colors) +
      bilateral("Quads", [[80, 206], [104, 208], [106, 260], [102, 315], [88, 322], [76, 315], [72, 260], [74, 230]], colors) +
      bilateral("Calves", [[84, 328], [99, 330], [97, 400], [95, 418], [87, 430], [79, 414], [79, 380]], colors);
    // Thin divider lines drawn over a couple of fills — purely cosmetic
    // detail (six-pack segmentation, a hint of rectus-femoris separation on
    // the quad) matching the look of a real anatomy chart.
    const dividerLines =
      '<line x1="96" y1="141" x2="124" y2="141" class="bodymap-muscle-divider"/>' +
      '<line x1="94" y1="167" x2="122" y2="167" class="bodymap-muscle-divider"/>' +
      '<line x1="110" y1="113" x2="110" y2="197" class="bodymap-muscle-divider"/>' +
      '<line x1="90" y1="218" x2="88" y2="312" class="bodymap-muscle-divider"/>' +
      '<line x1="130" y1="218" x2="132" y2="312" class="bodymap-muscle-divider"/>';
    return '<svg viewBox="0 0 220 480" role="img" aria-label="Front body map">' + bodyBaseSvg() + regions + dividerLines + '</svg>';
  }

  function bodyMapBackSvg(colors) {
    const regions =
      bilateral("RearDelts", [[40, 66], [56, 64], [60, 84], [52, 98], [36, 92], [32, 78]], colors) +
      regionPath("Traps", [[110, 58], [134, 74], [120, 110], [110, 120], [100, 110], [86, 74]], colors) +
      bilateral("Lats", [[72, 100], [94, 106], [100, 140], [96, 170], [84, 180], [68, 160], [62, 125]], colors) +
      bilateral("UpperBack", [[90, 100], [108, 108], [106, 136], [92, 134], [86, 116]], colors) +
      bilateral("LowerBack", [[98, 172], [108, 174], [106, 200], [98, 198]], colors) +
      bilateral("Triceps", [[50, 96], [64, 94], [62, 152], [48, 156], [38, 128], [40, 106]], colors) +
      bilateral("Forearms", [[42, 160], [54, 158], [52, 258], [42, 262], [34, 200]], colors) +
      bilateral("Glutes", [[78, 202], [108, 204], [106, 232], [92, 240], [76, 230], [74, 214]], colors) +
      bilateral("Hamstrings", [[80, 240], [104, 238], [102, 312], [86, 320], [78, 290], [76, 260]], colors) +
      bilateral("Calves", [[82, 328], [100, 330], [98, 396], [96, 416], [88, 428], [80, 410], [80, 378]], colors);
    // Spine groove between the two LowerBack strips, and a hint of the
    // gastrocnemius/soleus split on each calf — same cosmetic-divider
    // convention as the front view.
    const dividerLines =
      '<line x1="110" y1="60" x2="110" y2="118" class="bodymap-muscle-divider"/>' +
      '<line x1="88" y1="345" x2="85" y2="410" class="bodymap-muscle-divider"/>' +
      '<line x1="132" y1="345" x2="135" y2="410" class="bodymap-muscle-divider"/>';
    return '<svg viewBox="0 0 220 480" role="img" aria-label="Back body map">' + bodyBaseSvg() + regions + dividerLines + '</svg>';
  }

  function renderBodyMapView() {
    const colors = computeMuscleMapColors();
    const svg = bodyMapSide === "front" ? bodyMapFrontSvg(colors) : bodyMapBackSvg(colors);
    document.getElementById("bodyMapView").innerHTML = svg;
  }

  function renderBodyMapLegend() {
    const legendEl = document.getElementById("bodyMapLegend");
    const hintEl = document.getElementById("bodyMapHint");
    if (bodyMapMode === "strength") {
      legendEl.innerHTML = STRENGTH_LEVELS.map(function (l) {
        return '<div class="bodymap-legend-item"><span class="bodymap-legend-swatch" style="background:' + getMuscleColorForLevel(l) + '"></span>' + l + '</div>';
      }).join("") + '<div class="bodymap-legend-item"><span class="bodymap-legend-swatch" style="background:var(--card-hover)"></span>Not enough data</div>';
      hintEl.textContent = "Tap a muscle for details.";
    } else {
      legendEl.innerHTML =
        '<div class="bodymap-legend-item"><span class="bodymap-legend-swatch" style="background:var(--red)"></span>Fatigued</div>' +
        '<div class="bodymap-legend-item"><span class="bodymap-legend-swatch" style="background:var(--yellow)"></span>Recovering</div>' +
        '<div class="bodymap-legend-item"><span class="bodymap-legend-swatch" style="background:var(--green)"></span>Ready</div>' +
        '<div class="bodymap-legend-item"><span class="bodymap-legend-swatch" style="background:var(--card-hover)"></span>Not trained yet</div>';
      hintEl.textContent = "An estimate from time since trained + recent volume — not biological.";
    }
  }

  function renderBodyMap() {
    renderBodyMapView();
    renderBodyMapLegend();
  }

  // Mode and side switches never clear the current selection — the sheet
  // stays open and its content updates in place (continuity, per spec).
  function handleBodyMapModeClick(e) {
    const btn = e.target.closest(".bodymap-mode-btn");
    if (!btn) return;
    document.querySelectorAll(".bodymap-mode-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    bodyMapMode = btn.getAttribute("data-mode");
    renderBodyMapView();
    renderMuscleSheet();
  }

  function handleBodyMapSideClick(e) {
    const btn = e.target.closest(".bodymap-side-btn");
    if (!btn) return;
    document.querySelectorAll(".bodymap-side-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    const nextSide = btn.getAttribute("data-side");
    if (nextSide === bodyMapSide) return;
    const wrap = document.getElementById("bodyMapView");
    wrap.classList.add("is-fading");
    setTimeout(function () {
      bodyMapSide = nextSide;
      renderBodyMapView();
      wrap.classList.remove("is-fading");
    }, 90);
  }

  // Maps a click's screen coordinates into the SVG's own viewBox coordinate
  // space, so a near-miss tap near a small region (forearms, obliques) can
  // still resolve to the nearest region's center instead of doing nothing —
  // a forgiving hitbox without needing invisible duplicate shapes.
  function svgPointFromEvent(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  function handleBodyMapClick(e) {
    let el = e.target.closest("[data-muscle]");
    if (!el) {
      const svg = e.currentTarget.querySelector("svg");
      if (!svg) return;
      const pt = svgPointFromEvent(svg, e.clientX, e.clientY);
      if (pt) {
        let best = null, bestDist = Infinity;
        svg.querySelectorAll("[data-muscle]").forEach(function (region) {
          const bbox = region.getBBox();
          const cx = bbox.x + bbox.width / 2, cy = bbox.y + bbox.height / 2;
          const d = Math.hypot(pt.x - cx, pt.y - cy);
          if (d < bestDist) { bestDist = d; best = region; }
        });
        if (best && bestDist < 40) el = best;
      }
    }
    if (!el) return;
    selectMuscle(el.getAttribute("data-muscle"));
  }

  // Tapping the already-selected muscle deselects it (closes the sheet) —
  // the same gesture that opened it closes it, no separate mode needed.
  function selectMuscle(muscle) {
    selectedMuscle = selectedMuscle === muscle ? null : muscle;
    muscleSheetExpanded = false;
    muscleSheetHistoryOpen = false;
    renderBodyMapView();
    renderMuscleSheet();
  }

  function exercisesTargetingMuscle(muscle) {
    const JE = window.JarvisExercises;
    const loggedIds = {};
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      w.exercises.forEach(function (se) { if (se.sets.length) loggedIds[se.exerciseId] = true; });
    });
    const list = JE.getExercises().filter(function (ex) { return JE.getFineMuscleTargets(ex.id).primary.indexOf(muscle) !== -1; });
    list.sort(function (a, b) {
      const la = loggedIds[a.id] ? 0 : 1, lb = loggedIds[b.id] ? 0 : 1;
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  // For a standards-backed muscle, the "primary lift" is the exact benchmark
  // exercise that produced the score (so Add to Workout / Recent PR line up
  // with what's shown) — otherwise the most relevant logged exercise.
  function primaryExerciseForMuscle(muscle, strengthData) {
    const JE = window.JarvisExercises;
    if (strengthData && strengthData.basis === "standard" && strengthData.liftLabel) {
      const benchmarkEx = JE.getBenchmarkExercises().find(function (ex) { return ex.name === strengthData.liftLabel; });
      if (benchmarkEx) return benchmarkEx;
    }
    const list = exercisesTargetingMuscle(muscle);
    return list.length ? list[0] : null;
  }

  function bandProgressPct(score) {
    const bandWidth = 100 / STRENGTH_LEVELS.length;
    const within = score % bandWidth;
    return Math.max(0, Math.min(100, Math.round((within / bandWidth) * 100)));
  }

  function muscleHistoryStats(muscle) {
    const JE = window.JarvisExercises;
    const cutoff = new Date(Date.now() - 30 * 86400000);
    let sessions = 0;
    const sessionDates = [];
    const exIdsSeen = {};
    workouts.forEach(function (w) {
      if (w.schema !== 2) return;
      if (new Date(w.date) < cutoff) return;
      const hit = w.exercises.some(function (se) {
        return se.sets.length && JE.getFineMuscleTargets(se.exerciseId).primary.indexOf(muscle) !== -1;
      });
      if (!hit) return;
      sessions++;
      sessionDates.push(w.date);
      w.exercises.forEach(function (se) {
        if (se.sets.length && JE.getFineMuscleTargets(se.exerciseId).primary.indexOf(muscle) !== -1) exIdsSeen[se.exerciseId] = true;
      });
    });
    let prCount = 0;
    Object.keys(exIdsSeen).forEach(function (exId) {
      getPrHistory(exId).forEach(function (h) { if (new Date(h.date) >= cutoff) prCount++; });
    });
    sessionDates.sort(function (a, b) { return new Date(b) - new Date(a); });
    return { sessions: sessions, prCount: prCount, recentDates: sessionDates.slice(0, 5) };
  }

  function addExerciseToDraftById(exerciseId) {
    const core = window.JarvisCore;
    const existing = draft.exercises.find(function (se) { return se.exerciseId === exerciseId; });
    if (existing) { core.showToast("Already in your current session."); return; }
    draft.exercises.push({ sessionExId: core.uid("sesx"), exerciseId: exerciseId, sets: buildSetsFromRoutinePlan(exerciseId) });
    draft.activeIndex = draft.exercises.length - 1;
    saveDraft();
    renderSessionExerciseList();
    const ex = window.JarvisExercises.getExerciseById(exerciseId);
    core.showToast((ex ? ex.name : "Exercise") + " added to your current session.");
  }

  // The inline muscle panel — replaces the old modal. It never covers the
  // body map, so tapping a different muscle while it's open just updates its
  // content in place; nothing needs to be closed and reopened.
  function renderMuscleSheet() {
    const sheet = document.getElementById("muscleSheet");
    if (!selectedMuscle) { sheet.classList.add("hidden"); return; }
    sheet.classList.remove("hidden");

    const core = window.JarvisCore;
    const muscle = selectedMuscle;
    const strengthData = computeMuscleStrengthLevel(muscle);
    const readinessData = computeMuscleReadiness(muscle);
    const primaryEx = primaryExerciseForMuscle(muscle, strengthData);

    document.getElementById("muscleSheetTitle").textContent = muscleDisplayName(muscle);

    let compactHtml = "";
    if (bodyMapMode === "strength") {
      document.getElementById("muscleSheetSubtitle").textContent = "Strength";
      if (!strengthData.hasData) {
        compactHtml = '<div class="empty-state-compact">Log a few sets for ' + core.escapeHtml(muscleDisplayName(muscle)) + ' to see a strength level.</div>';
      } else {
        const progressPct = bandProgressPct(strengthData.score);
        const idx = STRENGTH_LEVELS.indexOf(strengthData.level);
        const nextLabel = idx >= 0 && idx < STRENGTH_LEVELS.length - 1 ? STRENGTH_LEVELS[idx + 1] : null;
        compactHtml =
          '<div class="muscle-sheet-stat-row"><span>Strength Score</span><span class="muscle-sheet-stat-value">' + Math.round(strengthData.score) + '</span></div>' +
          '<div class="muscle-sheet-stat-row"><span>30-Day Trend</span><span>' + core.escapeHtml(recentProgressText(strengthData, muscle) || "--") + '</span></div>' +
          '<div class="muscle-sheet-stat-row"><span>' + (strengthData.basis === "standard" ? "Primary Lift" : "Primary Exercise") + '</span><span>' + core.escapeHtml(primaryEx ? primaryEx.name : "--") + '</span></div>' +
          (nextLabel
            ? '<div class="muscle-sheet-progress"><div class="muscle-sheet-progress-label"><span>Progress to ' + core.escapeHtml(nextLabel) + '</span><span>' + progressPct + '%</span></div>' +
              '<div class="nutri-bar-track"><div class="nutri-bar-fill" style="width:' + progressPct + '%"></div></div></div>'
            : '<p class="field-hint">Already at the top tier tracked here.</p>');
      }
    } else {
      document.getElementById("muscleSheetSubtitle").textContent = "Readiness";
      if (!readinessData.hasData) {
        compactHtml = '<div class="empty-state-compact">' + core.escapeHtml(muscleDisplayName(muscle)) + " hasn't been trained yet.</div>";
      } else {
        compactHtml =
          '<div class="muscle-sheet-stat-row"><span>Readiness</span><span class="muscle-sheet-stat-value">' + Math.round(readinessData.pct) + '%</span></div>' +
          '<div class="muscle-sheet-stat-row"><span>Status</span><span>' + readinessLabel(readinessData.status) + '</span></div>' +
          '<div class="muscle-sheet-stat-row"><span>Last trained</span><span>' + readinessData.daysSince + ' day' + (readinessData.daysSince === 1 ? "" : "s") + ' ago</span></div>';
      }
    }

    let html = compactHtml;
    html += '<div class="muscle-sheet-actions">' +
      '<button type="button" class="btn btn-secondary muscle-sheet-expand-btn" data-action="toggle-expand">' +
      (muscleSheetExpanded ? "Hide Details" : "View " + core.escapeHtml(muscleDisplayName(muscle)) + " Details") +
      '</button></div>';

    if (muscleSheetExpanded) {
      html += '<div class="muscle-sheet-expanded">';

      if (strengthData.hasData) {
        html += '<p class="field-hint">' + core.escapeHtml(strengthData.basisText) + '</p>';
        html += '<p class="field-hint">' + core.escapeHtml(nextLevelHint(strengthData, muscle) || "") + '</p>';
      }

      const totals8w = computeFineMuscleVolume(new Date(Date.now() - 56 * 86400000));
      const recentSets = totals8w[muscle] || 0;
      html += '<div class="muscle-sheet-stat-row"><span>Weekly sets (8-week avg)</span><span>' + (Math.round((recentSets / 8) * 10) / 10) + '</span></div>';

      if (readinessData.hasData) {
        html += '<div class="muscle-sheet-stat-row"><span>Recovery</span><span>' + readinessLabel(readinessData.status) + ' (' + Math.round(readinessData.pct) + '%)</span></div>';
      }

      let suggestion;
      if (!readinessData.hasData) suggestion = "Log a session for " + muscleDisplayName(muscle) + " to get a recovery estimate.";
      else if (readinessData.status === "ready") suggestion = "Ready for normal training volume.";
      else if (readinessData.status === "recovering") suggestion = "Still recovering — consider lighter volume or an extra rest day.";
      else suggestion = "This muscle is fatigued — consider resting it before your next session.";
      html += '<div class="muscle-sheet-suggestion">' + core.escapeHtml(suggestion) + '</div>';

      if (primaryEx) {
        const prHistory = getPrHistory(primaryEx.id);
        if (prHistory.length) {
          const latestPr = prHistory[0];
          html += '<div class="muscle-sheet-stat-row"><span>Recent PR</span><span>' + core.escapeHtml(latestPr.weight) + ' &times; ' + core.escapeHtml(latestPr.reps) + ' (' + core.formatDate(latestPr.date) + ')</span></div>';
        }
      }

      const relevant = exercisesTargetingMuscle(muscle).slice(0, 6);
      if (relevant.length) {
        html += '<h3 class="checklist-title" style="margin-top:10px;">Relevant Exercises</h3><div class="muscle-sheet-exercise-chips">' +
          relevant.map(function (ex) { return '<button type="button" class="muscle-sheet-chip" data-action="jump-exercise" data-exercise-id="' + core.escapeHtml(ex.id) + '">' + core.escapeHtml(ex.name) + '</button>'; }).join("") +
          '</div>';
      }

      html += '<div class="muscle-sheet-actions">' +
        '<button type="button" class="btn-icon" data-action="view-history">' + (muscleSheetHistoryOpen ? "Hide History" : "View History") + '</button>' +
        (primaryEx ? '<button type="button" class="btn-icon" data-action="add-to-workout" data-exercise-id="' + core.escapeHtml(primaryEx.id) + '">Add to Workout</button>' : '') +
        '</div>';

      if (muscleSheetHistoryOpen) {
        const hist = muscleHistoryStats(muscle);
        html += '<div class="muscle-sheet-history">' +
          '<h3 class="checklist-title">' + core.escapeHtml(muscleDisplayName(muscle)) + ' History (Last 30 Days)</h3>' +
          '<div class="muscle-sheet-stat-row"><span>Sessions</span><span>' + hist.sessions + '</span></div>' +
          '<div class="muscle-sheet-stat-row"><span>PRs</span><span>' + hist.prCount + '</span></div>' +
          (hist.recentDates.length
            ? '<div class="item-list">' + hist.recentDates.map(function (d) { return '<div class="list-item"><span class="list-item-title">' + core.formatDate(d) + '</span></div>'; }).join("") + '</div>'
            : '<div class="empty-state-compact">No sessions in the last 30 days.</div>') +
          '</div>';
      }

      html += '</div>';
    }

    document.getElementById("muscleSheetBody").innerHTML = html;
  }

  function handleMuscleSheetClick(e) {
    const expandBtn = e.target.closest('[data-action="toggle-expand"]');
    if (expandBtn) { muscleSheetExpanded = !muscleSheetExpanded; renderMuscleSheet(); return; }
    const historyBtn = e.target.closest('[data-action="view-history"]');
    if (historyBtn) { muscleSheetHistoryOpen = !muscleSheetHistoryOpen; renderMuscleSheet(); return; }
    const jumpBtn = e.target.closest('[data-action="jump-exercise"]');
    if (jumpBtn) { jumpToExercise(jumpBtn.getAttribute("data-exercise-id")); return; }
    const addBtn = e.target.closest('[data-action="add-to-workout"]');
    if (addBtn) { addExerciseToDraftById(addBtn.getAttribute("data-exercise-id")); return; }
  }

  function handleMuscleSheetCloseClick() {
    selectedMuscle = null;
    muscleSheetExpanded = false;
    muscleSheetHistoryOpen = false;
    renderBodyMapView();
    renderMuscleSheet();
  }

  function renderProgressTab() {
    renderExercisePrList();
    populateProgressExerciseSelect();
    renderExerciseDetail();
    renderVolumeChart();
    populateProgressMeasurementSelect();
    renderMeasurementChart();
    renderStrengthScoreChart();
    renderFrequencyChart();
    renderTrendsMuscleVolume();
    renderBodyweightChart("trendsBodyweightChart", null);
    renderThisWeekTab();
    renderYourLifts();
    renderBodyMap();
    renderMuscleSheet();
    renderBodyweightTab();
  }

  /* ---------------- render all / init ---------------- */

  function renderAll() {
    renderStats();
    renderWorkoutHome();
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
    if (targetId === "workout-home") renderWorkoutHome();
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
    document.getElementById("exercisePickerMuscleChips").addEventListener("click", handleMuscleChipsClick);
    document.getElementById("exercisePickerCards").addEventListener("click", handleExercisePickerCardsClick);
    document.getElementById("addExerciseToggleBtn").addEventListener("click", handleAddExerciseToggle);
    document.getElementById("showAddCustomExerciseBtn").addEventListener("click", handleShowAddCustomExercise);
    document.getElementById("cancelCustomExerciseBtn").addEventListener("click", handleCancelAddCustomExercise);
    document.getElementById("saveCustomExerciseBtn").addEventListener("click", handleSaveCustomExercise);
    document.getElementById("customExerciseList").addEventListener("click", handleCustomExerciseListClick);
    document.getElementById("addExerciseToSessionBtn").addEventListener("click", handleAddExerciseToSession);
    document.getElementById("sessionExercisePillNav").addEventListener("click", handleSessionPillNavClick);
    document.getElementById("sessionPrevExerciseBtn").addEventListener("click", handleSessionPrevExercise);
    document.getElementById("sessionNextExerciseBtn").addEventListener("click", handleSessionNextExercise);
    document.getElementById("sessionExerciseList").addEventListener("click", handleSessionExerciseListClick);
    document.getElementById("sessionExerciseList").addEventListener("change", handleSessionExerciseListChange);
    document.getElementById("sessionRoutineSelect").addEventListener("change", function () {
      if (this.value) loadRoutineIntoDraft(this.value);
      else { draft.routineId = ""; saveDraft(); }
    });
    document.getElementById("sessionNotes").addEventListener("change", function () { draft.notes = this.value; saveDraft(); });
    document.getElementById("sessionDateTime").addEventListener("change", function () { draft.dateTime = this.value; saveDraft(); });
    document.getElementById("saveWorkoutBtn").addEventListener("click", handleSaveWorkout);
    document.getElementById("discardDraftBtn").addEventListener("click", handleDiscardDraft);
    document.getElementById("workoutList").addEventListener("click", handleWorkoutListClick);
    document.getElementById("workout-home").addEventListener("click", handleHomeClick);

    document.getElementById("routinePickerMuscleFilter").addEventListener("change", refreshRoutinePicker);
    document.getElementById("routinePickerEquipmentFilter").addEventListener("change", refreshRoutinePicker);
    document.getElementById("routinePickerSearch").addEventListener("input", refreshRoutinePicker);
    document.getElementById("routineAddSetRowBtn").addEventListener("click", handleAddSetRow);
    document.getElementById("routineSetEditorRows").addEventListener("click", handleSetEditorRowsClick);
    document.getElementById("routineSetEditorRows").addEventListener("change", handleSetEditorRowsChange);
    document.getElementById("addExerciseToRoutineBtn").addEventListener("click", handleAddExerciseToRoutine);
    document.getElementById("routineCancelEditExerciseBtn").addEventListener("click", resetSetEditor);
    document.getElementById("routineBuilderList").addEventListener("click", handleRoutineBuilderListClick);
    document.getElementById("routineGroupSupersetBtn").addEventListener("click", handleGroupSuperset);
    document.getElementById("saveRoutineBtn").addEventListener("click", handleSaveRoutine);
    document.getElementById("routineCancelEditBtn").addEventListener("click", exitRoutineEditMode);
    resetSetEditor();
    document.getElementById("routineList").addEventListener("click", handleRoutineListClick);
    initRoutineGenerator();
    document.getElementById("generatorToggleBtn").addEventListener("click", handleGeneratorToggle);
    document.getElementById("generatorGoalGrid").addEventListener("click", handleGeneratorGoalClick);
    document.getElementById("generatorDaysPerWeekRow").addEventListener("click", handleGeneratorDaysPerWeekClick);
    document.getElementById("generatorTrainingDaysRow").addEventListener("click", handleGeneratorTrainingDayClick);
    document.getElementById("generatorEquipmentList").addEventListener("click", handleGeneratorEquipmentClick);
    document.getElementById("generateRoutineBtn").addEventListener("click", handleGenerateRoutine);

    document.getElementById("addDayToProgramBtn").addEventListener("click", handleAddDayToProgram);
    document.getElementById("programBuilderList").addEventListener("click", handleProgramBuilderListClick);
    document.getElementById("saveProgramBtn").addEventListener("click", handleSaveProgram);
    document.getElementById("programCancelEditBtn").addEventListener("click", exitProgramEditMode);
    document.getElementById("programList").addEventListener("click", handleProgramListClick);

    document.getElementById("bodyweightForm").addEventListener("submit", handleBodyweightSubmit);
    document.getElementById("bodyweightList").addEventListener("click", handleBodyweightListClick);
    document.getElementById("bodyweightFormCancelBtn").addEventListener("click", resetBodyweightForm);
    document.getElementById("bodyweightRangeToggle").addEventListener("click", handleBodyweightRangeClick);
    document.getElementById("measurementForm").addEventListener("submit", handleMeasurementSubmit);
    document.getElementById("measurementList").addEventListener("click", handleMeasurementListClick);
    document.getElementById("measurementFormCancelBtn").addEventListener("click", resetMeasurementForm);
    document.getElementById("strengthSettingsForm").addEventListener("submit", handleStrengthSettingsSubmit);

    document.getElementById("progressExerciseSelect").addEventListener("change", renderExerciseDetail);
    document.getElementById("progressMeasurementSelect").addEventListener("change", renderMeasurementChart);
    document.getElementById("exerciseChartRangeToggle").addEventListener("click", handleExerciseRangeClick);
    document.getElementById("exercisePrList").addEventListener("click", function (e) {
      const row = e.target.closest("[data-exercise-id]");
      if (row) selectExerciseAndRenderDetail(row.getAttribute("data-exercise-id"));
    });

    const progressMainBtns = Array.prototype.slice.call(document.querySelectorAll(".progress-main-tab-btn"));
    const progressMainPanels = Array.prototype.slice.call(document.querySelectorAll(".progress-main-tab-panel"));
    window.JarvisCore.setupTabGroup(progressMainBtns, progressMainPanels, function () { renderProgressTab(); });
    const progressAnalyticsBtns = Array.prototype.slice.call(document.querySelectorAll(".progress-analytics-tab-btn"));
    const progressAnalyticsPanels = Array.prototype.slice.call(document.querySelectorAll(".progress-analytics-tab-panel"));
    window.JarvisCore.setupTabGroup(progressAnalyticsBtns, progressAnalyticsPanels, function () { renderProgressTab(); });

    document.getElementById("bodyMapModeToggle").addEventListener("click", handleBodyMapModeClick);
    document.getElementById("bodyMapSideToggle").addEventListener("click", handleBodyMapSideClick);
    document.getElementById("bodyMapView").addEventListener("click", handleBodyMapClick);
    document.getElementById("muscleSheet").addEventListener("click", handleMuscleSheetClick);
    document.getElementById("muscleSheetCloseBtn").addEventListener("click", handleMuscleSheetCloseClick);

    document.getElementById("yourLiftsScroll").addEventListener("click", function (e) {
      const card = e.target.closest(".lift-card");
      if (card) jumpToExercise(card.getAttribute("data-exercise-id"));
    });
    document.getElementById("yourLiftsAllBtn").addEventListener("click", function () {
      const tabBtn = document.getElementById("progressMainTabExercises");
      if (tabBtn) tabBtn.click();
    });

    renderSessionExerciseList();
    renderAll();
  }

  window.JarvisWorkout = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
