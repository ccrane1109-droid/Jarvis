"use strict";

// Dates and weeks are the phone's own, so these run in New York time (clocks go back on Nov 1 2026).
process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../../js/workout-logic");

const set = (weight, reps, o) => Object.assign({ weight: weight, reps: reps, warmup: false, dropset: false }, o || {});
const sess = (id, date, exercises, o) => Object.assign({ id: id, schema: 2, dateTime: date + "T18:00", date: date, routineId: null, programId: null, programDayId: null, notes: "", duration: 60, exercises: exercises, createdAt: Date.parse(date + "T18:00:00") }, o || {});
const ex = (exerciseId, sets) => ({ exerciseId: exerciseId, sets: sets });
const at = (m, d, h, mi) => new Date(2026, m - 1, d, h || 0, mi || 0).getTime();

test("estimated 1RM: the weight itself for one rep, Epley otherwise, zero for nonsense", () => {
  assert.equal(W.e1rm(100, 1), 100);
  assert.ok(Math.abs(W.e1rm(100, 5) - 116.6667) < 0.001);
  assert.equal(W.e1rm(0, 5), 0);
  assert.equal(W.e1rm(100, 0), 0);
  assert.equal(W.e1rm(-5, 5), 0);
  assert.equal(W.e1rm("", 5), 0);
});

test("working sets and volume leave out warm-ups and sets with no numbers", () => {
  const sets = [set(60, 10, { warmup: true }), set(100, 5), set(100, 5), set("", 5), set(100, ""), set(0, 12)];
  assert.equal(W.working(sets).length, 3, "bodyweight work at 0 still counts as a set");
  assert.equal(W.volumeOf(sets), 1000);
});

test("days: keys, adding days across a month and a clock change, the Monday-first week", () => {
  assert.equal(W.dayKey(at(11, 1, 23, 30)), "2026-11-01");
  assert.equal(W.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(W.addDays("2026-11-01", 1), "2026-11-02");
  assert.equal(W.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(W.mondayIndex("2026-11-02"), 0);
  assert.equal(W.mondayIndex("2026-11-01"), 6, "Sunday is the last day of the week");
  assert.equal(W.weekStart("2026-11-04"), "2026-11-02");
  assert.equal(W.weekStart("2026-11-01"), "2026-10-26");
});

test("last time: the newest session with that exercise, optionally before a moment, never a legacy entry", () => {
  const ws = [
    sess("a", "2026-10-05", [ex("bench", [set(135, 8)])]),
    sess("b", "2026-10-12", [ex("bench", [set(140, 8)]), ex("row", [set(100, 8)])]),
    sess("c", "2026-10-19", [ex("squat", [set(185, 5)])]),
    { id: "old", dateTime: "2026-10-30T10:00", date: "2026-10-30", name: "Quick log", sets: 3 }
  ];
  assert.equal(W.previousPerformance(ws, "bench").date, "2026-10-12");
  assert.equal(W.previousPerformance(ws, "bench", "2026-10-12T18:00").date, "2026-10-05", "strictly before");
  assert.equal(W.previousPerformance(ws, "row").sets[0].weight, 100);
  assert.equal(W.previousPerformance(ws, "curl"), null);
  assert.equal(W.previousPerformance([], "bench"), null);
  assert.equal(W.previousPerformance(null, "bench"), null);
});

test("the 'last time' line lists working sets only", () => {
  const prev = { sets: [set(75, 8, { warmup: true }), set(135, 8), set(150, 6)] };
  assert.equal(W.lastTimeText(prev), "135 × 8, 150 × 6");
  assert.equal(W.lastTimeText(null), "");
  assert.equal(W.lastTimeText({ sets: [set(75, 8, { warmup: true })] }), "");
});

test("suggestions line sets up by type, and run out gracefully", () => {
  const prev = [set(75, 8, { warmup: true }), set(135, 6), set(150, 6)];
  const s = W.suggestForPlan(["warmup", "normal", "normal", "normal"], prev);
  assert.deepEqual(s, [{ weight: 75, reps: 8 }, { weight: 135, reps: 6 }, { weight: 150, reps: 6 }, { weight: 150, reps: 6 }]);
  assert.deepEqual(W.suggestForPlan(["normal", "normal"], []), [null, null]);
  assert.deepEqual(W.suggestForPlan(["normal"], null), [null]);
  assert.deepEqual(W.suggestForPlan(["dropset"], [set(100, 8)]), [{ weight: 100, reps: 8 }], "no drop set last time: use the working set");
  assert.deepEqual(W.suggestForPlan(["dropset", "normal"], [set(100, 8), set(70, 10, { dropset: true })]), [{ weight: 70, reps: 10 }, { weight: 100, reps: 8 }]);
});

test("a routine's planned sets, the way the Routines tab reads them", () => {
  assert.deepEqual(W.plannedSetsOf({ targetSets: 3, targetReps: 8 }), [{ reps: 8, type: "normal" }, { reps: 8, type: "normal" }, { reps: 8, type: "normal" }]);
  assert.deepEqual(W.plannedSetsOf({ targetSets: 2, repsPerSet: [10, 8] }).map((p) => p.reps), [10, 8]);
  assert.deepEqual(W.plannedSetsOf({ plannedSets: [{ reps: 12, type: "warmup" }, { reps: 5 }] }), [{ reps: 12, type: "warmup" }, { reps: 5, type: "normal" }]);
  assert.equal(W.plannedSetsOf({}).length, 1);
  assert.equal(W.plannedSetsOf({ targetSets: 99 }).length, 20, "capped");
});

test("personal bests ignore warm-ups, and ties go to more reps", () => {
  const ws = [
    sess("a", "2026-10-05", [ex("bench", [set(200, 1, { warmup: true }), set(135, 8), set(145, 5)])]),
    sess("b", "2026-10-12", [ex("bench", [set(145, 6)])])
  ];
  const b = W.bestSets(ws, "bench");
  assert.deepEqual(b.heaviest, { weight: 145, reps: 6, date: "2026-10-12" });
  assert.equal(Math.round(b.e1rm.value * 10) / 10, 174);
  assert.equal(W.bestSets(ws, "bench", "2026-10-12T18:00").heaviest.reps, 5, "only what came before");
  assert.deepEqual(W.bestSets(ws, "curl"), { heaviest: null, e1rm: null });
});

test("a session's records: beaten by weight or by estimated 1RM, and the first time is only a baseline", () => {
  const history = [sess("a", "2026-10-05", [ex("bench", [set(135, 8)]), ex("squat", [set(185, 5)])]), sess("b", "2026-10-12", [ex("bench", [set(140, 6)])])];
  const today = sess("c", "2026-10-19", [
    ex("bench", [set(60, 10, { warmup: true }), set(145, 6)]),
    ex("squat", [set(185, 5)]),
    ex("curl", [set(30, 10)]),
    ex("row", [set(300, 1, { warmup: true })])
  ]);
  const prs = W.sessionPRs(history, today);
  assert.equal(prs.length, 1, "squat matched (no record), curl is a first, row has only a warm-up");
  assert.equal(prs[0].exerciseId, "bench");
  assert.deepEqual(prs[0].kinds, ["weight", "e1rm"]);
  assert.deepEqual([prs[0].weight, prs[0].reps, prs[0].e1rm, prs[0].previousE1rm, prs[0].previousHeaviest], [145, 6, 174, 171, 140]);
  const same = sess("d", "2026-10-26", [ex("bench", [set(140, 6)])]);
  assert.deepEqual(W.sessionPRs(history, same), [], "equalling a best is not a record");
  const lighter = sess("e", "2026-10-26", [ex("bench", [set(120, 15)])]);
  assert.deepEqual(W.sessionPRs(history, lighter).map((p) => p.kinds), [["e1rm"]], "more reps at a lighter weight can raise the estimate");
  assert.deepEqual(W.sessionPRs([today].concat(history), today).length, 1, "the session itself is not in its own history");
});

test("a session logged for an earlier date is judged only on what came before that date", () => {
  const ws = [sess("late", "2026-10-26", [ex("bench", [set(200, 1)])])];
  const early = sess("early", "2026-10-05", [ex("bench", [set(135, 8)])]);
  assert.deepEqual(W.sessionPRs(ws, early), []);
});

test("record history: newest first, each judged on what came before it", () => {
  const ws = [
    sess("a", "2026-10-05", [ex("bench", [set(135, 8)])]),
    sess("b", "2026-10-12", [ex("bench", [set(140, 8)])]),
    sess("c", "2026-10-19", [ex("bench", [set(140, 8)])]),
    sess("d", "2026-10-26", [ex("bench", [set(145, 6)]), ex("squat", [set(185, 5)])])
  ];
  const all = W.recentPRs(ws);
  assert.deepEqual(all.map((e) => [e.date, e.exerciseId]), [["2026-10-26", "bench"], ["2026-10-12", "bench"]]);
  assert.equal(W.recentPRs(ws, { limit: 1 }).length, 1);
  assert.equal(W.recentPRs(ws, { sinceDate: "2026-10-20" }).length, 1);
  assert.deepEqual(W.recentPRs([], {}), []);
});

test("session numbers", () => {
  const s = sess("a", "2026-10-05", [ex("bench", [set(60, 10, { warmup: true }), set(135, 8), set(135, 7)]), ex("row", [set("", 8)]), ex("curl", [set(30, 10)])], { duration: 55 });
  assert.deepEqual(W.sessionStats(s), { exercises: 2, workingSets: 3, warmupSets: 1, volume: 135 * 8 + 135 * 7 + 300, durationMin: 55 });
  assert.equal(W.sessionStats(sess("b", "2026-10-05", [], { duration: null })).durationMin, null);
});

test("compared with the last time you did the same routine", () => {
  const a = sess("a", "2026-10-05", [ex("bench", [set(100, 10)])], { routineId: "push", duration: 60 });
  const b = sess("b", "2026-10-12", [ex("bench", [set(100, 10)])], { routineId: "push", duration: 56 });
  const c = sess("c", "2026-10-19", [ex("bench", [set(100, 10), set(100, 10)])], { routineId: "push", duration: 70 });
  const other = sess("o", "2026-10-15", [ex("squat", [set(200, 5)])], { routineId: "legs" });
  const cmp = W.compareToPrevious([a, b, other], c);
  assert.deepEqual([cmp.date, cmp.volumePct, cmp.volumeDelta, cmp.durationDelta, cmp.setsDelta], ["2026-10-12", 100, 1000, 14, 1]);
  assert.equal(W.compareToPrevious([a], a), null, "nothing earlier");
  assert.equal(W.compareToPrevious([a, b], sess("n", "2026-10-26", [ex("bench", [set(1, 1)])])), null, "no routine, nothing fair to compare");
  const noTime = W.compareToPrevious([sess("p", "2026-10-05", [ex("bench", [set(100, 10)])], { routineId: "push", duration: null })], c);
  assert.equal(noTime.durationDelta, null);
});

test("the week: Monday to Sunday, which days, how many, and last week's count", () => {
  const ws = [
    sess("a", "2026-10-26", [ex("bench", [set(100, 10)])]),
    sess("b", "2026-11-02", [ex("bench", [set(100, 10)])], { duration: 50 }),
    sess("c", "2026-11-04", [ex("bench", [set(100, 5)])], { duration: 40 })
  ];
  const w = W.weekSummary(ws, at(11, 4, 20), 3);
  assert.equal(w.start, "2026-11-02");
  assert.deepEqual(w.days.map((d) => d.trained), [true, false, true, false, false, false, false]);
  assert.deepEqual(w.days.map((d) => d.today), [false, false, true, false, false, false, false]);
  assert.deepEqual(w.days.map((d) => d.future), [false, false, false, true, true, true, true]);
  assert.deepEqual([w.count, w.lastWeekCount, w.minutes, w.volume, w.target], [2, 1, 90, 1500, 3]);
  assert.equal(W.weekSummary(ws, at(11, 4, 20), 0).target, null);
  assert.equal(W.weekSummary([], at(11, 4, 20)).count, 0);
  assert.equal(W.weekSummary(ws, at(11, 1, 12)).start, "2026-10-26", "Sunday belongs to the week that began the Monday before");
});

test("routines come back most recently used first, unused ones after in their saved order", () => {
  const routines = [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }];
  const ws = [sess("a", "2026-10-05", [ex("x", [set(1, 1)])], { routineId: "r3" }), sess("b", "2026-10-12", [ex("x", [set(1, 1)])], { routineId: "r2" }), sess("c", "2026-10-19", [ex("x", [set(1, 1)])], { routineId: "r3" })];
  assert.deepEqual(W.recentRoutines(ws, routines).map((r) => r.routine.id), ["r3", "r2", "r1", "r4"]);
  assert.deepEqual(W.recentRoutines([], routines).map((r) => r.routine.id), ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(W.recentRoutines(ws, []), []);
});

test("repeat last workout: the newest saved session, as plain numbers", () => {
  assert.equal(W.lastWorkoutPlan([]), null);
  const ws = [sess("a", "2026-10-05", [ex("bench", [set(135, 8)])]), sess("b", "2026-10-12", [ex("bench", [set(60, 10, { warmup: true }), set(140, 8)]), ex("curl", [])], { routineId: "push" })];
  const plan = W.lastWorkoutPlan(ws);
  assert.equal(plan.date, "2026-10-12");
  assert.equal(plan.routineId, "push");
  assert.deepEqual(plan.exercises.map((e) => e.exerciseId), ["bench"], "an exercise with no sets is left out");
  assert.deepEqual(plan.exercises[0].sets.map((s) => [s.weight, s.reps, s.warmup]), [[60, 10, true], [140, 8, false]]);
  const drafted = W.exercisesFromLastWorkout(ws);
  assert.equal(drafted[0].sets.every((s) => s.completed === false && s.id), true, "loaded sets are not done and each has an id");
  assert.equal(W.exercisesFromLastWorkout([]), null);
});

test("an older or half-written draft is repaired without losing anything, and repairing twice changes nothing", () => {
  const raw = {
    dateTime: "2026-11-02T18:00", routineId: "push", notes: "felt good", startedAt: 123, activeIndex: 9, programId: "p", programDayId: "d",
    exercises: [
      { sessionExId: "e1", exerciseId: "bench", sets: [{ weight: 135, reps: 8, rpe: "", completed: true, warmup: false, dropset: false }, "junk", { weight: "", reps: 6 }] },
      { exerciseId: "row", sets: null },
      null,
      { sessionExId: "x" }
    ]
  };
  const d = W.migrateDraft(JSON.parse(JSON.stringify(raw)));
  assert.equal(d.exercises.length, 2, "junk entries dropped");
  assert.equal(d.exercises[0].sessionExId, "e1");
  assert.ok(d.exercises[1].sessionExId, "gets an id");
  assert.deepEqual(d.exercises[0].sets.map((s) => [s.weight, s.reps, s.completed]), [[135, 8, true], ["", 6, false]]);
  assert.ok(d.exercises[0].sets.every((s) => typeof s.id === "string" && s.id));
  assert.equal(d.activeIndex, 1, "clamped into range");
  assert.deepEqual([d.notes, d.startedAt, d.routineId, d.programId, d.programDayId, d.restEndsAt, d.uiVersion], ["felt good", 123, "push", "p", "d", null, 1]);
  const again = W.migrateDraft(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(again, d);
  assert.equal(W.migrateDraft(null).exercises.length, 0);
});

test("starting a routine: reps from the plan, weights suggested from last time, nothing marked done", () => {
  const history = [sess("a", "2026-10-05", [ex("bench", [set(60, 8, { warmup: true }), set(135, 8), set(140, 6)])])];
  const routine = { id: "push", exercises: [{ exerciseId: "bench", targetSets: 3, targetReps: 8 }, { exerciseId: "curl", plannedSets: [{ reps: 12, type: "warmup" }, { reps: 10, type: "normal" }], supersetGroup: "g1" }] };
  const exs = W.exercisesFromRoutine(routine, history);
  assert.deepEqual(exs[0].sets.map((s) => [s.weight, s.reps, s.completed]), [[135, 8, false], [140, 8, false], [140, 8, false]]);
  assert.deepEqual(exs[1].sets.map((s) => [s.weight, s.reps, s.warmup]), [["", 12, true], ["", 10, false]], "no history: weight left blank");
  assert.equal(exs[1].supersetGroup, "g1");
  assert.equal(new Set(exs.map((e) => e.sessionExId)).size, 2);
});

test("adding an exercise on the spot: three blank sets, or last time's sets with last time's numbers", () => {
  const blank = W.exerciseFromHistory("curl", []);
  assert.deepEqual(blank.sets.map((s) => [s.weight, s.reps]), [["", ""], ["", ""], ["", ""]]);
  const history = [sess("a", "2026-10-05", [ex("curl", [set(30, 10), set(30, 9)])])];
  assert.deepEqual(W.exerciseFromHistory("curl", history).sets.map((s) => [s.weight, s.reps]), [[30, 10], [30, 9]]);
});

const draftOf = (spec) => ({ exercises: spec.map((e, i) => ({ sessionExId: "e" + i, exerciseId: "x" + i, supersetGroup: e.g || null, sets: e.sets.map((done) => ({ weight: 100, reps: 5, completed: done })) })) });

test("counting what is done and what is left", () => {
  assert.deepEqual(W.pendingSets(draftOf([{ sets: [true, false] }, { sets: [false] }])), { total: 3, done: 1, open: 2 });
  assert.deepEqual(W.pendingSets({ exercises: [] }), { total: 0, done: 0, open: 0 });
});

test("after a set: on to the next open set, then the next exercise, then nothing", () => {
  const d = draftOf([{ sets: [true, false, false] }, { sets: [false] }]);
  assert.deepEqual(W.afterComplete(d, 0, 0), { focus: { exIdx: 0, setIdx: 1 }, rest: true });
  d.exercises[0].sets[1].completed = true; d.exercises[0].sets[2].completed = true;
  assert.deepEqual(W.afterComplete(d, 0, 2), { focus: { exIdx: 1, setIdx: 0 }, rest: true }, "exercise finished: move on");
  d.exercises[1].sets[0].completed = true;
  assert.deepEqual(W.afterComplete(d, 1, 0), { focus: null, rest: false }, "everything done");
  const back = draftOf([{ sets: [false, true] }]);
  assert.deepEqual(W.afterComplete(back, 0, 1), { focus: { exIdx: 0, setIdx: 0 }, rest: true }, "a skipped earlier set is still offered");
});

test("supersets: alternate with no rest between, rest after the last of each round", () => {
  const d = draftOf([{ g: "g1", sets: [false, false] }, { g: "g1", sets: [false, false] }, { sets: [false] }]);
  d.exercises[0].sets[0].completed = true;
  assert.deepEqual(W.afterComplete(d, 0, 0), { focus: { exIdx: 1, setIdx: 0 }, rest: false });
  d.exercises[1].sets[0].completed = true;
  assert.deepEqual(W.afterComplete(d, 1, 0), { focus: { exIdx: 0, setIdx: 1 }, rest: true });
  d.exercises[0].sets[1].completed = true;
  assert.deepEqual(W.afterComplete(d, 0, 1), { focus: { exIdx: 1, setIdx: 1 }, rest: false });
  d.exercises[1].sets[1].completed = true;
  assert.deepEqual(W.afterComplete(d, 1, 1), { focus: { exIdx: 2, setIdx: 0 }, rest: true }, "pair finished: next exercise");
});

test("the session to save keeps only finished sets with numbers, and says how long it took", () => {
  const draft = {
    dateTime: "2026-11-02T18:30", routineId: "push", programId: "", programDayId: "", notes: "  good  ", startedAt: 1000,
    exercises: [
      { sessionExId: "a", exerciseId: "bench", sets: [{ weight: 135, reps: 8, completed: true, warmup: false, rpe: 8 }, { weight: 140, reps: 6, completed: false }, { weight: "", reps: 6, completed: true }] },
      { sessionExId: "b", exerciseId: "row", sets: [{ weight: 100, reps: 8, completed: false }] }
    ]
  };
  const s = W.buildSession(draft, { now: 1000 + 47 * 60000 + 20000, id: "w1" });
  assert.deepEqual(s.exercises, [{ exerciseId: "bench", sets: [{ weight: 135, reps: 8, warmup: false, dropset: false, rpe: 8 }] }]);
  assert.deepEqual([s.id, s.schema, s.date, s.dateTime, s.routineId, s.programId, s.notes, s.duration], ["w1", 2, "2026-11-02", "2026-11-02T18:30", "push", null, "good", 47]);
  assert.equal(W.buildSession({ exercises: [{ exerciseId: "bench", sets: [{ weight: 100, reps: 5, completed: false }] }] }), null, "nothing done, nothing to save");
  const noClock = W.buildSession({ dateTime: "", startedAt: null, exercises: [{ exerciseId: "bench", sets: [{ weight: 100, reps: 5, completed: true }] }] }, { now: at(11, 2, 7, 5) });
  assert.deepEqual([noClock.dateTime, noClock.duration], ["2026-11-02T07:05", null]);
});

test("the rest timer is an end time: it keeps counting while the screen is off, and can be nudged or skipped", () => {
  const t0 = 1_000_000;
  const ends = W.startRest(t0, 90);
  assert.equal(ends, t0 + 90000);
  assert.equal(W.restRemainingMs(ends, t0 + 30000), 60000);
  assert.equal(W.restRemainingMs(ends, t0 + 5 * 60000), 0, "long after, it is simply over");
  assert.equal(W.restRemainingMs(null, t0), 0);
  assert.equal(W.adjustRest(ends, 15, t0 + 10000), ends + 15000);
  assert.equal(W.adjustRest(ends, -15, t0 + 80000), null, "taking off more than is left ends it");
  assert.equal(W.adjustRest(ends, 15, t0 + 100000), null, "a finished timer is not revived by +15");
  assert.equal(W.adjustRest(null, 15, t0), null);
  assert.equal(W.startRest(t0, 5), t0 + 15000, "never shorter than 15 seconds");
  assert.equal(W.startRest(t0, 9999), t0 + 600000, "or longer than 10 minutes");
  assert.equal(W.formatClock(90000), "1:30");
  assert.equal(W.formatClock(61000), "1:01");
  assert.equal(W.formatClock(500), "0:01");
  assert.equal(W.formatClock(0), "0:00");
  assert.equal(W.formatClock(3725000), "1:02:05");
});

test("preferences are repaired on load", () => {
  assert.deepEqual(W.sanitizePrefs(null), { restSeconds: 90, restAuto: true, restSound: true });
  assert.deepEqual(W.sanitizePrefs({ restSeconds: "120", restAuto: false, restSound: false }), { restSeconds: 120, restAuto: false, restSound: false });
  assert.equal(W.sanitizePrefs({ restSeconds: 1 }).restSeconds, 15);
  assert.equal(W.sanitizePrefs({ restSeconds: "x" }).restSeconds, 90);
});

test("a custom exercise that already exists is caught whatever the case, punctuation or plural", () => {
  const list = [{ name: "Bench Press" }, { name: "Dumbbell Curl" }, { name: "Overhead Press" }];
  assert.equal(W.findDuplicate("bench-press", list), list[0]);
  assert.equal(W.findDuplicate("  BENCH   PRESSES ", list), list[0]);
  assert.equal(W.findDuplicate("Dumbbell Curls", list), list[1]);
  assert.equal(W.findDuplicate("Incline Bench Press", list), null);
  assert.equal(W.findDuplicate("", list), null);
  assert.equal(W.findDuplicate("!!!", list), null);
});

test("a saved workout keeps the name of its routine as it was that day, and only when it has a routine", () => {
  const draft = { dateTime: "2026-11-02T18:00", routineId: "r1", startedAt: 1000, exercises: [{ exerciseId: "bench", sets: [{ weight: 100, reps: 5, completed: true }] }] };
  assert.equal(W.buildSession(draft, { now: 61000, routineName: "Push Day" }).routineName, "Push Day");
  assert.equal("routineName" in W.buildSession(draft, { now: 61000 }), false, "no name given, no field");
  assert.equal("routineName" in W.buildSession(Object.assign({}, draft, { routineId: "" }), { now: 61000, routineName: "Push Day" }), false, "a freestyle workout has no routine to name");
});
