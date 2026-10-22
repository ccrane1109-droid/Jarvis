"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/nutrition-label-parse");

const parse = (t) => P.parseNutritionLabelText(t);

// Text exactly as the OCR engine returned it for synthetic Nutrition Facts panels.
const YOGURT = `Nutrition Facts
1 serving per container
Serving size 1 container (250g)
Amount per serving
Calories 140
% Daily Value*
Total Fat 0g 0%
Saturated Fat 0g 0%
Trans Fat Og
Cholesterol 10mg 3%
Sodium 65mg 3%
Total Carbohydrate 9g 3%
Dietary Fiber 0g 0%
Total Sugars 7g
Includes Og Added Sugars 0%
Protein 22g
Vitamin D Omcg 0%
Calcium 200mg 15%
lron Omg 0%
Potassium 260mg 6%
of food contributes to a daily diet. 2,000 calories a day is used for
general nutrition advice.`;

const BAR = `Nutrition Facts
12 servings per container
Serving size 1 bar (45g)
Amount per serving
Calories 2 10
% Daily Value*
Total Fat 8g 10%
Saturated Fat 3.5g 18%
Sodium 150mg 7%
Total Carbohydrate 28g 10%
Dietary Fiber 3g 11%
Protein 10g
Vitamin D Omcg 0%
Calcium 100mg 8%
lron 2mg 10%
Potassium 190mg 4%`;

const TWO_COLUMN = `Nutrition Facts
Serving size 1 pot (150g)

Per 100g Per serving
Calories 40 100
Total Fat 1.0g 2.59
Sodium 32mg 80mg
Total Carbohydrate 4.89 12g
Protein 3.6g 9g`;

test("a clean panel gives every value; a lone O before a unit is a zero and isn't treated as doubtful", () => {
  const r = parse(YOGURT);
  assert.deepEqual(r.fields, { calories: 140, fat: 0, sodium: 65, carbs: 9, fiber: 0, protein: 22, vitaminD: 0, calcium: 200, iron: 0, potassium: 260 });
  assert.deepEqual(r.uncertain, [], "Omcg and Omg are how a printed 0 comes out");
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.missing, []);
  assert.equal(r.servingSize, "1 container (250g)");
  assert.equal(r.matchedCount, 10);
});

test("a printed zero read as the letter O is still a zero, for every unit", () => {
  const r = parse("Total Fat Og 0%\nSodium Omg 0%\nVitamin D Omcg\nIron Omg\nDietary Fiber Og");
  assert.deepEqual(r.fields, { fat: 0, sodium: 0, vitaminD: 0, iron: 0, fiber: 0 });
});

test("the unit g read as 9 or q, mg read as rng, does not lose the value", () => {
  const r = parse("Calories 150\nTotal Fat 2.59 3%\nTotal Carbohydrate 4.89\nProtein 17q\nDietary Fiber 39\nSodium 65rng 3%\nCalcium 200mg");
  assert.equal(r.fields.fat, 2.5);
  assert.equal(r.fields.carbs, 4.8);
  assert.equal(r.fields.protein, 17);
  assert.equal(r.fields.fiber, 3);
  assert.equal(r.fields.sodium, 65);
  assert.deepEqual(r.uncertain.sort(), ["carbs", "fat", "fiber", "protein", "sodium"].sort());
  assert.ok(!r.uncertain.includes("calcium"), "a value read cleanly is not flagged");
});

test("a letter inside a number (\"1O\", \"2l0\") is read as a digit but flagged", () => {
  const r = parse("Total Carbohydrate 1Og\nSodium 2l0mg\nProtein 1l g");
  assert.deepEqual(r.fields, { carbs: 10, sodium: 210, protein: 11 });
  assert.deepEqual(r.uncertain.sort(), ["carbs", "protein", "sodium"]);
});

test("the 9 from a percent column is not mistaken for a unit: \"24g 9%\" read as \"249 9%\" is 24", () => {
  // g read as 9 left "249 9%". The 9 of the percent must not be taken as the unit, which made this 249.
  const r = parse("Total Carbohydrate 249 9%\nDietary Fiber 59 18%\nTotal Fat 1.59 2%\nProtein 39");
  assert.equal(r.fields.carbs, 24);
  assert.equal(r.fields.fiber, 5);
  assert.equal(r.fields.fat, 1.5);
  assert.equal(r.fields.protein, 3);
  assert.equal(parse("Total Carbohydrate 24 g 9%").fields.carbs, 24, "a space before a real g is fine");
  assert.equal(parse("Total Carbohydrate 24g 9%").fields.carbs, 24);
  assert.equal(parse("Sodium 65m9 3%").fields.sodium, 65, "mg read as m9");
});

test("a number with too many digits to be real is rejected, never read as its last few digits", () => {
  // Reading "90000mg" as "0000mg" would have written a false zero.
  const r = parse("Sodium 90000mg\nTotal Fat 12345g\nProtein 1000000g\nCalcium 20000mg");
  assert.deepEqual(r.fields, {});
});

test("a unit that is read cleanly is never second-guessed: 99g stays 99, 9g stays 9", () => {
  assert.equal(parse("Total Carbohydrate 99g").fields.carbs, 99);
  assert.equal(parse("Total Carbohydrate 9g").fields.carbs, 9);
  assert.equal(parse("Protein 1g").fields.protein, 1);
  assert.deepEqual(parse("Protein 22g").uncertain, []);
});

test("a number split by a space (\"2 10\") is read as one number, and the macros back it up", () => {
  const r = parse(BAR);
  assert.equal(r.fields.calories, 210);
  assert.ok(r.uncertain.includes("calories"));
  assert.deepEqual(r.warnings, []);
  assert.equal(parse("Calories 1 20").fields.calories, 120);
  assert.equal(parse("Calories 140").fields.calories, 140);
  assert.equal(parse("Calories 140 Calories from Fat 0").fields.calories, 140);
});

test("when the macros disagree with the joined number, the reading that fits them wins", () => {
  // "Calories 10 5" could be 105 or 10; 9*0 + 4*20 + 4*6 = 104 says 105.
  assert.equal(parse("Calories 10 5\nTotal Fat 0g\nTotal Carbohydrate 20g\nProtein 6g").fields.calories, 105);
});

test("a two-column label gives the per-serving column, whichever side it is on", () => {
  const r = parse(TWO_COLUMN);
  assert.deepEqual(r.fields, { calories: 100, fat: 2.5, sodium: 80, carbs: 12, protein: 9 });
  const flipped = parse("Per serving Per 100g\nCalories 100 40\nTotal Fat 2.5g 1.0g\nProtein 9g 3.6g");
  assert.deepEqual(flipped.fields, { calories: 100, fat: 2.5, protein: 9 });
  const container = parse("Per serving Per container\nCalories 100 300\nTotal Fat 2.5g 7.5g\nProtein 9g 27g");
  assert.deepEqual(container.fields, { calories: 100, fat: 2.5, protein: 9 });
  const reversed = parse("Per container Per serving\nCalories 300 100\nProtein 27g 9g");
  assert.equal(reversed.fields.protein, 9);
});

test("\"servings per container\" and \"amount per serving\" on separate lines are not column headings", () => {
  // Reading these as a two-column label picked the second number, so calories came out wrong.
  const r = parse("12 servings per container\nServing size 1 bar (45g)\nAmount per serving\nCalories 210\nTotal Fat 8g\nTotal Carbohydrate 28g\nProtein 10g");
  assert.deepEqual(r.fields, { calories: 210, fat: 8, carbs: 28, protein: 10 });
  assert.equal(parse("About 13 servings per container\nAmount per serving\nCalories 120\nProtein 3g").fields.calories, 120);
});

test("nothing is invented: a line that isn't there is left out, not set to zero", () => {
  const r = parse("Nutrition Facts\nCalories 140\nTotal Fat 0g\nSodium 65mg");
  assert.deepEqual(Object.keys(r.fields).sort(), ["calories", "fat", "sodium"]);
  assert.deepEqual(r.missing.sort(), ["carbs", "protein"]);
  assert.equal(parse("").matchedCount, 0);
  assert.equal(parse(null).matchedCount, 0);
  assert.equal(parse(undefined).matchedCount, 0);
  assert.equal(parse(42).matchedCount, 0);
  assert.equal(parse("just some words about yogurt").matchedCount, 0);
});

test("saturated and trans fat lines are never read as total fat", () => {
  assert.equal(parse("Saturated Fat 3.5g 18%\nTrans Fat 0g").fields.fat, undefined);
  assert.equal(parse("Total Fat 8g 10%\nSaturated Fat 3.5g 18%").fields.fat, 8);
  // Labels that just say "Fat" are accepted, but only when it isn't a sub-line.
  assert.equal(parse("Calories 90\nFat 8g\nCarbohydrate 2g").fields.fat, 8);
  assert.equal(parse("Saturated Fat 3g\nPolyunsaturated Fat 1g\nMonounsaturated Fat 2g\nTrans Fat 0g").fields.fat, undefined);
});

test("other wording labels use: Carbohydrate, Carbs, Total Carb., Fibre-free layouts, a value on the next line", () => {
  assert.equal(parse("Carbohydrate 12g").fields.carbs, 12);
  assert.equal(parse("Total Carb. 12g").fields.carbs, 12);
  assert.equal(parse("Total Carbs 12g").fields.carbs, 12);
  assert.equal(parse("Protein\n22g").fields.protein, 22);
  assert.equal(parse("Calories\n140").fields.calories, 140);
  assert.equal(parse("Calorles 140").fields.calories, 140, "an l read in place of the i");
  assert.equal(parse("Prote1n 22g").fields.protein, 22);
});

test("the footnote about 2,000 calories is not read as the product's calories", () => {
  const r = parse("2,000 calories a day is used for general nutrition advice.\nCalories 140");
  assert.equal(r.fields.calories, 140);
  assert.equal(parse("based on 2,000 calories a day").fields.calories, undefined);
});

test("a number no real serving could have is a misread, not a fact", () => {
  const r = parse("Total Fat 5000g\nProtein 900g\nSodium 90000mg\nCalories 99999\nTotal Carbohydrate 12g");
  assert.deepEqual(r.fields, { carbs: 12 });
});

test("calories that don't fit the macros are reported, not changed", () => {
  const r = parse("Calories 10\nTotal Fat 8g\nTotal Carbohydrate 28g\nProtein 10g");
  assert.equal(r.fields.calories, 10, "the number is left as read");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Calories \(10\) don't fit/);
  assert.ok(r.uncertain.includes("calories"));
  // Close enough is quiet: label rounding and fiber make small differences normal.
  assert.deepEqual(parse("Calories 210\nTotal Fat 8g\nTotal Carbohydrate 28g\nProtein 10g").warnings, []);
  assert.deepEqual(parse("Calories 140\nTotal Fat 0g\nTotal Carbohydrate 9g\nProtein 22g").warnings, []);
  // Without all three macros there is nothing to compare against.
  assert.deepEqual(parse("Calories 10\nTotal Fat 8g").warnings, []);
});

test("fiber more than total carbs is reported", () => {
  const r = parse("Total Carbohydrate 3g\nDietary Fiber 30g");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Fiber/);
  assert.deepEqual(r.uncertain.sort(), ["carbs", "fiber"]);
});

test("checkFields works on any set of fields, for combining two readings", () => {
  const c = P.checkFields({ calories: 50, fat: 10, carbs: 30, protein: 20 });
  assert.equal(c.warnings.length, 1);
  assert.deepEqual(P.checkFields({ calories: 290, fat: 10, carbs: 30, protein: 20 }).warnings, []);
  assert.deepEqual(P.checkFields({}).warnings, []);
});

test("which of the four main values are missing is reported, so the page can say so", () => {
  assert.deepEqual(parse("Calories 140").missing, ["fat", "carbs", "protein"]);
  assert.deepEqual(parse(YOGURT).missing, []);
});

test("a long block of unrelated text can't make the parser slow or throw", () => {
  const noise = ("Total Fat " + "9".repeat(5000) + " ").repeat(50) + "Protein " + "l".repeat(20000) + "\n".repeat(2000);
  const t0 = Date.now();
  const r = parse(noise);
  assert.ok(Date.now() - t0 < 1500, "finished quickly");
  assert.ok(r.matchedCount >= 0);
});

test("a serving size whose g was read as a 9 is put right: (459) is (45g)", () => {
  assert.equal(parse("Serving size 1 bar (459)").servingSize, "1 bar (45g)");
  assert.equal(parse("Serving size 1 cup (2409)").servingSize, "1 cup (240g)");
  assert.equal(parse("Serving size 1 bar (45g)").servingSize, "1 bar (45g)");
  assert.equal(parse("Serving size 2 tbsp (30 mL)").servingSize, "2 tbsp (30 mL)");
  assert.equal(parse("Serving size 1 container (250g)").servingSize, "1 container (250g)");
});

/* ---------------- scaling to the amount you actually eat ---------------- */

test("a weight or volume is read from the way servings are written", () => {
  assert.deepEqual(P.parseAmount("250g"), { value: 250, unit: "g" });
  assert.deepEqual(P.parseAmount("250 g"), { value: 250, unit: "g" });
  assert.deepEqual(P.parseAmount("250 grams"), { value: 250, unit: "g" });
  assert.deepEqual(P.parseAmount("1 container (170g)"), { value: 170, unit: "g" });
  assert.deepEqual(P.parseAmount("3/4 cup (30g)"), { value: 30, unit: "g" });
  assert.deepEqual(P.parseAmount("2 tbsp (30 mL)"), { value: 30, unit: "ml" });
  assert.deepEqual(P.parseAmount("300ml"), { value: 300, unit: "ml" });
  assert.deepEqual(P.parseAmount("1.5g"), { value: 1.5, unit: "g" });
  assert.deepEqual(P.parseAmount("1,5 g"), { value: 1.5, unit: "g" }, "a decimal comma");
  assert.deepEqual(P.parseAmount("About 1 cup (227g)"), { value: 227, unit: "g" });
});

test("the metric amount in brackets beats the household one, and ounces are converted", () => {
  assert.deepEqual(P.parseAmount("6 oz (170g)"), { value: 170, unit: "g" });
  assert.equal(P.parseAmount("6 oz").unit, "g");
  assert.ok(Math.abs(P.parseAmount("6 oz").value - 170.1) < 0.1);
  const fl = P.parseAmount("8 fl oz");
  assert.equal(fl.unit, "ml");
  assert.ok(Math.abs(fl.value - 236.6) < 0.1);
});

test("text with no weight or volume gives nothing, and mg or a bare number is never taken for grams", () => {
  for (const t of ["1 cup", "2 scoops", "250", "1 container", "", null, undefined, "45mg", "0g", "g", "serving"]) assert.equal(P.parseAmount(t), null, String(t));
});

test("scaling: the label's serving against the amount you typed", () => {
  const plan = P.scalingPlan("1 container (170g)", "250g");
  assert.equal(plan.ok, true);
  assert.ok(Math.abs(plan.factor - 250 / 170) < 1e-9);
  assert.deepEqual(plan.label, { value: 170, unit: "g" });
  assert.deepEqual(plan.mine, { value: 250, unit: "g" });
  assert.equal(P.scalingPlan("1 cup (240 mL)", "120 ml").factor, 0.5);
  assert.equal(P.scalingPlan("1 bar (45g)", "45g").factor, 1, "the same amount changes nothing");
});

test("scaling says why it can't be done instead of guessing", () => {
  assert.deepEqual(P.scalingPlan("1 container (170g)", "1 cup"), { ok: false, reason: "no-amount" });
  assert.deepEqual(P.scalingPlan("1 container (170g)", ""), { ok: false, reason: "no-amount" });
  assert.deepEqual(P.scalingPlan("1 container (170g)", "250"), { ok: false, reason: "no-amount" }, "a bare number has no unit");
  assert.equal(P.scalingPlan(null, "250g").reason, "no-label");
  assert.equal(P.scalingPlan("1 cup", "250g").reason, "no-label");
  assert.equal(P.scalingPlan("1 cup (240 mL)", "250g").reason, "units", "millilitres are not grams");
  assert.equal(P.scalingPlan("1 container (170g)", "25000g").reason, "range");
  assert.equal(P.scalingPlan("1 container (170000g)", "250g").reason, "range");
});

test("scaled numbers are rounded the way the form shows them, and no field is invented", () => {
  const label = { calories: 120, protein: 17, carbs: 6, fat: 0, fiber: 0, sodium: 65, calcium: 200, iron: 0.4, potassium: 260, vitaminD: 0 };
  const s = P.scaleFields(label, 250 / 170);
  assert.deepEqual(s, { calories: 176, protein: 25, carbs: 8.8, fat: 0, fiber: 0, sodium: 96, calcium: 294, iron: 0.6, potassium: 382, vitaminD: 0 });
  assert.deepEqual(Object.keys(P.scaleFields({ calories: 100 }, 2)), ["calories"]);
  assert.deepEqual(P.scaleFields({}, 2), {});
  assert.deepEqual(P.scaleFields(null, 2), {});
  assert.deepEqual(P.scaleFields({ calories: "x", fat: NaN, protein: 4 }, 2), { protein: 8 });
  assert.equal(P.scaleFields({ fat: 1.5 }, 1).fat, 1.5, "a factor of 1 leaves the label's numbers as printed");
  assert.equal(P.scaleFields({ fat: 3.5 }, 0.5).fat, 1.8);
});

/* ---------------- mangled words, the footnote, and the printed Daily Values ---------------- */

// Raw text from tilted photos (what the recognition engine actually returned).
const TILTED_YOGURT = `Nutritio Facts
1 Serving per Container
Serving Size 1 COntaing, (250g)
Amount per Serving
Calorigg 140
% Daily Valyex
Tota] Fat Og 0%
Saturateq Fat Og 0%
Trans Fat Og
Cholesterg; 10mg 3%
Sodium 65mg 3%
Tota] Carbohydrate 9g 3%
Dietary Fiber Og 0%
Total Sugars 7g
Includes Og Added Sugars 0%
Protein 22g
Vitamin D Omcg 0%
Calcium, 200mg 15%
Iron Omg 0%
Potassium 260mg 6%
of foog CONtribyteg 0a daily diet 2,000 Calories 5 day is used for
Genera) Nutrition advice`;

const TILTED_CEREAL = `Nutritio, Facts
About 13 Servings per Container
Serving Size 3i4 Cup (30g)
Amount per Serving
Calorigg 12 0
% Daily Valyex
Tota] Fat 15g 2%
Saturateq Fat Og 0%
Trans Fat Og
Cholesterg; 10mg 3%
Sodium 190mg 8%
Total Carbohydrate 24g 9%
Dietary Fiber 5g 18%
Total Sugars 6g
Includes 6g Added Sugars 0%
Protein 3g
Vitamin D 2mcq 10%
Calcium, 130mg 10%
Iron 8mg 45%`;

test("a tilted photo's mangled words are still read, and the 2,000-calorie footnote is not taken for the calories", () => {
  const r = parse(TILTED_YOGURT);
  assert.deepEqual(r.fields, { calories: 140, fat: 0, sodium: 65, carbs: 9, fiber: 0, protein: 22, vitaminD: 0, calcium: 200, iron: 0, potassium: 260 });
  assert.ok(r.uncertain.includes("calories"), "read from a mangled word, so worth a look");
  assert.ok(r.uncertain.includes("fat"), "Tota] Fat was matched loosely");
  assert.ok(!r.uncertain.includes("sodium") && !r.uncertain.includes("carbs"), "spelled correctly, so not flagged");
  assert.deepEqual(r.warnings, []);
});

test("the calories footnote is skipped even when it is the only 'calories' on the page", () => {
  assert.equal(parse("of food contributes to a daily diet. 2,000 Calories 5 day is used").fields.calories, undefined);
  assert.equal(parse("2,000 calories a day").fields.calories, undefined);
  assert.equal(parse("Calories a day is used\nCalories 140").fields.calories, 140);
});

test("loose label matching only works at the start of a line, and only with a value after the name", () => {
  assert.equal(parse("Calorigg 140").fields.calories, 140);
  assert.equal(parse("Calorigg").fields.calories, undefined, "no value follows");
  assert.equal(parse("Tota] Fat 8g").fields.fat, 8);
  assert.equal(parse("Tota] Carbohydrate 12g").fields.carbs, 12);
  assert.equal(parse("Protien 22g").fields.protein, 22);
  assert.equal(parse("Potassiun 260mg").fields.potassium, 260);
  assert.equal(parse("buy high Protien 22g now").fields.protein, undefined, "not at the start of a line");
  assert.equal(parse("Sodiun\n65mg").fields.sodium, 65, "the value on the next line");
  assert.deepEqual(parse("Vitamin D 3mcg").fields, { vitaminD: 3 });
  assert.deepEqual(parse("Vitamin C 30mg").fields, { vitaminC: 30 }, "C and D are never swapped by loose matching");
  assert.deepEqual(parse("Total Sugars 12g\nSaturated Fat 3g\nTrans Fat 0g").fields, {}, "other lines are not mistaken for a nutrient");
});

test("a lost decimal point is put right when the printed Daily Value says so, and the change is reported", () => {
  const r = parse(TILTED_CEREAL);
  assert.equal(r.fields.fat, 1.5, "15g beside 2% only fits 1.5g");
  assert.equal(r.fields.calories, 120);
  assert.ok(r.uncertain.includes("fat"));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Fat: read 15g, but the 2% Daily Value printed beside it only fits 1\.5g, so 1\.5g is used\./);
  assert.equal(r.fields.carbs, 24);
  assert.equal(r.fields.fiber, 5);
  // Only a decimal shift is ever corrected; digits that merely disagree are flagged, not changed.
  const bad = parse("Total Fat 6g 25%");
  assert.equal(bad.fields.fat, 6, "left as read");
  assert.ok(bad.uncertain.includes("fat"));
  assert.match(bad.warnings[0], /Fat \(6g\) doesn't match the 25% Daily Value/);
});

test("an amount that fits its printed Daily Value is not flagged, on either generation of label", () => {
  const ok = parse("Total Fat 8g 10%\nSodium 150mg 7%\nTotal Carbohydrate 28g 10%\nDietary Fiber 3g 11%\nCalcium 100mg 8%\nIron 2mg 10%\nPotassium 190mg 4%\nVitamin D 2mcg 10%");
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.uncertain, []);
  assert.deepEqual(parse("Total Fat 8g 12%\nSodium 150mg 6%\nTotal Carbohydrate 28g 9%").warnings, [], "the older label's basis (65g fat, 2,400mg sodium, 300g carbs) also fits");
  assert.deepEqual(parse("Total Fat 0g 0%\nSodium 0mg 0%\nTotal Carbohydrate 0g O%").warnings, [], "zeros, including a 0 read as O");
  assert.deepEqual(parse("Total Fat 8g\nSodium 150mg").warnings, [], "no Daily Value printed, nothing to check");
});

test("Daily Values are not used on a two-column label, where they can belong to either column", () => {
  const r = parse("Per 100g Per serving\nTotal Fat 1.0g 2.5g 3%\nSodium 32mg 80mg 4%");
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.dvs, {});
});

test("checkFields flags a mismatch between two readings' values and Daily Values", () => {
  const c = P.checkFields({ sodium: 150, fat: 8 }, { sodium: 70, fat: 10 });
  assert.equal(c.warnings.length, 1);
  assert.deepEqual(c.uncertain, ["sodium"]);
  assert.match(c.warnings[0], /Sodium \(150mg\) doesn't match the 70% Daily Value/);
  const many = P.checkFields({ fat: 1, sodium: 1, carbs: 1, fiber: 1, calcium: 1 }, { fat: 90, sodium: 90, carbs: 90, fiber: 90, calcium: 90 });
  assert.equal(many.warnings.length, 4, "three named, then a count");
  assert.match(many.warnings[3], /2 more amounts/);
  assert.equal(many.uncertain.length, 5, "all five are still flagged");
});

test("a mangled saturated or trans fat line is never taken for total fat", () => {
  assert.equal(parse("Saturateq Fat 3g 15%\nTrans Fat Og\nTota] Fat 8g 10%").fields.fat, 8);
  assert.equal(parse("Saturateq Fat 3g 15%").fields.fat, undefined);
  assert.equal(parse("Polyunsaturated Fat 1g\nMonounsaturated Fat 2g").fields.fat, undefined);
  // With nothing better, a plain "Fat" line is used, but flagged.
  const r = parse("Calories 90\nFat 8g");
  assert.equal(r.fields.fat, 8);
  assert.ok(r.uncertain.includes("fat"));
});

test("transposed letters and a g read as q are tolerated (Protien, mcq)", () => {
  assert.equal(parse("Protien 22g").fields.protein, 22);
  assert.equal(parse("Vitamin D 2mcq").fields.vitaminD, 2);
  assert.equal(parse("Vitamin D 2mcg").fields.vitaminD, 2);
});

test("debris beside the unit (¢ or ©) is ignored, and the value is flagged", () => {
  const r = parse("Calories 80\nTotal Fat 1.5¢ 2%\nProtein 5¢g\nTotal Carbohydrate 15g 5%");
  assert.equal(r.fields.fat, 1.5);
  assert.equal(r.fields.protein, 5);
  assert.ok(r.uncertain.includes("fat") && r.uncertain.includes("protein"));
  assert.ok(!r.uncertain.includes("carbs"), "a cleanly read value stays unflagged");
});

test("a two-column label's per-serving amount survives debris in the unit: 2.5¢9 is 2.5", () => {
  const r = parse("Nutrition Facts\nServing size 1 pot (150g)\nPer 100g Per serving\nCalories 40 100\nTotal Fat 1.0g 2.5¢9\nSodium 32mg 80mg\nTotal Carbohydrate 4.8g 12g\nProtein 3.6g 9g");
  assert.equal(r.fields.fat, 2.5);
  assert.equal(r.fields.calories, 100);
  assert.equal(r.fields.carbs, 12);
});

test("on a two-column label, a line with only one readable amount is left out, never guessed at", () => {
  const r = parse("Nutrition Facts\nPer 100g Per serving\nCalories 40 100\nTotal Fat 1.0g\nSodium 32mg 80mg\nTotal Carbohydrate 4.8g 12g\nProtein 9g");
  assert.equal(r.fields.fat, undefined, "could be either column");
  assert.equal(r.fields.protein, undefined);
  assert.equal(r.fields.sodium, 80);
  assert.equal(parse("Per 100g Per serving\nCalories 40").fields.calories, undefined);
  assert.ok(r.missing.includes("protein") && r.missing.includes("fat"));
});
