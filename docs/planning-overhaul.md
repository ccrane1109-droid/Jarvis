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
* Free time is the Day planner's number (the free stretches of at least 15 minutes left in your day window, minus planned items). A task or habit with a time counts as a short placeholder slot (30 minutes) because neither has a length of its own.

### Add and Search (`planning-quick-ui.js`)

* **Add** offers Task, Event, Time block, Habit, Goal and Milestone, with the thing you are looking at first and today's date filled in. Each choice opens the form that already creates that kind of thing; nothing is copied.
* **Search** finds tasks, events, habits, time blocks and goals by name. A result opens the real record: the task form, the event popup, the habit form, the block form, the goal detail.

### Focus timer (`focus-logic.js`, `focus-ui.js`)

* Start from any task, habit or time block: *2-minute start*, 15, 25, 50, a custom length, or no timer. A bar stays at the bottom of the screen with *Pause / Resume*, *+5 min* once the time is up, and *Finish*; a break can follow.
* **Time comes from timestamps**, so a refresh or a closed page loses nothing, paused time is not work, and a break is never counted as work. A session under one second is not recorded; finishing twice cannot record twice.
* The running session is device-only (`jarvisFocusActive`); each finished session is one record in `jarvisFocusLog` (synced, merged by id) with its task and habit ids, for the planned-vs-actual figures planned for Phase 5.


## Phase 2c — Calendar Day, Week and Month

* **Day (list) and the day panel in Week** now read in parts of the day (Morning before 12:00, Afternoon to 16:59, Evening from 17:00). The next open thing is marked **Now** or **Up next**. **Done things fold away** behind "Show done (N)" (one tap to open; a past day shows what happened, done ones folded). Free stretches between things and the line for "now" are unchanged. Ticking a row that moves into the done list leaves focus on that list's button, so focus is never lost.
* **Rows show their length** ("1 h", "15 min") for timed events and time blocks. A task or habit has no stored length, so none is shown.
* **Week at a glance** (above the week): one line (busiest day, the day with most free time, overlaps, deadlines, tasks that still have no time), and a day-by-day breakdown behind a button. Every figure is counted from what is on the Calendar. *Planned* is time taken inside your planner hours by events, time blocks and timed tasks; habits take no time. A deadline, or a task that stands for a habit, is not counted as "no time yet".
* **Week agenda**: the Hours/List button also works in Week. *Agenda* lists the seven days one under the other (any width); *Grid* (wide) or *Days* (phone) goes back.
* **Month** already shows event names, the "+N more", a dot per item and, on tap, a preview of that day below the grid; this was checked, not rebuilt.
* **Accessibility fixes in the Calendar** (found by axe with the stricter WCAG 2.1 label-in-name rule; the stricter rule had not been run on the Calendar before): a control's accessible name now begins with the words it shows (rows, chips, event blocks, week day buttons, free-time rows, Pick, Schedule, Add to day, the Agenda/Hours button), spans in a row are separated by spaces so they are read as words, and today's date mark uses a darker blue for contrast.

**Verified** (Chromium, 390 px unless noted): Calendar test (48 checks: parts, up next, done fold, focus after a tick, durations, glance, agenda toggle at 390 and 1200 px, Month); the earlier Calendar flows (106), Phase 1 (47), Habits (39), Overview (63), Meal Prep (72 + 10) and the overdue suite (21); 1118 unit tests; axe clean on Day, Week (glance closed and open, agenda, grid) and Month at 320, 390, 768 and 1200 px.

**Not done in 2c** (left for the phases named): drag-and-drop between days was not changed (it is the existing drag on the grid); a task's day and time are changed in its form or, from the Overview, with Reschedule (later today, tomorrow). Overlap, overload and scheduling-opportunity suggestions that need approval belong to the Phase 3 assistant. The Calendar still has its floating "+" button on a phone.

## Day planner: everything in sight, overlaps flagged (follow-up)

* **Habits are always in view.** A habit with a time is a row in the schedule, in time order. The habits with **no set time** (and the "a few days a week" ones, with their week count) are listed under *Habits with no set time*, open by default, on **every** day (before, only today, folded). Today and past days can be ticked there; a future day only lists them. The phone Week view's day panel shows the same list.
* **Tasks with no time** are listed by name ("No time yet: …, +N more") above the schedule when the Daily plan is folded (a phone); on a wide screen they are already in the open Daily plan, so they are not repeated.
* **Overlaps are flagged for everything**, with what they overlap ("Overlaps Team call"), in the Day list, the Week views, the Hours grid, the day summary ("3 things overlap each other") and the Overview's Heads up. New: a task or habit with a time that **starts inside** an event or time block, and two tasks or habits **starting at the same minute**. Only the start of a task or habit is tested, because neither has a length of its own; nothing is guessed about how long it takes. Done things never overlap.
* **Free stretches no longer start on top of a habit.** A habit with a time takes the same short placeholder slot a timed task already did (30 minutes), so "Free" does not begin at the habit's own minute. The planning assistant (Plan my day, Find a time, ...) uses the same rule, so it does not propose something on top of a habit.
* Verified (Chromium, 390 and 1200 px): 34 browser checks for this (overlap flags and wording, habits with and without a time on today, a past day and a future day, ticking, free stretches, the untimed list on a phone and not on a wide screen, same-minute overlaps, Heads up, Plan my day avoiding habit and event times), unit tests for the free-time slot and the assistant, axe clean at 320 to 1200 px. Not tried on a real iPhone.

## Phase 3 — Intelligent planning (written rules, never an AI)

Everything here is a set of written rules: nothing is sent anywhere, the same data gives the same answer, every suggestion carries its reason, and nothing changes until you accept it.

* **One ranking, used everywhere.** The Strategy engine (`plan-insights-logic.js`, `rankTasks`) now also knows a task's **kind** (strategic, school, business, personal, routine, leisure, rest), taken only from the words in the category you gave it, from a habit link, or from a link to your plan; no category means no kind, not a guess. **Rest and leisure tasks are not ranked** (and the assistant leaves them alone), and **a habit's own task is not ranked as a task**. Ties are settled the same way every time: earlier day, then higher priority, then shorter estimate, then your own order, then age, then id. A task with no goal link, no deadline, no lateness, no estimate and only the usual priority says **"Not enough information to rank it"**. Each ranked task has a short reason and a **Why?** (kind, every reason with its points, the total, how ties are settled). Strategy's top three, Home, the Weekly view and the Overview all read this one ranking.
* **Overview suggestions**: *Suggest tasks* opens today's best-ranked open tasks with their short reason and a *Why?*; *Use* puts one in the first empty top-three slot. You can always choose any task yourself. With nothing on the clock, *Up next* offers the best-ranked task that has no time, with its reason.
* **Heads up** (Overview, Balanced and Advanced; shown only when there is something): overlaps today, a day over your workload limit, tasks with no time yet, a deadline due today or tomorrow, things from earlier today still open. Each line goes to the assistant or to the item; it changes nothing.
* **Planning assistant** (Calendar ⋯ › Planning assistant) gets two more actions in the same preview, tick-to-accept, apply and **Undo** flow it already used for plan my week, fix clashes, catch up, focus time, find a time and split a project:
  * **Plan my day** gives today's open, untimed tasks the earliest free stretch long enough for each (its estimate, else 30 minutes), most important first. It only gives a task a time on its own day. Deadlines, habit tasks, rest and leisure tasks and tasks that already have a time are left alone.
  * **Simplify my day**, when you have more open tasks today than your daily limit (Planning hours › tasks a day), offers a later day with room for the least important movable ones. Deadlines, timed tasks and protected kinds stay put. If nothing fits it says so.
* **Routines** (Calendar ⋯ › Routines, or Add › Routine): reusable sequences with a name, a kind (school morning, weekend morning, evening, after school, Sunday reset, business work, custom), a start time and steps (name, minutes, gap before it, optional linked habit). *Add a starter* adds an editable example. **Apply** to chosen weekdays for 7, 14 or 28 days shows what it would add and what is already there, then puts ordinary time blocks on the Calendar; a step already planned (same title and start) is skipped, and a step linked to a habit makes no block (the habit has its own time). Apply can be undone. A routine remembers the blocks it made, so after you edit it, **Update future days** replaces its blocks on days from today on (days that have passed are never touched, and you confirm first); **Remove future days**, **Pause** (not applied or updated; what it already placed stays), **Duplicate** and **Delete** (blocks already placed stay) are in its ⋯ menu. A step must be at least 15 minutes because a time block is.

**Verified**: 1136 unit tests (ranking kinds, protected time, "not enough information", ties and Why?; Heads up; routine rules; plan my day and simplify my day); browser tests at 390 px: Overview (73), Routines (43: starter, apply, no duplicates, habit step, undo, update future days, remove, pause, duplicate, delete, step editing, quick add), assistant (25: preview before apply, per-item untick, apply, undo, light day); every earlier suite still passes; axe clean on the routine sheets and menus, the suggestion sheet with Why? open, the assistant home and review, at 320, 390, 768 and 1200 px.

**Not done in Phase 3**: *deferral* and *dependencies* are not ranking factors, because JARVIS does not record how often a task was pushed back or what blocks what, and inventing either would be a guess; the "suggest the next task" action is the Overview's Up next / Suggest tasks rather than an assistant button; a routine is applied to dates (it does not repeat by itself); overlap/overload detection for events and time blocks is the Calendar's existing rule (the daily limit in Planning hours) and the new Heads up line. Business-metric and school-schedule awareness in the ranking comes only from the category words described above.

## Phases 4 and 5 — what was added, and what was only checked

**Added**

* **"I'm avoiding it"** (Habits › Today, the Discipline flow) now offers eight obstacle choices: the six that were there plus **"I don't know where to start"** and **"I need information first"**, each with its own fixed-wording next step and a rule you can adopt. It still only advises and logs: it creates no task. The 30-day program and its content are unchanged.
* **The two-minute start is a focus session.** When a Discipline timer run ends (Stop, "Enough for now", "I finished it", or "10 more minutes") the time actually worked (never more than the run's length) is added to the focus log, so it counts in the same totals as sessions started from the planner.
* **Start a focus session from a task**: the Overview's *Up next*, and *Start a focus session* inside a task's own form (Calendar). A running session is kept on the device and is still running after a refresh; paused time is not counted.
* **Focus time in numbers**: the Overview shows "Focused today: 35 min in 2 sessions" only when there is some, and Strategy › Insights › Execution shows focus-timer time for this week and the last 8 weeks. It is **kept apart from "Worked"** (hours logged on blocks and workouts), so the same time is never counted twice.
* **Quick reflection questions** in the Day plan: *Went well*, *Got in the way* and *One change for tomorrow* put their words into the day's reflection box for you to finish (about two minutes). They are saved in the day's own record; nothing is decided for you.

**Checked, not rebuilt.** These were already in Strategy and the Day plan before this overhaul, and their existing tests still pass. They were not re-audited line by line against every sub-point of the request: the yearly › quarterly › monthly › weekly › daily structure and the review, the guided goal breakdown and templates, the multi-year roadmap with a chosen start year, weekly intentions (things to do, things to stop, with notes) and the weekly review. See `strategic-planning.md` and `weekly-intentions.md`.

**Not done** (so nothing here should be assumed):

* Analytics that need data JARVIS does not record: *estimated vs actual duration per task*, *frequently rescheduled tasks* and *deferral* (nothing stores how often a task was moved), and any *productivity score*.
* *Suggestions from history* in reflections; a weekly summary that goes beyond the existing weekly review.
* Moving a task between days by dragging on a phone (the existing drag is unchanged); the alternatives are the task's form and the Overview's Reschedule.
* The "Hours" and "worked time" figures of habits (a habit has no stored length).
* Visual polish beyond what is listed above: typography, button and checkbox styles were not unified across all of JARVIS; only the new and touched Planning screens follow one style. The Calendar keeps its floating "+" on a phone; the page reserves space under the last row so it does not cover content.

## Data safety and migration

* No existing record was rewritten. New fields are optional and ignored by older code: `task.habitId` and `task.separate[]` (links), a habit's `skips`, `pauses` and `archivedAt`, and the new stores `jarvisPlanOverview` (layout; synced, newest wins), `jarvisPlanRoutines` (synced, merged by id) and `jarvisFocusLog` (synced, merged by id). `jarvisFocusActive` and the safety snapshot `jarvisPlanSnapshot` stay on the device.
* A snapshot of tasks, habits and the planner's records is taken before the first link change, so the earlier state can be put back.
* Backup and restore cover every new synced key (`backup-logic.js`, with a test that fails if a new key is left out).
* Duplicates are only ever *offered* for review; nothing is merged or deleted without a button press, and applying or updating a routine can be undone.

## Verified (final)

* **Unit tests: 1136 pass** (`cd functions && npm test`).
* **Browser tests** (headless Chromium, 390 px, touch, New York time, fixed clock): links and duplicates 47; Habits 39; Overview 73; Calendar 48; Routines 43; assistant 25; focus, Discipline and reflection 27; plus the earlier Calendar flows (106), overdue tasks (21), Meal Prep (72, 60, 89, 123, 10), Scanner (135, 49) and a 20-screen smoke test at 390 and 1200 px.
* **axe** (WCAG 2.0/2.1 A and AA plus best practice) is clean on the Overview in every layout, the Calendar Day, Week (glance, agenda, grid) and Month, the routine sheets and menus, the suggestion sheet and the assistant, at 320, 390, 768 and 1200 px, with no horizontal overflow.

## Not verified

* **Nothing was tried on a real iPhone or in Safari.** Everything above is Chromium with touch emulation. Safe-area spacing, the bottom focus bar above the tab bar, scrolling and the on-screen keyboard still need a look on the device.
* Haptics use `navigator.vibrate`, which iOS Safari does not provide.
* The focus timer is drawn from timestamps when the app is open; it sends no notification when time is up while the app is closed.
* Time-zone and daylight-saving behaviour is covered by the existing calendar rules and fixed-clock tests in New York time; a change of time zone mid-session was not tested.

## Verified (Phases 1 to 2b)

* Unit tests (`cd functions && npm test`): 1118 pass, including the link/duplicate rules, habit schedule rules, focus arithmetic and Overview rules.
* Browser tests in headless Chromium at 390 px (touch, New York time, a fixed clock): Phase 1 (47 checks), Habits (39), Overview (63), plus the earlier Calendar/Day-planner suite (106) and the overdue-task suite (21).
* axe (WCAG 2.0/2.1 A and AA plus best practice) is clean on the Overview in all layouts, the menus and sheets it opens, and the running focus bar, at 320, 390, 768 and 1200 px, with no horizontal overflow.

## Not verified / limits

* Not tried on a real iPhone or in Safari. Layout, the touch targets (44 px minimum in the CSS) and the bottom focus bar were checked only in Chromium's emulation.
* Haptics on time's up use `navigator.vibrate`, which iOS Safari does not provide; nothing else signals it there except the bar and a screen-reader announcement.
* The focus timer does not run in the background: the bar is drawn from timestamps when the page is open, but no notification is sent when time is up while the app is closed.
* A habit has no stored length, so habits show no duration; one with a time counts as a 30-minute placeholder slot in free time.
* Habit rows on the Overview move *for one day only*; changing a habit's usual time stays in Habits.
* Phases 2c (Calendar views), 3 (priority engine, assistant, routines), 4 (Strategy) and 5 (analytics, reflections) are not done yet; see the status at the bottom of this file once they are.
