# Meal Prep

**Health › Nutrition › Meal Prep.** One screen that connects your recipes, your week of meals, the grocery list, food you cooked ahead, and
the times you shop and cook, to your Calendar, Day plan, Habits and nutrition numbers.

```
TODAY'S MEALS        PLANNED PROTEIN     NEXT PREP SESSION     PREPARED PORTIONS
0 of 4 eaten         85 g (target 160)   Cooking · Sat 10 AM   5 portions left · 1 to use soon

[ Weekly Plan ] [ Recipes ] [ Grocery List ] [ Prep Tracker ]
```

Nothing here is a second copy of anything. **Recipes, the week plan, the grocery list and the pantry are the ones Nutrition and Groceries already
had** (they now open in a richer view). What is new is saved in three keys (`jarvisMealPrepBatches`, `jarvisMealPrepSessions`,
`jarvisMealPrepPrefs`), all in the cloud backup.

## Weekly Plan

Seven day cards (today is open), four meals a day. Each planned meal shows its **name, calories, protein / carbs / fat, portion, preparation
time and status**: *To prep*, *Prepped*, *Eaten* (or *Planned* for a quick meal, *Eating out*). Tap a meal for its **ingredients scaled to the
portion**.

* **Add a meal** from a recipe, or as a quick meal with your own numbers. **Repeat the same meal on several days** in one step: each day gets its own copy (tied by a group), so each can still be moved, edited or eaten separately, and one Undo reverses them all.
* **Move**: drag a meal onto another day (a long press on a phone), or use **Move**. One day of a *repeating* meal moves on its own; the rest of the series stays.
* **Mark eaten** puts one line in your food log with the numbers as they are *now*, uses a prepared portion if you have one (otherwise the ingredients come out of the pantry estimate), and **Undo** puts all of it back. *Not eaten* reverses it later.
* Meals you are **eating out** need no shopping or prep. A meal marked **prepped** needs no shopping.
* **Training days** (from your Workout routine schedule) are marked, with a note to plan protein and carbs around them. Nothing limits how much you eat.
* **Nutrition overview**: pick a day to see planned and logged calories, protein, carbs and fat side by side (plus your target, if you set one), meals done and still to come, and a seven-day chart with a table view. It states differences in plain numbers ("logged is 723 kcal less than planned") and never calls a day "over". If a plan is far under your calorie target it suggests adding food, not removing it.
* **Ideas** (suggestions, not rules): meals for empty slots from your own recipes (a different one from the last few days, favorites first, protein and carbs on a training day), recipes that are good for recovery (at least 25 g protein and 30 g carbs a serving), and recipes you can cook with what is in your pantry.

## Recipes

Your library, with search (names and ingredients), the categories **Breakfast, Lunch, Dinner, Snacks, High-protein** (worked out from 25 g protein a serving) and **Favorites**. Each recipe has ingredients and amounts, steps, servings, prep and cooking time, calories and macros **per serving**, storage notes and reheating, and an optional picture (shrunk to a small JPEG so it stays within storage). Edit, duplicate, favorite, delete (all with Undo), **Add to plan**, and **I cooked this**.

Per serving is always worked out (sum of the ingredients ÷ servings), never stored. **Editing a recipe changes meals you plan from now on. Meals you already marked eaten, your food log, and batches you recorded keep the numbers they had.**

### Estimated values

A number that you did not type is marked **est.** It comes from a small built-in list of typical values for about 50 common foods (`js/mealprep-foods.js`), or from the AI estimate Nutrition already offered. The list is **approximate**: typical USDA-style figures, rounded; brands, cuts and cooking methods differ, and a package label always wins. Typing over an estimate makes it yours. A food that is not in the list is left blank, not guessed. Amounts the list can't turn into grams (for example "2 cups of rice") are not guessed either.

## Portion calculator

Enter what you cooked, say whether each weight is **raw or cooked**, and the number of portions. Example: 1,000 g ground turkey (raw) + 500 g rice (cooked) + 200 g mixed vegetables, five portions → about **450 kcal, 41 g protein, 32 g carbs, 17 g fat** a portion.

Raw and cooked are not the same food: 100 g of cooked rice is about a third of the rice 100 g of dry rice is. The list has numbers for each state; when it only has one, it converts with a typical yield and says so. If you type your own label numbers, say whether they are for raw or cooked food, and it converts the weight the same way (or warns when it has no yield for that food). Add the finished dish's weight to see grams per portion. **Save as a recipe** carries it into the recipe form.

## Grocery List

The list Nutrition › Groceries keeps. It is built from the meals in your plan (a recipe's ingredients scaled to the portions), **duplicates combined into one total** when the units match, **what you already have at home taken off**, and meals already **prepared** left out (a batch with portions left and still good that day, or a meal marked prepped). Grouped by aisle (Produce, Meat & Seafood, Dairy & Eggs, Grains & Pasta, …). Tick items as you buy them (they go into the pantry estimate), **Have it**, **add your own**, **remove** (Undo). Meals with no recipe can't add anything, and the list says how many.

## Prep Tracker

**Prepared meals (leftovers).** Each batch has the date prepared, portions left, where it is kept, a **use-by date**, and reheating instructions. **Ate 1 portion** takes one off and adds it to your food log (Undo reverses both); the −/+ buttons correct the count without logging. **Freeze it** starts a 90-day clock; moving it back to the fridge to thaw gives 3 days. Food nearing its date gets ideas for using it up; food past its date is flagged and never hidden.

Use-by dates follow general food-safety guidance (USDA FoodSafety.gov): refrigerate within 2 hours of cooking, eat within **3 to 4 days** (the app uses 4), freeze for best quality within about **3 months** (the app uses 90 days), reheat to **165 °F / 74 °C**. It is guidance, not a guarantee, and you can change any date.

**Prep schedule.** Grocery shopping, cooking, portioning and reminders. Each is **one Calendar event**, found again by the session's id, so saving twice, a double tap, or editing never makes another; deleting the session removes it. Reminders use the Calendar's. **Also put it on my to-do list** (or *Add to my day plan*) makes one task for that day in your Day plan; it is *not* drawn on the Calendar as a second copy while its event is there, and ticking the task finishes the session (and the other way round). If you delete the event in the Calendar, the schedule says so and can put it back, once.

**What to prepare / good times to cook.** From the plan: which recipes still need cooking this week and how long that takes (prep + cook + 20 minutes to portion), and the free stretches in your Calendar (9 AM to 8 PM) long enough for it, weekends and the day before a busy day first. **Schedule here** fills the session in.

**Meal habits.** *Eat breakfast*, *Prepare lunch*, *Drink water*: made in **Habits** (the same habits, streaks and planner times). Eating a planned breakfast and prepping a planned lunch tick them for you.

## Where it shows up

| | |
|---|---|
| **Health overview** | A *Meal prep* card: planned and logged calories today, protein, the next prep session, prepared portions. |
| **Calendar and Day plan** | Prep sessions are Calendar events (Health category). |
| **Habits** | The three meal habits above. |
| **Workout** | Training days on the week plan, from your routines. |

## What is stored

| | |
|---|---|
| `jarvisNutritionRecipes` | recipes: now with optional `cats`, `favorite`, `prepMin`, `cookMin`, `storage`, `image`, `updatedAt`, and per ingredient `state` and `est`. A recipe saved before is read as it was. The older Foods form keeps these fields when you edit there. |
| `jarvisGroceryMealPlan` | the week plan: now with optional `skipDates`, `preppedDates`, `macros` (a quick meal's own numbers), `frozen` (numbers of a meal as eaten), `loggedItems`, `fromBatch`, `group`, `updatedAt`. |
| `jarvisMealPrepBatches` | `{ id, recipeId, name, preparedOn, portions, remaining, place, useBy, reheat, per, notes, eaten[] }` (removed ones are marked, 30 days, so a delete reaches other devices) |
| `jarvisMealPrepSessions` | `{ id, kind, title, date, time, durationMin, recipeIds, remind, eventId, taskId, doneAt }` |
| Calendar event | an ordinary event with `linked: { type: "mealprep", id }`. Tasks made from a session carry `mealPrepId`. |

## Limits worth knowing

* The typical values are approximate and cover about 50 foods. The calculator and "Estimate" need weights (g, oz, lb) or pieces/spoons for foods the list knows. For anything else type the numbers.
* A planned meal needs a recipe to add groceries; a quick meal with your own numbers counts toward nutrition but adds nothing to the list.
* Prepared portions cover planned meals of the *same recipe* only.
* A meal removed from the plan on one device can come back from another device that still had it (as with the rest of the backup).
* Pantry amounts are estimates (what you bought, minus what you cooked or ate) and can be corrected any time in the Grocery List or Groceries.
* The Groceries tab is unchanged and still has the shopping-day setup, regularly eaten foods and amounts. Both screens edit the same data.
* Tested in Chromium (desktop and phone sizes); not on a real iPhone.

## Where the code is

`js/mealprep-logic.js` (pure rules; tests `functions/test/mealprep-logic.test.js`) · `js/mealprep-foods.js` (typical values) · `js/mealprep-ui.js` (shell, overview, saving, Undo) · `js/mealprep-plan-ui.js`, `-recipes-ui.js`, `-grocery-ui.js`, `-tracker-ui.js` (the four tabs) · `js/nutrition.js` (recipe and food-log API) · `js/groceries.js` (plan, list and pantry API; prepared meals) · `js/habits.js` (`addHabit`) · `js/calendar-ui.js` (one row per session) · `js/health-overview-ui.js` (the card).
