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
                        manualProgressPct, completed, milestones, createdAt,
                        + optional: trackMode, startValue, priority, completedAt, updatedAt} ]
                      These are the personal/habit goals; tasks link here via
                      task.goalId. The Goals dashboard (goals-ui.js, rules in
                      goals-logic.js) owns the screen and the milestone fields.

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

  const TK = window.JarvisTaskKind;
  const HL = window.JarvisHabitLogic;   // counting, streaks and checking a habit off on any day (habit-logic.js)
  const PC = window.JarvisPlanningCore; // a task that stands for a habit on one day shares that habit's completion (planning-core-logic.js)
  const HP = window.JarvisHabitPlan;    // a habit's place on the Day planner and Calendar: time, days, one-day moves (habit-plan-logic.js)

  const LS_TASKS = "jarvisTasks";
  const LS_HABITS = "jarvisHabits";
  const LS_GOALS = "jarvisGoals";

  const Storage = {
    loadTasks: function () { return window.JarvisCore.loadJSON(LS_TASKS, []); },
    saveTasks: function (v) { window.JarvisCore.saveJSON(LS_TASKS, v); },
    loadHabits: function () { return window.JarvisCore.loadJSON(LS_HABITS, []); },
    saveHabits: function (v) { return window.JarvisCore.saveJSON(LS_HABITS, v); },
    loadGoals: function () { return window.JarvisCore.loadJSON(LS_GOALS, []); },
    saveGoals: function (v) { return window.JarvisCore.saveJSON(LS_GOALS, v); }
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
    if (HP) Object.assign(h, HP.fields(raw));   // where it sits on the planner (optional; a habit made before this has none of it)
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
    // Only things that can be a goal (a damaged list may hold a null or a number); the rest of each record is read defensively by the Goals screen.
    goals = (Array.isArray(loadedGoals) ? loadedGoals : []).filter(function (g) { return g && typeof g === "object" && !Array.isArray(g); });

    selectedDate = window.JarvisCore.todayISODate();
  }

  // Anything that saves the task list also tells the page (the Strategy tab keeps its progress in step with the tasks you tick off here).
  function saveTasks() {
    Storage.saveTasks(tasks);
    try { document.dispatchEvent(new CustomEvent("jarvis-tasks-changed")); } catch (e) { /* an old browser without CustomEvent: nothing listens anyway */ }
  }
  // Saves the habits (false if the browser refused) and tells the page, so the Day planner and Calendar follow a tick made on the Habits screen.
  function saveHabits() {
    const ok = Storage.saveHabits(habits);
    if (ok) { try { document.dispatchEvent(new CustomEvent("jarvis-habits-changed")); } catch (e) { /* an old browser without CustomEvent: nothing listens anyway */ } }
    return ok;
  }
  function saveGoalsData() { Storage.saveGoals(goals); }

  /* ==================== TASKS ==================== */

  function tasksForDate(date) {
    return tasks.filter(function (t) { return t.date === date; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function nextOrderForDate(date) {
    const list = tasksForDate(date);
    return list.length ? Math.max.apply(null, list.map(function (t) { return t.order || 0; })) + 1 : 0;
  }

  // The "counts toward the plan" choice in the task form. It only appears once the Strategy tab has something to link to.
  function planApi() { return window.JarvisPlan && typeof window.JarvisPlan.choices === "function" ? window.JarvisPlan : null; }
  function renderTaskPlanSelect(currentId) {
    const api = planApi(), row = $("taskPlanRow"), sel = $("taskPlanSelect");
    if (!row || !sel) return;
    const choices = api ? api.choices(currentId || "") : [];
    row.classList.toggle("hidden", !choices.length);
    sel.setAttribute("data-ready", choices.length ? "1" : "");
    const core = window.JarvisCore;
    let html = '<option value="">Not linked</option>', group = null;
    choices.forEach(function (c) {
      if (c.group !== group) { if (group !== null) html += "</optgroup>"; html += '<optgroup label="' + core.escapeHtml(c.group) + '">'; group = c.group; }
      html += '<option value="' + core.escapeHtml(c.id) + '">' + core.escapeHtml(c.label) + '</option>';
    });
    if (group !== null) html += "</optgroup>";
    sel.innerHTML = html;
    sel.value = currentId || "";
  }
  // Applies the form's choice to a task. Does nothing when the choice was never shown (so an edit can't unlink by accident).
  function applyTaskPlanLink(taskId) {
    const api = planApi(), sel = $("taskPlanSelect");
    if (!api || !sel || sel.getAttribute("data-ready") !== "1") return;
    api.setTaskLink(taskId, sel.value || "");
  }

  function resetTaskForm() {
    taskFormEditId = null;
    $("taskForm").classList.add("hidden");
    $("taskText").value = "";
    $("taskPriority").value = "medium";
    $("taskTime").value = "";
    $("taskCategory").value = "";
    $("taskGoalSelect").value = "";
    taskDupFound = [];
    if ($("taskDupRow")) { $("taskDupRow").classList.add("hidden"); $("taskDupSelect").innerHTML = ""; }
    if ($("taskDeadline")) $("taskDeadline").checked = true;
    renderTaskPlanSelect("");
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
    sel.innerHTML = '<option value="">None</option>' + goals.filter(function (g) { return typeof g.id === "string" && g.id; }).map(function (g) {
      return '<option value="' + core.escapeHtml(g.id) + '">' + core.escapeHtml(g.name) + '</option>';
    }).join("");
    if (goals.some(function (g) { return g.id === current; })) sel.value = current;
  }

  // "Looks like something you already have" under the Task field and the Habit name: shown while typing, and a choice is needed before saving.
  let taskDupFound = [], habitDupFound = [];
  function taskDupEls() { return { row: $("taskDupRow"), select: $("taskDupSelect"), note: $("taskDupNote") }; }
  function habitDupEls() { return { row: $("habitDupRow"), select: $("habitDupSelect"), note: $("habitDupNote") }; }
  function refreshTaskDup() {
    const PS = window.JarvisPlanSync, els = taskDupEls();
    if (!PS || !els.row) return;
    if (taskFormEditId) { els.row.classList.add("hidden"); taskDupFound = []; return; }
    taskDupFound = PS.fill(els, { type: "task", name: $("taskText").value, date: selectedDate, time: $("taskTime").value });
  }
  function refreshHabitDup() {
    const PS = window.JarvisPlanSync, els = habitDupEls();
    if (!PS || !els.row) return;
    if (habitFormEditId) { els.row.classList.add("hidden"); habitDupFound = []; return; }
    habitDupFound = PS.fill(els, { type: "habit", name: $("habitName").value });
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

  // An older task with no saved kind counts as a deadline only when it is tied to a Strategy item.
  function taskKindOpts() { return { linked: function (id) { const p = planApi(); return !!(p && p.nodeIdOfTask && p.nodeIdOfTask(id)); } }; }

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
    const wantDeadline = !$("taskDeadline") || $("taskDeadline").checked;
    const madeIds = [];
    if (taskFormEditId) {
      const t = tasks.find(function (tt) { return tt.id === taskFormEditId; });
      if (t) {
        Object.assign(t, raw);
        // only written when the box was changed, so editing an older task leaves how it is read as it was
        if (TK && TK.isDeadline(t, taskKindOpts()) !== wantDeadline) t.kind = wantDeadline ? "deadline" : "scheduled";
        madeIds.push(t.id);
      }
    } else {
      if (TK) raw.kind = wantDeadline ? "deadline" : "scheduled";
      refreshTaskDup();
      const decision = window.JarvisPlanSync ? window.JarvisPlanSync.decide(taskDupEls(), taskDupFound) : { action: "create" };
      if (!decision) { core.showToast("This looks like something you already have. Choose how to add it."); if ($("taskDupSelect")) $("taskDupSelect").focus(); return; }
      if (decision.action === "link") ensureSnapshot();
      const repeatDates = Array.prototype.slice.call($("taskRepeatDaysRow").querySelectorAll(".day-picker-btn.selected"))
        .map(function (b) { return b.getAttribute("data-date"); });
      const datesToCreate = [selectedDate].concat(repeatDates.filter(function (d) { return d !== selectedDate; }));
      datesToCreate.forEach(function (d) {
        if (decision.action === "existing" && d === selectedDate) return;      // the one you already have is kept; nothing new is added for this day
        const made = Object.assign({}, raw, { id: core.uid("task"), date: d, completed: false, order: nextOrderForDate(d), createdAt: Date.now() });
        if (decision.action === "link" && habitAllowsLink(decision.habitId, d)) {
          made.habitId = decision.habitId;
          const hb = habits.filter(function (x) { return x.id === decision.habitId; })[0];
          if (hb && HL.isDone(hb, d)) made.completed = true;      // the habit was already done that day
        }
        if (decision.action === "separate" && decision.ids.length && d === selectedDate) made.separate = decision.ids.slice();
        tasks.push(made);
        madeIds.push(made.id);
      });
    }
    saveTasks();
    madeIds.forEach(applyTaskPlanLink);
    resetTaskForm();
    renderTaskList();
    renderDaySelectorPills();
    renderTodayOverview();
    core.showToast(taskFormEditId ? "Task updated." : madeIds.length ? "Task added." : "Kept the one you already have.");
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
    const planTitle = planApi() ? planApi().nodeTitleOfTask(t.id) : "";
    if (planTitle) metaParts.push("Plan: " + core.escapeHtml(planTitle));
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
    if ($("taskDeadline")) $("taskDeadline").checked = !TK || TK.isDeadline(t, taskKindOpts());
    renderTaskPlanSelect(planApi() ? planApi().nodeIdOfTask(t.id) : "");
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
      if (t) setTasks(tasks.map(function (x) { return x.id === t.id ? Object.assign({}, x, { completed: !x.completed }) : x; }));
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

  function habitDailyTarget(h) { return HL.dailyTarget(h); }
  function habitCountOn(h, date) { return HL.countOn(h, date); }
  function isHabitDoneOnDate(h, date) { return HL.isDone(h, date); }
  function computeCurrentStreak(h) { return HL.currentStreak(h, window.JarvisCore.todayISODate()); }
  function computeLongestStreak(h) { return HL.longestStreak(h); }
  function habitWeeklyDone(h, weekDates) { return HL.weeklyDone(h, weekDates); }
  function habitWeeklyTarget(h) { return HL.weeklyTarget(h); }
  function habitTotalCompletions(h) { return HL.totalCompletions(h); }

  function resetHabitForm() {
    habitFormEditId = null;
    $("habitName").value = "";
    $("habitTargetDays").value = "7";
    $("habitDailyTarget").value = "1";
    habitDupFound = [];
    if ($("habitDupRow")) { $("habitDupRow").classList.add("hidden"); $("habitDupSelect").innerHTML = ""; }
    setPlanForm(null);
    $("habitFormTitle").textContent = "Add a Habit";
    $("habitSubmitBtn").textContent = "Add Habit";
    $("habitFormCancelBtn").classList.add("hidden");
    showHabitForm(false);
  }

  // The add/edit form stays folded away until "+ Add habit" (or Edit on a habit) opens it.
  function showHabitForm(on) {
    const wrap = $("habitFormWrap"), btn = $("habitAddToggleBtn");
    if (wrap) wrap.hidden = !on;
    if (btn) { btn.setAttribute("aria-expanded", on ? "true" : "false"); btn.textContent = on ? "Close" : "+ Add habit"; }
  }

  /* ---- the habit's place on the Day planner (time and days; see habit-plan-logic.js) ---- */

  function dayChipsHtml(days) {
    return [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" value="' + d + '"' + (days.indexOf(d) !== -1 ? " checked" : "") + '> ' + HP.DAY_SHORT[d] + '</label>';
    }).join("");
  }
  function planFormDays() {
    return Array.prototype.filter.call($("habitPlanDays").querySelectorAll("input"), function (i) { return i.checked; }).map(function (i) { return Number(i.value); });
  }
  // Shows the time and days a habit already has on the planner (null: none). The days appear once there is a time.
  function setPlanForm(h) {
    const p = h && HP ? HP.plan(h) : null;
    $("habitPlanTime").value = p ? p.time : "";
    $("habitPlanDays").innerHTML = dayChipsHtml(p ? p.days : []);
    syncPlanForm();
  }
  function syncPlanForm() {
    const has = !!$("habitPlanTime").value, sevenADay = clampInt($("habitTargetDays").value, 1, 7, 7) === 7;
    $("habitPlanDaysWrap").classList.toggle("hidden", !has);
    if (has && !planFormDays().length && sevenADay) Array.prototype.forEach.call($("habitPlanDays").querySelectorAll("input"), function (i) { i.checked = true; });
    $("habitPlanDaysHint").textContent = sevenADay ? "" : "This habit's goal is " + clampInt($("habitTargetDays").value, 1, 7, 7) + " days a week. Choose the days you plan to do it.";
  }
  // -> { ok, time, days, from } | { ok: false, error }. A habit with no time is off the planner.
  function readPlanForm(existing) {
    const time = $("habitPlanTime").value;
    if (!time) return { ok: true, time: "" };
    if (!HP || !HP.isTime(time)) return { ok: false, error: "Choose a time for the planner." };
    const days = planFormDays();
    if (!days.length) return { ok: false, error: "Choose at least one day for the planner." };
    const cur = existing && HP.plan(existing);
    return { ok: true, time: time, days: days, from: cur && cur.from ? cur.from : window.JarvisCore.todayISODate() };
  }
  // Puts the form's choice on the habit record (the same fields the planner's Add Habit writes).
  function applyPlanToHabit(h, plan) {
    if (!HP) return;
    const r = plan.time ? HP.setPlan([h], h.id, plan) : HP.clearPlan([h], h.id);
    if (!r.ok) return;
    ["planTime", "planDays", "planFrom", "planMoves"].forEach(function (k) { delete h[k]; });
    Object.assign(h, HP.fields(r.habits[0]));
  }

  function handleHabitFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("habitName").value.trim();
    if (!name) { core.showToast("Please enter a habit name."); return; }
    const targetDays = clampInt($("habitTargetDays").value, 1, 7, 7);
    const dailyTarget = clampInt($("habitDailyTarget").value, 1, 50, 1);
    const existing = habitFormEditId ? habits.find(function (hh) { return hh.id === habitFormEditId; }) : null;
    let newHabitId = "";
    const plan = readPlanForm(existing);
    if (!plan.ok) { core.showToast(plan.error); return; }
    let habitDecision = { action: "create" };
    if (!habitFormEditId) {
      refreshHabitDup();
      habitDecision = window.JarvisPlanSync ? window.JarvisPlanSync.decide(habitDupEls(), habitDupFound) : { action: "create" };
      if (!habitDecision) { core.showToast("This looks like something you already have. Choose how to add it."); if ($("habitDupSelect")) $("habitDupSelect").focus(); return; }
      if (habitDecision.action === "existing") { resetHabitForm(); core.showToast("Kept the habit you already have."); return; }
    }
    if (habitFormEditId) {
      const h = existing;
      if (h) { h.name = name; h.targetDays = targetDays; h.dailyTarget = dailyTarget; applyPlanToHabit(h, plan); }
    } else {
      const made = { id: core.uid("habit"), name: name, targetDays: targetDays, dailyTarget: dailyTarget, completions: {}, createdAt: Date.now() };
      applyPlanToHabit(made, plan);
      habits.push(made);
      newHabitId = made.id;
    }
    saveHabits();
    // what was chosen for tasks that look like this habit: link them to it, or remember they are meant to be separate
    if (newHabitId && PC && habitDecision.ids && habitDecision.ids.length) {
      if (habitDecision.action === "linkall") linkTasksToHabit(habitDecision.ids, newHabitId);
      else if (habitDecision.action === "separate") {
        let t = tasks;
        habitDecision.ids.forEach(function (id) { const r = PC.markSeparate(t, id, newHabitId); if (r.ok) t = r.tasks; });
        if (t !== tasks) { tasks = t; saveTasks(); renderTaskList(); }
      }
    }
    resetHabitForm();
    renderAllHabitViews();
    core.showToast(habitFormEditId ? "Habit updated." : "Habit added.");
  }

  // The card follows the day picked in the day selector above. Today and any earlier day can be checked off; a day that hasn't
  // happened yet shows the state but its buttons are off.
  function habitCardHtml(h) {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const date = selectedDate;
    const editable = HL.canEdit(date, today);
    const count = habitCountOn(h, date);
    const target = habitDailyTarget(h);
    const done = isHabitDoneOnDate(h, date);
    const streak = computeCurrentStreak(h);
    const weekDates = getWeekDatesISO(getMondayISO(date));
    const weeklyDone = habitWeeklyDone(h, weekDates);
    const weeklyTargetVal = habitWeeklyTarget(h);
    const isCountHabit = target > 1;
    const dis = editable ? "" : " disabled";
    const dayWord = HL.dayLabel(date, today);
    const e = core.escapeHtml;
    const thisWeek = date >= getMondayISO(today) && date <= addDaysISO(getMondayISO(today), 6);
    const meta = (isCountHabit ? e(dayWord) + ": " + count + " / " + target + " · " : "") + weeklyDone + " of " + weeklyTargetVal + (thisWeek ? " this week" : " that week") + (streak >= 2 ? " · " + streak + "-day streak" : "");
    return (
      '<div class="habit-card habit-row" data-id="' + e(h.id) + '">' +
        '<div class="habit-row-main"><span class="habit-card-name">' + e(h.name) + '</span><span class="habit-row-meta">' + meta + '</span></div>' +
        (isCountHabit
          ? '<div class="stepper-row">' +
              '<button type="button" class="stepper-btn habit-decrement-btn" data-id="' + e(h.id) + '" aria-label="Decrease ' + e(h.name) + ' for ' + e(dayWord) + '"' + dis + '>&minus;</button>' +
              '<span class="habit-card-count-value">' + count + '</span>' +
              '<button type="button" class="stepper-btn habit-increment-btn" data-id="' + e(h.id) + '" aria-label="Increase ' + e(h.name) + ' for ' + e(dayWord) + '"' + dis + '>+</button>' +
            '</div>'
          : '<button type="button" class="habit-toggle-btn' + (done ? " done" : "") + '" data-id="' + e(h.id) + '" aria-pressed="' + done + '" aria-label="' + e(h.name) + ', ' + e(dayWord) + (done ? ", done" : ", not done") + '"' + dis + '>' + (done ? "&#10003; Done" : "Done") + '</button>'
        ) +
      '</div>'
    );
  }

  // The line above the habit cards: which day this is, a way back to today, and a pointer to yesterday when it has habits left.
  function habitsDayNoteHtml() {
    const today = window.JarvisCore.todayISODate();
    const kind = HL.describeDay(selectedDate, today);
    if (!habits.length) return "";
    if (kind === "future") return '<p class="hb-note-text">This day hasn\'t happened yet, so its habits can\'t be checked off. Tasks can still be planned for it.</p><button type="button" class="btn btn-secondary" data-hb="back-today">Back to today</button>';
    if (kind === "yesterday" || kind === "past") return '<p class="hb-note-text">You\'re filling in ' + window.JarvisCore.escapeHtml(HL.dayLabel(selectedDate, today).toLowerCase() === "yesterday" ? "yesterday" : parseISODateLocal(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })) + '. Streaks and weekly totals follow what you tick here.</p><button type="button" class="btn btn-secondary" data-hb="back-today">Back to today</button>';
    const y = HL.dayStatus(habits, addDaysISO(today, -1));
    if (y.missed.length) return '<p class="hb-note-text">Yesterday: ' + y.done + ' of ' + y.total + ' habits done.</p><button type="button" class="btn btn-secondary" data-hb="fill-yesterday">Fill in yesterday</button>';
    return "";
  }

  function renderTodayHabitsList() {
    const container = $("todayHabitsList");
    const note = $("habitsDayNote");
    const title = $("habitsDayTitle");
    const today = window.JarvisCore.todayISODate();
    if (title) title.textContent = selectedDate === today ? "Habits" : "Habits \u2014 " + parseISODateLocal(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    if (note) { const html = habitsDayNoteHtml(); note.innerHTML = html; note.classList.toggle("hidden", !html); }
    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">No habits yet. Add one in Routines.</div>';
      return;
    }
    container.innerHTML = habits.map(habitCardHtml).join("");
  }

  // Checks one habit off (or a count up or down) for the picked day, if that day has happened.
  function applyHabitChange(id, fn) {
    const today = window.JarvisCore.todayISODate();
    const res = fn(habits, today);
    if (!res.ok) { window.JarvisCore.showToast(res.error || "That can't be changed."); return false; }
    const prev = habits;
    habits = res.habits;
    if (!saveHabits()) {      // nothing is shown as done unless it was saved
      habits = prev;
      renderAllHabitViews();
      window.JarvisCore.showToast("That couldn't be saved. The browser may be full or blocking storage.");
      return false;
    }
    followHabits(prev);
    renderAllHabitViews();
    return true;
  }

  function handleTodayHabitsClick(e) {
    const date = selectedDate;
    const incBtn = e.target.closest(".habit-increment-btn");
    if (incBtn) { const id = incBtn.getAttribute("data-id"); applyHabitChange(id, function (list, today) { return HL.adjust(list, id, date, 1, today); }); return; }
    const decBtn = e.target.closest(".habit-decrement-btn");
    if (decBtn) { const id = decBtn.getAttribute("data-id"); applyHabitChange(id, function (list, today) { return HL.adjust(list, id, date, -1, today); }); return; }
    const toggle = e.target.closest(".habit-toggle-btn");
    if (toggle) {
      const id = toggle.getAttribute("data-id");
      const h = habits.find(function (hh) { return hh.id === id; });
      if (!h) return;
      const wasDone = isHabitDoneOnDate(h, date);
      if (applyHabitChange(id, function (list, today) { return HL.setDone(list, id, date, !wasDone, today); })) {
        const f = $("todayHabitsList").querySelector('.habit-toggle-btn[data-id="' + id + '"]');
        if (f) f.focus({ preventScroll: true });
        if (date !== window.JarvisCore.todayISODate()) window.JarvisCore.showToast((wasDone ? "Unmarked " : "Marked ") + h.name + (wasDone ? " for " : " done for ") + parseISODateLocal(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + ".");
      }
    }
  }

  function handleHabitsDayNoteClick(e) {
    const btn = e.target.closest("[data-hb]");
    if (!btn) return;
    const today = window.JarvisCore.todayISODate();
    if (btn.getAttribute("data-hb") === "back-today") selectDate(today);
    else if (btn.getAttribute("data-hb") === "fill-yesterday") selectDate(addDaysISO(today, -1));
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
              '<span class="list-item-meta">Target ' + h.targetDays + 'x/week' + (h.dailyTarget > 1 ? " &middot; " + h.dailyTarget + "/day" : "") + " &middot; " + streak + ' day streak' + plannerMeta(h) + '</span>' +
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

  function plannerMeta(h) {
    const p = HP ? HP.plan(h) : null;
    if (!p) return "";
    const hr = Number(p.time.slice(0, 2));
    return " &middot; Planner " + ((hr + 11) % 12 + 1) + ":" + p.time.slice(3) + (hr < 12 ? " AM" : " PM") + ", " + escText(HP.daysLabel(p.days));
  }
  function escText(s) { return window.JarvisCore.escapeHtml(s); }

  function handleHabitManageListClick(e) {
    const editBtn = e.target.closest(".habit-edit-btn");
    if (editBtn) {
      const h = habits.find(function (hh) { return hh.id === editBtn.getAttribute("data-id"); });
      if (!h) return;
      habitFormEditId = h.id;
      $("habitName").value = h.name;
      $("habitTargetDays").value = h.targetDays;
      $("habitDailyTarget").value = h.dailyTarget;
      setPlanForm(h);
      $("habitFormTitle").textContent = "Edit Habit";
      $("habitSubmitBtn").textContent = "Save Changes";
      $("habitFormCancelBtn").classList.remove("hidden");
      showHabitForm(true);
      $("habitName").focus();
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
      // tasks that stood for this habit stay, as ordinary tasks (their own tick is kept)
      if (PC) { const un = PC.dropHabitLinks(tasks, h.id); if (un !== tasks) { tasks = un; saveTasks(); renderTaskList(); } }
      renderAllHabitViews();
      window.JarvisCore.showToast("Habit deleted.");
    }
  }

  // One block per habit with a button for each day of the week. A simple habit toggles right here; a counting habit opens that day
  // on the Today tab where it has + and −. Days that haven't happened yet are off.
  function renderHabitHistoryGrid() {
    const core = window.JarvisCore;
    const container = $("habitHistoryGrid");
    const today = core.todayISODate();
    const monday = getMondayISO(addDaysISO(today, historyWeekOffset * 7));
    const weekDates = getWeekDatesISO(monday);
    $("historyWeekLabel").textContent = formatShortDate(weekDates[0]) + " – " + formatShortDate(weekDates[6]);
    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">No habits yet — add one below.</div>';
      return;
    }
    const head = '<div class="hb-days hb-days-head" aria-hidden="true">' + weekDates.map(function (d) {
      return '<span class="hb-dayhead' + (d === today ? " is-today" : "") + '"><span>' + formatWeekdayShort(d).slice(0, 1) + '</span><span>' + parseISODateLocal(d).getDate() + '</span></span>';
    }).join("") + '</div>';
    const blocks = habits.map(function (h) {
      const target = habitDailyTarget(h);
      const buttons = weekDates.map(function (d) {
        const count = habitCountOn(h, d), done = isHabitDoneOnDate(h, d), future = !HL.canEdit(d, today);
        const dayWord = parseISODateLocal(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const label = core.escapeHtml(h.name) + ", " + dayWord + (target > 1 ? ": " + count + " of " + target : (done ? ", done" : ", not done")) + (future ? ". Hasn't happened yet." : (target > 1 ? ". Opens this day." : ""));
        return '<button type="button" class="hb-day' + (done ? " is-done" : "") + (d === today ? " is-today" : "") + (future ? " is-future" : "") + '" data-id="' + core.escapeHtml(h.id) + '" data-date="' + d + '" data-kind="' + (target > 1 ? "count" : "simple") + '"' +
          (target > 1 ? "" : ' aria-pressed="' + done + '"') + (future ? " disabled" : "") + ' aria-label="' + label + '">' + (target > 1 ? count : (done ? "&#10003;" : "")) + '</button>';
      }).join("");
      return '<div class="hb-habit"><div class="hb-habit-head"><span class="hb-habit-name">' + core.escapeHtml(h.name) + '</span><span class="hb-habit-week">' + habitWeeklyDone(h, weekDates) + ' / ' + habitWeeklyTarget(h) + '</span></div><div class="hb-days">' + buttons + '</div></div>';
    }).join("");
    container.innerHTML = '<p class="field-hint">Tap a day to fill it in. Days that haven\'t happened yet are greyed out.</p>' + head + blocks;
  }

  function handleHabitGridClick(e) {
    const btn = e.target.closest(".hb-day");
    if (!btn || btn.disabled) return;
    const id = btn.getAttribute("data-id"), date = btn.getAttribute("data-date");
    if (btn.getAttribute("data-kind") === "count") { selectDate(date); $("habitsSubNavToday").click(); return; }
    const h = habits.find(function (hh) { return hh.id === id; });
    if (!h) return;
    const wasDone = isHabitDoneOnDate(h, date);
    if (applyHabitChange(id, function (list, today) { return HL.setDone(list, id, date, !wasDone, today); })) {
      const again = $("habitHistoryGrid").querySelector('.hb-day[data-id="' + id + '"][data-date="' + date + '"]');
      if (again) again.focus({ preventScroll: true });
    }
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
    // Habits and Discipline are one screen now, so Discipline's "Next up" and routine numbers follow a tick straight away
    // (they used to refresh when you switched tabs).
    if (window.JarvisDiscipline && typeof window.JarvisDiscipline.refreshFromHabits === "function") window.JarvisDiscipline.refreshFromHabits();
  }

  /* ==================== GOALS ==================== */
  // The Goals dashboard (goals-ui.js) draws and edits goals; its rules are in goals-logic.js. This file only keeps the list and saves it.

  function renderGoalsList() { if (window.JarvisGoals && window.JarvisGoals.render) window.JarvisGoals.render(); }
  // Saves a new goals list (false if the browser refused; nothing changes then) and brings the places that list goals up to date.
  function commitGoals(next) {
    if (!Array.isArray(next)) return false;
    if (Storage.saveGoals(next) === false) return false;
    goals = next;
    renderTaskGoalSelectOptions(); renderStats();
    try { document.dispatchEvent(new CustomEvent("jarvis-goals-changed")); } catch (e) { /* nothing is listening on an old browser */ }
    return true;
  }
  // Unlinks the tasks that pointed at a goal (the goal is gone or about to be); tasks are never deleted by this.
  function releaseGoalTasks(goalId) {
    // New task objects, not edits in place: a caller that kept the old list (to undo a delete) must still see the old links.
    let changed = false;
    tasks = tasks.map(function (t) { if (t.goalId === goalId) { changed = true; return Object.assign({}, t, { goalId: null }); } return t; });
    if (changed) { saveTasks(); renderTaskList(); }
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
    $("todayOverviewDate").textContent = parseISODateLocal(today).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

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
    const streakEl = $("todayOverviewStreak");
    streakEl.textContent = bestStreak + " day" + (bestStreak === 1 ? "" : "s") + " streak";
    streakEl.hidden = bestStreak < 2;   // a streak is shown once there is one to speak of
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

  // Picks the day that the To-Do list and the habit cards show.
  function selectDate(date) {
    const today = window.JarvisCore.todayISODate();
    selectedDate = date;
    daySelectorWeekOffset = Math.round((parseISODateLocal(getMondayISO(date)) - parseISODateLocal(getMondayISO(today))) / (7 * 86400000));
    resetTaskForm();
    renderDaySelectorPills();
    renderTaskList();
    renderTaskGoalSelectOptions();
    renderTodayHabitsList();
    document.dispatchEvent(new CustomEvent("jarvis-habits-day-changed", { detail: { date: date } }));
    // The plan and the review (Discipline) follow the day picked here.
    if (window.JarvisDiscipline && typeof window.JarvisDiscipline.followDay === "function") {
      window.JarvisDiscipline.followDay(date === today ? "today" : date === addDaysISO(today, -1) ? "yesterday" : date === addDaysISO(today, 1) ? "tomorrow" : "");
    }
  }

  // The menu on Habits: the screens that are not in the three tabs.
  function openHabitsMenu() {
    const go = function (id) { const b = document.querySelector('.habits-sub-nav-btn[data-subtarget="' + id + '"]'); if (b) { b.click(); window.scrollTo(0, 0); } };
    window.JarvisMenu.open({
      title: "Habits", opener: $("habitsMenuBtn"),
      rows: [
        { key: "habits-plan", label: "Day planner", sub: "Put tasks into the hours of a day" },
        { key: "dup-review", label: "Review possible duplicates", sub: dupSub() },
        { key: "habits-goals", label: "Goals", sub: "Personal goals and their progress" },
        { key: "habits-reminders", label: "Reminders", sub: "Phone notifications and quiet hours" },
        { key: "habits-wake", label: "Wake check", sub: "Prove you are up" },
        { key: "discipline-program", label: "30-day program", sub: "Optional lessons and missions" },
        { key: "discipline-setup", label: "Discipline settings", sub: "Phone limit, rules, schedule, your data" }
      ],
      onPick: function (key) { if (key === "dup-review") { if (window.JarvisPlanSync) window.JarvisPlanSync.openReview($("habitsMenuBtn")); } else go(key); }
    });
  }
  function dupSub() { const n = window.JarvisPlanSync ? window.JarvisPlanSync.count() : 0; return n ? n + " possible " + (n === 1 ? "pair" : "pairs") + " to look at" : "Nothing looks duplicated"; }

  function handleDaySelectorClick(e) {
    const pill = e.target.closest(".day-pill");
    if (!pill) return;
    selectDate(pill.getAttribute("data-date"));
  }

  function handleDaySelectorWeekNav(delta) {
    daySelectorWeekOffset += delta;
    renderDaySelectorPills();
  }

  function handleJumpToToday() { selectDate(window.JarvisCore.todayISODate()); }

  // The app can stay open past midnight (a phone's home-screen app is put to sleep, not closed), and the day shown was picked once, when
  // it opened. Without this, the morning after, "today" still showed yesterday: the plan and the habits were yesterday's, and a task added
  // there was put on yesterday. If you were looking at today, move on to the new today; if you were filling in another day, stay on it
  // but refresh everything that says which day is today.
  let clockDay = "";
  function followTheClock() {
    const today = window.JarvisCore.todayISODate();
    if (!clockDay) { clockDay = today; return; }
    if (today === clockDay) return;
    const wasLookingAtToday = selectedDate === clockDay;
    clockDay = today;
    if (wasLookingAtToday) selectDate(today);
    else {
      daySelectorWeekOffset = Math.round((parseISODateLocal(getMondayISO(selectedDate)) - parseISODateLocal(getMondayISO(today))) / (7 * 86400000));
      renderDaySelectorPills();
      renderTaskList();
      renderTodayHabitsList();
    }
    renderTodayOverview();
    renderAllHabitViews();
    renderStats();
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

  /* ---- for the Plan tab (dayplan-ui.js) ----
     The planner works on the very same tasks the To-Do list shows (a task with a time is an item in that hour), so it
     reads them from here and hands the changed list back. Nothing is copied: one list, one place it is saved. */
  function getTasks() { return tasks; }
  function commitTasks(next) { if (Array.isArray(next)) setTasks(next); }

  // The one way a changed task list is saved when something else may need to follow it: a task that stands for a habit on a day (task.habitId)
  // shares that habit's tick, so ticking, unticking or moving it brings the habit along, in the same save. If the habits can't be saved, nothing
  // changes (neither the task nor the habit).
  function setTasks(next) {
    const prev = tasks, today = window.JarvisCore.todayISODate();
    let list = next;
    if (PC) {
      // a linked task moved to another day takes that day's state from its habit (the habit is where a tick lives)
      list = next.map(function (t) {
        const p = t && t.habitId ? prev.filter(function (x) { return x.id === t.id; })[0] : null;
        if (!p || p.date === t.date || !!p.completed !== !!t.completed) return t;
        const h = habits.filter(function (x) { return x.id === t.habitId; })[0];
        return h && HL.isDone(h, t.date) !== !!t.completed ? Object.assign({}, t, { completed: HL.isDone(h, t.date) }) : t;
      });
      const sync = PC.syncFromTasks(prev, list, habits, today);
      if (sync.changed.length) {
        const before = habits;
        habits = sync.habits;
        if (!saveHabits()) { habits = before; renderAllHabitViews(); renderTaskList(); window.JarvisCore.showToast("That couldn't be saved. The browser may be full or blocking storage."); return false; }
      }
    }
    tasks = list;
    saveTasks();
    renderTaskList();
    renderDaySelectorPills();
    renderTodayOverview();
    if (PC && habits) renderAllHabitViews();
    return true;
  }
  // After a habit's days changed (prev -> now), the tasks that stand for it on those days follow. Called once the habits were saved.
  function followHabits(prevHabits) {
    if (!PC) return;
    const s = PC.syncFromHabits(prevHabits, habits, tasks);
    if (!s.changed.length) return;
    tasks = s.tasks;
    saveTasks();
    renderTaskList(); renderDaySelectorPills(); renderTodayOverview();
  }
  function getSelectedDate() { return selectedDate; }
  // A new task made by another part of the app (the Strategy tab). It is the same record the To-Do form makes, in the same list.
  function addTask(fields) {
    const f = fields || {}, text = String(f.text || "").trim();
    if (!text) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || "") ? f.date : selectedDate;
    const t = {
      text: text, priority: ["low", "medium", "high"].indexOf(f.priority) !== -1 ? f.priority : "medium",
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(f.time || "") ? f.time : "", category: String(f.category || "").trim(), goalId: f.goalId || null,
      id: window.JarvisCore.uid("task"), date: date, completed: false, order: nextOrderForDate(date), createdAt: Date.now()
    };
    // "scheduled" (an activity planned for that day, never overdue) or "deadline" (see task-kind-logic.js); a caller that does not say leaves it unmarked
    if (TK && TK.KINDS.indexOf(f.kind) !== -1) t.kind = f.kind;
    if (typeof f.mealPrepId === "string" && f.mealPrepId) t.mealPrepId = f.mealPrepId.slice(0, 80);   // a Meal Prep session's task (the Calendar shows the session once, not the task too)
    tasks.push(t);
    saveTasks();
    renderTaskList(); renderDaySelectorPills(); renderTodayOverview();
    return t;
  }

  function onSubTabChange(targetId) {
    if (targetId === "habits-plan" && window.JarvisDayPlan && typeof window.JarvisDayPlan.onShow === "function") window.JarvisDayPlan.onShow();
    if (targetId === "habits-today") { renderDaySelectorPills(); renderTaskList(); renderTodayHabitsList(); renderTodayOverview(); }
    if (targetId === "habits-progress") { renderHabitHistoryGrid(); renderStats(); }
    if (targetId === "habits-routines") renderHabitManageList();
    if (targetId === "habits-goals") renderGoalsList();
  }

  function init() {
    load();
    clockDay = selectedDate;
    document.addEventListener("visibilitychange", function () { if (!document.hidden) followTheClock(); });
    window.addEventListener("pageshow", followTheClock);
    window.setInterval(followTheClock, 30000);

    $("taskAddToggleBtn").addEventListener("click", handleTaskAddToggle);
    $("taskForm").addEventListener("submit", handleTaskFormSubmit);
    $("taskText").addEventListener("input", refreshTaskDup);
    $("taskTime").addEventListener("input", refreshTaskDup);
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
    $("habitsDayNote").addEventListener("click", handleHabitsDayNoteClick);
    $("habitHistoryGrid").addEventListener("click", handleHabitGridClick);
    $("habitForm").addEventListener("submit", handleHabitFormSubmit);
    $("habitName").addEventListener("input", refreshHabitDup);
    $("habitPlanTime").addEventListener("input", syncPlanForm);
    $("habitTargetDays").addEventListener("input", syncPlanForm);
    $("habitFormCancelBtn").addEventListener("click", resetHabitForm);
    $("habitAddToggleBtn").addEventListener("click", function () {
      const open = !$("habitFormWrap").hidden;
      if (open) resetHabitForm(); else { showHabitForm(true); $("habitName").focus(); }
    });
    $("habitsMenuBtn").addEventListener("click", openHabitsMenu);
    $("habitManageList").addEventListener("click", handleHabitManageListClick);
    $("historyPrevWeekBtn").addEventListener("click", function () { handleHistoryWeekNav(-1); });
    $("historyNextWeekBtn").addEventListener("click", function () { handleHistoryWeekNav(1); });


    resetTaskForm();
    resetHabitForm();
    renderAll();
  }

  // For the Planning overview: today's habits as the Today screen shows them, and the same tick (through the same
  // code path, so every other habit screen and Discipline's "Next up" follow it). Nothing is copied or stored here.
  function getToday() {
    const today = window.JarvisCore.todayISODate();
    return { date: today, habits: habits.map(function (h) { return { id: h.id, name: h.name, done: isHabitDoneOnDate(h, today), count: habitCountOn(h, today), target: habitDailyTarget(h) }; }) };
  }
  function toggleToday(id) {
    const today = window.JarvisCore.todayISODate();
    const h = habits.find(function (x) { return x.id === id; });
    if (!h) return false;
    if (habitDailyTarget(h) > 1) return false;   // a habit with a daily count is stepped up and down on the Habits screen, not ticked
    const wasDone = isHabitDoneOnDate(h, today);
    return applyHabitChange(id, function (list, t) { return HL.setDone(list, id, today, !wasDone, t); });
  }

  /* ---- for the Day planner and the Calendar (calendar-ui.js, calendar-planner-ui.js) ----
     They never write the habits themselves: everything goes through here, so it is the same record, the same rules and the same save as
     the Habits screen. A change is only reported as made if it was saved; if the browser refuses, the list goes back as it was. */

  function getHabits() { return habits.slice(); }
  const REFUSED = "That couldn't be saved. The browser may be full or blocking storage.";
  // fn(list) -> { ok, habits, error }
  function changeHabits(fn) {
    const res = fn(habits);
    if (!res || !res.ok) return { ok: false, errors: (res && res.errors) || {}, error: (res && res.error) || "That can't be changed." };
    const prev = habits;
    habits = res.habits;
    if (!saveHabits()) { habits = prev; renderAllHabitViews(); return { ok: false, errors: {}, error: REFUSED }; }
    followHabits(prev);
    renderAllHabitViews();
    return { ok: true, errors: {} };
  }
  // Done or not done on one day (a counting habit is filled to its daily target, or emptied). The same write as ticking it on the Habits screen.
  function setHabitDay(id, date, done) { return changeHabits(function (list) { return HL.setDone(list, id, date, !!done, window.JarvisCore.todayISODate()); }); }
  // One more (or one less) on a counting habit.
  function stepHabitDay(id, date, delta) { return changeHabits(function (list) { return HL.adjust(list, id, date, delta, window.JarvisCore.todayISODate()); }); }
  // Put a habit on the planner ({ time, days, from }), or change its time and days.
  function planHabit(id, input) { return changeHabits(function (list) { return HP.setPlan(list, id, input); }); }
  // Undo for the two above: its planner fields exactly as they were (HabitPlan.fields of the habit before).
  function restoreHabitPlan(id, saved) { return changeHabits(function (list) { return HP.restorePlan(list, id, saved); }); }
  // A new habit (the same record the Habits form makes). An existing habit with the same name is returned instead of a second one.
  // -> { ok, habit, existed }
  function addHabit(fields) {
    const f = fields || {}, name = String(f.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) return { ok: false, error: "Give the habit a name." };
    const have = habits.filter(function (h) { return String(h.name).toLowerCase() === name.toLowerCase(); })[0];
    if (have) return { ok: true, habit: have, existed: true };
    const made = { id: window.JarvisCore.uid("habit"), name: name, targetDays: clampInt(f.targetDays, 1, 7, 7), dailyTarget: clampInt(f.dailyTarget, 1, 50, 1), completions: {}, createdAt: Date.now() };
    const r = changeHabits(function (list) { return { ok: true, habits: list.concat([made]) }; });
    return r.ok ? { ok: true, habit: made, existed: false } : { ok: false, error: r.error };
  }
  function unplanHabit(id) { return changeHabits(function (list) { return HP.clearPlan(list, id); }); }
  // A different time on one day only; the habit's usual time and days are not touched.
  function moveHabitDay(id, date, time) { return changeHabits(function (list) { return HP.moveOn(list, id, date, time); }); }


  /* ---- one occurrence, one tick: links between tasks and habits, and duplicate suggestions (planning-core-logic.js) ----
     A task with habitId stands for that habit on the task's day and shares its tick. Nothing is merged or deleted for you: a link is made, or a pair is
     kept separate, only when asked. The first time a link is made, the tasks and habits as they were are copied to this device (jarvisPlanSnapshot). */

  const SNAP_KEY = "jarvisPlanSnapshot";
  function ensureSnapshot() {
    try {
      if (window.JarvisCore.loadJSON(SNAP_KEY, null)) return;
      const snap = { v: 1, at: Date.now(), reason: "before the first task and habit were linked", tasks: tasks, habits: habits };
      if (JSON.stringify(snap).length > 1500000) return;
      window.JarvisCore.saveJSON(SNAP_KEY, snap);
    } catch (e) { /* a snapshot is a convenience; linking does not depend on it */ }
  }
  // A habit with a planner time is on its planner days; one without can be done any day, so it is "on" every day for duplicate suggestions.
  function habitOnDay(h, date) { return HP && HP.onPlanner(h) ? HP.occursOn(h, date) : true; }
  function habitAtTime(h, date) { return HP ? HP.timeOn(h, date) : ""; }
  function calEvents(from, to) {
    try {
      const c = window.JarvisCalendar;
      return c && c.itemsBetween ? c.itemsBetween(from, to).filter(function (it) { return it.source === "event"; }).map(function (it) { return { id: it.id, title: it.title, date: it.date, time: it.allDay ? "" : it.time, allDay: !!it.allDay }; }) : [];
    } catch (e) { return []; }
  }
  // Possible duplicates of something being made. cand { type: "task"|"habit"|"event"|"block", name, date?, time? }. Suggestions only.
  function duplicateCheck(cand) {
    if (!PC || !cand) return [];
    const today = window.JarvisCore.todayISODate(), day = /^\d{4}-\d{2}-\d{2}$/.test(cand.date || "") ? cand.date : "";
    return PC.findDuplicates(cand, { tasks: tasks, habits: habits, events: day ? calEvents(day, day) : [] }, { today: today, from: today, habitOn: habitOnDay, habitTime: habitAtTime });
  }
  // Pairs among what is already saved that may be one occurrence entered twice. opts { from, to }.
  function duplicateScan(opts) {
    if (!PC) return [];
    const today = window.JarvisCore.todayISODate(), o = opts || {};
    const from = o.from || PCaddDays(today, -7), to = o.to || PCaddDays(today, 60);
    return PC.scan({ tasks: tasks, habits: habits, events: calEvents(from, to) }, { today: today, habitOn: habitOnDay, habitTime: habitAtTime }, { from: from, to: to });
  }
  function PCaddDays(d, n) { return addDaysISO(d, n); }
  // Saves a changed pair of lists together; if the browser refuses, both go back. -> { ok, error }
  function commitLinked(nextTasks, nextHabits) {
    const prevT = tasks, prevH = habits;
    tasks = nextTasks; habits = nextHabits;
    if (nextHabits !== prevH && !saveHabits()) { tasks = prevT; habits = prevH; renderAllHabitViews(); renderTaskList(); return { ok: false, error: REFUSED }; }
    saveTasks();
    renderTaskList(); renderDaySelectorPills(); renderTodayOverview(); renderAllHabitViews();
    return { ok: true };
  }
  function linkTaskToHabit(taskId, habitId) {
    if (!PC) return { ok: false, error: "Linking isn't available." };
    ensureSnapshot();
    const r = PC.link(tasks, habits, taskId, habitId, window.JarvisCore.todayISODate());
    return r.ok ? commitLinked(r.tasks, r.habits) : r;
  }
  function unlinkTask(taskId) {
    if (!PC) return { ok: false, error: "Linking isn't available." };
    const r = PC.unlink(tasks, taskId);
    return r.ok ? commitLinked(r.tasks, habits) : r;
  }
  function keepSeparate(taskId, otherId) {
    if (!PC) return { ok: false, error: "Linking isn't available." };
    const r = PC.markSeparate(tasks, taskId, otherId);
    return r.ok ? commitLinked(r.tasks, habits) : r;
  }
  // Links every one of these tasks to the habit. -> { ok, linked }
  function linkTasksToHabit(taskIds, habitId) {
    if (!PC) return { ok: false, error: "Linking isn't available." };
    ensureSnapshot();
    let t = tasks, hs = habits, linked = 0;
    taskIds.forEach(function (id) { const r = PC.link(t, hs, id, habitId, window.JarvisCore.todayISODate()); if (r.ok) { t = r.tasks; hs = r.habits; linked++; } });
    if (!linked) return { ok: true, linked: 0 };
    const r = commitLinked(t, hs);
    return r.ok ? { ok: true, linked: linked } : r;
  }
  function habitAllowsLink(habitId, date) { const h = habits.filter(function (x) { return x.id === habitId; })[0]; return !!h && habitOnDay(h, date); }
  function getSnapshotInfo() { const s = window.JarvisCore.loadJSON(SNAP_KEY, null); return s && s.v ? { at: s.at, tasks: (s.tasks || []).length, habits: (s.habits || []).length, reason: s.reason } : null; }

  window.JarvisHabits = { duplicateCheck: duplicateCheck, duplicateScan: duplicateScan, linkTaskToHabit: linkTaskToHabit, linkTasksToHabit: linkTasksToHabit, unlinkTask: unlinkTask, keepSeparate: keepSeparate, habitAllowsLink: habitAllowsLink, getSnapshotInfo: getSnapshotInfo, addHabit: addHabit, getHabits: getHabits, setHabitDay: setHabitDay, stepHabitDay: stepHabitDay, planHabit: planHabit, restoreHabitPlan: restoreHabitPlan, unplanHabit: unplanHabit, moveHabitDay: moveHabitDay, init: init, getSummary: getSummary, getToday: getToday, toggleToday: toggleToday, onSubTabChange: onSubTabChange, getTasks: getTasks, commitTasks: commitTasks, getSelectedDate: getSelectedDate, addTask: addTask, selectDate: selectDate, getGoals: function () { return goals; }, commitGoals: commitGoals, releaseGoalTasks: releaseGoalTasks };
})();
