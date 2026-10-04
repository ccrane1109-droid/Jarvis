# Gladiator Mode — Design Specification
### Design angle: Coach's Voice — every line of copy is a data-grounded one-liner, never generic hype, built on one reused interaction shape: the Lineup

---

## 0. What this document assumes about JARVIS (grounding)

This spec is written against the actual JARVIS codebase, not a hypothetical schema. Key facts it relies on:

| Concern | Real source |
|---|---|
| Structured workout log | `localStorage["jarvisWorkouts"]`, array of sessions; structured ones have `schema: 2` with `{ id, dateTime, date, routineId, programId, programDayId, notes, exercises:[{exerciseId, sets:[{weight, reps, warmup, dropset}]}], createdAt }` (`js/workout.js`) |
| In-progress session | `localStorage["jarvisWorkoutDraft"]` — `{ dateTime, routineId, notes, exercises:[{sessionExId, exerciseId, sets, supersetGroup}], programId, programDayId, activeIndex }`, persisted on every change via `saveDraft()` |
| Routines | `localStorage["jarvisRoutines"]` — `{ id, name, exercises:[{exerciseId, supersetGroup, plannedSets:[{reps, type}]}] }` |
| Programs | `localStorage["jarvisPrograms"]` — `{ id, name, days:[{id, label, routineId}], currentIndex }` |
| Per-exercise PR / e1RM | `getExercisePrAndE1rm(exerciseId)` in `js/workout.js` → `{ bestSet:{weight,reps}|null, bestE1rm:number }`, scanned live from `jarvisWorkouts` |
| Most recent logged sets for an exercise | `mostRecentLoggedSets(exerciseId)` in `js/workout.js` |
| Routine's planned next set | `routineTargetForSet(exerciseId, setIndex)` → `{ reps, type }` |
| Workout streak / weekly count | `dayStreak()`, `thisWeekCount()`, exposed via `JarvisWorkout.getSummary()` → `{ total, thisWeek, streak, lastWorkout }` |
| Habits | `localStorage["jarvisHabits"]` — `{ id, name, targetDays, dailyTarget, completions:{ "YYYY-MM-DD": count } }`; `computeCurrentStreak(h)`, `isHabitDoneOnDate(h,date)`, `habitCountOn(h,date)` in `js/habits.js` |
| Personal tasks | `localStorage["jarvisTasks"]` — `{ id, date, text, priority, category, time, completed, goalId, order, createdAt }` (`js/habits.js`) |
| Business data | `localStorage["jarvisBusiness"]` — `{ profile, tasks:[{id,text,priority,deadline,category,notes,completed,createdAt}], goals:[{id,title,category,priority,status,...}], ... }` (`js/business.js`); `JarvisBusiness.getSummary()` → `{ income, expense, net, activeGoals, totalGoals }` |
| Shared utilities | `window.JarvisCore` — `uid()`, `loadJSON()`, `saveJSON()`, `showToast()`, `escapeHtml()`, `openModal()/closeModal()`, `todayISODate()`, `formatDate()` |
| Visual system | `:root` in `style.css` — `--bg:#0a0e14`, `--card:#151a24`, `--accent:#4f8cff` (blue), `--green:#33d17a`, `--purple:#9b6bff` (used for the Progress tab), `--radius:14px`; safe-area already handled via `.app-header{padding-top:env(safe-area-inset-top)}` / `.app-main{padding-bottom:calc(80px + env(safe-area-inset-bottom))}` |
| Navigation | `.main-nav` (Workout / Nutrition / Habits / Business / Trading Lab / AI Video) + per-tab `.sub-nav`, driven by `JarvisCore.setupTabGroup()` |

**No "Study" data module exists in JARVIS today.** Business has a `learning` log (a retrospective reading/course log, not an objective tracker). Gladiator's STUDY mission is therefore explicitly specified in §7.4 to source its objective from `jarvisTasks` items tagged `category: "Study"` — it does **not** invent a parallel study-tracking system.

Everything in this spec is additive: new files (`js/gladiator.js`, a `<section id="gladiatorOverlay">` in `index.html`, a Gladiator block in `style.css`) plus small, named, non-breaking export additions to `js/workout.js`, `js/habits.js`, `js/business.js` (a `.gladiator` sub-object on each module's existing `window.Jarvis*` export). Nothing already-shipped changes behavior.

---

## 1. Philosophy recap (governs every decision below)

> "JARVIS tells me what matters. Gladiator Mode helps me execute it."

Gladiator Mode is not a skin. It is a **mode switch for the whole app shell**: navigation disappears, one mission fills the screen, and the only copy on screen is either (a) the number the user needs right now, or (b) a single sharp, sourced sentence from their own history — the **Coach's Voice**. There is no mascot, no XP, no streak-flame, no arcade feedback. The emotional register is a strength coach glancing at your logbook and telling you exactly what it says, not a hype man.

**Coach's Voice hard rule:** every microcopy string in this document has a named data source in its template definition. If the required field is missing or empty, the fallback copy is used verbatim — never a fabricated number, never "Let's go!"-style filler.

**One more rule, new in this revision:** a coach doesn't just talk — they run a lineup. Whatever the mission, there is always exactly one person "at bat" (shown large) and a roster of everyone else waiting their turn (shown small, in order, never hidden). §2 makes that literal: one component, reused unmodified by all five mission types, is the structural backbone of every execution screen and the debrief that follows it.

---

## 2. The Lineup — the one structural shape every mission runs on

Every mission in Gladiator Mode — Training, Business, Habits, Study, Deep Work — renders as exactly the same data structure and exactly the same three visual states. This section exists to name that shape once, so §6–§8 can each say "this mission's Lineup is populated from field X" instead of re-describing a bespoke layout five times.

### 2.1 The primitive

A **Lineup** is an ordered list of items, each shaped:
```js
{ id, label, meta, state: "done" | "current" | "pending" }
```
Exactly **one** item in a Lineup is ever `current`. Items the mission has already moved past are `done`; items still ahead are `pending`. There is no fourth state, and there is never more than one `current` item.

Each item renders at one of three **densities**, chosen purely by state and list length — never by which mission it belongs to:

| Density | Used for | Visual |
|---|---|---|
| `hero` | the single `current` item, always | the largest content on the screen — full detail, and the mission's primary input/action lives inside it |
| `line` | `done` / `pending` items, when the Lineup has **≤4** non-current items | a 36px single row: state glyph · label · meta (right-aligned, `--text-faint`) |
| `pill` | `done` / `pending` items, when the Lineup has **>4** non-current items | a 28px compact chip: state glyph + a 3–4 letter label fragment, no meta |

The 4-item cutoff is the one fixed number used everywhere a Lineup renders. It exists purely to protect mobile real estate on longer lists (an 8-exercise Push Day), never to express anything mission-specific — the same threshold governs Training's exercise rail and Habits' queue alike.

State glyphs are identical everywhere: `done` = filled `--green` check, `pending` = hollow `--card-border` ring, `current` = no glyph (the hero body itself is the signal).

One render function, one CSS component, reused by every mission and by the debrief:
```js
// js/gladiator.js
function renderLineup(items, { heroRenderer }) {
  // items: Lineup[] — exactly one item has state:"current".
  // heroRenderer(item) returns the mission-specific hero body for that
  // one item. Everything else (glyphs, density selection, the done/
  // pending rows, tap-to-jump) is shared markup — the ONLY mission-
  // specific piece of the whole component is heroRenderer.
}
```
```css
.lineup-row { }
.lineup-row[data-state="done"] { }
.lineup-row[data-state="pending"] { }
.lineup-row[data-density="pill"] { }
.lineup-row.is-hero { } /* the current item — always density: hero */
```
Tapping a `done` or `pending` row moves the Lineup's `current` pointer to that item. This is the exact "tap segment to jump" / pill-nav behavior that already exists in `js/workout.js` — generalized here from a Training-only trick into the one navigation gesture every mission in Gladiator shares.

### 2.2 One rule, five mission shapes — no per-type branching

The same rule — "one hero, everyone else whispered" — produces every mission's screen without a single mission-specific layout decision:

| Mission | Lineup items | Typical non-current count | Density used |
|---|---|---|---|
| **Training (outer)** | `draft.exercises` | 3–9 | `pill` (>4) or `line` |
| **Training (inner)**, nested inside the outer Lineup's current hero | planned + logged sets for the active exercise | 1–5 | `line` |
| **Habits** | `habitsQueue` (frozen at mission start) | 0–6 | `line` or `pill` |
| **Study** | `getStudyCandidates()` — already plural in §3.2, previously only used to print a "+N more" count; now the actual queue | 0–3 | `line` |
| **Business** | top-N open tasks by the §7.2 sort rule (N=3; preview only, see asymmetry note below) | 0–2 | `line` |
| **Deep Work** | the countdown itself, alone | 0 | n/a — pure hero |

A Lineup with zero non-current items (Business or Study with a single candidate; Deep Work always) is **not a special case** — it is the general rule applied to a list of length 1. **Training nests a Lineup inside a Lineup's hero** (sets inside the current exercise), which is how this one mechanism scales up to Training's extra layer of structure without a second mechanism being invented for it.

One deliberate asymmetry, stated once so it never needs re-justifying below: Business's preview rows (the next 1–2 open tasks, shown faint beneath the hero task) are **display-only** — tapping one does not switch the mission's objective mid-session, because Business is explicitly a single-task mission (§7.2). Habits' and Training's rows *are* tappable, because jumping between queue items is already real, intended behavior there. Both are the same component; only this one documented rule decides whether a given mission's rows are live or inert.

### 2.3 Why this is the mechanism, not just the chrome

Earlier drafts of this spec had four different widgets that happened to look related: a segment progress bar, a completed-set chip row, a frozen habit queue, and a "+N more" Study picker. They are now one widget — `renderLineup()` — instantiated with a different `heroRenderer` per mission. An implementer builds the Lineup component once, tests its three states and two densities once, and every mission's execution screen, the debrief's closing receipt (§8.7), and the mission-select previews (§5) all consume it as data rather than as five layouts that have to be hand-built and kept visually in sync by eye.

---

## 3. System architecture & integration

### 3.1 New files / additions

| File | Change |
|---|---|
| `js/gladiator.js` (new) | Orchestrator module. Exposes `window.JarvisGladiator`. Owns the overlay DOM, mission-select logic, the Lineup renderer (§2), the Coach's Voice template engine, the debrief screen, and the new `jarvisGladiatorSessions` / `jarvisGladiatorState` storage keys. |
| `index.html` | One new top-level node, inserted as the **last child of `<body>`** (so it paints above everything, including modals): `<div id="gladiatorOverlay" class="gladiator-overlay hidden" aria-hidden="true"></div>`. One new header button (§10.1). `<script src="js/gladiator.js"></script>` added after `workout.js`, `habits.js`, `business.js` (it reads their `.gladiator` sub-objects at init). |
| `style.css` | New section `/* ---------------- Gladiator Mode ---------------- */` appended at the end, including the shared `.lineup-row` component (§2.1). Reuses existing tokens (`--bg`, `--card`, `--accent`, `--green`, `--purple`, `--radius`) — no new color system. |
| `js/workout.js` | Add `window.JarvisWorkout.gladiator = {...}` (§3.2) — thin wrapper around functions that already exist in the module's closure. |
| `js/habits.js` | Add `window.JarvisHabits.gladiator = {...}` (§3.2). |
| `js/business.js` | Add `window.JarvisBusiness.gladiator = {...}` (§3.2). |

### 3.2 Required additive exports (contract)

These are the only changes needed inside the existing domain modules. Each is a thin wrapper — no duplicated logic, no parallel data path. The two new exports introduced in this revision (`getExerciseLineup`, `getOpenTasksRanked`) exist solely to feed the Lineup (§2); they derive from data already described above, nothing new is computed.

**`js/workout.js` → `window.JarvisWorkout.gladiator`**
```js
{
  // Returns null, or a mission candidate descriptor (see §5.2.1) for TRAINING.
  getCandidate: function () { ... },

  // Loads the chosen routine/program day into the REAL draft via the
  // existing loadRoutineIntoDraft()/startRoutineNow()/startProgramToday()
  // code paths. Returns nothing; draft is now the single source of truth.
  start: function (source) { ... }, // source: {routineId} | {programId}

  // The OUTER Lineup for the Training mission (§2): one entry per
  // draft.exercises[i]. state = "done" when se.sets.some(isCompletedSet),
  // "current" when i === draft.activeIndex, else "pending". meta = the
  // best completed set logged THIS session for that exercise, formatted
  // "{weight}×{reps}", or null if none yet.
  getExerciseLineup: function () { ... },

  // Read-only view model for the current active exercise, built from the
  // live `draft` + routineTargetForSet() + getExercisePrAndE1rm() +
  // mostRecentLoggedSets() — exactly what renderExerciseCard() already
  // computes, reshaped as plain data instead of HTML. Now additionally
  // includes the INNER Lineup for this exercise (see §6.2 data shape):
  //   setsLineup: [{ id, label:"Set N", state, meta }]
  //     - done sets: meta "{weight}×{reps}"
  //     - the current set: state:"current" (its target/stepper values are
  //       the rest of this same view model — no duplicate fields)
  //     - up to 2 pending preview sets, sourced from
  //       routineTargetForSet(exerciseId, idx); meta omitted (never
  //       fabricated) when that call returns null
  getActiveView: function () { ... },

  // Pass-throughs to the existing mutation functions so Gladiator's UI
  // never writes to jarvisWorkoutDraft directly:
  logSet: function (weight, reps, type) { ... },      // == add-set-btn path
  nextExercise: function () { ... },                   // == handleSessionNextExercise
  prevExercise: function () { ... },                   // == handleSessionPrevExercise
  jumpToExercise: function (index) { ... },            // == handleSessionPillNavClick,
                                                        // now also the Lineup's tap-to-jump (§2.1)

  // == handleSaveWorkout(), then returns the saved session's id/date/
  // volume/PR count so the debrief can read it back.
  finish: function () { ... },

  // Discards nothing — Gladiator "abort" on Training NEVER clears the
  // draft (it's real, partially-logged work). It just closes the overlay.
  // Exposed so Gladiator can show "Draft saved — N sets logged" on exit.
  getDraftSummary: function () { ... }
}
```

**`js/habits.js` → `window.JarvisHabits.gladiator`**
```js
{
  // Today's not-yet-complete habits, in existing array order, each as
  // { id, name, dailyTarget, countToday, streak } using isHabitDoneOnDate/
  // habitCountOn/computeCurrentStreak. This array becomes the Habits
  // mission's Lineup (§2) verbatim — no reshaping needed.
  getRemainingToday: function () { ... },

  // Also returns today's open personal tasks tagged category:"Study"
  // (case-insensitive), for the STUDY mission — jarvisTasks, not a new
  // store. Already plural: previously used only to print "+N more" on
  // the mission-select card, now the actual frozen Study Lineup (§7.4).
  getStudyCandidates: function () { ... },

  // == the same increment used by the Today tab's habit-check-btn
  // (completions[today] += 1, or dailyTarget directly for a binary habit).
  incrementHabit: function (habitId) { ... },

  // == handleTaskListClick's completion toggle, for STUDY mission finish.
  completeTask: function (taskId) { ... }
}
```

**`js/business.js` → `window.JarvisBusiness.gladiator`**
```js
{
  // Single highest-priority open task (§7.2 selection rule), or null.
  // Used as the mission-select card's title and as the Lineup's hero.
  getTopTask: function () { ... },

  // Open tasks sorted by that exact same priority→deadline→createdAt
  // rule, sliced to `limit`. getTopTask() is equivalent to
  // getOpenTasksRanked(1)[0]; this export exists so the execution
  // screen's Lineup (§2.2) can show up to `limit-1` display-only
  // preview rows beneath the hero task without re-deriving the sort.
  getOpenTasksRanked: function (limit) { ... },

  // == the existing task-check-btn completion path in business.js.
  completeTask: function (taskId) { ... }
}
```

### 3.3 New storage keys (minimal, additive, never duplicates domain data)

**`jarvisGladiatorSessions`** — array, one entry per mission *run* (not per set/task — that detail still lives in the owning domain's own storage). This is what lets Gladiator answer "how many missions this week" across mission types without touching domain schemas:

```js
{
  id: "glad_...",
  type: "training" | "business" | "habits" | "study" | "deepwork",
  label: "Push Day",                 // mission title shown in the debrief header
  startedAt: 1730000000000,          // Date.now()
  endedAt: 1730003240000,
  durationSec: 3240,
  completed: true,                   // false if user exited early
  // type-specific, read-only receipt — never re-derived from fabricated
  // numbers, always copied from the real save-result of the domain action:
  result: { ... }                    // see §8 per mission type
}
```

**`jarvisGladiatorState`** — single object, not an array; lets a killed/reopened PWA resume mid-mission (Training already resumes for free via `jarvisWorkoutDraft`; this key matters for Study/Deep Work's timer and Habits'/Study's in-progress queue):

```js
{
  activeSessionId: "glad_..." | null,
  type: "training" | "business" | "habits" | "study" | "deepwork" | null,
  startedAt: 1730000000000 | null,
  objective: "..." | null,           // frozen at mission start, re-shown on resume
  endsAt: 1730001800000 | null,      // absolute timestamp for Deep Work/Study timers
  habitsQueue: ["habitId1","habitId2"] | null, // frozen Lineup order for Habits (§2)
  habitsQueueIndex: 0,
  studyQueue: ["taskId1","taskId2"] | null,    // frozen Lineup order for Study (§7.4),
  studyQueueIndex: 0                           // identical mechanism to habitsQueue
}
```
Timers are always stored as **absolute end timestamps**, never a decrementing counter, so backgrounding the PWA (iOS/Android throttle `setInterval` when the tab isn't visible) never desyncs the displayed time — on `visibilitychange`/`pageshow` the UI recomputes `remaining = endsAt - Date.now()`.

---

## 4. Entry points into Gladiator Mode

1. **Persistent header button** — in `.header-inner`, after the existing title block, a plain-text button:
   ```html
   <button type="button" id="gladiatorEntryBtn" class="gladiator-entry-btn">GLADIATOR</button>
   ```
   Styled as a slim outlined pill (1px `--card-border`, `--text-dim` label, no icon/emoji) that goes solid (`--accent` border, `--text` label) only when a mission is actually available today (computed on load — see §5.1). When nothing is available it's still tappable (leads to the Deep Work fallback) but visually quiet.

2. **Contextual cards inside each domain's Home/Today view** (secondary entry, same destination): e.g. Workout Home's existing `#homeTodayCard` gets one extra line under the program-day summary: a text link `Enter Gladiator Mode →` that calls `JarvisGladiator.open({ preselect: "training" })`. Same pattern added to Habits "Today" tab (`Enter Gladiator Mode →` under the day selector) and Business "Tasks" tab. This is a one-line addition per view, not a redesign of those tabs.

Both entry points call the same `JarvisGladiator.open(opts)`.

---

## 5. Mission-select screen

### 5.1 Layout (full-bleed overlay, replaces nothing underneath — it paints over it)

```
┌─────────────────────────────────────┐  ← safe-area-inset-top padding
│  ✕                         00:00     │  (close btn left; no timer yet, hidden)
│                                       │
│            GLADIATOR MODE            │  13px, letter-spacing .12em, --text-faint
│                                       │
│  ┌─────────────────────────────────┐ │
│  │ TRAINING                         │ │  eyebrow, 11px uppercase, --text-faint
│  │ Push Day — Week 3 · Day 2        │ │  20px/600, --text
│  │ 8 exercises · ~52 min            │ │  13px, --text-dim
│  │ "Last Push Day: 145×6 bench —    │ │  13px italic, --accent
│  │  beat it or match it."           │ │
│  │                    [ENTER ▸]     │ │  full-width btn, 48px tall
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ BUSINESS                         │ │
│  │ Finalize supplier quote          │ │
│  │ High priority · due today        │ │
│  │ "Your only High-priority item    │ │
│  │  due today."                     │ │
│  │                    [ENTER ▸]     │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ HABITS                           │ │
│  │ 3 habits remaining today         │ │
│  │ "Read 20 pages, Stretch,         │ │
│  │  No Added Sugar still open."     │ │
│  │                    [ENTER ▸]     │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ STUDY                            │ │
│  │ Spanish — Unit 4 review          │ │  (from a jarvisTasks item)
│  │                    [ENTER ▸]     │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ DEEP WORK                        │ │
│  │ Pick a focus block               │ │  always available, no data dep.
│  │ [25m] [45m] [60m] [Custom]       │ │  inline preset chips, 44px tall
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘  ← safe-area-inset-bottom padding
```

- Cards are vertically stacked, full width minus 16px gutters, `--card` background, `--radius`, `--card-border`. One card per mission type, **always all five present** (never hide a type) — a type with nothing queued renders its empty state instead of a candidate (below), so the user always sees the full roster JARVIS can execute against.
- Tapping anywhere on a card (not just the button) opens that mission — the button is a visual affordance, not the only hit target. Minimum card tap height 96px.
- Ordering is fixed top-to-bottom: **Training, Business, Habits, Study, Deep Work** — this matches the domain order of the main nav and keeps the list predictable rather than re-sorting by "urgency" each time (re-sorting a list of 5 short cards adds cognitive load for no real benefit; the coach line already front-loads what's urgent).
- Close (✕, top-left, 44×44 hit target) returns to whatever tab was open before Gladiator launched — no transition fanfare, same 150ms fade used elsewhere (§9).

### 5.2 Per-mission card states

**5.2.1 TRAINING**
- *Candidate exists* (draft already in progress, OR an active program has a day, OR routines exist): title = program day label or routine name; meta = `"{exercises.length} exercises · ~{estMinutes} min"`.
  - `estMinutes` formula (clearly an estimate, never presented as logged fact): for each exercise, `plannedSets.length × 40s + max(0, plannedSets.length-1) × 90s`, summed, plus `20s × (exerciseCount-1)` transition buffer, divided by 60, rounded to nearest 5.
  - If `jarvisWorkoutDraft.exercises.length > 0` (unsaved session already open), the card instead reads **"RESUME"** as its eyebrow and title = that draft's routine name (or "Freestyle Session"), meta = `"{completedExCount}/{totalExCount} exercises logged"`.
- *No program/routine and no draft*: card shows `"No routine queued — build one in Workout → Routines"` and the button reads `[OPEN ROUTINES]`, which closes Gladiator and switches the main nav to Workout → Routines instead of entering a mission (you cannot gladiator against nothing).

**5.2.2 BUSINESS**
- *Candidate exists*: `JarvisBusiness.gladiator.getTopTask()` non-null → title = `task.text`, meta = `"{Priority} priority" + (task.deadline ? " · due " + formatDate(deadline) : "")`.
- *No open tasks*: `"No open tasks in Business → Tasks"`, button `[OPEN TASKS]`.

**5.2.3 HABITS**
- *Candidate exists*: `getRemainingToday().length > 0` → title = `"{n} habit{s} remaining today"`, meta previews up to 3 names as compact `line`-density Lineup rows (§2.1) — the same row markup the execution screen uses, just shown small here, with `"+N more"` appended as a final faint row if longer (replaces a plain comma-joined string with the actual component, so the preview and the mission screen are pixel-consistent).
- *All done*: title becomes `"All habits complete today"` in `--green`, button disabled/replaced with a static check — this is itself a Coach's Voice line, not hidden.

**5.2.4 STUDY**
- *Candidate exists*: one or more `jarvisTasks` with `category` matching `/^study$/i` and `!completed` → title = the first such task's `text` by `createdAt` ascending (oldest first); if more than one exists, a small `"+N more"` suffix is shown. Entering the mission loads **all** of them as the frozen Study Lineup (§7.4), in that same order — there is no separate picker screen; the Lineup itself is the picker, exactly as it is for Habits.
- *None*: `"No tasks tagged 'Study' — add one in Habits → Tasks, or run Deep Work instead"`, button `[GO TO DEEP WORK]` which scrolls to/highlights that card.

**5.2.5 DEEP WORK**
- Always actionable. Inline duration chips (25/45/60/90 min, matching common focus-block lengths) plus a `Custom` chip opening a single numeric stepper (5–180 min, step 5). No text objective is required, but a single-line optional label input is offered (`"What are you focusing on? (optional)"`) — stored only in `jarvisGladiatorSessions[].label`, never fabricated if left blank (falls back to `"Deep Work Session"`).

---

## 6. In-mission execution UI — TRAINING (flagship)

### 6.1 Chrome removed vs. kept

**Removed entirely for the duration of the mission:** `.main-nav`, `.workout-sub-nav`, the app header's briefing/profile controls, bottom nav padding — `document.body.classList.add("gladiator-active")` sets `.main-nav, .sub-nav, .app-header > *:not(#gladiatorOverlay) { display:none }` while the overlay owns 100% of the viewport (`position:fixed; inset:0; z-index:500`).

**Kept, because they ARE the mission:** the outer exercise Lineup (§2.2), the current exercise's name + muscle group, the inner set Lineup (current set number, previous performance for this exact set slot, target for this set, upcoming set previews), the rest timer, Log Set / Next / Prev / Finish controls, the exit control. Nothing else — no nutrition widget, no business net number, no streak flame, no other exercise's stats.

### 6.2 Screen layout (default "logging" state)

```
┌─────────────────────────────────────┐
│ ✕          PUSH DAY            18:42│  ← top bar, 44px, safe-area-inset-top
├─✓BEN ✓INC ●TRI  SHO  DIP  CUR  CAL  FLY─┤ ← OUTER LINEUP, pill density (8 > 4 items);
│                                       │   ✓=done(--green) ●=current(hero below) dim=pending;
│                                       │   tap any pill = jump (§2.1)
│  "Last time you hit 145×6 here —    │  ← Coach's Voice line, 1–2 lines, --accent
│   beat it or match it."             │
│                                       │
│          BENCH PRESS                 │  ← 28px/700, --text — outer Lineup's hero body
│          Chest                       │  ← 12px badge, --text-dim
│                                       │
│   ┌───────────────────────────────┐ │
│   │ ✓ 135 × 8      ✓ 145 × 6      │ │  ← INNER LINEUP, done sets, line density
│   └───────────────────────────────┘ │
│                                       │
│        SET 3 OF 4                    │  ← INNER LINEUP's current item (hero)
│        Target: 145 × 6               │  ← 18px/600, --text  (routineTargetForSet)
│                                       │
│   ┌─────┐  ┌───────────┐  ┌─────┐   │
│   │  −  │  │    145    │  │  +  │   │  ← weight stepper, 56px tall buttons
│   └─────┘  └───────────┘  └─────┘   │
│   ┌─────┐  ┌───────────┐  ┌─────┐   │
│   │  −  │  │     6     │  │  +  │   │  ← reps stepper
│   └─────┘  └───────────┘  └─────┘   │
│   [Normal] [Warm-up] [Drop set]      │  ← segmented, 36px, defaults from plan
│                                       │
│   Set 4 · target 145 × 6 (preview)   │  ← INNER LINEUP, next pending set, line density
│                                       │
│ ┌───────────────────────────────────┐│
│ │          LOG SET                  ││  ← primary, 56px, full width, bottom
│ └───────────────────────────────────┘│
│   ‹ Prev           Finish Mission    │  ← secondary row, 44px hit targets
└─────────────────────────────────────┘  ← safe-area-inset-bottom
```

Field-level mapping (every number traceable):
- "18:42" top-right = mission elapsed time, `Date.now() - jarvisGladiatorState.startedAt`, mm:ss, ticks every second.
- **Outer Lineup pills** = `JarvisWorkout.gladiator.getExerciseLineup()` (§3.2), one pill per `draft.exercises[i]`: `done` when `se.sets.some(isCompletedSet)` — identical truth condition already used for the pill-nav "done" state in `js/workout.js` — `current` at `i === draft.activeIndex`, else `pending`. This pill rail is the same `renderLineup()` call used by every other mission's rail; only `heroRenderer` differs.
- "BENCH PRESS / Chest" = `JarvisExercises.getExerciseById(se.exerciseId).name` / `.muscleGroup` — the outer Lineup's current-item hero body.
- **Inner Lineup**, nested inside that hero: done-set rows = `se.sets.filter(isCompletedSet)`, rendered `"{weight} × {reps}"` (what used to be called "completed-set chips" is, mechanically, the inner Lineup's `done` rows at `line` density). "SET 3 OF 4" = `se.sets.filter(isCompletedSet).length + 1` of `getPlannedSets(routineExercise).length` (falls back to `se.sets.length + 1` of "–" when the exercise wasn't loaded from a routine, i.e. freestyle-added) — this is the inner Lineup's `current` row. "Target: 145 × 6" = `routineTargetForSet(exerciseId, nextSetIndex)`; if null (freestyle exercise, no plan), this line is omitted entirely rather than showing a fabricated target — the Set-of-N line also drops the "OF N" part in that case, reading just "SET 3".
- **"Set 4 · target 145 × 6 (preview)"** = the inner Lineup's next `pending` row(s) (up to 2 shown), sourced from `routineTargetForSet(exerciseId, idx)` for `idx` beyond the current set; omitted (not shown as a blank/fabricated row) when that call returns null for every remaining index, same honesty rule as the current-set target line.
- Weight/reps stepper initial values = the same prefill logic as today's `add-set-weight-input`/`add-set-reps-input` (`prefillWeight` from last set or `mostRecentLoggedSets`, `prefillReps` from `routineTargetForSet`).
- Set-type segmented control default = `routineTargetForSet(...).type` ("normal"/"warmup"/"dropset").
- "LOG SET" → `JarvisWorkout.gladiator.logSet(weight, reps, type)`, which runs the exact same validation already in `handleSessionExerciseListClick`'s add-set path (`isNonNegativeNumber(weight)`, `isPositiveNumber(reps)`) and shows the same toasts on failure ("Weight can't be negative." / "Reps must be a positive number.") — Gladiator doesn't get a separate validation path.

### 6.3 Interaction states

| State | Trigger | Visual change | Duration |
|---|---|---|---|
| **Logging (default)** | shown above | — | — |
| **Set logged, no PR** | `logSet()` succeeds, `estimateOneRepMax` ≤ snapshot best | The just-logged set's inner-Lineup row flips from `current` to `done` (joins the chip row, fade+slide-in 150ms); the next inner-Lineup row (a pending preview, if one existed, otherwise a freshly computed target) is promoted to `current`/hero and the steppers repopulate for it; button flashes a 1px `--green` inset border + brief scale(0.98→1) | 150ms |
| **Set logged, PR** | `estimateOneRepMax(weight,reps) > preMissionSnapshot[exerciseId].bestE1rm` | A one-line banner replaces the Coach's Voice line for 2.5s: `"New e1RM PR — {rounded e1rm} lb (prev {rounded prevBest})."` in `--purple` (the color already reserved for Progress/PR content elsewhere in the app), plus **one** haptic pulse (`navigator.vibrate(30)` if supported) — no confetti, no sound, no sustained animation. After 2.5s it fades back to the normal Coach's Voice line. | 2.5s |
| **Resting** | a non-final planned set was just logged (i.e. `nextSetIndex < plannedSets.length`) | The "LOG SET" button area is replaced by a calm countdown: `"RESTING — 1:12"` (56px tall, `--card-elevated` background, no progress ring animation beyond a static dim fill since constant animation is explicitly out of scope) with a text `Skip Rest` ghost button beside it. Rest length = the routine's configured rest (reuse existing per-set/exercise rest config if present; else default 90s normal / 60s for the last set of an exercise). | until 0:00 or Skip |
| **Rest finished** | countdown hits 0 | One gentle haptic pulse (`navigator.vibrate(15)`), countdown area swaps back to the stepper + LOG SET button automatically — no tap required | instant |
| **Exercise complete** | every planned set for the active exercise has a logged set | That exercise's **outer**-Lineup row transitions from `current` (hero) to `done` (pill/line, filled `--green` check); after 1.2s the next `pending` outer-Lineup row is promoted to `current`/hero (same mechanism as tapping a pill to jump) — if the user is actively re-focused on inputs (typing), auto-advance is suppressed and a small `Next Exercise ▸` affordance appears instead | 1.2s or manual |
| **Mission-complete-eligible** | every `draft.exercises[i]` has `se.sets.some(isCompletedSet)` (i.e. the outer Lineup has zero `pending` items left) | "Finish Mission" goes from ghost/outline to solid `--accent` | — |
| **Finish attempted early** | "Finish Mission" tapped while some exercises have zero completed sets | Toast: `"{n} exercise(s) still open. Hold Finish to end anyway."` + the button accepts a 600ms long-press to force-finish | — |
| **Backgrounded / resumed** | `visibilitychange` | Mission elapsed timer and any active rest countdown are recomputed from absolute timestamps (`jarvisGladiatorState.startedAt`, rest timer's own absolute end-time) — never drifts | instant on resume |
| **Exit (✕)** | tapped | Confirm only if the draft has zero completed sets logged this mission (`"Exit without logging anything?"`); otherwise exits immediately — the draft is autosaved continuously via the existing `saveDraft()`, so there is nothing to lose and nothing to confirm | — |

### 6.4 Snapshot-at-mission-start (required for honest PR detection)

On `start()`, Gladiator captures `preMissionSnapshot = { [exerciseId]: getExercisePrAndE1rm(exerciseId).bestE1rm }` for every exercise in the mission **before any new sets are logged**. All in-mission PR comparisons and the debrief's PR count (§8.1) diff against this snapshot, not against a constantly-moving "current best" (which would let a set falsely PR against itself).

---

## 7. In-mission execution UI — other mission types (deltas from Training)

All four share Training's chrome rules (§6.1: nav gone, top bar with ✕ + elapsed timer, bottom-anchored primary action, safe-area padding) and its state-driven, no-constant-animation posture. More specifically, all five mission types — Training included — are the **same Lineup skeleton** (§2) with a different `heroRenderer`; only the hero's content differs below.

### 7.1 Shared layout skeleton

```
┌─────────────────────────────────────┐
│ ✕        {MISSION TYPE}        12:04│
├───────────────────────────────────────┤  ← outer Lineup rail: done/pending rows,
│ {done rows}           {pending rows} │    line or pill density (§2.1); empty for
│                                       │    Business (preview-only, 0–2 rows),
│  "{Coach's Voice line}"               │    Study (0–2 rows), Deep Work (0 rows, n/a)
│                                       │
│          {objective, large}          │  ← the current Lineup item's hero body
│          {sub-detail}                │
│                                       │
│          {type-specific body}        │
│                                       │
│ ┌───────────────────────────────────┐│
│ │        {primary action}           ││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

### 7.2 BUSINESS mission

- **Lineup**: items = `JarvisBusiness.gladiator.getOpenTasksRanked(3)` (§3.2) — the same priority→deadline→createdAt sort as the selection rule below, just sliced to 3 instead of 1. Item 0 is always `current` (the hero task); items 1–2, if present, render `pending` at `line` density, faint, **display-only** — per §2.2's stated asymmetry, tapping one does nothing; Business stays a single-task mission regardless of what else is queued behind it. With only one open task, the Lineup has one item and renders as pure hero — the same degenerate case Deep Work always is.
- **Objective block**: task text large (24px/600), category badge + priority badge (reusing `.badge-red/-yellow/-green` exactly as Business's own task list does) beneath it, deadline line if present (`formatDate(deadline)`).
- **Body**: task `notes` field shown verbatim if non-empty (read-only, scrollable, max ~5 lines before "show more"); nothing else — no other business metrics on screen.
- **Primary action**: `[MARK TASK COMPLETE]`, 56px. Tapping calls `JarvisBusiness.gladiator.completeTask(task.id)` (the real completion toggle) then transitions straight to debrief.
- **Secondary**: `Not done yet — end session` ghost text link, for "I worked on it but it's not finished" — ends the mission without marking the task complete; debrief still shows honestly (`completed:false`, §8.2).
- **Selection rule (exact)**: `data.tasks.filter(t => !t.completed)`, sorted by `priority` weight (`high=2, medium=1, low=0`) **descending**, tie-broken by `deadline` ascending (blank deadlines sort last), tie-broken by `createdAt` ascending (oldest first). First result is the candidate/objective; `getOpenTasksRanked(limit)` is this same ordering, sliced.

### 7.3 HABITS mission

- **Lineup**: the outer (and only) Lineup for this mission, built from the frozen `habitsQueue` (captured at mission start from `getRemainingToday()`, so finishing one habit mid-mission can't make the list jump around) — `line` or `pill` density per §2.1's count rule, same threshold as Training's exercise rail.
- **Objective block**: current habit's name (24px/600) + its `dailyTarget` if >1 (`"2 of 3 today"` using `habitCountOn`) — the Lineup's current-item hero body.
- **Body**: nothing else — no other habits' data visible. A simple large circular tap target (for `dailyTarget===1` habits) or a stepper (for `dailyTarget>1`) identical in spirit to the existing `.habit-check-btn` but enlarged to 120px diameter for one-handed thumb reach.
- **Primary action**: `[MARK DONE]` / `[LOG REP]` → `JarvisHabits.gladiator.incrementHabit(habitId)`, then auto-advances to the next `pending` item in `habitsQueue` (same auto-advance timing as Training's exercise-complete: 1.2s, or immediate `Next ▸`) — mechanically identical to Training's outer-Lineup advance (§6.3).
- **Finish**: once `habitsQueueIndex` passes the last item (the Lineup has zero `pending` items left), auto-transitions to debrief — Habits mission has no separate "Finish" button, completing the queue *is* finishing.

### 7.4 STUDY mission

- **Lineup**: `JarvisHabits.gladiator.getStudyCandidates()` (§3.2) — every open `jarvisTasks` item with `category` matching `/^study$/i` — frozen into `jarvisGladiatorState.studyQueue` at mission start, ordered by `createdAt` ascending. This is, mechanically, the exact same queue pattern as Habits (§7.3): current item = hero, completed items = `done` rows, remaining items = `pending` rows, auto-advance on completion. There is no separate picker screen — the mission-select card's `"+N more"` (§5.2.4) loads directly into this queue.
- **Completing the current item** calls `JarvisHabits.gladiator.completeTask(taskId)` — the same personal-task completion path as the Habits tab — then advances `studyQueueIndex`, identical to `habitsQueueIndex`.
- **Manual fallback**: if no Study-tagged task exists at all, the mission-select card routes to Deep Work (§5.2.5) instead of inventing an objective — Study is never shown as runnable with a blank/fabricated objective.
- **Layout**: objective text large, a **count-up** elapsed focus timer running continuously across the whole queue (not countdown, and not reset per item — study sessions are "until done," matching the product brief's "one objective + timer + progress") plus the task's `time`/`category` fields if present. There is no separate sub-step progress bar beyond the Lineup rail itself, since a single study task has no internal structure in the schema (unlike Training, which nests a second Lineup for sets — Study's queue is one level deep, same as Habits).
- **Primary action**: `[MARK COMPLETE]` (completes the current task, advances the queue) or `[END SESSION]` ghost link (ends without completing the current item; already-completed items in the queue remain completed, same honesty rule as Business §7.2).

### 7.5 DEEP WORK mission

- **Fully generic, by design** — the one mission type allowed to run with zero backing domain data, because unstructured focus time is the product spec's own definition of it ("generic focus-timer session"). Per §2.2, its Lineup has exactly one item and no `done`/`pending` siblings — not because it's an exception to the rule, but because it has no underlying list to show around it.
- **Layout**: large countdown from the chosen preset/custom duration (`jarvisGladiatorState.endsAt`), optional user-entered label shown above it, no outer rail (nothing to rail — a single countdown ring substituting for the segment bar — static fill, recalculated each second from the absolute end time, not a continuously re-triggered animation).
- **Primary action**: none required until time's up — a quiet `[END EARLY]` ghost link is always available. At `endsAt`, one haptic pulse (`navigator.vibrate(30)`) and auto-transition to debrief — no alarm sound (explicitly excluded per the product brief).
- **Debrief treatment**: see §8.5 — honestly labeled as untracked-by-domain-data, its only "stat" is duration, sourced from `jarvisGladiatorSessions` itself (the one case where Gladiator's own log *is* the primary record, since no domain module owns unstructured focus time).

---

## 8. Debrief screen

### 8.1 TRAINING debrief (flagship — matches the product brief's worked example exactly)

Computed the instant `finish()` returns the saved `jarvisWorkouts` session:

```
┌─────────────────────────────────────┐
│                                       │
│          MISSION COMPLETE            │  20px uppercase, --text-faint
│                                       │
│          Push Day — 54 min           │  28px/700, --text
│                                       │
│  ✓BEN ✓INC ✓TRI ✓SHO ✓DIP ✓CUR ✓CAL ✓FLY │ ← the outer Lineup, one more time,
│                                       │    every row now "done" (§2.3 receipt)
│   Exercises        8 / 8             │
│   Working Sets     21                │
│   PRs              2                 │
│   Total Volume     12,840 lb         │
│                                       │
│   Compared with last Push Day:       │
│   Volume ↑ 6%   ·   Duration ↓ 4 min │
│                                       │
│   "3rd rep-PR streak this week —     │
│    bench is moving."                 │
│                                       │
│ ┌───────────────────────────────────┐│
│ │             FINISH                ││
│ └───────────────────────────────────┘│
└─────────────────────────────────────┘
```

Field-by-field source:
- **The receipt row** (`✓BEN ✓INC ...`): the exact same `renderLineup()` call used in §6.2, re-rendered from the final `getExerciseLineup()` state with every item forced to `done` (an exercise with zero logged sets still shows as the hollow `pending` ring here, honestly — "8/8" below is the real completion count, this row never silently promotes an untouched exercise to a check). At >4 items it renders `pill` density exactly as execution did, no new layout.
- **"Push Day — 54 min"**: title = same routine/program-day naming logic as `getSummary()`'s `lastWorkout.name` (routine name, or program name + day label, or "Freestyle Workout"); duration = `Math.round((finishedAt - jarvisGladiatorState.startedAt) / 60000)`.
- **"Exercises 8/8"**: `completedExerciseCount` (exercises with ≥1 completed set) `/` `draft.exercises.length` at the moment of finishing.
- **"Working Sets 21"**: count of all `isCompletedSet` sets across the saved session **excluding** `warmup === true` (a "working set" is explicitly non-warmup, matching lifting convention and avoiding inflating the number).
- **"PRs 2"**: count of exercises where `getExercisePrAndE1rm(exerciseId).bestE1rm` *after* saving > `preMissionSnapshot[exerciseId]` (§6.4) — i.e., exercises that left the session with a strictly higher all-time e1RM than they entered with.
- **"Total Volume 12,840 lb"**: `Σ (weight × reps)` over **all** completed sets in the saved session, including warmups — matching the exact convention `renderVolumeChart()`/`computeMuscleVolume()` already use elsewhere in the app, so this number is never inconsistent with the Progress tab.
- **Comparison row**: previous session for comparison = the most recent **other** `jarvisWorkouts` entry with the same `routineId` (or, if freestyle, the same first-`exerciseId`) before this one. `Volume ↑6%` = `(thisVolume - prevVolume) / prevVolume`, rounded to nearest whole percent. `Duration ↓4 min` = `thisDurationMin - prevDurationMin` (prev duration computed the same way from that session's own Gladiator log entry if it exists; if that prior session wasn't run through Gladiator — e.g. logged the old way — duration is omitted from the comparison line entirely rather than guessed, and the line reads `"Volume ↑6%"` alone). **If no prior session with the same routine exists at all**, this entire row is replaced with: `"No prior {routineName} session to compare — this is the first."`
- **Coach's Voice takeaway (exactly one sentence)**: selected by the priority rule in §8.6.

### 8.2 BUSINESS debrief

```
MISSION COMPLETE
✓ {task text} — {mm:ss or m min}        ← the one-item Lineup, hero one final
                                            time, now in its "done" state
Status: ✓ Completed   (or:  Not finished — ended early)

"That clears your only High-priority task due today."

[FINISH]
```
- The task line *is* the mission's Lineup, rendered once more in its final state — not a separately designed debrief header. With a single-item Lineup this looks identical to the original flat header line; the distinction only becomes visible when Business is run with more than one open task queued behind it (§7.2's preview rows), which this debrief does not re-show (they were never part of the mission, only previewed).
- Status line is literal (`task.completed` after the mission, set via the real completion toggle — never implied otherwise).
- Takeaway line sources from §8.6's Business rules (e.g., remaining open task count from `data.tasks.filter(!completed).length`, or `activeGoals` from `getSummary()`).

### 8.3 HABITS debrief

```
MISSION COMPLETE
{n}/{n} habits — {mm:ss}

✓ Read 20 Pages        (streak: 12 days)
✓ Stretch               (streak: 3 days)
✓ No Added Sugar        (first completion)

"You've completed {X} of {Y} planned workouts this week."  ← only if relevant,
  or a habits-specific line, see §8.6

[FINISH]
```
- This checklist is, literally and without modification, the mission's Lineup rendered fully `done` (§2) — the same `.lineup-row` markup the execution screen used, just every row now carrying a check. No separate debrief layout was designed for Habits; it didn't need one.
- Each row's streak annotation = `computeCurrentStreak(habit)` **after** incrementing, with `"first completion"` shown verbatim (never `"0-day streak"`) when the streak is exactly 1 and the habit's `completions` object had no prior truthy entries.
- If the user ended early (`habitsQueueIndex` < queue length), header instead reads `"{done}/{total} habits — ended early"`, and the remaining items in the Lineup correctly show as `pending`, not silently dropped.

### 8.4 STUDY debrief

```
MISSION COMPLETE
✓ {task text} — {mm:ss}                 ← or the full queue's Lineup, done/
                                            pending, when more than one was queued
Status: ✓ Completed  (or: Ended early)

"This is your Nth Study session logged this week."
  — from jarvisGladiatorSessions filtered type:"study", this ISO week

[FINISH]
```
- When the Study mission ran as a multi-item queue (§7.4), the debrief shows the same receipt treatment as Habits (§8.3): every queued task as a Lineup row, `done` for completed, `pending` for any left when the user ended early. With a single candidate it collapses to the same one-line hero-as-receipt shown above, identical in spirit to Business's single-item case.

### 8.5 DEEP WORK debrief

```
MISSION COMPLETE
{label or "Deep Work Session"} — {planned} min planned, {actual} min run

"{N} Deep Work sessions this week, {totalMin} min total."
  — from jarvisGladiatorSessions filtered type:"deepwork", this ISO week

[FINISH]
```
Explicitly the only debrief whose stats come entirely from Gladiator's own `jarvisGladiatorSessions` log rather than a domain module — stated here so an implementer doesn't go looking for a nonexistent "focus time" field elsewhere. Consistent with §2.2, Deep Work's Lineup has zero items both during execution and here, so there is nothing to collapse into a receipt — only the stats above.

### 8.6 Coach's Voice takeaway — selection priority (one sentence, never stacked)

The debrief always shows **exactly one** takeaway sentence, chosen by the first matching rule below (checked top to bottom, first match wins) per mission type. This prevents the "meaningless XP spam" failure mode of showing five congratulatory lines at once.

**Training**, in order:
1. A PR occurred this session (`prCount > 0`) → `"New e1RM PR on {exercise name} — {new} lb (prev {old})."` (if multiple PRs, name the largest % jump).
2. No PR, but this is a weekly PR streak (≥2 PR-containing sessions in the trailing 7 days, computed by scanning `jarvisWorkouts` chronologically and flagging any set whose e1RM exceeded the running best *at the time it was logged* — see algorithm note below) → `"{n}rd/th rep-PR streak this week — {muscle group} is moving."`
3. No PR, but volume beat the same-routine comparison (`volumeDeltaPct > 0`) → `"Volume ↑{pct}% vs. last {routineName} — {exercise with biggest per-set jump} led it."`
4. No comparison data at all (first time this routine is run) → `"First logged {routineName} — today's numbers are the baseline to beat next time."`
5. Fallback (session complete, no PR, volume flat/down) → `"{streak}-day training streak — showing up is the stat that compounds."` (from `dayStreak()`).

**Business**: 1) if this was the task's own `deadline === today` → `"That was the only High-priority item due today — done."`; 2) else if `data.tasks.filter(t=>!t.completed).length === 0` → `"Task list is clear."`; 3) else → `"{n} task(s) still open — Gladiator again when you're ready for the next one."`

**Habits**: 1) if every habit in `getRemainingToday()`'s original snapshot is now done → `"All {n} habits complete today."`; 2) else if any completed habit hit a new best streak (`computeCurrentStreak` after > the habit's previous max recorded in its own history) → `"{habit} just hit a new {n}-day best."`; 3) else → `"{done}/{total} habits done today."`

**Study / Deep Work**: the weekly count lines shown in §8.4/§8.5 directly (no further branching needed — there's only one real signal available, so no priority ladder is required).

*Algorithm note (weekly PR streak, Training rule 2):* iterate `jarvisWorkouts` with `schema===2` sorted by `dateTime` ascending; maintain `runningBestE1rm[exerciseId]`; for each set, if `estimateOneRepMax(weight,reps) > runningBestE1rm[exerciseId]`, mark that **session** as "PR-containing" for that exercise and update the running best. Count distinct PR-containing sessions in the trailing 7 days. This is the only way to compute "Nth PR this week" without fabricating it — it's a deterministic replay of real logged history, not a stored flag.

### 8.7 Debrief interaction & motion

- Debrief fades in from the final mission state over 200ms (`opacity 0→1`, `translateY(8px→0)`), no bounce/overshoot easing. The Lineup receipt (§8.1, §8.3, §8.4) fades in as a single unit with the rest of the debrief — its rows do not stagger in one-by-one, consistent with "no arcade feedback."
- Numbers do **not** count up/animate — they render final immediately. (Counting-up number animations read as "arcade," explicitly excluded.)
- One satisfying-but-restrained haptic on debrief entry: `navigator.vibrate([20])` for a plain completion, `navigator.vibrate([20,40,20])` only when `prCount > 0` (Training) — a single double-tap pattern reserved for the genuinely rare case, never the default.
- `[FINISH]` is the only button; tapping it closes the overlay, restores `.main-nav`/`.sub-nav` display, and deep-links to the relevant domain tab already scrolled/focused on the changed data (e.g. Training → Workout → Log tab showing the just-saved session; Business → Tasks tab with the completed task visible).

---

## 9. Visual & motion identity

### 9.1 Palette (reuses existing tokens — no new identity)

| Token | Value | Use in Gladiator |
|---|---|---|
| `--bg` | `#0a0e14` | overlay background, full-bleed |
| `--card` | `#151a24` | mission cards, objective panels |
| `--card-border` | `#232939` | card borders, Lineup row borders, `pending` glyph ring |
| `--accent` | `#4f8cff` | Coach's Voice line color, `current`-row accents, primary progress states |
| `--green` | `#33d17a` | `done`-row glyph fill, "all done" states, success checks |
| `--purple` | `#9b6bff` | PR-only moments (banner text, double-haptic trigger) — reserved exclusively for PR/record-breaking content, exactly as Progress tab already reserves it for e1RM/PR data |
| `--text` / `--text-dim` / `--text-faint` | as defined | hierarchy: objective (text) > meta (dim) > eyebrow labels / pending labels (faint) |

No flame orange, no red-gold "battle" gradient, no new hue introduced. The Lineup's `done`/`pending` glyphs reuse `--green`/`--card-border` directly — no new color was invented for the mechanism that unifies the five missions. The one deliberate addition is treating `--purple` as "this is a record" exclusively within Gladiator too, reinforcing an existing association rather than inventing a new one.

### 9.2 Typography

- Eyebrow labels (mission type, "MISSION COMPLETE"): 11–13px, `uppercase`, `letter-spacing: 0.1–0.14em`, `--text-faint` — restrained, not shouty despite the caps (small size + dim color keeps it quiet).
- Objective / exercise name: 24–28px, weight 700, `-0.01em` tracking — the single largest text on any Gladiator screen, always the current Lineup item's hero.
- Lineup `line`-density rows: 13px, `--text-dim` (pending) or `--text` (done, with the green glyph doing the "this one's finished" signaling rather than color-shifting the text). `pill`-density rows: 10px, same color rules, label truncated to a fixed-width fragment so pills never reflow.
- Coach's Voice lines: 13–14px, italic, `--accent` (or `--purple` for PR moments), max 2 lines with ellipsis overflow protection — never a popup, always inline, never pushes layout when it changes length (reserve a fixed 2-line-height slot).
- Numbers (sets, volume, timers): tabular/monospace-leaning via `font-variant-numeric: tabular-nums` so countdowns and set counts don't jitter horizontally as digits change.

### 9.3 Motion

- **Entry transition** (Normal JARVIS → Gladiator): 220ms. The current tab content scales to 0.97 and fades to 40% opacity while the Gladiator overlay fades in and scales from 1.02→1.0 — a single crossfade+scale, not a flashy wipe/flip. Matches "subtle screen transition, slight visual intensity increase."
- **Exit transition**: reverse of entry, 180ms.
- **Lineup state changes** (a row promoted from `pending`/`done` to `current`/hero, or demoted the other way) use the same ≤200ms opacity/transform envelope as every other in-mission transition — this is not a new animation primitive, it's the one motion rule in this document applied to the one structural component in this document.
- **All other in-mission transitions** (set logged, exercise advance, rest timer swap) are ≤200ms opacity/transform only — no looping/idle animation anywhere on screen. The Lineup's `pending`/`done` glyphs do not pulse, glow, or shimmer; they are a static fill that changes instantly when state changes.
- **`prefers-reduced-motion: reduce`**: every transition above collapses to an instant (`0ms` / display-swap) state change — no crossfade, no scale, no slide. Implemented as:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .gladiator-overlay, .gladiator-overlay * {
      transition-duration: 0.001ms !important;
      animation-duration: 0.001ms !important;
    }
  }
  ```
  (JARVIS's `style.css` currently has no reduced-motion handling anywhere — this is the first, scoped to Gladiator's own rules so it doesn't risk unrelated regressions elsewhere in the app.)
- **Haptics**: every single use is enumerated in this document (§6.3 set-logged/PR/rest-done, §7.5 timer-done, §8.7 debrief-entry) — there is no ambient or repeating haptic. All calls go through one feature-detected helper:
  ```js
  function hapticPulse(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }
  ```

### 9.4 Explicitly excluded (confirmed against the product brief)

No flame/fire imagery, no battle sound effects (no `<audio>` element anywhere in Gladiator's files), no continuously-looping animation (shimmer, pulse, particle, glow-breathing), no cartoon gladiator/sword/helmet graphics or emoji in any template string, no XP/points/level-up system, no generic hype copy ("You crushed it!", "Amazing job!") — every string in §5, §6, §7, §8 is either a literal field value or a template with a named data source.

---

## 10. Navigation integration

### 10.1 Header button markup (added to `.header-inner`, after the existing title)

```html
<button type="button" id="gladiatorEntryBtn" class="gladiator-entry-btn" aria-label="Enter Gladiator Mode">GLADIATOR</button>
```
```css
.gladiator-entry-btn {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--card-border);
  background: transparent;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.gladiator-entry-btn.has-mission {
  border-color: var(--accent);
  color: var(--text);
}
```
`has-mission` is toggled on load / on tab switch / after any domain save event by a cheap check: any of `JarvisWorkout.gladiator.getCandidate()`, `JarvisBusiness.gladiator.getTopTask()`, `JarvisHabits.gladiator.getRemainingToday().length>0` is truthy.

### 10.2 Suppressing navigation while active

```js
function enterGladiatorChrome() {
  document.body.classList.add("gladiator-active");
}
function exitGladiatorChrome() {
  document.body.classList.remove("gladiator-active");
}
```
```css
body.gladiator-active .app-header,
body.gladiator-active .main-nav,
body.gladiator-active .sub-nav,
body.gladiator-active .app-main { display: none; }
body.gladiator-active #gladiatorOverlay { display: block; }
```
This is a pure CSS visibility switch — underlying tab state (`draft`, scroll positions, open sub-tabs) is untouched and exactly as the user left it whenever they exit.

### 10.3 Resume-on-relaunch

On `DOMContentLoaded`, `js/gladiator.js` checks `jarvisGladiatorState.activeSessionId`. If set:
- **Training**: silently re-enters Training execution UI (no mission-select detour) — the draft itself already has everything needed; the outer Lineup rebuilds from `getExerciseLineup()` and the inner Lineup from the now-current exercise's `getActiveView().setsLineup`, both derived fresh from the draft, nothing resume-specific to store.
- **Business**: re-enters execution UI showing the frozen objective from `jarvisGladiatorState.objective`.
- **Habits**: re-enters with `habitsQueue`/`habitsQueueIndex` restored, rebuilding the Lineup exactly as it was mid-mission.
- **Study**: re-enters with `studyQueue`/`studyQueueIndex` restored — identical mechanism to Habits, same storage shape (§3.3).
- **Deep Work**: re-enters with the countdown recomputed from `endsAt`; if `endsAt` has already passed while the app was closed, it goes straight to the debrief instead of a negative countdown.

### 10.4 Mobile / one-handed specifics

- All primary actions (Log Set, Mark Done, Mark Complete, Finish) are bottom-anchored within `calc(16px + env(safe-area-inset-bottom))` of the viewport bottom — thumb zone on any phone size.
- Minimum touch target 44×44px for secondary controls, 56px height for primary full-width buttons, matching the dimensions already used by `.btn` in `style.css`. Lineup `line` rows are 36px, `pill` rows 28px — both below the 44px interactive minimum deliberately, since they are secondary/jump targets, not primary actions; their tap area is padded to 44px minimum even though their visual box is shorter.
- No horizontal scrolling anywhere in Gladiator (unlike the main app's horizontally-scrolling `.sub-nav` bars) — mission cards, the Lineup rail, exercise content, and debrief stats all stack and wrap vertically, 16px side gutters, `max-width: 480px` centered on tablet/desktop widths so it never stretches into an unreadable wide layout. The `pill`-density Lineup rail wraps onto a second line rather than scrolling horizontally when it doesn't fit one row (e.g. an unusually long 10-exercise freestyle session).
- The ✕ exit control sits top-left (natural left-thumb/right-thumb reach for a one-handed hold) and is never smaller than 44×44px despite the otherwise-minimal top bar.

---

## 11. Edge cases & honesty guarantees

| Situation | Behavior |
|---|---|
| User opens Gladiator with literally no data anywhere (fresh install) | All five mission cards show their "nothing queued" empty states (§5.2); Deep Work remains the one always-runnable option. No synthetic "Welcome, Gladiator!" copy. |
| Training mission started, user abandons mid-set (closes PWA) | `jarvisWorkoutDraft` already autosaves every change (existing behavior) — nothing Gladiator-specific needed; next Gladiator open on Training resumes exactly where the draft left off (§10.3). |
| Comparison requested but no prior session exists | Explicit sentence stating there's nothing to compare (§8.1), never a 0%/blank chart. |
| A set's `routineTargetForSet` returns null (freestyle addition) | Target line, the "OF N" suffix, and any inner-Lineup pending-set previews are omitted, not shown as "Target: -- × --". |
| PR detection with zero prior history for an exercise | Treated as "no PR possible yet" (nothing to beat) — Coach's Voice instead says `"First logged set for {exercise} — today sets the baseline."`, never claims a PR against a nonexistent baseline. |
| Business/Study task deleted elsewhere mid-mission (rare, e.g. multi-tab) | `completeTask(id)` no-ops safely (mirrors existing module behavior of `.find()` returning undefined); debrief shows `"Task no longer found — session logged, nothing changed."` |
| `navigator.vibrate` unsupported (iOS Safari/PWA) | `hapticPulse()` silently no-ops; no visual compensation needed since haptic is always paired with a visual state change already. |
| A Lineup has only one item (short freestyle Training session with one exercise; Business/Study with a single open item) | Renders as pure hero, zero `done`/`pending` rail — this is not special-cased code, it's §2.2's general rule applied to a list of length 1. |
| A Lineup has more than 4 non-current items | Density automatically switches from `line` to `pill` (§2.1); items are never truncated or hidden, only rendered more compactly — an outer rail of 9 exercises shows all 9, just smaller. |
| A Business or Study preview row (pending, display-only) is tapped during execution | No-op (`pointer-events: none` on non-interactive Lineup rows) — this is deliberate per §2.2's asymmetry note, so the preview never gets mistaken for Training's/Habits' real jump-to-item behavior. |
| Study has more than one tagged task | Entered as a frozen queue identical in mechanism to Habits (§7.4), oldest `createdAt` first — there is no separate picker screen to build or maintain. |

