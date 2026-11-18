# Simpler JARVIS: Workout, Nutrition, Habits, Calendar and Strategy

Six sections were reorganised so that the daily thing is on the first screen and the rest is one tap away.
**Discipline is now part of Habits**, so there are five tabs in the app for these six sections.
*(Since this was written, Workout and Nutrition sit under **Health**, and Calendar, Habits and Strategy under **Planning**; see [navigation.md](navigation.md). The screens themselves are as described here.)*
No stored data was changed or removed, and no storage key was added (see "Your data" at the end).

```
Workout     Today | Routines | Progress
Nutrition   Today | Foods | History | Groceries
Habits      Today | Routines | Progress        (Discipline lives here now)
Calendar    Today | Week | Month
Strategy    Overview | Goals | Weekly
```

## Rules used everywhere

- Three or four tabs, and the tab bar never scrolls sideways (checked at 320, 390, 768 and 1200 px wide).
- One obvious main button per screen: Start Workout, Log Food, + Add, + New routine, + Add habit.
- Less common things sit behind a **⋯** button (a small menu) or a folded section. Nothing was deleted to get there.
- No panel subtitles, no long explanations, no empty "No data yet" boxes. An empty list says one short thing.
- Cards, borders and gaps were reduced: lists are flat rows. The dark theme and blue accents are unchanged.
- Text is at least 12 px and buttons are at least 44 px tall where they are tapped.

## Workout

| Tab | What is on it |
|---|---|
| **Today** | The routine scheduled for today (or the one you used last), the *Start Workout* button, and *Choose a different workout*. Underneath: your last workout. A workout in progress shows *Resume workout*. |
| **Routines** | A flat list: name, size, days, when last used. Each row has *Start* and a ⋯ menu (Edit routine, Duplicate, Change days, Delete, Archive). *+ New routine* at the top. The ⋯ at the top has Exercise library, Programs, and Build a routine for me. The weekly schedule is a folded section. |
| **Progress** | Strength, History and Form check as three small switches. Everything that was on Progress (records, volume, charts, muscles, body measurements, "what I noticed") is still there. |

*Choose a different workout* lists your routines, the next day of each program, *Repeat last workout* and *Empty workout*,
so the repeated Empty / Start / Repeat buttons are no longer on the first screen.

## Nutrition

| Tab | What is on it |
|---|---|
| **Today** | Calories with protein, carbs, fat and fiber in one line; water (− and + Cup); one *+ Log Food* button; today's meals. A target or "remaining" figure only appears once you have set targets. ⋯ has Scan a label, Log a recipe, Targets and goals, Nutrient detail. |
| **Foods** | One library: foods and recipes, with search, sort, and All / Foods / Recipes chips. *+ Add* offers Saved food or Recipe. A *Log again* row shows the foods you log most; one tap logs it again into the meal that fits the time of day. |
| **History** | Averages (7 or 30 days), calorie and protein trends, past days and a day's detail. The *Nutrients* switch holds the detailed nutrient list. The nutrition score is folded. |
| **Groceries** | The grocery list with *+ Add recipe*, and an item form. Meal plan, Regularly eaten foods, Pantry and Groceries setup are folded sections. |

## Habits and Discipline (one section)

| Tab | What is on it |
|---|---|
| **Today** | The day (one row of seven day buttons for both Habits and Discipline), the day's main win, *Next up*, your habits with a quick tick, to-do tasks with *+ Add Task*, and the end-of-day reflection. |
| **Routines** | Your habits (*+ Add habit*, Edit, Delete), then *Morning and evening* (morning plan time, evening review time, personal rules) and *Programs* (the optional 30-day discipline program with its lesson and missions). |
| **Progress** | *Consistency* (the week of habits, recent days, daily review numbers, more insights, productivity numbers, weekly review) and *Goals*. |
| **⋯ (top right)** | Day planner, Goals, Reminders, Wake check, 30-day program, Discipline settings. |

Habits and Discipline used to show a streak, a progress card and a check-in each. There is now one habit list, one
streak (shown from two days) and one place to check in. The old Discipline screens kept their names inside the code and
their data is untouched.

## Calendar

| Tab | What is on it |
|---|---|
| **Today** | Events and tasks in time order as a list, with a tick on tasks so you can complete them in place. One *+ Add*. |
| **Week** | On a phone, the seven days as a list (a day with nothing on it says so); on a wider screen, the week grid. |
| **Month** | The month with its events. |
| **⋯** | Search and filters, Planning assistant, *Show Today hour by hour* / *as a list*, *Next 30 days* (the old agenda), Calendar settings, Keyboard shortcuts. |

The 30-day range is no longer in the header. Recurring events, time blocks and scheduling work as before.
A habit or plan item that is already on the calendar is not added a second time.

## Strategy

| Tab | What is on it |
|---|---|
| **Overview** | The three-year vision in one small block, your top three goals, the most important open milestones, and what to focus on next. *More numbers* opens Insights. Suggestions that need your approval sit at the top, folded on a phone. |
| **Goals** | Year, Quarter and Month as three expandable sections. Each is the same screen it always was (objectives, priorities, milestones, money, linked tasks), so the hierarchy is kept. |
| **Weekly** | This week's priorities, tasks tied to larger goals, the time-block planner, and the end-of-week review. |

## Where the old screens went

| Before | Now |
|---|---|
| Workout Home, Workout, History | Workout **Today**, the live workout (Start Workout), **Progress › History** |
| Workout Programs, Exercises | Routines ⋯ › Programs, Routines ⋯ › Exercise library |
| Workout Form Check | Progress › Form check |
| Nutrition Food Log, Saved, Recipes | **Foods** |
| Nutrition Goals, Nutrients | Today ⋯ › Targets and goals, Today ⋯ › Nutrient detail |
| Habits Week, Stats | **Progress › Consistency** |
| Habits Plan, Wake, Reminders, Goals | Habits ⋯ menu |
| Discipline tab: Today, Trends, Program, Setup | Habits Today, Habits Progress, Routines › Programs, Routines › Morning and evening |
| Calendar Month / Week / Day / Agenda | Today / Week / Month; Agenda is *Next 30 days* in ⋯ |
| Strategy Yearly, Quarterly, Monthly | **Goals** (three sections) |
| Strategy Insights | Overview › More numbers |
| Strategy overview tiles and "Getting started" list | Overview (short blocks); one *next step* line while the plan is empty |

## Your data

The screens changed; the storage did not. No storage key was added, and the logic and store files for workouts, nutrition,
habits, Discipline, the calendar and the plan were not touched (only screen code, `index.html` and `style.css` changed, plus
a small shared menu, `js/menu-ui.js`).

While making this change a browser check loaded one profile with something in every key these sections read, in
the version from just before this work and in the new one:

- every stored key was identical (apart from times and generated ids that differ between any two loads);
- opening 65 screens, menus, forms and folds, at phone and desktop width, and closing them without saving changed no data
  key (the only write was the device-only unfinished-routine draft that the routine builder has always kept);
- ticking a habit, ticking a task in the calendar, adding a calendar event and starting a workout still wrote to the same
  keys, and ticking a task did not create a second task.

Those browser checks are run from outside this repository (they are not part of `npm test`).

## Things found and fixed while testing

- After the merge, Discipline's styles that kept text readable, focus rings and 44 px buttons were still aimed at the old
  Discipline panel; they now apply to Habits.
- *Next up* and the evening review's habit line did not refresh after a habit was ticked on the same screen; they do now.
- The Start Workout button had shrunk from 56 px to 44 px under a new size rule; it is 56 px again.
- After a menu choice opened a dialog, closing the dialog sent keyboard focus to the page instead of the ⋯ button; it now
  returns to the ⋯ button.
- On a wide screen the Week grid's day headers had collapsed to 20 px; fixed.
- `/` in the calendar now opens the search box even though search is behind the menu.

## What is not verified

All browser testing was in Chromium at 320, 390, 768 and 1200 px wide with a fake clock. It has not been run on a real
iPhone or in Safari. At 768 px and wider the small event chips in the Week and Month grids are about 24 px tall (tapping a
day or a list entry is easier on a touch screen). One older Nutrition check (`food-reuse-test`, "log again from Recent in
the Add Food dialog") fails the same way on the version from before this work, so it was not caused by this change.
