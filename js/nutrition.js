/* ==========================================================================
   JARVIS — Nutrition tracker
   A separate main section from Workout. Manually logged only — no food
   database, no barcode scanning, no automatic lookups. Every number in here
   came from what the user typed in.

   localStorage keys:
     jarvisNutritionGoals      — { mode: "cutting"|"bulking",
                                    cutting: {calories,protein,carbs,fat,fiber,water},
                                    bulking: {calories,protein,carbs,fat,fiber,water} }
     jarvisNutritionLog        — { "<YYYY-MM-DD>": { water: number,
                                    meals: { breakfast:[item], lunch:[item],
                                    dinner:[item], snacks:[item] } } }
                                  item: {id, name, serving, calories, protein,
                                    carbs, fat, fiber, sodium, calcium, iron,
                                    potassium, vitaminC, vitaminD, isFruitVeg,
                                    createdAt} — every nutrient field beyond
                                    calories/protein/carbs/fat/fiber is
                                    OPTIONAL (undefined, not 0, when not
                                    entered) so totals never invent a number
                                    the user didn't provide.
     jarvisNutritionSavedFoods — [ {..same shape as a food item, minus date} ]
     jarvisNutritionRecipes    — [ {id, name, instructions, servings,
                                    ingredients: [{name,calories,protein,
                                    carbs,fat,fiber}], createdAt} ] — per-
                                    serving macros are always computed
                                    (sum of ingredients / servings), never
                                    stored separately, so they can't drift.
     jarvisNutritionMigrated   — "1" once the old Workout > Calories data
                                  (jarvisCalories) has been folded in, so it
                                  only happens once even if the user later
                                  deletes everything.

   The scoring/reference-value logic below is a transparent, disclosed
   heuristic built only from numbers the user actually entered — never a
   medical judgment and never a comment on the user's body. Structured as a
   plain state object + pure render functions so a future AI layer (per the
   product brief) could read this same state without any rework here.
   ========================================================================== */

(function () {
  "use strict";

  const LS_GOALS = "jarvisNutritionGoals";
  const LS_LOG = "jarvisNutritionLog";
  const LS_SAVED = "jarvisNutritionSavedFoods";
  const LS_RECIPES = "jarvisNutritionRecipes";
  const LS_MIGRATED = "jarvisNutritionMigrated";
  const LS_OLD_CALORIES = "jarvisCalories";

  const MEALS = ["breakfast", "lunch", "dinner", "snacks"];
  const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };
  const MACRO_FIELDS = ["calories", "protein", "carbs", "fat", "fiber"];
  const MICRO_FIELDS = ["sodium", "calcium", "iron", "potassium", "vitaminC", "vitaminD"];
  const MICRO_LABELS = { sodium: "Sodium", calcium: "Calcium", iron: "Iron", potassium: "Potassium", vitaminC: "Vitamin C", vitaminD: "Vitamin D" };
  const MICRO_UNITS = { sodium: "mg", calcium: "mg", iron: "mg", potassium: "mg", vitaminC: "mg", vitaminD: "mcg" };
  // Commonly-cited general adult reference values (not personalized, not
  // medical advice — shown only for rough context, same spirit as the
  // strength-standards disclaimer used elsewhere in this app).
  const MICRO_REFERENCE = { sodium: 2300, calcium: 1000, iron: 12, potassium: 2600, vitaminC: 80, vitaminD: 15 };
  const DEFAULT_TARGETS = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, water: 0 };

  let goals = { mode: "cutting", cutting: Object.assign({}, DEFAULT_TARGETS), bulking: Object.assign({}, DEFAULT_TARGETS) };
  let log = {}; // date -> { water, meals: { breakfast: [], ... } }
  let savedFoods = [];
  let recipes = [];

  // Transient (not persisted) editor state, same pattern as workout.js's
  // routine/program builders.
  let foodFormMeal = "breakfast";
  let foodFormEditId = null; // { meal, id } when editing an existing entry
  let recipeBuilder = { editId: null, ingredients: [{ name: "", calories: "", protein: "", carbs: "", fat: "", fiber: "" }] };
  let historySelectedDate = "";

  /* ---------------- persistence ---------------- */

  function isNonNegativeNumber(v) {
    const n = Number(v);
    return isFinite(n) && n >= 0;
  }

  function sanitizeTargets(t) {
    const out = {};
    ["calories", "protein", "carbs", "fat", "fiber", "water"].forEach(function (k) {
      out[k] = (t && isNonNegativeNumber(t[k])) ? Number(t[k]) : 0;
    });
    return out;
  }

  function sanitizeFoodItem(raw) {
    const core = window.JarvisCore;
    const item = {
      id: raw.id || core.uid("food"),
      name: String(raw.name || "").slice(0, 80),
      serving: String(raw.serving || "").slice(0, 40),
      isFruitVeg: !!raw.isFruitVeg,
      createdAt: raw.createdAt || Date.now()
    };
    MACRO_FIELDS.forEach(function (f) {
      item[f] = isNonNegativeNumber(raw[f]) ? Number(raw[f]) : 0;
    });
    MICRO_FIELDS.forEach(function (f) {
      // Left undefined (not 0) when not provided — a real "0" entered by the
      // user is kept distinct from "never entered," which matters for the
      // nutrient-coverage part of the score and for the Nutrients tab.
      if (raw[f] !== "" && raw[f] !== null && raw[f] !== undefined && isNonNegativeNumber(raw[f])) {
        item[f] = Number(raw[f]);
      }
    });
    return item;
  }

  function load() {
    const core = window.JarvisCore;
    const loadedGoals = core.loadJSON(LS_GOALS, null);
    if (loadedGoals && typeof loadedGoals === "object") {
      goals = {
        mode: loadedGoals.mode === "bulking" ? "bulking" : "cutting",
        cutting: sanitizeTargets(loadedGoals.cutting),
        bulking: sanitizeTargets(loadedGoals.bulking)
      };
    } else {
      goals = { mode: "cutting", cutting: Object.assign({}, DEFAULT_TARGETS), bulking: Object.assign({}, DEFAULT_TARGETS) };
    }

    const loadedLog = core.loadJSON(LS_LOG, {});
    log = (loadedLog && typeof loadedLog === "object") ? loadedLog : {};

    const loadedSaved = core.loadJSON(LS_SAVED, []);
    savedFoods = Array.isArray(loadedSaved) ? loadedSaved : [];

    const loadedRecipes = core.loadJSON(LS_RECIPES, []);
    recipes = Array.isArray(loadedRecipes) ? loadedRecipes : [];

    migrateOldCalorieData();
  }

  // One-time move of the old Workout > Calories log into today's-and-past
  // Nutrition history, so switching sections doesn't erase what was already
  // tracked. Each old entry becomes a single "Logged calories" food item on
  // its date (calories only — the old tracker never recorded macros, so
  // nothing is invented for protein/carbs/fat/fiber).
  function migrateOldCalorieData() {
    const core = window.JarvisCore;
    if (core.loadJSON(LS_MIGRATED, null)) return;
    const old = core.loadJSON(LS_OLD_CALORIES, null);
    if (old && Array.isArray(old.entries) && old.entries.length > 0) {
      old.entries.forEach(function (e) {
        if (!e || !isNonNegativeNumber(e.calories)) return;
        const date = e.date || core.todayISODate();
        if (!log[date]) log[date] = { water: 0, meals: { breakfast: [], lunch: [], dinner: [], snacks: [] } };
        log[date].meals.snacks.push(sanitizeFoodItem({
          name: e.notes ? "Logged calories — " + e.notes : "Logged calories (from old tracker)",
          serving: "1", calories: e.calories, protein: 0, carbs: 0, fat: 0, fiber: 0,
          createdAt: e.createdAt || Date.now()
        }));
      });
      if (old.goal && isNonNegativeNumber(old.goal)) {
        goals.cutting.calories = old.goal;
        goals.bulking.calories = goals.bulking.calories || old.goal;
      }
      saveLog();
      saveGoals();
    }
    core.saveJSON(LS_MIGRATED, "1");
  }

  function saveGoals() { window.JarvisCore.saveJSON(LS_GOALS, goals); }
  function saveLog() { window.JarvisCore.saveJSON(LS_LOG, log); }
  function saveSavedFoods() { window.JarvisCore.saveJSON(LS_SAVED, savedFoods); }
  function saveRecipes() { window.JarvisCore.saveJSON(LS_RECIPES, recipes); }

  /* ---------------- day data helpers ---------------- */

  // Mutating: creates (and persists, once saveLog() is called) the date's
  // entry if it doesn't exist yet. Only for actual writes — adding/editing/
  // deleting food, adjusting water. Read-only lookups (totals, history,
  // averages) use peekDay() below instead, so simply viewing a page never
  // writes empty placeholder days into storage.
  function getDay(date) {
    if (!log[date]) log[date] = { water: 0, meals: { breakfast: [], lunch: [], dinner: [], snacks: [] } };
    if (!log[date].meals) log[date].meals = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    MEALS.forEach(function (m) { if (!Array.isArray(log[date].meals[m])) log[date].meals[m] = []; });
    if (!isNonNegativeNumber(log[date].water)) log[date].water = 0;
    return log[date];
  }

  // Non-mutating read of a date's data — returns an empty-but-valid shape
  // for a date with no entry yet, without writing anything to `log`.
  function peekDay(date) {
    const d = log[date];
    if (!d || !d.meals) return { water: 0, meals: { breakfast: [], lunch: [], dinner: [], snacks: [] } };
    return {
      water: isNonNegativeNumber(d.water) ? d.water : 0,
      meals: {
        breakfast: Array.isArray(d.meals.breakfast) ? d.meals.breakfast : [],
        lunch: Array.isArray(d.meals.lunch) ? d.meals.lunch : [],
        dinner: Array.isArray(d.meals.dinner) ? d.meals.dinner : [],
        snacks: Array.isArray(d.meals.snacks) ? d.meals.snacks : []
      }
    };
  }

  function getAllEntries(date) {
    const day = peekDay(date);
    return MEALS.reduce(function (all, m) { return all.concat(day.meals[m]); }, []);
  }

  function getDayTotals(date) {
    const entries = getAllEntries(date);
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, fruitVegCount: 0, distinctFoods: 0 };
    MICRO_FIELDS.forEach(function (f) { totals[f] = 0; totals[f + "Coverage"] = false; });
    const namesSeen = {};
    entries.forEach(function (item) {
      MACRO_FIELDS.forEach(function (f) { totals[f] += item[f] || 0; });
      if (item.isFruitVeg) totals.fruitVegCount++;
      const key = (item.name || "").trim().toLowerCase();
      if (key) namesSeen[key] = true;
      MICRO_FIELDS.forEach(function (f) {
        if (item[f] !== undefined) { totals[f] += item[f]; totals[f + "Coverage"] = true; }
      });
    });
    totals.distinctFoods = Object.keys(namesSeen).length;
    totals.water = peekDay(date).water;
    return totals;
  }

  function getMode() { return goals.mode === "bulking" ? "bulking" : "cutting"; }
  function getActiveTargets() { return goals[getMode()]; }

  /* ---------------- nutrition score (transparent, disclosed heuristic) ---------------- */

  function computeScore(date) {
    const totals = getDayTotals(date);
    const targets = getActiveTargets();
    const parts = []; // { key, label, weight, fraction (0-1), positive: bool describing whether "high fraction" is good }

    if (targets.protein > 0) {
      parts.push({ key: "protein", weight: 25, fraction: Math.min(totals.protein / targets.protein, 1), goodMsg: "Protein target is on track", improveMsg: "Protein is behind target today" });
    }
    if (targets.fiber > 0) {
      parts.push({ key: "fiber", weight: 20, fraction: Math.min(totals.fiber / targets.fiber, 1), goodMsg: "Good fiber intake", improveMsg: "Fiber is low today" });
    }
    if (targets.water > 0) {
      parts.push({ key: "water", weight: 15, fraction: Math.min(totals.water / targets.water, 1), goodMsg: "Good hydration", improveMsg: "Water intake is low today" });
    }
    // Variety: distinct foods logged, loosely aiming for 5+ different items.
    parts.push({ key: "variety", weight: 15, fraction: Math.min(totals.distinctFoods / 5, 1), goodMsg: "Good variety of foods today", improveMsg: "Try logging a wider variety of foods" });
    // Fruit/veg: self-tagged servings, loosely aiming for 3+.
    parts.push({ key: "fruitveg", weight: 10, fraction: Math.min(totals.fruitVegCount / 3, 1), goodMsg: "Good fruit/vegetable intake", improveMsg: "Add another fruit or vegetable" });
    // Nutrient coverage: how many of the 6 tracked micronutrients have any
    // entered data today at all (never fabricated — just "was it logged").
    const coveredCount = MICRO_FIELDS.filter(function (f) { return totals[f + "Coverage"]; }).length;
    parts.push({ key: "coverage", weight: 10, fraction: coveredCount / MICRO_FIELDS.length, goodMsg: "Good nutrient data logged today", improveMsg: "Log a food's sodium/calcium/iron/potassium/vitamin info for a fuller picture" });
    // Sodium caution — only scored when the user actually entered sodium data.
    if (totals.sodiumCoverage) {
      const ratio = totals.sodium / MICRO_REFERENCE.sodium;
      const fraction = ratio <= 1 ? 1 : Math.max(0, 1 - (ratio - 1));
      parts.push({ key: "sodium", weight: 5, fraction: fraction, goodMsg: "Sodium looks reasonable today", improveMsg: "Sodium looks high today" });
    }

    const totalWeight = parts.reduce(function (s, p) { return s + p.weight; }, 0);
    const earned = parts.reduce(function (s, p) { return s + p.weight * p.fraction; }, 0);
    const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

    const good = [];
    const improve = [];
    parts.forEach(function (p) {
      if (p.fraction >= 0.8) good.push(p.goodMsg);
      else if (p.fraction < 0.5) improve.push(p.improveMsg);
    });
    if (!targets.protein) improve.push("Set a protein target (in Cutting or Bulking) to track this");
    if (!targets.fiber) improve.push("Set a fiber target to track this");
    if (!targets.water) improve.push("Set a water target to track this");
    if (coveredCount === 0) improve.push("Low calcium/iron/potassium/vitamin data logged today");

    return { score: score, good: good, improve: improve, totals: totals, targets: targets };
  }

  /* ---------------- 7-day history / averages ---------------- */

  function getLoggedDatesDescending() {
    return Object.keys(log)
      .filter(function (d) { return getAllEntries(d).length > 0 || log[d].water > 0; })
      .sort(function (a, b) { return new Date(b) - new Date(a); });
  }

  function getSevenDayAverages() {
    const core = window.JarvisCore;
    const today = new Date(core.todayISODate());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const tzOffset = d.getTimezoneOffset() * 60000;
      days.push(new Date(d.getTime() - tzOffset).toISOString().slice(0, 10));
    }
    const loggedDays = days.filter(function (d) { return getAllEntries(d).length > 0; });
    if (loggedDays.length === 0) return null;
    const sums = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, water: 0, score: 0 };
    loggedDays.forEach(function (d) {
      const t = getDayTotals(d);
      sums.calories += t.calories; sums.protein += t.protein; sums.carbs += t.carbs;
      sums.fat += t.fat; sums.fiber += t.fiber; sums.water += t.water;
      sums.score += computeScore(d).score;
    });
    const n = loggedDays.length;
    return {
      days: n,
      calories: Math.round(sums.calories / n), protein: Math.round(sums.protein / n),
      carbs: Math.round(sums.carbs / n), fat: Math.round(sums.fat / n),
      fiber: Math.round(sums.fiber / n), water: Math.round(sums.water / n),
      score: Math.round(sums.score / n)
    };
  }

  /* ---------------- shared render helpers ---------------- */

  function $(id) { return document.getElementById(id); }

  function barHtml(label, consumed, target, unit) {
    const core = window.JarvisCore;
    const hasTarget = target > 0;
    const pct = hasTarget ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
    const overCls = hasTarget && consumed > target ? " over" : "";
    const targetText = hasTarget ? (Math.round(consumed) + " / " + Math.round(target) + (unit || "")) : (Math.round(consumed) + (unit || "") + " (no target set)");
    return (
      '<div class="nutri-bar-row">' +
        '<div class="nutri-bar-label"><span>' + core.escapeHtml(label) + '</span><span class="nutri-bar-value">' + targetText + '</span></div>' +
        '<div class="nutri-bar-track"><div class="nutri-bar-fill' + overCls + '" style="width:' + (hasTarget ? pct : Math.min(100, consumed > 0 ? 100 : 0)) + '%"></div></div>' +
      '</div>'
    );
  }

  /* ---------------- Dashboard ---------------- */

  function renderDashboard() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const totals = getDayTotals(today);
    const targets = getActiveTargets();

    $("nutritionModeLabel").textContent = getMode() === "bulking" ? "Bulking" : "Cutting";
    $("nutritionCalorieTarget").textContent = targets.calories > 0 ? Math.round(targets.calories) : "Not set";
    $("nutritionCalorieConsumed").textContent = Math.round(totals.calories);
    const remaining = targets.calories - totals.calories;
    const remainingEl = $("nutritionCalorieRemaining");
    remainingEl.textContent = targets.calories > 0 ? Math.round(remaining) : "—";
    remainingEl.className = "stat-value " + (targets.calories > 0 ? (remaining >= 0 ? "positive" : "negative") : "");

    $("nutritionMacroBars").innerHTML =
      barHtml("Protein", totals.protein, targets.protein, "g") +
      barHtml("Carbohydrates", totals.carbs, targets.carbs, "g") +
      barHtml("Fat", totals.fat, targets.fat, "g") +
      barHtml("Fiber", totals.fiber, targets.fiber, "g");

    $("nutritionWaterBar").innerHTML = barHtml("Water", totals.water, targets.water, " cups");
    $("nutritionWaterCount").textContent = totals.water;

    const scoreResult = computeScore(today);
    $("nutritionScoreValue").textContent = scoreResult.score;
    $("nutritionScoreGood").innerHTML = scoreResult.good.length
      ? scoreResult.good.map(function (g) { return "<li>" + core.escapeHtml(g) + "</li>"; }).join("")
      : "<li>Log some food to see what's going well.</li>";
    $("nutritionScoreImprove").innerHTML = scoreResult.improve.length
      ? scoreResult.improve.map(function (g) { return "<li>" + core.escapeHtml(g) + "</li>"; }).join("")
      : "<li>Nothing stands out — nice work today.</li>";
  }

  function handleWaterAdjust(delta) {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const day = getDay(today);
    day.water = Math.max(0, day.water + delta);
    saveLog();
    renderDashboard();
    if ($("historySelectedDate") && historySelectedDate === today) renderHistoryDetail();
  }

  /* ---------------- Goals (Cutting / Bulking) ---------------- */

  function renderGoals() {
    const mode = getMode();
    $("goalsModeCuttingBtn").classList.toggle("active", mode === "cutting");
    $("goalsModeBulkingBtn").classList.toggle("active", mode === "bulking");
    const t = goals[mode];
    $("goalsCalories").value = t.calories || "";
    $("goalsProtein").value = t.protein || "";
    $("goalsCarbs").value = t.carbs || "";
    $("goalsFat").value = t.fat || "";
    $("goalsFiber").value = t.fiber || "";
    $("goalsWater").value = t.water || "";

    const today = window.JarvisCore.todayISODate();
    const totals = getDayTotals(today);
    $("goalsProgressBars").innerHTML =
      barHtml("Calories", totals.calories, t.calories, "") +
      barHtml("Protein", totals.protein, t.protein, "g") +
      barHtml("Carbohydrates", totals.carbs, t.carbs, "g") +
      barHtml("Fat", totals.fat, t.fat, "g") +
      barHtml("Fiber", totals.fiber, t.fiber, "g") +
      barHtml("Water", totals.water, t.water, " cups");
  }

  function handleModeSwitch(mode) {
    goals.mode = mode;
    saveGoals();
    renderGoals();
    renderDashboard();
  }

  function handleGoalsFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const mode = getMode();
    const next = {
      calories: Number($("goalsCalories").value) || 0,
      protein: Number($("goalsProtein").value) || 0,
      carbs: Number($("goalsCarbs").value) || 0,
      fat: Number($("goalsFat").value) || 0,
      fiber: Number($("goalsFiber").value) || 0,
      water: Number($("goalsWater").value) || 0
    };
    if (Object.keys(next).some(function (k) { return !isNonNegativeNumber(next[k]); })) {
      core.showToast("Targets must be zero or a positive number.");
      return;
    }
    goals[mode] = next;
    saveGoals();
    renderGoals();
    renderDashboard();
    core.showToast((mode === "bulking" ? "Bulking" : "Cutting") + " targets saved.");
  }

  /* ---------------- Food log ---------------- */

  function renderFoodForm() {
    $("foodFormMealSelect").value = foodFormMeal;
    $("foodFormTitle").textContent = foodFormEditId ? "Edit Food" : "Add Food";
    $("foodFormSubmitBtn").textContent = foodFormEditId ? "Save Changes" : "Add to Log";
    $("foodFormCancelBtn").classList.toggle("hidden", !foodFormEditId);
  }

  function resetFoodForm() {
    foodFormEditId = null;
    ["foodName", "foodServing", "foodCalories", "foodProtein", "foodCarbs", "foodFat", "foodFiber",
      "foodSodium", "foodCalcium", "foodIron", "foodPotassium", "foodVitaminC", "foodVitaminD"].forEach(function (id) {
      const el = $(id); if (el) el.value = "";
    });
    $("foodIsFruitVeg").checked = false;
    renderFoodForm();
  }

  function handleFoodFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("foodName").value.trim();
    const calories = $("foodCalories").value;
    if (!name) { core.showToast("Give the food a name."); return; }
    if (!isNonNegativeNumber(calories)) { core.showToast("Calories must be zero or a positive number."); return; }

    const raw = {
      name: name,
      serving: $("foodServing").value.trim(),
      calories: calories, protein: $("foodProtein").value, carbs: $("foodCarbs").value,
      fat: $("foodFat").value, fiber: $("foodFiber").value,
      sodium: $("foodSodium").value, calcium: $("foodCalcium").value, iron: $("foodIron").value,
      potassium: $("foodPotassium").value, vitaminC: $("foodVitaminC").value, vitaminD: $("foodVitaminD").value,
      isFruitVeg: $("foodIsFruitVeg").checked
    };

    const today = core.todayISODate();
    const day = getDay(today);
    const meal = $("foodFormMealSelect").value;

    if (foodFormEditId) {
      const oldMeal = foodFormEditId.meal;
      const idx = day.meals[oldMeal].findIndex(function (it) { return it.id === foodFormEditId.id; });
      if (idx !== -1) {
        raw.id = foodFormEditId.id;
        raw.createdAt = day.meals[oldMeal][idx].createdAt;
        const item = sanitizeFoodItem(raw);
        day.meals[oldMeal].splice(idx, 1);
        day.meals[meal].push(item);
      }
    } else {
      day.meals[meal].push(sanitizeFoodItem(raw));
    }
    saveLog();
    resetFoodForm();
    renderFoodLog();
    renderDashboard();
    core.showToast("Food saved.");
  }

  function handleFoodFormCancel() { resetFoodForm(); }

  function foodItemRowHtml(item, meal) {
    const core = window.JarvisCore;
    const fvTag = item.isFruitVeg ? ' <span class="badge badge-green">fruit/veg</span>' : "";
    return (
      '<div class="list-item" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">' +
        '<div class="list-item-row">' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(item.name) + fvTag + '</span>' +
            '<span class="list-item-meta">' + core.escapeHtml(item.serving || "1 serving") + ' &middot; ' + Math.round(item.calories) + ' cal &middot; P ' + item.protein + 'g &middot; C ' + item.carbs + 'g &middot; F ' + item.fat + 'g &middot; Fiber ' + item.fiber + 'g</span>' +
          '</div>' +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn-icon food-edit-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger food-delete-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderFoodLog() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const day = getDay(today);
    MEALS.forEach(function (meal) {
      const container = $("foodMeal_" + meal);
      if (!container) return;
      const items = day.meals[meal];
      container.innerHTML = items.length
        ? items.map(function (item) { return foodItemRowHtml(item, meal); }).join("")
        : '<div class="empty-state">No ' + MEAL_LABELS[meal].toLowerCase() + ' logged yet.</div>';
    });
    const totals = getDayTotals(today);
    $("foodLogTotals").textContent =
      Math.round(totals.calories) + " cal · P " + Math.round(totals.protein) + "g · C " + Math.round(totals.carbs) +
      "g · F " + Math.round(totals.fat) + "g · Fiber " + Math.round(totals.fiber) + "g logged today";
  }

  function handleFoodLogClick(e) {
    const editBtn = e.target.closest(".food-edit-btn");
    if (editBtn) {
      const meal = editBtn.getAttribute("data-meal");
      const id = editBtn.getAttribute("data-id");
      const item = getDay(window.JarvisCore.todayISODate()).meals[meal].find(function (it) { return it.id === id; });
      if (!item) return;
      foodFormEditId = { meal: meal, id: id };
      $("foodFormMealSelect").value = meal;
      $("foodName").value = item.name;
      $("foodServing").value = item.serving;
      MACRO_FIELDS.forEach(function (f) { $("food" + f.charAt(0).toUpperCase() + f.slice(1)).value = item[f]; });
      MICRO_FIELDS.forEach(function (f) {
        const el = $("food" + f.charAt(0).toUpperCase() + f.slice(1));
        if (el) el.value = item[f] !== undefined ? item[f] : "";
      });
      $("foodIsFruitVeg").checked = !!item.isFruitVeg;
      renderFoodForm();
      $("foodName").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const delBtn = e.target.closest(".food-delete-btn");
    if (delBtn) {
      const meal = delBtn.getAttribute("data-meal");
      const id = delBtn.getAttribute("data-id");
      const day = getDay(window.JarvisCore.todayISODate());
      day.meals[meal] = day.meals[meal].filter(function (it) { return it.id !== id; });
      saveLog();
      renderFoodLog();
      renderDashboard();
      window.JarvisCore.showToast("Food removed.");
    }
  }

  /* ---------------- Saved Foods ---------------- */

  function renderSavedFoodForm() {
    $("savedFoodFormTitle").textContent = window._savedFoodEditId ? "Edit Saved Food" : "Add Saved Food";
    $("savedFoodSubmitBtn").textContent = window._savedFoodEditId ? "Save Changes" : "Save Food";
    $("savedFoodCancelBtn").classList.toggle("hidden", !window._savedFoodEditId);
  }

  function resetSavedFoodForm() {
    window._savedFoodEditId = null;
    ["savedFoodName", "savedFoodServing", "savedFoodCalories", "savedFoodProtein", "savedFoodCarbs", "savedFoodFat", "savedFoodFiber"].forEach(function (id) {
      const el = $(id); if (el) el.value = "";
    });
    renderSavedFoodForm();
  }

  function handleSavedFoodFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("savedFoodName").value.trim();
    if (!name) { core.showToast("Give the saved food a name."); return; }
    if (!isNonNegativeNumber($("savedFoodCalories").value)) { core.showToast("Calories must be zero or a positive number."); return; }
    const raw = {
      name: name, serving: $("savedFoodServing").value.trim(),
      calories: $("savedFoodCalories").value, protein: $("savedFoodProtein").value,
      carbs: $("savedFoodCarbs").value, fat: $("savedFoodFat").value, fiber: $("savedFoodFiber").value
    };
    if (window._savedFoodEditId) {
      const idx = savedFoods.findIndex(function (f) { return f.id === window._savedFoodEditId; });
      if (idx !== -1) { raw.id = window._savedFoodEditId; savedFoods[idx] = sanitizeFoodItem(raw); }
    } else {
      savedFoods.push(sanitizeFoodItem(raw));
    }
    saveSavedFoods();
    resetSavedFoodForm();
    renderSavedFoods();
    core.showToast("Saved food updated.");
  }

  function renderSavedFoods() {
    const core = window.JarvisCore;
    const container = $("savedFoodsList");
    if (savedFoods.length === 0) {
      container.innerHTML = '<div class="empty-state">No saved foods yet. Add one above.</div>';
      return;
    }
    container.innerHTML = savedFoods.map(function (f) {
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(f.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(f.name) + '</span>' +
              '<span class="list-item-meta">' + core.escapeHtml(f.serving || "1 serving") + ' &middot; ' + Math.round(f.calories) + ' cal &middot; P ' + f.protein + 'g &middot; C ' + f.carbs + 'g &middot; F ' + f.fat + 'g</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<select class="saved-food-meal-select" data-id="' + core.escapeHtml(f.id) + '">' +
                MEALS.map(function (m) { return '<option value="' + m + '">' + MEAL_LABELS[m] + '</option>'; }).join("") +
              '</select>' +
              '<button type="button" class="btn-icon saved-food-add-btn" data-id="' + core.escapeHtml(f.id) + '">+ Add to Today</button>' +
              '<button type="button" class="btn-icon saved-food-edit-btn" data-id="' + core.escapeHtml(f.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger saved-food-delete-btn" data-id="' + core.escapeHtml(f.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleSavedFoodsClick(e) {
    const addBtn = e.target.closest(".saved-food-add-btn");
    if (addBtn) {
      const id = addBtn.getAttribute("data-id");
      const food = savedFoods.find(function (f) { return f.id === id; });
      if (!food) return;
      const row = addBtn.closest(".list-item");
      const meal = row.querySelector(".saved-food-meal-select").value;
      const today = window.JarvisCore.todayISODate();
      const day = getDay(today);
      const copy = Object.assign({}, food, { id: window.JarvisCore.uid("food"), createdAt: Date.now() });
      day.meals[meal].push(sanitizeFoodItem(copy));
      saveLog();
      renderFoodLog();
      renderDashboard();
      window.JarvisCore.showToast('Added "' + food.name + '" to ' + MEAL_LABELS[meal] + ".");
      return;
    }
    const editBtn = e.target.closest(".saved-food-edit-btn");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      const food = savedFoods.find(function (f) { return f.id === id; });
      if (!food) return;
      window._savedFoodEditId = id;
      $("savedFoodName").value = food.name;
      $("savedFoodServing").value = food.serving;
      MACRO_FIELDS.forEach(function (f2) { $("savedFood" + f2.charAt(0).toUpperCase() + f2.slice(1)).value = food[f2]; });
      renderSavedFoodForm();
      $("savedFoodName").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const delBtn = e.target.closest(".saved-food-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      savedFoods = savedFoods.filter(function (f) { return f.id !== id; });
      saveSavedFoods();
      renderSavedFoods();
      window.JarvisCore.showToast("Saved food deleted.");
    }
  }

  /* ---------------- Recipes ---------------- */

  function computeRecipeTotals(ingredients) {
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    let anyData = false;
    ingredients.forEach(function (ing) {
      MACRO_FIELDS.forEach(function (f) {
        const v = Number(ing[f]);
        if (isFinite(v) && v > 0) { totals[f] += v; anyData = true; }
      });
    });
    return { totals: totals, anyData: anyData };
  }

  function renderIngredientRows() {
    const container = $("recipeIngredientRows");
    container.innerHTML = recipeBuilder.ingredients.map(function (ing, i) {
      const aiTag = ing.aiEstimated ? ' <span class="badge badge-yellow">AI estimated</span>' : "";
      return (
        '<div class="form-row recipe-ingredient-row" data-index="' + i + '" style="display:grid;grid-template-columns:1.6fr 1fr repeat(5,1fr) auto;gap:6px;align-items:end;">' +
          '<div><label>Ingredient' + aiTag + '</label><input type="text" class="ri-name" data-index="' + i + '" value="' + window.JarvisCore.escapeHtml(ing.name) + '" placeholder="e.g. Chicken breast"></div>' +
          '<div><label>Quantity</label><input type="text" class="ri-quantity" data-index="' + i + '" value="' + window.JarvisCore.escapeHtml(ing.quantity) + '" placeholder="e.g. 6 oz"></div>' +
          '<div><label>Cal</label><input type="number" min="0" class="ri-calories" data-index="' + i + '" value="' + window.JarvisCore.escapeHtml(ing.calories) + '"></div>' +
          '<div><label>Protein</label><input type="number" min="0" class="ri-protein" data-index="' + i + '" value="' + window.JarvisCore.escapeHtml(ing.protein) + '"></div>' +
          '<div><label>Carbs</label><input type="number" min="0" class="ri-carbs" data-index="' + i + '" value="' + window.JarvisCore.escapeHtml(ing.carbs) + '"></div>' +
          '<div><label>Fat</label><input type="number" min="0" class="ri-fat" data-index="' + i + '" value="' + window.JarvisCore.escapeHtml(ing.fat) + '"></div>' +
          '<div><label>Fiber</label><input type="number" min="0" class="ri-fiber" data-index="' + i + '" value="' + window.JarvisCore.escapeHtml(ing.fiber) + '"></div>' +
          '<button type="button" class="btn-icon danger ri-remove-btn" data-index="' + i + '" aria-label="Remove ingredient">&times;</button>' +
        '</div>'
      );
    }).join("");
  }

  function handleAddIngredientRow() {
    recipeBuilder.ingredients.push({ name: "", quantity: "", calories: "", protein: "", carbs: "", fat: "", fiber: "" });
    renderIngredientRows();
  }

  function handleIngredientRowsInput(e) {
    const input = e.target.closest("input");
    if (!input) return;
    const i = Number(input.getAttribute("data-index"));
    if (!recipeBuilder.ingredients[i]) return;
    // Any manual edit means the value is no longer purely an AI guess.
    recipeBuilder.ingredients[i].aiEstimated = false;
    if (input.classList.contains("ri-name")) recipeBuilder.ingredients[i].name = input.value;
    else if (input.classList.contains("ri-quantity")) recipeBuilder.ingredients[i].quantity = input.value;
    else if (input.classList.contains("ri-calories")) recipeBuilder.ingredients[i].calories = input.value;
    else if (input.classList.contains("ri-protein")) recipeBuilder.ingredients[i].protein = input.value;
    else if (input.classList.contains("ri-carbs")) recipeBuilder.ingredients[i].carbs = input.value;
    else if (input.classList.contains("ri-fat")) recipeBuilder.ingredients[i].fat = input.value;
    else if (input.classList.contains("ri-fiber")) recipeBuilder.ingredients[i].fiber = input.value;
  }

  function handleIngredientRowsClick(e) {
    const btn = e.target.closest(".ri-remove-btn");
    if (!btn) return;
    const i = Number(btn.getAttribute("data-index"));
    if (recipeBuilder.ingredients.length <= 1) { window.JarvisCore.showToast("A recipe needs at least one ingredient row."); return; }
    recipeBuilder.ingredients.splice(i, 1);
    renderIngredientRows();
  }

  function setRecipeAiStatus(text, isError) {
    const el = $("recipeAiStatus");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("text-negative", !!isError);
  }

  // Strips a ```json fenced block, if present, since models frequently wrap
  // JSON in markdown even when told not to — then parses what's left.
  function parseJsonLoosely(text) {
    let cleaned = String(text || "").trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    return JSON.parse(cleaned);
  }

  // Sends every ingredient's name + quantity to the user's own configured
  // "nutrition" AI connection (Bring-Your-Own — see AI Video > Connections)
  // and asks it to estimate calories/protein/carbs/fat/fiber for each one,
  // instead of the user looking each one up and doing the math by hand.
  // These are AI estimates, not verified nutrition facts — every filled-in
  // field stays a normal, editable number the user can correct.
  function handleCalculateNutritionWithAI() {
    const core = window.JarvisCore;
    if (!window.JarvisVideoConnections || !window.JarvisVideoApi) {
      setRecipeAiStatus("AI connections aren't available right now.", true);
      return;
    }
    const named = recipeBuilder.ingredients.filter(function (ing) { return ing.name.trim(); });
    if (named.length === 0) {
      core.showToast("Add at least one ingredient name first.");
      return;
    }
    const connection = window.JarvisVideoConnections.getByKind("nutrition")[0];
    if (!connection || !connection.endpointUrl) {
      setRecipeAiStatus("No AI connection set up yet for nutrient calculation.", true);
      return;
    }

    const ingredientsText = named.map(function (ing) {
      return "- " + ing.name.trim() + (ing.quantity && ing.quantity.trim() ? " — " + ing.quantity.trim() : " — quantity not specified, assume a typical serving");
    }).join("\n");

    setRecipeAiStatus("Asking AI to estimate nutrition for " + named.length + " ingredient" + (named.length === 1 ? "" : "s") + "…");
    const btn = $("recipeAiCalculateBtn");
    if (btn) btn.disabled = true;

    let jsonBody;
    try {
      jsonBody = window.JarvisVideoApi.fillJsonTemplate(connection.bodyTemplate, { ingredientsText: ingredientsText });
    } catch (err) {
      setRecipeAiStatus("Couldn't build the request from this connection's template.", true);
      if (btn) btn.disabled = false;
      return;
    }

    window.JarvisVideoApi.postRequest(connection, jsonBody, false).then(function (result) {
      if (btn) btn.disabled = false;
      if (!result.ok) {
        setRecipeAiStatus("Request failed: " + (result.errorMessage || "unknown error"), true);
        return;
      }
      let responseJson;
      try { responseJson = JSON.parse(result.bodyText); } catch (e) {
        setRecipeAiStatus("The connection's response wasn't valid JSON.", true);
        return;
      }
      const extracted = window.JarvisVideoApi.resolveJsonPath(responseJson, connection.responsePath);
      if (extracted === undefined) {
        setRecipeAiStatus("Couldn't find the model's reply at that response path — check the connection's \"Result field\" setting.", true);
        return;
      }
      let estimates;
      try {
        estimates = typeof extracted === "string" ? parseJsonLoosely(extracted) : extracted;
      } catch (e) {
        setRecipeAiStatus("The model's reply wasn't a parseable JSON array — see the connection's placeholder hint for the exact shape it needs to reply with.", true);
        return;
      }
      if (!Array.isArray(estimates)) {
        setRecipeAiStatus("The model's reply wasn't a JSON array of ingredients.", true);
        return;
      }

      let filled = 0;
      named.forEach(function (ing, i) {
        const est = estimates[i];
        if (!est || typeof est !== "object") return;
        const originalIndex = recipeBuilder.ingredients.indexOf(ing);
        if (originalIndex === -1) return;
        MACRO_FIELDS.forEach(function (f) {
          if (isNonNegativeNumber(est[f])) recipeBuilder.ingredients[originalIndex][f] = Number(est[f]);
        });
        recipeBuilder.ingredients[originalIndex].aiEstimated = true;
        filled++;
      });
      renderIngredientRows();
      if (filled === 0) {
        setRecipeAiStatus("The model replied, but none of the estimates matched up with the ingredient list.", true);
      } else if (filled < named.length) {
        setRecipeAiStatus("Filled in " + filled + " of " + named.length + " ingredients — the model's reply had a different count than expected. Review the rest manually.", true);
      } else {
        setRecipeAiStatus("Filled in " + filled + " ingredient" + (filled === 1 ? "" : "s") + " with AI estimates — these are estimates, not verified nutrition facts, so double-check anything that matters.");
      }
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      setRecipeAiStatus("Something went wrong: " + (err && err.message ? err.message : String(err)), true);
    });
  }

  function handleGoToAiConnections() {
    const videoNavBtn = document.getElementById("navBtnVideo");
    const connectionsTabBtn = document.querySelector('.video-sub-nav-btn[data-subtarget="video-connections"]');
    if (videoNavBtn) videoNavBtn.click();
    if (connectionsTabBtn) connectionsTabBtn.click();
  }

  function resetRecipeForm() {
    recipeBuilder = { editId: null, ingredients: [{ name: "", quantity: "", calories: "", protein: "", carbs: "", fat: "", fiber: "" }] };
    $("recipeName").value = "";
    $("recipeInstructions").value = "";
    $("recipeServings").value = "1";
    $("recipeFormTitle").textContent = "Create a Recipe";
    $("recipeSubmitBtn").textContent = "Save Recipe";
    $("recipeCancelBtn").classList.add("hidden");
    setRecipeAiStatus("");
    renderIngredientRows();
  }

  function handleRecipeFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("recipeName").value.trim();
    const servings = Number($("recipeServings").value);
    if (!name) { core.showToast("Give the recipe a name."); return; }
    if (!core.isPositiveNumber(servings)) { core.showToast("Servings must be a positive number."); return; }
    const cleanIngredients = recipeBuilder.ingredients
      .filter(function (ing) { return ing.name.trim(); })
      .map(function (ing) {
        return {
          name: ing.name.trim(), quantity: (ing.quantity || "").trim(),
          calories: Number(ing.calories) || 0, protein: Number(ing.protein) || 0,
          carbs: Number(ing.carbs) || 0, fat: Number(ing.fat) || 0, fiber: Number(ing.fiber) || 0
        };
      });
    if (cleanIngredients.length === 0) { core.showToast("Add at least one ingredient."); return; }

    const recipe = {
      id: recipeBuilder.editId || core.uid("recipe"),
      name: name, instructions: $("recipeInstructions").value.trim(),
      servings: Math.round(servings), ingredients: cleanIngredients,
      createdAt: recipeBuilder.editId ? (recipes.find(function (r) { return r.id === recipeBuilder.editId; }) || {}).createdAt || Date.now() : Date.now()
    };
    if (recipeBuilder.editId) {
      const idx = recipes.findIndex(function (r) { return r.id === recipeBuilder.editId; });
      if (idx !== -1) recipes[idx] = recipe;
    } else {
      recipes.push(recipe);
    }
    saveRecipes();
    resetRecipeForm();
    renderRecipes();
    core.showToast("Recipe saved.");
  }

  function renderRecipes() {
    const core = window.JarvisCore;
    const container = $("recipesList");
    if (recipes.length === 0) {
      container.innerHTML = '<div class="empty-state">No recipes yet. Build one above.</div>';
      return;
    }
    container.innerHTML = recipes.map(function (r) {
      const result = computeRecipeTotals(r.ingredients);
      const per = {};
      MACRO_FIELDS.forEach(function (f) { per[f] = result.totals[f] / r.servings; });
      const incompleteNote = result.anyData ? "" : '<p class="field-hint text-negative">No ingredient nutrition info entered yet — macros show as 0 until you add some.</p>';
      return (
        '<div class="list-item" data-id="' + core.escapeHtml(r.id) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(r.name) + ' <span class="badge badge-neutral">' + r.servings + ' serving' + (r.servings === 1 ? "" : "s") + '</span></span>' +
              '<span class="list-item-meta">Per serving: ' + Math.round(per.calories) + ' cal &middot; P ' + Math.round(per.protein) + 'g &middot; C ' + Math.round(per.carbs) + 'g &middot; F ' + Math.round(per.fat) + 'g &middot; Fiber ' + Math.round(per.fiber) + 'g</span>' +
              incompleteNote +
              '<span class="list-item-meta">Ingredients: ' + r.ingredients.map(function (i) { return core.escapeHtml(i.name); }).join(", ") + '</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<select class="recipe-meal-select" data-id="' + core.escapeHtml(r.id) + '">' +
                MEALS.map(function (m) { return '<option value="' + m + '">' + MEAL_LABELS[m] + '</option>'; }).join("") +
              '</select>' +
              '<button type="button" class="btn-icon recipe-add-serving-btn" data-id="' + core.escapeHtml(r.id) + '">+ Add 1 Serving</button>' +
              '<button type="button" class="btn-icon recipe-edit-btn" data-id="' + core.escapeHtml(r.id) + '">Edit</button>' +
              '<button type="button" class="btn-icon danger recipe-delete-btn" data-id="' + core.escapeHtml(r.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function handleRecipesListClick(e) {
    const addBtn = e.target.closest(".recipe-add-serving-btn");
    if (addBtn) {
      const id = addBtn.getAttribute("data-id");
      const recipe = recipes.find(function (r) { return r.id === id; });
      if (!recipe) return;
      const row = addBtn.closest(".list-item");
      const meal = row.querySelector(".recipe-meal-select").value;
      const result = computeRecipeTotals(recipe.ingredients);
      const per = {};
      MACRO_FIELDS.forEach(function (f) { per[f] = result.totals[f] / recipe.servings; });
      const today = window.JarvisCore.todayISODate();
      const day = getDay(today);
      day.meals[meal].push(sanitizeFoodItem({
        name: recipe.name + " (1 serving)", serving: "1 serving",
        calories: per.calories, protein: per.protein, carbs: per.carbs, fat: per.fat, fiber: per.fiber
      }));
      saveLog();
      renderFoodLog();
      renderDashboard();
      window.JarvisCore.showToast('Added 1 serving of "' + recipe.name + '" to ' + MEAL_LABELS[meal] + ".");
      return;
    }
    const editBtn = e.target.closest(".recipe-edit-btn");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      const recipe = recipes.find(function (r) { return r.id === id; });
      if (!recipe) return;
      recipeBuilder = { editId: id, ingredients: recipe.ingredients.map(function (i) { return Object.assign({}, i); }) };
      $("recipeName").value = recipe.name;
      $("recipeInstructions").value = recipe.instructions;
      $("recipeServings").value = recipe.servings;
      $("recipeFormTitle").textContent = "Edit Recipe";
      $("recipeSubmitBtn").textContent = "Save Changes";
      $("recipeCancelBtn").classList.remove("hidden");
      renderIngredientRows();
      $("recipeName").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const delBtn = e.target.closest(".recipe-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      recipes = recipes.filter(function (r) { return r.id !== id; });
      saveRecipes();
      renderRecipes();
      window.JarvisCore.showToast("Recipe deleted.");
    }
  }

  /* ---------------- Nutrients tab ---------------- */

  function renderNutrients() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const totals = getDayTotals(today);
    $("nutrientsList").innerHTML = MICRO_FIELDS.map(function (f) {
      const unit = MICRO_UNITS[f];
      const ref = MICRO_REFERENCE[f];
      if (!totals[f + "Coverage"]) {
        return (
          '<div class="list-item"><div class="list-item-row"><div class="list-item-main">' +
            '<span class="list-item-title">' + MICRO_LABELS[f] + '</span>' +
            '<span class="list-item-meta">Not logged today — add it on a food entry to track it.</span>' +
          '</div></div></div>'
        );
      }
      const pct = Math.round((totals[f] / ref) * 100);
      return (
        '<div class="list-item"><div class="list-item-row"><div class="list-item-main">' +
          '<span class="list-item-title">' + MICRO_LABELS[f] + '</span>' +
          '<span class="list-item-meta">' + Math.round(totals[f] * 10) / 10 + unit + ' logged today &middot; ' + pct + '% of the general reference (' + ref + unit + ')</span>' +
        '</div></div></div>'
      );
    }).join("") + barHtml("Fiber", totals.fiber, getActiveTargets().fiber, "g");
  }

  /* ---------------- History ---------------- */

  function renderHistoryList() {
    const core = window.JarvisCore;
    const dates = getLoggedDatesDescending();
    const container = $("historyDateList");
    if (dates.length === 0) {
      container.innerHTML = '<div class="empty-state">No days logged yet.</div>';
    } else {
      container.innerHTML = dates.map(function (d) {
        const activeCls = d === historySelectedDate ? " active" : "";
        return '<button type="button" class="btn-icon history-date-btn' + activeCls + '" data-date="' + d + '">' + core.formatDate(d) + '</button>';
      }).join("");
    }

    const avg = getSevenDayAverages();
    $("historyAverages").innerHTML = avg
      ? ('<p class="field-hint">Average over the ' + avg.days + ' day' + (avg.days === 1 ? "" : "s") + ' you logged in the past week:</p>' +
         '<div class="stat-grid">' +
           '<div class="stat-box"><span class="stat-value">' + avg.calories + '</span><span class="stat-label">Calories</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.protein + 'g</span><span class="stat-label">Protein</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.carbs + 'g</span><span class="stat-label">Carbs</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.fat + 'g</span><span class="stat-label">Fat</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.fiber + 'g</span><span class="stat-label">Fiber</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.score + '</span><span class="stat-label">Nutrition score</span></div>' +
         '</div>')
      : '<p class="field-hint">Log a few days to see 7-day averages here.</p>';

    renderHistoryDetail();
  }

  function renderHistoryDetail() {
    const core = window.JarvisCore;
    const container = $("historyDetail");
    if (!historySelectedDate) {
      container.innerHTML = '<div class="empty-state">Pick a day above to see its details.</div>';
      return;
    }
    const totals = getDayTotals(historySelectedDate);
    const scoreResult = computeScore(historySelectedDate);
    const entries = getAllEntries(historySelectedDate);
    container.innerHTML =
      '<h3 class="checklist-title">' + core.formatDate(historySelectedDate) + ' &middot; Score: ' + scoreResult.score + '/100</h3>' +
      '<div class="stat-grid">' +
        '<div class="stat-box"><span class="stat-value">' + Math.round(totals.calories) + '</span><span class="stat-label">Calories</span></div>' +
        '<div class="stat-box"><span class="stat-value">' + Math.round(totals.protein) + 'g</span><span class="stat-label">Protein</span></div>' +
        '<div class="stat-box"><span class="stat-value">' + Math.round(totals.carbs) + 'g</span><span class="stat-label">Carbs</span></div>' +
        '<div class="stat-box"><span class="stat-value">' + Math.round(totals.fat) + 'g</span><span class="stat-label">Fat</span></div>' +
        '<div class="stat-box"><span class="stat-value">' + Math.round(totals.fiber) + 'g</span><span class="stat-label">Fiber</span></div>' +
        '<div class="stat-box"><span class="stat-value">' + totals.water + '</span><span class="stat-label">Water</span></div>' +
      '</div>' +
      '<h3 class="checklist-title" style="margin-top:12px;">Foods eaten</h3>' +
      (entries.length
        ? '<div class="item-list">' + MEALS.map(function (m) {
            const items = peekDay(historySelectedDate).meals[m];
            if (items.length === 0) return "";
            return '<div class="list-item"><div class="list-item-main"><span class="list-item-title">' + MEAL_LABELS[m] + '</span><span class="list-item-meta">' +
              items.map(function (it) { return core.escapeHtml(it.name) + " (" + Math.round(it.calories) + " cal)"; }).join(", ") +
              '</span></div></div>';
          }).join("") + '</div>'
        : '<div class="empty-state">No foods logged that day.</div>');
  }

  function handleHistoryDateListClick(e) {
    const btn = e.target.closest(".history-date-btn");
    if (!btn) return;
    historySelectedDate = btn.getAttribute("data-date");
    renderHistoryList();
  }

  /* ---------------- boot ---------------- */

  function renderAll() {
    renderDashboard();
    renderGoals();
    renderFoodForm();
    renderFoodLog();
    renderSavedFoodForm();
    renderSavedFoods();
    renderIngredientRows();
    renderRecipes();
    renderNutrients();
    renderHistoryList();
  }

  function getSummary() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const totals = getDayTotals(today);
    const targets = getActiveTargets();
    return {
      mode: getMode(),
      goal: targets.calories,
      todayTotal: Math.round(totals.calories),
      remaining: targets.calories > 0 ? Math.round(targets.calories - totals.calories) : null,
      score: computeScore(today).score
    };
  }

  // Food can be added/edited/removed from several different tabs (Food Log
  // directly, or "Add to Today" from Saved Foods/Recipes) — rather than
  // having every single mutation handler know about every other tab's
  // render function, each data-dependent tab just refreshes itself when the
  // user switches to it, so it's never showing stale numbers.
  function onSubTabChange(targetId) {
    if (targetId === "nutrition-dashboard") renderDashboard();
    if (targetId === "nutrition-goals") renderGoals();
    if (targetId === "nutrition-nutrients") renderNutrients();
    if (targetId === "nutrition-history") renderHistoryList();
  }

  function init() {
    load();

    $("goalsModeCuttingBtn").addEventListener("click", function () { handleModeSwitch("cutting"); });
    $("goalsModeBulkingBtn").addEventListener("click", function () { handleModeSwitch("bulking"); });
    $("goalsForm").addEventListener("submit", handleGoalsFormSubmit);

    $("nutritionWaterAddBtn").addEventListener("click", function () { handleWaterAdjust(1); });
    $("nutritionWaterRemoveBtn").addEventListener("click", function () { handleWaterAdjust(-1); });

    $("foodForm").addEventListener("submit", handleFoodFormSubmit);
    $("foodFormCancelBtn").addEventListener("click", handleFoodFormCancel);
    MEALS.forEach(function (meal) {
      const el = $("foodMeal_" + meal);
      if (el) el.addEventListener("click", handleFoodLogClick);
    });

    $("savedFoodForm").addEventListener("submit", handleSavedFoodFormSubmit);
    $("savedFoodCancelBtn").addEventListener("click", resetSavedFoodForm);
    $("savedFoodsList").addEventListener("click", handleSavedFoodsClick);

    $("recipeForm").addEventListener("submit", handleRecipeFormSubmit);
    $("recipeAddIngredientBtn").addEventListener("click", handleAddIngredientRow);
    $("recipeIngredientRows").addEventListener("input", handleIngredientRowsInput);
    $("recipeIngredientRows").addEventListener("click", handleIngredientRowsClick);
    $("recipeAiCalculateBtn").addEventListener("click", handleCalculateNutritionWithAI);
    $("recipeGoToAiConnectionsBtn").addEventListener("click", handleGoToAiConnections);
    $("recipeCancelBtn").addEventListener("click", resetRecipeForm);
    $("recipesList").addEventListener("click", handleRecipesListClick);

    $("historyDateList").addEventListener("click", handleHistoryDateListClick);

    resetFoodForm();
    resetSavedFoodForm();
    resetRecipeForm();
    renderAll();
  }

  window.JarvisNutrition = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
