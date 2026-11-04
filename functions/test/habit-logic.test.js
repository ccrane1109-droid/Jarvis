"use strict";

process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../../js/habit-logic");

function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }
const TODAY = "2026-11-04"; // a Wednesday
const habit = (id, o) => Object.assign({ id: id, name: id, targetDays: 7, dailyTarget: 1, completions: {}, createdAt: 1 }, o || {});
const days = (...d) => { const c = {}; d.forEach((x) => { c[x] = 1; }); return c; };

test("days are local calendar days, across a clock change", () => {
  assert.equal(H.addDays("2026-11-04", -1), "2026-11-03");
  assert.equal(H.addDays("2026-11-01", 1), "2026-11-02", "the day the clocks fall back is still one day");
  assert.equal(H.addDays("2026-10-31", 2), "2026-11-02");
  assert.equal(H.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(H.mondayOf("2026-11-04"), "2026-11-02");
  assert.equal(H.mondayOf("2026-11-08"), "2026-11-02", "a Sunday belongs to the week before it");
  assert.deepEqual(H.weekDates("2026-11-02"), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(H.isDay("2026-11-04"), true);
  ["2026-1-4", "tomorrow", "", null, undefined, 20261104].forEach((v) => assert.equal(H.isDay(v), false, String(v)));
});

test("a simple habit is done at 1, a counting habit at its target", () => {
  const simple = habit("read", { completions: { "2026-11-03": 1 } });
  assert.deepEqual([H.countOn(simple, "2026-11-03"), H.isDone(simple, "2026-11-03"), H.isDone(simple, "2026-11-02")], [1, true, false]);
  const water = habit("water", { dailyTarget: 8, completions: { "2026-11-03": 7, "2026-11-02": 8, "2026-11-01": 11 } });
  assert.deepEqual([H.isDone(water, "2026-11-03"), H.isDone(water, "2026-11-02"), H.isDone(water, "2026-11-01")], [false, true, true], "7 of 8 is not done; more than the target still is");
  assert.equal(H.dailyTarget(habit("x", { dailyTarget: 0 })), 1);
  assert.equal(H.dailyTarget(null), 1);
  assert.equal(H.countOn(null, "2026-11-03"), 0);
  assert.equal(H.countOn({ id: "x" }, "2026-11-03"), 0, "an older habit with no completions at all");
});

test("the current streak runs back from today, and needs today done (as the screen always has)", () => {
  const h = habit("run", { completions: days("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04") });
  assert.equal(H.currentStreak(h, TODAY), 4);
  assert.equal(H.currentStreak(habit("run", { completions: days("2026-11-01", "2026-11-02", "2026-11-03") }), TODAY), 0, "today is not done yet");
  assert.equal(H.currentStreak(habit("run", { completions: days("2026-11-04", "2026-11-02", "2026-11-01") }), TODAY), 1, "a gap ends it");
  assert.equal(H.currentStreak(habit("run"), TODAY), 0);
});

test("the longest streak finds the best run anywhere", () => {
  const h = habit("run", { completions: days("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-20", "2026-10-21", "2026-11-01") });
  assert.equal(H.longestStreak(h), 3);
  assert.equal(H.longestStreak(habit("run")), 0);
  assert.equal(H.longestStreak(habit("run", { completions: days("2026-10-31") })), 1);
  const water = habit("water", { dailyTarget: 2, completions: { "2026-10-01": 2, "2026-10-02": 1, "2026-10-03": 2 } });
  assert.equal(H.longestStreak(water), 1, "a day short of the target breaks the run");
});

test("weekly totals cap each day at its target", () => {
  const week = H.weekDates("2026-11-02");
  const water = habit("water", { dailyTarget: 8, targetDays: 5, completions: { "2026-11-02": 8, "2026-11-03": 12, "2026-11-04": 3 } });
  assert.equal(H.weeklyDone(water, week), 8 + 8 + 3, "12 cups counts as 8");
  assert.equal(H.weeklyTarget(water), 40);
  assert.equal(H.totalCompletions(water), 23, "the real total is not capped");
});

test("today and any earlier day can be edited; tomorrow cannot", () => {
  assert.equal(H.canEdit("2026-11-04", TODAY), true);
  assert.equal(H.canEdit("2026-11-03", TODAY), true);
  assert.equal(H.canEdit("2025-01-01", TODAY), true, "a long time ago is still a day that happened");
  assert.equal(H.canEdit("2026-11-05", TODAY), false);
  assert.equal(H.canEdit("2027-01-01", TODAY), false);
  assert.equal(H.canEdit("not a day", TODAY), false);
  assert.equal(H.describeDay(TODAY, TODAY), "today");
  assert.equal(H.describeDay("2026-11-03", TODAY), "yesterday");
  assert.equal(H.describeDay("2026-10-30", TODAY), "past");
  assert.equal(H.describeDay("2026-11-05", TODAY), "future");
});

test("a habit forgotten yesterday can be ticked, and nothing else changes", () => {
  const list = deepFreeze([habit("read", { completions: days("2026-11-02") }), habit("gym", { completions: days("2026-11-03") })]);
  const r = H.setDone(list, "read", "2026-11-03", true, TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.habits[0].completions, { "2026-11-02": 1, "2026-11-03": 1 });
  assert.deepEqual(r.habits[1], list[1], "the other habit is untouched");
  assert.deepEqual(list[0].completions, { "2026-11-02": 1 }, "the original is not changed");
  const off = H.setDone(r.habits, "read", "2026-11-03", false, TODAY);
  assert.equal(H.isDone(off.habits[0], "2026-11-03"), false, "and it can be taken back");
  assert.equal(H.setDone(list, "read", "2026-11-04", true, TODAY).ok, true, "today works too");
});

test("ticking a counting habit sets it to its target", () => {
  const list = [habit("water", { dailyTarget: 8, completions: { "2026-11-03": 3 } })];
  assert.equal(H.setDone(list, "water", "2026-11-03", true, TODAY).habits[0].completions["2026-11-03"], 8);
  assert.equal(H.setDone(list, "water", "2026-11-03", false, TODAY).habits[0].completions["2026-11-03"], 0);
});

test("a future day, a bad day, or a missing habit is refused, with a reason, and changes nothing", () => {
  const list = deepFreeze([habit("read")]);
  const f = H.setDone(list, "read", "2026-11-05", true, TODAY);
  assert.deepEqual([f.ok, f.error, f.habits === list], [false, "That day hasn't happened yet.", true]);
  assert.equal(H.setDone(list, "read", "yesterday", true, TODAY).error, "That isn't a day.");
  assert.equal(H.setDone(list, "nope", "2026-11-03", true, TODAY).error, "That habit isn't there.");
  assert.equal(H.adjust(list, "read", "2026-11-05", 1, TODAY).ok, false);
  assert.equal(H.adjust(list, "nope", "2026-11-03", 1, TODAY).ok, false);
});

test("adding to and taking from a count on a past day never goes below zero", () => {
  const list = deepFreeze([habit("water", { dailyTarget: 8, completions: { "2026-11-02": 1 } })]);
  const up = H.adjust(list, "water", "2026-11-02", 1, TODAY);
  assert.equal(up.habits[0].completions["2026-11-02"], 2);
  const down = H.adjust(list, "water", "2026-11-02", -5, TODAY);
  assert.equal(down.habits[0].completions["2026-11-02"], 0);
  assert.equal(H.adjust(list, "water", "2026-10-20", 1, TODAY).habits[0].completions["2026-10-20"], 1, "a day with no count yet starts from 0");
});

test("filling in yesterday lets the streak and the week follow", () => {
  let list = [habit("read", { completions: days("2026-11-02", "2026-11-04") })];
  assert.equal(H.currentStreak(list[0], TODAY), 1, "yesterday was missed, so only today counts");
  list = H.setDone(list, "read", "2026-11-03", true, TODAY).habits;
  assert.equal(H.currentStreak(list[0], TODAY), 3, "ticked after the fact, the three days link up");
  assert.equal(H.weeklyDone(list[0], H.weekDates("2026-11-02")), 3);
  assert.equal(H.longestStreak(list[0]), 3);
});

test("a day at a glance, and its label", () => {
  const list = [habit("read", { completions: days("2026-11-03") }), habit("gym"), habit("water", { dailyTarget: 2, completions: { "2026-11-03": 1 } })];
  const s = H.dayStatus(list, "2026-11-03");
  assert.deepEqual([s.done, s.total, s.missed.map((h) => h.id)], [1, 3, ["gym", "water"]]);
  assert.deepEqual(H.dayStatus([], "2026-11-03"), { done: 0, total: 0, missed: [] });
  assert.equal(H.dayLabel(TODAY, TODAY), "Today");
  assert.equal(H.dayLabel("2026-11-03", TODAY), "Yesterday");
  assert.equal(H.dayLabel("2026-10-30", TODAY), "Fri, Oct 30");
});
