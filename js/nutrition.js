/* ==========================================================================
   JARVIS — Nutrition tracker
   A separate main section from Workout. No built-in food database, barcode
   scanning, or automatic lookups. Every number in here either came from what
   the user typed in, or from a one-click AI estimate the user asked for and
   can see and edit afterward (Food Log, Saved Foods, and Recipe ingredients
   each offer an "Estimate with AI" / "Calculate Nutrition with AI" button
   that sends a name + serving to the user's own configured "nutrition" AI
   connection — see js/video-connections.js — and fills in the same editable
   fields manual entry would). Nothing is ever silently invented: AI fields
   are clearly labeled and the feature is fully opt-in per entry.

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
  const LS_PROFILE = "jarvisNutritionProfile";
  const LS_CHECKINS = "jarvisNutritionCheckins";

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
  let historyRangeDays = 7;
  let savedFoodSearch = "";
  let savedFoodSort = "name";
  let foodItemMenuOpenKey = null; // "<meal>:<id>" of the Today's Food item whose options menu is open
  let foodItemMoveSubmenuOpen = false;
  // "+ Add Food" bottom sheet: lets the user search Saved Foods, pick a
  // Recent Food, use the manual Create form, or log a Recipe, instead of
  // always typing every number by hand.
  let addFoodModalTab = "recent";
  let modalSavedFoodSearch = "";

  // AI Nutrition Goal Calculator: nutritionProfile is the last SAVED profile
  // (persists across reloads); calculatorResult/calculatorPendingProfile hold
  // a just-computed preview that hasn't been applied to goals[] yet, so
  // calculating never silently overwrites a previously saved target.
  let nutritionProfile = null;
  let checkins = [];
  let calculatorFormVisible = true;
  let calculatorResult = null;
  let calculatorPendingProfile = null;
  let pendingAdjustment = null; // { delta, reason } from the weekly check-in trend, awaiting explicit confirm

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

  // The label numbers kept with a food ({ serving, values }: a serving and the numbers for it), so the food can be
  // worked out again for another amount later. Anything that isn't a serving with numbers is dropped.
  //   size         the weight or volume of that serving, { value, unit: "g" | "ml" }, when the label gave one (or you confirmed it)
  //   perContainer how many servings the package holds, when the label said
  // The label is the baseline every amount is worked out from, so these are kept exactly as read.
  function sanitizeLabel(raw) { return window.JarvisFoodAmount.cleanLabel(raw); }

  // What a saved food (or a logged entry) remembers beyond its numbers. All optional, so foods saved before this are unchanged.
  //   favorite, lastUsedAt, useCount      for the library (favorites, recently used)
  //   lastPortion, portions, defaultPortionId   the amounts you use: the last one, named ones, and which is offered first
  //   source ("scan" | "manual"), needsCheck [fields]   where it came from, and numbers that were flagged and not confirmed
  //   foodId, amount   on a logged entry: the saved food it came from and the amount you had ({ value, unit })
  function sanitizeFoodExtras(raw, item) {
    const FA = window.JarvisFoodAmount;
    if (raw.favorite === true) item.favorite = true;
    if (typeof raw.lastUsedAt === "number" && isFinite(raw.lastUsedAt) && raw.lastUsedAt > 0) item.lastUsedAt = raw.lastUsedAt;
    if (typeof raw.useCount === "number" && isFinite(raw.useCount) && raw.useCount > 0) item.useCount = Math.floor(raw.useCount);
    if (typeof raw.updatedAt === "number" && isFinite(raw.updatedAt) && raw.updatedAt > 0) item.updatedAt = raw.updatedAt;
    if (raw.source === "scan" || raw.source === "manual") item.source = raw.source;
    if (typeof raw.foodId === "string" && raw.foodId) item.foodId = raw.foodId.slice(0, 60);
    if (Array.isArray(raw.needsCheck)) {
      const known = MACRO_FIELDS.concat(MICRO_FIELDS);
      const list = raw.needsCheck.filter(function (k, i, all) { return known.indexOf(k) !== -1 && all.indexOf(k) === i; });
      if (list.length) item.needsCheck = list;
    }
    if (FA) {
      const last = FA.cleanEntry(raw.lastPortion);
      if (last) item.lastPortion = last;
      const amount = FA.cleanEntry(raw.amount);
      if (amount) item.amount = amount;
      const portions = FA.cleanPortions(raw.portions);
      if (portions.length) {
        item.portions = portions;
        if (typeof raw.defaultPortionId === "string" && portions.some(function (p) { return p.id === raw.defaultPortionId; })) item.defaultPortionId = raw.defaultPortionId;
      }
    }
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
    const label = sanitizeLabel(raw.label);
    if (label) item.label = label;
    sanitizeFoodExtras(raw, item);
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

    loadNutritionProfile();
    const loadedCheckins = core.loadJSON(LS_CHECKINS, []);
    checkins = Array.isArray(loadedCheckins) ? loadedCheckins : [];
    calculatorFormVisible = !(nutritionProfile && nutritionProfile.lastResult);

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
  function nutritionChanged() { try { document.dispatchEvent(new CustomEvent("jarvis-nutrition-changed")); } catch (e) { /* nothing listens in an old browser */ } }
  function saveLog() { const ok = window.JarvisCore.saveJSON(LS_LOG, log); if (ok) nutritionChanged(); return ok; }
  function saveSavedFoods() { return window.JarvisCore.saveJSON(LS_SAVED, savedFoods); }
  function saveRecipes() { const ok = window.JarvisCore.saveJSON(LS_RECIPES, recipes); if (ok) nutritionChanged(); return ok; }

  // Persists the calculator's inputs plus its last computed result together,
  // so "Recalculate Goals" can re-open the form pre-filled, and the results
  // dashboard can be redrawn on load without recomputing anything.
  function saveNutritionProfile(profile, result) {
    nutritionProfile = Object.assign({}, profile, { lastResult: result, lastCalculatedAt: Date.now() });
    window.JarvisCore.saveJSON(LS_PROFILE, nutritionProfile);
  }
  function loadNutritionProfile() {
    const loaded = window.JarvisCore.loadJSON(LS_PROFILE, null);
    nutritionProfile = (loaded && typeof loaded === "object") ? loaded : null;
  }
  function saveCheckins() { window.JarvisCore.saveJSON(LS_CHECKINS, checkins); }

  /* ---------------- AI Nutrition Goal Calculator: pure calculation engine ----------------
     Deterministic and formula-based throughout — nothing here calls an AI. Every function
     is a plain, independently-testable calculation so the numbers stay auditable. */

  const ACTIVITY_MULTIPLIERS = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extreme: 1.9 };
  const CALC_MIN_CALORIE_FLOOR = 1200; // conservative absolute floor — not a clinical minimum, just a hard stop
  const CALC_SAFE_LOSS_RATE_KG_PER_WEEK = 0.5;  // ~1 lb/week, a widely-cited sustainable ceiling
  const CALC_SAFE_GAIN_RATE_KG_PER_WEEK = 0.25; // a modest lean-gain ceiling
  const CALC_GOAL_LABELS = { maintain: "Maintain", gain: "Muscle Gain", lose: "Weight Loss" };

  function calcClamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function feetInchesToCm(feet, inches) { return ((Number(feet) || 0) * 12 + (Number(inches) || 0)) * 2.54; }
  function cmToFeetInches(cm) {
    const totalIn = Number(cm) / 2.54;
    const feet = Math.floor(totalIn / 12);
    return { feet: feet, inches: Math.round(totalIn - feet * 12) };
  }
  function lbToKg(lb) { return Number(lb) * 0.453592; }
  function kgToLb(kg) { return Number(kg) / 0.453592; }

  function isRealisticAge(v) { const n = Number(v); return isFinite(n) && n >= 5 && n <= 100; }
  function isRealisticHeightCm(v) { const n = Number(v); return isFinite(n) && n >= 100 && n <= 250; }
  function isRealisticWeightKg(v) { const n = Number(v); return isFinite(n) && n >= 25 && n <= 300; }
  function isRealisticWeeks(v) { const n = Number(v); return isFinite(n) && n > 0 && n <= 104; }

  // Mifflin-St Jeor — the most broadly validated resting-energy equation for
  // general (non-clinical) use. "unspecified" sex averages the male/female
  // constants as a rough approximation, since the formula itself is binary.
  function calculateBMR(sex, weightKg, heightCm, age) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    if (sex === "male") return base + 5;
    if (sex === "female") return base - 161;
    return base - 78;
  }

  function calculateTDEE(bmr, activityLevel) {
    return bmr * (ACTIVITY_MULTIPLIERS[activityLevel] || ACTIVITY_MULTIPLIERS.sedentary);
  }

  // Age + timeline safety gate, run before any calorie target is finalized.
  // Minors never get a restrictive/surplus target — only a maintenance-style
  // estimate. Adults requesting an unsafe rate of change get the requested
  // timeline overridden by a conservative default deficit/surplus instead of
  // an aggressive one, plus a suggested, more gradual timeframe.
  function validateGoal(profile) {
    const result = { isMinor: profile.age < 18, blockedForMinor: false, timelineWarning: null, suggestedWeeks: null, effectiveGoal: profile.goal };
    if (result.isMinor) {
      if (profile.goal !== "maintain") { result.blockedForMinor = true; result.effectiveGoal = "maintain"; }
      return result;
    }
    if (profile.goal === "maintain") return result;

    const weightDeltaKg = profile.targetWeightKg - profile.weightKg;
    const wantsLoss = profile.goal === "lose";
    const directionMatches = wantsLoss ? weightDeltaKg < 0 : weightDeltaKg > 0;
    if (!directionMatches || !profile.timeframeWeeks) return result;

    const impliedWeeklyRateKg = Math.abs(weightDeltaKg) / profile.timeframeWeeks;
    const safeRate = wantsLoss ? CALC_SAFE_LOSS_RATE_KG_PER_WEEK : CALC_SAFE_GAIN_RATE_KG_PER_WEEK;
    if (impliedWeeklyRateKg > safeRate) {
      result.timelineWarning = "Your selected timeline may be too aggressive. JARVIS recommends using a more gradual approach.";
      result.suggestedWeeks = Math.ceil(Math.abs(weightDeltaKg) / safeRate);
    }
    return result;
  }

  // Protein: evidence-based g/kg range by goal + training load (higher on a
  // cut to help preserve muscle, lower for infrequent/non-resistance training).
  // Fat: kept within the commonly-cited 20-35% of calories dietary range, with
  // a per-kg floor for hormonal health. Carbs fill whatever calories remain.
  // Fiber: ~14g per 1000 kcal (a standard general guideline). Water: ~0.5 oz
  // per lb bodyweight plus a modest bump for average daily exercise time.
  function calculateMacros(calories, weightKg, goal, trainingType, workoutsPerWeek, workoutDurationMin) {
    let proteinPerKg = goal === "lose" ? 2.0 : goal === "gain" ? 1.8 : 1.6;
    if ((workoutsPerWeek || 0) < 2) proteinPerKg -= 0.3;
    if (trainingType === "cardio") proteinPerKg -= 0.2;
    else if (trainingType === "weighttraining") proteinPerKg += 0.1;
    proteinPerKg = calcClamp(proteinPerKg, 1.2, 2.2);
    let proteinG = proteinPerKg * weightKg;

    let fatG = Math.max((calories * 0.25) / 9, 0.5 * weightKg);
    let proteinCal = proteinG * 4;
    let fatCal = fatG * 9;

    // Guard rail for very low calorie targets on a heavy user: trim fat
    // first (down to its own floor), then protein, before ever letting
    // carbs go negative.
    if (proteinCal + fatCal > calories * 0.9) {
      const overage = (proteinCal + fatCal) - calories * 0.9;
      fatCal = Math.max(fatCal - overage, 0.3 * weightKg * 9);
      fatG = fatCal / 9;
      proteinCal = proteinG * 4;
      if (proteinCal + fatCal > calories * 0.9) {
        proteinG = Math.max((calories * 0.9 - fatCal) / 4, 1.0 * weightKg);
        proteinCal = proteinG * 4;
      }
    }

    const carbCal = Math.max(calories - proteinCal - fatCal, 0);
    const carbG = carbCal / 4;
    const fiber = calcClamp(Math.round((calories / 1000) * 14), 20, 50);

    const weightLb = weightKg * 2.20462;
    const avgDailyExerciseMin = ((workoutDurationMin || 0) * (workoutsPerWeek || 0)) / 7;
    const exerciseOz = (avgDailyExerciseMin / 30) * 12;
    const water = calcClamp(Math.round((weightLb * 0.5 + exerciseOz) / 8), 6, 16);

    return { protein: Math.round(proteinG), carbs: Math.round(carbG), fat: Math.round(fatG), fiber: fiber, water: water };
  }

  // Orchestrates BMR -> TDEE -> safety validation -> goal-adjusted calories
  // -> macros. This is the single entry point the UI calls; every number in
  // the result traces back to one of the formulas above.
  function calculateNutritionTargets(profile) {
    const bmr = calculateBMR(profile.sex, profile.weightKg, profile.heightCm, profile.age);
    const tdee = calculateTDEE(bmr, profile.activityLevel);
    const validation = validateGoal(profile);
    const effectiveGoal = validation.effectiveGoal;

    let calories;
    if (effectiveGoal === "maintain") calories = tdee;
    else if (effectiveGoal === "gain") calories = tdee + 350; // modest surplus, not an aggressive bulk
    else calories = tdee - 500; // modest deficit, not an aggressive cut

    // Safety floor: never below resting energy needs, and never below the
    // absolute minimum — this is what makes an aggressive deadline
    // impossible to force by just widening the deficit/surplus.
    const floor = Math.max(CALC_MIN_CALORIE_FLOOR, bmr);
    if (calories < floor) calories = floor;
    calories = Math.round(calories);

    const macros = calculateMacros(calories, profile.weightKg, effectiveGoal, profile.trainingType, profile.workoutsPerWeek, profile.workoutDurationMin);

    return {
      bmr: Math.round(bmr), tdee: Math.round(tdee),
      maintenanceLow: Math.round(tdee - 100), maintenanceHigh: Math.round(tdee + 100),
      calories: calories, effectiveGoal: effectiveGoal,
      isMinor: validation.isMinor, blockedForMinor: validation.blockedForMinor,
      timelineWarning: validation.timelineWarning, suggestedWeeks: validation.suggestedWeeks,
      protein: macros.protein, carbs: macros.carbs, fat: macros.fat, fiber: macros.fiber, water: macros.water
    };
  }

  // A deterministic, template-built explanation — never an AI call. The
  // numbers it describes are exactly the ones already computed above, so
  // there's no way for this step to invent or alter a target.
  function buildTargetsExplanation(result) {
    const goalPhrase = result.effectiveGoal === "lose"
      ? "a modest calorie deficit to support gradual fat loss while preserving muscle"
      : result.effectiveGoal === "gain"
      ? "a modest calorie surplus to support lean muscle gain without excess fat gain"
      : "your estimated maintenance calories to support your current weight";
    let text =
      "Your calorie target (" + result.calories.toLocaleString() + " cal) is based on your estimated resting energy needs " +
      "(Mifflin-St Jeor formula) and activity level, adjusted for " + goalPhrase + ". " +
      "Protein (" + result.protein + "g) is set relative to your body weight, training frequency, and goal to support " +
      "muscle recovery and repair. Fat (" + result.fat + "g) stays within a healthy dietary range to support normal " +
      "body functions like hormone production. Carbohydrates (" + result.carbs + "g) fill the remaining calories to " +
      "fuel your training and daily activity. Fiber (" + result.fiber + "g) and water (" + result.water + " cups) " +
      "follow general daily guidelines based on your calorie intake and activity level.";
    if (result.blockedForMinor) {
      text += " Because you're under 18, JARVIS shows a conservative maintenance-based estimate rather than a " +
        "restrictive or aggressive target — a parent/guardian, pediatrician, or registered dietitian can help " +
        "determine an appropriate target for intentional weight change.";
    }
    text += " These are estimates from established formulas, not medical advice — actual needs vary and are best adjusted from real-world trends over time.";
    return text;
  }

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

  /* ---------------- shared render helpers ---------------- */

  function $(id) { return document.getElementById(id); }

  // Only renders an actual progress bar when a real target exists — showing
  // a full-looking bar with no target would falsely imply a goal was hit.
  // With no target, this is just the logged number, plainly labeled as such.
  function barHtml(label, consumed, target, unit) {
    const core = window.JarvisCore;
    const hasTarget = target > 0;
    if (!hasTarget) {
      return (
        '<div class="nutri-bar-row">' +
          '<div class="nutri-bar-label"><span>' + core.escapeHtml(label) + '</span><span class="nutri-bar-value">' + Math.round(consumed) + (unit || "") + ' (no target set)</span></div>' +
        '</div>'
      );
    }
    const pct = Math.min(100, Math.round((consumed / target) * 100));
    const overCls = consumed > target ? " over" : "";
    const targetText = Math.round(consumed) + " / " + Math.round(target) + (unit || "");
    return (
      '<div class="nutri-bar-row">' +
        '<div class="nutri-bar-label"><span>' + core.escapeHtml(label) + '</span><span class="nutri-bar-value">' + targetText + '</span></div>' +
        '<div class="nutri-bar-track"><div class="nutri-bar-fill' + overCls + '" style="width:' + pct + '%"></div></div>' +
      '</div>'
    );
  }

  /* ---------------- Dashboard ---------------- */

  // One macro in the compact summary: the amount logged, and "of target" only when a target has been set.
  function macroCellHtml(label, consumed, target, unit) {
    const hasTarget = target > 0;
    const over = hasTarget && consumed > target ? " over" : "";
    return '<div class="nut-macro' + over + '"><span class="nut-macro-v">' + Math.round(consumed) + unit + (hasTarget ? '<span class="nut-macro-of"> / ' + Math.round(target) + '</span>' : '') + '</span><span class="nut-macro-l">' + window.JarvisCore.escapeHtml(label) + '</span></div>';
  }

  function renderMacroCards() {
    const today = window.JarvisCore.todayISODate();
    const totals = getDayTotals(today);
    const targets = getActiveTargets();
    $("nutritionMacroCards").innerHTML =
      macroCellHtml("Protein", totals.protein, targets.protein, "g") +
      macroCellHtml("Carbs", totals.carbs, targets.carbs, "g") +
      macroCellHtml("Fat", totals.fat, targets.fat, "g") +
      macroCellHtml("Fiber", totals.fiber, targets.fiber, "g");
  }

  // Today: calories logged; the target, what is left and a bar only once a calorie target exists; macros; water.
  function renderDashboard() {
    const core = window.JarvisCore;
    const today = core.todayISODate();
    const totals = getDayTotals(today);
    const targets = getActiveTargets();

    $("nutritionCalorieTarget").textContent = targets.calories > 0 ? Math.round(targets.calories) : "";
    $("nutritionCalorieConsumed").textContent = Math.round(totals.calories).toLocaleString();
    const remaining = targets.calories - totals.calories;
    const remainingEl = $("nutritionCalorieRemaining");
    const bar = $("nutSumBar");
    if (targets.calories > 0) {
      remainingEl.textContent = " of " + Math.round(targets.calories).toLocaleString() + " · " + (remaining >= 0 ? Math.round(remaining).toLocaleString() + " left" : Math.round(-remaining).toLocaleString() + " over");
      remainingEl.className = "nut-sum-of " + (remaining >= 0 ? "" : "text-negative");
      bar.hidden = false;
      const pct = Math.min(100, Math.round((totals.calories / targets.calories) * 100));
      $("nutSumFill").style.width = pct + "%";
      bar.classList.toggle("over", remaining < 0);
    } else {
      remainingEl.textContent = "";
      remainingEl.className = "nut-sum-of";
      bar.hidden = true;
    }

    renderMacroCards();

    $("nutritionWaterBar").textContent = totals.water + (totals.water === 1 ? " cup" : " cups") + (targets.water > 0 ? " of " + targets.water : "");

    renderGoals();
    renderCalculator();
    renderCheckinHistory();
    renderCheckinSuggestion();

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
    if (historySelectedDate === today) renderHistoryDetail();
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
    renderDashboard();
    core.showToast((mode === "bulking" ? "Bulking" : "Cutting") + " targets saved.");
  }

  /* ---------------- AI Nutrition Goal Calculator: UI ---------------- */

  function updateCalculatorUnitVisibility() {
    const heightUnit = $("calcHeightUnit").value;
    $("calcHeightFtInRow").classList.toggle("hidden", heightUnit !== "ftin");
    $("calcHeightCmRow").classList.toggle("hidden", heightUnit !== "cm");
    const weightUnit = $("calcWeightUnit").value;
    $("calcWeightLbRow").classList.toggle("hidden", weightUnit !== "lb");
    $("calcWeightKgRow").classList.toggle("hidden", weightUnit !== "kg");
    $("calcTargetWeightLbRow").classList.toggle("hidden", weightUnit !== "lb");
    $("calcTargetWeightKgRow").classList.toggle("hidden", weightUnit !== "kg");
    $("calcHeightUnitToggle").querySelectorAll(".segmented-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-unit") === heightUnit);
    });
    $("calcWeightUnitToggle").querySelectorAll(".segmented-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-unit") === weightUnit);
    });
  }

  function handleCalcUnitToggleClick(e) {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    const group = btn.closest(".segmented-control");
    const targetSelectId = group.id === "calcHeightUnitToggle" ? "calcHeightUnit" : "calcWeightUnit";
    $(targetSelectId).value = btn.getAttribute("data-unit");
    updateCalculatorUnitVisibility();
  }

  function prefillCalculatorForm(profile) {
    $("calcAge").value = profile.age || "";
    $("calcSex").value = profile.sex || "unspecified";
    $("calcHeightUnit").value = profile.heightUnit || "ftin";
    if (profile.heightUnit === "cm") {
      $("calcHeightCm").value = Math.round(profile.heightCm) || "";
    } else {
      const fi = cmToFeetInches(profile.heightCm);
      $("calcHeightFt").value = fi.feet || "";
      $("calcHeightIn").value = fi.inches || "";
    }
    $("calcWeightUnit").value = profile.weightUnit || "lb";
    if (profile.weightUnit === "kg") {
      $("calcWeightKg").value = Math.round(profile.weightKg * 10) / 10 || "";
      $("calcTargetWeightKg").value = Math.round(profile.targetWeightKg * 10) / 10 || "";
    } else {
      $("calcWeightLb").value = Math.round(kgToLb(profile.weightKg) * 10) / 10 || "";
      $("calcTargetWeightLb").value = Math.round(kgToLb(profile.targetWeightKg) * 10) / 10 || "";
    }
    $("calcGoal").value = profile.goal || "maintain";
    $("calcTimeframeWeeks").value = profile.timeframeWeeks || "";
    $("calcActivityLevel").value = profile.activityLevel || "moderate";
    $("calcTrainingType").value = profile.trainingType || "mixed";
    $("calcWorkoutsPerWeek").value = profile.workoutsPerWeek || "";
    $("calcWorkoutDuration").value = profile.workoutDurationMin || "";
    $("calcDailySteps").value = profile.dailySteps || "";
    updateCalculatorUnitVisibility();
  }

  function macroResultCardHtml(label, value, unit) {
    return (
      '<div class="macro-mini-card">' +
        '<div class="macro-mini-label">' + label + '</div>' +
        '<div class="macro-mini-value">' + value + unit + '</div>' +
      '</div>'
    );
  }

  function renderCalculatorResults(result, profile) {
    if (!result) return;
    $("calcHeroCalories").textContent = result.calories.toLocaleString();
    $("calcMacroCards").innerHTML =
      macroResultCardHtml("Protein", result.protein, "g") +
      macroResultCardHtml("Carbohydrates", result.carbs, "g") +
      macroResultCardHtml("Fat", result.fat, "g") +
      macroResultCardHtml("Fiber", result.fiber, "g") +
      macroResultCardHtml("Water", result.water, " cups");

    const targetWeightText = profile.weightUnit === "kg"
      ? Math.round(profile.targetWeightKg) + " kg"
      : Math.round(kgToLb(profile.targetWeightKg)) + " lb";
    $("calcSummaryStats").innerHTML =
      '<div class="stat-box"><span class="stat-value">' + result.maintenanceLow.toLocaleString() + '–' + result.maintenanceHigh.toLocaleString() + '</span><span class="stat-label">Estimated maintenance (cal)</span></div>' +
      '<div class="stat-box"><span class="stat-value">' + (CALC_GOAL_LABELS[result.effectiveGoal] || result.effectiveGoal) + '</span><span class="stat-label">Goal</span></div>' +
      '<div class="stat-box"><span class="stat-value">' + targetWeightText + '</span><span class="stat-label">Target weight</span></div>';

    $("calcAgeBanner").classList.toggle("hidden", !result.blockedForMinor);
    if (result.blockedForMinor) {
      $("calcAgeBanner").textContent =
        "Calorie needs during adolescence also support growth and development, so JARVIS shows a conservative " +
        "maintenance-based estimate instead of a weight-loss or weight-gain target. A parent/guardian, pediatrician, " +
        "or registered dietitian can help determine an appropriate target for intentional weight change.";
    }
    $("calcTimelineBanner").classList.toggle("hidden", !result.timelineWarning);
    if (result.timelineWarning) {
      $("calcTimelineBanner").textContent = result.timelineWarning +
        (result.suggestedWeeks ? (" A more gradual pace would take about " + result.suggestedWeeks + " weeks.") : "");
    }
    $("calcExplanationText").textContent = "";
  }

  function renderCalculator() {
    const hasSavedProfile = !!(nutritionProfile && nutritionProfile.lastResult);
    const showResults = !!calculatorResult || (hasSavedProfile && !calculatorFormVisible);
    $("calcForm").classList.toggle("hidden", showResults && !calculatorFormVisible);
    $("calcResults").classList.toggle("hidden", !showResults);
    // Available whenever results are showing — including a just-computed
    // preview that hasn't been applied/saved yet — so there's always a way
    // back to tweak inputs, not only after the first Apply.
    $("calcRecalculateBtn").classList.toggle("hidden", !showResults);
    if (!showResults) {
      $("calcAgeBanner").classList.add("hidden");
      $("calcTimelineBanner").classList.add("hidden");
      return;
    }
    const result = calculatorResult || nutritionProfile.lastResult;
    const profile = calculatorPendingProfile || nutritionProfile;
    renderCalculatorResults(result, profile);
  }

  function readCalculatorFormProfile() {
    const heightUnit = $("calcHeightUnit").value;
    const weightUnit = $("calcWeightUnit").value;
    const heightCm = heightUnit === "cm" ? Number($("calcHeightCm").value) : feetInchesToCm($("calcHeightFt").value, $("calcHeightIn").value);
    const weightKg = weightUnit === "kg" ? Number($("calcWeightKg").value) : lbToKg($("calcWeightLb").value);
    const targetWeightKg = weightUnit === "kg" ? Number($("calcTargetWeightKg").value) : lbToKg($("calcTargetWeightLb").value);

    let timeframeWeeks = Number($("calcTimeframeWeeks").value);
    const dateInput = $("calcTargetDate").value;
    if (!isRealisticWeeks(timeframeWeeks) && dateInput) {
      const days = (new Date(dateInput) - new Date(window.JarvisCore.todayISODate())) / 86400000;
      timeframeWeeks = Math.max(1, Math.round(days / 7));
    }

    return {
      age: Number($("calcAge").value), sex: $("calcSex").value,
      heightCm: heightCm, heightUnit: heightUnit,
      weightKg: weightKg, weightUnit: weightUnit,
      goal: $("calcGoal").value, targetWeightKg: targetWeightKg, timeframeWeeks: timeframeWeeks,
      activityLevel: $("calcActivityLevel").value, trainingType: $("calcTrainingType").value,
      workoutsPerWeek: Number($("calcWorkoutsPerWeek").value) || 0,
      workoutDurationMin: Number($("calcWorkoutDuration").value) || 0,
      dailySteps: $("calcDailySteps").value ? Number($("calcDailySteps").value) : undefined
    };
  }

  function handleCalculatorFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const profile = readCalculatorFormProfile();

    if (!isRealisticAge(profile.age)) { core.showToast("Enter a realistic age (5-100)."); return; }
    if (!isRealisticHeightCm(profile.heightCm)) { core.showToast("Enter a realistic height."); return; }
    if (!isRealisticWeightKg(profile.weightKg)) { core.showToast("Enter a realistic current weight."); return; }

    if (profile.goal !== "maintain") {
      if (!isRealisticWeightKg(profile.targetWeightKg)) { core.showToast("Enter a realistic target weight."); return; }
      if (!isRealisticWeeks(profile.timeframeWeeks)) { core.showToast("Enter a realistic timeframe — weeks, or a target date."); return; }
    } else {
      if (!isRealisticWeightKg(profile.targetWeightKg)) profile.targetWeightKg = profile.weightKg;
      if (!isRealisticWeeks(profile.timeframeWeeks)) profile.timeframeWeeks = 12;
    }

    calculatorResult = calculateNutritionTargets(profile);
    calculatorPendingProfile = profile;
    calculatorFormVisible = false;
    renderCalculator();
    core.showToast("Targets calculated — review below, then Apply to save them.");
  }

  function handleApplyCalculatedTargets() {
    const core = window.JarvisCore;
    if (!calculatorResult || !calculatorPendingProfile) return;
    const result = calculatorResult;
    const profile = calculatorPendingProfile;

    // Routes into the existing Cutting/Bulking target sets, since that's the
    // same data the Dashboard, Nutrients tab, and manual form all already
    // read — no new "mode" concept needed. "Maintain" keeps whichever mode
    // is currently selected rather than forcing one.
    if (result.effectiveGoal === "lose") goals.mode = "cutting";
    else if (result.effectiveGoal === "gain") goals.mode = "bulking";

    goals[goals.mode] = {
      calories: result.calories, protein: result.protein, carbs: result.carbs,
      fat: result.fat, fiber: result.fiber, water: result.water
    };
    saveGoals();
    saveNutritionProfile(profile, result);
    calculatorResult = null;
    calculatorPendingProfile = null;
    calculatorFormVisible = false;
    renderCalculator();
    renderDashboard();
    core.showToast("Applied to your " + (goals.mode === "bulking" ? "Bulking" : "Cutting") + " targets.");
  }

  function handleRecalculateGoals() {
    // Prefer the not-yet-applied preview's inputs if there is one, so
    // re-opening the form after a first-ever calculation (before any Apply)
    // still shows what was just entered, not a blank form.
    const sourceProfile = calculatorPendingProfile || nutritionProfile;
    calculatorFormVisible = true;
    calculatorResult = null;
    calculatorPendingProfile = null;
    if (sourceProfile) prefillCalculatorForm(sourceProfile);
    renderCalculator();
  }

  function handleExplainTargets() {
    const result = calculatorResult || (nutritionProfile && nutritionProfile.lastResult);
    if (!result) return;
    $("calcExplanationText").textContent = buildTargetsExplanation(result);
  }

  /* ---------------- Weekly Check-In (adaptive targets) ---------------- */

  function renderCheckinHistory() {
    const core = window.JarvisCore;
    const container = $("checkinHistoryList");
    if (checkins.length === 0) {
      container.innerHTML = '<div class="empty-state">No check-ins yet.</div>';
      return;
    }
    const sorted = checkins.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    container.innerHTML = sorted.slice(0, 8).map(function (c) {
      return (
        '<div class="list-item"><div class="list-item-row"><div class="list-item-main">' +
          '<span class="list-item-title">' + core.formatDate(c.date) + '</span>' +
          '<span class="list-item-meta">Weight: ' + core.escapeHtml(c.weightDisplay) + ' &middot; Performance ' + c.performance + '/5 &middot; Energy ' + c.energy + '/5 &middot; Hunger ' + c.hunger + '/5 &middot; Adherence ' + c.adherence + '/5</span>' +
        '</div></div></div>'
      );
    }).join("");
  }

  // Trend across the last several check-ins (never a single weigh-in), in
  // kg/week. Returns null when there isn't enough of a time spread yet.
  function analyzeWeightTrend() {
    const withWeight = checkins
      .filter(function (c) { return isNonNegativeNumber(c.weightKg); })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (withWeight.length < 2) return null;
    const recent = withWeight.slice(-4);
    const first = recent[0], last = recent[recent.length - 1];
    const daysBetween = (last.createdAt - first.createdAt) / 86400000;
    if (daysBetween < 3) return null;
    return ((last.weightKg - first.weightKg) / daysBetween) * 7;
  }

  function renderCheckinSuggestion() {
    const el = $("checkinTrendMessage");
    if (!el) return;
    pendingAdjustment = null;
    if (!nutritionProfile || !nutritionProfile.lastResult) { el.innerHTML = ""; return; }
    // Never auto-suggest a calorie change for minors, per the same age-safety
    // policy the calculator itself follows.
    if (nutritionProfile.age < 18) { el.innerHTML = ""; return; }

    const trend = analyzeWeightTrend();
    if (trend === null) {
      el.innerHTML = '<p class="field-hint">Log a few weekly check-ins to see a weight trend here.</p>';
      return;
    }

    const goal = nutritionProfile.lastResult.effectiveGoal;
    let suggestion = null;
    if (goal === "lose" && trend > -0.15) {
      suggestion = { delta: -150, reason: "Your weight trend over your recent check-ins is fairly flat even with a calorie deficit in place." };
    } else if (goal === "lose" && trend < -0.7) {
      suggestion = { delta: 150, reason: "You're losing faster than the intended gradual pace — a small increase can help protect muscle and energy." };
    } else if (goal === "gain" && trend < 0.05) {
      suggestion = { delta: 150, reason: "Your weight trend isn't moving up much despite a calorie surplus in place." };
    } else if (goal === "gain" && trend > 0.4) {
      suggestion = { delta: -150, reason: "You're gaining faster than the intended lean pace — a small decrease can help limit excess fat gain." };
    }

    if (!suggestion) {
      el.innerHTML = '<p class="field-hint text-positive">Your weight trend (' + (trend >= 0 ? "+" : "") + (Math.round(trend * 10) / 10) + ' kg/week) looks in line with your goal — no change suggested.</p>';
      return;
    }
    pendingAdjustment = suggestion;
    el.innerHTML =
      '<div class="calm-message">' + window.JarvisCore.escapeHtml(suggestion.reason) +
      ' JARVIS suggests a small adjustment: ' + (suggestion.delta > 0 ? "+" : "") + suggestion.delta + ' calories/day.' +
      '<div class="form-actions" style="margin-top:8px;"><button type="button" class="btn btn-secondary" id="checkinApplyAdjustmentBtn">Apply Suggested Adjustment</button></div>' +
      '</div>';
  }

  function handleCheckinFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const weightRaw = $("checkinWeight").value;
    if (!isNonNegativeNumber(weightRaw) || Number(weightRaw) <= 0) { core.showToast("Enter a valid weight."); return; }
    const unit = (nutritionProfile && nutritionProfile.weightUnit) || "lb";
    const weightKg = unit === "kg" ? Number(weightRaw) : lbToKg(weightRaw);
    checkins.push({
      id: core.uid("checkin"), date: core.todayISODate(),
      weightKg: weightKg, weightDisplay: (Math.round(Number(weightRaw) * 10) / 10) + " " + unit,
      performance: Number($("checkinPerformance").value) || 3, energy: Number($("checkinEnergy").value) || 3,
      hunger: Number($("checkinHunger").value) || 3, adherence: Number($("checkinAdherence").value) || 3,
      createdAt: Date.now()
    });
    saveCheckins();
    $("checkinForm").reset();
    ["checkinPerformance", "checkinEnergy", "checkinHunger", "checkinAdherence"].forEach(function (id) { $(id).value = "3"; });
    renderCheckinHistory();
    renderCheckinSuggestion();
    core.showToast("Check-in saved.");
  }

  // Adjusts the currently-applied calorie target by a small confirmed
  // amount and recomputes macros to match — never automatic, always behind
  // an explicit button the user has to click after reviewing the reason.
  function handleApplyAdjustment() {
    const core = window.JarvisCore;
    if (!pendingAdjustment || !nutritionProfile || !nutritionProfile.lastResult) return;
    if (!window.confirm("Adjust your daily calorie target by " + (pendingAdjustment.delta > 0 ? "+" : "") + pendingAdjustment.delta + " calories? Your macros will be recalculated to match.")) return;
    const newCalories = Math.max(CALC_MIN_CALORIE_FLOOR, nutritionProfile.lastResult.calories + pendingAdjustment.delta);
    const macros = calculateMacros(newCalories, nutritionProfile.weightKg, nutritionProfile.lastResult.effectiveGoal, nutritionProfile.trainingType, nutritionProfile.workoutsPerWeek, nutritionProfile.workoutDurationMin);
    const newResult = Object.assign({}, nutritionProfile.lastResult, { calories: newCalories }, macros);
    goals[goals.mode] = { calories: newResult.calories, protein: newResult.protein, carbs: newResult.carbs, fat: newResult.fat, fiber: newResult.fiber, water: newResult.water };
    saveGoals();
    saveNutritionProfile(nutritionProfile, newResult);
    renderCalculator();
    renderDashboard();
    renderCheckinSuggestion();
    core.showToast("Targets adjusted.");
  }

  function handleCheckinTrendClick(e) {
    if (e.target.closest("#checkinApplyAdjustmentBtn")) handleApplyAdjustment();
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
    $("foodNameMatchHint").classList.add("hidden");
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
        const old = day.meals[oldMeal][idx];
        keepSourceIfUntouched(old, raw);
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
    core.closeModal("addFoodModal");
  }

  function handleFoodFormCancel() { closeAddFoodModal(); }

  function mealTotalsText(items) {
    if (!items || items.length === 0) return "";
    const cals = items.reduce(function (s, it) { return s + (it.calories || 0); }, 0);
    return Math.round(cals) + " kcal";
  }

  // The options menu (kebab button) for a single Today's Food item. Shows a
  // small "move to which meal" submenu in place of the main actions when
  // "Move to another meal" is tapped, rather than a separate popup.
  function foodItemMenuHtml(item, meal) {
    const core = window.JarvisCore;
    if (foodItemMoveSubmenuOpen) {
      const otherMeals = MEALS.filter(function (m) { return m !== meal; });
      return (
        '<div class="food-item-menu">' +
          otherMeals.map(function (m) {
            return '<button type="button" class="food-item-menu-item food-move-target-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '" data-target-meal="' + m + '">Move to ' + MEAL_LABELS[m] + '</button>';
          }).join("") +
          '<button type="button" class="food-item-menu-item food-move-cancel-btn">&larr; Back</button>' +
        '</div>'
      );
    }
    return (
      '<div class="food-item-menu">' +
        (item.label ? '<button type="button" class="food-item-menu-item food-amount-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Change amount</button>' : '') +
        '<button type="button" class="food-item-menu-item food-edit-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Edit</button>' +
        '<button type="button" class="food-item-menu-item food-duplicate-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Duplicate</button>' +
        '<button type="button" class="food-item-menu-item food-move-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Move to another meal</button>' +
        '<button type="button" class="food-item-menu-item food-save-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Save as Saved Food</button>' +
        '<button type="button" class="food-item-menu-item danger food-delete-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">Delete</button>' +
      '</div>'
    );
  }

  function foodItemRowHtml(item, meal) {
    const core = window.JarvisCore;
    const fvTag = item.isFruitVeg ? ' <span class="badge badge-green">fruit/veg</span>' : "";
    const menuOpen = foodItemMenuOpenKey === (meal + ":" + item.id);
    return (
      '<div class="food-item-card" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '">' +
        '<div class="food-item-main">' +
          '<div class="food-item-title-row">' +
            '<span class="food-item-title">' + core.escapeHtml(item.name) + fvTag + '</span>' +
            '<span class="food-item-cal">' + Math.round(item.calories) + ' cal</span>' +
          '</div>' +
          '<div class="food-item-meta">' + core.escapeHtml(item.serving || "1 serving") + ' &middot; P ' + item.protein + 'g &middot; C ' + item.carbs + 'g &middot; F ' + item.fat + 'g &middot; Fiber ' + item.fiber + 'g</div>' +
        '</div>' +
        '<div class="food-item-menu-wrap">' +
          '<button type="button" class="food-item-menu-btn" data-meal="' + meal + '" data-id="' + core.escapeHtml(item.id) + '" aria-label="Food options">&#8942;</button>' +
          (menuOpen ? foodItemMenuHtml(item, meal) : "") +
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
      const totalEl = $("foodMealTotal_" + meal);
      if (totalEl) totalEl.textContent = mealTotalsText(items);
    });
    const totals = getDayTotals(today);
    $("foodLogTotals").textContent =
      Math.round(totals.calories) + " cal · P " + Math.round(totals.protein) + "g · C " + Math.round(totals.carbs) +
      "g · F " + Math.round(totals.fat) + "g · Fiber " + Math.round(totals.fiber) + "g logged today";
  }

  function handleFoodLogClick(e) {
    const menuBtn = e.target.closest(".food-item-menu-btn");
    if (menuBtn) {
      const key = menuBtn.getAttribute("data-meal") + ":" + menuBtn.getAttribute("data-id");
      foodItemMoveSubmenuOpen = false;
      foodItemMenuOpenKey = (foodItemMenuOpenKey === key) ? null : key;
      renderFoodLog();
      return;
    }
    const moveBtn = e.target.closest(".food-move-btn");
    if (moveBtn) {
      foodItemMoveSubmenuOpen = true;
      renderFoodLog();
      return;
    }
    const moveCancelBtn = e.target.closest(".food-move-cancel-btn");
    if (moveCancelBtn) {
      foodItemMoveSubmenuOpen = false;
      renderFoodLog();
      return;
    }
    const moveTargetBtn = e.target.closest(".food-move-target-btn");
    if (moveTargetBtn) {
      const meal = moveTargetBtn.getAttribute("data-meal");
      const id = moveTargetBtn.getAttribute("data-id");
      const targetMeal = moveTargetBtn.getAttribute("data-target-meal");
      const day = getDay(window.JarvisCore.todayISODate());
      const idx = day.meals[meal].findIndex(function (it) { return it.id === id; });
      if (idx !== -1) {
        const item = day.meals[meal].splice(idx, 1)[0];
        day.meals[targetMeal].push(item);
        saveLog();
      }
      foodItemMenuOpenKey = null;
      foodItemMoveSubmenuOpen = false;
      renderFoodLog();
      renderDashboard();
      window.JarvisCore.showToast("Moved to " + MEAL_LABELS[targetMeal] + ".");
      return;
    }
    const dupBtn = e.target.closest(".food-duplicate-btn");
    if (dupBtn) {
      const meal = dupBtn.getAttribute("data-meal");
      const id = dupBtn.getAttribute("data-id");
      const day = getDay(window.JarvisCore.todayISODate());
      const item = day.meals[meal].find(function (it) { return it.id === id; });
      if (item) {
        const copy = Object.assign({}, item, { id: window.JarvisCore.uid("food"), createdAt: Date.now() });
        day.meals[meal].push(copy);
        saveLog();
        window.JarvisCore.showToast("Duplicated.");
      }
      foodItemMenuOpenKey = null;
      renderFoodLog();
      renderDashboard();
      return;
    }
    const saveBtn = e.target.closest(".food-save-btn");
    if (saveBtn) {
      const meal = saveBtn.getAttribute("data-meal");
      const id = saveBtn.getAttribute("data-id");
      const item = getDay(window.JarvisCore.todayISODate()).meals[meal].find(function (it) { return it.id === id; });
      if (item) {
        const r = saveLogItemAsFood(item);
        window.JarvisCore.showToast(!r.ok ? r.error : r.existed ? '"' + item.name + '" is already in Saved Foods.' : 'Saved "' + item.name + '" to Saved Foods.');
      }
      foodItemMenuOpenKey = null;
      renderFoodLog();
      return;
    }
    const amountBtn = e.target.closest(".food-amount-btn");
    if (amountBtn) {
      const meal = amountBtn.getAttribute("data-meal");
      const id = amountBtn.getAttribute("data-id");
      const item = getDay(window.JarvisCore.todayISODate()).meals[meal].find(function (it) { return it.id === id; });
      foodItemMenuOpenKey = null;
      renderFoodLog();
      if (!item || !item.label) return;
      startFlow({
        mode: "edit", start: "amount", meal: meal, itemId: id, entry: entryOfItem(item),
        food: { source: "edit", name: item.name, serving: item.label.serving, label: item.label, isFruitVeg: !!item.isFruitVeg }
      });
      return;
    }
    const editBtn = e.target.closest(".food-edit-btn");
    if (editBtn) {
      const meal = editBtn.getAttribute("data-meal");
      const id = editBtn.getAttribute("data-id");
      const item = getDay(window.JarvisCore.todayISODate()).meals[meal].find(function (it) { return it.id === id; });
      if (!item) return;
      foodItemMenuOpenKey = null;
      openAddFoodModal("create");
      foodFormEditId = { meal: meal, id: id };
      $("foodFormMealSelect").value = meal;
      $("foodName").value = item.name;
      $("foodServing").value = item.serving;
      MACRO_FIELDS.forEach(function (f) { $("food" + capitalize(f)).value = item[f]; });
      MICRO_FIELDS.forEach(function (f) {
        const el = $("food" + capitalize(f));
        if (el) el.value = item[f] !== undefined ? item[f] : "";
      });
      $("foodIsFruitVeg").checked = !!item.isFruitVeg;
      renderFoodForm();
      renderFoodLog();
      return;
    }
    const delBtn = e.target.closest(".food-delete-btn");
    if (delBtn) {
      const meal = delBtn.getAttribute("data-meal");
      const id = delBtn.getAttribute("data-id");
      const day = getDay(window.JarvisCore.todayISODate());
      const item = day.meals[meal].find(function (it) { return it.id === id; });
      if (!item) return;
      if (!window.confirm('Delete "' + item.name + '"? This can\'t be undone.')) return;
      day.meals[meal] = day.meals[meal].filter(function (it) { return it.id !== id; });
      saveLog();
      foodItemMenuOpenKey = null;
      renderFoodLog();
      renderDashboard();
      window.JarvisCore.showToast("Food removed.");
    }
  }

  /* ---------------- Saved Foods ---------------- */

  function renderSavedFoodForm() {
    $("savedFoodFormTitle").textContent = window._savedFoodEditId ? "Edit Saved Food" : "Add Saved Food";
    $("savedFoodSubmitBtn").textContent = window._savedFoodEditId ? "Save Changes" : "Save Food";
    $("savedFoodCancelBtn").classList.remove("hidden");   // Cancel closes the form: always offered
    renderSavedFoodPortions();
  }

  function resetSavedFoodForm() {
    window._savedFoodEditId = null;
    ["savedFoodName", "savedFoodServing", "savedFoodSize", "savedFoodCalories", "savedFoodProtein", "savedFoodCarbs", "savedFoodFat", "savedFoodFiber",
      "savedFoodSodium", "savedFoodCalcium", "savedFoodIron", "savedFoodPotassium", "savedFoodVitaminC", "savedFoodVitaminD"].forEach(function (id) {
      const el = $(id); if (el) el.value = "";
    });
    $("savedFoodSizeUnit").value = "g";
    $("savedFoodPortionName").value = ""; $("savedFoodPortionValue").value = ""; $("savedFoodPortionMsg").textContent = "";
    renderSavedFoodForm();
    const sw = $("savedFoodFormWrap"); if (sw) sw.hidden = true;
  }

  // The form edits the food as its LABEL has it: the label's serving, its weight or volume, and the numbers for that one serving.
  function fillSavedFoodForm(food) {
    const FA = window.JarvisFoodAmount, base = FA ? FA.baseOf(food) : null, vals = FA ? FA.valuesOf(food) : food;
    $("savedFoodName").value = food.name;
    $("savedFoodServing").value = (food.label && food.label.serving) || food.serving || "";
    $("savedFoodSize").value = base ? base.value : "";
    $("savedFoodSizeUnit").value = base ? base.unit : "g";
    MACRO_FIELDS.forEach(function (f2) { $("savedFood" + capitalize(f2)).value = vals[f2] !== undefined ? vals[f2] : (food[f2] !== undefined ? food[f2] : ""); });
    MICRO_FIELDS.forEach(function (f2) {
      const el = $("savedFood" + capitalize(f2));
      if (el) el.value = vals[f2] !== undefined ? vals[f2] : "";
    });
  }

  // The portions you have named for the food being edited, with a way to make one the default or take it away. Saved at once.
  function renderSavedFoodPortions() {
    const wrap = $("savedFoodPortionsWrap"), list = $("savedFoodPortions");
    if (!wrap || !list) return;
    const food = window._savedFoodEditId ? savedFoods.find(function (f) { return f.id === window._savedFoodEditId; }) : null;
    wrap.hidden = !food;
    if (!food) return;
    const FA = window.JarvisFoodAmount, core = window.JarvisCore, base = FA ? FA.baseOf(food) : null;
    const units = FA ? FA.unitsFor(base) : ["serving"];
    $("savedFoodPortionUnit").innerHTML = units.map(function (u) { return '<option value="' + u + '">' + FA.unitLabel(u, 2) + '</option>'; }).join("");
    const portions = FA ? FA.cleanPortions(food.portions) : [];
    list.innerHTML = portions.length ? portions.map(function (p) {
      const isDef = food.defaultPortionId === p.id;
      return '<div class="ff-portion-row" data-id="' + core.escapeHtml(p.id) + '"><span class="ff-portion-name">' + core.escapeHtml(p.name) + ' <span class="ff-portion-amt">' + core.escapeHtml(FA.describeEntry(p)) + '</span></span>' +
        '<button type="button" class="btn-icon ff-portion-default" aria-pressed="' + isDef + '" aria-label="' + (isDef ? "Default portion: " : "Make default: ") + core.escapeHtml(p.name) + '">' + (isDef ? "Default" : "Make default") + '</button>' +
        '<button type="button" class="btn-icon danger ff-portion-remove" aria-label="Remove portion ' + core.escapeHtml(p.name) + '">&times;</button></div>';
    }).join("") : '<p class="field-hint">No portions yet.</p>';
  }

  function handleSavedFoodPortionsClick(e) {
    const FA = window.JarvisFoodAmount, id = window._savedFoodEditId;
    const food = id ? savedFoods.find(function (f) { return f.id === id; }) : null;
    if (!FA || !food) return;
    const row = e.target.closest(".ff-portion-row");
    if (!row) return;
    const pid = row.getAttribute("data-id");
    if (e.target.closest(".ff-portion-default")) {
      const on = food.defaultPortionId === pid;
      if (updateSavedFood(id, { defaultPortionId: on ? "" : pid }).ok) renderSavedFoodPortions();
    } else if (e.target.closest(".ff-portion-remove")) {
      const r = FA.removePortion(food, pid);
      if (updateSavedFood(id, { portions: r.portions, defaultPortionId: r.defaultPortionId }).ok) { renderSavedFoodPortions(); $("savedFoodPortionMsg").textContent = "Portion removed."; }
    }
  }

  function handleSavedFoodPortionAdd() {
    const FA = window.JarvisFoodAmount, id = window._savedFoodEditId, msg = $("savedFoodPortionMsg");
    const food = id ? savedFoods.find(function (f) { return f.id === id; }) : null;
    if (!FA || !food) return;
    const r = FA.addPortion(food, { name: $("savedFoodPortionName").value, value: Number($("savedFoodPortionValue").value), unit: $("savedFoodPortionUnit").value }, function () { return window.JarvisCore.uid("por"); });
    if (!r.ok) { msg.textContent = r.error; return; }
    if (!updateSavedFood(id, { portions: r.portions }).ok) { msg.textContent = REFUSED; return; }
    msg.textContent = (r.replaced ? "Updated " : "Added ") + "“" + $("savedFoodPortionName").value.trim() + "”.";
    $("savedFoodPortionName").value = ""; $("savedFoodPortionValue").value = "";
    renderSavedFoodPortions();
  }

  function handleSavedFoodFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore, FA = window.JarvisFoodAmount, parse = window.JarvisLabelParse;
    const name = $("savedFoodName").value.trim();
    if (!name) { core.showToast("Give the saved food a name."); return; }
    if (!isNonNegativeNumber($("savedFoodCalories").value)) { core.showToast("Calories must be zero or a positive number."); return; }
    const serving = $("savedFoodServing").value.trim();
    // The label's weight or volume: what is typed, else what the serving text says ("2/3 cup (55g)").
    const typed = { value: Number($("savedFoodSize").value), unit: $("savedFoodSizeUnit").value };
    let size = FA && FA.validSize(typed) ? typed : null;
    if (!size && parse && serving) { const a = parse.parseAmount(serving); if (a) size = { value: a.value, unit: a.unit }; }
    const values = {};
    MACRO_FIELDS.forEach(function (f) {
      const v = $("savedFood" + capitalize(f)).value;
      if (f === "fiber" && v === "") return;       // fiber left empty is "not on the label", not 0
      values[f] = isNonNegativeNumber(v) && v !== "" ? Number(v) : 0;
    });
    MICRO_FIELDS.forEach(function (f) { const v = $("savedFood" + capitalize(f)).value; if (v !== "" && isNonNegativeNumber(v)) values[f] = Number(v); });
    const idx = window._savedFoodEditId ? savedFoods.findIndex(function (f) { return f.id === window._savedFoodEditId; }) : -1;
    const old = idx !== -1 ? savedFoods[idx] : null;
    const raw = Object.assign({}, old || {}, values, { name: name, serving: serving, isFruitVeg: old ? !!old.isFruitVeg : false, updatedAt: Date.now() });
    MICRO_FIELDS.forEach(function (f) { if (values[f] === undefined) delete raw[f]; });
    // A food with a measurable serving keeps its label; one without keeps it only if it already had one (the label's own serving text).
    if (size || (old && old.label)) {
      raw.label = { serving: serving || (size ? size.value + (size.unit === "ml" ? " mL" : " g") : "1 serving"), values: Object.assign({}, values), perContainer: old && old.label ? old.label.perContainer : undefined };
      if (size) raw.label.size = size;
    } else delete raw.label;
    raw.source = old && old.source ? old.source : "manual";
    if (raw.fiber !== undefined && values.fiber === undefined) delete raw.fiber;
    // Portions in a unit the food no longer allows (its label went from grams to millilitres) can't be used, so they are dropped.
    if (FA && raw.portions) { const base = FA.baseOf(raw); raw.portions = FA.cleanPortions(raw.portions).filter(function (p) { return FA.unitAllowed(base, p.unit); }); }
    // Numbers that were flagged by a scan and then changed by hand are confirmed; the ones left alone stay flagged.
    if (old && old.needsCheck) raw.needsCheck = old.needsCheck.filter(function (k) { const was = FA ? FA.valuesOf(old)[k] : old[k]; return was === values[k]; });
    if (old) { raw.id = old.id; raw.createdAt = old.createdAt; }
    const prev = savedFoods;
    const item = sanitizeFoodItem(raw);
    savedFoods = old ? savedFoods.map(function (f, i) { return i === idx ? item : f; }) : savedFoods.concat([item]);
    if (!saveSavedFoods()) { savedFoods = prev; core.showToast(REFUSED); return; }
    resetSavedFoodForm();
    renderSavedFoods();
    core.showToast(old ? "Saved food updated." : "Food saved.");
  }

  const ICON_STAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

  // A saved food as the library lists it: its label's serving and numbers (the baseline), and what you last had of it.
  function savedFoodLine(f) {
    const FA = window.JarvisFoodAmount, v = FA ? FA.valuesOf(f) : f;
    const num = function (k) { return Math.round((v[k] || 0) * 10) / 10; };
    return { per: (f.label && f.label.serving) || f.serving || "1 serving", macros: Math.round(v.calories || 0) + " cal · P " + num("protein") + "g · C " + num("carbs") + "g · F " + num("fat") + "g" };
  }

  function savedFoodMatches(f, q) {
    return !q || f.name.toLowerCase().indexOf(q) !== -1 || ((f.label && f.label.serving) || f.serving || "").toLowerCase().indexOf(q) !== -1;
  }

  function renderSavedFoods() {
    const core = window.JarvisCore, FA = window.JarvisFoodAmount;
    const container = $("savedFoodsList");
    let list = savedFoods.filter(function (f) { return f && typeof f.name === "string"; });
    const q = savedFoodSearch.trim().toLowerCase();
    list = list.filter(function (f) { return savedFoodMatches(f, q) && (foodsFilter !== "favorites" || f.favorite); });
    if (savedFoodSort === "calories") list.sort(function (a, b) { return (FA ? FA.valuesOf(a).calories || 0 : a.calories) - (FA ? FA.valuesOf(b).calories || 0 : b.calories); });
    else if (savedFoodSort === "recent") list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    else if (savedFoodSort === "used") list.sort(function (a, b) { return (b.lastUsedAt || 0) - (a.lastUsedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0); });
    else list.sort(function (a, b) { return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name); });

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">' + (savedFoods.length === 0 ? "No saved foods yet. Scan a label and it is saved here for you." : foodsFilter === "favorites" && !q ? "No favorite foods yet. Tap the star on a food." : "No saved foods match your search.") + '</div>';
      return;
    }
    container.innerHTML = list.map(function (f) {
      const line = savedFoodLine(f), last = f.lastPortion && FA ? FA.describeEntry(f.lastPortion) : "";
      const esc = core.escapeHtml;
      const tags = (f.source === "scan" ? ' <span class="badge badge-neutral">Scanned</span>' : "") + (f.needsCheck && f.needsCheck.length ? ' <span class="badge badge-yellow">Check numbers</span>' : "");
      return (
        '<div class="saved-food-card" data-id="' + esc(f.id) + '">' +
          '<div class="saved-food-card-top">' +
            '<div class="saved-food-card-main"><div class="saved-food-card-title">' + esc(f.name) + tags + '</div>' +
            '<div class="saved-food-card-meta">Per ' + esc(line.per) + (last ? ' &middot; last had ' + esc(last) : '') + '</div></div>' +
            '<button type="button" class="ff-star saved-food-star' + (f.favorite ? " is-on" : "") + '" data-id="' + esc(f.id) + '" aria-pressed="' + (f.favorite ? "true" : "false") + '" aria-label="' + (f.favorite ? "Remove " : "Add ") + esc(f.name) + (f.favorite ? " from favorites" : " to favorites") + '">' + ICON_STAR + '</button>' +
          '</div>' +
          '<div class="saved-food-card-macros">' + line.macros + '</div>' +
          (f.needsCheck && f.needsCheck.length ? '<div class="saved-food-card-meta">Not confirmed from the label: ' + esc(f.needsCheck.map(function (k) { return (FA && FA.NAMES[k]) || k; }).join(", ")) + '.</div>' : '') +
          '<div class="saved-food-card-actions">' +
            '<button type="button" class="btn btn-secondary saved-food-log-btn" data-id="' + esc(f.id) + '" aria-label="Log ' + esc(f.name) + '">+ Log</button>' +
            (f.needsCheck && f.needsCheck.length ? '<button type="button" class="btn-icon saved-food-checked-btn" data-id="' + esc(f.id) + '" aria-label="Mark checked: ' + esc(f.name) + '">Mark checked</button>' : '') +
            '<button type="button" class="btn-icon saved-food-edit-btn" data-id="' + esc(f.id) + '" aria-label="Edit ' + esc(f.name) + '">Edit</button>' +
            '<button type="button" class="btn-icon danger saved-food-delete-btn" data-id="' + esc(f.id) + '" aria-label="Delete ' + esc(f.name) + '">Delete</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  // Changes some of a saved food's fields (favorite, portions, last amount ...) and saves, taking the change back if the browser refuses.
  function updateSavedFood(id, patch) {
    const idx = savedFoods.findIndex(function (f) { return f.id === id; });
    if (idx === -1) return { ok: false, error: "That food isn't saved any more." };
    const prev = savedFoods;
    const next = sanitizeFoodItem(Object.assign({}, copyOf(savedFoods[idx]), patch, { id: id, createdAt: savedFoods[idx].createdAt }));
    // sanitize drops what it can't keep; a field set to "" or null in the patch is taken away
    Object.keys(patch).forEach(function (k) { if (patch[k] === "" || patch[k] === null) delete next[k]; });
    savedFoods = savedFoods.map(function (f, i) { return i === idx ? next : f; });
    if (!saveSavedFoods()) { savedFoods = prev; return { ok: false, error: REFUSED }; }
    return { ok: true, food: copyOf(next) };
  }

  function handleSavedFoodsClick(e) {
    const logBtn = e.target.closest(".saved-food-log-btn");
    if (logBtn) { openFlowFor("saved", logBtn.getAttribute("data-id"), "saved"); return; }
    const star = e.target.closest(".saved-food-star");
    if (star) {
      const id = star.getAttribute("data-id");
      const food = savedFoods.find(function (f) { return f.id === id; });
      if (!food) return;
      const r = updateSavedFood(id, { favorite: !food.favorite, updatedAt: Date.now() });
      if (!r.ok) { window.JarvisCore.showToast(r.error); return; }
      renderSavedFoods();
      const again = document.querySelector('.saved-food-star[data-id="' + id + '"]'); if (again) again.focus();
      return;
    }
    const checkedBtn = e.target.closest(".saved-food-checked-btn");
    if (checkedBtn) {
      const r = updateSavedFood(checkedBtn.getAttribute("data-id"), { needsCheck: [] });
      window.JarvisCore.showToast(r.ok ? "Marked as checked." : r.error);
      renderSavedFoods();
      return;
    }
    const editBtn = e.target.closest(".saved-food-edit-btn");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      const food = savedFoods.find(function (f) { return f.id === id; });
      if (!food) return;
      window._savedFoodEditId = id;
      fillSavedFoodForm(food);
      renderSavedFoodForm();
      showFoodForm("saved");
      $("savedFoodName").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const delBtn = e.target.closest(".saved-food-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      const food = savedFoods.find(function (f) { return f.id === id; });
      if (!food) return;
      if (!window.confirm('Delete saved food "' + food.name + '"? This can\'t be undone.')) return;
      const prev = savedFoods;
      savedFoods = savedFoods.filter(function (f) { return f.id !== id; });
      if (!saveSavedFoods()) { savedFoods = prev; window.JarvisCore.showToast(REFUSED); return; }
      renderSavedFoods();
      window.JarvisCore.showToast("Saved food deleted.");
    }
  }

  /* ---------------- Recipes ---------------- */

  function computeRecipeTotals(ingredients) {
    // An ingredient made from a food is worked out from its label (exact); the others are their own numbers. Added up exact, rounded by whoever shows it.
    if (window.JarvisFoodAmount) { const ex = window.JarvisFoodAmount.recipeExact(ingredients); return { totals: ex.totals, anyData: ex.counted > 0 }; }
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

  // An ingredient made from a food keeps its label and amount; its numbers follow them exactly until they are typed over.
  function linkedIng(ing) { return !!(ing && ing.label && ing.amount && window.JarvisFoodFlow && window.JarvisFoodFlow.linkNote(ing)); }
  function unlinkIng(ing) { delete ing.label; delete ing.amount; delete ing.foodId; }
  function renderRecipeSummary() {
    const box = $("recipeSummary"), FA = window.JarvisFoodAmount;
    if (!box || !window.JarvisFoodFlow) return;
    const wasOpen = !!box.querySelector(".ff-rs-more[open]");
    const dish = recipeBuilder.editId ? (recipes.find(function (r) { return r.id === recipeBuilder.editId; }) || {}).dishGrams : undefined;
    box.innerHTML = window.JarvisFoodFlow.recipeSummaryHtml({ ingredients: recipeBuilder.ingredients.filter(function (i) { return String(i.name || "").trim(); }), servings: $("recipeServings").value, dishGrams: dish });
    const more = box.querySelector(".ff-rs-more");
    if (more && wasOpen) more.open = true;
  }

  function renderIngredientRows() {
    const core = window.JarvisCore;
    const container = $("recipeIngredientRows");
    const last = recipeBuilder.ingredients.length - 1;
    container.innerHTML = recipeBuilder.ingredients.map(function (ing, i) {
      const aiTag = ing.aiEstimated ? ' <span class="badge badge-yellow">AI estimated</span>' : (ing.est ? ' <span class="badge badge-yellow">Estimated</span>' : "");
      return (
        '<div class="recipe-ingredient-card" data-index="' + i + '">' +
          '<div class="recipe-ingredient-card-header">' +
            '<span class="recipe-ingredient-number">Ingredient ' + (i + 1) + aiTag + '</span>' +
            '<div class="recipe-ingredient-card-actions">' +
              '<button type="button" class="btn-icon ri-move-up-btn" data-index="' + i + '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>&uarr;</button>' +
              '<button type="button" class="btn-icon ri-move-down-btn" data-index="' + i + '" aria-label="Move down"' + (i === last ? " disabled" : "") + '>&darr;</button>' +
              '<button type="button" class="btn-icon danger ri-remove-btn" data-index="' + i + '" aria-label="Remove ingredient">&times;</button>' +
            '</div>' +
          '</div>' +
          (linkedIng(ing) ? '<p class="ff-link"><span>' + core.escapeHtml(window.JarvisFoodFlow.linkNote(ing)) + '</span><button type="button" class="btn-icon ri-amount-btn" data-index="' + i + '">Change amount</button></p>' : '') +
          '<div class="form-row two-col">' +
            '<div><label>Name</label><input type="text" class="ri-name" aria-label="Ingredient ' + (i + 1) + ' name" data-index="' + i + '" value="' + core.escapeHtml(ing.name) + '" placeholder="e.g. Chicken breast"></div>' +
            '<div><label>Quantity</label><input type="text" class="ri-quantity" aria-label="Ingredient ' + (i + 1) + ' quantity" data-index="' + i + '" value="' + core.escapeHtml(ing.quantity) + '" placeholder="e.g. 6 oz"></div>' +
          '</div>' +
          '<div class="recipe-ingredient-macro-grid">' +
            '<div><label>Cal</label><input type="number" min="0" class="ri-calories" aria-label="Ingredient ' + (i + 1) + ' calories" data-index="' + i + '" value="' + core.escapeHtml(ing.calories) + '"></div>' +
            '<div><label>Protein</label><input type="number" min="0" class="ri-protein" aria-label="Ingredient ' + (i + 1) + ' protein" data-index="' + i + '" value="' + core.escapeHtml(ing.protein) + '"></div>' +
            '<div><label>Carbs</label><input type="number" min="0" class="ri-carbs" aria-label="Ingredient ' + (i + 1) + ' carbs" data-index="' + i + '" value="' + core.escapeHtml(ing.carbs) + '"></div>' +
            '<div><label>Fat</label><input type="number" min="0" class="ri-fat" aria-label="Ingredient ' + (i + 1) + ' fat" data-index="' + i + '" value="' + core.escapeHtml(ing.fat) + '"></div>' +
            '<div><label>Fiber</label><input type="number" min="0" class="ri-fiber" aria-label="Ingredient ' + (i + 1) + ' fiber" data-index="' + i + '" value="' + core.escapeHtml(ing.fiber) + '"></div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
    renderRecipeSummary();
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
    if (!input.classList.contains("ri-name") && !input.classList.contains("ri-quantity")) recipeBuilder.ingredients[i].est = false;   // typing a number makes it yours
    const wasLinked = linkedIng(recipeBuilder.ingredients[i]);
    if (!input.classList.contains("ri-name") && wasLinked) { unlinkIng(recipeBuilder.ingredients[i]); const note = input.closest(".recipe-ingredient-card").querySelector(".ff-link"); if (note) note.remove(); }
    if (input.classList.contains("ri-name")) recipeBuilder.ingredients[i].name = input.value;
    else if (input.classList.contains("ri-quantity")) recipeBuilder.ingredients[i].quantity = input.value;
    else if (input.classList.contains("ri-calories")) recipeBuilder.ingredients[i].calories = input.value;
    else if (input.classList.contains("ri-protein")) recipeBuilder.ingredients[i].protein = input.value;
    else if (input.classList.contains("ri-carbs")) recipeBuilder.ingredients[i].carbs = input.value;
    else if (input.classList.contains("ri-fat")) recipeBuilder.ingredients[i].fat = input.value;
    else if (input.classList.contains("ri-fiber")) recipeBuilder.ingredients[i].fiber = input.value;
    renderRecipeSummary();
  }

  // An ingredient from a scanned label or a saved food, added through the food sheet.
  function handleRecipeFromFood() {
    if (!window.JarvisFoodFlow) { window.JarvisCore.showToast("The food sheet isn't ready. Reload the app."); return; }
    window.JarvisFoodFlow.addIngredient({ onDone: function (ing) { putIngredientRow(ing); } });
  }
  function ingredientRow(ing) {
    const row = { name: ing.name, quantity: ing.quantity, calories: ing.calories, protein: ing.protein, carbs: ing.carbs, fat: ing.fat, fiber: ing.fiber, est: false, aiEstimated: false };
    if (ing.label && ing.amount) { row.label = ing.label; row.amount = ing.amount; if (ing.foodId) row.foodId = ing.foodId; }
    return row;
  }
  function putIngredientRow(ing, at) {
    const list = recipeBuilder.ingredients, row = ingredientRow(ing);
    const blank = function (r) { return !String(r.name || "").trim() && !String(r.quantity || "").trim() && !Number(r.calories) && !Number(r.protein) && !Number(r.carbs) && !Number(r.fat); };
    if (typeof at === "number") list[at] = Object.assign({}, list[at], row);
    else if (list.length && blank(list[list.length - 1])) list[list.length - 1] = row; else list.push(row);
    renderIngredientRows();
    const names = document.querySelectorAll("#recipeIngredientRows .ri-name"), target = names[typeof at === "number" ? at : names.length - 1];
    if (target) target.focus();
  }

  function handleIngredientRowsClick(e) {
    const amountBtn = e.target.closest(".ri-amount-btn");
    if (amountBtn) {
      const at = Number(amountBtn.getAttribute("data-index")), ing = recipeBuilder.ingredients[at];
      if (ing && ing.label && ing.amount && window.JarvisFoodFlow) window.JarvisFoodFlow.changeIngredient(ing, { onDone: function (n) { putIngredientRow(n, at); } });
      return;
    }
    const upBtn = e.target.closest(".ri-move-up-btn");
    if (upBtn) {
      const i = Number(upBtn.getAttribute("data-index"));
      if (i > 0) {
        const tmp = recipeBuilder.ingredients[i - 1];
        recipeBuilder.ingredients[i - 1] = recipeBuilder.ingredients[i];
        recipeBuilder.ingredients[i] = tmp;
        renderIngredientRows();
      }
      return;
    }
    const downBtn = e.target.closest(".ri-move-down-btn");
    if (downBtn) {
      const i = Number(downBtn.getAttribute("data-index"));
      if (i < recipeBuilder.ingredients.length - 1) {
        const tmp = recipeBuilder.ingredients[i + 1];
        recipeBuilder.ingredients[i + 1] = recipeBuilder.ingredients[i];
        recipeBuilder.ingredients[i] = tmp;
        renderIngredientRows();
      }
      return;
    }
    const btn = e.target.closest(".ri-remove-btn");
    if (!btn) return;
    const i = Number(btn.getAttribute("data-index"));
    if (recipeBuilder.ingredients.length <= 1) { window.JarvisCore.showToast("A recipe needs at least one ingredient row."); return; }
    recipeBuilder.ingredients.splice(i, 1);
    renderIngredientRows();
  }

  function setAiStatus(elId, text, isError) {
    const el = $(elId);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("text-negative", !!isError);
  }

  function setRecipeAiStatus(text, isError) {
    setAiStatus("recipeAiStatus", text, isError);
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Strips a ```json fenced block, if present, since models frequently wrap
  // JSON in markdown even when told not to — then parses what's left.
  function parseJsonLoosely(text) {
    let cleaned = String(text || "").trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    return JSON.parse(cleaned);
  }

  // Shared by Recipes, Food Log, and Saved Foods: sends one or more
  // {name, quantity} items to the user's own configured "nutrition" AI
  // connection (Bring-Your-Own — see Recipes > Set Up / Manage AI Connection) and asks it to
  // estimate calories/protein/carbs/fat/fiber (and optionally micronutrients)
  // for each one, in the same order, instead of the user looking each one up
  // and doing the math by hand. Resolves to {ok:true, estimates:[...]} or
  // {ok:false, error:"..."} — never rejects, so callers don't need a .catch.
  function requestNutritionEstimates(items) {
    if (!window.JarvisVideoConnections || !window.JarvisVideoApi) {
      return Promise.resolve({ ok: false, error: "AI connections aren't available right now." });
    }
    const connection = window.JarvisVideoConnections.getByKind("nutrition")[0];
    if (!connection || !connection.endpointUrl) {
      return Promise.resolve({ ok: false, error: "No AI connection set up yet for nutrient calculation." });
    }

    const ingredientsText = items.map(function (item) {
      return "- " + item.name.trim() + (item.quantity && item.quantity.trim() ? " — " + item.quantity.trim() : " — quantity not specified, assume a typical serving");
    }).join("\n");

    let jsonBody;
    try {
      jsonBody = window.JarvisVideoApi.fillJsonTemplate(connection.bodyTemplate, { ingredientsText: ingredientsText });
    } catch (err) {
      return Promise.resolve({ ok: false, error: "Couldn't build the request from this connection's template." });
    }

    return window.JarvisVideoApi.postRequest(connection, jsonBody, false).then(function (result) {
      if (!result.ok) {
        return { ok: false, error: "Request failed: " + (result.errorMessage || "unknown error") };
      }
      let responseJson;
      try { responseJson = JSON.parse(result.bodyText); } catch (e) {
        return { ok: false, error: "The connection's response wasn't valid JSON." };
      }
      const extracted = window.JarvisVideoApi.resolveJsonPath(responseJson, connection.responsePath);
      if (extracted === undefined) {
        return { ok: false, error: "Couldn't find the model's reply at that response path — check the connection's \"Result field\" setting." };
      }
      let estimates;
      try {
        estimates = typeof extracted === "string" ? parseJsonLoosely(extracted) : extracted;
      } catch (e) {
        return { ok: false, error: "The model's reply wasn't a parseable JSON array — see the connection's placeholder hint for the exact shape it needs to reply with." };
      }
      if (!Array.isArray(estimates)) {
        return { ok: false, error: "The model's reply wasn't a JSON array." };
      }
      return { ok: true, estimates: estimates };
    }).catch(function (err) {
      return { ok: false, error: "Something went wrong: " + (err && err.message ? err.message : String(err)) };
    });
  }

  function handleCalculateNutritionWithAI() {
    const core = window.JarvisCore;
    // Ingredients made from a label are never sent: an estimate must not replace numbers read from a package.
    const named = recipeBuilder.ingredients.filter(function (ing) { return ing.name.trim() && !linkedIng(ing); });
    if (named.length === 0) {
      core.showToast(recipeBuilder.ingredients.some(linkedIng) ? "Every ingredient already has its numbers from a label." : "Add at least one ingredient name first.");
      return;
    }
    setRecipeAiStatus("Asking AI to estimate nutrition for " + named.length + " ingredient" + (named.length === 1 ? "" : "s") + "…");
    const btn = $("recipeAiCalculateBtn");
    if (btn) btn.disabled = true;

    requestNutritionEstimates(named).then(function (result) {
      if (btn) btn.disabled = false;
      if (!result.ok) {
        setRecipeAiStatus(result.error, true);
        return;
      }
      const estimates = result.estimates;
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
    });
  }

  function handleGoToAiConnections() {
    if (window.JarvisVideoConnections && typeof window.JarvisVideoConnections.openManager === "function") window.JarvisVideoConnections.openManager();
  }

  // Is the form's content (raw, as strings) the same food as this stored item: same serving, same numbers?
  function sameFood(item, raw) {
    if ((item.serving || "") !== (raw.serving || "")) return false;
    return MACRO_FIELDS.concat(MICRO_FIELDS).every(function (f) {
      const had = item[f] !== undefined, has = raw[f] !== "" && raw[f] !== null && raw[f] !== undefined;
      if (MACRO_FIELDS.indexOf(f) !== -1) return Number(item[f] || 0) === Number(has ? raw[f] : 0);
      return had === has && (!had || Number(item[f]) === Number(raw[f]));
    });
  }

  // Editing a logged entry by hand: the entry keeps the label it was worked out from, and the saved food and amount behind it, only
  // while its numbers and serving are untouched. Change them and it is a different amount of a different thing, so the link is let go.
  function keepSourceIfUntouched(old, raw) {
    if (!old || !sameFood(old, raw)) return;
    if (old.label) raw.label = old.label;
    if (old.amount) raw.amount = old.amount;
    if (old.foodId) raw.foodId = old.foodId;
  }

  // "Recognizes it": as the user types a food name into the Food Log's
  // manual entry form, checks for an exact (case-insensitive) match in
  // Saved Foods and offers a one-tap fill from it — the same macro/micro
  // fields the AI estimate and label scan paths fill, just sourced from a
  // food already saved instead of estimated fresh each time. Never fills
  // automatically; always a confirmed tap, same "nothing silently
  // overwritten" rule as the rest of the form.
  let foodNameMatchedSaved = null;
  function handleFoodNameInputForMatch() {
    const typed = $("foodName").value.trim();
    const hint = $("foodNameMatchHint");
    if (!typed) { hint.classList.add("hidden"); foodNameMatchedSaved = null; return; }
    const match = savedFoods.find(function (f) { return f.name.trim().toLowerCase() === typed.toLowerCase(); });
    if (!match) { hint.classList.add("hidden"); foodNameMatchedSaved = null; return; }
    foodNameMatchedSaved = match;
    $("foodNameMatchText").textContent = 'Match found in Saved Foods: "' + match.name + '" —';
    hint.classList.remove("hidden");
  }

  function handleFoodNameMatchUse() {
    if (!foodNameMatchedSaved) return;
    const match = foodNameMatchedSaved;
    MACRO_FIELDS.concat(MICRO_FIELDS).forEach(function (f) {
      if (isNonNegativeNumber(match[f])) $("food" + capitalize(f)).value = match[f];
    });
    const servingInput = $("foodServing");
    if (match.serving && servingInput && !servingInput.value.trim()) servingInput.value = match.serving;
    $("foodNameMatchHint").classList.add("hidden");
    window.JarvisCore.showToast('Filled in nutrients saved for "' + match.name + '".');
  }

  function resetRecipeForm() {
    recipeBuilder = { editId: null, ingredients: [{ name: "", quantity: "", calories: "", protein: "", carbs: "", fat: "", fiber: "" }] };
    $("recipeName").value = "";
    $("recipeInstructions").value = "";
    $("recipeServings").value = "1";
    $("recipeFormTitle").textContent = "Create a Recipe";
    $("recipeSubmitBtn").textContent = "Save Recipe";
    $("recipeCancelBtn").classList.remove("hidden");
    setRecipeAiStatus("");
    renderIngredientRows();
    const rw = $("recipeFormWrap"); if (rw) rw.hidden = true;
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
        const clean = {
          name: ing.name.trim(), quantity: (ing.quantity || "").trim(),
          calories: Number(ing.calories) || 0, protein: Number(ing.protein) || 0,
          carbs: Number(ing.carbs) || 0, fat: Number(ing.fat) || 0, fiber: Number(ing.fiber) || 0
        };
        if (ing.state === "raw" || ing.state === "cooked" || ing.state === "packaged") clean.state = ing.state;
        // made from a food: the label and amount stay with it, and its numbers are worked out from them (exact), not read back from the boxes
        if (linkedIng(ing)) {
          const FA = window.JarvisFoodAmount, x = FA.ingredientExact({ label: ing.label, amount: ing.amount }), r3 = function (n) { return Math.round((n || 0) * 1000) / 1000; };
          clean.calories = r3(x.calories); clean.protein = r3(x.protein); clean.carbs = r3(x.carbs); clean.fat = r3(x.fat); clean.fiber = r3(x.fiber);
          clean.label = ing.label; clean.amount = FA.cleanEntry(ing.amount);
          if (ing.foodId) clean.foodId = ing.foodId;
          return clean;
        }
        if (ing.aiEstimated || ing.est) clean.est = true;      // numbers that were not typed by you stay marked as estimates
        return clean;
      });
    if (cleanIngredients.length === 0) { core.showToast("Add at least one ingredient."); return; }

    // Editing keeps everything else a recipe has (categories, favorite, times, storage, image: added in Meal Prep), not just these fields.
    const prevRecipe = recipeBuilder.editId ? recipes.find(function (r) { return r.id === recipeBuilder.editId; }) : null;
    const recipe = Object.assign({}, prevRecipe || {}, {
      id: recipeBuilder.editId || core.uid("recipe"),
      name: name, instructions: $("recipeInstructions").value.trim(),
      servings: Math.round(servings), ingredients: cleanIngredients,
      createdAt: prevRecipe ? prevRecipe.createdAt || Date.now() : Date.now(), updatedAt: Date.now()
    });
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
    const rq = savedFoodSearch.trim().toLowerCase();
    const shownRecipes = rq ? recipes.filter(function (r) { return r.name.toLowerCase().indexOf(rq) !== -1 || r.ingredients.some(function (i) { return (i.name || "").toLowerCase().indexOf(rq) !== -1; }); }) : recipes;
    if (shownRecipes.length === 0) {
      container.innerHTML = '<div class="empty-state">' + (recipes.length === 0 ? "No recipes yet. Tap + Add." : "No recipes match your search.") + '</div>';
      return;
    }
    container.innerHTML = shownRecipes.map(function (r) {
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
              '<select class="recipe-meal-select" aria-label="Meal for ' + core.escapeHtml(r.name) + '" data-id="' + core.escapeHtml(r.id) + '">' +
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
      if (window.JarvisGroceries && typeof window.JarvisGroceries.onRecipeLogged === "function") {
        window.JarvisGroceries.onRecipeLogged({
          recipeId: recipe.id, recipeName: recipe.name,
          ingredients: recipe.ingredients, recipeServings: recipe.servings, servingsLogged: 1
        });
      }
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
      showFoodForm("recipe");
      $("recipeName").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const delBtn = e.target.closest(".recipe-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      const recipe = recipes.find(function (r) { return r.id === id; });
      if (!recipe) return;
      if (!window.confirm('Delete recipe "' + recipe.name + '"? This can\'t be undone.')) return;
      recipes = recipes.filter(function (r) { return r.id !== id; });
      saveRecipes();
      renderRecipes();
      window.JarvisCore.showToast("Recipe deleted.");
    }
  }

  /* ---------------- Nutrients tab ---------------- */

  function renderNutrientsMacros() {
    const today = window.JarvisCore.todayISODate();
    const totals = getDayTotals(today);
    const targets = getActiveTargets();
    $("nutrientsMacroList").innerHTML =
      barHtml("Protein", totals.protein, targets.protein, "g") +
      barHtml("Carbohydrates", totals.carbs, targets.carbs, "g") +
      barHtml("Fat", totals.fat, targets.fat, "g") +
      barHtml("Fiber", totals.fiber, targets.fiber, "g");
  }

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
    }).join("");
  }

  /* ---------------- History ---------------- */

  function getDateRangeDescending(days) {
    const core = window.JarvisCore;
    const today = new Date(core.todayISODate());
    const result = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const tzOffset = d.getTimezoneOffset() * 60000;
      result.push(new Date(d.getTime() - tzOffset).toISOString().slice(0, 10));
    }
    return result;
  }

  function getAverages(days) {
    const loggedDays = getDateRangeDescending(days).filter(function (d) { return getAllEntries(d).length > 0; });
    if (loggedDays.length === 0) return null;
    const sums = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, water: 0, score: 0, fruitVeg: 0 };
    loggedDays.forEach(function (d) {
      const t = getDayTotals(d);
      sums.calories += t.calories; sums.protein += t.protein; sums.carbs += t.carbs;
      sums.fat += t.fat; sums.fiber += t.fiber; sums.water += t.water; sums.fruitVeg += t.fruitVegCount;
      sums.score += computeScore(d).score;
    });
    const n = loggedDays.length;
    return {
      days: n,
      calories: Math.round(sums.calories / n), protein: Math.round(sums.protein / n),
      carbs: Math.round(sums.carbs / n), fat: Math.round(sums.fat / n),
      fiber: Math.round(sums.fiber / n), water: Math.round(sums.water / n),
      fruitVeg: Math.round((sums.fruitVeg / n) * 10) / 10,
      score: Math.round(sums.score / n)
    };
  }

  // A small inline SVG line chart, same approach as workout.js's progress
  // charts (kept local here rather than shared, since that module doesn't
  // export its version) — only ever plots days that were actually logged,
  // so a gap in the data is a gap in the line, never a fabricated zero.
  function renderNutriLineChart(containerId, points, opts) {
    const core = window.JarvisCore;
    const container = $(containerId);
    if (!points || points.length < 2) {
      container.innerHTML = '<div class="empty-state">' + (opts.emptyMessage || "Log a few more days to see a trend line.") + '</div>';
      return;
    }
    const width = 640, height = 200;
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
      const label = core.escapeHtml(p.label) + ": " + core.escapeHtml(String(p.v));
      return '<circle cx="' + xPos(p.t).toFixed(1) + '" cy="' + yPos(p.v).toFixed(1) + '" r="4" fill="var(--accent)"><title>' + label + '</title></circle>';
    }).join("");
    const gridY0 = yPos(0), gridY1 = yPos(maxY);
    const gridLines =
      '<line x1="' + padding.left + '" y1="' + gridY0.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + gridY0.toFixed(1) + '" stroke="var(--card-border)" stroke-width="1"/>' +
      '<text x="4" y="' + (gridY0 + 4).toFixed(1) + '" font-size="10" fill="var(--text-faint)">0</text>' +
      '<text x="4" y="' + (gridY1 + 10).toFixed(1) + '" font-size="10" fill="var(--text-faint)">' + Math.round(maxY) + '</text>';
    container.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" class="progress-chart-svg" role="img" aria-label="' + core.escapeHtml(opts.ariaLabel || "trend chart") + '">' +
        gridLines +
        '<path d="' + pathD + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        circles +
      '</svg>';
  }

  function buildTrendPoints(days, field) {
    const core = window.JarvisCore;
    const loggedDates = getDateRangeDescending(days).reverse().filter(function (d) { return getAllEntries(d).length > 0; });
    return loggedDates.map(function (d) {
      const t = getDayTotals(d);
      return { t: new Date(d).getTime(), v: Math.round(t[field]), label: core.formatDate(d) };
    });
  }

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

    const avg = getAverages(historyRangeDays);
    $("historyAverages").innerHTML = avg
      ? ('<p class="field-hint">Average over the ' + avg.days + ' day' + (avg.days === 1 ? "" : "s") + ' you logged in the past ' + historyRangeDays + ' days:</p>' +
         '<div class="stat-grid">' +
           '<div class="stat-box"><span class="stat-value">' + avg.calories + '</span><span class="stat-label">Calories</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.protein + 'g</span><span class="stat-label">Protein</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.carbs + 'g</span><span class="stat-label">Carbs</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.fat + 'g</span><span class="stat-label">Fat</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.fiber + 'g</span><span class="stat-label">Fiber</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.water + '</span><span class="stat-label">Water (cups)</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.fruitVeg + '</span><span class="stat-label">Fruit/veg servings</span></div>' +
           '<div class="stat-box"><span class="stat-value">' + avg.score + '</span><span class="stat-label">Nutrition score</span></div>' +
         '</div>')
      : '<p class="field-hint">Log a few days to see averages.</p>';

    renderNutriLineChart("historyCalorieTrend", buildTrendPoints(historyRangeDays, "calories"),
      { ariaLabel: "Calorie trend", emptyMessage: "Log two days to see a calorie trend." });
    renderNutriLineChart("historyProteinTrend", buildTrendPoints(historyRangeDays, "protein"),
      { ariaLabel: "Protein trend", emptyMessage: "Log two days to see a protein trend." });

    renderHistoryDetail();
  }

  function handleHistoryRangeClick(e) {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    historyRangeDays = Number(btn.getAttribute("data-range")) || 7;
    $("historyRange7dBtn").classList.toggle("active", historyRangeDays === 7);
    $("historyRange30dBtn").classList.toggle("active", historyRangeDays === 30);
    renderHistoryList();
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

  /* ---------------- "+ Add Food" bottom sheet ---------------- */

  // Distinct foods logged recently, most-recent first — not a separate
  // stored list, just derived from the existing log so there's nothing new
  // to keep in sync. Two entries with the same (case-insensitive) name keep
  // only the most recent one's numbers.
  function getRecentFoods(limit) {
    const seen = {};
    const result = [];
    getDateRangeDescending(30).forEach(function (d) {
      const entries = getAllEntries(d).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      entries.forEach(function (item) {
        const key = (item.name || "").trim().toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        result.push(item);
      });
    });
    result.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return result.slice(0, limit || 12);
  }

  function guessCurrentMeal() {
    const hour = new Date().getHours();
    if (hour < 11) return "breakfast";
    if (hour < 15) return "lunch";
    if (hour < 20) return "dinner";
    return "snacks";
  }

  /* ---------------- the food library: one screen for saved foods and recipes ---------------- */

  let foodsFilter = "all";
  function showFoodForm(which) {
    const sw = $("savedFoodFormWrap"), rw = $("recipeFormWrap");
    if (sw) sw.hidden = which !== "saved";
    if (rw) rw.hidden = which !== "recipe";
    setFoodsFilter(which === "saved" ? "foods" : "recipes");
  }
  function setFoodsFilter(f) {
    foodsFilter = f;
    const a = $("foodsSavedSec"), b = $("foodsRecipesSec");
    if (a) a.hidden = f === "recipes";
    if (b) b.hidden = f === "foods" || f === "favorites";
    Array.prototype.forEach.call(document.querySelectorAll("[data-foodsfilter]"), function (btn) {
      const on = btn.getAttribute("data-foodsfilter") === f;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderSavedFoods();
  }
  function openFoodsAddMenu() {
    window.JarvisMenu.open({
      title: "Add to your library", opener: $("foodsAddBtn"),
      rows: [
        { key: "scan", label: "Scan a label", sub: "Read a nutrition label and save the food" },
        { key: "saved", label: "Saved food", sub: "Type in a food you eat often, with its numbers" },
        { key: "recipe", label: "Recipe", sub: "Ingredients that make servings" }
      ],
      onPick: function (key) {
        if (key === "scan") { startFlow({ mode: "save", start: "scan" }); return; }
        if (key === "saved") { window._savedFoodEditId = null; renderSavedFoodForm(); }
        showFoodForm(key);
        const el = $(key === "saved" ? "savedFoodName" : "recipeName");
        if (el) { el.scrollIntoView({ block: "center" }); el.focus(); }
      }
    });
  }
  function openTodayMenu() {
    window.JarvisMenu.open({
      title: "Nutrition", opener: $("nutMoreBtn"),
      rows: [
        { key: "scan", label: "Scan a label", sub: "Add a food from its nutrition label" },
        { key: "recipe", label: "Log a recipe" },
        { key: "targets", label: "Targets and goals", sub: "Calorie and macro targets, weekly check-in" },
        { key: "nutrients", label: "Nutrient detail", sub: "Macros and micronutrients for today" }
      ],
      onPick: function (key) {
        if (key === "scan") startFlow({ mode: "log", start: "scan" });
        else if (key === "recipe") openAddFoodModal("recipe");
        else { const b = document.querySelector('.nutrition-sub-nav-btn[data-subtarget="' + (key === "targets" ? "nutrition-goals" : "nutrition-nutrients") + '"]'); if (b) b.click(); }
      }
    });
  }

  // Foods you have logged on at least two days in the last 30, most often first.
  function getFrequentFoods(limit) {
    const counts = {}, latest = {};
    getDateRangeDescending(30).forEach(function (d) {
      const seenToday = {};
      getAllEntries(d).forEach(function (item) {
        const key = (item.name || "").trim().toLowerCase();
        if (!key || seenToday[key]) return;
        seenToday[key] = true;
        counts[key] = (counts[key] || 0) + 1;
        if (!latest[key] || (item.createdAt || 0) > (latest[key].createdAt || 0)) latest[key] = item;
      });
    });
    return Object.keys(counts).filter(function (k) { return counts[k] >= 2; })
      .sort(function (a, b) { return (counts[b] - counts[a]) || ((latest[b].createdAt || 0) - (latest[a].createdAt || 0)); })
      .slice(0, limit || 6).map(function (k) { return latest[k]; });
  }
  function renderFrequentFoods() {
    const wrap = $("foodsFrequentWrap"), box = $("foodsFrequent");
    if (!wrap || !box) return;
    const items = getFrequentFoods(6);
    wrap.hidden = items.length === 0;
    box.innerHTML = items.map(function (it) {
      return '<button type="button" class="nut-freq-btn" data-id="' + window.JarvisCore.escapeHtml(it.id) + '" aria-label="Log ' + window.JarvisCore.escapeHtml(it.name) + ' again"><span class="nut-freq-name">' + window.JarvisCore.escapeHtml(it.name) + '</span><span class="nut-freq-meta">' + Math.round(it.calories) + ' cal &middot; + Log</span></button>';
    }).join("");
  }
  // One tap logs the same food again (as it was last logged) into the meal that fits the time of day.
  function handleFrequentClick(e) {
    const btn = e.target.closest(".nut-freq-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const item = getFrequentFoods(12).filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    const copy = Object.assign({}, item); delete copy.id; delete copy.createdAt;
    const meal = guessCurrentMeal();
    getDay(window.JarvisCore.todayISODate()).meals[meal].push(sanitizeFoodItem(copy));
    saveLog();
    renderFoodLog();
    renderDashboard();
    if (window.JarvisGroceries && typeof window.JarvisGroceries.onSimpleFoodLogged === "function") window.JarvisGroceries.onSimpleFoodLogged(item.name, item.serving || "1 serving");
    if (item.foodId && item.amount) recordFlowUse("saved", item.foodId, item.amount);
    window.JarvisCore.showToast('Added "' + item.name + '" to ' + MEAL_LABELS[meal] + ".");
  }

  function openAddFoodModal(tab) {
    addFoodModalTab = tab || (getRecentFoods(1).length ? "recent" : "saved");
    modalSavedFoodSearch = "";
    const searchInput = $("modalSavedFoodSearchInput");
    if (searchInput) searchInput.value = "";
    renderAddFoodModal();
    window.JarvisCore.openModal("addFoodModal");
  }

  function closeAddFoodModal() {
    window.JarvisCore.closeModal("addFoodModal");
    resetFoodForm();
  }

  function pickerListItemHtml(source, id, name, meta) {
    const core = window.JarvisCore;
    return (
      '<button type="button" class="picker-list-item" data-source="' + source + '" data-id="' + core.escapeHtml(id) + '">' +
        '<span class="picker-list-item-title">' + core.escapeHtml(name) + '</span>' +
        '<span class="picker-list-item-meta">' + meta + '</span>' +
      '</button>'
    );
  }

  function renderRecentFoodsList() {
    const core = window.JarvisCore, FA = window.JarvisFoodAmount;
    const items = getRecentFoods(15);
    $("recentFoodsList").innerHTML = items.length
      ? items.map(function (it) {
          const had = it.amount && FA ? FA.describeEntry(it.amount) : "";
          return pickerListItemHtml("recent", it.id, it.name, Math.round(it.calories) + " cal &middot; " + core.escapeHtml(had || it.serving || "1 serving"));
        }).join("")
      : '<div class="empty-state">No recently logged foods yet — log something and it\'ll show up here.</div>';
  }

  // The Saved tab of the sheet: favorites first, then what you used lately, then everything else. A search shows one plain list.
  function renderModalSavedFoodsList() {
    const core = window.JarvisCore;
    const q = modalSavedFoodSearch.trim().toLowerCase();
    const all = savedFoods.filter(function (f) { return f && typeof f.name === "string" && savedFoodMatches(f, q); });
    const box = $("modalSavedFoodsList");
    if (!all.length) { box.innerHTML = '<div class="empty-state">' + (savedFoods.length === 0 ? "No saved foods yet. Scan a label and it is saved for you." : "No matches.") + '</div>'; return; }
    const row = function (f) { const line = savedFoodLine(f); return pickerListItemHtml("saved", f.id, f.name, line.macros.split(" · ")[0] + " &middot; per " + core.escapeHtml(line.per)); };
    const byName = function (a, b) { return a.name.localeCompare(b.name); };
    if (q) { box.innerHTML = all.slice().sort(byName).map(row).join(""); return; }
    const favs = all.filter(function (f) { return f.favorite; }).sort(byName);
    const used = all.filter(function (f) { return !f.favorite && f.lastUsedAt; }).sort(function (a, b) { return b.lastUsedAt - a.lastUsedAt; }).slice(0, 5);
    const shown = {};
    favs.concat(used).forEach(function (f) { shown[f.id] = true; });
    const rest = all.filter(function (f) { return !shown[f.id]; }).sort(byName);
    if (!favs.length && !used.length) { box.innerHTML = rest.map(row).join(""); return; }
    const section = function (title, list) { return list.length ? '<h3 class="ff-list-h">' + title + '</h3>' + list.map(row).join("") : ""; };
    box.innerHTML = section("Favorites", favs) + section("Recently used", used) + section("All foods", rest);
  }

  function renderModalRecipesList() {
    $("modalRecipesList").innerHTML = recipes.length
      ? recipes.map(function (r) {
          const result = computeRecipeTotals(r.ingredients);
          const perCal = result.totals.calories / r.servings;
          return pickerListItemHtml("recipe", r.id, r.name, Math.round(perCal) + " cal/serving &middot; " + r.servings + " serving" + (r.servings === 1 ? "" : "s"));
        }).join("")
      : '<div class="empty-state">No recipes yet — build one in the Recipes tab.</div>';
  }

  function renderAddFoodModal() {
    ["recent", "saved", "create", "recipe"].forEach(function (t) {
      const btn = $("addFoodTab" + capitalize(t));
      const panel = $("addFoodPanel" + capitalize(t));
      if (btn) { btn.classList.toggle("active", t === addFoodModalTab); btn.setAttribute("aria-selected", t === addFoodModalTab ? "true" : "false"); }
      if (panel) panel.classList.toggle("hidden", t !== addFoodModalTab);
    });
    if (addFoodModalTab === "recent") renderRecentFoodsList();
    else if (addFoodModalTab === "saved") renderModalSavedFoodsList();
    else if (addFoodModalTab === "recipe") renderModalRecipesList();
  }

  /* ---- the food sheet (js/food-flow-ui.js): what it gets from here ----
     Every number it shows or logs is worked out by JarvisFoodAmount from the food's label baseline; this file only stores the result. */

  // A recipe seen as a food: one serving is its per-serving numbers (exact), and when the finished weight of a serving is known,
  // that many grams, so it can also be logged by weight.
  function recipeAsFood(r) {
    const FA = window.JarvisFoodAmount;
    const per = FA.perPortion(FA.recipeExact(r.ingredients).totals, r.servings);
    const grams = FA.portionWeight(r.dishGrams, r.servings);
    const label = { serving: grams ? "1 serving (" + grams + " g)" : "1 serving", values: per };
    if (grams) label.size = { value: grams, unit: "g" };
    const food = { source: "recipe", id: r.id, name: r.name, serving: "1 serving", isFruitVeg: false, label: label, recipeServings: r.servings };
    if (r.lastPortion) food.lastPortion = r.lastPortion;
    if (r.portions) food.portions = r.portions;
    if (r.defaultPortionId) food.defaultPortionId = r.defaultPortionId;
    return food;
  }

  // Foods saved before this update with a label ("Remember This Food") have their own serving and numbers (what you had, "125g") next to the
  // label's (the whole "1 container (250g)"). Logging one serving used to mean your serving, so it still does: that amount becomes the
  // food's first portion, "Saved serving", once, the first time the food is used. Nothing else about the food changes.
  function savedServingPatch(f) {
    const FA = window.JarvisFoodAmount;
    if (!f || !f.label || !f.serving || f.serving === f.label.serving || (f.portions && f.portions.length) || f.lastPortion) return null;
    if (/^\s*[\d.]+\s*[x\u00d7]\s/i.test(f.serving)) return null;
    const e = FA.parseEntry(f.serving, null), base = FA.baseOf(f);
    if (!e || e.error || !base || !FA.unitAllowed(base, e.unit) || !FA.factorFor(base, e).ok) return null;
    return { portions: [{ id: "p_saved", name: "Saved serving", unit: e.unit, value: e.value }], defaultPortionId: "p_saved" };
  }

  // A food for the sheet, from the chooser or the library: { source, id, savedId?, name, serving, label?, numbers, portions ... } or null.
  function resolveFlowFood(source, id) {
    if (source === "saved") {
      let f = savedFoods.find(function (x) { return x.id === id; });
      if (!f) return null;
      const patch = savedServingPatch(f);
      if (patch) { const r = updateSavedFood(id, patch); if (r.ok) f = savedFoods.find(function (x) { return x.id === id; }) || f; }
      return Object.assign(copyOf(f), { source: "saved", savedId: f.id });
    }
    if (source === "recipe") {
      const r = recipes.find(function (x) { return x.id === id; });
      return r ? recipeAsFood(r) : null;
    }
    if (source === "recent") {
      const it = getRecentFoods(50).find(function (x) { return x.id === id; });
      if (!it) return null;
      const saved = it.foodId ? savedFoods.find(function (x) { return x.id === it.foodId; }) : null;
      if (saved) return Object.assign(copyOf(saved), { source: "saved", savedId: saved.id });
      const food = copyOf(it);
      delete food.id; delete food.createdAt; delete food.foodId; delete food.amount;
      food.source = "recent";
      if (it.amount) food.lastPortion = it.amount;
      return food;
    }
    return null;
  }

  function startFlow(opts) {
    const core = window.JarvisCore;
    if (!window.JarvisFoodFlow) { core.showToast("The food sheet didn't load. Reload the app and try again."); return; }
    const chooser = $("addFoodModal"), fromChooser = !!chooser && !chooser.classList.contains("hidden");
    if (fromChooser) core.closeModal("addFoodModal");
    window.JarvisFoodFlow.open(Object.assign({ meal: guessCurrentMeal() }, opts, {
      onBack: fromChooser ? function () { openAddFoodModal(addFoodModalTab); } : null
    }));
  }

  function openFlowFor(source, id) {
    const food = resolveFlowFood(source, id);
    if (!food) { window.JarvisCore.showToast("That food isn't there any more."); return; }
    startFlow({ mode: "log", start: "amount", food: food });
  }

  function handlePickerListClick(e) {
    const btn = e.target.closest(".picker-list-item");
    if (!btn) return;
    openFlowFor(btn.getAttribute("data-source"), btn.getAttribute("data-id"));
  }

  // What a logged line was made at, as an amount: the one it stored, else read from its serving text.
  function entryOfItem(item) {
    const FA = window.JarvisFoodAmount;
    const stored = FA.cleanEntry(item.amount);
    if (stored) return stored;
    const text = String(item.serving || "");
    const times = /^\s*(\d*\.?\d+)\s*[x×]\s/i.exec(text);
    if (times && Number(times[1]) > 0) return { value: Number(times[1]), unit: "serving" };
    const e = FA.parseEntry(text, null);
    if (e && !e.error && FA.factorFor(FA.baseOf({ label: item.label }), e).ok) return e;
    return { value: 1, unit: "serving" };
  }

  // The library: a food scanned (or checked by you) in the sheet. The same food again (same name) updates what is saved, and keeps its
  // favorite, portions and history; it never saves twice.  rec { id?, name, label {serving, size?, perContainer?, values}, isFruitVeg?, source, needsCheck? }
  function saveScannedFood(rec) {
    const FA = window.JarvisFoodAmount;
    const name = String(rec && rec.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return { ok: false, error: "Give the food a name." };
    const label = sanitizeLabel(rec.label);
    if (!label) return { ok: false, error: "There are no numbers to save." };
    let at = rec.id ? savedFoods.findIndex(function (f) { return f.id === rec.id; }) : -1;
    if (at === -1) at = savedFoods.findIndex(function (f) { return String(f.name).trim().toLowerCase() === name.toLowerCase(); });
    const prior = at === -1 ? null : savedFoods[at];
    const raw = Object.assign({}, prior ? copyOf(prior) : {}, { name: name, serving: label.serving, label: label, updatedAt: Date.now(), source: rec.source === "manual" ? "manual" : "scan" });
    if (rec.isFruitVeg !== undefined) raw.isFruitVeg = !!rec.isFruitVeg;
    MACRO_FIELDS.concat(MICRO_FIELDS).forEach(function (f) { delete raw[f]; if (label.values[f] !== undefined) raw[f] = label.values[f]; });
    raw.needsCheck = Array.isArray(rec.needsCheck) ? rec.needsCheck : [];
    const base = FA.baseOf({ label: label });
    if (prior && prior.portions) raw.portions = FA.cleanPortions(prior.portions).filter(function (p) { return FA.unitAllowed(base, p.unit); });
    const item = sanitizeFoodItem(raw);
    const changed = !prior || JSON.stringify(prior.label || null) !== JSON.stringify(item.label) || prior.name !== item.name;
    const prev = savedFoods;
    savedFoods = prior ? savedFoods.map(function (f, i) { return i === at ? item : f; }) : savedFoods.concat([item]);
    if (!saveSavedFoods()) { savedFoods = prev; return { ok: false, error: REFUSED }; }
    renderSavedFoods();
    return { ok: true, food: copyOf(item), created: !prior, changed: changed };
  }

  // Remembers what you used: last amount, when, and how often (saved foods and recipes). Not an error if the food is gone.
  function recordFlowUse(source, id, entry) {
    const FA = window.JarvisFoodAmount;
    if (source === "saved") {
      const f = savedFoods.find(function (x) { return x.id === id; });
      if (f) { updateSavedFood(id, FA.afterUse(f, entry, Date.now())); renderSavedFoods(); }
    } else if (source === "recipe") {
      const r = recipes.find(function (x) { return x.id === id; });
      if (r) updateRecipeFields(id, FA.afterUse(r, entry, Date.now()));
    }
  }

  // Portions, default and favorite of a saved food or a recipe, from the sheet. Only these keys are taken.
  function updateFlowSource(source, id, patch) {
    const FA = window.JarvisFoodAmount, p = {};
    if (patch.portions) p.portions = FA.cleanPortions(patch.portions);
    if (patch.defaultPortionId !== undefined) p.defaultPortionId = patch.defaultPortionId;
    if (patch.lastPortion) p.lastPortion = FA.cleanEntry(patch.lastPortion);
    if (source === "saved") {
      if (patch.favorite !== undefined) p.favorite = !!patch.favorite;
      const r = updateSavedFood(id, p);
      if (r.ok) renderSavedFoods();
      return r;
    }
    if (source === "recipe") return updateRecipeFields(id, p);
    return { ok: false, error: "That can only be saved for a saved food or a recipe." };
  }

  // Changes fields of a recipe without counting it as edited (its "updated" time stays).
  function updateRecipeFields(id, patch) {
    const idx = recipes.findIndex(function (r) { return r.id === id; });
    if (idx === -1) return { ok: false, error: "That recipe isn't there any more." };
    const prev = recipes, next = Object.assign({}, recipes[idx]);
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === "" || patch[k] === null || patch[k] === undefined || (Array.isArray(patch[k]) && !patch[k].length)) delete next[k]; else next[k] = patch[k];
    });
    if (next.defaultPortionId && !(next.portions || []).some(function (x) { return x.id === next.defaultPortionId; })) delete next.defaultPortionId;
    recipes = recipes.map(function (r, i) { return i === idx ? next : r; });
    if (!saveRecipes()) { recipes = prev; return { ok: false, error: REFUSED }; }
    return { ok: true };
  }

  // Puts an amount of a food in today's log. spec { meal, food, entry, source?, date? }. The numbers are worked out here, once, from the
  // food's label baseline, so the sheet can't hand over a figure that was already rounded.  -> { ok, item, message } | { ok: false, error }
  function addToLog(spec) {
    const core = window.JarvisCore, FA = window.JarvisFoodAmount;
    const food = spec && spec.food, entry = FA.cleanEntry(spec && spec.entry);
    if (MEALS.indexOf(spec && spec.meal) === -1) return { ok: false, error: "Pick a meal." };
    if (!food || !entry) return { ok: false, error: "Enter an amount above 0." };
    const c = FA.compute(food, entry);
    if (!c.ok) return { ok: false, error: c.message };
    const isRecipe = food.source === "recipe";
    const serving = isRecipe ? FA.describeEntry(entry) : c.serving;
    const raw = Object.assign({ name: isRecipe ? food.name + " (" + serving + ")" : food.name, serving: serving, isFruitVeg: !!food.isFruitVeg }, c.values);
    if (!isRecipe) {
      // The logged line keeps the label it was worked out from and the amount, so its amount can be changed later without a rescan.
      raw.label = food.label || { serving: food.serving || "1 serving", values: FA.valuesOf(food) };
      raw.amount = entry;
      if (food.savedId) raw.foodId = food.savedId;
    }
    const day = getDay(spec.date || core.todayISODate());
    const item = sanitizeFoodItem(raw);
    day.meals[spec.meal].push(item);
    if (!saveLog()) { day.meals[spec.meal].pop(); return { ok: false, error: REFUSED }; }
    renderFoodLog();
    renderDashboard();
    if (food.source === "saved" || isRecipe) recordFlowUse(food.source === "saved" ? "saved" : "recipe", food.savedId || food.id, entry);
    if (window.JarvisGroceries) {
      if (isRecipe && typeof window.JarvisGroceries.onRecipeLogged === "function") {
        const rec = recipes.find(function (r) { return r.id === food.id; });
        if (rec) window.JarvisGroceries.onRecipeLogged({ recipeId: rec.id, recipeName: rec.name, ingredients: rec.ingredients, recipeServings: rec.servings, servingsLogged: c.factor });
      } else if (!isRecipe && typeof window.JarvisGroceries.onSimpleFoodLogged === "function") {
        window.JarvisGroceries.onSimpleFoodLogged(food.name, serving);
      }
    }
    return { ok: true, item: copyOf(item), message: 'Added "' + food.name + '" to ' + MEAL_LABELS[spec.meal] + "." };
  }

  // Changes the amount of a line already in today's log, from the label it keeps. spec { meal, id, entry, date? }
  function replaceLogItem(spec) {
    const core = window.JarvisCore, FA = window.JarvisFoodAmount;
    const day = getDay(spec.date || core.todayISODate());
    const list = day.meals[spec.meal] || [];
    const at = list.findIndex(function (x) { return x.id === spec.id; });
    if (at === -1) return { ok: false, error: "That line isn't in the log any more." };
    const old = list[at], entry = FA.cleanEntry(spec.entry);
    if (!old.label || !entry) return { ok: false, error: "Enter an amount above 0." };
    const c = FA.compute({ name: old.name, serving: old.serving, label: old.label }, entry);
    if (!c.ok) return { ok: false, error: c.message };
    const raw = Object.assign({}, old, { serving: c.serving, amount: entry });
    MACRO_FIELDS.concat(MICRO_FIELDS).forEach(function (f) { delete raw[f]; });
    Object.assign(raw, c.values);
    const next = sanitizeFoodItem(raw);
    list[at] = next;
    if (!saveLog()) { list[at] = old; return { ok: false, error: REFUSED }; }
    renderFoodLog();
    renderDashboard();
    return { ok: true, item: copyOf(next), message: 'Changed "' + old.name + '" to ' + c.serving + "." };
  }

  // Saves a logged line to Saved Foods. A line made from a label saves that label (the baseline), not the amount you had.
  function saveLogItemAsFood(item) {
    if (item.foodId && savedFoods.some(function (f) { return f.id === item.foodId; })) return { ok: true, existed: true };
    const raw = item.label
      ? Object.assign({ name: item.name, serving: item.label.serving, isFruitVeg: item.isFruitVeg, label: item.label }, item.label.values)
      : Object.assign({}, item, { id: undefined, createdAt: undefined, amount: undefined, foodId: undefined });
    const food = sanitizeFoodItem(Object.assign(raw, { id: undefined, createdAt: undefined }));
    const same = savedFoods.some(function (f) { return String(f.name).toLowerCase() === food.name.toLowerCase() && String(f.serving || "").toLowerCase() === food.serving.toLowerCase(); });
    if (same) return { ok: true, existed: true };
    const prev = savedFoods;
    savedFoods = savedFoods.concat([food]);
    if (!saveSavedFoods()) { savedFoods = prev; return { ok: false, error: REFUSED }; }
    renderSavedFoods();
    return { ok: true, existed: false };
  }

  /* ---------------- boot ---------------- */

  function renderAll() {
    renderDashboard();
    renderFoodForm();
    renderFoodLog();
    renderSavedFoodForm();
    renderSavedFoods();
    renderIngredientRows();
    renderRecipes();
    renderFrequentFoods();
    renderNutrientsMacros();
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

  // For the Health overview: today's totals and targets exactly as the Today screen works them out (read only).
  function getToday() {
    const today = window.JarvisCore.todayISODate();
    const t = getDayTotals(today), g = getActiveTargets();
    return {
      date: today, entries: getAllEntries(today).length,
      calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat), water: t.water,
      targets: { calories: g.calories || 0, protein: g.protein || 0, carbs: g.carbs || 0, fat: g.fat || 0, water: g.water || 0 }
    };
  }

  // Food can be added/edited/removed from several different tabs (Food Log
  // directly, or "Add to Today" from Saved Foods/Recipes) — rather than
  // having every single mutation handler know about every other tab's
  // render function, each data-dependent tab just refreshes itself when the
  // user switches to it, so it's never showing stale numbers.
  function onSubTabChange(targetId) {
    if (targetId === "nutrition-dashboard") renderDashboard();
    if (targetId === "nutrition-foods") { renderFrequentFoods(); renderSavedFoods(); renderRecipes(); }
    if (targetId === "nutrition-nutrients") { renderNutrientsMacros(); renderNutrients(); }
    if (targetId === "nutrition-history") renderHistoryList();
    if (targetId === "nutrition-groceries" && window.JarvisGroceries) window.JarvisGroceries.onSubTabChange(targetId);
    if (targetId === "nutrition-mealprep" && window.JarvisMealPrep && window.JarvisMealPrep.onShow) window.JarvisMealPrep.onShow();
  }

  function init() {
    load();

    $("goalsModeCuttingBtn").addEventListener("click", function () { handleModeSwitch("cutting"); });
    $("goalsModeBulkingBtn").addEventListener("click", function () { handleModeSwitch("bulking"); });
    $("goalsForm").addEventListener("submit", handleGoalsFormSubmit);

    $("calcForm").addEventListener("submit", handleCalculatorFormSubmit);
    $("calcHeightUnitToggle").addEventListener("click", handleCalcUnitToggleClick);
    $("calcWeightUnitToggle").addEventListener("click", handleCalcUnitToggleClick);
    $("calcRecalculateBtn").addEventListener("click", handleRecalculateGoals);
    $("calcExplainBtn").addEventListener("click", handleExplainTargets);
    $("calcApplyBtn").addEventListener("click", handleApplyCalculatedTargets);
    updateCalculatorUnitVisibility();

    $("checkinForm").addEventListener("submit", handleCheckinFormSubmit);
    $("checkinTrendMessage").addEventListener("click", handleCheckinTrendClick);

    $("nutritionWaterAddBtn").addEventListener("click", function () { handleWaterAdjust(1); });
    $("nutritionWaterRemoveBtn").addEventListener("click", function () { handleWaterAdjust(-1); });

    $("nutMoreBtn").addEventListener("click", openTodayMenu);
    $("foodsAddBtn").addEventListener("click", openFoodsAddMenu);
    $("foodsFrequent").addEventListener("click", handleFrequentClick);
    Array.prototype.forEach.call(document.querySelectorAll("[data-foodsfilter]"), function (b) {
      b.addEventListener("click", function () { setFoodsFilter(b.getAttribute("data-foodsfilter")); });
    });

    $("foodOpenModalBtn").addEventListener("click", function () { openAddFoodModal(); });
    $("addFoodModalCloseBtn").addEventListener("click", closeAddFoodModal);
    $("addFoodTabs").addEventListener("click", function (e) {
      const btn = e.target.closest(".segmented-btn");
      if (!btn) return;
      addFoodModalTab = btn.getAttribute("data-tab");
      renderAddFoodModal();
    });
    $("recentFoodsList").addEventListener("click", handlePickerListClick);
    $("modalSavedFoodsList").addEventListener("click", handlePickerListClick);
    $("modalRecipesList").addEventListener("click", handlePickerListClick);
    $("modalSavedFoodSearchInput").addEventListener("input", function (e) {
      modalSavedFoodSearch = e.target.value;
      renderModalSavedFoodsList();
    });
    $("addFoodScanBtn").addEventListener("click", function () { startFlow({ mode: "log", start: "scan" }); });

    $("foodForm").addEventListener("submit", handleFoodFormSubmit);
    $("foodFormCancelBtn").addEventListener("click", handleFoodFormCancel);
    $("foodName").addEventListener("input", handleFoodNameInputForMatch);
    $("foodNameMatchUseBtn").addEventListener("click", handleFoodNameMatchUse);
    MEALS.forEach(function (meal) {
      const el = $("foodMeal_" + meal);
      if (el) el.addEventListener("click", handleFoodLogClick);
    });
    // Close an open food-item options menu on any click outside it.
    document.addEventListener("click", function (e) {
      if (foodItemMenuOpenKey && !e.target.closest(".food-item-menu-wrap")) {
        foodItemMenuOpenKey = null;
        foodItemMoveSubmenuOpen = false;
        renderFoodLog();
      }
    });

    $("savedFoodForm").addEventListener("submit", handleSavedFoodFormSubmit);
    $("savedFoodCancelBtn").addEventListener("click", resetSavedFoodForm);
    $("savedFoodsList").addEventListener("click", handleSavedFoodsClick);
    $("savedFoodPortions").addEventListener("click", handleSavedFoodPortionsClick);
    $("savedFoodPortionAddBtn").addEventListener("click", handleSavedFoodPortionAdd);
    $("savedFoodSearchInput").addEventListener("input", function (e) { savedFoodSearch = e.target.value; renderSavedFoods(); renderRecipes(); });
    $("savedFoodSortSelect").addEventListener("change", function (e) { savedFoodSort = e.target.value; renderSavedFoods(); });

    $("recipeForm").addEventListener("submit", handleRecipeFormSubmit);
    $("recipeAddIngredientBtn").addEventListener("click", handleAddIngredientRow);
    $("recipeFromFoodBtn").addEventListener("click", handleRecipeFromFood);
    $("recipeServings").addEventListener("input", renderRecipeSummary);
    $("recipeIngredientRows").addEventListener("input", handleIngredientRowsInput);
    $("recipeIngredientRows").addEventListener("click", handleIngredientRowsClick);
    $("recipeAiCalculateBtn").addEventListener("click", handleCalculateNutritionWithAI);
    $("recipeGoToAiConnectionsBtn").addEventListener("click", handleGoToAiConnections);
    $("recipeCancelBtn").addEventListener("click", resetRecipeForm);
    $("recipesList").addEventListener("click", handleRecipesListClick);

    $("historyDateList").addEventListener("click", handleHistoryDateListClick);
    $("historyRangeToggle").addEventListener("click", handleHistoryRangeClick);

    resetFoodForm();
    resetSavedFoodForm();
    resetRecipeForm();
    renderAll();

    // The app can stay open past midnight (a phone's home-screen app is put to sleep, not closed). Foods are always logged on the real
    // current day, but the totals on screen were drawn when it was yesterday. Draw them again when the day changes.
    nutritionDay = window.JarvisCore.todayISODate();
    document.addEventListener("visibilitychange", function () { if (!document.hidden) followTheClock(); });
    window.addEventListener("pageshow", followTheClock);
    window.setInterval(followTheClock, 30000);
  }

  let nutritionDay = "";
  function followTheClock() {
    const today = window.JarvisCore.todayISODate();
    if (!nutritionDay || today === nutritionDay) return;
    nutritionDay = today;
    renderDashboard();
    renderFoodLog();
    renderNutrientsMacros();
    renderNutrients();
    renderHistoryList();
  }

  /* ---- for Meal Prep (mealprep-*.js) ----
     Recipes and the food log live here, in memory, so Meal Prep reads and changes them only through these, never by writing the storage
     keys itself. A change is reported as made only if it was saved; if the browser refuses, it is taken back. */

  function copyOf(v) { return JSON.parse(JSON.stringify(v)); }
  function getRecipesCopy() { return recipes.map(copyOf); }
  const REFUSED = "That couldn't be saved. The browser may be full or blocking storage.";
  // Adds or replaces one recipe (by id). Whatever fields it carries are kept. -> { ok, recipe, error }
  function saveRecipeRecord(rec) {
    const core = window.JarvisCore;
    if (!rec || !String(rec.name || "").trim()) return { ok: false, error: "Give the recipe a name." };
    if (!Array.isArray(rec.ingredients) || !rec.ingredients.length) return { ok: false, error: "Add at least one ingredient." };
    const saved = Object.assign({}, copyOf(rec), { id: rec.id || core.uid("recipe"), updatedAt: Date.now() });
    if (!saved.createdAt) saved.createdAt = Date.now();
    const prev = recipes, at = recipes.findIndex(function (r) { return r.id === saved.id; });
    recipes = at === -1 ? recipes.concat([saved]) : recipes.map(function (r, i) { return i === at ? saved : r; });
    if (!saveRecipes()) { recipes = prev; return { ok: false, error: REFUSED }; }
    renderRecipes();
    return { ok: true, recipe: copyOf(saved) };
  }
  function deleteRecipeRecord(id) {
    const prev = recipes;
    if (!recipes.some(function (r) { return r.id === id; })) return { ok: false, error: "That recipe isn't there any more." };
    recipes = recipes.filter(function (r) { return r.id !== id; });
    if (!saveRecipes()) { recipes = prev; return { ok: false, error: REFUSED }; }
    renderRecipes();
    return { ok: true };
  }
  // What a day's log adds up to (read only).
  function dayTotalsFor(date) {
    const t = getDayTotals(date);
    return { calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat), water: t.water, entries: getAllEntries(date).length };
  }
  function getTargets() { const g = getActiveTargets(); return { calories: g.calories || 0, protein: g.protein || 0, carbs: g.carbs || 0, fat: g.fat || 0, water: g.water || 0, mode: getMode() }; }
  // One line in the food log (a snapshot of the numbers, so a recipe edited later does not change it). o: { date, meal, name, serving, calories, protein, carbs, fat }
  function logMealItem(o) {
    if (MEALS.indexOf(o.meal) === -1 || !/^\d{4}-\d{2}-\d{2}$/.test(o.date || "")) return { ok: false, error: "That isn't a meal or a day." };
    const day = getDay(o.date), raw = { name: o.name, serving: o.serving || "1 serving", calories: o.calories, protein: o.protein, carbs: o.carbs, fat: o.fat };
    ["fiber", "isFruitVeg", "label", "amount", "foodId"].concat(MICRO_FIELDS).forEach(function (k) { if (o[k] !== undefined) raw[k] = o[k]; });
    const item = sanitizeFoodItem(raw);
    day.meals[o.meal].push(item);
    if (!saveLog()) { day.meals[o.meal].pop(); return { ok: false, error: REFUSED }; }
    renderFoodLog(); renderDashboard();
    return { ok: true, id: item.id };
  }
  // The foods you saved (Foods tab). Meal Prep searches them and can save a new one. A food with the same name and serving is not saved twice.
  function getSavedFoodsCopy() { return savedFoods.map(copyOf); }
  function saveFoodRecord(o) {
    const name = String(o && o.name || "").replace(/\s+/g, " ").trim();
    if (!name) return { ok: false, error: "Give the food a name." };
    const serving = String(o.serving || "").trim().slice(0, 40);
    const same = savedFoods.filter(function (f) { return String(f.name).toLowerCase() === name.toLowerCase() && String(f.serving || "").toLowerCase() === serving.toLowerCase(); })[0];
    if (same) return { ok: true, food: copyOf(same), existed: true };
    const item = sanitizeFoodItem({ name: name, serving: serving, calories: o.calories, protein: o.protein, carbs: o.carbs, fat: o.fat });
    const prev = savedFoods;
    savedFoods = savedFoods.concat([item]);
    if (!saveSavedFoods()) { savedFoods = prev; return { ok: false, error: REFUSED }; }
    renderSavedFoods();
    return { ok: true, food: copyOf(item), existed: false };
  }
  // Is this line still in the food log? (so a plan can tell whether what it logged is still there)
  function hasMealItem(date, meal, id) { return (peekDay(date).meals[meal] || []).some(function (x) { return x.id === id; }); }
  function removeMealItem(date, meal, id) {
    const list = peekDay(date).meals[meal] || [];
    if (!list.some(function (x) { return x.id === id; })) return { ok: true, gone: true };       // already removed by hand
    const day = getDay(date), prev = day.meals[meal];
    day.meals[meal] = prev.filter(function (x) { return x.id !== id; });
    if (!saveLog()) { day.meals[meal] = prev; return { ok: false, error: REFUSED }; }
    renderFoodLog(); renderDashboard();
    return { ok: true };
  }

  window.JarvisNutrition = {
    init: init, getSummary: getSummary, getToday: getToday, onSubTabChange: onSubTabChange,
    recipes: { all: getRecipesCopy, save: saveRecipeRecord, remove: deleteRecipeRecord },
    savedFoods: { all: getSavedFoodsCopy, save: saveFoodRecord },
    // The library, for the food sheet and Meal Prep: a saved food by id, favorites.
    foods: {
      all: getSavedFoodsCopy,
      get: function (id) { const f = savedFoods.find(function (x) { return x.id === id; }); return f ? copyOf(f) : null; },
      setFavorite: function (id, on) { return updateFlowSource("saved", id, { favorite: !!on }); }
    },
    // What the food sheet (js/food-flow-ui.js) uses. It never writes the storage keys itself.
    flow: {
      mealLabels: MEAL_LABELS, guessMeal: guessCurrentMeal, resolve: resolveFlowFood, recipeAsFood: recipeAsFood,
      saveScanned: saveScannedFood, addToLog: addToLog, replaceLogItem: replaceLogItem, recordUse: recordFlowUse, update: updateFlowSource,
      findSavedByName: function (name) { const n = String(name || "").trim().toLowerCase(); const f = n ? savedFoods.find(function (x) { return String(x.name).trim().toLowerCase() === n; }) : null; return f ? copyOf(f) : null; },
      searchSaved: function (q) { const x = String(q || "").trim().toLowerCase(); return savedFoods.filter(function (f) { return f && typeof f.name === "string" && savedFoodMatches(f, x); }).map(copyOf); }
    },
    openAddFood: openAddFoodModal,
    log: { totals: dayTotalsFor, targets: getTargets, add: logMealItem, remove: removeMealItem, has: hasMealItem }
  };
})();
