"use strict";

process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../js/routine-logic");
const W = require("../../js/workout-logic");

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); }
  return o;
}
const NOW = Date.parse("2026-11-02T18:00:00-05:00");
const ex = (exerciseId, reps, n, type) => ({ exerciseId: exerciseId, supersetGroup: null, plannedSets: Array.from({ length: n || 3 }, () => ({ reps: reps || 10, type: type || "normal" })) });
const routine = (id, name, days, exercises, o) => Object.assign({ id: id, name: name, exercises: exercises || [ex("bench")], scheduledDays: days || [], createdAt: 1000 }, o || {});
const set = (weight, reps, o) => Object.assign({ weight: weight, reps: reps, warmup: false, dropset: false }, o || {});
const sess = (id, date, routineId, exercises, o) => Object.assign({ id: id, schema: 2, dateTime: date + "T18:00", date: date, routineId: routineId, programId: null, programDayId: null, notes: "", duration: 60, exercises: exercises, createdAt: 1 }, o || {});

test("planned sets are read the same way the older code reads them", () => {
  const samples = [
    { plannedSets: [{ reps: 8, type: "normal" }, { reps: 6, type: "dropset" }] },
    { targetSets: 3, targetReps: 12 },
    { targetSets: 2, repsPerSet: [5, 3] },
    { targetSets: 0 },
    { targetSets: 99, targetReps: "x" },
    {},
    { plannedSets: [] , targetSets: 2, targetReps: 8 }
  ];
  samples.forEach((s) => assert.deepEqual(R.plannedSetsOf(s), W.plannedSetsOf(s)));
});

test("an even plan reads as 3 x 10; anything else lists the sets and their types", () => {
  assert.equal(R.setsLabel(R.uniform(3, 10)), "3 × 10");
  assert.equal(R.setsLabel([{ reps: 12, type: "normal" }, { reps: 10, type: "normal" }]), "2 sets: 12, 10");
  assert.equal(R.setsLabel([{ reps: 10, type: "warmup" }, { reps: 6, type: "normal" }, { reps: 8, type: "dropset" }]), "3 sets: 10 (warm-up), 6, 8 (drop set)");
  assert.equal(R.setsLabel([{ reps: 5, type: "normal" }]), "1 × 5");
  assert.equal(R.isUniform(R.uniform(3, 10)), true);
  assert.equal(R.isUniform([{ reps: 10, type: "warmup" }]), false);
});

test("working set counts leave out warm-ups; muscles are listed once, in order", () => {
  const r = routine("a", "Push", [], [ex("bench", 8, 3), { exerciseId: "press", supersetGroup: null, plannedSets: [{ reps: 10, type: "warmup" }, { reps: 8, type: "normal" }] }, ex("fly", 12, 2)]);
  assert.equal(R.workingSetCount(r), 6);
  const lookup = (id) => ({ bench: { muscleGroup: "Chest" }, press: { muscleGroup: "Shoulders" }, fly: { muscleGroup: "Chest" } }[id] || null);
  assert.deepEqual(R.muscleSummary(r, lookup), ["Chest", "Shoulders"]);
});

test("names: case, spacing and punctuation don't make a different name; archived routines don't hold a name", () => {
  const list = [routine("a", "Push Day"), routine("b", "Old", [], [ex("x")], { archivedAt: 5 })];
  assert.equal(R.nameTaken("  push   DAY ", list).id, "a");
  assert.equal(R.nameTaken("push-day", list).id, "a");
  assert.equal(R.nameTaken("Push Day", list, "a"), null, "editing a routine doesn't clash with itself");
  assert.equal(R.nameTaken("Old", list), null);
  assert.equal(R.nameTaken("", list), null);
});

test("a free name for a copy: (copy), (copy 2), (copy 3)", () => {
  assert.equal(R.uniqueName("Pull Day", [routine("a", "Push Day")]), "Pull Day");
  const one = [routine("a", "Push Day")];
  assert.equal(R.uniqueName("Push Day", one), "Push Day (copy)");
  const two = one.concat([routine("b", "Push Day (copy)")]);
  assert.equal(R.uniqueName("Push Day", two), "Push Day (copy 2)");
  const long = "x".repeat(60);
  const n = R.uniqueName(long, [routine("a", long)]);
  assert.ok(n.length <= 60 && /\(copy\)$/.test(n));
});

test("what to plan for a new exercise comes from your last sets, and says so; otherwise 3 x 10", () => {
  const hist = [
    sess("w1", "2026-10-20", null, [{ exerciseId: "bench", sets: [set(135, 8), set(135, 8), set(135, 7)] }]),
    sess("w2", "2026-10-27", null, [{ exerciseId: "bench", sets: [set(95, 10, { warmup: true }), set(145, 6), set(145, 6), set(145, 5), set(145, 5), set(120, 12, { dropset: true })] }]),
    { id: "legacy", dateTime: "2026-10-30T18:00", date: "2026-10-30", exercises: [{ exerciseId: "bench", sets: [{ weight: 1, reps: 1 }] }] }
  ];
  const p = R.suggestedPlan(hist, "bench");
  assert.equal(p.from, "last");
  assert.deepEqual(p.plannedSets, R.uniform(4, 6), "4 working sets, usual reps 6 (tie 6 vs 5 goes to the higher); warm-up and drop set left out");
  const none = R.suggestedPlan(hist, "squat");
  assert.equal(none.from, "default");
  assert.deepEqual(none.plannedSets, R.uniform(3, 10));
  const many = R.suggestedPlan([sess("w", "2026-10-01", null, [{ exerciseId: "row", sets: Array.from({ length: 9 }, () => set(100, 12)) }])], "row");
  assert.equal(many.plannedSets.length, 6, "at most 6 sets are suggested");
});

test("adding exercises skips ones already there, respects the cap, and uses what it is given", () => {
  let b = R.blankBuilder();
  let r = R.addExercises(b, [{ exerciseId: "bench" }, { exerciseId: "press", plannedSets: R.uniform(4, 6) }, { exerciseId: "bench" }]);
  assert.deepEqual([r.added, r.skipped], [2, 1]);
  assert.deepEqual(r.builder.exercises[0].plannedSets, R.uniform(3, 10));
  assert.deepEqual(r.builder.exercises[1].plannedSets, R.uniform(4, 6));
  const big = R.addExercises(R.blankBuilder(), Array.from({ length: 40 }, (_, i) => ({ exerciseId: "e" + i })));
  assert.equal(big.builder.exercises.length, R.MAX_EXERCISES);
  assert.equal(big.skipped, 10);
});

test("moving and removing exercises keeps supersets honest: two in a row, or nothing", () => {
  let b = R.addExercises(R.blankBuilder(), ["a", "b", "c", "d"].map((id) => ({ exerciseId: id }))).builder;
  b = R.toggleSuperset(b, 0, "g1");
  assert.deepEqual(b.exercises.map((e) => e.supersetGroup), ["g1", "g1", null, null]);
  b = R.moveExercise(b, 1, 1);
  assert.deepEqual(b.exercises.map((e) => e.exerciseId), ["a", "c", "b", "d"]);
  assert.deepEqual(b.exercises.map((e) => e.supersetGroup), [null, null, null, null], "moving one out of a pair breaks the pair, so both are freed");
  b = R.toggleSuperset(b, 2, "g2");
  assert.deepEqual(b.exercises.map((e) => e.supersetGroup), [null, null, "g2", "g2"]);
  b = R.removeExercise(b, 3);
  assert.deepEqual(b.exercises.map((e) => e.supersetGroup), [null, null, null], "removing half a pair frees the other half");
  b = R.toggleSuperset(b, 2, "g3");
  assert.deepEqual(b.exercises.map((e) => e.supersetGroup), [null, null, null], "the last exercise has nothing after it to pair with");
  assert.equal(R.moveExercise(b, 0, -1), b, "moving the first one up does nothing");
});

test("sets and reps steppers stay in range and turn an uneven plan into an even one", () => {
  let b = R.addExercises(R.blankBuilder(), [{ exerciseId: "bench", plannedSets: [{ reps: 12, type: "warmup" }, { reps: 8, type: "dropset" }] }]).builder;
  b = R.setUniform(b, 0, { sets: 4 });
  assert.deepEqual(b.exercises[0].plannedSets, R.uniform(4, 12));
  b = R.setUniform(b, 0, { reps: 0 });
  assert.equal(b.exercises[0].plannedSets[0].reps, 1);
  b = R.setUniform(b, 0, { reps: 500, sets: 99 });
  assert.deepEqual([b.exercises[0].plannedSets.length, b.exercises[0].plannedSets[0].reps], [R.MAX_SETS, R.MAX_REPS]);
  b = R.setPlannedSets(b, 0, [{ reps: 8, type: "weird" }, { reps: "x", type: "dropset" }]);
  assert.deepEqual(b.exercises[0].plannedSets, [{ reps: 8, type: "normal" }, { reps: 10, type: "dropset" }]);
});

test("a routine can be saved only with a name that is free, an exercise, and sane sets", () => {
  const list = [routine("a", "Push Day")];
  const ok = R.addExercises(R.setName(R.blankBuilder(), "Pull Day"), [{ exerciseId: "row" }]).builder;
  assert.equal(R.validate(ok, list).ok, true);
  assert.equal(R.validate(R.blankBuilder(), list).name, "Give it a name.");
  assert.match(R.validate(R.setName(ok, "push day"), list).name, /already have a routine called “Push Day”/);
  assert.equal(R.validate(R.setName(R.blankBuilder(), "X"), list).exercises, "Add at least one exercise.");
  const bad = Object.assign({}, ok, { exercises: [Object.assign({}, ok.exercises[0], { plannedSets: [] }), Object.assign({}, ok.exercises[0], { exerciseId: "z", plannedSets: [{ reps: 0, type: "normal" }] }), Object.assign({}, ok.exercises[0], { exerciseId: "y", plannedSets: [{ reps: 2.5, type: "normal" }] })] });
  assert.deepEqual(R.validate(bad, list).sets.map((s) => s.index), [0, 1, 2]);
  const edit = R.builderFromRoutine(list[0]);
  assert.equal(R.validate(edit, list).ok, true, "editing Push Day does not clash with Push Day");
});

test("saving a new routine: a new id, the days it asked for, and those days taken from others", () => {
  const list = deepFreeze([routine("a", "Push Day", [0, 3]), routine("b", "Leg Day", [4]), routine("old", "Old", [3], [ex("x")], { archivedAt: 9 })]);
  let b = R.addExercises(R.setName(R.blankBuilder(), "  Pull   Day "), [{ exerciseId: "row" }]).builder;
  b = R.toggleDay(R.toggleDay(b, 3), 1);
  assert.deepEqual(R.dayConflicts(b, list).map((c) => [c.day, c.routine.id]), [[3, "a"]], "Thursday would be taken from Push Day; the archived routine doesn't count");
  const res = R.applyBuilder(list, b, { now: NOW, id: "new1" });
  assert.equal(res.ok, true);
  const by = (id) => res.routines.find((r) => r.id === id);
  assert.deepEqual(res.routine, { id: "new1", name: "Pull Day", exercises: [{ exerciseId: "row", supersetGroup: null, plannedSets: R.uniform(3, 10) }], scheduledDays: [1, 3], createdAt: NOW, updatedAt: NOW });
  assert.deepEqual(by("a").scheduledDays, [0]);
  assert.equal(by("a").updatedAt, NOW, "the routine that lost a day is stamped so a synced copy knows it changed");
  assert.deepEqual(by("b"), list[1], "an untouched routine is the very same object");
  assert.deepEqual(by("old").scheduledDays, [3], "archived routines are left alone");
  assert.equal(list.length, 3, "the list given is not changed");
});

test("editing keeps the id, creation time and archive state, and changes only what was edited", () => {
  const list = deepFreeze([routine("a", "Push Day", [0], [ex("bench", 8, 4), ex("press", 10, 3)], { createdAt: 500 })]);
  let b = R.builderFromRoutine(list[0]);
  assert.equal(R.isDirty(b), false);
  b = R.setName(b, "Push A");
  b = R.setUniform(b, 1, { sets: 4 });
  assert.equal(R.isDirty(b), true);
  const res = R.applyBuilder(list, b, { now: NOW, id: "ignored" });
  assert.deepEqual([res.routine.id, res.routine.name, res.routine.createdAt, res.routine.updatedAt], ["a", "Push A", 500, NOW]);
  assert.deepEqual(res.routine.exercises[0].plannedSets, R.uniform(4, 8));
  assert.equal(R.applyBuilder(list, Object.assign({}, b, { editId: "gone" }), { now: NOW }).reason, "missing");
  assert.equal(R.applyBuilder(list, R.setName(b, ""), { now: NOW }).reason, "invalid");
});

test("changing a day: a routine, or a rest day; the day is taken from whoever had it", () => {
  const list = deepFreeze([routine("a", "Push", [0]), routine("b", "Pull", [2]), routine("c", "Old", [0], [ex("x")], { archivedAt: 4 })]);
  const moved = R.assignDay(list, 0, "b", NOW);
  assert.deepEqual(moved.map((r) => r.scheduledDays), [[], [0, 2], [0]]);
  assert.equal(moved[0].updatedAt, NOW);
  const rest = R.assignDay(list, 2, "", NOW);
  assert.deepEqual(rest.map((r) => r.scheduledDays), [[0], [], [0]]);
  assert.equal(R.assignDay(list, 5, "a", NOW)[0].scheduledDays.join(), "0,5");
  assert.equal(R.assignDay(list, 0, "a", NOW)[0], list[0], "nothing to change, nothing copied");
});

test("the week: one routine per day, archived ones don't count", () => {
  const list = [routine("a", "Push", [0, 3]), routine("b", "Pull", [2]), routine("c", "Old", [4], [ex("x")], { archivedAt: 4 })];
  const plan = R.weekPlan(list);
  assert.deepEqual(plan.map((d) => d.routine && d.routine.id), ["a", null, "b", "a", null, null, null]);
  assert.equal(plan[0].label, "Monday");
  assert.equal(R.plannedDayCount(list), 3);
  assert.equal(R.dayText([3, 0]), "Mon · Thu");
});

test("archiving hides a routine and frees its days; restoring brings it back without days, and renames if the name was reused", () => {
  const list = deepFreeze([routine("a", "Push Day", [0, 3]), routine("b", "Pull Day", [2])]);
  const arc = R.archiveRoutine(list, "a", NOW);
  assert.deepEqual([arc[0].archivedAt, arc[0].scheduledDays, arc[0].updatedAt], [NOW, [], NOW]);
  assert.deepEqual(R.active(arc).map((r) => r.id), ["b"]);
  assert.deepEqual(R.archived(arc).map((r) => r.id), ["a"]);
  assert.equal(R.plannedDayCount(arc), 1);
  assert.equal(R.findById(arc, "a").name, "Push Day", "everything that points at it still finds it");
  assert.equal(R.archiveRoutine(arc, "a", NOW + 1)[0].archivedAt, NOW, "archiving twice changes nothing");
  const back = R.restoreRoutine(arc, "a", NOW + 5);
  assert.deepEqual([back[0].name, back[0].scheduledDays, back[0].archivedAt, back[0].updatedAt], ["Push Day", [], undefined, NOW + 5]);
  const reused = R.addExercises(R.setName(R.blankBuilder(), "Push Day"), [{ exerciseId: "x" }]).builder;
  const withNew = R.applyBuilder(arc, reused, { now: NOW + 2, id: "n" }).routines;
  assert.equal(R.restoreRoutine(withNew, "a", NOW + 6).find((r) => r.id === "a").name, "Push Day (restored)");
});

test("only an archived routine can be deleted; the screen is told what that leaves behind", () => {
  const routines = [routine("a", "Push Day", [0]), routine("b", "Old", [], [ex("x")], { archivedAt: 3 })];
  assert.equal(R.deleteRoutine(routines, "a"), routines, "an active routine is not deletable");
  assert.deepEqual(R.deleteRoutine(routines, "b").map((r) => r.id), ["a"]);
  assert.equal(R.deleteRoutine(routines, "nope"), routines);
  const workouts = [sess("w1", "2026-10-20", "b", []), sess("w2", "2026-10-27", "b", []), sess("w3", "2026-10-28", "a", [])];
  const programs = [{ id: "p", name: "PPL", days: [{ id: "d1", label: "Day 1", routineId: "a" }, { id: "d2", label: "Day 2", routineId: "b" }], currentIndex: 0 }];
  assert.deepEqual(R.deleteImpact("b", workouts, programs), { sessions: 2, lastDate: "2026-10-27", programDays: [{ programId: "p", programName: "PPL", dayId: "d2", dayLabel: "Day 2" }] });
  assert.deepEqual(R.deleteImpact("zzz", workouts, programs), { sessions: 0, lastDate: null, programDays: [] });
});

test("deleting stamps the routine's name onto its workouts, so History never says 'routine deleted'", () => {
  const workouts = deepFreeze([sess("w1", "2026-10-20", "b", []), sess("w2", "2026-10-21", "b", [], { routineName: "Pull A" }), sess("w3", "2026-10-22", "a", []), sess("w4", "2026-10-23", null, [])]);
  const r = R.stampNames(workouts, routine("b", "Pull Day"));
  assert.equal(r.changed, 1);
  assert.equal(r.workouts[0].routineName, "Pull Day");
  assert.equal(r.workouts[1].routineName, "Pull A", "a name already stored is never overwritten");
  assert.equal(r.workouts[2], workouts[2], "other workouts are the very same objects");
  assert.equal(workouts[0].routineName, undefined, "the original list is not changed");
  const none = R.stampNames(workouts, routine("zzz", "Nope"));
  assert.equal(none.workouts, workouts);
  assert.equal(none.changed, 0);
});

test("a workout is labelled by its routine's current name, else the name it was saved with, else nothing", () => {
  const routines = [routine("a", "Push A")];
  assert.equal(R.sessionLabel(sess("w", "2026-10-20", "a", [], { routineName: "Push Day" }), routines), "Push A");
  assert.equal(R.sessionLabel(sess("w", "2026-10-20", "gone", [], { routineName: "Push Day" }), routines), "Push Day");
  assert.equal(R.sessionLabel(sess("w", "2026-10-20", "gone", []), routines), "");
  assert.equal(R.sessionLabel(sess("w", "2026-10-20", null, []), routines), "");
  assert.equal(R.sessionLabel(null, routines), "");
});

test("a program day says whether its routine can be started", () => {
  const routines = [routine("a", "Push"), routine("b", "Old", [], [ex("x")], { archivedAt: 1 })];
  const prog = (i) => ({ id: "p", name: "PPL", currentIndex: i, days: [{ id: "d1", label: "D1", routineId: "a" }, { id: "d2", label: "D2", routineId: "b" }, { id: "d3", label: "D3", routineId: "zzz" }] });
  assert.equal(R.programDayStatus(prog(0), routines).status, "ok");
  assert.equal(R.programDayStatus(prog(1), routines).status, "archived");
  assert.equal(R.programDayStatus(prog(2), routines).status, "missing");
  assert.equal(R.programDayStatus(prog(3), routines).day.id, "d1", "the program wraps around");
  assert.equal(R.programDayStatus({ id: "p", days: [] }, routines).status, "empty");
  assert.equal(R.programDayStatus(null, routines).status, "empty");
});

test("an unfinished routine read back from storage is repaired, or dropped if it is junk", () => {
  assert.equal(R.sanitizeBuilder(null), null);
  assert.equal(R.sanitizeBuilder("x"), null);
  assert.equal(R.sanitizeBuilder({ name: "x" }), null);
  const b = R.sanitizeBuilder({ editId: 5, name: 42, days: [1, "3", 9, 1, -1, 2.5], exercises: [{ exerciseId: "bench", targetSets: 2, targetReps: 8 }, { nope: 1 }, null, { exerciseId: "", plannedSets: [] }, { exerciseId: "a", supersetGroup: "g" }] });
  assert.deepEqual([b.editId, b.name, b.days], [null, "", [1, 3]]);
  assert.deepEqual(b.exercises.map((e) => e.exerciseId), ["bench", "a"]);
  assert.deepEqual(b.exercises[0].plannedSets, R.uniform(2, 8));
  assert.equal(b.exercises[1].supersetGroup, null, "a lone superset member is freed");
});

test("the list: scheduled routines first by weekday, then the rest as created; archived left out", () => {
  const list = [routine("x", "Extra"), routine("l", "Legs", [4]), routine("o", "Old", [0], [ex("a")], { archivedAt: 1 }), routine("p", "Push", [0, 3]), routine("q", "Pull", [2]), routine("y", "More")];
  assert.deepEqual(R.listOrder(list).map((r) => r.id), ["p", "q", "l", "x", "y"]);
});

test("a copy is a new, unsaved routine with its own name, the same exercises and no days", () => {
  const list = deepFreeze([routine("a", "Push Day", [0, 3], [ex("bench", 8, 4)])]);
  const b = R.builderFromCopy(list[0], list);
  assert.deepEqual([b.editId, b.name, b.days], [null, "Push Day (copy)", []]);
  assert.deepEqual(b.exercises[0].plannedSets, R.uniform(4, 8));
  assert.equal(R.isDirty(b), true);
  const res = R.applyBuilder(list, b, { now: NOW, id: "c1" });
  assert.deepEqual(res.routines.map((r) => r.name), ["Push Day", "Push Day (copy)"]);
  assert.deepEqual(res.routines[0].scheduledDays, [0, 3], "the original keeps its days");
});

test("none of this changes what it is given", () => {
  const list = deepFreeze([routine("a", "Push Day", [0, 3], [ex("bench", 8, 4)]), routine("b", "Old", [], [ex("x")], { archivedAt: 3 })]);
  const workouts = deepFreeze([sess("w1", "2026-10-20", "a", [{ exerciseId: "bench", sets: [set(100, 5)] }])]);
  const programs = deepFreeze([{ id: "p", name: "P", currentIndex: 0, days: [{ id: "d", label: "D", routineId: "a" }] }]);
  const b = deepFreeze(R.builderFromRoutine(list[0]));
  assert.doesNotThrow(() => {
    R.active(list); R.archived(list); R.listOrder(list); R.weekPlan(list); R.plannedDayCount(list);
    R.archiveRoutine(list, "a", NOW); R.restoreRoutine(list, "b", NOW); R.deleteRoutine(list, "b"); R.assignDay(list, 1, "a", NOW);
    R.stampNames(workouts, list[0]); R.deleteImpact("a", workouts, programs); R.suggestedPlan(workouts, "bench");
    R.setName(b, "x"); R.toggleDay(b, 1); R.removeExercise(b, 0); R.moveExercise(b, 0, 1); R.setUniform(b, 0, { sets: 5 }); R.toggleSuperset(b, 0, "g");
    R.addExercises(b, [{ exerciseId: "q" }]); R.validate(b, list); R.applyBuilder(list, b, { now: NOW, id: "n" }); R.dayConflicts(b, list); R.isDirty(b);
    R.builderFromCopy(list[0], list); R.programDayStatus(programs[0], list);
  });
});
