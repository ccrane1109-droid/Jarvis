# Overdue tasks: scheduled activities and deadlines

A task is one of two kinds, and only one kind can be overdue.

| Kind | Made in | Overdue? | If it isn't done |
|---|---|---|---|
| **Scheduled** (an activity you planned for a day) | the Day Planner (Calendar › Day / Week, **+ Add**, Top 3, a time block), Home's hour-by-hour schedule, **+ Today** / **Add to day** on a goal | **Never** | It stays on its own day, not done. Nothing moves it, clears it or deletes it. |
| **Deadline** (a task with a date you have to meet) | the Tasks section (Habits › Today › To-Do), and Strategy (milestone tasks, the breakdown wizard, the plan's quick add) | Yes, once its day has passed and it is not ticked | Shown as overdue on Home, in the Daily Briefing and in Strategy until you finish it, move it or delete it. |

## What this means day to day

* **Overdue** (Home's Overdue list and the "N overdue" count, the Daily Briefing, Strategy's Overdue tiles and the overdue
  points in its suggestions) only ever lists deadline tasks. A task planned in the Day Planner never appears there, even
  after its day or its time has passed.
* **A new day starts clean.** Today's Day Planner lists the tasks dated today. Yesterday's unfinished tasks are not in
  it, and **Today's focus** on Home does not carry them over. If you want one today, move it there yourself (change its date in the Calendar's task form, use **Move to Tomorrow** or
  **Duplicate to another day** in the To-Do list, or the assistant's *catch up*, which still asks before it moves anything).
* **History is kept.** An unfinished task stays on the day it was planned for. Open that day in the Calendar and its
  Day planner shows what was done (ticked) and what was missed (not ticked), with nothing deleted.
* **The Calendar keeps showing them** on their original dates, in Day, Week, Month and Agenda, after the date has passed.
* **It is automatic.** The rule reads each task as it is, so nothing has to be cleared by hand, and nothing is rewritten
  when the day changes.

## How a task knows its kind

The kind is saved on the task as `kind` (`"scheduled"` or `"deadline"`). Tasks saved before this had no `kind`. They are
**read as scheduled activities**, except an older task that is **linked to a Strategy item**, which keeps its deadline
(Strategy dates are real due dates). Their records are not changed.

In the Tasks form there is one box, **It's a deadline: show it as overdue if it isn't done by its day**. It is ticked
for a new task (the Tasks section is where deadline tasks are made). Untick it to make a scheduled activity. Editing any
older task shows its current kind, and ticking or unticking the box changes it; saving an edit without touching the box
leaves the record as it was. This is also how an older Tasks-section task is made a deadline again.

## Not changed

* Calendar **events** of the *Task* or *Milestone* kind (made in the event form) and **goal and milestone dates** are
  deadlines in their own right and are overdue as before.
* The planning assistant's *catch up on unfinished tasks* still lists every earlier unfinished task, because you start it
  and approve every move.
* The Day Planner's layout, forms and data are unchanged.

Code: `js/task-kind-logic.js` (the rule, pure; `functions/test/task-kind-logic.test.js`), used by `js/calendar-logic.js`
(`taskItems` marks scheduled tasks), `js/schedule-logic.js` (`isOverdue`), `js/plan-insights-logic.js` (Strategy's counts,
ranking and suggestions) and `js/habits.js` (the Tasks form).
