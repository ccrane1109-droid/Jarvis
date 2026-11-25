"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../js/food-amount-logic");
const P = require("../../js/nutrition-label-parse");

function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), a + " is not " + b);

// Granola: the label says "2/3 cup (55g)" and 190 calories for that serving.
const granola = () => ({ id: "f1", name: "Granola", serving: "2/3 cup (55g)", calories: 190, protein: 4, carbs: 36, fat: 3, fiber: 3, label: { serving: "2/3 cup (55g)", values: { calories: 190, protein: 4, carbs: 36, fat: 3, fiber: 3, sodium: 95 } } });
// A drink labelled in millilitres, and a cookie labelled only as "1 cookie".
const juice = () => ({ id: "f2", name: "Juice", serving: "1 cup (240mL)", calories: 110, protein: 1, carbs: 26, fat: 0, label: { serving: "1 cup (240mL)", values: { calories: 110, protein: 1, carbs: 26, fat: 0 } } });
const cookie = () => ({ id: "f3", name: "Cookie", serving: "1 cookie", calories: 80, protein: 1, carbs: 11, fat: 4, label: { serving: "1 cookie", values: { calories: 80, protein: 1, carbs: 11, fat: 4 } } });

test("what is typed into the amount box: numbers, fractions, units; a bare number needs the unit beside it", () => {
  assert.deepEqual(A.parseEntry("200g"), { value: 200, unit: "g" });
  assert.deepEqual(A.parseEntry("200 g"), { value: 200, unit: "g" });
  assert.deepEqual(A.parseEntry("200 grams"), { value: 200, unit: "g" });
  assert.deepEqual(A.parseEntry("1.5 kg"), { value: 1.5, unit: "kg" });
  assert.deepEqual(A.parseEntry("6 oz"), { value: 6, unit: "oz" });
  assert.deepEqual(A.parseEntry("8 fl oz"), { value: 8, unit: "floz" });
  assert.deepEqual(A.parseEntry("8 floz"), { value: 8, unit: "floz" });
  assert.deepEqual(A.parseEntry("250ml"), { value: 250, unit: "ml" });
  assert.deepEqual(A.parseEntry("0.25 l"), { value: 0.25, unit: "l" });
  assert.deepEqual(A.parseEntry("2 servings"), { value: 2, unit: "serving" });
  assert.deepEqual(A.parseEntry("1 serving"), { value: 1, unit: "serving" });
  assert.deepEqual(A.parseEntry("1,5 oz"), { value: 1.5, unit: "oz" }, "a decimal comma");
  assert.deepEqual(A.parseEntry("1/2", "serving"), { value: 0.5, unit: "serving" });
  assert.deepEqual(A.parseEntry("1 1/2", "serving"), { value: 1.5, unit: "serving" });
  assert.deepEqual(A.parseEntry("½", "serving"), { value: 0.5, unit: "serving" });
  assert.deepEqual(A.parseEntry("1½ cup", "serving"), null, "a cup is never guessed at");
  assert.deepEqual(A.parseEntry("150", "g"), { value: 150, unit: "g" }, "a bare number takes the chosen unit");
  assert.deepEqual(A.parseEntry("150"), { error: "unit" }, "and with no unit chosen it says so");
  assert.equal(A.parseEntry("1 cup", "g"), null, "a word that is not a weight or volume is refused, not read as grams");
  assert.equal(A.parseEntry(""), null);
  assert.equal(A.parseEntry("abc"), null);
  assert.equal(A.parseEntry("0", "g"), null, "nothing is not an amount");
  assert.equal(A.parseEntry("-5", "g"), null);
  assert.equal(A.parseEntry("999999 g"), null, "absurdly large");
  assert.equal(A.parseEntry(null), null);
  assert.equal(A.describeEntry({ value: 55, unit: "g" }), "55 g");
  assert.equal(A.describeEntry({ value: 1, unit: "serving" }), "1 serving");
  assert.equal(A.describeEntry({ value: 1.5, unit: "serving" }), "1.5 servings");
  assert.equal(A.describeEntry({ value: 8, unit: "floz" }), "8 fl oz");
  assert.equal(A.describeEntry({ value: 250, unit: "ml" }), "250 mL");
  assert.equal(A.describeEntry({ value: 2.333333, unit: "serving" }), "2.33 servings");
});

test("the baseline of a food is its label's serving: a weight or volume, or nothing at all", () => {
  assert.deepEqual(A.baseOf(granola()), { value: 55, unit: "g", text: "2/3 cup (55g)", perContainer: null });
  assert.deepEqual(A.baseOf(juice()), { value: 240, unit: "ml", text: "1 cup (240mL)", perContainer: null });
  assert.equal(A.baseOf(cookie()), null, "“1 cookie” has no weight, so it has no baseline to convert with");
  const noWeight = granola(); noWeight.label.serving = "2/3 cup";
  assert.equal(A.baseOf(noWeight), null, "a household measure is never turned into grams");
  // a size confirmed on the review screen wins over the text, and can rescue a label with no weight
  noWeight.label.size = { value: 55, unit: "g" };
  assert.deepEqual(A.baseOf(noWeight), { value: 55, unit: "g", text: "2/3 cup", perContainer: null });
  const per = granola(); per.label.perContainer = 8;
  assert.equal(A.baseOf(per).perContainer, 8);
  // foods saved before there was a label: their own serving, when it is a weight
  assert.deepEqual(A.baseOf({ serving: "125g", calories: 100 }), { value: 125, unit: "g", text: "125g", perContainer: null });
  assert.equal(A.baseOf({ serving: "1.6x 125g", calories: 160 }), null, "a multiple's numbers are not for the 125 g");
  assert.equal(A.baseOf({ serving: "1 scoop", calories: 100 }), null);
  assert.equal(A.baseOf(null), null);
  assert.equal(A.baseOf({ label: { serving: "x", size: { value: -3, unit: "g" }, values: {} }, serving: "x" }), null, "a size below zero is ignored");
  assert.deepEqual(A.valuesOf(granola()), { calories: 190, protein: 4, carbs: 36, fat: 3, fiber: 3, sodium: 95 });
  assert.deepEqual(A.valuesOf({ calories: 100, protein: 5, label: null }), { calories: 100, protein: 5 }, "without a label, the food's own numbers");
});

test("amount to servings and back: grams, ounces, servings; grams and millilitres are never mixed", () => {
  const g = A.baseOf(granola()), ml = A.baseOf(juice());
  let f = A.factorFor(g, { value: 110, unit: "g" });
  assert.equal(f.ok, true); close(f.factor, 2); assert.deepEqual([f.amount, f.unit], [110, "g"]);
  close(A.factorFor(g, { value: 27.5, unit: "g" }).factor, 0.5);
  close(A.factorFor(g, { value: 2, unit: "oz" }).factor, 2 * A.G_PER_OZ / 55, 1e-9);
  close(A.factorFor(g, { value: 0.11, unit: "kg" }).factor, 2, 1e-9);
  close(A.factorFor(g, { value: 1.5, unit: "serving" }).factor, 1.5);
  assert.equal(A.factorFor(g, { value: 1.5, unit: "serving" }).amount, null);
  close(A.factorFor(ml, { value: 480, unit: "ml" }).factor, 2);
  close(A.factorFor(ml, { value: 8, unit: "floz" }).factor, 8 * A.ML_PER_FLOZ / 240, 1e-9);
  close(A.factorFor(ml, { value: 0.24, unit: "l" }).factor, 1, 1e-9);
  // never interchangeable
  let r = A.factorFor(g, { value: 100, unit: "ml" });
  assert.deepEqual([r.ok, r.reason, r.label, r.entered], [false, "units", "g", "volume"], "a food labelled in grams can't be entered in mL");
  r = A.factorFor(g, { value: 3, unit: "floz" }); assert.equal(r.reason, "units");
  r = A.factorFor(ml, { value: 100, unit: "g" }); assert.deepEqual([r.ok, r.reason], [false, "units"]);
  r = A.factorFor(ml, { value: 4, unit: "oz" }); assert.equal(r.reason, "units", "ounces of weight are not fluid ounces");
  // no baseline: servings only
  assert.equal(A.factorFor(null, { value: 100, unit: "g" }).reason, "no-base");
  assert.equal(A.factorFor(null, { value: 2, unit: "serving" }).ok, true);
  // mistakes
  assert.equal(A.factorFor(g, { value: 0, unit: "g" }).reason, "amount");
  assert.equal(A.factorFor(g, { value: NaN, unit: "g" }).reason, "amount");
  assert.equal(A.factorFor(g, null).reason, "amount");
  assert.equal(A.factorFor(g, { value: 5, unit: "cup" }).reason, "unit");
  assert.equal(A.factorFor(g, { value: 100000, unit: "g" }).reason, "range", "1,800 servings is a typing mistake");
  assert.equal(A.factorFor(g, { value: 0.01, unit: "g" }).reason, "range");
  assert.equal(A.factorFor(g, { value: 5000, unit: "g" }).unusual, true, "91 servings is allowed but flagged");
  assert.equal(A.factorFor(g, { value: 100, unit: "g" }).unusual, false);
  assert.deepEqual(A.unitsFor(g), ["g", "oz", "serving"]);
  assert.deepEqual(A.unitsFor(ml), ["ml", "floz", "serving"]);
  assert.deepEqual(A.unitsFor(null), ["serving"]);
});

test("equivalents and switching units carry the amount over without drifting", () => {
  const g = A.baseOf(granola());
  const eq = A.equivalents(g, 2);
  assert.deepEqual(eq.map((e) => e.unit), ["serving", "g", "oz"]);
  assert.deepEqual([eq[0].value, eq[1].value], [2, 110]);
  close(eq[2].value, 110 / A.G_PER_OZ, 1e-5);
  assert.deepEqual(A.equivalents(A.baseOf(juice()), 1).map((e) => e.unit), ["serving", "ml", "floz"]);
  assert.deepEqual(A.equivalents(null, 3), [{ unit: "serving", value: 3 }], "no baseline: servings only, nothing invented");
  assert.deepEqual(A.equivalents(g, 0), []);
  assert.deepEqual(A.convertEntry(g, { value: 110, unit: "g" }, "serving"), { value: 2, unit: "serving" });
  assert.deepEqual(A.convertEntry(g, { value: 2, unit: "serving" }, "g"), { value: 110, unit: "g" });
  assert.equal(A.convertEntry(g, { value: 2, unit: "serving" }, "ml"), null, "servings of a gram food in millilitres: never");
  assert.equal(A.convertEntry(null, { value: 2, unit: "serving" }, "g"), null);
  // g -> oz -> g -> serving -> g, a hundred times: the amount does not move
  let e = { value: 137, unit: "g" };
  for (let i = 0; i < 100; i++) { e = A.convertEntry(g, e, "oz"); e = A.convertEntry(g, e, "g"); e = A.convertEntry(g, e, "serving"); e = A.convertEntry(g, e, "g"); }
  close(e.value, 137, 1e-4);
});

test("the numbers are worked out from the label every time, rounded once, so nothing accumulates", () => {
  const f = granola(), v = A.valuesOf(f);
  assert.deepEqual(A.scaleRounded(v, 1), { calories: 190, protein: 4, carbs: 36, fat: 3, fiber: 3, sodium: 95 }, "one serving is exactly the label");
  assert.deepEqual(A.scaleRounded(v, 150 / 55), { calories: 518, protein: 10.9, carbs: 98.2, fat: 8.2, fiber: 8.2, sodium: 259 });
  assert.deepEqual(A.scaleRounded(v, 0.5), { calories: 95, protein: 2, carbs: 18, fat: 1.5, fiber: 1.5, sodium: 48 });
  close(A.scaleExact({ calories: 190 }, 2 / 3).calories, 380 / 3, 1e-12);          // exact scaling keeps every digit
  // the label never changes, however many amounts are worked out from it
  const frozen = deepFreeze(granola());
  for (let g = 1; g <= 400; g += 7) A.scaleRounded(A.valuesOf(frozen), g / 55);
  assert.deepEqual(frozen, granola());
  // working out 1 g, 2 g, ... and adding the rounded numbers is NOT how a day's total is built from one food: scaling the label to the
  // total amount is exact, the sum of rounded pieces is not
  const piece = A.scaleRounded(v, 1 / 55).calories;      // 190 / 55 = 3.45 -> 3
  assert.equal(piece * 55, 165, "55 rounded pieces lose 25 calories");
  assert.equal(A.scaleRounded(v, 55 / 55).calories, 190, "while one amount of 55 g is exact");
});

test("portions: your default, else the last amount, else one serving; custom portions are checked", () => {
  const f = granola();
  assert.deepEqual(A.suggestEntry(f), { value: 1, unit: "serving", from: "serving" });
  f.lastPortion = { unit: "g", value: 150 };
  assert.deepEqual(A.suggestEntry(f), { value: 150, unit: "g", from: "last" });
  let id = 0; const mk = () => "p" + (++id);
  let r = A.addPortion(f, { name: "  My   bowl ", value: 220, unit: "g" }, mk);
  assert.equal(r.ok, true); assert.deepEqual(r.portions, [{ id: "p1", name: "My bowl", unit: "g", value: 220 }]);
  f.portions = r.portions;
  assert.deepEqual(A.suggestEntry(f), { value: 150, unit: "g", from: "last" }, "a portion is not the default until you make it one");
  f.defaultPortionId = "p1";
  assert.deepEqual(A.suggestEntry(f), { value: 220, unit: "g", from: "default", name: "My bowl" });
  // the same name replaces, with the same id
  r = A.addPortion(f, { name: "my BOWL", value: 240, unit: "g" }, mk);
  assert.deepEqual([r.ok, r.id, r.replaced, r.portions.length, r.portions[0].value, r.portions[0].name], [true, "p1", true, 1, 240, "My bowl"]);
  // checks
  assert.match(A.addPortion(f, { name: "", value: 100, unit: "g" }, mk).error, /name/i);
  assert.match(A.addPortion(f, { name: "x", value: 0, unit: "g" }, mk).error, /above 0/);
  assert.match(A.addPortion(f, { name: "x", value: 100, unit: "ml" }, mk).error, /grams.*g, oz or servings/, "a gram food can't have a mL portion");
  assert.match(A.addPortion(juice(), { name: "x", value: 100, unit: "g" }, mk).error, /millilitres.*mL, fl oz or servings/);
  assert.match(A.addPortion(cookie(), { name: "x", value: 100, unit: "g" }, mk).error, /servings only/, "a food with no weight can only have servings portions");
  assert.equal(A.addPortion(cookie(), { name: "two", value: 2, unit: "serving" }, mk).ok, true);
  // a remembered amount in a unit the food no longer allows is skipped
  const changed = juice(); changed.lastPortion = { unit: "g", value: 100 };
  assert.deepEqual(A.suggestEntry(changed), { value: 1, unit: "serving", from: "serving" });
  changed.portions = [{ id: "z", name: "Glass", unit: "g", value: 100 }]; changed.defaultPortionId = "z";
  assert.equal(A.suggestEntry(changed).from, "serving", "and so is a default in the wrong kind of unit");
  // the limit, and removing
  const many = granola();
  many.portions = Array.from({ length: A.MAX_PORTIONS }, (_, i) => ({ id: "q" + i, name: "P" + i, unit: "g", value: 10 + i }));
  assert.match(A.addPortion(many, { name: "one more", value: 5, unit: "g" }, mk).error, /up to 12/);
  many.defaultPortionId = "q3";
  const rm = A.removePortion(many, "q3");
  assert.deepEqual([rm.portions.length, rm.defaultPortionId], [11, ""], "removing the default clears it");
  assert.equal(A.removePortion(many, "q4").defaultPortionId, "q3");
  // stored data is cleaned: bad entries dropped
  assert.deepEqual(A.cleanPortions([{ id: "a", name: "Ok", unit: "g", value: 5 }, { id: "a", name: "Dup", unit: "g", value: 5 }, { id: "b", name: "", unit: "g", value: 5 }, { id: "c", name: "Bad", unit: "cup", value: 5 }, null, "x", { name: "No id", unit: "g", value: 1 }]), [{ id: "a", name: "Ok", unit: "g", value: 5 }]);
  assert.deepEqual(A.cleanPortions("nope"), []);
  assert.deepEqual(A.cleanEntry({ unit: "g", value: 12.5 }), { unit: "g", value: 12.5 });
  assert.equal(A.cleanEntry({ unit: "g", value: -1 }), null);
});

test("using a food remembers the amount and counts the use", () => {
  const f = granola();
  assert.deepEqual(A.afterUse(f, { value: 150, unit: "g" }, 1000), { lastUsedAt: 1000, useCount: 1, lastPortion: { value: 150, unit: "g" } });
  f.useCount = 4;
  assert.equal(A.afterUse(f, { value: 2, unit: "serving" }, 5).useCount, 5);
  assert.equal(A.afterUse(f, { unit: "bogus", value: 2 }, 5).lastPortion, undefined, "an amount that can't be stored is not remembered");
  const frozen = deepFreeze(granola());
  A.afterUse(frozen, { value: 1, unit: "serving" }, 1); A.addPortion(frozen, { name: "a", value: 1, unit: "g" }, () => "x");
});

test("reviewing a scan: unread and doubtful numbers are flagged, never filled in", () => {
  const st = A.reviewState({ fields: { calories: 190, fat: 3, carbs: 36 }, uncertain: ["carbs"] });
  assert.deepEqual(st.calories, { state: "ok", reason: "" });
  assert.equal(st.carbs.state, "unsure");
  assert.equal(st.protein.state, "missing"); assert.match(st.protein.reason, /Not read/);
  assert.equal(st.fiber.state, "missing", "fiber is reported when it is absent");
  assert.equal(st.sodium, undefined, "an optional number that isn't there is just absent");
  assert.equal(A.reviewState(null).calories.state, "missing");
  assert.deepEqual(A.readyToContinue({ name: "Granola", calories: "190", protein: "4", carbs: "36", fat: "0" }), { ok: true, problems: [] }, "0 is an answer");
  assert.deepEqual(A.readyToContinue({ name: " ", calories: "190", protein: "", carbs: "36", fat: "3" }).problems, ["Name", "Protein"]);
  assert.deepEqual(A.readyToContinue({}).problems, ["Name", "Calories", "Protein", "Carbs", "Fat"]);
  assert.deepEqual(A.readyToContinue({ name: "x", calories: "-1", protein: "a", carbs: 1, fat: 1 }).problems, ["Calories", "Protein"]);
});

test("a recipe from foods: every ingredient is worked out from its label, the whole is exact, then divided", () => {
  const ing = (food, amount, name) => ({ name: name || food.name, quantity: A.describeEntry(amount), calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, label: food.label, amount: amount, foodId: food.id });
  const rice = { id: "r", name: "Rice", label: { serving: "1/4 cup (45g)", values: { calories: 160, protein: 3, carbs: 36, fat: 0, fiber: 1 } } };
  const chicken = { id: "c", name: "Chicken", label: { serving: "4 oz (112g)", values: { calories: 130, protein: 26, carbs: 0, fat: 2.5 } } };
  const list = [ing(rice, { value: 300, unit: "g" }), ing(chicken, { value: 500, unit: "g" }), { name: "Olive oil", quantity: "1 tbsp", calories: 120, protein: 0, carbs: 0, fat: 14 }];
  const x = A.ingredientExact(list[0]);
  close(x.calories, 160 * 300 / 45, 1e-9); close(x.carbs, 36 * 300 / 45, 1e-9);
  const t = A.recipeExact(list);
  close(t.totals.calories, 160 * 300 / 45 + 130 * 500 / 112 + 120, 1e-9);
  close(t.totals.protein, 3 * 300 / 45 + 26 * 500 / 112, 1e-9);
  close(t.totals.fat, 2.5 * 500 / 112 + 14, 1e-9);
  assert.deepEqual([t.counted, t.uncounted], [3, []]);
  const per = A.perPortion(t.totals, 4);
  close(per.calories, t.totals.calories / 4, 1e-9);
  assert.deepEqual(A.roundMacros(per), { calories: Math.round(t.totals.calories / 4), protein: Math.round(per.protein * 10) / 10, carbs: Math.round(per.carbs * 10) / 10, fat: Math.round(per.fat * 10) / 10, fiber: Math.round(per.fiber * 10) / 10 });
  // changing the amount works from the label, not from the rounded numbers
  const bigger = Object.assign({}, list[0], { amount: { value: 600, unit: "g" } });
  close(A.ingredientExact(bigger).calories, 2 * A.ingredientExact(list[0]).calories, 1e-9);
  // the portions can't be zero or fractional
  assert.deepEqual(A.perPortion({ calories: 100 }, 0), { calories: 100, protein: 0, carbs: 0, fat: 0, fiber: 0 }, "a zero count is one portion, not a division by zero");
  assert.equal(A.perPortion({ calories: 100 }, 3.4).calories, 100 / 3);
  // an ingredient with no numbers is named, not counted as zero silently
  const gap = A.recipeExact([{ name: "Salt", quantity: "a pinch" }, list[2]]);
  assert.deepEqual([gap.counted, gap.uncounted], [1, ["Salt"]]);
  // a bad amount on a linked ingredient falls back to the numbers stored on it
  const bad = Object.assign({}, list[0], { amount: { value: 100, unit: "ml" }, calories: 55 });
  assert.equal(A.ingredientExact(bad).calories, 55, "grams label with a mL amount: the stored number, not a guess");
  // twenty small ingredients lose nothing to rounding
  const tiny = Array.from({ length: 20 }, () => ing({ id: "t", name: "Spice", label: { serving: "1 g", values: { calories: 3.4 } } }, { value: 1, unit: "g" }));
  close(A.recipeExact(tiny).totals.calories, 68, 1e-9);
  const rounded = tiny.reduce((s, i) => s + A.scaleRounded(A.ingredientExact(i), 1).calories, 0);
  assert.equal(rounded, 60, "rounding each piece first would have lost 8 calories");
});

test("ingredient quantities for the whole recipe and for one portion; finished weight; logging by the finished weight", () => {
  const list = [
    { name: "Chicken", quantity: "500 g", amount: { value: 500, unit: "g" } },
    { name: "Milk", quantity: "1 L" },
    { name: "Flour", quantity: "8 oz" },
    { name: "Eggs", quantity: "2" },
    { name: "Salt", quantity: "1 pinch" },
    { name: "Stock", quantity: "", amount: { value: 3, unit: "serving" } }
  ];
  assert.deepEqual(A.ingredientQuantities(list, 4), [
    { name: "Chicken", whole: "500 g", each: "125 g" },
    { name: "Milk", whole: "1 L", each: "0.25 L" },
    { name: "Flour", whole: "8 oz", each: "2 oz" },
    { name: "Eggs", whole: "2", each: "" },
    { name: "Salt", whole: "1 pinch", each: "" },
    { name: "Stock", whole: "3 servings", each: "0.75 servings" }
  ]);
  assert.equal(A.ingredientQuantities([{ name: "x", quantity: "300 g" }], 0)[0].each, "300 g", "zero portions is one");
  assert.equal(A.portionWeight(1200, 4), 300);
  assert.equal(A.portionWeight(1000, 3), 333.3);
  assert.equal(A.portionWeight(0, 4), null); assert.equal(A.portionWeight("x", 4), null); assert.equal(A.portionWeight(100, 0), null);
  close(A.recipeFactor(300, { value: 450, unit: "g" }).factor, 1.5);
  close(A.recipeFactor(300, { value: 3, unit: "oz" }).factor, 3 * A.G_PER_OZ / 300, 1e-9);
  assert.equal(A.recipeFactor(300, { value: 450, unit: "ml" }).reason, "units", "a finished weight is grams, never millilitres");
  assert.equal(A.recipeFactor(null, { value: 450, unit: "g" }).reason, "no-base");
  assert.equal(A.recipeFactor(300, { value: 2, unit: "serving" }).factor, 2);
});

test("compute: one call gives the factor, the numbers (exact and rounded once) and the words for the log", () => {
  const g = A.compute(granola(), { value: 82.5, unit: "g" });
  assert.equal(g.ok, true);
  close(g.factor, 1.5);
  assert.equal(g.serving, "82.5 g");
  assert.equal(g.values.calories, 285);
  assert.equal(g.values.protein, 6);
  assert.equal(g.values.sodium, 143, "142.5 rounds up once");
  close(g.exact.calories, 285, 1e-9);
  const oz = A.compute(granola(), { value: 3, unit: "oz" });
  assert.equal(oz.serving, "3 oz (85 g)", "an ounce amount also says the grams it is");
  assert.equal(A.compute(granola(), { value: 1, unit: "serving" }).serving, "2/3 cup (55g)", "exactly one serving is the label's own serving");
  assert.equal(A.compute(granola(), { value: 1.5, unit: "serving" }).serving, "1.5x 2/3 cup (55g)");
  const ml = A.compute(juice(), { value: 8, unit: "floz" });
  assert.equal(ml.serving, "8 fl oz (237 mL)");
  assert.equal(ml.values.calories, 108, "110 x 236.588 / 240 = 108.4");
  const wrong = A.compute(juice(), { value: 200, unit: "g" });
  assert.equal(wrong.ok, false); assert.equal(wrong.reason, "units");
  assert.match(wrong.message, /never converted/);
  const none = A.compute(cookie(), { value: 20, unit: "g" });
  assert.equal(none.ok, false); assert.equal(none.reason, "no-base"); assert.match(none.message, /servings/);
  assert.equal(A.compute(cookie(), { value: 2, unit: "serving" }).values.calories, 160);
  assert.equal(A.compute(granola(), { value: 0, unit: "g" }).reason, "amount");
  assert.equal(A.compute(granola(), { value: 1e9, unit: "g" }).reason, "range");
  assert.equal(A.compute(granola(), { value: 3, unit: "serving" }).unusual, false);
  assert.equal(A.compute(granola(), { value: 100, unit: "serving" }).unusual, true, "a lot of servings is flagged, not refused");
});

test("the stored label: only a serving with usable numbers, size and servings per container only when valid", () => {
  assert.equal(A.cleanLabel(null), null);
  assert.equal(A.cleanLabel({ serving: "1 cup", values: {} }), null, "no numbers: no label");
  assert.equal(A.cleanLabel({ serving: 3, values: { calories: 1 } }), null);
  assert.deepEqual(A.cleanLabel({ serving: "1 cup (240 mL)", size: { value: 240, unit: "ml" }, perContainer: 4, values: { calories: 100, protein: -1, fat: "x", sodium: 80, nonsense: 5 } }),
    { serving: "1 cup (240 mL)", values: { calories: 100, sodium: 80 }, size: { value: 240, unit: "ml" }, perContainer: 4 });
  assert.deepEqual(A.cleanLabel({ serving: "x", size: { value: 0, unit: "g" }, perContainer: 9999, values: { calories: 1 } }), { serving: "x", values: { calories: 1 } });
  assert.deepEqual(A.cleanLabel({ serving: "x", size: { value: 5, unit: "cup" }, values: { calories: 1 } }), { serving: "x", values: { calories: 1 } }, "a size is grams or millilitres");
});

test("an ingredient made from a food in servings is told as the weight those servings are", () => {
  const cereal = { name: "Cereal", quantity: "100 g (2.5 servings)", amount: { value: 2.5, unit: "serving" }, label: { serving: "1 cup (40g)", values: { calories: 110 } } };
  assert.deepEqual(A.ingredientQuantities([cereal], 4), [{ name: "Cereal", whole: "100 g", each: "25 g" }]);
  const bars = { name: "Bars", quantity: "3", amount: { value: 3, unit: "serving" }, label: { serving: "1 bar", values: { calories: 200 } } };
  assert.deepEqual(A.ingredientQuantities([bars], 3), [{ name: "Bars", whole: "3 servings", each: "1 serving" }], "no weight on the label: stays in servings");
  const drink = { name: "Drink", amount: { value: 2, unit: "serving" }, label: { serving: "1 cup (240 mL)", values: { calories: 100 } } };
  assert.deepEqual(A.ingredientQuantities([drink], 2), [{ name: "Drink", whole: "480 mL", each: "240 mL" }]);
});
