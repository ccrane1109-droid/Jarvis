"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../js/plan-routine-logic");

let seq = 0;
const ctx = (o) => Object.assign({ now: 1000, makeId: (p) => p + "_" + (++seq) }, o || {});
const input = (o) => Object.assign({ name: "School morning", kind: "school-morning", startTime: "06:30", steps: [{ title: "Wake up", durationMin: 15 }, { title: "Get ready", durationMin: 20 }, { title: "Breakfast", durationMin: 20, gapMin: 5 }] }, o || {});
const made = (o) => R.add([], input(o), ctx()).routine;

test("a routine needs a name, a start time and at least one step; steps need lengths; it must fit in a day", () => {
  assert.deepEqual(Object.keys(R.add([], input({ name: " " }), ctx()).errors), ["name"]);
  assert.deepEqual(Object.keys(R.add([], input({ startTime: "" }), ctx()).errors), ["startTime"]);
  assert.deepEqual(Object.keys(R.add([], input({ steps: [] }), ctx()).errors), ["steps"]);
  assert.deepEqual(Object.keys(R.add([], input({ steps: [{ title: "x", durationMin: 10 }] }), ctx()).errors), ["steps"], "a step is at least as long as the shortest block (15 minutes)");
  assert.match(R.add([], input({ startTime: "23:30" }), ctx()).errors.steps, /does not fit in one day/);
  const ok = R.add([], input(), ctx());
  assert.equal(ok.ok, true);
  assert.equal(ok.routine.steps.length, 3);
  assert.equal(ok.routine.steps[2].gapMin, 5);
  assert.equal(ok.routine.paused, false);
  assert.deepEqual(ok.routine.applied, []);
});

test("blank steps are dropped; unknown kinds become custom; the routine is never changed by a failed edit", () => {
  const r = made({ kind: "weird", steps: [{ title: "A", durationMin: 15 }, { title: "  ", durationMin: 15 }] });
  assert.equal(r.kind, "custom");
  assert.equal(r.steps.length, 1);
  const list = [r];
  const bad = R.edit(list, r.id, input({ name: "" }), ctx());
  assert.equal(bad.ok, false);
  assert.equal(bad.list, list);
  const good = R.edit(list, r.id, input({ name: "Mornings" }), ctx({ now: 5000 }));
  assert.equal(good.routine.name, "Mornings");
  assert.equal(good.routine.updatedAt, 5000);
  assert.equal(good.routine.id, r.id);
});

test("layout: steps run one after another, with their gaps, from the start time", () => {
  const r = made();
  const l = R.layout(r, "06:30");
  assert.equal(l.ok, true);
  assert.deepEqual(l.steps.map((s) => [s.title, s.start, s.end]), [["Wake up", "06:30", "06:45"], ["Get ready", "06:45", "07:05"], ["Breakfast", "07:10", "07:30"]]);
  assert.equal(l.endTime, "07:30");
  assert.equal(R.layout(r, "23:50").ok, false, "it must fit in the day");
  assert.equal(R.summary(r), "3 steps · 1 h");
});

test("apply: blocks for each step on each day; a step already planned is skipped; a habit's step makes no block; past days are not touched", () => {
  const r = made({ steps: [{ title: "Wake up", durationMin: 15 }, { title: "Cold shower", durationMin: 15, habitId: "h1" }, { title: "Breakfast", durationMin: 20 }] });
  const existing = [{ date: "2026-11-19", title: "wake  UP", start: "06:30" }];
  const p = R.planApply(r, ["2026-11-17", "2026-11-18", "2026-11-19"], "06:30", existing, { h1: "Cold shower" }, "2026-11-18");
  assert.equal(p.ok, true);
  assert.deepEqual(p.add.map((a) => a.date + " " + a.title + " " + a.start), ["2026-11-18 Wake up 06:30", "2026-11-18 Breakfast 07:00", "2026-11-19 Breakfast 07:00"]);
  assert.deepEqual(p.skipped.map((s) => s.date + " " + (s.title || "-") + ": " + s.reason), ["2026-11-17 -: That day has passed.", "2026-11-19 Wake up: Already planned at 06:30."]);
  assert.deepEqual(p.habitSteps, [{ title: "Cold shower", habitName: "Cold shower" }], "the habit keeps its own time; nothing is duplicated");
  assert.deepEqual(R.planApply(R.setPaused([r], r.id, true, ctx()).list[0], ["2026-11-18"], "06:30", [], {}, "2026-11-18").add, [], "a paused routine is not applied");
  assert.equal(R.planApply(Object.assign({}, r, { paused: true }), ["2026-11-18"], "06:30", [], {}, "2026-11-18").ok, false);
});

test("datesFor: the days from a date with the chosen weekdays, never before it", () => {
  // 2026-11-18 is a Wednesday (3)
  assert.deepEqual(R.datesFor("2026-11-18", 7, [1, 3, 5]), ["2026-11-18", "2026-11-20", "2026-11-23"]);
  assert.deepEqual(R.datesFor("2026-11-18", 7, []), []);
  assert.deepEqual(R.datesFor("nope", 7, [1]), []);
});

test("applied blocks are remembered, only future ones are listed, and forgetting removes just those", () => {
  let list = [made()];
  const id = list[0].id;
  list = R.recordApplied(list, id, [{ date: "2026-11-10", blockId: "b1", stepId: "s1" }, { date: "2026-11-19", blockId: "b2", stepId: "s1" }, { date: "2026-11-20", blockId: "b3", stepId: "s2" }], ctx()).list;
  assert.deepEqual(R.futureApplied(list[0], "2026-11-18").map((a) => a.blockId), ["b2", "b3"], "the past day is never in the list");
  list = R.forgetApplied(list, id, ["b2"], ctx()).list;
  assert.deepEqual(list[0].applied.map((a) => a.blockId), ["b1", "b3"]);
});

test("duplicate, pause and delete keep the rest as they were; delete leaves a marker so it syncs", () => {
  const a = made();
  let list = [a];
  const dup = R.duplicate(list, a.id, ctx());
  assert.equal(dup.routine.name, "School morning copy");
  assert.notEqual(dup.routine.id, a.id);
  assert.notEqual(dup.routine.steps[0].id, a.steps[0].id, "new steps have their own ids");
  list = dup.list;
  list = R.setPaused(list, a.id, true, ctx()).list;
  assert.equal(R.byId(list, a.id).paused, true);
  list = R.remove(list, a.id, ctx({ now: 9000 })).list;
  assert.equal(R.byId(list, a.id), null);
  assert.equal(list.find((r) => r.id === a.id).deletedAt, 9000);
  assert.equal(R.live(list).length, 1);
});

test("starters make valid routines; damaged stored data is cleaned, not trusted", () => {
  R.STARTERS.forEach((s, i) => { const r = R.add([], R.fromStarter(i), ctx()); assert.equal(r.ok, true, s.name + " " + JSON.stringify(r.errors)); });
  assert.equal(R.fromStarter(99), null);
  const dirty = R.clean([{ id: "x", name: "Ok", kind: "evening", startTime: "bad", steps: [{ title: "A", durationMin: 9999 }, null, { title: "" }], applied: [{ date: "nope", blockId: "b" }, { date: "2026-11-20", blockId: "b9" }] }, { name: "no id" }, null, { id: "x", name: "dupe" }], ctx());
  assert.equal(dirty.length, 1);
  assert.equal(dirty[0].startTime, "07:00");
  assert.equal(dirty[0].steps.length, 1);
  assert.equal(dirty[0].steps[0].durationMin, 15, "an impossible length falls back instead of being trusted");
  assert.deepEqual(dirty[0].applied, [{ date: "2026-11-20", blockId: "b9", stepId: "" }]);
});
