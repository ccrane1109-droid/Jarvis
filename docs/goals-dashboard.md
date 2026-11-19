# Goals dashboard

Planning → Progress → Goals answers three questions at a glance:

1. **What am I working toward?** goal cards, grouped by category
2. **How close am I?** a progress bar and a percentage on every card, and four numbers at the top
3. **What should I do next?** a *Next steps* list under the cards, and one *Next* line on each card

```
Goals                                              [ + New Goal ]
 5 Active goals | 1 Goals completed | 1 Due soon | 40% Overall progress
 [ All Goals ] [ Business ] [ Health ] [ Learning ] [ Personal ] [ Other ]
 +--------------------------------------------+
 | Launch Gratiel Drop 001   Business   High   |
 | Dec 1 · in 27 days                      33% |
 | [=========-------------------------------] |
 | 2 of 6 milestones                           |
 | NEXT  Email the photographer · Nov 5        |
 | Supports: First $100k year › Launch the ... |
 |                              [Edit] [Complete]
 +--------------------------------------------+
 Next steps       (earliest deadline and most important first)
  [ ] Email the photographer   Launch Gratiel Drop 001 · Nov 5        [+ Today]
 Completed goals (1)
```

## What is stored

Nothing moved. Goals are still in `jarvisGoals` (Habits' store, backed up and merged by record id). A goal written before this
screen existed opens, shows and saves exactly as it was: name, description, category, target date, number, unit, percentage,
checklist and `createdAt` are all kept. New, optional fields on the same record:

| Field | Meaning |
|---|---|
| `trackMode` | `milestones`, `numeric` or `manual`. A goal without it is read as **numeric** if it had a number target, otherwise **manual**, so its progress is not recalculated. |
| `startValue` | where a number goal started (so "from 20 down to 12" works, and so progress is measured from the start, not from 0) |
| `priority` | `low`, `medium` (the default) or `high`; used to rank Next steps |
| `milestones[]` | `{ id, text, done, due, taskId }`. `due` is an optional date; `taskId` links the milestone to a task |
| `updatedAt` | set by every change, so two devices merge by the newer edit |

There is no second goals store, no copy of a goal in Strategy and no copy of a milestone in the calendar.

## Three ways to track progress

| Mode | Progress is | Changing it |
|---|---|---|
| **Milestones** | milestones done ÷ milestones. A milestone with a task is done exactly when its task is. | tick a milestone, or finish its task anywhere |
| **Number** | `(current − start) ÷ (target − start)`, any direction. Shows "7 of 12 books · 5 books to go". | **Update** on the card: type the new number and press Enter. No editor. |
| **Manual** | the percentage you set | −5 / +5 on the card, or the edit sheet |

JARVIS never changes a manual goal's percentage, and never changes a number by itself. A goal is also **not completed
automatically** any more: reaching the target shows "Target reached" (or "All done") and highlights **Complete**, and you press it.
(Before this screen a goal could complete itself the moment a number target was reached; that changed on purpose.)

Completing a goal does not touch its numbers; it only sets `completed`. **Undo** (8 seconds) reverses it.

## New goal / Edit

**+ New Goal** opens one short sheet: name, category, target date, priority, "How will you track progress?", milestones (a
line each, each with an optional date; pasting several lines makes several milestones) and, folded away, a description.
Only what the chosen way of tracking needs is shown: number fields for **Number**, a percentage for **Manual**, a "your own
category" box when you choose *Your own*. Switching modes never wipes what you typed or saved for the other modes. Editing uses
the same sheet, and **Delete goal** is at its bottom (with a confirmation and Undo; tasks that were linked to the goal are kept and
simply unlinked).

## Next steps

For every active goal: its open milestones and the open tasks linked to it (a milestone's own task is shown once, as the milestone).
Ranked in four groups: **overdue**, **within 7 days**, **later**, **no date**; inside a group by priority and then date. The list
shows the first five ("Show all N" for the rest).

* **+ Today** puts the step on today's calendar: a milestone with no task gets one (dated today, linked to the goal and the
  milestone); a task already on another day is moved. It is never added twice (the row then says *On today*). Undo is offered.
* The tick completes the task or milestone. Reading the list changes nothing.

## Calendar, Day planner and the To-Do list: one set of tasks

* **Dates on the calendar.** Each goal's target date and each milestone's date appear on the calendar as all-day items
  (rows read "Goal deadline" and "Milestone · <goal>"). A milestone that already has a task is *not* also shown as a
  milestone, because its task is on the calendar already, so nothing appears twice.
* **Tasks from a goal.** On a milestone's sheet, **Add as a task** picks a day and makes one task (linked to the goal and the
  milestone); the card's **+ Add a task** makes a task that belongs to the goal but to no milestone.
* **Ticks flow both ways.** Ticking the milestone ticks its task; finishing the task in the Calendar, the Day planner or the To-Do
  list ticks the milestone. Milestone dates without a task can be ticked from the calendar (row tick, or the popup's *Mark done*).
  Goal deadlines are not ticked there: a goal is finished in Goals.
* **Day planner.** *Daily plan → From your goals* lists up to three next steps that are not on that day yet, each with **Add to
  day** (same rule as *+ Today*, for the day you are looking at; not offered for past days).
* A goal date is changed in Goals, not by dragging it on the calendar.

## Strategy

**Link to Strategy** (inside an open card) points the goal at an objective, priority or monthly milestone that already exists in
Strategy. Nothing is created or copied: the Strategy item switches to "follows this goal" (`measure: "goal"`, `goalId`), the same
link Strategy's own *One of your Goals* option has always made, and its progress is read from the goal. The sheet says so before
you confirm ("It will follow this goal's progress instead of counting its tasks"). The goal's card then shows
**Supports: First $100k year › Launch the winter drop**, worked out by looking the link up, so the two screens cannot disagree.
**Unlink** puts the item back to counting its tasks. Strategy's own goal progress now uses this screen's rules (milestones, number or
percentage), so a milestone goal shows the same percentage in both places.

## Where the code is

`js/goals-logic.js` pure rules, no page access (unit tests: `functions/test/goals-logic.test.js`) · `js/goals-ui.js` the screen ·
`js/habits.js` keeps the goal list and exports `commitGoals` / `releaseGoalTasks` · `js/calendar-ui.js` and
`js/calendar-planner-ui.js` draw the dates and the *From your goals* section · `js/plan-logic.js` reads progress through
`JarvisGoalsLogic.progress`.

## Limits worth knowing

* Milestones keep the order you entered them; there is no drag-to-reorder.
* Deleting a goal is a real delete (with Undo for 8 seconds). As with every other list, a delete made while another device was
  offline can come back when that device syncs.
* Tested in Chromium (desktop and phone sizes); not on a real iPhone.
