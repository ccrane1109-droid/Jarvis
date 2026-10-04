/* ==========================================================================
   JARVIS — Habits / Productivity (Tasks, Habits, Goals, Stats)

   localStorage keys:
     jarvisTasks  — [ {id, date, text, priority, category, time, completed,
                        goalId, order, createdAt} ]  — flat array, not
                      nested per-date, so moving/duplicating a task across
                      dates is just changing/copying its `date` field.
     jarvisHabits — [ {id, name, targetDays, dailyTarget, completions, createdAt} ]
                      completions: { "<YYYY-MM-DD>": count }. A "simple"
                      check-off habit is just dailyTarget === 1. Same key as
                      before this upgrade — old {completedDates:[iso,...]}
                      habits are migrated in place the first time this loads
                      (see migrateHabit), so nothing already tracked is lost.
     jarvisGoals  — [ {id, name, description, category, targetDate,
                        hasNumericTarget, currentValue, targetValue, unit,
                        manualProgressPct, completed, milestones, createdAt} ]
                      Separate from Business's own jarvisBusiness.goals —
                      these are personal/habit goals, distinct from the
                      Business section's goals, and tasks link here via
                      task.goalId.

   All reads/writes to localStorage go through the small Storage object
   below — nothing else in this file calls window.JarvisCore.loadJSON/
   saveJSON directly. Swapping to a real backend (Supabase/Firebase) later
   means only rewriting Storage's five functions (likely to return
   Promises), not the rendering/logic code that calls them.

   Module layout in this file, top to bottom: Storage, date helpers, Tasks,
   Habits, Goals, Stats, Today Overview + day selector, boot/wiring.
   ========================================================================== */

(function () {
  "use strict";

  const LS_TASKS = "jarvisTasks";
  const LS_HABITS = "jarvisHabits";
  const LS_GOALS = "jarvisGoals";

  const Storage = {
    loadTasks: function () { return window.JarvisCore.loadJSON(LS_TASKS, []); },
    saveTasks: function (v) { window.JarvisCore.saveJSON(LS_TASKS, v); },
    loadHabits: function () { return window.JarvisCore.loadJSON(LS_HABITS, []); },
    saveHabits: function (v) { window.JarvisCore.saveJSON(LS_HABITS, v); },
    loadGoals: function () { return window.JarvisCore.loadJSON(LS_GOALS, []); },
    saveGoals: function (v) { window.JarvisCore.saveJSON(LS_GOALS, v); }
  };

  let tasks = [];
  let habits = [];
  let goals = [];

  // Transient (not persisted) UI state.
  let selectedDate = "";
  let daySelectorWeekOffset = 0;
  let historyWeekOffset = 0;
  let taskFormEditId = null;
  let habitFormEditId = null;
  let goalFormEditId = null;
  let taskMenuOpenId = null;
  let taskDuplicateSubmenuOpenId = null;

  function $(id) { return document.getElementById(id); }

  /* ---------------- date helpers ----------------
     Deliberately never parses a "YYYY-MM-DD" string with `new Date(str)`
     (that's parsed as UTC and can land on the wrong local weekday) — every
     helper here builds/reads dates via explicit local Y/M/D components. */

  function parseISODateLocal(iso) {
    const parts = iso.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function toISODateLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDaysISO(iso, n) {
    const d = parseISODateLocal(iso);
    d.setDate(d.getDate() + n);
    return toISODateLocal(d);
  }
  function getMondayISO(iso) {
    const d = parseISODateLocal(iso);
    const day = d.getDay(); // 0 = Sun .. 6 = Sat
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return toISODateLocal(d);
  }
  function getWeekDatesISO(mondayIso) {
    const out = [];
    for (let i = 0; i < 7; i++) out.push(addDaysISO(mondayIso, i));
    return out;
  }
  function formatWeekdayShort(iso) { return parseISODateLocal(iso).toLocaleDateString("en-US", { weekday: "short" }); }
  function formatShortDate(iso) { return parseISODateLocal(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function isNonNegativeNumber(v) { const n = Number(v); return isFinite(n) && n >= 0; }

  /* ---------------- persistence / load ---------------- */

  // Upgrades a pre-existing habit (completedDates: [iso,...]) into the new
  // shape (completions: {iso: count}) the first time it's loaded — a simple
  // check-off habit becomes dailyTarget 1, each completed date gets count 1.
  // Idempotent: already-migrated habits pass through unchanged.
  function migrateHabit(raw) {
    const core = window.JarvisCore;
    const h = {
      id: raw.id || core.uid("habit"),
      name: String(raw.name || "").slice(0, 60),
      targetDays: clampInt(raw.targetDays, 1, 7, 7),
      dailyTarget: clampInt(raw.dailyTarget, 1, 50, 1),
      completions: {},
      createdAt: raw.createdAt || Date.now()
    };
    if (raw.completions && typeof raw.completions === "object" && !Array.isArray(raw.completions)) {
      Object.keys(raw.completions).forEach(function (d) {
        const n = Number(raw.completions[d]);
        if (isFinite(n) && n >= 0) h.completions[d] = n;
      });
    } else if (Array.isArray(raw.completedDates)) {
      raw.completedDates.forEach(function (d) { if (typeof d === "string") h.completions[d] = 1; });
    }
    return h;
  }

  function load() {
    const loadedTasks = Storage.loadTasks();
    tasks = Array.isArray(loadedTasks) ? loadedTasks : [];

    const loadedHabits = Storage.loadHabits();
    habits = (Array.isArray(loadedHabits) ? loadedHabits : []).map(migrateHabit);

    const loadedGoals = Storage.loadGoals();
    goals = Array.isArray(loadedGoals) ? loadedGoals : [];

    selectedDate = window.JarvisCore.todayISODate();
  }

  function saveTasks() { Storage.saveTasks(tasks); }
  function saveHabits() { Storage.saveHabits(habits); }
  function saveGoalsData() { Storage.saveGoals(goals); }

  /* ==================== TASKS ==================== */

  function tasksForDate(date) {
    return tasks.filter(function (t) { return t.date === date; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function nextOrderForDate(date) {
    const list = tasksForDate(date);
    return list.length ? Math.max.apply(null, list.map(function (t) { return t.order || 0; })) + 1 : 0;
  }

  function resetTaskForm() {
    taskFormEditId = null;
    $("taskForm").classList.add("hidden");
    $("taskText").value = "";
    $("taskPriority").value = "medium";
    $("taskTime").value = "";
    $("taskCategory").value = "";
    $("taskGoalSelect").value = "";
    $("taskFormTitle").textContent = "Add Task";
    $("taskFormSubmitBtn").textContent = "Add Task";
    $("taskFormCancelBtn").classList.add("hidden");
    $("taskRepeatDetails").classList.remove("hidden");
    $("taskRepeatDetails").open = false;
    renderTaskRepeatDaysRow();
  }

  function renderTaskRepeatDaysRow() {
    const weekDates = getWeekDatesISO(getMondayISO(selectedDate));
    $("taskRepeatDaysRow").innerHTML = weekDates.map(function (d) {
      return '<button type="button" class="day-picker-btn" data-date="' + d + '"' + (d === selectedDate ? " disabled" : "") + '>' + formatWeekdayShort(d).slice(0, 1) + '</button>';
    }).join("");
  }

  function renderTaskGoalSelectOptions() {
    const core = window.JarvisCore;
    const sel = $("taskGoalSelect");
    const current = sel.value;
    sel.innerHTML = '<option value="">None</option>' + goals.map(function (g) {
      return '<option value="' + core.escapeHtml(g.id) + '">' + core.escapeHtml(g.name) + '</option>';
    }).join("");
    if (goals.some(function (g) { return g.id === current; })) sel.value = current;
  }

  function handleTaskAddToggle() {
    const isHidden = $("taskForm").classList.contains("hidden");
    if (isHidden) {
      resetTaskForm();
      $("taskForm").classList.remove("hidden");
      $("taskText").focus();
    } else {
      resetTaskForm();
    }
  }

  function handleTaskFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const text = $("taskText").value.trim();
    if (!text) { core.showToast("Enter a task."); return; }
    const raw = {
      text: text,
      priority: $("taskPriority").value,
      time: $("taskTime").value,
      category: $("taskCategory").value.trim(),
      goalId: $("taskGoalSelect").value || null
    };
    if (taskFormEditId) {
      const t = tasks.find(function (tt) { return tt.id === taskFormEditId; });
      if (t) Object.assign(t, raw);
    } else {
      const repeatDates = Array.prototype.slice.call($("taskRepeatDaysRow").querySelectorAll(".day-picker-btn.selected"))
        .map(function (b) { return b.getAttribute("data-date"); });
      const datesToCreate = [selectedDate].concat(repeatDates.filter(function (d) { return d !== selectedDate; }));
      datesToCreate.forEach(function (d) {
        tasks.push(Object.assign({}, raw, { id: core.uid("task"), date: d, completed: false, order: nextOrderForDate(d), createdAt: Date.now() }));
      });
    }
    saveTasks();
    resetTaskForm();
    renderTaskList();
    renderDaySelectorPills();
    renderTodayOverview();
    core.showToast(taskFormEditId ? "Task updated." : "Task added.");
  }

  function taskMenuHtml(t) {
    const core = window.JarvisCore;
    if (taskDuplicateSubmenuOpenId === t.id) {
      const week = getWeekDatesISO(getMondayISO(t.date));
      return (
        '<div class="food-item-menu">' +
          week.filter(function (d) { return d !== t.date; }).map(function (d) {
            return '<button type="button" class="food-item-menu-item task-duplicate-target-btn" data-id="' + core.escapeHtml(t.id) + '" data-target-date="' + d + '">Copy to ' + formatWeekdayShort(d) + ' ' + formatShortDate(d) + '</button>';
          }).join("") +
          '<button type="button" class="food-item-menu-item task-duplicate-cancel-btn" data-id="' + core.escapeHtml(t.id) + '">&larr; Back</button>' +
        '</div>'
      );
    }
    return (
      '<div class="food-item-menu">' +
        '<button type="button" class="food-item-menu-item task-edit-btn" data-id="' + core.escapeHtml(t.id) + '">Edit</button>' +
        '<button type="button" class="food-item-menu-item task-tomorrow-btn" data-id="' + core.escapeHtml(t.id) + '">Move to Tomorrow</button>' +
        '<button type="button" class="food-item-menu-item task-duplicate-btn" data-id="' + core.escapeHtml(t.id) + '">Duplicate to another day</button>' +
        '<button type="button" class="food-item-menu-item task-move-up-btn" data-id="' + core.escapeHtml(t.id) + '">Move up</button>' +
        '<button type="button" class="food-item-menu-item task-move-down-btn" data-id="' + core.escapeHtml(t.id) + '">Move down</button>' +
        '<button type="button" class="food-item-menu-item danger task-delete-btn" data-id="' + core.escapeHtml(t.id) + '">Delete</button>' +
      '</div>'
    );
  }

  function taskRowHtml(t) {
    const core = window.JarvisCore;
    const prioClass = t.priority === "high" ? "badge-red" : t.priority === "low" ? "badge-green" : "badge-yellow";
    const prioLabel = t.priority === "high" ? "High" : t.priority === "low" ? "Low" : "Medium";
    const metaParts = [];
    if (t.time) metaParts.push(core.escapeHtml(t.time));
    if (t.category) metaParts.push(core.escapeHtml(t.category));
    if (t.goalId) {
      const g = goals.find(function (gg) { return gg.id === t.goalId; });
      if (g) metaParts.push("Goal: " + core.escapeHtml(g.name));
    }
    const menuOpen = taskMenuOpenId === t.id;
    // Reuses Nutrition's .food-item-* card/menu styles and the existing
    // .habit-check-btn circular-check style — see the CSS note in
    // style.css's Habits section for why these aren't duplicated.
    return (
      '<div class="food-item-card task-row' + (t.completed ? " task-row-done" : "") + '" data-id="' + core.escapeHtml(t.id) + '">' +
        '<button type="button" class="habit-check-btn task-check-btn' + (t.completed ? " done" : "") + '" data-id="' + core.escapeHtml(t.id) + '" aria-pressed="' + !!t.completed + '" aria-label="Toggle task complete">' + (t.completed ? "&#10003;" : "") + '</button>' +
        '<div class="food-item-main">' +
          '<div class="food-item-title-row">' +
            '<span class="food-item-title task-text">' + core.escapeHtml(t.text) + '</span>' +
            '<span class="badge ' + prioClass + '">' + prioLabel + '</span>' +
          '</div>' +
          (metaParts.length ? '<div class="food-item-meta">' + metaParts.join(" &middot; ") + '</div>' : "") +
        '</div>' +
        '<div class="food-item-menu-wrap">' +
          '<button type="button" class="food-item-menu-btn task-menu-btn" data-id="' + core.escapeHtml(t.id) + '" aria-label="Task options">&#8942;</button>' +
          (menuOpen ? taskMenuHtml(t) : "") +
        '</div>' +
      '</div>'
    );
  }

  function renderTaskList() {
    const container = $("taskList");
    const list = tasksForDate(selectedDate);
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">No tasks for this day yet.</div>';
      return;
    }
    const incomplete = list.filter(function (t) { return !t.completed; });
    const complete = list.filter(function (t) { return t.completed; });
    let html = incomplete.map(taskRowHtml).join("");
    if (complete.length) {
      html += '<h3 class="checklist-title" style="margin-top:12px;">Completed</h3>' + complete.map(taskRowHtml).join("");
    }
    container.innerHTML = html;
  }

  function startEditTask(t) {
    taskFormEditId = t.id;
    $("taskForm").classList.remove("hidden");
    $("taskText").value = t.text;
    $("taskPriority").value = t.priority || "medium";
    $("taskTime").value = t.time || "";
    $("taskCategory").value = t.category || "";
    renderTaskGoalSelectOptions();
    $("taskGoalSelect").value = t.goalId || "";
    $("taskFormTitle").textContent = "Edit Task";
    $("taskFormSubmitBtn").textContent = "Save Changes";
    $("taskFormCancelBtn").classList.remove("hidden");
    $("taskRepeatDetails").classList.add("hidden"); // repeat-on-days only applies when creating
    $("taskText").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleTaskListClick(e) {
    const core = window.JarvisCore;

    const checkBtn = e.target.closest(".task-check-btn");
    if (checkBtn) {
      const t = tasks.find(function (tt) { return tt.id === checkBtn.getAttribute("data-id"); });
      if (t) { t.completed = !t.completed; saveTasks(); renderTaskList(); renderTodayOverview(); }
      return;
    }
    const menuBtn = e.target.closest(".task-menu-btn");
    if (menuBtn) {
      const id = menuBtn.getAttribute("data-id");
      taskDuplicateSubmenuOpenId = null;
      taskMenuOpenId = taskMenuOpenId === id ? null : id;
      renderTaskList();
      return;
    }
    const dupBtn = e.target.closest(".task-duplicate-btn");
    if (dupBtn) { taskDuplicateSubmenuOpenId = dupBtn.getAttribute("data-id"); renderTaskList(); return; }
    const dupCancelBtn = e.target.closest(".task-duplicate-cancel-btn");
    if (dupCancelBtn) { taskDuplicateSubmenuOpenId = null; renderTaskList(); return; }
    const dupTargetBtn = e.target.closest(".task-duplicate-target-btn");
    if (dupTargetBtn) {
      const t = tasks.find(function (tt) { return tt.id === dupTargetBtn.getAttribute("data-id"); });
      const targetDate = dupTargetBtn.getAttribute("data-target-date");
      if (t) {
        tasks.push(Object.assign({}, t, { id: core.uid("task"), date: targetDate, completed: false, order: nextOrderForDate(targetDate), createdAt: Date.now() }));
        saveTasks();
        core.showToast("Copied to " + formatWeekdayShort(targetDate) + ".");
      }
      taskMenuOpenId = null; taskDuplicateSubmenuOpenId = null;
      renderTaskList(); renderDaySelectorPills();
      return;
    }
    const tomorrowBtn = e.target.closest(".task-tomorrow-btn");
    if (tomorrowBtn) {
      const t = tasks.find(function (tt) { return tt.id === tomorrowBtn.getAttribute("data-id"); });
      if (t) { t.date = addDaysISO(t.date, 1); t.order = nextOrderForDate(t.date); saveTasks(); core.showToast("Moved to tomorrow."); }
      taskMenuOpenId = null;
      renderTaskList(); renderDaySelectorPills(); renderTodayOverview();
      return;
    }
    const upBtn = e.target.closest(".task-move-up-btn");
    if (upBtn) { reorderTask(upBtn.getAttribute("data-id"), -1); return; }
    const downBtn = e.target.closest(".task-move-down-btn");
    if (downBtn) { reorderTask(downBtn.getAttribute("data-id"), 1); return; }
    const editBtn = e.target.closest(".task-edit-btn");
    if (editBtn) {
      const t = tasks.find(function (tt) { return tt.id === editBtn.getAttribute("data-id"); });
      if (t) { taskMenuOpenId = null; renderTaskList(); startEditTask(t); }
      return;
    }
    const delBtn = e.target.closest(".task-delete-btn");
    if (delBtn) {
      const t = tasks.find(function (tt) { return tt.id === delBtn.getAttribute("data-id"); });
      if (!t) return;
      if (!window.confirm('Delete "' + t.text + '"? This can\'t be undone.')) return;
      tasks = tasks.filter(function (tt) { return tt.id !== t.id; });
      saveTasks();
      taskMenuOpenId = null;
      renderTaskList(); renderDaySelectorPills(); renderTodayOverview();
      core.showToast("Task deleted.");
    }
  }

  function reorderTask(id, direction) {
    const t = tasks.find(function (tt) { return tt.id === id; });
    if (!t) return;
    const list = tasksForDate(t.date);
    const idx = list.findIndex(function (tt) { return tt.id === id; });
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const tmp = list[idx].order;
    list[idx].order = list[swapIdx].order;
    list[swapIdx].order = tmp;
    saveTasks();
    taskMenuOpenId = null;
    renderTaskList();
  }

  /* ==================== HABITS ==================== */

  function habitDailyTarget(h) { return (h.dailyTarget && h.dailyTarget > 1) ? h.dailyTarget : 1; }
  function habitCountOn(h, date) { return (h.completions && h.completions[date]) || 0; }
  function isHabitDoneOnDate(h, date) { return habitCountOn(h, date) >= habitDailyTarget(h); }

  function computeCurrentStreak(h) {
    let streak = 0;
    let cursor = window.JarvisCore.todayISODate();
    for (;;) {
      if (isHabitDoneOnDate(h, cursor)) { streak++; cursor = addDaysISO(cursor, -1); } else break;
    }
    return streak;
  }

  function computeLongestStreak(h) {
    const doneDates = Object.keys(h.completions || {}).filter(function (d) { return isHabitDoneOnDate(h, d); }).sort();
    if (doneDates.length === 0) return 0;
    let longest = 1, current = 1;
    for (let i = 1; i < doneDates.length; i++) {
      const diffDays = Math.round((parseISODateLocal(doneDates[i]) - parseISODateLocal(doneDates[i - 1])) / 86400000);
      current = diffDays === 1 ? current + 1 : 1;
      if (current > longest) longest = current;
    }
    return longest;
  }

  function habitWeeklyDone(h, weekDates) {
    return weekDates.reduce(function (sum, d) { return sum + Math.min(habitCountOn(h, d), habitDailyTarget(h)); }, 0);
  }
  function habitWeeklyTarget(h) { return h.targetDays * habitDailyTarget(h); }
  function habitTotalCompletions(h) {
    return Object.keys(h.completions || {}).reduce(function (sum, d) { return sum + (h.completions[d] || 0); }, 0);
  }

  function resetHabitForm() {
    habitFormEditId = null;
    $("habitName").value = "";
    $("habitTargetDays").value = "7";
    $("habitDailyTarget").value = "1";
    $("habitFormTitle").textContent = "Add a Habit";
    $("habitSubmitBtn").textContent = "Add Habit";
    $("habitFormCancelBtn").classList.add("hidden");
  }

  function handleHabitFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("habitName").value.trim();
    if (!name) { core.showToast("Please enter a habit name."); return; }
    const targetDays = clampInt($("habitTargetDays").value, 1, 7, 7);
    const dailyTarget = clampInt($("habitDailyTarget").value, 1, 50, 1);
    if (habitFormEditId) {
      const h = habits.find(function (hh) { return hh.id === habitFormEditId; });
      if (h) { h.name = name; h.targetDays = targetDays; h.dailyTarget = dailyTarget; }
    } else {
      habits.push({ id: core.uid("habit"), name: name, targetDays: targetDays, dailyTarget: dailyTarget, completions: {}, createdAt: Date.now() });
    }
    saveHabits();
    resetHabitForm();
    renderAllHabitViews();
    core.showToast(habitFormEditId ? "Habit updated." : "Habit added.");
  }

  function habitCardHtml(h) {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const count = habitCountOn(h, today);
    const target = habitDailyTarget(h);
    const done = isHabitDoneOnDate(h, today);
    const streak = computeCurrentStreak(h);
    const weekDates = getWeekDatesISO(getMondayISO(today));
    const weeklyDone = habitWeeklyDone(h, weekDates);
    const weeklyTargetVal = habitWeeklyTarget(h);
    const total = habitTotalCompletions(h);
    const isCountHabit = target > 1;
    return (
      '<div class="habit-card" data-id="' + core.escapeHtml(h.id) + '">' +
        '<div class="habit-card-header"><span class="habit-card-name">' + core.escapeHtml(h.name) + '</span></div>' +
        (isCountHabit
          ? '<div class="habit-card-today-row">' +
              '<span class="field-hint">Today: ' + count + ' / ' + target + '</span>' +
              '<div class="stepper-row">' +
                '<button type="button" class="stepper-btn habit-decrement-btn" data-id="' + core.escapeHtml(h.id) + '" aria-label="Decrease">&minus;</button>' +
                '<span class="habit-card-count-value">' + count + '</span>' +
                '<button type="button" class="stepper-btn habit-increment-btn" data-id="' + core.escapeHtml(h.id) + '" aria-label="Increase">+</button>' +
              '</div>' +
            '</div>'
          : '<button type="button" class="habit-check-btn' + (done ? " done" : "") + '" data-id="' + core.escapeHtml(h.id) + '" aria-pressed="' + done + '" style="align-self:flex-start;width:auto;border-radius:var(--radius-sm);padding:8px 14px;">' + (done ? "&#10003; Completed Today" : "Mark Complete") + '</button>'
        ) +
        '<div class="habit-card-body">' +
          '<span>Weekly: ' + weeklyDone + ' / ' + weeklyTargetVal + '</span>' +
          '<span>Current streak: ' + streak + ' day' + (streak === 1 ? "" : "s") + '</span>' +
          '<span>Total: ' + total + ' completion' + (total === 1 ? "" : "s") + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function renderTodayHabitsList() {
    const container = $("todayHabitsList");
    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">No habits yet — add one in the Week tab.</div>';
      return;
    }
    container.innerHTML = habits.map(habitCardHtml).join("");
  }

  function handleTodayHabitsClick(e) {
    const today = window.JarvisCore.todayISODate();
    const incBtn = e.target.closest(".habit-increment-btn");
    if (incBtn) {
      const h = habits.find(function (hh) { return hh.id === incBtn.getAttribute("data-id"); });
      if (h) { h.completions = h.completions || {}; h.completions[today] = (h.completions[today] || 0) + 1; saveHabits(); renderAllHabitViews(); }
      return;
    }
    const decBtn = e.target.closest(".habit-decrement-btn");
    if (decBtn) {
      const h = habits.find(function (hh) { return hh.id === decBtn.getAttribute("data-id"); });
      if (h) { h.completions = h.completions || {}; h.completions[today] = Math.max(0, (h.completions[today] || 0) - 1); saveHabits(); renderAllHabitViews(); }
      return;
    }
    const checkBtn = e.target.closest(".habit-check-btn");
    if (checkBtn) {
      const h = habits.find(function (hh) { return hh.id === checkBtn.getAttribute("data-id"); });
      if (h) {
        h.completions = h.completions || {};
        h.completions[today] = isHabitDoneOnDate(h, today) ? 0 : habitDailyTarget(h);
        saveHabits(); renderAllHabitViews();
      }
    }
  }

  function renderHabitManageList() {
    const core = window.JarvisCore;
    const container = $("habitManageList");
    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">No habits yet. Add one above to start tracking.</div>';
      return;
    }
    container.innerHTML = habits.map(function (h) {
      const streak = computeCurrentStreak(h);
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(h.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(h.name) + '</span>' +
              '<span class="list-item-meta">Target ' + h.targetDays + 'x/week' + (h.dailyTarget > 1 ? " &middot; " + h.dailyTarget + "/day" : "") + " &middot; " + streak + ' day streak</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon habit-edit-btn" data-id="' + core.escapeHtml(h.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger habit-delete-btn" data-id="' + core.escapeHtml(h.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleHabitManageListClick(e) {
    const editBtn = e.target.closest(".habit-edit-btn");
    if (editBtn) {
      const h = habits.find(function (hh) { return hh.id === editBtn.getAttribute("data-id"); });
      if (!h) return;
      habitFormEditId = h.id;
      $("habitName").value = h.name;
      $("habitTargetDays").value = h.targetDays;
      $("habitDailyTarget").value = h.dailyTarget;
      $("habitFormTitle").textContent = "Edit Habit";
      $("habitSubmitBtn").textContent = "Save Changes";
      $("habitFormCancelBtn").classList.remove("hidden");
      $("habitName").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const delBtn = e.target.closest(".habit-delete-btn");
    if (delBtn) {
      const h = habits.find(function (hh) { return hh.id === delBtn.getAttribute("data-id"); });
      if (!h) return;
      if (!window.confirm('Delete habit "' + h.name + '"? This removes its entire history and can\'t be undone.')) return;
      habits = habits.filter(function (hh) { return hh.id !== h.id; });
      saveHabits();
      renderAllHabitViews();
      window.JarvisCore.showToast("Habit deleted.");
    }
  }

  function renderHabitHistoryGrid() {
    const core = window.JarvisCore;
    const container = $("habitHistoryGrid");
    const monday = getMondayISO(addDaysISO(core.todayISODate(), historyWeekOffset * 7));
    const weekDates = getWeekDatesISO(monday);
    $("historyWeekLabel").textContent = formatShortDate(weekDates[0]) + " – " + formatShortDate(weekDates[6]);
    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">No habits yet — add one below.</div>';
      return;
    }
    const headerCells = weekDates.map(function (d) { return "<th>" + formatWeekdayShort(d).slice(0, 1) + "</th>"; }).join("");
    const rows = habits.map(function (h) {
      const cells = weekDates.map(function (d) {
        const done = isHabitDoneOnDate(h, d);
        return '<td><span class="habit-history-dot' + (done ? " done" : "") + '">' + (done ? "&#10003;" : "&#9675;") + "</span></td>";
      }).join("");
      return '<tr><td class="habit-history-row-name">' + core.escapeHtml(h.name) + "</td>" + cells + "</tr>";
    }).join("");
    container.innerHTML = '<table class="habit-history-grid"><thead><tr><th></th>' + headerCells + "</tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function handleHistoryWeekNav(delta) {
    historyWeekOffset += delta;
    renderHabitHistoryGrid();
  }

  function renderAllHabitViews() {
    renderTodayHabitsList();
    renderHabitManageList();
    renderHabitHistoryGrid();
    renderTodayOverview();
  }

  /* ==================== GOALS ==================== */

  function goalProgressPct(g) {
    if (g.completed) return 100;
    if (g.hasNumericTarget && isFinite(g.targetValue) && g.targetValue !== 0) {
      return Math.min(100, Math.max(0, Math.round((g.currentValue / g.targetValue) * 100)));
    }
    return Math.min(100, Math.max(0, Math.round(g.manualProgressPct || 0)));
  }

  function updateGoalFormNumericVisibility() {
    const hasNumeric = $("habitsGoalHasNumeric").checked;
    $("habitsGoalNumericRow").classList.toggle("hidden", !hasNumeric);
    $("habitsGoalUnitRow").classList.toggle("hidden", !hasNumeric);
    $("habitsGoalManualProgressRow").classList.toggle("hidden", hasNumeric);
  }

  function resetGoalForm() {
    goalFormEditId = null;
    $("habitsGoalName").value = "";
    $("habitsGoalDescription").value = "";
    $("habitsGoalCategory").value = "";
    $("habitsGoalTargetDate").value = "";
    $("habitsGoalHasNumeric").checked = false;
    $("habitsGoalCurrentValue").value = "";
    $("habitsGoalTargetValue").value = "";
    $("habitsGoalUnit").value = "";
    $("habitsGoalManualProgress").value = "0";
    $("habitsGoalFormTitle").textContent = "Create a Goal";
    $("habitsGoalSubmitBtn").textContent = "Save Goal";
    $("habitsGoalCancelBtn").classList.add("hidden");
    updateGoalFormNumericVisibility();
  }

  function handleGoalFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("habitsGoalName").value.trim();
    if (!name) { core.showToast("Give the goal a name."); return; }
    const hasNumeric = $("habitsGoalHasNumeric").checked;
    if (hasNumeric && !isNonNegativeNumber($("habitsGoalTargetValue").value)) {
      core.showToast("Enter a valid target value."); return;
    }
    const raw = {
      name: name,
      description: $("habitsGoalDescription").value.trim(),
      category: $("habitsGoalCategory").value.trim(),
      targetDate: $("habitsGoalTargetDate").value,
      hasNumericTarget: hasNumeric,
      currentValue: hasNumeric ? Number($("habitsGoalCurrentValue").value) || 0 : 0,
      targetValue: hasNumeric ? Number($("habitsGoalTargetValue").value) || 0 : 0,
      unit: hasNumeric ? $("habitsGoalUnit").value.trim() : "",
      manualProgressPct: hasNumeric ? 0 : clampInt($("habitsGoalManualProgress").value, 0, 100, 0)
    };
    if (goalFormEditId) {
      const g = goals.find(function (gg) { return gg.id === goalFormEditId; });
      if (g) Object.assign(g, raw);
    } else {
      goals.push(Object.assign({}, raw, { id: core.uid("goal"), completed: false, milestones: [], createdAt: Date.now() }));
    }
    saveGoalsData();
    resetGoalForm();
    renderGoalsList();
    renderTaskGoalSelectOptions();
    core.showToast(goalFormEditId ? "Goal updated." : "Goal created.");
  }

  function goalCardHtml(g) {
    const core = window.JarvisCore;
    const pct = goalProgressPct(g);
    const linkedTasks = tasks.filter(function (t) { return t.goalId === g.id; });
    const metaParts = [];
    if (g.category) metaParts.push(core.escapeHtml(g.category));
    if (g.targetDate) metaParts.push("Target: " + core.formatDate(g.targetDate));
    const unitSuffix = g.unit ? (" " + core.escapeHtml(g.unit)) : "";
    const valueLine = g.hasNumericTarget ? (g.currentValue + unitSuffix + " / " + g.targetValue + unitSuffix) : (pct + "%");

    const milestonesHtml = (g.milestones || []).map(function (m) {
      return (
        '<div class="checklist-item">' +
          '<input type="checkbox" class="goal-milestone-toggle" data-goal-id="' + core.escapeHtml(g.id) + '" data-milestone-id="' + core.escapeHtml(m.id) + '"' + (m.done ? " checked" : "") + '>' +
          '<label>' + core.escapeHtml(m.text) + '</label>' +
          '<button type="button" class="btn-icon danger goal-milestone-delete-btn" data-goal-id="' + core.escapeHtml(g.id) + '" data-milestone-id="' + core.escapeHtml(m.id) + '" style="margin-left:auto;" aria-label="Delete milestone">&times;</button>' +
        '</div>'
      );
    }).join("");

    return (
      '<div class="list-item" data-id="' + core.escapeHtml(g.id) + '">' +
        '<div class="list-item-main">' +
          '<span class="list-item-title">' + core.escapeHtml(g.name) + (g.completed ? ' <span class="badge badge-green">Complete</span>' : "") + '</span>' +
          (metaParts.length ? '<span class="list-item-meta">' + metaParts.join(" &middot; ") + '</span>' : "") +
          (g.description ? '<span class="list-item-meta">' + core.escapeHtml(g.description) + '</span>' : "") +
          '<div class="nutri-bar-row" style="margin-top:8px;">' +
            '<div class="nutri-bar-label"><span>Progress</span><span class="nutri-bar-value">' + valueLine + '</span></div>' +
            '<div class="nutri-bar-track"><div class="nutri-bar-fill" style="width:' + pct + '%"></div></div>' +
          '</div>' +
        '</div>' +
        (g.hasNumericTarget
          ? '<div class="form-row two-col" style="margin-top:10px;">' +
              '<input type="number" class="goal-progress-input" data-id="' + core.escapeHtml(g.id) + '" value="' + g.currentValue + '" step="any">' +
              '<button type="button" class="btn-icon goal-update-progress-btn" data-id="' + core.escapeHtml(g.id) + '">Update Progress</button>' +
            '</div>'
          : '<div class="stepper-row" style="grid-template-columns:auto auto auto;justify-content:start;margin-top:10px;">' +
              '<button type="button" class="stepper-btn goal-progress-minus-btn" data-id="' + core.escapeHtml(g.id) + '" aria-label="Decrease progress">&minus;</button>' +
              '<span class="habit-card-count-value">' + pct + '%</span>' +
              '<button type="button" class="stepper-btn goal-progress-plus-btn" data-id="' + core.escapeHtml(g.id) + '" aria-label="Increase progress">+</button>' +
            '</div>'
        ) +
        (linkedTasks.length
          ? '<div style="margin-top:10px;"><h4 class="checklist-title" style="font-size:12px;">Linked Tasks</h4><ul class="plain-list">' +
              linkedTasks.map(function (t) { return "<li>" + (t.completed ? "&#10003; " : "&#9675; ") + core.escapeHtml(t.text) + "</li>"; }).join("") +
            "</ul></div>"
          : "") +
        '<div style="margin-top:10px;">' +
          '<h4 class="checklist-title" style="font-size:12px;">Milestones</h4>' +
          milestonesHtml +
          '<div class="form-row two-col" style="margin-top:6px;">' +
            '<input type="text" class="goal-milestone-input" data-id="' + core.escapeHtml(g.id) + '" placeholder="Add a milestone" maxlength="80">' +
            '<button type="button" class="btn-icon goal-milestone-add-btn" data-id="' + core.escapeHtml(g.id) + '">+ Add</button>' +
          '</div>' +
        '</div>' +
        '<div class="list-item-actions" style="margin-top:10px;">' +
          '<button type="button" class="btn-icon goal-complete-btn" data-id="' + core.escapeHtml(g.id) + '">' + (g.completed ? "Mark Incomplete" : "Mark Complete") + '</button>' +
          '<button type="button" class="btn-icon goal-edit-btn" data-id="' + core.escapeHtml(g.id) + '">Edit</button>' +
          '<button type="button" class="btn-icon danger goal-delete-btn" data-id="' + core.escapeHtml(g.id) + '">Delete</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderGoalsList() {
    const container = $("habitsGoalsList");
    if (goals.length === 0) {
      container.innerHTML = '<div class="empty-state">No goals yet. Create one above.</div>';
      return;
    }
    container.innerHTML = goals.map(goalCardHtml).join("");
  }

  function startEditGoal(g) {
    goalFormEditId = g.id;
    $("habitsGoalName").value = g.name;
    $("habitsGoalDescription").value = g.description || "";
    $("habitsGoalCategory").value = g.category || "";
    $("habitsGoalTargetDate").value = g.targetDate || "";
    $("habitsGoalHasNumeric").checked = !!g.hasNumericTarget;
    $("habitsGoalCurrentValue").value = g.hasNumericTarget ? g.currentValue : "";
    $("habitsGoalTargetValue").value = g.hasNumericTarget ? g.targetValue : "";
    $("habitsGoalUnit").value = g.unit || "";
    $("habitsGoalManualProgress").value = g.hasNumericTarget ? "0" : (g.manualProgressPct || 0);
    updateGoalFormNumericVisibility();
    $("habitsGoalFormTitle").textContent = "Edit Goal";
    $("habitsGoalSubmitBtn").textContent = "Save Changes";
    $("habitsGoalCancelBtn").classList.remove("hidden");
    $("habitsGoalName").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleGoalsListClick(e) {
    const core = window.JarvisCore;

    const updateBtn = e.target.closest(".goal-update-progress-btn");
    if (updateBtn) {
      const id = updateBtn.getAttribute("data-id");
      const g = goals.find(function (gg) { return gg.id === id; });
      const input = updateBtn.closest(".list-item").querySelector(".goal-progress-input");
      if (g && input && isNonNegativeNumber(input.value)) {
        g.currentValue = Number(input.value);
        if (g.targetValue > 0 && g.currentValue >= g.targetValue) g.completed = true;
        saveGoalsData(); renderGoalsList(); core.showToast("Progress updated.");
      }
      return;
    }
    const plusBtn = e.target.closest(".goal-progress-plus-btn");
    if (plusBtn) {
      const g = goals.find(function (gg) { return gg.id === plusBtn.getAttribute("data-id"); });
      if (g) { g.manualProgressPct = clampInt((g.manualProgressPct || 0) + 5, 0, 100, 0); if (g.manualProgressPct >= 100) g.completed = true; saveGoalsData(); renderGoalsList(); }
      return;
    }
    const minusBtn = e.target.closest(".goal-progress-minus-btn");
    if (minusBtn) {
      const g = goals.find(function (gg) { return gg.id === minusBtn.getAttribute("data-id"); });
      if (g) { g.manualProgressPct = clampInt((g.manualProgressPct || 0) - 5, 0, 100, 0); saveGoalsData(); renderGoalsList(); }
      return;
    }
    const milestoneAddBtn = e.target.closest(".goal-milestone-add-btn");
    if (milestoneAddBtn) {
      const id = milestoneAddBtn.getAttribute("data-id");
      const g = goals.find(function (gg) { return gg.id === id; });
      const input = milestoneAddBtn.closest(".list-item").querySelector(".goal-milestone-input");
      const text = input ? input.value.trim() : "";
      if (g && text) {
        g.milestones = g.milestones || [];
        g.milestones.push({ id: core.uid("milestone"), text: text, done: false });
        saveGoalsData(); renderGoalsList();
      }
      return;
    }
    const milestoneDelBtn = e.target.closest(".goal-milestone-delete-btn");
    if (milestoneDelBtn) {
      const g = goals.find(function (gg) { return gg.id === milestoneDelBtn.getAttribute("data-goal-id"); });
      const mid = milestoneDelBtn.getAttribute("data-milestone-id");
      if (g) { g.milestones = (g.milestones || []).filter(function (m) { return m.id !== mid; }); saveGoalsData(); renderGoalsList(); }
      return;
    }
    const completeBtn = e.target.closest(".goal-complete-btn");
    if (completeBtn) {
      const g = goals.find(function (gg) { return gg.id === completeBtn.getAttribute("data-id"); });
      if (g) { g.completed = !g.completed; saveGoalsData(); renderGoalsList(); renderStats(); }
      return;
    }
    const editBtn = e.target.closest(".goal-edit-btn");
    if (editBtn) {
      const g = goals.find(function (gg) { return gg.id === editBtn.getAttribute("data-id"); });
      if (g) startEditGoal(g);
      return;
    }
    const delBtn = e.target.closest(".goal-delete-btn");
    if (delBtn) {
      const g = goals.find(function (gg) { return gg.id === delBtn.getAttribute("data-id"); });
      if (!g) return;
      if (!window.confirm('Delete goal "' + g.name + '"? This can\'t be undone.')) return;
      goals = goals.filter(function (gg) { return gg.id !== g.id; });
      // Un-link, never silently delete, any tasks that pointed at this goal.
      tasks.forEach(function (t) { if (t.goalId === g.id) t.goalId = null; });
      saveGoalsData(); saveTasks();
      renderGoalsList(); renderTaskGoalSelectOptions(); renderTaskList();
      core.showToast("Goal deleted.");
    }
  }

  function handleGoalsListChange(e) {
    const toggle = e.target.closest(".goal-milestone-toggle");
    if (!toggle) return;
    const g = goals.find(function (gg) { return gg.id === toggle.getAttribute("data-goal-id"); });
    const mid = toggle.getAttribute("data-milestone-id");
    if (!g) return;
    const m = (g.milestones || []).find(function (mm) { return mm.id === mid; });
    if (m) { m.done = toggle.checked; saveGoalsData(); }
  }

  /* ==================== STATS ==================== */

  function statBoxHtml(value, label) {
    return '<div class="stat-box"><span class="stat-value">' + value + '</span><span class="stat-label">' + label + '</span></div>';
  }

  function computeProductivityStats() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const weekDates = getWeekDatesISO(getMondayISO(today));

    const tasksToday = tasksForDate(today);
    const tasksTodayDone = tasksToday.filter(function (t) { return t.completed; }).length;

    const tasksThisWeek = tasks.filter(function (t) { return weekDates.indexOf(t.date) !== -1; });
    const tasksThisWeekDone = tasksThisWeek.filter(function (t) { return t.completed; }).length;

    let habitWeeklyDoneSum = 0, habitWeeklyTargetSum = 0, bestCurrentStreak = 0, longestStreakEver = 0;
    habits.forEach(function (h) {
      habitWeeklyDoneSum += habitWeeklyDone(h, weekDates);
      habitWeeklyTargetSum += habitWeeklyTarget(h);
      bestCurrentStreak = Math.max(bestCurrentStreak, computeCurrentStreak(h));
      longestStreakEver = Math.max(longestStreakEver, computeLongestStreak(h));
    });
    const habitCompletionRate = habitWeeklyTargetSum > 0 ? Math.round((habitWeeklyDoneSum / habitWeeklyTargetSum) * 100) : 0;
    const taskCompletionRateWeek = tasksThisWeek.length > 0 ? Math.round((tasksThisWeekDone / tasksThisWeek.length) * 100) : 0;

    const rateCount = (tasksThisWeek.length > 0 ? 1 : 0) + (habitWeeklyTargetSum > 0 ? 1 : 0);
    const weeklyProductivityPct = rateCount > 0 ? Math.round((habitCompletionRate + taskCompletionRateWeek) / rateCount) : 0;

    return {
      tasksTodayDone: tasksTodayDone, tasksTodayTotal: tasksToday.length,
      tasksWeekDone: tasksThisWeekDone, tasksWeekTotal: tasksThisWeek.length,
      habitCompletionRate: habitCompletionRate,
      bestCurrentStreak: bestCurrentStreak, longestStreakEver: longestStreakEver,
      goalsCompleted: goals.filter(function (g) { return g.completed; }).length,
      weeklyProductivityPct: weeklyProductivityPct
    };
  }

  function renderStats() {
    const s = computeProductivityStats();
    $("productivityStatsGrid").innerHTML =
      statBoxHtml(s.tasksTodayDone + " / " + s.tasksTodayTotal, "Tasks completed today") +
      statBoxHtml(s.tasksWeekDone + " / " + s.tasksWeekTotal, "Tasks completed this week") +
      statBoxHtml(s.habitCompletionRate + "%", "Habit completion rate") +
      statBoxHtml(s.bestCurrentStreak + " day" + (s.bestCurrentStreak === 1 ? "" : "s"), "Current best streak") +
      statBoxHtml(s.longestStreakEver + " day" + (s.longestStreakEver === 1 ? "" : "s"), "Longest streak") +
      statBoxHtml(String(s.goalsCompleted), "Goals completed") +
      statBoxHtml(s.weeklyProductivityPct + "%", "Weekly productivity");
  }

  /* ==================== TODAY OVERVIEW + DAY SELECTOR ==================== */

  function renderTodayOverview() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    $("todayOverviewDate").textContent = parseISODateLocal(today).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    const todayTasks = tasksForDate(today);
    const todayTasksDone = todayTasks.filter(function (t) { return t.completed; }).length;
    $("todayTasksStat").textContent = todayTasksDone + " / " + todayTasks.length;

    const todayHabitsDone = habits.filter(function (h) { return isHabitDoneOnDate(h, today); }).length;
    $("todayHabitsStat").textContent = todayHabitsDone + " / " + habits.length;

    const totalItems = todayTasks.length + habits.length;
    const doneItems = todayTasksDone + todayHabitsDone;
    const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
    $("todayProgressPct").textContent = pct + "%";
    const ring = $("todayProgressRing");
    if (ring) ring.style.setProperty("--pct", String(pct));

    let bestStreak = 0;
    habits.forEach(function (h) { bestStreak = Math.max(bestStreak, computeCurrentStreak(h)); });
    $("todayOverviewStreak").textContent = bestStreak + " day" + (bestStreak === 1 ? "" : "s") + " streak";
  }

  function renderDaySelectorPills() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const monday = getMondayISO(addDaysISO(today, daySelectorWeekOffset * 7));
    const weekDates = getWeekDatesISO(monday);
    $("daySelectorPills").innerHTML = weekDates.map(function (d) {
      const hasTasks = tasksForDate(d).length > 0;
      return (
        '<button type="button" class="day-pill' + (d === selectedDate ? " selected" : "") + (d === today ? " is-today" : "") + (hasTasks ? " has-tasks" : "") + '" data-date="' + d + '">' +
          '<span class="day-pill-label">' + formatWeekdayShort(d) + '</span>' +
          '<span class="day-pill-num">' + parseISODateLocal(d).getDate() + '</span>' +
          '<span class="day-pill-dot"></span>' +
        '</button>'
      );
    }).join("");
    $("todoSelectedDateLabel").textContent = parseISODateLocal(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  }

  function handleDaySelectorClick(e) {
    const pill = e.target.closest(".day-pill");
    if (!pill) return;
    selectedDate = pill.getAttribute("data-date");
    resetTaskForm();
    renderDaySelectorPills();
    renderTaskList();
    renderTaskGoalSelectOptions();
  }

  function handleDaySelectorWeekNav(delta) {
    daySelectorWeekOffset += delta;
    renderDaySelectorPills();
  }

  function handleJumpToToday() {
    daySelectorWeekOffset = 0;
    selectedDate = window.JarvisCore.todayISODate();
    resetTaskForm();
    renderDaySelectorPills();
    renderTaskList();
  }

  /* ==================== boot ==================== */

  function renderAll() {
    renderTodayOverview();
    renderDaySelectorPills();
    renderTaskGoalSelectOptions();
    renderTaskList();
    renderAllHabitViews();
    renderGoalsList();
    renderStats();
  }

  function getSummary() {
    const today = window.JarvisCore.todayISODate();
    const doneToday = habits.filter(function (h) { return isHabitDoneOnDate(h, today); }).length;
    let bestStreak = 0;
    habits.forEach(function (h) { bestStreak = Math.max(bestStreak, computeCurrentStreak(h)); });
    return { total: habits.length, doneToday: doneToday, bestStreak: bestStreak };
  }

  function onSubTabChange(targetId) {
    if (targetId === "habits-today") { renderDaySelectorPills(); renderTaskList(); renderTodayHabitsList(); renderTodayOverview(); }
    if (targetId === "habits-week") renderHabitHistoryGrid();
    if (targetId === "habits-goals") renderGoalsList();
    if (targetId === "habits-stats") renderStats();
  }

  function init() {
    load();

    $("taskAddToggleBtn").addEventListener("click", handleTaskAddToggle);
    $("taskForm").addEventListener("submit", handleTaskFormSubmit);
    $("taskFormCancelBtn").addEventListener("click", resetTaskForm);
    $("taskList").addEventListener("click", handleTaskListClick);
    $("taskRepeatDaysRow").addEventListener("click", function (e) {
      const btn = e.target.closest(".day-picker-btn");
      if (btn && !btn.disabled) btn.classList.toggle("selected");
    });
    document.addEventListener("click", function (e) {
      if (taskMenuOpenId && !e.target.closest(".food-item-menu-wrap")) { taskMenuOpenId = null; taskDuplicateSubmenuOpenId = null; renderTaskList(); }
    });

    $("daySelectorPills").addEventListener("click", handleDaySelectorClick);
    $("daySelectorPrevWeekBtn").addEventListener("click", function () { handleDaySelectorWeekNav(-1); });
    $("daySelectorNextWeekBtn").addEventListener("click", function () { handleDaySelectorWeekNav(1); });
    $("daySelectorTodayBtn").addEventListener("click", handleJumpToToday);

    $("todayHabitsList").addEventListener("click", handleTodayHabitsClick);
    $("habitForm").addEventListener("submit", handleHabitFormSubmit);
    $("habitFormCancelBtn").addEventListener("click", resetHabitForm);
    $("habitManageList").addEventListener("click", handleHabitManageListClick);
    $("historyPrevWeekBtn").addEventListener("click", function () { handleHistoryWeekNav(-1); });
    $("historyNextWeekBtn").addEventListener("click", function () { handleHistoryWeekNav(1); });

    $("habitsGoalHasNumeric").addEventListener("change", updateGoalFormNumericVisibility);
    $("habitsGoalForm").addEventListener("submit", handleGoalFormSubmit);
    $("habitsGoalCancelBtn").addEventListener("click", resetGoalForm);
    $("habitsGoalsList").addEventListener("click", handleGoalsListClick);
    $("habitsGoalsList").addEventListener("change", handleGoalsListChange);

    resetTaskForm();
    resetHabitForm();
    resetGoalForm();
    renderAll();
  }

  /* ---------------- Gladiator Mode integration ---------------- */

  function gladiatorGetRemainingToday() {
    const today = window.JarvisCore.todayISODate();
    return habits.filter(function (h) { return !isHabitDoneOnDate(h, today); })
      .map(function (h) {
        return { id: h.id, name: h.name, dailyTarget: habitDailyTarget(h), countToday: habitCountOn(h, today), streak: computeCurrentStreak(h) };
      });
  }

  function gladiatorGetStudyCandidates() {
    return tasks.filter(function (t) { return !t.completed && /^study$/i.test(t.category || ""); })
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })
      .map(function (t) { return { id: t.id, text: t.text, category: t.category, time: t.time || null }; });
  }

  function gladiatorIncrementHabit(habitId) {
    const h = habits.find(function (hh) { return hh.id === habitId; });
    if (!h) return null;
    const today = window.JarvisCore.todayISODate();
    h.completions = h.completions || {};
    const target = habitDailyTarget(h);
    const wasFirstEver = Object.keys(h.completions).every(function (d) { return !h.completions[d]; });
    if (target === 1) {
      h.completions[today] = isHabitDoneOnDate(h, today) ? 0 : target;
    } else {
      h.completions[today] = (h.completions[today] || 0) + 1;
    }
    saveHabits();
    renderAllHabitViews();
    return {
      done: isHabitDoneOnDate(h, today), streak: computeCurrentStreak(h),
      count: h.completions[today], target: target, isFirstCompletionEver: wasFirstEver && isHabitDoneOnDate(h, today)
    };
  }

  function gladiatorCompleteTask(taskId) {
    const t = tasks.find(function (tt) { return tt.id === taskId; });
    if (!t) return false;
    t.completed = true;
    saveTasks();
    renderTaskList();
    renderTodayOverview();
    return true;
  }

  const gladiator = {
    getRemainingToday: gladiatorGetRemainingToday,
    getStudyCandidates: gladiatorGetStudyCandidates,
    incrementHabit: gladiatorIncrementHabit,
    completeTask: gladiatorCompleteTask
  };

  window.JarvisHabits = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange, gladiator: gladiator };
})();
