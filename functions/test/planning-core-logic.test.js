"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/planning-core-logic");

const TODAY = "2026-11-18";
const habit = (id, name, o) => Object.assign({ id, name, targetDays: 7, dailyTarget: 1, completions: {}, createdAt: 1 }, o || {});
const task = (id, text, date, o) => Object.assign({ id, text, date, completed: false }, o || {});
// every habit is planned every day at its planTime, for these tests
const ctx = { today: TODAY, habitOn: (h) => !!h.planTime, habitTime: (h) => h.planTime || "" };

test("names: case, accents, punctuation and little words are ignored; only a suggestion is ever made", () => {
  assert.equal(P.normName("Take a COLD shower!"), "take cold shower");
  assert.equal(P.normName("  Café  au   lait "), "cafe au lait");
  assert.equal(P.normName("Rock & Roll"), "rock and roll");
  assert.equal(P.normName("the my an"), "");
  assert.equal(P.nameMatch("Cold shower", "cold  SHOWER."), 1);
  assert.equal(P.nameMatch("shower cold", "Cold shower"), 0.8, "the same words in another order");
  assert.equal(P.nameMatch("Cold shower", "Take cold shower"), 0.6, "the shorter name is inside the longer");
  assert.equal(P.nameMatch("Run", "Run the dog"), 0, "a one-word, short name is not enough to suggest");
  assert.equal(P.nameMatch("Study math", "Call mom"), 0);
  assert.equal(P.nameMatch("", "x"), 0);
});

test("times: unknown is not a difference; more than half an hour apart is", () => {
  assert.equal(P.timesAgree("05:10", "05:30"), true);
  assert.equal(P.timesAgree("05:10", "06:00"), false);
  assert.equal(P.timesAgree("", "06:00"), true);
  assert.equal(P.timesAgree(undefined, undefined), true);
});

test("occurrence keys are the same everywhere", () => {
  assert.equal(P.occKey("task", "t1", "2026-11-18"), "task:t1");
  assert.equal(P.occKey("habit", "h1", "2026-11-18"), "habit:h1@2026-11-18");
});

test("a new task with the name of a habit planned that day is reported; a different time or day is not", () => {
  const habits = [habit("h1", "Cold shower", { planTime: "05:10" })];
  const found = P.findDuplicates({ type: "task", name: "cold shower", date: TODAY, time: "05:10" }, { tasks: [], habits }, ctx);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].type, found[0].id, found[0].strength], ["habit", "h1", 1]);
  assert.match(found[0].why, /Cold shower is planned for this day at 05:10/);
  assert.equal(P.findDuplicates({ type: "task", name: "Cold shower", date: TODAY, time: "18:00" }, { habits }, ctx).length, 0, "a different time of day");
  assert.equal(P.findDuplicates({ type: "task", name: "Cold shower", date: TODAY }, { habits: [habit("h2", "Cold shower")] }, ctx).length, 0, "a habit that is not planned that day");
  assert.equal(P.findDuplicates({ type: "task", name: "Cold shower", date: "" }, { habits }, ctx).length, 0, "no day, no suggestion");
  assert.equal(P.findDuplicates({ type: "task", name: "Buy milk", date: TODAY }, { habits }, ctx).length, 0);
});

test("a task that already stands for the habit that day makes a second one a duplicate of that task", () => {
  const habits = [habit("h1", "Cold shower", { planTime: "05:10" })];
  const tasks = [task("t1", "Cold shower", TODAY, { habitId: "h1", time: "05:10" })];
  const found = P.findDuplicates({ type: "task", name: "Cold shower", date: TODAY, time: "05:10" }, { tasks, habits }, ctx);
  assert.deepEqual(found.map((f) => [f.type, f.id]), [["task", "t1"]], "reported as the existing task, not offered the habit again");
});

test("same-day tasks and events with the same name are reported; items marked separate are not", () => {
  const data = { tasks: [task("t1", "Dentist", TODAY, { time: "09:00" }), task("t2", "Dentist", "2026-11-19")], events: [{ id: "e1", title: "Dentist", date: TODAY, time: "09:15" }] };
  const found = P.findDuplicates({ type: "task", name: "Dentist", date: TODAY, time: "09:00" }, data, ctx);
  assert.deepEqual(found.map((f) => f.type + ":" + f.id).sort(), ["event:e1", "task:t1"]);
  assert.equal(P.findDuplicates({ type: "task", name: "Dentist", date: TODAY, separate: ["t1", "e1"] }, data, ctx).length, 0, "kept separate on purpose");
});

test("a new habit finds tasks of the same name from today on, never past ones or ones already linked", () => {
  const data = { tasks: [task("t1", "Stretch", TODAY), task("t2", "Stretch", "2026-11-10"), task("t3", "Stretch", "2026-11-20", { habitId: "h9" }), task("t4", "Stretch", "2026-11-21")] };
  const found = P.findDuplicates({ type: "habit", name: "Stretch" }, data, { from: TODAY });
  assert.deepEqual(found.map((f) => f.id).sort(), ["t1", "t4"]);
});

test("scan finds task/habit, task/task and task/event pairs among what is already saved, and only suggests", () => {
  const habits = [habit("h1", "Cold shower", { planTime: "05:10" })];
  const tasks = [
    task("t1", "Cold shower", TODAY, { time: "05:10" }),
    task("t2", "Call supplier", TODAY), task("t3", "call supplier", TODAY),
    task("t4", "Dentist", "2026-11-19"),
    task("t5", "Old", "2026-01-01")
  ];
  const events = [{ id: "e1", title: "Dentist", date: "2026-11-19", time: "09:00" }];
  const out = P.scan({ tasks, habits, events }, ctx);
  assert.deepEqual(out.map((s) => s.kind).sort(), ["task-event", "task-habit", "task-task"]);
  const th = out.filter((s) => s.kind === "task-habit")[0];
  assert.deepEqual([th.task.id, th.habit.id, th.habit.time], ["t1", "h1", "05:10"]);
  assert.equal(P.scan({ tasks, habits, events }, ctx).map((s) => s.id).join(), out.map((s) => s.id).join(), "the same ids each time");
  // tasks are not touched
  assert.equal(tasks[0].habitId, undefined);
});

test("scan leaves out pairs already linked, marked separate, or outside the window", () => {
  const habits = [habit("h1", "Cold shower", { planTime: "05:10" })];
  const linked = [task("t1", "Cold shower", TODAY, { habitId: "h1" }), task("t2", "Cold shower", TODAY)];
  assert.equal(P.scan({ tasks: linked, habits }, ctx).filter((s) => s.kind === "task-habit").length, 0, "the habit already has its task that day");
  const sep = [task("t1", "Cold shower", TODAY, { separate: ["h1"] })];
  assert.equal(P.scan({ tasks: sep, habits }, ctx).length, 0);
  const far = [task("t1", "Cold shower", "2027-03-01")];
  assert.equal(P.scan({ tasks: far, habits }, ctx).length, 0, "more than 60 days ahead");
  assert.equal(P.scan({ tasks: far, habits }, ctx, { to: "2027-12-31" }).length, 1, "unless asked to look further");
});

test("linking shares one tick: an already ticked side is never lost", () => {
  const habits = [habit("h1", "Cold shower", { completions: { [TODAY]: 1 } })];
  const tasks = [task("t1", "Cold shower", TODAY)];
  const r = P.link(tasks, habits, "t1", "h1", TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.tasks[0].habitId, "h1");
  assert.equal(r.tasks[0].completed, true, "the habit was done, so the task is");
  const r2 = P.link([task("t1", "Cold shower", TODAY, { completed: true })], [habit("h1", "Cold shower")], "t1", "h1", TODAY);
  assert.equal(r2.habits[0].completions[TODAY], 1, "the task was done, so the habit is");
  // a future day: the habit cannot be ticked, the task keeps its own state
  const fut = P.link([task("t1", "Cold shower", "2026-11-25", { completed: true })], [habit("h1", "Cold shower")], "t1", "h1", TODAY);
  assert.equal(fut.habits[0].completions["2026-11-25"], undefined);
  assert.equal(fut.tasks[0].completed, true);
  assert.equal(P.link(tasks, habits, "nope", "h1", TODAY).ok, false);
  assert.equal(P.link(tasks, habits, "t1", "nope", TODAY).ok, false);
  // nothing was changed in the input
  assert.equal(tasks[0].habitId, undefined);
});

test("linking removes the 'separate' note for that habit; unlink and markSeparate", () => {
  const tasks = [task("t1", "x", TODAY, { separate: ["h1", "t9"] })];
  const r = P.link(tasks, [habit("h1", "x")], "t1", "h1", TODAY);
  assert.deepEqual(r.tasks[0].separate, ["t9"]);
  const u = P.unlink(r.tasks, "t1");
  assert.equal(u.tasks[0].habitId, undefined);
  const m = P.markSeparate([task("t1", "x", TODAY)], "t1", "h1");
  assert.deepEqual(m.tasks[0].separate, ["h1"]);
  assert.deepEqual(P.markSeparate(m.tasks, "t1", "h1").tasks[0].separate, ["h1"], "not added twice");
  assert.equal(P.markSeparate(m.tasks, "zz", "h1").ok, false);
});

test("ticking a linked task ticks its habit on that day, and unticking undoes it", () => {
  const habits = [habit("h1", "Water", { dailyTarget: 3, completions: { [TODAY]: 1 } })];
  const prev = [task("t1", "Water", TODAY, { habitId: "h1" })];
  const done = P.syncFromTasks(prev, [Object.assign({}, prev[0], { completed: true })], habits, TODAY);
  assert.deepEqual(done.changed, ["h1"]);
  assert.equal(done.habits[0].completions[TODAY], 3, "a counting habit is filled to its target");
  const undone = P.syncFromTasks([Object.assign({}, prev[0], { completed: true })], prev, done.habits, TODAY);
  assert.equal(undone.habits[0].completions[TODAY], 0, "and emptied");
  // unlinked task: nothing happens
  const none = P.syncFromTasks([task("t2", "x", TODAY)], [task("t2", "x", TODAY, { completed: true })], habits, TODAY);
  assert.equal(none.habits, habits);
  // a future day is left alone
  const fut = P.syncFromTasks([task("t1", "Water", "2026-11-30", { habitId: "h1" })], [task("t1", "Water", "2026-11-30", { habitId: "h1", completed: true })], habits, TODAY);
  assert.deepEqual(fut.changed, []);
  assert.equal(fut.habits, habits);
});

test("a habit tick or undo moves the linked task of that day only", () => {
  const prevH = [habit("h1", "Cold shower", { completions: {} })];
  const nextH = [habit("h1", "Cold shower", { completions: { [TODAY]: 1 } })];
  const tasks = [task("t1", "Cold shower", TODAY, { habitId: "h1" }), task("t2", "Cold shower", "2026-11-19", { habitId: "h1" }), task("t3", "Cold shower", TODAY)];
  const r = P.syncFromHabits(prevH, nextH, tasks);
  assert.deepEqual(r.changed, ["t1"]);
  assert.equal(r.tasks[0].completed, true);
  assert.equal(r.tasks[1].completed, false, "another day of the same habit is untouched");
  assert.equal(r.tasks[2].completed, false, "an unlinked task of the same name is untouched");
  const back = P.syncFromHabits(nextH, prevH, r.tasks);
  assert.equal(back.tasks[0].completed, false, "undo goes back too");
  assert.equal(P.syncFromHabits(prevH, prevH, tasks).tasks, tasks, "no change, same list");
  // a counting habit that goes 1 -> 2 of 3 does not flip anything
  const c1 = [habit("h", "W", { dailyTarget: 3, completions: { [TODAY]: 1 } })], c2 = [habit("h", "W", { dailyTarget: 3, completions: { [TODAY]: 2 } })];
  assert.deepEqual(P.syncFromHabits(c1, c2, [task("t", "W", TODAY, { habitId: "h" })]).changed, []);
});

test("one row for one occurrence: a task that stands for a shown habit is left out; one whose habit is not shown stays", () => {
  const items = [
    { source: "habit", id: "h1", date: TODAY, title: "Cold shower" },
    { source: "task", id: "t1", date: TODAY, habitId: "h1", title: "Cold shower" },
    { source: "task", id: "t2", date: TODAY, habitId: "h2", title: "Stretch" },
    { source: "task", id: "t3", date: "2026-11-19", habitId: "h1", title: "Cold shower" },
    { source: "event", id: "e1", date: TODAY, title: "x" }
  ];
  assert.deepEqual(P.unifyItems(items).map((i) => i.id), ["h1", "t2", "t3", "e1"]);
  assert.deepEqual(P.unifyItems(null), []);
});

test("linksOn and dropHabitLinks", () => {
  const tasks = [task("t1", "a", TODAY, { habitId: "h1" }), task("t2", "b", TODAY), task("t3", "c", "2026-11-19", { habitId: "h1" })];
  assert.deepEqual(P.linksOn(tasks, TODAY), { h1: ["t1"] });
  const dropped = P.dropHabitLinks(tasks, "h1");
  assert.equal(dropped[0].habitId, undefined);
  assert.equal(dropped[0].text, "a", "the task itself stays");
  assert.equal(P.dropHabitLinks(tasks, "zz"), tasks);
});

test("a new habit with the name of an existing habit is reported (it would split the history); a similar longer name is not", () => {
  const habits = [habit("h1", "Cold shower"), habit("h2", "Read")];
  const found = P.findDuplicates({ type: "habit", name: "cold SHOWER" }, { habits, tasks: [] }, {});
  assert.deepEqual(found.map((f) => [f.type, f.id]), [["habit", "h1"]]);
  assert.equal(P.findDuplicates({ type: "habit", name: "Take cold shower" }, { habits, tasks: [] }, {}).length, 0, "only the same words count for habits");
  assert.equal(P.findDuplicates({ type: "habit", id: "h1", name: "Cold shower" }, { habits, tasks: [] }, {}).length, 0, "not itself");
});

test("a time block that holds a linked task is the row that stays; the habit row for that day goes", () => {
  const items = [
    { source: "habit", id: "h1", date: TODAY, title: "Cold shower" },
    { source: "plan", id: "b1", taskId: "t1", date: TODAY, title: "Cold shower" },
    { source: "habit", id: "h1", date: "2026-11-19", title: "Cold shower" }
  ];
  const byId = { t1: { id: "t1", habitId: "h1" } };
  assert.deepEqual(P.unifyItems(items, byId).map((i) => i.id + "@" + i.date), ["b1@" + TODAY, "h1@2026-11-19"]);
  assert.equal(P.unifyItems(items).length, 3, "without the task list nothing is guessed");
});
