"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../js/mealprep-logic.js");
const F = require("../../js/mealprep-foods.js");

// 2026-11-16 is a Monday.
const ing = (name, quantity, cal, p, c, f, extra) => Object.assign({ name, quantity, calories: cal, protein: p, carbs: c, fat: f, fiber: 0 }, extra || {});
const bowl = { id: "r_bowl", name: "Turkey rice bowl", servings: 4, createdAt: 1, cats: ["lunch", "dinner"], prepMin: 15, cookMin: 30, ingredients: [ing("Ground turkey", "500 g", 750, 93.5, 0, 41.5), ing("Cooked rice", "400 g", 520, 10.8, 112.8, 1.2), ing("Broccoli", "300 g", 102, 8.4, 19.8, 1.2)] };
const oats = { id: "r_oats", name: "Overnight oats", servings: 1, createdAt: 1, cats: ["breakfast"], ingredients: [ing("Rolled oats", "50 g", 195, 8.5, 33, 3.5)] };

test("the typical-values list: foods are found by name, and a plain food is not confused with a broth, sauce or milk made from something else", () => {
  assert.equal(F.find("93% lean ground turkey").id, "ground-turkey");
  assert.equal(F.find("Boneless skinless chicken breast").id, "chicken-breast");
  assert.equal(F.find("cooked white rice").id, "white-rice");
  assert.equal(F.find("brown rice").id, "brown-rice");
  assert.equal(F.find("rice").id, "white-rice");
  assert.equal(F.find("chicken broth"), null);
  assert.equal(F.find("coconut milk"), null);
  assert.equal(F.find("tomato sauce"), null);
  assert.equal(F.find("xyzzy"), null);
  assert.equal(F.stateInName("Cooked rice"), "cooked"); assert.equal(F.stateInName("raw chicken"), "raw"); assert.equal(F.stateInName("rice"), "");
  F.FOODS.forEach((f) => { ["raw", "cooked", "packaged"].forEach((s) => { if (f[s]) { assert.equal(f[s].length, 4, f.id); assert.ok(f[s].every((n) => n >= 0), f.id); } }); assert.ok(f.raw || f.packaged || f.cooked, f.id + " has numbers"); });
});

test("quantities: parse and scale", () => {
  assert.deepEqual(M.parseQty("500 g"), { amount: 500, unit: "g" });
  assert.deepEqual(M.parseQty("1 1/2 cups"), { amount: 1.5, unit: "cup" });
  assert.deepEqual(M.parseQty("2"), { amount: 2, unit: "each" });
  assert.deepEqual(M.parseQty("1,000 g"), { amount: 1000, unit: "g" });
  assert.equal(M.parseQty("a pinch"), null); assert.equal(M.parseQty(""), null); assert.equal(M.parseQty("0 g"), null);
  assert.equal(M.scaleQty("2 cups", 1.5), "3 cups");
  assert.equal(M.scaleQty("1/2 tsp salt", 2), "1 tsp salt");
  assert.equal(M.scaleQty("a pinch", 2), "a pinch (x2)");
  assert.equal(M.toGrams(1, "lb"), 453.592);
  assert.equal(M.toGrams(2, "each", F.byId("egg")), 100);
  assert.equal(M.toGrams(2, "each", F.byId("rice")), null, "a piece of rice is not a weight: nothing is guessed");
});

test("a recipe: per serving is sum / servings, always worked out; where the numbers came from is said", () => {
  const per = M.recipePer(bowl);
  assert.deepEqual(M.roundMacros(per), { calories: 343, protein: 28.2, carbs: 33.2, fat: 11 });
  assert.equal(M.recipeSource(bowl).kind, "entered");
  assert.equal(M.recipeSource({ ingredients: [ing("a", "1", 100, 0, 0, 0, { est: true }), ing("b", "1", 100, 0, 0, 0)] }).kind, "mixed");
  assert.equal(M.recipeSource({ ingredients: [ing("a", "1", 100, 0, 0, 0, { est: true })] }).kind, "estimated");
  assert.equal(M.recipeSource({ ingredients: [ing("a", "1", 0, 0, 0, 0)] }).kind, "none");
  assert.equal(M.hasNutrition({ ingredients: [ing("a", "1", 0, 0, 0, 0)] }), false);
  assert.equal(M.servingsOf({ servings: 0 }), 1); assert.equal(M.servingsOf({ servings: "x" }), 1);
});

test("categories: high protein is the tag or 25 g a serving; recovery needs protein and carbs together", () => {
  assert.equal(M.isHighProtein(bowl), true, "28 g a serving");
  assert.equal(M.isHighProtein(oats), false);
  assert.equal(M.isRecoveryFriendly(M.recipePer(bowl)), true);
  assert.equal(M.isRecoveryFriendly({ protein: 30, carbs: 5 }), false);
  assert.deepEqual(M.recoveryRecipes([bowl, oats]).map((r) => r.id), ["r_bowl"]);
  assert.equal(M.inCategory(bowl, "lunch"), true); assert.equal(M.inCategory(bowl, "breakfast"), false);
  assert.equal(M.inCategory(bowl, "high-protein"), true); assert.equal(M.inCategory(bowl, "favorites"), false);
  assert.equal(M.inCategory(Object.assign({}, oats, { favorite: true }), "favorites"), true);
  assert.equal(M.inCategory(oats, "all"), true);
  assert.deepEqual(M.searchRecipes([bowl, oats], "oat").map((r) => r.id), ["r_oats"]);
  assert.deepEqual(M.searchRecipes([bowl, oats], "broccoli").map((r) => r.id), ["r_bowl"], "searches ingredients too");
  assert.equal(M.totalMinutes(bowl), 45);
});

test("recipe extras: only good optional fields are kept", () => {
  assert.deepEqual(M.recipeExtras({ cats: ["lunch", "x", "lunch"], favorite: true, prepMin: "15", cookMin: -3, storage: { place: "fridge", notes: "  airtight ", reheat: "" }, image: "data:image/jpeg;base64,AAAA" }),
    { cats: ["lunch"], favorite: true, prepMin: 15, storage: { place: "fridge", notes: "airtight" }, image: "data:image/jpeg;base64,AAAA" });
  assert.deepEqual(M.recipeExtras({ image: "http://x/y.png", favorite: "yes", storage: { place: "attic" } }), {});
  assert.deepEqual(M.recipeExtras(null), {});
  const d = M.duplicateRecipe(Object.assign({}, bowl, { favorite: true }), "r2", 5);
  assert.equal(d.id, "r2"); assert.equal(d.name, "Turkey rice bowl (copy)"); assert.equal(d.favorite, undefined); assert.equal(d.ingredients.length, 3);
  d.ingredients[0].name = "changed"; assert.equal(bowl.ingredients[0].name, "Ground turkey", "a copy shares nothing with the original");
  assert.deepEqual(M.scaledIngredients(bowl, 2).map((i) => i.text), ["250 g", "200 g", "150 g"]);
});

test("estimating an ingredient: the state it is weighed in decides the numbers", () => {
  const rawRice = M.estimate("rice", "100 g", "raw"), cookedRice = M.estimate("rice", "100 g", "cooked");
  assert.equal(rawRice.calories, 365); assert.equal(cookedRice.calories, 130);
  assert.equal(M.estimate("chicken breast", "300 g", "cooked").calories, 495);
  assert.equal(M.estimate("chicken breast", "400 g", "raw").calories, 480);
  assert.equal(M.estimate("Cooked rice", "100 g").calories, 130, "the name can say it");
  assert.equal(M.estimate("rice", "100 g").calories, 130, "rice is usually weighed cooked");
  assert.equal(M.estimate("chicken breast", "100 g").calories, 120, "chicken is usually weighed raw");
  const sp = M.estimate("spinach", "100 g", "cooked");
  assert.equal(sp.converted, true); assert.match(sp.note, /typical yield/);
  assert.equal(M.estimate("2 eggs", "2", "").calories, 143, "2 eggs are 100 g");
  assert.match(M.estimate("rice", "2 cups", "cooked").error, /can't turn/, "cups of rice are not guessed");
  assert.match(M.estimate("dragon fruit", "100 g").error, /No typical value/);
  assert.match(M.estimate("rice", "").error, /amount/);
  assert.equal(M.estimate("canned tuna", "100 g", "raw").calories, 116, "a packaged food has one state");
});

test("the portion calculator: the 1,000 g turkey, 500 g cooked rice, 200 g vegetables, five portions example", () => {
  const r = M.calculate({ portions: 5, rows: [
    { name: "ground turkey", amount: 1000, unit: "g", state: "raw" },
    { name: "rice", amount: 500, unit: "g", state: "cooked" },
    { name: "mixed vegetables", amount: 200, unit: "g", state: "raw" }
  ] });
  assert.deepEqual(r.totals, { calories: 2250, protein: 205.5, carbs: 161, fat: 85.1 });
  assert.deepEqual(r.perPortion, { calories: 450, protein: 41.1, carbs: 32.2, fat: 17 });
  assert.equal(r.anyEstimated, true);
  assert.ok(r.warnings.some((w) => /generic/.test(w)), "the generic vegetable mix says it is generic");
  // weighing the rice RAW instead gives a very different answer: that is the point of asking
  const raw = M.calculate({ portions: 5, rows: [{ name: "rice", amount: 500, unit: "g", state: "raw" }] });
  assert.equal(raw.totals.calories, 1825); assert.equal(raw.perPortion.calories, 365);
  assert.equal(M.calculate({ portions: 5, dishWeight: 2500, rows: [{ name: "rice", amount: 500, unit: "g", state: "cooked" }] }).gramsPerPortion, 500);
  assert.equal(M.calculate({ portions: 0, rows: [{ name: "rice", amount: 500, unit: "g", state: "cooked" }] }).perPortion, null);
});

test("the calculator with your own numbers: for the whole amount, per 100 g, and the raw/cooked mismatch", () => {
  const whole = M.calculate({ portions: 2, rows: [{ name: "my sauce", amount: 1, unit: "each", own: { calories: 200, protein: 4, carbs: 30, fat: 8 } }] });
  assert.deepEqual(whole.perPortion, { calories: 100, protein: 2, carbs: 15, fat: 4 });
  assert.equal(whole.rows[0].source, "yours"); assert.equal(whole.anyEstimated, false);
  const p100 = M.calculate({ portions: 1, rows: [{ name: "rice", amount: 300, unit: "g", state: "cooked", own: { basis: "per100", state: "cooked", calories: 150, protein: 3, carbs: 30, fat: 1 } }] });
  assert.equal(p100.totals.calories, 450);
  // the label says 365 kcal per 100 g DRY rice but 300 g of cooked rice was weighed: converted with the yield, not multiplied as if it were dry
  const conv = M.calculate({ portions: 1, rows: [{ name: "rice", amount: 280, unit: "g", state: "cooked", own: { basis: "per100", state: "raw", calories: 365, protein: 7, carbs: 80, fat: 1 } }] });
  assert.equal(conv.totals.calories, 365, "280 g cooked is 100 g dry");
  assert.match(conv.rows[0].note, /converted/);
  const noYield = M.calculate({ portions: 1, rows: [{ name: "my stew", amount: 300, unit: "g", state: "cooked", own: { basis: "per100", state: "raw", calories: 100, protein: 1, carbs: 1, fat: 1 } }] });
  assert.ok(noYield.warnings.some((w) => /no typical yield/.test(w)));
  assert.match(M.calculate({ portions: 1, rows: [{ name: "x y z", amount: 100, unit: "g" }] }).rows[0].error, /No typical value/);
  assert.match(M.calculate({ portions: 1, rows: [{ name: "rice", unit: "g" }] }).rows[0].error, /amount/);
});

const plan = [
  { id: "p1", type: "single", date: "2026-11-16", meal: "lunch", recipeId: "r_bowl", recipeName: "Turkey rice bowl", servings: 1, completedDates: [], createdAt: 2 },
  { id: "p2", type: "single", date: "2026-11-16", meal: "breakfast", recipeId: "r_oats", recipeName: "Overnight oats", servings: 1, completedDates: [], createdAt: 3 },
  { id: "p3", type: "recurring", days: [1, 3], meal: "snacks", recipeId: "", recipeName: "Fruit", servings: 1, macros: { calories: 90, protein: 1, carbs: 23, fat: 0 }, completedDates: [], createdAt: 4 }
];

test("the week plan: single and recurring meals show on their days, in day and meal order, and skipped days stay skipped", () => {
  const o = M.occurrences(plan, "2026-11-16", "2026-11-22");
  assert.deepEqual(o.map((x) => x.date + " " + x.meal), ["2026-11-16 breakfast", "2026-11-16 lunch", "2026-11-16 snacks", "2026-11-18 snacks"]);
  const skipped = M.occurrences(plan.map((e) => e.id === "p3" ? Object.assign({}, e, { skipDates: ["2026-11-16"] }) : e), "2026-11-16", "2026-11-22");
  assert.deepEqual(skipped.map((x) => x.key), ["p2@2026-11-16", "p1@2026-11-16", "p3@2026-11-18"]);
  assert.deepEqual(M.occurrences([null, { id: "x", meal: "brunch", date: "2026-11-16" }, { id: "y", meal: "lunch", date: "nope" }], "2026-11-16", "2026-11-22"), []);
});

test("planned nutrition for a day: from the recipe per serving, from your own numbers for a quick meal; meals with no numbers are counted, not guessed", () => {
  const d = M.dayPlan(plan.concat([{ id: "p4", type: "single", date: "2026-11-16", meal: "dinner", recipeId: "", recipeName: "Pizza night", servings: 1, completedDates: [], createdAt: 5 }]), [bowl, oats], "2026-11-16");
  assert.equal(d.items.length, 4);
  assert.deepEqual(d.totals, { calories: 343 + 195 + 90, protein: 28.2 + 8.5 + 1, carbs: 33.2 + 33 + 23, fat: 11 + 3.5 + 0 });
  assert.equal(d.withNumbers, 3); assert.equal(d.withoutNumbers, 1);
  assert.equal(d.upcoming, 4); assert.equal(d.eaten, 0);
  const none = M.dayPlan(plan, [], "2026-11-16");
  assert.equal(none.items.find((i) => i.entry.id === "p1").nutrition, null, "a recipe that can't be found has no numbers");
});

test("a meal marked eaten keeps the numbers it had: editing the recipe later does not change it", () => {
  const info = { nutrition: M.roundMacros(M.recipePer(bowl)), name: "Turkey rice bowl", source: "entered", itemId: "food_1", batches: [{ batchId: "b1", n: 1 }] };
  const eaten = M.markEaten(plan, "p1", "2026-11-16", info, 10);
  const edited = Object.assign({}, bowl, { ingredients: bowl.ingredients.map((i) => Object.assign({}, i, { calories: 9999 })) });
  const d = M.dayPlan(eaten, [edited], "2026-11-16");
  const it = d.items.find((i) => i.entry.id === "p1");
  assert.equal(it.nutrition.calories, 343, "still the numbers it had");
  assert.equal(it.frozen, true); assert.equal(it.eaten, true);
  assert.equal(eaten.find((e) => e.id === "p1").loggedItems["2026-11-16"], "food_1");
  assert.deepEqual(eaten.find((e) => e.id === "p1").fromBatch["2026-11-16"], [{ batchId: "b1", n: 1 }]);
  assert.equal(M.dayPlan(plan, [edited], "2026-11-16").items.find((i) => i.entry.id === "p1").nutrition.calories, Math.round(M.recipePer(edited).calories), "a meal not yet eaten follows the recipe");
  const back = M.unmarkEaten(eaten, "p1", "2026-11-16", 11);
  assert.deepEqual(back.find((e) => e.id === "p1").completedDates, []); assert.deepEqual(back.find((e) => e.id === "p1").loggedItems, {}); assert.deepEqual(back.find((e) => e.id === "p1").frozen, {});
  assert.equal(plan[0].completedDates.length, 0, "the list that was given is not changed");
});

test("moving a meal: a single one changes its date; one day of a recurring one becomes its own meal and the series is left alone", () => {
  const r1 = M.moveOccurrence(plan, "p1", "2026-11-16", "2026-11-18", "new1", 20);
  assert.equal(r1.plan.find((e) => e.id === "p1").date, "2026-11-18");
  assert.equal(r1.plan.length, plan.length);
  assert.equal(M.moveOccurrence(plan, "p1", "2026-11-16", "2026-11-16", "x", 1).same, true);
  const r2 = M.moveOccurrence(plan, "p3", "2026-11-16", "2026-11-17", "new2", 21);
  assert.deepEqual(r2.plan.find((e) => e.id === "p3").skipDates, ["2026-11-16"]);
  const copy = r2.plan.find((e) => e.id === "new2");
  assert.equal(copy.type, "single"); assert.equal(copy.date, "2026-11-17"); assert.equal(copy.recipeName, "Fruit"); assert.deepEqual(copy.macros, plan[2].macros);
  const days = M.occurrences(r2.plan, "2026-11-16", "2026-11-22").filter((o) => o.meal === "snacks").map((o) => o.date);
  assert.deepEqual(days, ["2026-11-17", "2026-11-18"], "Monday's showing moved to Tuesday, Wednesday's stays");
  assert.equal(M.moveOccurrence(plan, "zzz", "2026-11-16", "2026-11-17", "n", 1).error, "That meal isn't there any more.");
  assert.equal(M.moveOccurrence(plan, "p1", "2026-11-16", "nope", "n", 1).error, "Pick a day.");
});

test("repeat across days: one entry per date, no duplicates, tied by a group; remove one or all", () => {
  const base = { type: "single", date: "2026-11-16", meal: "lunch", recipeId: "r_bowl", recipeName: "Turkey rice bowl", servings: 1, completedDates: ["2026-11-16"] };
  let n = 0;
  const made = M.repeatEntries(base, ["2026-11-16", "2026-11-17", "2026-11-17", "bad", "2026-11-19"], () => "e" + (++n), "g1", 5);
  assert.deepEqual(made.map((e) => e.date), ["2026-11-16", "2026-11-17", "2026-11-19"]);
  assert.ok(made.every((e) => e.group === "g1" && e.completedDates.length === 0 && e.type === "single"), "copies start un-eaten");
  assert.equal(new Set(made.map((e) => e.id)).size, 3);
  const all = made.concat(plan);
  assert.equal(M.removeEntry(all, "e1", false).length, all.length - 1);
  assert.equal(M.removeEntry(all, "e1", true).length, all.length - 3);
  assert.equal(M.removeEntry(all, "zzz", true).length, all.length);
  const ro = M.removeOccurrence(plan, "p3", "2026-11-16", 9);
  assert.deepEqual(ro.find((e) => e.id === "p3").skipDates, ["2026-11-16"]); assert.equal(ro.length, plan.length);
  assert.equal(M.removeOccurrence(plan, "p1", "2026-11-16", 9).length, plan.length - 1);
});

test("planned against logged: two numbers and the plain difference, no over or under", () => {
  const c = M.compare({ calories: 2000, protein: 150, carbs: 200, fat: 60 }, { calories: 1500, protein: 160, carbs: 120, fat: 55 });
  assert.deepEqual(c.calories, { planned: 2000, logged: 1500, diff: -500 });
  assert.deepEqual(c.protein, { planned: 150, logged: 160, diff: 10 });
  assert.deepEqual(M.compare({ calories: 100 }, null).calories, { planned: 100, logged: 0, diff: -100 });
  assert.equal(M.targetShare(1500, 3000), 50); assert.equal(M.targetShare(1500, 0), null);
});

const day = "2026-11-16";
test("storage: use-by dates from food-safety guidance, and what each state means", () => {
  assert.equal(M.useBy(day, "fridge"), "2026-11-20");
  assert.equal(M.useBy(day, "freezer"), "2027-02-14");
  assert.equal(M.useBy("nope", "fridge"), "");
  assert.match(M.reheatText("fridge"), /165 F/);
  assert.match(M.reheatText("freezer", "Add sauce."), /^Thaw overnight.*Add sauce\..*165 F/);
  assert.match(M.GUIDE.fridge.rule, /3 to 4 days/);
  const b = M.newBatch({ recipeId: "r_bowl", name: "Turkey rice bowl", preparedOn: day, portions: 5, place: "fridge", per: M.recipePer(bowl) }, "b1", 1);
  assert.equal(b.remaining, 5); assert.equal(b.useBy, "2026-11-20"); assert.deepEqual(b.per, { calories: 343, protein: 28.2, carbs: 33.2, fat: 11 });
  assert.equal(M.newBatch({ preparedOn: day, portions: 0 }, "b", 1).portions, 1);
  assert.equal(M.newBatch({ preparedOn: day, portions: 3, place: "attic" }, "b", 1).place, "fridge");
});

test("batch status counts days from today and says so plainly", () => {
  const b = (u, r) => ({ id: "b", remaining: r === undefined ? 3 : r, useBy: u });
  assert.deepEqual([M.batchState(b("2026-11-20"), "2026-11-16").level, M.batchState(b("2026-11-20"), "2026-11-16").text], ["ok", "4 days left"]);
  assert.equal(M.batchState(b("2026-11-18"), "2026-11-16").level, "soon");
  assert.equal(M.batchState(b("2026-11-17"), "2026-11-16").text, "Use by tomorrow");
  assert.equal(M.batchState(b("2026-11-16"), "2026-11-16").level, "today");
  assert.equal(M.batchState(b("2026-11-15"), "2026-11-16").level, "past"); assert.match(M.batchState(b("2026-11-15"), "2026-11-16").text, /Throw it out/);
  assert.equal(M.batchState(b("2026-11-20", 0), "2026-11-16").level, "gone");
  assert.equal(M.batchState(null, "2026-11-16").level, "gone");
});

test("eating portions: remaining follows, never below zero, and it can be given back", () => {
  let list = [M.newBatch({ recipeId: "r_bowl", name: "Bowls", preparedOn: day, portions: 5 }, "b1", 1)];
  let r = M.eatPortions(list, "b1", 2, "2026-11-17", 5);
  assert.equal(r.used, 2); assert.equal(r.batches[0].remaining, 3); assert.deepEqual(r.batches[0].eaten, [{ date: "2026-11-17", n: 2 }]);
  r = M.eatPortions(r.batches, "b1", 9, "2026-11-18", 6);
  assert.equal(r.used, 3, "only what is left"); assert.equal(r.batches[0].remaining, 0);
  assert.equal(M.eatPortions(r.batches, "b1", 1, "2026-11-19", 7).used, 0);
  const back = M.restorePortions(r.batches, "b1", 3, "2026-11-18", 8);
  assert.equal(back[0].remaining, 3); assert.deepEqual(back[0].eaten, [{ date: "2026-11-17", n: 2 }]);
  assert.equal(list[0].remaining, 5, "the list that was given is not changed");
  assert.equal(M.portionsLeft(back, day), 3);
  assert.equal(M.portionsLeft(back.concat([{ id: "x", remaining: 2, deletedAt: 1 }]), day), 3, "deleted batches do not count");
});

test("plan status: eaten, prepped (by hand or from a batch still good that day), to prep, planned", () => {
  const batches = [M.newBatch({ recipeId: "r_bowl", name: "Bowls", preparedOn: day, portions: 5 }, "b1", 1)];
  const occ = (id, date) => M.occurrences(plan, date, date).find((o) => o.planId === id);
  assert.equal(M.status(occ("p1", "2026-11-16"), [], day).code, "to-prep");
  assert.equal(M.status(occ("p1", "2026-11-16"), batches, day).code, "prepped");
  assert.equal(M.status(occ("p1", "2026-11-16"), batches, day).batch.id, "b1");
  assert.equal(M.status({ date: "2026-11-30", entry: plan[0] }, batches, day).code, "to-prep", "after the batch's use-by date it is no longer prepped for that day");
  assert.equal(M.status(occ("p2", "2026-11-16"), batches, day).code, "to-prep", "a batch of another recipe does not count");
  assert.equal(M.status(occ("p3", "2026-11-16"), batches, day).code, "planned");
  const hand = M.setPrepped(plan, "p2", "2026-11-16", true, 3);
  assert.equal(M.status(M.occurrences(hand, "2026-11-16", "2026-11-16").find((o) => o.planId === "p2"), [], day).code, "prepped");
  const eaten = M.markEaten(plan, "p1", "2026-11-16", {}, 3);
  assert.equal(M.status(M.occurrences(eaten, "2026-11-16", "2026-11-16").find((o) => o.planId === "p1"), batches, day).code, "eaten");
  assert.equal(M.status({ date: "2026-11-16", entry: { id: "q", recipeId: "", isRestaurant: true } }, [], day).label, "Eating out");
});

test("eating a planned meal uses the soonest-expiring good batch of that recipe, across batches", () => {
  const a = M.newBatch({ recipeId: "r_bowl", name: "Bowls", preparedOn: "2026-11-15", portions: 1 }, "a", 1);
  const b = M.newBatch({ recipeId: "r_bowl", name: "Bowls", preparedOn: "2026-11-16", portions: 3 }, "b", 1);
  const other = M.newBatch({ recipeId: "r_oats", name: "Oats", preparedOn: "2026-11-16", portions: 3 }, "o", 1);
  const r = M.useFromBatches([b, a, other], "r_bowl", 2, "2026-11-17", 9);
  assert.deepEqual(r.used, [{ batchId: "a", n: 1 }, { batchId: "b", n: 1 }]);
  assert.deepEqual(r.batches.map((x) => x.remaining), [2, 0, 3]);
  assert.deepEqual(M.useFromBatches([a], "r_bowl", 1, "2026-12-30", 9).used, [], "a batch past its use-by date is not used");
});

test("moving a batch between fridge and freezer starts the right clock", () => {
  const b = M.newBatch({ recipeId: "r", name: "x", preparedOn: day, portions: 4 }, "b", 1);
  const f = M.moveBatch([b], "b", "freezer", "2026-11-17", 2)[0];
  assert.equal(f.place, "freezer"); assert.equal(f.useBy, "2027-02-15"); assert.equal(f.movedOn, "2026-11-17");
  const t = M.moveBatch([f], "b", "fridge", "2026-12-01", 3)[0];
  assert.equal(t.useBy, "2026-12-04", "thawed in the fridge: 3 days");
  assert.equal(M.moveBatch([b], "b", "fridge", day, 2)[0], b, "no change when it is already there");
});

test("ideas: from what you have, from the library, and from a leftover batch", () => {
  const pantry = { turkey: { name: "Turkey", quantity: 500 }, "cooked rice": { name: "Cooked rice", quantity: 2 }, broccoli: { name: "Broccoli", quantity: 0 }, oats: { name: "Oats", quantity: 1 } };
  const m = M.pantryMatches([bowl, oats, { id: "z", name: "Z", ingredients: [ing("quail", "1", 1, 1, 1, 1)] }], pantry);
  assert.deepEqual(m.map((x) => [x.recipe.id, x.have, x.total]), [["r_oats", 1, 1], ["r_bowl", 2, 3]]);
  assert.deepEqual(m[1].missing, ["Broccoli"], "something with none left counts as missing");
  assert.deepEqual(M.pantryMatches([bowl], {}), []);
  const li = M.leftoverIdeas({ recipeId: "r_bowl", name: "Turkey rice bowl" }, [bowl, oats, { id: "r3", name: "Rice pudding", ingredients: [ing("Cooked rice", "1 cup", 1, 1, 1, 1)] }]);
  assert.ok(li.ideas.length > 0 && li.ideas.length <= 4);
  assert.deepEqual(li.recipes.map((r) => r.id), ["r3"], "another recipe that uses an ingredient of the batch");
});

test("empty meals can be filled from the library: the right kind of meal, not repeated, favourites and training days considered", () => {
  const recipes = [bowl, oats, Object.assign({}, oats, { id: "r_fav", name: "Yogurt bowl", favorite: true })];
  const s = M.fillSuggestions({ dates: ["2026-11-16", "2026-11-17"], plan: [], recipes, training: { "2026-11-17": true } });
  const lunch = s.filter((x) => x.meal === "lunch"), brk = s.filter((x) => x.meal === "breakfast");
  assert.deepEqual(lunch.map((x) => x.recipe.id), ["r_bowl", "r_bowl"]);
  assert.equal(lunch[1].why, "Protein and carbs for a training day");
  assert.equal(brk[0].recipe.id, "r_fav", "the favourite first");
  assert.notEqual(brk[1].recipe.id, brk[0].recipe.id, "not the same breakfast two days running");
  assert.equal(s.some((x) => x.meal === "snacks"), false, "no recipe is a snack");
  const filled = M.fillSuggestions({ dates: ["2026-11-16"], plan, recipes, training: {} });
  assert.equal(filled.some((x) => x.meal === "lunch" || x.meal === "breakfast"), false, "a slot already planned is left alone");
});

test("prep sessions: free time that is long enough, weekends and the day before a busy day first", () => {
  const rows = [{ date: "2026-11-17", start: 540, end: 600 }, { date: "2026-11-21", start: 600, end: 840 }, { date: "2026-11-18", start: 420, end: 780 }, { date: "2026-11-19", start: 1140, end: 1320 }];
  const s = M.prepSlots(rows, 120, { today: "2026-11-16", load: { "2026-11-19": 2 } });
  assert.deepEqual(s.map((x) => x.date), ["2026-11-21", "2026-11-18"], "Saturday first; Tuesday is too short; Thursday evening is late");
  assert.deepEqual([s[0].start, s[0].end], [600, 720]);
  assert.equal(M.sessionMinutes([bowl, oats]), 65);
  assert.equal(M.sessionMinutes([oats]), 0, "no times known: no guess");
});

test("training days come from your routine schedule (Monday first), archived routines are ignored", () => {
  const routines = [{ name: "Push", scheduledDays: [0, 3] }, { name: "Old", scheduledDays: [1], archivedAt: 5 }, { name: "Legs", scheduledDays: [4] }];
  assert.deepEqual(M.trainingDays(routines, M.weekDates("2026-11-16")), { "2026-11-16": "Push", "2026-11-19": "Push", "2026-11-20": "Legs" });
  assert.deepEqual(M.trainingDays(null, ["2026-11-16"]), {});
});

test("dates: weeks start on Monday", () => {
  assert.equal(M.mondayOf("2026-11-22"), "2026-11-16"); assert.equal(M.mondayOf("2026-11-16"), "2026-11-16");
  assert.deepEqual(M.weekDates("2026-11-16").slice(-1), ["2026-11-22"]);
  assert.equal(M.isDate("2026-02-30"), false);
});
