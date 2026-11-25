/* ==========================================================================
   JARVIS — Meal Prep (pure rules: no page, storage or network, so they can be tested outside the browser).

   Meal Prep is a view over data JARVIS already keeps. Nothing here is a second copy of anything:

     recipes        jarvisNutritionRecipes   { id, name, instructions, servings, ingredients: [{ name, quantity, calories, protein, carbs, fat, fiber }], createdAt }
                    and, optionally: cats[], favorite, prepMin, cookMin, storage { place, notes, reheat }, image, updatedAt.
                    The numbers on an ingredient are for the whole amount of it; per serving is always worked out (sum / servings).
     the week plan  jarvisGroceryMealPlan   { id, type: "single" | "recurring", date, days, meal, recipeId, recipeName, servings, isRestaurant,
                    includeInGroceries, completedDates }  and, optionally: skipDates, preppedDates, macros, frozen, loggedItems, fromBatch, group, updatedAt,
                    serving, foodId, from, until.
                    Each entry is ONE FOOD under a meal (a recipe's serving, or a food with its own numbers). A meal is the foods that share
                    a day and a slot. "recurring" entries repeat every week on their weekdays, between from and until (both optional): that is
                    what carries a regular food into next week without anyone copying it.
     the food log   jarvisNutritionLog       (what you actually ate; Meal Prep only reads it, and adds a line when you tap "Eaten")
     batches        jarvisMealPrepBatches    cooked food you prepared ahead: portions, where it is kept, use-by date.
     sessions       jarvisMealPrepSessions   shopping / cooking / portioning / reminder times, each one also ONE Calendar event.

   Every nutrition number is either typed by you or labelled "estimated" (from the typical-values list in mealprep-foods.js, or
   from the AI estimate Nutrition already offers). A meal you mark as eaten keeps the numbers it had that day (frozen), so
   editing a recipe later changes plans from now on and never rewrites what you ate.

   Nothing in this file changes what it is given: every edit returns a new list.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./mealprep-foods.js"), require("./food-amount-logic.js"));
  else root.JarvisMealPrepLogic = factory(root.JarvisMealPrepFoods, root.JarvisFoodAmount);
})(typeof self !== "undefined" ? self : this, function (F, FA) {
  "use strict";

  const MEALS = ["breakfast", "lunch", "dinner", "snacks"];
  const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };
  const MACROS = ["calories", "protein", "carbs", "fat"];
  const CATS = ["breakfast", "lunch", "dinner", "snacks"];
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const FRIDGE_DAYS = 4, FREEZER_DAYS = 90, THAWED_DAYS = 3;
  const HIGH_PROTEIN_G = 25, RECOVERY_PROTEIN_G = 25, RECOVERY_CARBS_G = 30;

  /* ---------------- small helpers ---------------- */

  function isDate(s) {
    if (typeof s !== "string" || !DAY_RE.test(s)) return false;
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8)));
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function isTime(s) { return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function addDays(date, n) { return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8) + n)).toISOString().slice(0, 10); }
  function weekday(date) { return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8))).getUTCDay(); }   // 0 = Sunday
  function mondayOf(date) { return addDays(date, -((weekday(date) + 6) % 7)); }
  function weekDates(start) { const out = []; for (let i = 0; i < 7; i++) out.push(addDays(start, i)); return out; }
  function diffDays(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 86400000); }
  function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r0(n) { return Math.round(n); }
  function keyOf(name) { return String(name || "").trim().toLowerCase(); }
  function oneLine(s, max) { return String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max || 200); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function zero() { return { calories: 0, protein: 0, carbs: 0, fat: 0 }; }
  function addMacros(a, b, k) { const o = {}; MACROS.forEach(function (m) { o[m] = (a[m] || 0) + (b[m] || 0) * (k === undefined ? 1 : k); }); return o; }
  function roundMacros(m) { return { calories: r0(m.calories), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat) }; }

  /* ---------------- quantities ---------------- */

  const UNITS = {
    g: "g", gram: "g", grams: "g", kg: "kg", kilogram: "kg", kilograms: "kg", oz: "oz", ounce: "oz", ounces: "oz", lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
    ml: "ml", l: "l", tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", cup: "cup", cups: "cup",
    each: "each", piece: "each", pieces: "each", whole: "each", large: "each", medium: "each", small: "each", slice: "each", slices: "each", can: "can", cans: "can"
  };
  const MASS_G = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

  function mixed(tok) {
    if (tok.indexOf(" ") !== -1) return tok.split(" ").filter(Boolean).reduce(function (s, p) { return s + mixed(p); }, 0);
    if (tok.indexOf("/") !== -1) { const p = tok.split("/"); return Number(p[1]) ? Number(p[0]) / Number(p[1]) : 0; }
    return Number(tok) || 0;
  }
  // "500 g", "1.5 lb", "2 cups", "1/2 tsp", "3" -> { amount, unit } (unit "" when none, "each" for a bare count). null when there is no number.
  function parseQty(text) {
    const s = String(text === undefined || text === null ? "" : text).trim().toLowerCase().replace(/,/g, "");
    const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*([a-z]*)/);
    if (!m) return null;
    const amount = mixed(m[1]);
    if (!(amount > 0)) return null;
    const u = m[2] ? UNITS[m[2]] || m[2] : "";
    return { amount: amount, unit: u || "each" };
  }
  // Grams for an amount of a food: weights directly; pieces, spoons and cups only when the list knows them. null when it can not be said.
  function toGrams(amount, unit, food) {
    if (MASS_G[unit]) return amount * MASS_G[unit];
    if (unit === "each" && food && food.each) return amount * food.each;
    if (unit === "tbsp" && food && food.tbsp) return amount * food.tbsp;
    if (unit === "tsp" && food && food.tbsp) return amount * food.tbsp / 3;
    if (unit === "cup" && food && food.cup) return amount * food.cup;
    if (unit === "ml" && food && food.cup && food.packaged) return amount * food.cup / 236.588;
    return null;
  }
  function fmtAmount(a) { const r = Math.round(a * 100) / 100; return r % 1 === 0 ? String(r) : String(r); }
  // "1.5 lb" scaled by k -> "2.25 lb". Text with no number is returned with the factor spelled out.
  function scaleQty(text, k) {
    const q = parseQty(text);
    if (!q) return oneLine(text) ? oneLine(text) + (k === 1 ? "" : " (x" + fmtAmount(k) + ")") : "";
    const rest = String(text).trim().toLowerCase().replace(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*/, "");
    return fmtAmount(q.amount * k) + (rest ? " " + rest : "");
  }

  /* ---------------- recipes ---------------- */

  // The optional fields Meal Prep adds to a recipe, cleaned. Anything wrong is dropped, so a damaged value can not break a screen.
  function recipeExtras(raw) {
    const out = {}, r = raw && typeof raw === "object" ? raw : {};
    const cats = (Array.isArray(r.cats) ? r.cats : []).filter(function (c, i, a) { return CATS.indexOf(c) !== -1 && a.indexOf(c) === i; });
    if (cats.length) out.cats = cats;
    if (r.favorite === true) out.favorite = true;
    if (num(r.prepMin)) out.prepMin = Math.min(1440, Math.round(num(r.prepMin)));
    if (num(r.cookMin)) out.cookMin = Math.min(1440, Math.round(num(r.cookMin)));
    if (r.storage && typeof r.storage === "object") {
      const st = {};
      if (r.storage.place === "fridge" || r.storage.place === "freezer" || r.storage.place === "both") st.place = r.storage.place;
      if (oneLine(r.storage.notes, 300)) st.notes = oneLine(r.storage.notes, 300);
      if (oneLine(r.storage.reheat, 300)) st.reheat = oneLine(r.storage.reheat, 300);
      if (Object.keys(st).length) out.storage = st;
    }
    if (typeof r.image === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(r.image) && r.image.length <= 120000) out.image = r.image;
    if (typeof r.updatedAt === "number" && r.updatedAt > 0) out.updatedAt = r.updatedAt;
    return out;
  }
  function cleanIngredient(i) {
    const o = { name: oneLine(i && i.name, 80), quantity: oneLine(i && i.quantity, 40) };
    MACROS.concat(["fiber"]).forEach(function (m) { o[m] = num(i && i[m]); });
    if (i && (i.state === "raw" || i.state === "cooked" || i.state === "packaged")) o.state = i.state;
    if (i && i.est === true) o.est = true;
    // An ingredient made from a food keeps the label it was worked out from and the amount used, so its numbers follow the amount
    // exactly and a recipe can say how much of it each portion needs. Both are kept or neither (the amount means nothing without the label).
    const lab = FA && i ? FA.cleanLabel(i.label) : null, amt = FA && i ? FA.cleanEntry(i.amount) : null;
    if (lab && amt) {
      o.label = lab; o.amount = amt;
      if (typeof i.foodId === "string" && i.foodId) o.foodId = i.foodId.slice(0, 60);
    }
    return o;
  }
  function recipeTotals(recipe) {
    const t = zero();
    ((recipe && recipe.ingredients) || []).forEach(function (i) { MACROS.forEach(function (m) { t[m] += num(i && i[m]); }); });
    return t;
  }
  function servingsOf(recipe) { const n = Math.round(num(recipe && recipe.servings)); return n > 0 ? n : 1; }
  // Per serving, always worked out from the ingredients (sum / servings), never stored.
  function recipePer(recipe) { const t = recipeTotals(recipe), s = servingsOf(recipe); const o = {}; MACROS.forEach(function (m) { o[m] = t[m] / s; }); return o; }
  function hasNutrition(recipe) { const t = recipeTotals(recipe); return t.calories > 0 || t.protein > 0 || t.carbs > 0 || t.fat > 0; }
  // Where a recipe's numbers came from: none | entered | estimated (all of what is there) | mixed.
  function recipeSource(recipe) {
    let est = 0, own = 0;
    ((recipe && recipe.ingredients) || []).forEach(function (i) {
      if (!(num(i.calories) || num(i.protein) || num(i.carbs) || num(i.fat))) return;
      if (i.est) est++; else own++;
    });
    return { kind: !est && !own ? "none" : est && own ? "mixed" : est ? "estimated" : "entered", estimated: est, entered: own };
  }
  function isHighProtein(recipe) { return hasNutrition(recipe) && recipePer(recipe).protein >= HIGH_PROTEIN_G; }
  // Protein and carbohydrate in the same meal: useful after training. A plain threshold, not a judgement of the meal.
  function isRecoveryFriendly(per) { return !!per && per.protein >= RECOVERY_PROTEIN_G && per.carbs >= RECOVERY_CARBS_G; }
  function inCategory(recipe, cat) {
    if (cat === "all") return true;
    if (cat === "favorites") return !!(recipe && recipe.favorite);
    if (cat === "high-protein") return isHighProtein(recipe);
    return ((recipe && recipe.cats) || []).indexOf(cat) !== -1;
  }
  function totalMinutes(recipe) { return num(recipe && recipe.prepMin) + num(recipe && recipe.cookMin); }
  function searchRecipes(recipes, q) {
    const s = oneLine(q).toLowerCase();
    if (!s) return recipes.slice();
    return recipes.filter(function (r) { return (r.name || "").toLowerCase().indexOf(s) !== -1 || (r.ingredients || []).some(function (i) { return (i.name || "").toLowerCase().indexOf(s) !== -1; }); });
  }
  // A copy of a recipe under a new id (the original is not touched).
  function duplicateRecipe(recipe, id, now) {
    const c = clone(recipe);
    c.id = id; c.name = oneLine(recipe.name, 70) + " (copy)"; c.createdAt = now; c.updatedAt = now; delete c.favorite;
    return c;
  }
  // The ingredients of a recipe for a number of servings, amounts scaled: [{ name, text }].
  function scaledIngredients(recipe, servings) {
    const k = num(servings) / servingsOf(recipe);
    return ((recipe && recipe.ingredients) || []).map(function (i) { return { name: i.name, text: scaleQty(i.quantity, k || 1) }; });
  }

  /* ---------------- estimating one ingredient ---------------- */

  // name, quantity text ("500 g", "2 eggs"), state "raw" | "cooked" | "packaged" | "" (unsaid) -> { calories, protein, carbs, fat, grams, state, food, note, converted } or { error }.
  // The state it is weighed in matters: 100 g of cooked rice is a third of the food 100 g of dry rice is. When the list has the numbers for
  // the state given they are used as they are; when it only has the other state they are converted with a typical yield and it says so.
  function estimate(name, quantity, state) {
    const food = F.find(name);
    if (!food) return { error: "No typical value for \"" + oneLine(name, 40) + "\". Type its numbers." };
    const q = parseQty(quantity);
    if (!q) return { error: "Give an amount like 500 g or 2 cups." };
    const grams = toGrams(q.amount, q.unit, food);
    if (grams === null) return { error: "JARVIS can't turn \"" + oneLine(quantity, 30) + "\" into grams for " + food.names[0] + ". Use a weight (g, oz, lb), or type its numbers." };
    let st = state === "raw" || state === "cooked" || state === "packaged" ? state : (F.stateInName(name) || food.def);
    if (food.packaged && !food.raw) st = "packaged";
    if (!food.packaged && st === "packaged") st = food.def;
    let per = food[st], g = grams, converted = false, note = "";
    if (!per) {
      const other = st === "cooked" ? "raw" : "cooked";
      if (!food[other] || !food.yield) return { error: "No " + st + " value for " + food.names[0] + ". Type its numbers." };
      // grams in the other state: cooked -> raw divides by the yield, raw -> cooked multiplies by it
      g = st === "cooked" ? grams / food.yield : grams * food.yield;
      per = food[other]; converted = true;
      note = grams + " g " + st + " is about " + r0(g) + " g " + other + " (typical yield x" + food.yield + ")";
    }
    const k = g / 100;
    return { calories: r0(per[0] * k), protein: r1(per[1] * k), carbs: r1(per[2] * k), fat: r1(per[3] * k), grams: r0(grams), state: st, food: food.names[0], converted: converted, note: note, generic: !!food.generic };
  }

  /* ---------------- the portion calculator ---------------- */

  // rows: [{ name, amount, unit, state, own: { calories, protein, carbs, fat, basis: "total" | "per100", state } }], portions, dishWeight (g, optional)
  // -> { rows: [{ name, grams, nutrition, source: "typical" | "yours", note, error }], totals, perPortion, portions, gramsPerPortion, warnings }
  function calculate(input) {
    const rows = (input && input.rows) || [], portions = Math.round(num(input && input.portions));
    const out = [], warnings = [];
    let totals = zero();
    rows.forEach(function (r) {
      const name = oneLine(r.name, 60);
      if (!name) return;
      const row = { name: name, nutrition: null, grams: null, source: "", note: "", error: "" };
      const unit = UNITS[String(r.unit || "g").toLowerCase()] || "g";
      const amount = num(r.amount);
      if (!amount) { row.error = "Give an amount."; out.push(row); return; }
      const own = r.own && (num(r.own.calories) || num(r.own.protein) || num(r.own.carbs) || num(r.own.fat)) ? r.own : null;
      const food = F.find(name);
      const g = toGrams(amount, unit, food);
      if (own) {
        // your own numbers: for the whole amount, or per 100 g (then the weight is needed)
        let k = 1;
        if (own.basis === "per100") {
          if (g === null) { row.error = "Per-100 g numbers need the amount as a weight."; out.push(row); return; }
          let gg = g;
          if (own.state && r.state && own.state !== r.state && food && food.yield && food.raw && food.cooked) {
            gg = r.state === "cooked" ? g / food.yield : g * food.yield;      // the label is for the other state: convert the weight first
            row.note = "Your numbers are for " + own.state + " food; the weight was converted (typical yield x" + food.yield + ").";
          } else if (own.state && r.state && own.state !== r.state) {
            warnings.push(name + ": your numbers are for " + own.state + " food but you weighed it " + r.state + ". There is no typical yield for it, so check the result.");
          }
          k = gg / 100;
        }
        row.nutrition = { calories: num(own.calories) * k, protein: num(own.protein) * k, carbs: num(own.carbs) * k, fat: num(own.fat) * k };
        row.grams = g === null ? null : r0(g); row.source = "yours";
      } else {
        const e = estimate(name, fmtAmount(amount) + " " + unit, r.state || "");
        if (e.error) { row.error = e.error; out.push(row); return; }
        row.nutrition = { calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat };
        row.grams = e.grams; row.source = "typical"; row.note = e.note; row.state = e.state; row.food = e.food;
        if (e.generic) warnings.push(name + ": a generic mix. Use your own numbers for a better estimate.");
      }
      totals = addMacros(totals, row.nutrition);
      out.push(row);
    });
    const per = {}; MACROS.forEach(function (m) { per[m] = portions ? totals[m] / portions : 0; });
    const dw = num(input && input.dishWeight);
    return {
      rows: out, totals: roundMacros(totals), perPortion: portions ? roundMacros(per) : null, portions: portions,
      gramsPerPortion: portions && dw ? r0(dw / portions) : null, warnings: warnings,
      anyEstimated: out.some(function (r) { return r.source === "typical"; })
    };
  }

  /* ---------------- the week plan ---------------- */

  function mealIndex(m) { const i = MEALS.indexOf(m); return i === -1 ? 9 : i; }
  // Every showing of the plan from..to: [{ key, planId, date, meal, entry, recurring }], in day and meal order. A recurring entry shows on its
  // weekdays except the dates skipped; an entry made for one date shows on that date.
  function occurrences(plan, from, to) {
    const out = [];
    (Array.isArray(plan) ? plan : []).forEach(function (e) {
      if (!e || typeof e.id !== "string" || MEALS.indexOf(e.meal) === -1) return;
      if (e.type === "recurring") {
        const days = Array.isArray(e.days) ? e.days : [];
        for (let d = from; d <= to; d = addDays(d, 1)) {
          if (days.indexOf(weekday(d)) !== -1 && (e.skipDates || []).indexOf(d) === -1 && (!isDate(e.from) || d >= e.from) && (!isDate(e.until) || d <= e.until)) out.push({ key: e.id + "@" + d, planId: e.id, date: d, meal: e.meal, entry: e, recurring: true });
        }
      } else if (isDate(e.date) && e.date >= from && e.date <= to) {
        out.push({ key: e.id + "@" + e.date, planId: e.id, date: e.date, meal: e.meal, entry: e, recurring: false });
      }
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : mealIndex(a.meal) - mealIndex(b.meal) || (a.entry.createdAt || 0) - (b.entry.createdAt || 0); });
  }
  function eatenOn(entry, date) { return (entry.completedDates || []).indexOf(date) !== -1; }
  function recipeOf(entry, recipes) { return entry.recipeId ? (recipes || []).filter(function (r) { return r.id === entry.recipeId; })[0] || null : null; }

  // The numbers a planned meal stands for on a date, and where they came from.
  // A meal marked eaten keeps the numbers it had then (frozen); otherwise: your numbers for a quick meal, or the recipe's per serving x servings.
  function entryNutrition(entry, recipes, date) {
    const fz = entry.frozen && entry.frozen[date];
    if (fz && typeof fz === "object") return { nutrition: roundMacros(fz), source: fz.source || "entered", frozen: true };
    if (entry.macros && MACROS.some(function (m) { return num(entry.macros[m]); })) {
      const o = {}; MACROS.forEach(function (m) { o[m] = num(entry.macros[m]) * (num(entry.servings) || 1); });
      return { nutrition: roundMacros(o), source: "entered", frozen: false };
    }
    const rec = recipeOf(entry, recipes);
    if (rec && hasNutrition(rec)) {
      const per = recipePer(rec), k = num(entry.servings) || 1, o = {}; MACROS.forEach(function (m) { o[m] = per[m] * k; });
      return { nutrition: roundMacros(o), source: recipeSource(rec).kind, frozen: false };
    }
    return { nutrition: null, source: "none", frozen: false };
  }
  // The meals of one day with their numbers, and the day's planned totals (meals with no numbers are counted, not guessed).
  function dayPlan(plan, recipes, date) {
    const items = occurrences(plan, date, date).map(function (o) {
      const n = entryNutrition(o.entry, recipes, o.date);
      return Object.assign({}, o, { nutrition: n.nutrition, source: n.source, frozen: n.frozen, eaten: eatenOn(o.entry, o.date), recipe: recipeOf(o.entry, recipes) });
    });
    let t = zero(), e = zero(), withNumbers = 0, without = 0, eaten = 0;
    items.forEach(function (it) {
      if (it.eaten) eaten++;
      if (it.nutrition) { t = addMacros(t, it.nutrition); withNumbers++; if (it.eaten) e = addMacros(e, it.nutrition); } else without++;
    });
    // each meal: how many of its foods are eaten, and whether the whole meal is done (it has foods and all are eaten)
    const meals = {};
    MEALS.forEach(function (m) { const f = items.filter(function (i) { return i.meal === m; }); meals[m] = { total: f.length, eaten: f.filter(function (i) { return i.eaten; }).length, done: f.length > 0 && f.every(function (i) { return i.eaten; }) }; });
    return { date: date, items: items, totals: roundMacros(t), eatenTotals: roundMacros(e), meals: meals, mealsDone: MEALS.filter(function (m) { return meals[m].done; }).length, mealsPlanned: MEALS.filter(function (m) { return meals[m].total > 0; }).length,
      withNumbers: withNumbers, withoutNumbers: without, eaten: eaten, upcoming: items.length - eaten, anyEstimated: items.some(function (i) { return i.nutrition && (i.source === "estimated" || i.source === "mixed"); }) };
  }
  // Planned against logged for one day. No "over" and no "under": two numbers and the plain difference, so it reads as information.
  function compare(planned, logged) {
    const o = {};
    MACROS.forEach(function (m) { o[m] = { planned: r0(planned[m] || 0), logged: r0(logged && logged[m] || 0), diff: r0((logged && logged[m] || 0) - (planned[m] || 0)) }; });
    return o;
  }
  function targetShare(value, target) { return target > 0 ? Math.round(value / target * 100) : null; }

  // The status of one planned meal: eaten | prepped | to-prep | planned (no recipe to prepare) .
  // prepped: you marked it prepped, or a batch of the same recipe has portions left that are still good on that day.
  function status(occ, batches, today) {
    const e = occ.entry;
    if (eatenOn(e, occ.date)) return { code: "eaten", label: "Eaten" };
    if ((e.preppedDates || []).indexOf(occ.date) !== -1) return { code: "prepped", label: "Prepped" };
    if (e.recipeId) {
      const b = availableBatch(batches, e.recipeId, occ.date < today ? today : occ.date);
      if (b) return { code: "prepped", label: "Prepped", batch: b };
      return { code: "to-prep", label: "To prep" };
    }
    return { code: "planned", label: e.isRestaurant ? "Eating out" : "Planned" };
  }

  // A new plan with an entry moved from one date to another. A single entry changes its date. One showing of a recurring entry is skipped
  // and a single copy is made on the new date (the rest of the series is untouched). Returns { plan, createdId }.
  function moveOccurrence(plan, entryId, fromDate, toDate, newId, now) {
    if (!isDate(toDate)) return { plan: plan, error: "Pick a day." };
    const e = (plan || []).filter(function (x) { return x && x.id === entryId; })[0];
    if (!e) return { plan: plan, error: "That meal isn't there any more." };
    if (e.type !== "recurring") {
      if (e.date === toDate) return { plan: plan, same: true };
      return { plan: plan.map(function (x) { return x.id === entryId ? Object.assign({}, x, { date: toDate, updatedAt: now }) : x; }) };
    }
    if (fromDate === toDate) return { plan: plan, same: true };
    const copy = Object.assign({}, clone(e), { id: newId, type: "single", date: toDate, days: null, skipDates: [], completedDates: [], preppedDates: [], loggedItems: {}, frozen: {}, fromBatch: {}, createdAt: now, updatedAt: now });
    const next = plan.map(function (x) { return x.id === entryId ? Object.assign({}, x, { skipDates: (x.skipDates || []).filter(function (d) { return d !== fromDate; }).concat([fromDate]), updatedAt: now }) : x; });
    return { plan: next.concat([copy]), createdId: newId };
  }
  // Single entries for the same meal on several dates ("repeat across days"). They share a group so they can be removed together.
  function repeatEntries(base, dates, makeId, group, now) {
    const seen = {};
    return (dates || []).filter(function (d) { if (!isDate(d) || seen[d]) return false; seen[d] = true; return true; }).map(function (d) {
      return Object.assign({}, clone(base), { id: makeId(), type: "single", date: d, days: null, group: group, completedDates: [], preppedDates: [], skipDates: [], loggedItems: {}, frozen: {}, fromBatch: {}, createdAt: now, updatedAt: now });
    });
  }
  // Removes one entry, or (all = true) every entry made together with it (same group).
  function removeEntry(plan, id, all) {
    const e = (plan || []).filter(function (x) { return x && x.id === id; })[0];
    if (!e) return plan;
    return plan.filter(function (x) { return !(x.id === id || (all && e.group && x.group === e.group)); });
  }
  // Removes just one day of a recurring entry (it is skipped that day) or the whole single entry.
  function removeOccurrence(plan, id, date, now) {
    const e = (plan || []).filter(function (x) { return x && x.id === id; })[0];
    if (!e) return plan;
    if (e.type !== "recurring") return plan.filter(function (x) { return x.id !== id; });
    return plan.map(function (x) { return x.id === id ? Object.assign({}, x, { skipDates: (x.skipDates || []).filter(function (d) { return d !== date; }).concat([date]), updatedAt: now }) : x; });
  }
  function setPrepped(plan, id, date, on, now) {
    return plan.map(function (x) {
      if (x.id !== id) return x;
      const set = (x.preppedDates || []).filter(function (d) { return d !== date; });
      return Object.assign({}, x, { preppedDates: on ? set.concat([date]) : set, updatedAt: now });
    });
  }
  // Marks one showing eaten: completedDates, the frozen numbers, the food-log line it made and any prepped portions it used.
  function markEaten(plan, id, date, info, now) {
    return plan.map(function (x) {
      if (x.id !== id) return x;
      const o = Object.assign({}, x, { completedDates: (x.completedDates || []).filter(function (d) { return d !== date; }).concat([date]), updatedAt: now });
      o.frozen = Object.assign({}, x.frozen || {}); o.loggedItems = Object.assign({}, x.loggedItems || {}); o.fromBatch = Object.assign({}, x.fromBatch || {});
      if (info && info.nutrition) o.frozen[date] = Object.assign({}, info.nutrition, { name: info.name || x.recipeName, source: info.source || "entered" });
      if (info && info.itemId) o.loggedItems[date] = info.itemId;
      if (info && info.batches && info.batches.length) o.fromBatch[date] = info.batches;
      return o;
    });
  }
  function unmarkEaten(plan, id, date, now) {
    return plan.map(function (x) {
      if (x.id !== id) return x;
      const o = Object.assign({}, x, { completedDates: (x.completedDates || []).filter(function (d) { return d !== date; }), updatedAt: now });
      o.frozen = Object.assign({}, x.frozen || {}); o.loggedItems = Object.assign({}, x.loggedItems || {}); o.fromBatch = Object.assign({}, x.fromBatch || {});
      delete o.frozen[date]; delete o.loggedItems[date]; delete o.fromBatch[date];
      return o;
    });
  }


  /* ---------------- foods: changing, replacing and repeating them ---------------- */

  // What identifies the food an entry stands for (not its day or its eaten state).
  const FOOD_KEYS = ["meal", "recipeId", "recipeName", "servings", "serving", "foodId", "macros", "isRestaurant"];
  function foodOf(entry) {
    const o = {};
    FOOD_KEYS.forEach(function (k) { if (entry && entry[k] !== undefined && entry[k] !== null && !(k === "recipeId" && !entry[k])) o[k] = clone(entry[k]); });
    return o;
  }
  // The food a plain food (not a recipe) is: name, how much, and its own numbers per serving (any left out stay out, nothing is invented).
  function plainFood(o) {
    const f = { recipeId: null, recipeName: oneLine(o.name, 80), servings: num(o.servings) || 1 };
    if (oneLine(o.serving, 40)) f.serving = oneLine(o.serving, 40);
    if (o.foodId) f.foodId = String(o.foodId).slice(0, 80);
    const m = { calories: num(o.calories), protein: num(o.protein), carbs: num(o.carbs), fat: num(o.fat) };
    if (MACROS.some(function (k) { return m[k]; })) f.macros = m; else f.macros = null;
    return f;
  }
  function recipeFood(recipe, servings) { return { recipeId: recipe.id, recipeName: recipe.name, servings: num(servings) || 1, macros: null, foodId: null, serving: "" }; }

  // The per-date state of an entry (eaten, prepped, skipped, what was logged) split at a date: before it and from it on.
  const DATE_LISTS = ["completedDates", "preppedDates", "skipDates"], DATE_MAPS = ["frozen", "loggedItems", "fromBatch"];
  function splitState(e, date) {
    const before = {}, after = {};
    DATE_LISTS.forEach(function (k) { const l = Array.isArray(e[k]) ? e[k] : []; before[k] = l.filter(function (d) { return d < date; }); after[k] = l.filter(function (d) { return d >= date; }); });
    DATE_MAPS.forEach(function (k) { const m = e[k] && typeof e[k] === "object" ? e[k] : {}; before[k] = {}; after[k] = {}; Object.keys(m).forEach(function (d) { (d < date ? before : after)[k][d] = m[d]; }); });
    return { before: before, after: after };
  }
  // A repeating food, from one day on. The earlier days keep the old food (and what you ate on them); the new part is its own entry.
  // -> { plan, id, whole } : whole is true when the series starts on or after that day, so the entry itself is the one to change.
  function splitSeries(plan, id, date, newId, now) {
    const e = (plan || []).filter(function (x) { return x && x.id === id; })[0];
    if (!e || e.type !== "recurring") return { plan: plan, id: id, whole: true };
    if (isDate(e.from) && date <= e.from) return { plan: plan, id: id, whole: true };
    const parts = splitState(e, date);
    const old = Object.assign({}, e, parts.before, { until: addDays(date, -1), updatedAt: now });
    const fresh = Object.assign({}, clone(e), parts.after, { id: newId, from: date, createdAt: now, updatedAt: now });
    delete fresh.group;
    return { plan: plan.map(function (x) { return x.id === id ? old : x; }).concat([fresh]), id: newId, whole: false };
  }
  function applyFood(e, fields, now) {
    const o = Object.assign({}, e, fields, { updatedAt: now });
    if (fields.macros === null || (fields.macros && !MACROS.some(function (k) { return num(fields.macros[k]); }))) delete o.macros;
    ["foodId", "serving"].forEach(function (k) { if (fields[k] === null || fields[k] === "") delete o[k]; });
    if (!o.recipeId) o.recipeId = null;
    return o;
  }
  // Change what a food is (replace it, or edit its name, numbers, portion or meal).
  // scope: "day" (only that day) or "series" (that day and every week after). A food made for one day changes in place either way.
  // -> { plan, id } the entry that now holds the food on that date, or { plan, error }
  function changeFood(plan, id, date, scope, fields, newId, now) {
    const e = (plan || []).filter(function (x) { return x && x.id === id; })[0];
    if (!e) return { plan: plan, error: "That food isn't there any more." };
    if (e.type !== "recurring") return { plan: plan.map(function (x) { return x.id === id ? applyFood(x, fields, now) : x; }), id: id };
    if (scope === "series") {
      const sp = splitSeries(plan, id, date, newId, now);
      return { plan: sp.plan.map(function (x) { return x.id === sp.id ? applyFood(x, fields, now) : x; }), id: sp.id };
    }
    const base = clone(e);
    ["from", "until", "group", "frozen", "loggedItems", "fromBatch"].forEach(function (k) { delete base[k]; });
    const single = applyFood(Object.assign(base, { id: newId, type: "single", date: date, days: null, completedDates: [], preppedDates: [], skipDates: [], loggedItems: {}, frozen: {}, fromBatch: {}, createdAt: now }), fields, now);
    const skipped = plan.map(function (x) { return x.id === id ? Object.assign({}, x, { skipDates: (x.skipDates || []).filter(function (d) { return d !== date; }).concat([date]), updatedAt: now }) : x; });
    return { plan: skipped.concat([single]), id: newId };
  }
  // Take a food off one day, or off that day and every week after (what was eaten before stays on the earlier days).
  function removeFood(plan, id, date, scope, now) {
    const e = (plan || []).filter(function (x) { return x && x.id === id; })[0];
    if (!e) return plan;
    if (e.type !== "recurring") return plan.filter(function (x) { return x.id !== id; });
    if (scope === "series") {
      if (isDate(e.from) && date <= e.from) return plan.filter(function (x) { return x.id !== id; });
      return plan.map(function (x) { return x.id === id ? Object.assign({}, x, { until: addDays(date, -1), updatedAt: now }) : x; });
    }
    return removeOccurrence(plan, id, date, now);
  }
  // A food that repeats every week on some weekdays, starting on a day (it carries into next week by itself).
  function makeRecurring(base, days, from, id, group, now) {
    const d = (days || []).map(Number).filter(function (x, i, a) { return x >= 0 && x <= 6 && a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    const o = Object.assign({}, clone(base), { id: id, type: "recurring", days: d, date: null, from: from, createdAt: now, updatedAt: now, completedDates: [], preppedDates: [], skipDates: [], loggedItems: {}, frozen: {}, fromBatch: {} });
    delete o.until;
    if (group) o.group = group; else delete o.group;
    return o;
  }
  // Last week's one-off foods put on this week (same weekday). Anything already there (same meal, day and food) is left alone.
  // -> { plan, added }
  function copyWeek(plan, fromStart, toStart, makeId, now) {
    const shift = diffDays(fromStart, toStart), have = {};
    (plan || []).forEach(function (e) { if (e && e.type !== "recurring" && isDate(e.date)) have[e.date + "|" + e.meal + "|" + (e.recipeId || e.recipeName)] = true; });
    const add = [];
    (plan || []).forEach(function (e) {
      if (!e || e.type === "recurring" || !isDate(e.date) || e.date < fromStart || e.date > addDays(fromStart, 6)) return;
      const d = addDays(e.date, shift), key = d + "|" + e.meal + "|" + (e.recipeId || e.recipeName);
      if (have[key]) return;
      have[key] = true;
      add.push(Object.assign({}, clone(e), { id: makeId(), date: d, completedDates: [], preppedDates: [], skipDates: [], loggedItems: {}, frozen: {}, fromBatch: {}, createdAt: now, updatedAt: now }));
      delete add[add.length - 1].group;
    });
    return { plan: (plan || []).concat(add), added: add.length };
  }

  /* ---------------- saved meals ---------------- */

  // A meal you eat often: a name, the meal it belongs to, and its foods. Each food is copied as it is now (numbers included), so a saved
  // meal keeps working if a recipe or a saved food is edited or deleted later.
  function savedMealFrom(name, meal, entries, id, now) {
    return { id: id, name: oneLine(name, 60), meal: MEALS.indexOf(meal) === -1 ? "dinner" : meal, foods: (entries || []).map(foodOf).map(function (f) { delete f.meal; delete f.isRestaurant; return f; }), createdAt: now, updatedAt: now };
  }
  // The plan entries a saved meal makes on a date (one per food): [{ ...food, meal, type: single, date }]
  function entriesFromSavedMeal(saved, meal, date, makeId, now) {
    return ((saved && saved.foods) || []).map(function (f) {
      return Object.assign({ id: makeId(), type: "single", date: date, days: null, meal: meal, isRestaurant: false, includeInGroceries: false, completedDates: [], createdAt: now, updatedAt: now }, clone(f), { meal: meal });
    });
  }

  /* ---------------- storage, use-by dates and batches ---------------- */

  // General food-safety guidance (USDA FoodSafety.gov): cooked leftovers keep 3-4 days in the refrigerator; in the freezer they stay safe
  // but are best within a few months. Reheat to 165 F (74 C). This is guidance, not a guarantee: smell and look do not tell you.
  const GUIDE = {
    fridge: { days: FRIDGE_DAYS, label: "Refrigerator", rule: "Keep at 40 F (4 C) or colder and eat within 3 to 4 days. Put it in the fridge within 2 hours of cooking." },
    freezer: { days: FREEZER_DAYS, label: "Freezer", rule: "Keep at 0 F (-18 C). Safe for a long time; best quality within about 3 months." },
    thawed: { days: THAWED_DAYS, label: "Thawed in the fridge", rule: "Eat within 3 to 4 days of thawing, and don't refreeze it unless you cook it again." }
  };
  function useBy(preparedOn, place) {
    if (!isDate(preparedOn)) return "";
    return addDays(preparedOn, place === "freezer" ? FREEZER_DAYS : FRIDGE_DAYS);
  }
  function reheatText(place, custom) {
    const base = "Reheat until steaming hot all the way through (165 F / 74 C). Stir halfway in the microwave; add a splash of water to rice or pasta.";
    const t = oneLine(custom, 300);
    return (place === "freezer" ? "Thaw overnight in the fridge (or defrost in the microwave and eat right away), then reheat. " : "") + (t ? t + " " : "") + base;
  }
  // How a batch stands on a day: { daysLeft, level: "ok" | "soon" | "today" | "past" | "gone", text }
  function batchState(b, today) {
    if (!b || !(num(b.remaining) > 0)) return { daysLeft: null, level: "gone", text: "All eaten" };
    if (!isDate(b.useBy)) return { daysLeft: null, level: "ok", text: "" };
    const left = diffDays(today, b.useBy);
    if (left < 0) return { daysLeft: left, level: "past", text: "Past its use-by date (" + -left + (left === -1 ? " day" : " days") + " ago). Throw it out if you are not sure." };
    if (left === 0) return { daysLeft: 0, level: "today", text: "Use by today" };
    if (left <= 1) return { daysLeft: left, level: "soon", text: "Use by tomorrow" };
    return { daysLeft: left, level: left <= 2 ? "soon" : "ok", text: left + " days left" };
  }
  // A new batch of prepared portions from a recipe. per = what one portion has (a copy, so a recipe edit later does not change it).
  function newBatch(o, id, now) {
    const place = o.place === "freezer" ? "freezer" : "fridge", portions = Math.max(1, Math.round(num(o.portions)) || 1);
    return {
      id: id, recipeId: o.recipeId || "", name: oneLine(o.name, 80), preparedOn: o.preparedOn, portions: portions, remaining: portions, place: place,
      movedOn: o.preparedOn, useBy: isDate(o.useBy) ? o.useBy : useBy(o.preparedOn, place), reheat: oneLine(o.reheat, 300),
      per: o.per ? roundMacros(o.per) : null, perSource: o.perSource || "", notes: oneLine(o.notes, 200), eaten: [], createdAt: now, updatedAt: now
    };
  }
  function availableBatch(batches, recipeId, date) {
    const list = (batches || []).filter(function (b) { return b && !b.deletedAt && b.recipeId === recipeId && num(b.remaining) > 0 && (!isDate(b.useBy) || b.useBy >= date); });
    return list.sort(function (a, b) { return (a.useBy || "9999") < (b.useBy || "9999") ? -1 : 1; })[0] || null;
  }
  function portionsLeft(batches, today) {
    return (batches || []).filter(function (b) { return b && !b.deletedAt && num(b.remaining) > 0; }).reduce(function (n, b) { return n + num(b.remaining); }, 0);
  }
  // Eat n portions (never more than are left). -> { batches, used } where used is what was taken, so it can be given back.
  function eatPortions(batches, id, n, date, now) {
    let used = 0;
    const next = batches.map(function (b) {
      if (b.id !== id) return b;
      used = Math.min(Math.round(num(n)), Math.round(num(b.remaining)));
      if (used <= 0) return b;
      return Object.assign({}, b, { remaining: b.remaining - used, eaten: (b.eaten || []).concat([{ date: date, n: used }]), updatedAt: now });
    });
    return { batches: next, used: used };
  }
  function restorePortions(batches, id, n, date, now) {
    return batches.map(function (b) {
      if (b.id !== id) return b;
      const log = (b.eaten || []).slice(), at = log.map(function (x) { return x.date; }).lastIndexOf(date);
      if (at !== -1) { const left = log[at].n - n; if (left > 0) log[at] = { date: date, n: left }; else log.splice(at, 1); }
      return Object.assign({}, b, { remaining: Math.min(b.portions, b.remaining + n), eaten: log, updatedAt: now });
    });
  }
  // Portions eaten from a plan: uses the soonest use-by batch of the recipe that is still good. -> { batches, used: [{ batchId, n }] }
  function useFromBatches(batches, recipeId, servings, date, now) {
    let need = Math.max(1, Math.round(num(servings)) || 1), list = batches, used = [];
    while (need > 0) {
      const b = availableBatch(list, recipeId, date);
      if (!b) break;
      const r = eatPortions(list, b.id, need, date, now);
      if (!r.used) break;
      used.push({ batchId: b.id, n: r.used }); need -= r.used; list = r.batches;
    }
    return { batches: list, used: used };
  }
  // Move a batch between the fridge and the freezer. Freezing starts a new clock; thawing in the fridge gives a short one.
  function moveBatch(batches, id, to, date, now) {
    return batches.map(function (b) {
      if (b.id !== id || b.place === to) return b;
      const from = b.place;
      const u = to === "freezer" ? addDays(date, FREEZER_DAYS) : addDays(date, from === "freezer" ? THAWED_DAYS : FRIDGE_DAYS);
      return Object.assign({}, b, { place: to, movedOn: date, useBy: u, updatedAt: now });
    });
  }

  /* ---------------- ideas ---------------- */

  const WORDS = /[a-z]+/g;
  function words(s) { return (String(s || "").toLowerCase().match(WORDS) || []).filter(function (w) { return w.length > 2; }); }
  function haveIt(pantryKeys, name) {
    const n = keyOf(name);
    if (!n) return false;
    return pantryKeys.some(function (k) { return k === n || k.indexOf(n) !== -1 || n.indexOf(k) !== -1; });
  }
  // Recipes ranked by how much of them you already have. pantry: { key: { name, quantity } }. Only things with something left count.
  function pantryMatches(recipes, pantry) {
    const keys = Object.keys(pantry || {}).filter(function (k) { return num(pantry[k] && pantry[k].quantity) > 0; });
    return (recipes || []).filter(function (r) { return (r.ingredients || []).length; }).map(function (r) {
      const names = (r.ingredients || []).map(function (i) { return i.name; }).filter(Boolean);
      const have = names.filter(function (n) { return haveIt(keys, n); });
      return { recipe: r, have: have.length, total: names.length, missing: names.filter(function (n) { return !haveIt(keys, n); }), share: names.length ? have.length / names.length : 0 };
    }).filter(function (m) { return m.have > 0; }).sort(function (a, b) { return b.share - a.share || b.have - a.have || (a.recipe.name < b.recipe.name ? -1 : 1); });
  }
  function recoveryRecipes(recipes) { return (recipes || []).filter(function (r) { return hasNutrition(r) && isRecoveryFriendly(recipePer(r)); }); }

  // Meals to fill empty slots in a set of days, from the recipe library. Prefers a recipe of the right kind of meal, one not used in the last
  // few days, favourites, and (on a training day) one with protein and carbohydrate. Nothing is chosen for you: these are suggestions.
  // opts: { dates, plan, recipes, training: { date: true } } -> [{ date, meal, recipe, why }]
  function fillSuggestions(opts) {
    const plan = opts.plan || [], recipes = (opts.recipes || []).filter(function (r) { return (r.ingredients || []).length; });
    const out = [], usedRecently = {};
    const dates = opts.dates || [];
    const first = dates[0], last = dates[dates.length - 1];
    const occ = first ? occurrences(plan, addDays(first, -3), last) : [];
    dates.forEach(function (d) {
      MEALS.forEach(function (meal) {
        if (meal === "snacks" && out.some(function (s) { return s.date === d && s.meal === "snacks"; })) return;
        if (occ.some(function (o) { return o.date === d && o.meal === meal; })) return;
        const recent = {}; occ.concat(out.map(function (s) { return { date: s.date, entry: { recipeId: s.recipe.id } }; })).forEach(function (o) { if (o.entry.recipeId && o.date <= d && diffDays(o.date, d) <= 3) recent[o.entry.recipeId] = true; });
        const training = !!(opts.training && opts.training[d]);
        const cands = recipes.filter(function (r) { return (r.cats || []).indexOf(meal) !== -1; });
        let best = null, bestScore = -1, why = "";
        cands.forEach(function (r) {
          let score = 1, w = "In your " + MEAL_LABELS[meal].toLowerCase() + " recipes";
          if (r.favorite) { score += 2; w = "A favorite"; }
          if (!recent[r.id]) score += 2; else score -= 2;
          if (training && hasNutrition(r) && isRecoveryFriendly(recipePer(r))) { score += 3; w = "Protein and carbs for a training day"; }
          if (score > bestScore) { best = r; bestScore = score; why = w; }
        });
        if (best) out.push({ date: d, meal: meal, recipe: best, why: why });
      });
    });
    return out;
  }

  const LEFTOVER_IDEAS = [
    { words: ["rice"], ideas: ["Fried rice with egg and vegetables", "A rice bowl with beans and salsa", "Stuffed peppers"] },
    { words: ["chicken"], ideas: ["Chicken wraps or a salad", "Chicken fried rice", "Chicken and vegetable soup"] },
    { words: ["turkey"], ideas: ["Turkey tacos or burrito bowls", "Stuffed peppers", "Turkey chili"] },
    { words: ["beef"], ideas: ["Beef tacos or a rice bowl", "Beef and vegetable stir-fry", "Chili"] },
    { words: ["salmon", "fish", "cod", "tilapia", "tuna"], ideas: ["Fish tacos", "A salmon salad or wrap", "Fish cakes with potato"] },
    { words: ["pasta", "noodles", "spaghetti"], ideas: ["A baked pasta with cheese", "Cold pasta salad", "Pasta frittata"] },
    { words: ["potato", "potatoes"], ideas: ["Breakfast hash with eggs", "Potato and egg skillet", "Soup"] },
    { words: ["beans", "lentils", "chickpeas"], ideas: ["A burrito or quesadilla", "Soup or stew", "A grain bowl"] },
    { words: ["vegetables", "broccoli", "veggies", "carrot", "zucchini"], ideas: ["Add to an omelet", "Blend into a soup", "Toss through pasta or rice"] },
    { words: ["egg", "eggs"], ideas: ["Egg salad sandwich", "Add to a rice bowl"] }
  ];
  // Ways to use up a batch: simple ideas from what is in it, and your own recipes that share an ingredient with it.
  function leftoverIdeas(batch, recipes) {
    const rec = (recipes || []).filter(function (r) { return r.id === batch.recipeId; })[0];
    const names = rec ? (rec.ingredients || []).map(function (i) { return i.name; }) : [];
    const text = words(batch.name + " " + names.join(" "));
    const ideas = [];
    LEFTOVER_IDEAS.forEach(function (g) { if (g.words.some(function (w) { return text.indexOf(w) !== -1; })) g.ideas.forEach(function (i) { if (ideas.indexOf(i) === -1) ideas.push(i); }); });
    const mine = (recipes || []).filter(function (r) { return r.id !== batch.recipeId && (r.ingredients || []).some(function (i) { return names.some(function (n) { return keyOf(n) && keyOf(i.name) && (keyOf(i.name).indexOf(keyOf(n)) !== -1 || keyOf(n).indexOf(keyOf(i.name)) !== -1); }); }); });
    return { ideas: ideas.slice(0, 4), recipes: mine.slice(0, 3) };
  }

  // Free stretches to prepare food in. rows: [{ date, start, end }] minutes, already the free time between things. -> best first.
  // need is minutes; weekends and the day before a day with several planned meals to prepare are preferred; late evenings are not offered.
  function prepSlots(rows, need, opts) {
    const o = opts || {}, win = o.window || { start: 9 * 60, end: 20 * 60 };
    const out = [];
    (rows || []).forEach(function (r) {
      const s = Math.max(r.start, win.start), e = Math.min(r.end, win.end);
      if (e - s >= need) out.push({ date: r.date, start: s, end: s + need, free: e - s });
    });
    return out.map(function (s) {
      const wk = weekday(s.date), weekend = wk === 0 || wk === 6;
      const load = (o.load && o.load[addDays(s.date, 1)]) || 0;
      return Object.assign(s, { score: (weekend ? 3 : 0) + Math.min(3, load) + (s.free >= need + 60 ? 1 : 0) - (diffDays(o.today || s.date, s.date) > 5 ? 1 : 0) });
    }).sort(function (a, b) { return b.score - a.score || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start); });
  }
  // Minutes a cooking session for these recipes may need: each recipe's prep and cook time, plus 20 minutes to portion and clean up.
  function sessionMinutes(recipes) {
    const t = (recipes || []).reduce(function (n, r) { return n + totalMinutes(r); }, 0);
    return t ? t + 20 : 0;
  }

  /* ---------------- training days ---------------- */

  // Which dates have a routine scheduled. routines: [{ name, scheduledDays: [0..6, Monday first], archivedAt }] -> { date: name }
  function trainingDays(routines, dates) {
    const out = {};
    dates.forEach(function (d) {
      const idx = (weekday(d) + 6) % 7;
      const r = (routines || []).filter(function (x) { return x && !x.archivedAt && Array.isArray(x.scheduledDays) && x.scheduledDays.indexOf(idx) !== -1; })[0];
      if (r) out[d] = oneLine(r.name, 40);
    });
    return out;
  }

  return {
    MEALS: MEALS, MEAL_LABELS: MEAL_LABELS, MACROS: MACROS, CATS: CATS, GUIDE: GUIDE, FRIDGE_DAYS: FRIDGE_DAYS, FREEZER_DAYS: FREEZER_DAYS, HIGH_PROTEIN_G: HIGH_PROTEIN_G,
    RECOVERY_PROTEIN_G: RECOVERY_PROTEIN_G, RECOVERY_CARBS_G: RECOVERY_CARBS_G,
    isDate: isDate, isTime: isTime, addDays: addDays, weekday: weekday, mondayOf: mondayOf, weekDates: weekDates, diffDays: diffDays, keyOf: keyOf, roundMacros: roundMacros,
    parseQty: parseQty, toGrams: toGrams, scaleQty: scaleQty, recipeExtras: recipeExtras, cleanIngredient: cleanIngredient, recipeTotals: recipeTotals, recipePer: recipePer,
    servingsOf: servingsOf, hasNutrition: hasNutrition, recipeSource: recipeSource, isHighProtein: isHighProtein, isRecoveryFriendly: isRecoveryFriendly, inCategory: inCategory,
    totalMinutes: totalMinutes, searchRecipes: searchRecipes, duplicateRecipe: duplicateRecipe, scaledIngredients: scaledIngredients,
    estimate: estimate, calculate: calculate,
    occurrences: occurrences, eatenOn: eatenOn, recipeOf: recipeOf, entryNutrition: entryNutrition, dayPlan: dayPlan, compare: compare, targetShare: targetShare, status: status,
    foodOf: foodOf, plainFood: plainFood, recipeFood: recipeFood, splitSeries: splitSeries, changeFood: changeFood, removeFood: removeFood, makeRecurring: makeRecurring, copyWeek: copyWeek,
    savedMealFrom: savedMealFrom, entriesFromSavedMeal: entriesFromSavedMeal,
    moveOccurrence: moveOccurrence, repeatEntries: repeatEntries, removeEntry: removeEntry, removeOccurrence: removeOccurrence, setPrepped: setPrepped, markEaten: markEaten, unmarkEaten: unmarkEaten,
    useBy: useBy, reheatText: reheatText, batchState: batchState, newBatch: newBatch, availableBatch: availableBatch, portionsLeft: portionsLeft, eatPortions: eatPortions,
    restorePortions: restorePortions, useFromBatches: useFromBatches, moveBatch: moveBatch,
    pantryMatches: pantryMatches, recoveryRecipes: recoveryRecipes, fillSuggestions: fillSuggestions, leftoverIdeas: leftoverIdeas, prepSlots: prepSlots, sessionMinutes: sessionMinutes, trainingDays: trainingDays
  };
});
