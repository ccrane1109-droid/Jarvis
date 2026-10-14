"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const research = require("../lib/research");
const { OWNER, fakeDb, fakeFetch, deps } = require("./helpers");

const settingsPath = `users/${OWNER}/marketing/settings`;
const statePath = `users/${OWNER}/marketingState/research`;
const profile = (followers, posts) => ({ status: 200, body: { success: true, data: { id: 12345, username: "x", followers, stats: { posts }, created_at: 1700000000 }, credits_used: 1, credits_remaining: 9000 } });

test("extractMetrics keeps numeric fields by their real names and skips ids/timestamps/credits", () => {
  const m = research.extractMetrics({ success: true, data: { id: 9, user_pk: 3, followers: 10, following: 2, bio: "hi", stats: { posts: 5, last_post_at: 99 }, list: [1, 2] }, credits_used: 1 });
  assert.deepEqual(m, { followers: 10, following: 2, "stats.posts": 5 });
});

test("compareMetrics reports changed fields, largest change first", () => {
  const c = research.compareMetrics({ followers: 100, posts: 10, gone: 1 }, { followers: 130, posts: 9, posts2: 3 });
  assert.deepEqual(c.map((x) => [x.name, x.delta]), [["followers", 30], ["posts", -1]]);
});

test("empty watchlist records a successful run with guidance and makes no requests", async () => {
  const d = deps();
  const res = await research.runResearch(OWNER, d, { trigger: "manual" });
  assert.equal(res.ok, true);
  assert.match(res.run.summary[0], /No competitors on your watchlist/);
  assert.equal(d.fetchImpl.calls.length, 0);
  assert.ok(d.db.store.get(statePath).lastRun);
});

test("first run saves snapshots; next day's run reports changes in plain language", async () => {
  let clock = new Date("2026-10-14T13:00:00Z");
  const d = deps({
    now: () => clock,
    db: fakeDb({ [settingsPath]: { watchlist: ["@BrandA", "branda", "brandb", "bad handle!"] } }),
    fetchImpl: fakeFetch((url) => (url.includes("brandb") ? profile(500, 40) : profile(1000, 20)))
  });
  const first = await research.runResearch(OWNER, d, { trigger: "schedule" });
  assert.equal(first.ok, true);
  assert.equal(first.run.results.length, 2, "duplicates and invalid handles are dropped");
  assert.match(first.run.summary[0], /@branda: first snapshot saved \(2 numeric fields\)/);
  const snapA = d.db.store.get(`users/${OWNER}/marketingSnapshots/branda`);
  assert.deepEqual(snapA.latest.metrics, { followers: 1000, "stats.posts": 20 });

  clock = new Date("2026-10-15T13:00:00Z");
  d.fetchImpl = fakeFetch((url) => (url.includes("brandb") ? profile(500, 40) : profile(1060, 21)));
  const second = await research.runResearch(OWNER, d, { trigger: "schedule" });
  assert.match(second.run.summary[0], /@branda: followers 1,000 → 1,060 \(\+60\), stats\.posts 20 → 21 \(\+1\) since 2026-10-14/);
  assert.match(second.run.summary[1], /@brandb: no changes since 2026-10-14/);
  assert.equal(d.db.store.get(`users/${OWNER}/marketingSnapshots/branda`).history.length, 2);
  const state = d.db.store.get(statePath);
  assert.equal(state.runs.length, 2);
  assert.equal(state.lastSuccessfulRunAt, second.run.finishedAt);
  assert.equal(second.run.creditsUsed, 2);
});

test("manual run within 30 minutes reuses the last run instead of spending credits", async () => {
  let clock = new Date("2026-10-14T13:00:00Z");
  const d = deps({ now: () => clock, db: fakeDb({ [settingsPath]: { watchlist: ["branda"] } }), fetchImpl: fakeFetch([profile(1, 1)]) });
  await research.runResearch(OWNER, d, { trigger: "manual" });
  clock = new Date("2026-10-14T13:10:00Z");
  const again = await research.runResearch(OWNER, d, { trigger: "manual" });
  assert.equal(again.reused, true);
  assert.match(again.note, /less than 30 minutes ago/);
  assert.equal(d.fetchImpl.calls.length, 1);
});

test("credit cap stops the run; remaining handles are marked, failures recorded", async () => {
  const d = deps({ db: fakeDb({ [settingsPath]: { watchlist: ["a1", "a2"], monthlyCreditCap: 0 } }) });
  const res = await research.runResearch(OWNER, d, { trigger: "schedule" });
  assert.equal(res.ok, false);
  assert.equal(d.fetchImpl.calls.length, 0);
  assert.equal(res.run.results.length, 2);
  assert.ok(res.run.results.every((r) => !r.ok && /credit cap/.test(r.error)));
  assert.equal(d.db.store.get(statePath).lastSuccessfulRunAt, null);
});

test("an InsightSocial failure for one handle doesn't stop the others", async () => {
  const busy = { status: 503, body: { success: false, error: { message: "Capacity is temporarily exhausted." }, credits_used: 0 } };
  const d = deps({ db: fakeDb({ [settingsPath]: { watchlist: ["a1", "a2"] } }), fetchImpl: fakeFetch((url) => (url.includes("a1") ? busy : profile(5, 1))) });
  const res = await research.runResearch(OWNER, d, { trigger: "schedule" });
  assert.equal(res.ok, true);
  assert.match(res.run.summary[0], /@a1: couldn't refresh \(Capacity is temporarily exhausted\.\)/);
  assert.match(res.run.summary[1], /@a2: first snapshot saved/);
});

test("only the owner can run research", async () => {
  await assert.rejects(research.runResearch("intruder", deps(), { trigger: "manual" }), (e) => e.code === "permission-denied");
});
