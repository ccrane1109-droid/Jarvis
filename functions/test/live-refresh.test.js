"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../js/live-refresh");

const base = { visible: true, editing: false, dialogOpen: false, sinceRefreshMs: 600000, sinceReturnMs: 60000, interactedSinceReturn: true, idleMs: 0 };
const d = (o) => R.decide(Object.assign({}, base, o));

test("never refresh while the app is not on screen: wait until it is", () => {
  assert.equal(d({ visible: false, idleMs: 99999 }), "wait");
});

test("never refresh while a form is open or you are typing: ask instead", () => {
  assert.equal(d({ editing: true, idleMs: 99999 }), "ask");
  assert.equal(d({ dialogOpen: true, idleMs: 99999 }), "ask");
  assert.equal(d({ editing: true, dialogOpen: true, sinceReturnMs: 100, interactedSinceReturn: false }), "ask", "not even right after coming back");
});

test("right after coming back, before touching anything, refresh at once", () => {
  assert.equal(d({ sinceReturnMs: 800, interactedSinceReturn: false, idleMs: 800 }), "reload");
  assert.equal(d({ sinceReturnMs: R.RETURN_MS, interactedSinceReturn: false, idleMs: 100 }), "reload");
  assert.equal(d({ sinceReturnMs: R.RETURN_MS + 1, interactedSinceReturn: false, idleMs: 100 }), "soon", "a moment later it waits for idle like any other time");
});

test("while using the app, wait for a few quiet seconds", () => {
  assert.equal(d({ idleMs: 500 }), "soon");
  assert.equal(d({ idleMs: R.IDLE_MS - 1 }), "soon");
  assert.equal(d({ idleMs: R.IDLE_MS }), "reload");
  assert.equal(d({ sinceReturnMs: 800, interactedSinceReturn: true, idleMs: 500 }), "soon", "touching the screen cancels the 'just came back' case");
});

test("at most one automatic refresh every 15 seconds: in between, ask", () => {
  assert.equal(d({ sinceRefreshMs: 5000, idleMs: 99999 }), "ask");
  assert.equal(d({ sinceRefreshMs: R.LOOP_GUARD_MS - 1, idleMs: 99999 }), "ask");
  assert.equal(d({ sinceRefreshMs: R.LOOP_GUARD_MS, idleMs: 99999 }), "reload");
});

test("outside a browser, hearing the news does nothing and does not throw", () => {
  assert.doesNotThrow(() => R.notify([{ key: "jarvisTasks", rev: 5 }]));
  assert.deepEqual(R._pending(), {});
});

test("a clock set backwards never makes the time since something negative", () => {
  assert.equal(R.since(1000, 400, 0), 600);
  assert.equal(R.since(1000, 1000, 0), 0);
  assert.equal(R.since(1000, 5000, 0), 0, "touched 'in the future': counted from now");
  assert.equal(R.since(1000, 5000, Infinity), Infinity, "refreshed 'in the future': treated as long ago");
});
