"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../../js/task-kind-logic.js");

const TODAY = "2026-11-04";
const t = (o) => Object.assign({ id: "t1", date: "2026-11-02", text: "x", completed: false }, o);

test("a saved kind is what the task is", () => {
  assert.equal(K.kindOf(t({ kind: "scheduled" })), "scheduled");
  assert.equal(K.kindOf(t({ kind: "deadline" })), "deadline");
  assert.equal(K.isDeadline(t({ kind: "deadline" })), true);
  assert.equal(K.isDeadline(t({ kind: "scheduled" }), { linked: () => true }), false, "a saved kind wins over a Strategy link");
  assert.deepEqual(K.KINDS, ["scheduled", "deadline"]);
});

test("an older task with no kind is a scheduled activity, unless it is tied to a Strategy item", () => {
  assert.equal(K.kindOf(t({})), "scheduled");
  assert.equal(K.kindOf(t({ kind: "junk" })), "scheduled", "an unknown value is read as no kind");
  assert.equal(K.kindOf(t({}), { linked: (id) => id === "t1" }), "deadline");
  assert.equal(K.kindOf(t({ id: "t2" }), { linked: (id) => id === "t1" }), "scheduled");
  assert.equal(K.kindOf(t({}), {}), "scheduled");
  assert.equal(K.kindOf(null), "scheduled");
});

test("Strategy links: only a live link to an item counts", () => {
  const linked = K.linkedTo([{ id: "a", nodeId: "n1" }, { id: "b", nodeId: "" }, { id: "c", nodeId: "n2", deletedAt: 5 }, { id: "d", estMin: 30 }, null, { nodeId: "n3" }]);
  assert.deepEqual(["a", "b", "c", "d", "e"].map(linked), [true, false, false, false, false]);
  assert.equal(K.linkedTo(null)("a"), false);
});

test("overdue: a deadline task, not done, whose day has passed. Nothing else", () => {
  const dl = (o) => t(Object.assign({ kind: "deadline" }, o));
  assert.equal(K.isOverdue(dl({}), TODAY), true);
  assert.equal(K.isOverdue(dl({ date: TODAY }), TODAY), false, "today is not late");
  assert.equal(K.isOverdue(dl({ date: "2026-11-05" }), TODAY), false);
  assert.equal(K.isOverdue(dl({ completed: true }), TODAY), false);
  assert.equal(K.isOverdue(dl({ date: "someday" }), TODAY), false);
  assert.equal(K.isOverdue(dl({ date: "" }), TODAY), false);
  assert.equal(K.isOverdue(t({ kind: "scheduled", date: "2026-01-01" }), TODAY), false, "a scheduled task is never overdue, however old");
  assert.equal(K.isOverdue(t({}), TODAY), false, "an older task with no kind is not overdue");
  assert.equal(K.isOverdue(t({}), TODAY, { linked: () => true }), true, "unless it is tied to Strategy");
  assert.equal(K.isOverdue(null, TODAY), false);
  assert.equal(K.isOverdue(dl({}), ""), false);
});
