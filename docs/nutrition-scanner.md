# Nutrition scanner

**Nutrition › Today › + Add Food › Scan a label** (also **Foods › + Add › Scan a label**, and **From my foods or a label** in both recipe forms). One sheet takes a food from a photo of its label to a line in your meal, in four steps. The label is the baseline for every number.

```
 1 Scan   ›   2 Review   ›   3 Amount   ›   4 Add
 photo or     check what    how much you   which meal,
 saved food   was read      had            then done
```

## The four steps

1. **Scan.** Take a photo, choose one from your photos, pick a food you already saved, or type the numbers in by hand. The photo is read on the phone (the same on-device reader as before).
2. **Review.** What was read is filled in: food name (you type it; labels rarely print one), the serving as printed ("2/3 cup (55g)"), the weight or volume of that serving, calories, protein, carbs, fat and fiber, and more nutrients under "More nutrients". A value the reader was unsure of has an amber outline and says why, with an **It's right** button. A value it could not read is **empty and marked**: calories, protein, carbs and fat must each be typed (0 is an answer) before **Continue** turns on. Nothing is filled in for you.
3. **Amount.** Type how much you had, in **g, oz or servings** (or **mL, fl oz or servings** for a drink labelled in millilitres). Switching the unit carries the amount over (82.5 g is 1.5 servings is 2.91 oz). The numbers update as you type. Quick amounts: your default portion, the last amount you used, ½ / 1 / 2 servings, the whole package when the label says how many servings it holds.
4. **Add.** The meal is picked from the time of day (change it with one tap). **Add to Lunch** puts it in today's log.

A food you saved before starts at step 3 (steps 1 and 2 show as done).

## Amounts and units

* **Grams and millilitres are never mixed.** A label in grams takes g, oz and servings; a label in millilitres takes mL, fl oz and servings. Typing "200g" for a millilitre food is refused with the reason, and no numbers are shown for it.
* **A label with no weight or volume** ("1 bar", "1 cup" with nothing in brackets) is servings only. The sheet says so and tells you where to add the weight (Foods › Edit). The household measure on its own is never turned into grams.
* **Ounces** are exact (1 oz = 28.349523125 g, 1 fl oz = 29.5735295625 mL). A logged line says both: "3 oz (85 g)".
* An amount that is a tiny fraction of a serving, or tens of servings, is flagged ("check the amount"); an absurd one (under 0.001 or over 1000 servings) is refused.

## Accuracy

* **Every number is worked out from the label, once.** 30 g, then 60 g, then 30 g again gives exactly what 30 g gave: nothing is ever scaled from a number that was already scaled or rounded.
* **Rounding happens once**, when a number is shown or logged: whole calories and minerals, one decimal for the rest. A recipe adds its ingredients up exact and rounds the total; one portion is the exact total divided, not the rounded total divided.
* **Nothing is invented.** Unread numbers stay empty. Fiber left empty is saved as "not on the label" (a line you log from it counts fiber as 0, like every line without one). Numbers that were flagged and that you neither retyped nor confirmed are kept marked: the food shows a **Check numbers** badge and says which ones, and **Mark checked** clears it.
* **The AI estimate in the recipe form never touches a label ingredient.** An estimate must not replace numbers read from a package.

## Saved foods and the library

* **Every scanned food is saved** when you leave the review step, with its label as printed: serving, weight or volume, servings per container, and the numbers for one serving. Scan the same product again (same name) and the saved food is updated, keeping its favorite, portions and history; the review says so first ("You already have “Granola” saved").
* **Foods › Food library:** search by name or serving; a ★ on each food for favorites; **Favorites** filter; sort by name, recently added, recently used or calories; each food shows its serving, what you had last, and a **Scanned** / **Check numbers** badge. **Edit** changes the numbers, the serving, the weight and the portions without scanning again; **+ Log** opens the sheet at the amount step.
* **In the Add Food sheet,** the Saved tab lists Favorites, then what you used lately, then everything else; Recent shows what you had and in what amount.
* **A logged line from a food keeps its label and the amount you had** ("82.5 g"). Its menu has **Change amount**, which re-works it from the label (never from the rounded numbers on the line). **Save as Saved Food** on such a line saves the label, not the amount, and says so if the food is already saved.

## Portions

* Each food remembers **the last amount you used** (offered first next time) and can have up to 12 **named portions** ("My bowl · 60 g"), one of them offered first. Portions are made on the Amount step (**My portions**) or in the food's edit form. A portion is in a unit the food allows; if a food's label later changes from grams to millilitres, portions in grams are dropped rather than converted.
* **Foods saved before this update.** Nothing is rewritten. A food saved with a label whose own serving differs from the label's ("125g" next to "1 container (250g)") keeps meaning 125 g: it gets a **Saved serving** portion the first time it is used, offered first. A food whose serving is a household measure ("1 cup") is servings only, as before.

## Meal Prep

* **From my foods or a label** in the Meal Prep recipe form and in Nutrition's recipe form opens the same sheet. The last step is **Add to recipe**. The ingredient keeps its food, its label and the amount, and its numbers follow the amount exactly. Its quantity text is a weight or volume ("100 g (2.5 servings)") so groceries and portions can use it.
* **Typing over a linked ingredient** (its amount or any of its numbers) lets go of the link; it then keeps what you typed, with no stale label. **Change amount** re-opens the sheet at the amount.
* **Totals and portions** (under the ingredients): the whole recipe, one portion (÷ the servings), and how much of each ingredient one portion needs ("Chicken 600 g in all · 150 g each"). A count ("2 eggs") has no unit to divide and is shown as it is. Ingredients with no numbers are named and left out of the totals.
* **Weight of the finished dish** (optional): then a portion has a weight, and the recipe can be logged **by weight** in the sheet (400 g of a 1000 g dish divided into 4 is 1.6 servings). Without it, a recipe is logged by servings only.
* Meal Prep's Weekly Plan, grocery list and prepared-meal tracker use the same recipe numbers as before.

## What is stored

Everything is in the keys Jarvis already used; every new field is optional, so what you saved before reads as it was.

| | |
|---|---|
| `jarvisNutritionSavedFoods` | a saved food gains `label { serving, size { value, unit: "g" \| "ml" }, perContainer, values }` (the baseline), `favorite`, `lastUsedAt`, `useCount`, `lastPortion { unit, value }`, `portions [{ id, name, unit, value }]`, `defaultPortionId`, `source` (`scan` or `manual`), `needsCheck [fields]`, `updatedAt`. The top-level serving and numbers are the same as the label's for foods saved from now on. |
| `jarvisNutritionLog` | a line made from a food gains `foodId`, `label` and `amount { value, unit }`. Lines from a recipe carry none of them (a recipe is a snapshot). |
| `jarvisNutritionRecipes` | an ingredient made from a food gains `foodId`, `label` and `amount`; a recipe gains `dishGrams` and, once logged, `lastPortion`. |

## Where the code is

* `js/food-amount-logic.js`: the rules (amounts, units, baseline, rounding, portions, recipe totals and per-portion quantities); no page, so it is unit tested (`functions/test/food-amount-logic.test.js`).
* `js/food-flow-ui.js`: the sheet and its helpers for recipe editors. It reads and writes through `JarvisNutrition.flow` only.
* `js/nutrition.js`: the library, the saved-food form, the flow API (`JarvisNutrition.flow`, `.foods`), logging and Change amount.
* `js/nutrition-label-parse.js` / `js/nutrition-label-scan.js`: reading the label (unchanged apart from the servings-per-container line and exact ounce constants).
* `js/mealprep-logic.js` (`cleanIngredient` keeps the link), `js/mealprep-recipes-ui.js` (the recipe form).

## Limits worth knowing

* The label reader (Tesseract) downloads its language data the first time it is used, so the first scan needs a connection. It was tested here with a stand-in for the reader; every step after reading was tested in Chromium at phone and desktop sizes, not on a real iPhone and not with real label photos.
* The label's weight comes from the serving as printed. If the serving text and the weight box disagree, the box is used and the review says so.
* A food that was saved from a scan by a name that already exists is **updated**, not duplicated. If you wanted two different products under one name, give them different names.
* Recipe lines in the food log are snapshots with no label, so they have no **Change amount**; edit them by hand.
* Typed ingredient quantities that are a count ("2 eggs") are not divided into portions.
