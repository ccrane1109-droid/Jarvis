"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../../js/goals-logic");

const TODAY = "2026-11-04";
const NOW = 1793800000000;
let seq = 0;
const ctx = () => ({ now: NOW, makeId: (p) => p + "_" + (++seq) });
const old = (o) => Object.assign({ id: "g1", name: "Run a 5k", description: "", category: "Health", targetDate: "2026-12-31", hasNumericTarget: false, currentValue: 0, targetValue: 0, unit: "", manualProgressPct: 20, completed: false, milestones: [], createdAt: 1 }, o || {});
const task = (o) => Object.assign({ id: "t1", date: TODAY, text: "Do it", priority: "medium", time: "", completed: false, order: 0, createdAt: 1 }, o || {});
const frozen = (x) => JSON.parse(JSON.stringify(x));

test("goals saved before the dashboard are read as they were: numeric stays numeric, everything else stays manual, progress is unchanged", () => {
  assert.equal(G.mode(old()), "manual");
  assert.equal(G.mode(old({ hasNumericTarget: true, currentValue: 1800, targetValue: 5000 })), "numeric");
  assert.equal(G.progress(old({ manualProgressPct: 35 })).pct, 35);
  const n = G.progress(old({ hasNumericTarget: true, currentValue: 1800, targetValue: 5000, unit: "$" }));
  assert.deepEqual([n.pct, n.remaining, n.unit], [36, 3200, "$"]);
  assert.equal(G.progress(old({ completed: true, manualProgressPct: 10 })).pct, 100, "a completed goal is 100%, as before");
  // an old goal that has milestones is NOT recalculated from them: its progress was set by hand
  const withMs = old({ manualProgressPct: 40, milestones: [{ id: "m1", text: "a", done: true }, { id: "m2", text: "b", done: false }] });
  assert.equal(G.progress(withMs).pct, 40);
  assert.equal(G.mode(withMs), "manual");
});

test("numeric progress counts from a starting value, so a goal can go down (weight) as well as up (money saved)", () => {
  const up = G.progress({ trackMode: "numeric", startValue: 1000, currentValue: 3000, targetValue: 5000 });
  assert.deepEqual([up.pct, up.remaining, up.reached], [50, 2000, false]);
  const down = G.progress({ trackMode: "numeric", startValue: 200, currentValue: 185, targetValue: 170 });
  assert.deepEqual([down.pct, down.remaining], [50, 15]);
  assert.equal(G.progress({ trackMode: "numeric", startValue: 0, currentValue: 120, targetValue: 100 }).pct, 100, "never above 100");
  assert.equal(G.progress({ trackMode: "numeric", startValue: 0, currentValue: -5, targetValue: 100 }).pct, 0, "never below 0");
  assert.equal(G.progress({ trackMode: "numeric", startValue: 0, currentValue: 100, targetValue: 100 }).reached, true);
});

test("milestone progress counts done milestones; a milestone with a task is done when its task is", () => {
  const g = old({ trackMode: "milestones", milestones: [{ id: "a", text: "A", done: false }, { id: "b", text: "B", done: true }, { id: "c", text: "C", done: false, taskId: "t1" }, { id: "d", text: "D", done: true, taskId: "t2" }] });
  const p = G.progress(g, [task({ id: "t1", completed: true }), task({ id: "t2", completed: false })]);
  assert.deepEqual([p.done, p.total, p.pct], [2, 4, 50], "b ticked + c's task done; d's task is open so d is not done whatever was saved");
  assert.equal(G.progress(g, []).done, 2, "with the tasks gone, the saved ticks are used (b and d)");
  assert.equal(G.progress(old({ trackMode: "milestones", milestones: [] })).pct, 0, "no milestones: 0%, not a guess");
  assert.equal(G.progress(old({ trackMode: "milestones", milestones: [{ id: "a", text: "A", done: true }] })).reached, true);
});

test("due wording: overdue, today, tomorrow, soon, later, none", () => {
  assert.deepEqual([G.dueInfo("2026-11-01", TODAY).tone, G.dueInfo("2026-11-01", TODAY).text], ["overdue", "Overdue by 3 days"]);
  assert.equal(G.dueInfo(TODAY, TODAY).text, "Due today");
  assert.equal(G.dueInfo("2026-11-05", TODAY).text, "Due tomorrow");
  assert.deepEqual([G.dueInfo("2026-11-14", TODAY).tone, G.dueInfo("2026-11-14", TODAY).text], ["soon", "Due in 10 days"]);
  assert.equal(G.dueInfo("2026-12-31", TODAY).tone, "later");
  assert.equal(G.dueInfo("2027-06-01", TODAY).text, "Due in 7 months");
  assert.equal(G.dueInfo("", TODAY).tone, "none");
});

test("category chips: the four, All Goals, and Other only when some goal needs it; filtering keeps unknown categories", () => {
  const goals = [old({ id: "a", category: "Business" }), old({ id: "b", category: "health " }), old({ id: "c", category: "Fitness" }), old({ id: "d", category: "" })];
  const chips = G.chips(goals);
  assert.deepEqual(chips.map((c) => [c.key, c.count]), [["all", 4], ["business", 1], ["health", 1], ["learning", 0], ["personal", 0], ["other", 2]]);
  assert.deepEqual(G.chips([old({ category: "Learning" })]).map((c) => c.key), ["all", "business", "health", "learning", "personal"], "no Other chip with nothing in it");
  assert.deepEqual(G.filter(goals, "other").map((g) => g.id), ["c", "d"]);
  assert.equal(G.filter(goals, "all").length, 4);
  assert.equal(G.filter(goals, "health")[0].category, "health ", "the saved category text is never rewritten");
});

test("the list: active goals by target date then importance, finished ones last", () => {
  const goals = [old({ id: "late", targetDate: "2027-03-01" }), old({ id: "done", completed: true, completedAt: 5 }), old({ id: "none", targetDate: "" }), old({ id: "soon", targetDate: "2026-11-20", priority: "low" }), old({ id: "soon2", targetDate: "2026-11-20", priority: "high" })];
  assert.deepEqual(G.order(goals).map((g) => g.id), ["soon2", "soon", "late", "none", "done"]);
  assert.deepEqual(goals.map((g) => g.id), ["late", "done", "none", "soon", "soon2"], "the saved list is not reordered");
});

test("the four numbers: active, completed, due soon (within 14 days, overdue included), and the average progress of the active ones", () => {
  const goals = [old({ id: "a", manualProgressPct: 20, targetDate: "2026-11-10" }), old({ id: "b", manualProgressPct: 60, targetDate: "2026-10-30" }), old({ id: "c", manualProgressPct: 100, completed: true }), old({ id: "d", manualProgressPct: 40, targetDate: "2027-01-01" })];
  assert.deepEqual(G.stats(goals, [], TODAY), { active: 3, completed: 1, dueSoon: 2, overdue: 1, overall: 40 });
  assert.equal(G.stats([], [], TODAY).overall, null, "nothing active: no percentage");
});

test("next steps: unfinished milestones and open goal tasks of active goals, soonest first, then by how much you said it matters", () => {
  const goals = [
    old({ id: "g1", name: "Launch", priority: "medium", trackMode: "milestones", milestones: [{ id: "m1", text: "Order samples", done: false, due: "2026-11-20" }, { id: "m2", text: "Approve", done: false, due: "2026-11-02" }, { id: "m3", text: "Done one", done: true, due: "2026-11-01" }, { id: "m4", text: "Website", done: false, taskId: "tw" }] }),
    old({ id: "g2", name: "Learn", priority: "high", trackMode: "milestones", milestones: [{ id: "n1", text: "Chapter 1", done: false, due: "2026-11-06" }, { id: "n2", text: "Someday", done: false }] }),
    old({ id: "g3", name: "Closed", completed: true, milestones: [{ id: "x", text: "ignored", done: false }] })
  ];
  const tasks = [task({ id: "tw", text: "Build the site", date: "2026-11-09" }), task({ id: "loose", text: "Call the printer", date: "2026-11-05", goalId: "g1", priority: "high" }), task({ id: "claimed", goalId: "g1", completed: true })];
  const s = G.steps(goals, tasks, TODAY);
  assert.deepEqual(s.map((x) => x.title), ["Approve", "Call the printer", "Chapter 1", "Website", "Order samples", "Someday"]);
  assert.deepEqual(s.map((x) => x.tier), [0, 1, 1, 1, 2, 3], "overdue, within a week, later, undated");
  assert.equal(s[0].overdue, true);
  assert.equal(s[3].taskId, "tw", "a milestone that has a task is that one step, with its task");
  assert.equal(s.filter((x) => x.taskId === "tw").length, 1, "and its task is not listed a second time");
  assert.equal(G.nextFor(s, "g2").title, "Chapter 1");
  assert.equal(G.nextFor(s, "nope"), null);
  assert.deepEqual(goals[0].milestones.map((m) => m.done), [false, false, true, false], "reading steps changes nothing");
});

test("importance breaks ties inside the same urgency, and never moves an overdue step below a later one", () => {
  const goals = [old({ id: "lo", priority: "low", trackMode: "milestones", milestones: [{ id: "a", text: "Low overdue", done: false, due: "2026-11-01" }] }), old({ id: "hi", priority: "high", trackMode: "milestones", milestones: [{ id: "b", text: "High later", done: false, due: "2026-12-30" }, { id: "c", text: "High overdue", done: false, due: "2026-10-30" }] })];
  assert.deepEqual(G.steps(goals, [], TODAY).map((x) => x.title), ["High overdue", "Low overdue", "High later"]);
});

test("making a goal: a name is needed, a numeric goal needs a different target, milestones get ids and keep their dates", () => {
  assert.equal(G.create([], { name: "  " }, ctx()).errors.name, "Give the goal a name.");
  assert.ok(G.create([], { name: "x", trackMode: "numeric", targetValue: "" }, ctx()).errors.targetValue);
  assert.ok(G.create([], { name: "x", trackMode: "numeric", startValue: 5, targetValue: 5 }, ctx()).errors.targetValue);
  assert.ok(G.create([], { name: "x", targetDate: "soon" }, ctx()).errors.targetDate);
  const r = G.create([old({ id: "keep" })], { name: " Launch  Gratiel Drop 001 ", category: "Business", priority: "high", targetDate: "2026-12-01", trackMode: "milestones", milestones: [{ text: "Finalize designs", due: "2026-11-10" }, { text: "" }, { text: "Order samples" }] }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.goals.length, 2);
  assert.equal(r.goal.name, "Launch Gratiel Drop 001");
  assert.deepEqual(r.goal.milestones.map((m) => [m.text, m.due || "", m.done]), [["Finalize designs", "2026-11-10", false], ["Order samples", "", false]]);
  assert.equal(new Set(r.goal.milestones.map((m) => m.id)).size, 2);
  assert.deepEqual([r.goal.trackMode, r.goal.hasNumericTarget, r.goal.priority, r.goal.completed], ["milestones", false, "high", false]);
  const n = G.create([], { name: "Save", trackMode: "numeric", startValue: "1000", targetValue: "5000", unit: "$" }, ctx());
  assert.deepEqual([n.goal.hasNumericTarget, n.goal.startValue, n.goal.currentValue, n.goal.targetValue, n.goal.unit], [true, 1000, 1000, 5000, "$"], "starts at the starting value");
});

test("editing keeps what was saved: milestones keep their ticks and tasks by id, a goal changing how it is tracked keeps the old numbers", () => {
  const g = old({ id: "g", trackMode: "numeric", hasNumericTarget: true, startValue: 0, currentValue: 3, targetValue: 10, manualProgressPct: 25, completed: true, milestones: [{ id: "m1", text: "A", done: true, taskId: "t1", doneAt: 9 }, { id: "m2", text: "B", done: false }] });
  const before = frozen(g);
  const r = G.update([g], "g", { name: "Renamed", trackMode: "milestones", milestones: [{ id: "m1", text: "A (renamed)", due: "2026-12-01" }, { text: "New one" }] }, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(g, before, "the old list is untouched");
  const n = r.goal;
  assert.deepEqual([n.name, n.trackMode, n.hasNumericTarget, n.completed], ["Renamed", "milestones", false, true]);
  assert.deepEqual([n.currentValue, n.targetValue, n.manualProgressPct], [3, 10, 25], "the numbers saved for the other ways of tracking are kept");
  assert.deepEqual(n.milestones.map((m) => m.text), ["A (renamed)", "New one"], "B was left out so it is removed");
  assert.deepEqual([n.milestones[0].done, n.milestones[0].taskId, n.milestones[0].doneAt, n.milestones[0].due], [true, "t1", 9, "2026-12-01"], "m1 kept its tick, its task and now has a date");
  // without a milestone list the milestones are not touched
  const same = G.update([g], "g", { name: "Only the name", trackMode: "numeric", startValue: 0, currentValue: 3, targetValue: 10 }, ctx()).goal;
  assert.deepEqual(same.milestones, g.milestones);
  assert.equal(G.update([g], "missing", { name: "x" }, ctx()).ok, false);
});

test("quick progress: a number for numeric goals, steps for manual goals; neither completes the goal, and other goals are never touched", () => {
  const goals = [old({ id: "n", trackMode: "numeric", hasNumericTarget: true, currentValue: 0, targetValue: 5000 }), old({ id: "m", manualProgressPct: 95 }), old({ id: "k", trackMode: "milestones" })];
  const a = G.setCurrent(goals, "n", "5200", ctx());
  assert.deepEqual([a.goal.currentValue, a.goal.completed], [5200, false], "reaching the target does not complete it for you");
  assert.equal(G.progress(a.goal).reached, true, "but it is shown as reached");
  assert.ok(G.setCurrent(goals, "n", "abc", ctx()).error);
  assert.ok(G.setCurrent(goals, "m", "5", ctx()).error, "a manual goal has no number");
  assert.equal(G.stepManual(goals, "m", 5, ctx()).goal.manualProgressPct, 100);
  assert.equal(G.stepManual(goals, "m", 50, ctx()).goal.manualProgressPct, 100, "capped");
  assert.equal(G.stepManual(goals, "m", -5, ctx()).goal.manualProgressPct, 90);
  assert.equal(G.stepManual(goals, "k", 5, ctx()).ok, false, "milestone goals are never stepped by hand");
  assert.equal(a.goals[1], goals[1], "other goals are the very same records");
});

test("complete and reopen", () => {
  const goals = [old({ id: "g" })];
  const done = G.setCompleted(goals, "g", true, ctx());
  assert.deepEqual([done.goal.completed, done.goal.completedAt], [true, NOW]);
  const back = G.setCompleted(done.goals, "g", false, ctx());
  assert.deepEqual([back.goal.completed, "completedAt" in back.goal], [false, false]);
  assert.equal(G.setPriority(goals, "g", "high", ctx()).goal.priority, "high");
  assert.equal(G.setPriority(goals, "g", "urgent", ctx()).ok, false);
});

test("milestones: add, change the date (a task on the old date goes with it), tick with and without a task, remove", () => {
  let goals = [old({ id: "g", trackMode: "milestones", milestones: [{ id: "m1", text: "Order samples", done: false, due: "2026-11-10", taskId: "t1" }, { id: "m2", text: "Website", done: false }] })];
  const tasks = [task({ id: "t1", date: "2026-11-10" })];
  const e = G.editMilestone(goals, "g", "m1", { due: "2026-11-15" }, tasks, ctx());
  assert.equal(e.goal.milestones[0].due, "2026-11-15");
  assert.deepEqual(e.taskPatch, { taskId: "t1", date: "2026-11-15" }, "the task was on the old date, so it moves too");
  const e2 = G.editMilestone(goals, "g", "m1", { due: "2026-11-15" }, [task({ id: "t1", date: "2026-11-12" })], ctx());
  assert.equal(e2.taskPatch, null, "a task you moved yourself is left alone");
  assert.equal(G.editMilestone(goals, "g", "m1", { due: "" }, tasks, ctx()).goal.milestones[0].due, undefined, "the date can be cleared");
  assert.equal(G.editMilestone(goals, "g", "m1", { text: "  " }, tasks, ctx()).goal.milestones[0].text, "Order samples", "an empty name is ignored");
  const a = G.addMilestone(goals, "g", { text: "Launch", due: "2026-12-01" }, ctx());
  assert.deepEqual(a.goal.milestones.slice(-1)[0].due, "2026-12-01");
  assert.ok(G.addMilestone(goals, "g", "  ", ctx()).error);
  // ticking one with a task changes the task; without a task it changes the milestone
  const withTask = G.setMilestoneDone(goals, "g", "m1", true, tasks, ctx());
  assert.deepEqual(withTask.taskPatch, { taskId: "t1", completed: true });
  const plain = G.setMilestoneDone(goals, "g", "m2", true, tasks, ctx());
  assert.equal(plain.taskPatch, null);
  assert.deepEqual([plain.goal.milestones[1].done, plain.goal.milestones[1].doneAt], [true, NOW]);
  assert.equal("doneAt" in G.setMilestoneDone(plain.goals, "g", "m2", false, tasks, ctx()).goal.milestones[1], false);
  assert.deepEqual(G.removeMilestone(goals, "g", "m2", ctx()).goal.milestones.map((m) => m.id), ["m1"]);
  assert.equal(G.removeMilestone(goals, "g", "nope", ctx()).ok, false);
  const linked = G.linkTask(goals, "g", "m2", "t9", ctx());
  assert.equal(linked.goal.milestones[1].taskId, "t9");
  assert.equal("taskId" in G.linkTask(linked.goals, "g", "m2", "", ctx()).goal.milestones[1], false);
  goals = null;
});

test("keeping saved ticks in step with tasks: a finished task ticks its milestone for good; a deleted task is let go; nothing else changes", () => {
  const goals = [old({ id: "g", trackMode: "milestones", milestones: [{ id: "m1", text: "A", done: false, taskId: "t1" }, { id: "m2", text: "B", done: true, taskId: "t2" }, { id: "m3", text: "C", done: false, taskId: "gone" }, { id: "m4", text: "D", done: false }] }), old({ id: "other" })];
  const r = G.syncFromTasks(goals, [task({ id: "t1", completed: true }), task({ id: "t2", completed: false })], ctx());
  assert.equal(r.changed, true);
  const ms = r.goals[0].milestones;
  assert.deepEqual(ms.map((m) => [m.done, m.taskId || null]), [[true, "t1"], [false, "t2"], [false, null], [false, null]]);
  assert.equal(r.goals[1], goals[1], "goals with no linked tasks are the same records");
  const again = G.syncFromTasks(r.goals, [task({ id: "t1", completed: true }), task({ id: "t2", completed: false })], ctx());
  assert.equal(again.changed, false);
  assert.equal(again.goals, r.goals);
});

test("a task for a milestone: its words, its date (or today), the goal's importance, linked to the goal", () => {
  const g = old({ id: "g", priority: "high" });
  assert.deepEqual(G.taskDraft(g, { id: "m", text: "Order samples", due: "2026-11-20" }, { today: TODAY }), { text: "Order samples", date: "2026-11-20", time: "", priority: "high", goalId: "g" });
  assert.equal(G.taskDraft(g, { id: "m", text: "No date" }, { today: TODAY }).date, TODAY);
  assert.deepEqual(G.taskDraft(g, null, { text: "Free task", date: "2026-11-06", time: "14:30", priority: "low" }), { text: "Free task", date: "2026-11-06", time: "14:30", priority: "low", goalId: "g" });
  assert.equal(G.taskDraft(g, null, { text: "x", time: "25:00", today: TODAY }).time, "");
});

test("the Calendar: a goal's target date and its milestones' dates, and a milestone that has a task is not listed twice", () => {
  const goals = [old({ id: "g", name: "Launch", targetDate: "2026-11-30", priority: "high", trackMode: "milestones", milestones: [{ id: "m1", text: "Order samples", done: false, due: "2026-11-10" }, { id: "m2", text: "Approve", done: true, due: "2026-11-12" }, { id: "m3", text: "Website", done: false, due: "2026-11-14", taskId: "tw" }, { id: "m4", text: "Later", done: false, due: "2027-02-01" }, { id: "m5", text: "Undated", done: false }] })];
  const items = G.calendarItems(goals, [task({ id: "tw", date: "2026-11-14" })], "2026-11-01", "2026-11-30");
  assert.deepEqual(items.map((i) => [i.title, i.date, i.completed, i.readOnly]), [["Goal: Launch", "2026-11-30", false, true], ["Milestone: Order samples", "2026-11-10", false, false], ["Milestone: Approve", "2026-11-12", true, false]]);
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
  assert.equal(items[1].goalId, "g");
  assert.equal(items[1].milestoneId, "m1");
  assert.equal(items[1].allDay, true);
  assert.equal(items[1].priority, "high");
  // the task is gone: the milestone shows on its own date again
  assert.ok(G.calendarItems(goals, [], "2026-11-14", "2026-11-14").some((i) => i.title === "Milestone: Website"));
  assert.deepEqual(G.calendarItems(null, null, "2026-11-01", "2026-11-30"), []);
});

test("damaged records are skipped, never thrown on", () => {
  const junk = [null, 3, "x", { id: "" }, { name: "no id" }, old({ id: "ok", milestones: [null, 5, { id: "m", text: "fine" }, { text: "no id" }] })];
  assert.doesNotThrow(() => { G.stats(junk, [], TODAY); G.order(junk); G.chips(junk); G.steps(junk, null, TODAY); G.calendarItems(junk, null, "2026-11-01", "2026-11-30"); });
  assert.deepEqual(G.milestones(junk[5]).map((m) => m.id), ["m"]);
  assert.equal(G.stats(junk, [], TODAY).active, 1);
});
