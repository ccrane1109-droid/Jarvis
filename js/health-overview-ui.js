/* ==========================================================================
   JARVIS — Health › Overview.

   The first screen of the Health section (Overview | Workout | Nutrition). It only shows what Workout and Nutrition
   already know — a workout in progress, the routine scheduled for today, this week's count, the last workout, and
   today's food and water — and gives one tap to each area. Nothing is saved or calculated here that the other screens
   do not also show: the numbers come from JarvisWorkout / JarvisWorkoutUI / JarvisNutrition (read only), and a button
   only opens the screen that does the work. With nothing logged it says so instead of showing zeros as if they were data.
   ========================================================================== */

(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(String(s === null || s === undefined ? "" : s)); }
  function panelActive() { const p = $("panel-health"); return !!(p && p.classList.contains("active")); }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function prettyDate(iso) {
    const p = String(iso || "").slice(0, 10).split("-").map(Number);
    if (p.length !== 3 || !p[0]) return "";
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function num(n) { return Number(n).toLocaleString("en-US"); }

  /* ---------------- Workout ---------------- */

  function workoutCard() {
    const W = window.JarvisWorkout, UI = window.JarvisWorkoutUI;
    let body = "", cta = '<button type="button" class="btn btn-primary ov-cta" data-ov="workout">Open Workout</button>';
    try {
      const live = UI && UI.activeInfo ? UI.activeInfo() : null;
      const sum = W && W.getSummary ? W.getSummary() : null;
      if (live) {
        body = '<p class="ov-kicker">In progress</p><p class="ov-main">' + esc(live.title) + '</p>' +
          '<p class="ov-meta">' + esc(live.elapsed) + ' &middot; ' + live.done + ' of ' + live.total + ' sets done</p>';
        cta = '<button type="button" class="btn btn-primary ov-cta" data-ov="resume">Resume workout</button>';
      } else {
        const a = W && W.api ? W.api : null;
        const scheduled = a && a.routineScheduledToday ? a.routineScheduledToday() : null;
        if (scheduled) {
          const n = scheduled.exercises ? scheduled.exercises.length : 0;
          body = '<p class="ov-kicker">Scheduled today</p><p class="ov-main">' + esc(scheduled.name) + '</p>' +
            (n ? '<p class="ov-meta">' + n + ' ' + plural(n, "exercise") + '</p>' : "");
        } else {
          body = '<p class="ov-main">No workout scheduled today</p>';
        }
        if (sum && sum.total > 0) {
          body += '<dl class="ov-facts">' +
            '<div><dt>This week</dt><dd>' + sum.thisWeek + ' ' + plural(sum.thisWeek, "workout") + '</dd></div>' +
            (sum.lastWorkout ? '<div><dt>Last workout</dt><dd>' + esc(sum.lastWorkout.name) + (prettyDate(sum.lastWorkout.date) ? ' &middot; ' + esc(prettyDate(sum.lastWorkout.date)) : "") + '</dd></div>' : "") +
            '</dl>';
        } else {
          body += '<p class="ov-meta">No workouts logged yet.</p>';
        }
      }
    } catch (e) {
      body = '<p class="ov-meta">Workout details are not available right now.</p>';
    }
    return '<section class="card ov-card" aria-labelledby="hoWorkoutTitle"><h2 class="ov-title" id="hoWorkoutTitle">Workout</h2>' + body + cta +
      '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="routines">Routines</button><button type="button" class="ov-chip" data-ov="progress">Progress</button></div></section>';
  }

  /* ---------------- Nutrition ---------------- */

  function barHtml(value, target, label) {
    if (!(target > 0)) return "";
    const pct = Math.max(0, Math.min(100, Math.round((value / target) * 100)));
    return '<div class="ov-bar" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>';
  }
  function macro(label, value, target) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + num(value) + (target > 0 ? ' / ' + num(target) : "") + ' g</dd></div>';
  }

  function nutritionCard() {
    const N = window.JarvisNutrition;
    let body = "";
    try {
      const t = N && N.getToday ? N.getToday() : null;
      if (!t) {
        body = '<p class="ov-meta">Nutrition details are not available right now.</p>';
      } else if (!t.entries && !t.water) {
        body = '<p class="ov-main">Nothing logged yet today</p>' +
          (t.targets.calories > 0 ? '<p class="ov-meta">Calorie target ' + num(t.targets.calories) + '</p>' : "");
      } else {
        const left = t.targets.calories > 0 ? t.targets.calories - t.calories : null;
        body = '<p class="ov-big">' + num(t.calories) + ' <span class="ov-unit">cal</span></p>' +
          (left === null ? "" : '<p class="ov-meta' + (left < 0 ? " is-over" : "") + '">of ' + num(t.targets.calories) + ' &middot; ' + (left >= 0 ? num(left) + ' left' : num(-left) + ' over') + '</p>') +
          barHtml(t.calories, t.targets.calories, "Calories today") +
          '<dl class="ov-facts ov-facts-3">' + macro("Protein", t.protein, t.targets.protein) + macro("Carbs", t.carbs, t.targets.carbs) + macro("Fat", t.fat, t.targets.fat) + '</dl>' +
          '<p class="ov-meta">Water: ' + t.water + ' ' + plural(t.water, "cup") + (t.targets.water > 0 ? ' of ' + t.targets.water : "") + '</p>';
      }
    } catch (e) {
      body = '<p class="ov-meta">Nutrition details are not available right now.</p>';
    }
    return '<section class="card ov-card" aria-labelledby="hoNutritionTitle"><h2 class="ov-title" id="hoNutritionTitle">Nutrition</h2>' + body +
      '<button type="button" class="btn btn-primary ov-cta" data-ov="log-food">+ Log Food</button>' +
      '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="nutrition">Open Nutrition</button><button type="button" class="ov-chip" data-ov="foods">Foods</button><button type="button" class="ov-chip" data-ov="nut-history">History</button></div></section>';
  }

  /* ---------------- Meal prep ---------------- */

  // Today's plan against what is logged, the next prep session and the prepared portions left. Read only: it comes from Meal Prep.
  function mealPrepCard() {
    const M = window.JarvisMealPrep;
    let body = "";
    try {
      const o = M && M.overview ? M.overview() : null;
      if (!o) body = '<p class="ov-meta">Meal prep details are not available right now.</p>';
      else {
        body = o.meals ? '<p class="ov-main">' + o.eaten + ' of ' + o.meals + ' planned ' + plural(o.meals, "meal") + ' eaten</p>' : '<p class="ov-main">No meals planned today</p>';
        if (o.meals) {
          body += '<dl class="ov-facts ov-facts-3"><div><dt>Planned</dt><dd>' + num(o.planned.calories) + ' cal</dd></div><div><dt>Logged</dt><dd>' + num(o.logged ? o.logged.calories : 0) + ' cal</dd></div><div><dt>Protein</dt><dd>' + num(Math.round(o.planned.protein)) + ' g planned</dd></div></dl>' +
            (o.estimated ? '<p class="ov-meta">Some planned numbers are estimates.</p>' : '');
        }
        body += '<dl class="ov-facts"><div><dt>Next prep</dt><dd>' + (o.next ? esc(({ shopping: "Grocery shopping", cooking: "Cooking", portioning: "Portioning", reminder: "Reminder" })[o.next.kind] || "Prep") + ' &middot; ' + esc(prettyDate(o.next.date)) : 'None scheduled') + '</dd></div>' +
          '<div><dt>Prepared portions</dt><dd>' + o.portions + (o.useSoon ? ' (' + o.useSoon + ' to use soon)' : '') + '</dd></div></dl>';
      }
    } catch (e) {
      body = '<p class="ov-meta">Meal prep details are not available right now.</p>';
    }
    return '<section class="card ov-card" aria-labelledby="hoMealPrepTitle"><h2 class="ov-title" id="hoMealPrepTitle">Meal prep</h2>' + body +
      '<button type="button" class="btn btn-primary ov-cta" data-ov="mealprep">Open Meal Prep</button>' +
      '<div class="ov-chips"><button type="button" class="ov-chip" data-ov="mealprep-plan">Weekly plan</button><button type="button" class="ov-chip" data-ov="mealprep-grocery">Grocery list</button></div></section>';
  }

  /* ---------------- drawing and taps ---------------- */

  function render() {
    const root = $("hoRoot");
    if (!root || !core()) return;
    root.innerHTML = workoutCard() + nutritionCard() + mealPrepCard();
  }

  function onClick(e) {
    const el = e.target.closest ? e.target.closest("[data-ov]") : null;
    if (!el) return;
    const go = core().openScreen, act = el.getAttribute("data-ov");
    if (act === "workout") go("navBtnWorkout", "workoutSubNavWkHome");
    else if (act === "routines") go("navBtnWorkout", "workoutSubNavRoutines");
    else if (act === "progress") go("navBtnWorkout", "workoutSubNavProgress");
    else if (act === "resume") { go("navBtnWorkout", "workoutSubNavWkHome"); if (window.JarvisWorkoutUI && window.JarvisWorkoutUI.resume) window.JarvisWorkoutUI.resume(); }
    else if (act === "nutrition") go("navBtnNutrition", "nutritionSubNavDashboard");
    else if (act === "foods") go("navBtnNutrition", "nutritionSubNavFoods");
    else if (act === "nut-history") go("navBtnNutrition", "nutritionSubNavHistory");
    else if (act === "mealprep") go("navBtnNutrition", "nutritionSubNavMealPrep");
    else if (act === "mealprep-plan" || act === "mealprep-grocery") { go("navBtnNutrition", "nutritionSubNavMealPrep"); if (window.JarvisMealPrep && window.JarvisMealPrep.kit) window.JarvisMealPrep.kit.setTab(act === "mealprep-plan" ? "plan" : "grocery"); }
    else if (act === "log-food") {
      go("navBtnNutrition", "nutritionSubNavDashboard");
      const b = $("foodOpenModalBtn"); if (b) b.click();
    }
  }

  function onShow() { render(); }

  let started = false;
  function init() {
    const root = $("hoRoot");
    if (!root || started) return;
    started = true;
    root.addEventListener("click", onClick);
    document.addEventListener("jarvis-workout-changed", function () { if (panelActive()) render(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && panelActive()) render(); });
    // The "in progress" time keeps counting; never redraw under a finger that is on a button here.
    window.setInterval(function () {
      if (document.hidden || !panelActive()) return;
      if (document.activeElement && root.contains(document.activeElement)) return;
      render();
    }, 30000);
    render();
  }

  // app.js starts this with the other screens, once the saved data has loaded.
  window.JarvisHealthOverview = { init: init, onShow: onShow, render: render };
})();
