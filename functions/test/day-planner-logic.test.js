"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../js/day-planner-logic");

const DAY = "2026-11-04";
const NOW = Date.parse("2026-11-04T15:00:00Z");
const ctx = (now) => ({ now: now || NOW });
const apply = (records, date, change, now) => { const r = D.update(records, date, change, ctx(now)); assert.equal(r.ok, true, JSON.stringify(change) + " -> " + r.error); return r.records; };
const W = { start: 360, end: 1320 };          // 6:00 - 22:00
const ev = (o) => Object.assign({ key: "e" + Math.random(), source: "event", title: "Event", allDay: false, date: DAY, endDate: DAY, startMin: 540, endMin: 600, point: false, completed: false }, o);
const task = (o) => Object.assign({ key: "t" + Math.random(), source: "task", title: "Task", allDay: false, date: DAY, endDate: DAY, startMin: 720, endMin: 720, point: true, completed: false }, o);

test("a day's record holds exactly three top slots, notes and a reflection, and keeps what else is on it", () => {
  const empty = D.read(null);
  assert.equal(empty.top.length, 3);
  assert.deepEqual(empty.top[0], { taskId: "", text: "" });
  let r = apply([], DAY, { type: "top", index: 1, taskId: "t1", text: "  Finish   the lookbook " });
  r = apply(r, DAY, { type: "notes", text: "Call the printer\nafter lunch" });
  r = apply(r, DAY, { type: "reflection", text: "Good focus" });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "pd_" + DAY);
  const v = D.view(r, DAY);
  assert.equal(v.saved, true);
  assert.deepEqual(v.top[1], { taskId: "t1", text: "Finish the lookbook" });
  assert.equal(v.notes, "Call the printer\nafter lunch");
  assert.equal(v.reflection, "Good focus");
  r = r.map((x) => Object.assign({}, x, { fromTheFuture: 1 }));
  r = apply(r, DAY, { type: "notes", text: "x" });
  assert.equal(r[0].fromTheFuture, 1, "fields this version does not know are kept");
  assert.equal(r[0].createdAt, NOW);
  assert.equal(D.view([], DAY).saved, false, "a day with no record shows empty and saves nothing");
});

test("one task can fill only one slot; a slot clears with empty words; bad input is refused", () => {
  let r = apply([], DAY, { type: "top", index: 0, taskId: "t1", text: "A" });
  const dup = D.update(r, DAY, { type: "top", index: 2, taskId: "t1", text: "A" }, ctx());
  assert.equal(dup.ok, false);
  assert.match(dup.error, /already/);
  assert.equal(dup.records, r);
  r = apply(r, DAY, { type: "top", index: 0, taskId: "", text: "" });
  assert.deepEqual(D.view(r, DAY).top[0], { taskId: "", text: "" });
  assert.equal(D.update(r, DAY, { type: "top", index: 3, taskId: "", text: "x" }, ctx()).ok, false);
  assert.equal(D.update(r, "nope", { type: "notes", text: "x" }, ctx()).ok, false);
  assert.equal(D.update(r, DAY, { type: "other" }, ctx()).ok, false);
  assert.equal(D.update(null, DAY, { type: "notes", text: "x" }, ctx()).records.length, 1);
});

test("the top three follow the tasks: ticking a task ticks its slot, a deleted task keeps its words", () => {
  const r = apply(apply([], DAY, { type: "top", index: 0, taskId: "a", text: "old words" }), DAY, { type: "top", index: 1, taskId: "gone", text: "Was a task" });
  const items = D.topItems(D.view(r, DAY), [{ id: "a", text: "Renamed in the To-Do list", completed: true }]);
  assert.deepEqual([items[0].text, items[0].done, items[0].linked], ["Renamed in the To-Do list", true, true]);
  assert.deepEqual([items[1].text, items[1].done, items[1].linked], ["Was a task", false, false]);
  assert.equal(items[2].empty, true);
});

test("deleted records are ignored and a change brings a record back", () => {
  const r = apply([], DAY, { type: "notes", text: "hi" });
  const gone = r.map((x) => Object.assign({}, x, { deletedAt: 9 }));
  assert.equal(D.view(gone, DAY).saved, false);
  const back = apply(gone, DAY, { type: "notes", text: "again" });
  assert.equal(back.length, 1);
  assert.equal(back[0].deletedAt, undefined);
  assert.doesNotThrow(() => D.view([null, 3, "x", { id: "pd_x", date: "no" }].concat(r), DAY));
});

test("tasks still to schedule: dated that day, no time, open first", () => {
  const tasks = [
    { id: "1", date: DAY, text: "done one", completed: true, order: 0 }, { id: "2", date: DAY, text: "open b", order: 2 }, { id: "3", date: DAY, text: "open a", order: 1 },
    { id: "4", date: DAY, text: "timed", time: "09:00", order: 0 }, { id: "5", date: "2026-11-05", text: "tomorrow", order: 0 }
  ];
  assert.deepEqual(D.unscheduled(tasks, DAY).map((t) => t.id), ["3", "2", "1"]);
  assert.deepEqual(D.unscheduled(null, DAY), []);
});

test("the timeline puts items in time order with the free stretches between them", () => {
  const t = D.timeline({ date: DAY, window: W, items: [ev({ title: "Standup", startMin: 570, endMin: 600 }), ev({ title: "Deep work", source: "plan", startMin: 660, endMin: 780 })] });
  assert.deepEqual(t.rows.map((r) => r.type === "free" ? "free " + r.start + "-" + r.end : r.item.title), ["free 360-570", "Standup", "free 600-660", "Deep work", "free 780-1320"]);
  assert.equal(t.busyMin, 30 + 120);
  assert.equal(t.freeMin, 960 - 150);
  assert.deepEqual(t.nextFree, { start: 360, end: 570, minutes: 210 });
  // overlapping items are counted once
  const o = D.timeline({ date: DAY, window: W, items: [ev({ startMin: 600, endMin: 720 }), ev({ startMin: 660, endMin: 780 })] });
  assert.equal(o.busyMin, 180);
  assert.deepEqual(o.rows.filter((r) => r.type === "free").map((r) => [r.start, r.end]), [[360, 600], [780, 1320]]);
});

test("a task with a time but no block takes 30 minutes; a ticked one, a reminder and an all-day item take none", () => {
  const t = D.timeline({ date: DAY, window: W, items: [task({ startMin: 600, endMin: 600 }), task({ startMin: 900, endMin: 900, completed: true }), task({ source: "event", startMin: 1000, endMin: 1000 }), ev({ allDay: true, startMin: null, endMin: null, title: "Launch day" })] });
  assert.equal(t.busyMin, 30);
  assert.equal(t.allDay.length, 1);
  const rows = t.rows.map((r) => r.type === "free" ? "free " + r.start + "-" + r.end : "item " + r.start);
  assert.deepEqual(rows, ["free 360-600", "item 600", "free 630-900", "item 900", "free 900-1000", "item 1000", "free 1000-1320"]);
});

test("free stretches under 15 minutes are not shown, and items outside the window are still listed", () => {
  const t = D.timeline({ date: DAY, window: W, items: [ev({ title: "Early", startMin: 300, endMin: 400 }), ev({ title: "A", startMin: 410, endMin: 500 }), ev({ title: "B", startMin: 510, endMin: 600 })] });
  assert.deepEqual(t.rows.map((r) => r.type === "free" ? "free" : r.item.title), ["Early", "A", "B", "free"], "gaps of 10 minutes are left out, the early item is listed");
  const none = D.timeline({ date: DAY, window: W, items: [] });
  assert.deepEqual(none.rows, [{ type: "free", start: 360, end: 1320, minutes: 960 }]);
  assert.equal(none.freeMin, 960);
});

test("today: free time starts from now, and what is left is what is counted", () => {
  const t = D.timeline({ date: DAY, today: DAY, nowMin: 620, window: W, items: [ev({ title: "Past", startMin: 540, endMin: 600 }), ev({ title: "Later", startMin: 780, endMin: 840 })] });
  assert.deepEqual(t.rows.map((r) => r.type === "free" ? "free " + r.start + "-" + r.end : r.item.title), ["Past", "free 620-780", "Later", "free 840-1320"], "the past hours are not offered as free time");
  assert.equal(t.freeMin, 160 + 480);
  assert.deepEqual(t.nextFree, { start: 620, end: 780, minutes: 160 });
  const other = D.timeline({ date: DAY, today: "2026-11-05", nowMin: 620, window: W, items: [] });
  assert.equal(other.freeMin, 960, "another day is not affected by the time now");
});

test("a multi-day event is a whole-day stretch on its middle days, and an item for another day is ignored", () => {
  const span = ev({ title: "Trip", date: "2026-11-03", endDate: "2026-11-05", startMin: 1200, endMin: 480, allDay: false });
  const mid = D.timeline({ date: DAY, window: W, items: [span] });
  assert.equal(mid.busyMin, 960, "all of the window");
  const first = D.timeline({ date: "2026-11-03", window: W, items: [span] });
  assert.equal(first.busyMin, 1320 - 1200);
  const other = D.timeline({ date: DAY, window: W, items: [ev({ date: "2026-11-06", endDate: "2026-11-06" })] });
  assert.equal(other.rows.length, 1);
});

test("where a task fits: the first free stretches that are long enough", () => {
  const t = D.timeline({ date: DAY, window: W, items: [ev({ startMin: 420, endMin: 1260 })] });
  assert.deepEqual(D.fits(t.rows, 45, 3), [{ start: 360, end: 405 }, { start: 1260, end: 1305 }]);
  assert.deepEqual(D.fits(t.rows, 90, 3), [], "nothing long enough is not suggested");
  assert.equal(D.hm(90), "1 h 30 min");
  assert.equal(D.hm(45), "45 min");
  assert.equal(D.hm(120), "2 h");
});
