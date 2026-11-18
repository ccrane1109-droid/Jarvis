# Navigation: Health and Planning

Five screens were grouped under two sections, so the bottom bar went from six buttons to five.

```
Home | Health | Planning | Business | More
         |         |                      |
         |         |                      +-- Learning
         |         +-- Overview  Calendar  Habits  Strategy
         +-- Overview  Workout  Nutrition
```

Nothing was removed. Workout, Nutrition, Calendar, Habits and Strategy are the same screens, with the same tabs inside
them, the same data and the same buttons. They now sit under a tab bar that names the section they belong to.

## How it works

- **Bottom bar (phone, up to 900 px wide):** Home, Health, Planning, Business, More. Labels are 12 px, icons are plain
  outlines. The button of the section you are in is highlighted, also while you are inside Workout, Calendar and so on.
  *More* holds Learning; when Learning is open the *More* button is renamed *Learning*.
- **Header (wider screens):** Home, Health, Planning, Business, Learning.
- **Tab bar inside a section:** the first thing on every screen of Health and Planning. Health has *Overview, Workout,
  Nutrition*; Planning has *Overview, Calendar, Habits, Strategy*. It is the same bar on every screen of its section, so
  moving between them is one tap, and the tab you are on is highlighted. The bar does not scroll sideways at 320 px.
- **Pressing Health or Planning** opens that section's Overview. Pressed again while you are on its Overview, it scrolls
  to the top. Pressed while you are on one of the screens inside it (Workout, Calendar...), it goes back to the Overview.
- **A workout in progress** keeps the whole screen to itself as before: the tab bar is hidden while you are logging, and
  the Health Overview shows *In progress* with a *Resume workout* button.

### Taps from Home (phone)

| Screen | Before | Now |
|---|---|---|
| Workout, Nutrition, Habits, Calendar | 1 | 2 (Health or Planning, then the tab) |
| Strategy | 2 (More, Strategy) | 2 (Planning, then Strategy) |
| Business | 2 (More, Business) | 1 |
| Learning | 2 | 2 (More, Learning) |

The Overviews have buttons straight to the useful screens (for example *Routines*, *Progress*, *+ Log Food*, *Open
Habits*), so the extra tap is often not needed.

## Health › Overview

Two cards. Everything on them is read from Workout and Nutrition; nothing is stored here.

| Card | Shows | Where the numbers come from |
|---|---|---|
| **Workout** | *In progress* (name, time, sets done) with **Resume workout**, or the routine scheduled for today, *This week* (workouts) and *Last workout* (name and day). With nothing logged it says so. Buttons: **Open Workout**, *Routines*, *Progress*. | `JarvisWorkout.getSummary()`, the routine scheduled for today, and the live-workout state (`JarvisWorkoutUI.activeInfo()`) |
| **Nutrition** | Calories today (with the target, what is left or over, and a bar, only if a target is set), protein, carbs and fat (with targets if set), water in cups. With nothing logged: "Nothing logged yet today". Buttons: **+ Log Food**, *Open Nutrition*, *Foods*, *History*. | `JarvisNutrition.getToday()`, the same totals and targets the Nutrition Today screen shows |

## Planning › Overview

Three cards.

| Card | Shows | Where it comes from |
|---|---|---|
| **Upcoming** | Calendar events in the next 7 days (today's that are already over are left out), up to four, then *+N more in Calendar*. Tapping one opens it. Buttons: *+ Add event*, *Open Calendar*. | `JarvisCalendar.itemsBetween`, the list Home and the Calendar draw from |
| **Today's habits** | Your habits with what is left first, and how many are done. Tapping a habit ticks it, the same as on the Habits screen. A habit with a daily count (for example 3 cups) shows its count and opens Habits, where it is stepped up and down. | `JarvisHabits.getToday()` and `toggleToday()`; the tick goes through the same code as the Habits screen, so Discipline's *Next up* and the week view follow it |
| **Q4 priorities** (or *This year's goals* if there are no priorities for the quarter) | Up to three, each with its progress. With no progress data it says "No progress data yet" instead of 0%. Buttons: *Open Strategy*, *This week*. | `JarvisPlanApp` and `JarvisPlanInsights.dashboard`, the same numbers as Strategy |

## Old links keep working

The header buttons for Workout, Nutrition, Calendar, Habits and Strategy still exist (hidden, same ids), and everything
that used to press them still does: Home's schedule rows, reminders and notification taps, the wake check, Discipline,
the *Open Strategy* buttons, the calendar's links to Habits and Strategy. Each opens the right screen, and the bottom bar
shows its section.

## Your data

Nothing is stored differently. No storage key was added or changed, and the logic and store files were not touched. Three
small read-only/additive functions were added so the Overviews could read what the screens already know:
`JarvisNutrition.getToday()`, `JarvisHabits.getToday()` (and `toggleToday()`, which is the Habits tick), and
`JarvisWorkoutUI.activeInfo()`/`resume()`.

A browser check (run from outside this repository, so not part of `npm test`) loaded one profile with something in every
key in the version from just before this change and in the new one:

- every stored key was identical after loading;
- opening every route, tab, Overview button, the More sheet and the food form at phone and desktop width, and closing
  them without saving, changed no data key;
- a habit ticked on the Planning Overview changed exactly the keys that ticking it on the Habits screen changes;
- a workout started on the Workout screen showed *In progress* on the Health Overview, and *Resume workout* opened it.

## Things found and fixed while testing

- Home's "Today's focus" card showed lower progress than the Strategy tab for the same goals (for example 33% against
  38%) until something changed. The plan's progress is kept until a change, and the first one was worked out at page load
  before the tasks it counts had loaded. Home and the new Planning Overview now start from a fresh one.
- Two navigation landmarks had the same name (*Planning sections*); the Strategy sub-tabs are now *Strategy views*.
- White text on the Overview buttons was 3.2:1; they use the deeper blue the other sections use (4.7:1).
- The bottom bar's labels were 11 px (10 px on small phones); with five buttons instead of six they are 12 px.

## What is not verified

All browser testing was in Chromium at 320, 390, 768 and 1200 px wide with a fake clock. It has not been run on a real
iPhone or in Safari. The desktop header tabs are 37 px tall, as they were before (they are for a mouse).
