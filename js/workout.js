/* ==========================================================================
   JARVIS — Workout tracker
   localStorage key: jarvisWorkouts
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisWorkouts";
  let workouts = [];

  function load() {
    workouts = window.JarvisCore.loadJSON(LS_KEY, []);
    if (!Array.isArray(workouts)) workouts = [];
  }

  function save() {
    window.JarvisCore.saveJSON(LS_KEY, workouts);
  }

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
    const core = window.JarvisCore;
    document.getElementById("workoutStatTotal").textContent = workouts.length;
    document.getElementById("workoutStatWeek").textContent = thisWeekCount();
    document.getElementById("workoutStatStreak").textContent = dayStreak();
  }

  function renderList() {
    const core = window.JarvisCore;
    const container = document.getElementById("workoutList");
    if (workouts.length === 0) {
      container.innerHTML = '<div class="empty-state">No workouts logged yet. Add your first session above.</div>';
      return;
    }
    const sorted = workouts.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt;
    });
    container.innerHTML = sorted.map(function (w) {
      const durationText = w.duration ? core.escapeHtml(w.duration) + " min" : "";
      const notesText = w.notes ? " — " + core.escapeHtml(w.notes) : "";
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(w.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(w.name) + ' <span class="badge badge-neutral">' + core.escapeHtml(w.category) + '</span></span>' +
              '<span class="list-item-meta">' + core.formatDate(w.date) + (durationText ? " · " + durationText : "") + notesText + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger workout-delete-btn" data-id="' + core.escapeHtml(w.id) + '" aria-label="Delete workout">Delete</button>' +
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

  function handleSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = document.getElementById("workoutName").value.trim();
    const category = document.getElementById("workoutCategory").value;
    const durationRaw = document.getElementById("workoutDuration").value;
    const dateInput = document.getElementById("workoutDate").value;
    const notes = document.getElementById("workoutNotes").value.trim();

    if (!name) {
      core.showToast("Please enter a workout name.");
      return;
    }
    let duration = null;
    if (durationRaw !== "") {
      const n = Number(durationRaw);
      if (!isFinite(n) || n <= 0) {
        core.showToast("Duration must be a positive number.");
        return;
      }
      duration = n;
    }

    const date = dateInput || core.todayISODate();

    workouts.push({
      id: core.uid("workout"),
      name: name,
      category: category,
      duration: duration,
      date: date,
      notes: notes,
      createdAt: Date.now()
    });
    save();
    render();
    e.target.reset();
    document.getElementById("workoutDate").value = "";
    core.showToast("Workout logged.");
  }

  function handleListClick(e) {
    const btn = e.target.closest(".workout-delete-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    workouts = workouts.filter(function (w) { return w.id !== id; });
    save();
    render();
  }

  function init() {
    load();
    render();
    document.getElementById("workoutForm").addEventListener("submit", handleSubmit);
    document.getElementById("workoutList").addEventListener("click", handleListClick);
  }

  window.JarvisWorkout = { init: init };
})();
