# Meal Prep

**Health › Nutrition › Meal Prep.** One screen that connects your recipes, your week of meals, the grocery list, food you cooked ahead, and
the times you shop and cook, to your Calendar, Day plan, Habits and nutrition numbers.

```
TODAY'S FOODS        PLANNED PROTEIN     NEXT PREP SESSION     PREPARED PORTIONS
0 of 4 eaten         85 g (target 160)   Cooking · Sat 10 AM   5 portions left · 1 to use soon

[ Weekly Plan ] [ Recipes ] [ Grocery List ] [ Prep Tracker ]
```

Nothing here is a second copy of anything. **Recipes, the week plan, the grocery list and the pantry are the ones Nutrition and Groceries already
had** (they now open in a richer view). What is new is saved in four keys (`jarvisMealPrepBatches`, `jarvisMealPrepSessions`,
`jarvisMealPrepMeals`, `jarvisMealPrepPrefs`), all in the cloud backup.

## Weekly Plan

**The idea: plan the foods you usually eat once, open JARVIS each day, tick off what you ate, and replace anything you ate differently.**

Seven day cards (today is open, any day can be opened), each with **Breakfast, Lunch, Dinner and Snacks**, and **as many foods under each as you like**. A day card shows `2 of 4 foods eaten · 1 of 4 meals done`, a progress bar, and `1,123 kcal planned · 276 kcal eaten`.

Every food is one row:

```
[ ]  Overnight oats   To prep
     284 kcal · P 24 g · C 38 g · F 4 g est. · 1 serving
     [ Replace ]  [ Edit ]  [ Remove ]
     Details  v          (ingredients for the portion, prep time, Move, Mark prepped)
```

### Checking foods off

* The **checkbox** means "I ate this". A checked food looks completed (struck through, green edge) and counts in the day's and the meal's progress ("1 of 1 eaten").
* It is **saved the moment you tick it**. Reload the page and the ticks are still there.
* Checking a food **adds one line to Today's food log** (so it is in History too) with the numbers it had, uses a **prepared portion** if you cooked ahead (otherwise the recipe's ingredients come out of the pantry estimate), and ticks the *Eat breakfast* habit for a breakfast. **Unchecking takes all of that back.**
* **No duplicates.** The plan remembers which log line it made (`loggedItems`). Checking an already-checked food, a double tap, a reload or the old *Mark as eaten* button on the Groceries tab (it now goes through the same check) never adds a second line.
* A day that **hasn't happened yet** can't be checked off (the box is disabled). Foods **with no numbers** can still be checked off; they go into the log by name with 0 calories (nothing is invented) and are listed as "without numbers" in the day total.
* **Check off every food / Uncheck every food** for a whole meal is in that meal's **More** menu.
* The numbers of a food you ate are **frozen for that day**. Editing the recipe later does not change them or your food log.

### Planned and eaten are separate

Each food shows calories, protein, carbs and fat when it has them (**est.** when some are estimates). The day card and the **Nutrition overview** show **planned** (everything on the plan) and **eaten** (only the foods you have checked off) next to each other, for calories, protein, carbs and fat, and in the seven-day chart (with a table view). It states differences in plain numbers ("eaten is 123 kcal less than planned"), never calls a day "over", and if your Today log has more than the plan's checked foods it says so ("Your Today food log shows 400 kcal… it also includes foods you added there yourself"). A plan far under your calorie target suggests adding food, not removing it.

### Add a food

**+ Add food** (on a meal, or at the top) opens one sheet:

* **Search my foods**: your saved foods (the Foods tab list), your recipes, and your saved meals, in one searchable list.
* **New food**: name, serving, calories, protein, carbs, fat (all but the name optional; nothing is guessed). *Save it to my foods* is on by default, so next week it is one search away. The same name and serving is never saved twice.
* Choose the **meal**, the **day**, and **how much** (servings), then **Repeat**:

| Repeat | What it makes |
|---|---|
| Just this day | one food on that day |
| Selected days of this week only | one copy per chosen day, tied together (Remove can take them all away; Undo reverses them all) |
| Selected days every week | **one repeating food** on the chosen weekdays, starting on the day you picked |
| Every day, every week | one repeating food on all seven days |

**A repeating food carries into next week by itself** (and the week after), with no copying, until you change or remove it. Foods planned for one day don't carry. **Copy last week** (top of the plan) puts last week's one-day foods on this week (same weekday); anything already there (same meal, day and food) is left alone, so pressing it twice adds nothing.

### Replace: what you actually ate

**Replace** is beside every food. Pick what you ate instead (search saved foods, recipes, or **New food**), set how much, and:

* **I ate this** (on by default for today and past days) checks the replacement off. Nutrition totals and Today's log then show what you actually ate: if the original was already checked, its log line is replaced, not added to.
* For a **repeating** food choose **Just this day** (the series skips the day and a one-day food takes its place) or **This day and every week after** (the old food ends the day before, the new one starts that day). Earlier days, and what was eaten on them, keep the old food.
* **Undo** puts back the plan *and* the log line.

**Edit** changes a food's name, serving and numbers (your own foods), the portion, the meal, or marks it *eating out*; a checked food's log line follows the edit. **Remove** takes a food off one day (a repeating food: just that day, or this day and every week after). A repeated set can be removed together. **Removing a food you already checked leaves its line in your food log**: you ate it.

### Whole meals

A meal's **More** menu: **Add a saved meal**, **Save this meal** (a name for the foods in it, e.g. *My usual breakfast*, kept with their numbers so later recipe or saved-food changes don't break it), **Repeat this meal** (to other days of this week, on chosen days every week, or every day), **Check off / uncheck every food**, **Remove all foods** (Undo), and **Manage saved meals** (delete one you no longer use, with Undo; days you already added it to are not changed).

### Also in the plan

* **Move**: drag a food onto another day (a long press on a phone), or *Details ▸ Move to another day*. One day of a repeating food moves on its own.
* A food **eating out** needs no shopping or prep; a food **marked prepped** needs no shopping. A recipe food is *Prepped* when a batch of it with portions left (and still good) covers that day.
* **Training days** (from your Workout routine schedule) are marked, with a note to plan protein and carbs around them. Nothing limits how much you eat.
* **Ideas** (suggestions, not rules): foods for empty slots from your own recipes, recipes that are good for recovery (at least 25 g protein and 30 g carbs a serving), and recipes you can cook with what is in your pantry.

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
| **Health overview** | A *Meal prep* card: foods eaten today, planned and eaten calories, protein, the next prep session, prepared portions. |
| **Today / History (Nutrition)** | Checking a food adds its line to the food log; unchecking removes it. |
| **Calendar and Day plan** | Prep sessions are Calendar events (Health category). |
| **Habits** | The three meal habits above. |
| **Workout** | Training days on the week plan, from your routines. |

## What is stored

| | |
|---|---|
| `jarvisNutritionRecipes` | recipes: now with optional `cats`, `favorite`, `prepMin`, `cookMin`, `storage`, `image`, `updatedAt`, and per ingredient `state` and `est`. A recipe saved before is read as it was. The older Foods form keeps these fields when you edit there. |
| `jarvisGroceryMealPlan` | the week plan. **Each entry is one food** under a meal: `{ id, type: "single" \| "recurring", date, days[0-6 Sun=0], meal, recipeId \| null, recipeName, servings, isRestaurant, includeInGroceries, completedDates[] }` plus optional `serving`, `foodId` (a saved food), `macros` (per serving, for a food that isn't a recipe), `skipDates`, `preppedDates`, `frozen` (numbers as eaten, by date), `loggedItems` (the food-log line each checked day made), `fromBatch`, `group`, `from` / `until` (the dates a repeating food applies; a replace "from this day on" ends the old entry the day before and starts a new one), `updatedAt`. A plan saved before is read as it was. |
| `jarvisMealPrepMeals` | saved meals: `{ id, name, meal, foods[], createdAt, updatedAt }` (removed ones are marked, 30 days). Each food is a copy with its numbers. |
| `jarvisNutritionSavedFoods` | the Foods tab's saved foods. Meal Prep reads it, and saves a New food to it (same name and serving is not saved twice). |
| `jarvisMealPrepBatches` | `{ id, recipeId, name, preparedOn, portions, remaining, place, useBy, reheat, per, notes, eaten[] }` (removed ones are marked, 30 days, so a delete reaches other devices) |
| `jarvisMealPrepSessions` | `{ id, kind, title, date, time, durationMin, recipeIds, remind, eventId, taskId, doneAt }` |
| Calendar event | an ordinary event with `linked: { type: "mealprep", id }`. Tasks made from a session carry `mealPrepId`. |

## Limits worth knowing

* The typical values are approximate and cover about 50 foods. The calculator and "Estimate" need weights (g, oz, lb) or pieces/spoons for foods the list knows. For anything else type the numbers.
* A planned food needs a recipe to add groceries; a food with your own numbers counts toward nutrition but adds nothing to the list.
* **Eaten means checked.** The overview no longer compares the plan with the whole food log: it compares it with the foods you checked off, and notes when the log has more.
* Editing or replacing a repeating food "from this day on" keeps the earlier part as its own entry, so it will show as two entries if you look at the raw data.
* Prepared portions cover planned meals of the *same recipe* only.
* A meal removed from the plan on one device can come back from another device that still had it (as with the rest of the backup).
* Pantry amounts are estimates (what you bought, minus what you cooked or ate) and can be corrected any time in the Grocery List or Groceries.
* The Groceries tab is unchanged and still has the shopping-day setup, regularly eaten foods and amounts. Both screens edit the same data.
* Tested in Chromium (desktop and phone sizes); not on a real iPhone.

## Where the code is

`js/mealprep-logic.js` (pure rules; tests `functions/test/mealprep-logic.test.js`) · `js/mealprep-foods.js` (typical values) · `js/mealprep-ui.js` (shell, overview, saving, Undo) · `js/mealprep-plan-ui.js` (rows, check-off, add / replace / edit, saved meals), `-recipes-ui.js`, `-grocery-ui.js`, `-tracker-ui.js` (the four tabs) · `js/nutrition.js` (recipe, food-log and saved-foods API) · `js/groceries.js` (plan, list and pantry API; prepared meals) · `js/habits.js` (`addHabit`) · `js/calendar-ui.js` (one row per session) · `js/health-overview-ui.js` (the card).
