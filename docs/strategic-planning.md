# Strategic Planning Center

The **Strategy** tab joins your goals, your tasks and your calendar into one chain:

```
Three-year vision → Yearly objectives → Quarterly priorities → Monthly milestones → Tasks → Time blocks
```

Nothing that was already in JARVIS moved or changed. Your tasks, goals, habits, calendar and workouts stay where they were; the plan only
holds **links** to them.

## Where things live

| What | Storage key | Cloud backup |
| --- | --- | --- |
| Objectives, priorities, milestones | `jarvisPlanNodes` | merged by record (newer edit wins; deletions kept 30 days so Undo works) |
| Money by year / quarter / month, hiring | `jarvisPlanPeriods` | merged by record |
| Task ↔ plan links and time estimates | `jarvisPlanLinks` | merged by record |
| Vision, revenue measure, planner hours | `jarvisPlanSettings` | newest copy wins |
| Ingredients (School, Gratiel, …) | `jarvisPlanIngredients` | merged by record |
| Time blocks | `jarvisPlanBlocks` | merged by record |
| Weekly top three and review | `jarvisPlanWeeks` | merged by record |

Tasks stay in `jarvisTasks` and goals in `jarvisGoals` (Habits). A task is linked to **at most one** plan item, so it can never be counted twice.
Unlinking, or deleting a plan item, never deletes the task.

## How progress is worked out

Nothing is guessed. Each plan item is measured one of five ways:

* **Tasks** (default): finished tasks ÷ all tasks linked to the item or anything under it, each task counted once. A milestone with no tasks is
  a tick-off item you finish yourself, and counts as one item toward the priority above it.
* **Revenue**: the revenue you entered for the months it covers ÷ its target. **Gratiel's default is monthly sales revenue** (months add up).
  If you choose MRR in *Plan settings*, a quarter or year shows its latest month instead, because MRR is a snapshot, not a total.
* **Spending limit**: what you entered as spent ÷ the limit. Over the limit is flagged.
* **A number you track**: current ÷ target (for example hires made).
* **One of your Goals**: read from the goal as it is now.

Revenue and budget never use task completion; task progress never uses money. Where nothing has been entered, the screen says so instead of
showing 0%.

Health ("On track", "At risk", "Behind", "Overdue") compares progress with how much of the item's time has gone: on track = within 10 points
of the time elapsed, at risk = within 25, otherwise behind. An item is overdue when its deadline (or the end of its month, quarter or year)
has passed and it isn't done. Paused items raise no warnings; dropped items leave their parents' progress.

## The weekly planner

* **Ingredients** are the kinds of time you plan with. The starter set (School, Gratiel, Workout, Studying, Personal, Rest) is added only when you
  press the button; you can rename, recolour, add and delete them. Rest time doesn't count toward your daily workload.
* **Blocks** snap to 30 minutes or an hour, can repeat (daily, or weekly on days you choose), and can be dragged (mouse) or press-and-held then
  dragged (touch). On a phone the week shows one day at a time.
* A block can hold one existing task. The task takes the block's day and time (the same task you see in Habits and the Calendar), follows the
  block if it moves, and the block follows the task if you move it elsewhere. Ticking either ticks both. A block with a task can't repeat.
* **Time worked** is only what you log on a block. Unlogged blocks aren't counted as worked, and the numbers say how many were logged.
* Suggested times use the free time left after your blocks, calendar events and timed tasks. They are proposals; you press Schedule.
* Carry-forward lists unfinished tasks from days that have passed; nothing moves until you press the button (and it can be undone).

## Files

`js/plan-logic.js` (rules: nodes, money, links, progress) · `js/plan-week-logic.js` (rules: ingredients, blocks, week figures) ·
`js/plan-store.js` (saving) · `js/plan-ui.js` (shell, cards, forms) · `js/plan-yearly-ui.js` · `js/plan-quarterly-ui.js` (Quarterly and Monthly) ·
`js/plan-week-ui.js` · tests in `functions/test/plan-logic.test.js` and `plan-week-logic.test.js`.
