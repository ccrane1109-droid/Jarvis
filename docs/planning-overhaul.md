# Planning overhaul

This file is the working record of the Planning overhaul: what each phase changed, what was checked, and what is still limited. It is updated phase by phase. Nothing here is a plan for something that does not exist: a feature is listed only once it works and has a test.

## Phase 1 — One occurrence, one completion

* **A task can stand for a habit's occurrence** (`task.habitId`). The habit holds the tick (`completions[date]`), so ticking either one ticks both, and un-ticking either one un-ticks both. Future days never tick a habit. The sync lives in `habits.js` (`setTasks`, `followHabits`) and reverts both sides if saving fails.
* **Duplicates are found, never merged by themselves.** `planning-core-logic.js` compares normalised names and times. When a new task or habit looks like one already there, the form offers *Link it*, *Keep separate* or *Make it anyway*. *Review possible duplicates* (Calendar ⋯ and Habits ⋯) lists what is already there, one pair at a time, and changes nothing until a button is pressed.
* **The Calendar draws one row for one occurrence**: a time block wins over a habit row, a habit row over a task row (`unifyItems`).
* **A safety snapshot** of tasks, habits and the planner's records is taken (device only, `jarvisPlanSnapshot`) before the first structural change, so the old data can be put back.

## Phase 2a — Habits

* **Today** lists only what is scheduled for today, grouped morning / afternoon / evening / anytime. Done habits fold away. Flexible weekly habits ("3 days a week") are a separate section. Skip, pause and archive keep history; a skipped or paused day is never a miss; a future day is never a failure.
* **Consistency** (`habit-schedule-logic.js`) counts only chances that have passed, so rest days, skips, pauses and flexible weeks are treated fairly. It is `null` ("not enough yet"), never 0, when there was no chance to measure.
* **Routines** have a compact ⋯ menu and warn when the chosen days do not match the weekly target.

## Phase 2b — Overview command center, focus timer, Add, Search

### Overview (`planning-overview-ui.js`, rules in `planning-overview-logic.js`)

| Section | What it shows | Where the data comes from |
| --- | --- | --- |
| Today in numbers | Tasks done today, scheduled habits done, free time left, this week's task completion | Tasks (habit-linked tasks are counted with the habits, not twice), `getTodayDetail()` counts, the Day planner's free-time rule, the week of the Calendar's first-day setting |
| Up next | What is on now, or starts next; failing that the next task with no time | The Calendar's unified items (`JarvisCalendar.planItems`) |
| Today's top three | Your three, or "Suggest tasks" | The Day plan record (the one the Calendar's Daily plan edits); suggestions are today's open tasks ranked by the existing Strategy engine, with the top reasons |
| Rest of today | Open things in time order, tasks with no time, done things folded away | Same items; the up-next item and (when Habits is showing) habit rows are not repeated |
| Habits | Today's scheduled habits, ticked in place; counting habits step with − / + | The Habits records |
| Strategic progress | This week's priority, this month's milestone, this year's goal | Strategy (`JarvisPlanInsights.dashboard`); nothing is estimated here |
| Upcoming deadlines | Deadline tasks, goal dates, single events; a repeating event is one line with a count | Same items, next 14 days |

* **Up next** has *Start* (a focus session), *Complete* and *Reschedule*. Complete goes through the same code as ticking on the Calendar. Reschedule offers *Later today* (the next quarter hour an hour on), *Tomorrow* (tasks only) and *Pick a day and time…* (opens the real editor). A habit moves for that day only. Complete and Reschedule show an **Undo** note.
* **Layouts**: Simple (next action, top three, rest of today), Balanced (adds the numbers, habits, strategic progress), Advanced (everything, incl. deadlines), or *My own* (show/hide and reorder). The choice is saved in `jarvisPlanOverview` (synced, newest wins).
* **Nothing is invented**: a number with nothing behind it shows a dash; Up next says "Nothing else is scheduled" when that is so.
* Free time is the Day planner's number (the free stretches of at least 15 minutes left in your day window, minus planned items). Habits take no time in it because a habit has no stored length.

### Add and Search (`planning-quick-ui.js`)

* **Add** offers Task, Event, Time block, Habit, Goal and Milestone, with the thing you are looking at first and today's date filled in. Each choice opens the form that already creates that kind of thing; nothing is copied.
* **Search** finds tasks, events, habits, time blocks and goals by name. A result opens the real record: the task form, the event popup, the habit form, the block form, the goal detail.

### Focus timer (`focus-logic.js`, `focus-ui.js`)

* Start from any task, habit or time block: *2-minute start*, 15, 25, 50, a custom length, or no timer. A bar stays at the bottom of the screen with *Pause / Resume*, *+5 min* once the time is up, and *Finish*; a break can follow.
* **Time comes from timestamps**, so a refresh or a closed page loses nothing, paused time is not work, and a break is never counted as work. A session under one second is not recorded; finishing twice cannot record twice.
* The running session is device-only (`jarvisFocusActive`); each finished session is one record in `jarvisFocusLog` (synced, merged by id) with its task and habit ids, for the planned-vs-actual figures planned for Phase 5.

## Verified

* Unit tests (`cd functions && npm test`): 1118 pass, including the link/duplicate rules, habit schedule rules, focus arithmetic and Overview rules.
* Browser tests in headless Chromium at 390 px (touch, New York time, a fixed clock): Phase 1 (47 checks), Habits (39), Overview (63), plus the earlier Calendar/Day-planner suite (106) and the overdue-task suite (21).
* axe (WCAG 2.0/2.1 A and AA plus best practice) is clean on the Overview in all layouts, the menus and sheets it opens, and the running focus bar, at 320, 390, 768 and 1200 px, with no horizontal overflow.

## Not verified / limits

* Not tried on a real iPhone or in Safari. Layout, the touch targets (44 px minimum in the CSS) and the bottom focus bar were checked only in Chromium's emulation.
* Haptics on time's up use `navigator.vibrate`, which iOS Safari does not provide; nothing else signals it there except the bar and a screen-reader announcement.
* The focus timer does not run in the background: the bar is drawn from timestamps when the page is open, but no notification is sent when time is up while the app is closed.
* A habit has no stored length, so habits show no duration and take no time in "free time left".
* Habit rows on the Overview move *for one day only*; changing a habit's usual time stays in Habits.
* Phases 2c (Calendar views), 3 (priority engine, assistant, routines), 4 (Strategy) and 5 (analytics, reflections) are not done yet; see the status at the bottom of this file once they are.
