"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const insight = require("../lib/insight");

const { OWNER, KEY, fakeDb, fakeFetch, deps } = require("./helpers");

const profileReq = (handle, extra) => Object.assign({ endpoint: "instagram.profile", params: { handle } }, extra || {});
const okBody = (credits, remaining) => ({ success: true, data: { username: "gratiel", followers: 1234 }, credits_used: credits, credits_remaining: remaining, request_id: "req_1" });

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof insight.InsightError && err.code === code);
}

test("rejects signed-out callers", async () => {
  await rejectsWith(insight.runInsightRequest(null, profileReq("gratiel"), deps()), "unauthenticated");
});

test("rejects any account other than the owner", async () => {
  const d = deps();
  await rejectsWith(insight.runInsightRequest("someone-else", profileReq("gratiel"), d), "permission-denied");
  assert.equal(d.fetchImpl.calls.length, 0);
});

test("fails clearly when OWNER_UID or the key is not configured", async () => {
  await rejectsWith(insight.runInsightRequest(OWNER, profileReq("gratiel"), deps({ ownerUid: "" })), "failed-precondition");
  await rejectsWith(insight.runInsightRequest(OWNER, profileReq("gratiel"), deps({ apiKey: "" })), "failed-precondition");
  await rejectsWith(insight.runInsightRequest(OWNER, profileReq("gratiel"), deps({ apiKey: "mypasswordgram" })), "failed-precondition");
});

test("rejects endpoints that aren't allow-listed and invalid handles", async () => {
  const d = deps();
  await rejectsWith(insight.runInsightRequest(OWNER, { endpoint: "tiktok.search", params: { q: "x" } }, d), "invalid-argument");
  await rejectsWith(insight.runInsightRequest(OWNER, profileReq("bad handle!"), d), "invalid-argument");
  await rejectsWith(insight.runInsightRequest(OWNER, profileReq("../../admin"), d), "invalid-argument");
  await rejectsWith(insight.runInsightRequest(OWNER, { endpoint: "instagram.profile", params: {} }, d), "invalid-argument");
  assert.equal(d.fetchImpl.calls.length, 0);
});

test("successful lookup: key sent only as a header, usage recorded, result cached", async () => {
  const d = deps({ fetchImpl: fakeFetch([{ status: 200, body: okBody(2, 9998) }]) });
  const res = await insight.runInsightRequest(OWNER, profileReq("@Gratiel"), d);
  assert.equal(res.ok, true);
  assert.equal(res.cached, false);
  assert.equal(res.creditsUsed, 2);
  assert.equal(res.creditsRemaining, 9998);
  assert.equal(res.params.handle, "gratiel");
  const call = d.fetchImpl.calls[0];
  assert.equal(call.url, "https://api.insightsocial.app/v1/instagram/profile?handle=gratiel");
  assert.equal(call.headers["x-api-key"], KEY);
  assert.ok(!call.url.includes(KEY));
  const usage = d.db.store.get(`users/${OWNER}/marketingUsage/2026-10`);
  assert.deepEqual([usage.requests, usage.creditsUsed, usage.unknownCostRequests, usage.lastCreditsRemaining], [1, 2, 0, 9998]);
  assert.ok(!JSON.stringify(res).includes(KEY), "key must not appear in the response");
  assert.ok(!JSON.stringify([...d.db.store.values()]).includes(KEY), "key must not be stored");
  assert.ok(!JSON.stringify(d.logs).includes(KEY), "key must not be logged");
});

test("repeat lookup within 12h is served from cache with no request or charge", async () => {
  const d = deps({ fetchImpl: fakeFetch([{ status: 200, body: okBody(2, 9998) }]) });
  await insight.runInsightRequest(OWNER, profileReq("gratiel"), d);
  const again = await insight.runInsightRequest(OWNER, profileReq("GRATIEL"), d);
  assert.equal(again.cached, true);
  assert.equal(again.creditsUsed, 0);
  assert.equal(d.fetchImpl.calls.length, 1);
  assert.equal(d.db.store.get(`users/${OWNER}/marketingUsage/2026-10`).requests, 1);
});

test("refresh within 10 minutes reuses the saved result; after that it fetches again", async () => {
  let clock = new Date("2026-10-14T15:00:00Z");
  const d = deps({ now: () => clock, fetchImpl: fakeFetch([{ status: 200, body: okBody(1, 9) }, { status: 200, body: okBody(1, 8) }]) });
  await insight.runInsightRequest(OWNER, profileReq("gratiel"), d);
  clock = new Date("2026-10-14T15:05:00Z");
  const early = await insight.runInsightRequest(OWNER, profileReq("gratiel", { refresh: true }), d);
  assert.equal(early.cached, true);
  assert.match(early.note, /less than 10 minutes/);
  clock = new Date("2026-10-14T15:20:00Z");
  const late = await insight.runInsightRequest(OWNER, profileReq("gratiel", { refresh: true }), d);
  assert.equal(late.cached, false);
  assert.equal(d.fetchImpl.calls.length, 2);
});

test("expired cache (older than 12h) triggers a fresh request", async () => {
  let clock = new Date("2026-10-14T00:00:00Z");
  const d = deps({ now: () => clock, fetchImpl: fakeFetch([{ status: 200, body: okBody(1, 9) }, { status: 200, body: okBody(1, 8) }]) });
  await insight.runInsightRequest(OWNER, profileReq("gratiel"), d);
  clock = new Date("2026-10-14T13:00:00Z");
  const res = await insight.runInsightRequest(OWNER, profileReq("gratiel"), d);
  assert.equal(res.cached, false);
});

test("monthly cap blocks new requests, falls back to a saved result when there is one", async () => {
  const usagePath = `users/${OWNER}/marketingUsage/2026-10`;
  const d = deps({ db: fakeDb({ [`users/${OWNER}/marketing/settings`]: { monthlyCreditCap: 5 }, [usagePath]: { creditsUsed: 5 } }) });
  await rejectsWith(insight.runInsightRequest(OWNER, profileReq("gratiel"), d), "resource-exhausted");
  assert.equal(d.fetchImpl.calls.length, 0);

  let clock = new Date("2026-10-14T00:00:00Z");
  const d2 = deps({ now: () => clock, fetchImpl: fakeFetch([{ status: 200, body: okBody(5, 5) }]) });
  await d2.db.doc(`users/${OWNER}/marketing/settings`).set({ monthlyCreditCap: 5 });
  await insight.runInsightRequest(OWNER, profileReq("gratiel"), d2);
  clock = new Date("2026-10-14T13:00:00Z");
  const stale = await insight.runInsightRequest(OWNER, profileReq("gratiel"), d2);
  assert.equal(stale.cached, true);
  assert.equal(stale.stale, true);
  assert.match(stale.note, /cap \(5\)/);
  assert.equal(d2.fetchImpl.calls.length, 1);
});

test("default monthly cap applies when no setting is saved", async () => {
  const status = await insight.getStatus(OWNER, deps());
  assert.equal(status.monthlyCreditCap, insight.DEFAULT_MONTHLY_CREDIT_CAP);
});

test("InsightSocial 503 is returned as a clear failure, recorded at 0 credits, not cached", async () => {
  const busy = { success: false, error: { type: "SERVICE_UNAVAILABLE", message: "Capacity is temporarily exhausted. Nothing was charged. Retry shortly." }, credits_used: 0, credits_remaining: 10000 };
  const d = deps({ fetchImpl: fakeFetch([{ status: 503, body: busy }]) });
  const res = await insight.runInsightRequest(OWNER, profileReq("gratiel"), d);
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.match(res.error, /Capacity is temporarily exhausted/);
  assert.equal(res.creditsRemaining, 10000);
  const usage = d.db.store.get(`users/${OWNER}/marketingUsage/2026-10`);
  assert.equal(usage.creditsUsed, 0);
  assert.equal([...d.db.store.keys()].some((k) => k.includes("marketingCache")), false);
});

test("missing credit cost is counted as unknown-cost", async () => {
  const d = deps({ fetchImpl: fakeFetch([{ status: 200, body: { success: true, data: {} } }]) });
  await insight.runInsightRequest(OWNER, profileReq("gratiel"), d);
  const usage = d.db.store.get(`users/${OWNER}/marketingUsage/2026-10`);
  assert.equal(usage.unknownCostRequests, 1);
  assert.equal(usage.creditsUsed, 0);
});

test("invalid JSON, oversized responses, timeouts and network errors are handled", async () => {
  const big = "x".repeat(300 * 1024);
  const d = deps({ fetchImpl: fakeFetch([
    { status: 200, body: "<html>oops</html>" },
    { status: 200, body: big },
    { throws: "aborted", name: "AbortError" },
    { throws: "ECONNRESET" }
  ]) });
  const r1 = await insight.runInsightRequest(OWNER, profileReq("a1"), d);
  const r2 = await insight.runInsightRequest(OWNER, profileReq("a2"), d);
  const r3 = await insight.runInsightRequest(OWNER, profileReq("a3"), d);
  const r4 = await insight.runInsightRequest(OWNER, profileReq("a4"), d);
  assert.match(r1.error, /wasn't valid JSON/);
  assert.match(r2.error, /unexpectedly large/);
  assert.match(r3.error, /didn't respond in time/);
  assert.match(r4.error, /Couldn't reach InsightSocial/);
  [r1, r2, r3, r4].forEach((r) => assert.equal(r.ok, false));
  // Two requests reached InsightSocial (r1, r2); the timeout/network failures are not counted.
  assert.equal(d.db.store.get(`users/${OWNER}/marketingUsage/2026-10`).requests, 2);
});

test("status reports configuration and this month's usage without calling InsightSocial", async () => {
  const d = deps({ db: fakeDb({ [`users/${OWNER}/marketingUsage/2026-10`]: { creditsUsed: 7, requests: 3, unknownCostRequests: 1, lastCreditsRemaining: 9993 } }) });
  const s = await insight.getStatus(OWNER, d);
  assert.equal(s.keyConfigured, true);
  assert.equal(s.month, "2026-10");
  assert.deepEqual([s.usage.creditsUsed, s.usage.requests, s.usage.unknownCostRequests, s.usage.lastCreditsRemaining], [7, 3, 1, 9993]);
  assert.equal(s.usage.aiCostUsd, 0);
  assert.equal(s.monthlyBudgetUsd, 20);
  assert.equal(s.aiAllowanceUsd, 20);
  assert.equal(s.aiKeyConfigured, false);
  assert.deepEqual(s.aiPrices["claude-opus-5-5"], { input: 4, output: 20 });
  assert.equal(s.aiMaxOutputTokens, 16000);
  assert.equal(s.lastRun, null);
  assert.deepEqual(s.endpoints, ["instagram.profile"]);
  assert.equal(d.fetchImpl.calls.length, 0);
  await rejectsWith(insight.getStatus("intruder", d), "permission-denied");
  const s2 = await insight.getStatus(OWNER, deps({ apiKey: "" }));
  assert.equal(s2.keyConfigured, false);
});
