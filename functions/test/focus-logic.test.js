"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../js/focus-logic");

const T0 = new Date("2026-11-18T10:00:00").getTime();
const MIN = 60000;
const begin = (o) => F.start(o || { title: "Research manufacturers", plannedMin: 25, taskId: "t1" }, T0, () => "fs1").active;

test("a session is made from what you chose; a bad length is refused, none means open-ended", () => {
  const a = begin();
  assert.deepEqual([a.id, a.kind, a.title, a.plannedMin, a.taskId, a.startedAt, a.pausedMs, a.pausedAt], ["fs1", "focus", "Research manufacturers", 25, "t1", T0, 0, null]);
  assert.equal(F.start({ title: "x", plannedMin: 0 }, T0).active.plannedMin, 0);
  assert.equal(F.start({ title: "x" }, T0).active.plannedMin, 0);
  assert.equal(F.start({ title: "x", plannedMin: 9999 }, T0).ok, false);
  assert.equal(F.start({ title: "x", plannedMin: "abc" }, T0).ok, false);
  assert.equal(F.start({ title: "x", plannedMin: 1.4 }, T0).active.plannedMin, 1);
  assert.equal(F.start({ title: "  " }, T0).active.title, "Focus");
  assert.equal(F.minutesFrom("90"), 90);
  assert.equal(F.minutesFrom("0"), 0);
});

test("worked time is from timestamps: paused time is never counted, and survives a refresh", () => {
  let a = begin();
  assert.equal(F.elapsedMs(a, T0 + 10 * MIN), 10 * MIN);
  a = F.pause(a, T0 + 10 * MIN);
  assert.equal(F.isPaused(a), true);
  assert.equal(F.elapsedMs(a, T0 + 40 * MIN), 10 * MIN, "30 minutes paused: still 10 worked");
  a = F.resume(a, T0 + 40 * MIN);
  assert.equal(F.elapsedMs(a, T0 + 45 * MIN), 15 * MIN, "5 more after resuming");
  // the same session read back from storage after a refresh
  const back = F.readActive(JSON.parse(JSON.stringify(a)));
  assert.equal(F.elapsedMs(back, T0 + 45 * MIN), 15 * MIN);
  // pausing twice or resuming a running session changes nothing
  assert.equal(F.pause(F.pause(begin(), T0 + MIN), T0 + 9 * MIN).pausedAt, T0 + MIN);
  assert.equal(F.resume(begin(), T0 + MIN).pausedMs, 0);
});

test("a planned length is up when the worked time reaches it, not the wall clock", () => {
  let a = begin();
  assert.equal(F.remainingMs(a, T0 + 5 * MIN), 20 * MIN);
  assert.equal(F.isUp(a, T0 + 24 * MIN), false);
  assert.equal(F.isUp(a, T0 + 25 * MIN), true);
  a = F.pause(a, T0 + 20 * MIN);
  assert.equal(F.isUp(a, T0 + 120 * MIN), false, "an hour paused does not use the time up");
  assert.equal(F.remainingMs(F.start({ title: "open" }, T0).active, T0 + MIN), null, "an open session has no end");
  const more = F.extend(begin(), 5);
  assert.equal(more.plannedMin, 30);
  assert.equal(F.extend(F.start({ title: "open" }, T0).active, 5).plannedMin, 0);
});

test("finishing records the day it started, the exact worked time, and nothing for breaks or instant stops", () => {
  let a = begin();
  a = F.pause(a, T0 + 10 * MIN); a = F.resume(a, T0 + 20 * MIN);
  const r = F.finish(a, T0 + 30 * MIN);
  assert.deepEqual([r.id, r.date, r.focusMs, r.plannedMin, r.taskId, r.kind], ["fs1", "2026-11-18", 20 * MIN, 25, "t1", "focus"], "10 worked, 10 paused, 10 worked");
  assert.equal(F.finish(F.start({ title: "break", kind: "break", plannedMin: 5 }, T0).active, T0 + 5 * MIN), null, "a break is never work");
  assert.equal(F.finish(begin(), T0 + 500), null, "under a second is nothing");
  // a session that began just before midnight belongs to the day it started
  const late = F.start({ title: "late", plannedMin: 25 }, new Date("2026-11-18T23:50:00").getTime(), () => "x").active;
  assert.equal(F.finish(late, new Date("2026-11-19T00:20:00").getTime()).date, "2026-11-18");
});

test("records: one per session, valid ones only, totals rounded once", () => {
  const r1 = F.finish(begin(), T0 + 25 * MIN), r2 = Object.assign({}, F.finish(begin({ title: "b", plannedMin: 15, taskId: "t2" }), T0 + 10 * MIN), { id: "fs2" });
  let list = F.add([], r1);
  list = F.add(list, r1);
  assert.equal(list.length, 1, "the same session twice is one record");
  list = F.add(list, r2);
  assert.equal(F.totals(list, "2026-11-18", "2026-11-18").minutes, 35);
  assert.deepEqual(F.totals(list, "2026-11-18", "2026-11-18").byTask, { t1: 25, t2: 10 });
  assert.equal(F.totals(list, "2026-11-19", "2026-11-30").sessions, 0);
  assert.equal(F.live([{ id: "x" }, null, { id: "y", date: "bad", focusMs: 99999 }, Object.assign({}, r1, { deletedAt: 5 })]).length, 0);
  // 100 s and 100 s are 3.33 minutes: rounded once, to 3
  const a = Object.assign({}, r1, { id: "a", focusMs: 100000 }), b = Object.assign({}, r1, { id: "b", focusMs: 100000 });
  assert.equal(F.totals([a, b], "2026-11-18", "2026-11-18").minutes, 3);
});

test("readActive cleans what storage gives back", () => {
  assert.equal(F.readActive(null), null);
  assert.equal(F.readActive({ id: "", startedAt: 5 }), null);
  assert.equal(F.readActive({ id: "a", startedAt: 0 }), null);
  const a = F.readActive({ id: "a", startedAt: T0, pausedMs: -5, pausedAt: T0 - 1000, plannedMin: 99999, kind: "weird", title: "  t  " });
  assert.deepEqual([a.pausedMs, a.pausedAt, a.plannedMin, a.kind, a.title], [0, null, 600, "focus", "t"]);
});

test("the clock reads m:ss and h:mm:ss", () => {
  assert.equal(F.clock(0), "0:00");
  assert.equal(F.clock(65 * 1000), "1:05");
  assert.equal(F.clock(25 * MIN), "25:00");
  assert.equal(F.clock(3725 * 1000), "1:02:05");
  assert.equal(F.clock(-5), "0:00");
});
