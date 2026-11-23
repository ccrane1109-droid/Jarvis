# Muscle map

**Workout › Progress › Muscles.** Both sides of the body, side by side, with each muscle coloured by how many sets you did.

```
BODY MAP                         [ Week ] [ Month ]
Last 30 days · Oct 20 – Nov 18

   front            back
  (figure)         (figure)

 0 sets  1–3  4–6  7–9  10–12  13
 Tap a muscle for its sets, last workout and exercises.
```

## What you see

* **Front and back together**, large enough to tell the muscles apart: about 180 separate regions in all (the pecs, the deltoid in front, side and rear parts, the biceps, the triceps, the forearm muscles, the abs block by block, the obliques, the traps, the lats, the lower back, the glutes, the three heads of the quads, the hamstrings, the calves ...). The figures are exactly symmetrical.
* **Dark when there are no sets.** As sets go up, a muscle steps through five shades of blue (the same blue steps as the other charts). The thin white outline stays on every region, so the shapes can be read whatever the colour.
* **The scale** under the figures follows your busiest muscle: its steps split 1 to that muscle's sets into five equal bands, so the lightest blue always means "the most this period". The last step reads "13+" style when it spans more than one number.
* **Week** is the last 7 days and **Month** is the last 30 days, both counting today. It does not follow the period at the top of the screen; the list "Sets by muscle" below the map still does.

## Tap a muscle

A panel opens out under the legend:

| | |
|---|---|
| **Name** | the muscle (and the anatomical name of what is drawn, where the drawing is sure of it: "Pectoralis major") |
| **Last 7 days / Last 30 days** | working sets, and about how many a week the 30 days make |
| **Last workout** | how many days ago, and the date: the last time it was the *main* muscle of a set. If it never was, it says "Not yet" and doesn't invent a date |
| **Exercises** | the exercises that counted, most sets first, for the period the map shows |

All the regions of the same muscle are outlined together, on both figures, and the rest step back. Tap it again, or press Close, to fold the panel away. Tapping the head, hands, feet or the joints does nothing.

**Muscles JARVIS doesn't count.** The drawing also shows the neck, the sartorius, the inner thigh, the hip (tensor fasciae latae) and the lower abdomen. No exercise in the app is counted toward them, so they are never coloured; tapping one says so rather than showing numbers.

**Keyboard:** the map is one tab stop. Arrow keys move between the 17 muscles (a dashed outline shows where you are, and it is read out), Enter opens one, Escape closes it.

## Where the numbers come from

Nothing is new here: it is the same saved workouts and the same exercise-to-muscle table as the rest of Progress.

* A **working set** is any set not marked warm-up. Each counts 1 for the exercise's main muscles (`JarvisExercises.getFineMuscleTargets`). "Count helping muscles as half a set" (the box above the map) adds half a set for the muscles that help; it applies to the map and to the list below it.
* Sets, last workout and exercises are worked out in `js/progress-logic.js` (`mapWindow`, `muscleDetail`, `muscleExercises`), with tests.
* **The upper back** is never the main muscle of any exercise in the app (rows count for the lats, with the upper back helping), so it only lights up when helping muscles are counted.

## How it is built

* `js/musclemap-art.js` draws the figures. Every region is its own SVG `<path>`, so it is coloured and tapped on its own. The left half of each figure is stored; the right half is the same shapes mirrored when the map is drawn. Three kinds of region: a muscle JARVIS counts (one of the 17 in `JarvisExercises.FINE_MUSCLES`; all regions of one muscle share a colour and are selected together), a muscle that is drawn but not counted, and structure (head, hands, feet, joints) that is drawn but not tappable.
* `js/progress-ui.js` colours it (`JarvisCharts.heatColor`), draws the legend, and opens the panel. Selecting a muscle only changes classes on the drawing; the figures are redrawn only when the colours change (Week / Month, the helping-muscles box).
* The older Body Map card in `js/workout.js` (hidden; it only shows if the Progress code fails to load) draws the same figures, one side at a time.
* **Where the shapes came from.** They were traced from the outline-only anatomy illustration supplied as the design reference: each outlined area became a closed curve, the figure was made symmetrical, and the deltoid was divided into its front / side parts (and rear / side from behind). This was a one-off job; the file is not generated at run time.

## Limits worth knowing

* The map shows **sets**, not how hard a muscle worked, and not recovery or strength level (those were removed from Progress earlier because they needed standards the app can't back up).
* Some drawn regions are a judgement call about which tracked muscle they belong to: the thin strips on the sides of the upper arm are counted as triceps, the slivers beside the abs as obliques (that includes the serratus), and the strip on the outside of the thigh seen from behind as quads (vastus lateralis).
* Tested in Chromium at phone and desktop sizes; not on a real iPhone.
