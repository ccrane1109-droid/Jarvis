# Weekly Intentions

A small section at the top of **Strategy › Weekly** for the habits you want to build and the ones you want to drop,
one week at a time.

```
Weekly Intentions
┌ 3 things I want to do this week ┐  ┌ 3 things I want to stop doing this week ┐
│ 1 of 3 done  ▓▓▓░░░             │  │ 6 of 21 days avoided  ▓▓▓░░░            │
│ ☑ Read every morning            │  │ Excessive scrolling             2/7     │
│ ☐ Work on my business           │  │ [M][T][W][ ][ ][ ][ ]                   │
│ ☐ Follow my daily routine       │  │ Procrastinating                 2/7     │
└─────────────────────────────────┘  │ [M][ ][W][ ][ ][ ][ ]  …                │
                                     └─────────────────────────────────────────┘
Weekly reflection: What did I do well this week? / What should I improve next week?
History ▸
```

On a computer the two cards sit side by side; on a phone they stack. The section follows the week the planner is showing,
so the planner's week arrows (and *This week*) also move Weekly Intentions to another week.

## Setting it up (about a minute)

Tap a box and write. The grey examples ("Read every morning", "Excessive scrolling"…) are only hints. There are exactly
three boxes in each card. Anything you write is saved as you go (a moment after you stop typing, and as soon as you leave
the box or press Enter); there is no Save button. You can change any words at any time, in this week or another.

## Each day (a few seconds)

- **To do:** tick the box when you have done it. A box can only be ticked once it has words in it.
- **To stop:** tap the day you avoided it. Tap again to undo. Today is outlined; days that have not happened yet are greyed
  out and can't be marked. Earlier days of the week can still be filled in.
- Each card has one **progress** line and bar: *x of y done* and *x of y days avoided*. Only boxes with words count, so
  an empty box is not a failure. That is all the counting there is.

## A new week

Nothing needs to be reset by hand and nothing is lost. A week is its own record, so when a new week begins:

- the checkboxes, the daily marks and the reflection are **new and empty**;
- the **words** of your six boxes are carried over from the last week you wrote anything in, so you only retype what
  changed (change or clear any of them; they are only a starting point until you do);
- the week that ended stays exactly as you left it, and appears under **History**.

Looking at a new week saves nothing; it is saved the first time you change something in it. A past week you never filled
in stays empty (it does not borrow words from another week).

## Weekly reflection

Two boxes at the bottom: *What did I do well this week?* and *What should I improve next week?* They belong to the week
and are saved the same way. (The older, longer **Weekly review** further down the page is separate and unchanged.)

## History

*History* is folded at the bottom. It lists earlier weeks, newest first (up to 26), each with one line (*To do 2 of 3 ·
Avoided 15 of 21*). Tap a week to see what you wrote, what was done, how many days you avoided each thing, and your
reflection. There are no charts or scores.

## Where it is stored

| What | Key | Backup |
|---|---|---|
| One record per week, `wi_<the Monday>`: three "do" boxes (words, done), three "stop" boxes (words, seven true/false days Monday–Sunday), the two reflection answers | `jarvisPlanIntentions` | Part of the cloud backup, merged by record (the newer edit of a week wins, like the other planner records) |

It lives in the same plan storage as the Weekly planner, so it is backed up and synced with it. No account, paid service
or outside request is used. If something saved there can't be read, the section says so and does not save over it; if the
browser refuses to save, you are told and the change is not kept.

The rules (what a week shows, what can be ticked or marked, progress, history) are in `js/intentions-logic.js` and are
covered by `functions/test/intentions-logic.test.js`; the screen is `js/plan-intentions-ui.js`.

## Choices that were made for you

- **Words carry over; ticks don't.** If you would rather start every week with empty boxes, clear them: it is three boxes
  and six taps. (Tell me if you would rather it started empty.)
- **Progress for "stop" is out of seven days per box.** Early in the week it will show a low number; it rises as you mark days.
- Marks are kept if you empty a box and write it again, so pausing mid-edit never loses them; an empty box is not counted.
- Two devices editing the *same week* at the same time: the later edit of the week wins (the same as other planner records).

## What is not verified

All browser testing was in Chromium at 320, 390, 768 and 1200 px wide with a fake clock. It has not been run on a real
iPhone or in Safari. On a 320 px phone the seven day buttons are about 34 px wide and 44 px tall (the other seven-day rows
in JARVIS are the same).
