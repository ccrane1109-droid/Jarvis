# Habits in the Day planner and Calendar

Create a habit once (Habits), give it a time, and it shows up on your Day planner and Calendar on its days. Ticking it
anywhere is the same tick everywhere.

```
Day planner, Wednesday
 7:30 AM  ⟳ Stretch                          ( )     ⟳ = a habit (tasks have no mark)
          Habit
 12:00 PM ⟳ Drink water                      ( )
          Habit · 1 of 3
 3:00 PM    Call the supplier                ( )
          Task
 6:00 PM  ⟳ Lift                             ( )
          Habit
```

## What you can do

| | |
|---|---|
| **Put a habit on the planner** | Day planner → **+ Add** → **Habit** (or **+ Add habit** in *Daily plan*), pick the habit, a time, its days and the first day. Or give it a *Time in your planner* in the Habits form (Habits → Routines → + Add habit / Edit). |
| **It repeats by itself** | A habit shows on its chosen days from its first day on. Nothing is copied: the planner reads the habit. |
| **Tick it** | Tap the circle in the Day planner, Week, Month's day list, Agenda or the habit's popup. That ticks the same day in Habits. Tick it in Habits and the planner shows it at once, no refresh. |
| **A habit with a daily count** (8 cups of water) | The circle fills it to its target (or empties it). The popup has **−** and **+**. |
| **Change the time for one day** | Open the habit → *Time on this day* → **Set time**, or drag it up or down in the Day (hours) / Week grid. Only that day changes; its usual time and days stay. **Back to its usual time** and **Undo** are there. |
| **Change its usual time and days** | Open the habit → **Edit schedule** (or Habits → Edit). **Remove from planner** keeps the habit, its streak and every tick. |
| **Hide or show habits** | Calendar **⋯** menu → *Hide habits* / *Show habits*. A hidden day says "3 habits are hidden · Show habits". Remembered on this device. |

Habits are drawn in green with a small ⟳ mark. In Month a day's habits are one chip ("2/3 habits"); tap it to open the day.

## What is stored

Nothing moved and nothing was reset. Habits are still in `jarvisHabits` (backed up and merged by habit id), and a habit written
before this change reads and saves exactly as it was: name, `targetDays`, `dailyTarget`, `completions` and `createdAt`
are all kept. Four new, optional fields sit on the same record:

| Field | Meaning |
|---|---|
| `planTime` | `"HH:MM"`, its usual time. **A habit with no `planTime` is not on the planner** (every older habit reads this way). |
| `planDays` | weekdays it is planned on, `0` = Sunday. Left out on a habit done 7 days a week: then every day. |
| `planFrom` | the first day it is on the planner, so days before you added it do not suddenly show it as missed. |
| `planMoves` | `{ "YYYY-MM-DD": "HH:MM" }`, a different time on one day only. |

A tick is `completions["YYYY-MM-DD"]`, the number the Habits screen already used, written once per date: ticking twice cannot
make a second record or count it twice. Habits are **not** copied into the task list, the calendar events or the plan; the
planner works each day out from the record when it is drawn, so a habit cannot appear twice on a day and switching between
days cannot make copies.

## Rules worth knowing

* **Never overdue.** A habit that was not done stays on the day it belonged to, not ticked, so you can look back at it. It is
  not a task and never appears in Overdue. Home does not list habits (it has its own habits card).
* **The days of a "3 days a week" habit are chosen once.** Habits only ever knew *how many* days a week, not *which*, so JARVIS does
  not guess: when you put a habit done fewer than 7 days a week on the planner you tick its days (the sheet says so). A 7-day
  habit has every day ticked for you.
* **Days that have not happened can be seen but not ticked** (the same rule the Habits screen has always had).
* **Saves are checked.** If the browser refuses a save, the tick or move is taken back and the problem is shown. (This also now
  applies to ticks made on the Habits screen: before, a refused save left the habit looking done until the next reload.)
* **Two devices.** Ticks from both are kept (the larger count per day, as before). A habit this device never put on the planner
  takes the other device's schedule, so a schedule is not lost by a tick on the other device. If both devices changed the
  habit list since they last agreed, a habit you removed from the planner on one can come back from the other.

## Limits

* Dragging changes the **time** on that day only. A habit stays on its days: dropped on another day, only the time is applied
  (and the message says so). There is no "skip this day".
* Changing a habit's usual days or time also changes how its **past** days look on the planner and Calendar (the days in the
  past are drawn from the current schedule). Its ticks and streaks in Habits do not change. A tick made on a day the habit was
  not planned for still counts in Habits but is not drawn on that day of the planner.
* Habits are shown in Calendar › Day, Week, Month and Agenda, not on Home or in the planning assistant's free-time search.
* Tested in Chromium (desktop and phone sizes); not on a real iPhone.

## Where the code is

`js/habit-plan-logic.js` pure rules, no page access (unit tests: `functions/test/habit-plan-logic.test.js`, merge:
`functions/test/backup-logic.test.js`) · `js/habits.js` keeps the list, the Habits form fields, and exports `getHabits`,
`setHabitDay`, `stepHabitDay`, `planHabit`, `restoreHabitPlan`, `unplanHabit`, `moveHabitDay`; it fires `jarvis-habits-changed`
after every saved change · `js/calendar-ui.js` draws habit rows, chips and blocks, ticks, drags and the popup ·
`js/calendar-planner-ui.js` has *Add → Habit*, the schedule sheet and the hide/show choice (`jarvisCalPlannerUi.showHabits`).
