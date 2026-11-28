# Workout: "Today" target for each exercise

Under **Last time** in the live logger, every exercise now has a line like

> **TODAY**  3 sets × 8 reps at 150 lb  `up 5 lb`      Why?      [Use 150 lb]

It answers "how many sets, how many reps and what weight" for that exercise, and **Why?** shows the numbers it used. Nothing changes until you tap **Use**, and a set only counts once you mark it done (same as before).

## The rules (written, not an AI; `todayTarget` in `workout-logic.js`)

* **Sets and reps** come from the workout you started: its working sets for that exercise (warm-ups and drop sets are not counted) and their rep targets. An exercise added on the spot has no plan, so it uses the same number of sets and reps as last time.
* **Weight** starts from the heaviest working weight of your **last session** of that exercise (the "working weight", W):
  * **Up one small step** (5 lb, or 2.5 lb under 30 lb) when, last time at W, you did every planned working set and each one reached its rep target, and no set at W was rated RPE 9.5 or more.
  * **Same weight** otherwise, and the Why? says what was missing (for example "8, 7, 6 reps at 145 lb" or "only 1 of the 3 sets were at that weight"). The same weight is also kept when a set at W felt very hard (RPE 9.5+).
  * **Same weight after more than 28 days away** (no increase), and **same weight when the workout has no rep target** for the exercise (nothing to measure last time against).
  * **No weight at all the first time you log an exercise.** Nothing in your log says what to lift, so none is invented. The Why? gives one line of general advice and labels it as general advice.
* A pyramid plan (different reps per set) is measured set by set. Bodyweight work (0 lb) has no weight to suggest.

## Relation to what was already there

* The older **"Ready to progress"** note (needs the same target reached in your **last two** sessions) is unchanged and still appears when its rule fires. When it is showing its own **Use** button, the target line does not add a second one.
* The grey numbers in the set rows ("Last" column and the dim pre-filled weight) are still last time's numbers; they are not the target.

## Limits

* It only knows what is in your log. It does not know your body, your recovery, your equipment's plate sizes, or whether last time was a bad day. The step is a standard small one; type any weight you like.
* If your workout's plan has the wrong number of sets or reps for an exercise, the target shows that plan. Fix it in Routines.
* Tested with 10 unit tests (the rule) and 14 browser checks (Chromium, 390 px); axe clean at 320 to 1200 px. Not tried on a real iPhone. The "no plan" case (an exercise added on the spot) is covered by the unit tests only, not by a browser test.
