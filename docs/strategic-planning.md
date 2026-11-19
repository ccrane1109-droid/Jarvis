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
| Time Block Categories (School, Gratiel, …; called “ingredients” in version 1) | `jarvisPlanIngredients` | merged by record |
| Time blocks | `jarvisPlanBlocks` | merged by record |
| Weekly top three and review | `jarvisPlanWeeks` | merged by record |
| Your own goal templates | `jarvisPlanTemplates` | merged by record (deletions kept so Undo works) |
| Monthly reviews (`mo_YYYY-MM`) | `jarvisPlanReviews` | merged by record |
| The Calendar's daily plan (`pd_<date>`: the day's top three as references to tasks, notes, end-of-day reflection) | `jarvisPlanDays` | merged by record |
| Weekly Intentions (`wi_<Monday>`: three things to do, three to stop with a daily tracker, a two-question reflection) | `jarvisPlanIntentions` | merged by record |
| Which sections you folded, last tab, hidden hints | `jarvisPlanUi` | **this device only** (a preference, not data) |

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
* **One of your Goals**: read from the goal as it is now, with the Goals screen's own rules (milestones done, a number, or the percentage you set). Link or unlink it from the goal's card; see [goals-dashboard.md](goals-dashboard.md).

Revenue and budget never use task completion; task progress never uses money. Where nothing has been entered, the screen says so instead of
showing 0%.

Health ("On track", "At risk", "Behind", "Overdue") compares progress with how much of the item's time has gone: on track = within 10 points
of the time elapsed, at risk = within 25, otherwise behind. An item is overdue when its deadline (or the end of its month, quarter or year)
has passed and it isn't done. Paused items raise no warnings; dropped items leave their parents' progress.

## The weekly planner (now in the Calendar)

**Strategy › Weekly** is for the week's direction: Weekly Intentions, the week at a glance, the week's top three, the numbers, and the end-of-week
review with carry-forward. The time-blocking itself (the Monday-to-Sunday grid, the category palette, suggested times, the Add block button) was
moved to **Calendar › Day and Week**, so there is one planner, not two; see [calendar-planner.md](calendar-planner.md). **Nothing was copied and
nothing was lost**: the Calendar reads and writes the very same blocks (`jarvisPlanBlocks`) and categories (`jarvisPlanIngredients`).

* **Time Block Categories** (version 1 called them ingredients; the saved data is the same) are the kinds of time you plan with. The starter set (School, Gratiel, Workout, Studying, Personal, Rest) is added only when you
  press the button; you can rename, recolour, add and delete them from the Calendar's ⋯ menu. Rest time doesn't count toward your daily workload. Calendar and Home label these blocks “Time block”.
* **Blocks** start and end on any quarter hour, can repeat (daily, or weekly on days you choose), and can be dragged and resized in the Calendar's hour-by-hour views.
* A block can hold one existing task. The task takes the block's day and time (the same task you see in Habits and the Calendar), follows the
  block if it moves, and the block follows the task if you move it elsewhere. Ticking either ticks both. A block with a task can't repeat.
* **Time worked** is only what you log on a block. Unlogged blocks aren't counted as worked, and the numbers say how many were logged.
* The planner's hours (when the day starts and ends, and the daily workload limit) are set from the Calendar's ⋯ menu › *Planner hours*; they
  are still saved in `jarvisPlanSettings`. The old "Time blocks snap to 30 minutes / 1 hour" setting is no longer used (blocks use quarter hours); its saved value is left alone.
* Carry-forward lists unfinished tasks from days that have passed; nothing moves until you press the button (and it can be undone).

## Version 2.0: what was added

Everything above still holds. Version 2.0 changes how the plan is shown and adds the pieces that answer *Where am I going? What matters most
now? What should I work on today? Am I making progress?* No existing record was changed or moved, and there are no new services, accounts or
paid APIs: every figure and suggestion is worked out on your phone from your own records.

**Tabs:** Yearly · Quarterly · Monthly · Weekly · Insights. A compact dashboard sits above them (overall completion, this year's objectives,
this quarter's top three, this month's milestones, this week's top three, tasks done this week, Gratiel time this week, deadlines in the next
two weeks). Each tile opens a sheet that follows the chain down — vision → year → quarter → month → week → day — and every row opens the item.
Sections fold and stay folded (that choice is saved on the device only).

* **Yearly:** a timeline of the three years with each year's theme and progress; per year, a planned-against-actual bar (share of the year
  that has passed beside the average progress of its objectives), up to three objectives with the quarterly priorities that feed each one and
  how many “points” each counts for, revenue / budget / hiring targets. **Break down a goal** turns a goal into objective → priorities →
  milestones → first tasks, shown for you to edit before anything is saved (Undo removes what it added). Built-in templates (clothing drop,
  getting stronger, finishing the semester) and your own can be reused.
* **Quarterly:** three priorities, each with a description, objective it serves, deadline, success metric, importance (1–5), status, notes,
  milestones, and progress with planned-against-actual. A performance overview counts priorities on track / at risk / done, milestones done
  and tasks done. **What would help** lists plain rules, for example: no parent objective, no milestones or tasks yet, an overdue milestone, a
  milestone with no tasks, nothing dated in the next 7 days. Money and number priorities say what to enter instead of chasing tasks.
* **Monthly:** collapsible Overview, Milestones, Finances (a six-month trend chart plus a table of the same numbers) and Tasks. Tasks are
  grouped by what they count toward and paged, never all listed at once. The **inbox** holds tasks that count toward nothing; from there you
  can link, schedule, categorize or put a task away (archived tasks leave every count; nothing is deleted). Search plus priority and category
  filters work on hundreds of tasks.
* **Weekly:** the top three is picked by points, and **Why?** lists every reason with its points. The score shown is exactly the sum of the
  listed reasons. Reasons: counts toward your plan +15; objective importance up to +15; objective at risk +10 / on track +4; this quarter's
  priority +10 (+5 if at risk); milestone overdue +16, due within 7 days +14, within 14 days +9, within 30 days +4; high priority +14 / medium +6;
  overdue up to +12; about an hour or more of work +4. Minus: milestone already complete −12, paused item −15, small task tied to no goal −8,
  needs more time than is free this week −10, a second pick from the same milestone −6. At most one pick is a task that counts toward no goal.
  You can use the three, change them, or write your own. Also on this tab: tasks done and hours planned against logged, unfinished tasks and
  carry-over, a day summary (planned by category, time taken and free, overlaps counted once), clash marks, tap a block to edit, drag, resize,
  custom lengths, an unscheduled-tasks list, and the weekly review.
* **Insights:** goal progress by year, planned against actual (this week and the last six weeks), time by category, and revenue / spending
  by month. Each chart has a table of the same numbers, and a value that was never entered is shown as **not tracked** (a gap in a line, no
  bar), never as zero.
* **Reviews:** the weekly and monthly reviews are filled in from your records (done, late, wins, what slipped) by fixed rules. They are
  summaries, not predictions; your own reflections are optional text boxes. Starting a review never overwrites something you already wrote.
* **Suggestions (automation with approval):** a box under the overview (folded on a phone, with the count in its header) lists rule-based proposals: move an overdue milestone's deadline two weeks out, move
  overdue plan-linked tasks to today, add a task for an at-risk priority with nothing planned this week, write last week's review (only if that
  week had tasks or blocks). **Nothing changes until you press Apply**, and Apply gives an Undo that is recorded as a new edit (so it also
  wins on your other device). “Not now” hides a suggestion for 14 days.
* **Integrations:** Home shows today's focus (up to three open tasks dated today or earlier, tickable) and a plan card; Business shows the goals tied to Gratiel;
  Calendar shows time blocks next to events and tasks, and a block that holds a task is listed once (as the task); Workouts add their logged
  minutes to the Exercise total once; a habit can be linked to an objective, and the goal then shows how many of the last 7 days that habit was done (the habit itself and the goal's progress figure are not changed by it). A task is still stored once, in
  `jarvisTasks`, with at most one plan link.

**How the new figures are worked out**

* Planned against actual: *planned* is the share of the time between an item's start and deadline that has passed; *actual* is its progress
  as above. Before the start, planned is 0%; after the deadline it is 100%. If the item has no progress figure yet, there is no gap, only
  “no data yet”.
* A spending limit counts as behind when spending runs *ahead* of the time passed; a revenue target when revenue runs behind it.
* Roll-ups use importance (1–5) as weight; items with no figure are left out of the average instead of counting as 0%, and dropped items
  leave the average. A milestone with nothing under it counts for 0% until you finish it.
* Hours **worked** come only from time you logged on a block and logged workout sessions. Hours are never estimated from the plan.
* Gratiel's monthly revenue is what you type in. The Shopify sales snapshot on the Business tab is read on demand and is not written into the
  plan automatically.

**What it deliberately does not do:** guess; call itself AI; use a network; or change a deadline, task day or priority by itself.

## Limits to know about

* Built and tested in desktop Chromium at phone widths (320, 390 px) and wide screens; it hasn't been checked on a real iPhone or in Safari.
* The live “update from my other device” listener is tested against a pretend backend; whether your own cloud rules let `users/{uid}/appData`
  be read and written hasn't been checked from here.
* With about 1,500 tasks, ticking one redraws the screen in roughly 0.45 s on the test machine; the other screens draw in about 0.15–0.35 s.
  A phone will be slower; that hasn't been measured.
* A suggestion you dismiss comes back after 14 days if it still applies.
* Objectives, priorities and milestones are reordered with Move up / Move down buttons; there is no drag to reorder them.

## Files

`js/plan-logic.js` (rules: nodes, money, links, progress, pace, templates) · `js/plan-week-logic.js` (rules: categories, blocks, week and day figures) ·
`js/plan-insights-logic.js` (rules: ranking, dashboard, overviews, reviews, suggestions) · `js/plan-store.js` (saving) · `js/plan-ui.js` (shell, cards, forms) ·
`js/plan-dash-ui.js` (dashboard, drill-down, suggestions) · `js/plan-yearly-ui.js` · `js/plan-quarterly-ui.js` (Quarterly and Monthly) · `js/plan-week-ui.js` ·
`js/plan-insights-ui.js` · `js/plan-charts.js` (own SVG charts) · `js/plan-breakdown-ui.js` (Break down a goal, templates) · `js/plan-home-ui.js` (Home and Business cards) ·
tests in `functions/test/plan-logic.test.js`, `plan-insights-logic.test.js`, `plan-week-logic.test.js` and `plan-charts.test.js`.
