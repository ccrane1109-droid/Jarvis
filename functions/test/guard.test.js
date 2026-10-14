"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeGuard } = require("../lib/guard");
const { InsightError } = require("../lib/insight");

class FakeHttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

function setup() {
  const logs = [];
  const guarded = makeGuard({ InsightError, HttpsError: FakeHttpsError, logger: { error: (msg, data) => logs.push({ msg, data }) } });
  return { guarded, logs };
}

test("expected errors keep their code and message and aren't logged as crashes", async () => {
  const { guarded, logs } = setup();
  await assert.rejects(guarded("marketingStatus", async () => { throw new InsightError("permission-denied", "Not allowed."); }),
    (e) => e instanceof FakeHttpsError && e.code === "permission-denied" && e.message === "Not allowed.");
  assert.equal(logs.length, 0);
});

test("unexpected errors return a reference that matches the log entry", async () => {
  const { guarded, logs } = setup();
  let caught;
  await guarded("generateIdeas", async () => { throw new TypeError("boom"); }).catch((e) => { caught = e; });
  assert.equal(caught.code, "internal");
  assert.equal(caught.message, "Unexpected server error.");
  assert.match(caught.details.ref, /^[0-9a-f]{8}$/);
  assert.equal(caught.details.fn, "generateIdeas");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].data.ref, caught.details.ref);
  assert.equal(logs[0].data.fn, "generateIdeas");
  assert.equal(logs[0].data.message, "boom");
});

test("successful results pass through", async () => {
  const { guarded } = setup();
  assert.deepEqual(await guarded("x", async () => ({ ok: true })), { ok: true });
});
