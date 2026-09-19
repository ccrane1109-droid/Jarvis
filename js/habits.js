/* ==========================================================================
   JARVIS — Habits tracker
   localStorage key: jarvisHabits
   Each habit: { id, name, targetDays, completedDates: [ISO date strings], createdAt }
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisHabits";
  let habits = [];

  function load() {
    habits = window.JarvisCore.loadJSON(LS_KEY, []);
    if (!Array.isArray(habits)) habits = [];
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, habits);
  }

  function computeStreak(habit) {
    const dates = new Set(habit.completedDates || []);
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

  function render() {
    const core = window.JarvisCore;
    const container = document.getElementById("habitList");
    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-state">No habits yet. Add one above to start tracking.</div>';
      return;
    }
    const today = core.todayISODate();
    container.innerHTML = habits.map(function (h) {
      const doneToday = (h.completedDates || []).indexOf(today) !== -1;
      const streak = computeStreak(h);
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(h.id) + '">' +
          '<div class="list-item-row">' +
            '<button type="button" class="habit-check-btn' + (doneToday ? " done" : "") + '" data-id="' + core.escapeHtml(h.id) + '" aria-pressed="' + doneToday + '" aria-label="Mark ' + core.escapeHtml(h.name) + ' done today">' + (doneToday ? "&#10003;" : "") + '</button>' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(h.name) + '</span>' +
              '<span class="list-item-meta">Target ' + core.escapeHtml(h.targetDays) + 'x/week · ' + streak + ' day streak</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger habit-delete-btn" data-id="' + core.escapeHtml(h.id) + '" aria-label="Delete habit">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = document.getElementById("habitName").value.trim();
    const targetRaw = document.getElementById("habitTargetDays").value;

    if (!name) {
      core.showToast("Please enter a habit name.");
      return;
    }
    let targetDays = Number(targetRaw);
    if (!isFinite(targetDays) || targetDays < 1) targetDays = 7;
    if (targetDays > 7) targetDays = 7;

    habits.push({
      id: core.uid("habit"),
      name: name,
      targetDays: Math.round(targetDays),
      completedDates: [],
      createdAt: Date.now()
    });
    save();
    render();
    e.target.reset();
    document.getElementById("habitTargetDays").value = "7";
    core.showToast("Habit added.");
  }

  function handleListClick(e) {
    const core = window.JarvisCore;
    const checkBtn = e.target.closest(".habit-check-btn");
    if (checkBtn) {
      const id = checkBtn.getAttribute("data-id");
      const habit = habits.find(function (h) { return h.id === id; });
      if (!habit) return;
      const today = core.todayISODate();
      const list = habit.completedDates || [];
      const idx = list.indexOf(today);
      if (idx === -1) {
        list.push(today);
      } else {
        list.splice(idx, 1);
      }
      habit.completedDates = list;
      save();
      render();
      return;
    }
    const delBtn = e.target.closest(".habit-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      habits = habits.filter(function (h) { return h.id !== id; });
      save();
      render();
    }
  }

  function init() {
    load();
    render();
    document.getElementById("habitForm").addEventListener("submit", handleSubmit);
    document.getElementById("habitList").addEventListener("click", handleListClick);
  }

  window.JarvisHabits = { init: init };
})();
