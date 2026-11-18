# Learning & Research: how it is organised

The Learning tab has **four tabs** and **one + Add button**. Everything that used to be on the eight old tabs is still
there; some of it moved one tap deeper. No stored data was changed or removed (see "Your data" below).

```
Learning & Research                       [+ Add]  [⋯]
Overview | Books | Research | Notes
```

- **+ Add** (top right, on every screen): Book, Research topic, Note, then the less common Flashcard and Action idea.
  When a book or a research topic is open, a new note starts out already "from" it.
- **⋯ More** (top right): Learning goals, Weekly review, Topics, Collections, Review schedule, Review history.
  These open as their own screens with a back button; the tab they belong to stays highlighted.

## The four tabs

### Overview
Only what is worth a glance:

1. Three figures, each a button: **Active books** (books marked Reading), **Pages today**, **Notes saved**.
2. **Currently reading**: the book, its progress bar and page, a **Log reading** button, and "N more in progress" if
   there are others. A running reading timer shows here too.
3. **Today's review**: up to three notes or flashcards due for spaced repetition, a count, and **Start review**.
   Hidden when nothing is scheduled.
4. **Recent activity**: pages and minutes read (merged per book and day), notes saved, research started or completed,
   sources added, books finished, actions put into practice, review sessions.

If there is nothing yet it says so in one line and points at + Add. Nothing is invented: every figure and line is
computed from saved records (`js/learning-overview-logic.js`, unit-tested).

**Log reading** is one small sheet: pick the book, type the page you are on (or tap **+5 / +10 / +25**), optionally
the minutes read, Save. There is also "Use the timer instead". It goes through the same page log as before, so a
page is counted once however it is entered.

### Books
- **Library**: one flat list with a progress line per book and a **Log** button, filter chips (All, Reading, To read,
  Paused when there are any, Finished), search, and Filters for category and sort.
- **History**: pages read today / this week / this month, day streak, the reading-history chart, the time list
  (with "Add time for another day") and the calendar. "More numbers" holds books finished, pages per session and the
  timed session.
- **A book's page**: status menu, progress, Log reading, reading time and the optional timer, its notes (+ Note) and
  actions (+ Action), and a folded reading log. Edit and Delete are in the ⋯ menu on the page.

### Research
- Topics as a flat list with status chips (All, Active, Planned, Completed), search, and Filters (priority, category,
  archived, sort).
- A topic's page: status menu, the question, **findings and notes** (findings, opinions you have not verified, other
  notes, kept apart), **sources and links** (with how many are reviewed), and folded Next steps, Conclusion, Checklist
  and Purpose. Edit, Archive and Delete are in the ⋯ menu on the page.
- A new topic asks only for a topic and its main question; template, purpose, category, priority and status are
  under "More details".

### Notes
Three small pills at the top: **Notes**, **Flashcards**, **Actions**.

- **Notes**: a "N items due, Start review" bar, anything still **to organize** (older quick-captured items), chips
  (All, Starred, Reviewing), search, Filters (kind, topic, category, book, project, date, sort).
  Each note has **Remember / Reviewing** (one tap puts it into spaced repetition), **Make an action** (turns it into
  an action idea), Edit, and a folded "More" for pause, star, mark organized, link to other notes, add to a
  collection, make a flashcard and delete.
- **Flashcards**: the review launcher, practice (folded), the cards, with the review schedule and history under ⋯ More.
- **Actions**: the action ideas, with a status menu on each row.

## Where everything went

| Before | Now |
|---|---|
| Dashboard (stat tiles, quick page buttons, review and goals cards) | **Overview** (three figures, Currently reading, Today's review, recent activity). Goals moved to ⋯ More. |
| Books | **Books › Library**; reading stats and the timer are **Books › History**; the page box and +5/+10/+25 are in **Log reading** |
| Research | **Research** (same data; extras folded) |
| Knowledge (notes, Topics, Collections) | **Notes**; Topics and Collections are in ⋯ More |
| Actions | **Notes › Actions** |
| Study (cards, review, schedule, history) | **Notes › Flashcards**; Review schedule and Review history are in ⋯ More |
| Goals | ⋯ More › **Learning goals** |
| Weekly review | ⋯ More › **Weekly review** |
| Quick Capture button | **+ Add** (note kinds include Research idea and Question); items captured earlier still wait under "To organize" in Notes |

## Your data

The screens changed; the storage did not. The records, the storage keys and the rules in the logic files
(`learning-logic.js`, `learning-store.js`, the cards / goals / links / reading / spaced-repetition / weekly logic) are
unchanged, and nothing is migrated. `functions/test` still covers those files.

While making this change, a browser check seeded every kind of record, opened every screen, menu and form without
saving, and confirmed the stored text was identical; it also confirmed every record is still counted and reachable
from its new place, and that editing through the new forms keeps the fields the forms do not show. Those browser
checks are run from outside this repository (they are not part of `npm test`).

## What is not verified

All browser testing was done in Chromium at 320, 390, 768 and 1200 px wide with a fake clock. It has not been run on a
real iPhone or in Safari.
