"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/plan-logic");
const W = require("../../js/plan-week-logic");
const CL = require("../../js/calendar-logic");

const MON = "2026-11-02";                 // the week of Wed 2026-11-04
const TODAY = "2026-11-04";
const NOW = Date.parse("2026-11-04T15:00:00Z");
let seq = 0;
const ctx = (o) => Object.assign({ now: NOW, makeId: (p) => p + "_" + (++seq) }, o || {});
const task = (id, o) => Object.assign({ id: id, date: TODAY, text: "Task " + id, priority: "medium", time: "", completed: false, order: 0, createdAt: 1 }, o || {});
const ING = W.addStarters([], ctx()).ingredients;
const block = (blocks, o, c) => { const r = W.addBlock(blocks, Object.assign({ title: "Deep work", ingredientId: "ing_gratiel", date: TODAY, start: "09:00", end: "10:30" }, o), ctx(Object.assign({ ingredients: ING }, c || {}))); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r; };
const event = (o) => CL.add([], Object.assign({ title: "Class", kind: "event", date: TODAY, time: "09:00", endTime: "10:30", tz: "America/New_York" }, o), { now: 1, zone: "America/New_York" }).events;

/* ---------------- ingredients ---------------- */

test("the six starter ingredients are added once, with fixed ids, and Rest is the resting one", () => {
  const r = W.addStarters([], ctx());
  assert.deepEqual(r.ingredients.map((i) => i.name), ["School", "Gratiel", "Workout", "Studying", "Personal", "Rest"]);
  assert.equal(r.added, 6);
  assert.deepEqual(r.ingredients.filter((i) => i.rest).map((i) => i.name), ["Rest"]);
  // again: nothing new, even on another device that made its own copy with the same ids
  const again = W.addStarters(r.ingredients, ctx());
  assert.equal(again.added, 0); assert.equal(again.ingredients.length, 6);
  // one you deleted comes back; one you renamed isn't made a second time
  const gone = W.removeIngredient(r.ingredients, "ing_rest", ctx()).ingredients;
  const back = W.addStarters(gone, ctx());
  assert.equal(back.added, 1); assert.equal(W.liveIngredients(back.ingredients).length, 6);
  const renamed = W.editIngredient(r.ingredients, "ing_school", { name: "Class" }, ctx()).ingredients;
  assert.equal(W.addStarters(renamed, ctx()).ingredients.filter((i) => !i.deletedAt).length, 6);
  // a different one of yours with the same name is not duplicated
  const mine = W.addIngredient([], { name: "school", color: "#4f8cff" }, ctx()).ingredients;
  assert.equal(W.liveIngredients(W.addStarters(mine, ctx()).ingredients).filter((i) => i.name.toLowerCase() === "school").length, 1);
});

test("an ingredient needs a name and a colour; names are unique; the colour can be changed", () => {
  assert.ok(W.addIngredient([], { name: "", color: "#4f8cff" }, ctx()).errors.name);
  assert.ok(W.addIngredient([], { name: "Reading", color: "blue" }, ctx()).errors.color);
  assert.ok(W.addIngredient([], { name: "x".repeat(31), color: "#4f8cff" }, ctx()).errors.name);
  let r = W.addIngredient([], { name: "Reading", color: "#4F8CFF" }, ctx());
  assert.equal(r.ok, true); assert.equal(r.ingredient.color, "#4f8cff");
  assert.match(W.addIngredient(r.ingredients, { name: " reading ", color: "#33d17a" }, ctx()).errors.name, /already/);
  const e = W.editIngredient(r.ingredients, r.ingredient.id, { color: "#ff5c66" }, ctx({ now: NOW + 5 }));
  assert.equal(e.ok, true); assert.equal(e.ingredient.color, "#ff5c66"); assert.equal(e.ingredient.name, "Reading"); assert.equal(e.ingredient.updatedAt, NOW + 5);
  // renaming to itself is fine
  assert.equal(W.editIngredient(r.ingredients, r.ingredient.id, { name: "Reading" }, ctx()).ok, true);
  assert.equal(W.tint("#ff0000", 0.2), "rgba(255,0,0,0.2)");
  assert.equal(W.tint("junk", 0.2), "rgba(148,163,184,0.2)");
});

test("deleting an ingredient keeps its blocks (as 'no ingredient'), and undo restores it", () => {
  let blocks = block([], {}).blocks;
  const gone = W.removeIngredient(ING, "ing_gratiel", ctx()).ingredients;
  assert.equal(W.liveBlocks(blocks).length, 1);
  const st = W.weekStats({ weekStart: MON, today: TODAY, blocks, ingredients: gone, tasks: [] });
  assert.equal(st.allocation[0].name, "No ingredient");
  const back = W.restoreIngredient(gone, "ing_gratiel", ctx()).ingredients;
  assert.equal(W.weekStats({ weekStart: MON, today: TODAY, blocks, ingredients: back, tasks: [] }).allocation[0].name, "Gratiel");
});

/* ---------------- blocks ---------------- */

test("a block needs a day, a start and an end that is after it and at least 15 minutes later", () => {
  const c = ctx({ ingredients: ING });
  const bad = (o) => W.checkBlock(Object.assign({ title: "x", date: TODAY, start: "09:00", end: "10:00" }, o), c).errors;
  assert.ok(bad({ date: "" }).date); assert.ok(bad({ start: "9am" }).start); assert.ok(bad({ end: "" }).end);
  assert.match(bad({ end: "09:00" }).end, /after/); assert.match(bad({ end: "08:00" }).end, /after/); assert.match(bad({ end: "09:10" }).end, /15/);
  assert.ok(bad({ title: "" }).title);
  assert.deepEqual(bad({}), {});
  assert.equal(W.checkBlock({ title: "x".repeat(141), date: TODAY, start: "09:00", end: "10:00" }, c).ok, false);
});

test("a block with no title takes the task's text, else the ingredient's name", () => {
  const tasks = [task("t1", { text: "Order samples" })];
  assert.equal(W.checkBlock({ taskId: "t1", date: TODAY, start: "09:00", end: "10:00" }, ctx({ tasks: tasks })).block.title, "Order samples");
  assert.equal(W.checkBlock({ ingredientId: "ing_workout", date: TODAY, start: "09:00", end: "10:00" }, ctx({ ingredients: ING })).block.title, "Workout");
  assert.ok(W.checkBlock({ taskId: "gone", date: TODAY, start: "09:00", end: "10:00", title: "x" }, ctx({ tasks: tasks })).errors.taskId);
  assert.ok(W.checkBlock({ ingredientId: "ing_nope", title: "x", date: TODAY, start: "09:00", end: "10:00" }, ctx({ ingredients: ING })).errors.ingredientId);
});

test("only blocks without a task can repeat", () => {
  const c = ctx({ tasks: [task("t1")], ingredients: ING });
  const r = W.checkBlock({ title: "x", taskId: "t1", date: TODAY, start: "09:00", end: "10:00", repeatFreq: "weekly", repeatDays: [1] }, c);
  assert.match(r.errors.repeatFreq, /can't repeat/);
  const ok = W.checkBlock({ title: "Workout", date: TODAY, start: "06:00", end: "07:00", repeatFreq: "weekly", repeatDays: [5, 1, 3, 3] }, c);
  assert.deepEqual(ok.block.repeat, { freq: "weekly", byDay: [1, 3, 5], until: "" }, "Monday first, each once");
  // no days picked: the day of the first block
  assert.deepEqual(W.checkBlock({ title: "x", date: TODAY, start: "06:00", end: "07:00", repeatFreq: "weekly" }, c).block.repeat.byDay, [3]);
  assert.ok(W.checkBlock({ title: "x", date: TODAY, start: "06:00", end: "07:00", repeatFreq: "weekly", until: "2026-11-01" }, c).errors.until);
  assert.ok(W.checkBlock({ title: "x", date: TODAY, start: "06:00", end: "07:00", repeatFreq: "weekly", until: "nope" }, c).errors.until);
});

test("a repeating block shows on each chosen day, not before it starts or after its last day, and skips taken-out days", () => {
  let blocks = W.addBlock([], { title: "Workout", ingredientId: "ing_workout", date: "2026-11-02", start: "06:00", end: "07:00", repeatFreq: "weekly", repeatDays: [1, 3, 5], until: "2026-11-13" }, ctx({ ingredients: ING })).blocks;
  const id = blocks[0].id;
  const days = (from, to) => W.occurrences(blocks, from, to).map((o) => o.date);
  assert.deepEqual(days("2026-11-01", "2026-11-22"), ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13"]);
  assert.deepEqual(days("2026-10-26", "2026-11-01"), [], "not before it starts");
  blocks = W.removeOccurrence(blocks, id, "2026-11-04", ctx()).blocks;
  assert.deepEqual(days("2026-11-02", "2026-11-08"), ["2026-11-02", "2026-11-06"], "that Wednesday is skipped, the series continues");
  assert.equal(W.liveBlocks(blocks).length, 1, "still one block");
  blocks = W.restoreOccurrence(blocks, id, "2026-11-04", ctx()).blocks;
  assert.equal(days("2026-11-02", "2026-11-08").length, 3, "undo");
  // daily
  const daily = W.addBlock([], { title: "Read", date: "2026-11-02", start: "21:00", end: "21:30", repeatFreq: "daily", until: "2026-11-05" }, ctx()).blocks;
  assert.equal(W.occurrences(daily, "2026-11-01", "2026-11-30").length, 4);
});

test("moving a one-off block, and re-timing one day of a repeating block", () => {
  let blocks = block([], { title: "Admin", start: "09:00", end: "10:00" }).blocks;
  const id = blocks[0].id;
  const mv = W.moveOccurrence(blocks, id, TODAY, { date: "2026-11-06", start: "14:00", end: "15:30" }, ctx());
  assert.equal(mv.ok, true);
  assert.deepEqual(W.occurrences(mv.blocks, MON, "2026-11-08").map((o) => [o.date, o.start, o.end]), [["2026-11-06", "14:00", "15:30"]]);
  assert.equal(mv.taskPatch, null, "no task, nothing to change on a task");
  assert.equal(W.moveOccurrence(blocks, id, TODAY, { date: TODAY, start: "10:00", end: "09:00" }, ctx()).ok, false);
  assert.equal(W.moveOccurrence(blocks, id, TODAY, { date: TODAY, start: "10:00", end: "10:05" }, ctx()).ok, false);
  // repeating: same day -> that day only
  const rep = W.addBlock([], { title: "Workout", date: "2026-11-02", start: "06:00", end: "07:00", repeatFreq: "weekly", repeatDays: [1, 3] }, ctx()).blocks;
  const same = W.moveOccurrence(rep, rep[0].id, "2026-11-04", { date: "2026-11-04", start: "07:00", end: "08:00" }, ctx());
  assert.deepEqual(W.occurrences(same.blocks, "2026-11-02", "2026-11-11").map((o) => [o.date, o.start, o.moved]), [["2026-11-02", "06:00", false], ["2026-11-04", "07:00", true], ["2026-11-09", "06:00", false], ["2026-11-11", "06:00", false]]);
  // putting it back on the original time clears the override
  const back = W.moveOccurrence(same.blocks, rep[0].id, "2026-11-04", { date: "2026-11-04", start: "06:00", end: "07:00" }, ctx());
  assert.equal(W.occurrence(back.blocks, rep[0].id, "2026-11-04").moved, false);
  // to another day: that day is skipped and a one-off copy appears, the series is untouched
  const other = W.moveOccurrence(rep, rep[0].id, "2026-11-04", { date: "2026-11-05", start: "18:00", end: "19:00" }, ctx());
  assert.deepEqual(W.occurrences(other.blocks, "2026-11-02", "2026-11-08").map((o) => [o.date, o.start, o.recurring]), [["2026-11-02", "06:00", true], ["2026-11-05", "18:00", false]]);
  assert.equal(W.liveBlocks(other.blocks).length, 2);
});

test("resizing changes the end only", () => {
  const blocks = block([], { start: "09:00", end: "10:00" }).blocks;
  const r = W.resizeOccurrence(blocks, blocks[0].id, TODAY, "11:30", ctx());
  assert.deepEqual(W.occurrences(r.blocks, TODAY, TODAY).map((o) => [o.start, o.end]), [["09:00", "11:30"]]);
  assert.equal(W.resizeOccurrence(blocks, blocks[0].id, TODAY, "09:05", ctx()).ok, false);
});

test("editing: all of a repeating block, or only one day (as a one-off copy)", () => {
  let blocks = W.addBlock([], { title: "Workout", ingredientId: "ing_workout", date: "2026-11-02", start: "06:00", end: "07:00", repeatFreq: "weekly", repeatDays: [1, 3] }, ctx({ ingredients: ING })).blocks;
  const id = blocks[0].id;
  const all = W.editBlock(blocks, id, { title: "Lift", end: "07:30" }, ctx({ ingredients: ING }));
  assert.equal(all.ok, true);
  assert.deepEqual(W.occurrences(all.blocks, "2026-11-02", "2026-11-04").map((o) => [o.title, o.end]), [["Lift", "07:30"], ["Lift", "07:30"]]);
  assert.equal(W.liveBlocks(all.blocks).length, 1);
  const one = W.editOccurrence(blocks, id, "2026-11-04", { title: "Easy run", ingredientId: "ing_personal" }, ctx({ ingredients: ING }));
  assert.equal(one.ok, true);
  assert.deepEqual(W.occurrences(one.blocks, "2026-11-02", "2026-11-04").map((o) => [o.date, o.title, o.recurring]), [["2026-11-02", "Workout", true], ["2026-11-04", "Easy run", false]]);
  // stopping the repeat
  const stop = W.editBlock(blocks, id, { repeatFreq: "" }, ctx({ ingredients: ING }));
  assert.equal(stop.block.repeat, null);
  assert.equal(W.occurrences(stop.blocks, "2026-11-02", "2026-11-30").length, 1);
});

test("deleting keeps a tombstone; undo", () => {
  const blocks = block([], {}).blocks;
  const gone = W.removeBlock(blocks, blocks[0].id, ctx());
  assert.equal(W.liveBlocks(gone.blocks).length, 0);
  assert.equal(W.liveBlocks(W.restoreBlock(gone.blocks, blocks[0].id, ctx()).blocks).length, 1);
  assert.equal(W.purge(gone.blocks, NOW + 31 * 86400000).length, 0);
});

test("time worked is only what you log; it can be cleared; blocks without a task can be ticked", () => {
  let blocks = block([], { start: "09:00", end: "10:00" }).blocks;
  const id = blocks[0].id;
  assert.equal(W.occurrence(blocks, id, TODAY).workedMin, null);
  blocks = W.logWork(blocks, id, TODAY, "45", ctx()).blocks;
  assert.equal(W.occurrence(blocks, id, TODAY).workedMin, 45);
  assert.equal(W.logWork(blocks, id, TODAY, "-5", ctx()).ok, false);
  assert.equal(W.logWork(blocks, id, TODAY, "1.5", ctx()).ok, false);
  assert.equal(W.logWork(blocks, id, TODAY, "1441", ctx()).ok, false);
  assert.equal(W.occurrence(W.logWork(blocks, id, TODAY, 0, ctx()).blocks, id, TODAY).workedMin, 0, "zero is a real answer: planned, not done");
  assert.equal(W.occurrence(W.logWork(blocks, id, TODAY, "", ctx()).blocks, id, TODAY).workedMin, null);
  blocks = W.setBlockDone(blocks, id, TODAY, true, ctx()).blocks;
  assert.equal(W.occurrence(blocks, id, TODAY).done, true);
  assert.equal(W.occurrence(W.setBlockDone(blocks, id, TODAY, false, ctx()).blocks, id, TODAY).done, false);
});

/* ---------------- tasks in blocks ---------------- */

test("a task goes in one block; the task's day and time follow; taking it out puts them back", () => {
  const tasks = [task("t1", { text: "Order samples", date: "2026-11-05", time: "" })];
  const c = ctx({ ingredients: ING });
  let r = W.placeTask([], "t1", { date: TODAY, start: "10:00", end: "11:00", ingredientId: "ing_gratiel" }, tasks, c);
  assert.equal(r.ok, true);
  assert.deepEqual(r.taskPatch, { date: TODAY, time: "10:00" });
  assert.equal(r.block.taskId, "t1"); assert.equal(r.block.title, "Order samples");
  assert.deepEqual(r.block.was, { date: "2026-11-05", time: "" });
  let blocks = r.blocks;
  // moving it: still one block
  r = W.placeTask(blocks, "t1", { date: "2026-11-06", start: "14:00", end: "15:00", ingredientId: "ing_school" }, tasks, c);
  assert.equal(W.liveBlocks(r.blocks).length, 1);
  assert.deepEqual(r.taskPatch, { date: "2026-11-06", time: "14:00" });
  assert.equal(r.block.ingredientId, "ing_school");
  assert.deepEqual(r.block.was, { date: "2026-11-05", time: "" }, "the original day is remembered, not the last move");
  blocks = r.blocks;
  // taking it out
  const un = W.unplaceTask(blocks, "t1", ctx());
  assert.deepEqual(un.taskPatch, { date: "2026-11-05", time: "" });
  assert.equal(W.liveBlocks(un.blocks).length, 0);
  assert.equal(W.unplaceTask([], "t1", ctx()).ok, false);
  assert.equal(W.placeTask([], "ghost", { date: TODAY, start: "10:00", end: "11:00" }, tasks, c).ok, false);
  assert.equal(W.placeTask([], "t1", { date: TODAY, start: "11:00", end: "10:00" }, tasks, c).ok, false);
});

test("a task is 'scheduled' only when its block is on the day it is dated; carrying it forward frees it, keeping the past block", () => {
  const tasks = [task("t1", { date: TODAY })];
  let blocks = W.placeTask([], "t1", { date: TODAY, start: "10:00", end: "11:00" }, tasks, ctx()).blocks;
  assert.ok(W.scheduledBlock(blocks, tasks[0]));
  const moved = W.carryTasks(tasks, ["t1"], "2026-11-05");
  assert.equal(W.scheduledBlock(blocks, moved[0]), null, "the block is on another day now");
  blocks = W.detachTasks(blocks, ["t1"], ctx());
  assert.equal(W.blockOfTask(blocks, "t1"), null);
  assert.equal(W.liveBlocks(blocks).length, 1, "the block stays for the review");
  assert.equal(W.liveBlocks(blocks)[0].title, "Task t1");
  // and the task can be placed again
  assert.equal(W.placeTask(blocks, "t1", { date: "2026-11-05", start: "10:00", end: "11:00" }, moved, ctx()).blocks.length, 2);
});

/* ---------------- the week's numbers ---------------- */

test("planned vs actual time and the split by ingredient", () => {
  let blocks = block([], { title: "Gratiel", ingredientId: "ing_gratiel", date: "2026-11-02", start: "09:00", end: "11:00" }).blocks;
  blocks = block(blocks, { title: "Gym", ingredientId: "ing_workout", date: "2026-11-03", start: "06:00", end: "07:00" }).blocks;
  blocks = block(blocks, { title: "Study", ingredientId: "ing_studying", date: "2026-11-06", start: "19:00", end: "20:00" }).blocks;
  const id0 = blocks[0].id, id1 = blocks[1].id;
  blocks = W.logWork(blocks, id0, "2026-11-02", 90, ctx()).blocks;
  blocks = W.logWork(blocks, id1, "2026-11-03", 60, ctx()).blocks;
  const st = W.weekStats({ weekStart: MON, today: TODAY, blocks, ingredients: ING, tasks: [] });
  assert.equal(st.plannedMin, 240); assert.equal(st.actualMin, 150);
  assert.equal(st.blocks, 3); assert.equal(st.pastBlocks, 2); assert.equal(st.loggedBlocks, 2);
  assert.deepEqual(st.allocation.map((a) => [a.name, a.planned, a.actual, a.share]), [["Gratiel", 120, 90, 50], ["Workout", 60, 60, 25], ["Studying", 60, 0, 25]]);
  // a block you didn't log is not counted as worked
  assert.equal(st.allocation[2].logged, 0);
  // blocks in other weeks are not in this one
  assert.equal(W.weekStats({ weekStart: "2026-11-09", today: TODAY, blocks, ingredients: ING, tasks: [] }).plannedMin, 0);
});

test("completion rate and alignment come from this week's tasks and their links", () => {
  const o = P.addNode([], { type: "objective", title: "First $100k year", year: 2026 }, { now: NOW, today: TODAY, makeId: () => "pn_o" });
  const tasks = [task("a", { completed: true }), task("b"), task("c", { date: "2026-11-06" }), task("d", { date: "2026-12-01" })];
  const links = ["a", "b"].reduce((l, id) => P.setLink(l, id, "pn_o", { nodes: o.nodes, now: NOW }).links, []);
  const model = P.model({ nodes: o.nodes, links, tasks, today: TODAY });
  const st = W.weekStats({ weekStart: MON, today: TODAY, blocks: [], ingredients: ING, tasks, model });
  assert.deepEqual([st.tasksTotal, st.tasksDone, st.completionRate], [3, 1, 33], "d is in December");
  assert.deepEqual([st.linkedTasks, st.alignmentPct], [2, 67]);
  assert.deepEqual(st.byNode.map((n) => [n.title, n.tasks, n.done]), [["First $100k year", 2, 1]]);
  const none = W.weekStats({ weekStart: MON, today: TODAY, blocks: [], ingredients: ING, tasks: [] });
  assert.equal(none.completionRate, null); assert.equal(none.alignmentPct, null);
});

test("a past block counts as done when its task is complete, or when you ticked it", () => {
  const tasks = [task("t1", { date: "2026-11-03", completed: true })];
  let blocks = W.placeTask([], "t1", { date: "2026-11-03", start: "10:00", end: "11:00" }, tasks, ctx()).blocks;
  blocks = block(blocks, { title: "Read", date: "2026-11-03", start: "20:00", end: "21:00" }).blocks;
  blocks = block(blocks, { title: "Admin", date: "2026-11-02", start: "08:00", end: "09:00" }).blocks;
  blocks = W.setBlockDone(blocks, blocks[1].id, "2026-11-03", true, ctx()).blocks;
  const st = W.weekStats({ weekStart: MON, today: TODAY, blocks, ingredients: ING, tasks });
  assert.deepEqual([st.pastBlocks, st.blocksDone], [3, 2]);
  // today's blocks are not "past" until they have ended (when the time is known)
  const later = block([], { date: TODAY, start: "09:00", end: "10:00" }).blocks;
  assert.equal(W.weekStats({ weekStart: MON, today: TODAY, nowMin: 9 * 60 + 30, blocks: later, ingredients: ING, tasks: [] }).pastBlocks, 0);
  assert.equal(W.weekStats({ weekStart: MON, today: TODAY, nowMin: 10 * 60 + 5, blocks: later, ingredients: ING, tasks: [] }).pastBlocks, 1);
});

/* ---------------- free time and suggestions ---------------- */

test("busy time is blocks, calendar events and timed tasks that are not in a block", () => {
  const blocks = block([], { start: "13:00", end: "14:00" }).blocks;
  const tasks = [task("t1", { time: "16:00" }), task("t2", { time: "17:00", completed: true }), task("t3", { time: "18:00" })];
  const t3block = W.placeTask(blocks, "t3", { date: TODAY, start: "18:00", end: "19:00" }, tasks, ctx());
  const busy = W.busyOn(TODAY, { blocks: t3block.blocks, tasks: tasks, events: event({}), zone: "America/New_York" });
  assert.deepEqual(busy.map((b) => [b.kind, b.start, b.end]), [["event", 540, 630], ["block", 780, 840], ["task", 960, 990], ["block", 1080, 1140]],
    "the class, the block, the 4 pm task (30 min); the done task and the task that is in a block are not counted twice");
});

test("free slots fall between the busy stretches and the edges of the day window, on the snap interval", () => {
  const blocks = block([], { start: "09:00", end: "10:30" }).blocks;
  const c = { blocks: blocks, tasks: [], settings: { dayStart: "08:00", dayEnd: "12:00", interval: 30 }, today: TODAY };
  assert.deepEqual(W.freeSlots(TODAY, c, 30, []).map((s) => [W.toTime(s.start), W.toTime(s.end)]), [["08:00", "09:00"], ["10:30", "12:00"]]);
  assert.deepEqual(W.freeSlots(TODAY, c, 90, []).map((s) => [W.toTime(s.start), W.toTime(s.end)]), [["10:30", "12:00"]]);
  // hourly snapping starts a slot on the hour
  const hourly = Object.assign({}, c, { settings: { dayStart: "08:00", dayEnd: "13:00", interval: 60 } });
  assert.deepEqual(W.freeSlots(TODAY, hourly, 60, []).map((s) => [W.toTime(s.start), W.toTime(s.end)]), [["08:00", "09:00"], ["11:00", "13:00"]]);
  // today only has what is left of it
  assert.deepEqual(W.freeSlots(TODAY, Object.assign({}, c, { nowMin: 10 * 60 + 40 }), 30, []).map((s) => [W.toTime(s.start), W.toTime(s.end)]), [["11:00", "12:00"]]);
  // a day with a long event: nothing fits
  assert.deepEqual(W.freeSlots(TODAY, { blocks: [], tasks: [], events: event({ time: "08:00", endTime: "12:00" }), zone: "America/New_York", settings: c.settings, today: TODAY }, 30, []), []);
});

test("suggestions use the first free time around everything else, and never double-book", () => {
  const events = event({ time: "08:00", endTime: "10:00" });
  const tasks = [task("t1", { priority: "high", text: "Order samples" }), task("t2", { priority: "medium", text: "Email supplier" }), task("t3", { priority: "high", text: "Big one" })];
  const links = P.setEstimate(P.setEstimate([], "t1", 90, { now: NOW }).links, "t3", 660, { now: NOW }).links;
  const s = W.suggest({ weekStart: MON, today: TODAY, blocks: [], tasks: tasks, links: links, events: events, zone: "America/New_York", settings: { dayStart: "08:00", dayEnd: "18:00", interval: 30 } });
  const by = {}; s.forEach((x) => { by[x.taskId] = x; });
  assert.deepEqual([by.t1.date, by.t1.start, by.t1.end, by.t1.estimated], [TODAY, "10:00", "11:30", true], "after the class, for the 90 minutes you estimated");
  assert.match(by.t1.reason, /after “Class”/);
  assert.deepEqual([by.t2.start, by.t2.end, by.t2.estimated], ["11:30", "12:30", false], "no estimate: an hour, right after the first");
  assert.match(by.t2.reason, /No estimate/);
  assert.equal(by.t3.none, true, "eleven hours fit in no ten-hour day");
  assert.match(by.t3.reason, /No free 660 min/);
  assert.deepEqual(s.map((x) => x.taskId), ["t1", "t3", "t2"], "high priority first");
  // a task already in a block, a done task and one dated before today are left out
  const blocks = W.placeTask([], "t1", { date: TODAY, start: "10:00", end: "11:00" }, tasks, ctx()).blocks;
  const s2 = W.suggest({ weekStart: MON, today: TODAY, blocks: blocks, tasks: tasks.concat([task("t4", { completed: true }), task("t5", { date: "2026-11-03" })]), links: [], events: [], settings: { dayStart: "08:00", dayEnd: "18:00", interval: 30 } });
  assert.deepEqual(s2.map((x) => x.taskId).sort(), ["t2", "t3"]);
});

test("suggestions never start before the task's own day", () => {
  const tasks = [task("t1", { date: "2026-11-06" })];
  const s = W.suggest({ weekStart: MON, today: TODAY, blocks: [], tasks: tasks, links: [], settings: { dayStart: "08:00", dayEnd: "18:00", interval: 30 } });
  assert.equal(s[0].date, "2026-11-06");
});

/* ---------------- alerts ---------------- */

test("unscheduled high-priority tasks: open, this week, no block, no time", () => {
  const tasks = [task("a", { priority: "high" }), task("b", { priority: "high", time: "10:00" }), task("c", { priority: "medium" }), task("d", { priority: "high", completed: true }), task("e", { priority: "high", date: "2026-11-03" }), task("f", { priority: "high", date: "2026-11-06" }), task("g", { priority: "high", date: "2026-11-20" })];
  const blocks = W.placeTask([], "f", { date: "2026-11-06", start: "09:00", end: "10:00" }, tasks, ctx()).blocks;
  assert.deepEqual(W.unscheduledHigh({ weekStart: MON, today: TODAY, tasks: tasks, blocks: [] }).map((t) => t.id), ["a", "f"]);
  assert.deepEqual(W.unscheduledHigh({ weekStart: MON, today: TODAY, tasks: tasks, blocks: blocks }).map((t) => t.id), ["a"]);
});

test("capacity: too many hours in a day, overlapping blocks, a block that runs into an event, and estimates that don't fit", () => {
  let blocks = block([], { title: "A", date: TODAY, start: "06:00", end: "12:00", ingredientId: "ing_gratiel" }).blocks;
  blocks = block(blocks, { title: "B", date: TODAY, start: "11:00", end: "18:00", ingredientId: "ing_school" }).blocks;
  blocks = block(blocks, { title: "Sleep in", date: "2026-11-05", start: "06:00", end: "20:00", ingredientId: "ing_rest" }).blocks;
  const cap = W.capacity({ weekStart: MON, today: TODAY, blocks: blocks, ingredients: ING, tasks: [], links: [], events: event({ time: "17:00", endTime: "19:00" }), zone: "America/New_York", settings: { dailyLimitHours: 10, dayStart: "06:00", dayEnd: "22:00" } });
  const kinds = cap.warnings.map((w) => w.kind + ":" + w.date);
  assert.ok(kinds.includes("overbooked:" + TODAY), "6 h + 7 h + 2 h of events is over 10 h: " + kinds);
  assert.ok(kinds.includes("overlap:" + TODAY), "A and B overlap");
  assert.ok(kinds.includes("clash:" + TODAY), "B runs into the 5 pm event");
  assert.ok(!kinds.includes("overbooked:2026-11-05"), "a 14 h Rest block is rest, not workload");
  assert.equal(cap.perDay["2026-11-05"], 0);
  assert.match(cap.warnings.find((w) => w.kind === "overbooked").message, /Wednesday/);
});

test("capacity estimates warning appears only when the free time is really short", () => {
  const tasks = [task("t1", { date: "2026-11-08" })];
  const links = P.setEstimate([], "t1", 600, { now: NOW }).links;
  // Sunday is the only day left (today = Sunday); a 10 h day window with 9 h taken
  const blocks = block([], { date: "2026-11-08", start: "08:00", end: "17:00" }).blocks;
  const cap = W.capacity({ weekStart: MON, today: "2026-11-08", blocks: blocks, ingredients: ING, tasks: tasks, links: links, events: [], settings: { dayStart: "08:00", dayEnd: "18:00", dailyLimitHours: 12 } });
  assert.deepEqual(cap.warnings.map((w) => w.kind), ["estimates"]);
  assert.match(cap.warnings[0].message, /10 h, but only 1 h/);
  const enough = W.capacity({ weekStart: MON, today: "2026-11-08", blocks: [], ingredients: ING, tasks: tasks, links: links, events: [], settings: { dayStart: "08:00", dayEnd: "20:00" } });
  assert.deepEqual(enough.warnings, []);
});

/* ---------------- top three ---------------- */

test("the top three: priority, being carried over, and counting toward something that is behind", () => {
  const o = P.addNode([], { type: "objective", title: "First $100k year", year: 2026, due: "2026-11-05" }, { now: NOW, today: TODAY, makeId: () => "pn_o" });
  const tasks = [
    task("low", { priority: "low" }), task("med", { priority: "medium" }), task("hi", { priority: "high" }),
    task("old", { priority: "medium", date: "2026-10-30" }), task("goal", { priority: "low", text: "Call the printer" }),
    task("done", { priority: "high", completed: true }), task("later", { priority: "high", date: "2026-11-20" })
  ];
  const links = P.setLink([], "goal", "pn_o", { nodes: o.nodes, now: NOW }).links;
  const model = P.model({ nodes: o.nodes, links, tasks, today: TODAY });
  const top = W.topThree({ weekStart: MON, today: TODAY, tasks: tasks, model: model });
  assert.equal(top.length, 3);
  assert.deepEqual(top.map((x) => x.task.id), ["goal", "hi", "old"], "the low task that moves a plan item that is behind outranks a plain high one; the carried-over one next");
  assert.ok(top[0].reasons.some((r) => /Counts toward “First \$100k year”/.test(r)));
  assert.ok(top[0].reasons.some((r) => /which is (behind|overdue|at risk)/.test(r)), top[0].reasons.join("|"));
  assert.ok(top[2].reasons.some((r) => /Carried over/.test(r)));
  assert.ok(!top.some((x) => x.task.id === "done" || x.task.id === "later"), "done and next-month tasks are not suggested");
  assert.deepEqual(W.topThree({ weekStart: MON, today: TODAY, tasks: [], model: model }), []);
});

/* ---------------- carry forward ---------------- */

test("carry forward: unfinished tasks from days gone by, moved only when asked, as unscheduled tasks at the end of the day", () => {
  const tasks = [task("a", { date: "2026-11-02", time: "09:00", order: 3 }), task("b", { date: "2026-11-03" }), task("c", { date: "2026-11-02", completed: true }), task("d", { date: TODAY }), task("e", { date: "2026-10-01" }), task("x", { date: "2026-11-05", order: 7 })];
  const list = W.carryForward({ weekStart: MON, today: TODAY, tasks: tasks });
  assert.deepEqual(list.map((t) => t.id), ["a", "b"], "not done, before today, within the last week: not today's, not done, not a month ago");
  assert.equal(W.carryTarget({ weekStart: MON, today: TODAY }), TODAY, "mid-week: carry to today");
  assert.equal(W.carryTarget({ weekStart: MON, today: "2026-11-08" }), "2026-11-09", "on the last day: carry to next Monday");
  assert.equal(W.carryTarget({ weekStart: MON, today: "2026-11-10" }), "2026-11-09", "a later week: the Monday after the week shown");
  const moved = W.carryTasks(tasks, ["a", "b"], "2026-11-05");
  assert.deepEqual(moved.filter((t) => ["a", "b"].includes(t.id)).map((t) => [t.id, t.date, t.time, t.order]), [["a", "2026-11-05", "", 8], ["b", "2026-11-05", "", 9]]);
  assert.equal(moved.find((t) => t.id === "x").order, 7, "tasks already on that day keep their place");
  assert.deepEqual(moved.find((t) => t.id === "d"), tasks.find((t) => t.id === "d"), "the rest is untouched");
  assert.equal(moved.find((t) => t.id === "c").date, "2026-11-02", "a done task is never moved");
  assert.equal(tasks.find((t) => t.id === "a").date, "2026-11-02", "the original list is not changed");
});

/* ---------------- the week's own record ---------------- */

test("the weekly record keeps up to three top tasks and the review text, only on a Monday", () => {
  assert.equal(W.setWeek([], "2026-11-04", {}, ctx()).ok, false);
  let r = W.setWeek([], MON, { top: [{ taskId: "t1" }, { text: "Call the printer" }, { taskId: "t3" }, { taskId: "t4" }] }, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.week.top, [{ taskId: "t1", text: "" }, { taskId: "", text: "Call the printer" }, { taskId: "t3", text: "" }], "only three");
  assert.equal(r.week.id, "wk_" + MON);
  r = W.setWeek(r.weeks, MON, { wins: "Shipped the drop", lessons: "Plan less", nextFocus: "Photos" }, ctx({ now: NOW + 9 }));
  assert.equal(r.weeks.length, 1, "the same record");
  assert.deepEqual([r.week.wins, r.week.lessons, r.week.nextFocus, r.week.top.length, r.week.updatedAt, r.week.createdAt], ["Shipped the drop", "Plan less", "Photos", 3, NOW + 9, NOW], "the top three are kept when only the text changes");
  r = W.setWeek(r.weeks, MON, { reviewedAt: NOW + 20 }, ctx());
  assert.equal(r.week.reviewedAt, NOW + 20);
  assert.equal(W.weekOf(r.weeks, MON).wins, "Shipped the drop");
  assert.equal(W.weekOf(r.weeks, "2026-11-09"), null);
});

test("readers keep what they can't understand aside, and clean what they can", () => {
  const b = W.readers.blocks([{ id: "pb1", title: "x", date: TODAY, start: "09:00", end: "10:00", repeat: { freq: "monthly" }, exceptions: ["junk", "2026-11-05"] }, { id: "pb2", title: "bad", date: "nope", start: "09:00", end: "10:00" }, "junk"]);
  assert.equal(b.items.length, 1); assert.equal(b.kept.length, 2);
  assert.equal(b.items[0].repeat, null); assert.deepEqual(b.items[0].exceptions, ["2026-11-05"]);
  const i = W.readers.ingredients([{ id: "ing_a", name: "A", color: "red" }, { name: "no id" }]);
  assert.equal(i.items[0].color, "#94a3b8"); assert.equal(i.kept.length, 1);
});

test("a task moved elsewhere takes its block with it; a deleted task lets its block go on; a task that only lost its time changes nothing", () => {
  const tasks = [task("t1", { date: TODAY })];
  const placed = W.placeTask([], "t1", { date: TODAY, start: "10:00", end: "11:30" }, tasks, ctx());
  const blocks = placed.blocks;
  // unchanged: the same list comes back (so nothing is saved needlessly)
  assert.equal(W.followTasks(blocks, [Object.assign({}, tasks[0], { time: "10:00" })], ctx()), blocks);
  assert.equal(W.followTasks(blocks, [Object.assign({}, tasks[0], { time: "" })], ctx()), blocks, "no time on the task: the block's time stands");
  // moved to Friday at 14:00 in Habits: the block follows and keeps its 90 minutes
  const f = W.followTasks(blocks, [Object.assign({}, tasks[0], { date: "2026-11-06", time: "14:00" })], ctx());
  assert.deepEqual(W.occurrences(f, MON, "2026-11-08").map((o) => [o.date, o.start, o.end]), [["2026-11-06", "14:00", "15:30"]]);
  // a late time can't push the block past midnight
  const late = W.followTasks(blocks, [Object.assign({}, tasks[0], { time: "23:30" })], ctx());
  assert.equal(W.occurrences(late, TODAY, TODAY)[0].end, "23:59");
  // deleted task
  const gone = W.followTasks(blocks, [], ctx());
  assert.equal(W.liveBlocks(gone)[0].taskId, "");
  assert.equal(W.liveBlocks(gone)[0].title, "Task t1");
});

test("letting a block go keeps the block and says where the task was", () => {
  const tasks = [task("t1", { date: "2026-11-05", time: "08:00" })];
  const placed = W.placeTask([], "t1", { date: TODAY, start: "10:00", end: "11:00" }, tasks, ctx());
  const r = W.releaseTask(placed.blocks, placed.block.id, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.taskPatch, { date: "2026-11-05", time: "08:00" });
  assert.equal(W.liveBlocks(r.blocks).length, 1); assert.equal(W.liveBlocks(r.blocks)[0].taskId, "");
  assert.equal(W.releaseTask(r.blocks, placed.block.id, ctx()).ok, false, "nothing to release the second time");
});

test("putting a task into an existing block; a task that was in another block leaves it behind as a plain block", () => {
  const tasks = [task("t1", { date: "2026-11-05", time: "08:00", text: "Order samples" })];
  let blocks = block([], { title: "Gratiel work", date: TODAY, start: "10:00", end: "12:00" }).blocks;
  const id = blocks[0].id;
  let r = W.assignTask(blocks, id, "t1", tasks, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.taskPatch, { date: TODAY, time: "10:00" });
  assert.equal(r.block.taskId, "t1"); assert.equal(r.block.title, "Order samples");
  assert.deepEqual(r.block.was, { date: "2026-11-05", time: "08:00" });
  // the task is in another block: that block stays (plain), this one takes the task, and where the task first was is kept
  const second = block(r.blocks, { title: "Evening", date: "2026-11-06", start: "19:00", end: "20:00" });
  const id2 = second.block.id;
  const moved = W.assignTask(second.blocks, id2, "t1", tasks, ctx());
  assert.equal(moved.releasedFrom.id, id);
  assert.equal(W.blockOfTask(moved.blocks, "t1").id, id2);
  assert.equal(W.liveBlocks(moved.blocks).length, 2, "nothing deleted");
  assert.deepEqual(moved.block.was, { date: "2026-11-05", time: "08:00" });
  assert.equal(W.assignTask(blocks, id, "ghost", tasks, ctx()).ok, false);
  const rep = W.addBlock([], { title: "Workout", date: TODAY, start: "06:00", end: "07:00", repeatFreq: "weekly" }, ctx()).blocks;
  assert.match(W.assignTask(rep, rep[0].id, "t1", tasks, ctx()).error, /repeats/);
});
