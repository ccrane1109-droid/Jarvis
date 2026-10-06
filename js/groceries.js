/* ==========================================================================
   JARVIS — Groceries (Nutrition > Groceries)
   Automatically keeps a grocery list synced with planned/recurring meals and
   saved recipes already tracked elsewhere in the app. Builds entirely on top
   of js/nutrition.js's existing data (recipes, food log) — never a parallel
   food database, never a fabricated number. Quantities computed from recipe
   ingredient text the user already typed; anything that can't be parsed
   falls back to "1 each" rather than guessing. Pantry amounts derived from
   consumption are always estimates and can be corrected manually at any time.

   localStorage keys:
     jarvisGroceryPantry   — { "<lowercased ingredient name>": {name, quantity,
                               unit, source: "estimate"|"manual"|"purchase",
                               updatedAt} }
     jarvisGroceryList     — [ {id, name, category, quantity, unit, purchased,
                               manual, excluded, userEdited, neededFor:[text],
                               note, addedAt} ]
     jarvisGroceryMealPlan — [ {id, type:"single"|"recurring", date, days:[0-6],
                               meal, recipeId, recipeName, servings,
                               isRestaurant, includeInGroceries,
                               completedDates:[date], createdAt} ]
     jarvisGroceryPrefs    — { setupDone, shoppingDay (0-6), horizonDays,
                               weeklyReplenish: { "<name>": {enabled, qty,
                               unit, displayName} } }
     jarvisGroceryChangelog — the single most recent sync's change message +
                               an undo snapshot, or null. Only one level of
                               undo is kept (same spirit as a normal "undo
                               last action" toast, not a full history).

   Reads js/nutrition.js's jarvisNutritionRecipes (to resolve ingredients) and
   jarvisNutritionLog (read-only, to suggest regularly-eaten foods) directly
   from localStorage rather than depending on nutrition.js exporting its
   private state. Two small, defensive hook calls from nutrition.js
   (onRecipeLogged / onSimpleFoodLogged) are the only coupling in the other
   direction, and both no-op safely if this module isn't loaded.
   ========================================================================== */

(function () {
  "use strict";

  const LS_PANTRY = "jarvisGroceryPantry";
  const LS_LIST = "jarvisGroceryList";
  const LS_PLAN = "jarvisGroceryMealPlan";
  const LS_PREFS = "jarvisGroceryPrefs";
  const LS_CHANGELOG = "jarvisGroceryChangelog";
  const LS_RECIPES = "jarvisNutritionRecipes";
  const LS_LOG = "jarvisNutritionLog";

  const MEALS = ["breakfast", "lunch", "dinner", "snacks"];
  const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const CATEGORIES = [
    "Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Grains & Pasta",
    "Canned & Jarred", "Frozen", "Condiments & Sauces", "Spices & Seasonings",
    "Snacks", "Beverages", "Other"
  ];

  const CATEGORY_KEYWORDS = {
    "Produce": ["apple", "banana", "lettuce", "spinach", "kale", "onion", "garlic", "tomato", "potato", "carrot", "pepper", "cucumber", "broccoli", "cauliflower", "avocado", "lemon", "lime", "berry", "berries", "grape", "orange", "mushroom", "zucchini", "squash", "herb", "cilantro", "parsley", "basil", "ginger", "celery", "corn", "cabbage"],
    "Meat & Seafood": ["chicken", "beef", "turkey", "pork", "steak", "bacon", "sausage", "ham", "lamb", "shrimp", "salmon", "tuna", "fish", "cod", "tilapia", "ground"],
    "Dairy & Eggs": ["milk", "cheese", "yogurt", "butter", "cream", "egg", "sour cream", "cottage cheese"],
    "Bakery": ["bread", "bagel", "tortilla", "bun", "roll", "muffin", "pita", "naan"],
    "Grains & Pasta": ["rice", "pasta", "noodle", "quinoa", "oat", "cereal", "flour", "couscous", "spaghetti"],
    "Canned & Jarred": ["canned", "can of", "beans", "chickpea", "lentil", "broth", "stock", "tomato sauce", "tomato paste", "salsa", "jam", "jelly", "pickle"],
    "Frozen": ["frozen"],
    "Condiments & Sauces": ["ketchup", "mustard", "mayo", "mayonnaise", "sauce", "dressing", "vinegar", "soy sauce", "oil", "olive oil", "honey", "syrup"],
    "Spices & Seasonings": ["salt", "pepper", "cumin", "paprika", "oregano", "cinnamon", "spice", "seasoning", "chili powder", "garlic powder", "onion powder", "bay leaf"],
    "Snacks": ["chips", "crackers", "popcorn", "pretzel", "granola bar", "nuts", "almond", "cashew", "peanut"],
    "Beverages": ["juice", "soda", "water", "coffee", "tea", "wine", "beer", "sparkling"]
  };

  const UNIT_ALIASES = {
    g: "g", gram: "g", grams: "g",
    kg: "kg", kilogram: "kg", kilograms: "kg",
    oz: "oz", ounce: "oz", ounces: "oz",
    lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
    ml: "ml", milliliter: "ml", milliliters: "ml",
    l: "l", liter: "l", liters: "l",
    tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
    tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
    cup: "cup", cups: "cup",
    qt: "qt", quart: "qt", quarts: "qt",
    pt: "pt", pint: "pt", pints: "pt",
    gal: "gal", gallon: "gal", gallons: "gal",
    can: "can", cans: "can",
    clove: "clove", cloves: "clove",
    slice: "slice", slices: "slice",
    piece: "each", pieces: "each", item: "each", items: "each", each: "each",
    bunch: "bunch", bunches: "bunch",
    package: "package", packages: "package", pkg: "package",
    head: "head", heads: "head"
  };
  const UNIT_LIST = ["each", "g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "qt", "pt", "gal", "can", "clove", "slice", "bunch", "package", "head"];
  const MASS_TO_G = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
  const VOLUME_TO_ML = { ml: 1, l: 1000, tsp: 4.92892, tbsp: 14.7868, cup: 236.588, qt: 946.353, pt: 473.176, gal: 3785.41 };

  let pantry = {};
  let groceryList = [];
  let mealPlan = [];
  let prefs = { setupDone: false, shoppingDay: 0, horizonDays: 7, weeklyReplenish: {} };
  let changelog = null;

  // transient editor state
  let showSetupForm = false;
  let planFormVisible = false;
  let planFormEditId = null;
  let planFormType = "single";
  let planFormDays = [];
  let showPlanDetails = {}; // planId -> bool, unused placeholder for future expand
  let showChangeDetails = false;

  function $(id) { return document.getElementById(id); }

  /* ---------------- persistence ---------------- */

  function load() {
    const core = window.JarvisCore;
    pantry = core.loadJSON(LS_PANTRY, {}) || {};
    groceryList = core.loadJSON(LS_LIST, []) || [];
    mealPlan = core.loadJSON(LS_PLAN, []) || [];
    const loadedPrefs = core.loadJSON(LS_PREFS, null);
    prefs = loadedPrefs ? Object.assign({ setupDone: false, shoppingDay: 0, horizonDays: 7, weeklyReplenish: {} }, loadedPrefs) : prefs;
    changelog = core.loadJSON(LS_CHANGELOG, null);
    showSetupForm = !prefs.setupDone;
  }

  function savePantry() { window.JarvisCore.saveJSON(LS_PANTRY, pantry); }
  function saveList() { window.JarvisCore.saveJSON(LS_LIST, groceryList); }
  function savePlan() { window.JarvisCore.saveJSON(LS_PLAN, mealPlan); }
  function savePrefs() { window.JarvisCore.saveJSON(LS_PREFS, prefs); }
  function saveChangelog() { window.JarvisCore.saveJSON(LS_CHANGELOG, changelog); }

  function getRecipes() { return window.JarvisCore.loadJSON(LS_RECIPES, []) || []; }
  function getNutritionLog() { return window.JarvisCore.loadJSON(LS_LOG, {}) || {}; }

  /* ---------------- units ---------------- */

  function normalizeUnit(u) {
    const key = String(u || "").trim().toLowerCase().replace(/\.$/, "");
    return UNIT_ALIASES[key] || null;
  }

  function parseMixedNumber(token) {
    if (!token) return 0;
    if (token.indexOf(" ") !== -1) {
      const parts = token.split(" ").filter(Boolean);
      return parts.reduce(function (sum, p) { return sum + parseMixedNumber(p); }, 0);
    }
    if (token.indexOf("/") !== -1) {
      const parts = token.split("/");
      const n = Number(parts[0]), d = Number(parts[1]);
      return d ? n / d : 0;
    }
    return Number(token) || 0;
  }

  // "2 cups", "1.5 lb", "1/2 tsp", "2 cloves, minced", "3" -> {amount, unit}.
  // Unparseable or empty text becomes "1 each" rather than invented detail.
  function parseQuantityString(str) {
    const s = String(str || "").trim().toLowerCase();
    if (!s) return { amount: 1, unit: "each" };
    const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*([a-z]*)/);
    if (!m || !m[1]) return { amount: 1, unit: "each" };
    const amount = parseMixedNumber(m[1]);
    const unit = normalizeUnit(m[2]) || "each";
    return { amount: (isFinite(amount) && amount > 0) ? amount : 1, unit: unit };
  }

  function unitGroup(unit) {
    if (MASS_TO_G[unit] !== undefined) return "mass";
    if (VOLUME_TO_ML[unit] !== undefined) return "volume";
    return "count";
  }

  // Converts an amount between compatible units; returns null when the two
  // units aren't in the same measurement family (e.g. "cup" vs "lb") rather
  // than silently producing a meaningless number.
  function convertQuantity(amount, fromUnit, toUnit) {
    if (fromUnit === toUnit) return amount;
    const g1 = unitGroup(fromUnit), g2 = unitGroup(toUnit);
    if (g1 !== g2) return null;
    if (g1 === "mass") return amount * MASS_TO_G[fromUnit] / MASS_TO_G[toUnit];
    if (g1 === "volume") return amount * VOLUME_TO_ML[fromUnit] / VOLUME_TO_ML[toUnit];
    return null; // two different count-style units (e.g. "can" vs "clove") can't be combined
  }

  function combineIntoBuckets(buckets, amount, unit) {
    for (let i = 0; i < buckets.length; i++) {
      const converted = convertQuantity(amount, unit, buckets[i].unit);
      if (converted !== null) { buckets[i].amount += converted; return; }
    }
    buckets.push({ amount: amount, unit: unit });
  }

  function formatQty(amount, unit) {
    const rounded = Math.round(amount * 100) / 100;
    return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, "")) + " " + unit;
  }

  /* ---------------- category guess ---------------- */

  function guessCategory(name) {
    const n = String(name || "").toLowerCase();
    for (let i = 0; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];
      const words = CATEGORY_KEYWORDS[cat];
      if (words && words.some(function (w) { return n.indexOf(w) !== -1; })) return cat;
    }
    return "Other";
  }

  /* ---------------- meal plan ---------------- */

  function keyFor(name) { return String(name || "").trim().toLowerCase(); }

  function todayISO() { return window.JarvisCore.todayISODate(); }

  function addDaysISO(iso, days) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function dateDayOfWeek(iso) { return new Date(iso + "T00:00:00").getDay(); }

  // Expands single + recurring plan entries into concrete dated occurrences
  // within the sync horizon, skipping ones already marked completed and
  // (by default) restaurant/takeout meals.
  function upcomingOccurrences(horizonDays, includeRestaurant) {
    const today = todayISO();
    const out = [];
    mealPlan.forEach(function (p) {
      if (p.isRestaurant && !p.includeInGroceries && !includeRestaurant) return;
      if (p.type === "single") {
        if (p.date >= today && p.date < addDaysISO(today, horizonDays)) {
          if ((p.completedDates || []).indexOf(p.date) === -1) {
            out.push({ planId: p.id, date: p.date, meal: p.meal, recipeId: p.recipeId, recipeName: p.recipeName, servings: p.servings });
          }
        }
      } else if (p.type === "recurring") {
        for (let i = 0; i < horizonDays; i++) {
          const d = addDaysISO(today, i);
          if ((p.days || []).indexOf(dateDayOfWeek(d)) !== -1 && (p.completedDates || []).indexOf(d) === -1) {
            out.push({ planId: p.id, date: d, meal: p.meal, recipeId: p.recipeId, recipeName: p.recipeName, servings: p.servings });
          }
        }
      }
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return out;
  }

  function addPlanEntry(data) {
    mealPlan.push({
      id: window.JarvisCore.uid("plan"),
      type: data.type, date: data.date || null, days: data.days || null,
      meal: data.meal, recipeId: data.recipeId || null, recipeName: data.recipeName,
      servings: data.servings, isRestaurant: !!data.isRestaurant,
      includeInGroceries: !!data.includeInGroceries, completedDates: [], createdAt: Date.now()
    });
    savePlan();
  }

  function updatePlanEntry(id, data) {
    const idx = mealPlan.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return;
    mealPlan[idx] = Object.assign({}, mealPlan[idx], data);
    savePlan();
  }

  function removePlanEntry(id) {
    mealPlan = mealPlan.filter(function (p) { return p.id !== id; });
    savePlan();
  }

  /* ---------------- pantry ---------------- */

  // delta > 0 adds to pantry (purchase / "already have" / correction),
  // delta < 0 consumes from it (eating a logged recipe); never below 0.
  function adjustPantry(name, delta, unit, source) {
    const key = keyFor(name);
    const existing = pantry[key];
    if (!existing) {
      if (delta <= 0) return;
      pantry[key] = { name: name, quantity: delta, unit: unit, source: source, updatedAt: Date.now() };
    } else {
      const converted = convertQuantity(delta, unit, existing.unit);
      if (converted === null) {
        // Incompatible units for the same ingredient (rare) — only apply
        // when adding a fresh positive amount; otherwise leave it alone
        // rather than guess a conversion.
        if (delta > 0) { existing.quantity += delta; existing.unit = existing.unit; }
      } else {
        existing.quantity = Math.max(0, existing.quantity + converted);
      }
      existing.updatedAt = Date.now();
      if (source === "manual" || source === "purchase") existing.source = source;
    }
    savePantry();
  }

  function setPantryManual(name, amount, unit) {
    const key = keyFor(name);
    pantry[key] = { name: name, quantity: amount, unit: unit, source: "manual", updatedAt: Date.now() };
    savePantry();
  }

  function removePantryItem(key) {
    delete pantry[key];
    savePantry();
  }

  /* ---------------- sync engine ---------------- */

  function snapshot() {
    return {
      list: JSON.parse(JSON.stringify(groceryList)),
      pantry: JSON.parse(JSON.stringify(pantry))
    };
  }

  function isLocked(item) { return !!(item.manual || item.userEdited || item.excluded || item.purchased); }

  function recomputeGroceryList() {
    const before = snapshot();
    const recipes = getRecipes();
    const occurrences = upcomingOccurrences(prefs.horizonDays || 7, false);

    // name -> { buckets:[{amount,unit}], sources:Set(labels), category }
    const demand = {};
    function addDemand(name, amount, unit, sourceLabel) {
      const key = keyFor(name);
      if (!demand[key]) demand[key] = { name: name, buckets: [], sources: [] };
      combineIntoBuckets(demand[key].buckets, amount, unit);
      if (sourceLabel && demand[key].sources.indexOf(sourceLabel) === -1) demand[key].sources.push(sourceLabel);
    }

    occurrences.forEach(function (occ) {
      if (!occ.recipeId) return; // custom/no-recipe meal — surfaced separately, never fabricated
      const recipe = recipes.find(function (r) { return r.id === occ.recipeId; });
      if (!recipe || !recipe.servings) return;
      const ratio = occ.servings / recipe.servings;
      const dayLabel = DAY_SHORT[dateDayOfWeek(occ.date)] + " " + MEAL_LABELS[occ.meal];
      recipe.ingredients.forEach(function (ing) {
        const q = parseQuantityString(ing.quantity);
        addDemand(ing.name, q.amount * ratio, q.unit, recipe.name + " (" + dayLabel + ")");
      });
    });

    // Weekly-replenish foods the user has flagged for automatic restocking.
    Object.keys(prefs.weeklyReplenish || {}).forEach(function (key) {
      const w = prefs.weeklyReplenish[key];
      if (!w || !w.enabled) return;
      addDemand(w.displayName || key, Number(w.qty) || 1, w.unit || "each", "Weekly restock");
    });

    // Subtract what's already on hand (read-only against pantry itself).
    Object.keys(demand).forEach(function (key) {
      const d = demand[key];
      const have = pantry[key];
      if (!have) return;
      d.buckets.forEach(function (b) {
        const haveConverted = convertQuantity(have.quantity, have.unit, b.unit);
        if (haveConverted !== null) b.amount = Math.max(0, b.amount - haveConverted);
      });
    });

    // Build the new set of auto (unlocked) items from remaining demand.
    const lockedByKey = {};
    groceryList.filter(isLocked).forEach(function (item) { lockedByKey[keyFor(item.name)] = item; });

    const newAutoItems = [];
    Object.keys(demand).forEach(function (key) {
      if (lockedByKey[key]) return; // a manual/edited/excluded/purchased line already covers this ingredient
      const d = demand[key];
      d.buckets.forEach(function (b, i) {
        if (b.amount <= 0.0001) return;
        const prior = groceryList.find(function (it) { return !isLocked(it) && keyFor(it.name) === key && it.unit === b.unit; });
        newAutoItems.push({
          id: prior ? prior.id : window.JarvisCore.uid("grocery"),
          name: d.name, category: guessCategory(d.name),
          quantity: Math.round(b.amount * 100) / 100, unit: b.unit,
          purchased: false, manual: false, excluded: false, userEdited: false,
          neededFor: d.sources.slice(), addedAt: prior ? prior.addedAt : Date.now()
        });
      });
    });

    const oldAuto = groceryList.filter(function (it) { return !isLocked(it); });
    const lockedItems = groceryList.filter(isLocked);
    groceryList = lockedItems.concat(newAutoItems);
    saveList();

    // Human-readable diff for the update banner.
    const added = [], increased = [], decreased = [], removed = [];
    newAutoItems.forEach(function (item) {
      const old = oldAuto.find(function (o) { return o.id === item.id; });
      if (!old) added.push(item);
      else if (item.quantity > old.quantity + 0.01) increased.push(item);
      else if (item.quantity < old.quantity - 0.01) decreased.push(item);
    });
    oldAuto.forEach(function (old) {
      if (!newAutoItems.some(function (n) { return n.id === old.id; })) removed.push(old);
    });

    const changed = added.length + increased.length + decreased.length + removed.length;
    if (changed > 0) {
      let message, details = [];
      if (changed === 1) {
        if (added[0]) message = "Added " + formatQty(added[0].quantity, added[0].unit) + " of " + added[0].name + " for your upcoming meals.";
        else if (increased[0]) message = "Increased " + increased[0].name + " to " + formatQty(increased[0].quantity, increased[0].unit) + ".";
        else if (decreased[0]) message = "Reduced " + decreased[0].name + " to " + formatQty(decreased[0].quantity, decreased[0].unit) + ".";
        else message = "Removed " + removed[0].name + " — no longer needed.";
      } else {
        message = "Updated " + changed + " grocery item" + (changed === 1 ? "" : "s") + " based on your meal plan.";
      }
      added.forEach(function (i) { details.push("Added " + formatQty(i.quantity, i.unit) + " " + i.name); });
      increased.forEach(function (i) { details.push("Increased " + i.name + " to " + formatQty(i.quantity, i.unit)); });
      decreased.forEach(function (i) { details.push("Reduced " + i.name + " to " + formatQty(i.quantity, i.unit)); });
      removed.forEach(function (i) { details.push("Removed " + i.name); });
      changelog = { message: message, details: details, timestamp: Date.now(), snapshot: before };
      saveChangelog();
      showChangeDetails = false;
    }
  }

  function undoLastChange() {
    if (!changelog || !changelog.snapshot) return;
    groceryList = changelog.snapshot.list;
    pantry = changelog.snapshot.pantry;
    saveList();
    savePantry();
    changelog = null;
    saveChangelog();
    window.JarvisCore.showToast("Change undone.");
    renderAll();
  }

  function dismissChangeBanner() {
    changelog = null;
    saveChangelog();
    renderUpdateBanner();
  }

  /* ---------------- hooks called from nutrition.js ---------------- */

  // payload: {recipeId, recipeName, ingredients, recipeServings, servingsLogged}
  function onRecipeLogged(payload) {
    if (!payload || !payload.ingredients || !payload.recipeServings) return;
    const ratio = (payload.servingsLogged || 1) / payload.recipeServings;
    payload.ingredients.forEach(function (ing) {
      const q = parseQuantityString(ing.quantity);
      adjustPantry(ing.name, -(q.amount * ratio), q.unit, "estimate");
    });
    // Mark the first matching, not-yet-completed planned occurrence for
    // today as eaten so it stops generating future demand (no double count).
    const today = todayISO();
    const occ = upcomingOccurrences(prefs.horizonDays || 7, true)
      .find(function (o) { return o.date === today && o.recipeId === payload.recipeId; });
    if (occ) {
      const plan = mealPlan.find(function (p) { return p.id === occ.planId; });
      if (plan) {
        plan.completedDates = (plan.completedDates || []).concat([today]);
        savePlan();
      }
    }
    recomputeGroceryList();
    renderAll();
  }

  // Best-effort pantry decrement for a simple (non-recipe) logged food, e.g.
  // logging "Banana" or "Milk" straight from Saved/Recent. Only acts when
  // the name is already something we're tracking (in pantry or flagged for
  // weekly replenishment) — never invents ingredients for a mixed dish.
  function onSimpleFoodLogged(name, servingText) {
    const key = keyFor(name);
    if (!pantry[key] && !(prefs.weeklyReplenish && prefs.weeklyReplenish[key])) return;
    const q = parseQuantityString(servingText);
    adjustPantry(name, -q.amount, q.unit, "estimate");
    recomputeGroceryList();
    renderAll();
  }

  /* ---------------- regularly eaten foods ---------------- */

  function computeRegularlyEatenFoods() {
    const log = getNutritionLog();
    const recipeNames = getRecipes().map(function (r) { return keyFor(r.name); });
    const cutoff = addDaysISO(todayISO(), -30);
    const counts = {}; // key -> {name, days:Set, lastServing}
    Object.keys(log).forEach(function (date) {
      if (date < cutoff) return;
      const day = log[date];
      if (!day || !day.meals) return;
      MEALS.forEach(function (meal) {
        (day.meals[meal] || []).forEach(function (item) {
          const key = keyFor(item.name);
          if (!key) return;
          if (recipeNames.indexOf(key) !== -1 || / \(1 serving\)$/.test(item.name)) return; // recipe reheats handled via meal plan
          if (!counts[key]) counts[key] = { key: key, name: item.name, days: {}, lastServing: item.serving };
          counts[key].days[date] = true;
          counts[key].lastServing = item.serving;
        });
      });
    });
    return Object.keys(counts).map(function (key) {
      const c = counts[key];
      return { key: key, name: c.name, frequency: Object.keys(c.days).length, lastServing: c.lastServing };
    }).filter(function (c) { return c.frequency >= 3; })
      .sort(function (a, b) { return b.frequency - a.frequency; })
      .slice(0, 10);
  }

  function toggleWeeklyReplenish(key, name, lastServing) {
    if (!prefs.weeklyReplenish) prefs.weeklyReplenish = {};
    const existing = prefs.weeklyReplenish[key];
    if (existing && existing.enabled) {
      existing.enabled = false;
    } else {
      const q = parseQuantityString(lastServing);
      prefs.weeklyReplenish[key] = { enabled: true, qty: q.amount, unit: q.unit, displayName: name };
    }
    savePrefs();
    recomputeGroceryList();
    renderAll();
  }

  /* ---------------- rendering ---------------- */

  function renderSetup() {
    const card = $("grocerySetupCard");
    if (!card) return;
    $("grocerySetupSummary").classList.toggle("hidden", showSetupForm);
    $("grocerySetupForm").classList.toggle("hidden", !showSetupForm);
    if (!showSetupForm) {
      $("grocerySetupSummaryText").textContent = "Shopping day: " + DAY_NAMES[prefs.shoppingDay] + ".";
    } else {
      $("groceryShoppingDaySelect").value = String(prefs.shoppingDay);
    }
  }

  function renderUpdateBanner() {
    const banner = $("groceryUpdateBanner");
    if (!banner) return;
    if (!changelog) { banner.classList.add("hidden"); return; }
    banner.classList.remove("hidden");
    $("groceryUpdateMessage").textContent = changelog.message;
    const detailsList = $("groceryUpdateDetailsList");
    const hasDetails = changelog.details && changelog.details.length > 1;
    $("groceryUpdateDetailsToggle").classList.toggle("hidden", !hasDetails);
    detailsList.classList.toggle("hidden", !showChangeDetails || !hasDetails);
    if (hasDetails) detailsList.innerHTML = changelog.details.map(function (d) { return "<li>" + window.JarvisCore.escapeHtml(d) + "</li>"; }).join("");
  }

  function planOccurrenceLabel(occ) {
    const d = new Date(occ.date + "T00:00:00");
    const label = (occ.date === todayISO()) ? "Today" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return label + " &middot; " + MEAL_LABELS[occ.meal];
  }

  function renderPlanList() {
    const core = window.JarvisCore;
    const container = $("groceryPlanList");
    if (!container) return;
    const occurrences = upcomingOccurrences(prefs.horizonDays || 7, true);
    if (occurrences.length === 0) {
      container.innerHTML = '<div class="empty-state">No planned meals yet. Add one below.</div>';
    } else {
      container.innerHTML = occurrences.map(function (occ) {
        const plan = mealPlan.find(function (p) { return p.id === occ.planId; });
        if (!plan) return "";
        const restaurantBadge = plan.isRestaurant ? '<span class="badge badge-neutral">Restaurant' + (plan.includeInGroceries ? "" : " &middot; excluded") + '</span>' : "";
        const noRecipeBadge = !occ.recipeId ? '<span class="badge badge-neutral">No ingredients on file</span>' : "";
        return (
          '<div class="list-item" data-plan-id="' + core.escapeHtml(plan.id) + '" data-date="' + occ.date + '">' +
            '<div class="list-item-row">' +
              '<div class="list-item-main">' +
                '<span class="list-item-title">' + planOccurrenceLabel(occ) + ' &middot; ' + core.escapeHtml(occ.recipeName) + ' ' + restaurantBadge + ' ' + noRecipeBadge + '</span>' +
                '<span class="list-item-meta">' + occ.servings + ' serving' + (occ.servings === 1 ? "" : "s") + (plan.type === "recurring" ? " &middot; recurring" : "") + '</span>' +
              '</div>' +
              '<div class="list-item-actions">' +
                '<button type="button" class="btn-icon plan-mark-eaten-btn" data-plan-id="' + core.escapeHtml(plan.id) + '" data-date="' + occ.date + '">Mark Eaten</button>' +
                '<button type="button" class="btn-icon plan-edit-btn" data-id="' + core.escapeHtml(plan.id) + '">Edit</button>' +
                '<button type="button" class="btn-icon danger plan-delete-btn" data-id="' + core.escapeHtml(plan.id) + '">Delete</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join("");
    }

    const needsDetails = mealPlan.filter(function (p) { return !p.recipeId; });
    const detailsCard = $("groceryPlanNeedsDetailsCard");
    if (detailsCard) {
      detailsCard.classList.toggle("hidden", needsDetails.length === 0);
      $("groceryPlanNeedsDetails").innerHTML = needsDetails.map(function (p) {
        return '<div class="list-item"><div class="list-item-row"><div class="list-item-main">' +
          '<span class="list-item-title">' + core.escapeHtml(p.recipeName) + '</span>' +
          '<span class="list-item-meta">No ingredients on file — save this as a Recipe with ingredients to include it in automatic grocery calculations.</span>' +
          '</div></div></div>';
      }).join("");
    }
  }

  function renderRecipeOptions(selectEl, selectedId) {
    const core = window.JarvisCore;
    const recipes = getRecipes();
    selectEl.innerHTML = '<option value="">Custom (no recipe on file)</option>' +
      recipes.map(function (r) { return '<option value="' + core.escapeHtml(r.id) + '">' + core.escapeHtml(r.name) + '</option>'; }).join("");
    selectEl.value = selectedId || "";
  }

  function renderPlanForm() {
    const form = $("groceryPlanForm");
    if (!form) return;
    form.classList.toggle("hidden", !planFormVisible);
    $("groceryPlanAddToggleBtn").textContent = planFormVisible ? "Cancel" : "+ Add Planned Meal";
    if (!planFormVisible) return;
    $("groceryPlanTypeSingleBtn").classList.toggle("active", planFormType === "single");
    $("groceryPlanTypeRecurringBtn").classList.toggle("active", planFormType === "recurring");
    $("groceryPlanDateRow").classList.toggle("hidden", planFormType !== "single");
    $("groceryPlanDaysRow").classList.toggle("hidden", planFormType !== "recurring");
    document.querySelectorAll(".plan-day-chk").forEach(function (chk) {
      chk.checked = planFormDays.indexOf(Number(chk.value)) !== -1;
    });
    renderRecipeOptions($("groceryPlanRecipeSelect"), null);
    $("groceryPlanFormTitle").textContent = planFormEditId ? "Edit Planned Meal" : "Add a Planned Meal";
    $("groceryPlanSubmitBtn").textContent = planFormEditId ? "Save Changes" : "Add to Plan";
  }

  function renderRegularFoods() {
    const core = window.JarvisCore;
    const container = $("groceryRegularFoodsList");
    if (!container) return;
    const foods = computeRegularlyEatenFoods();
    if (foods.length === 0) {
      container.innerHTML = '<div class="empty-state">Log the same food a few times and it\'ll show up here for automatic weekly restocking.</div>';
      return;
    }
    container.innerHTML = foods.map(function (f) {
      const w = prefs.weeklyReplenish && prefs.weeklyReplenish[f.key];
      const enabled = w && w.enabled;
      return (
        '<div class="list-item">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(f.name) + '</span>' +
              '<span class="list-item-meta">Logged ' + f.frequency + ' of the last 30 days</span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<label class="checklist-item"><input type="checkbox" class="regular-food-toggle" data-key="' + core.escapeHtml(f.key) + '" data-name="' + core.escapeHtml(f.name) + '" data-serving="' + core.escapeHtml(f.lastServing || "") + '"' + (enabled ? " checked" : "") + '> Auto-add weekly</label>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderPantryList() {
    const core = window.JarvisCore;
    const container = $("groceryPantryList");
    if (!container) return;
    const keys = Object.keys(pantry).sort(function (a, b) { return pantry[a].name.localeCompare(pantry[b].name); });
    if (keys.length === 0) {
      container.innerHTML = '<div class="empty-state">Nothing tracked yet. Purchases and recipe logging will fill this in, or add an item you already have.</div>';
      return;
    }
    const sourceLabel = { estimate: "Estimate", manual: "Manual", purchase: "Purchased" };
    container.innerHTML = keys.map(function (key) {
      const p = pantry[key];
      return (
        '<div class="list-item" data-key="' + core.escapeHtml(key) + '">' +
          '<div class="list-item-row">' +
            '<div class="list-item-main">' +
              '<span class="list-item-title">' + core.escapeHtml(p.name) + ' <span class="badge badge-neutral">' + sourceLabel[p.source] + '</span></span>' +
            '</div>' +
            '<div class="list-item-actions">' +
              '<input type="number" min="0" step="0.1" class="pantry-qty-input" data-key="' + core.escapeHtml(key) + '" value="' + p.quantity + '" style="width:70px;">' +
              '<select class="pantry-unit-select" data-key="' + core.escapeHtml(key) + '">' +
                UNIT_LIST.map(function (u) { return '<option value="' + u + '"' + (u === p.unit ? " selected" : "") + '>' + u + '</option>'; }).join("") +
              '</select>' +
              '<button type="button" class="btn-icon danger pantry-remove-btn" data-key="' + core.escapeHtml(key) + '">Remove</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");
  }

  function groceryItemRowHtml(item) {
    const core = window.JarvisCore;
    const neededFor = item.neededFor && item.neededFor.length ? '<span class="list-item-meta">For: ' + core.escapeHtml(item.neededFor.join(", ")) + '</span>' : "";
    const badges = [];
    if (item.manual) badges.push('<span class="badge badge-neutral">Manual</span>');
    if (item.excluded) badges.push('<span class="badge badge-neutral">Excluded from auto-sync</span>');
    if (item.userEdited && !item.manual) badges.push('<span class="badge badge-neutral">Edited</span>');
    return (
      '<div class="list-item grocery-item-row' + (item.purchased ? " is-purchased" : "") + '" data-id="' + core.escapeHtml(item.id) + '">' +
        '<div class="list-item-row">' +
          '<label class="checklist-item grocery-purchased-label">' +
            '<input type="checkbox" class="grocery-purchased-chk" data-id="' + core.escapeHtml(item.id) + '"' + (item.purchased ? " checked" : "") + '>' +
          '</label>' +
          '<div class="list-item-main">' +
            '<span class="list-item-title">' + core.escapeHtml(item.name) + ' ' + badges.join(" ") + '</span>' +
            neededFor +
          '</div>' +
          '<div class="list-item-actions">' +
            '<input type="number" min="0" step="0.1" class="grocery-qty-input" data-id="' + core.escapeHtml(item.id) + '" value="' + item.quantity + '" style="width:64px;">' +
            '<select class="grocery-unit-select" data-id="' + core.escapeHtml(item.id) + '">' +
              UNIT_LIST.map(function (u) { return '<option value="' + u + '"' + (u === item.unit ? " selected" : "") + '>' + u + '</option>'; }).join("") +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="list-item-row grocery-item-quick-actions">' +
          '<button type="button" class="btn-icon grocery-already-have-btn" data-id="' + core.escapeHtml(item.id) + '">Already Have</button>' +
          '<button type="button" class="btn-icon grocery-exclude-btn" data-id="' + core.escapeHtml(item.id) + '">' + (item.excluded ? "Include in Auto-Sync" : "Exclude from Auto-Sync") + '</button>' +
          '<button type="button" class="btn-icon danger grocery-remove-btn" data-id="' + core.escapeHtml(item.id) + '">Remove</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderGroceryList() {
    const container = $("groceryListContainer");
    if (!container) return;
    if (groceryList.length === 0) {
      container.innerHTML = '<div class="empty-state">Your grocery list is empty. Plan a meal above or add an item manually below.</div>';
      return;
    }
    const byCategory = {};
    groceryList.forEach(function (item) {
      const cat = item.category || "Other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    });
    const orderedCats = CATEGORIES.filter(function (c) { return byCategory[c]; });
    container.innerHTML = orderedCats.map(function (cat) {
      return '<div class="grocery-category-group">' +
        '<h3 class="grocery-category-title">' + cat + '</h3>' +
        byCategory[cat].map(groceryItemRowHtml).join("") +
        '</div>';
    }).join("");
  }

  function renderAll() {
    renderSetup();
    renderUpdateBanner();
    renderPlanForm();
    renderPlanList();
    renderRegularFoods();
    renderPantryList();
    renderGroceryList();
  }

  /* ---------------- event handlers ---------------- */

  function handleSetupFormSubmit(e) {
    e.preventDefault();
    prefs.shoppingDay = Number($("groceryShoppingDaySelect").value) || 0;
    prefs.setupDone = true;
    savePrefs();
    showSetupForm = false;
    window.JarvisCore.showToast("Groceries set up.");
    renderSetup();
  }

  function resetPlanForm() {
    planFormVisible = false;
    planFormEditId = null;
    planFormType = "single";
    planFormDays = [];
    $("groceryPlanForm").reset();
  }

  function handlePlanFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const recipeSelect = $("groceryPlanRecipeSelect");
    const recipeId = recipeSelect.value || null;
    const recipe = recipeId ? getRecipes().find(function (r) { return r.id === recipeId; }) : null;
    const customName = $("groceryPlanCustomName").value.trim();
    const servings = Number($("groceryPlanServings").value) || 1;
    if (planFormType === "single" && !$("groceryPlanDate").value) { core.showToast("Pick a date."); return; }
    if (planFormType === "recurring" && planFormDays.length === 0) { core.showToast("Pick at least one day."); return; }
    if (!recipe && !customName) { core.showToast("Name this meal or pick a recipe."); return; }
    const data = {
      type: planFormType,
      date: planFormType === "single" ? $("groceryPlanDate").value : null,
      days: planFormType === "recurring" ? planFormDays.slice() : null,
      meal: $("groceryPlanMealSelect").value,
      recipeId: recipeId,
      recipeName: recipe ? recipe.name : customName,
      servings: servings,
      isRestaurant: $("groceryPlanRestaurantChk").checked,
      includeInGroceries: $("groceryPlanIncludeChk").checked
    };
    if (planFormEditId) updatePlanEntry(planFormEditId, data);
    else addPlanEntry(data);
    resetPlanForm();
    recomputeGroceryList();
    renderAll();
    core.showToast(planFormEditId ? "Planned meal updated." : "Added to your meal plan.");
  }

  function handlePlanListClick(e) {
    const markBtn = e.target.closest(".plan-mark-eaten-btn");
    if (markBtn) {
      const planId = markBtn.getAttribute("data-plan-id");
      const date = markBtn.getAttribute("data-date");
      const plan = mealPlan.find(function (p) { return p.id === planId; });
      if (!plan) return;
      if (plan.recipeId) {
        const recipe = getRecipes().find(function (r) { return r.id === plan.recipeId; });
        if (recipe) {
          const ratio = plan.servings / recipe.servings;
          recipe.ingredients.forEach(function (ing) {
            const q = parseQuantityString(ing.quantity);
            adjustPantry(ing.name, -(q.amount * ratio), q.unit, "estimate");
          });
        }
      }
      plan.completedDates = (plan.completedDates || []).concat([date]);
      savePlan();
      recomputeGroceryList();
      renderAll();
      window.JarvisCore.showToast("Marked as eaten.");
      return;
    }
    const editBtn = e.target.closest(".plan-edit-btn");
    if (editBtn) {
      const id = editBtn.getAttribute("data-id");
      const plan = mealPlan.find(function (p) { return p.id === id; });
      if (!plan) return;
      planFormVisible = true;
      planFormEditId = id;
      planFormType = plan.type;
      planFormDays = plan.days ? plan.days.slice() : [];
      renderPlanForm();
      $("groceryPlanMealSelect").value = plan.meal;
      renderRecipeOptions($("groceryPlanRecipeSelect"), plan.recipeId);
      $("groceryPlanCustomName").value = plan.recipeId ? "" : plan.recipeName;
      $("groceryPlanServings").value = plan.servings;
      $("groceryPlanDate").value = plan.date || "";
      $("groceryPlanRestaurantChk").checked = !!plan.isRestaurant;
      $("groceryPlanIncludeChk").checked = !!plan.includeInGroceries;
      $("groceryPlanAddToggleBtn").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const delBtn = e.target.closest(".plan-delete-btn");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      if (!window.confirm("Remove this planned meal?")) return;
      removePlanEntry(id);
      recomputeGroceryList();
      renderAll();
      window.JarvisCore.showToast("Planned meal removed.");
    }
  }

  function handleRegularFoodsClick(e) {
    const chk = e.target.closest(".regular-food-toggle");
    if (!chk) return;
    toggleWeeklyReplenish(chk.getAttribute("data-key"), chk.getAttribute("data-name"), chk.getAttribute("data-serving"));
  }

  function handlePantryListClick(e) {
    const removeBtn = e.target.closest(".pantry-remove-btn");
    if (removeBtn) {
      removePantryItem(removeBtn.getAttribute("data-key"));
      recomputeGroceryList();
      renderAll();
    }
  }

  function handlePantryListChange(e) {
    const input = e.target.closest(".pantry-qty-input, .pantry-unit-select");
    if (!input) return;
    const key = input.getAttribute("data-key");
    const p = pantry[key];
    if (!p) return;
    const row = input.closest(".list-item");
    p.quantity = Math.max(0, Number(row.querySelector(".pantry-qty-input").value) || 0);
    p.unit = row.querySelector(".pantry-unit-select").value;
    p.source = "manual";
    p.updatedAt = Date.now();
    savePantry();
    recomputeGroceryList();
    renderGroceryList();
  }

  function handlePantryAddFormSubmit(e) {
    e.preventDefault();
    const name = $("groceryPantryAddName").value.trim();
    const qty = Number($("groceryPantryAddQty").value) || 0;
    const unit = $("groceryPantryAddUnit").value;
    if (!name) return;
    setPantryManual(name, qty, unit);
    $("groceryPantryAddForm").reset();
    recomputeGroceryList();
    renderAll();
  }

  function handleAddItemFormSubmit(e) {
    e.preventDefault();
    const core = window.JarvisCore;
    const name = $("groceryAddItemName").value.trim();
    const qty = Number($("groceryAddItemQty").value) || 1;
    const unit = $("groceryAddItemUnit").value;
    if (!name) return;
    groceryList.push({
      id: core.uid("grocery"), name: name, category: guessCategory(name),
      quantity: qty, unit: unit, purchased: false, manual: true, excluded: false,
      userEdited: false, neededFor: [], addedAt: Date.now()
    });
    saveList();
    $("groceryAddItemForm").reset();
    renderGroceryList();
    core.showToast('Added "' + name + '" to your grocery list.');
  }

  function handleGroceryListClick(e) {
    const already = e.target.closest(".grocery-already-have-btn");
    if (already) {
      const id = already.getAttribute("data-id");
      const item = groceryList.find(function (it) { return it.id === id; });
      if (!item) return;
      adjustPantry(item.name, item.quantity, item.unit, "manual");
      recomputeGroceryList();
      renderAll();
      window.JarvisCore.showToast("Marked as already have.");
      return;
    }
    const exclude = e.target.closest(".grocery-exclude-btn");
    if (exclude) {
      const id = exclude.getAttribute("data-id");
      const item = groceryList.find(function (it) { return it.id === id; });
      if (!item) return;
      item.excluded = !item.excluded;
      saveList();
      renderGroceryList();
      return;
    }
    const remove = e.target.closest(".grocery-remove-btn");
    if (remove) {
      const id = remove.getAttribute("data-id");
      groceryList = groceryList.filter(function (it) { return it.id !== id; });
      saveList();
      recomputeGroceryList();
      renderAll();
    }
  }

  function handleGroceryListChange(e) {
    const purchasedChk = e.target.closest(".grocery-purchased-chk");
    if (purchasedChk) {
      const id = purchasedChk.getAttribute("data-id");
      const item = groceryList.find(function (it) { return it.id === id; });
      if (!item) return;
      const nowPurchased = purchasedChk.checked;
      if (nowPurchased && !item.purchased) adjustPantry(item.name, item.quantity, item.unit, "purchase");
      else if (!nowPurchased && item.purchased) adjustPantry(item.name, -item.quantity, item.unit, "purchase");
      item.purchased = nowPurchased;
      saveList();
      recomputeGroceryList();
      renderAll();
      return;
    }
    const qtyOrUnit = e.target.closest(".grocery-qty-input, .grocery-unit-select");
    if (qtyOrUnit) {
      const id = qtyOrUnit.getAttribute("data-id");
      const item = groceryList.find(function (it) { return it.id === id; });
      if (!item) return;
      const row = qtyOrUnit.closest(".list-item");
      item.quantity = Math.max(0, Number(row.querySelector(".grocery-qty-input").value) || 0);
      item.unit = row.querySelector(".grocery-unit-select").value;
      item.userEdited = true;
      saveList();
    }
  }

  /* ---------------- boot ---------------- */

  function getSummary() {
    const unpurchased = groceryList.filter(function (it) { return !it.purchased && !it.excluded; });
    return { itemsNeeded: unpurchased.length };
  }

  function onSubTabChange(targetId) {
    if (targetId === "nutrition-groceries") renderAll();
  }

  function init() {
    load();

    $("grocerySetupForm").addEventListener("submit", handleSetupFormSubmit);
    $("grocerySetupEditBtn").addEventListener("click", function () { showSetupForm = true; renderSetup(); });

    $("groceryUpdateUndoBtn").addEventListener("click", undoLastChange);
    $("groceryUpdateDismissBtn").addEventListener("click", dismissChangeBanner);
    $("groceryUpdateDetailsToggle").addEventListener("click", function () { showChangeDetails = !showChangeDetails; renderUpdateBanner(); });

    $("groceryPlanAddToggleBtn").addEventListener("click", function () {
      if (planFormVisible) { resetPlanForm(); renderPlanForm(); return; }
      planFormVisible = true;
      renderPlanForm();
    });
    $("groceryPlanTypeSingleBtn").addEventListener("click", function () { planFormType = "single"; renderPlanForm(); });
    $("groceryPlanTypeRecurringBtn").addEventListener("click", function () { planFormType = "recurring"; renderPlanForm(); });
    document.querySelectorAll(".plan-day-chk").forEach(function (chk) {
      chk.addEventListener("change", function () {
        const v = Number(chk.value);
        planFormDays = chk.checked ? planFormDays.concat([v]) : planFormDays.filter(function (d) { return d !== v; });
      });
    });
    $("groceryPlanRestaurantChk").addEventListener("change", function () {
      $("groceryPlanIncludeRow").classList.toggle("hidden", !$("groceryPlanRestaurantChk").checked);
    });
    $("groceryPlanForm").addEventListener("submit", handlePlanFormSubmit);
    $("groceryPlanCancelBtn").addEventListener("click", function () { resetPlanForm(); renderPlanForm(); });
    $("groceryPlanList").addEventListener("click", handlePlanListClick);

    $("groceryRegularFoodsList").addEventListener("change", handleRegularFoodsClick);

    $("groceryPantryList").addEventListener("click", handlePantryListClick);
    $("groceryPantryList").addEventListener("change", handlePantryListChange);
    $("groceryPantryAddForm").addEventListener("submit", handlePantryAddFormSubmit);

    $("groceryAddItemForm").addEventListener("submit", handleAddItemFormSubmit);
    $("groceryListContainer").addEventListener("click", handleGroceryListClick);
    $("groceryListContainer").addEventListener("change", handleGroceryListChange);

    recomputeGroceryList();
    renderAll();
  }

  window.JarvisGroceries = {
    init: init,
    getSummary: getSummary,
    onSubTabChange: onSubTabChange,
    onRecipeLogged: onRecipeLogged,
    onSimpleFoodLogged: onSimpleFoodLogged
  };
})();
