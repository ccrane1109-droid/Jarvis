"use strict";

process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/progress-logic");
const W = require("../../js/workout-logic");

function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }
const set = (weight, reps, o) => Object.assign({ weight: weight, reps: reps, warmup: false, dropset: false }, o || {});
const ex = (exerciseId, sets) => ({ exerciseId: exerciseId, sets: sets });
let n = 0;
const sess = (date, exercises, o) => Object.assign({ id: "w" + (++n), schema: 2, dateTime: date + "T18:00", date: date, routineId: null, programId: null, programDayId: null, notes: "", duration: 60, exercises: exercises, createdAt: n }, o || {});
const TODAY = "2026-11-03"; // a Tuesday

test("the window to look at, and the equal window right before it", () => {
  const b = P.rangeBounds("4w", TODAY, []);
  assert.deepEqual([b.start, b.end, b.prevStart, b.prevEnd, b.days, b.hasPrev], ["2026-10-07", "2026-11-03", "2026-09-09", "2026-10-06", 28, true]);
  assert.equal(W.addDays(b.start, 27), b.end, "28 days, both ends included");
  const all = P.rangeBounds("all", TODAY, [sess("2026-08-17", [])]);
  assert.deepEqual([all.start, all.end, all.prevStart, all.hasPrev], ["2026-08-17", TODAY, null, false]);
  assert.equal(P.rangeBounds("all", TODAY, []).start, TODAY, "no workouts: just today");
  assert.equal(P.rangeBounds("nonsense", TODAY, []).key, "3m", "an unknown range falls back to 3 months");
  assert.deepEqual(P.RANGES.map((r) => r.key), ["4w", "3m", "6m", "1y", "all"]);
});

test("totals count working sets only, and minutes only where a duration was saved", () => {
  const list = [
    sess("2026-10-20", [ex("bench", [set(60, 10, { warmup: true }), set(100, 5), set(100, 5)]), ex("row", [set(80, 8)])], { duration: 50 }),
    sess("2026-10-22", [ex("bench", [set(105, 5)])], { duration: null }),
    sess("2026-10-22", [ex("squat", [set(0, 12), set("", 5), set(100, "")])], { duration: 0 })
  ];
  const s = P.summarize(list);
  assert.deepEqual([s.workouts, s.workingSets, s.volume, s.minutes, s.timed, s.avgMinutes, s.exercises, s.activeDays], [3, 5, 1000 + 640 + 525, 50, 1, 50, 3, 2]);
  const none = P.summarize([sess("2026-10-20", [ex("bench", [set(100, 5)])], { duration: null })]);
  assert.equal(none.avgMinutes, null, "no timed workouts, no average");
  assert.deepEqual(P.summarize([]), { workouts: 0, workingSets: 0, volume: 0, minutes: 0, timed: 0, avgMinutes: null, exercises: 0, activeDays: 0 });
});

test("a period against the one before it: up, down, same, and nothing to compare with", () => {
  const cur = { workouts: 12, volume: 5000, avgMinutes: 55 }, prev = { workouts: 10, volume: 5000, avgMinutes: 60 };
  assert.deepEqual(P.compare(cur, prev, "workouts"), { value: 12, prev: 10, delta: 2, pct: 20, trend: "up" });
  assert.equal(P.compare(cur, prev, "volume").trend, "same");
  assert.deepEqual([P.compare(cur, prev, "avgMinutes").delta, P.compare(cur, prev, "avgMinutes").pct], [-5, -8]);
  const empty = P.compare(cur, { workouts: 0, volume: 0 }, "workouts");
  assert.deepEqual([empty.value, empty.trend, empty.pct], [12, null, null], "an empty earlier period gives no trend, not a made-up one");
  assert.equal(P.compare(cur, { workouts: 3, volume: 0 }, "volume").pct, null, "no percentage from zero");
  assert.equal(P.compare(cur, null, "workouts").trend, null);
  assert.equal(P.compare({ workouts: 2, avgMinutes: null }, { workouts: 2, avgMinutes: 40 }, "avgMinutes").trend, null, "a missing number is not compared");
});

test("weeks run Monday to Sunday, are filled in when empty, and this week is marked as so far", () => {
  const list = [sess("2026-10-26", [ex("a", [set(10, 10)])]), sess("2026-11-01", [ex("a", [set(10, 10)])]), sess("2026-11-02", [ex("a", [set(20, 10)])], { duration: 30 }), sess("2026-10-12", [ex("a", [set(10, 10)])])];
  const wk = P.weeklySeries(list, TODAY, 4);
  assert.deepEqual(wk.map((w) => w.start), ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  assert.deepEqual(wk.map((w) => w.workouts), [1, 0, 2, 1], "Oct 12 | Oct 19 (empty) | Oct 26-Nov 1 (Mon and Sun) | Nov 2-8");
  assert.deepEqual(wk.map((w) => w.partial), [false, false, false, true], "only the current week is partial");
  assert.equal(wk[3].minutes, 30);
  assert.equal(wk[2].volume, 200);
  assert.equal(P.weeklySeries([], TODAY, 3).length, 3);
});

test("how many weeks to chart for each period: every Monday-to-Sunday week the period touches, from your first workout", () => {
  const long = [sess("2025-01-06", [])];
  assert.deepEqual(["4w", "3m", "6m", "1y"].map((k) => P.weeksFor(k, TODAY, long)), [5, 14, 27, 53], "on a Tuesday, 28 days reach back into a fifth week");
  assert.equal(P.weeksFor("4w", "2026-11-02", long), 5, "on a Monday, 28 days start on a Tuesday: still five weeks touched");
  assert.equal(P.weeksFor("4w", "2026-11-08", long), 4, "on a Sunday, 28 days start exactly on a Monday: four weeks");
  assert.equal(P.weeksFor("all", TODAY, []), 1, "no workouts: one empty week, not a padded chart");
  assert.equal(P.weeksFor("all", TODAY, [sess("2026-09-14", [])]), 8, "Sep 14 (a Monday) to the week of Nov 2");
  assert.equal(P.weeksFor("all", TODAY, [sess("2020-01-01", [])]), 104, "never more than two years of bars");
  assert.equal(P.weeksFor("1y", TODAY, [sess("2026-09-14", [])]), 8, "a year that starts before your first workout is only charted from it");
  assert.equal(P.weeksFor("3m", TODAY, [sess("2026-10-30", [])]), 2, "someone who started last Friday has two weeks to show");
});

test("where the numbers begin: the period's start, or your first workout when that is later", () => {
  const first = [sess("2026-09-14", [])];
  assert.deepEqual([P.rangeBounds("3m", TODAY, first).start, P.rangeBounds("3m", TODAY, first).from], ["2026-08-06", "2026-09-14"]);
  assert.equal(P.rangeBounds("4w", TODAY, first).from, "2026-10-07", "a workout older than the period changes nothing");
  assert.equal(P.rangeBounds("3m", TODAY, []).from, TODAY, "no workouts: from today");
  assert.equal(P.rangeBounds("all", TODAY, first).from, "2026-09-14");
});

test("a first week cut off by the start of the period is marked, so its short count is not read as a slow week", () => {
  const hist = [sess("2025-01-06", [])], b = P.rangeBounds("4w", TODAY, hist);
  const wk = P.weeklySeries([sess("2026-10-08", [ex("a", [set(10, 10)])])], TODAY, P.weeksFor("4w", TODAY, hist), b.from);
  assert.deepEqual(wk.map((w) => w.clipped), [true, false, false, false, false]);
  assert.deepEqual(wk.map((w) => w.start)[0], "2026-10-05");
  const c = P.consistency(wk.map((w, i) => Object.assign({}, w, { workouts: i + 1 })), 0);
  assert.deepEqual([c.weeks, c.avgPerWeek], [3, 3], "only the three complete weeks count: not the cut-off first week, not this week so far");
});

test("steadiness over complete weeks only: average, weeks trained, the run of weeks that met your plan", () => {
  const weekly = [{ workouts: 3, partial: false }, { workouts: 3, partial: false }, { workouts: 1, partial: false }, { workouts: 3, partial: false }, { workouts: 3, partial: false }, { workouts: 1, partial: true }];
  const c = P.consistency(weekly, 3);
  assert.deepEqual([c.weeks, c.avgPerWeek, c.trainedWeeks, c.metTarget, c.run, c.runNeed, c.bestWeek, c.thisWeek], [5, 2.6, 5, 4, 2, 3, 3, 1]);
  const noPlan = P.consistency(weekly, 0);
  assert.deepEqual([noPlan.metTarget, noPlan.run, noPlan.runNeed], [null, 5, 1], "with no plan, a run is weeks with at least one workout");
  const gap = P.consistency([{ workouts: 0, partial: false }, { workouts: 2, partial: false }, { workouts: 0, partial: false }, { workouts: 0, partial: true }], 0);
  assert.deepEqual([gap.trainedWeeks, gap.run], [1, 0], "an empty last complete week ends the run");
  const fresh = P.consistency([{ workouts: 1, partial: true }], 3);
  assert.deepEqual([fresh.weeks, fresh.avgPerWeek, fresh.run], [0, null, 0], "no complete week yet: no average to show");
});

test("days since the last workout and the longest gap", () => {
  const list = [sess("2026-10-01", []), sess("2026-10-02", []), sess("2026-10-10", []), sess("2026-10-10", []), sess("2026-10-30", [])];
  assert.deepEqual(P.gaps(list, TODAY), { daysSinceLast: 4, longestGap: 19 });
  assert.deepEqual(P.gaps([sess("2026-11-03", [])], TODAY), { daysSinceLast: 0, longestGap: null });
  assert.deepEqual(P.gaps([], TODAY), { daysSinceLast: null, longestGap: null });
});

test("the month calendar: Monday first, counts per day (older entries too), today and the future marked", () => {
  const legacy = { id: "old", name: "Run", date: "2026-11-02", category: "Cardio" };
  const c = P.calendarMonth([sess("2026-11-02", []), legacy, sess("2026-11-30", []), sess("2026-10-31", [])], 2026, 10, TODAY);
  assert.equal(c.title, "November 2026");
  assert.equal(c.weeks.length, 6, "November 2026 starts on a Sunday, so it needs six rows");
  assert.deepEqual(c.weeks[0].map((d) => d.day), [26, 27, 28, 29, 30, 31, 1]);
  assert.deepEqual(c.weeks[0].map((d) => d.inMonth), [false, false, false, false, false, false, true]);
  const mon = c.weeks[1][0];
  assert.deepEqual([mon.date, mon.count, mon.today, mon.future], ["2026-11-02", 2, false, false]);
  const tue = c.weeks[1][1];
  assert.deepEqual([tue.today, tue.future, c.weeks[1][2].future], [true, false, true]);
  assert.equal(c.total, 3, "this month's workouts only; October 31 is shown greyed and not counted");
  assert.equal(c.weeks[0][5].count, 1, "a day from the neighbouring month still shows its dot");
  const feb = P.calendarMonth([], 2027, 1, TODAY);
  assert.equal(feb.weeks.length, 4, "February 2027 starts on a Monday and has 28 days");
  assert.deepEqual(P.shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(P.shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(P.shiftMonth(2026, 5, 14), { year: 2027, month: 7 });
});

test("an exercise over time: the best estimated 1RM of each day's working sets, never a warm-up", () => {
  const list = [
    sess("2026-10-06", [ex("bench", [set(60, 10, { warmup: true }), set(135, 5), set(140, 3)])]),
    sess("2026-10-13", [ex("bench", [set(135, 8)]), ex("row", [set(100, 8)])]),
    sess("2026-10-20", [ex("row", [set(105, 8)])]),
    sess("2026-10-27", [ex("bench", [set(145, 5), set(145, 5)])]),
    sess("2026-10-28", [ex("bench", [set(50, 10, { warmup: true })])])
  ];
  const pts = P.exerciseSeries(list, "bench");
  assert.deepEqual(pts.map((p) => [p.date, p.e1rm, p.topWeight, p.topReps, p.volume, p.sets]), [
    ["2026-10-06", 157.5, 140, 3, 135 * 5 + 140 * 3, 2],
    ["2026-10-13", 171, 135, 8, 1080, 1],
    ["2026-10-27", 169.2, 145, 5, 1450, 2]
  ].map((r) => r));
  assert.equal(P.exerciseSeries(list, "bench", "2026-10-10", "2026-10-20").length, 1, "limited to a period");
  assert.deepEqual(P.exerciseSeries(list, "squat"), []);
});

test("change over a period needs two sessions; one session shows no change", () => {
  const pts = [{ e1rm: 150 }, { e1rm: 155 }, { e1rm: 165 }];
  assert.deepEqual(P.seriesChange(pts, "e1rm"), { first: 150, last: 165, delta: 15, pct: 10, sessions: 3 });
  assert.equal(P.seriesChange([{ e1rm: 150 }], "e1rm"), null);
  assert.equal(P.seriesChange([], "e1rm"), null);
  assert.equal(P.seriesChange([{ e1rm: 0 }, { e1rm: 5 }], "e1rm").pct, null, "no percentage from zero");
});

test("an exercise's all-time facts, taken straight from what was saved", () => {
  const list = [sess("2026-10-06", [ex("bench", [set(60, 10, { warmup: true }), set(135, 5), set(140, 3)])]), sess("2026-10-27", [ex("bench", [set(145, 5)])])];
  const s = P.exerciseSummary(list, "bench");
  assert.deepEqual([s.sessions, s.sets, s.reps, s.volume, s.firstDate, s.lastDate], [2, 3, 13, 135 * 5 + 140 * 3 + 145 * 5, "2026-10-06", "2026-10-27"]);
  assert.deepEqual([s.bestE1rm.value, s.bestE1rm.weight, s.bestE1rm.reps, s.bestE1rm.date], [169.2, 145, 5, "2026-10-27"]);
  assert.deepEqual([s.heaviest.weight, s.heaviest.reps], [145, 5]);
  assert.equal(P.exerciseSummary(list, "squat"), null);
});

test("the list of exercises: most-done first, warm-up-only entries left out", () => {
  const list = [sess("2026-10-06", [ex("a", [set(1, 1)]), ex("b", [set(1, 1)]), ex("w", [set(1, 1, { warmup: true })])]), sess("2026-10-13", [ex("a", [set(1, 1)])]), sess("2026-10-20", [ex("b", [set(1, 1)]), ex("c", [set(1, 1)])])];
  assert.deepEqual(P.exerciseList(list).map((e) => [e.exerciseId, e.sessions, e.lastDate]), [["b", 2, "2026-10-20"], ["a", 2, "2026-10-13"], ["c", 1, "2026-10-20"]]);
});

test("top lifts: each exercise's change inside the period, none for a single session", () => {
  const list = [sess("2026-10-06", [ex("bench", [set(135, 5)]), ex("squat", [set(185, 5)])]), sess("2026-10-20", [ex("bench", [set(145, 5)])]), sess("2026-09-01", [ex("bench", [set(95, 5)])])];
  const t = P.topLifts(list, "2026-10-01", "2026-11-03", 5);
  assert.deepEqual(t.map((x) => [x.exerciseId, x.sessions, x.change && x.change.delta]), [["bench", 2, 11.7], ["squat", 1, null]]);
  assert.equal(P.topLifts(list, "2026-10-01", "2026-11-03", 1).length, 1);
});

test("records inside a period, and how many each workout set", () => {
  const a = sess("2026-10-06", [ex("bench", [set(135, 5)])]), b = sess("2026-10-13", [ex("bench", [set(140, 5)])]), c = sess("2026-10-20", [ex("bench", [set(130, 5)])]), d = sess("2026-10-27", [ex("bench", [set(150, 5)])]);
  const list = [a, b, c, d];
  assert.deepEqual(P.recordsBetween(list, "2026-10-10", "2026-10-26").map((r) => r.date), ["2026-10-13"]);
  assert.deepEqual(P.recordsBetween(list, "2026-10-01", "2026-11-03").map((r) => r.date), ["2026-10-27", "2026-10-13"], "newest first; the first ever workout is a baseline, not a record");
  assert.equal(P.recordsBetween(list, "2026-10-01", "2026-11-03", 1).length, 1);
  const counts = P.recordCountBySession(list);
  assert.deepEqual([counts[a.id], counts[b.id], counts[c.id], counts[d.id]], [undefined, 1, undefined, 1]);
});

const MUSCLES = { bench: { primary: ["Chest"], secondary: ["Triceps", "Shoulders"] }, row: { primary: ["Back"], secondary: ["Biceps"] } };
const lookup = (id) => MUSCLES[id] || null;

test("sets per muscle: working sets for the main muscle; helping muscles only if you ask, at half", () => {
  const list = [sess("2026-10-20", [ex("bench", [set(60, 10, { warmup: true }), set(100, 5), set(100, 5)]), ex("row", [set(80, 8)]), ex("mystery", [set(10, 10), set(10, 10)])]), sess("2026-09-01", [ex("bench", [set(100, 5)])])];
  const plain = P.muscleTotals(list, "2026-10-01", "2026-11-03", lookup);
  assert.deepEqual(plain.byMuscle, { Chest: 2, Back: 1 });
  assert.equal(plain.unknownSets, 2, "sets for an exercise with no muscle on record are reported, not guessed");
  const half = P.muscleTotals(list, "2026-10-01", "2026-11-03", lookup, { secondaryHalf: true });
  assert.deepEqual(half.byMuscle, { Chest: 2, Triceps: 1, Shoulders: 1, Back: 1, Biceps: 0.5 });
  assert.deepEqual(P.muscleTotals(list, "2026-01-01", "2026-11-03", lookup).byMuscle, { Chest: 3, Back: 1 });
});

test("muscle rows: ranked, with sets per week and a bar share", () => {
  const rows = P.muscleRows({ Chest: 24, Back: 12, Legs: 12, Arms: 0 }, 12);
  assert.deepEqual(rows.map((r) => [r.muscle, r.sets, r.perWeek, r.share]), [["Chest", 24, 2, 1], ["Back", 12, 1, 0.5], ["Legs", 12, 1, 0.5]]);
  assert.equal(P.muscleRows({ Chest: 5 }, 0)[0].perWeek, null, "no weeks, no weekly rate");
  assert.deepEqual(P.muscleRows({}, 4), []);
});

test("days since each muscle was last the main target", () => {
  const list = [sess("2026-10-20", [ex("bench", [set(100, 5)])]), sess("2026-10-30", [ex("row", [set(80, 8)]), ex("bench", [set(50, 10, { warmup: true })])])];
  assert.deepEqual(P.lastTrained(list, TODAY, lookup), { Chest: 14, Back: 4 });
});

test("times of day and the time-spent points", () => {
  assert.deepEqual(["2026-11-02T18:30", "2026-11-02T00:05", "2026-11-02T12:00", "2026-11-02T09:07", "", null, "x"].map(P.timeLabel), ["6:30 PM", "12:05 AM", "12:00 PM", "9:07 AM", "", "", ""]);
  const pts = P.durationPoints([sess("2026-10-20", [], { duration: 50 }), sess("2026-10-13", [], { duration: 40 }), sess("2026-10-14", [], { duration: null }), sess("2026-10-15", [], { duration: 0 })]);
  assert.deepEqual(pts, [{ date: "2026-10-13", minutes: 40 }, { date: "2026-10-20", minutes: 50 }]);
});

const names = { bench: "Barbell Bench Press", row: "Barbell Row", squat: "Back Squat" };
const ctx = { label: (w) => w.routineId === "r1" ? "Push Day" : (w.routineName || ""), exerciseName: (id) => names[id] || "Unknown exercise", programText: (w) => w.programId ? "PPL · Day 1" : "" };

test("a History card: title from the routine, times, sets, volume, records; older entries stay simple", () => {
  const a = sess("2026-10-06", [ex("bench", [set(135, 5)])], { routineId: "r1" }), b = sess("2026-10-13", [ex("bench", [set(60, 10, { warmup: true }), set(140, 5), set(145, 3)]), ex("row", [set(0, 0)])], { routineId: "r1", dateTime: "2026-10-13T07:05", programId: "p" });
  const counts = P.recordCountBySession([a, b]);
  const item = P.historyItem(b, ctx, counts);
  assert.deepEqual([item.kind, item.title, item.date, item.time, item.minutes, item.sets, item.volume, item.prs, item.program], ["session", "Push Day", "2026-10-13", "7:05 AM", 60, 2, 140 * 5 + 145 * 3, 1, "PPL · Day 1"]);
  assert.deepEqual(item.exercises.map((e) => [e.name, e.sets, e.best]), [["Barbell Bench Press", 2, { weight: 145, reps: 3 }]], "the empty row entry is left out");
  assert.equal(P.historyItem(sess("2026-10-14", [ex("bench", [set(100, 5)])]), ctx, counts).title, "Workout", "no routine name anywhere");
  assert.equal(P.historyItem(sess("2026-10-14", [ex("bench", [set(100, 5)])], { routineName: "Pull Day" }), ctx, counts).title, "Pull Day", "the name saved with the workout");
  const legacy = P.historyItem({ id: "o", name: "Evening run", category: "Cardio", date: "2026-09-01", duration: 30, notes: "easy" }, ctx, counts);
  assert.deepEqual([legacy.kind, legacy.title, legacy.sub, legacy.minutes, legacy.sets, legacy.notes], ["legacy", "Evening run", "Cardio", 30, null, "easy"]);
});

test("search and filters: every word must match the title, the notes or an exercise; newest first", () => {
  const list = [
    sess("2026-10-06", [ex("bench", [set(135, 5)])], { routineId: "r1", notes: "felt strong" }),
    sess("2026-10-13", [ex("row", [set(100, 8)])], { routineName: "Pull Day" }),
    sess("2026-10-20", [ex("squat", [set(185, 5)])]),
    { id: "o", name: "Evening run", category: "Cardio", date: "2026-10-20", notes: "" }
  ];
  const f = (o) => P.filterHistory(list, o, ctx).map((w) => w.id);
  assert.deepEqual(f({}).length, 4);
  assert.equal(P.filterHistory(list, {}, ctx)[0].date, "2026-10-20", "newest first");
  assert.deepEqual(f({ query: "push" }), [list[0].id], "by routine name");
  assert.deepEqual(f({ query: "STRONG push" }), [list[0].id], "words in any order, any case, across fields");
  assert.deepEqual(f({ query: "bench strong" }), [list[0].id], "an exercise name and a note");
  assert.deepEqual(f({ query: "run cardio" }), ["o"], "older entries are searchable too");
  assert.deepEqual(f({ query: "push row" }), [], "all words must match");
  assert.deepEqual(f({ day: "2026-10-20" }).sort(), [list[2].id, "o"].sort(), "one day");
  assert.deepEqual(f({ routine: "r:r1" }), [list[0].id]);
  assert.deepEqual(f({ routine: "free" }).sort(), [list[1].id, list[2].id, "o"].sort(), "workouts with no routine");
  assert.deepEqual(f({ query: "squat", day: "2026-10-13" }), [], "filters combine");
});

test("the routines you can filter by, with counts, including ones that no longer exist", () => {
  const list = [sess("2026-10-06", [], { routineId: "r1" }), sess("2026-10-13", [], { routineId: "r1" }), sess("2026-10-20", [], { routineId: "gone", routineName: "Pull Day" }), sess("2026-10-21", [])];
  const ctx2 = { label: (w) => w.routineId === "r1" ? "Push Day" : (w.routineName || ""), exerciseName: () => "" };
  assert.deepEqual(P.routineOptions(list, ctx2), [{ key: "r:r1", label: "Push Day", count: 2 }, { key: "free", label: "No routine", count: 1 }, { key: "r:gone", label: "Pull Day", count: 1 }]);
});

test("none of this changes what it is given", () => {
  const list = deepFreeze([sess("2026-10-20", [ex("bench", [set(100, 5), set(60, 10, { warmup: true })])], { routineId: "r1" }), sess("2026-10-27", [ex("bench", [set(105, 5)])])]);
  const legacy = deepFreeze({ id: "o", name: "Run", date: "2026-10-01" });
  assert.doesNotThrow(() => {
    P.rangeBounds("3m", TODAY, list); P.inRange(list, "2026-10-01", TODAY); P.summarize(list); P.weeklySeries(list, TODAY, 6); P.gaps(list, TODAY);
    P.calendarMonth(list.concat([legacy]), 2026, 9, TODAY); P.exerciseSeries(list, "bench"); P.exerciseSummary(list, "bench"); P.exerciseList(list); P.topLifts(list, "2026-10-01", TODAY, 5);
    P.recordsBetween(list, "2026-10-01", TODAY); P.recordCountBySession(list); P.muscleTotals(list, "2026-10-01", TODAY, lookup, { secondaryHalf: true });
    P.lastTrained(list, TODAY, lookup); P.durationPoints(list); P.sortNewest(list); P.filterHistory(list.concat([legacy]), { query: "bench" }, ctx);
    P.routineOptions(list, ctx); P.historyItem(list[0], ctx, {}); P.historyItem(legacy, ctx, {});
  });
});
