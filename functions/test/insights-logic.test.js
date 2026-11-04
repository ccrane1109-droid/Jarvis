"use strict";

process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../../js/insights-logic");
const W = require("../../js/workout-logic");

function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }
const set = (weight, reps, o) => Object.assign({ weight: weight, reps: reps, warmup: false, dropset: false }, o || {});
const ex = (exerciseId, sets) => ({ exerciseId: exerciseId, sets: sets });
let n = 0;
const sess = (date, exercises, o) => Object.assign({ id: "w" + (++n), schema: 2, dateTime: date + "T18:00", date: date, routineId: null, programId: null, programDayId: null, notes: "", duration: 60, exercises: exercises, createdAt: n }, o || {});
const TODAY = "2026-11-03"; // a Tuesday
const plan = (count, reps) => Array.from({ length: count }, () => ({ reps: reps, type: "normal" }));
const three = (w, reps, o) => [set(w, reps, o), set(w, reps, o), set(w, reps, o)];

/* ---------------- ready to progress ---------------- */

test("two sessions in a row at the same weight, every set at target: suggests a small step, with the reasons", () => {
  const h = deepFreeze([sess("2026-10-27", [ex("bench", three(145, 8))]), sess("2026-10-30", [ex("bench", [set(145, 8), set(145, 9), set(145, 8)])])]);
  const p = I.progressionFor(h, "bench", { plan: plan(3, 8), todayKey: TODAY, name: "Bench Press" });
  assert.equal(p.kind, "increase");
  assert.deepEqual([p.from, p.to, p.increment, p.target, p.need], [145, 150, 5, 8, 3]);
  assert.deepEqual(p.dates, ["2026-10-27", "2026-10-30"]);
  const why = p.why.join(" | ");
  assert.match(why, /Your plan for Bench Press is 3 × 8/);
  assert.match(why, /Oct 27: 145 lb for 8, 8, 8 reps\. Oct 30: 145 lb for 8, 9, 8 reps/);
  assert.match(why, /145 → 150 lb/);
  assert.match(why, /Nothing changes until you tap Use 150/);
  assert.match(p.title, /150 lb/);
});

test("under 30 lb the step is 2.5, and a fractional weight stays exact", () => {
  assert.equal(I.stepFor(25), 2.5);
  assert.equal(I.stepFor(30), 5);
  const h = [sess("2026-10-27", [ex("raise", three(22.5, 12))]), sess("2026-10-30", [ex("raise", three(22.5, 12))])];
  const p = I.progressionFor(h, "raise", { plan: plan(3, 12), todayKey: TODAY });
  assert.deepEqual([p.kind, p.from, p.to], ["increase", 22.5, 25]);
  const h2 = [sess("2026-10-27", [ex("row", three(142.5, 10))]), sess("2026-10-30", [ex("row", three(142.5, 10))])];
  assert.equal(I.progressionFor(h2, "row", { plan: plan(3, 10), todayKey: TODAY }).to, 147.5);
});

test("no suggestion until the plan was met in BOTH of the last two sessions", () => {
  const miss = [sess("2026-10-27", [ex("bench", three(145, 8))]), sess("2026-10-30", [ex("bench", [set(145, 8), set(145, 8), set(145, 6)])])];
  assert.deepEqual(I.progressionFor(miss, "bench", { plan: plan(3, 8), todayKey: TODAY }), { kind: "none", reason: "not-yet" }, "one set short last time");
  const olderMiss = [sess("2026-10-27", [ex("bench", [set(145, 8), set(145, 7), set(145, 8)])]), sess("2026-10-30", [ex("bench", three(145, 8))])];
  assert.equal(I.progressionFor(olderMiss, "bench", { plan: plan(3, 8), todayKey: TODAY }).reason, "not-yet", "one set short in the older session");
  const justMoved = [sess("2026-10-27", [ex("bench", three(140, 8))]), sess("2026-10-30", [ex("bench", three(145, 8))])];
  assert.equal(I.progressionFor(justMoved, "bench", { plan: plan(3, 8), todayKey: TODAY }).reason, "not-yet", "only one session at the new weight");
  const wentDown = [sess("2026-10-27", [ex("bench", three(150, 8))]), sess("2026-10-30", [ex("bench", three(145, 8))])];
  assert.equal(I.progressionFor(wentDown, "bench", { plan: plan(3, 8), todayKey: TODAY }).reason, "not-yet", "weight dropped, so it is not two in a row");
  const oneSession = [sess("2026-10-30", [ex("bench", three(145, 8))])];
  assert.equal(I.progressionFor(oneSession, "bench", { plan: plan(3, 8), todayKey: TODAY }).reason, "history");
});

test("warm-ups and drop sets never count toward the rule, and legacy entries are ignored", () => {
  const withExtras = (date) => sess(date, [ex("bench", [set(60, 10, { warmup: true }), set(145, 8), set(145, 8), set(145, 8), set(100, 12, { dropset: true })])]);
  const h = [withExtras("2026-10-27"), withExtras("2026-10-30"), { id: "old", name: "Chest day", category: "Strength", date: "2026-10-31", duration: 40 }];
  const p = I.progressionFor(h, "bench", { plan: plan(3, 8), todayKey: TODAY });
  assert.deepEqual([p.kind, p.from, p.to], ["increase", 145, 150]);
  const dropOnly = [sess("2026-10-27", [ex("bench", [set(100, 12, { dropset: true })])]), sess("2026-10-30", [ex("bench", [set(100, 12, { dropset: true })])])];
  assert.equal(I.progressionFor(dropOnly, "bench", { plan: plan(1, 12), todayKey: TODAY }).reason, "drop-only");
});

test("it needs a plan with one rep target, and never suggests for bodyweight-only work", () => {
  const h = [sess("2026-10-27", [ex("bench", three(145, 8))]), sess("2026-10-30", [ex("bench", three(145, 8))])];
  assert.equal(I.progressionFor(h, "bench", { todayKey: TODAY }).reason, "no-plan");
  assert.equal(I.progressionFor(h, "bench", { plan: [], todayKey: TODAY }).reason, "no-plan");
  assert.equal(I.progressionFor(h, "bench", { plan: [{ reps: 8, type: "normal" }, { reps: 6, type: "normal" }], todayKey: TODAY }).reason, "mixed-reps");
  assert.equal(I.progressionFor(h, "bench", { plan: [{ reps: 8, type: "warmup" }], todayKey: TODAY }).reason, "no-working-sets");
  const body = [sess("2026-10-27", [ex("pushup", three(0, 15))]), sess("2026-10-30", [ex("pushup", three(0, 15))])];
  assert.equal(I.progressionFor(body, "pushup", { plan: plan(3, 15), todayKey: TODAY }).reason, "bodyweight");
  // warm-up rows in the plan don't change the working-set rule
  const planWithWarm = [{ reps: 10, type: "warmup" }].concat(plan(3, 8));
  assert.equal(I.progressionFor(h, "bench", { plan: planWithWarm, todayKey: TODAY }).kind, "increase");
});

test("a very hard set (RPE 9.5+) holds the weight and says so; a long break holds it too", () => {
  const hard = [sess("2026-10-27", [ex("bench", three(145, 8))]), sess("2026-10-30", [ex("bench", [set(145, 8), set(145, 8), set(145, 8, { rpe: 10 })])])];
  const p = I.progressionFor(hard, "bench", { plan: plan(3, 8), todayKey: TODAY, name: "Bench Press" });
  assert.deepEqual([p.kind, p.reason, p.from], ["hold", "rpe", 145]);
  assert.match(p.why.join(" "), /RPE 10/);
  const okRpe = [sess("2026-10-27", [ex("bench", three(145, 8, { rpe: 8 }))]), sess("2026-10-30", [ex("bench", three(145, 8, { rpe: 9 }))])];
  const q = I.progressionFor(okRpe, "bench", { plan: plan(3, 8), todayKey: TODAY });
  assert.equal(q.kind, "increase");
  assert.match(q.why.join(" "), /RPE you logged on those sets: 9, 9, 9, 8, 8, 8\. None was 9\.5 or higher/);
  const old = [sess("2026-08-01", [ex("bench", three(145, 8))]), sess("2026-08-04", [ex("bench", three(145, 8))])];
  const g = I.progressionFor(old, "bench", { plan: plan(3, 8), todayKey: TODAY });
  assert.deepEqual([g.kind, g.reason], ["hold", "gap"]);
  assert.ok(g.days > 28);
  const edge = I.progressionFor(old, "bench", { plan: plan(3, 8), todayKey: "2026-09-01" });
  assert.equal(edge.kind, "increase", "28 days or fewer: still fine");
});

/* ---------------- plateau ---------------- */

const series = (id, rows) => rows.map((r) => sess(r[0], [ex(id, [set(r[1], r[2])])]));

test("plateau: nothing has beaten the best in 4+ sessions and 3+ weeks", () => {
  const h = deepFreeze(series("bench", [["2026-09-01", 135, 8], ["2026-09-08", 145, 8], ["2026-09-15", 150, 8], ["2026-09-22", 145, 8], ["2026-09-29", 145, 8], ["2026-10-06", 150, 7], ["2026-10-13", 145, 8], ["2026-10-20", 145, 8]]));
  const p = I.plateauFor(h, "bench", TODAY, "Bench Press");
  assert.equal(p.kind, "plateau");
  assert.equal(p.bestDate, "2026-09-15");
  assert.deepEqual([p.sessionsSince, p.daysSince], [5, 35]);
  assert.match(p.title, /Bench Press: no new best in 35 days/);
  assert.match(p.why.join(" "), /not based on your data/);
  assert.match(p.why.join(" "), /description, not a diagnosis/);
});

test("plateau: a new best inside the window, a short span, too few sessions, or a lift you stopped doing: no plateau", () => {
  const fresh = series("bench", [["2026-09-01", 135, 8], ["2026-09-08", 145, 8], ["2026-09-15", 145, 8], ["2026-09-22", 145, 8], ["2026-09-29", 145, 8], ["2026-10-06", 150, 8]]);
  assert.equal(I.plateauFor(fresh, "bench", TODAY), null, "a new best on the last session");
  const quick = series("bench", [["2026-10-01", 150, 8], ["2026-10-04", 145, 8], ["2026-10-07", 145, 8], ["2026-10-10", 145, 8], ["2026-10-13", 145, 8]]);
  assert.equal(I.plateauFor(quick, "bench", TODAY), null, "4 sessions but only 12 days");
  const few = series("bench", [["2026-09-01", 150, 8], ["2026-09-20", 145, 8], ["2026-10-10", 145, 8]]);
  assert.equal(I.plateauFor(few, "bench", TODAY), null, "3 sessions");
  const gone = series("bench", [["2026-06-01", 150, 8], ["2026-06-08", 145, 8], ["2026-06-15", 145, 8], ["2026-06-22", 145, 8], ["2026-06-29", 145, 8]]);
  assert.equal(I.plateauFor(gone, "bench", TODAY), null, "stopped doing it months ago: not a plateau");
  assert.equal(I.plateauFor([], "bench", TODAY), null);
});

test("plateau: a tiny rounding difference does not count as a new best", () => {
  const h = series("bench", [["2026-09-01", 150, 8], ["2026-09-08", 150, 8], ["2026-09-15", 150, 8], ["2026-09-22", 150, 8], ["2026-09-29", 150, 8]]);
  const p = I.plateauFor(h, "bench", TODAY);
  assert.equal(p.bestDate, "2026-09-01", "ties keep the first");
  assert.equal(p.sessionsSince, 4);
});

/* ---------------- improvements ---------------- */

test("improvements: the best of the first sessions against the best of the latest", () => {
  const h = deepFreeze(series("squat", [["2026-08-20", 185, 5], ["2026-09-03", 190, 5], ["2026-09-24", 200, 5], ["2026-10-20", 205, 5]]).concat(series("curl", [["2026-10-01", 30, 10], ["2026-10-20", 30, 10], ["2026-10-30", 30, 10]])));
  const list = I.improvements(h, TODAY, (id) => ({ squat: "Squat", curl: "Curl" }[id]));
  assert.equal(list.length, 1, "the curl did not change");
  const s = list[0];
  assert.deepEqual([s.exerciseId, s.sessions], ["squat", 4]);
  // the maths, spelled out: best of the first two sessions is 190 x 5, best of the latest two is 205 x 5
  assert.equal(s.from, Math.round(190 * (1 + 5 / 30) * 10) / 10);
  assert.equal(s.to, Math.round(205 * (1 + 5 / 30) * 10) / 10);
  assert.equal(s.pct, Math.round((205 - 190) / 190 * 100));
  assert.match(s.why.join(" "), /first 2 sessions/);
  assert.match(s.why.join(" "), /The sets behind those two numbers: 190 × 5 then 205 × 5 \(heaviest set of each session\)/);
  assert.doesNotMatch(s.why.join(" "), /more than 10 reps/, "five-rep sets need no caveat");
  const high = I.improvements(series("curl", [["2026-09-01", 15, 15], ["2026-09-20", 17.5, 15], ["2026-10-20", 20, 15]]), TODAY)[0];
  assert.match(high.why.join(" "), /more than 10 reps are rougher/);
  assert.match(s.title, /Squat is up 8%/);
});

test("improvements: under 3 sessions, under 2 weeks, under 3%, or older than 90 days: nothing", () => {
  assert.equal(I.improvements(series("squat", [["2026-10-01", 185, 5], ["2026-10-30", 225, 5]]), TODAY).length, 0, "2 sessions");
  assert.equal(I.improvements(series("squat", [["2026-10-20", 185, 5], ["2026-10-24", 195, 5], ["2026-10-28", 205, 5]]), TODAY).length, 0, "8 days");
  assert.equal(I.improvements(series("squat", [["2026-09-01", 200, 5], ["2026-09-20", 201, 5], ["2026-10-20", 202, 5]]), TODAY).length, 0, "1%");
  assert.equal(I.improvements(series("squat", [["2026-05-01", 100, 5], ["2026-05-20", 150, 5], ["2026-06-20", 200, 5]]), TODAY).length, 0, "all of it older than 90 days");
});

/* ---------------- volume and muscles ---------------- */

const lookup = (id) => ({ bench: { primary: ["Chest"] }, row: { primary: ["Lats"] }, squat: { primary: ["Quads"] } }[id] || null);
// Four workouts in each window. Earlier window 2026-09-09..10-06, last 4 weeks 10-07..11-03.
function twoWindows(prevSets, curSets, prevCount, curCount) {
  const out = [];
  for (let i = 0; i < prevCount; i++) out.push(sess(W.addDays("2026-09-09", i * 8), [ex("bench", Array.from({ length: prevSets }, () => set(100, 10)))]));
  for (let i = 0; i < curCount; i++) out.push(sess(W.addDays("2026-10-08", i * 8), [ex("bench", Array.from({ length: curSets }, () => set(100, 10)))]));
  return out;
}

test("volume: a 20% change in the last 4 weeks against the 4 before, only when history covers both", () => {
  const h = deepFreeze(twoWindows(3, 4, 4, 4));   // 12 sets -> 16 sets of 1000 lb
  const v = I.volumeChange(h, TODAY);
  assert.equal(v.direction, "up");
  assert.equal(v.pct, 33);
  assert.deepEqual([v.prev.volume, v.cur.volume, v.prev.workouts, v.cur.workouts], [12000, 16000, 4, 4]);
  assert.match(v.title, /up 33%/);
  assert.match(v.why.join(" "), /12,000 → 16,000 lb/);
  const down = I.volumeChange(twoWindows(4, 2, 4, 4), TODAY);
  assert.deepEqual([down.direction, down.pct], ["down", -50]);
  assert.equal(I.volumeChange(twoWindows(5, 5, 4, 4), TODAY), null, "no change, no note");
  assert.equal(I.volumeChange(twoWindows(10, 11, 4, 4), TODAY), null, "10% is under the line");
});

test("volume: no note when the earlier window is thin or your history doesn't reach back that far", () => {
  assert.equal(I.volumeChange(twoWindows(3, 4, 2, 4), TODAY), null, "only 2 workouts before");
  assert.equal(I.volumeChange(twoWindows(3, 4, 0, 4), TODAY), null, "started 4 weeks ago: nothing to compare with");
  assert.equal(I.volumeChange([], TODAY), null);
  assert.equal(I.windows(twoWindows(3, 4, 4, 4), TODAY).prevStart, "2026-09-09", "the windows are fixed by the date");
  const late = twoWindows(3, 4, 4, 4).slice(1);   // the first earlier workout is gone: the log now starts 8 days into that window
  assert.equal(I.windows(late, TODAY), null, "history must cover the whole earlier window");
  assert.equal(I.volumeChange(late, TODAY), null);
});

test("muscles: a muscle that fell 40% or rose 50% from at least 8 sets", () => {
  const h = [];
  for (let i = 0; i < 4; i++) { h.push(sess(W.addDays("2026-09-09", i * 7), [ex("bench", [set(100, 10), set(100, 10), set(100, 10)]), ex("row", [set(80, 10), set(80, 10), set(80, 10)]), ex("squat", [set(100, 5)])])); }
  for (let i = 0; i < 4; i++) { h.push(sess(W.addDays("2026-10-08", i * 7), [ex("bench", [set(100, 10), set(100, 10), set(100, 10), set(100, 10), set(100, 10)]), ex("row", [set(80, 10)]), ex("squat", [set(100, 5)])])); }
  const shifts = I.muscleShifts(deepFreeze(h), TODAY, lookup);
  const byName = {}; shifts.forEach((s) => { byName[s.muscle] = s; });
  assert.deepEqual([byName.Chest.direction, byName.Chest.prev, byName.Chest.cur, byName.Chest.pct], ["up", 12, 20, 67]);
  assert.deepEqual([byName.Lats.direction, byName.Lats.prev, byName.Lats.cur, byName.Lats.pct], ["down", 12, 4, -67]);
  assert.equal(byName.Quads, undefined, "4 sets is under the 8-set line");
  assert.match(byName.Lats.title, /Lats sets are down 67%/);
  assert.match(byName.Lats.why.join(" "), /doesn't know your goals/);
  // never-trained-again reads plainly
  const gone = h.slice(0, 4);
  gone.push(sess("2026-10-20", [ex("squat", [set(100, 5)])]));
  const g = I.muscleShifts(gone, TODAY, lookup).filter((s) => s.muscle === "Chest")[0];
  assert.match(g.text, /No working sets for chest in the last 4 weeks, after 12/);
  assert.deepEqual(I.muscleShifts(h, TODAY, null), [], "no muscle information: no claim");
});

/* ---------------- recovery ---------------- */

test("recovery: days in a row, the same muscle two days running, and a long break are counted, never judged", () => {
  const streak = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"].map((d) => sess(d, [ex("bench", three(100, 10))]));
  const r = I.recoveryNotes(deepFreeze(streak), TODAY, lookup);
  const st = r.filter((x) => x.type === "streak")[0];
  assert.match(st.title, /You trained 4 days in a row/);
  assert.match(st.why.join(" "), /no sleep, soreness or heart-rate data/);
  const bb = r.filter((x) => x.type === "back-to-back")[0];
  assert.match(bb.title, /Chest two days in a row/);
  assert.match(bb.why.join(" "), /can't measure whether you were recovered/);
  assert.equal(I.recoveryNotes(streak.slice(1), TODAY, lookup).filter((x) => x.type === "streak").length, 0, "3 days in a row is under the line");
  const old = [sess("2026-10-10", [ex("bench", three(100, 10))])];
  const br = I.recoveryNotes(old, TODAY, lookup);
  assert.equal(br.length, 1);
  assert.equal(br[0].type, "break");
  assert.match(br[0].title, /24 days since your last workout/);
  assert.deepEqual(I.recoveryNotes([], TODAY, lookup), []);
  const two = [sess("2026-11-02", [ex("bench", [set(100, 10), set(100, 10)])]), sess("2026-11-03", [ex("bench", three(100, 10))])];
  assert.equal(I.recoveryNotes(two, TODAY, lookup).filter((x) => x.type === "back-to-back").length, 0, "2 sets is under the 3-set line");
  const stale = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].map((d) => sess(d, [ex("bench", three(100, 10))]));
  assert.equal(I.recoveryNotes(stale, TODAY, lookup).filter((x) => x.type === "streak").length, 0, "a streak that ended days ago is not announced as current");
});

/* ---------------- substitutes ---------------- */

const LIB = [
  { id: "bb-bench", name: "Barbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
  { id: "db-bench", name: "Dumbbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
  { id: "chest-press", name: "Chest Press Machine", muscleGroup: "Chest", equipment: "Machine" },
  { id: "cable-fly", name: "Cable Fly", muscleGroup: "Chest", equipment: "Cable" },
  { id: "bench-press", name: "Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
  { id: "dip", name: "Chest Dip", muscleGroup: "Chest", equipment: "Bodyweight" },
  { id: "tri-push", name: "Triceps Pushdown", muscleGroup: "Triceps", equipment: "Cable" },
  { id: "row", name: "Seated Row", muscleGroup: "Back", equipment: "Cable" },
  { id: "run", name: "Treadmill Run", muscleGroup: "Cardio", equipment: "Cardio Equipment" },
  { id: "mystery", name: "Mystery Move", muscleGroup: "Chest", equipment: "Machine" }
];
const FINE = { "bb-bench": ["Chest"], "db-bench": ["Chest"], "chest-press": ["Chest"], "cable-fly": ["Chest"], "bench-press": ["Chest"], dip: ["Chest", "Triceps"], "tri-push": ["Triceps"], row: ["Lats"], run: [] };
const fineLookup = (id) => (FINE[id] ? { primary: FINE[id], secondary: [] } : { primary: [], secondary: [] });

test("swap suggestions: same main muscle, ranked, every one explained, nothing for cardio or unknown", () => {
  const h = [sess("2026-10-12", [ex("db-bench", [set(60, 10), set(60, 10)])])];
  const r = I.substitutes("bb-bench", { library: LIB, lookup: fineLookup, workouts: deepFreeze(h), exclude: [], todayKey: TODAY });
  const ids = r.items.map((x) => x.exerciseId);
  assert.equal(ids[0], "db-bench", "same muscle, same movement (press), same group, and you have logged it");
  assert.equal(ids[1], "chest-press");
  assert.ok(ids.indexOf("tri-push") === -1 && ids.indexOf("row") === -1 && ids.indexOf("run") === -1, "other muscles and cardio never appear");
  assert.ok(ids.indexOf("mystery") === -1, "an exercise with no muscle information can't be matched, so it is left out");
  assert.ok(ids.indexOf("bench-press") === -1, "the same exercise under another spelling is not an alternative");
  assert.ok(ids.indexOf("bb-bench") === -1, "not itself");
  const first = r.items[0];
  assert.match(first.why.join(" | "), /Works the same main muscle: Chest/);
  assert.match(first.why.join(" | "), /The same lift \(bench press\) with different equipment/);
  const machineFirst = r.items.filter((x) => x.exerciseId === "chest-press")[0];
  assert.match(machineFirst.why.join(" | "), /Same kind of movement \(press\)/, "a different lift of the same movement says so");
  assert.match(first.why.join(" | "), /Same equipment type \(Free Weight\)/);
  assert.match(first.why.join(" | "), /logged it 1 time\. Last on Oct 12: 60 × 10, 60 × 10/);
  const machine = r.items.filter((x) => x.exerciseId === "chest-press")[0];
  assert.match(machine.why.join(" | "), /Equipment: Machine, where Barbell Bench Press uses Free Weight/);
  assert.match(machine.why.join(" | "), /haven't logged it yet/);
  const dip = r.items.filter((x) => x.exerciseId === "dip")[0];
  assert.match(dip.why.join(" | "), /Shares the main muscle Chest and also works Triceps/);
  r.items.forEach((x) => assert.ok(x.why.length >= 3, x.name + " has its reasons"));
  assert.equal(I.substitutes("run", { library: LIB, lookup: fineLookup, workouts: [] }).reason, "no-muscles");
  assert.equal(I.substitutes("nope", { library: LIB, lookup: fineLookup, workouts: [] }).reason, "unknown");
});

test("swap suggestions leave out exercises already in the workout, and respect the limit", () => {
  const r = I.substitutes("bb-bench", { library: LIB, lookup: fineLookup, workouts: [], exclude: ["db-bench"], limit: 2 });
  assert.equal(r.items.length, 2);
  assert.ok(r.items.every((x) => x.exerciseId !== "db-bench"));
});

test("movement words are read from the name", () => {
  assert.equal(I.movementOf("Incline Dumbbell Press"), "press");
  assert.equal(I.movementOf("Seated Cable Rows"), "row");
  assert.equal(I.movementOf("Pull-Up"), "pullup");
  assert.equal(I.movementOf("Lat Pulldown"), "pulldown");
  assert.equal(I.movementOf("Triceps Push Down"), "pushdown");
  assert.equal(I.movementOf("Plank"), "");
});

test("a swap only works before any set is done, and keeps the sets' shape without carrying the old weights over", () => {
  const se = { sessionExId: "sx1", exerciseId: "bb-bench", supersetGroup: "g1", sets: [W.newSet({ weight: 45, reps: 10, warmup: true }), W.newSet({ weight: 145, reps: 8 }), W.newSet({ weight: 145, reps: 8 }), W.newSet({ weight: 100, reps: 12, dropset: true })] };
  deepFreeze(se);
  assert.equal(I.canSwap(se), true);
  const history = [sess("2026-10-12", [ex("db-bench", [set(60, 10, { warmup: true }), set(60, 10), set(65, 8)])])];
  const out = I.swapExercise(se, "db-bench", history);
  assert.equal(out.exerciseId, "db-bench");
  assert.equal(out.sessionExId, "sx1");
  assert.equal(out.supersetGroup, "g1");
  assert.deepEqual(out.sets.map((s) => [s.warmup, s.dropset, s.reps]), [[true, false, 10], [false, false, 8], [false, false, 8], [false, true, 12]]);
  assert.deepEqual(out.sets.map((s) => s.weight), [60, 60, 65, 60], "weights come from the new exercise's own last session, set by set (a drop set with none logged borrows the first working set)");
  assert.ok(out.sets.every((s) => s.completed === false));
  const fresh = I.swapExercise(se, "chest-press", []);
  assert.deepEqual(fresh.sets.map((s) => s.weight), ["", "", "", ""], "no history, so blank, not the old exercise's numbers");
  const started = Object.assign({}, se, { sets: se.sets.map((s, i) => (i === 1 ? Object.assign({}, s, { completed: true }) : s)) });
  assert.equal(I.canSwap(started), false, "once a set is finished the exercise can't be swapped");
  assert.equal(I.canSwap(null), false);
});

/* ---------------- changing a weight needs a tap: the only function that does it ---------------- */

test("applying a suggested weight only touches sets still to do", () => {
  const se = deepFreeze({ sessionExId: "sx1", exerciseId: "bench", sets: [
    W.newSet({ id: "w", weight: 60, reps: 10, warmup: true }),
    W.newSet({ id: "a", weight: 145, reps: 8, completed: true, doneAt: 1 }),
    W.newSet({ id: "b", weight: 145, reps: 8 }),
    W.newSet({ id: "c", weight: 145, reps: 8 }),
    W.newSet({ id: "d", weight: 100, reps: 12, dropset: true })
  ] });
  const r = I.applyWeight(se, 150);
  assert.deepEqual(r.changed, ["b", "c"]);
  assert.deepEqual(r.exercise.sets.map((s) => s.weight), [60, 145, 150, 150, 100], "warm-up, finished set and drop set untouched");
  assert.equal(se.sets[2].weight, 145, "the original is not changed");
  assert.deepEqual(I.applyWeight(se, "nonsense").changed, []);
  assert.deepEqual(I.applyWeight(se, -5).changed, []);
});

test("nothing in the module changes what it is given", () => {
  const h = deepFreeze([sess("2026-10-27", [ex("bench", three(145, 8))]), sess("2026-10-30", [ex("bench", three(145, 8))])]);
  const routines = deepFreeze([{ id: "r1", name: "Push", exercises: [{ exerciseId: "bench", plannedSets: plan(3, 8) }] }]);
  const prefs = deepFreeze({ cards: true, logger: true, dismissed: { a: "2026-10-01" } });
  I.buildInsights({ workouts: h, routines: routines, todayKey: TODAY, lookup: lookup, nameOf: (id) => id, prefs: prefs });
  I.dismiss(prefs, "x", TODAY); I.prune(prefs, TODAY); I.clearDismissed(prefs); I.sanitizePrefs(prefs);
  I.plateauFor(h, "bench", TODAY); I.improvements(h, TODAY); I.volumeChange(h, TODAY); I.recoveryNotes(h, TODAY, lookup);
});

/* ---------------- settings, hiding, and the whole list ---------------- */

test("settings: on by default, malformed input is repaired, hidden notes are remembered per note", () => {
  assert.deepEqual(I.sanitizePrefs(null), { cards: true, logger: true, dismissed: {} });
  assert.deepEqual(I.sanitizePrefs({ cards: false, logger: 0, dismissed: { a: "2026-10-01", b: "yesterday", c: 5 } }), { cards: false, logger: true, dismissed: { a: "2026-10-01" } });
  const p = I.dismiss(null, "plateau:bench:2026-09-15", TODAY);
  assert.equal(I.isHidden(p, "plateau:bench:2026-09-15"), true);
  assert.equal(I.isHidden(p, "plateau:bench:2026-10-20"), false, "a note about different data comes back");
  assert.deepEqual(I.clearDismissed(p).dismissed, {});
  const old = { dismissed: { old: "2025-01-01", recent: "2026-10-30" } };
  assert.deepEqual(Object.keys(I.prune(old, TODAY).dismissed), ["recent"]);
  const many = {}; for (let i = 0; i < 260; i++) many["k" + i] = W.addDays("2026-01-01", i % 200);
  assert.equal(Object.keys(I.sanitizePrefs({ dismissed: many }).dismissed).length, 200, "capped, newest kept");
});

test("the whole list: routines drive progression, hidden notes are counted, and a short history says what is missing", () => {
  const h = [sess("2026-10-27", [ex("bench", three(145, 8))]), sess("2026-10-30", [ex("bench", three(145, 8))])];
  const routines = [{ id: "r1", name: "Push", exercises: [{ exerciseId: "bench", plannedSets: plan(3, 8) }, { exerciseId: "row", plannedSets: plan(3, 10) }] }];
  const names = { bench: "Bench Press", row: "Row" };
  const out = I.buildInsights({ workouts: h, routines: routines, todayKey: TODAY, lookup: lookup, nameOf: (id) => names[id] || id });
  assert.equal(out.items.length, 1);
  const it = out.items[0];
  assert.equal(it.kind, "increase");
  assert.equal(it.kicker, "Ready to progress");
  assert.equal(it.key, "progress:bench:2026-10-30");
  assert.match(it.title, /Bench Press: try 150 lb/);
  assert.match(it.text, /From your Push routine/);
  assert.ok(it.why.length >= 4);
  const hidden = I.buildInsights({ workouts: h, routines: routines, todayKey: TODAY, lookup: lookup, nameOf: (id) => id, prefs: I.dismiss(null, it.key, TODAY) });
  assert.deepEqual([hidden.items.length, hidden.hidden], [0, 1]);
  const lines = out.readiness.lines;
  assert.deepEqual(lines.map((l) => l.ok), [true, false, false, false], "two sessions unlock only the first kind");
  assert.equal(out.readiness.workouts, 2);
  const empty = I.buildInsights({ workouts: [], routines: [], todayKey: TODAY, lookup: lookup });
  assert.deepEqual([empty.items.length, empty.hidden, empty.readiness.workouts], [0, 0, 0]);
  assert.ok(empty.readiness.lines.every((l) => l.ok === false && l.need));
});

test("a fuller history produces each kind of note, each with a stable key and reasons", () => {
  const h = [];
  // squat gets better; bench flat-lines; steady training so the windows are covered
  for (let i = 0; i < 16; i++) {
    const d = W.addDays("2026-09-01", i * 4);
    h.push(sess(d, [ex("squat", [set(185 + i * 2, 5)]), ex("bench", [set(i < 2 ? 150 : 140, 8), set(140, 8), set(140, 8)])]));
  }
  const names = { squat: "Squat", bench: "Bench Press" };
  const out = I.buildInsights({ workouts: h, routines: [], todayKey: "2026-11-01", lookup: lookup, nameOf: (id) => names[id] });
  const kinds = out.items.map((x) => x.kind);
  assert.ok(kinds.indexOf("improvement") !== -1, "squat improved");
  assert.ok(kinds.indexOf("plateau") !== -1, "bench has not beaten its first weeks");
  const keys = out.items.map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length, "keys are unique");
  out.items.forEach((x) => { assert.ok(x.title && x.text && x.why.length >= 3 && x.key && x.kicker, x.key); assert.ok(["good", "neutral", "watch"].indexOf(x.tone) !== -1); });
  const again = I.buildInsights({ workouts: h, routines: [], todayKey: "2026-11-01", lookup: lookup, nameOf: (id) => names[id] });
  assert.deepEqual(again.items.map((x) => x.key), keys, "the same data gives the same notes");
});

test("no note ever claims to be an AI or a score", () => {
  const h = [];
  for (let i = 0; i < 16; i++) h.push(sess(W.addDays("2026-09-01", i * 4), [ex("squat", [set(185 + i * 2, 5)]), ex("bench", [set(i < 2 ? 150 : 140, 8), set(140, 8), set(140, 8)])]));
  const out = I.buildInsights({ workouts: h, routines: [], todayKey: "2026-11-01", lookup: lookup, nameOf: (id) => id });
  const words = out.items.reduce((a, x) => a.concat([x.kicker, x.title, x.text], x.why), []).concat(out.readiness.lines.map((l) => l.label + " " + l.need)).join(" \n ");
  assert.ok(words.length > 200, "there is text to check");
  assert.doesNotMatch(words, /\bAI\b|machine learning|readiness|recovery score|fatigue score|strength score|level/i);
});
