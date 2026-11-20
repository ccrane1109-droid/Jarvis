"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const HP = require("../../js/habit-plan-logic.js");
const HL = require("../../js/habit-logic.js");
const S = require("../../js/schedule-logic.js");

// 2026-11-16 is a Monday.
const TODAY = "2026-11-18";
const h = (o) => Object.assign({ id: "h1", name: "Stretch", targetDays: 7, dailyTarget: 1, completions: {}, createdAt: 1 }, o);

test("a habit with no planTime is not on the planner (every older habit reads this way)", () => {
  assert.equal(HP.plan(h({})), null);
  assert.equal(HP.onPlanner(h({})), false);
  assert.equal(HP.occursOn(h({}), TODAY), false);
  assert.deepEqual(HP.items([h({})], "2026-11-16", "2026-11-22", { today: TODAY }), []);
});

test("a habit done 7 days a week with a time is on every day; one done fewer days needs its days chosen", () => {
  const daily = h({ planTime: "07:30", planFrom: "2026-11-01" });
  assert.deepEqual(HP.plan(daily).days, [0, 1, 2, 3, 4, 5, 6]);
  const few = h({ targetDays: 3, planTime: "07:30", planFrom: "2026-11-01" });
  assert.deepEqual(HP.plan(few).days, [], "3 times a week says nothing about which weekdays: none are guessed");
  assert.equal(HP.occursOn(few, "2026-11-16"), false);
  assert.equal(HP.items([few], "2026-11-16", "2026-11-22", {}).length, 0);
  assert.deepEqual(HP.plan(h({ targetDays: 3, planTime: "07:30", planDays: [1, 3, 5] })).days, [1, 3, 5]);
});

test("damaged plan fields are dropped, valid ones kept", () => {
  assert.deepEqual(HP.fields({ planTime: "7:30", planDays: [9, -1, "x", null, true, 1.5], planFrom: "2026-02-30", planMoves: { "2026-11-16": "25:00", bad: "08:00" } }), {});
  assert.deepEqual(HP.fields({ planTime: "07:30", planDays: [3, 1, 1, "5", 9], planFrom: "2026-11-02", planMoves: { "2026-11-16": "08:15", "2026-11-17": "nope" } }),
    { planTime: "07:30", planDays: [1, 3, 5], planFrom: "2026-11-02", planMoves: { "2026-11-16": "08:15" } });
  assert.deepEqual(HP.fields(null), {});
  assert.deepEqual(HP.fields({ name: "x" }), {});
});

test("it occurs on its weekdays, from its first day, and nowhere else", () => {
  const x = h({ targetDays: 3, planTime: "06:45", planDays: [1, 3, 5], planFrom: "2026-11-18" });
  const days = []; for (let d = 16; d <= 22; d++) days.push("2026-11-" + d);
  assert.deepEqual(days.filter((d) => HP.occursOn(x, d)), ["2026-11-18", "2026-11-20"], "Mon the 16th is before its first day");
  assert.equal(HP.occursOn(x, "2026-11-23"), true, "next Monday");
  assert.equal(HP.occursOn(x, "nonsense"), false);
});

test("items: one per habit per planned day, in time order, never twice", () => {
  const a = h({ id: "a", name: "Read", planTime: "21:00", planFrom: "2026-11-01" });
  const b = h({ id: "b", name: "Stretch", planTime: "07:30", planFrom: "2026-11-01" });
  const list = HP.items([a, b, a], "2026-11-16", "2026-11-22", { today: TODAY });
  assert.equal(list.length, 14, "2 habits x 7 days; the duplicate record in the list adds nothing");
  assert.equal(new Set(list.map((i) => i.key)).size, 14);
  assert.deepEqual(list.slice(0, 2).map((i) => i.title + "@" + i.time), ["Stretch@07:30", "Read@21:00"]);
  // asking for overlapping ranges gives the same item for the same day
  const again = HP.items([a, b], "2026-11-18", "2026-11-19", { today: TODAY });
  assert.deepEqual(again.map((i) => i.key), list.filter((i) => i.date === "2026-11-18" || i.date === "2026-11-19").map((i) => i.key));
});

test("an item is shaped like the other calendar items and is never overdue", () => {
  const x = h({ planTime: "22:00", planFrom: "2026-11-01" });
  const it = HP.items([x], "2026-11-10", "2026-11-10", { today: TODAY })[0];
  assert.equal(it.source, "habit");
  assert.equal(it.date, "2026-11-10"); assert.equal(it.endDate, "2026-11-10");
  assert.equal(it.time, "22:00"); assert.equal(it.startMin, 1320); assert.equal(it.endMin, 1350);
  assert.equal(it.allDay, false); assert.equal(it.completed, false); assert.equal(it.scheduled, true); assert.equal(it.editable, true);
  // a missed habit from days ago is on the planner as not done, and the overdue rules never count it
  const old = HP.items([x], "2026-11-12", "2026-11-17", { today: TODAY });
  assert.equal(old.length, 6);
  assert.deepEqual(old.map((i) => S.isOverdue(i, TODAY, 600)), [false, false, false, false, false, false]);
  assert.equal(S.isOverdue(Object.assign({}, old[0], { scheduled: false }), TODAY, 600), true, "it is the scheduled flag that keeps it out of Overdue");
  assert.equal(S.summarize(old, { today: TODAY, nowMin: 600, weekStart: 1 }).overdue.length, 0);
  const late = HP.items([h({ planTime: "23:50", planFrom: "2026-11-01" })], "2026-11-17", "2026-11-17", { today: TODAY })[0];
  assert.equal(late.endMin, 1439, "the shown length stops at the end of the day");
});

test("completion comes from the habit's own completions for that date, so the two screens agree", () => {
  const x = h({ planTime: "07:30", planFrom: "2026-11-01", completions: { "2026-11-17": 1 } });
  const list = HP.items([x], "2026-11-16", "2026-11-18", { today: TODAY });
  assert.deepEqual(list.map((i) => i.completed), [false, true, false]);
  const counting = h({ dailyTarget: 3, planTime: "07:30", planFrom: "2026-11-01", completions: { "2026-11-17": 2, "2026-11-18": 3 } });
  const c = HP.items([counting], "2026-11-17", "2026-11-18", { today: TODAY });
  assert.deepEqual(c.map((i) => [i.count, i.target, i.completed]), [[2, 3, false], [3, 3, true]]);
  // ticking in the planner is the Habits rule (HL.setDone), writing the same date key once: ticking twice never makes a second record
  let list2 = [x];
  list2 = HL.setDone(list2, "h1", "2026-11-18", true, TODAY).habits;
  list2 = HL.setDone(list2, "h1", "2026-11-18", true, TODAY).habits;
  assert.deepEqual(list2[0].completions, { "2026-11-17": 1, "2026-11-18": 1 });
  assert.equal(HP.items(list2, "2026-11-18", "2026-11-18", { today: TODAY })[0].completed, true);
  list2 = HL.setDone(list2, "h1", "2026-11-18", false, TODAY).habits;
  assert.equal(HP.items(list2, "2026-11-18", "2026-11-18", { today: TODAY })[0].completed, false);
});

test("days after today are shown but can not be ticked", () => {
  const x = h({ planTime: "07:30", planFrom: "2026-11-01" });
  const l = HP.items([x], "2026-11-18", "2026-11-19", { today: TODAY });
  assert.deepEqual(l.map((i) => i.editable), [true, false]);
});

test("setPlan: validates, keeps the habit and its history, keeps one-day moves", () => {
  const base = [h({ completions: { "2026-11-10": 1 }, planMoves: { "2026-11-20": "09:00" } }), h({ id: "h2", name: "Read" })];
  assert.equal(HP.setPlan(base, "h1", { time: "7:30", days: [1], from: "2026-11-18" }).ok, false);
  assert.deepEqual(HP.setPlan(base, "h1", { time: "", days: [], from: "x" }).errors, { time: "Choose a time.", days: "Choose at least one day.", from: "Choose the first day." });
  assert.equal(HP.setPlan(base, "nope", { time: "07:30", days: [1], from: "2026-11-18" }).ok, false);
  const r = HP.setPlan(base, "h1", { time: "07:30", days: [5, 1, 1], from: "2026-11-18" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.habits[0].planDays, [1, 5]);
  assert.equal(r.habits[0].planTime, "07:30"); assert.equal(r.habits[0].planFrom, "2026-11-18");
  assert.deepEqual(r.habits[0].completions, { "2026-11-10": 1 });
  assert.deepEqual(r.habits[0].planMoves, { "2026-11-20": "09:00" });
  assert.equal(r.habits[1], base[1], "other habits are the same objects");
  assert.equal(base[0].planTime, undefined, "the list that was given is not changed");
});

test("clearPlan takes it off the planner and nothing else", () => {
  const x = h({ completions: { "2026-11-10": 1 }, planTime: "07:30", planDays: [1], planFrom: "2026-11-01", planMoves: { "2026-11-16": "08:00" } });
  const r = HP.clearPlan([x], "h1");
  assert.equal(r.ok, true);
  assert.deepEqual(r.habits[0], h({ completions: { "2026-11-10": 1 } }));
  assert.equal(HP.onPlanner(r.habits[0]), false);
  assert.equal(HP.clearPlan([x], "zzz").ok, false);
});

test("moveOn changes the time of one day only", () => {
  const x = h({ targetDays: 3, planTime: "07:30", planDays: [1, 3], planFrom: "2026-11-01" });
  assert.equal(HP.timeOn(x, "2026-11-16"), "07:30");
  const r = HP.moveOn([x], "h1", "2026-11-16", "08:15");
  assert.equal(r.ok, true);
  const y = r.habits[0];
  assert.equal(HP.timeOn(y, "2026-11-16"), "08:15");
  assert.equal(HP.timeOn(y, "2026-11-18"), "07:30", "the next one keeps its usual time");
  assert.equal(HP.timeOn(y, "2026-11-23"), "07:30", "so does next week");
  assert.equal(y.planTime, "07:30"); assert.deepEqual(y.planDays, [1, 3]);
  assert.equal(HP.isMoved(y, "2026-11-16"), true); assert.equal(HP.isMoved(y, "2026-11-18"), false);
  const items = HP.items([y], "2026-11-16", "2026-11-18", {});
  assert.deepEqual(items.map((i) => [i.date, i.time, i.moved]), [["2026-11-16", "08:15", true], ["2026-11-18", "07:30", false]]);
  // back to the usual time removes the move
  const z = HP.moveOn([y], "h1", "2026-11-16", "07:30").habits[0];
  assert.equal(z.planMoves, undefined);
  assert.equal(HP.clearMove([y], "h1", "2026-11-16").habits[0].planMoves, undefined);
  // a day it is not planned on, bad times, unknown habit
  assert.equal(HP.moveOn([x], "h1", "2026-11-17", "08:00").ok, false);
  assert.equal(HP.moveOn([x], "h1", "2026-11-16", "8am").ok, false);
  assert.equal(HP.moveOn([x], "zzz", "2026-11-16", "08:00").ok, false);
  assert.equal(HP.moveOn([h({})], "h1", "2026-11-16", "08:00").ok, false, "a habit that is not on the planner has nothing to move");
});

test("the number of saved moves is bounded, oldest first", () => {
  let list = [h({ planTime: "07:30", planFrom: "2020-01-01" })];
  let d = "2025-01-01";
  const next = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8) + 1)).toISOString().slice(0, 10);
  for (let i = 0; i < 410; i++) { list = HP.moveOn(list, "h1", d, "08:00").habits; d = next(d); }
  assert.equal(Object.keys(list[0].planMoves).length, 400);
  assert.equal(list[0].planMoves["2025-01-01"], undefined, "the oldest went first");
});

test("daysLabel and dayTotals", () => {
  assert.equal(HP.daysLabel([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.equal(HP.daysLabel([1, 2, 3, 4, 5]), "Weekdays");
  assert.equal(HP.daysLabel([6, 0]), "Weekends");
  assert.equal(HP.daysLabel([5, 1, 3]), "Mon, Wed, Fri");
  assert.equal(HP.daysLabel([]), "No days");
  const l = HP.items([h({ id: "a", planTime: "07:00", planFrom: "2026-11-01", completions: { "2026-11-17": 1 } }), h({ id: "b", name: "B", planTime: "08:00", planFrom: "2026-11-01" })], "2026-11-17", "2026-11-18", { today: TODAY });
  assert.deepEqual(HP.dayTotals(l, "2026-11-17"), { done: 1, total: 2 });
  assert.deepEqual(HP.dayTotals(l, "2026-11-18"), { done: 0, total: 2 });
  assert.deepEqual(HP.dayTotals(l, "2026-11-19"), { done: 0, total: 0 });
  assert.deepEqual(HP.dayTotals(null, "2026-11-19"), { done: 0, total: 0 });
});

test("a damaged list does not throw", () => {
  assert.deepEqual(HP.items(null, "2026-11-16", "2026-11-17", {}), []);
  assert.deepEqual(HP.items([null, 5, {}, { id: "x" }, { id: "y", name: "n", planTime: "07:00" }], "2026-11-16", "2026-11-16", {}).map((i) => i.id), ["y"]);
  assert.deepEqual(HP.items([h({ planTime: "07:00" })], "2026-11-17", "2026-11-16", {}), []);
  assert.equal(HP.items([h({ planTime: "07:00", planFrom: "2020-01-01" })], "2026-01-01", "2030-01-01", {}).length, 401, "a very long range is capped");
});

test("restorePlan puts the planner fields back exactly (undo), including one-day moves", () => {
  const x = h({ targetDays: 3, planTime: "07:30", planDays: [1, 3], planFrom: "2026-11-01", planMoves: { "2026-11-16": "08:15" }, completions: { "2026-11-10": 1 } });
  const before = HP.fields(x);
  const cleared = HP.clearPlan([x], "h1").habits;
  assert.equal(HP.onPlanner(cleared[0]), false);
  const back = HP.restorePlan(cleared, "h1", before);
  assert.equal(back.ok, true);
  assert.deepEqual(back.habits[0], x);
  // undoing "added to the planner" for a habit that had none
  const added = HP.setPlan([h({})], "h1", { time: "09:00", days: [1], from: "2026-11-16" }).habits;
  assert.deepEqual(HP.restorePlan(added, "h1", HP.fields(h({}))).habits[0], h({}));
  assert.equal(HP.restorePlan([x], "zzz", before).ok, false);
});
