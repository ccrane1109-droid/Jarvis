"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const library = require("../lib/library");
const niche = require("../lib/niche");
const insight = require("../lib/insight");
const { OWNER, KEY, fakeDb, fakeFetch, deps } = require("./helpers");

const postsPath = `users/${OWNER}/marketingPosts`;
const libPath = `users/${OWNER}/marketingState/library`;
const statePath = `users/${OWNER}/marketingState/niche`;

const post = (id, over) => Object.assign({
  id: id, url: "https://www.tiktok.com/@gratiel/video/" + id, kind: "short",
  content: { text: "Caption " + id, media_urls: [], thumbnail_url: null, duration_seconds: 12 },
  author: { id: "a1", username: "gratiel", display_name: "Gratiel", avatar_url: null, verified: false },
  engagement: { views: 1500, likes: 120, comments: 9, shares: 3, saves: null },
  flags: { deleted: false }, published_at: "2026-09-20T12:00:00Z", language: "en", ext: null
}, over || {});
const body = (list, used, remaining) => ({
  success: true, platform: "x", endpoint: "x", schema_version: "2",
  data: { items: list.map((p) => ({ post: p })), total: null, truncated: false, ext: null },
  pagination: { next_cursor: null, has_more: false, page_size: list.length, stopped_at: null },
  credits_used: used, credits_remaining: remaining === undefined ? 9000 : remaining, request_id: "r", cached: false
});
const ok = (list, used, remaining) => ({ status: 200, body: body(list, used, remaining) });
const tiktokOnly = (keywords) => ({ keywords: keywords, platforms: ["tiktok"] });

/* ---------------- research memory ---------------- */

test("a run's posts are saved once each, with the searches that found them", async () => {
  const d = deps({ fetchImpl: fakeFetch(() => ok([post("1"), post("2", { engagement: { views: 900, likes: 5, comments: 0, shares: 0 } })], 10)) });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith", "hope"]) });
  assert.deepEqual({ created: res.run.library.created, updated: res.run.library.updated, count: res.run.library.count },
    { created: 2, updated: 0, count: 2 }, "the same post found by two searches is one library entry");
  const saved = d.db.store.get(`${postsPath}/tiktok_1`);
  assert.equal(saved.text, "Caption 1");
  assert.equal(saved.views, 1500);
  assert.deepEqual(saved.queries, ["faith", "hope"]);
  assert.deepEqual(saved.sessions, [res.run.id]);
  assert.equal(saved.seenCount, 1);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.bookmarked, false);
  assert.equal(d.db.store.get(libPath).count, 2);
  assert.match(res.run.summary.join(" "), /2 new posts added to your library \(2 saved in all\)/);
  assert.ok(!JSON.stringify([...d.db.store.values()]).includes(KEY));
});

test("seeing a post again later records the change; the same cached result adds no data point", async () => {
  let clock = new Date("2026-10-14T15:00:00Z");
  let views = 1500;
  const d = deps({ now: () => clock, fetchImpl: fakeFetch(() => ok([post("1", { engagement: { views: views, likes: 120, comments: 9, shares: 3 } })], 10)) });
  const run = () => niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  await run();
  clock = new Date("2026-10-14T20:00:00Z");
  const cached = await run();
  assert.equal(cached.run.sources[0].status, "cached");
  assert.equal(d.db.store.get(`${postsPath}/tiktok_1`).seenCount, 1, "a reused result isn't a new sighting");
  assert.equal(d.db.store.get(`${postsPath}/tiktok_1`).history.length, 1);
  assert.equal(cached.run.library.created, 0);
  assert.equal(cached.run.library.updated, 1);

  clock = new Date("2026-10-16T15:00:00Z");
  views = 4000;
  await run();
  const saved = d.db.store.get(`${postsPath}/tiktok_1`);
  assert.deepEqual([saved.views, saved.prevViews, saved.seenCount, saved.history.length], [4000, 1500, 2, 2]);
  assert.equal(saved.firstSeenAt, "2026-10-14T15:00:00.000Z");
  assert.equal(saved.prevSeenAt, "2026-10-14T15:00:00.000Z");
  assert.equal(saved.lastSeenAt, "2026-10-16T15:00:00.000Z");
  assert.equal(d.db.store.get(libPath).count, 1);
});

test("a metric the platform stops reporting keeps its last known value; nothing is invented", () => {
  const first = library.mergePost(null, { id: "1", url: null, text: "a", author: "x", views: 100, likes: 10, comments: null, shares: null, publishedAt: null }, "tiktok", "2026-10-01T00:00:00.000Z", "q", "s1");
  const next = library.mergePost(first, { id: "1", url: null, text: "", author: null, views: null, likes: 12, comments: null, shares: null, publishedAt: null }, "tiktok", "2026-10-02T00:00:00.000Z", "q2", "s2");
  assert.deepEqual([next.views, next.likes, next.comments, next.text, next.author], [100, 12, null, "a", "x"]);
  assert.deepEqual([next.queries, next.sessions], [["q", "q2"], ["s1", "s2"]]);
});

test("history, queries and sessions stay bounded", () => {
  let p = null;
  for (let i = 0; i < 45; i++) {
    p = library.mergePost(p, { id: "1", url: null, text: "t", author: null, views: i, likes: 0, comments: 0, shares: 0, publishedAt: null }, "tiktok",
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), "q" + i, "s" + i);
  }
  assert.equal(p.history.length, library.HISTORY_LIMIT);
  assert.equal(p.queries.length, 8);
  assert.equal(p.sessions.length, 8);
  assert.equal(p.seenCount, 45);
  assert.equal(p.views, 44);
});

test("posts with ids that can't be stored are skipped and counted, not saved", async () => {
  const d = deps({ fetchImpl: fakeFetch(() => ok([post("good-1"), post("../evil"), post("has space")], 10)) });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  assert.deepEqual([res.run.library.created, res.run.library.skipped], [1, 2]);
  assert.deepEqual([...d.db.store.keys()].filter((k) => k.startsWith(postsPath)), [`${postsPath}/tiktok_good-1`]);
});

test("if saving to the library breaks, the run's results are still returned and stored", async () => {
  const db = fakeDb();
  const realDoc = db.doc;
  db.doc = (path) => {
    const ref = realDoc(path);
    if (path.includes("/marketingPosts/")) return Object.assign({}, ref, { set: async () => { throw new Error("firestore down"); } });
    return ref;
  };
  const d = deps({ db: db, fetchImpl: fakeFetch(() => ok([post("1")], 10)) });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  assert.equal(res.ok, true);
  assert.equal(res.run.sources[0].items.length, 1);
  assert.match(res.run.library.error, /couldn't be saved/);
  assert.match(res.run.summary.join(" "), /couldn't be saved to your research library/);
  assert.equal(db.store.get(statePath).lastRun.id, res.run.id);
});

test("a run where everything failed saves nothing", async () => {
  const down = { status: 503, body: { success: false, error: { message: "Down." }, credits_used: 0 } };
  const d = deps({ fetchImpl: fakeFetch(() => down) });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  assert.equal(res.run.library, null);
  assert.equal([...d.db.store.keys()].some((k) => k.startsWith(postsPath)), false);
});

/* ---------------- reading and bookmarking ---------------- */

async function seeded() {
  let n = 0;
  const d = deps({ fetchImpl: fakeFetch(() => ok([post("a" + n), post("b" + n++, { engagement: { views: 50000, likes: 1, comments: 1, shares: 1 } })], 10)) });
  await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  return d;
}

test("the library list is owner-only, carries no history array, and reports counts", async () => {
  const d = await seeded();
  await assert.rejects(library.handle(null, { action: "list" }, d), (e) => e.code === "unauthenticated");
  await assert.rejects(library.handle("intruder", { action: "list" }, d), (e) => e.code === "permission-denied");
  await assert.rejects(library.handle(OWNER, { action: "nope" }, d), (e) => e.code === "invalid-argument");
  const res = await library.handle(OWNER, { action: "list" }, d);
  assert.deepEqual([res.ok, res.total, res.bookmarks, res.limit], [true, 2, 0, 1000]);
  assert.equal(res.posts.length, 2);
  res.posts.forEach((p) => {
    assert.ok(!("history" in p));
    assert.deepEqual(Object.keys(p).sort(), ["author", "bookmarked", "comments", "firstSeenAt", "id", "key", "lastSeenAt", "likes", "platform", "prevSeenAt", "prevViews", "publishedAt", "queries", "seenCount", "sessions", "shares", "text", "url", "views"]);
  });
  assert.equal(d.fetchImpl.calls.length, 1, "reading the library never calls InsightSocial");
});

test("bookmarks are saved, counted, and checked", async () => {
  const d = await seeded();
  const key = "tiktok_a0";
  assert.deepEqual(await library.handle(OWNER, { action: "bookmark", key: key, bookmarked: true }, d), { ok: true, key: key, bookmarked: true });
  assert.equal(d.db.store.get(`${postsPath}/${key}`).bookmarked, true);
  assert.equal(d.db.store.get(libPath).bookmarks, 1);
  await library.handle(OWNER, { action: "bookmark", key: key, bookmarked: true }, d);
  assert.equal(d.db.store.get(libPath).bookmarks, 1, "bookmarking twice counts once");
  assert.equal((await library.handle(OWNER, { action: "list" }, d)).bookmarks, 1);
  await library.handle(OWNER, { action: "bookmark", key: key, bookmarked: false }, d);
  assert.equal(d.db.store.get(libPath).bookmarks, 0);
  assert.equal(d.db.store.get(`${postsPath}/${key}`).bookmarked, false);

  for (const bad of ["tiktok_", "x_1", "../tiktok_a0", "tiktok_a0/../x", 5, null, "tiktok_" + "a".repeat(65)]) {
    await assert.rejects(library.handle(OWNER, { action: "bookmark", key: bad, bookmarked: true }, d), (e) => e.code === "invalid-argument", String(bad));
  }
  await assert.rejects(library.handle(OWNER, { action: "bookmark", key: "tiktok_missing", bookmarked: true }, d), (e) => e.code === "not-found");
});

test("a bookmark survives the next run; the 300-bookmark limit is enforced", async () => {
  const d = await seeded();
  await library.handle(OWNER, { action: "bookmark", key: "tiktok_a0", bookmarked: true }, d);
  d.now = () => new Date("2026-10-16T15:00:00Z");
  await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  assert.equal(d.db.store.get(`${postsPath}/tiktok_a0`).bookmarked, true);

  const full = deps({ db: fakeDb({ [libPath]: { count: 5, bookmarks: library.MAX_BOOKMARKS }, [`${postsPath}/tiktok_1`]: { key: "tiktok_1", bookmarked: false } }) });
  await assert.rejects(library.handle(OWNER, { action: "bookmark", key: "tiktok_1", bookmarked: true }, full), (e) => e.code === "resource-exhausted");
});

test("past 1,000 posts the least recently seen un-bookmarked ones are removed; bookmarks never are", async () => {
  const init = { [libPath]: { count: 1000, bookmarks: 1 } };
  for (let i = 0; i < 1000; i++) {
    const key = "tiktok_old" + i;
    init[`${postsPath}/${key}`] = { key: key, platform: "tiktok", id: "old" + i, text: "", lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), seenCount: 1, bookmarked: i === 0 };
  }
  const d = deps({ db: fakeDb(init), fetchImpl: fakeFetch(() => ok([post("new1"), post("new2")], 10)) });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  const left = [...d.db.store.keys()].filter((k) => k.startsWith(postsPath));
  assert.equal(left.length, library.PRUNE_TO);
  assert.equal(res.run.library.pruned, 102);
  assert.ok(d.db.store.has(`${postsPath}/tiktok_old0`), "the oldest post survives because it is bookmarked");
  assert.ok(!d.db.store.has(`${postsPath}/tiktok_old1`), "the next oldest is removed");
  assert.ok(d.db.store.has(`${postsPath}/tiktok_new1`) && d.db.store.has(`${postsPath}/tiktok_new2`));
  assert.deepEqual([d.db.store.get(libPath).count, d.db.store.get(libPath).bookmarks], [library.PRUNE_TO, 1]);
});

/* ---------------- credit balance check ---------------- */

test("the balance check compares InsightSocial's balance with what its searches reported", async () => {
  let remaining = 10000;
  const d = deps({
    db: fakeDb({ [`users/${OWNER}/marketingUsage/2026-10`]: { creditsUsed: 0, lastCreditsRemaining: 10000 } }),
    fetchImpl: fakeFetch(() => { remaining -= 10; return ok([post("p" + remaining)], 10, remaining); })
  });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["a1", "b2", "c3"]) });
  assert.deepEqual(res.run.balance, { before: 10000, after: 9970, reported: 30, unexplained: 0 });
  assert.ok(!/balance dropped/.test(res.run.summary.join(" ")));
});

test("a balance that drops more than the searches reported is flagged, without guessing why", async () => {
  let remaining = 10000;
  const d = deps({
    db: fakeDb({ [`users/${OWNER}/marketingUsage/2026-10`]: { creditsUsed: 0, lastCreditsRemaining: 10000 } }),
    fetchImpl: fakeFetch(() => { remaining -= 25; return ok([post("p" + remaining)], 10, remaining); })
  });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["a1", "b2"]) });
  // two searches reported 10 credits each, but the balance fell by 50
  assert.deepEqual(res.run.balance, { before: 10000, after: 9950, reported: 20, unexplained: 30 });
  assert.match(res.run.summary.join(" "), /InsightSocial's balance dropped by 30 more credits than these searches reported \(10000 to 9950\)\. JARVIS can't tell why\./);
  assert.equal(d.db.store.get(statePath).runs[0].balance.unexplained, 30);
});

test("with no earlier balance, or a search that reported no cost, nothing is claimed", async () => {
  const fresh = deps({ fetchImpl: fakeFetch(() => ok([post("1")], 10, 9000)) });
  const r1 = await niche.runNicheResearch(OWNER, fresh, { niche: tiktokOnly(["a1"]) });
  assert.deepEqual(r1.run.balance, { before: null, after: 9000, reported: 10, unexplained: null });

  const noCost = deps({
    db: fakeDb({ [`users/${OWNER}/marketingUsage/2026-10`]: { lastCreditsRemaining: 9000 } }),
    fetchImpl: fakeFetch(() => ({ status: 200, body: Object.assign(body([post("2")], 10, 8000), { credits_used: undefined }) }))
  });
  const r2 = await niche.runNicheResearch(OWNER, noCost, { niche: tiktokOnly(["a1"]) });
  assert.equal(r2.run.balance.unexplained, null);
  assert.equal(r2.run.creditsUsed, 10, "the documented price is still counted toward the run limit");

  const cachedOnly = deps({ fetchImpl: fakeFetch(() => ok([post("3")], 10, 9000)) });
  await niche.runNicheResearch(OWNER, cachedOnly, { niche: tiktokOnly(["a1"]) });
  const again = await niche.runNicheResearch(OWNER, cachedOnly, { niche: tiktokOnly(["a1"]) });
  assert.equal(again.run.sources[0].cached, true);
  assert.deepEqual(again.run.balance, { before: 9000, after: null, reported: null, unexplained: null }, "no live search, so nothing to compare");
});

test("InsightSocial's stated reason for a charge is passed on as plain text", async () => {
  const withReason = Object.assign(body([post("1")], 0, 9990), { free_call: true, charge_reason: "  Free during\u0000 beta  " });
  const d = deps({ fetchImpl: fakeFetch(() => ({ status: 200, body: withReason })) });
  const res = await niche.runNicheResearch(OWNER, d, { niche: tiktokOnly(["faith"]) });
  assert.equal(res.run.sources[0].chargeReason, "Free during beta");
  assert.match(res.run.summary.join(" "), /InsightSocial's note on the charge: Free during beta/);
  const direct = await insight.runInsightRequest(OWNER, { endpoint: "tiktok.search.top", params: { query: "other" } }, deps({ fetchImpl: fakeFetch(() => ({ status: 200, body: withReason })) }));
  assert.equal(direct.chargeReason, "Free during beta");
});

test("status reports the library size and bookmarks for the Overview", async () => {
  const d = await seeded();
  await library.handle(OWNER, { action: "bookmark", key: "tiktok_a0", bookmarked: true }, d);
  const status = await insight.getStatus(OWNER, d);
  assert.deepEqual([status.libraryCount, status.libraryBookmarks], [2, 1]);
  const empty = await insight.getStatus(OWNER, deps());
  assert.deepEqual([empty.libraryCount, empty.libraryBookmarks, empty.nicheRuns, empty.nicheLastFullAt], [0, 0, [], null]);
});
