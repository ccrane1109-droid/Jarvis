"use strict";

process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../js/dayplan-logic");

function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }
const DAY = "2026-11-04";
let n = 0;
const task = (text, time, o) => Object.assign({ id: "t" + (++n), date: DAY, text: text, priority: "medium", category: "", time: time, completed: false, goalId: null, order: n, createdAt: n }, o || {});
const ctx = () => ({ makeId: () => "new_" + (++n), now: 1000 });

test("times are read strictly and shown the way a phone clock shows them", () => {
  assert.deepEqual(D.parseTime("06:30"), { hour: 6, minute: 30 });
  assert.deepEqual(D.parseTime("6:05"), { hour: 6, minute: 5 });
  assert.deepEqual(D.parseTime("23:59"), { hour: 23, minute: 59 });
  ["24:00", "12:60", "9", "", "ab:cd", null, undefined, "12:5"].forEach((v) => assert.equal(D.parseTime(v), null, String(v)));
  assert.equal(D.timeString(6, 5), "06:05");
  assert.equal(D.timeString(18), "18:00");
  assert.deepEqual([0, 1, 11, 12, 13, 23].map(D.hourLabel), ["12 AM", "1 AM", "11 AM", "12 PM", "1 PM", "11 PM"]);
  assert.deepEqual(["00:00", "00:15", "09:00", "12:00", "12:30", "15:45", "23:59"].map(D.timeLabel), ["12:00 AM", "12:15 AM", "9:00 AM", "12:00 PM", "12:30 PM", "3:45 PM", "11:59 PM"]);
  assert.equal(D.timeLabel("nope"), "");
  assert.equal(D.minutesOf("01:30"), 90);
  assert.equal(D.minutesOf("x"), null);
});

test("a day has 24 hours, and a task with a time sits in its hour, in order", () => {
  const list = deepFreeze([task("Gym", "17:30"), task("Wake up and stretch", "06:00"), task("Breakfast", "06:30"), task("Deep work", "09:00"), task("Call mum", "17:05"), task("Email", ""), task("Other day", "09:00", { date: "2026-11-05" })]);
  const s = D.slots(list, DAY);
  assert.equal(s.length, 24);
  assert.deepEqual(s.map((x) => x.hour), Array.from({ length: 24 }, (_, i) => i));
  assert.equal(s[0].label, "12 AM");
  assert.equal(s[23].label, "11 PM");
  assert.deepEqual(s[6].items.map((t) => t.text), ["Wake up and stretch", "Breakfast"]);
  assert.deepEqual(s[17].items.map((t) => t.text), ["Call mum", "Gym"], "by minutes, not by the order they were added");
  assert.deepEqual(s[9].items.map((t) => t.text), ["Deep work"], "another day's task is not here");
  assert.equal(s.reduce((a, x) => a + x.items.length, 0), 5, "the task with no time is in no hour");
  assert.deepEqual(D.slots([], DAY).map((x) => x.items.length), new Array(24).fill(0));
  assert.equal(D.slots(null, DAY).length, 24);
});

test("tasks with no time, or an unreadable one, are not scheduled yet", () => {
  const list = [task("Plain", ""), task("Done", "", { completed: true }), task("Junk", "late"), task("Planned", "10:00"), task("Missing field", undefined)];
  const u = D.unscheduled(list, DAY);
  assert.deepEqual(u.map((t) => t.text), ["Plain", "Junk", "Missing field", "Done"], "unticked first, then ticked");
  assert.equal(D.isPlanned(list[3]), true);
  assert.equal(D.isPlanned(list[2]), false);
  assert.equal(D.isPlanned(null), false);
});

test("the summary counts planned, done and unscheduled", () => {
  const list = [task("a", "08:00", { completed: true }), task("b", "09:00"), task("c", ""), task("d", "", { completed: true }), task("e", "10:00", { date: "2026-11-06" })];
  assert.deepEqual(D.summary(list, DAY), { planned: 2, plannedDone: 1, unscheduled: 2, total: 4 });
  assert.deepEqual(D.summary([], DAY), { planned: 0, plannedDone: 0, unscheduled: 0, total: 0 });
});

test("planning something in an hour creates an ordinary task", () => {
  const list = deepFreeze([task("Existing", "", { order: 4 })]);
  const r = D.add(list, { date: DAY, text: "  Study   for English ", hour: 15, minute: 30 }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.tasks.length, 2);
  assert.deepEqual(Object.keys(r.task).sort(), ["category", "completed", "createdAt", "date", "goalId", "id", "order", "priority", "text", "time"], "the same fields as a task from the To-Do form");
  assert.deepEqual([r.task.text, r.task.time, r.task.date, r.task.completed, r.task.priority, r.task.order, r.task.createdAt], ["Study for English", "15:30", DAY, false, "medium", 5, 1000]);
  assert.equal(D.slots(r.tasks, DAY)[15].items[0].text, "Study for English");
  assert.equal(list.length, 1, "the original list is not changed");
  assert.equal(D.add(list, { date: DAY, text: "x", hour: 6 }, ctx()).task.time, "06:00", "no minutes means on the hour");
});

test("what can't be planned is refused with a reason, and nothing changes", () => {
  const list = deepFreeze([task("Existing", "")]);
  const bad = (input) => D.add(list, input, ctx());
  assert.equal(bad({ date: DAY, text: "   ", hour: 6 }).error, "Write what you are planning.");
  assert.match(bad({ date: DAY, text: "x".repeat(141), hour: 6 }).error, /140 characters/);
  assert.equal(bad({ date: DAY, text: "x", hour: 24 }).error, "Pick an hour.");
  assert.equal(bad({ date: DAY, text: "x", hour: "" }).error, "Pick an hour.");
  assert.equal(bad({ date: DAY, text: "x", hour: 6, minute: 75 }).error, "Pick the minutes.");
  assert.equal(bad({ date: "someday", text: "x", hour: 6 }).error, "Pick a day.");
  assert.equal(bad({ date: DAY, text: "x", hour: 6 }).ok, true);
  const refused = bad({ date: DAY, text: "", hour: 6 });
  assert.equal(refused.tasks, list);
});

test("moving an item to another hour, and editing its words", () => {
  const list = deepFreeze([task("Gym", "17:30", { id: "gym" })]);
  const moved = D.edit(list, "gym", { hour: 6 });
  assert.equal(moved.task.time, "06:30", "the hour changes, the minutes stay");
  assert.equal(D.edit(list, "gym", { hour: 6, minute: 0 }).task.time, "06:00");
  assert.equal(D.edit(list, "gym", { text: "Lift" }).task.time, "17:30", "new words, same time");
  assert.equal(D.edit(list, "gym", { text: "Lift" }).task.text, "Lift");
  assert.equal(D.edit(list, "gym", { text: "" }).ok, false);
  assert.equal(D.edit(list, "nope", { hour: 6 }).ok, false);
  assert.equal(list[0].time, "17:30");
});

test("an unscheduled task can be given an hour, and taken out of one", () => {
  const list = deepFreeze([task("Email supplier", "", { id: "mail" })]);
  const s = D.schedule(list, "mail", 11);
  assert.deepEqual([s.ok, s.task.time], [true, "11:00"]);
  assert.equal(D.slots(s.tasks, DAY)[11].items[0].id, "mail");
  assert.equal(D.schedule(list, "mail", 11, 45).task.time, "11:45");
  assert.equal(D.schedule(list, "mail", 30).ok, false);
  const u = D.unschedule(s.tasks, "mail");
  assert.equal(u.task.time, "");
  assert.equal(D.unscheduled(u.tasks, DAY).length, 1, "back in the not-scheduled list, still a task");
  assert.equal(D.unschedule(list, "nope").ok, false);
});

test("ticking in the planner is ticking the task", () => {
  const list = deepFreeze([task("Run", "07:00", { id: "run" })]);
  const t = D.toggle(list, "run");
  assert.equal(t.task.completed, true);
  assert.equal(D.toggle(t.tasks, "run").task.completed, false);
  assert.equal(D.summary(t.tasks, DAY).plannedDone, 1);
});

test("a removed item can be put back exactly where it was", () => {
  const list = deepFreeze([task("a", "08:00", { id: "a" }), task("b", "09:00", { id: "b" }), task("c", "10:00", { id: "c" })]);
  const r = D.remove(list, "b");
  assert.deepEqual([r.ok, r.index, r.removed.id, r.tasks.map((t) => t.id)], [true, 1, "b", ["a", "c"]]);
  assert.deepEqual(D.restore(r.tasks, r.removed, r.index).map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(D.restore(list, list[0], 0).map((t) => t.id), ["a", "b", "c"], "restoring something that is already there changes nothing");
  assert.deepEqual(D.restore(r.tasks, r.removed, 99).map((t) => t.id), ["a", "c", "b"]);
  assert.equal(D.remove(list, "zzz").ok, false);
});

test("where the planner opens: the current hour today, the first item on another day, 7 AM on an empty one", () => {
  const list = [task("Gym", "17:30"), task("Wake", "06:00")];
  const at = (h) => new Date(2026, 10, 4, h, 20).getTime();
  assert.equal(D.startHour(list, DAY, DAY, at(14)), 14);
  assert.equal(D.startHour(list, DAY, "2026-11-03", at(14)), 6, "a day that isn't today opens at its first item");
  assert.equal(D.startHour([], "2026-11-09", DAY, at(14)), 7);
  assert.equal(D.currentHour(at(0)), 0);
});
