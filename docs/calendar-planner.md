# Calendar and Daily Planner (one planner)

The Calendar is now also the daily and weekly planner. It answers *what am I doing, hour by hour, today and this week?* with the
things you already keep in JARVIS, not a second set of data.

```
Planning > Calendar      [ Day | Week | Month ]        + Add  (a floating + on a phone)
  Day    the daily planner: Top 3, a timeline with free time, tasks still to schedule, notes, reflection
  Week   Monday to Sunday; a day strip on a phone, seven columns with each day's top three on a wide screen
  Month  the traditional calendar (unchanged)
Planning > Strategy > Weekly   long-term direction: Weekly Intentions, top three for the week, review (no time-blocking grid)
```

## One system, no copies

| What you see | Where it lives | Notes |
|---|---|---|
| Tasks (checkbox, priority, day, optional time) | `jarvisTasks` (Habits' To-Do list) | A task made in the Calendar is the To-Do list's own task. Ticking it anywhere ticks it everywhere. |
| Time blocks (start, end, category, repeat) | `jarvisPlanBlocks`, categories in `jarvisPlanIngredients` | The same blocks and categories the Strategy weekly planner used. Nothing was copied, converted or deleted. |
| A block that holds a task | the block, with `taskId` | Shown once, with the task's words and tick. Moving it moves the task's day and time; ticking either ticks both. |
| Events and appointments | `jarvisCalendarEvents` | Unchanged. |
| Top 3 for a day, notes, end-of-day reflection | `jarvisPlanDays` (`pd_<date>`) | The only new data. A top-3 slot is a **reference to a real task**, so ticking it ticks the task. Backed up and merged by record like the other plan data. |
| Free time | worked out, never saved | The stretches of your day (default 6 AM to 10 PM) that nothing takes up. |
| Which folds are open (Daily plan, Habits, weekly reference) | `jarvisCalPlannerUi` | This device only. |

## Day (the main workspace)

Open the Calendar and pick **Day**. From the top:

1. **Daily plan** (folded to one line on a phone, open beside the schedule on a computer). Tap it to open:
   * **Top 3**: type a priority (it becomes a task for that day in your To-Do list) or tap **Pick** to choose one of that day's open tasks.
     Tick it, tap its words to edit the task, or **×** to take it out of the three (the task stays).
   * **Still to schedule**: that day's tasks that have no time yet. **Schedule** opens the block form at the first free stretch long enough
     for the task (your estimate if you gave one, otherwise an hour).
   * **Notes for the day** and **End-of-day reflection**: saved as you type, when you leave the box, and when the page is hidden.
   * **From your weekly plan** (only if you have something there): the week's top three and your Weekly Intentions, read-only and optional.
2. **One line of numbers**: how many things are scheduled and how much free time is left (for today, from now). A day that holds more than
   your daily limit says so.
3. **All-day items** (events and goal dates) and, for today, a **Habits** row (done of total; tap it to open the day's habit chips). Habits have
   no time of day in JARVIS, so they are not placed on the timeline. A habit with a daily count is stepped on the Habits screen.
4. **The timeline**, in time order, each row with start time, end time, title, category and a tick. Between rows, **Free · 1 h 30 min**:
   tap it to add a task, a time block or an event starting right there. A red *Now* line sits where you are (today).

**Hours** (top right) shows the same day hour by hour, where you can drag blocks and events to another time and drag the bottom edge to
change the length (15-minute steps). **List** takes you back.

The day arrows and **Today** move between days; the shortcuts `t`, `d`, `w`, `m`, `n`, `j`, `k` still work.

## Time blocking

* **+ Add** (or the floating + on a phone) offers **Task**, **Time block** or **Event**. Tapping a free stretch or an empty slot in the
  hour-by-hour grid starts one at that time.
* **Time block**: title, category, start and end on any quarter hour, **length chips** (15 / 30 / 45 min, 1 h, 1.5 h, 2 h) or a number of
  minutes, notes, repeat (daily, or weekly on chosen days, until a date), a task to put in it, and for each day the time you actually worked and *Done*. Edit or delete it
  by tapping it; for a repeating block you choose *this day only* or *every time*.
* **Task**: what, day, optional start time and **length** (a length makes it a block on the timeline; "just a time" does not), category, priority. Editing and
  **Delete this task** (with Undo) live in the same form.
* Move or resize by dragging in **Hours** and **Week** on a computer, or edit the times in the form. (There is no drag in the Day list.)
* Tick a block to mark it done (a block with a task ticks the task). Free time is counted without double-counting overlaps.
* Time block categories and the planner hours (day start/end, daily limit) are in the **⋯** menu.

## Week

* **Phone**: a strip of the seven days (with a count of what is on each); tap one and its plan appears below: top 3, tasks still to schedule,
  all-day items and the timeline. **Open day** goes to the full Day planner. The floating + adds to the selected day.
* **Computer**: the seven columns by hour, with each day's top three under its name; tapping a day opens it in Day. Drag and resize blocks and events right in the grid.

## Strategy

Strategy › Weekly keeps Weekly Intentions, the week at a glance, the week's top three (and *Why?*), the numbers, and the weekly review. The
grid, category palette, day summary, suggested times and the *Add block* button are gone from there; **Plan time in Calendar** takes you to the
Calendar's week. The other Strategy screens that used to jump to the weekly grid (a task's *Schedule*, the dashboard's *Add block*) now open the block form in place.

What did not move one-for-one: the old "capacity" and "high priority, not scheduled" warnings are replaced by the over-the-limit note on the Day screen and the
*Still to schedule* list (high priority tasks are marked). The old *Schedule all suggestions* button is gone; *Schedule* on each task and the ⋯ › Planning assistant remain.

## What was not verified

All browser testing was in Chromium (320, 390, 768 and 1200 px wide, with a fake clock). It has not been run on a real iPhone or in Safari.
Drag and drop is tested with mouse pointer events; press-and-hold dragging on a touch screen is not tested on a device.
On a 320 px phone the seven day buttons in the Week strip are about 41 px wide and 64 px tall.

## Where the code is

`js/day-planner-logic.js` (pure rules: the day record, timeline, free time; tests in `functions/test/day-planner-logic.test.js`),
`js/calendar-planner-ui.js` (the Day and Week screens, Add menu, task form), `js/calendar-ui.js` (the Calendar itself, now also reading and writing blocks),
`js/plan-week-logic.js` / `js/plan-week-ui.js` (the block rules and the block, category and top-three forms the Calendar opens).
