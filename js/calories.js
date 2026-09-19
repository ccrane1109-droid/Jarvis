/* ==========================================================================
   JARVIS — Calorie tracker
   localStorage key: jarvisCalories -> { goal: number, entries: [...] }
   Manually logged only. No food database, no automatic tracking.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisCalories";
  let state = { goal: 2000, entries: [] };

  function load() {
    const loaded = window.JarvisCore.loadJSON(LS_KEY, { goal: 2000, entries: [] });
    state = {
      goal: (loaded && window.JarvisCore.isPositiveNumber(loaded.goal)) ? loaded.goal : 2000,
      entries: (loaded && Array.isArray(loaded.entries)) ? loaded.entries : []
    };
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, state);
  }

  function todayTotal() {
    const today = window.JarvisCore.todayISODate();
    return state.entries
      .filter(function (e) { return e.date === today; })
      .reduce(function (sum, e) { return sum + e.calories; }, 0);
  }

  function renderStats() {
    const core = window.JarvisCore;
    const total = todayTotal();
    const remaining = state.goal - total;
    document.getElementById("calorieStatToday").textContent = total;
    document.getElementById("calorieStatGoal").textContent = state.goal;
    const remainingEl = document.getElementById("calorieStatRemaining");
    remainingEl.textContent = remaining;
    remainingEl.className = "stat-value " + (remaining >= 0 ? "positive" : "negative");
    document.getElementById("calorieGoalInput").value = state.goal;
  }

  function renderList() {
    const core = window.JarvisCore;
    const container = document.getElementById("calorieList");
    if (state.entries.length === 0) {
      container.innerHTML = '<div class="empty-state">No calories logged yet.</div>';
      return;
    }
    const sorted = state.entries.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt;
    });
    container.innerHTML = sorted.map(function (e) {
      const notesText = e.notes ? " — " + core.escapeHtml(e.notes) : "";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(e.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(e.calories) + ' cal</span>' +
              '<span class="list-item-meta">' + core.formatDate(e.date) + notesText + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger calorie-delete-btn" data-id="' + core.escapeHtml(e.id) + '" aria-label="Delete calorie entry">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function render() {
    renderStats();
    renderList();
  }

  function handleGoalSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const goal = Number(document.getElementById("calorieGoalInput").value);
    if (!core.isPositiveNumber(goal)) {
      core.showToast("Daily goal must be a positive number.");
      return;
    }
    state.goal = Math.round(goal);
    save();
    render();
    core.showToast("Calorie goal saved.");
  }

  function handleEntrySubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const dateInput = document.getElementById("calorieDate").value;
    const calories = Number(document.getElementById("calorieAmount").value);
    const notes = document.getElementById("calorieNotes").value.trim();

    if (!core.isPositiveNumber(calories)) {
      core.showToast("Calories must be a positive number.");
      return;
    }

    state.entries.push({
      id: core.uid("cal"),
      date: dateInput || core.todayISODate(),
      calories: Math.round(calories),
      notes: notes,
      createdAt: Date.now()
    });
    save();
    render();
    e.target.reset();
    document.getElementById("calorieDate").value = "";
    core.showToast("Calories logged.");
  }

  function handleListClick(e) {
    const delBtn = e.target.closest(".calorie-delete-btn");
    if (!delBtn) return;
    const id = delBtn.getAttribute("data-id");
    state.entries = state.entries.filter(function (entry) { return entry.id !== id; });
    save();
    render();
  }

  function getSummary() {
    return {
      goal: state.goal,
      todayTotal: todayTotal(),
      remaining: state.goal - todayTotal(),
      entriesLogged: state.entries.length
    };
  }

  function init() {
    load();
    render();
    document.getElementById("calorieGoalForm").addEventListener("submit", handleGoalSubmit);
    document.getElementById("calorieForm").addEventListener("submit", handleEntrySubmit);
    document.getElementById("calorieList").addEventListener("click", handleListClick);
  }

  window.JarvisCalories = { init: init, getSummary: getSummary };
})();
